/*
 * Every action the client calls, actually called.
 *
 * WHY THIS EXISTS, stated plainly: the app has been buggy today, and this is
 * why. The client calls 34 actions. The payload tests covered 8. Everything
 * else was verified by reading the code, comparing registries, and checking
 * permissions — none of which runs anything, and all of which stayed green
 * through four separate bugs where a handler returned successfully and handed
 * back something the browser could not use.
 *
 * The bugs were not subtle once found. read_snapshot had no `fields`.
 * list_permissions had no `actions`. report_draw_ready had no `totals`. Every
 * ledger read returned an empty raffle because the view filters on a role the
 * service key does not have. Each was a thing a single real call would have
 * exposed immediately, and no test made a single real call.
 *
 * So this makes one of every call. It is deliberately shallow — it asks whether
 * an action RUNS and answers in a usable shape, not whether its logic is right;
 * edgehandlers.test.mjs and the SQL suites do that. Shallow and complete beats
 * deep and partial for this particular failure, because the failure was never
 * subtle logic. It was a handler nobody had ever invoked.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

function world() {
  const tickets = Array.from({ length: 30 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: Math.ceil((i + 1) / 10), status: 'Available',
    buyer_name: '', buyer_phone: '', buyer_zone: '', amount: null,
    sold_by_agent: null, payment_status: '', sold_at: null, notes: '',
    source: '', version: 1, recorded_by: '', modified_at: new Date().toISOString(),
  }))
  Object.assign(tickets[0], {
    status: 'Sold', buyer_name: 'Ma Nu', buyer_phone: '0125550100',
    amount: 10, sold_by_agent: 'A001',
  })
  // A second sold ticket that has NOT won, so record_winner has somebody to
  // award to. KS-00001 already holds a hamper in the fixture below, and a
  // record_winner that merely refuses deliberately would leave the awarding
  // path — the seat arithmetic, the frozen label — never once executed.
  Object.assign(tickets[5], {
    status: 'Sold', buyer_name: 'U Tun', buyer_phone: '0125550105',
    amount: 10, sold_by_agent: 'A001',
  })
  const books = Array.from({ length: 3 }, (_, i) => ({
    idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'),
    first_ticket: 'KS-' + String(i * 10 + 1).padStart(5, '0'),
    last_ticket: 'KS-' + String((i + 1) * 10).padStart(5, '0'),
    status: i === 0 ? 'Out' : 'Unassigned',
    held_by_agent: i === 0 ? 'A001' : null,
    declared_sold: null, amount_due: null, amount_paid: null,
    due_at: null, settled_at: null, settled_by: '', notes: '', version: 1,
  }))
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '30', ACTIVE_TICKETS: '30', TICKET_CEILING: '100' }),
    tickets, books,
    /*
     * A schedule with one prize already given, so the reads have something to
     * count and set_winner_status has a winner to move. 'second-hamper' is here
     * unawarded because remove_prize must have something it is allowed to
     * remove — a prize nobody holds.
     */
    prize_types: [
      { type_id: 'goods', label: 'Donated goods', valuing: 'fixed', sort: 20, active: true, built_in: true },
      { type_id: 'pot_share', label: 'Share of takings', valuing: 'percent', sort: 40, active: true, built_in: true },
    ],
    prizes: [
      { prize_id: 'grand-hilux', tier: 'Grand Prize', name: 'Toyota Hilux', description: '',
        type_id: 'goods', value_amount: 120000, quantity: 1, rank: 1, draw_order: null,
        donor: '', active: true, created_by: 'boss@x.com' },
      { prize_id: 'second-hamper', tier: 'Second Prize', name: 'Hamper', description: '',
        type_id: 'goods', value_amount: 250, quantity: 10, rank: 2, draw_order: null,
        donor: '', active: true, created_by: 'boss@x.com' },
    ],
    winners: [
      { ticket_idx: 1, prize: 'Second Prize — Hamper', prize_id: 'second-hamper', seq: 1,
        prize_value: 250, buyer_name: 'Ma Nu', buyer_phone: '0125550100',
        notified: false, claimed: false, recorded_by: 'boss@x.com' },
    ],
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true }],
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agent_id: null },
    ],
    book_ledger_all: books.map((b) => ({
      idx: b.idx, number: b.number, first_ticket: b.first_ticket, last_ticket: b.last_ticket,
      status: b.status, held_by_agent: b.held_by_agent,
      agent_name: 'Daw Hla', due_at: null, counted_expected: 0, counted_collected: 0,
      counted_sold: 0, days_overdue: 0, past_final: false, available: 10, reserved: 0,
      missing_contact: 0, recorded_sold: 0, recorded_amount: 0,
    })),
  })
}

async function call(action, payload = {}, email = 'boss@x.com') {
  const w = world()
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email } })
  return { status: res.status, body: await res.json() }
}

/*
 * A plausible payload for each, so the call gets past field validation and
 * actually reaches the query. Writes are previewed where the action previews.
 */
const CALLS = {
  whoami: {}, read_version: {}, read_snapshot: { offset: 0, limit: 100 },
  read_delta: { since: '2020-01-01T00:00:00.000Z' }, search: { q: 'KS-00001' },
  list_books: {}, list_agents: {}, list_users: {}, list_winners: {},
  list_approvals: {}, list_permissions: {}, read_audit: {},
  deadline_status: {}, book_history: { bookNumber: 'Book-001' },
  handover_receipt: { agentId: 'A001' },
  acknowledge_books: { agentId: 'A001' },
  acknowledged_books: { agentId: 'A001' },
  report_draft: { agentId: 'A001' },
  report_outstanding: {}, report_overdue: {}, report_missing_contact: {},
  report_draw_ready: {}, agent_statement: { agentId: 'A001' }, export_entries: {},

  sell_ticket: { ticketNumber: 'KS-00002', buyerName: 'Ko Zaw', buyerPhone: '0125550101', agentId: 'A001' },
  reserve_ticket: { ticketNumber: 'KS-00003' },
  release_ticket: { ticketNumber: 'KS-00003' },
  correct_ticket: { ticketNumber: 'KS-00001', buyerName: 'Ma Nu Corrected' },
  void_ticket: { ticketNumber: 'KS-00004', reason: 'damaged' },
  bulk_record_sales: { sales: [{ ticketNumber: 'KS-00005', buyerName: 'X', buyerPhone: '0125550102' }] },
  sell_book: { fromBook: 'Book-002', buyerName: 'Ma Nu', buyerPhone: '0125550100' },
  issue_books: { fromBook: 'Book-002', agentId: 'A001' },
  transfer_books: { fromBook: 'Book-001', toAgentId: 'A001' },
  return_books: { fromBook: 'Book-001' },
  settle_book: { bookNumber: 'Book-001', amountPaid: 0, unsoldTickets: [] },
  set_book_status: { fromBook: 'Book-002', status: 'Lost', reason: 'test' },
  restock_books: { fromBook: 'Book-002' },
  upsert_agent: { name: 'New Seller', phone: '0125559999' },
  upsert_user: { email: 'new@x.com', role: 'recorder' },
  set_user_status: { email: 'rec@x.com', active: false },
  set_permission: { action: 'report_overdue', role: 'agent', allowed: true },
  request_approval: { action: 'restock_books', payload: { fromBook: 'Book-002' } },
  cancel_approval: { requestId: 'nope' },
  decide_approval: { requestId: 'nope', approve: false },
  record_winner: { ticketNumber: 'KS-00006', prizeId: 'grand-hilux' },
  list_prizes: {},
  upsert_prize: { tier: 'Second Prize', name: 'Hamper', typeId: 'goods', value: 250, quantity: 3 },
  remove_prize: { prizeId: 'second-hamper' },
  upsert_prize_type: { label: 'Experience day', valuing: 'none' },
  set_winner_status: { ticketNumber: 'KS-00001', notified: true },
  expand_tickets: { totalTickets: 50 },
  set_active_tickets: { activeTickets: 20 },
  set_ticket_ceiling: { ticketCeiling: 200 },
  roll_check_in: {}, set_final_deadline: { date: '2027-01-01' },
  record_check_in: { agentId: 'A001', booksBack: 1, ticketsSold: 4, amountPaid: 40,
                     stubsReturned: 4, unsoldReturned: 6 },
  check_in_sheet: { agentId: 'A001' },
  round_snapshot: {},
  // A round far enough ahead to exist in any plan this fixture has; the point
  // of exercising it here is that the action answers at all, in words, rather
  // than falling over on a payload shape.
  set_check_in_date: { round: 2, date: '2027-06-01' },
  // Far enough out to need no confirmation, and inside the year the setter caps
  // a mistyped date at.
  set_sales_close: { date: '2027-01-01' },
  record_payment: { agentId: 'A001', amount: 40, note: 'at the hall' },
  // A real 1x1 PNG, because the handler sniffs the bytes rather than trusting
  // contentType — a made-up string would be refused for the right reason and
  // exercise the wrong path.
  upload_logo: {
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    contentType: 'image/png'
  },
  set_brand_color: { color: '#0d7a6f' },
  reverse_payment: { paymentId: 999, reason: 'recorded twice' },
  list_payments: { agentId: 'A001' },
}

/*
 * Codes that mean the handler RAN and decided something. A refusal is a pass
 * here — the question is whether the action works at all.
 *
 * The codes NOT on this list are the tell. UNKNOWN_ACTION means it was never
 * ported. QUERY_FAILED means it asked the database for something that is not
 * there. SERVER_ERROR means it threw. Each of those is the shape of every bug
 * that reached the user today.
 */
const DELIBERATE = new Set([
  'NOTHING_TO_DO', 'NO_CHANGE', 'CONFIRM_REQUIRED', 'APPROVAL_REQUIRED',
  'NOT_FOUND', 'BOOK_NOT_FOUND', 'TICKET_NOT_FOUND', 'AGENT_NOT_FOUND',
  'USER_NOT_FOUND', 'NOT_AVAILABLE', 'ALREADY_SOLD', 'ALREADY_SETTLED',
  'BOOKS_NOT_AVAILABLE', 'TRANSFER_BLOCKED', 'MONEY_STILL_OWED',
  'NO_FINAL_DEADLINE', 'NO_CHECK_IN_DATE', 'FINAL_PASSED', 'IN_THE_PAST', 'CANNOT_MOVE_BACK',
  'TOO_FAR', 'BAD_DATE', 'AFTER_DRAW', 'DUE_AFTER_FINAL', 'PARTIAL_BOOK',
  'TICKETS_IN_USE', 'BOOKS_IN_USE', 'NOT_GENERATED', 'ABOVE_CEILING',
  'CANNOT_SHRINK', 'SCHEMA_DRIFT', 'NOT_ELIGIBLE', 'NOT_IN_BOOK',
  'NOT_RESERVED', 'MISSING_FIELD', 'BAD_REQUEST', 'RANGE_TOO_LARGE',
  'BELOW_GENERATED', 'NOT_YOUR_BOOK', 'BOOK_WITH_SELLER', 'BOOK_CLOSED',
  // An organiser writing into a book that is out with a seller: allowed, and
  // now asked to say why. This fixture's books are out with A001 and the caller
  // is the super admin, so the two selling actions land on it — which is the
  // rule working rather than a gap in the fixture.
  'REASON_REQUIRED',
  'DUPLICATE_IN_BATCH', 'BATCH_REJECTED',
])

/** Never acceptable: the action does not exist, or it broke. */
const BROKEN = new Set(['UNKNOWN_ACTION', 'QUERY_FAILED', 'SERVER_ERROR'])

const called = Object.keys(CALLS).sort()

console.log(`calling all ${called.length} actions as the super admin`)
{
  for (const action of called) {
    const { body } = await call(action, CALLS[action])
    if (body.ok) {
      ok(body.data !== undefined && body.data !== null, `${action} answers with data`)
      continue
    }
    const code = body.error?.code
    ok(!BROKEN.has(code), `${action} is not broken (got ${code}: ${body.error?.message ?? ''})`)
    ok(DELIBERATE.has(code), `${action} refused deliberately, not accidentally (${code})`)
  }
}

console.log('and the reads answer for a recorder too')
{
  // A different role walks different branches — the agent-scoping code in
  // particular, which is where an unlinked account once saw everything.
  for (const action of ['whoami', 'read_snapshot', 'list_books', 'list_agents',
                        'search', 'deadline_status', 'report_outstanding']) {
    const { body } = await call(action, CALLS[action], 'rec@x.com')
    const code = body.error?.code
    ok(body.ok || !BROKEN.has(code),
       `${action} works for a recorder (${code ?? 'ok'})`)
  }
}

console.log('every action the client calls exists on this backend')
{
  // The list is read from src/ rather than typed here, so an action added to a
  // screen tomorrow is covered the day it is added rather than the day it
  // breaks. ping is excluded: the function is auth:'user' and has no
  // unauthenticated path, so the client deliberately never calls it here.
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = new URL('../src/', import.meta.url).pathname
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
  const src = walk(root).map((f) => readFileSync(f, 'utf8')).join('\n')
  const calls = [...new Set([...src.matchAll(/api\('([a-z_]+)'/g)].map((m) => m[1]))]
    .filter((a) => a !== 'ping').sort()

  const untested = calls.filter((a) => !(a in CALLS))
  ok(untested.length === 0,
    `every action a screen calls is exercised here — missing: ${untested.join(', ')}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
