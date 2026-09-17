/**
 * Where a ticket physically is, as distinct from whether it has been sold.
 *
 * These two questions are different and the app used to answer only the second.
 * An unsold ticket in a book somebody is carrying showed as "Not sold yet",
 * which an organiser reads as "free to sell" — when it is 200km away and may
 * already have been sold on paper without anybody writing it down.
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}

const { state, reindex, whereIs, bookHolders, searchResults, sellBlock } = await import('../src/lib/store.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

state.cfg = { ticketPrefix: 'KS-', ticketDigits: 4, ticketStart: 1, totalTickets: 40,
  ticketsPerBook: 10, bookPrefix: 'Book-', bookDigits: 3, ticketPrice: 10, currency: 'RM' }
state.agents = [
  { id: 'A001', name: 'KUI', phone: '0123456789', active: true },
  { id: 'A002', name: 'Pa Thang', phone: '0119999999', active: true }
]
// Book 1: out with KUI. Book 2: in the office. Book 3: brought back. Book 4: lost.
state.books = [
  { book: 'Book-001', status: 'Out', agentId: 'A001', agentName: 'KUI' },
  { book: 'Book-002', status: 'Unassigned', agentId: '', agentName: '' },
  { book: 'Book-003', status: 'Returned', agentId: 'A002', agentName: 'Pa Thang' },
  { book: 'Book-004', status: 'Lost', agentId: 'A002', agentName: 'Pa Thang' }
]
state.tickets = []
for (let i = 1; i <= 40; i++) {
  const book = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0')
  // KUI has recorded two sales out of book 1; the other eight are unrecorded.
  const sold = i === 1 || i === 2
  state.tickets.push({
    number: 'KS-' + String(i).padStart(4, '0'),
    status: sold ? 'Sold' : 'Available',
    book,
    name: sold ? 'Ma Nu' : '', phone: sold ? '0123456789' : '', zone: '',
    agent: sold ? 'A001' : '',        // only set when it SELLS
    version: 1
  })
}
reindex()

console.log('a ticket knows where it is, even unsold')
{
  const t = state.tickets[4]                       // KS-0005, unsold, book 1
  const w = whereIs(t)
  ok(w, 'resolves')
  ok(w.out, 'book 1 is out')
  eq(w.agentName, 'KUI', 'and KUI has it')
  eq(t.agent, '', 'while the ticket itself records no seller — that is the gap')
}
{
  const w = whereIs(state.tickets[14])             // book 2, in the office
  ok(!w.out, 'book 2 is not out')
  eq(w.status, 'Unassigned', 'it is in the office')
}
{
  eq(whereIs(state.tickets[24]).status, 'Returned', 'book 3 was brought back')
  eq(whereIs(state.tickets[34]).status, 'Lost', 'book 4 is lost')
  ok(!whereIs({ book: 'Book-999' }), 'a book that does not exist resolves to nothing')
}

console.log("searching a seller's name finds their whole stock")
{
  state.query = 'KUI'; state.filterStatus = ''; state.filterAgent = ''; state.filterWhere = ''
  const r = searchResults.value
  eq(r.total, 10, 'all ten tickets in the book KUI is holding, not just the two sold')
  ok(r.results.some(t => t.status === 'Available'), 'including the unsold ones')
}

console.log('filtering by seller means everything to do with them')
{
  state.query = ''; state.filterAgent = 'A001'
  eq(searchResults.value.total, 10, 'ten — the whole book they hold')
  state.filterAgent = 'A002'
  eq(searchResults.value.total, 20, 'books 3 and 4 between them')
  state.filterAgent = ''
}

console.log('filtering by where it physically is')
{
  state.query = ''; state.filterWhere = 'out'
  eq(searchResults.value.total, 10, 'only book 1 is out with anybody')
  state.filterWhere = 'office'
  eq(searchResults.value.total, 30, 'the other three books are not out')
  state.filterWhere = ''
}

console.log('the dangerous case: unsold, but not actually available')
{
  state.query = ''; state.filterStatus = 'Available'; state.filterWhere = 'office'
  const trulyFree = searchResults.value.total
  state.filterWhere = ''
  const lookAvailable = searchResults.value.total
  eq(lookAvailable, 38, '38 tickets say "not sold yet"')
  eq(trulyFree, 30, 'but only 30 are actually in the office and sellable')
  ok(lookAvailable > trulyFree,
    'the difference is the eight sitting in a book somebody is carrying')
  state.filterStatus = ''
}

/*
 * The screen's copy of the rule the backend enforces.
 *
 * It exists so a helper is told while typing rather than after keying in
 * thirty stubs, and it is only a courtesy — the backend refuses either way.
 * But a courtesy that disagrees with the rule is worse than none: it either
 * blocks a sale that would have worked, or promises one that will not. So the
 * same cases are checked here as in whoholds.test.mjs.
 */
console.log('the screen says the same thing the backend will')
{
  const inBag   = state.tickets[4]    // KS-0005, book 1, out with KUI
  const shelf   = state.tickets[14]   // book 2, in the office
  const back    = state.tickets[24]   // book 3, handed back
  const lost    = state.tickets[34]   // book 4

  state.user = { role: 'recorder', agentId: null }
  ok(/KUI/.test(sellBlock(inBag) || ''), 'a helper is told who has the book')
  eq(sellBlock(shelf), null, 'and is not blocked on a book in the office')
  eq(sellBlock(back), null, 'nor on one that has been handed back')
  ok(/lost/.test(sellBlock(lost) || ''), 'but is blocked on a lost book')

  state.user = { role: 'admin', agentId: null }
  eq(sellBlock(inBag), null, 'an organiser may write down what the seller reported')
  ok(/lost/.test(sellBlock(lost) || ''), 'but a lost book is closed to them too')

  state.user = { role: 'agent', agentId: 'A001' }
  eq(sellBlock(inBag), null, 'the seller holding it is not blocked')
  /*
   * NAMES BOTH SIDES NOW, and the sentence is the point rather than its
   * wording. It used to be "not your book" — true, unanswerable, and the exact
   * words a seller met while looking at a book they were certain was theirs.
   * The two seller ids were different and no screen showed either of them, so
   * the only reading left was that the app was broken. Asserted as a property:
   * whose it is, and who the reader is.
   */
  state.user = { role: 'agent', agentId: 'A002' }
  const refused = sellBlock(inBag) || ''
  ok(/A001/.test(refused), `another seller is told whose it is (${refused})`)
  ok(/A002/.test(refused), 'and which seller the app thinks they are')

  state.user = null
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
