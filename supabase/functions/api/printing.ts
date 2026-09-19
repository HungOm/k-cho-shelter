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

/** Rows per insert. Postgres is happy with far more; the wire is the limit. */
const CHUNK = 500

async function currentConfig(ctx: Ctx): Promise<Record<string, string>> {
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.key] = r.value
  return out
}

/*
 * Which tickets the caller means.
 *
 * Exactly one of the four forms. Accepting a mixture is how a caller ends up
 * generating for a different set than it asked for, and on a job that writes
 * twenty thousand rows that is not a mistake anybody spots.
 *
 * Returns ticket rows — idx and number — in index order, which is the order
 * they will be printed in.
 */
async function resolveScope(p: Record<string, unknown>, ctx: Ctx): Promise<{ idx: number; number: string }[]> {
  const forms = ['book', 'fromBook', 'numbers', 'all'].filter((k) => p[k] !== undefined)
  if (forms.length === 0) {
    throw new ApiError('MISSING_FIELD',
      'Nothing to generate — say which book, which books, which tickets, or all of them.')
  }
  if (p.book !== undefined && p.fromBook !== undefined) {
    throw new ApiError('BAD_REQUEST', 'Give one book or a range of books, not both.')
  }

  const sel = () => ctx.supabaseAdmin.from('tickets').select('idx,number')

  if (p.numbers !== undefined) {
    const list = Array.isArray(p.numbers) ? p.numbers.map((n) => String(n).trim()).filter(Boolean) : []
    if (!list.length) throw new ApiError('MISSING_FIELD', 'No ticket numbers were given.')
    if (list.length > MAX_PER_CALL) {
      throw new ApiError('RANGE_TOO_LARGE',
        `That is ${list.length} tickets. ${MAX_PER_CALL} is the most in one go.`)
    }
    const { data, error } = await sel().in('number', list)
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    const found = new Set((data ?? []).map((r: any) => String(r.number)))
    const missing = list.filter((n) => !found.has(n))
    /*
     * Refuse the whole run rather than generating for the ones that exist. A
     * caller who asked for ten tickets and silently got eight has a gap in a
     * printed book and no way to know which one.
     */
    if (missing.length) {
      throw new ApiError('TICKET_NOT_FOUND',
        `${missing.length === 1 ? 'This is not a ticket in this raffle' : 'These are not tickets in this raffle'}: ` +
        missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, and ${missing.length - 5} more` : '') + '.')
    }
    return (data ?? []).map((r: any) => ({ idx: Number(r.idx), number: String(r.number) })).sort((a, b) => a.idx - b.idx)
  }

  // By book, or a run of books. Books are resolved to their index first, so a
  // range is a numeric range rather than a string comparison on labels.
  let bookIdx: number[] | null = null
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
    if (p.book !== undefined) {
      bookIdx = [byNumber.get(wanted[0])!]
    } else {
      const lo = byNumber.get(wanted[0])!
      const hi = byNumber.get(wanted[1])!
      if (hi < lo) throw new ApiError('BAD_REQUEST', `${wanted[1]} comes before ${wanted[0]}.`)
      bookIdx = []
      for (let i = lo; i <= hi; i++) bookIdx.push(i)
    }
  }

  let q = sel()
  if (bookIdx) q = q.in('book_idx', bookIdx)
  const { data, error } = await q.order('idx').limit(MAX_PER_CALL + 1)
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  const rows = (data ?? []).map((r: any) => ({ idx: Number(r.idx), number: String(r.number) }))
  if (rows.length > MAX_PER_CALL) {
    throw new ApiError('RANGE_TOO_LARGE',
      `That is more than ${MAX_PER_CALL} tickets. Generate them a few books at a time — ` +
      'the screen does this for you.')
  }
  return rows
}

/**
 * Give these tickets a code, if they do not have one.
 *
 * Answers with what it did rather than only that it worked: how many were
 * generated, how many already had a code, and the batch the new ones belong to.
 * "Nothing to do" is a normal and useful answer here — it is what a second run
 * over the same book says, and it is the difference between a reprint and a
 * re-mint.
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

  const scope = await resolveScope(p, ctx)
  if (!scope.length) {
    return { generated: 0, alreadyGenerated: 0, batchId: null, total: 0 }
  }

  // Which of them already have one. Asked in one query rather than per ticket.
  const { data: have, error: haveErr } = await ctx.supabaseAdmin
    .from('ticket_codes').select('ticket_idx').in('ticket_idx', scope.map((t) => t.idx))
  if (haveErr) throw new ApiError('QUERY_FAILED', haveErr.message)
  const already = new Set((have ?? []).map((r: any) => Number(r.ticket_idx)))
  const todo = scope.filter((t) => !already.has(t.idx))

  if (!todo.length) {
    return { generated: 0, alreadyGenerated: already.size, batchId: null, total: scope.length }
  }

  const batchId = crypto.randomUUID()
  const length = Math.max(8, Math.min(32, Number(cfg.TICKET_CODE_LENGTH ?? DEFAULT_LENGTH) || DEFAULT_LENGTH))

  /*
   * Every code distinct within the batch before it is sent.
   *
   * The unique index on `code` is the real guarantee; this is so that a
   * collision inside one insert — which would fail the whole chunk and leave a
   * confusing partial run — cannot happen in the first place. At eighty bits a
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
  }
}
