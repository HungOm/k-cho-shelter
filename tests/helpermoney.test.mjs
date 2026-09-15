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
  book_ledger_all: [
    { idx: 1, number: 'Book-001', status: 'Settled', held_by_agent: 'A001', counted_collected: 90, counted_expected: 90, recorded_amount: 90 },
    { idx: 2, number: 'Book-002', status: 'Returned', held_by_agent: 'A002', counted_collected: 0, counted_expected: 20, recorded_amount: 20 },
  ],
  payments: [
    { id: 1, agent_id: 'A001', amount: 30, source: 'handover' },
    { id: 2, agent_id: 'A002', amount: 10, source: 'handover' },
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

console.log('scope names the three cases, and a helper with no books is the third')
{
  eq(money.moneyScope(users.admin), 'all', 'an organiser sees the raffle')
  eq(money.moneyScope(users.agent), 'mine', 'a seller sees their own line')
  eq(money.moneyScope(users.recorder), 'totals', 'a helper with no books is neither')
  eq(money.moneyScope({ ...users.recorder, agentId: 'A001' }), 'mine',
     'but a helper who also carries books has a line of their own')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
