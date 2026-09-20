/*
 * THE SEED KNOWS WHAT IT WOULD MAKE, AND IT KNOWS WHEN NOT TO.
 *
 * Two claims, and the second is the one with teeth.
 *
 * WHAT IT WOULD MAKE. _shared/seedplan.ts walks the same foreign-key graph the
 * reset walks, in the other direction: the edge that makes `payments` come out
 * before `agents` is the edge that makes agents go in before payments. Two
 * hand-written traversals of one graph is exactly the shape that drifts apart,
 * so this asserts the reflection edge by edge rather than trusting that both
 * authors read the same table the same way.
 *
 * WHEN NOT TO. A seed is a feature that writes sample sellers and sample money
 * into a database, and the failure it can cause is not "the demo looked thin".
 * It is sample sellers appearing in a raffle somebody is running — in the chase
 * list, in the outstanding column, in a report an organiser reads out. The
 * three counts in seed.ts are what stop that, and each is stated as a claim
 * about the set that is ALLOWED to pass rather than about the set to keep out:
 * nothing has been printed, every sold ticket was recorded by the seed, every
 * payment was recorded by the seed. "Everything except X" is the shape that put
 * three defects in this repository in one day (supabase/AUDIT.md §X), and the
 * only thing that catches it is an assertion on a value nobody thought of — so
 * the cases below include a raffle whose only sale WAS the seed's, which is the
 * value a naive "is anything sold" check gets wrong.
 *
 * AND ANYTHING THE SEED MAKES, THE RESET CAN REMOVE. Every table in a `writes`
 * list must belong to a RESETTABLE feature in resetplan.ts. Without that the
 * seed could leave rows behind that the only cleanup route in the app cannot
 * reach — demo data in a raffle about to go live, with no button that takes it
 * out. It is the cheapest assertion here and the one with the worst failure.
 *
 * WHAT THIS CANNOT DO. It cannot watch a book being sold through. tests/fakedb
 * stubs the `sell_books` SQL function to `{ sold: 0 }` on purpose — the
 * arithmetic and the transaction are proven against real Postgres in
 * supabase/test-functions.sh, and a fake that reimplemented them would be a
 * second copy to keep true. So the selling step is driven here through a
 * recorded stand-in that reports what the seed ASKED the database to do, which
 * proves the orchestration — which book, held by whom, sold to whom — and
 * proves nothing about the SQL. The SQL is somebody else's suite.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const S = await loadModule('../_shared/seedplan.ts')
const R = await loadModule('../_shared/resetplan.ts')
const seed = await loadModule('seed.ts')

/* ---------- 1. the declaration ---------- */

console.log('the two files were actually read')
ok(S.SEEDS.length >= 8, `features classified (${S.SEEDS.length})`)
ok(S.SEEDABLE.length >= 3, `features the seed offers (${S.SEEDABLE.join(', ')})`)
ok(S.SIZES.length >= 2, `sizes offered (${S.SIZES.length})`)

console.log('every feature has a decision, and a new one cannot default into being offered')
{
  /*
   * THE QUIET FAILURE, and it is the mirror of the one resetplan guards. A
   * feature nobody classified here is a feature the screen silently does not
   * offer — no error, no refusal shown, just a row missing from a list nobody
   * counts. resetplan makes the same demand of tables; this makes it of
   * features, because that is the unit this file deals in.
   */
  for (const f of R.FEATURES) {
    ok(S.SEEDS.some((s) => s.id === f.id),
       `${f.id} is classified in seedplan — a new feature must be decided about, not defaulted`)
  }
  for (const s of S.SEEDS) {
    ok(R.FEATURES.some((f) => f.id === s.id), `seedplan's ${s.id} is a feature that exists`)
    ok(!!s.never || !!s.makes, `${s.id} either says what it makes or says why it does not`)
    if (s.never) ok(s.never.length > 60, `${s.id} is refused with a reason somebody can act on`)
    if (!s.never) ok(s.writes.length > 0, `${s.id} is offered, so it writes something`)
  }
}

console.log('anything the seed makes, the reset can remove')
{
  /*
   * The assertion with the worst failure behind it. A table the seed fills that
   * no resettable feature owns is demo data with no way out of the database
   * except a terminal — found by whoever is trying to take the raffle live.
   */
  let checked = 0
  for (const s of S.SEEDS) {
    for (const t of s.writes) {
      const owner = R.featureOf(t)
      ok(owner !== '', `${t} belongs to a feature, so the reset knows about it`)
      ok(R.RESETTABLE.includes(owner),
         `${t} is owned by ${owner}, which the reset offers — otherwise the seed could `
         + 'leave rows the app has no way to take out')
      ok(owner === s.id, `${t} is written by the same feature that owns it (${owner})`)
      checked++
    }
  }
  ok(checked >= 4, `tables the seed writes were actually checked (${checked})`)
}

console.log('the requirement graph is the reset graph, read backwards')
{
  /*
   * ONE EDGE, TWO READINGS. `payments.agent_id references agents on delete
   * restrict` means the reset cannot empty agents while payments point at them,
   * AND means the seed cannot make a payment before the agent exists. If the
   * two functions ever disagree about an edge, one of them is wrong about the
   * database.
   */
  let seenBoth = 0
  for (const [from, to, act] of R.LINKS) {
    if (act === 'set null') continue
    const child = S.SEEDS.find((s) => s.writes.includes(from))
    if (!child) continue
    const parent = R.featureOf(to)
    if (!parent || parent === child.id) continue

    ok(S.needsFor(child.id).some((n) => n.feature === parent),
       `${child.id} needs ${parent} first, because every ${from} row names a ${to} row`)
    ok(R.dragsIn(parent).some((d) => d.feature === child.id),
       `and resetting ${parent} drags ${child.id} with it — the same edge from the other end`)
    seenBoth++
  }
  ok(seenBoth >= 1, `hard edges reflected in both directions (${seenBoth})`)

  /* And the edge that is NOT a requirement, so the rule is not simply "yes". */
  ok(!S.needsFor('tickets').some((n) => n.feature === 'money'),
     'tickets does not need money: payments.book_idx is set null and a book can exist unpaid')
}

console.log('a selection grows to what it needs, parents before children')
{
  const p = S.seedPlanFor(['money'])
  ok(p.features.includes('money'), 'what was asked for is in it')
  ok(p.features.includes('sellers'), 'and the sellers a payment names')
  ok(p.features.includes('tickets'), 'and the tickets that make the figure mean something')
  ok(p.added.some((a) => a.feature === 'sellers'), 'listed separately as an addition')
  ok(!p.added.some((a) => a.feature === 'money'), 'and what was asked for is not listed as one')
  for (const a of p.added) ok(a.why.length > 40, `${a.feature} comes with a reason, not just a name`)

  const at = (id) => p.features.indexOf(id)
  ok(at('sellers') < at('tickets'), 'sellers are made before the books they carry')
  ok(at('tickets') < at('money'), 'and the tickets before the money taken for them')
}

console.log('some things the seed will not invent, and says so')
{
  ok(!S.SEEDABLE.includes('access'), 'not accounts')
  ok(!S.SEEDABLE.includes('audit'), 'not the audit log')
  ok(!S.SEEDABLE.includes('approvals'), 'not a queue of requests nobody made')
  ok(!S.SEEDABLE.includes('settings'), 'not the numbering tickets are issued under')

  const p = S.seedPlanFor(['access', 'audit', 'prizes'])
  ok(!p.features.includes('access'), 'asking for accounts does not make any')
  ok(p.features.includes('prizes'), 'and the rest of the selection still goes ahead')
  eq(p.refused.length, 2, 'both refusals are reported rather than dropped')
}

console.log('the sample content is sample, and there is enough of it')
{
  const biggest = S.SIZES.reduce((m, s) => Math.max(m, s.sellers), 0)
  ok(S.SAMPLE_SELLERS.length >= biggest,
     `the seller list covers the largest size (${S.SAMPLE_SELLERS.length} for ${biggest})`)
  ok(S.SAMPLE_BUYERS.length >= 4, `there are buyers (${S.SAMPLE_BUYERS.length})`)
  ok(S.SAMPLE_PRIZES.length >= 3, `there are prizes (${S.SAMPLE_PRIZES.length})`)

  /*
   * A DEMONSTRATION FULL OF PLAUSIBLE PHONE NUMBERS IS A LIST SOMEBODY RINGS.
   * 09 is the real Myanmar prefix so the column still sorts and reads like the
   * real thing; the body is zeros, which is what says "placeholder" to a person
   * looking at it.
   */
  const phones = S.SAMPLE_SELLERS.map((_, i) => S.sellerPhone(i))
    .concat(S.SAMPLE_BUYERS.map((b) => b.phone))
  for (const t of phones) ok(/^090{6}\d\d$/.test(t), `${t} is a placeholder nobody can ring`)
  eq(new Set(phones).size, phones.length, 'and no two of them are the same')

  ok(/\.invalid$/.test(S.SEED_EMAIL),
     `${S.SEED_EMAIL} is in a reserved domain, so no real person can ever hold it`)

  /* The prize types are the ones schema.sql ships, so a fresh install has them. */
  for (const z of S.SAMPLE_PRIZES) {
    ok(['cash', 'goods', 'voucher', 'pot_share'].includes(z.typeId),
       `the ${z.tier} uses a built-in prize type (${z.typeId})`)
  }
  ok(!S.SEEDS.find((s) => s.id === 'prizes').writes.includes('prize_types'),
     'and prize_types is not written, because every install already has it')
}

/* ---------- 2. the guards, against a database ---------- */

const CONFIG = () => baseConfig({ TOTAL_TICKETS: '0', ACTIVE_TICKETS: '0', TICKET_CEILING: '20000' })
const TYPES = [{ type_id: 'goods', label: 'Donated goods', valuing: 'fixed', sort: 20, active: true, built_in: true }]

const fresh = (over = {}) => fakeDb({ config: CONFIG(), prize_types: TYPES, ...over })

/** A sold ticket, credited to somebody, recorded by whoever is named. */
const soldBy = (recorder) => ({
  idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold',
  buyer_name: 'Ma Nu', buyer_phone: '0125550100', buyer_zone: '', amount: 10,
  sold_by_agent: 'A001', payment_status: '', sold_at: null, notes: '', source: '',
  version: 1, recorded_by: recorder, modified_at: new Date().toISOString(),
})

console.log('only the system admin, whatever the registry lets through')
{
  const w = fresh()
  eq(await codeOf(() => seed.seedPreview({ features: ['prizes'] }, users.admin, w.ctx)),
     'SUPER_ADMIN_ONLY', 'an ordinary admin cannot even count what it would make')
  eq(await codeOf(() => seed.seedApply({ features: ['prizes'] }, users.recorder, w.ctx)),
     'SUPER_ADMIN_ONLY', 'nor a recorder fill anything')
}

console.log('a raffle somebody is using never takes sample data')
{
  const sold = fresh({ tickets: [soldBy('rec@x.com')] })
  const pre = await seed.seedPreview({ features: ['prizes'] }, users.boss, sold.ctx)
  ok(pre.inUse, 'a ticket sold by a person makes the raffle in use')
  ok(pre.inUseWhy.join(' ').includes('not by the seed'), 'and the sentence says why')
  eq(await codeOf(() => seed.seedApply(
       { features: ['prizes'], size: 'small', phrase: pre.phrase }, users.boss, sold.ctx)),
     'RAFFLE_IN_USE', 'and a correct phrase does not get past it')
  eq(sold.db.tables.prizes.length, 0, 'nothing was written')

  const paid = fresh({
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '09', zone: '', active: true, notes: '' }],
    payments: [{ id: 1, agent_id: 'A001', amount: 10, received_by: 'rec@x.com', method: 'cash',
                 note: '', source: 'hand', received_at: new Date().toISOString() }],
  })
  ok((await seed.seedPreview({ features: ['prizes'] }, users.boss, paid.ctx)).inUse,
     'money recorded by a person does the same')

  const printed = fresh({
    ticket_codes: [{ ticket_idx: 1, code: 'ABC', printed_at: new Date().toISOString() }],
  })
  ok((await seed.seedPreview({ features: ['prizes'] }, users.boss, printed.ctx)).inUse,
     'and so does a ticket already on paper, whoever printed it')
}

console.log('but the seed’s own work does not lock it out of finishing')
{
  /*
   * THE CASE A NAIVE GUARD GETS WRONG, and the reason the claim is stated as
   * "every sale was the seed's" rather than "nothing is sold". Fill the sellers
   * and the tickets today, come back for the money tomorrow: the raffle now
   * contains sales, and a check that asked "is anything sold" would refuse the
   * second half of the seed's own job and give no way to finish it.
   */
  const w = fresh({ tickets: [soldBy(S.SEED_EMAIL)] })
  const pre = await seed.seedPreview({ features: ['prizes'] }, users.boss, w.ctx)
  ok(!pre.inUse, 'a raffle whose only sale was the seed’s is still seedable')
  ok(pre.total > 0, 'and there is something to make')
}

console.log('what is already there is left alone, and still counts as there')
{
  /*
   * ALREADY IS NOT REFUSED. Somebody who generated their tickets by hand and
   * now wants sample sellers should get them — `money` needed the tickets to
   * EXIST, not to have been made by us. Collapsing the two answers would tell
   * that person the seed did not work.
   */
  const w = fresh({
    agents: [{ agent_id: 'A001', name: 'Real Person', phone: '09', zone: '', active: true, notes: '' }],
  })
  const pre = await seed.seedPreview({ features: ['sellers', 'prizes'] }, users.boss, w.ctx)
  ok(pre.already.some((a) => a.id === 'sellers'), 'the sellers are reported as already there')
  ok(!pre.refused.some((r) => r.id === 'sellers'), 'and not as a refusal')
  ok(pre.willFill.some((f) => f.id === 'prizes'), 'while the rest is still filled')
  ok(!pre.makes.agents, 'no sellers are counted into what would be made')

  const all = fresh({
    prizes: [{ prize_id: 'p1', tier: 'First', name: 'Bike', type_id: 'goods', quantity: 1,
               value_amount: 1, rank: 1, active: true, removed_at: null }],
  })
  eq(await codeOf(() => seed.seedApply({ features: ['prizes'], phrase: 'X' }, users.boss, all.ctx)),
     'NOTHING_TO_FILL', 'and when everything chosen is already there, it says so')
}

console.log('the sentence has to be typed, and it names what would be made')
{
  const w = fresh()
  const pre = await seed.seedPreview({ features: ['prizes'] }, users.boss, w.ctx)
  ok(/^FILL \d+ /.test(pre.phrase), `the phrase says what it makes: ${pre.phrase}`)
  eq(await codeOf(() => seed.seedApply(
       { features: ['prizes'], phrase: 'FILL EVERYTHING' }, users.boss, w.ctx)),
     'CONFIRM_MISMATCH', 'a phrase that is not the generated one refuses')
  eq(w.db.tables.prizes.length, 0, 'and writes nothing on the way out')
  eq(await codeOf(() => seed.seedApply({ features: [] }, users.boss, w.ctx)),
     'NOTHING_SELECTED', 'nothing ticked is its own refusal')
}

console.log('and when it runs, the rows are made by the app and marked as the seed’s')
{
  const w = fresh()

  /*
   * The stand-in for `sell_books`, described in this file's header. It reports
   * what the seed asked for and then makes the rows the real function would, so
   * the money step downstream has something true to read. It replaces the
   * fake's own stub for this test only.
   */
  const asked = []
  const realRpc = w.ctx.supabaseAdmin.rpc.bind(w.ctx.supabaseAdmin)
  w.ctx.supabaseAdmin.rpc = (fn, args) => {
    if (fn !== 'sell_books') return realRpc(fn, args)
    asked.push(args)
    const numbers = args.p_book_numbers ?? []
    const idxs = w.db.tables.books.filter((b) => numbers.includes(b.number)).map((b) => b.idx)
    const hit = w.db.tables.tickets.filter((t) => idxs.includes(t.book_idx) && t.status === 'Available')
    for (const t of hit) Object.assign(t, {
      status: 'Sold', buyer_name: args.p_buyer_name, buyer_phone: args.p_buyer_phone,
      sold_by_agent: args.p_sold_by, amount: 10, recorded_by: args.p_user,
    })
    return Promise.resolve({ data: { sold: hit.length, amount: hit.length * 10, skipped: [], books: numbers }, error: null })
  }

  const pre = await seed.seedPreview({ features: ['money'], size: 'small' }, users.boss, w.ctx)
  const out = await seed.seedApply(
    { features: ['money'], size: 'small', phrase: pre.phrase }, users.boss, w.ctx)

  ok(w.db.tables.agents.length > 0, `sellers were made (${w.db.tables.agents.length})`)
  ok(w.db.tables.tickets.length > 0, `tickets were made (${w.db.tables.tickets.length})`)
  ok(w.db.tables.books.some((b) => b.held_by_agent), 'and some books are out with somebody')
  ok(asked.length > 0, `books were sold through the app’s own sale (${asked.length})`)
  ok(w.db.tables.payments.length > 0, `money came back in (${w.db.tables.payments.length})`)

  /* The orchestration, which is the part this level can actually see. */
  for (const a of asked) {
    const held = w.db.tables.books.find((b) => (a.p_book_numbers ?? []).includes(b.number))
    ok(!!held, 'the seed sold a book that exists')
    eq(a.p_sold_by, held?.held_by_agent, 'credited to the seller who is carrying it')
    ok(/^09\d{8}$/.test(String(a.p_buyer_phone)), 'with a buyer who has a phone number')
  }

  /*
   * THE MARK. Every row carries the seed's address rather than the System
   * Admin's, which is the whole mechanism behind the guard above — and it needs
   * no column and no migration.
   */
  for (const t of w.db.tables.tickets) {
    eq(t.recorded_by, S.SEED_EMAIL, `${t.number} is recorded as the seed’s`)
  }
  for (const p of w.db.tables.payments) {
    eq(p.received_by, S.SEED_EMAIL, 'the payment is recorded as the seed’s')
  }

  /* And the audit row names the person, because that is a different question. */
  const row = w.db.tables.audit_log.find((r) => r.action === 'RAFFLE_SEEDED')
  ok(!!row, 'the seed is in the audit log')
  eq(row?.email, users.boss.email, 'named against the system admin who ran it, not the seed')

  ok(out.made.some((m) => m.what === 'sellers'), 'and it reports what it made')

  /* Run twice: the second says there is nothing left rather than doubling it. */
  const again = await seed.seedPreview({ features: ['money'], size: 'small' }, users.boss, w.ctx)
  ok(!again.inUse, 'the raffle it just filled is still not "in use"')
  ok(again.already.length > 0, 'and everything it made is reported as already there')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
