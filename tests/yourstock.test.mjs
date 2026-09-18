/*
 * What a seller is holding, on the screens where they need it.
 *
 * WHY THIS FILE EXISTS. The panel was reported missing from Find twice, and
 * both times the answer was a page that had not been reloaded — but proving
 * that meant rendering the component by hand at a terminal, which is not a
 * thing anybody should have to do twice. The rules it encodes are small and
 * easy to break from a distance: which books count, which tickets count, and
 * what a seller who has sold everything is told.
 *
 * IT RENDERS THE REAL COMPONENT. The screens that use it stub their children,
 * so a test against Sell or Find sees `<YourStock title="…">` as an attribute
 * and nothing inside it — which is how a panel can appear to be present in a
 * test and be empty on a phone.
 */
import { renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${what}`) } }

const store = (extra = '') => `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10, ticketsPerBook: 10 },
  agents: [{ id: 'A001', name: 'TEST' }],
  tickets: [
    { number: 'KS-00011', book: 'Book-002', status: 'Available' },
    { number: 'KS-00012', book: 'Book-002', status: 'Available' },
    { number: 'KS-00013', book: 'Book-002', status: 'Sold' },
    { number: 'KS-00014', book: 'Book-002', status: 'Reserved' },
    { number: 'KS-00021', book: 'Book-003', status: 'Available' },
    { number: 'KS-00031', book: 'Book-004', status: 'Available' },
  ],
  books: [
    { book: 'Book-002', firstTicket: 'KS-00011', lastTicket: 'KS-00020',
      status: 'Out', agentId: 'A001', agentName: 'TEST', sold: 1, available: 8 },
    { book: 'Book-003', firstTicket: 'KS-00021', lastTicket: 'KS-00030',
      status: 'Out', agentId: 'A001', agentName: 'TEST', sold: 0, available: 10 },
    // SOMEBODY ELSE'S. The panel must not offer it, and the seller cannot sell
    // from it — the server refuses, and offering it here would be inviting that.
    { book: 'Book-004', firstTicket: 'KS-00031', lastTicket: 'KS-00040',
      status: 'Out', agentId: 'A002', agentName: 'OTHER', sold: 0, available: 10 },
  ],
  user: { role: 'agent', agentId: 'A001' },
})
export const isSold = (t) => t.status === 'Sold' || t.status === 'Donated'
${extra}
`

console.log('1. a seller sees the books in their own hands, and only those')
{
  const html = await renderScreen('src/components/ui/YourStock.vue', store())
  ok(/Book-002/.test(html), 'their first book is listed')
  ok(/Book-003/.test(html), 'and their second')
  ok(!/Book-004/.test(html), "and not one that is out with somebody else")
  ok(/KS-00011/.test(html) && /KS-00020/.test(html),
     'each book shows the range it covers, which is what a seller recognises')
}

console.log('2. the numbers offered are the ones that can actually be sold')
{
  const html = await renderScreen('src/components/ui/YourStock.vue', store())
  ok(/KS-00011/.test(html), 'an available ticket is offered')
  ok(!/KS-00013/.test(html), 'a sold one is not — it is done')
  ok(!/KS-00014/.test(html),
     'nor a reserved one — that is somebody else’s promise, and tapping it would be refused')
}

console.log('3. a seller holding nothing is shown nothing, rather than an empty box')
{
  const empty = store().replace(/books: \[[\s\S]*?\n  \],/, 'books: [],')
  const html = await renderScreen('src/components/ui/YourStock.vue', empty)
  ok(!/Yours to sell|Your tickets/.test(html), 'the panel does not draw at all')
}

console.log('4. an organiser holds no books, so the panel is not for them')
{
  const asOrganiser = store().replace(
    "user: { role: 'agent', agentId: 'A001' },",
    "user: { role: 'admin', agentId: null },")
  const html = await renderScreen('src/components/ui/YourStock.vue', asOrganiser)
  ok(!/Book-002/.test(html), 'their whole raffle is not listed as "theirs"')
}

console.log('5. a seller whose books are all sold is told what to do next')
{
  const allGone = store()
    .replace(/status: 'Available'/g, "status: 'Sold'")
  const html = await renderScreen('src/components/ui/YourStock.vue', allGone)
  ok(/report back/i.test(html),
     'the empty state names the next act rather than saying "nothing here"')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
