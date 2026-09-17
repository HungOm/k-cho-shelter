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

// ---------- the registry ----------

const ts = read('../supabase/functions/api/index.ts')

const tsStart = ts.indexOf('const REGISTRY')
const tsBody = ts.slice(tsStart, ts.indexOf('\n}', tsStart))
const supabase = new Map(
  [...tsBody.matchAll(/^\s{2}([a-z_]+):\s*\{(.*)$/gm)].map(m => [m[1], m[2]]))

ok(supabase.size > 25, `the registry parsed (${supabase.size} actions)`)

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


console.log('every action the client calls exists, unless the omission was written down')
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
