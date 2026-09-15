/**
 * Ticket writes — ported from Tickets.gs and the sell_book part of Books.gs.
 *
 * HOW CONCURRENCY CHANGES, AND WHY IT GETS BETTER
 *
 * Apps Script took one script-wide lock for every write, so two volunteers
 * recording sales in different books queued behind each other for up to twenty
 * seconds. The lock existed because a spreadsheet has no way to say "update
 * this row only if nobody has touched it since I read it".
 *
 * Postgres does: an UPDATE with `version = <what I read>` in the WHERE clause
 * either matches one row or none, atomically, with no lock held across the
 * round trip. Nought rows back means somebody got there first — the same
 * VERSION_CONFLICT the Sheet reported, decided by the database instead of by a
 * lock, and without making everyone else wait.
 *
 * Anything that must be all-or-nothing across several rows — bulk entry, a
 * whole-book sale — goes through a Postgres function instead, listed in
 * functions.sql. A half-applied batch of 180 stubs is the thing that must not
 * happen, and `for` loops over single updates cannot promise that.
 */
import { ApiError, type AppUser } from './gate.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

const SOLD = ['Sold', 'Donated']

// ============ SHARED CHECKS ============

async function config(ctx: Ctx): Promise<Record<string, string>> {
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const out: Record<string, string> = {}
  for (const r of data ?? []) out[r.key] = r.value
  return out
}

const num = (v: unknown, d: number) => {
  const n = parseInt(String(v ?? ''), 10)
  return isNaN(n) ? d : n
}

/**
 * The ticket, plus everything needed to decide whether this person may write to
 * it. One query rather than the four the Sheet needed, because a join is free
 * here and four spreadsheet reads were not.
 */
async function loadTicket(ctx: Ctx, number: string) {
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .select('idx,number,status,version,book_idx,buyer_name,buyer_phone,books(number,status,held_by_agent)')
    .eq('number', number)
    .maybeSingle()
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  if (!data) throw new ApiError('TICKET_NOT_FOUND', `Ticket ${number} does not exist.`, null, 404)
  return data
}

/**
 * Every rule that stands between a person and a ticket row, in the order
 * Auth.gs applied them. Ported as one function because splitting them is how a
 * path ends up skipping one — handleVoidTicket skipped this entire gate in the
 * Sheet version and nobody noticed until a test went looking.
 */

/**
 * Books whose tickets are frozen.
 *
 * Lost belongs here with Settled and Void. Marking a book lost voids its unsold
 * tickets, which covers most of it — but not a ticket that was already sold and
 * is later corrected, and not a ticket voided then corrected back. A lost book
 * is paper nobody can find; nothing written against it is worth trusting.
 */
const CLOSED_BOOKS = ['Settled', 'Void', 'Lost']

/** Who is holding a book, in words a volunteer recognises. */
async function agentLabel(ctx: Ctx, agentId: string | null): Promise<string> {
  if (!agentId) return 'a seller'
  const { data } = await ctx.supabaseAdmin
    .from('agents').select('name').eq('agent_id', agentId).maybeSingle()
  return String(data?.name ?? '').trim() || agentId
}

async function assertCanWrite(
  ctx: Ctx,
  user: AppUser,
  ticket: {
    idx: number
    number: string
    books?: { number?: string; status: string; held_by_agent: string | null } | null
  },
  opts: { force?: boolean; claiming?: boolean } = {},
) {
  const cfg = await config(ctx)
  const generated = num(cfg.TOTAL_TICKETS, 0)
  const activeRaw = num(cfg.ACTIVE_TICKETS, 0)
  const active = activeRaw <= 0 || activeRaw > generated ? generated : activeRaw

  if (ticket.idx > active) {
    throw new ApiError(
      'TICKET_NOT_RELEASED',
      `Ticket ${ticket.number} has not been released yet. This raffle is selling the ` +
        `first ${active} tickets; release more before selling beyond that.`,
      { active, requested: ticket.idx },
    )
  }

  const book = ticket.books
  if (!book) throw new ApiError('BOOK_NOT_FOUND', 'That ticket has no book.', null, 404)

  // Closed books are frozen unless an admin explicitly forces it.
  if (CLOSED_BOOKS.includes(book.status)) {
    if (!(user.isAdmin && opts.force)) {
      throw new ApiError(
        'BOOK_CLOSED',
        `That book is ${book.status.toLowerCase()} and cannot be changed.`,
      )
    }
  }

  // An agent may only write to books they are actually holding.
  if (user.role === 'agent') {
    if (!user.agentId || book.held_by_agent !== user.agentId) {
      throw new ApiError('NOT_YOUR_BOOK', 'That book is not issued to you.', null, 403)
    }
  }

  /*
   * You can only sell paper you can hand to the buyer.
   *
   * A book that is Out is in a seller's bag, possibly an hour away. Claiming
   * one of its tickets from the office gives the buyer a number and no ticket,
   * and leaves the seller free to sell that same number to somebody standing in
   * front of them. Two people hold it; one of them loses an argument at the
   * draw.
   *
   * So a book that is out is writable by the person holding it, and by an
   * organiser — who is not selling but WRITING DOWN what the seller reported,
   * which is ordinary and has to keep working. A helper cannot: get the book
   * marked returned first, and then it is paper on the desk like any other.
   *
   * That leaves an organiser able to do the damaging thing. The second half of
   * the rule closes it: a sale out of a book that is Out is CREDITED TO THE
   * HOLDER, always (see sellTicket). The money lands on that seller's balance
   * and settlement reconciles it against the stubs they hand back. A sale
   * invented at the desk does not stay quiet — it turns up as a discrepancy
   * with a name on it.
   *
   * Only for claiming a ticket. Correcting a spelling, releasing a hold or
   * voiding on a book that happens to be out is office work and stays open.
   *
   * A book that is Out with nobody recorded should not exist; it is refused
   * rather than guessed at in the permissive direction.
   */
  if (opts.claiming && book.status === 'Out') {
    const holdsIt = !!user.agentId && book.held_by_agent === user.agentId
    if (!holdsIt && !(user.isAdmin && book.held_by_agent)) {
      const who = await agentLabel(ctx, book.held_by_agent)
      throw new ApiError(
        'BOOK_WITH_SELLER',
        `Book ${book.number ?? ''} is out with ${who}, so its tickets are not here to sell. ` +
          'If the book is back, ask an organiser to mark it returned first.',
        { book: book.number ?? '', heldBy: book.held_by_agent ?? '' },
        403,
      )
    }
  }
}

function normalisePhone(v: unknown): string {
  return String(v ?? '').replace(/[^\d+]/g, '')
}

function requireBuyer(payload: Record<string, unknown>) {
  const name = String(payload.buyerName ?? '').trim()
  const phone = normalisePhone(payload.buyerPhone)
  if (!name) throw new ApiError('MISSING_FIELD', 'Buyer name is required.')
  if (phone.replace(/\D/g, '').length < 7) {
    throw new ApiError(
      'BAD_PHONE',
      'A phone number is needed — without one you cannot tell them if they win.',
    )
  }
  return { name, phone }
}

async function audit(ctx: Ctx, action: string, details: unknown, email: string) {
  await ctx.supabaseAdmin.from('audit_log').insert({ action, details, email })
}

/**
 * The conditional update that replaces the script-wide lock.
 *
 * `.eq('version', expected)` is the whole mechanism: the row changes only if
 * nobody has touched it since it was read. No rows back is not an error in the
 * database's eyes, so it has to be turned into one here — silently doing
 * nothing is how two people sell the same ticket and both believe they did.
 */
async function updateIfUnchanged(
  ctx: Ctx,
  idx: number,
  expectedVersion: number,
  patch: Record<string, unknown>,
  ticketNumber: string,
) {
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .update(patch)
    .eq('idx', idx)
    .eq('version', expectedVersion)
    .select('version,status,buyer_name')
    .maybeSingle()

  if (error) {
    // The contact constraint is the database refusing a sale the draw could not
    // resolve to a person. Reported as the same code the handlers used, so the
    // client says the same thing however the rule was enforced.
    if (String(error.message).includes('tickets_sold_needs_contact')) {
      throw new ApiError('BAD_PHONE', 'A sold ticket needs a name and a usable phone number.')
    }
    throw new ApiError('QUERY_FAILED', error.message)
  }
  if (!data) {
    throw new ApiError(
      'VERSION_CONFLICT',
      `Ticket ${ticketNumber} was changed by someone else while you were working on it. ` +
        'Refresh and try again.',
    )
  }
  return data
}

// ============ HANDLERS ============

export async function sellTicket(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  if (!number) throw new ApiError('MISSING_FIELD', 'Ticket number is required.')
  const { name, phone } = requireBuyer(p)

  const t = await loadTicket(ctx, number)
  await assertCanWrite(ctx, user, t, { force: !!p.force, claiming: true })

  if (SOLD.includes(t.status)) {
    throw new ApiError(
      'ALREADY_SOLD',
      `Ticket ${number} was already sold to ${t.buyer_name || 'someone'}.`,
      { current: t },
    )
  }
  if (t.status === 'Void') {
    throw new ApiError('TICKET_VOID', `Ticket ${number} has been voided.`)
  }

  const cfg = await config(ctx)
  const donated = !!p.donated

  /*
   * The other half of the out-with-a-seller rule.
   *
   * If the book is in somebody's bag then they handed the ticket over, whoever
   * typed it in afterwards. Crediting anyone else would be false, and it is
   * what makes the organiser's transcription safe: the money goes onto the
   * holder's balance, where settlement checks it against the stubs.
   */
  const heldBy = t.books?.status === 'Out' ? (t.books.held_by_agent ?? null) : null

  const row = await updateIfUnchanged(ctx, t.idx, num(p.expectedVersion, t.version), {
    status: donated ? 'Donated' : 'Sold',
    buyer_name: name,
    buyer_phone: phone,
    buyer_zone: String(p.buyerZone ?? ''),
    sold_by_agent: heldBy ?? p.agentId ?? user.agentId ?? null,
    amount: donated ? 0 : Number(p.amount ?? cfg.TICKET_PRICE ?? 10),
    payment_status: String(p.paymentStatus ?? 'Paid'),
    sold_at: new Date().toISOString(),
    source: 'app',
    recorded_by: user.email,
  }, number)

  await audit(ctx, 'SELL', { ticket: number, buyer: name }, user.email)
  return { ticketNumber: number, status: row.status, version: row.version }
}

export async function reserveTicket(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  const name = String(p.buyerName ?? '').trim()
  if (!number) throw new ApiError('MISSING_FIELD', 'Ticket number is required.')
  if (!name) throw new ApiError('MISSING_FIELD', 'Buyer name is required.')

  const t = await loadTicket(ctx, number)
  await assertCanWrite(ctx, user, t, { force: !!p.force, claiming: true })
  if (t.status !== 'Available') {
    throw new ApiError('NOT_AVAILABLE', `Ticket ${number} is ${t.status.toLowerCase()}.`)
  }

  const row = await updateIfUnchanged(ctx, t.idx, num(p.expectedVersion, t.version), {
    status: 'Reserved',
    buyer_name: name,
    buyer_phone: normalisePhone(p.buyerPhone),
    recorded_by: user.email,
  }, number)

  await audit(ctx, 'RESERVE', { ticket: number, buyer: name }, user.email)
  return { ticketNumber: number, status: row.status, version: row.version }
}

export async function releaseTicket(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  const t = await loadTicket(ctx, number)
  await assertCanWrite(ctx, user, t, { force: !!p.force })
  if (t.status !== 'Reserved') {
    throw new ApiError('NOT_RESERVED', `Ticket ${number} is not being held.`)
  }

  const row = await updateIfUnchanged(ctx, t.idx, num(p.expectedVersion, t.version), {
    status: 'Available',
    buyer_name: '', buyer_phone: '', buyer_zone: '',
    sold_by_agent: null, amount: null, payment_status: '', sold_at: null,
    recorded_by: user.email,
  }, number)

  await audit(ctx, 'RELEASE', { ticket: number }, user.email)
  return { ticketNumber: number, status: row.status, version: row.version }
}

export async function correctTicket(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  const reason = String(p.reason ?? '').trim()
  if (!reason) throw new ApiError('MISSING_FIELD', 'A reason is required for a correction.')

  const t = await loadTicket(ctx, number)
  await assertCanWrite(ctx, user, t, { force: !!p.force })

  /*
   * The hole that was found in the Sheet version: Status was a freely patchable
   * field here, so an ordinary admin could void a ticket through a correction
   * and it logged as CORRECT rather than VOID — the audit trail did not show a
   * ticket leaving the draw. Both values are refused outright.
   *
   * READ BOTH SPELLINGS, for the same reason the patch map below accepts both —
   * and this line is the more important of the two. Accepting `Status` as an
   * alias while guarding only `status` would have reopened exactly the hole
   * this guard was written to close, and silently: a non-organiser sending
   * Status:'Void' would have walked straight past it into the patch. A widened
   * input and an un-widened check is how a fix becomes a vulnerability.
   */
  const nextStatus = p.status !== undefined ? p.status
                   : p.Status !== undefined ? p.Status
                   : undefined
  if (nextStatus !== undefined) {
    const next = String(nextStatus)
    if (next === 'Void') {
      throw new ApiError('USE_VOID_ACTION',
        'Voiding a ticket is done with the void action, not a correction.')
    }
    if (next === 'Donated') {
      throw new ApiError('USE_SELL_ACTION',
        'A donated ticket is recorded when the sale is recorded, not by correction.')
    }
    if (!user.isAdmin) {
      throw new ApiError('INSUFFICIENT_ROLE', 'Only an organiser can change a ticket status.', null, 403)
    }
  }

  const patch: Record<string, unknown> = { recorded_by: user.email }
  const before: Record<string, unknown> = {}
  /*
   * BOTH SPELLINGS, and that is a fix rather than a kindness.
   *
   * Apps Script's correction reads the SHEET COLUMN NAMES — Buyer_Name,
   * Buyer_Phone — because it was writing to a spreadsheet row. This port read
   * camelCase. Both read camelCase for a SALE, so selling worked and only
   * correcting was broken, which is why it survived the switch to Supabase as
   * the default: "Fix this" had been dead for every user since, failing with
   * NOTHING_TO_DO — "No changed fields were supplied" — a sentence that is
   * true, useless, and blames the person typing rather than the wire.
   *
   * An ignored write is worse than a bad read. A bad read shows as an empty
   * screen and somebody reports it; an ignored write looks exactly like a write
   * refused for a good reason.
   *
   * The aliases stay after the client stops sending the sheet names. The
   * contract this port promised was "same action names, same payloads", and a
   * backend that accepts only one of two spellings its twin accepts has not
   * kept it.
   */
  const allowed = {
    buyerName: 'buyer_name', buyerPhone: 'buyer_phone', buyerZone: 'buyer_zone',
    paymentStatus: 'payment_status', notes: 'notes', agentId: 'sold_by_agent',
    status: 'status',
    Buyer_Name: 'buyer_name', Buyer_Phone: 'buyer_phone', Buyer_Zone: 'buyer_zone',
    Payment_Status: 'payment_status', Notes: 'notes', Sold_By_Agent: 'sold_by_agent',
    Status: 'status',
  } as const

  for (const [from, col] of Object.entries(allowed)) {
    if (p[from] !== undefined) {
      before[col] = (t as Record<string, unknown>)[col]
      patch[col] = from === 'buyerPhone' ? normalisePhone(p[from]) : p[from]
    }
  }
  if (Object.keys(patch).length === 1) {
    throw new ApiError('NOTHING_TO_DO', 'No changed fields were supplied.')
  }

  const row = await updateIfUnchanged(ctx, t.idx, num(p.expectedVersion, t.version), patch, number)
  await audit(ctx, 'CORRECT', { ticket: number, reason, before, after: patch }, user.email)
  return { ticketNumber: number, version: row.version }
}

export async function voidTicket(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  const reason = String(p.reason ?? '').trim()
  if (!reason) throw new ApiError('MISSING_FIELD', 'A reason is required to void a ticket.')

  const t = await loadTicket(ctx, number)

  // Deliberately NOT the full assertCanWrite: a super admin voids a ticket
  // regardless of who holds the book. But a ticket that is not in play yet is a
  // different matter — voiding it would take it out of the draw before anybody
  // had decided to release it. That check is repeated here on purpose.
  const cfg = await config(ctx)
  const generated = num(cfg.TOTAL_TICKETS, 0)
  const activeRaw = num(cfg.ACTIVE_TICKETS, 0)
  const active = activeRaw <= 0 || activeRaw > generated ? generated : activeRaw
  if (t.idx > active) {
    throw new ApiError('TICKET_NOT_RELEASED',
      `Ticket ${number} has not been released yet.`, { active, requested: t.idx })
  }

  const row = await updateIfUnchanged(ctx, t.idx, num(p.expectedVersion, t.version), {
    status: 'Void',
    notes: `Voided: ${reason}`,
    recorded_by: user.email,
  }, number)

  await audit(ctx, 'VOID', { ticket: number, reason }, user.email)
  return { ticketNumber: number, status: 'Void', version: row.version }
}

/**
 * All-or-nothing, so it goes through a Postgres function rather than a loop.
 *
 * The Sheet validated every row before writing any, which was the right
 * instinct but only approximated atomicity — nothing stopped a failure halfway
 * through the writes. Here the whole batch is one transaction: it commits or it
 * does not, and a volunteer with 180 stubs never sees half of them recorded.
 */
export async function bulkRecordSales(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const sales = Array.isArray(p.sales) ? p.sales : []
  if (!sales.length) throw new ApiError('BAD_REQUEST', 'No sales supplied.')
  if (sales.length > 500) {
    throw new ApiError('RANGE_TOO_LARGE', 'Record at most 500 sales at a time.')
  }

  const { data, error } = await ctx.supabaseAdmin.rpc('bulk_record_sales', {
    p_sales: sales,
    p_user: user.email,
    p_role: user.role,
    p_agent_id: user.agentId,
    p_force: !!p.force,
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  if (data?.failures?.length) {
    throw new ApiError(
      'BATCH_REJECTED',
      `${data.failures.length} of ${sales.length} entries have problems. Nothing was saved.`,
      { failures: data.failures },
    )
  }

  await audit(ctx, 'BULK_SELL', { count: data?.recorded ?? 0 }, user.email)
  return { recorded: data?.recorded ?? 0 }
}

/**
 * One buyer takes a whole book, or several. Same buyer on every ticket, which
 * is correct rather than a shortcut: they really do hold all ten, and each one
 * still resolves to a findable person when a number comes up. That is the
 * difference from settlement, which marks a book sold with the buyer fields
 * deliberately blank.
 */
export async function sellBook(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { name, phone } = requireBuyer(p)

  const { data, error } = await ctx.supabaseAdmin.rpc('sell_books', {
    p_from_book: p.fromBook ?? null,
    p_to_book: p.toBook ?? null,
    p_book_numbers: p.bookNumbers ?? null,
    p_buyer_name: name,
    p_buyer_phone: phone,
    p_buyer_zone: String(p.buyerZone ?? ''),
    p_donated: !!p.donated,
    p_user: user.email,
    p_role: user.role,
    p_agent_id: user.agentId,
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  if (data?.error) throw new ApiError(data.error.code, data.error.message, data.error.details)

  if (!data?.sold) {
    throw new ApiError('NOTHING_TO_DO',
      'Every ticket in those books was already sold or voided. Nothing was changed.')
  }

  await audit(ctx, 'SELL_BOOK',
    { books: data.books, buyer: name, sold: data.sold, skipped: data.skipped?.length ?? 0 },
    user.email)
  return data
}
