/*
 * What the Sell screen offers an organiser before they type.
 *
 * THE REPORT THAT PROMPTED THIS: "for organiser too — add available tickets and
 * books". A seller opening Sell gets YourStock, their own numbers, tappable. An
 * organiser got a blank box, because YourStock renders nothing for somebody who
 * holds no books and says so in its own header. Holding no books is not having
 * nothing to sell — the office holds the rest of the raffle — so the only way to
 * find a free number was to type one and be told no.
 *
 * THE ASSERTION THAT MATTERS is not that the panel appears. It is that what it
 * OFFERS and what the screen would REFUSE are the same set. The panel derives
 * from sellBlock, the function Sell already calls before a sale, so a number can
 * only appear here when pressing it works. A recommendation that leads to a
 * refusal is worse than no recommendation: it spends somebody's trust and then
 * takes it back, and they stop reading the panel. Case 3 is that guarantee, and
 * it is the one that fails if anybody re-derives "looks free" independently.
 */
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/*
 * sellBlock is the real rule in miniature: a ticket is blocked when its book is
 * out with a seller. Stubbed rather than imported because the component must be
 * shown to ASK, and a stub that answers differently from the tickets is how we
 * find out whether it does.
 */
const STORE = (user, tickets, books) => `
import { reactive, computed } from 'vue'
export const state = reactive({
  user: ${JSON.stringify(user)},
  tickets: ${JSON.stringify(tickets)},
  books: ${JSON.stringify(books)},
  cfg: { ticketsPerBook: 10, currency: 'RM' },
})
export function isSold(t) { return t.status === 'Sold' || t.status === 'Donated' }
export function sellBlock(t) {
  const b = state.books.find((x) => x.book === t.book)
  return b && b.status === 'Out' ? 'out with a seller' : null
}
export const isAdmin = computed(() => true)
export function go() {}
export function toast() {}
`

const BOOKS = [
  { book: 'Book-001', status: 'Unassigned', agentId: '', available: 2 },
  { book: 'Book-002', status: 'Out', agentId: 'A001', agentName: 'KUI', available: 2 },
  { book: 'Book-003', status: 'Unassigned', agentId: '', available: 0 },
]
const TICKETS = [
  { number: 'KS-00001', book: 'Book-001', status: 'Available' },
  { number: 'KS-00002', book: 'Book-001', status: 'Available' },
  { number: 'KS-00011', book: 'Book-002', status: 'Available' },
  { number: 'KS-00012', book: 'Book-002', status: 'Available' },
  { number: 'KS-00021', book: 'Book-003', status: 'Sold' },
]

const ORGANISER = { role: 'admin', agentId: '', email: 'org@x.com' }
const SELLER = { role: 'agent', agentId: 'A001', email: 'kui@x.com' }

const panel = async (user, tickets = TICKETS, books = BOOKS) =>
  renderScreen('src/components/ui/DeskStock.vue', STORE(user, tickets, books))

/*
 * PRESENCE IS ASKED OF THE MARKUP, NOT OF THE HEADING. The title goes through
 * <Bi text="...">, and this harness renders a component's slots rather than its
 * props, so the heading is never in visibleText however correct the screen is.
 * bookdetail.test.mjs was caught by the same thing. Keying on the panel's own
 * class asks whether it drew, which is the actual question.
 */
const drew = (html) => /class="[^"]*\bdesk\b/.test(html)

console.log('1. an organiser is told what is free before they type')
{
  const html = await panel(ORGANISER)
  const text = visibleText(html)
  ok(drew(html), 'the panel is there for an organiser')
  ok(/KS-00001/.test(text) && /KS-00002/.test(text),
     `both free numbers are offered (${text.slice(0, 90)})`)
  /* Re-aimed, not weakened: the wording became "still to sell" when the two
     office figures were joined into one line. The invariant is unchanged —
     the size of the job is stated, so nobody counts tiles. */
  ok(/2 still to sell/.test(text), 'and counted, so the size of the job is visible without counting tiles')
}

console.log('2. a seller sees nothing here, because YourStock is their panel')
{
  const html = await panel(SELLER)
  ok(!drew(html), 'the desk panel does not draw for somebody holding books')
  ok(!/KS-00001/.test(visibleText(html)), 'and offers them nothing')
}

console.log('3. it never offers a ticket the screen would refuse')
{
  /*
   * KS-00011 and KS-00012 are unsold and in Book-002, which is out with KUI.
   * Selling one at the desk hands a buyer a number with no ticket behind it, and
   * sellBlock refuses it. If this panel ever lists them, the recommendation and
   * the refusal have come apart — which is the whole failure this test exists
   * for. Mutation-check: drop the !sellBlock(t) filter in DeskStock and this
   * fails while cases 1 and 2 stay green.
   */
  const text = visibleText(await panel(ORGANISER))
  ok(!/KS-00011/.test(text) && !/KS-00012/.test(text),
     'a ticket in a book that is out with a seller is not offered')
  ok(/2 tickets are out with sellers/.test(text),
     `but it is counted and named, not silently dropped (${text.slice(-120)})`)
  ok(!/4 to sell/.test(text),
     'and never folded into one "available" figure that means two different things')
  /*
   * "What have we got left?" is ONE question and used to need two readings —
   * the count at the top of the panel and the count below the pager, added up
   * by the person on the telephone. Both figures sit on one line now. Pinned
   * because the composition is the card, and splitting them again would be
   * invisible to every other assertion here: each number would still be
   * present and still be correct.
   */
  ok(/2 still to sell, in 1 book · 2 tickets are out with sellers/.test(text),
     `both office figures read as one sentence (${text.slice(0, 80)})`)
}

console.log('4. the books nobody is holding are named as runs')
{
  const text = visibleText(await panel(ORGANISER))
  ok(/2 books have not gone out yet/.test(text),
     `the free books are counted (${text.slice(0, 140)})`)
  ok(/1/.test(text) && /3/.test(text),
     'and shown as runs, which is what somebody is asked on the telephone')
}

console.log('5. an empty office says so rather than drawing an empty box')
{
  const allOut = BOOKS.map((b) => ({ ...b, status: 'Out', agentId: 'A001' }))
  const text = visibleText(await panel(ORGANISER, TICKETS, allOut))
  ok(/Nothing in the office is free to sell/.test(text),
     'it says the office is empty in words')
  ok(!/\bto sell, in\b/.test(text), 'rather than showing a count of nothing')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
