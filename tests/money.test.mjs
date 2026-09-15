/*
 * Cash handed in: who may record it, who may see whose, and the column that
 * could not say no.
 *
 * THREE FAILURES THIS PINS, all of them found on a live screen.
 *
 * 1. THE MONEY COLUMN WAS ALWAYS GREEN. `/paid|received|in/i` against the only
 *    two values the system writes — 'Paid' and 'Unpaid' — matches both, because
 *    "Unpaid" contains "paid". Every sold ticket in the raffle showed as paid,
 *    including the ones nobody had paid for, and the chip had no reachable
 *    state that said otherwise. The screen showed ten tickets marked paid above
 *    a total that said 90 of 100 had come in, and both were drawn from the
 *    data: they were answering different questions in the same column.
 *
 * 2. HANDED IN ONLY MOVED WHEN A BOOK CLOSED. books.amount_paid is written by
 *    settle_book and nothing else, so a seller who brought half the money and
 *    kept the book to sell the rest showed as having handed in nothing. There
 *    was no way to record a part payment at all — the organiser's choices were
 *    to wait, or to close a book nobody had counted.
 *
 * 3. MONEY WAS NOT SCOPED. A helper at a desk for one afternoon saw every
 *    seller's debt, and a seller could not see their own anywhere in the app.
 *
 * THE RULE THAT RESOLVES ALL THREE: money follows CUSTODY, not whoever typed it
 * in. A helper records sales credited to the book's holder, so a helper owes
 * nothing and is shown nothing — unless they also carry books, in which case
 * they are a seller for this purpose and no special case is needed.
 *
 * Both backends, because they have disagreed before.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  if (String(g) === String(w)) pass++
  else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) }
}

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const M = await loadModule('money.ts')
const reports = await loadModule('reports.ts')
const books = await loadModule('books.ts')

/** Two sellers holding a book each, one of them with money already in. */
function world(payments = []) {
  const bookRows = [
    { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001', due_at: null },
    { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002', due_at: null },
  ]
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
    books: bookRows,
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
    ],
    payments,
    book_ledger_all: [
      { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001', agent_name: 'Daw Hla',
        counted_sold: 10, counted_expected: 100, counted_collected: 0, days_overdue: 0 },
      { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002', agent_name: 'U Kyaw',
        counted_sold: 5, counted_expected: 50, counted_collected: 0, days_overdue: 0 },
    ],
  })
}

const helper = { ...users.recorder }                       // a desk helper, no books
const sellerHelper = { ...users.recorder, agentId: 'A001' } // a helper who also carries books
const viewer = { email: 'v@x.com', name: 'V', role: 'viewer', active: true,
                 agentId: null, isAdmin: false, isSuperAdmin: false }

// ============ 1. who may be told about whom ============

console.log('1. the scope rule, stated once')
{
  eq(M.moneyScope(users.boss), 'all', 'an organiser sees every seller')
  eq(M.moneyScope(users.agent), 'mine', 'a seller sees their own line')
  eq(M.moneyScope(sellerHelper), 'mine', 'so does a helper who also carries books')
  eq(M.moneyScope(helper), 'totals', 'a helper carrying nothing gets totals, not names')
  eq(M.moneyScope(viewer), 'totals', 'and so does a viewer')

  eq(M.visibleAgents(users.boss), null, 'null means everybody')
  eq(JSON.stringify(M.visibleAgents(users.agent)), '["A001"]', 'a seller: only themselves')
  eq(JSON.stringify(M.visibleAgents(helper)), '[]', 'a helper with no books: nobody')
}

console.log('2. and the report obeys it')
{
  const w = world()
  const all = await reports.reportOutstanding({}, users.boss, w.ctx)
  eq(all.agents.length, 2, 'an organiser sees both sellers')
  eq(all.scope, 'all', 'and is told the scope')

  const mine = await reports.reportOutstanding({}, users.agent, w.ctx)
  eq(mine.agents.length, 1, 'a seller sees one line')
  eq(mine.agents[0].agentId, 'A001', 'their own')

  const desk = await reports.reportOutstanding({}, helper, w.ctx)
  eq(desk.agents.length, 0, 'a helper holding nothing sees no names')
  eq(desk.scope, 'totals', 'and is told why')

  const vw = await reports.reportOutstanding({}, viewer, w.ctx)
  eq(vw.agents.length, 0, 'nor does a viewer')
  ok(Number(vw.totalOutstanding) >= 0, 'but the totals still come back')
}

// ============ 2. recording cash ============

console.log('3. money can be handed in without closing a book')
{
  const w = world()
  const r = await M.recordPayment({ agentId: 'A001', amount: 40, note: 'at the hall' },
    users.boss, w.ctx)
  eq(r.amount, 40, 'recorded')
  eq(r.stillOwed, 60, 'and what is left is worked out, not guessed')
  eq(w.table('payments').length, 1, 'one ledger row')
  eq(w.table('books').find((b) => b.idx === 1).status, 'Out',
     'the book is untouched — recording cash is not settling')

  const after = await reports.reportOutstanding({}, users.boss, w.ctx)
  const line = after.agents.find((x) => x.agentId === 'A001')
  eq(line.collected, 40, 'handed in reflects the part payment')
  eq(line.outstanding, 60, 'and so does what they owe')
}

console.log('4. what recording refuses')
{
  const w = world()
  eq(await codeOf(() => M.recordPayment({ amount: 10 }, users.boss, w.ctx)),
     'MISSING_FIELD', 'somebody has to have handed it in')
  eq(await codeOf(() => M.recordPayment({ agentId: 'A001' }, users.boss, w.ctx)),
     'MISSING_FIELD', 'and an amount is required')
  eq(await codeOf(() => M.recordPayment({ agentId: 'A001', amount: 0 }, users.boss, w.ctx)),
     'MISSING_FIELD', 'zero is not a payment')
  eq(await codeOf(() => M.recordPayment({ agentId: 'A001', amount: -5 }, users.boss, w.ctx)),
     'MISSING_FIELD', 'and a negative is a reversal, which has its own door')
  eq(await codeOf(() => M.recordPayment({ agentId: 'A404', amount: 10 }, users.boss, w.ctx)),
     'AGENT_NOT_FOUND', 'the seller has to exist')
  eq(await codeOf(() => M.recordPayment(
    { agentId: 'A001', amount: 10, bookNumber: 'Book-999' }, users.boss, w.ctx)),
     'BOOK_NOT_FOUND', 'and a named book has to exist')
}

console.log('5. a helper cannot record money against somebody else')
{
  const w = world()
  eq(await codeOf(() => M.recordPayment({ agentId: 'A002', amount: 10 }, sellerHelper, w.ctx)),
     'NOT_AUTHORIZED', 'recording for another seller changes what THEY are shown as owing')
  const own = await M.recordPayment({ agentId: 'A001', amount: 10 }, sellerHelper, w.ctx)
  eq(own.amount, 10, 'but their own is theirs to write down')
}

console.log('6. undoing is a new row, never a delete')
{
  const w = world()
  const made = await M.recordPayment({ agentId: 'A001', amount: 40 }, users.boss, w.ctx)
  eq(await codeOf(() => M.reversePayment({ paymentId: made.paymentId }, users.boss, w.ctx)),
     'MISSING_FIELD', 'a reversal nobody can explain is worse than the mistake')

  const undone = await M.reversePayment(
    { paymentId: made.paymentId, reason: 'wrong seller' }, users.boss, w.ctx)
  eq(undone.stillOwed, 100, 'the debt comes back')
  eq(w.table('payments').length, 2, 'BOTH rows survive — the trail keeps the mistake')
  const rev = w.table('payments').find((p) => p.reverses)
  eq(rev.amount, -40, 'the reversal is the negative of it')

  eq(await codeOf(() => M.reversePayment(
    { paymentId: made.paymentId, reason: 'again' }, users.boss, w.ctx)),
     'NOTHING_TO_DO', 'and it cannot be reversed twice')
  eq(await codeOf(() => M.reversePayment({ paymentId: 9999, reason: 'x' }, users.boss, w.ctx)),
     'NOT_FOUND', 'nor can a payment that does not exist')
}

// ============ 3. settlement is a handover too ============

console.log('7. settling writes to the same ledger')
{
  const w = world()
  await books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 70, unsoldTickets: [] }, users.boss, w.ctx)

  const rows = w.table('payments')
  eq(rows.length, 1, 'the settlement recorded a handover')
  eq(rows[0].source, 'settlement', 'marked as counted in with a book')
  eq(rows[0].amount, 70, 'for what was actually handed over')

  /*
   * AND IT IS NOT COUNTED TWICE, which is the invariant that matters.
   *
   * settle_book writes books.amount_paid AND a settlement row, so a total that
   * summed both would charge the raffle twice for the same cash. Asserted here
   * rather than "they add up", because the plpgsql settle_book is stubbed in
   * this fake: it never moves amount_paid, so an adding-up assertion would be
   * testing the stub. The Apps Script half settles for real and asserts the
   * sum; supabase/test-functions.sh covers the function against real Postgres.
   */
  const w2 = world()
  await M.recordPayment({ agentId: 'A001', amount: 30 }, users.boss, w2.ctx)
  await books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 70, unsoldTickets: [] }, users.boss, w2.ctx)
  eq(w2.table('payments').filter((x) => x.source === 'settlement').length, 1,
     'the settlement left its row')
  const line = (await reports.reportOutstanding({}, users.boss, w2.ctx))
    .agents.find((x) => x.agentId === 'A001')
  eq(line.collected, 30,
     'and the total counts the hand payment only — the settlement row is excluded')
}

console.log('8. a settlement and its ledger row move together, or neither does')
{
  /*
   * THIS USED TO ASSERT THE OPPOSITE, and the change is the point of the fix.
   *
   * The payment row was written after settle_book returned, in a call that
   * deliberately could not fail the settlement — "money is not held hostage by
   * a bookkeeping row". The price was that the two could disagree: a book
   * saying RM70 came in, over a ledger with no row for it, and the only
   * symptom a seller's running total quietly short. Nothing sums them against
   * each other, so nothing would ever have said so.
   *
   * Written inside the transaction, that disagreement is not reachable. The
   * cost is the case below: a ledger that cannot be written now refuses the
   * settlement. That is the safer half of the trade — a book that is not
   * settled is visibly not settled, and somebody tries again.
   */
  const w = world()
  delete w.db.tables.payments

  eq(await codeOf(() => books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 70, unsoldTickets: [] }, users.boss, w.ctx)),
    'QUERY_FAILED', 'a ledger that cannot be written refuses the settlement')
}

// ============ 4. reading it back ============

console.log('9. a seller is shown their own payments and nobody else\'s')
{
  const w = world()
  await M.recordPayment({ agentId: 'A001', amount: 40 }, users.boss, w.ctx)
  await M.recordPayment({ agentId: 'A002', amount: 25 }, users.boss, w.ctx)

  const mine = await M.listPayments({ agentId: 'A002' }, users.agent, w.ctx)
  eq(mine.agentId, 'A001', 'asking for another seller quietly returns your own')
  eq(mine.payments.length, 1, 'one row')
  eq(mine.payments[0].amount, 40, 'their own money')

  const organiser = await M.listPayments({ agentId: 'A002' }, users.boss, w.ctx)
  eq(organiser.payments.length, 1, 'an organiser may ask about anybody')
  eq(organiser.payments[0].amount, 25, 'and gets that seller')

  const desk = await M.listPayments({ agentId: 'A001' }, helper, w.ctx)
  eq(desk.payments.length, 0, 'a helper holding nothing is shown nothing')
}

// ============ 5. the Apps Script side agrees ============

console.log('10. the Sheet backend decides it the same way')
{
  const { execFileSync } = await import('node:child_process')
  let out
  try {
    out = execFileSync(process.execPath, [new URL('./money.gs.cjs', import.meta.url).pathname],
      { encoding: 'utf8' })
  } catch (e) {
    out = (e.stdout ?? '') + (e.stderr ?? '')
  }
  const lines = out.split('\n').filter((l) => l.startsWith('  FAIL'))
  if (lines.length) process.stdout.write(lines.join('\n') + '\n')
  const m = out.match(/(\d+) passed, (\d+) failed/)
  ok(!!m, `the Apps Script half ran${m ? '' : ' — it crashed:\n' + out.slice(-900)}`)
  if (m) { pass += Number(m[1]); fail += Number(m[2]) }
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
