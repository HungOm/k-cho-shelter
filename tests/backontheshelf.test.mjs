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
import { renderScreen, visibleText } from './screen.mjs'

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

  // The server refuses to restock a book still owing money, and names them.
  ok(/MONEY_STILL_OWED/.test(sheet),
     'a refusal that names which books still owe is shown as that list, not one sentence')
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
    agent_statement: "a seller's statement can be produced but not asked for",
    chase_today: 'the chase list exists as a handler only',
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
