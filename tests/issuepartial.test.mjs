/*
 * Giving out books when not all of them are still there to give.
 *
 * Three things went wrong on this screen and they share one cause: the server
 * goes to real trouble to name what it could not do, and the screen threw the
 * names away.
 *
 * THE REFUSAL PRINTED NOTHING. Every blocked book was rendered as its number,
 * a dash, and `b.reason` — a field no handler has ever sent. The server sends
 * {book, status, agentId}. So an organiser standing at a table was told
 * "Nothing was changed. These are not free:" and then given a list of book
 * numbers followed by empty space, which is worse than no list: it looks like
 * the screen tried to explain and had nothing to say.
 *
 * THE RACE WAS NOT CAUGHT AT ALL. BOOKS_CHANGED_MEANWHILE carries the same
 * `blocked` list — two organisers giving out the same run within a second —
 * and only BOOKS_NOT_AVAILABLE was handled, so it fell through to a toast and
 * the names went with it.
 *
 * AND A PARTIAL HANDOVER PRINTED A RECEIPT FOR ALL OF IT. When some books were
 * taken between the range being typed and the button being pressed, the server
 * gives out what it can and names the rest in `skipped`. The screen read
 * `issued`, closed, and went straight to the handover receipt. The server's
 * own comment says what that costs: a handover receipt for five books when
 * three went out is the paper a seller holds up later and is wrong about.
 *
 * The last one is the reason this file drives the component rather than
 * rendering it. What the modal TELLS ITS PARENT is the behaviour — 'issued'
 * is what opens the receipt — and a screen that merely looks right while
 * emitting it anyway is the bug wearing the fix's clothes.
 */
import { nextTick } from 'vue'
import { renderScreen, setupOf, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const agents = [
  { id: 'A1', name: 'JOHN', active: true, booksOut: 4 },
  { id: 'A2', name: 'KUI', active: true, booksOut: 2 },
]

/** A store whose `api` answers however a case needs it to. */
const storeWith = (apiBody) => `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', checkInDate: '2026-10-11', ticketsPerBook: 10, ticketPrice: 10 },
  agents: ${JSON.stringify(agents)}, books: [], tickets: [], user: { role: 'admin' }
})
export const toasts = []
export const toast = (m, k, c) => { toasts.push({ m, k, c }) }
export const refresh = async () => {}
export const api = ${apiBody}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`

const refuses = (code, blocked) => `async () => {
  const e = new Error('refused'); e.code = ${JSON.stringify(code)};
  e.details = { blocked: ${JSON.stringify(blocked)} }; throw e
}`

const issues = (r) => `async () => (${JSON.stringify(r)})`

/** Drive the component to the point just after the button was pressed. */
async function press(apiBody, { emit } = {}) {
  const { ctx, cleanup } = await setupOf(
    'src/components/modals/IssueBooks.vue', storeWith(apiBody), {}, { emit },
  )
  ctx.from.value = '31'
  ctx.to.value = '35'
  await ctx.issue()
  await nextTick()
  return { ctx, cleanup }
}

console.log('1. a refusal says why, in words, and names who has the book')
{
  const blocked = [
    { book: 'Book-031', status: 'out', agentId: 'A2' },
    { book: 'Book-032', status: 'not released yet', agentId: '' },
  ]
  const { ctx, cleanup } = await press(refuses('BOOKS_NOT_AVAILABLE', blocked))
  ok(ctx.blocked.value?.length === 2, 'the blocked list reached the screen')

  // The bug: whyBlocked exists because `reason` never did.
  const said = ctx.blocked.value.map(ctx.whyBlocked)
  ok(said.every((t) => t && t.trim().length > 0),
    'every line says something — not a book number followed by an empty dash')
  ok(/with KUI/.test(said[0]),
    'a book that is out is out WITH somebody, and that is who has to be rung')
  ok(/not released yet/.test(said[1]), 'and one nobody holds says so plainly')
  ok(!said.some((t) => /undefined/.test(t)), 'and nothing reads as undefined')
  cleanup()
}

console.log('2. an unknown seller in the blocked list still reads as something')
{
  // The agent may not be in the local list — a seller added on another device
  // between this screen loading and the button being pressed.
  const blocked = [{ book: 'Book-031', status: 'out', agentId: 'A404' }]
  const { ctx, cleanup } = await press(refuses('BOOKS_NOT_AVAILABLE', blocked))
  const said = ctx.whyBlocked(ctx.blocked.value[0])
  ok(/out/.test(said), 'the status is still said')
  ok(/A404/.test(said), 'and the id stands in for the name rather than vanishing')
  cleanup()
}

console.log('3. the race is caught, and keeps the names it was given')
{
  const blocked = [
    { book: 'Book-031', status: 'taken meanwhile', agentId: '' },
    { book: 'Book-032', status: 'taken meanwhile', agentId: '' },
  ]
  const { ctx, cleanup } = await press(refuses('BOOKS_CHANGED_MEANWHILE', blocked))
  ok(ctx.blocked.value?.length === 2,
    'BOOKS_CHANGED_MEANWHILE shows the books, rather than falling through to a toast')
  ok(/taken meanwhile/.test(ctx.whyBlocked(ctx.blocked.value[0])), 'saying what happened to them')
  cleanup()
}

console.log('4. an error with nothing to name still reaches the person')
{
  const { ctx, cleanup } = await press(`async () => {
    const e = new Error('The network went away'); e.code = 'TIMEOUT'; throw e
  }`)
  ok(ctx.blocked.value === null, 'there is no list to show')
  ok(ctx.partly.value === null, 'and nothing was handed over')
  cleanup()
}

console.log('5. a partial handover does NOT print a receipt for the books that stayed')
{
  const emitted = []
  const { ctx, cleanup } = await press(
    issues({ issued: 3, books: ['Book-031', 'Book-032', 'Book-033'],
             skipped: ['Book-034', 'Book-035'],
             agent: { id: 'A1', name: 'JOHN', phone: '01' }, dueDate: '2026-10-11' }),
    { emit: (e, ...a) => emitted.push([e, ...a]) },
  )
  eq(ctx.partly.value?.issued, 3, 'the screen knows three went out')
  eq(ctx.partly.value?.skipped.length, 2, 'and two did not')
  ok(!emitted.some(([e]) => e === 'issued'),
    'and it did NOT emit issued — that is what opens the receipt, for five books')
  ok(!emitted.some(([e]) => e === 'close'), 'nor did it close over the top of the news')
  cleanup()
}

console.log('6. the receipt is a deliberate second tap, for what actually went out')
{
  const emitted = []
  const { ctx, cleanup } = await press(
    issues({ issued: 3, books: [], skipped: ['Book-034', 'Book-035'],
             agent: { id: 'A1', name: 'JOHN', phone: '01' } }),
    { emit: (e, ...a) => emitted.push([e, ...a]) },
  )
  // What the button in the actions slot does.
  ok(ctx.partly.value, 'the panel is up')
  cleanup()

  const html = await renderScreen('src/components/modals/IssueBooks.vue',
    storeWith(issues({ issued: 3, books: [], skipped: ['Book-034', 'Book-035'],
                       agent: { id: 'A1', name: 'JOHN', phone: '01' } })),
    { drive: async (c) => { c.from.value = '31'; c.to.value = '35'; await c.issue() } })
  const text = visibleText(html)
  ok(/3 of 5 books went to JOHN/.test(text),
    'the panel says how many of how many, so the count cannot be misread')
  ok(/Book-034/.test(text) && /Book-035/.test(text), 'and names the ones that stayed')
  ok(/Receipt for the 3 that went out/.test(text),
    'the receipt is offered for the three, and has to be asked for')
  ok(!/Give out/.test(text),
    'and "Give out" is gone — offering it over a range that is now half gone repeats the mistake')
}

console.log('7. a clean handover is unchanged')
{
  const emitted = []
  const { ctx, cleanup } = await press(
    issues({ issued: 5, books: ['Book-031'], skipped: [],
             agent: { id: 'A1', name: 'JOHN', phone: '01' } }),
    { emit: (e, ...a) => emitted.push([e, ...a]) },
  )
  ok(ctx.partly.value === null, 'nothing was skipped, so there is no panel')
  ok(emitted.some(([e, id]) => e === 'issued' && id === 'A1'),
    'it emits issued and goes straight to the receipt, as it always did')
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
