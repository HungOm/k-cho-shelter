/*
 * The ledger's protocol: append only, idempotent, and threaded.
 *
 * WHAT A LEDGER IS FOR. Every ringgit that moves is one row — cash handed in, a
 * settlement, a write-off — and nothing corrects a row. A reversal is a new
 * entry pointing at the one it undoes, so a balance is a fold over the rows and
 * the arithmetic that produced it is still on the table afterwards. All of that
 * was already true. What was not true is that anything ENFORCED it: no handler
 * updated the table and no handler deleted from it, which held exactly as long
 * as nobody wrote the one that did. The SQL half of this file's subject —
 * update, delete and truncate all refused — is in supabase/test-functions.sh,
 * against real Postgres, because a fake that does not enforce constraints
 * cannot prove anything about them.
 *
 * WHAT IS HERE is the half the database cannot decide: whether the handler
 * treats a repeated attempt as a retry or as more money.
 *
 * THE RETRY IS THE WHOLE PROBLEM. A ticket sale is idempotent by nature — the
 * ticket number is the key, the version check makes a second attempt fail
 * loudly, and the sell screen reads back what landed. A payment has no natural
 * key: RM60 twice for one seller is indistinguishable from two genuine RM60
 * payments. And the app says, in as many words, "Checking what went through"
 * when a write times out — which is the sentence on the screen at the moment a
 * volunteer with one bar of signal presses the button again.
 *
 * So the caller names the attempt and a repeat of that name returns the row the
 * first one wrote. The two assertions that matter are that it does NOT write a
 * second row, and that it does not write a second AUDIT row either — a log that
 * grows an entry every time a phone retries reports one payment as four, which
 * is the same lie one layer along.
 *
 * AND A COLLISION THAT IS NOT A RETRY MUST STILL THROW. Reporting an unrelated
 * constraint failure as a successful replay is how this feature would quietly
 * start swallowing real faults.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  if (String(g) === String(w)) pass++
  else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) }
}

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const money = await loadModule('money.ts')
const D = await loadModule('deadlines.ts')

/*
 * ANCHORED ON THE APP'S OWN today(), NOT ON THIS MACHINE'S CLOCK.
 *
 * The obvious version of this helper — new Date(), setHours(0,0,0,0),
 * setDate(+n) — builds days in whatever timezone the runner happens to be in.
 * The app does not: deadlines.ts works in the raffle's zone, Asia/Singapore, so
 * that "today" means the day it is where the books are rather than the day it is
 * on the server. Those two agree on a laptop in Malaysia and disagree in CI,
 * which runs UTC — and for the eight hours after 16:00 UTC it is already
 * tomorrow where the raffle is, so every date built here lands a day out and the
 * grace-period arithmetic comes back off by one.
 *
 * THAT IS NOT HYPOTHETICAL AND IT COST A DAY'S DEPLOYS. On 2026-09-17 the Pages
 * workflow began failing at 16:43 UTC on `Run tests` and published nothing after
 * 14:12, while the same suite was green on every machine anybody checked it on.
 * Six commits sat on master looking deployed, including the fix for a seller
 * being refused their own book. The failure was not in any of them: this helper
 * had been fragile since it was written and had simply never been run in the
 * part of the day where it breaks.
 *
 * Deriving from D.today() means the test cannot disagree with the code about
 * what day it is, because it is asking the code.
 */
const day = (n) => {
  const [y, m, d] = D.today().split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const agents = [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true }]

/**
 * A database that answers the insert however the test wants.
 *
 * The fake database does not enforce unique indexes — it says so at the top of
 * itself — so the collision has to be handed to the handler rather than
 * provoked. What is being tested is what the handler DOES with a 23505, which
 * is exactly the part Postgres cannot answer.
 */
function dbThatSays(error, existingRow = { id: 77 }) {
  const inserted = []
  const q = {
    insert(row) { inserted.push(row); return { select: () => ({ maybeSingle: async () => ({ data: error ? null : { id: 42 }, error }) }) } },
    select() { return this },
    eq() { return this },
    maybeSingle: async () => ({ data: existingRow, error: null }),
  }
  return { inserted, ctx: { supabaseAdmin: { from: () => ({ ...q }) } } }
}

// ============ 1. the same attempt, named ============

console.log('1. an attempt with no name is just a payment')
{
  const w = dbThatSays(null)
  const r = await money.insertPayment(w.ctx, { agent_id: 'A001', amount: 60 }, '')
  eq(r.id, 42, 'the row it wrote')
  eq(r.replayed, 'false', 'nothing was replayed')
  eq(w.inserted[0].client_key, 'null',
     'and no key is stored — null, not an empty string, or the partial index ' +
     'would treat every keyless payment as the same attempt')
}

console.log('2. the same name twice is one payment')
{
  const w = dbThatSays({ code: '23505', message: 'duplicate key value violates unique constraint "payments_client_key_idx"' })
  const r = await money.insertPayment(w.ctx, { agent_id: 'A001', amount: 60 }, 'attempt-1')
  eq(r.replayed, 'true', 'the second one is a replay')
  eq(r.id, 77, 'and it comes back with the row the FIRST one wrote, not a new one')
}

console.log('3. a collision that is not the key still throws')
{
  const w = dbThatSays({ code: '23505', message: 'duplicate key value violates unique constraint "payments_settlement_book_idx"' })
  const err = await errOf(() => money.insertPayment(w.ctx, { agent_id: 'A001', amount: 60 }, 'attempt-1'))
  eq(err?.code, 'QUERY_FAILED',
     'a different constraint is a real fault and travels as one — reporting it as ' +
     'a successful replay is how this starts swallowing faults')

  const other = dbThatSays({ code: '42P01', message: 'relation "payments" does not exist' })
  eq(await codeOf(() => money.insertPayment(other.ctx, {}, 'attempt-1')), 'QUERY_FAILED',
     'and so is anything that is not a duplicate at all')
}

console.log('4. no key, no replay — the collision cannot be one')
{
  const w = dbThatSays({ code: '23505', message: 'duplicate key ... "payments_client_key_idx"' })
  eq(await codeOf(() => money.insertPayment(w.ctx, { agent_id: 'A001', amount: 60 }, '')),
     'QUERY_FAILED', 'without a key there is no attempt to have repeated')
}

// ============ 2. through the handler ============

console.log('5. a retried payment writes one row and one log line')
{
  const w = fakeDb({ config: baseConfig(), agents, books: [], payments: [] })

  const first = await money.recordPayment(
    { agentId: 'A001', amount: 60, clientKey: 'k-1' }, users.admin, w.ctx)
  eq(first.replayed, 'false', 'the first one is a payment')
  eq(w.table('payments').length, 1, 'one row')
  eq(w.table('payments')[0].client_key, 'k-1', 'carrying the name of the attempt')
  eq(w.table('audit_log').filter((a) => a.action === 'RECORD_PAYMENT').length, 1, 'and one log line')

  // The fake does not enforce the index, so this is the shape of the call
  // rather than the collision — the collision is tested above and in Postgres.
  const second = await money.recordPayment(
    { agentId: 'A001', amount: 60, clientKey: 'k-1' }, users.admin, w.ctx)
  eq(second.agentId, 'A001', 'a retry still answers')
  ok('replayed' in second,
     'and says which it was, so the screen can read "already recorded" rather ' +
     'than "recorded" to somebody deciding whether to count the cash again')
}

console.log('6. a reversal needs no key, because it already has one')
{
  const w = fakeDb({
    config: baseConfig(), agents, books: [],
    payments: [{ id: 1, agent_id: 'A001', amount: 60, source: 'hand', reverses: null, method: 'cash' }],
    book_ledger_all: [],
  })
  await money.reversePayment({ paymentId: 1, reason: 'wrong seller' }, users.admin, w.ctx)
  eq(await codeOf(() => money.reversePayment({ paymentId: 1, reason: 'again' }, users.admin, w.ctx)),
     'NOTHING_TO_DO',
     'the row it undoes is the natural key a plain payment does not have')
}

// ============ 3. the day selling stops ============

console.log('7. an organiser can now set the date they were being refused by')
{
  const w = fakeDb({ config: baseConfig({ DRAW_DATE: day(60), FINAL_DEADLINE: day(40) }), agents, books: [] })
  const r = await D.setSalesClose({ date: day(30) }, users.admin, w.ctx)
  eq(r.to, day(30), 'it is set')
  eq(w.config('SALES_CLOSE_DATE'), day(30), 'and stored where the refusal reads it')
  ok(w.table('audit_log').some((a) => a.action === 'SET_SALES_CLOSE'), 'and recorded')
}

console.log('8. closing sooner has to be typed back; opening up does not')
{
  const w = fakeDb({
    config: baseConfig({ DRAW_DATE: day(60), SALES_CLOSE_DATE: day(30) }), agents, books: [],
  })
  eq(await codeOf(() => D.setSalesClose({ date: day(10) }, users.admin, w.ctx)),
     'CONFIRM_REQUIRED', 'bringing it in stops selling for everybody')
  const okd = await D.setSalesClose({ date: day(10), confirm: day(10) }, users.admin, w.ctx)
  eq(okd.to, day(10), 'and goes through once it is')

  const later = await D.setSalesClose({ date: day(20) }, users.admin, w.ctx)
  eq(later.to, day(20), 'pushing it out needs no confirmation — nobody loses anything')
}

console.log('9. and the refusals name what is wrong with the date')
{
  const w = fakeDb({ config: baseConfig({ DRAW_DATE: day(60) }), agents, books: [] })
  eq(await codeOf(() => D.setSalesClose({ date: day(90) }, users.admin, w.ctx)),
     'AFTER_THE_DRAW', 'selling cannot close after the tickets are drawn')
  eq(await codeOf(() => D.setSalesClose({ date: 'the first' }, users.admin, w.ctx)),
     'BAD_DATE', 'and a date nobody can read is said so')
  eq(await codeOf(() => D.setSalesClose({}, users.admin, w.ctx)),
     'NO_CHANGE', 'clearing a date that is not set changes nothing')

  const past = fakeDb({ config: baseConfig({ DRAW_DATE: day(60) }), agents, books: [] })
  const err = await errOf(() => D.setSalesClose({ date: day(-1) }, users.admin, past.ctx))
  eq(err?.code, 'CONFIRM_REQUIRED', 'a date already gone would stop selling the moment it saved')
  ok(err?.details?.alreadyPast, 'and says that is why, rather than reusing the other sentence')
}

console.log('10. and it can be undone, which is what makes it safe to offer')
{
  const w = fakeDb({
    config: baseConfig({ DRAW_DATE: day(60), SALES_CLOSE_DATE: day(30) }), agents, books: [],
  })
  const r = await D.setSalesClose({}, users.admin, w.ctx)
  eq(r.cleared, 'true', 'cleared')
  eq(w.config('SALES_CLOSE_DATE'), '', 'and selling stays open')
}

// ============ 4. a role nobody has invented yet ============

console.log('11. an unrecognised role is the least of them, not the most')
{
  /*
   * THE READING QUESTION, pointed at the masker: which branch does an unknown
   * value land in? mask() asks viewer, then agent, then recorder, and returns
   * the row UNTOUCHED if none match — so a sixth role would have been handed
   * every buyer's name and full telephone number. Every "everything except"
   * bug found today fell the same way: the value nobody thought of landed on
   * the permissive side.
   *
   * Not reachable through the app — app_users.role carries a CHECK naming the
   * five values — which is the point. The guard was a constraint in a file, and
   * this is the same rule said in the code that depends on it.
   */
  const gate = await loadModule('gate.ts')
  const env = { get: () => '' }

  const odd = gate.resolveUser('x@y.z', { role: 'auditor', status: 'active' }, env)
  eq(odd.role, 'viewer', 'a role this code does not know becomes the floor')
  eq(odd.isAdmin, 'false', 'and carries none of the admin flag with it')

  const row = { book_idx: 1, buyer_name: 'Pa Thang', buyer_phone: '0123456789',
                buyer_zone: 'KL', notes: 'behind the market', recorded_by: 'rec@x.com' }
  const seen = gate.mask({ ...row }, odd)
  eq(seen.buyer_phone, '\u2022\u2022\u2022\u2022789',
     'so the masker shortens their number, which it would not have done for a role it fell through on')

  // The five that ARE recognised still resolve to themselves.
  for (const r of ['admin', 'recorder', 'agent', 'viewer']) {
    eq(gate.resolveUser('x@y.z', { role: r, status: 'active' }, env).role, r,
       `${r} is unchanged`)
  }
  eq(gate.resolveUser('x@y.z', { role: 'superadmin', status: 'active' }, env).role, 'admin',
     'and superadmin still resolves to admin plus the flag, which is not a fifth tier')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
