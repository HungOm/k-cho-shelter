/*
 * THE SUPPORTER LADDER: FIVE RUNGS, AND THE WORDS ARE NOT OURS.
 *
 * The bands were rewritten three times in two days — metals, then one fixed
 * ladder of relationship words — and every argument was about which vocabulary
 * is right. It was the wrong argument. A raffle here is an instrument rather
 * than an event: the same app runs one for a community centre, one for a
 * refugee learning centre, one for a fellowship, one for a shelter housing
 * refugee patients with chronic and mental health conditions. "Mentor" is right
 * in one of those rooms and meaningless in another.
 *
 * So the names and the thresholds are configuration, and what this file pins is
 * the part that is NOT configurable, because that is the part everything else
 * depends on:
 *
 *   THE SHAPE. Five rungs, ids that are POSITIONS rather than words, thresholds
 *   in whole books, strictly ascending, first match from the top. A rung whose
 *   threshold is not strictly above the one below it can never be returned — it
 *   stays listed, stays named, and simply never happens to anybody.
 *
 *   THE COUNTING. An organiser chooses what to call five books. Nobody chooses
 *   who has five books, and no screen awards a rung.
 *
 *   THE FALLBACK. `ladderFrom` runs inside a page drawing somebody's ticket and
 *   inside the function answering a stranger's scan, so it never throws: a row
 *   it cannot use becomes the default preset. Which is exactly why the WRITE
 *   side has to refuse instead — see tests/everyaction and branding.ts.
 *
 * It also pins the two refusals. `rankFor` returns null rather than guessing,
 * and the case worth protecting is the second one: with no tickets-per-book
 * there is no way to turn a count into books, and the obvious fallback would
 * print the bottom rung on the card of somebody holding two hundred tickets. A
 * rung is a public compliment; getting it wrong downward, in writing, on
 * something they were sent, is worse than saying nothing.
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
const R = await loadModule('../_shared/ranks.ts')
const {
  RANKS, RANK_IDS, SLOTS, PRESETS, DEFAULT_PRESET, DEFAULT_BOOKS,
  presetById, ladderOf, ladderFrom, rankFor, rankCount, booksHeld,
} = R

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

const PER = 10

console.log('the ladder is five rungs, named by position and ordered from the top down')
{
  eq(SLOTS.join(','), 'rung1,rung2,rung3,rung4,rung5', 'the slots, lowest first')
  eq(RANK_IDS.join(','), 'rung5,rung4,rung3,rung2,rung1', 'and the ladder reads highest first')

  /*
   * THE IDS ARE POSITIONS AND NOT WORDS, which is the change that made the rest
   * of this possible. Every earlier ladder keyed on the name — `gold`,
   * `bronze`, `family` — and that works exactly as long as the names are
   * written in the code. A stylesheet token called `--band-gold` holding the
   * colour of something an organiser called "Encourager" is the defect this
   * repository already has a memory of, one level up.
   */
  ok(RANK_IDS.every((id) => /^rung[1-5]$/.test(id)),
    'no id is a word, so an organiser renaming a rung changes no key anywhere')

  /*
   * ORDERED HIGHEST FIRST, and `rankFor` takes the first match, so a rung whose
   * threshold is not strictly below the one above it would be unreachable. That
   * is a mistake nobody would see in a diff — the rung is still listed, still
   * named, and simply never returned.
   */
  for (let i = 1; i < RANKS.length; i++) {
    ok(RANKS[i].minBooks < RANKS[i - 1].minBooks,
      `${RANKS[i].id} sits strictly below ${RANKS[i - 1].id}, so it is reachable`)
  }
  ok(RANKS.every((r) => r.name.trim() !== '' && r.id.trim() !== ''), 'every rung is named')
}

console.log('the default is the community centre preset, at reachable book counts')
{
  eq(DEFAULT_PRESET, 'community', 'community centre is what a raffle gets before anybody chooses')
  /*
   * WHY THAT ONE. A raffle is sold across all the rooms at once — the same
   * ticket reaches a family at the learning centre and somebody at the
   * fellowship — so the words that ship are the ones true in every room, and an
   * organiser running a raffle FOR one of the others changes it in one click.
   */
  eq(DEFAULT_BOOKS.join(','), '0,1,2,3,5', 'the default thresholds, lowest first')
  /*
   * 0 IS DELIBERATE AND IS NOT "no books". It is the rung for somebody who has
   * bought tickets but not yet a whole book, and it exists because that is most
   * buyers: a ladder whose bottom rung is one book says nothing at all to the
   * person who bought three tickets, and that person is the one the raffle most
   * wants to thank.
   *
   * At the raffle's own defaults — ten tickets to a book, RM 10 a ticket —
   * these are RM 10, 100, 200, 300 and 500. An earlier ladder put its top at
   * ten books, RM 1,000 from one buyer, which is a rung nobody stood on.
   */
  eq(DEFAULT_BOOKS[0], 0, 'the bottom rung reaches somebody short of a whole book')
  eq([...RANKS].reverse().map((r) => r.name).join(','),
    'Well-wisher,Friend,Neighbour,Builder,Pillar',
    'and the default names are the community column, lowest first')
}

console.log('every preset is a usable ladder')
{
  ok(PRESETS.length >= 4, `there are ${PRESETS.length} presets to check, not zero`)
  const wanted = ['community', 'shelter', 'learning', 'fellowship']
  for (const id of wanted) {
    ok(PRESETS.some((p) => p.id === id), `there is a preset for ${id}`)
  }
  for (const p of PRESETS) {
    eq(p.rungs.length, SLOTS.length, `${p.id} names all ${SLOTS.length} rungs`)
    ok(p.rungs.every((n) => typeof n === 'string' && n.trim() !== ''),
      `${p.id} has no blank rung`)
    /*
     * DISTINCT WITHIN A PRESET. Two rungs called the same thing is a ladder
     * that reads as broken to the buyer on the lower one — they are told they
     * are a Friend, and so is somebody with five times as many tickets.
     */
    eq(new Set(p.rungs).size, p.rungs.length, `${p.id} names no two rungs the same`)
    ok(p.rungs.every((n) => n.length <= 24),
      `${p.id} fits the 24 characters a card holds`)
    ok(p.name.trim() !== '', `${p.id} has a name for the settings screen`)
  }
  /*
   * AND A PRESET IS A LADDER THAT WORKS, not just a list of words. Walked
   * rather than trusted, because a preset with the wrong number of names would
   * produce a ladder with an undefined threshold and fail somewhere far away.
   */
  for (const p of PRESETS) {
    const ladder = ladderOf(p.id)
    eq(ladder.length, SLOTS.length, `${p.id} resolves to a full ladder`)
    for (let i = 1; i < ladder.length; i++) {
      ok(ladder[i].minBooks < ladder[i - 1].minBooks, `${p.id} rung ${i} is reachable`)
    }
    ok(rankFor(1, PER, ladder)?.name === p.rungs[0],
      `${p.id}: one ticket is the bottom rung, "${p.rungs[0]}"`)
    ok(rankFor(PER * 40, PER, ladder)?.name === p.rungs[4],
      `${p.id}: forty books is the top rung, "${p.rungs[4]}"`)
  }
  eq(presetById('nonsense').id, PRESETS[0].id, 'an unknown preset id falls back to the first')
}

console.log('every count above zero falls in exactly one rung')
{
  /*
   * The property an overlapping description breaks, checked by exhaustion
   * rather than by argument: two hundred books' worth of tickets, every one of
   * them landing in one rung and never in two.
   */
  for (let t = 1; t <= PER * 200; t++) {
    const r = rankFor(t, PER)
    if (!r) { fail++; console.log(`  FAIL ${t} tickets has no rung`); break }
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
  //  books:  0        1        2        3        5
  const cases = [
    [1, 'rung1', 'one ticket is already somebody'],
    [PER - 1, 'rung1', 'nine tickets is short of a book'],
    [PER, 'rung2', 'the first whole book is the second rung'],
    [PER * 2 - 1, 'rung2', 'one ticket short of two books is still the second'],
    [PER * 2, 'rung3', 'two books is the third'],
    [PER * 3 - 1, 'rung3', 'one ticket short of three books is still the third'],
    /*
     * FOUR BOOKS HAD NO RUNG AT ALL in the ladder as first described — Silver
     * stopped at three and Gold started at five, so the count fell through the
     * gap. Holes and overlaps are the same defect and both are gone by
     * construction now that rungs are thresholds, but four books is the value
     * this ladder has been wrong about once, so it is still walked.
     */
    [PER * 3, 'rung4', 'three books is the fourth rung'],
    [PER * 4, 'rung4', 'four books too — the count that once had no rung at all'],
    [PER * 5 - 1, 'rung4', 'one ticket short of five books is still the fourth'],
    [PER * 5, 'rung5', 'five books is the top'],
    [PER * 40, 'rung5', 'and it stays the top however far above'],
  ]
  for (const [tickets, id, what] of cases) {
    eq(rankFor(tickets, PER)?.id, id, `${tickets} tickets: ${what}`)
  }
}

console.log('the rungs move with the raffle, because they are counted in books')
{
  /*
   * The same ladder against a five-ticket book. The second rung is 5 tickets
   * here and 10 above, which is the point: the sentence an organiser says is
   * "three books", and it stays true when somebody changes the book size.
   */
  eq(rankFor(5, 5)?.id, 'rung2', 'one book of five is the second rung')
  eq(rankFor(4, 5)?.id, 'rung1', 'four tickets is short of that book')
  eq(rankFor(25, 5)?.id, 'rung5', 'five books of five is the top')
  eq(rankFor(25, 10)?.id, 'rung3', 'the same twenty-five tickets is the third where a book is ten')
}

console.log('a stored ladder is used, and an unusable one falls back rather than throwing')
{
  const mine = [
    { name: 'Well-wisher', minBooks: 0 }, { name: 'Friend', minBooks: 1 },
    { name: 'Neighbour', minBooks: 2 }, { name: 'Keeper', minBooks: 4 },
    { name: 'Guardian', minBooks: 8 },
  ]
  const got = ladderFrom({ preset: 'shelter', rungs: mine })
  eq(got.length, 5, 'a good stored ladder comes back whole')
  eq(got[0].name, 'Guardian', 'highest first, whatever order it was stored in')
  eq(got[0].id, 'rung5', 'and the ids are still positions, not the stored words')
  eq(rankFor(PER * 8, PER, got)?.name, 'Guardian', 'and it is what the band is worked out from')
  eq(rankFor(PER * 4, PER, got)?.name, 'Keeper', 'at the thresholds that were stored')
  eq(ladderFrom(mine).length, 5, 'a bare array is accepted as well as {rungs}')

  /*
   * EVERY WAY IT CAN BE WRONG FALLS BACK TO THE DEFAULT, SILENTLY AND WHOLE.
   *
   * Silently because this runs inside a page that is drawing somebody's ticket
   * and inside the function answering a stranger's scan — a raffle with a
   * damaged config row gets working words, never an exception. Whole because
   * half a ladder is worse than the default one: patching a bad rung leaves an
   * organiser looking at four of their words and one of ours.
   *
   * And this is exactly why branding.ts REFUSES on the way in. A ladder quietly
   * replaced at read time is somebody who saved their words, saw "Saved", and
   * is being shown a stranger's on every card.
   */
  const isDefault = (l) => l.length === 5 && l[0].name === 'Pillar'
  const bad = [
    [null, 'nothing at all'],
    ['', 'a blank row'],
    ['not json', 'text that is not a ladder'],
    [{}, 'an object with no rungs'],
    [{ rungs: [] }, 'no rungs'],
    [{ rungs: mine.slice(0, 4) }, 'four rungs instead of five'],
    [{ rungs: [...mine, { name: 'Sixth', minBooks: 9 }] }, 'six rungs'],
    [{ rungs: mine.map((r, i) => (i === 2 ? { name: '', minBooks: 2 } : r)) }, 'a rung with no name'],
    [{ rungs: mine.map((r, i) => (i === 2 ? { name: 'X', minBooks: -1 } : r)) }, 'a negative threshold'],
    [{ rungs: mine.map((r, i) => (i === 2 ? { name: 'X', minBooks: 1.5 } : r)) }, 'a fractional threshold'],
    [{ rungs: mine.map((r, i) => (i === 2 ? { name: 'X', minBooks: 'two' } : r)) }, 'a threshold that is not a number'],
    [{ rungs: mine.map((r, i) => (i === 2 ? null : r)) }, 'a rung that is not an object'],
    /*
     * THE ONE THAT MATTERS MOST, because it is the only one that looks fine.
     * Every rung named, every threshold a whole number, five of them — and the
     * fourth does not sit above the third, so it can never be returned. An
     * organiser would have typed a word that happens to nobody, forever, with
     * nothing on any screen to show for it.
     */
    [{ rungs: mine.map((r, i) => (i === 3 ? { name: 'Keeper', minBooks: 2 } : r)) }, 'thresholds that do not ascend'],
    [{ rungs: mine.map((r, i) => (i === 3 ? { name: 'Keeper', minBooks: 1 } : r)) }, 'thresholds that go backwards'],
  ]
  for (const [stored, what] of bad) {
    let got
    try { got = ladderFrom(stored) } catch { fail++; console.log(`  FAIL ${what} threw`); continue }
    ok(isDefault(got), `${what} falls back to the default ladder`)
  }
}

console.log('it refuses rather than guesses')
{
  eq(rankFor(0, PER), null, 'nobody is a supporter of nothing')
  eq(rankFor(-3, PER), null, 'and a negative count is not a small one')
  eq(rankFor('', PER), null, 'a blank count is not zero tickets, it is no answer')
  /*
   * THE ONE THAT MATTERS. Without a book size the count cannot be turned into
   * books, and the fallback everybody reaches for — give them the bottom rung —
   * writes "Well-wisher" onto the card of the raffle's largest supporter.
   */
  eq(rankFor(500, 0), null, 'with no book size it says nothing rather than the bottom rung')
  eq(rankFor(500, undefined), null, 'and the same when the setting is missing')
  eq(rankFor(500, 'ten'), null, 'and when it is not a number')
  /* A ladder that is not one is not a reason to fail a scan. */
  eq(rankFor(PER * 3, PER, [])?.id, 'rung4', 'an empty ladder falls back to the default')
  eq(rankFor(PER * 3, PER, null)?.id, 'rung4', 'and so does no ladder at all')
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
  eq(rankCount(null), '', 'no rung says nothing at all')
}

console.log('the client reads this same ladder rather than a copy of it')
{
  /*
   * The whole argument for the re-export, pinned. Two copies of five thresholds
   * agree on the day they are written; the first time one moves, a buyer is one
   * rung on the card they were sent and another on the page that is meant to
   * confirm it — and the page is the one that gets believed. They are moved by
   * hand now, in a settings screen, which makes drift a matter of when rather
   * than whether.
   *
   * Matched on the import, not on the numbers: a client file that happened to
   * contain the same five values would pass a comparison of values while still
   * being a second place they are written down.
   */
  const client = readFileSync(new URL('../src/lib/ranks.js', import.meta.url), 'utf8')
  ok(/_shared\/ranks\.ts'/.test(client), 'src/lib/ranks.js re-exports the shared ladder')
  const bare = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/minBooks/.test(bare), 'and does not carry a second copy of the thresholds')
  for (const name of ['ladderFrom', 'PRESETS', 'SLOTS']) {
    ok(new RegExp(`\\b${name}\\b`).test(bare), `and re-exports ${name}, which the screens need`)
  }
}

console.log('the check page keys on the position and reads the name off the reply')
{
  const page = readFileSync(new URL('../src/verify/main.js', import.meta.url), 'utf8')
  const strings = readFileSync(new URL('../src/verify/strings.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/verify/verify.css', import.meta.url), 'utf8')

  /*
   * THE NAME CANNOT BE A TABLE ON THE PAGE ANY MORE, and the page must not
   * quietly grow one back. It used to hold `{ gold: 'rankGold', ... }` and look
   * a string up by id, which was right while the words lived in the code. They
   * are the organiser's now, so the only place that knows what rung four is
   * called is the config the server has already read.
   */
  ok(/body\.rankName/.test(page), 'the rung name comes from the reply')
  ok(/rankName: band\.name/.test(
    readFileSync(new URL('../supabase/functions/verify/index.ts', import.meta.url), 'utf8')),
    'and the server puts it there, from the ladder it resolved')

  /*
   * THE ID IS STILL A FIXED LIST, which is the half that has to stay. It is
   * pasted into a class attribute, so an id this page has never heard of must
   * draw nothing rather than reach the stylesheet.
   */
  const slotList = /const SLOT = \[([^\]]*)\]/.exec(page)
  ok(slotList, 'main.js still holds a fixed list of rung positions')
  ok(SLOTS.length === 5, 'and there are five to find, not zero')
  for (const id of SLOTS) {
    ok(slotList && new RegExp(`'${id}'`).test(slotList[1]), `${id} is one the page will draw`)
    /*
     * AND HAS A COLOUR OF ITS OWN, IN BOTH THEMES. `.rank` paints from
     * `currentColor` and mixes its own background from it, so a rung with no
     * rule inherits the body text and its panel goes grey — a thank-you that
     * reads as a disabled row. Both blocks, because the dark values are
     * hand-picked rather than derived, and a rename that reaches one and not
     * the other leaves dark mode falling back to nothing.
     */
    ok(new RegExp(`\\.rank-${id} \\{ color: var\\(--band-${id}\\) \\}`).test(css),
      `.rank-${id} paints from --band-${id}`)
    ok((css.match(new RegExp(`--band-${id}:`, 'g')) || []).length === 2,
      `--band-${id} is set in both the light and the dark block`)
    /*
     * NOT IN strings.js, which is the deliberate exception. Every entry there
     * owes a Burmese line; a rung's name is typed in by an organiser, in one
     * language, and this page has nowhere to get the other half from.
     */
    ok(!new RegExp(`rank${id}`, 'i').test(strings),
      `${id} has no entry in the string table, where every entry owes Burmese`)
  }

  /*
   * The counted line under the name IS still a pair — only the rung's name is
   * not. And it has a singular, because the rung most buyers land in is the one
   * this line is read at most often and "1 tickets in this raffle" is a
   * thank-you that reads as generated.
   */
  for (const key of ['rankThanks', 'rankThanks1', 'receiptCount', 'receiptCount1']) {
    ok(new RegExp(`${key}: \\{`).test(strings), `${key} exists, so a count of one is not made plural`)
    ok(new RegExp(`${key}: \\{[\\s\\S]{0,200}?my: '[^']*[က-႟]`).test(strings),
      `and ${key} still carries its Burmese half`)
  }
  ok(/Number\(n\) === 1 \? `\$\{key\}1`/.test(page),
    'and the page picks the singular by the number rather than by the string')
}

console.log('a retired rung id cannot reach the page, because no stored one is read')
{
  /*
   * THE INFERENCE THIS EXISTS TO STOP, because a peer drew it within an hour of
   * a rename and it is the obvious one.
   *
   * `ticket_receipts.rank` still permits every id this ladder has ever used —
   * deliberately, since the column holds rungs frozen at mint, is never
   * back-filled, and a CHECK is validated against the rows already there, so
   * narrowing it would fail the db push on precisely the raffles with history
   * worth keeping. Meanwhile main.js draws nothing for an id it does not know.
   * Put those together and you conclude the halves disagree.
   *
   * None of it follows, because NOTHING READS THE COLUMN. `holding_of` returns
   * six columns and rank is not among them; the band on the reply is
   * `rankFor(sold, perBook, ladder)` computed at scan time, for the legacy
   * branch as much as the live one.
   *
   * That is the property that made three renames a change to a handful of files
   * rather than a permanent compatibility map, so it is pinned rather than left
   * to be re-derived.
   */
  const fn = readFileSync(
    new URL('../supabase/functions/verify/index.ts', import.meta.url), 'utf8')

  ok(/const band = rankFor\(/.test(fn), 'the band is worked out at scan time')
  /* `\b` is load-bearing: without it this matched `band.identifier` as well,
     and the negative check meant to prove the assertion bites came back green.
     A guard has to be shown failing before it is worth anything. */
  ok(/rank: band\.id\b/.test(fn), 'and the reply carries that computed id, never a stored one')

  /*
   * Guarded, because an absence proves nothing if the parse found nothing to
   * look at: a regex that stopped matching would pass this silently.
   */
  const selects = [...fn.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1])
  ok(selects.length > 0, 'and the file does query the database, so the next line means something')
  ok(!selects.some((cols) => /\brank\b/.test(cols)), 'no query on this route reads a stored rung')

  const mig = readFileSync(new URL(
    '../supabase/migrations/20260922200000_what_to_call_a_supporter_is_the_organisers_to_choose.sql',
    import.meta.url), 'utf8')
  for (const id of SLOTS) {
    ok(new RegExp(`'${id}'`).test(mig), `today's ${id} is legal in the column`)
  }
  for (const retired of ['faithful', 'bronze', 'silver', 'gold', 'diamond',
                         'friend', 'neighbour', 'companion', 'family']) {
    ok(new RegExp(`'${retired}'`).test(mig),
      `and the retired id ${retired} stays legal, where old rows carry it`)
  }
}

console.log('all three treatments draw the rung, and none of them invents one')
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
    const svg = cardSVG(d.id, { ...base, rankName: 'Keeper', rankCount: '4 books' })
    ok(svg.includes('KEEPER'), `${d.id} draws the rung`)
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
     * AND WITH NO RUNG, NOTHING — not an empty label, not a stray separator.
     * Checked per treatment because each has its own slot and each could leave
     * its own debris.
     */
    const bare = cardSVG(d.id, base)
    ok(!/KEEPER/i.test(bare), `${d.id} draws nothing when there is no rung`)
  }
}

await cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
