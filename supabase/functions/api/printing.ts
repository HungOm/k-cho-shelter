/*
 * GENERATING THE CODES THAT GO ON PRINTED TICKETS.
 *
 * A ticket row has existed since somebody made the tickets. Generating is a
 * second and separate thing: it gives that ticket a code, and from then on the
 * ticket can be printed, scanned and proved genuine. A ticket that has never
 * been generated is not broken — it is simply not printed yet, and every screen
 * says so in those words.
 *
 * IT IS DONE ONCE AND KEPT. Running it again over the same tickets generates
 * nothing and reports that it generated nothing. That is what makes a reprint
 * safe: the ticket in somebody's hand and the ticket coming off the printer
 * carry the same code, because the code was not re-rolled.
 *
 * ORGANISERS AND THE SYSTEM ADMIN ONLY, AND NOT GRANTABLE — registered
 * ADMIN_ONLY and `kind: 'write'` in index.ts, pinned by tests/strictactions.
 * A code is the thing that makes a ticket provable; handing out the ability to
 * mint them is handing out the ability to make a forgery verify.
 *
 * NOTHING HERE TOUCHES THE tickets TABLE. Deliberately. Every update to a
 * ticket fires bump_version() and record_ticket_history(), so minting twenty
 * thousand codes that way would raise twenty thousand version numbers and hand
 * every connected phone twenty thousand changed tickets to re-download. The
 * codes live in their own table for that reason as much as for tidiness.
 */
import { ApiError, type AppUser } from './gate.ts'
import { newCode, DEFAULT_LENGTH } from '../_shared/ticketcode.ts'
/* The one bound the check page and this function have to agree about. */
import { HOLDING_MAX_TICKETS } from '../_shared/holding.ts'

type Ctx = {
  supabaseAdmin: { from: (t: string) => any }
}

/** A ticket, as every function here needs it: its index, its label, its book. */
type Ticket = { idx: number; number: string; bookIdx: number }

/*
 * How many tickets one call will generate for.
 *
 * Not a limit on the raffle — the screen loops and shows progress — but on one
 * request. A whole raffle is twenty thousand rows, which is a long-running
 * insert behind a function timeout that would leave nobody knowing how far it
 * got. Five thousand is comfortably inside the timeout and small enough that a
 * retry after a dropped connection is cheap.
 */
export const MAX_PER_CALL = 5000

/*
 * And how many can be DRAWN at once, which is a far smaller number.
 *
 * Generating writes sixty bytes a ticket; drawing lays out a full page of
 * artwork per ticket in a browser. Two hundred is about a printer's worth and
 * comfortably inside what a phone can render without falling over.
 */
export const MAX_PER_PRINT = 200

/** Rows per insert. Postgres is happy with far more; the wire is the limit. */
const CHUNK = 500

/**
 * WHICH ARTWORK TO PRINT ON, AND WHAT TO DO WHEN THE SETTING HAS GONE.
 *
 * `TICKET_ARTWORK_ID` lives in `config`; the artwork itself lives in
 * `ticket_templates`. A reset empties the first and leaves the second, so a
 * raffle ends up holding artwork it can no longer name — and this screen said
 * "There is no ticket artwork yet", which is FALSE and sends somebody off to
 * upload a second copy of the picture they already have.
 *
 * A setting that points at nothing is not the same as having nothing, and the
 * two must not share a sentence.
 *
 * ONE IS ADOPTED; SEVERAL ARE NOT. With exactly one template there is nothing
 * to choose, so the setting is repaired in place and printing carries on. With
 * several, picking one would be guessing which paper this raffle prints on —
 * a physical decision, expensive to get wrong, and nobody's to make silently.
 *
 * templates.ts already does exactly this on upload, adopting the new artwork
 * when the configured id is blank OR DANGLING. This is the same rule on the
 * read side, which is where a reset leaves the damage.
 */
async function activeTemplateId(
  ctx: Ctx, cfg: Record<string, string>, opts: { requireRow?: boolean } = {},
): Promise<string> {
  /*
   * `requireRow` separates the two callers, and they genuinely differ.
   * renderTickets DRAWS, so a named artwork that is no longer there is nothing
   * to print onto. generateTickets only mints codes; it checks artwork exists
   * so it cannot hand out codes for tickets nobody could print, and has never
   * needed the row itself. Requiring it there would be a stricter rule than
   * the one that was agreed, smuggled in under a repair.
   */
  const want = String(cfg.TICKET_ARTWORK_ID ?? '')
  const { data, error } = await ctx.supabaseAdmin
    .from('ticket_templates').select('id').order('uploaded_at', { ascending: false })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  const ids = (data ?? []).map((r: Record<string, unknown>) => String(r.id ?? ''))

  if (want && (ids.includes(want) || !opts.requireRow)) return want

  if (ids.length === 1) {
    const { error: wErr } = await ctx.supabaseAdmin
      .from('config').upsert([{ key: 'TICKET_ARTWORK_ID', value: ids[0] }], { onConflict: 'key' })
    if (wErr) throw new ApiError('QUERY_FAILED', wErr.message)
    return ids[0]
  }

  if (!ids.length) {
    throw new ApiError('NO_TEMPLATE',
      'There is no ticket artwork yet, so tickets cannot be printed. ' +
      'Upload it on the Ticket Studio screen first.')
  }

  throw new ApiError('NO_TEMPLATE_CHOSEN',
    `${ids.length} ticket artworks are stored and none of them is the chosen one. ` +
    'Open Ticket Studio and pick which one this raffle prints on.')
}

async function currentConfig(ctx: Ctx): Promise<Record<string, string>> {
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.key] = r.value
  return out
}

/*
 * Which tickets the caller means — A WINDOW OF THEM, not all of them.
 *
 * Exactly one of the four forms. Accepting a mixture is how a caller ends up
 * generating for a different set than it asked for, and on a job that writes
 * twenty thousand rows that is not a mistake anybody spots.
 *
 * `after` IS THE WHOLE POINT OF THIS FUNCTION'S SHAPE. An earlier version
 * materialised every ticket in the scope and refused if there were more than
 * five thousand of them — which meant "every ticket in the raffle" was an
 * option the screen offered and the server always refused, on any raffle big
 * enough to want it. It refused with a message saying the screen would do it a
 * chunk at a time, which the screen did not do. A raffle of ten thousand could
 * not generate or print its own tickets at all.
 *
 * So it returns a window ordered by index, starting after the index the caller
 * last saw, and says whether there may be more. The caller walks it.
 */
async function resolveScope(
  p: Record<string, unknown>,
  ctx: Ctx,
  limit: number,
): Promise<{ rows: Ticket[]; more: boolean }> {
  const forms = ['book', 'fromBook', 'numbers', 'all'].filter((k) => p[k] !== undefined)
  if (forms.length === 0) {
    throw new ApiError('MISSING_FIELD',
      'Nothing to do — say which book, which books, which tickets, or all of them.')
  }
  if (p.book !== undefined && p.fromBook !== undefined) {
    throw new ApiError('BAD_REQUEST', 'Give one book or a range of books, not both.')
  }
  const after = Number(p.after ?? 0) || 0

  const sel = () => ctx.supabaseAdmin.from('tickets').select('idx,number,book_idx')

  if (p.numbers !== undefined) {
    const list = Array.isArray(p.numbers) ? p.numbers.map((n) => String(n).trim()).filter(Boolean) : []
    if (!list.length) throw new ApiError('MISSING_FIELD', 'No ticket numbers were given.')
    if (list.length > MAX_PER_CALL) {
      throw new ApiError('RANGE_TOO_LARGE',
        `That is ${list.length} tickets named one by one. ${MAX_PER_CALL} is the most in one go — ` +
        'name a book or a run of books instead.')
    }
    const { data, error } = await sel().in('number', list)
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    const found = new Set((data ?? []).map((r: any) => String(r.number)))
    const missing = list.filter((n) => !found.has(n))
    /*
     * Refuse the whole run rather than working on the ones that exist. A caller
     * who asked for ten tickets and silently got eight has a gap in a printed
     * book and no way to know which one.
     */
    if (missing.length) {
      throw new ApiError('TICKET_NOT_FOUND',
        `${missing.length === 1 ? 'This is not a ticket in this raffle' : 'These are not tickets in this raffle'}: ` +
        missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, and ${missing.length - 5} more` : '') + '.')
    }
    const rows = (data ?? [])
      .map((r: any) => ({ idx: Number(r.idx), number: String(r.number), bookIdx: Number(r.book_idx) }))
      .filter((r) => r.idx > after)
      .sort((a, b) => a.idx - b.idx)
    return { rows: rows.slice(0, limit), more: rows.length > limit }
  }

  // By book, or a run of books, resolved to indexes so a range is arithmetic
  // rather than a string comparison on labels.
  let lo: number | null = null
  let hi: number | null = null
  if (p.book !== undefined || p.fromBook !== undefined) {
    const wanted = p.book !== undefined
      ? [String(p.book).trim()]
      : [String(p.fromBook ?? '').trim(), String(p.toBook ?? p.fromBook ?? '').trim()]
    const { data, error } = await ctx.supabaseAdmin.from('books').select('idx,number').in('number', wanted)
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    const byNumber = new Map((data ?? []).map((r: any) => [String(r.number), Number(r.idx)]))
    for (const w of wanted) {
      if (!byNumber.has(w)) throw new ApiError('BOOK_NOT_FOUND', `${w} is not a book in this raffle.`)
    }
    lo = byNumber.get(wanted[0])!
    hi = p.book !== undefined ? lo : byNumber.get(wanted[1])!
    if (hi < lo) throw new ApiError('BAD_REQUEST', `${wanted[1]} comes before ${wanted[0]}.`)
  }

  let q = sel()
  if (lo !== null) q = q.gte('book_idx', lo).lte('book_idx', hi as number)
  const { data, error } = await q.gt('idx', after).order('idx').limit(limit + 1)
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  const rows = (data ?? [])
    .map((r: any) => ({ idx: Number(r.idx), number: String(r.number), bookIdx: Number(r.book_idx) }))
  return { rows: rows.slice(0, limit), more: rows.length > limit }
}

/** The book each of these tickets belongs to, by its printed label. */
async function bookLabels(rows: Ticket[], ctx: Ctx): Promise<Map<number, string>> {
  const idxs = [...new Set(rows.map((r) => r.bookIdx))]
  if (!idxs.length) return new Map()
  const { data, error } = await ctx.supabaseAdmin.from('books').select('idx,number').in('idx', idxs)
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return new Map((data ?? []).map((r: any) => [Number(r.idx), String(r.number)]))
}

/**
 * Give these tickets a code, if they do not have one.
 *
 * ONE WINDOW PER CALL, and the reply says whether to come back. `after` is the
 * last index this call reached; passing it to the next call continues from
 * there. A raffle of twenty thousand is four calls, and each one is small
 * enough that a dropped connection costs a retry rather than a mystery.
 *
 * Answers with what it did rather than only that it worked: how many were
 * generated, how many already had a code, and whether there is more to do.
 * "Nothing to do" is a normal and useful answer — it is what a second run over
 * the same book says, and it is the difference between a reprint and a re-mint.
 */
export async function generateTickets(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const cfg = await currentConfig(ctx)

  /*
   * No artwork, no printing. Generating codes for tickets that cannot be drawn
   * would be minting something nobody can use, and the screen that would then
   * offer to print them has nothing to print onto.
   */
  const templateId = await activeTemplateId(ctx, cfg)

  const { rows: scope, more } = await resolveScope(p, ctx, MAX_PER_CALL)
  if (!scope.length) {
    return { generated: 0, alreadyGenerated: 0, batchId: null, total: 0, after: null, done: true }
  }

  // Which of them already have one. Asked in one query rather than per ticket.
  const { data: have, error: haveErr } = await ctx.supabaseAdmin
    .from('ticket_codes').select('ticket_idx').in('ticket_idx', scope.map((t) => t.idx))
  if (haveErr) throw new ApiError('QUERY_FAILED', haveErr.message)
  const already = new Set((have ?? []).map((r: any) => Number(r.ticket_idx)))
  const todo = scope.filter((t) => !already.has(t.idx))
  const lastIdx = scope[scope.length - 1].idx

  if (!todo.length) {
    return {
      generated: 0, alreadyGenerated: already.size, batchId: null,
      total: scope.length, after: lastIdx, done: !more,
    }
  }

  const batchId = crypto.randomUUID()
  const length = Math.max(8, Math.min(32, Number(cfg.TICKET_CODE_LENGTH ?? DEFAULT_LENGTH) || DEFAULT_LENGTH))

  /*
   * Every code distinct within the batch before it is sent.
   *
   * The unique index on `code` is the real guarantee; this is so that a
   * collision inside one insert — which would fail the whole chunk and leave a
   * confusing partial run — cannot happen in the first place. At sixty bits a
   * collision is not a practical worry, and checking is three lines.
   */
  const seen = new Set<string>()
  const rows = todo.map((t) => {
    let code = newCode(length)
    while (seen.has(code)) code = newCode(length)
    seen.add(code)
    return {
      ticket_idx: t.idx,
      code,
      template_id: templateId,
      batch_id: batchId,
      generated_by: user.email,
    }
  })

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await ctx.supabaseAdmin.from('ticket_codes').insert(rows.slice(i, i + CHUNK))
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'TICKETS_GENERATED',
    details: {
      batch: batchId,
      generated: rows.length,
      alreadyGenerated: already.size,
      first: todo[0]?.number,
      last: todo[todo.length - 1]?.number,
      template: templateId,
    },
    email: user.email,
  })

  return {
    generated: rows.length,
    alreadyGenerated: already.size,
    batchId,
    total: scope.length,
    first: todo[0]?.number ?? null,
    last: todo[todo.length - 1]?.number ?? null,
    /* Where to carry on from, and whether there is anything to carry on to. */
    after: lastIdx,
    done: !more,
  }
}

/*
 * Everything needed to draw a set of tickets, and nothing more.
 *
 * ONE WINDOW PER CALL, like generating, and for a harder reason: a drawn ticket
 * is a page of artwork with a QR on it, and a browser asked to lay out ten
 * thousand at once will not. The caller walks the raffle with `after` and
 * assembles the result a printer's worth at a time.
 *
 * ONLY TICKETS THAT HAVE A CODE. A ticket without one has never been generated
 * and cannot be proved genuine, so printing it would put a ticket into the
 * world that the verify page would reject. The ones that are missing come back
 * by name in `notGenerated` — named rather than counted, because the screen
 * offers to generate exactly those and a count would make that offer a guess.
 *
 * A WRITE, THOUGH IT MOSTLY READS. Two reasons, and the second is the one that
 * decided it. It stamps printed_at when a real print run happens. And a read or
 * a report can be handed to another role by a permissions row, which must not
 * be possible for the action that hands out ticket codes — see
 * tests/strictactions.
 */
export async function renderTickets(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const cfg = await currentConfig(ctx)

  const templateId = await activeTemplateId(ctx, cfg, { requireRow: true })
  const { data: tpl, error: tplErr } = await ctx.supabaseAdmin
    .from('ticket_templates')
    .select('id,name,content_type,width_px,height_px,url,design')
    .eq('id', templateId).limit(1)
  if (tplErr) throw new ApiError('QUERY_FAILED', tplErr.message)
  const template = (tpl ?? [])[0]
  if (!template) {
    throw new ApiError('NO_TEMPLATE',
      'The ticket artwork this raffle prints from is no longer there. ' +
      'Choose one on the Ticket Studio screen.')
  }

  const { rows: scope, more } = await resolveScope(p, ctx, MAX_PER_PRINT)
  if (!scope.length) {
    return {
      template: wireTemplate(template), verifyBase: String(cfg.VERIFY_URL ?? ''),
      tickets: [], notGenerated: [], after: null, done: true,
    }
  }

  const byIdx = new Map(scope.map((t) => [t.idx, t]))
  const books = await bookLabels(scope, ctx)

  const { data: codes, error: codeErr } = await ctx.supabaseAdmin
    .from('ticket_codes').select('ticket_idx,code,generated_at,printed_at')
    .in('ticket_idx', scope.map((t) => t.idx))
  if (codeErr) throw new ApiError('QUERY_FAILED', codeErr.message)

  /*
   * The status comes from the ticket row, and it is the ONLY thing about the
   * sale that travels: no buyer, no phone, no seller. A printed blank ticket
   * has nobody's name on it, and the person printing a book does not need one.
   */
  /*
   * WHAT TRAVELS ABOUT THE SALE, and it is a decision rather than a default.
   *
   * Without `withBuyer` the answer carries the status and nothing else: a blank
   * book going out to a seller must print blank lines, and the person running
   * off a hundred of them has no reason to be handed a hundred phone numbers.
   *
   * With it, and only for a ticket the raffle has a sale recorded against, the
   * four things the stub is printed to hold come too — because the stub exists
   * to be filled in, the raffle already knows them, and the alternative is
   * somebody copying them out of the app by hand onto paper they will then have
   * to read back.
   *
   * This action is organisers-only and ungrantable, which is what makes that
   * safe; a seller cannot reach it to ask for anybody's details.
   */
  const withBuyer = p.withBuyer === true
  const cols = withBuyer
    ? 'idx,number,status,buyer_name,buyer_phone,buyer_zone,sold_by_agent'
    : 'idx,number,status'
  const { data: rows, error: rowErr } = await ctx.supabaseAdmin
    .from('tickets').select(cols).in('idx', scope.map((t) => t.idx))
  if (rowErr) throw new ApiError('QUERY_FAILED', rowErr.message)
  const statusOf = new Map((rows ?? []).map((r: any) => [Number(r.idx), String(r.status ?? '')]))
  const saleOf = new Map((rows ?? []).map((r: any) => [Number(r.idx), r]))

  /* The seller's name, looked up once for the whole window rather than per row. */
  const sellerName = new Map<string, string>()
  if (withBuyer) {
    const ids = [...new Set((rows ?? [])
      .map((r: any) => String(r.sold_by_agent ?? '')).filter(Boolean))]
    if (ids.length) {
      const { data: ags } = await ctx.supabaseAdmin.from('agents').select('agent_id,name').in('agent_id', ids)
      for (const a of ags ?? []) sellerName.set(String(a.agent_id), String(a.name ?? ''))
    }
  }
  /* Sold and Donated are both "spoken for"; anything else has no buyer yet. */
  const SOLD = ['Sold', 'Donated']

  const tickets: Record<string, unknown>[] = []
  for (const c of codes ?? []) {
    const t = byIdx.get(Number(c.ticket_idx))
    if (!t) continue
    tickets.push({
      number: t.number,
      /*
       * WHICH BOOK IT CAME OUT OF, printed on the ticket itself.
       *
       * The ticket number alone identifies the ticket, but the book is what
       * somebody is holding: stubs come back as a book, a seller is given
       * books, and a counted-in book is reconciled as a book. A ticket that
       * does not say which one it belongs to has to be looked up to be filed.
       */
      book: books.get(t.bookIdx) ?? '',
      status: statusOf.get(t.idx) ?? '',
      code: String(c.code ?? ''),
      generatedAt: c.generated_at ?? null,
      printedAt: c.printed_at ?? null,
      ...(withBuyer && SOLD.includes(statusOf.get(t.idx) ?? '')
        ? {
            buyer: {
              name: String(saleOf.get(t.idx)?.buyer_name ?? ''),
              phone: String(saleOf.get(t.idx)?.buyer_phone ?? ''),
              address: String(saleOf.get(t.idx)?.buyer_zone ?? ''),
              seller: sellerName.get(String(saleOf.get(t.idx)?.sold_by_agent ?? '')) ?? '',
            },
          }
        : {}),
    })
  }
  const have = new Set((codes ?? []).map((c: any) => Number(c.ticket_idx)))
  const notGenerated = scope.filter((t) => !have.has(t.idx)).map((t) => t.number)
  tickets.sort((a, b) => String(a.number).localeCompare(String(b.number)))

  /*
   * Marked as printed only when somebody is actually printing. Opening a ticket
   * to look at it is not a print run, and a printed_at that meant "somebody
   * glanced at this" would answer no useful question.
   */
  if (p.print === true && tickets.length) {
    const now = new Date().toISOString()
    const { error } = await ctx.supabaseAdmin.from('ticket_codes')
      .update({ printed_at: now, printed_by: user.email })
      .in('ticket_idx', [...have])
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'TICKETS_PRINTED',
      details: { count: tickets.length, first: tickets[0]?.number, last: tickets[tickets.length - 1]?.number },
      email: user.email,
    })
  }

  return {
    template: wireTemplate(template),
    /*
     * Where a scanned code should point. The server decides, not the browser:
     * printed codes outlive the raffle and an organiser has to be able to aim
     * them at an address they will still control. Blank means "this site", and
     * the screen fills in its own origin.
     */
    verifyBase: String(cfg.VERIFY_URL ?? ''),
    tickets,
    notGenerated,
    after: scope[scope.length - 1].idx,
    done: !more,
  }
}

function wireTemplate(t: Record<string, unknown>) {
  return {
    id: String(t.id),
    name: String(t.name ?? ''),
    url: String(t.url ?? ''),
    width: Number(t.width_px ?? 0),
    height: Number(t.height_px ?? 0),
    design: t.design ?? {},
  }
}

/* ============ A RECEIPT FOR THE TICKETS ONE BUYER TOOK ============ */

/**
 * Mints — or finds — the code that stands for a set of tickets.
 *
 * WHAT IT IS FOR. A buyer who takes ten tickets gets ten pictures and ten QR
 * codes, and the thing they actually hold, "these ones are mine", is
 * represented nowhere. They cannot check them in one go and neither can
 * anybody standing beside them at the draw. One code covers the set: the
 * picture lists every number, and the QR verifies all of them at once.
 *
 * WHY NOT PUT THE LIST IN THE QR, measured rather than argued. The encoder is
 * byte mode, versions 1 to 10; at the level the ticket design ships, M, a
 * version 10 code holds 213 bytes. The address is ~39 and each
 * `KS-00123.ABCDEFGHJKMN` pair is 22, so the pairs outright fit SEVEN tickets.
 * A book is ten. Level L would fit ten and would cost error correction on a
 * thing whose job is to still scan after a month in a pocket.
 *
 * ONE PER BUYER, NOT ONE PER PURCHASE — and this reverses what this function
 * was built to do, so the old rule is worth stating before the new one.
 *
 * It used to deduplicate on the EXACT SET: an existing receipt covering these
 * tickets and no others was handed back, and anything else minted a new code.
 * That is right for a receipt, which is a record of one purchase on one day.
 * It is wrong for a digital ticket. A buyer who takes a second book gets a
 * second code under that rule, and their first link goes on showing a subset
 * of what they hold — two artefacts where the buyer believes there is one,
 * which is the failure the old rule was written to prevent, reached from the
 * other side.
 *
 * So the key is the BUYER. Their telephone number, never their name: two
 * buyers called "Ma Hla" are two people, and this app has refused to identify
 * anybody by name since ranks.ts. One holding, one code, for as long as they
 * hold anything.
 *
 * AND THE SET IS WIDENED TO EVERYTHING THEY HOLD. The caller names some of a
 * buyer's tickets; what gets written is every sold ticket that buyer has. That
 * is what makes "regenerated" true rather than aspirational — pressing send
 * after a new sale picks the new tickets up, and a client working from a stale
 * list cannot publish a holding that is missing half of itself.
 *
 * A BUYER WITH NO TELEPHONE NUMBER IS NOT A BUYER THIS CAN KEY ON. There is no
 * identity to hold the set against, so that case keeps the old behaviour — a
 * one-off receipt for exactly the tickets named, with no buyer on it. Pooling
 * every phone-less sale into one shared digital ticket is the same mistake
 * `holding_of` refuses the same thing for the same reason, and it would hand
   * strangers each other's ticket numbers.
 *
 * TICKETS FROM TWO DIFFERENT BUYERS ARE REFUSED rather than silently split or
 * silently merged. One set, one buyer, or say so.
 *
 * ONLY TICKETS THAT ARE SOLD, and this is the rule the plan states for sending
 * a digital ticket at all. A receipt for a ticket nobody has bought is a
 * document asserting a sale that did not happen, and it would verify.
 */
export async function makeReceipt(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const asked = Array.isArray(p.ticketNumbers) ? p.ticketNumbers.map((n) => String(n).trim()) : []
  const wanted = [...new Set(asked.filter(Boolean))]
  if (!wanted.length) throw new ApiError('MISSING_FIELD', 'Which tickets?')
  if (wanted.length > HOLDING_MAX_TICKETS) {
    throw new ApiError('RANGE_TOO_LARGE',
      `A digital ticket covers at most ${HOLDING_MAX_TICKETS} tickets.`)
  }

  const { data: rows, error } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number,status,buyer_phone').in('number', wanted)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const found = new Map((rows ?? []).map((t: Record<string, unknown>) => [String(t.number), t]))
  const missing = wanted.filter((n) => !found.has(n))
  if (missing.length) {
    throw new ApiError('TICKET_NOT_FOUND',
      `${missing[0]} is not a ticket in this raffle.`, { missing }, 404)
  }

  const SOLD = ['Sold', 'Donated']
  const unsold = wanted.filter((n) => !SOLD.includes(String(found.get(n)!.status)))
  if (unsold.length) {
    throw new ApiError('NOT_SOLD',
      `A digital ticket is what a buyer is given after they have paid, and ${unsold[0]} is not ` +
      `recorded as sold. ${unsold.length === 1 ? 'Write the sale down first.' : ''}`,
      { tickets: unsold })
  }

  /*
   * WHOSE IS THIS SET. Distinct numbers, not "the first one found" — the old
   * the band lookup that used to live here took the first non-blank and would
   * have been perfectly happy to band one buyer's holding by another's count.
   */
  const phones = [...new Set(wanted
    .map((n) => String(found.get(n)!.buyer_phone ?? '').trim())
    .filter((v) => v !== ''))]
  if (phones.length > 1) {
    throw new ApiError('MIXED_BUYERS',
      'Those tickets belong to more than one buyer, and a digital ticket belongs to one. '
      + 'Send each buyer their own.',
      { buyers: phones.length })
  }
  const phone = phones[0] ?? ''

  /*
   * NO NUMBER RECORDED, so there is no buyer to key on and no way to widen the
   * set to "everything they hold". A one-off code for exactly what was named
   * is the honest answer, and it is what this function did for everybody until
   * today. It is not reused, because there is nothing to recognise it by.
   */
  if (!phone) {
    const idxs = wanted.map((n) => Number(found.get(n)!.idx)).sort((a, b) => a - b)
    const code = newCode(await codeLength(ctx))
    const { error: headErr } = await ctx.supabaseAdmin
      .from('ticket_receipts').insert({ code, created_by: user.email })
    if (headErr) throw new ApiError('QUERY_FAILED', headErr.message)
    const { error: itemErr } = await ctx.supabaseAdmin
      .from('ticket_receipt_items').insert(idxs.map((ticket_idx) => ({ code, ticket_idx })))
    if (itemErr) throw new ApiError('QUERY_FAILED', itemErr.message)
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'MAKE_RECEIPT',
      details: { code, tickets: wanted.length, buyer: 'no number recorded' },
      email: user.email,
    })
    return { code, tickets: wanted, count: wanted.length, created: true, rank: '' }
  }

  /* Everything this buyer holds, which is what the digital ticket is. */
  const { data: mine, error: mineErr } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number')
    .eq('buyer_phone', phone).in('status', SOLD)
    .order('idx', { ascending: true })
    .limit(HOLDING_MAX_TICKETS)
  if (mineErr) throw new ApiError('QUERY_FAILED', mineErr.message)

  const held = (mine ?? []) as Array<Record<string, unknown>>

  const numbers = held.map((t) => String(t.number))

  /*
   * ONLY THE TOKEN IS WRITTEN. What this code covers is not stored anywhere:
   * `holding_of` resolves it to the buyer and answers with the tickets they
   * hold at the moment somebody scans. So there is no item list to keep in
   * step, no sale path that has to remember a second table, and no window in
   * which a link lists what somebody held last week.
   *
   * The band is not stored either. It used to be frozen here because the check
   * page could not count a buyer's tickets without becoming able to identify
   * them; that page counts the rows `holding_of` gives it now, so the band is
   * worked out from what they hold today.
   *
   * WHAT IS RETURNED IS STILL THE WHOLE HOLDING, because the screen that
   * called this puts the count on a button somebody is about to press in front
   * of the buyer. It is read here and stored nowhere.
   */
  const { data: out, error: upErr } = await ctx.supabaseAdmin.rpc('ensure_holding_tx', {
    p_phone: phone,
    p_code: newCode(await codeLength(ctx)),
    p_user: user.email,
  })
  if (upErr) throw new ApiError('QUERY_FAILED', upErr.message)
  const row = (Array.isArray(out) ? out[0] : out) as Record<string, unknown> | undefined
  const code = String(row?.holding_code ?? '')
  if (!code) throw new ApiError('QUERY_FAILED', 'The digital ticket could not be written.')

  /*
   * LOGGED ONLY WHEN ONE WAS MADE. This action is now called whenever the
   * buyer's card is LOOKED AT, so that the picture on screen is the picture
   * that would be sent; logging every one of those would bury the entries that
   * record something happening under a trail of somebody scrolling.
   */
  if (row?.was_created) {
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'MAKE_RECEIPT',
      details: { code, tickets: numbers.length },
      email: user.email,
    })
  }

  return {
    code,
    tickets: numbers,
    count: numbers.length,
    created: !!row?.was_created,
  }
}

/* The code length this raffle writes, which is configured and capped. */
async function codeLength(ctx: Ctx) {
  const { data: cfgRows } = await ctx.supabaseAdmin
    .from('config').select('key,value').eq('key', 'TICKET_CODE_LENGTH')
  return Math.max(8, Math.min(32,
    Number((cfgRows ?? [])[0]?.value ?? DEFAULT_LENGTH) || DEFAULT_LENGTH))
}

/*
 * `bandFor` WAS HERE AND THE BAND IS NOT STORED ANY MORE.
 *
 * It counted a buyer's tickets and froze the answer onto the row, because the
 * public check page could not count without becoming able to identify
 * somebody. `holding_of` resolves a code to its buyer inside the database, so
 * that page counts rows which name nobody and works the band out from what
 * they hold today — see the migration of 2026-09-21 and the note in
 * verify/index.ts. A stored band was a second answer to a question with a live
 * one, and it was the answer that went stale.
 */
