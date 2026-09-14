/*
 * Does each reply carry the fields the browser reads off it?
 *
 * Three separate bugs today were the same bug: a handler that returned
 * successfully, passed its gate, sat in both registries, and handed back a
 * shape the client could not use.
 *
 *   read_snapshot      no `fields` array      -> threw on the first page
 *   list_permissions   no `actions` array     -> Access screen blank
 *   report_draw_ready  no `totals` object     -> "Getting your raffle…" forever
 *
 * The last one is the one to remember. The tickets had loaded. Nothing was
 * broken except the shape of one reply, and the symptom was a spinner that
 * never stopped — which reads as "slow" or "stuck", not as "this field is
 * missing", so it could have been chased for a long time in the wrong place.
 *
 * These handlers are RUN, not read. A test that greps the source for a key name
 * proves the key is typed somewhere, not that it survives to the caller.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const reports = await loadModule('reports.ts')
const api = (await loadModule('index.ts')).default

/** A small raffle with something in every state the reports care about. */
function world() {
  const tickets = Array.from({ length: 50 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: Math.ceil((i + 1) / 10), status: 'Available',
    buyer_name: '', buyer_phone: '', amount: null, sold_by_agent: null, notes: '',
  }))
  // Book 1 sold, one of them with nobody to ring. Book 2 partly reserved.
  for (let i = 0; i < 10; i++) {
    Object.assign(tickets[i], {
      status: 'Sold', buyer_name: 'Ma Nu', buyer_phone: '0125550100',
      amount: 10, sold_by_agent: 'A001',
    })
  }
  Object.assign(tickets[4], { buyer_phone: '' })
  Object.assign(tickets[10], { status: 'Reserved' })
  Object.assign(tickets[11], { status: 'Void' })

  const books = Array.from({ length: 5 }, (_, i) => ({
    idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'),
    status: i === 0 ? 'Settled' : i === 1 ? 'Out' : 'Unassigned',
    held_by_agent: i < 2 ? 'A001' : null,
    declared_sold: i === 0 ? 10 : null, amount_due: i === 0 ? 100 : null,
    amount_paid: i === 0 ? 60 : null, due_at: null,
  }))

  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '50', ACTIVE_TICKETS: '50' }),
    tickets,
    books,
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true }],
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null }],
    book_ledger_all: books.map((b) => ({
      idx: b.idx, number: b.number, status: b.status,
      held_by_agent: b.held_by_agent, agent_name: 'Daw Hla', due_at: null,
      counted_expected: b.idx === 1 ? 100 : 0,
      counted_collected: b.idx === 1 ? 60 : 0,
      counted_sold: b.idx === 1 ? 10 : 0,
      days_overdue: 0, past_final: false,
    })),
  })
}

const call = async (action, payload = {}, email = 'boss@x.com') => {
  const w = world()
  const req = new Request('https://x/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  })
  const res = await api.fetch(req, { ...w.ctx, userClaims: { id: 'u1', email } })
  return (await res.json()).data
}

/** Assert every path exists on the payload. 'totals.expected' walks in. */
function carries(payload, paths, label) {
  for (const path of paths) {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), payload)
    ok(v !== undefined, `${label} carries ${path}`)
  }
}

// ============ the one that cost an afternoon ============
console.log('report_draw_ready carries what the home screen computes its overview from')
{
  const d = await call('report_draw_ready')

  // store.js: state.totals = draw.totals — and overview returns null without it,
  // which renders as a spinner that never stops.
  ok(d.totals && typeof d.totals === 'object', 'totals is an object, not undefined')
  carries(d, [
    'totals.ticketsSold', 'totals.ticketsAvailable', 'totals.ticketsReserved',
    'totals.ticketsVoid', 'totals.expected', 'totals.collected',
    'totals.outstanding', 'totals.missingContact',
  ], 'report_draw_ready')

  // store.js: state.bookStats = draw.booksByStatus — the grid colours from it.
  ok(d.booksByStatus && typeof d.booksByStatus === 'object', 'booksByStatus is an object')
  ok(d.booksByStatus.Out === 1, 'and counts the book that is out')

  // Draw.vue renders ready.blockers as a list of strings.
  ok(Array.isArray(d.blockers), 'blockers is an array')
  ok(d.blockers.every((b) => typeof b === 'string'), 'of strings, which is what Draw.vue prints')

  carries(d, ['ready', 'currency', 'drawDate', 'checkInDate', 'finalDeadline', 'finalPassed'],
    'report_draw_ready')

  // The numbers have to be right, not merely present: book 1 is settled, so it
  // reports its DECLARED figures — 100 due, 60 handed in, 40 outstanding.
  ok(d.totals.expected === 100, `expected is 100 (got ${d.totals.expected})`)
  ok(d.totals.collected === 60, `collected is 60 (got ${d.totals.collected})`)
  ok(d.totals.outstanding === 40, `outstanding is 40 (got ${d.totals.outstanding})`)
  ok(d.totals.missingContact === 1, `one sold ticket has nobody to ring (got ${d.totals.missingContact})`)
  ok(d.totals.ticketsReserved === 1, 'one is being held')
  ok(d.totals.ticketsVoid === 1, 'and one is void')
}

// ============ the other two, so they cannot come back ============
console.log('read_snapshot carries the wire the client parses')
{
  const d = await call('read_snapshot', { offset: 0, limit: 1000 })
  ok(Array.isArray(d.fields), 'fields is an array — toTicket does fields.forEach')
  ok(d.fields[0] === 'Ticket_Number', 'named the way FIELD_MAP is keyed')
  ok(Array.isArray(d.rows), 'rows is an array')
  ok(Array.isArray(d.rows[0]), 'and each row is an ARRAY, not an object')
  ok(d.rows[0].length === d.fields.length, 'as long as the fields list')
  carries(d, ['returned', 'total', 'hasMore', 'offset'], 'read_snapshot')

  // The book must arrive as a NUMBER, not an index: the grid and search key on it.
  const bookAt = d.fields.indexOf('Book_Number')
  ok(String(d.rows[0][bookAt]).startsWith('Book-'), `book arrives as a name (${d.rows[0][bookAt]})`)
}

console.log('list_permissions carries the grid the Access screen draws')
{
  const d = await call('list_permissions')
  ok(Array.isArray(d.actions), 'actions is an array')
  ok(Array.isArray(d.roles), 'roles is an array')
  carries(d.actions[0], ['action', 'group', 'label', 'defaults', 'current'], 'each action')
}

console.log('list_books carries the counts the home screen reads')
{
  const d = await call('list_books')
  carries(d, ['books', 'stats', 'total', 'currency', 'generatedBooks', 'heldBackBooks'], 'list_books')
  ok(d.stats.Out === 1, 'stats counts by status')
}

console.log('whoami carries what the app boots on')
{
  const d = await call('whoami')
  carries(d, ['email', 'role', 'isSuperAdmin', 'config.ticketPrefix', 'config.currency',
              'config.totalTickets', 'config.ticketPrice'], 'whoami')
}

console.log('the money reports carry their own shape')
{
  const out = await call('report_outstanding')
  carries(out, ['agents', 'totalOutstanding', 'currency'], 'report_outstanding')

  const over = await call('report_overdue')
  carries(over, ['books', 'count', 'checkInDate', 'finalDeadline', 'pastFinal'], 'report_overdue')

  const st = await call('agent_statement', { agentId: 'A001' })
  carries(st, ['agent', 'books', 'sold', 'expected', 'collected', 'outstanding', 'currency'],
    'agent_statement')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
