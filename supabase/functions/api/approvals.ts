/**
 * Two-person control — ported from Approvals.gs.
 *
 * An admin asks, the super admin approves, and the action runs. What needs it:
 * marking a run of books lost or void, putting books back on the shelf,
 * settling a book that is already settled, letting somebody sign in — and
 * UNDOING MONEY, which is reversing a recorded payment or writing off a debt.
 *
 * The money pair were added last and for a different reason from the rest.
 * Everything above changes what the raffle can still sell. Those two change
 * what a named volunteer is shown as owing, with nothing handed over and
 * nobody else in the room.
 *
 * APPROVING EXECUTES, in the same call. An approval that merely unlocked the
 * action for later leaves a gap between what was read and what runs — approve a
 * three-book restock and a two-hundred-book one fires. The exact payload is
 * stored when the request is made and executed when it is approved, so what was
 * approved is what happens.
 *
 * It executes as the REQUESTER, re-checked at that moment. If they were
 * disabled or demoted while the request sat in the queue it fails, rather than
 * running on permissions they no longer have. Both names go in the audit line:
 * the person who asked owns it, the person who approved signed for it.
 */
import { ApiError, isActionAllowed, resolveUser, type ActionSpec, type AppUser, type Role } from './gate.ts'
import { REQUESTABLE_BY_ADMIN } from './people.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

const TTL_HOURS = 24

/*
 * A SELLER'S REPORT OUTLIVES A DAY, because the person deciding it is not
 * sitting at a desk waiting.
 *
 * Twenty-four hours is right for a two-person control: an organiser is stopped
 * mid-act and somebody has to agree quickly or the act should not happen at
 * all. A report is the opposite — it is finished work, submitted on a Saturday
 * by somebody who has done what was asked of them, and the organiser may not
 * open the app until Monday. Lapsing it overnight would mean the seller who
 * reported on time is the one told to do it again.
 *
 * A fortnight, which is longer than any gap between checkpoints in this raffle.
 */
const TTL_FOR: Record<string, number> = { report_back: 24 * 14 }
const ttlFor = (action: string) => TTL_FOR[action] ?? TTL_HOURS

/**
 * How many books a payload names, resolved the way the handlers resolve them:
 * an explicit list, or everything between two book numbers by index.
 *
 * Lifted out of approvalNeeded because a request for books reads the same field
 * pair, and two copies of "which books does this mean" is how an approval
 * summary comes to describe something other than what runs.
 */
async function booksIn(payload: Record<string, unknown>, ctx: Ctx): Promise<number> {
  if (Array.isArray(payload.bookNumbers)) return payload.bookNumbers.length
  const from = String(payload.fromBook ?? '')
  const to = String(payload.toBook ?? '') || from
  if (!from) return 0
  const { data } = await ctx.supabaseAdmin.from('books').select('idx,number').in('number', [from, to])
  const idxs = (data ?? []).map((b: { idx: number }) => b.idx)
  if (idxs.length === 0) return 0
  return Math.abs(Math.max(...idxs) - Math.min(...idxs)) + 1
}

/**
 * The books a payload names, with what is actually recorded against them.
 *
 * Beside booksIn rather than folded into it because the two answer different
 * questions — how many, and what is in them — and booksIn is asked by the
 * summary sentence, which must keep counting the whole span whatever is in it.
 */
async function bookRowsIn(
  payload: Record<string, unknown>,
  ctx: Ctx,
): Promise<Record<string, unknown>[]> {
  const cols = 'idx,number,recorded_sold,counted_sold,counted_expected,counted_collected'
  if (Array.isArray(payload.bookNumbers)) {
    const { data } = await ctx.supabaseAdmin.from('book_ledger_all').select(cols)
      .in('number', payload.bookNumbers.map(String))
    return data ?? []
  }
  const from = String(payload.fromBook ?? '')
  const to = String(payload.toBook ?? '') || from
  if (!from) return []
  const { data: ends } = await ctx.supabaseAdmin.from('books').select('idx').in('number', [from, to])
  const idxs = (ends ?? []).map((b: { idx: number }) => Number(b.idx))
  if (!idxs.length) return []
  const { data } = await ctx.supabaseAdmin.from('book_ledger_all').select(cols)
    .gte('idx', Math.min(...idxs)).lte('idx', Math.max(...idxs))
  return data ?? []
}

/**
 * A COUNT-IN AT NOUGHT HAS NOTHING FOR A SECOND PERSON TO SIGN OFF.
 *
 * Restocking needs two people because it CLEARS A DECLARED FIGURE: somebody
 * counted a book in, somebody else's money is recorded against it, and undoing
 * that quietly is exactly the act that wants a witness. All of that is still
 * true and none of it is true of a book that was counted in with nothing sold.
 *
 * That book is the trap this exemption exists for. A seller hands back a book
 * untouched, it is counted in at nought — no sales, no money, no ledger row —
 * and every ticket in it freezes, because a settled book cannot be sold from.
 * Putting it back is the only way to sell those tickets again, and an organiser
 * who has just made a nought-value mistake had to find the owner and wait to
 * undo it. Two people to sign off the reversal of nothing.
 *
 * EVERY named book, and only from the figures themselves: nothing sold, nothing
 * declared, nothing expected, nothing handed in. One book in the range with a
 * real sale on it and the whole request goes to the owner as before. A book the
 * view does not carry cannot be judged and counts against the exemption too —
 * the count and the rows must agree, or the range holds something unexamined.
 */
async function clearsNothing(
  payload: Record<string, unknown>,
  named: number,
  ctx: Ctx,
): Promise<boolean> {
  const rows = await bookRowsIn(payload, ctx)
  if (!rows.length || rows.length !== named) return false
  const nought = (v: unknown) => !Number(v ?? 0)
  return rows.every((r) =>
    nought(r.recorded_sold) && nought(r.counted_sold) &&
    nought(r.counted_expected) && nought(r.counted_collected))
}

/**
 * Decides whether an action needs two people, and if so writes the sentence the
 * approver will read — here, at request time, so the words come from the same
 * code that made the decision. Deriving them again in the browser would let the
 * two drift, and the drift would only show on the day it mattered.
 *
 * Returns null when the action can just be done.
 */
export async function approvalNeeded(
  action: string,
  payload: Record<string, unknown>,
  ctx: Ctx,
): Promise<{ text: string; kind: string; [k: string]: unknown } | null> {
  const countBooks = () => booksIn(payload, ctx)

  if (action === 'set_book_status') {
    // A preview writes nothing, so it needs nobody's permission.
    if (payload.dryRun === undefined || payload.dryRun) return null
    const n = await countBooks()
    if (n <= 1) return null
    const status = String(payload.status ?? '')
    const voids = status === 'Lost' || status === 'Void'
    const { data: per } = await ctx.supabaseAdmin
      .from('config').select('value').eq('key', 'TICKETS_PER_BOOK').maybeSingle()
    return {
      kind: 'set_book_status', books: n, status, voidsTickets: voids,
      tickets: n * (parseInt(String(per?.value ?? '10'), 10) || 10),
      firstBook: String(payload.fromBook ?? ''), lastBook: String(payload.toBook ?? ''),
      text: `Mark ${n} books as ${status} — ${payload.fromBook} to ${payload.toBook}.` +
        (voids ? ' Unsold tickets in them are voided and leave the draw.' : ''),
    }
  }

  if (action === 'restock_books') {
    const n = await countBooks()
    if (!n) return null
    // Nothing was sold, declared, expected or handed in, so there is no figure
    // to clear and nothing to witness. See clearsNothing.
    if (await clearsNothing(payload, n, ctx)) return null
    return {
      kind: 'restock_books', books: n,
      firstBook: String(payload.fromBook ?? ''), lastBook: String(payload.toBook ?? ''),
      text: `Put ${n} book${n === 1 ? '' : 's'} back on the shelf. The settlement figures ` +
        `already recorded against ${n === 1 ? 'it' : 'them'} are cleared.`,
    }
  }

  if (action === 'upsert_user') {
    const role = String(payload.role ?? 'viewer').toLowerCase()
    const email = String(payload.email ?? '').trim().toLowerCase()

    // Organiser and owner are NOT requestable. Returning null here sends the
    // call on to the handler, which refuses it outright — an approvable request
    // to create a peer is an escalation with a waiting period, not one
    // prevented.
    if (!REQUESTABLE_BY_ADMIN.includes(role)) return null
    if (!email) return null

    // And not pointed at somebody who is ALREADY an organiser or owner. A
    // request reading "let them sign in as view-only" that in fact demotes a
    // peer is the approval screen lying about the deed, and it would fail at
    // the moment of approval anyway — which is the worst time to find out.
    const { data: existing } = await ctx.supabaseAdmin
      .from('app_users').select('role').eq('email', email).maybeSingle()
    if (existing && (existing.role === 'admin' || existing.role === 'superadmin')) return null

    const WORD: Record<string, string> = {
      recorder: 'Helper', agent: 'Seller who signs in', viewer: 'view-only',
    }
    return {
      kind: 'upsert_user',
      email,
      role,
      // The sentence the owner reads, written HERE rather than in the browser.
      // An approver shown a client-written summary is approving the client's
      // description rather than the change, and the one thing an approval
      // screen has to get right is that the words match the deed. The role is
      // named explicitly because it is the part that actually matters.
      text: `Let ${email} sign in as ${WORD[role] ?? role}.`,
    }
  }

  /*
   * UNDOING MONEY TAKES TWO PEOPLE, and it is the only kind of write here that
   * changes what a named volunteer is shown as owing without anybody handing
   * anything over.
   *
   * Both of these were already an organiser's alone, both already demanded a
   * reason, and both already wrote a new row rather than editing one — the
   * audit is not the gap. The gap is that one person could decide, at a desk,
   * that a debt on somebody else's name is gone, and the only trace is a line
   * nobody reads until there is an argument. A raffle run by volunteers for
   * their own community is exactly where that has to be two signatures.
   *
   * THE SENTENCE CARRIES THE NUMBERS, because an approver reading "write off a
   * debt" is being asked to sign for something they cannot see. The figures are
   * read here, at request time, from the same views the money screens use.
   */
  const currencyWord = async () => {
    const { data } = await ctx.supabaseAdmin
      .from('config').select('value').eq('key', 'CURRENCY').maybeSingle()
    return String(data?.value ?? 'RM')
  }
  const agentName = async (id: string) => {
    if (!id) return 'a seller'
    const { data } = await ctx.supabaseAdmin
      .from('agents').select('name').eq('agent_id', id).maybeSingle()
    return String(data?.name ?? '') || id
  }

  if (action === 'reverse_payment') {
    const id = Number(payload.paymentId)
    const { data: row } = await ctx.supabaseAdmin
      .from('payments').select('agent_id,amount,source,received_at').eq('id', id).maybeSingle()
    const r = (row ?? {}) as Record<string, unknown>
    const who = await agentName(String(r.agent_id ?? ''))
    const cur = await currencyWord()
    const amount = Number(r.amount ?? 0)
    const when = String(r.received_at ?? '').slice(0, 10)
    // A settlement row is a book's own figure as well as a payment, so undoing
    // one is a bigger act than undoing a hand-over and the sentence says which.
    const kindWord = String(r.source ?? '') === 'settlement'
      ? ' It was counted in with a book, so the book\'s figure moves too.'
      : ''
    return {
      kind: 'reverse_payment', paymentId: id, agentId: String(r.agent_id ?? ''), amount,
      text: `Undo ${cur} ${amount.toFixed(2)} recorded against ${who}` +
            (when ? ` on ${when}` : '') + `.${kindWord} Both entries stay on the record.`,
    }
  }

  if (action === 'write_off') {
    const agentId = String(payload.agentId ?? '').trim()
    const who = await agentName(agentId)
    const cur = await currencyWord()
    const { data: m } = await ctx.supabaseAdmin
      .from('agent_money').select('outstanding').eq('agent_id', agentId).maybeSingle()
    const owed = Number((m as { outstanding?: number } | null)?.outstanding ?? 0)
    const asked = payload.amount === undefined || payload.amount === null || payload.amount === ''
      ? owed : Number(payload.amount)
    const whole = Math.abs(asked - owed) < 0.005
    return {
      kind: 'write_off', agentId, amount: asked, owed,
      text: `Write off ${cur} ${asked.toFixed(2)} owed by ${who}` +
            (whole ? ', which is everything they owe' : ` of the ${cur} ${owed.toFixed(2)} they owe`) +
            '. Nobody asks them for it again, and it will not read as having been paid.',
    }
  }

  if (action === 'settle_book' && payload.force) {
    const bn = String(payload.bookNumber ?? '')
    return {
      kind: 'resettle_book', books: 1, firstBook: bn, lastBook: bn,
      text: `Settle ${bn || 'a book'} again, over a settlement that is already recorded.`,
    }
  }

  return null
}

/**
 * ASKING FOR A BOOK, WHICH IS NOT THE SAME SHAPE AS TWO-PERSON CONTROL.
 *
 * approvalNeeded above answers "does this need a second pair of eyes" — a
 * permitted person about to do something that cannot be undone, who is stopped
 * until somebody else agrees. The queue, the stored payload, the 24-hour lapse
 * and the audit pair all exist for that, and all of them suit this equally.
 *
 * What is different is WHOSE ACT IT IS. A seller asking for Book-330 is not
 * permitted to issue it and never will be; issuing books is the organiser's.
 * The request is a petition — the seller says what they want, and if an
 * organiser agrees, THE ORGANISER hands it over. So a petition runs as the
 * approver, not as the requester, and decideApproval says so where it matters.
 *
 * KEPT APART FROM approvalNeeded ON PURPOSE. That function is also what the
 * router reads to BLOCK a direct call (index.ts), so adding issue_books to it
 * would stop organisers issuing books at all — the one thing this feature must
 * not break. Two questions, two functions, one queue.
 *
 * BOOK-LEVEL ONLY. A ticket has no custody of its own: exclusivity is
 * books.held_by_agent and a ticket's owner is derived from its book. Find
 * answers "3291 is in Book-330, at the office" and offers the book.
 */
export const PETITIONS = new Set(['issue_books', 'report_back'])

/** As many books as one person can sensibly be handed in one go. */
const MOST_BOOKS_ASKED = 20

/**
 * A SELLER'S REPORT, TURNED INTO THE SENTENCE AN ORGANISER DECIDES ON.
 *
 * The same shape as a book request and for the same reason: bringing books
 * back, counting them in and taking money are the organiser's acts, so this
 * runs as the approver. What the seller is doing is telling the truth about
 * what they are holding and handing over; the acceptance is what writes.
 *
 * THE SENTENCE CARRIES THE NUMBERS, not a word like "a report". Somebody
 * deciding this is agreeing to books coming back, tickets being marked sold and
 * money going on the ledger — an approval screen that says only who sent it is
 * a rubber stamp with extra steps.
 */
function reportPetition(
  payload: Record<string, unknown>,
  user: AppUser,
): { text: string; kind: string; runAs: string; [k: string]: unknown } {
  const lines = (Array.isArray(payload.books) ? payload.books : []) as Array<Record<string, unknown>>
  const returning = lines.filter((l) => String(l.action) === 'return').map((l) => String(l.book))
  const counting = lines.filter((l) => String(l.action) === 'count').map((l) => String(l.book))
  const handed = Number(payload.amountHanded ?? 0) || 0

  if (!returning.length && !counting.length && handed <= 0) {
    throw new ApiError('NOTHING_TO_DO',
      'There is nothing in this report — no books coming back and no money. ' +
      'Say what you are bringing before you send it.')
  }

  const said = []
  if (counting.length) {
    said.push(`${counting.length} ${counting.length === 1 ? 'book' : 'books'} to count in`)
  }
  if (returning.length) {
    said.push(`${returning.length} ${returning.length === 1 ? 'book' : 'books'} coming back unsold`)
  }
  if (handed > 0) said.push(`${handed.toFixed(2)} handed over`)

  const all = [...counting, ...returning].sort()

  return {
    kind: 'report_back',
    runAs: 'approver',
    agentId: user.agentId,
    books: all.length,
    counting, returning, handed,
    stubsReturned: Number(payload.stubsReturned ?? 0) || 0,
    unsoldReturned: Number(payload.unsoldReturned ?? 0) || 0,
    ticketsSold: Number(payload.ticketsSold ?? 0) || 0,
    // The Approvals screen keys its "look before you decide" link on these.
    firstBook: all[0] ?? '',
    lastBook: all[all.length - 1] ?? '',
    text: `${user.name || user.email} is reporting back: ${said.join(', ')}.`,
  }
}

export async function requestable(
  action: string,
  payload: Record<string, unknown>,
  user: AppUser,
  ctx: Ctx,
): Promise<{ text: string; kind: string; runAs: string; [k: string]: unknown } | null> {
  if (action !== 'issue_books' && action !== 'report_back') return null

  /*
   * TO THEMSELVES, ALWAYS. A seller asking for books they will carry is the
   * whole of this feature; a seller asking that books be issued to somebody
   * else is a different act with different consequences for that person's
   * balance, and nothing here should let one be typed as the other. The
   * requester's own id is written into the payload at request time, so what is
   * stored cannot disagree with who asked.
   */
  if (!user.agentId) {
    throw new ApiError(
      'NOT_A_SELLER',
      'Books are given out to sellers, and your account is not linked to one. ' +
      'An organiser can link it on the People screen.',
    )
  }

  if (action === 'report_back') return reportPetition(payload, user)

  const list = Array.isArray(payload.bookNumbers) ? payload.bookNumbers.map(String) : []
  const first = String(payload.fromBook ?? list[0] ?? '')
  const last = String(payload.toBook ?? list[list.length - 1] ?? '') || first
  if (!first) throw new ApiError('MISSING_FIELD', 'Which book are you asking for?')

  const n = await booksIn(payload, ctx)
  if (!n) throw new ApiError('BOOK_NOT_FOUND', `Book ${first} does not exist.`, null, 404)
  if (n > MOST_BOOKS_ASKED) {
    throw new ApiError('RANGE_TOO_LARGE',
      `Ask for at most ${MOST_BOOKS_ASKED} books at a time.`)
  }

  const one = n === 1
  return {
    kind: 'book_request',
    // Read by decideApproval. Stored with the row so an old request decided
    // after a deploy still runs the way it was made.
    runAs: 'approver',
    books: n,
    agentId: user.agentId,
    // firstBook/lastBook are what the Approvals screen keys its "look before you
    // decide" link on, so a book request gets that link without a second shape.
    firstBook: first,
    lastBook: last,
    text: one
      ? `${user.name || user.email} is asking for ${first}.`
      : `${user.name || user.email} is asking for ${n} books — ${first} to ${last}.`,
  }
}

const newId = () =>
  'R' + Date.now().toString(36).toUpperCase() + '-' +
  Math.floor(Math.random() * 1679616).toString(36).toUpperCase()

export async function requestApproval(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const action = String(p.action ?? '')
  const inner = (p.payload ?? {}) as Record<string, unknown>

  // The super admin would only be approving themselves. Theatre, and it would
  // make the queue look like a control when it is not one.
  if (user.isSuperAdmin) {
    throw new ApiError('BAD_REQUEST',
      'You can do this yourself — an approval request would only come back to you.')
  }

  /*
   * TWO REASONS A REQUEST CAN EXIST, and they are asked in order.
   *
   * approvalNeeded first: something the caller may do and is stopped from doing
   * alone. Then requestable: something the caller may NOT do and is asking
   * somebody who can. An organiser is refused the second, because they can
   * simply hand the book over — a queue entry there would be a message to
   * themselves dressed as a control.
   */
  let need = await approvalNeeded(action, inner, ctx)
  let payload = inner
  if (!need && !user.isAdmin) {
    need = await requestable(action, inner, user, ctx)
    if (need) {
      // PINNED HERE, not taken from the request. The books go to whoever asked,
      // and what is stored cannot disagree with who that was.
      payload = { ...inner, agentId: user.agentId }
    }
  }
  if (!need) {
    throw new ApiError('NOTHING_TO_DO', 'That action does not need anybody else to approve it.')
  }

  const requestId = newId()
  const expiresAt = new Date(Date.now() + ttlFor(action) * 3600_000).toISOString()
  const { error } = await ctx.supabaseAdmin.from('pending_approvals').insert({
    request_id: requestId, action, payload, summary: need.text, detail: need,
    requested_by: user.email,
    expires_at: expiresAt,
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_REQUESTED', details: { requestId, action, summary: need.text }, email: user.email,
  })
  return { requestId, action, summary: need.text, detail: need, expiresAt }
}

export async function listApprovals(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  let q = ctx.supabaseAdmin.from('pending_approvals').select('*').order('requested_at', { ascending: false })
  /*
   * WHO SEES WHAT.
   *
   *   super admin  everything — they are the one who decides the controls
   *   organiser    their own requests, AND every petition, because granting a
   *                book is theirs to do and a queue they cannot see is a queue
   *                nobody answers
   *   anybody else their own, and nothing else
   *
   * A petition names its asker and the books they want, which an organiser can
   * already read on the Books screen. It carries nothing about anybody else.
   */
  if (user.isAdmin && !user.isSuperAdmin) {
    q = q.or(`requested_by.eq.${user.email},action.in.(${[...PETITIONS].join(',')})`)
  } else if (!user.isSuperAdmin) {
    q = q.eq('requested_by', user.email)
  }
  if (p.status) q = q.eq('status', String(p.status))

  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Expiry is applied on read as well as on decide, so a request that lapsed
  // while nobody was looking shows as expired rather than as still waiting.
  const now = Date.now()
  const stale = (data ?? []).filter((r: { status: string; expires_at: string }) =>
    r.status === 'Pending' && Date.parse(r.expires_at) <= now)
  if (stale.length) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Expired', note: `Nobody decided within ${TTL_HOURS} hours.` })
      .in('request_id', stale.map((r: { request_id: string }) => r.request_id))
  }

  return {
    requests: (data ?? []).map((r: Record<string, unknown>) => ({
      requestId: r.request_id, action: r.action, summary: r.summary, detail: r.detail,
      requestedBy: r.requested_by, requestedAt: r.requested_at, expiresAt: r.expires_at,
      status: stale.some((s: { request_id: string }) => s.request_id === r.request_id)
        ? 'Expired' : r.status,
      decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note,
    })),
    youDecide: !!user.isSuperAdmin,
  }
}

export async function cancelApproval(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const requestId = String(p.requestId ?? '')
  const { data: r } = await ctx.supabaseAdmin
    .from('pending_approvals').select('*').eq('request_id', requestId).maybeSingle()
  if (!r) throw new ApiError('NOT_FOUND', 'No request with that id.', null, 404)
  if (r.status !== 'Pending') throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.')
  if (!user.isSuperAdmin && r.requested_by !== user.email) {
    throw new ApiError('NOT_AUTHORIZED', 'That is not your request.', null, 403)
  }

  await ctx.supabaseAdmin.from('pending_approvals')
    .update({ status: 'Cancelled', decided_by: user.email, decided_at: new Date().toISOString(),
              note: String(p.note ?? '') })
    .eq('request_id', requestId)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_CANCELLED', details: { requestId }, email: user.email,
  })
  return { requestId, status: 'Cancelled' }
}

/**
 * Approve and run, or refuse. Super-admin only through the registry.
 *
 * `run` is the router's own dispatcher, passed in so this file does not import
 * the registry and create a cycle — and so the approved action goes through
 * exactly the same path a direct call would, rather than a second copy of it.
 */
export async function decideApproval(
  p: Record<string, unknown>,
  user: AppUser,
  ctx: Ctx,
  run: (action: string, payload: Record<string, unknown>, asUser: AppUser) => Promise<unknown>,
  specOf: (action: string) => ActionSpec | undefined,
  overrides: Record<string, Partial<Record<Role, boolean>>>,
  /*
   * WHICH QUEUE THIS CALL IS ALLOWED TO TOUCH.
   *
   * decide_approval is the super admin's and stays that way: it decides
   * two-person controls, which exist precisely to put somebody above an
   * organiser. decide_book_request is the organiser's and can only reach
   * petitions — a seller asking for a book, which is the organiser's to grant
   * and nobody else's business.
   *
   * TWO ACTIONS RATHER THAN ONE WITH A SOFTER BAR. The registry is where this
   * app declares who may do what, in one readable list; moving that bar into a
   * handler would make the list say something untrue about the most dangerous
   * action in it.
   */
  opts: { petitionsOnly?: boolean } = {},
) {
  const requestId = String(p.requestId ?? '')
  if (p.approve === undefined) {
    throw new ApiError('MISSING_FIELD', 'approve is required (true or false).')
  }

  const { data: r } = await ctx.supabaseAdmin
    .from('pending_approvals').select('*').eq('request_id', requestId).maybeSingle()
  if (!r) throw new ApiError('NOT_FOUND', 'No request with that id.', null, 404)
  if (r.status !== 'Pending') throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.')

  const petition = PETITIONS.has(r.action) &&
    (r.detail as { runAs?: string } | null)?.runAs === 'approver'

  // An organiser reaching a two-person control through the wrong door. The
  // registry refuses them decide_approval; this refuses them the other one.
  if (opts.petitionsOnly && !petition) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'That request is not somebody asking for a book. Only the system admin can decide it.',
      null, 403)
  }

  // Checked here as well as on read: a row that went stale while nobody was
  // looking must not execute because somebody finally opened the screen.
  if (Date.parse(r.expires_at) <= Date.now()) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Expired', note: `Nobody decided within ${TTL_HOURS} hours.` })
      .eq('request_id', requestId)
    const hours = ttlFor(r.action)
    throw new ApiError('APPROVAL_EXPIRED',
      hours >= 48
        ? `That was submitted more than ${Math.round(hours / 24)} days ago. Ask for it again.`
        : `That request is more than ${hours} hours old. Ask for it again.`)
  }

  if (!p.approve) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Rejected', decided_by: user.email, decided_at: new Date().toISOString(),
                note: String(p.note ?? '') })
      .eq('request_id', requestId)
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'APPROVAL_REJECTED',
      details: { requestId, action: r.action, requestedBy: r.requested_by, note: p.note },
      email: user.email,
    })
    return { requestId, status: 'Rejected', executed: false }
  }

  // --- approve: re-establish who asked, as they are NOW ---
  const { data: row } = await ctx.supabaseAdmin
    .from('app_users').select('name,role,active,agent_id').eq('email', r.requested_by).maybeSingle()

  let requester: AppUser
  try {
    requester = resolveUser(r.requested_by, row, Deno.env)
  } catch {
    throw new ApiError('REQUESTER_UNAVAILABLE',
      `${r.requested_by} is no longer an active user, so their request cannot run.`)
  }

  const spec = specOf(r.action)
  if (!spec) throw new ApiError('UNKNOWN_ACTION', 'That request names an action that no longer exists.')

  /*
   * WHOSE ACT IS BEING PERFORMED, which depends on which kind of request it is.
   *
   * A two-person control runs as the REQUESTER: they are permitted the action
   * and were stopped until somebody agreed, so it is still their act and their
   * permissions are re-checked at this moment. If they were demoted or disabled
   * while it sat in the queue it fails rather than running on authority they no
   * longer have.
   *
   * A PETITION runs as the APPROVER. A seller asking for a book is not
   * permitted to issue one and never will be — issuing books is the
   * organiser's — so re-checking the requester would refuse every book request
   * at the moment it was granted, which is the worst place to find out. The
   * organiser granting it IS the person handing the book over, and the act is
   * theirs.
   *
   * The requester is still resolved above either way: a book issued to somebody
   * who has been disabled since they asked is not a book anybody is carrying,
   * and the payload names them.
   */
  if (!petition && !isActionAllowed(r.action, spec, requester, overrides)) {
    throw new ApiError('REQUESTER_NOT_ALLOWED',
      `${r.requested_by} can no longer do that, so their request cannot run.`)
  }

  const result = await run(r.action, r.payload as Record<string, unknown>,
                           petition ? user : requester)

  await ctx.supabaseAdmin.from('pending_approvals')
    .update({ status: 'Approved', decided_by: user.email, decided_at: new Date().toISOString(),
              note: String(p.note ?? '') })
    .eq('request_id', requestId)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_APPROVED',
    details: { requestId, action: r.action, summary: r.summary,
               requestedBy: r.requested_by, approvedBy: user.email },
    email: user.email,
  })

  return {
    requestId, status: 'Approved', executed: true,
    action: r.action, summary: r.summary, requestedBy: r.requested_by, result,
  }
}
