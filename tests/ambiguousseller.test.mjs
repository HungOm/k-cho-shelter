/*
 * Two sellers the app cannot tell apart.
 *
 * THIS RAFFLE HAS BOTH SHAPES, live. Two active sellers are both called JOHN
 * and share one telephone number; KUI and Thang ling share another. Neither is
 * necessarily a mistake — a household shares a handset, and two people can be
 * called JOHN — but the app was presenting the name as though it were an
 * identity, and that costs three things in order of when they hurt:
 *
 *   the outstanding list shows two JOHNs and you cannot tell whose debt you are
 *   chasing; the chase button reaches whoever answers that handset; and at the
 *   draw a winning ticket resolves to "JOHN" with no way to say which one sold
 *   it.
 *
 * NOT RESOLVED IN CODE, deliberately. Whether two rows are one person entered
 * twice or two people is a question about the world. Merging them would destroy
 * a distinction somebody may have meant, and inventing a rule ("same name and
 * phone means the same person") would be a guess dressed as a fix. The app's
 * job is to stop presenting an ambiguity as a fact, so an organiser can decide.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const people = await loadModule('people.ts')

/** The live raffle's own shape, plus one unambiguous seller and one retired. */
const world = () => fakeDb({
  config: baseConfig({}),
  books: [], check_in_reports: [],
  agents: [
    { agent_id: 'A001', name: 'JOHN', phone: '0123367462', zone: 'Saremban', active: true },
    { agent_id: 'A002', name: 'JOHN', phone: '0123367462', zone: 'Saremban2', active: true },
    { agent_id: 'A003', name: 'KUI', phone: '0172112613', zone: 'CCFM', active: true },
    { agent_id: 'A004', name: 'Thang ling', phone: '0172112613', zone: 'Pandah Indah', active: true },
    { agent_id: 'A005', name: 'Ma Nu', phone: '0125550100', zone: 'KL', active: true },
    { agent_id: 'A006', name: 'JOHN', phone: '0123367462', zone: 'Old', active: false },
  ],
})
const listed = async () => {
  const r = await people.listAgents({}, users.admin, world().ctx)
  return Object.fromEntries(r.agents.map((a) => [a.id, a]))
}

console.log('two sellers with the same name are both marked')
{
  const a = await listed()
  ok(a.A001.sharesName, 'the first JOHN')
  ok(a.A002.sharesName, 'and the second')
  ok(!a.A005.sharesName, 'while a seller with her own name is not')
}

console.log('two sellers on one handset are both marked, even with different names')
{
  const a = await listed()
  ok(a.A003.sharesPhone, 'KUI shares a number')
  ok(a.A004.sharesPhone, 'and so does Thang ling')
  ok(!a.A003.sharesName, 'but their NAMES are their own — the two problems are different')
  ok(!a.A005.sharesPhone, 'and an unshared number is not flagged')
}

console.log('a retired duplicate is history, not a confusion')
{
  /*
   * A006 is an inactive JOHN on the same number. Counting it would mark A001
   * and A002 as sharing with somebody nobody can hand a book to — and a flag
   * that fires on things that do not matter is a flag people learn to ignore.
   */
  const r = await people.listAgents({}, users.admin, world().ctx)
  const six = r.agents.find((x) => x.id === 'A006')
  ok(six, 'the retired seller is still listed')
  ok(!six.active, 'and still shows as retired')

  // A005 stands alone among the ACTIVE sellers and must stay unflagged.
  const a = Object.fromEntries(r.agents.map((x) => [x.id, x]))
  ok(!a.A005.sharesName && !a.A005.sharesPhone, 'the unambiguous seller stays unflagged')

  /*
   * THE CASE THAT ACTUALLY PROVES IT, added because the first version did not.
   * A005 being unflagged passes whether or not retired sellers are counted,
   * because A001 and A002 duplicate each other anyway. The test that bites is a
   * seller whose ONLY namesake is retired: counting the retired one flags a
   * person who is not ambiguous with anybody you can hand a book to.
   */
  const w = fakeDb({
    config: baseConfig({}), books: [], check_in_reports: [],
    agents: [
      { agent_id: 'C1', name: 'Solo', phone: '0125550001', zone: 'KL', active: true },
      { agent_id: 'C2', name: 'Solo', phone: '0125550001', zone: 'Old', active: false },
    ],
  })
  const only = (await people.listAgents({}, users.admin, w.ctx)).agents.find((x) => x.id === 'C1')
  ok(!only.sharesName, 'a namesake who has retired does not make somebody ambiguous')
  ok(!only.sharesPhone, 'nor a number only a retired seller also had')
}

console.log('a blank number is not a shared number')
{
  /*
   * NOT INDEPENDENTLY TESTABLE, and saying so rather than pretending. The
   * handler guards this twice — the tally skips empty keys, and the row check
   * tests for '' as well — so removing the second guard changes no behaviour and
   * no mutant can catch it. That is dead code shaped exactly like a guard: the
   * evidence that it does nothing is that removing it does nothing.
   *
   * It stays because the tally's skip is the load-bearing one and could be
   * refactored away by somebody who does not know it is. The assertion below
   * covers the BEHAVIOUR, which is what matters; the redundancy is documented
   * rather than defended.
   */
  const w = fakeDb({
    config: baseConfig({}), books: [], check_in_reports: [],
    agents: [
      { agent_id: 'B1', name: 'One', phone: '', zone: '', active: true },
      { agent_id: 'B2', name: 'Two', phone: '', zone: '', active: true },
    ],
  })
  const r = await people.listAgents({}, users.admin, w.ctx)
  for (const a of r.agents) ok(!a.sharesPhone, `${a.name} has no number, so shares none`)
}

console.log('the flag is a fact about the list, not a judgement')
{
  // Nothing is merged, nothing is hidden, nothing is renamed. Six in, six out.
  const r = await people.listAgents({}, users.admin, world().ctx)
  eq(r.agents.length, 6, 'every seller is still listed')
  eq(r.agents.filter((a) => a.name === 'JOHN').length, 3, 'all three JOHNs survive')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
