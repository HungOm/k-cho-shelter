/*
 * The guard is CALLED, not merely correct.
 *
 * WHY THIS EXISTS, and it is a hole I put in my own work. sellBlock is the rule
 * that stops a helper keying thirty stubs into a book that is out with a seller
 * and losing the lot at save. It has nine assertions in whereis.test.mjs and
 * they all pass. Delete the CALL from Sell.vue and every one of them still
 * passes, because they test the function and nothing tested that a screen
 * reaches for it.
 *
 * Proven, not suspected: removing `const blocked = sellBlock(t)` from Sell.vue
 * and neutering SellTicket's `blocked` computed both left the entire suite
 * green. The warning would have silently stopped appearing and the first
 * evidence would have been a volunteer losing a batch.
 *
 * It is the same shape as everything else this week — a check that exists, is
 * correct, and never runs — and it is the version that is hardest to see,
 * because the thorough tests on the helper are exactly what makes it look
 * covered.
 *
 * WHAT THIS FILE DOES NOT DO: test the guard's LOGIC. The store is stubbed here,
 * so neutering sellBlock itself passes this file untouched — and should.
 * whereis.test.mjs owns whether the rule is right; this owns whether anybody
 * asks. Two files because they fail for different reasons and a single file
 * covering both would not distinguish them.
 *
 * SO THIS RUNS THE COMPONENT. The script setup block is compiled with Vue's own
 * compiler and executed against a store whose sellBlock is a spy. A source scan
 * for the call would be a pattern, and a pattern is satisfied by a comment
 * mentioning the name.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupOf, renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** A store whose sellBlock records every call and answers however we like. */
const storeWith = (answer) => `
import { reactive, computed } from 'vue'
export const calls = []
export const state = reactive({
  cfg: { ticketPrefix: 'KS-', ticketDigits: 5, ticketsPerBook: 10, ticketPrice: 10, currency: 'RM' },
  tickets: [], byNumber: {}, books: [], agents: [], user: { role: 'recorder', agentId: null },
})
export function sellBlock(t) {
  ;(globalThis.__sellBlockCalls ??= []).push(t?.number ?? null)
  return ${JSON.stringify(answer)}
}
export function whereIs() { return { status: 'Out', agentId: 'A001', agentName: 'Daw Hla', out: true } }
export const agentMap = computed(() => ({}))
export const canWrite = computed(() => true)
export const isAdmin = computed(() => false)
export async function api() { return {} }
export function toast() {}
export async function loadDelta() {}
export async function optimistic() {}
export function setSellMode() {}
`

console.log('Sell.vue asks sellBlock before it calls a ticket sellable')
{
  globalThis.__sellBlockCalls = []
  const { ctx, cleanup } = await setupOf('src/components/Sell.vue', storeWith('with Daw Hla'))
  ok(typeof ctx.resolved === 'function', 'resolved() is exposed to the template')

  // A ticket that exists and looks sellable — so the only thing that can refuse
  // it is the guard. state lives in the bundle, reached through the component.
  ctx.state.byNumber['KS-00001'] = { number: 'KS-00001', status: 'Available', book: 'Book-001' }

  const verdict = ctx.resolved({ num: 'KS-00001', name: '', phone: '' })
  ok(globalThis.__sellBlockCalls.includes('KS-00001'),
     'the screen actually CALLS sellBlock for the ticket being keyed in')
  ok(verdict?.bad === true, 'and refuses the row when the guard refuses')
  ok(verdict?.text === 'with Daw Hla',
     `and shows the guard's own words, not its own (got ${JSON.stringify(verdict?.text)})`)
  cleanup()
}

console.log('and calls it sellable when the guard allows it')
{
  globalThis.__sellBlockCalls = []
  const { ctx, cleanup } = await setupOf('src/components/Sell.vue', storeWith(null))
  ctx.state.byNumber['KS-00011'] = { number: 'KS-00011', status: 'Available', book: 'Book-002' }

  const verdict = ctx.resolved({ num: 'KS-00011', name: '', phone: '' })
  ok(globalThis.__sellBlockCalls.includes('KS-00011'), 'the guard is consulted either way')
  ok(verdict?.bad === false, 'and an allowed ticket is not flagged')
  cleanup()
}

const TICKET = { number: 'KS-00001', status: 'Available', book: 'Book-001', version: 1,
                 name: '', phone: '', zone: '', agent: '' }

console.log('SellTicket asks it too, and takes the button away when refused')
{
  globalThis.__sellBlockCalls = []
  const { ctx, cleanup } = await setupOf('src/components/SellTicket.vue',
    storeWith('with Daw Hla'), { ticket: TICKET })

  // `blocked` is what the template disables the Sold button on. If it stops
  // consulting the guard, the button goes live over a book that is 200km away
  // and the refusal arrives only after the volunteer has taken the money.
  const blocked = ctx.blocked?.value
  ok(globalThis.__sellBlockCalls.includes('KS-00001'),
     'the modal CALLS sellBlock for the ticket it is about to sell')
  ok(blocked === 'with Daw Hla',
     `and carries the guard's answer to the button (got ${JSON.stringify(blocked)})`)
  cleanup()
}

console.log('every selling button gates on the guard — counted, because only one branch renders')
{
  /*
   * KEPT ALONGSIDE THE RENDER BELOW, and the reason is a gap I created and then
   * measured rather than assumed. I replaced this counted check with the render
   * and re-ran the mutants: removing ONE of the five gates went from caught to
   * uncaught. SellTicket has three template branches — quick, steps, reserved —
   * and only one renders per pass, so a render can never see all five bindings
   * at once. Counting can.
   *
   * The reverse is also true, which is why both are here: counting cannot tell
   * a binding that MENTIONS the guard from one that honours it, and the render
   * below can. Neither is redundant; each catches what the other structurally
   * cannot.
   *
   * Five, not seven. The two ungated buttons are "Save the fix" and "Let it
   * go" — correcting a spelling and releasing a hold on a book that is out are
   * ordinary office work, deliberately still allowed. If that number moves in
   * either direction somebody has changed the rule.
   */
  const src = readFileSync(join(ROOT, 'src/components/SellTicket.vue'), 'utf8')
  const gated = (src.match(/:disabled="[^"]*blocked[^"]*"/g) ?? []).length
  const all = (src.match(/:disabled="[^"]*"/g) ?? []).length
  ok(gated === 5, `five action buttons refuse when the guard refuses (found ${gated})`)
  ok(all - gated === 2, `and exactly two stay open — correct and release (found ${all - gated})`)
}

console.log('and the rendered button is actually disabled, not merely gated in source')
{
  /*
   * RENDERED, not counted. This assertion used to count :disabled bindings
   * containing `blocked` and require exactly five — a counted pattern, which is
   * better than a bare match but still reads the source rather than the screen.
   * It could not tell a binding that mentions the guard from one that honours
   * it, and `:disabled="busy || !canSell || (blocked && false)"` would have
   * passed.
   *
   * Rendering settles it: the Sold button either carries disabled in the HTML
   * or it does not. The template half of the harness is
   * shelter-ticket-inventory-tracker's; this is the assertion it unlocked.
   */
  // DRIVEN with a buyer filled in. Without it both screens disable the button
  // anyway — for want of a name, not for want of permission — and the two
  // renders are identical. A comparison between two screens that are disabled
  // for different reasons proves nothing, and it passed at first.
  const fill = (b) => { b.name.value = 'Ma Nu'; b.phone.value = '0125550100' }
  const refused = await renderScreen('src/components/SellTicket.vue',
    storeWith('with Daw Hla'), { props: { ticket: TICKET }, drive: fill })
  const allowedHtml = await renderScreen('src/components/SellTicket.vue',
    storeWith(null), { props: { ticket: TICKET }, drive: fill })

  /*
   * THE SOLD BUTTON SPECIFICALLY, not a count of disabled attributes anywhere.
   *
   * Counting was my first version and it was too coarse: neutering one gate to
   * `(blocked && false)` left the total unchanged, because other controls are
   * disabled for their own reasons and the comparison could not see which one
   * had stopped listening. Naming the button settles it — it either carries
   * disabled or it does not, and that is the control that takes the money.
   *
   * Found by text because it is the one button whose label survives the child
   * stubs: <Bi text="..."> renders through a prop, so those buttons come out
   * empty, while "Sold · RM 10.00" is plain template text.
   */
  const soldButton = (h) => (h.match(/<button[^>]*>Sold[^<]*<\/button>/) ?? [''])[0]
  ok(/disabled/.test(soldButton(refused)),
     `the Sold button is disabled when the guard refuses (${soldButton(refused) || 'not rendered'})`)
  ok(!/disabled/.test(soldButton(allowedHtml)),
     `and live when it does not (${soldButton(allowedHtml) || 'not rendered'})`)

  /*
   * And the words differ, which matters as much as the button.
   *
   * BOTH screens name the seller: one as a refusal, one as the older advisory
   * "check with them first" that has always been there. My first assertion was
   * that an allowed ticket does not mention Daw Hla, and it failed correctly —
   * the advice is right to stay. What distinguishes them is whether the screen
   * says the sale CANNOT happen or merely that it is unwise.
   */
  ok(/cannot be sold from this screen/.test(refused),
     'a refused ticket says it cannot be sold here')
  ok(!/cannot be sold from this screen/.test(allowedHtml),
     'and an allowed one does not')
  ok(/Check with them before selling/.test(allowedHtml),
     'while the older advice survives for a book that is merely out')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
