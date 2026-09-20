/*
 * EVERY BOUNDARY IN THE LADDER, AND THE TWO THAT DID NOT EXIST.
 *
 * The bands arrived described as spans — "Gold (5-10 books), Diamond (10+),
 * Silver (1-3)" — and spans written by hand overlap and leave holes. Ten books
 * was Gold and Diamond at once; four books was nothing at all. Both are the
 * same defect, a count with no single answer, and neither shows up in a test
 * that checks the middle of each band.
 *
 * So this file walks the counts either side of every threshold, and it checks
 * four books specifically, because that is the value that had no home. A test
 * on a value that sits comfortably inside a band proves only that the band
 * exists.
 *
 * It also pins the two refusals. `rankFor` returns null rather than guessing,
 * and the case worth protecting is the second one: with no tickets-per-book
 * there is no way to turn a count into books, and the obvious fallback would
 * print "Faithful supporter" on the card of somebody holding two hundred
 * tickets. A rank is a public compliment; getting it wrong downward, in
 * writing, on something they were sent, is worse than saying nothing.
 */
/*
 * LOADED AS THE SERVER LOADS IT, from _shared, because that is where the ladder
 * is defined. src/lib/ranks.js re-exports this same module so the card and the
 * check page cannot drift apart; testing the re-export would test the alias.
 * `clientmirrorsladder` below checks that the alias still points here.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { readFileSync } from 'node:fs'

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const { RANKS, RANK_IDS, rankFor, rankCount, booksHeld } = await loadModule('../_shared/ranks.ts')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

const PER = 10

console.log('the ladder is four bands, ordered from the top down')
{
  eq(RANK_IDS.join(','), 'diamond,gold,silver,faithful', 'the bands and their order')
  /*
   * ORDERED HIGHEST FIRST, and `rankFor` takes the first match, so a band whose
   * threshold is not strictly below the one above it would be unreachable. That
   * is a mistake nobody would see in a diff — the band is still listed, still
   * named, and simply never returned.
   */
  for (let i = 1; i < RANKS.length; i++) {
    ok(RANKS[i].minBooks < RANKS[i - 1].minBooks,
      `${RANKS[i].id} sits strictly below ${RANKS[i - 1].id}, so it is reachable`)
  }
  ok(RANKS.every((r) => r.name.trim() !== '' && r.id.trim() !== ''), 'every band is named')
}

console.log('every count above zero falls in exactly one band')
{
  /*
   * The property the overlapping description broke, checked by exhaustion
   * rather than by argument: two hundred books' worth of tickets, every one of
   * them landing in one band and never in two.
   */
  for (let t = 1; t <= PER * 200; t++) {
    const r = rankFor(t, PER)
    if (!r) { fail++; console.log(`  FAIL ${t} tickets has no band`); break }
    const matches = RANKS.filter((b) => booksHeld(t, PER) >= b.minBooks)
    if (matches[0].id !== r.id) {
      fail++; console.log(`  FAIL ${t} tickets: rankFor said ${r.id}, the ladder says ${matches[0].id}`)
      break
    }
  }
  pass++
}

console.log('the thresholds themselves, on both sides')
{
  //  books:  0        1         3        4        9        10
  const cases = [
    [1, 'faithful', 'one ticket is already somebody'],
    [PER - 1, 'faithful', 'nine tickets is short of a book'],
    [PER, 'silver', 'the first whole book is Silver'],
    [PER * 3, 'silver', 'three books is still Silver'],
    [PER * 4 - 1, 'silver', 'one ticket short of four books is Silver'],
    /*
     * FOUR BOOKS HAD NO BAND AT ALL in the ladder as it was described — Silver
     * stopped at three and Gold started at five, so the count fell through the
     * gap. Closing the gap is a choice about which way it closes, and this line
     * is that choice written down: four books is Gold. Move the threshold back
     * to five and this is the assertion that goes red, reporting Silver.
     */
    [PER * 4, 'gold', 'four books is Gold — the count that had no band'],
    [PER * 9, 'gold', 'nine books is Gold'],
    [PER * 10 - 1, 'gold', 'one ticket short of ten books is Gold'],
    /*
     * TEN BOOKS WAS BOTH Gold (5-10) and Diamond (10+). It is Diamond, the
     * higher of the two, because a ladder that rounds a compliment down is the
     * wrong way to be wrong.
     */
    [PER * 10, 'diamond', 'ten books is Diamond, and used to be Gold as well'],
    [PER * 40, 'diamond', 'and it stays Diamond however far above'],
  ]
  for (const [tickets, id, what] of cases) {
    eq(rankFor(tickets, PER)?.id, id, `${tickets} tickets: ${what}`)
  }
}

console.log('the bands move with the raffle, because they are counted in books')
{
  /*
   * The same ladder against a five-ticket book. Silver is 5 tickets here and 10
   * above, which is the point: the sentence an organiser says is "three books",
   * and it stays true when somebody changes the book size.
   */
  eq(rankFor(5, 5)?.id, 'silver', 'one book of five is Silver')
  eq(rankFor(4, 5)?.id, 'faithful', 'four tickets is short of that book')
  eq(rankFor(50, 5)?.id, 'diamond', 'ten books of five is Diamond')
  eq(rankFor(50, 10)?.id, 'gold', 'the same fifty tickets is Gold where a book is ten')
}

console.log('it refuses rather than guesses')
{
  eq(rankFor(0, PER), null, 'nobody is a supporter of nothing')
  eq(rankFor(-3, PER), null, 'and a negative count is not a small one')
  eq(rankFor('', PER), null, 'a blank count is not zero tickets, it is no answer')
  /*
   * THE ONE THAT MATTERS. Without a book size the count cannot be turned into
   * books, and the fallback everybody reaches for — call them Faithful — writes
   * the bottom band onto the card of the raffle's largest supporter.
   */
  eq(rankFor(500, 0), null, 'with no book size it says nothing rather than Faithful')
  eq(rankFor(500, undefined), null, 'and the same when the setting is missing')
  eq(rankFor(500, 'ten'), null, 'and when it is not a number')
}

console.log('what it says under the name is what they have, not what they lack')
{
  eq(rankCount(rankFor(PER * 12, PER)), '12 books', 'somebody with books is counted in books')
  eq(rankCount(rankFor(PER, PER)), '1 book', 'and one book is not "1 books"')
  /*
   * "0 books" would be the literal truth and the wrong sentence: it tells
   * somebody what they are short of on the one line that exists to thank them.
   */
  eq(rankCount(rankFor(7, PER)), '7 tickets', 'somebody short of a book is counted in tickets')
  eq(rankCount(rankFor(1, PER)), '1 ticket', 'and one ticket is not "1 tickets"')
  eq(rankCount(null), '', 'no rank says nothing at all')
}

console.log('the client reads this same ladder rather than a copy of it')
{
  /*
   * The whole argument for the re-export, pinned. Two copies of four
   * thresholds agree on the day they are written; the first time one moves, a
   * buyer is Gold on the card they were sent and Silver on the page that is
   * meant to confirm it — and the page is the one that gets believed.
   *
   * Matched on the import, not on the numbers: a client file that happened to
   * contain the same four values would pass a comparison of values while still
   * being a second place they are written down.
   */
  const client = readFileSync(new URL('../src/lib/ranks.js', import.meta.url), 'utf8')
  ok(/_shared\/ranks\.ts'/.test(client),
    'src/lib/ranks.js re-exports the shared ladder')
  const bare = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/minBooks/.test(bare),
    'and does not carry a second copy of the thresholds')
}

console.log('all three treatments draw the band, and none of them invents one')
{
  /*
   * THE OMISSION THIS CATCHES IS SILENT. A band drawn on Grand and not on Stub
   * means an organiser changing the treatment in the studio deletes a thank-you
   * from every card the raffle sends, and the card still looks finished — there
   * is no gap where it was, no error, nothing to report. So each treatment is
   * named here rather than the list being spot-checked.
   */
  const { cardSVG, CARD_DESIGNS } = await import('../src/lib/ticketart.js')
  const base = {
    number: 'KS-00031', name: 'John Kui', org: 'CEAM Shelter', price: 'RM 10.00',
    book: 'Book-004', brand: '#0d7a6f', ink: '#ffffff', thanks: 'Thank you.',
  }
  for (const d of CARD_DESIGNS) {
    const svg = cardSVG(d.id, { ...base, rankName: 'Gold supporter', rankCount: '4 books' })
    ok(svg.includes('GOLD SUPPORTER'), `${d.id} draws the band`)
    ok(svg.includes('4 books'), `${d.id} draws the count beside it`)
    /*
     * ONE ELEMENT, NOT TWO. The count sits after a name of unknown width, and
     * the only way to place a separate element there is to measure the first —
     * which this file cannot do for anything set in the Myanmar chain. A tspan
     * is laid out by the renderer; an estimated x is the bug that once printed
     * "Klang" as "K l a n g".
     */
    ok(/<tspan[^>]*>\s*·\s*4 books<\/tspan>/.test(svg),
      `${d.id} places the count with a tspan rather than an estimated x`)

    /*
     * AND WITH NO BAND, NOTHING — not an empty label, not a stray separator.
     * Checked per treatment because each has its own slot and each could leave
     * its own debris.
     */
    const bare = cardSVG(d.id, base)
    ok(!/SUPPORTER/i.test(bare), `${d.id} draws nothing when there is no band`)
  }
}

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
