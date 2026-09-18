/*
 * A seller reporting back, and an organiser accepting it.
 *
 * WHAT A SELLER COULD DO AT A CHECKPOINT BEFORE THIS: nothing. They carry the
 * books, they hold the stubs and the cash, they are given a date — and then the
 * checkpoint happens TO them. An organiser types their figures into a screen
 * the seller never sees, from numbers read out over a telephone or remembered
 * from a car park, and the only record of what the seller said is written by
 * somebody else, afterwards, with the seller not in the room.
 *
 * IT IS A PETITION, NOT A NEW TABLE, for the same reasons a book request is:
 * pending_approvals already stores the exact payload with a server-written
 * summary, lapses it, scopes the list, and executes on decision rather than
 * unlocking something for later. What is different — and the thing this file
 * exists to pin — is that ACCEPTING IS WHAT WRITES. Nothing the seller sends
 * moves a book, marks a ticket or touches the ledger until an organiser says
 * yes, and then all of it happens at once, in the organiser's name.
 *
 * AND THE ORDER IS THE ORDER OF THE TABLE: the books come back first, because a
 * book has to be on the desk before it can be counted in; then each counted
 * book, with the stubs the seller listed; then the money, as ONE hand-over
 * against the seller rather than a share invented per book.
 */
import { setEnv, loadModule } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

const book = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-' + String((idx - 1) * 10 + 1).padStart(5, '0'),
  last_ticket: 'KS-' + String(idx * 10).padStart(5, '0'),
  status: 'Unassigned', held_by_agent: null, due_at: null,
  declared_sold: null, amount_due: null, amount_paid: null, version: 1, ...over,
})
const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'), status: 'Unassigned',
  held_by_agent: null, agent_name: '', days_overdue: 0, recorded_sold: 0, recorded_amount: 0,
  counted_sold: 0, counted_expected: 0, counted_collected: 0, available: 10, ...over,
})
const ticket = (idx, bookIdx, over = {}) => ({
  idx, number: 'KS-' + String(idx).padStart(5, '0'), book_idx: bookIdx,
  status: 'Available', buyer_name: '', buyer_phone: '', buyer_zone: '',
  sold_by_agent: null, amount: null, payment_status: '', source: '', version: 1, ...over,
})

/**
 * One seller, two books out with her.
 *
 * Book-001 has two tickets written down as sold — the book she will count in.
 * Book-002 was never opened — the one she is bringing back. That pair is the
 * whole of a checkpoint and the reason the draft suggests different things for
 * each.
 */
const world = () => fakeDb({
  config: baseConfig({ TOTAL_TICKETS: '30', ACTIVE_TICKETS: '30', TICKETS_PER_BOOK: '10',
                       TICKET_PRICE: '10', CHECK_IN_DATE: '2026-10-01', CHECK_IN_ROUND: '1' }),
  app_users: [
    { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
    { email: 'org@x.com', name: 'Hung Om', role: 'admin', active: true, agent_id: null },
    { email: 'seller@x.com', name: 'Daw Hla', role: 'agent', active: true, agent_id: 'A001' },
    { email: 'other@x.com', name: 'U Kyaw', role: 'agent', active: true, agent_id: 'A002' },
  ],
  /*
   * ONE OF EACH KIND OF SELLER, and the third one is the common kind.
   *
   * A001 and A002 have accounts. Pu Lian does not, and never will: `agents`
   * holds a name, a telephone number and a zone, and an app_users row is an
   * optional link that nobody makes for the volunteer carrying one book round
   * their church. Most sellers in this raffle are that.
   *
   * A fixture made entirely of sellers who can sign in agrees with itself
   * indefinitely while describing a raffle that does not exist — every case
   * passes, and the reporting workflow is never once exercised the way most of
   * it actually happens: the organiser doing it with the seller standing there.
   */
  agents: [
    { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
    { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'KL', active: true },
    { agent_id: 'A003', name: 'Pu Lian', phone: '0125553333', zone: 'KL', active: true },
  ],
  books: [
    book(1, { status: 'Out', held_by_agent: 'A001', due_at: '2026-10-01' }),
    book(2, { status: 'Out', held_by_agent: 'A001', due_at: '2026-10-01' }),
    book(3),
  ],
  book_ledger_all: [
    ledger(1, { status: 'Out', held_by_agent: 'A001', agent_name: 'Daw Hla',
                recorded_sold: 2, recorded_amount: 20, counted_sold: 2,
                counted_expected: 20, available: 8 }),
    ledger(2, { status: 'Out', held_by_agent: 'A001', agent_name: 'Daw Hla' }),
    ledger(3),
  ],
  tickets: [
    ...Array.from({ length: 10 }, (_, i) => ticket(i + 1, 1)),
    ...Array.from({ length: 10 }, (_, i) => ticket(i + 11, 2)),
    ...Array.from({ length: 10 }, (_, i) => ticket(i + 21, 3)),
  ],
  check_in_reports: [],
  payments: [],
})

// Two sold in Book-001, written down by the seller as she went.
const withSales = () => {
  const w = world()
  for (const n of ['KS-00001', 'KS-00002']) {
    Object.assign(w.db.tables.tickets.find((t) => t.number === n),
                  { status: 'Sold', buyer_name: 'Ko Zaw', buyer_phone: '0125550100',
                    sold_by_agent: 'A001', amount: 10, payment_status: 'Paid' })
  }
  return w
}

async function call(action, payload, email, w) {
  const req = new Request('https://x/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload ?? {} }),
  })
  const res = await api.fetch(req, { ...w.ctx, userClaims: { id: 'u1', email } })
  return { status: res.status, body: await res.json() }
}

console.log('1. the report is ready when the seller opens it, not a blank form')
{
  const w = withSales()
  const { body } = await call('report_draft', {}, 'seller@x.com', w)
  ok(body.ok, `a seller can build their own (${body.error?.code ?? ''} ${body.error?.message ?? ''})`)
  const d = body.data
  eq(d.agentId, 'A001', 'and it is theirs, without asking for it by id')
  eq(d.books.length, 2, 'both books they are holding')

  const one = d.books.find((b) => b.book === 'Book-001')
  const two = d.books.find((b) => b.book === 'Book-002')
  eq(one.recordedSold, 2, 'what is already written down in the part-sold one')
  eq(one.unsoldNumbers.length, 8, 'and the stubs that leaves')
  /*
   * WHAT THE SCREEN OPENS ON, and it changed the day "keep it" arrived.
   *
   * Both of these books have tickets left in them, so the honest suggestion
   * for both is that the seller carries on selling. It used to be "count this
   * one in, bring that one back" — the two ENDINGS — which at a mid-raffle
   * checkpoint asks somebody holding eight live tickets to either close the
   * book on them or hand them back. One live book froze exactly that way.
   */
  eq(one.suggest, 'keep', 'a book with tickets left in it is one to carry on selling')
  eq(two.suggest, 'keep', 'and so is one that was never opened')
  eq(d.stillSelling, true, 'because the raffle has not closed')
  eq(d.expected, 20, 'the money those sales come to')
  eq(d.owed, 20, 'none of it handed over yet')
  eq(d.booksExpected, 20, 'which is also what the books in her hands come to')
  eq(d.handedIn, 0, 'and nothing has been handed over against no book')
  eq(d.round, 1, 'the round it answers')
}

console.log('1b. a book with nothing left in it is one to count in')
{
  /*
   * The other half of the rule. There is no selling to carry on with, so the
   * suggestion is the ending — count the stubs while the seller is standing
   * there, rather than send them away with a book that is finished.
   */
  const w = world()
  for (let i = 1; i <= 10; i++) {
    Object.assign(w.db.tables.tickets.find((t) => t.idx === i),
                  { status: 'Sold', buyer_name: 'Ko Zaw', buyer_phone: '0125550100',
                    sold_by_agent: 'A001', amount: 10, payment_status: 'Paid' })
  }
  const { body } = await call('report_draft', {}, 'seller@x.com', w)
  const one = body.data.books.find((b) => b.book === 'Book-001')
  eq(one.suggest, 'count', 'sold out, so it is finished with')
  eq(one.unsoldNumbers.length, 0, 'and there is nothing to bring back from it')
}

console.log('1c. once selling has closed, keeping a book is not on offer')
{
  /*
   * A suggestion to carry on selling after the sales date has passed is the
   * screen telling a volunteer to do something the server refuses. Past either
   * date the two endings come back: what has sales in it is counted in, and
   * what does not comes back.
   */
  const w = withSales()
  w.db.tables.config.push({ key: 'SALES_CLOSE_DATE', value: '2020-01-01' })
  const { body } = await call('report_draft', {}, 'seller@x.com', w)
  eq(body.data.stillSelling, false, 'the screen is told selling is over')
  eq(body.data.books.find((b) => b.book === 'Book-001').suggest, 'count',
     'the part-sold one is counted in')
  eq(body.data.books.find((b) => b.book === 'Book-002').suggest, 'return',
     'and the untouched one comes back')
}

console.log('1d. what she owes is the raffle\'s own figure, not this screen\'s')
{
  /*
   * WHY THIS IS READ RATHER THAN RECOMPUTED.
   *
   * The screen used to work it out as "sold tickets in the books still in her
   * hands, less every payment row with her name on it". Both halves go wrong
   * the moment a book has been finished: the takings of a closed book are not
   * in the first, and settle_book's own evidence row IS in the second — so
   * finishing one book for RM100 while holding another with RM60 written down
   * showed the seller RM40 IN CREDIT on the one screen that tells her what to
   * bring. agent_money has always had it right; now this asks it.
   */
  const w = withSales()
  // A book she finished last week: closed at RM100, paid in full.
  Object.assign(w.db.tables.books.find((b) => b.idx === 3),
                { status: 'Settled', held_by_agent: 'A001', settled_by_agent: 'A001',
                  declared_sold: 10, amount_due: 100, amount_paid: 100 })
  Object.assign(w.db.tables.book_ledger_all.find((b) => b.idx === 3),
                { status: 'Settled', held_by_agent: 'A001', agent_name: 'Daw Hla',
                  counted_sold: 10, counted_expected: 100, counted_collected: 100 })
  // settle_book's own evidence row, which is not a hand-over and never was.
  w.db.tables.payments.push(
    { agent_id: 'A001', amount: 100, source: 'settle', book_idx: 3, method: 'cash' })

  const { body } = await call('report_draft', {}, 'seller@x.com', w)
  eq(body.data.owed, 20, 'she owes the RM20 in the book she is still holding')
  eq(body.data.handedIn, 0, 'a settlement row is not money handed in against no book')
}

console.log('1e. interim money comes off what she owes, and is named')
{
  /*
   * The case the whole workflow exists for: she has sold two, handed the RM20
   * over, and is still carrying both books. She owes nothing and is holding
   * everything, and both halves have to be sayable at once.
   */
  const w = withSales()
  w.db.tables.payments.push(
    { agent_id: 'A001', amount: 20, source: 'hand', book_idx: null, method: 'cash' })
  const { body } = await call('report_draft', {}, 'seller@x.com', w)
  eq(body.data.owed, 0, 'paid up')
  eq(body.data.handedIn, 20, 'and the screen can say where that came from')
  eq(body.data.books.length, 2, 'with both books still in her hands')
}

console.log('2. and it is nobody else\'s to read')
{
  const w = withSales()
  const { body } = await call('report_draft', { agentId: 'A001' }, 'other@x.com', w)
  ok(!body.ok, 'another seller is refused')
  eq(body.error.code, 'NOT_YOURS', 'by name')

  const staff = await call('report_draft', { agentId: 'A001' }, 'org@x.com', w)
  ok(staff.body.ok, 'an organiser may build one for somebody on the telephone')
  eq(staff.body.data.agentId, 'A001', 'for the seller they named')
}

console.log('3. sending it changes NOTHING until somebody accepts')
{
  const w = withSales()
  const { body } = await call('request_approval', {
    action: 'report_back',
    payload: {
      books: [
        { book: 'Book-001', action: 'count', unsold: ['KS-00003', 'KS-00004', 'KS-00005',
          'KS-00006', 'KS-00007', 'KS-00008', 'KS-00009', 'KS-00010'] },
        { book: 'Book-002', action: 'return' },
      ],
      ticketsSold: 2, stubsReturned: 2, unsoldReturned: 8, amountHanded: 20,
    },
  }, 'seller@x.com', w)

  ok(body.ok, `the report is accepted into the queue (${body.error?.message ?? ''})`)
  ok(/Daw Hla/.test(body.data.summary), 'the sentence names who is reporting')
  ok(/count in/.test(body.data.summary), 'and what accepting it would do')
  ok(/20/.test(body.data.summary), 'including the money')

  const row = w.table('pending_approvals')[0]
  eq(row.action, 'report_back', 'one row, naming the action it would run')
  eq(row.detail.runAs, 'approver', 'marked as the organiser\'s act to perform')
  eq(row.payload.agentId, 'A001', 'and pinned to whoever sent it')

  // THE WHOLE POINT. Every one of these is still exactly as it was.
  eq(w.db.tables.books.find((b) => b.idx === 1).status, 'Out', 'the counted book has not moved')
  eq(w.db.tables.books.find((b) => b.idx === 2).status, 'Out', 'nor the returned one')
  eq(w.db.tables.tickets.filter((t) => t.status === 'Sold').length, 2,
     'no ticket has been marked sold')
  eq(w.table('payments').length, 0, 'and not a penny is on the ledger')
  eq(w.table('check_in_reports').length, 0, 'nothing is recorded as reported either')
}

console.log('4. a seller cannot carry out their own report')
{
  const w = withSales()
  const { body } = await call('report_back', {
    agentId: 'A001', books: [{ book: 'Book-002', action: 'return' }],
  }, 'seller@x.com', w)
  ok(!body.ok, 'the direct call is refused')
  eq(body.error.code, 'INSUFFICIENT_ROLE', 'because carrying it out is the organiser\'s act')
  eq(w.db.tables.books.find((b) => b.idx === 2).status, 'Out', 'and the book did not move')
}

console.log('5. accepting is what writes — all of it, at once, in the organiser\'s name')
{
  const w = withSales()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: {
      books: [
        { book: 'Book-001', action: 'count', unsold: ['KS-00003', 'KS-00004', 'KS-00005',
          'KS-00006', 'KS-00007', 'KS-00008', 'KS-00009', 'KS-00010'] },
        { book: 'Book-002', action: 'return' },
      ],
      ticketsSold: 2, stubsReturned: 2, unsoldReturned: 8, amountHanded: 20, note: 'all in',
    },
  }, 'seller@x.com', w)
  const id = asked.body.data.requestId

  const decided = await call('decide_book_request', { requestId: id, approve: true }, 'org@x.com', w)
  ok(decided.body.ok, `an organiser decides it (${decided.body.error?.code ?? ''} ${decided.body.error?.message ?? ''})`)
  ok(decided.body.data.executed, 'and accepting carries it out there and then')

  /*
   * BOTH BOOKS ARE ON THE DESK, which is the half this fake can prove.
   *
   * The count-in itself is settle_book, and the fake models only the part of it
   * a handler can observe — the ledger. It does not move the book row or write
   * declared_sold, on purpose, because the arithmetic is proven against real
   * Postgres in supabase/test-functions.sh and a JavaScript re-implementation
   * of settlement here would be the fake agreeing with itself.
   *
   * So what is pinned here is what this file is actually about: that accepting
   * put BOTH books back on the desk, and that the one marked for counting went
   * through the count-in path with its own stubs and nobody else's.
   */
  const one = w.db.tables.books.find((b) => b.idx === 1)
  const two = w.db.tables.books.find((b) => b.idx === 2)
  eq(two.status, 'Returned', 'the untouched book is simply back')
  /*
   * The counted book's own row is NOT asserted, and the reason is the fake:
   * settle_book is modelled here only for its ledger half, so the row it would
   * set to Settled in Postgres stays as it was. It is also no longer returned
   * first — a book is counted in straight from the seller's hands, which is the
   * ordinary count-in and one write instead of two.
   */
  eq(one.held_by_agent, 'A001', 'the counted book is still known to be hers')

  const result = decided.body.data.result
  eq(result.counted.length, 1, 'one book went through the count-in')
  eq(result.counted[0].book, 'Book-001', 'the one with sales in it')
  eq(result.returned.length, 1, 'and one simply came back')
  eq(result.returned[0], 'Book-002', 'the one that was never opened')

  /*
   * THE MONEY LANDS ON THE BOOK IT PAYS FOR.
   *
   * It used to go in as one loose hand-over against the seller while every book
   * was counted in at nought — the seller's balance came out right and each
   * book said "should have 20, handed in 0, still owed 20" for ever. Somebody
   * then counts that book in again with the money, and the same cash is on the
   * ledger twice; and the book can never go back on the shelf, because restock
   * refuses a book with money owed on it. Both happened within a day.
   */
  const paid = w.table('payments')
  eq(paid.length, 1, 'one payment row')
  eq(Number(paid[0].amount), 20, 'for what she handed over')
  eq(paid[0].agent_id, 'A001', 'against her')
  eq(paid[0].book_idx, 1, 'and against the book it pays for, not loose')
  eq(paid[0].source, 'settlement', 'as part of counting that book in')
  eq(paid[0].received_by, 'org@x.com', 'taken by the organiser who accepted it')
  eq(decided.body.data.result.counted[0].paid, 20, 'the result says what that book was paid')
  eq(decided.body.data.result.overPaid, 0, 'and nothing was left over')

  // And the declaration itself, which is the half nothing else records.
  const said = w.table('check_in_reports')
  eq(said.length, 1, 'she is recorded as having reported')
  eq(said[0].agent_id, 'A001', 'by name')
  eq(said[0].books_back, 2, 'with both books accounted for')
  eq(said[0].stubs_returned, 2, 'the stubs she handed in')
  eq(said[0].unsold_returned, 8, 'and the tickets that came back unsold')
}

console.log('6. a report that no longer matches the books is refused whole')
{
  const w = withSales()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'return' },
                       { book: 'Book-002', action: 'return' }], amountHanded: 0 },
  }, 'seller@x.com', w)

  // Somebody transferred Book-001 away while the report sat in the queue.
  Object.assign(w.db.tables.books.find((b) => b.idx === 1), { held_by_agent: 'A002' })

  const decided = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(!decided.body.ok, 'accepting it fails rather than doing half of it')
  ok(/Book-001/.test(JSON.stringify(decided.body.error ?? {})), 'naming the book that moved')
  eq(w.db.tables.books.find((b) => b.idx === 2).status, 'Out',
     'and the book that was still fine did not move either')
}

console.log('6b. a book already where the report wanted it is finished, not a conflict')
{
  /*
   * THE TRAP THIS REMOVES, reported from the live raffle. This handler makes
   * several writes and is not one transaction, so a failure part way through
   * left some books moved and the request still Pending. "Already moved" and
   * "moved somewhere else" were treated alike, so the organiser could not
   * accept the report — the moved books read as stale — and declining left the
   * books where the half-run put them. The seller's book was settled, and a
   * settled book cannot be sold from by anybody.
   *
   * So a book already in the state the report asked for is skipped and named.
   * Accepting again finishes what is left, which is what somebody will try.
   */
  const w = withSales()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'count', unsold: [] },
                       { book: 'Book-002', action: 'return' }], amountHanded: 0 },
  }, 'seller@x.com', w)

  // Book-002 was brought back by hand while the report sat in the queue.
  Object.assign(w.db.tables.books.find((b) => b.idx === 2), { status: 'Returned' })

  const decided = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(decided.body.ok,
     `accepting still works (${decided.body.error?.code ?? ''} ${decided.body.error?.message ?? ''})`)
  eq(decided.body.data.result.alreadyDone.join(','), 'Book-002',
     'and says which book was already dealt with')
  eq(decided.body.data.result.counted.length, 1, 'while the rest of the report was carried out')

  // A book that went somewhere ELSE is still refused, and refuses the whole
  // report with it — that is a different fact and a different fix.
  const w2 = withSales()
  const a2 = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'return' }], amountHanded: 0 },
  }, 'seller@x.com', w2)
  Object.assign(w2.db.tables.books.find((b) => b.idx === 1), { status: 'Lost' })
  const d2 = await call('decide_book_request',
    { requestId: a2.body.data.requestId, approve: true }, 'org@x.com', w2)
  ok(!d2.body.ok, 'a book that is lost now is refused')
  eq(d2.body.error.code, 'REPORT_STALE', 'by name')
}

console.log('7. an empty report is not a report')
{
  const w = world()
  const { body } = await call('request_approval', {
    action: 'report_back', payload: { books: [], amountHanded: 0 },
  }, 'seller@x.com', w)
  ok(!body.ok, 'refused')
  eq(body.error.code, 'NOTHING_TO_DO', 'with the reason said plainly')
}

console.log('7b. but "still selling, nothing yet" IS a report')
{
  /*
   * THE ANSWER THE QUEUE USED TO REFUSE.
   *
   * A seller who has sold nothing since the last checkpoint has no book coming
   * back and no money to hand over. The only truthful thing they can say is
   * "both books are still with me, I am still selling" — and that was rejected
   * as empty, so they sent nothing at all and the round recorded them as
   * silent. Being chased for a checkpoint you turned up to is how a volunteer
   * stops answering checkpoints.
   *
   * It is not empty. It is a dated statement of which books are in whose
   * hands, and accepting it marks the round answered without moving anything.
   */
  const w = world()
  const { body } = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'keep' },
                       { book: 'Book-002', action: 'keep' }], amountHanded: 0 },
  }, 'seller@x.com', w)
  ok(body.ok, `accepted (${body.error?.code ?? ''} ${body.error?.message ?? ''})`)
  ok(/staying with them/.test(body.data.summary),
     `the organiser is told what it says: "${body.data.summary}"`)
  const row = w.row('pending_approvals', (r) => r.action === 'report_back')
  eq(row.detail.lines.length, 0, 'and nothing is listed for them to DO')
  eq(row.detail.keeping.length, 2, 'though both books are named as staying put')
}

console.log('7c. accepting it moves nothing and marks the round answered')
{
  const w = world()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'keep' }], amountHanded: 0 },
  }, 'seller@x.com', w)
  const decided = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(decided.body.ok,
     `accepted (${decided.body.error?.code ?? ''} ${decided.body.error?.message ?? ''})`)

  const one = w.row('books', (b) => b.number === 'Book-001')
  eq(one.status, 'Out', 'the book has not moved')
  eq(one.held_by_agent, 'A001', 'and it is still hers')
  eq(w.table('payments').length, 0, 'no money was invented')
  ok(!!w.row('check_in_reports', (r) => r.agent_id === 'A001'),
     'and she has answered the round, which is the whole point')
}

console.log('7d. a book that is no longer hers cannot be reported as kept')
{
  /*
   * A kept book asks nothing of the organiser, which is not the same as being
   * unchecked. The report SAYS it is in her hands; if it is not, the report is
   * wrong and the whole of it is refused rather than half-applied.
   */
  const w = world()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-001', action: 'keep' }], amountHanded: 0 },
  }, 'seller@x.com', w)
  Object.assign(w.db.tables.books.find((b) => b.number === 'Book-001'),
                { held_by_agent: 'A002' })
  const decided = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  const code = decided.body.error?.code ?? decided.body.data?.error?.code
  eq(code, 'REPORT_STALE', 'it is refused, because the paper is not where it says')
  eq(w.row('books', (b) => b.number === 'Book-001').held_by_agent, 'A002',
     'and nothing was changed on the way to finding out')
}

console.log('8. and there is a way in — including for the seller who cannot use it')
{
  /*
   * REPORTED AS "I didn't see any submit report or return buttons".
   *
   * A feature nothing can press is not a feature, and this one had two ways to
   * end up that way. The first is ordinary and was caught by looking: the entry
   * point keyed on `agentId`, so a seller whose account is not linked to a
   * seller record — the exact account that cannot report, and the exact account
   * this raffle produced — was shown nothing at all. The person who most needs
   * to be told why is the one it hid from.
   *
   * The second is the attention row written FOR sellers, which pointed at the
   * Books screen. A seller's sidebar has no Books screen. The app told them it
   * was time to report and then had nowhere to put them.
   */
  const { readFileSync } = await import('node:fs')
  const root = new URL('../', import.meta.url).pathname
  const read = (f) => readFileSync(root + f, 'utf8')

  const home = read('src/components/Home.vue')
  ok(/emit\('report-back'\)/.test(home), 'Home has a control that asks for it')
  ok(/defineEmits\(\[[^\]]*'report-back'/.test(home), 'and declares the event, or Vue drops it')

  // Role OR link. Keyed on the link alone it disappears for the broken account.
  const seller = home.slice(home.indexOf('const isSeller'), home.indexOf('function doStep'))
  ok(/role === 'agent'/.test(seller),
     'and it is shown to a seller account whether or not its link is sound')

  const app = read('src/App.vue')
  ok(/@report-back="openModal\('reportback'\)"/.test(app),
     'the app opens the sheet on it — an emit nobody listens for is a dead button')
  ok(/modal\?\.kind === 'reportback'/.test(app), 'and renders it')

  // The row written for sellers goes to the report, not to a screen they do
  // not have.
  const store = read('src/lib/store.js')
  const row = store.slice(store.indexOf("key: 'myreport'"), store.indexOf("key: 'reports'"))
  ok(/act: 'report-back'/.test(row), 'the "time to report" row opens the report itself')
  ok(/a\.act \? emit\(a\.act\) : go\(a\.go\)/.test(home),
     'and Home raises it rather than navigating')
}

console.log('9. the seller names the tickets that came back, rather than counting them')
{
  /*
   * A COUNT CANNOT CARRY THE LINK, and the draw runs on the link.
   *
   * The screen asked "how many did not sell?" and sent the LAST N unsold
   * numbers, on the assumption that a book is sold from the front. Somebody
   * sells three from the middle to buyers who picked their own numbers, says
   * seven did not sell, and seven tickets are marked sold — the wrong seven,
   * with a stranger's name against a number somebody is holding. settle_book
   * takes the numbers for exactly this reason; the screen was the half throwing
   * them away.
   */
  const form = readFileSync(new URL('../src/components/modals/ReportBack.vue', import.meta.url), 'utf8')
  ok(/new Set\(b\.unsoldNumbers\)/.test(form),
     'every ticket not already written down as sold starts as one that came back')
  ok(/unsold: b\.unsoldNumbers\.filter\(n => isUnsold\(b, n\)\)/.test(form),
     'and what is sent is the numbers themselves, in the book\'s own order')
  ok(!/slice\(-Math\.max/.test(form), 'the last-N guess is gone')
  ok(/function toggle\(b, number\)/.test(form) && /aria-pressed/.test(form),
     'they are tapped, which is the act the seller is already performing')
}

console.log('10. a book the organiser has accepted stops being the seller\'s')
{
  /*
   * ASKED FOR IN THESE TERMS: a book the seller returned and the organiser
   * accepted should no longer be seen by the seller; one that has been reported
   * but NOT accepted should be marked, and still be theirs to sell from.
   *
   * held_by_agent deliberately survives a return and a settlement — settlement
   * has to know whose money it is — so "the books in their hands", which is
   * what this list claimed to be, actually meant "every book they have ever
   * held". A seller watched an organiser count a book in and kept it on their
   * own screen for the rest of the raffle.
   */
  const w = withSales()
  // One accepted and counted in, one still out with her.
  Object.assign(w.db.tables.books.find((b) => b.idx === 1), { status: 'Settled' })
  Object.assign(w.db.tables.book_ledger_all.find((b) => b.idx === 1), { status: 'Settled' })

  const seller = await call('list_books', {}, 'seller@x.com', w)
  const mine = seller.body.data.books.map((b) => b.book)
  ok(!mine.includes('Book-001'), `a counted-in book is gone from her list (${mine.join(', ')})`)
  ok(mine.includes('Book-002'), 'and the one she is still holding is not')

  const org = await call('list_books', {}, 'org@x.com', w)
  ok(org.body.data.books.map((b) => b.book).includes('Book-001'),
     'the organiser still sees it — the holder is how the money is chased')
}

console.log('11. a book in a report nobody has accepted is marked, and still hers')
{
  const w = withSales()
  await call('request_approval', {
    action: 'report_back',
    payload: { books: [{ book: 'Book-002', action: 'return' }], amountHanded: 0 },
  }, 'seller@x.com', w)

  const seller = await call('list_books', {}, 'seller@x.com', w)
  const two = seller.body.data.books.find((b) => b.book === 'Book-002')
  const one = seller.body.data.books.find((b) => b.book === 'Book-001')
  ok(two, 'the reported book is still on her list')
  eq(two.status, 'Out', 'still out with her, because nothing happens until it is accepted')
  ok(two.inReport, 'and marked as reported')
  ok(one && !one.inReport, 'while a book she did not report is not')

  // The organiser sees the same mark from the other side, which is the
  // difference between counting a book in twice and knowing not to.
  const org = await call('list_books', {}, 'org@x.com', w)
  ok(org.body.data.books.find((b) => b.book === 'Book-002')?.inReport,
     'the organiser sees there is a report waiting on it')

  // And her own report screen says so rather than offering it as though it were
  // the first time.
  const draft = await call('report_draft', {}, 'seller@x.com', w)
  ok(draft.body.data.books.find((b) => b.book === 'Book-002')?.inReport,
     'her next draft says which books she has already reported')
}

console.log('12. money beyond the books it pays for is a hand-over, and only that part')
{
  /*
   * A seller hands over more than tonight's paper comes to — paying off an
   * older book, or simply rounding up. That money is real and has to land
   * somewhere, and it is not part of any book being counted in. It is the one
   * case the loose hand-over is actually for.
   */
  const w = withSales()
  const asked = await call('request_approval', {
    action: 'report_back',
    payload: {
      books: [{ book: 'Book-001', action: 'count', unsold: ['KS-00003', 'KS-00004', 'KS-00005',
        'KS-00006', 'KS-00007', 'KS-00008', 'KS-00009', 'KS-00010'] }],
      amountHanded: 50,
    },
  }, 'seller@x.com', w)
  const decided = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(decided.body.ok, `accepted (${decided.body.error?.message ?? ''})`)

  const rows = w.table('payments')
  eq(rows.length, 2, 'two rows: the book, and the rest')
  const onBook = rows.find((r) => r.book_idx === 1)
  const loose = rows.find((r) => !r.book_idx)
  eq(Number(onBook.amount), 20, 'the book gets what it comes to and no more')
  eq(Number(loose.amount), 30, 'and the remainder is a hand-over against her')
  eq(decided.body.data.result.overPaid, 30, 'which the result names rather than leaving to be derived')
}

console.log('13. the seller who cannot sign in reports through the organiser')
{
  /*
   * THE KIND OF SELLER THIS RAFFLE IS MOSTLY MADE OF, and the one no test here
   * had ever described. Pu Lian has no account. She cannot open the report
   * screen, cannot press Send, and will never appear in the approvals queue —
   * so every path proven above is a path she does not take.
   *
   * Hers is the organiser doing it with her standing at the table, which is
   * `report_back` called directly rather than asked for: an organiser does not
   * queue a request to themselves. The whole of the workflow has to work down
   * that road too, and none of it was ever run down it.
   */
  const w = world()
  Object.assign(w.db.tables.books.find((b) => b.idx === 3),
                { status: 'Out', held_by_agent: 'A003', due_at: '2026-10-01' })
  Object.assign(w.db.tables.book_ledger_all.find((b) => b.idx === 3),
                { status: 'Out', held_by_agent: 'A003', agent_name: 'Pu Lian' })
  for (const i of [21, 22, 23]) {
    Object.assign(w.db.tables.tickets.find((t) => t.idx === i),
      { status: 'Sold', buyer_name: 'Ma Aye', buyer_phone: '0125550200',
        sold_by_agent: 'A003', amount: 10, payment_status: 'Paid' })
  }

  // The organiser opens her report. She has no account, so there is no "own"
  // to fall back on and the id has to carry the whole answer.
  const drafted = await call('report_draft', { agentId: 'A003' }, 'org@x.com', w)
  ok(drafted.body.ok, `the draft builds for a seller with no account (${drafted.body.error?.code ?? ''})`)
  eq(drafted.body.data.agentName, 'Pu Lian', 'and it is hers')
  eq(drafted.body.data.owed, 30, 'three sold, thirty owed')
  eq(drafted.body.data.books[0].suggest, 'keep',
     'with seven tickets left, so she carries on selling — the same rule as anybody')

  // And she hands over the thirty while keeping the book.
  const done = await call('report_back', {
    agentId: 'A003', books: [{ book: 'Book-003', action: 'keep' }], amountHanded: 30,
  }, 'org@x.com', w)
  ok(done.body.ok, `the organiser records it (${done.body.error?.code ?? ''} ${done.body.error?.message ?? ''})`)

  const book = w.row('books', (b) => b.number === 'Book-003')
  eq(book.status, 'Out', 'the book does not move')
  eq(book.held_by_agent, 'A003', 'and stays with her, which is the point of keeping it')

  const paid = w.table('payments')
  eq(paid.length, 1, 'one payment')
  eq(paid[0].source, 'hand', 'recorded as money handed over')
  eq(paid[0].book_idx, null,
     'against no book — it is interim money, and a book_idx would close a book that is still out')

  ok(!!w.row('check_in_reports', (r) => r.agent_id === 'A003'),
     'and she has answered the round, so the chase list leaves her alone')

  const after = await call('report_draft', { agentId: 'A003' }, 'org@x.com', w)
  eq(after.body.data.owed, 0, 'she owes nothing now')
  eq(after.body.data.handedIn, 30,
     'and the thirty is named as money against no book, which is what the count-in screen reads')
  eq(after.body.data.books.length, 1, 'with the book still in her hands')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
