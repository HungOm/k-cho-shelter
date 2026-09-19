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

/*
 * WHAT COUNTS AS A CONTACT POINT: a link that CARRIES A RECIPIENT.
 *
 * This used to be "any file mentioning wa.me or tel:", which is the
 * everything-except shape that has bitten this repository before — it names the
 * set by what it looks like rather than by what it does. Two things it got
 * wrong:
 *
 *   SellerMoney.vue matched on a PROP CALLED `tel`, and passed only because it
 *   happens to import isDialable for another reason. It has never built a link.
 *
 *   A share-sheet link — wa.me/?text=... — has no recipient in it at all. It
 *   opens WhatsApp and lets the person choose who to send to, so there is no
 *   stored number to be wrong and nothing for isDialable to check. Requiring
 *   the guard there would mean adding a call that guards nothing, which is how
 *   a guard stops meaning anything.
 *
 * So the set is named by the construction that embeds a number: a wa.me path
 * built from an expression, or a tel: href being assembled. The four links the
 * leading-zero bug actually reached are all in it.
 */
const CARRIES_NUMBER = /wa\.me\/\$\{|['"`]tel:['"`]?\s*\+|`tel:\$\{/

const contacts = vueFiles(ROOT)
  .map(f => [f, readFileSync(f, 'utf8')])
  .filter(([, src]) => CARRIES_NUMBER.test(src))

ok(contacts.length >= 3, `found the contact points (${contacts.length})`)

/*
 * And the other kind, checked for the thing that would turn it into the first
 * kind: a share sheet that someone later "improves" by pre-filling the buyer's
 * number would become an unguarded contact point without moving files.
 */
const pickers = vueFiles(ROOT)
  .map(f => [f, readFileSync(f, 'utf8')])
  .filter(([, src]) => /wa\.me\/\?text=/.test(src))

for (const [file, src] of pickers) {
  const name = file.split('/components/')[1]
  ok(!CARRIES_NUMBER.test(src),
    `${name}: the share sheet picks the recipient, so no number is put in the link`)
}

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

/*
 * And the place a bad number is CREATED, not merely displayed.
 *
 * Every fix above stops the app acting on an unreachable number. None of them
 * stops one being written down. Nine tickets on this raffle already carry a
 * seller's number with its leading zero gone, and a buyer's number has exactly
 * one job — finding the person whose ticket was drawn — so the table, with the
 * buyer still standing there, is the only cheap moment to catch it.
 */
console.log('and the moment a number is typed')
{
  const sell = readFileSync(join(ROOT, 'Sell.vue'), 'utf8')
  const body = sell.slice(sell.indexOf('function phoneWarning'), sell.indexOf('</script>'))
  const warn = new Function('isDialable', 'phoneDigits',
    `${body}; return phoneWarning`)(
    (await import('../src/lib/search.js')).isDialable,
    (await import('../src/lib/search.js')).phoneDigits)

  ok(warn('012-345 6789') === '', 'a number a volunteer can ring passes without comment')
  ok(warn('+95 9 123 4567') === '', 'so does one written in full, from anywhere')
  ok(warn('') === '', 'an empty box is not nagged at — the buyer may not have given one')
  ok(warn('123') === '', 'and neither is a half-typed one; the save rule says that better')
  const bad = warn('123367462')
  ok(/leading 0/.test(bad), 'the live shape is warned about, and told what is missing')
  ok(/cannot be rung/.test(bad), 'in terms of what it costs rather than what it violates')

  // Not a blocker, on purpose: the save rule is unchanged, and a volunteer with
  // a queue in front of them should not be stopped by a warning.
  ok(/phoneDigits\(r\.phone\)\.length < 7/.test(sell),
     'the rule that actually refuses a sale is untouched')
  ok(!/isDialable\([^)]*\)\)?\s*\{?\s*local\.push/.test(sell),
     'and dialability does not refuse one')
  ok(/phoneWarning\(r\.phone\)/.test(sell), 'the warning is shown beside the box it is about')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
