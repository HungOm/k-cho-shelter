/*
 * THE CASE THAT LOOKS LIKE A BOOK AND IS NOT ONE.
 *
 * A digital ticket is one per buyer and carries everything they hold, so
 * something has to turn a list of numbers into a line: books where a book is
 * whole, spans where the numbers run on, singles otherwise.
 *
 * The rule that seems obvious is "ten consecutive numbers is a book", and it
 * is wrong in the one case that costs money. With books of ten, KS-00006 …
 * KS-00015 is ten consecutive numbers and NO book — the back half of one book
 * and the front half of the next, filed in two different places at the office.
 * A card printing "Book-0001" for that tells a buyer they hold a book they do
 * not, and tells the office to look in one place for counterfoils that are in
 * two. That case is `halfofeachbook` below and it is why this file exists.
 *
 * The other half is the reverse: a raffle's last book may hold six tickets,
 * and holding all six IS a book. Any rule with the number ten written into it
 * gets one of those two wrong, so nothing here counts — it asks whether the
 * set contains every ticket the book contains.
 *
 * AND THE MERGE RULE IS A WHITELIST. A number this code cannot read stands
 * alone rather than being spanned on a guess. `KS-00001 – KS-00500` on the
 * card of somebody holding two tickets is the failure worth being paranoid
 * about, and it is the "everything except X" shape AUDIT.md §X already names.
 */
import { shapeOf, bookSize, spansOf, chunkText, describeSpans, summarise } from '../src/lib/ticketspans.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

/* Books of ten, the way this raffle numbers them. */
const BOOKS = []
for (let i = 1; i <= 5; i += 1) {
  BOOKS.push({
    book: `Book-${String(i).padStart(4, '0')}`,
    firstTicket: `KS-${String((i - 1) * 10 + 1).padStart(5, '0')}`,
    lastTicket: `KS-${String(i * 10).padStart(5, '0')}`,
  })
}
/* The last book of a run, short — six tickets, and six of six is still a book. */
BOOKS.push({ book: 'Book-0006', firstTicket: 'KS-00051', lastTicket: 'KS-00056' })

const num = (n) => `KS-${String(n).padStart(5, '0')}`
const bookOf = (n) => (n <= 50
  ? `Book-${String(Math.ceil(n / 10)).padStart(4, '0')}`
  : 'Book-0006')
const hold = (...ns) => ns.map((n) => ({ number: num(n), book: bookOf(n) }))
const range = (a, b) => { const out = []; for (let i = a; i <= b; i += 1) out.push(i); return out }

const line = (ts, opts) => summarise(ts, BOOKS, opts).text

/* ---------- taking a number apart ---------- */

console.log('a ticket number is read without being told the prefix')
{
  eq(shapeOf('KS-00042').ord, 42, 'the figures are the figures')
  eq(shapeOf('KS-00042').head, 'KS-', 'and everything before them is the head')
  eq(shapeOf('KS-00042').width, 5, 'padded to its own width')
  /* A prefix ending in digits still works, because the head and the width are
     compared rather than assumed — every number in one raffle splits the same
     way, so adjacency survives. */
  eq(shapeOf('CEAM2026-00007').ord, 7, 'a prefix with a year in it is still a prefix')
  eq(shapeOf('KS2026' + '00007').ord, 202600007, 'and one with no separator splits consistently')
  eq(shapeOf('NOFIGURES').ord, 'null', 'a number with no figures has no ordinal')
  eq(shapeOf(undefined).ord, 'null', 'and neither has nothing at all')
}

console.log('a book knows its own size, and says so or says nothing')
{
  eq(bookSize(BOOKS[0]), 10, 'a full book of ten')
  eq(bookSize(BOOKS[5]), 6, 'and a short last book of six')
  eq(bookSize({ firstTicket: 'KS-00001', lastTicket: 'XX-00010' }), 'null',
    'two ends in different numbering is not a size')
  eq(bookSize({ firstTicket: 'KS-00010', lastTicket: 'KS-00001' }), 'null',
    'and neither is a book that runs backwards')
  eq(bookSize(null), 'null', 'nor a book that is not there')
}

/* ---------- the rule ---------- */

console.log('a whole book is a book')
{
  const c = spansOf(hold(...range(1, 10)), BOOKS)
  eq(c.length, 1, 'ten tickets of one book are one chunk')
  eq(c[0].kind, 'book', 'and the chunk is a book')
  eq(c[0].book, 'Book-0001', 'named by the book, not by its ends')
  eq(c[0].count, 10, 'carrying its own count')
  eq(line(hold(...range(1, 10))), 'Book-0001', 'which is the whole of the line')
}

console.log('the short last book is a book when you hold all of it')
{
  const c = spansOf(hold(...range(51, 56)), BOOKS)
  eq(c.length, 1, 'six of six is one chunk')
  eq(c[0].kind, 'book', 'and it is a book')
  eq(c[0].count, 6, 'of six')
  /* The counter-test: any rule with "ten" in it gets this wrong. */
  ok(c[0].count !== 10, 'a book is not ten tickets, it is all of its own')
}

console.log('halfofeachbook — ten consecutive numbers that are not a book')
{
  const tickets = hold(...range(6, 15))
  eq(tickets.length, 10, 'ten tickets')
  const c = spansOf(tickets, BOOKS)
  eq(c.filter((x) => x.kind === 'book').length, 0, 'and not one book among them')
  /* Said the other way, because this is the assertion that protects the money:
     nothing in the output may name a book the buyer does not hold whole. */
  ok(!line(tickets).includes('Book-'), 'no book is named on a holding that contains none')

  /*
   * AND THEY ARE TWO SPANS, NOT ONE. This is the other half of the same rule.
   * A book here is a physical object with a printed range, handed to a seller
   * and reconciled as a unit; these ten are the back half of one and the front
   * half of the next. Printed as `KS-00006 – KS-00015` the line reads like one
   * book's worth and sends whoever checks it to one shelf, so a run stops
   * where a book does.
   */
  eq(c.length, 2, 'they are two spans, one per book')
  eq(chunkText(c[0]), 'KS-00006 – KS-00010', 'the back half of the first')
  eq(chunkText(c[1]), 'KS-00011 – KS-00015', 'and the front half of the second')
  eq(summarise(tickets, BOOKS).tickets, 10, 'and all ten are still accounted for')
}

console.log('nine of ten is nine, not a book')
{
  const c = spansOf(hold(...range(1, 9)), BOOKS)
  eq(c.filter((x) => x.kind === 'book').length, 0, 'one ticket short is not a book')
  eq(line(hold(...range(1, 9))), 'KS-00001 – KS-00009', 'it is a span')
  /* And the missing one is not quietly at the end: a hole in the middle
     breaks the span as well as the book. */
  eq(line(hold(1, 2, 3, 5, 6, 7, 8, 9, 10)),
    'KS-00001 – KS-00003 · KS-00005 – KS-00010', 'a hole in the middle breaks both')
}

console.log('scattered numbers are scattered numbers')
{
  eq(line(hold(3)), 'KS-00003', 'one ticket is its number')
  eq(line(hold(3, 7)), 'KS-00003 · KS-00007', 'two apart are two numbers')
  eq(line(hold(3, 4)), 'KS-00003, KS-00004', 'two together are listed, not spanned')
  eq(line(hold(3, 4, 5)), 'KS-00003 – KS-00005', 'three together are a span')
  /* Order in does not matter. A buyer's tickets arrive in whatever order the
     query returned them, and the same holding must read the same every time. */
  eq(line(hold(7, 3, 5, 4)), line(hold(3, 4, 5, 7)), 'the order they arrive in changes nothing')
}

console.log('books, spans and singles together, in reading order')
{
  const t = [...hold(...range(1, 10)), ...hold(...range(23, 25)), ...hold(47)]
  const c = spansOf(t, BOOKS)
  eq(c.length, 3, 'a book, a span and a single')
  eq(c[0].kind, 'book', 'the book leads')
  eq(chunkText(c[1]), 'KS-00023 – KS-00025', 'then the span')
  eq(chunkText(c[2]), 'KS-00047', 'then the single')
  eq(summarise(t, BOOKS).tickets, 14, 'and the count is every ticket in it')
}

console.log('two whole books are two books')
{
  const c = spansOf(hold(...range(1, 20)), BOOKS)
  eq(c.length, 2, 'twenty consecutive tickets across two whole books')
  ok(c.every((x) => x.kind === 'book'), 'are two books, not one twenty-long span')
  eq(line(hold(...range(1, 20))), 'Book-0001 · Book-0002', 'and read as their names')
}

/* ---------- what may merge, and what may not ---------- */

console.log('nothing merges across a change in the numbering')
{
  const mixed = [
    { number: 'KS-00001', book: '' }, { number: 'KS-00002', book: '' },
    /* A raffle that changed its prefix. 3 follows 2 arithmetically and must
       not be spanned with it: the head differs, so the span stops. */
    { number: 'XS-00003', book: '' }, { number: 'XS-00004', book: '' },
  ]
  eq(line(mixed), 'KS-00001, KS-00002 · XS-00003, XS-00004',
    'the span stops where the numbering changes')

  /* Same head, different width — 0009 and 00010 are adjacent as numbers and
     are not the same numbering. Listed, never spanned. */
  const widths = [{ number: 'KS-0009', book: '' }, { number: 'KS-00010', book: '' }]
  eq(line(widths), 'KS-0009 · KS-00010', 'and where the padding changes')

  /* A number this file cannot read stands alone rather than being guessed at. */
  const odd = [{ number: 'SAMPLE', book: '' }, { number: 'KS-00001', book: '' }]
  eq(summarise(odd, BOOKS).chunks.length, 2, 'an unreadable number is its own chunk')
  ok(line(odd).includes('SAMPLE'), 'and is still shown')
}

console.log('a run never merges two books, whole or not')
{
  /* The whole-book case cannot arise — pass one takes those out first — so
     this is the case that is left: partial, partial, and adjacent. */
  const c = spansOf(hold(10, 11), BOOKS)
  eq(c.length, 2, 'the last ticket of one book and the first of the next are two')
  eq(line(hold(10, 11)), 'KS-00010 · KS-00011', 'and are printed as two')
  /* Within one book it still runs on, which is the thing that would be lost
     if the boundary check were written as "never merge anything". */
  eq(line(hold(11, 12, 13)), 'KS-00011 – KS-00013', 'inside one book a run is a run')
}

console.log('a book whose row is missing is listed, never folded')
{
  /* The failure that matters is the other direction: folding a book on a size
     nobody supplied would print "Book-0001" for however many the buyer had. */
  const c = spansOf(hold(...range(1, 10)), [])
  eq(c.filter((x) => x.kind === 'book').length, 0, 'with no books loaded, nothing is a book')
  eq(chunkText(c[0]), 'KS-00001 – KS-00010', 'the tickets are listed instead')
}

console.log('duplicates are one ticket')
{
  const twice = [...hold(...range(1, 10)), ...hold(...range(1, 10))]
  eq(twice.length, 20, 'twenty rows in')
  const c = spansOf(twice, BOOKS)
  eq(c.length, 1, 'one book out')
  eq(c[0].count, 10, 'of ten tickets, not twenty')
  /* Worth its own line: the book test is a COUNT against the book's size, so a
     duplicated ticket is exactly what would make nine look like ten. */
  const nine = [...hold(...range(1, 9)), ...hold(9)]
  eq(spansOf(nine, BOOKS).filter((x) => x.kind === 'book').length, 0,
    'and a ticket counted twice does not complete a book')
}

/* ---------- the room there is on a card ---------- */

console.log('what does not fit is counted, not dropped')
{
  const t = [
    ...hold(...range(1, 10)), ...hold(...range(11, 20)),
    ...hold(...range(23, 25)), ...hold(27), ...hold(29),
  ]
  const s = summarise(t, BOOKS, { max: 3 })
  eq(s.tickets, 25, 'the count is every ticket held')
  eq(s.shown, 3, 'three chunks are named')
  eq(s.hidden, 2, 'and the rest are counted as TICKETS, not as entries')
  eq(s.text, 'Book-0001 · Book-0002 · KS-00023 – KS-00025 · +2 more',
    'which is the line')
  /* The count beside the line is never the abbreviated one. That pairing is
     how a small card tells the truth about a large holding. */
  ok(s.tickets > s.shown, 'the exact count stands beside an abbreviated line')

  const room = summarise(t, BOOKS, { max: 9 })
  eq(room.hidden, 0, 'given the room, nothing is hidden')
  ok(!room.text.includes('more'), 'and nothing says it is')
}

console.log('the overflow wording is the caller’s')
{
  const t = [...hold(...range(1, 10)), ...hold(23), ...hold(27), ...hold(31)]
  const s = summarise(t, BOOKS, { max: 2, more: (n) => `and ${n} others` })
  ok(s.text.endsWith('and 2 others'), 'a caller may say it in its own words')
}

console.log('one ticket is still one ticket')
{
  const s = summarise(hold(4), BOOKS)
  eq(s.text, 'KS-00004', 'the line is the number')
  eq(s.tickets, 1, 'and the count is one')
  eq(summarise([], BOOKS).text, '', 'and nothing held says nothing')
  eq(summarise([], BOOKS).tickets, 0, 'with a count of nothing')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
