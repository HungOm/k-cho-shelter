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
  fold, phoneDigits, waNumber, closeEnough,
  buildIndex, parseBookRange, scoreEntry, runSearch
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
