/*
 * A helper is not carrying anybody's money.
 *
 * REPORTED FROM A SCREENSHOT, signed in as a Helper:
 *
 *     Should have  RM 0      Handed in  RM 120
 *     Still owed   RM -120   Tickets sold  12
 *
 * Negative money owed is not a rounding error. visibleAgents() returns null for
 * an organiser — meaning no narrowing — and [] for a helper who holds no books,
 * meaning none. The same [] was then read two opposite ways inside one call:
 *
 *   report_draw_ready's book filter    `!only || only.includes(id)`
 *                                      [] is truthy, includes() false -> NONE
 *   collectedByAgent's money queries    `agentIds && agentIds.length`
 *                                      [] has length 0 -> NO FILTER -> ALL
 *
 * So the books were scoped to nothing and the cash to everything, and the
 * difference between them was printed as a debt. The nonsense arithmetic and
 * the leak of the whole raffle's takings to a helper were the same bug.
 *
 * Apps Script never had it: it filters inline with the same expression in both
 * places, so [] means none on both sides. The divergence was introduced by
 * extracting the money helpers and adding a `.length` guard that read as
 * defensive.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const money = await loadModule('money.ts')

const world = () => fakeDb({
  config: baseConfig({}),
  // The sellers these ledger rows belong to. Postgres would not have let them
  // be absent — books.held_by_agent references agents — and the per-seller
  // money view is driven by that table, so a fixture without them describes a
  // raffle whose books are held by people who do not exist.
  agents: [
    { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
    { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
  ],
  book_ledger_all: [
    { idx: 1, number: 'Book-001', status: 'Settled', held_by_agent: 'A001', counted_collected: 90, counted_expected: 90, recorded_amount: 90 },
    { idx: 2, number: 'Book-002', status: 'Returned', held_by_agent: 'A002', counted_collected: 0, counted_expected: 20, recorded_amount: 20 },
  ],
  payments: [
    // 'hand', not 'handover': the column is checked against
    // ('hand','settlement','writeoff') and the database would refuse the row
    // this fixture used to describe. It passed because the sum asked for
    // "not settlement", which an invalid value satisfies as happily as a valid
    // one — so the fixture was testing that a row nobody can insert is counted.
    { id: 1, agent_id: 'A001', amount: 30, source: 'hand' },
    { id: 2, agent_id: 'A002', amount: 10, source: 'hand' },
  ],
})

console.log('an empty scope means NOTHING, not everything')
{
  const w = world()
  const none = await money.collectedByAgent(w.ctx, [])
  eq(none.size, 0, 'a helper holding no books is told about no money')
  eq([...none.values()].reduce((s, n) => s + n, 0), 0, 'and the sum is zero, not the raffle')
}

console.log('null still means the whole raffle, which is the organiser')
{
  const all = await money.collectedByAgent(world().ctx, null)
  eq(all.size, 2, 'both sellers are counted')
  eq([...all.values()].reduce((s, n) => s + n, 0), 130, '90 + 30 + 0 + 10')
}

console.log('a named scope is that seller and nobody else')
{
  const one = await money.collectedByAgent(world().ctx, ['A001'])
  eq(one.size, 1, 'one seller')
  eq(one.get('A001'), 120, 'their ledger figure plus their handovers')
  ok(!one.has('A002'), 'and not the other seller')
}

console.log('the two sentinels are genuinely different, which is the whole point')
{
  /*
   * The assertion that would have caught the original. [] and null must not
   * produce the same answer — if they ever do, the distinction has been lost
   * again and somebody will read one as the other.
   */
  const w = world()
  const empty = [...(await money.collectedByAgent(w.ctx, [])).values()].reduce((s, n) => s + n, 0)
  const everything = [...(await money.collectedByAgent(w.ctx, null)).values()].reduce((s, n) => s + n, 0)
  ok(empty !== everything, `[] (${empty}) and null (${everything}) mean different things`)
  eq(empty, 0, 'and empty is the one that means none')
}

const viewer = { ...users.recorder, email: 'v@x.com', role: 'viewer' }

console.log('scope names FOUR cases, because three of them were sharing a name')
{
  eq(money.moneyScope(users.admin), 'all', 'an organiser sees the raffle')
  eq(money.moneyScope(users.agent), 'mine', 'a seller sees their own line')
  eq(money.moneyScope({ ...users.recorder, agentId: 'A001' }), 'mine',
     'a helper who also carries books has a line of their own')
  eq(money.moneyScope(viewer), 'totals', 'a viewer sees the figures and no names')
  eq(money.moneyScope(users.recorder), 'recorded', 'a helper with no books sees what THEY wrote down')

  /*
   * THE ASSERTION THE OLD SHAPE COULD NOT MAKE. 'totals' was returned for a
   * viewer and for a helper alike, so one value drove two screens that want
   * opposite things — an auditor needs the raffle's money and no names, a
   * volunteer at a desk needs neither and is owed a record of their own
   * afternoon. Collapsing them again would restore a bug that reads as tidying.
   */
  ok(money.moneyScope(viewer) !== money.moneyScope(users.recorder),
     'a viewer and a helper are not the same screen')
}

console.log('whose name may I see is not whose money is in my total')
{
  /*
   * visibleAgents and totalsAgents AGREE on everybody except a viewer, which
   * is why one function did for both until a viewer's Money screen read zero.
   * Asserted as a disagreement rather than as two values, so a refactor that
   * points one at the other fails here rather than in front of an auditor.
   */
  eq(JSON.stringify(money.visibleAgents(viewer)), '[]', 'a viewer is told no names')
  eq(money.totalsAgents(viewer), null, 'and counts the whole raffle')
  ok(JSON.stringify(money.visibleAgents(viewer)) !== JSON.stringify(money.totalsAgents(viewer)),
     'the two questions have different answers for a viewer — that is the point of both')

  eq(money.totalsAgents(users.admin), null, 'an organiser counts everything')
  eq(JSON.stringify(money.totalsAgents(users.agent)), '["A001"]', 'a seller counts their own')
  eq(JSON.stringify(money.totalsAgents(users.recorder)), '[]',
     'and a helper counts nothing, because they are carrying nothing')
}

console.log('a role nobody has written yet lands on the floor, not the ceiling')
{
  /*
   * THE SAME READING QUESTION, ASKED OF A ROLE RATHER THAN A SCOPE.
   *
   * Every function here ends in an arm that catches whatever the named ones
   * did not — moneyScope's final ternary, and the `own ? [own] : []` that both
   * agent lists end on. A sixth role in app_users lands in those arms, and the
   * only thing standing between "lands there" and "reachable" is a CHECK
   * constraint in schema.sql. None of this code says it depends on that.
   *
   * The answers are already the safe ones. Nothing pinned them, which is the
   * whole point: reorder the ternary to `role === 'recorder' ? 'recorded' :
   * 'totals'` — a change that reads like tidying — and an unrecognised role is
   * handed the raffle's figures instead of its own empty desk record.
   *
   * 'recorded' is the FLOOR for money, not a middle. It shows what this person
   * wrote down and nothing of the raffle: no totals, no names, no debts. For
   * somebody who has written nothing down, it is an empty screen, which is the
   * correct amount to tell a role the system does not know.
   */
  const sixth = { ...users.recorder, email: 't@x.com', role: 'treasurer' }

  eq(money.moneyScope(sixth), 'recorded', 'an unrecognised role gets the floor')
  ok(money.moneyScope(sixth) !== 'totals',
     'and specifically NOT the raffle-wide figures, which is the arm next door')
  eq(JSON.stringify(money.totalsAgents(sixth)), '[]', 'none of the raffle\'s money is theirs')
  eq(JSON.stringify(money.visibleAgents(sixth)), '[]', 'and no seller may be named to them')
  ok(!money.showsSellerNames(money.moneyScope(sixth)), 'so no debt table either')
}

console.log('the debt table goes to two people, and a fourth scope did not change that')
{
  ok(money.showsSellerNames('all'), 'an organiser gets the rows')
  ok(money.showsSellerNames('mine'), 'and a seller gets their own')
  ok(!money.showsSellerNames('totals'), 'a viewer does not')
  ok(!money.showsSellerNames('recorded'), 'and neither does a helper')

  /*
   * SPELLED AS AN ALLOW-LIST, NOT AS `!== 'totals'`. Both screens wrote the
   * negative form by hand, and it was correct for exactly as long as there
   * were three scopes: the moment a fourth existed, a helper fell through to
   * the table branch and was handed every seller's debts. An unknown scope
   * must therefore be refused, not admitted.
   */
  ok(!money.showsSellerNames('something-added-later'),
     'an unrecognised scope is refused, so adding one cannot leak the table')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
