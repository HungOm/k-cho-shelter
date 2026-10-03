/**
 * Search matching.
 *
 * These run against src/lib/search.js, the module the app actually imports.
 *
 * The spelling-tolerance cases are the point: K'Cho and Burmese names
 * transliterate inconsistently, and an exact-match-only search sends a helper
 * off to create a duplicate record for someone already in the system.
 */
import {
  fold, phoneDigits, waNumber, isDialable, closeEnough,
  buildIndex, parseBookRange, scoreEntry, runSearch, searchBooks, ticketBookOf
} from '../src/lib/search.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

// ---------------------------------------------------------------
console.log('folding names')
eq(fold('Pa Thang'), 'pa thang', 'lowercases')
eq(fold('  Pa   THANG '), 'pa thang', 'collapses whitespace')
eq(fold("K'Cho"), 'kcho', 'drops apostrophes')
/*
 * BOTH APOSTROPHES, and the curly one is the one that matters most here.
 *
 * iOS and Android autocorrect a typed ' into a curly ’, so a volunteer
 * searching on a phone — which is nearly all of them — sends the curly form,
 * while a name pasted from a spreadsheet usually carries the straight one. If
 * the fold handled only one, the two would stop matching and search would fail
 * for phone users and for nobody else, which is the hardest kind of bug to have
 * reported.
 *
 * It was already handled and not pinned: removing ’ from the fold passed the
 * whole suite. This community's names carry apostrophes constantly — K'Cho
 * itself does — so this is closer to the common case than to an edge one.
 */
eq(fold('K’Cho'), 'kcho', 'drops the curly apostrophe a phone types')
eq(fold("K’Cho Women's Group"), fold("K'Cho Women’s Group"),
   'so a name typed on a phone matches the same name pasted from a spreadsheet')
eq(fold('Za-Aung'), 'zaaung', 'drops hyphens')
// Initials and abbreviations: "U. Kyaw" written out by one person and "U Kyaw"
// by the next is the same seller. Folded and unpinned until now.
eq(fold('U. Kyaw'), 'u kyaw', 'drops full stops')
eq(fold('U. Kyaw'), fold('U Kyaw'), 'so an initial with a stop matches one without')
eq(fold('José'), 'jose', 'strips accents')
eq(fold(null), '', 'handles null')

console.log('spelling tolerance')
ok(closeEnough('thang', 'thuang'), 'Thang ~ Thuang')
ok(closeEnough('cung', 'chung'), 'Cung ~ Chung')
ok(closeEnough('biak', 'biek'), 'one letter different')
ok(!closeEnough('zaa', 'za'), 'too short to fuzzy-match — avoids false hits')
ok(!closeEnough('thang', 'mangkul'), 'unrelated names do not match')
ok(!closeEnough('sui', 'par'), 'short unrelated words do not match')

console.log('phone numbers, any format')
const want = '0123456789'
for (const form of ['012-345 6789', '0123456789', '+60123456789', '60123456789', '(012) 345-6789', '012 345 6789']) {
  eq(phoneDigits(form), want, `"${form}"`)
}
eq(phoneDigits(''), '', 'empty stays empty')
eq(waNumber('0123456789'), '60123456789', 'WhatsApp form adds the country code')
eq(waNumber('+60123456789'), '60123456789', 'already international, unchanged')

/*
 * The country code is Malaysia's, and these assertions record that as a
 * LIMITATION rather than approving of it. Raffled is meant to be reusable now,
 * and a local number from anywhere else comes out as a real Malaysian number
 * belonging to a stranger — who then receives a message naming a seller and
 * what they owe. It is pinned rather than fixed because the live raffle depends
 * on it and the country belongs in config, like the logo and the colour; the
 * point of writing it down is that the next deployment should not find out by
 * ringing the wrong person.
 */
/*
 * Absent was handled; UNUSABLE was not, and to whoever presses the button the
 * two look identical. Four sellers on the live raffle have numbers that lost
 * their leading zero, so 0123367462 is stored as 123367462 — wa.me reads that
 * as country code 1 and the chase message goes to North America.
 */
eq(isDialable('0123367462'), true, 'a local number with its leading 0 can be dialled')
eq(isDialable('+95 9 123 456 789'), true, 'so can one written in full, whatever the country')
eq(isDialable('60123367462'), true, 'and one already carrying this raffle\'s country code')
eq(isDialable('123367462'), false, 'a number with its leading 0 lost cannot — the live bug')
eq(isDialable('12336746'), false, 'nor a shorter one of the same shape')
eq(isDialable('1234567'), false, 'too few digits to be any telephone number')
// That one is refused by the unknown-country rule anyway, so it pins nothing
// about length. This is the case that isolates the floor: a leading 0 would
// otherwise be trusted, and three digits is not a phone number.
eq(isDialable('012'), false, 'a leading 0 is not enough on its own — the floor is real')
eq(isDialable('0123456'), false, 'nor is seven digits')
eq(isDialable('01234567'), true, 'eight is where a local number becomes plausible')
eq(isDialable(''), false, 'and nothing at all is not dialable either')
eq(isDialable(null), false, 'nor is a missing field')

eq(waNumber('09 123 456 789'), '609123456789',
   'LIMITATION: a Myanmar local number becomes a Malaysian one')
eq(waNumber('081-234-5678'), '60812345678',
   'LIMITATION: so does an Indonesian one')
eq(waNumber('+95 9 123 456 789'), '959123456789',
   'a number written in full international form survives, whatever the country')

console.log('book ranges')
eq(String(parseBookRange('Book-031..045')), '31,45', 'Book-031..045')
eq(String(parseBookRange('book 3 to 9')), '3,9', 'book 3 to 9')
eq(String(parseBookRange('Book-045..031')), '31,45', 'reversed range is sorted')
eq(parseBookRange('0123456789'), null, 'a phone number is not a book range')
eq(parseBookRange('KS-0721'), null, 'a ticket number is not a book range')
eq(parseBookRange('hello'), null, 'words are not a book range')

// ---------------------------------------------------------------
console.log('searching a realistic index')

const NAMES = ['Pa Thang', 'Biak Cung', 'Ning Hlei', 'Za Aung', 'Sui Par']
const agentMap = { A001: { name: 'Pa Thang' }, A002: { name: 'Biak Cung' } }
const tickets = []
for (let i = 1; i <= 200; i++) {
  const sold = i <= 60
  tickets.push({
    number: 'KS-' + String(i).padStart(4, '0'),
    status: sold ? 'Sold' : 'Available',
    book: 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0'),
    name: sold ? NAMES[i % 5] : '',
    phone: sold ? '01' + String(20000000 + i) : '',
    zone: sold ? 'Kajang' : '',
    agent: sold ? (i % 2 ? 'A001' : 'A002') : ''
  })
}
// one with an awkward spelling, to prove the fuzzy path
tickets[10].name = 'Thuang Lian'
const index = buildIndex(tickets, agentMap)

const find = (q, opts = {}) => runSearch(index, { query: q, ...opts })

// trailing digits — the way people actually remember a ticket
{
  const r = find('21')
  ok(r.results.some(t => t.number === 'KS-0021'), 'finds KS-0021 from "21"')
  ok(r.results.some(t => t.number === 'KS-0121'), 'and KS-0121 — both end in 21')
  ok(!r.results.some(t => t.number === 'KS-0210'), 'but not KS-0210')
}
eq(find('KS-0042').results[0].number, 'KS-0042', 'full number matches exactly')
eq(find('42').results[0].number, 'KS-0042', 'exact-length digits rank first')

// names
ok(find('thang').total > 0, 'finds a name')
ok(find('THANG').total > 0, 'case does not matter')
{
  // "Thang" should also reach the row spelled "Thuang"
  const r = find('thuang')
  ok(r.results.some(t => t.name === 'Thuang Lian'), 'exact spelling found')
  const r2 = find('thaung')
  ok(r2.results.some(t => t.name === 'Thuang Lian'), 'a misspelling still finds Thuang')
}

// phone
{
  const t = tickets[4]           // KS-0005, phone 0120000005
  const r = find(t.phone)
  ok(r.results.some(x => x.number === t.number), 'finds by full phone number')
  const r2 = find('012-000 0005')
  ok(r2.results.some(x => x.number === t.number), 'finds the same person written differently')
}

// books
eq(find('Book-003').total, 10, 'a single book returns its 10 tickets')
eq(find('Book-001..003').total, 30, 'a range returns 3 books')
eq(find('book 1 to 2').total, 20, 'range in plain words')

// filters
eq(find('', { status: 'Sold' }).total, 60, 'status filter alone')
eq(find('', { agent: 'A001' }).total, 30, 'agent filter alone')
{
  const r = find('Book-001', { status: 'Available' })
  ok(r.total === 0, 'book 1 is entirely sold, so no available tickets')
  const r2 = find('Book-020', { status: 'Available' })
  eq(r2.total, 10, 'book 20 is entirely unsold')
}

// nothing
eq(find('zzzzzz').total, 0, 'gibberish finds nothing')
eq(find('9999').total, 0, 'a number out of range finds nothing')

console.log('scoring order')
{
  // An exact ticket number must beat a name or zone match.
  const e = index.find(x => x.t.number === 'KS-0042')
  ok(scoreEntry(e, 'ks0042', '0042', null) === 100, 'exact ticket scores highest')
  ok(scoreEntry(e, 'kajang', '', null) === 30, 'zone scores low')
}

/* ---------------------------------------------------------------
 * BOOKS. The same search, over the book list. Built from a fixture shaped like
 * the real wire row (bookWire in the Edge Function) at the real scale: 2,000
 * books of ten, KS- tickets to five digits, which is where the number-ending and
 * whole-ticket cases are different from a 30-book toy.
 */
console.log('searching books')
{
  const agents = { A001: { name: 'Mana Kee' }, A002: { name: 'Shwe Thuang' } }
  const pad = (n, w) => String(n).padStart(w, '0')
  const books = Array.from({ length: 2000 }, (_, i) => {
    const n = i + 1
    return {
      book: 'Book-' + pad(n, 4),
      firstTicket: 'KS-' + pad((n - 1) * 10 + 1, 5),
      lastTicket: 'KS-' + pad(n * 10, 5),
      status: 'Unassigned', agentId: '', agentName: '', offeredTo: '',
    }
  })
  // Book 13 is out with Mana; Book 14 is out with Shwe; Book 15 is offered to Shwe.
  Object.assign(books[12], { status: 'Out', agentId: 'A001', agentName: 'Mana Kee' })
  Object.assign(books[13], { status: 'Out', agentId: 'A002', agentName: 'Shwe Thuang' })
  Object.assign(books[14], { status: 'Offered', offeredTo: 'A002' })
  const sb = (query, extra = {}) => searchBooks(books, { query, agents, ...extra })
  const nums = (r) => r.results.map(b => b.book)

  // The number, however it is written
  for (const form of ['31', '031', '0031', 'book 31', 'Book-031', 'Book-0031', 'b31']) {
    ok(nums(sb(form))[0] === 'Book-0031', `"${form}" finds Book-0031 first`)
  }
  eq(nums(sb('book 31')).length, 1, '"book 31" is that one book and not every book ending in 31')
  ok(nums(sb('31'))[0] === 'Book-0031' && nums(sb('31')).includes('Book-0131'),
    'a bare number also finds the books whose number ends that way, exact one first')
  eq(sb('31', { tail: false }).total, 1, 'with tail off (the Find screen) only the exact book')
  // WAS: eq(sb('9999').total, 0, 'a book that is not in the raffle finds nothing')
  // WHY CHANGED: 9999 is not a book but it IS a ticket (in book 1000), and a
  // number that is no book is now read as a ticket. The case this guarded — a
  // number the raffle does not contain finds nothing — is a number past the last
  // ticket, 20,000 here.
  eq(sb('99999').total, 0, 'a number past the last book and the last ticket finds nothing')
  eq(nums(sb('9999'))[0], 'Book-1000', 'while 9999, which is no book, finds the book holding that ticket')

  // A run of books, with and without the word "book"
  eq(sb('31-45').total, 15, 'a bare range names books on this screen')
  eq(sb('book 31 to 45').total, 15, 'and in words')
  eq(sb('45-31').total, 15, 'and backwards')
  eq(sb('31-45').results[0].book, 'Book-0031', 'in book order')
  eq(parseBookRange('3291-3300'), null, 'but the ticket screen still does not take it for books')
  eq(parseBookRange('KS-03291-KS-03300', { bare: true }), null,
    'and a range of ticket numbers is never a range of books, even bare')

  // A ticket names the book it is printed in
  eq(nums(sb('KS-00131'))[0], 'Book-0014', 'a whole ticket number finds its book (ticket 131 is in book 14)')
  eq(nums(sb('00131'))[0], 'Book-0014', 'and so do just its five digits')
  ok(nums(sb('131'))[0] === 'Book-0131', 'three digits is a BOOK, not a ticket: book 131 beats the ticket')

  // Sellers
  eq(nums(sb('Mana'))[0], 'Book-0013', 'a seller\'s name finds the book they hold')
  eq(nums(sb('A001'))[0], 'Book-0013', 'and so does their ID')
  ok(nums(sb('shwe')).includes('Book-0014') && nums(sb('shwe')).includes('Book-0015'),
    'a seller\'s name finds a book waiting on them as well as one they hold')
  eq(nums(sb('Shwe'))[0], 'Book-0014', 'held ranks above offered')
  ok(nums(sb('thaung')).includes('Book-0014'), 'a misspelt name still finds them (Thuang)')
  eq(sb('zzzzzz').total, 0, 'gibberish finds nothing')

  // Filters, which are the same words as for tickets
  eq(sb('', { status: 'Out' }).total, 2, 'status alone')
  eq(sb('', { agent: 'A002' }).total, 2, 'a seller alone: held and offered')
  eq(sb('', { where: 'out' }).total, 2, 'out with a seller')
  eq(sb('', { where: 'office' }).total, 1998, 'and in the office')
  eq(sb('', { agent: 'A001' }).results[0].book, 'Book-0013', 'a seller alone lists their books')
  eq(sb('Shwe', { where: 'out' }).total, 1, 'a name and a filter together')
  eq(sb('').total, 2000, 'nothing typed is every book')
  eq(sb('', { limit: 5 }).results.length, 5, 'limit caps what is returned')
  eq(sb('', { limit: 5 }).total, 2000, 'but the total still says how many there are')

  // A ticket number, typed the way people read it off the paper
  eq(sb('3291').results[0]?.book, 'Book-0330', 'a shorter number that is no book is read as a ticket (3291 is in book 330)')
  eq(sb('2500').results[0]?.book, 'Book-0250', 'and 2500, past the last book, finds ticket 2500\'s book')
  eq(nums(sb('131'))[0], 'Book-0131', 'but where a book has that number, the book still wins')
  eq(sb('99999').total, 0, 'a number past the last ticket finds nothing')

  // Which book is it in — the answer as a line, not just a narrowed list
  const tb = (q) => { const r = ticketBookOf(books, q); return r && `${r.ticket} -> ${r.book.book}` }
  eq(tb('KS-03291'), 'KS-03291 -> Book-0330', 'a printed ticket number names its book')
  eq(tb('ks 3291'), 'KS-03291 -> Book-0330', 'however it is spaced or cased')
  eq(tb('03291'), 'KS-03291 -> Book-0330', 'five digits are a ticket')
  eq(tb('3291'), 'KS-03291 -> Book-0330', 'and so is a shorter number no book has')
  eq(tb('2500'), 'KS-02500 -> Book-0250', 'padded to the printed width')
  eq(tb('131'), null, 'a number that is a book is a book, not a ticket')
  eq(tb('00131'), 'KS-00131 -> Book-0014', 'unless it is written to the full ticket width')
  eq(tb('KS-00001'), 'KS-00001 -> Book-0001', 'the first ticket')
  eq(tb('KS-20000'), 'KS-20000 -> Book-2000', 'and the last')
  eq(tb('KS-20001'), null, 'a ticket past the end is in no book')
  eq(tb('31-45'), null, 'a run of books is not a ticket')
  eq(tb('book 31'), null, 'nor is "book 31"')
  eq(tb('Mana'), null, 'nor a name')
  eq(tb(''), null, 'nor nothing')
  eq(tb('XX-00131'), null, 'a different prefix is not this raffle\'s ticket')
  eq(ticketBookOf([], '3291'), null, 'with no books loaded there is nothing to answer from')

  // Shape: the same as runSearch, so a screen can treat them alike
  ok('total' in sb('1') && Array.isArray(sb('1').results), 'returns { total, results } like runSearch')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
