/*
 * Searching books, on the two screens that offer it.
 *
 * search.test.mjs proves the MATCHING (what "31", "31-45", "KS-00131" and a
 * seller's name each find). This proves the screens USE it — the fault this
 * repository keeps paying for is a helper that is correct, tested, and never
 * called, so the question here is whether a person typing into the box sees
 * the books come and go.
 *
 *   Books    a search box narrows the list; an empty result says what it looked
 *            for and offers the way back; nothing typed leaves the list alone.
 *   Find     matching books appear above the tickets, a few at a time, with a
 *            way to the rest — and not under a ticket-status filter, where
 *            "Sold" means nothing for a book.
 */
import { renderScreen } from './screen.mjs'
import { cleanup } from './loadts.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const pad = (n) => String(n).padStart(4, '0')
const book = (n, extra = {}) => ({
  book: 'Book-' + pad(n), firstTicket: 'KS-' + String((n - 1) * 10 + 1).padStart(5, '0'),
  lastTicket: 'KS-' + String(n * 10).padStart(5, '0'), status: 'Unassigned',
  agentId: '', agentName: '', offeredTo: '', sold: 0, daysOverdue: 0, ...extra,
})
const withMana = (n) => book(n, { status: 'Out', agentId: 'A001', agentName: 'Mana Kee' })

/** A store stub both screens can import from. `s` overrides state fields. */
const store = (s = {}) => `
import { reactive, computed } from 'vue'
export const state = reactive(Object.assign({
  cfg: { currency: 'RM', ticketsPerBook: 10, ticketStart: 1, ticketDigits: 5, ticketPrefix: 'KS-', bookPrefix: 'Book-', bookDigits: 4 },
  agents: [{ id: 'A001', name: 'Mana Kee', zone: 'CCFM', active: true }],
  tickets: [], books: [], user: { role: 'admin' },
  query: '', bookQuery: '', filterStatus: '', filterAgent: '', filterWhere: '',
}, ${JSON.stringify(s)}))
export const searchResults = computed(() => ({ results: [], total: 0, truncated: false }))
export const agentMap = computed(() => ({ A001: { id: 'A001', name: 'Mana Kee' } }))
export const whereIs = () => null
export const isSold = () => false
export const sellBlock = () => null
export const api = async () => ({})
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const go = () => {}
`
const REAL = { renderReal: ['BookRow.vue', 'BookSearchBox.vue'] }

console.log('the Books screen has a search box')
{
  const books = [book(1), book(2), withMana(13), book(31)]
  const all = await renderScreen('src/components/Books.vue', store({ books }), REAL)
  ok(/aria-label="Search books"/.test(all), 'the box is there and named for a screen reader')
  ok(/placeholder="Book number/.test(all), 'and says what it takes')
  ok(['Book-0001', 'Book-0002', 'Book-0013', 'Book-0031'].every((b) => all.includes(b)),
    'nothing typed lists every book')
  ok(!/>Clear<\/button>/.test(all), 'and there is no Clear button while the box is empty')

  const by = await renderScreen('src/components/Books.vue', store({ books, bookQuery: 'Mana' }), REAL)
  ok(by.includes('Book-0013') && !by.includes('Book-0001') && !by.includes('Book-0031'),
    'a seller\'s name narrows the list to their books')
  ok(/>Clear<\/button>/.test(by), 'and a Clear button appears')

  const num = await renderScreen('src/components/Books.vue', store({ books, bookQuery: 'book 31' }), REAL)
  ok(num.includes('Book-0031') && !num.includes('Book-0002'), 'a book number finds that book')

  const run = await renderScreen('src/components/Books.vue', store({ books, bookQuery: '1-2' }), REAL)
  ok(run.includes('Book-0001') && run.includes('Book-0002') && !run.includes('Book-0031'),
    'a bare range of numbers finds a run of books')

  const none = await renderScreen('src/components/Books.vue', store({ books, bookQuery: 'zzzzzz' }), REAL)
  ok(!none.includes('Book-0001'), 'a search that matches nothing lists no books')
  ok(/Try a book number, a run such as 31-45/.test(none), 'and says how to search instead of "Nothing here"')
}

console.log('Find shows matching books above the tickets')
{
  const books = [book(1), withMana(13), withMana(14)]
  const hit = await renderScreen('src/components/Search.vue', store({ books, query: 'Mana' }), REAL)
  ok(/2 books/.test(hit), 'it says how many books matched')
  ok(hit.includes('Book-0013') && hit.includes('Book-0014') && !hit.includes('Book-0001'),
    'and lists the ones that did')
  ok(!/See all in Books/.test(hit), 'with no "see all" when they all fit')

  const many = Array.from({ length: 7 }, (_, i) => withMana(i + 10))
  const lots = await renderScreen('src/components/Search.vue', store({ books: many, query: 'Mana' }), REAL)
  ok(/7 books/.test(lots), 'seven matching books are counted')
  ok((lots.match(/class="item"/g) || []).length === 5, 'but only five are listed')
  ok(/See all in Books/.test(lots), 'with a way to the rest')

  const quiet = await renderScreen('src/components/Search.vue', store({ books }), REAL)
  ok(!/ books?<\/h3>/.test(quiet) && !quiet.includes('Book-0013'), 'nothing typed shows no books')

  const sold = await renderScreen('src/components/Search.vue',
    store({ books, query: 'Mana', filterStatus: 'Sold' }), REAL)
  ok(!sold.includes('Book-0013'), 'a ticket-status filter hides the books: "Sold" is not a book state')

  const seller = await renderScreen('src/components/Search.vue',
    store({ books, filterAgent: 'A001' }), REAL)
  ok(seller.includes('Book-0013'), 'a seller filter alone lists the books they hold')

  // Tickets exist but none match (the stub's searchResults is empty), so this is
  // the "nothing matches" branch and not "no tickets yet". Its sentence is slot
  // content, which is what the harness can see; the title is a prop it cannot.
  const nothing = await renderScreen('src/components/Search.vue',
    store({ books, query: 'zzzzzz', tickets: [{ number: 'KS-00001', book: 'Book-0001', status: 'Available' }] }), REAL)
  ok(/Try the last few numbers on the ticket/.test(nothing) && !nothing.includes('Book-0013'),
    'a query nothing matches still gets the ticket help and lists no books')
}


/** Home reads a lot of derived values; none of them matter to the grid, so they are inert. */
const homeStore = (s = {}) => store({ problems: [], needsSetup: false, loadProgress: null, ...s }) + `
export const overview = computed(() => null)
export const attention = computed(() => [])
export const gettingStarted = computed(() => null)
`

console.log('the Home grid has a search box too')
{
  const books = [book(1), book(2), withMana(13), book(31)]
  const all = await renderScreen('src/components/Home.vue', homeStore({ books }), REAL)
  ok(/aria-label="Search books"/.test(all), 'the box is on the dashboard')
  ok(!/books match/.test(all), 'and says nothing about matches until something is typed')

  const by = await renderScreen('src/components/Home.vue', homeStore({ books, bookQuery: 'Mana' }), REAL)
  ok(/>1<\/b>\s*of 4 books match/.test(by.replace(/<!--[\s\S]*?-->/g, '')),
    'a search says how many of the books match, so a narrowed grid is not read as a short raffle')
  ok(/>Clear<\/button>/.test(by), 'with a Clear button')

  const none = await renderScreen('src/components/Home.vue', homeStore({ books, bookQuery: 'zzzzzz' }), REAL)
  ok(/try a book number, a run such as 31-45/.test(none), 'a search that matches nothing says how to search')

  const empty = await renderScreen('src/components/Home.vue', homeStore({ books: [] }), REAL)
  ok(!/aria-label="Search books"/.test(empty), 'no box before there are any books to look through')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
