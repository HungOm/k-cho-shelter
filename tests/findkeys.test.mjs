/*
 * The keyboard on Find, and the three things it does that nobody can see.
 *
 * WHY THIS IS NEEDED. The results header prints "↑↓ to move · Enter to open ·
 * S to sell". A printed promise of keys is the easiest thing in an interface
 * to ship without the behaviour behind it, and when it is missing nothing
 * fails — the screen simply does not respond, and a keyboard user is left
 * deciding whether they misread the header or the page is broken. So the
 * promise and the behaviour are asserted together.
 *
 * AND ONE OF THOSE KEYS CAN BE REFUSED. `permissionui` requires a control you
 * cannot use to be shown disabled WITH THE REASON IN ITS TITLE, never hidden.
 * A keyboard shortcut has no title attribute, so that rule is satisfiable on
 * the mouse path — a greyed Sell button with a tooltip — and has no
 * equivalent on the keyboard path. Pressing S on a ticket in somebody else's
 * bag must therefore SAY why. Silence is the one outcome the rule forbids,
 * and silence is also the default behaviour of a missing branch.
 *
 * AND WHERE THE TICKET GOES WHEN A KEY OPENS ONE. Find used to draw the
 * ticket in a dock beside the list when the window was wide enough and hand it
 * up to the sheet when it was not — two records of one ticket, two sale forms.
 * The organiser removed the dock on 2026-09-22 and ruled that a ticket opens
 * in the modal whatever you are holding. What replaced the dock's assertion is
 * below: opening ALWAYS hands the ticket up. The failure being pinned is a
 * width-gated branch that swallows it instead, which on screen is a row that
 * does nothing when you press it.
 *
 * WHAT THIS CANNOT DO. It cannot prove focus actually lands on a row: server
 * rendering has no document, so `focusRow` has nothing to focus. It proves
 * what the component decides — which row is next, which page, what is said,
 * and what it hands to App.vue — and leaves the DOM half to a browser.
 */
import { renderScreen, visibleText, setupOf } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/* Thirty tickets, so page one is full and there is a page two to fall into. */
const TICKETS = Array.from({ length: 30 }, (_, i) => ({
  number: `KS-${String(1 + i).padStart(5, '0')}`,
  book: i < 25 ? 'Book-001' : 'Book-002',
  status: 'Available', name: '', phone: '', agent: '', version: 1,
}))

/*
 * Book-002 is out with a seller, so its tickets refuse. sellBlock is stubbed
 * to the real rule in miniature — the component must be shown to ASK, and a
 * stub that answers differently from the rows is how we find out whether it
 * does.
 */
const STORE = (user) => `
import { reactive, computed } from 'vue'
export const state = reactive({
  user: ${JSON.stringify(user)},
  cfg: { ticketPrefix: 'KS-', bookPrefix: 'Book-', ticketStart: 1, ticketPrice: 10, currency: 'RM' },
  tickets: ${JSON.stringify(TICKETS)},
  agents: [], query: '', filterStatus: '', filterAgent: '', filterWhere: '',
  loadProgress: null, byNumber: {},
})
state.byNumber = Object.fromEntries(state.tickets.map(t => [t.number, t]))
export const searchResults = computed(() => ({ results: state.tickets, total: state.tickets.length }))
export const agentMap = computed(() => ({}))
export const whereIs = (t) => (t && t.book === 'Book-002'
  ? { book: t.book, out: true, agentId: 'A001', agentName: 'TEST', status: 'Out' }
  : { book: t && t.book, out: false, status: 'Unassigned' })
export const isSold = (t) => !!t && (t.status === 'Sold' || t.status === 'Donated')
export const sellBlock = (t) => (t && t.book === 'Book-002'
  ? 'Book-002 is out with TEST.' : null)
export const isAdmin = ${user.role === 'admin'}
export const api = async () => ({})
export const toast = () => {}
export const go = () => {}
export const optimistic = async () => {}
export const sellOverrideNeeded = () => false
export const setSellMode = () => {}
`

const ADMIN = { email: 'org@x.com', role: 'admin', agentId: '', isSuperAdmin: false }

/*
 * WHAT THE SCREEN TELLS THE APP is now the observable. It used to be a
 * `selected` ref that the dock read, which a test could look at directly; with
 * the dock gone, opening a ticket is an EMIT and nothing is left on the
 * component to inspect. setupOf takes an emit for exactly this — a swallowed
 * one would make "opened the ticket" and "did nothing at all" identical.
 */
const bindings = async () => {
  const sent = []
  const { ctx, cleanup } = await setupOf('src/components/Search.vue', STORE(ADMIN), {},
    { emit: (ev, arg) => sent.push([ev, arg]) })
  return { b: ctx, sent, cleanup }
}

console.log('the keys are promised only where the keys exist')
{
  const narrow = visibleText(await renderScreen('src/components/Search.vue', STORE(ADMIN), {}))
  ok(!/to move/.test(narrow),
     'a phone is told nothing about arrow keys, because it has none')

  const wideHtml = visibleText(await renderScreen('src/components/Search.vue', STORE(ADMIN), {
    drive: (b) => { b.wide.value = true },
  }))
  ok(/↑↓ to move · Enter to open · S to sell/.test(wideHtml),
     `the wide layout states the contract (${wideHtml.slice(0, 70)})`)
}

console.log('a ticket opens in the sheet, and at every width the same way')
{
  /*
   * BOTH WIDTHS, because the defect this replaces a dock assertion with is a
   * branch that only one of them takes. A screen that opens the ticket on a
   * phone and swallows it on a desktop passes any test that renders one shape.
   */
  for (const wide of [false, true]) {
    const { b, sent, cleanup } = await bindings()
    b.wide.value = wide
    b.openTicket(TICKETS[0])
    ok(sent.length === 1 && sent[0][0] === 'open' && sent[0][1].number === 'KS-00001',
       `the ticket is handed up for the sheet to open, wide: ${wide} `
       + `(${JSON.stringify(sent.map((e) => e[0]))})`)
    /* The one thing the dock was better at, kept: the keyboard stays on the
       row it came from, so closing the sheet does not land you at the top of
       six hundred results. */
    ok(b.focusNum.value === 'KS-00001',
       `and the keyboard keeps its place on the row it came from (${b.focusNum.value})`)
    cleanup()
  }
}

console.log('down at the bottom of a page turns the page, and says so')
{
  const { b, cleanup } = await bindings()
  b.wide.value = true
  ok(b.pageCount.value === 2, `thirty results over twenty-five make two pages (${b.pageCount.value})`)

  await b.focusRow('KS-00025')          // the last row of page one
  ok(b.page.value === 1, 'still on page one')
  await b.move(1)
  ok(b.page.value === 2, 'down from the last row turns the page rather than stopping dead')
  ok(b.focusNum.value === 'KS-00026', `and lands on the first row of it (${b.focusNum.value})`)
  ok(/Page 2 of 2/.test(b.said.value), `and says where it went (${b.said.value})`)

  await b.move(-1)
  ok(b.page.value === 1 && b.focusNum.value === 'KS-00025',
     'and back up returns to the row it came from, not to the top')
  cleanup()
}

console.log('the ends of the list are stated rather than silent')
{
  const { b, cleanup } = await bindings()
  await b.focusRow('KS-00001')
  await b.move(-1)
  ok(/Top of the results/.test(b.said.value), `up from the first row says so (${b.said.value})`)

  b.page.value = 2
  await b.focusRow('KS-00030')
  await b.move(1)
  ok(/End of the results/.test(b.said.value), `and down from the last says so (${b.said.value})`)
  cleanup()
}

console.log('S on a ticket that cannot be sold says why, out loud')
{
  /*
   * THE ASSERTION THIS FILE EXISTS FOR. KS-00026 is in Book-002, which is out
   * with TEST, so sellBlock refuses it. On the mouse path permissionui is met
   * by a disabled control with the reason in its title; a shortcut has no
   * title, so the reason has to be spoken. Mutation-check: drop the sellBlock
   * branch from sellFocused and this fails while every other case here stays
   * green, because the key would still "work" — it would just open a ticket
   * the server then refuses.
   */
  const { b, sent, cleanup } = await bindings()
  b.wide.value = true
  b.page.value = 2
  await b.focusRow('KS-00026')
  b.sellFocused()
  ok(sent.length === 0,
     'a refused ticket is not opened for a sale that cannot happen')
  ok(/cannot be sold from here/.test(b.said.value) && /Book-002 is out with TEST/.test(b.said.value),
     `and the reason is spoken, not swallowed (${b.said.value})`)

  /* Back to page one first: focus only ever sits on a row that is drawn, so
     a ticket on another page is not something S can reach. This one also
     proves the line above could have failed: the same array, and the sale
     that IS allowed puts something in it. */
  b.page.value = 1
  await b.focusRow('KS-00001')
  b.sellFocused()
  ok(sent.length === 1 && sent[0][1].number === 'KS-00001',
     `a ticket that can be sold opens (${JSON.stringify(sent.map((e) => e[0]))})`)
  ok(/Who bought it/.test(b.said.value), `and says what to type (${b.said.value})`)
  cleanup()
}

console.log('exactly one row is in the tab order')
{
  const { b, cleanup } = await bindings()
  const roving = b.pageRows.value.map((t) => b.rovingFor(t))
  ok(roving.filter((n) => n === 0).length === 1,
     `one row is tabbable and the rest are reached by arrow (${roving.filter((n) => n === 0).length})`)

  /*
   * KEYED ON THE NUMBER, NOT THE INDEX. The list is a TransitionGroup that
   * re-sorts and re-pages; an index would move the focus ring to whichever
   * ticket landed in that slot. Turning the page with a focus set to a number
   * that is no longer drawn must fall back to the first row rather than
   * leaving nothing tabbable at all.
   */
  await b.focusRow('KS-00003')
  b.page.value = 2
  const after = b.pageRows.value.map((t) => b.rovingFor(t))
  ok(after.filter((n) => n === 0).length === 1,
     'and after the page turns under it, exactly one row is still tabbable')
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
