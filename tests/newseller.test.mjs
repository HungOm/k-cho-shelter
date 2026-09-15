/*
 * Adding a seller without losing the handover you were in the middle of.
 *
 * Books get given out at a table, and the person in front of you is often not
 * on the list yet. Sending them to the Sellers screen means closing this modal,
 * typing a name, coming back, and re-entering the book range and the date — so
 * in practice the range gets retyped from memory, or the books are handed over
 * and written down later, which is how a book ends up with nobody's name on it.
 *
 * WHAT IS ACTUALLY BEING TESTED is that the form opens ON TOP rather than
 * instead: IssueBooks must not unmount, because everything already typed lives
 * in its setup state. A render proves the option is there; only running the
 * component proves the range survives opening the form and coming back.
 *
 * The revert matters as much as the rest. "+ Add a new seller" sits in a list
 * of people, and a v-model that keeps the sentinel after the form is cancelled
 * leaves the box reading as though a person called __new__ is taking the books.
 */
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'
import { renderScreen, setupOf, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const agents = [
  { id: 'A1', name: 'JOHN', active: true, booksOut: 60 },
  { id: 'A2', name: 'KUI', active: true, booksOut: 31 },
  { id: 'A3', name: 'Thang ling', active: true, booksOut: 0 },
]
const store = `
import { reactive, ref, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', checkInDate: '2026-10-11', ticketsPerBook: 10 },
  agents: ${JSON.stringify(agents)}, books: [], tickets: [], user: { role: 'admin' }
})
export const api = async () => ({ agentId: 'A9', created: true })
export const toast = () => {}
export const refresh = async () => {
  // Deferred on purpose: a real refresh is a round trip. An instant one lets a
  // missing await pass, because the list is already updated by the time anyone
  // looks — which is exactly the bug it would be hiding.
  await new Promise((r) => setTimeout(r, 0))
  if (!state.agents.some(a => a.id === 'A9')) {
    state.agents.push({ id: 'A9', name: 'New Person', active: true, booksOut: 0 })
  }
}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
// Mirrors the real store's exports. A screen that grows an import breaks the
// bundle here with "no matching export", which reads as a broken test rather
// than as a stub one field behind.
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`

console.log('the option is there, last, and reads as an action')
{
  const html = await renderScreen('src/components/modals/IssueBooks.vue', store)
  const text = visibleText(html)
  ok(/Add a new seller/.test(text), 'the choice exists on the screen')
  const opts = [...html.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)].map(m => visibleText(m[1]))
  ok(opts.length === agents.length + 1, `one option per seller plus the new one (${opts.length})`)
  ok(/Add a new seller/.test(opts[opts.length - 1]),
     'and it is LAST — an action hidden among names is how books go to the wrong person')
  ok(/class="newopt"/.test(html) || /newopt/.test(html), 'carrying the class that colours it')
  const src = readFileSync(new URL('../src/components/modals/IssueBooks.vue', import.meta.url), 'utf8')
  ok(/\.newopt\s*\{[^}]*var\(--brand\)/.test(src),
     'in the raffle\'s own colour, so it follows the branding rather than a fixed one')
}

console.log('choosing it opens the form and does not become the answer')
{
  // setup() hands back refs, not values — the template unwraps them and a test
  // driving the component directly does not.
  const { ctx, cleanup } = await setupOf('src/components/modals/IssueBooks.vue', store)
  ok(ctx.agentId.value === 'A1', 'starts on the first seller')
  ok(ctx.adding.value === false, 'and with no form open')

  // Everything a volunteer had already typed.
  ctx.from.value = '31'; ctx.to.value = '45'
  const dueBefore = ctx.due.value

  // Driven through the handler the element calls, not by assigning the model —
  // the sentinel must never reach agentId at all. Letting it in and setting it
  // back leaves the BOX reading "+ Add a new seller" while the value says JOHN,
  // because the model ends where Vue last rendered it and no patch is
  // scheduled. A browser found that; state assertions could not.
  const el = { value: '__new__' }
  ctx.pickSeller(el)
  await nextTick()
  ok(ctx.adding.value === true, 'picking it opens the seller form')
  ok(ctx.agentId.value === 'A1', 'the model never holds the sentinel, so nothing has to be undone')
  ok(el.value === 'A1', 'and the box itself is put back, in the same turn')

  ok(ctx.from.value === '31' && ctx.to.value === '45', 'the book range is untouched')
  ok(ctx.due.value === dueBefore, 'and so is the date')
  cleanup()
}

console.log('saving comes back here with the new seller chosen')
{
  const { ctx, cleanup } = await setupOf('src/components/modals/IssueBooks.vue', store)
  ctx.from.value = '31'; ctx.to.value = '45'
  ctx.pickSeller({ value: '__new__' })
  await nextTick()

  await ctx.sellerAdded({ agentId: 'A9', created: true })
  ok(ctx.adding.value === false, 'the form closes')
  ok(ctx.agentId.value === 'A9', 'the seller just created is the one selected')
  // And is actually in the list at that moment. Without waiting for the
  // refresh, the box points at an id no option carries and renders blank —
  // which looks like the save failed, on the screen where it plainly did not.
  ok(ctx.state.agents.some((a) => a.id === 'A9'),
     'and the list already contains them, so the box is not momentarily empty')
  ok(ctx.from.value === '31' && ctx.to.value === '45',
     'and the handover is still where it was left')

  // A save that answers without an id must not silently select nothing.
  ctx.agentId.value = 'A1'
  await ctx.sellerAdded({})
  ok(ctx.agentId.value === 'A1',
     'a reply with no id leaves the selection alone rather than clearing it')
  cleanup()
}

console.log('and an ordinary choice still just works')
{
  const { ctx, cleanup } = await setupOf('src/components/modals/IssueBooks.vue', store)
  ctx.pickSeller({ value: 'A2' })
  ok(ctx.agentId.value === 'A2', 'choosing a real seller selects them')
  ok(ctx.adding.value === false, 'and opens nothing')
  cleanup()
}

console.log('the form hands its id back at all')
{
  const form = readFileSync(new URL('../src/components/modals/AgentForm.vue', import.meta.url), 'utf8')
  ok(/emit\('saved', \{ agentId/.test(form), 'AgentForm reports which seller it saved')
  ok(/r\?\.agentId/.test(form), 'taken from the reply rather than guessed from the name')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
