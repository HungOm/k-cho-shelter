/*
 * THE RESET KNOWS WHAT IT WOULD DESTROY, AND THE SCHEMA IS WHAT IT IS CHECKED
 * AGAINST.
 *
 * supabase/functions/api/resetplan.ts carries a hand-written copy of the
 * foreign-key graph, because an Edge Function cannot open schema.sql. A
 * hand-written copy of anything is a copy that goes out of date, and this one
 * goes out of date silently: a new table nobody classified does not throw, it
 * simply never gets emptied and the last raffle's rows sit inside the next one.
 * That already happened once — `money_entries` had no foreign key to anything,
 * so nothing refused, and the money journal would have carried over with the
 * figures quietly wrong (see tests/resetcovers).
 *
 * So this file is the link between the two. It parses schema.sql, derives the
 * graph, and fails on any difference in either direction. It also requires
 * every table to have a home, which is the check that catches the quiet case:
 * a table absent from the map is not assumed safe, it is a failure.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const P = await loadModule('../_shared/resetplan.ts')

/* ---------- the schema, read rather than remembered ---------- */

const sql = readFileSync(ROOT + 'supabase/schema.sql', 'utf8')
const TABLES = [...sql.matchAll(/create table if not exists ([a-z_]+)\s*\(([\s\S]*?)\n\);/g)]
  .map((m) => ({ name: m[1], body: m[2] }))

/* The `on delete` action is part of the edge, not decoration: restrict refuses,
 * cascade deletes the child too, set null keeps it and empties the link. A
 * graph that loses that distinction cannot tell "must go with it" from "is
 * merely affected". */
const action = (tail) => (tail.match(/on delete (set null|cascade|restrict)/) ?? [, 'restrict'])[1]
const REF = /references ([a-z_]+)\([a-z_]+\)((?:\s+on delete (?:set null|cascade|restrict))?)/g
const derived = []
for (const t of TABLES) {
  for (const m of t.body.matchAll(REF)) if (m[1] !== t.name) derived.push([t.name, m[1], action(m[2])])
}
/* Keys added later by `alter table` count the same as ones in the create. */
for (const m of sql.matchAll(new RegExp('alter table ([a-z_]+) add column[^;]*' + REF.source, 'g'))) {
  if (m[1] !== m[2]) derived.push([m[1], m[2], action(m[3])])
}

console.log('the schema was actually read')
ok(TABLES.length >= 15, `found the tables (${TABLES.length})`)
ok(derived.length >= 10, `found the foreign keys (${derived.length})`)

console.log('every table has a home, and only one')
{
  const seen = new Map()
  for (const f of P.FEATURES) {
    for (const t of f.tables) {
      if (seen.has(t)) fail++, console.log(`  FAIL ${t} is claimed by both ${seen.get(t)} and ${f.id}`)
      else { seen.set(t, f.id); pass++ }
    }
  }
  /*
   * THE CHECK THAT CATCHES THE QUIET FAILURE. A table nobody classified would
   * otherwise be a table the reset never empties — no error, nothing rolled
   * back, and the previous raffle's rows inside the new one.
   */
  for (const t of TABLES) {
    ok(P.featureOf(t.name) !== '', `${t.name} belongs to a feature — a new table must be classified, not defaulted`)
  }
  for (const [t, f] of seen) {
    ok(TABLES.some((x) => x.name === t), `${f} claims ${t}, which is a table that exists`)
  }
}

console.log('the declared foreign keys match the schema, both directions')
{
  const key = ([a, b, act]) => `${a} -> ${b} (${act})`
  const inSchema = new Set(derived.map(key))
  const declared = new Set(P.LINKS.map(key))

  for (const k of inSchema) ok(declared.has(k), `schema has ${k}; resetplan LINKS does not`)
  for (const k of declared) ok(inSchema.has(k), `resetplan LINKS has ${k}; the schema does not`)
  eq(declared.size, inSchema.size, 'the two graphs are the same size')
}

/* ---------- what the graph then means ---------- */

console.log('a foreign key pointing at a feature drags its owner in')
{
  /* winners -> tickets, so tickets cannot be emptied while winners remain. */
  const d = P.dragsIn('tickets').map((x) => x.feature)
  ok(d.includes('prizes'), 'resetting tickets also resets prizes, because winners point at tickets')
  ok(!d.includes('money'), 'but NOT money: payments.book_idx is set null, so no payment row is deleted')
  const sd = P.dragsIn('sellers').map((x) => x.feature)
  ok(sd.includes('money'), 'sellers drags money in — payments.agent_id is restrict')
  ok(sd.includes('checkins'), 'and the check-in reports, which cascade with an agent')
  ok(!sd.includes('access'), 'but NOT accounts: app_users.agent_id is set null and deletes nobody')
  for (const x of P.dragsIn('tickets')) ok(!!x.why && x.why.length > 20, `${x.feature} comes with a reason, not just a name`)
}

/*
 * THE FINDING THIS WHOLE FILE EXISTS FOR.
 *
 * Nothing in the schema points at `payments`, `config` or `ticket_codes`. Asked
 * only "does a foreign key reference this", all three answer no and all three
 * are the most dangerous single resets in the system. Money is two doors and
 * deleting one changes what every seller owes; settings hold the numbering the
 * printed tickets were issued under. Those edges have to be declared, because
 * Postgres does not know about them and never will.
 */
console.log('and a dependency with no foreign key behind it still counts')
{
  const fkOnly = new Set(derived.map(([, to]) => to))
  ok(!fkOnly.has('payments'), 'nothing in the schema points at payments')
  ok(!fkOnly.has('config'), 'nor at config')

  ok(!P.aloneIsSafe('money'), 'money is still not safe to reset on its own')
  ok(!P.aloneIsSafe('settings'), 'nor are the settings')
  const why = P.dragsIn('money')[0]?.why ?? ''
  ok(/owes/.test(why), 'and money says what it costs to get wrong')

  /* The ones that really are safe alone, so the rule is not just "refuse". */
  ok(P.aloneIsSafe('artwork'), 'the artwork can be reset by itself')
  ok(P.aloneIsSafe('approvals'), 'and so can pending approvals')
  ok(P.aloneIsSafe('checkins'), 'and the check-in reports')
}

console.log('some things are never offered here at all')
{
  ok(!P.RESETTABLE.includes('audit'), 'the audit log is not on the list')
  ok(!P.RESETTABLE.includes('access'), 'and neither are accounts and permissions')

  const plan = P.planFor(['audit', 'access', 'artwork'])
  ok(!plan.features.includes('audit'), 'asking for the audit log does not reset it')
  ok(!plan.features.includes('access'), 'nor accounts')
  ok(plan.features.includes('artwork'), 'and the rest of the selection still goes ahead')
  eq(plan.refused.length, 2, 'both refusals are reported rather than dropped')
  for (const r of plan.refused) ok(r.why.length > 40, `${r.feature} is refused with a reason somebody can act on`)
}

console.log('a selection says what it grew into before it happens')
{
  const plan = P.planFor(['tickets'])
  ok(plan.features.includes('tickets'), 'what was asked for is in it')
  ok(plan.features.includes('prizes'), 'and what it drags in')
  ok(plan.added.some((a) => a.feature === 'prizes'), 'listed separately as an addition')
  ok(!plan.added.some((a) => a.feature === 'tickets'), 'and what was asked for is not listed as one')

  /* Expansion is transitive: money drags tickets, tickets drags prizes. */
  const m = P.planFor(['money'])
  ok(m.features.includes('tickets'), 'money drags tickets in')
  ok(m.features.includes('prizes'), 'and tickets then drags prizes, through it')
}

console.log('rows come out children first, so nothing refuses halfway through')
{
  const plan = P.planFor(P.RESETTABLE)
  const at = new Map(plan.tables.map((t, i) => [t, i]))
  /* Only the edges that actually refuse impose an order. `set null` does not:
   * emptying books simply blanks payments.book_idx, whenever it happens. */
  for (const [from, to, act] of P.LINKS) {
    if (act === 'set null' || !at.has(from) || !at.has(to)) continue
    ok(at.get(from) < at.get(to), `${from} is emptied before ${to}, which it points at (${act})`)
  }
  for (const t of TABLES) {
    const f = P.featureOf(t.name)
    if (f && P.RESETTABLE.includes(f)) ok(at.has(t.name), `${t.name} is in the everything plan`)
  }
}

/*
 * AND THE THIRD LIST, WHICH NOTHING WAS CHECKING.
 *
 * There are two routes that empty this raffle and they keep separate lists of
 * what they may touch. supabase/reset.sql names its tables in `delete from`
 * lines, and tests/resetcovers has asked since it was written whether every
 * table created is on them. `app_reset`, the SQL function the APP calls, keeps
 * an allowlist built into itself — and nothing asked the same question of it.
 *
 * SO IT WENT OUT OF DATE IMMEDIATELY. `ticket_receipts` and
 * `ticket_receipt_items` arrived with the buyer's receipt, resetplan filed them
 * under `tickets`, and the allowlist had never heard of them. Ticking "Tickets,
 * books and codes" — the likeliest selection anybody makes — sent them to
 * app_reset, which refused: `app_reset refuses to empty ticket_receipt_items`.
 * The reset failed AFTER the counts had been read and the sentence typed back.
 *
 * It failed safely, because the allowlist is checked over the whole list before
 * anything is touched. That is the difference between this and the money_entries
 * case above, which succeeded and carried a raffle's journal into the next one.
 * A loud failure at the worst possible moment is still a failure, and this is
 * the check that would have found it in a test run instead.
 *
 * The EFFECTIVE definition is the last one in migration order, because these
 * are `create or replace` and a later migration wins. Reading only the first
 * would test a function the database no longer has.
 */
console.log('the SQL function the app calls will accept every table the plan sends it')
{
  const MIG = ROOT + 'supabase/migrations/'
  let allowed = null, definedIn = '', deletes = []
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(MIG + f, 'utf8')
    const m = sql.match(/create or replace function app_reset[\s\S]*?allowed constant text\[\] := array\[([\s\S]*?)\]/)
    if (!m) continue
    allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
    definedIn = f
    /*
     * Every delete the winning definition ISSUES — from the code, not from the
     * prose around it. The `--` lines are stripped first because this file's own
     * header quotes the unqualified statement it exists to explain, and without
     * this the migration that fixes the problem fails the test that describes
     * it. A scanner that cannot tell a statement from a sentence about one will
     * eventually read every comment as an instruction.
     */
    const code = sql.replace(/^\s*--.*$/gm, '')
    deletes = [...code.matchAll(/execute format\(\s*'(delete from [^']*)'/g)].map((x) => x[1])
  }

  /* A parse that quietly matches nothing passes everything below it. */
  ok(allowed !== null, 'app_reset\'s allowlist was found in the migrations')
  ok((allowed ?? []).length >= 15, `and read (${(allowed ?? []).length} tables, from ${definedIn})`)

  if (allowed) {
    const set = new Set(allowed)
    /* Every table the plan can put in front of it, for any selection anybody
     * can make from the screen. */
    const sendable = P.planFor(P.RESETTABLE).tables
    ok(sendable.length >= 15, `tables the screen can send (${sendable.length})`)
    for (const t of sendable) {
      ok(set.has(t),
         `app_reset accepts ${t} — the plan sends it, and a table missing here refuses the `
         + 'whole reset after the System Admin has typed the confirmation')
    }

    /*
     * AND THE OTHER DIRECTION, which is the refusal rather than the omission.
     * These three are deliberately not on it: they are how the person running
     * the reset gets back in, and the record that they ran it.
     */
    for (const t of ['app_users', 'permissions', 'audit_log']) {
      ok(!set.has(t), `app_reset refuses ${t} — reset.sql does that from a terminal, not a page`)
    }
    /*
     * THE DELETE SAYS WHICH ROWS IT MEANS.
     *
     * app_reset emptied its tables with `delete from <table>` and nothing after
     * it. An organiser typed the confirmation, pressed the button, and got
     * "DELETE requires a WHERE clause" with the raffle still full.
     *
     * WHAT RAISES IT IS STILL UNKNOWN. `safeupdate` was the first guess and is
     * measurably not installed, and an unqualified delete is allowed on that
     * database as both postgres and service_role. So this assertion is NOT
     * resting on a diagnosed cause — it rests on the narrower claim that a
     * statement which cannot say which rows it means is worth refusing anyway,
     * and that whatever raised the error once can raise it again.
     *
     * NOT `where true`. It is constant-folded away before the plan exists, so
     * it reads to the guard exactly like no clause at all and is refused
     * identically — which would look like a fix, pass a naive test, and fail in
     * production in the same way. `ctid is not null` survives planning as a
     * real qual and is true for every live row.
     *
     * Asserted on a POSITIVE COUNT first. A regex that quietly matches nothing
     * would make every line below it vacuous, which is the failure this file is
     * full of warnings about.
     */
    ok(deletes.length > 0, `app_reset's deletes were found (${deletes.length}, in ${definedIn})`)
    for (const d of deletes) {
      ok(/\swhere\s/.test(d), `"${d}" carries a where clause — a stack that guards deletes refuses one without`)
      ok(!/\swhere\s+true\s*$/i.test(d),
         `"${d}" does not rely on \`where true\`, which is folded away before the plan`)
    }

    for (const t of allowed) {
      const owner = P.featureOf(t)
      ok(owner !== '', `${t} is on the allowlist and belongs to a feature`)
      ok(P.RESETTABLE.includes(owner),
         `${t} is allowed and its feature (${owner}) is one the app offers`)
    }
  }
}

console.log('the printed-paper guard is declared where the tickets are')
{
  const tickets = P.FEATURES.find((f) => f.id === 'tickets')
  eq(tickets.guard, 'printed', 'tickets carry the guard about codes already on paper')
}

/*
 * AND THE ROWS THAT SURVIVE POINTING AT NOTHING.
 *
 * `payments.book_idx` is `set null`, so emptying the books keeps every payment
 * and blanks the book it was taken against. Nothing refuses, no row vanishes,
 * and a figure stops reconciling some weeks later. It is the quietest damage
 * this feature can do, so it is disclosed rather than discovered.
 */
console.log('what survives but comes out pointing at nothing is disclosed')
{
  const loose = P.loosens(['tickets'])
  ok(loose.some((l) => l.table === 'payments' && l.by === 'books'),
    'resetting the tickets says that payments lose the book they were taken against')
  for (const l of loose) ok(l.why.length > 30, `${l.table} comes with the sentence, not just the fact`)

  /* When both ends go, there is nothing to disclose — the rows are gone. */
  ok(!P.loosens(['tickets', 'money']).some((l) => l.table === 'payments'),
    'but not when the payments are going too')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
