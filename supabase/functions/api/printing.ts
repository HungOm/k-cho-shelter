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
  const templateId = String(cfg.TICKET_ARTWORK_ID ?? '')
  if (!templateId) {
    throw new ApiError('NO_TEMPLATE',
      'There is no ticket artwork yet, so tickets cannot be printed. ' +
      'Upload it on the Ticket design screen first.')
  }

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

  const templateId = String(cfg.TICKET_ARTWORK_ID ?? '')
  if (!templateId) {
    throw new ApiError('NO_TEMPLATE',
      'There is no ticket artwork yet, so tickets cannot be printed. ' +
      'Upload it on the Ticket design screen first.')
  }
  const { data: tpl, error: tplErr } = await ctx.supabaseAdmin
    .from('ticket_templates')
    .select('id,name,content_type,width_px,height_px,url,design')
    .eq('id', templateId).limit(1)
  if (tplErr) throw new ApiError('QUERY_FAILED', tplErr.message)
  const template = (tpl ?? [])[0]
  if (!template) {
    throw new ApiError('NO_TEMPLATE',
      'The ticket artwork this raffle prints from is no longer there. ' +
      'Choose one on the Ticket design screen.')
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
