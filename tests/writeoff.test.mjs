/*
 * Money that is not coming back, said out loud instead of faked.
 *
 * Readiness rule L6 says the draw is ready when outstanding money is zero, OR
 * every non-zero line has been explicitly written off with a reason. Only the
 * first half was buildable. A raffle with one seller who genuinely never pays —
 * who moved, who is unreachable, who lost the book — could never read as ready,
 * and the only way to clear the blocker was to record a payment that never
 * happened.
 *
 * That is the failure worth naming. A rule that can only be satisfied by lying
 * does not stop anybody; it teaches them to put false figures in the one place
 * the raffle keeps its accounts, and then every total downstream is wrong in a
 * way nobody can find.
 *
 * A WRITE-OFF IS NOT A PAYMENT, and most of this file is about that one
 * sentence. It reduces what somebody owes and it is not cash, so anything
 * summing money handed in has to leave it out — otherwise the screen says the
 * money arrived and the seller whose debt was forgiven appears to have paid it.
 * The row lives in `payments` because it belongs to the same running total and
 * because every correction to money here is a row with a reason rather than an
 * edit, and `source` is what keeps the two apart.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const money = await loadModule('money.ts')
const reports = await loadModule('reports.ts')

const REASON = 'Moved away in June, no forwarding number, family says the book was lost.'

/** A001 owes RM120 of RM150; A002 is straight. */
function world(payments = []) {
  return fakeDb({
    config: baseConfig({}),
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
    ],
    books: [
      { idx: 1, number: 'Book-001', status: 'Settled', held_by_agent: 'A001' },
      { idx: 2, number: 'Book-002', status: 'Settled', held_by_agent: 'A002' },
    ],
    book_ledger_all: [
      { idx: 1, number: 'Book-001', status: 'Settled', held_by_agent: 'A001', agent_name: 'Daw Hla',
        days_overdue: 0, counted_sold: 15, counted_expected: 150, counted_collected: 30,
        recorded_sold: 15, recorded_amount: 150, unidentified_sold: 0, available: 0,
        reserved: 0, missing_contact: 0, past_final: false },
      { idx: 2, number: 'Book-002', status: 'Settled', held_by_agent: 'A002', agent_name: 'U Kyaw',
        days_overdue: 0, counted_sold: 5, counted_expected: 50, counted_collected: 50,
        recorded_sold: 5, recorded_amount: 50, unidentified_sold: 0, available: 0,
        reserved: 0, missing_contact: 0, past_final: false },
    ],
    payments,
  })
}
const rows = (w) => w.table('payments')

console.log('1. it records the decision, with the reason attached')
{
  const w = world()
  eq(await money.owedBy(w.ctx, 'A001'), 120, 'A001 owes RM120 to begin with')

  const r = await money.writeOff({ agentId: 'A001', reason: REASON }, users.admin, w.ctx)
  eq(r.amount, 120, 'unstated means all of it, which is the common case')
  eq(r.stillOwed, 0, 'and the account is closed')
  ok(/account is closed/.test(r.message), 'said in words, not only in a number')

  const row = rows(w).find((p) => p.source === 'writeoff')
  ok(!!row, 'a row was written')
  eq(row.amount, 120, 'for the whole debt')
  eq(row.note, REASON, 'carrying the reason somebody typed')
  eq(row.received_by, 'admin@x.com', 'and who decided it')
  eq(await money.owedBy(w.ctx, 'A001'), 0, 'they no longer owe anything')
}

console.log('2. it is NOT counted as money handed in')
{
  /*
   * The one that matters. If a write-off is summed with the cash, the screen
   * says the money arrived — and the seller whose debt was forgiven appears
   * to have paid it, to anybody reading the total afterwards.
   */
  const w = world()
  const before = (await money.collectedByAgent(w.ctx, null)).get('A001') ?? 0
  await money.writeOff({ agentId: 'A001', reason: REASON }, users.admin, w.ctx)
  const after = (await money.collectedByAgent(w.ctx, null)).get('A001') ?? 0
  eq(after, before, 'what they handed in did not move — no cash changed hands')
  eq(after, 30, 'it is still the RM30 that actually came back')

  const forgiven = (await money.writtenOffByAgent(w.ctx, null)).get('A001')
  eq(forgiven, 120, 'and the forgiven amount is its own figure')
}

console.log('3. an unknown kind of row is never assumed to be cash')
{
  // The sum used to ask for "not settlement", which counts every kind of row
  // nobody has thought of yet. A write-off was the first one, and the next one
  // would have been summed as money too.
  const w = world([{ id: 9, agent_id: 'A001', amount: 999, source: 'writeoff', note: REASON }])
  const paid = (await money.collectedByAgent(w.ctx, null)).get('A001') ?? 0
  eq(paid, 30, 'a write-off already on the books is not part of what they handed in')
}

console.log('4. the reason is required, and a word is not a reason')
{
  const w = world()
  eq(await codeOf(() => money.writeOff({ agentId: 'A001' }, users.admin, w.ctx)),
    'MISSING_FIELD', 'no reason at all is refused')
  eq(await codeOf(() => money.writeOff({ agentId: 'A001', reason: 'lost' }, users.admin, w.ctx)),
    'MISSING_FIELD', '"lost" is a word, not an explanation')
  eq(rows(w).length, 0, 'and nothing was written either time')

  const e = await errOf(() => money.writeOff({ agentId: 'A001', reason: 'x' }, users.admin, w.ctx))
  ok(/in a year/.test(e.message), 'the refusal says who the reason is for')
}

console.log('5. it cannot forgive more than is owed')
{
  const w = world()
  const e = await errOf(() =>
    money.writeOff({ agentId: 'A001', amount: 500, reason: REASON }, users.admin, w.ctx))
  eq(e.code, 'TOO_MUCH', 'refused')
  eq(e.details.owed, 120, 'naming what is actually owed')
  ok(/owing them money/.test(e.message), 'and why: a negative balance reads as the raffle owing them')
  eq(rows(w).length, 0, 'nothing was written')
}

console.log('6. part of a debt can be forgiven and the rest still chased')
{
  const w = world()
  const r = await money.writeOff({ agentId: 'A001', amount: 20, reason: REASON }, users.admin, w.ctx)
  eq(r.stillOwed, 100, 'the rest is still owed')
  ok(/still owes 100/.test(r.message), 'and says so')
  eq(await money.owedBy(w.ctx, 'A001'), 100, 'which is what the balance now reads')
}

console.log('7. nothing owed is nothing to forgive')
{
  const w = world()
  eq(await codeOf(() => money.writeOff({ agentId: 'A002', reason: REASON }, users.admin, w.ctx)),
    'NOTHING_TO_DO', 'a seller who is straight cannot have a debt written off')
  eq(rows(w).length, 0, 'and no row invents one')
}

console.log('8. a seller who does not exist is not written off')
{
  const w = world()
  eq(await codeOf(() => money.writeOff({ agentId: 'A999', reason: REASON }, users.admin, w.ctx)),
    'AGENT_NOT_FOUND', 'refused')
  eq(await codeOf(() => money.writeOff({ reason: REASON }, users.admin, w.ctx)),
    'MISSING_FIELD', 'and so is nobody at all')
}

console.log('9. the decision is on the record')
{
  const w = world()
  await money.writeOff({ agentId: 'A001', amount: 20, reason: REASON }, users.admin, w.ctx)
  const logged = w.table('audit_log').find((r) => r.action === 'WRITE_OFF')
  ok(!!logged, 'the audit log has it')
  eq(logged.details.amount, 20, 'with the amount')
  eq(logged.details.owedBefore, 120, 'and what was owed before, so the log reads without the ledger')
  eq(logged.details.reason, REASON, 'and the reason')
  eq(logged.email, 'admin@x.com', 'and who decided')
}

console.log('10. the chase list stops chasing what was forgiven')
{
  const w = world()
  const before = await reports.reportOutstanding({}, users.admin, w.ctx)
  const a1Before = before.agents.find((l) => l.agentId === 'A001')
  eq(a1Before.outstanding, 120, 'A001 owes RM120')

  await money.writeOff({ agentId: 'A001', reason: REASON }, users.admin, w.ctx)

  const after = await reports.reportOutstanding({}, users.admin, w.ctx)
  const a1 = after.agents.find((l) => l.agentId === 'A001')
  eq(a1.outstanding, 0, 'and now owes nothing')
  eq(a1.writtenOff, 120, 'because RM120 was written off')
  eq(a1.collected, 30, 'while what they handed in is untouched — the cash did not arrive')
  eq(a1.expected, 150, 'and what they should have had is unchanged')
  eq(after.totalOutstanding, 0, 'so the raffle is not owed anything either')
}

console.log('11. and the draw can be ready, honestly')
{
  /*
   * The whole point. Before this, a raffle with one seller who never pays had
   * a blocker that could only be cleared by recording a payment that never
   * happened.
   */
  const w = world()
  const before = await reports.reportDrawReady({}, users.admin, w.ctx)
  const moneyProblem = (r) => r.problems.find((p) => p.what === 'money not handed in')
  ok(!!moneyProblem(before), 'the money blocker is up')
  ok(/write it off with a reason/.test(moneyProblem(before).why),
    'and it says what to do instead of recording a payment that did not happen')

  await money.writeOff({ agentId: 'A001', reason: REASON }, users.admin, w.ctx)

  const after = await reports.reportDrawReady({}, users.admin, w.ctx)
  ok(!moneyProblem(after), 'once forgiven with a reason, the money no longer blocks the draw')
}

console.log('12. a partial write-off leaves the blocker up, and says what was forgiven')
{
  const w = world()
  await money.writeOff({ agentId: 'A001', amount: 20, reason: REASON }, users.admin, w.ctx)
  const r = await reports.reportDrawReady({}, users.admin, w.ctx)
  const problem = r.problems.find((p) => p.what === 'money not handed in')
  ok(!!problem, 'RM100 is still outstanding, so the draw is still blocked')
  eq(problem.count, 100, 'for the amount that is genuinely still missing')
  ok(/20 has been written off already/.test(problem.why),
    'and the blocker says what was already forgiven, so nobody writes it off twice')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
