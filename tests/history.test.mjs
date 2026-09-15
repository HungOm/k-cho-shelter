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
  ok(/recorder@example\.org/.test(said), 'and who wrote it down — a different person, and often is')
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

console.log('a call that failed keeps the sheet open')
{
  const fails = "throw Object.assign(new Error('The server did not answer.'), { code: 'TIMEOUT' })"
  const { ctx, cleanup } = await setupOf('src/components/modals/History.vue', storeFor(fails),
    { book: 'Book-031' })
  await ctx.load()
  ok(/did not answer/.test(ctx.problem.value), 'it says what went wrong')
  cleanup()

  const src = read('src/components/modals/History.vue')
  const load = src.slice(src.indexOf('async function load'), src.indexOf('const WORDS'))
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
  const table = vue.slice(vue.indexOf('const WORDS'), vue.indexOf('/** Unknown verbs'))
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
