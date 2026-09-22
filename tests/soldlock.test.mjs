/*
 * A sold ticket is locked on every screen, and "sold" means the same thing on
 * all of them.
 *
 * TWO STATUSES, ONE FACT. A donated ticket is as spoken for as a sold one: it
 * is in the draw and somebody's name is on it. The server has always said this
 * in exactly one place — `const SOLD = ['Sold', 'Donated']` in tickets.ts — and
 * the browser said it by hand in seven, of which two named only 'Sold'.
 *
 * WHAT THE TWO COST:
 *
 *   Sell.vue resolved()    marks a line "already sold" before the batch is
 *                          sent, so one bad row does not take forty good ones
 *                          down at the server. A donated ticket passed that
 *                          check, was refused by the server, and the whole
 *                          batch failed — with the line that caused it the one
 *                          line not flagged.
 *   Sell.vue reconcile()   after a timeout, decides what actually landed. A
 *                          ticket genuinely written as Donated read as missing
 *                          and was queued to be sent a second time.
 *
 * The second is the dangerous direction: the first wastes a volunteer's evening
 * and the second writes twice.
 *
 * WHY THIS FILE IS A SOURCE SCAN rather than a list of screens. The lesson that
 * produced it is that a guard can be right in one place and that is exactly what
 * hides the other three — the correctness of the instance is what stops anybody
 * looking further. A hand-written list of call sites reproduces the author's
 * blind spot perfectly. So the rule is enforced over the whole tree: the fact is
 * defined once, and nowhere else may spell it out.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { codeOf } from './source.mjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const files = walk(join(ROOT, 'src')).filter((f) => /\.(vue|js)$/.test(f))
const rel = (f) => f.slice(ROOT.length)

console.log('the instrument read the tree')
{
  ok(files.length > 30, `${files.length} client files`)
}

console.log('the fact is defined once')
{
  const store = readFileSync(join(ROOT, 'src/lib/store.js'), 'utf8')
  ok(/export function isSold\(/.test(store), 'store.js defines isSold')
  ok(/DONATED/.test(store.slice(store.indexOf('export function isSold'),
                                store.indexOf('export function isSold') + 260)),
     'and it counts Donated, which is the half that kept getting dropped')
}

console.log('and nowhere else spells it out')
{
  /*
   * Money.vue is the one exclusion, and it is about OWNERSHIP, not correctness:
   * it names both statuses and has always been right. Two other sessions are
   * editing that file as this is written, so converting it here would mean
   * reverting somebody's work in a file I do not own. It should move to isSold
   * when they are done.
   */
  const OWNED_ELSEWHERE = ['src/components/Money.vue']

  const offenders = []
  for (const f of files) {
    if (rel(f) === 'src/lib/store.js') continue
    if (OWNED_ELSEWHERE.includes(rel(f))) continue

    /*
     * CODE ONLY. A file that explains this rule contains every phrase the rule
     * does — store.js's own comment quotes `['Sold', 'Donated']` while naming
     * the one place it is allowed to live, and would read as the offender it
     * exists to prevent. That file is excluded below for a different reason, so
     * the collision is latent rather than live: any file that gains a comment
     * mentioning the pattern becomes a false offender, and a check that cries
     * wolf about prose is one people start skipping.
     */
    const src = codeOf(readFileSync(f, 'utf8'))

    // The inline pair, in either order and either bracket style.
    if (/\[\s*'(Sold|Donated)'\s*,\s*'(Sold|Donated)'\s*\]/.test(src)) {
      offenders.push(`${rel(f)} spells the pair inline`)
    }
    // A comparison that decides whether a ticket is spoken for. Assignments
    // (`status: 'Sold'`) are how a sale is WRITTEN and are left alone.
    for (const m of src.matchAll(/\.status\s*[=!]==\s*'Sold'/g)) {
      offenders.push(`${rel(f)} compares against 'Sold' alone: ${m[0]}`)
    }
  }
  ok(offenders.length === 0,
    offenders.length ? `these decide "sold" for themselves:\n    ${offenders.join('\n    ')}`
                     : 'every screen asks store.js')
}

/* ---- and the lock actually holds on the screen ---- */

const TICKET = {
  number: 'KS-00305', book: 'Book-031', name: 'Pa Thang', phone: '0123456789',
  agent: 'A1', saleDate: '2026-08-20T08:00:00Z', by: 'recorder@example.org',
  amount: 10, payment: 'Paid', source: '', version: 2,
}

const store = `
import { reactive, computed } from 'vue'
export const TICKET_STATUS = { AVAILABLE: 'Available', RESERVED: 'Reserved',
  SOLD: 'Sold', DONATED: 'Donated', VOID: 'Void' }
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10 }, agents: [], sellMode: 'quick',
  user: { role: 'admin' },
})
export const api = async () => ({ book: { number: 'Book-031', status: 'Out' }, history: [] })
export const optimistic = async () => {}
export const toast = () => {}
export const setSellMode = () => {}
export const refresh = async () => {}
export const agentMap = computed(() => ({ A1: { name: 'MARY' } }))
export const whereIs = () => null
export const sellBlock = () => null
// The organiser's override asks why; these screens import the predicate that
// decides whether to ask. Default false: no stub here puts a book in somebody
// else's hands, and a stub that says yes would make every render demand a reason.
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
export const bookBlock = () => null
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
`

for (const status of ['Sold', 'Donated']) {
  console.log(`a ${status.toLowerCase()} ticket is locked, not sellable again`)
  {
    const html = await renderScreen('src/components/SellTicket.vue', store, {
      props: { ticket: { ...TICKET, status } },
    })
    const said = visibleText(html)

    // The sell controls are the lock. "Sold · RM 10.00" is the button that
    // writes a sale; "Hold it" reserves one. Neither may be reachable.
    ok(!/Sold · RM/.test(said), 'the sell button is not offered')
    ok(!/Hold it/.test(said), 'nor holding it for somebody')
    // It shows the correction view instead, which is the only thing left to do.
    ok(/Fix something/.test(said), 'it offers to fix a mistake instead')
    ok(/Sold by/.test(said) && /MARY/.test(said),
       'and says who sold it — recorded from the first version, shown nowhere until now')
  }

  console.log(`and a ${status.toLowerCase()} ticket can be traced`)
  {
    /* Re-aimed twice, never relaxed. The trail stopped being a button to
       another sheet and became a section of this one, so the words are now the
       section's heading and the child has to be drawn to see them; then the
       label lost three words it did not need ("Where THIS TICKET has been" on
       a sheet whose title is the ticket number). The invariant is the one this
       always asserted, and it has not moved: from a sold ticket there is a way
       into where it has been, without leaving the record. */
    const html = await renderScreen('src/components/SellTicket.vue', store, {
      props: { ticket: { ...TICKET, status } }, renderReal: ['Trail.vue'],
    })
    ok(/Where it has been/.test(visibleText(html)),
       'the way into its history is on the ticket itself')
  }
}

console.log('an available ticket is still sellable')
{
  // The other direction, because a lock that locks everything is not a lock.
  const html = await renderScreen('src/components/SellTicket.vue', store, {
    props: { ticket: { ...TICKET, status: 'Available', name: '', phone: '' } },
  })
  const said = visibleText(html)
  ok(/Sold · RM/.test(said), 'the sell button is there')
  ok(!/Fix something/.test(said), 'and it is not pretending the sale already happened')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
