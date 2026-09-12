/**
 * Turning what somebody typed into the exact ticket number stored in the sheet.
 *
 * The settlement screen is why this is its own file. That list is the tickets
 * an agent physically handed back, and anything NOT on it counts as sold and is
 * charged to them. A number that fails to resolve does not error — it moves one
 * ticket to the sold side and adds its price to what a volunteer owes.
 *
 * So the rule here is not "be forgiving". It is: resolve confidently, or return
 * nothing and let the screen say so. A wrong guess costs somebody money.
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}

const { state, reindex } = await import('../src/lib/store.js')
const { resolveTicketNumber, bookNumber } = await import('../src/lib/books.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

// The live shape: KS- with five digits.
state.cfg = { ticketPrefix: 'KS-', ticketDigits: 5, ticketStart: 1, totalTickets: 200,
  ticketsPerBook: 10, bookPrefix: 'Book-', bookDigits: 4, ticketPrice: 10, currency: 'RM' }
state.agents = []; state.books = []
state.tickets = []
for (let i = 1; i <= 200; i++) {
  state.tickets.push({
    number: 'KS-' + String(i).padStart(5, '0'),
    status: 'Available', book: 'Book-' + String(Math.ceil(i / 10)).padStart(4, '0'),
    name: '', phone: '', zone: '', agent: '', version: 1
  })
}
reindex()

console.log('the exact number')
eq(resolveTicketNumber('KS-00003'), 'KS-00003', 'as stored')
eq(resolveTicketNumber('ks-00003'), 'KS-00003', 'lower case')
eq(resolveTicketNumber('  KS-00003  '), 'KS-00003', 'with spaces')

console.log('a dropped leading zero — the money case')
eq(resolveTicketNumber('KS-3'), 'KS-00003', 'KS-3 is KS-00003')
eq(resolveTicketNumber('KS-003'), 'KS-00003', 'KS-003 too')
eq(resolveTicketNumber('3'), 'KS-00003', 'bare 3')
eq(resolveTicketNumber('03'), 'KS-00003', 'and 03')
eq(resolveTicketNumber('KS-00117'), 'KS-00117', 'a longer one unchanged')
eq(resolveTicketNumber('117'), 'KS-00117', 'and unpadded')

console.log('what must NOT resolve')
eq(resolveTicketNumber('KS-99999'), null, 'a number past the end of the raffle')
eq(resolveTicketNumber('999'), null, 'unpadded past the end')
eq(resolveTicketNumber(''), null, 'nothing typed')
eq(resolveTicketNumber('   '), null, 'only spaces')
eq(resolveTicketNumber(null), null, 'null')
eq(resolveTicketNumber('abc'), null, 'letters alone')
eq(resolveTicketNumber('KS-'), null, 'a prefix with no number')

console.log('ambiguity is refused, never guessed')
{
  // "13" ends the digits of KS-00013 and KS-00113. The padded form wins because
  // it is exact; that is the confident answer.
  eq(resolveTicketNumber('13'), 'KS-00013', 'the padded form is exact, so it wins')

  // But a trailing fragment matching several tickets with no exact padded form
  // must return nothing rather than pick whichever sits first in the sheet.
  const saved = state.tickets
  state.tickets = [
    { number: 'KS-00113', status: 'Available', book: 'Book-0012', name:'', phone:'', zone:'', agent:'', version:1 },
    { number: 'KS-00213', status: 'Available', book: 'Book-0022', name:'', phone:'', zone:'', agent:'', version:1 }
  ]
  reindex()
  eq(resolveTicketNumber('13'), null, 'two tickets end in 13 and neither is exact — refuse')
  eq(resolveTicketNumber('113'), 'KS-00113', 'one match is fine')
  state.tickets = saved
  reindex()
}

console.log('the settlement list, end to end')
{
  const typed = ['KS-00003', 'KS-4', '5', '99999', 'abc']
  const resolved = typed.map(resolveTicketNumber)
  eq(resolved[0], 'KS-00003', 'exact')
  eq(resolved[1], 'KS-00004', 'dropped zero')
  eq(resolved[2], 'KS-00005', 'bare digit')
  eq(resolved[3], null, 'out of range is refused')
  eq(resolved[4], null, 'nonsense is refused')

  const bad = typed.filter(t => !resolveTicketNumber(t))
  eq(bad.length, 2, 'two entries would be shown back rather than sent')
  ok(bad.includes('99999') && bad.includes('abc'), 'and they are the right two')

  // Three of ten came back, so seven sold — not eight, which is what counting
  // an unresolved entry as returned would have produced.
  const good = typed.length - bad.length
  eq(10 - good, 7, 'seven sold, and the agent owes for seven')
}

console.log('book numbers use the same discipline')
eq(bookNumber('1'), 'Book-0001', 'padded to four')
eq(bookNumber('Book-0373'), 'Book-0373', 'already padded')
eq(bookNumber(''), '', 'nothing typed')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
