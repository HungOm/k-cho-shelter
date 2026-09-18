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

/**
 * A client that takes Book-001 for somebody else between the check and the write.
 *
 * IT HOOKS THE RPC NOW, not `.from('books').update()`. The issue path used to
 * be a PostgREST update followed by a separate history insert; it is one SQL
 * function, so the moment to steal the book is the moment that function is
 * called. The property under test has not changed — an issue lands only on
 * books that are still free — and if this hook is ever pointed at a call the
 * handler no longer makes, the race stops being simulated and every assertion
 * below passes for the wrong reason.
 */
function racedClient(w) {
  const inner = w.ctx.supabaseAdmin
  return {
    ...inner,
    rpc: (fn, args) => {
      if (fn === 'issue_books_tx') {
        const b = w.db.tables.books.find((x) => x.idx === 1)
        b.status = 'Out'; b.held_by_agent = 'A002'
      }
      return inner.rpc(fn, args)
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

console.log('2b. a book that came back untouched goes out again without a settlement of nought')
{
  /*
   * WHAT THIS REPLACES. Only an Unassigned book could be issued, so a seller
   * who took ten books, sold nothing from three and handed those three back had
   * to have each one counted in — a settlement declaring nought sold — and then
   * restocked, before anybody else could carry them. Three acts, two screens
   * and a figure signed off, to move paper that never left the desk.
   *
   * AND THE HALF THAT MUST NOT MOVE. A book with sales on it still goes through
   * the office. Issuing a part-sold book to somebody else carries the first
   * seller's money to the second and takes their debt off the chase list with
   * nobody deciding it — the fault that put RM400 on the wrong volunteer across
   * Books 001, 002, 003 and 116. It is the same condition transferBooks refuses
   * as BOOK_HAS_SALES, read from the same view, so the two cannot drift.
   */
  const w = fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Returned' }), book(2, { status: 'Returned' })],
    book_ledger_all: [
      ledger(1, { status: 'Returned' }),
      ledger(2, { status: 'Returned', recorded_sold: 3, recorded_amount: 30 }),
    ],
  })

  const r = await books.issueBooks({ bookNumbers: ['Book-001'], agentId: 'A002' }, users.admin, w.ctx)
  eq(r.issued, 1, 'a book handed back with nothing sold from it can be given out again')
  eq(w.row('books', (b) => b.idx === 1).status, 'Out', 'it goes out')
  eq(w.row('books', (b) => b.idx === 1).held_by_agent, 'A002', 'to whoever is taking it')
  eq(w.table('book_history').filter((h) => h.book_idx === 1 && h.action === 'issue').length, 1,
     'and the handover is on its record')

  const e = await errOf(() =>
    books.issueBooks({ bookNumbers: ['Book-002'], agentId: 'A002' }, users.admin, w.ctx))
  eq(e?.code, 'BOOKS_NOT_AVAILABLE', 'one with sales on it is still refused')
  // The refusal has to say which rule, because "returned" on its own sends
  // somebody looking for one.
  ok(/count it in first/.test(e?.details?.blocked?.[0]?.status ?? ''),
     `and names the way out (got "${e?.details?.blocked?.[0]?.status}")`)
  eq(w.row('books', (b) => b.idx === 2).status, 'Returned', 'and it did not move')

  // A range that mixes the two leaves nothing half issued, like every other
  // refusal on this handler.
  const both = fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Returned' }), book(2, { status: 'Returned' })],
    book_ledger_all: [ledger(1, { status: 'Returned' }),
                      ledger(2, { status: 'Returned', recorded_sold: 3, recorded_amount: 30 })],
  })
  eq(await codeOf(() => books.issueBooks(
       { fromBook: 'Book-001', toBook: 'Book-002', agentId: 'A002' }, users.admin, both.ctx)),
     'BOOKS_NOT_AVAILABLE', 'a range with one part-sold book in it is refused whole')
  eq(both.row('books', (b) => b.idx === 1).status, 'Returned', 'the empty one stayed put too')
  eq(both.table('book_history').length, 0, 'and nothing was written')

  // A SETTLED book is a different case and stays shut: its figures are declared
  // and its money reconciled, so it is restocked rather than re-issued.
  const settled = fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Settled', declared_sold: 0, amount_due: 0, amount_paid: 0 })],
    book_ledger_all: [ledger(1, { status: 'Settled' })],
  })
  eq(await codeOf(() => books.issueBooks({ bookNumbers: ['Book-001'], agentId: 'A002' }, users.admin, settled.ctx)),
     'BOOKS_NOT_AVAILABLE', 'a counted-in book is restocked first, however empty it was')
}

console.log('2c. offering books to a seller who cannot sign in just gives them the books')
{
  /*
   * OFFERING ASKS FOR CONSENT, AND MOST SELLERS CANNOT GIVE IT.
   *
   * A book is offered so the seller can agree before it becomes theirs. A seller
   * here is a paper identity — agents holds a name, a phone and a zone and no
   * email — and an account is an optional link nobody makes for the volunteer
   * carrying one book round their church. Offered to one of them, a book waits
   * for an answer that cannot come.
   *
   * WHAT THAT COST, on the live raffle: two books sat Offered to a seller with no
   * account. They were in neither count — not in the office, not with a seller —
   * and the handover receipt, which lists what somebody is holding, showed
   * nothing on the one screen an organiser opens at the moment of putting the
   * paper in their hand. It read as "the receipt is gone".
   *
   * So for that seller the offer IS the handover, and it is recorded as one,
   * against the organiser who made it. Nobody was ever permanently stuck — an
   * organiser could accept on their behalf — but that is a step with no meaning
   * which somebody had to know to take.
   */
  const w = fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null }),
            book(2, { status: 'Unassigned', held_by_agent: null })],
    book_ledger_all: [ledger(1, { status: 'Unassigned', held_by_agent: null }),
                      ledger(2, { status: 'Unassigned', held_by_agent: null })],
    // A001 can sign in. A002 cannot, which is the ordinary case.
    app_users: [{ email: 'a@x.com', name: 'Daw Hla', role: 'agent', active: true, agent_id: 'A001' }],
  })

  const r = await books.offerBooks({ bookNumbers: ['Book-001'], agentId: 'A002' }, users.admin, w.ctx)
  ok(r.direct === true, 'the reply says it went out rather than waiting')
  eq(r.whyDirect, 'no_account', 'and why, so the screen can say so')
  eq(r.issued, 1, 'one book given')
  eq(w.row('books', (b) => b.idx === 1).status, 'Out', 'it is out, not Offered')
  eq(w.row('books', (b) => b.idx === 1).held_by_agent, 'A002', 'and in their hands')
  eq(w.table('book_history').filter((h) => h.book_idx === 1 && h.action === 'issue').length, 1,
     "recorded as a handover on the book's trail")

  // AND THE HALF THAT MUST NOT CHANGE: a seller who CAN sign in is still asked.
  const signed = fakeDb({
    config: baseConfig(), agents,
    books: [book(2, { status: 'Unassigned', held_by_agent: null })],
    book_ledger_all: [ledger(2, { status: 'Unassigned', held_by_agent: null })],
    app_users: [{ email: 'a@x.com', name: 'Daw Hla', role: 'agent', active: true, agent_id: 'A001' }],
  })
  const r2 = await books.offerBooks({ bookNumbers: ['Book-002'], agentId: 'A001' }, users.admin, signed.ctx)
  ok(!r2.direct, 'somebody with an account is still offered rather than handed')
  eq(signed.row('books', (b) => b.idx === 2).status, 'Offered', 'and the book waits for their answer')
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

// ============ 5. a ticket keeps its past, and it is readable ============

/*
 * WHO MAY READ THE TRAIL IS WHOEVER MAY READ THE TICKET.
 *
 * Phase 1 gave the buyer fields to organisers and nobody else, which is a
 * fourth rule for a question the system already answers three times in
 * agreement — tickets_readable in the database, mask() on every other read, and
 * what the ticket screen shows. It was wrong in both directions at once: the
 * seller carrying the book was shown the buyer on the live ticket and a blank
 * in its history, and a viewer who may read every buyer in the raffle was shown
 * none of them here. So the trail asks gate.ts the same question the ticket
 * does, and these cases are the four answers it can give.
 */
console.log('5. a book\'s history carries every change to its tickets, and whoever may read the ticket may read it')
{
  const w = fakeDb({
    config: baseConfig(), agents,
    books: [book(1)],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', recorded_by: 'rec@x.com' }],
    book_history: [{ book_idx: 1, from_agent: null, to_agent: 'A001', action: 'issue',
                     by_user: 'boss@x.com', note: '', at: '2026-08-01T00:00:00Z' }],
    ticket_history: [{ id: 1, at: '2026-08-02T00:00:00Z', ticket_idx: 1, book_idx: 1,
      from_status: 'Available', to_status: 'Sold', from_agent: null, to_agent: 'A002',
      from_buyer: '', to_buyer: 'Pa Thang', from_phone: '', to_phone: '0123456789',
      from_amount: null, to_amount: 10, from_payment: '', to_payment: 'Paid',
      source: 'app', by_user: 'rec@x.com', note: 'lives behind the market' }],
  })
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.boss, w.ctx)
  eq(r.history.length, 1, 'the book\'s own movements are still there')
  eq(r.tickets.length, 1, 'and the ticket trail rides along')
  const t = r.tickets[0]
  eq(t.ticket, 'KS-00001', 'by ticket number, not row index')
  eq(t.fromStatus + '>' + t.toStatus, 'Available>Sold', 'what changed')
  eq(t.toSeller, 'U Kyaw', 'credited to a person, by name')
  eq(t.toBuyer, 'Pa Thang', 'an organiser sees who was written on it')
  eq(t.toPayment, 'Paid', 'and that it was marked paid — otherwise that step shows nothing')
  eq(t.by, 'rec@x.com', 'and who wrote it')

  // A001 is carrying Book-001, so tickets_readable shows them this buyer.
  const holder = await books.bookHistory({ bookNumber: 'Book-001' }, users.agent, w.ctx)
  eq(holder.tickets[0].toStatus, 'Sold', 'the seller carrying the book sees the movement')
  eq(holder.tickets[0].toBuyer, 'Pa Thang', 'and the buyer, which is the name their own ticket screen shows them')
  eq(holder.tickets[0].toPhone, '0123456789', 'and the number they would ring')

  const other = { ...users.agent, email: 'b@x.com', name: 'U Kyaw', agentId: 'A002' }
  const stranger = await books.bookHistory({ bookNumber: 'Book-001' }, other, w.ctx)
  eq(stranger.tickets[0].toStatus, 'Sold', 'a seller who is not carrying it still sees the movement')
  eq(stranger.tickets[0].toBuyer, '', 'and not somebody else\'s buyer')
  eq(stranger.tickets[0].toPhone, '', 'nor their number')
  eq(stranger.tickets[0].note, '', 'nor the note about them, which is masked with them everywhere else')

  const wroteIt = await books.bookHistory({ bookNumber: 'Book-001' }, users.recorder, w.ctx)
  eq(wroteIt.tickets[0].toBuyer, 'Pa Thang', 'the helper who wrote the sale down sees it')
  eq(wroteIt.tickets[0].note, 'lives behind the market', 'and their own note')
  const elseHelper = { ...users.recorder, email: 'other@x.com' }
  eq((await books.bookHistory({ bookNumber: 'Book-001' }, elseHelper, w.ctx)).tickets[0].toBuyer, '',
     'a helper who did not sees a desk shift, not every buyer in the raffle')

  const viewer = { ...users.recorder, role: 'viewer', email: 'v@x.com' }
  const seen = await books.bookHistory({ bookNumber: 'Book-001' }, viewer, w.ctx)
  eq(seen.tickets[0].toBuyer, 'Pa Thang', 'a viewer reads the names')
  eq(seen.tickets[0].toPhone, '\u2022\u2022\u2022\u2022789',
     'with the telephone number shortened exactly as mask() shortens the live one')
}

console.log('a function the migrations install matches the one the repo calls canonical')
{
  /*
   * THE GAP THIS CLOSES, raised by another session and real.
   *
   * 20260917150000 changed how a closed book's money is READ — it follows
   * books.settled_by_agent now — while the only thing that WRITES that column
   * is settle_book, which lives in supabase/functions.sql. `supabase db push`
   * does not read that file. So the migration set carried the new reading model
   * and a settle_book from before the column existed.
   *
   * SETUP.md applies functions.sql AFTER the migrations, so a clean build built
   * by following it is fine. The exposure is an EXISTING project updated with
   * db push alone, which is the ordinary incremental path and the one
   * production is on. There the new views arrive and the old writer stays, and
   * nothing fails: a settlement simply stores no seller, and under closed-book
   * rules that money goes to the desk instead of to whoever sold it. The
   * seller's line reads zero.
   *
   * THE RULE, which is checkable and would have caught it: if a function is
   * defined both in functions.sql and in any migration, the newest migration
   * defining it must define it the same way. When they agree, db push alone
   * leaves the database with the canonical function. When they drift, whether
   * the database is right depends on somebody having remembered to re-apply a
   * file — which is not a mechanism.
   */
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const ROOT = fileURLToPath(new URL('../', import.meta.url))

  const bodies = (sql) => {
    const out = new Map()
    const re = /create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*)\s*\(/gi
    for (const m of sql.matchAll(re)) {
      const start = m.index
      const lang = sql.indexOf('language ', start)
      if (lang < 0) continue
      const end = sql.indexOf(';', lang)
      if (end < 0) continue
      // Whitespace-insensitive, so reindenting a function is not a failure.
      out.set(m[1].toLowerCase(), sql.slice(start, end + 1).replace(/\s+/g, ' ').trim())
    }
    return out
  }

  /*
   * ONE VERSION, ONE MIGRATION. Supabase keys applied migrations by the leading
   * timestamp, not by the filename, so two files sharing a version are one
   * migration as far as the database is concerned — the second is recorded as
   * already applied and silently never runs.
   *
   * Nearly shipped here: a migration written in this session was dated
   * 20260917180000, which a peer's config_defaults.sql already had. Both files
   * looked fine side by side in the directory.
   */
  const versions = new Map()
  const dupes = []
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql'))) {
    const v = f.slice(0, f.indexOf('_'))
    if (versions.has(v)) dupes.push(`${v}: ${versions.get(v)} and ${f}`)
    else versions.set(v, f)
  }
  ok(dupes.length === 0,
     `no two migrations share a version${dupes.length ? ' — ' + dupes.join('; ') : ''}`)

  const canonical = bodies(readFileSync(join(ROOT, 'supabase/functions.sql'), 'utf8'))
  ok(canonical.size >= 5, `functions.sql parsed (${canonical.size} functions)`)

  // Newest migration wins, because that is the one db push leaves behind.
  const newest = new Map()
  for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    for (const [name, body] of bodies(readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'))) {
      newest.set(name, { body, file: f })
    }
  }
  ok(newest.size > 0, `migrations parsed (${newest.size} functions defined across them)`)

  const drifted = []
  for (const [name, { body, file }] of newest) {
    if (!canonical.has(name)) continue
    if (canonical.get(name) !== body) drifted.push(`${name} (newest in ${file})`)
  }
  ok(drifted.length === 0,
     `every function a migration installs matches functions.sql${drifted.length ? ' — drifted: ' + drifted.join(', ') : ''}`)

  // The specific one that started this, named so a future reader can see the
  // case rather than only the rule.
  ok(/settled_by_agent/.test(canonical.get('settle_book') ?? ''),
     'settle_book writes settled_by_agent in functions.sql')
  ok(/settled_by_agent/.test(newest.get('settle_book')?.body ?? ''),
     'and a migration carries that same writer, so db push alone installs it')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
