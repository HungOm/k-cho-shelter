/*
 * The four money holes the 2026-09-15 audit reproduced, closed and pinned.
 *
 * Each of these produced a reassuring total that was wrong: a transfer that
 * moved one seller's debt onto another, an issue that could land on a book
 * somebody else had just taken, a draw declared ready over paid-for entries
 * that could not be drawn, and RM10 "still owed" by nobody because a desk sale
 * had no seller to charge. The SQL half — the Lost-book ledger, the settlement
 * refusal, the row lock and the ticket trail — is proven against real Postgres
 * in supabase/test-functions.sh. This is the handler half.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const books = await loadModule('books.ts')
const reports = await loadModule('reports.ts')

const agents = [
  { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
  { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'Klang', active: true },
]
const book = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-' + String((idx - 1) * 10 + 1).padStart(5, '0'),
  last_ticket: 'KS-' + String(idx * 10).padStart(5, '0'),
  status: 'Out', held_by_agent: 'A001', due_at: null,
  declared_sold: null, amount_due: null, amount_paid: null, version: 1, ...over,
})
const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'), status: 'Out', held_by_agent: 'A001',
  agent_name: 'Daw Hla', days_overdue: 0, recorded_sold: 0, recorded_amount: 0,
  counted_sold: 0, counted_expected: 0, counted_collected: 0, ...over,
})

// ============ 1. money does not change hands with the book ============

console.log('1. a book with sales recorded on it goes through the office, not straight to the next seller')
{
  const w = fakeDb({
    config: baseConfig(), agents,
    books: [book(1), book(2)],
    book_ledger_all: [
      ledger(1, { recorded_sold: 3, recorded_amount: 30, counted_sold: 3, counted_expected: 30 }),
      ledger(2),
    ],
  })
  const err = await errOf(() =>
    books.transferBooks({ fromBook: 'Book-001', toBook: 'Book-002', toAgentId: 'A002' }, users.admin, w.ctx))
  eq(err?.code, 'BOOK_HAS_SALES', 'refused: the first seller\'s sales would be charged to the second')
  eq(err?.details?.books?.[0]?.book, 'Book-001', 'the book is named')
  eq(err?.details?.books?.[0]?.sold, 3, 'with how many sales are on it')
  eq(err?.details?.books?.[0]?.amount, 30, 'and what they are worth')
  eq(err?.details?.books?.[0]?.agent, 'Daw Hla', 'and whose they are')
  eq(w.row('books', (b) => b.idx === 1).held_by_agent, 'A001', 'the book stayed where it was')
  eq(w.row('books', (b) => b.idx === 2).held_by_agent, 'A001', 'and so did the clean one — nothing half moved')
  eq(w.table('book_history').length, 0, 'nothing was written')

  const r = await books.transferBooks({ fromBook: 'Book-002', toAgentId: 'A002' }, users.admin, w.ctx)
  eq(r.transferred, 1, 'a book with nothing sold on it still passes on')
  eq(w.row('books', (b) => b.idx === 2).held_by_agent, 'A002', 'to the new seller')
  eq(w.table('book_history')[0].from_agent + '>' + w.table('book_history')[0].to_agent, 'A001>A002',
     'with both ends of the handover on its record')
}

// ============ 2. an issue lands only on books that are still free ============

/** A client that takes Book-001 for somebody else between the check and the write. */
function racedClient(w) {
  const inner = w.ctx.supabaseAdmin
  return {
    ...inner,
    from: (t) => {
      const q = inner.from(t)
      if (t === 'books') {
        const update = q.update.bind(q)
        q.update = (patch) => {
          const b = w.db.tables.books.find((x) => x.idx === 1)
          b.status = 'Out'; b.held_by_agent = 'A002'
          return update(patch)
        }
      }
      return q
    },
  }
}

console.log('2. two organisers issuing the same run: the second does not overwrite the first')
{
  const fresh = () => fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null }),
            book(2, { status: 'Unassigned', held_by_agent: null })],
  })

  const calm = fresh()
  const r = await books.issueBooks({ fromBook: 'Book-001', toBook: 'Book-002', agentId: 'A001' }, users.admin, calm.ctx)
  eq(r.issued, 2, 'the ordinary case issues both')
  eq(r.skipped.length, 0, 'and skips nothing')
  eq(calm.table('book_history').length, 2, 'one handover per book')

  const raced = fresh()
  const r2 = await books.issueBooks({ fromBook: 'Book-001', toBook: 'Book-002', agentId: 'A001' },
    users.admin, { supabaseAdmin: racedClient(raced) })
  eq(r2.issued, 1, 'only the book still free was issued')
  eq(JSON.stringify(r2.skipped), '["Book-001"]', 'the one taken meanwhile is named, not counted')
  eq(raced.row('books', (b) => b.idx === 1).held_by_agent, 'A002', 'the first organiser keeps it')
  eq(raced.table('book_history').filter((h) => h.book_idx === 1).length, 0, 'and its record shows one handover, not two')
  eq(raced.table('book_history').filter((h) => h.book_idx === 2).length, 1, 'the other book has its one')

  const gone = fakeDb({ config: baseConfig(), agents, books: [book(1, { status: 'Unassigned', held_by_agent: null })] })
  eq(await codeOf(() => books.issueBooks({ fromBook: 'Book-001', agentId: 'A001' },
       users.admin, { supabaseAdmin: racedClient(gone) })),
     'BOOKS_CHANGED_MEANWHILE', 'and when every book was taken meanwhile it says so rather than reporting nought issued')
  eq(gone.table('book_history').length, 0, 'writing nothing')
}

// ============ 3. the draw is not ready over what cannot be drawn ============

console.log('3. sales nobody can draw, and requests nobody decided, keep the draw closed')
{
  const soon = new Date(Date.now() + 3600e3).toISOString()
  const ago = new Date(Date.now() - 3600e3).toISOString()
  const w = fakeDb({
    config: baseConfig({ FINAL_DEADLINE: '2020-01-01' }), agents,
    books: [book(1, { status: 'Settled', declared_sold: 6, amount_due: 60, amount_paid: 60 })],
    book_ledger_all: [ledger(1, { status: 'Settled', counted_sold: 6, counted_expected: 60,
                                  counted_collected: 60, unidentified_sold: 6 })],
    pending_approvals: [
      // status spelled out: a seed bypasses the fake's insert defaults, and the
      // real table defaults it to Pending.
      { request_id: 'R1', action: 'restock_books', payload: {}, summary: 'x', requested_by: 'admin@x.com', expires_at: soon, status: 'Pending' },
      { request_id: 'R2', action: 'restock_books', payload: {}, summary: 'y', requested_by: 'admin@x.com', expires_at: ago, status: 'Pending' },
    ],
    /*
     * A prize, so the two blockers under test here are the only ones speaking.
     * An empty schedule is its own blocker — a raffle with nothing to win is
     * not ready to be drawn — and this section is about the pool, not the
     * prizes. prizes.test.mjs owns that one.
     */
    prizes: [{ prize_id: 'grand', tier: 'Grand Prize', name: 'Hilux', type_id: 'goods',
               value_amount: 1, quantity: 1, rank: 1 }],
  })
  const r = await reports.reportDrawReady({}, users.boss, w.ctx)
  ok(!r.ready, 'not ready')
  ok(r.blockers.some((b) => /not identified \(6\)/.test(b)), 'six buyers paid and are not in the pool: ' + r.blockers.join(' | '))
  ok(r.blockers.some((b) => /waiting for approval \(1\)/.test(b)), 'one live request blocks; the lapsed one does not')
  eq(r.totals.unidentified, 6, 'and the count is in the totals')
  eq(r.totals.pendingApprovals, 1, 'as is the queue')
  ok(!r.blockers.some((b) => /money not handed in/.test(b)), 'the money itself balanced, and is not blamed')

  // Decide the request and identify the sales, and it opens.
  w.db.tables.pending_approvals[0].status = 'Approved'
  w.db.tables.book_ledger_all[0].unidentified_sold = 0
  const again = await reports.reportDrawReady({}, users.boss, w.ctx)
  ok(again.ready, 'ready once both are resolved: ' + again.blockers.join(' | '))
}

// ============ 4. the desk ============

console.log('4. money taken at the desk is money in the tin, not money owed by nobody')
{
  const w = fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20', FINAL_DEADLINE: '2020-01-01' }), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null }), book(2)],
    tickets: [
      { idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', buyer_name: 'John', buyer_phone: '0171234567',
        amount: 10, payment_status: 'Paid', sold_by_agent: null },
      { idx: 2, number: 'KS-00002', book_idx: 1, status: 'Sold', buyer_name: 'Ann', buyer_phone: '0171234568',
        amount: 10, payment_status: 'Unpaid', sold_by_agent: null },
      { idx: 11, number: 'KS-00011', book_idx: 2, status: 'Sold', buyer_name: 'B', buyer_phone: '0171234569',
        amount: 10, payment_status: 'Paid', sold_by_agent: 'A001' },
    ],
    book_ledger_all: [
      ledger(1, { status: 'Unassigned', held_by_agent: null, agent_name: null,
                  recorded_sold: 2, recorded_amount: 20, counted_sold: 2, counted_expected: 20 }),
      ledger(2, { recorded_sold: 1, recorded_amount: 10, counted_sold: 1, counted_expected: 10 }),
    ],
  })

  const out = await reports.reportOutstanding({}, users.boss, w.ctx)
  const desk = out.agents.find((a) => a.agentId === '')
  ok(!!desk, 'the desk has a line of its own')
  eq(desk?.name, 'Sold at the office', 'named as what it is')
  eq(desk?.ticketsSold, 2, 'two sold there')
  eq(desk?.expected, 20, 'worth RM 20')
  eq(desk?.collected, 10, 'of which the paid one is in the tin')
  eq(desk?.outstanding, 10, 'and the unpaid one is still owed — at the desk, by a named buyer')
  eq(out.totalExpected, 30, 'the raffle expects RM 30')
  eq(out.totalCollected, 10, 'has RM 10')
  eq(out.totalOutstanding, 20, 'and is owed RM 20')

  const mine = await reports.reportOutstanding({}, users.agent, w.ctx)
  ok(!mine.agents.some((a) => a.agentId === ''), 'a seller is not shown the desk')
  eq(mine.totalOutstanding, 10, 'only their own')

  const draw = await reports.reportDrawReady({}, users.boss, w.ctx)
  eq(draw.totals.expected, 30, 'the overview expects the same RM 30')
  eq(draw.totals.collected, 10, 'has the same RM 10')
  eq(draw.totals.outstanding, 20, 'and the top of the Money screen now agrees with the table under it')

  const drawMine = await reports.reportDrawReady({}, users.agent, w.ctx)
  eq(drawMine.totals.expected, 10, 'a seller\'s overview is their own books')
  eq(drawMine.totals.collected, 0, 'and the desk\'s cash is not credited to them')
}

// ============ 5. a ticket keeps its past ============

console.log('5. a book\'s history carries every change to its tickets, and a seller is not shown a stranger\'s name')
{
  const w = fakeDb({
    config: baseConfig(), agents,
    books: [book(1)],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold' }],
    book_history: [{ book_idx: 1, from_agent: null, to_agent: 'A001', action: 'issue',
                     by_user: 'boss@x.com', note: '', at: '2026-08-01T00:00:00Z' }],
    ticket_history: [{ id: 1, at: '2026-08-02T00:00:00Z', ticket_idx: 1, book_idx: 1,
      from_status: 'Available', to_status: 'Sold', from_agent: null, to_agent: 'A002',
      from_buyer: '', to_buyer: 'Pa Thang', from_phone: '', to_phone: '0123456789',
      from_amount: null, to_amount: 10, from_payment: '', to_payment: 'Paid',
      source: 'app', by_user: 'rec@x.com', note: '' }],
  })
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.boss, w.ctx)
  eq(r.history.length, 1, 'the book\'s own movements are still there')
  eq(r.tickets.length, 1, 'and the ticket trail rides along')
  const t = r.tickets[0]
  eq(t.ticket, 'KS-00001', 'by ticket number, not row index')
  eq(t.fromStatus + '>' + t.toStatus, 'Available>Sold', 'what changed')
  eq(t.toSeller, 'U Kyaw', 'credited to a person, by name')
  eq(t.toBuyer, 'Pa Thang', 'an organiser sees who was written on it')
  eq(t.by, 'rec@x.com', 'and who wrote it')

  const asAgent = await books.bookHistory({ bookNumber: 'Book-001' }, users.agent, w.ctx)
  eq(asAgent.tickets[0].toStatus, 'Sold', 'a seller sees the movement')
  eq(asAgent.tickets[0].toBuyer, '', 'and not the buyer')
  eq(asAgent.tickets[0].toPhone, '', 'nor their number')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
