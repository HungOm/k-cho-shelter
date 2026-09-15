/*
 * Every place the app offers to message somebody, checked together.
 *
 * Money was fixed alone and three siblings were left: the seller reminder and
 * the overdue-book reminder on Agents, and the handover receipt. All four build
 * a wa.me link from a stored phone, and four of this raffle's sellers have
 * numbers whose leading zero was lost — so all four were producing links that
 * reached a stranger and looked exactly like links that work.
 *
 * Enumerated from the source rather than listed by hand: a fifth contact point
 * added tomorrow joins this test by existing, which a hand-kept list would not
 * do. The guard being right in one place is what made the other three invisible.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../src/components/', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

function vueFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? vueFiles(join(dir, e.name))
      : e.name.endsWith('.vue') ? [join(dir, e.name)] : [])
}

const contacts = vueFiles(ROOT)
  .map(f => [f, readFileSync(f, 'utf8')])
  .filter(([, src]) => /wa\.me|tel:/.test(src))

ok(contacts.length >= 3, `found the contact points (${contacts.length})`)

for (const [file, src] of contacts) {
  const name = file.split('/components/')[1]
  ok(/isDialable/.test(src), `${name} asks whether the number can be dialled at all`)
  // The guard existing is not the guard running. Every wa.me template literal
  // must sit in a function that refuses first — the shape that caught Money.
  const builders = src.match(/https:\/\/wa\.me\/\$\{waNumber\([^)]*\)\}/g) || []
  for (const b of builders) {
    const fn = src.slice(Math.max(0, src.lastIndexOf('function', src.indexOf(b))), src.indexOf(b))
    const guarded = /isDialable\([^)]*\)\)\s*return/.test(fn) || /if \(!isDialable/.test(fn)
    ok(guarded, `${name}: the link built by ${b.slice(0, 34)}… is behind the guard`)
  }
  // And nothing may offer the button on mere presence of a field.
  ok(!/v-if="[a-z]+\.(agentP|p)hone"\s+class="btn[^>]*wa/i.test(src.replace(/\n/g, ' ')),
     `${name}: no button shown on "there is a number" alone`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
