/*
 * Where a book has been, and the ticket's sale in the middle of it.
 *
 * book_history has been WRITTEN since the first version of this app and read by
 * nothing. The table exists, both backends expose an action over it, and that
 * action is deliberately open to every role — the person who needs to know
 * where a book went is usually the one holding the clipboard. Until now no
 * screen called it: the cost of keeping the record was paid every day and the
 * benefit never collected. That is the fifth "correct, tested, never called"
 * finding in this repository in two days, and the only one where the unused
 * half was a whole feature rather than a guard.
 *
 * The assertion that matters most here is the LAST one. A trail is only worth
 * opening if every movement in it reads as English, and the verbs come from
 * three different places in the server — two handlers writing literals and a
 * third lower-casing whatever status somebody set. A hand-written list of them
 * in the screen reproduces the author's blind spot exactly, which is how a book
 * marked lost would have rendered as the word "lost" in a trail that otherwise
 * speaks in sentences. So the list is checked against the source.
 */
import { cut, codeOf } from './source.mjs'
import { readFileSync } from 'node:fs'
import { renderScreen, visibleText, setupOf } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

const TRAIL = `return {
  book: { number: 'Book-031', status: 'Returned' },
  history: [
    { at: '2026-08-01T09:00:00Z', action: 'issue', from: null, to: 'JOHN',
      by: 'organiser@example.org', note: '' },
    { at: '2026-08-14T10:00:00Z', action: 'transfer', from: 'JOHN', to: 'MARY',
      by: 'organiser@example.org', note: 'JOHN went back to the village' },
    { at: '2026-09-10T11:00:00Z', action: 'return', from: 'MARY', to: null,
      by: 'organiser@example.org', note: '' },
  ],
}`

const storeFor = (result, agents = "{ A1: { name: 'MARY' } }") => `
import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { currency: 'RM', ticketPrice: 10 }, agents: [], user: { role: 'agent' } })
export const api = async () => { ${result} }
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => false)
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => (${agents}))
export const whereIs = () => null
export const optimistic = async () => {}
export const setSellMode = () => {}
export const sellBlock = () => null
export const bookBlock = () => null
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
`

const SOLD_TICKET = {
  number: 'KS-00305', book: 'Book-031', status: 'Sold',
  name: 'Pa Thang', phone: '0123456789', agent: 'A1',
  saleDate: '2026-08-20T08:00:00Z', by: 'recorder@example.org',
  amount: 10, payment: 'Paid', source: '', version: 2,
}

console.log('a book that has moved')
{
  const html = await renderScreen('src/components/modals/History.vue', storeFor(TRAIL), {
    props: { book: 'Book-031' }, drive: (b) => b.load(),
  })
  const said = visibleText(html)

  ok(/Given out/.test(said), 'the handover reads as "Given out", not "issue"')
  ok(/to JOHN/.test(said), 'and names who took it')
  ok(/Passed on/.test(said), 'the transfer reads as English too')
  ok(/from JOHN to MARY/.test(said), 'naming both ends — that is the whole question')
  ok(/Brought back/.test(said), 'and the return')
  ok(/went back to the village/.test(said), 'the note somebody typed is kept, not dropped')
  ok(/organiser@example\.org/.test(said), 'who recorded each movement')
  ok(!/undefined/.test(said) && !/null/.test(said), 'nothing on it reads as a missing value')
}

console.log('a ticket, whose sale belongs in the middle of its book\'s trail')
{
  const html = await renderScreen('src/components/modals/History.vue', storeFor(TRAIL), {
    props: { ticket: SOLD_TICKET }, drive: (b) => b.load(),
  })
  const said = visibleText(html)

  ok(/Sold/.test(said), 'the sale is in the list')
  ok(/by MARY/.test(said), 'attributed to the seller who made it, by name and not by id')
  ok(/Pa Thang/.test(said), 'and says who bought it')
  /*
   * WHO WROTE IT DOWN IS STILL SHOWN, and is no longer shown as a raw address:
   * it goes through the component that turns one into a name with the address
   * kept underneath. The render harness stubs child components, so the words
   * come back empty here — the label survives, and whowrote.test.mjs renders
   * that component on its own and asserts both halves of what it draws.
   */
  ok(/Written down by/.test(said), 'the trail still says who wrote it down')
  ok(/<Who :email="sale\.by"/.test(read('src/components/modals/History.vue')),
     'and hands the address to the component that names the person')
  ok(/Given out/.test(said) && /Brought back/.test(said),
     'the book movements are there too: a ticket travels with its book')

  /*
   * ORDER IS THE POINT. Sold on the 20th of August, between the transfer on the
   * 14th and the return on the 10th of September. Two lists side by side would
   * make the reader do that join in their head, and that is where somebody
   * concludes a ticket was sold after the book came back.
   */
  const at = (s) => said.indexOf(s)
  ok(at('Given out') < at('Passed on'), 'handover before transfer')
  ok(at('Passed on') < at('Sold'), 'transfer before the sale')
  ok(at('Sold') < at('Brought back'), 'and the sale before the book came back')
}

console.log('an unsold ticket invents no sale')
{
  const free = { ...SOLD_TICKET, status: 'Available', name: '', agent: '', saleDate: '' }
  const html = await renderScreen('src/components/modals/History.vue', storeFor(TRAIL), {
    props: { ticket: free }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(!/\bSold\b/.test(said), 'nothing in the trail claims it was sold')
  ok(/Given out/.test(said), 'but the book it sits in still has its movements')
}

console.log('a book that has never moved says so')
{
  const empty = "return { book: { number: 'Book-900', status: 'Unassigned' }, history: [] }"
  const html = await renderScreen('src/components/modals/History.vue', storeFor(empty), {
    props: { book: 'Book-900' }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(/Nothing has been recorded/.test(said), 'it is an answer, not an empty panel')
  ok(/has not been given out/.test(said), 'and says why there is nothing to show')
}

console.log('a book that has moved, with nothing recorded, does not claim otherwise')
{
  /*
   * REPORTED FROM PRODUCTION. Book-001 had been given to a seller and brought
   * back; its own panel said so, by name, one sheet behind this one. This panel
   * said "It has not been given out, so there is nowhere for it to have been."
   *
   * Both halves were empty for an ordinary reason — the raffle ran on a
   * spreadsheet first, and books that moved before the move have no rows — but
   * the sentence did not say that. It asserted the opposite of what the book
   * itself said, which teaches the reader that the trail cannot be trusted.
   */
  const moved = "return { book: { number: 'Book-001', status: 'Returned' }, history: [], tickets: [] }"
  const html = await renderScreen('src/components/modals/History.vue', storeFor(moved), {
    props: { book: 'Book-001' }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(!/has not been given out/.test(said),
     'it does not tell somebody a book was never given out while the book says it was')
  ok(/before the system started keeping them/.test(said),
     'and says what an empty trail on a moved book actually means')

  // The other half still has to work: a book in the office with no trail HAS
  // never moved, and saying so is the useful answer.
  const never = "return { book: { number: 'Book-900', status: 'Unassigned' }, history: [], tickets: [] }"
  const still = visibleText(await renderScreen('src/components/modals/History.vue', storeFor(never), {
    props: { book: 'Book-900' }, drive: (b) => b.load(),
  }))
  ok(/has not been given out/.test(still), 'a book that truly has not moved still says so')
}

console.log('a call that failed keeps the sheet open')
{
  const fails = "throw Object.assign(new Error('The server did not answer.'), { code: 'TIMEOUT' })"
  const { ctx, cleanup } = await setupOf('src/components/modals/History.vue', storeFor(fails),
    { book: 'Book-031' })
  await ctx.load()
  ok(/did not answer/.test(ctx.problem.value), 'it says what went wrong')
  cleanup()

  // The same fix as the verb table below, which 12ae61 caught one slice above
  // this one and I left here: indexOf returning -1 makes slice(start, -1) run to
  // the end of the file, and this region would then be the whole component —
  // which DOES contain emit('close'), twice, in the template. The assertion
  // would fail while naming a region it was not looking at.
  const load = cut(read('src/components/modals/History.vue'),
                   'async function load', 'const WORDS', 'the load function')
  ok(!/emit\('close'\)/.test(load),
     'and never dismisses itself — that is what the receipt was reported for')
}

console.log('every movement the server can record has words for it')
{
  /*
   * ENUMERATED FROM THE SOURCE, not listed by hand.
   *
   * Three places write an action. issueBooks, transferBooks, returnBooks and
   * restockBooks write literals; settle_book writes 'settle' from inside a
   * Postgres function; and setBookStatus writes `status.toLowerCase()`, so its
   * verbs are whatever that handler's own list of valid statuses happens to be.
   * A screen with a hand-written translation table would have covered the four
   * obvious ones and rendered a book reported lost as the bare word "lost".
   */
  const books = read('supabase/functions/api/books.ts')
  const verbs = new Set(
    [...books.matchAll(/action:\s*'(\w+)'/g)].map((m) => m[1]))
  verbs.add('settle')                          // written by the SQL function

  // setBookStatus lower-cases whichever of these somebody sets.
  const valid = books.match(/const valid = \[([^\]]*)\]/)
  ok(!!valid, 'found the status list setBookStatus writes from')
  for (const s of (valid?.[1] ?? '').matchAll(/'(\w+)'/g)) verbs.add(s[1].toLowerCase())

  ok(verbs.size >= 8, `found ${verbs.size} movements the server can write`)

  const vue = read('src/components/modals/History.vue')
  // Code at both ends: this ended at the comment above words(), so rewording
  // that prose moves the marker, indexOf returns -1, and the slice runs to the
  // end of the file — scraping the whole component as if it were the table.
  const table = cut(vue, 'const WORDS', 'function words(', 'the verb table')
  const known = new Set([...table.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]))

  const untranslated = [...verbs].filter((v) => !known.has(v))
  ok(untranslated.length === 0,
    untranslated.length
      ? `these would render as raw server verbs: ${untranslated.join(', ')}`
      : `all ${verbs.size} read as English`)
}

console.log('a verb nobody planned for still appears')
{
  // Belt and braces for the check above: if the server grows a movement before
  // this screen learns the word for it, the step must still show up. A trail
  // that silently omits a step is worse than one with an ugly word in it.
  const odd = `return { book: { number: 'Book-031', status: 'Out' },
    history: [{ at: '2026-08-01T09:00:00Z', action: 'reissued', from: null, to: 'JOHN', by: 'x@y.z', note: '' }] }`
  const html = await renderScreen('src/components/modals/History.vue', storeFor(odd), {
    props: { book: 'Book-031' }, drive: (b) => b.load(),
  })
  ok(/Reissued/.test(visibleText(html)), 'an unknown movement still renders, capitalised')
}

/*
 * ============ THE TICKET'S OWN RECORD ============
 *
 * Everything above this line was written when a ticket had no history and the
 * screen said so in as many words. It has one now — ticket_history, filled by a
 * trigger before each overwrite and refused any update or delete by another —
 * and the value of keeping it is entirely in whether it can be read back. The
 * first version of this feature returned it to organisers only, so a seller
 * holding the book was shown the buyer on the ticket and a blank in its record.
 *
 * These are the cases that decide whether the screen tells the truth about a
 * correction: that the earlier name is still there, that the sale is not
 * printed twice when the record already holds it, and that a step the reader
 * may not see says so rather than rendering as a change that did nothing.
 */

const CORRECTED = `return {
  book: { number: 'Book-031', status: 'Out' },
  history: [
    { at: '2026-08-01T09:00:00Z', action: 'issue', from: null, to: 'MARY',
      by: 'organiser@example.org', note: '' },
  ],
  tickets: [
    { at: '2026-08-20T08:00:00Z', ticket: 'KS-00305', fromStatus: 'Available', toStatus: 'Sold',
      fromSeller: null, toSeller: 'MARY', fromBuyer: '', toBuyer: 'Pa Thang',
      fromPhone: '', toPhone: '0123456789', fromAmount: null, toAmount: 10,
      fromPayment: '', toPayment: 'Unpaid', source: 'app', by: 'recorder@example.org', note: '' },
    { at: '2026-09-01T08:00:00Z', ticket: 'KS-00305', fromStatus: 'Sold', toStatus: 'Sold',
      fromSeller: 'MARY', toSeller: 'MARY', fromBuyer: 'Pa Thang', toBuyer: 'Pa Thaung',
      fromPhone: '0123456789', toPhone: '0123456789', fromAmount: 10, toAmount: 10,
      fromPayment: 'Unpaid', toPayment: 'Paid', source: 'app', by: 'organiser@example.org', note: '' },
  ],
}`

console.log('a corrected sale still shows the name that was on it')
{
  const html = await renderScreen('src/components/modals/History.vue', storeFor(CORRECTED), {
    props: { ticket: { ...SOLD_TICKET, name: 'Pa Thaung' } }, drive: (b) => b.load(),
  })
  const said = visibleText(html)

  ok(/Pa Thaung/.test(said), 'the name on it now')
  ok(/was Pa Thang/.test(said), 'and the name it was corrected FROM — the whole reason to keep a record')
  ok(/Corrected/.test(said), 'a change that moved no status is headed as a correction')
  ok(/Marked paid/.test(said), 'money state is a change too, and the step would otherwise be blank')
  // Same reason as above: the signature is a <Who>, which the harness stubs.
  // That each step carries its own author is asserted on the data instead, so
  // this stays a test of the trail rather than of the stub.
  ok(/<Who :email="s\.by"/.test(read('src/components/modals/History.vue')),
     'each change is signed by whoever made it, through the same component')

  const at = (x) => said.indexOf(x)
  ok(at('Given out') < at('Pa Thang'), 'the book was handed out before the sale')
  ok(at('Pa Thang') < at('Pa Thaung'), 'and the sale before the correction to it')

  /*
   * NOT TWICE. The sale block below the trail draws the ticket's CURRENT state,
   * which is the same event the first recorded change already is. Printed both
   * ways it reads as two sales a fortnight apart, which on this screen is the
   * one mistake that costs somebody real money.
   */
  ok(!/To Pa Thaung/.test(said), 'the sale is not drawn a second time from the ticket row')
}

console.log('a sale older than the record is still shown')
{
  // Two cases at once: a book sold before the trigger existed, and the Apps
  // Script backend, which has no such table and returns no `tickets` at all.
  // The ticket row is the only record of the sale either way.
  const other = `return { book: { number: 'Book-031', status: 'Out' }, history: [],
    tickets: [{ at: '2026-09-01T08:00:00Z', ticket: 'KS-00300', fromStatus: 'Available', toStatus: 'Sold',
      fromSeller: null, toSeller: 'MARY', fromBuyer: '', toBuyer: 'Somebody Else',
      fromPhone: '', toPhone: '0111111111', fromAmount: null, toAmount: 10,
      fromPayment: '', toPayment: 'Paid', source: 'app', by: 'x@y.z', note: '' }] }`
  const html = await renderScreen('src/components/modals/History.vue', storeFor(other), {
    props: { ticket: SOLD_TICKET }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(/To Pa Thang/.test(said), 'the sale on the ticket row is shown, because nothing else holds it')
  ok(!/Somebody Else/.test(said), 'and another ticket\'s record is not mixed into this one')
}

console.log('a step whose details are not for this reader says so')
{
  // What the server sends a seller who is not carrying the book: the movement,
  // and blanks where the buyer was. A step with nothing under it reads as a
  // change that did nothing, which is the opposite of what happened.
  const masked = `return { book: { number: 'Book-031', status: 'Out' }, history: [],
    tickets: [{ at: '2026-09-01T08:00:00Z', ticket: 'KS-00305', fromStatus: 'Sold', toStatus: 'Sold',
      fromSeller: 'MARY', toSeller: 'MARY', fromBuyer: '', toBuyer: '', fromPhone: '', toPhone: '',
      fromAmount: 10, toAmount: 10, fromPayment: 'Paid', toPayment: 'Paid',
      source: 'app', by: 'organiser@example.org', note: '' }] }`
  const html = await renderScreen('src/components/modals/History.vue', storeFor(masked), {
    props: { ticket: SOLD_TICKET }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(/Corrected/.test(said), 'the change is on the list — a gap would read as nothing having happened')
  ok(/not shown them/.test(said), 'and says plainly that the detail is withheld, rather than showing an empty step')

  // And the other way round for the reader who may see it: the note IS the
  // change, and a step printing it must not also claim it is being withheld.
  const noted = masked.replace("note: '' }", "note: 'lives behind the market' }")
  const mine = visibleText(await renderScreen('src/components/modals/History.vue', storeFor(noted), {
    props: { ticket: SOLD_TICKET }, drive: (b) => b.load(),
  }))
  ok(/lives behind the market/.test(mine), 'the note somebody typed about the buyer is shown to whoever may read it')
  ok(!/not shown them/.test(mine), 'and the step does not contradict itself by calling it withheld')
}

console.log('a book\'s history names the ticket each change was to')
{
  const html = await renderScreen('src/components/modals/History.vue', storeFor(CORRECTED), {
    props: { book: 'Book-031' }, drive: (b) => b.load(),
  })
  const said = visibleText(html)
  ok(/KS-00305/.test(said), 'opened on the book, every ticket change is named')
  ok(/Given out/.test(said), 'alongside the book\'s own movements, in one order')
}

console.log('the screen no longer claims the earlier name is gone')
{
  // WITHOUT ITS COMMENTS, which is what codeOf exists for. The docblock above
  // the component quotes the retired sentence in order to say it was retired,
  // and a scan of the raw file reads that quote as the sentence still being on
  // the screen — the exact failure codeOf was written after.
  const shown = codeOf(read('src/components/modals/History.vue'))
  ok(!/earlier name is not kept/.test(shown),
     'that sentence was true when it was written and stopped being true when the trail landed')
  ok(/Nothing here can be edited or removed/.test(shown),
     'and says what is true now: the record is append only')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
