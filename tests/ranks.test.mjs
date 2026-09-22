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
 * print the bottom rung on the card of somebody holding two hundred tickets. A rank is a public compliment; getting it wrong downward, in
 * writing, on something they were sent, is worse than saying nothing.
 *
 * THE LADDER HAS BEEN RENAMED TWICE AND RE-CUT ONCE, all on 2026-09-22, and
 * none of it was a correction — each was a decision, so each is asserted here
 * by name AND by number rather than left to be noticed in a diff:
 *
 *   thresholds  1 / 4 / 10 books  ->  1 / 3 / 6
 *   bottom rung faithful -> bronze
 *   all four    bronze/silver/gold/diamond -> friend/neighbour/companion/family
 *
 * The last one is why the words here describe RELATIONSHIPS and not materials:
 * the raffle is sold inside the community it funds, so a ladder of closeness
 * says belonging where metals said nothing and where Patron or Champion would
 * have put the buyer above the people served. See _shared/ranks.ts.
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
  eq(RANK_IDS.join(','), 'family,companion,neighbour,friend', 'the bands and their order')
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

  /*
   * THE NUMBERS THEMSELVES, because they are a judgement about this raffle's
   * buyers rather than a fact about the code, and a judgement should be
   * written down where changing it is deliberate.
   *
   * At the raffle's defaults — ten tickets to a book, RM 10 a ticket — these
   * are RM 100, RM 300 and RM 600. They were 1 / 4 / 10, which put Diamond at
   * RM 1,000 from one buyer and left the top of the ladder somewhere nobody
   * stood. If these move again, this is the line that says what they were.
   */
  const at = (id) => RANKS.find((r) => r.id === id)?.minBooks
  eq(at('friend'), 0, 'a Friend is anybody holding tickets but not yet a book')
  eq(at('neighbour'), 1, 'a Neighbour is one book')
  eq(at('companion'), 3, 'a Companion is three books, and was four')
  eq(at('family'), 6, 'Family is six books, and was ten')

  /*
   * AND THERE IS NO RUNG ABOVE IT, which is a decision and not an omission.
   * A fifth band was on the table when the metals ladder was being replaced;
   * nothing sits above being one of the family, so if the top should be
   * further away the THRESHOLD moves and the ladder stays four deep.
   */
  eq(RANKS.length, 4, 'four rungs, and Family is the last of them')
  eq(RANKS[0].id, 'family', 'with nothing named above it')
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
  //  books:  0        1        2        3        5        6
  const cases = [
    [1, 'friend', 'one ticket is already somebody'],
    [PER - 1, 'friend', 'nine tickets is short of a book'],
    [PER, 'neighbour', 'the first whole book is a Neighbour'],
    [PER * 2, 'neighbour', 'two books is still a Neighbour'],
    [PER * 3 - 1, 'neighbour', 'one ticket short of three books is a Neighbour'],
    /*
     * THREE BOOKS IS THE THIRD RUNG, and this is the assertion rewritten when
     * the thresholds came down on 2026-09-22. It read `PER * 4, 'gold'` — four
     * books, the count that had no band at all in the ladder as first
     * described, Silver stopping at three and Gold starting at five. That hole
     * is closed by construction now that the bands are thresholds, so the line
     * that earns its place is the new boundary rather than the old scar.
     * Four books is checked below as well, because it is the value this ladder
     * has been wrong about once already.
     */
    [PER * 3, 'companion', 'three books is a Companion'],
    [PER * 4, 'companion', 'four books is a Companion — the count that once had no band'],
    [PER * 5, 'companion', 'five books is a Companion'],
    [PER * 6 - 1, 'companion', 'one ticket short of six books is a Companion'],
    /*
     * SIX BOOKS IS THE TOP RUNG. Ten books used to be, and was Gold as well under
     * the description this ladder replaced; where two bands claimed a count it
     * went to the higher of them, because a ladder that rounds a compliment
     * down is the wrong way to be wrong. Ten books is still Diamond — now with
     * four books of room underneath it rather than none.
     */
    [PER * 6, 'family', 'six books is Family'],
    [PER * 10, 'family', 'ten books is Family, where the top rung used to start'],
    [PER * 40, 'family', 'and it stays Family however far above'],
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
  eq(rankFor(5, 5)?.id, 'neighbour', 'one book of five is a Neighbour')
  eq(rankFor(4, 5)?.id, 'friend', 'four tickets is short of that book')
  eq(rankFor(30, 5)?.id, 'family', 'six books of five is Family')
  eq(rankFor(30, 10)?.id, 'companion', 'the same thirty tickets is a Companion where a book is ten')
}

console.log('it refuses rather than guesses')
{
  eq(rankFor(0, PER), null, 'nobody is a supporter of nothing')
  eq(rankFor(-3, PER), null, 'and a negative count is not a small one')
  eq(rankFor('', PER), null, 'a blank count is not zero tickets, it is no answer')
  /*
   * THE ONE THAT MATTERS. Without a book size the count cannot be turned into
   * books, and the fallback everybody reaches for — call them a Friend — writes
   * the bottom band onto the card of the raffle's largest supporter.
   */
  eq(rankFor(500, 0), null, 'with no book size it says nothing rather than Friend')
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

console.log('every band on the ladder has its own name and colour on the check page')
{
  /*
   * THE FAILURE THIS CATCHES HAS NO SYMPTOM, which is the only reason it is
   * worth a test of its own. main.js turns a band id into a string key through
   * a FIXED map and draws nothing when the lookup misses — deliberate, so that
   * a band this page has never heard of cannot render as the literal word
   * `rankSomething`. The cost of that safety is that a half-landed rename is
   * invisible: the server starts answering `bronze`, the page finds no entry,
   * and the supporter line silently disappears for the entire bottom band.
   * No error, no console, no gap on the screen where it used to be.
   *
   * It is not hypothetical — the metals became Friend, Neighbour, Companion
   * and Family on 2026-09-22 across exactly these three files, and shipping the
   * server half without the page half would have looked like nothing at all.
   */
  const page = readFileSync(new URL('../src/verify/main.js', import.meta.url), 'utf8')
  const strings = readFileSync(new URL('../src/verify/strings.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/verify/verify.css', import.meta.url), 'utf8')

  const mapBlock = /const BAND = \{([\s\S]*?)\}/.exec(page)
  ok(mapBlock, 'main.js still builds the band names from a fixed map')
  ok(RANK_IDS.length === 4, 'and there are four bands to find, not zero')

  for (const band of RANKS) {
    const id = band.id
    /*
     * THE NAME, CHARACTER FOR CHARACTER, because the page cannot import the
     * ladder — src/lib/ranks.js re-exports a module and verify may only import
     * leaves — so main.js carries a copy. A copy with no assertion over it is
     * how a buyer ends up Companion on the card in their chat and something
     * else on the page that is supposed to confirm it.
     */
    ok(mapBlock && new RegExp(`\\b${id}: '${band.name}'`).test(mapBlock[1]),
      `${id} is named "${band.name}" on the check page, as the ladder names it`)
    /*
     * AND NOT IN strings.js, which is the deliberate exception. Every other
     * string on that page is a pair; these four are English only until a
     * reader of Burmese has looked at them, because the Burmese for a
     * relationship word would be composed rather than translated. Asserted as
     * an ABSENCE so that putting them back is a decision somebody makes here.
     */
    const key = 'rank' + id[0].toUpperCase() + id.slice(1)
    ok(!new RegExp(`${key}:`).test(strings),
      `${key} is not in the string table, where every entry owes a Burmese line`)
    /*
     * AND HAS A COLOUR OF ITS OWN. `.rank` paints from `currentColor` and
     * mixes its own background from it, so a band with no rule inherits the
     * body text and its panel goes grey — a thank-you that reads as a
     * disabled row. Both themes, because the dark values are hand-picked
     * rather than derived, and a rename that reaches one block and not the
     * other leaves dark mode falling back to nothing.
     */
    ok(new RegExp(`\\.rank-${id} \\{ color: var\\(--band-${id}\\) \\}`).test(css),
      `.rank-${id} paints from --band-${id}`)
    ok((css.match(new RegExp(`--band-${id}:`, 'g')) || []).length === 2,
      `--band-${id} is set in both the light and the dark block`)
  }

  /*
   * The counted line under the name has a singular, because the band the
   * smallest buyer lands in is the one this line is read at most often and
   * "1 tickets in this raffle" is a thank-you that reads as generated.
   */
  /*
   * The counted line under the name IS still a pair — only the rung's name is
   * English. And it has a singular, because the band most buyers land in is
   * the one this line is read at most often and "1 tickets in this raffle" is
   * a thank-you that reads as generated.
   */
  for (const key of ['rankThanks', 'rankThanks1', 'receiptCount', 'receiptCount1']) {
    ok(new RegExp(`${key}: \\{`).test(strings),
      `${key} exists, so a count of one is not made plural`)
    ok(new RegExp(`${key}: \\{[\\s\\S]{0,200}?my: '[^']*[\u1000-\u109f]`).test(strings),
      `and ${key} still carries its Burmese half`)
  }
  ok(/Number\(n\) === 1 \? `\$\{key\}1`/.test(page),
    'and the page picks the singular by the number rather than by the string')
}

console.log('a retired band id cannot reach the page, because no stored one is read')
{
  /*
   * THE INFERENCE THIS EXISTS TO STOP, because a peer drew it within an hour
   * of the rename and it is the obvious one.
   *
   * `ticket_receipts.rank` still permits 'faithful' — deliberately, since the
   * column holds bands frozen at mint, is never back-filled, and a CHECK is
   * validated against the rows already there, so narrowing it would fail the
   * db push on precisely the raffles with history worth keeping. Meanwhile
   * main.js draws NOTHING for a band it has no string for. Put those two
   * together and you conclude the halves disagree: that a legacy row renders
   * as an empty space, and that every future rename must keep mapping its
   * retired id for as long as a receipt carrying it can be scanned.
   *
   * None of it follows, because NOTHING READS THE COLUMN. `holding_of`
   * returns six columns and rank is not among them; the band on the reply is
   * `rankFor(sold, perBook)` computed at scan time, for the legacy branch as
   * much as the live one. So `body.rank` is always an id from this ladder, and
   * feeding the page 'faithful' tests a state the server cannot produce.
   *
   * That is a property worth having rather than an accident — it is what made
   * the rename a three-file change instead of a permanent compatibility map —
   * so it is pinned here rather than left to be re-derived.
   */
  const fn = readFileSync(
    new URL('../supabase/functions/verify/index.ts', import.meta.url), 'utf8')

  ok(/const band = rankFor\(/.test(fn), 'the band is worked out at scan time')
  /* `\b` is load-bearing: without it this matched `band.identifier` as well,
     and the negative check that was meant to prove the assertion bites came
     back green. A guard has to be shown failing before it is worth anything. */
  ok(/rank: band\.id\b/.test(fn),
    'and the reply carries that computed id, never a stored one')

  /*
   * Guarded, because an absence proves nothing if the parse found nothing to
   * look at: a regex that stopped matching would pass this silently.
   */
  const selects = [...fn.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1])
  ok(selects.length > 0, 'and the file does query the database, so the next line means something')
  ok(!selects.some((cols) => /\brank\b/.test(cols)),
    'no query on this route reads a stored band')

  const mig = readFileSync(new URL(
    '../supabase/migrations/20260922160000_the_ladder_stopped_being_made_of_metal.sql',
    import.meta.url), 'utf8')
  for (const retired of ['faithful', 'bronze', 'silver', 'gold', 'diamond']) {
    ok(new RegExp(`'${retired}'`).test(mig),
      `the retired id ${retired} stays legal in the column, where old rows carry it`)
  }
  for (const id of RANK_IDS) {
    ok(new RegExp(`'${id}'`).test(mig), `and today's ${id} is legal too`)
  }
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
