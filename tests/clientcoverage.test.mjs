/*
 * Does every call the CLIENT makes reach a real action — and is every write
 * treated as one?
 *
 * portparity.test.mjs compares the two registries to each other, which catches
 * an action ported to one backend and not the other. It cannot see the third
 * party: the app. An action can be absent from BOTH registries and still be
 * called from a modal every day, and registry-to-registry parity stays green
 * because the two sides agree about nothing.
 *
 * That is not hypothetical. handover_receipt, expand_tickets and
 * set_active_tickets were each called from a modal while the Supabase function
 * had no handler, and set_ticket_ceiling sat in supabaseApi.js's write list
 * with no handler and no caller anywhere.
 *
 * THE SECOND HALF matters more than it looks. supabaseApi.js decides from a
 * hardcoded list whether a call is a write, and that decision picks the timeout
 * and the wording on failure. A write missing from that list is given the read
 * timeout and told "The server did not answer in time. Try again." instead of
 * WRITE_UNCONFIRMED and "Checking what went through…". The first sentence asks
 * a volunteer to re-enter a sale that may already be recorded. That is the
 * mistake that doubles an entry, so the list is checked against the registry
 * rather than maintained by memory.
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const here = new URL('.', import.meta.url).pathname
const read = p => readFileSync(join(here, p), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// ---------- what the client calls ----------

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e)) out.push(p)
  }
  return out
}

const calls = new Map()          // action -> the files that call it
for (const file of walk(join(here, '../src'))) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\bapi\(\s*'([a-z_]+)'/g)) {
    if (!calls.has(m[1])) calls.set(m[1], [])
    calls.get(m[1]).push(file.slice(file.indexOf('/src/') + 1))
  }
}

ok(calls.size > 25, `found the client's calls (${calls.size} distinct actions)`)

// ---------- the two registries ----------

const gs = read('../apps_script/Api.gs')
const ts = read('../supabase/functions/api/index.ts')

const gsBody = gs.slice(gs.indexOf('function actionRegistry()'), gs.indexOf('function actionMeta'))
const appsScript = new Set([...gsBody.matchAll(/^\s{4}([a-z_]+):\s*\{\s*fn:/gm)].map(m => m[1]))

const tsStart = ts.indexOf('const REGISTRY')
const tsBody = ts.slice(tsStart, ts.indexOf('\n}', tsStart))
const supabase = new Map(
  [...tsBody.matchAll(/^\s{2}([a-z_]+):\s*\{(.*)$/gm)].map(m => [m[1], m[2]]))

ok(appsScript.size > 25, `Apps Script registry parsed (${appsScript.size})`)
ok(supabase.size > 25, `Supabase registry parsed (${supabase.size})`)

/*
 * Calls the client makes that one backend deliberately does not answer.
 *
 * A reason, not a silence: "not ported" and "nobody noticed" look identical
 * from outside, and this list is what tells them apart. A stale entry fails
 * below, so the list cannot quietly outlive the decision it records.
 */
const CLIENT_EXEMPT = new Map([
  ['ping', 'Apps Script boot only — the edge function is auth:user, so the ' +
           'Supabase path skips the pre-flight rather than pinging it'],
])

/*
 * Actions the client calls that the SPREADSHEET backend does not have.
 *
 * This direction had no exemption at all, and the rule it replaces — every
 * action a screen calls exists on both backends — was right while the two were
 * meant to be interchangeable. The migration has since produced features that
 * genuinely cannot exist in a spreadsheet: a table nothing can rewrite, and a
 * record of whose word a confirmation is.
 *
 * SO THE BAR MOVES RATHER THAN DROPS. A screen may call a Supabase-only action
 * if it is listed here with a reason AND the file that calls it reads
 * isSupabase — asserted below, not promised. Without that second half this
 * list would be a way to make a screen break quietly on the other backend by
 * writing a sentence about it: the volunteer gets an unknown-action error,
 * which reads as the app being broken rather than as a feature the backend
 * does not have.
 */
const SUPABASE_ONLY = new Map([
  ['acknowledge_books',
   'recording whose word a confirmation is — the seller\'s own tap against an ' +
   'organiser typing that they saw a signed paper — needs a row nobody can edit ' +
   'afterwards, which a sheet anybody with the link can open has nowhere to put'],
  ['acknowledged_books',
   'reads back what acknowledge_books writes, and there is nothing to read on a ' +
   'backend that cannot write it'],
])

console.log('every action the client calls exists on Apps Script')
for (const [action, where] of calls) {
  if (appsScript.has(action)) { pass++; continue }
  const why = SUPABASE_ONLY.get(action)
  ok(!!why, `${action} — called from ${where[0]}, not in the Apps Script registry and no reason given`)
}

console.log('and a screen that calls one knows which backend it is on')
for (const [action, why] of SUPABASE_ONLY) {
  ok(why.length > 20, `${action}'s exemption gives an actual reason`)
  ok(!appsScript.has(action), `${action} is exempt but Apps Script now has it — delete the exemption`)
  ok(calls.has(action), `${action} is exempt but nothing calls it — a stale exemption`)
  for (const file of calls.get(action) ?? []) {
    const src = read('../' + file)
    ok(/isSupabase/.test(src),
       `${file} calls ${action} and reads isSupabase — otherwise it shows a volunteer ` +
       'an unknown-action error and reads as the app being broken')
  }
}

console.log('…and on Supabase, unless the omission was written down')
for (const [action, where] of calls) {
  if (supabase.has(action)) { pass++; continue }
  const why = CLIENT_EXEMPT.get(action)
  ok(!!why, `${action} — called from ${where[0]}, no Supabase handler and no recorded reason`)
}

console.log('and no exemption outlives the decision it records')
for (const [action, why] of CLIENT_EXEMPT) {
  ok(why.length > 20, `${action}'s exemption gives an actual reason`)
  ok(calls.has(action), `${action} is still called by the client — a stale exemption`)
  ok(!supabase.has(action),
     `${action} is exempt but Supabase now implements it — delete the exemption`)
}

// ---------- writes are known to be writes ----------

const apiSrc = read('../src/lib/supabaseApi.js')
const listed = new Set(
  [...apiSrc.slice(apiSrc.indexOf('const WRITES'), apiSrc.indexOf('])', apiSrc.indexOf('const WRITES')))
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]))

ok(listed.size > 15, `supabaseApi's write list parsed (${listed.size} actions)`)

console.log('every mutating action is on the write list')
for (const [action, spec] of supabase) {
  const mutates = /kind:\s*'(write|bulk)'/.test(spec)
  if (!mutates) continue
  ok(listed.has(action),
     `${action} mutates but is missing from WRITES — it would get the read ` +
     `timeout and be reported as failed after succeeding`)
}

console.log('and nothing on the write list is a read or a ghost')
for (const action of listed) {
  const spec = supabase.get(action)
  ok(spec !== undefined, `${action} is on the write list but no Supabase action answers to it`)
  if (spec !== undefined) {
    ok(/kind:\s*'(write|bulk)'/.test(spec),
       `${action} is on the write list but the registry calls it a read`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
