/*
 * A book counted in with one ticket left, and nobody could ever sell it.
 *
 * Reported from the live raffle: Book-084 came back with nine of ten sold, was
 * counted in, and KS-00831 — the stub that came back unsold — could not be sold
 * by anybody, including the organiser holding it. Both buttons were dead and
 * the screen gave no reason.
 *
 * NEITHER HALF OF THAT WAS AN ACCIDENT, WHICH IS WHY IT LASTED. The freeze is
 * deliberate and enforced three times over — store.js refuses it, the Edge
 * Function refuses it, the SQL refuses it — because counting a book in
 * reconciles its money, and selling another ticket out of it changes a total
 * somebody has signed off. That rule is right and stays.
 *
 * What was missing was the step AFTER it. books.ts documents the lifecycle as
 * Returned -> settle -> restock -> issue again, restock_books has existed on
 * the server from the beginning, and the client's own action list names it.
 * Nothing in the app could call it. A documented step of the book lifecycle
 * existed everywhere except where somebody could press it, so a ticket that
 * came back unsold was frozen for good.
 *
 * So this pins three things: the way out exists and is reachable, the screen
 * says why when it refuses, and — the general form — an action nothing can
 * call is caught by a test rather than by a fundraiser.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderScreen, setupOf, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const root = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')

console.log('1. the way back onto the shelf is reachable from the books screen')
{
  const books = read('src/components/Books.vue')
  ok(/emit\('restock'\)/.test(books), 'the books screen has a control that asks for it')
  ok(/defineEmits\(\[[^\]]*'restock'/.test(books), 'and declares the event, or Vue drops it')

  const app = read('src/App.vue')
  ok(/@restock="openModal\('bookaction', 'restock'\)"/.test(app),
     'and the app opens the sheet on it — an emit nobody listens for is a dead button')
}

console.log('2. the sheet turns it into the action the server has always had')
{
  const sheet = read('src/components/modals/BookAction.vue')
  ok(/restock:\s*\['restock_books'/.test(sheet), "'restock' maps to restock_books")
  ok(/restock:\s*\['Put books back on the shelf'/.test(sheet), 'and the sheet is titled for it')

  // The books it can act on are the opposite set from transfer and bring-back:
  // a book goes back on the shelf FROM the desk, not from a seller's bag.
  const relevant = sheet.slice(sheet.indexOf('const isRelevant'), sheet.indexOf('const range'))
  ok(/'Returned'/.test(relevant) && /'Settled'/.test(relevant),
     'and it offers the books that are back at the desk, not the ones out with sellers')

  // Money merely OWED is no longer a refusal — the debt follows the sold
  // tickets through a restock. What is refused is a book counted in for more
  // than its tickets carry, where the difference would be destroyed.
  ok(/MONEY_WOULD_BE_LOST/.test(sheet),
     'a refusal that names which books would lose money is shown as that list, not one sentence')
  ok(!/MONEY_STILL_OWED/.test(sheet),
     'and the old refusal is gone rather than left beside it, because both branches cannot be right')
}

const store = `
import { reactive, computed } from 'vue'
export const TICKET_STATUS = { AVAILABLE: 'Available', RESERVED: 'Reserved',
  SOLD: 'Sold', DONATED: 'Donated', VOID: 'Void' }
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10 }, agents: [], sellMode: 'quick',
  user: { role: 'admin' },
})
export const api = async () => ({ book: { number: 'Book-084', status: 'Settled' }, history: [] })
export const optimistic = async () => {}
export const toast = () => {}
export const setSellMode = () => {}
export const refresh = async () => {}
export const agentMap = computed(() => ({}))
export const whereIs = () => ({ book: 'Book-084', status: 'Settled', out: false })
export const sellBlock = () => 'book is settled'
// The organiser's override asks why; these screens import the predicate that
// decides whether to ask. Default false: no stub here puts a book in somebody
// else's hands, and a stub that says yes would make every render demand a reason.
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
export const bookBlock = () => 'book is settled'
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
`
const TICKET = { number: 'KS-00831', book: 'Book-084', status: 'Available',
                 name: '', phone: '', zone: '', version: 1 }

console.log('3. the ticket in a counted-in book says why, instead of two dead buttons')
{
  const said = visibleText(await renderScreen('src/components/SellTicket.vue', store,
    { props: { ticket: TICKET } }))
  ok(/counted in/i.test(said), 'it says the book has been counted in')
  ok(/Book-084/.test(said), 'names the book, because the ticket number is not the thing that is stuck')
  /*
   * The half that makes it a rule rather than a trap. "You cannot do this" with
   * no "here is what you can do" is what the organiser met, and it reads as a
   * broken screen — which is how it was reported.
   */
  ok(/back on the shelf/i.test(said), 'and names the way out')
}

console.log('4. and the lock itself still holds — the buttons are dead, just no longer silent')
{
  /*
   * Explaining the refusal must not soften it. The note is the new part; the
   * disabled button is the old part and the one the money depends on, so both
   * are checked in the same render rather than trusting that adding prose left
   * the guard alone.
   */
  const html = await renderScreen('src/components/SellTicket.vue', store,
    { props: { ticket: TICKET } })
  const at = html.indexOf('Sold · RM')
  ok(at > 0, 'the sell button is still drawn')
  const button = html.slice(html.lastIndexOf('<button', at), at)
  ok(/disabled/.test(button), 'and it is disabled — the freeze is not relaxed by explaining it')

  /*
   * Holding it is checked at the source rather than in the render: its label
   * comes from the bilingual component, which the render stub drops, so an
   * assertion that the words are absent passes whether the button is there or
   * not. What has to hold is that every control that writes is bound to the
   * same block — so count them instead.
   */
  const src = read('src/components/SellTicket.vue')
  const writes = [...src.matchAll(/<button[^>]*@click="(sell|hold)"/g)].length
  const guarded = [...src.matchAll(/<button[^>]*:disabled="[^"]*blocked[^"]*"[^>]*@click="(sell|hold)"/g)].length
  ok(writes > 0 && guarded === writes,
     `all ${writes} sell-or-hold controls are bound to the block (${guarded} are)`)
}

console.log('5. no action is registered on the server that nothing can call')
{
  /*
   * THE GENERAL FORM OF THIS BUG, which is the part worth keeping.
   *
   * restock_books was not broken. It was written, tested, routed, permissioned
   * and named in the client's action list, and no screen could reach it. Every
   * check that existed looked in the direction that passed: everyaction.test
   * asks that each action a SCREEN calls exists on the server. Nothing asked
   * the reverse, and the reverse is where a whole feature can sit unbuilt
   * looking exactly like a built one.
   *
   * The allow-list is deliberately a list of NAMES rather than a pattern. Each
   * is a handler with no way to reach it, and writing them down turns a silent
   * gap into a visible debt: adding a seventh fails this test, and building one
   * means deleting a line here.
   */
  const NO_SCREEN_YET = {
    void_ticket: 'cancelling a single ticket has no control anywhere',
    write_off: 'a debt can be forgiven by the server and by nothing else',
    set_ticket_ceiling: 'the ceiling is set by editing config directly',
    return_check: 'declaration against verified returns is computed and never shown',
    chase_today: 'the chase list exists as a handler only',
    // Deliberate, and the only one here with a date on it. The picker that
    // calls this is client code; the client deploys on every push and the
    // backend is frozen behind a hold, so a screen built now would be a dead
    // one on the live site. The handler ships with the function, which is
    // frozen too. This line comes out when the picker is built.
    move_tickets: 'the ticket picker waits for the deploy freeze to lift',
    /*
     * NOT A SCREEN ACTION AND NEVER WILL BE. accept_offer is what runs when a
     * seller accepts, and it is reached only from inside decideApproval, which
     * has already established that this exact person is the one the books were
     * offered to. The screen calls decide_offer; the client must NOT be able to
     * call this one directly, because accepting by naming book indexes in a
     * request would be the handshake with the handshake taken out.
     */
    accept_offer: 'run by the queue when a seller accepts, never called by a screen',
    /*
     * SHIPPED AHEAD OF ITS SCREEN, ON PURPOSE. Minting the codes that make a
     * printed ticket provable. The screen that calls it is the printing one,
     * which lands with the rendering in the next step — and the handler goes
     * first so that the day tickets start carrying codes is not also the day
     * the table, the handler and the screen are all new at once.
     *
     * REMOVE THIS LINE in the commit that adds the printing screen. The check
     * below runs in both directions, so a name left here after its screen
     * exists fails rather than lingering.
     */
    generate_tickets: 'the printing screen calls it; shipped one step ahead of that screen',
  }

  const idx = read('supabase/functions/api/index.ts')
  const registered = [...idx.matchAll(/^ {2}([a-z_]+):\s*\{[^}]*\bfn:\s*/gm)].map((m) => m[1])
  ok(registered.length > 40, `${registered.length} actions are registered`)

  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
  // Everything the app is, EXCEPT the action list itself — which names every
  // action by definition and would make this test pass on any of them.
  const app = walk(join(root, 'src'))
    .filter((f) => /\.(vue|js)$/.test(f) && !f.endsWith('supabaseApi.js'))
    .map((f) => readFileSync(f, 'utf8')).join('\n')
  const named = new Set([...app.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))

  const orphans = registered.filter((a) => !named.has(a) && !(a in NO_SCREEN_YET))
  ok(orphans.length === 0,
     `every registered action is reachable from a screen — unreachable: ${orphans.join(', ')}`)

  // And the list stays honest in the other direction: a name left here after
  // somebody wires it up is a debt that has been paid and is still being read
  // as owed.
  const wired = Object.keys(NO_SCREEN_YET).filter((a) => named.has(a))
  ok(wired.length === 0,
     `nothing on the not-built-yet list is actually built — remove: ${wired.join(', ')}`)
}

console.log('6. and the trap is not walked into again: nothing sold is not a count-in')
{
  /*
   * THE SAME FREEZE, REPORTED FROM THE OTHER END, after everything above
   * shipped. A book came back with every ticket still in it. It was counted in
   * — nothing sold, nothing handed in, "Finished · RM0", which is what the
   * screen asked for and what the screen said. All ten tickets froze with the
   * book, and the person holding them could not sell one.
   *
   * Sections 1 to 4 are the way out and the reason. This is the way IN, and it
   * is the half that matters more: the count-in was offered as the thing to do
   * at the one moment it was the wrong thing. There was no money to reconcile,
   * so it recorded nothing and cost ten sellable tickets.
   *
   * What is pinned is that the screen offers bringing the book back instead —
   * one act, no approval, and the tickets stay sellable — and that it says what
   * counting in would do before anybody presses it.
   */
  const TICKETS = Array.from({ length: 10 }, (_, i) => ({
    number: 'KS-0' + (5051 + i), book: 'Book-506', status: 'Available',
    name: '', phone: '', source: '',
  }))
  const settleStore = `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM',
         ticketPrefix: 'KS-', ticketDigits: 5, bookPrefix: 'Book-', bookDigits: 3 },
  tickets: ${JSON.stringify(TICKETS)},
  byNumber: ${JSON.stringify(Object.fromEntries(TICKETS.map((t) => [t.number, t])))},
})
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
// SettleBook tells a seller who can answer a count-in request from one with
// no account who never will. Empty: no stub here puts a seller in the list,
// and an unknown seller falls to "ask", which is what these cases assume.
export const agentMap = { value: {} }
export const api = async (action, payload) => { globalThis.__call = [action, payload]; return {} }
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
`
  const OUT = { book: 'Book-506', agentName: 'Kee Thang', status: 'Out' }

  const { ctx, cleanup } = await setupOf('src/components/modals/SettleBook.vue', settleStore, { book: OUT })
  ctx.wholeBookBack()
  ok(ctx.sold.value === 0, 'the whole book came back, so nothing sold')
  ok(ctx.nothingSold.value, 'and the screen knows it')
  ok(ctx.putBackInstead.value, 'and that bringing it back is the act, not closing it')

  globalThis.__call = null
  await ctx.putBack()
  ok(globalThis.__call?.[0] === 'return_books',
     `it brings the book back rather than settling it (called ${globalThis.__call?.[0]})`)
  ok(globalThis.__call?.[1]?.fromBook === 'Book-506' &&
     globalThis.__call?.[1]?.toBook === 'Book-506', 'that one book, both ends of the range')
  cleanup()

  // A book already handed back needs nothing doing at all — it is on the desk
  // and free — so there is no second act to offer, only the warning.
  const { ctx: back, cleanup: c2 } = await setupOf('src/components/modals/SettleBook.vue',
    settleStore, { book: { ...OUT, status: 'Returned' } })
  back.wholeBookBack()
  ok(back.nothingToCount.value, 'a returned book with nothing sold has nothing to count in')
  ok(!back.putBackInstead.value, 'and nothing to bring back — it is already back')
  c2()
}

console.log('7. and it says so on the screen, before the press')
{
  const TICKETS = Array.from({ length: 10 }, (_, i) => ({
    number: 'KS-0' + (5051 + i), book: 'Book-506', status: 'Available',
    name: '', phone: '', source: '',
  }))
  const settleStore = `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM',
         ticketPrefix: 'KS-', ticketDigits: 5, bookPrefix: 'Book-', bookDigits: 3 },
  tickets: ${JSON.stringify(TICKETS)},
  byNumber: ${JSON.stringify(Object.fromEntries(TICKETS.map((t) => [t.number, t])))},
})
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
// SettleBook tells a seller who can answer a count-in request from one with
// no account who never will. Empty: no stub here puts a seller in the list,
// and an unknown seller falls to "ask", which is what these cases assume.
export const agentMap = { value: {} }
export const api = async () => ({})
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
`
  const html = await renderScreen('src/components/modals/SettleBook.vue', settleStore, {
    props: { book: { book: 'Book-506', agentName: 'Kee Thang', status: 'Out' } },
    drive: (b) => b.wholeBookBack(),
  })
  const said = visibleText(html)
  ok(/Nothing sold in this book/i.test(said), 'the screen says nothing sold')
  ok(/freeze with it|frozen/i.test(said), 'and that the tickets freeze with the book')
  ok(/back on the shelf/i.test(said), 'and names the way out, as the ticket screen does')
  ok(/Mark it brought back/.test(said), 'and offers the act that is actually being asked for')
  // Case-insensitive, because the sentence grew a prefix: a book still out with
  // its seller is COUNTED IN BY THEM now, so the desk asks rather than decides
  // and the button says so. The point of the line is unchanged — the count-in is
  // still reachable for whoever means it, and it is not the obvious press.
  ok(/count it in anyway/i.test(said),
     'with the count-in still there for whoever means it, and no longer the obvious press')
  ok(!/Finish this book/.test(said),
     'so the button that reads as the ordinary next step is not what a nought-value count-in looks like')
}

console.log('8. the way back on the shelf is on the book it is about')
{
  /*
   * REPORTED AGAIN AFTER 1 TO 5 SHIPPED, by somebody looking at exactly the
   * book sheet. The way out existed — on another screen, under "Other things
   * you can do", as a range you type the book's number into. They did not find
   * it, and reported that an organiser could not put the book back at all.
   *
   * A way out that asks you to re-identify the book you are already looking at
   * is one most people will not use. So it is on the book, and the sheet says
   * what happened to the tickets rather than leaving a greyed-out button to
   * explain itself.
   */
  const detailStore = `
import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { ticketsPerBook: 10, currency: 'RM' }, books: [], agents: [],
  tickets: [], user: { email: 'org@x.com' } })
export const isAdmin = computed(() => true)
export function go() {}
export function bookBlock() { return 'book is settled' }
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
export const agentMap = computed(() => ({}))
export function toast() {}
export const isSold = (t) => /^(Sold|Donated)$/.test(String(t?.status || ''))
// The sheet asks what the SELLER owes when a counted-in book still shows a
// shortfall, because money handed over mid-book sits against no book and would
// otherwise be drawn as a debt nobody has. This book is square, so the read is
// never reached; the export is here because esbuild resolves imports, not calls.
export const api = async () => ({})
`
  const BOOK = {
    book: 'Book-084', firstTicket: 'KS-00831', lastTicket: 'KS-00840',
    agentName: 'JOHN', agentId: 'A001', status: 'Settled', countedIn: true,
    sold: 0, expected: 0, paid: 0, variance: 0, missingContact: 0, available: 10,
  }
  const said = visibleText(await renderScreen('src/components/modals/BookDetail.vue',
    detailStore, { props: { book: BOOK } }))
  ok(/Put it back on the shelf/.test(said), 'the book sheet carries the way out')
  ok(/10 tickets in this book never sold/.test(said),
     'and says what happened to the tickets, which is the question somebody arrives with')
  ok(/keeps its buyer/.test(said), 'and that the sales in it are not touched by putting it back')

  // A book nobody is stuck on must not grow a control that undoes a settlement
  // beside the one that performs it.
  const out = visibleText(await renderScreen('src/components/modals/BookDetail.vue',
    detailStore, { props: { book: { ...BOOK, status: 'Out', countedIn: false, available: 10 } } }))
  ok(!/Put it back on the shelf/.test(out), 'a book still out does not offer it')
  ok(!/never sold/.test(out), 'and is not described as stuck')

  const app = read('src/App.vue')
  ok(/@restock="b => openModal\('bookaction', \{ kind: 'restock', book: b\.book \}\)"/.test(app),
     'the app opens the shelf sheet on it — an emit nobody listens for is a dead button')

  // And it arrives filled in. Being sent to a range picker to type the number of
  // the book you just pressed is the same dead end one step along.
  const { ctx, cleanup } = await setupOf('src/components/modals/BookAction.vue',
    `import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { currency: 'RM', ticketsPerBook: 10 }, agents: [], books: [] })
export const api = async () => ({})
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
`, { kind: 'restock', book: 'Book-084' })
  ok(ctx.from.value === '84' && ctx.to.value === '84',
     `the sheet opens on that book alone (${ctx.from.value}–${ctx.to.value})`)
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
