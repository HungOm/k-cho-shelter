/*
 * A sheet that closes itself is the worst answer to "why is there no receipt".
 *
 * REPORTED AS A BUG, and reasonably: the Handover receipt opened, showed its
 * skeletons, and vanished. It was doing exactly what it was written to do —
 * toast "this person has no books out" and emit close — but a toast is gone in
 * seconds and a dialog that dismisses itself for no stated reason is
 * indistinguishable from a crash.
 *
 * Two cases that look identical from outside and need opposite things: nothing
 * to print is a fact about the seller and ends there; a failed call is worth
 * trying again. Both now keep the sheet open and say which happened.
 */
import { readFileSync } from 'node:fs'
import { nextTick } from 'vue'
import { setupOf, renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const storeFor = (result) => `
import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { currency: 'RM', orgName: 'Somebody' }, agents: [], user: { role: 'admin' } })
export const api = async () => { ${result} }
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`
const EMPTY = "return { books: [], generatedAt: '2026-09-15T00:00:00Z' }"
const FAILS = "throw Object.assign(new Error('The server did not answer.'), { code: 'TIMEOUT' })"
/*
 * THE FIXTURE IS BUILT FROM THE HANDLER'S OWN KEYS, not written by hand.
 *
 * 93 caught this in the version below: it was hand-written in Apps Script's
 * vocabulary, so it proved the screen CAN render a receipt, not that it renders
 * the one Supabase sends. That is the same mistake as the payment pill earlier
 * today — a fixture that does not speak the system's language — made again in
 * the test I wrote about making it. The receipt had been failing to render at
 * all on Supabase and nothing here noticed, because nothing here was asking.
 *
 * The keys are scraped and asserted below, so a handler that renames a field
 * fails this file instead of the screen.
 */
const RECEIPT = {
  org: 'Somebody', event: 'Raffle', currency: 'RM',
  agent: { id: 'A1', name: 'JOHN', phone: '0123456789', zone: '' },
  books: [{ book: '31', firstTicket: 'KS-00301', lastTicket: 'KS-00310',
            tickets: 10, issued: '2026-09-01', due: '2026-10-11', soldSoFar: 0 }],
  bookCount: 1, ticketCount: 10, valueIfAllSold: 100,
  issuedBy: 'Admin', generatedAt: '2026-09-15T00:00:00Z'
}
const FULL = `return ${JSON.stringify(RECEIPT)}`

console.log('a seller holding nothing')
{
  const { ctx, cleanup } = await setupOf('src/components/modals/Receipt.vue', storeFor(EMPTY), { agentId: 'A1' })
  await ctx.load(); await nextTick()
  ok(ctx.nothing.value !== '', 'the sheet has something to say')
  ok(/not holding any books/.test(ctx.nothing.value), 'and says the seller is holding none')
  ok(ctx.r.value === null, 'with no receipt to show')
  cleanup()

  const html = await renderScreen('src/components/modals/Receipt.vue', storeFor(EMPTY), {
    props: { agentId: 'A1' }, drive: b => b.load()
  })
  const said = visibleText(html)
  ok(/nothing to print/.test(said), 'the reason is on the screen, not in a toast that has gone')
  ok(/Close/.test(said), 'and there is a way out')
  ok(!/Print \/ Save/.test(said), 'the print button is not offered — there is nothing to print')
  ok(!/Send on WhatsApp/.test(said), 'nor sending, for the same reason')
  ok(!/skel/.test(html), 'and it is not still pretending to load')
}

console.log('a call that failed')
{
  const { ctx, cleanup } = await setupOf('src/components/modals/Receipt.vue', storeFor(FAILS), { agentId: 'A1' })
  await ctx.load(); await nextTick()
  ok(/did not answer/.test(ctx.nothing.value), 'says what went wrong, in the server\'s own words')
  ok(!/not holding any books/.test(ctx.nothing.value),
     'and is not confused with the seller having none — they need opposite responses')
  cleanup()
}

console.log('and a real receipt is unaffected')
{
  const html = await renderScreen('src/components/modals/Receipt.vue', storeFor(FULL), {
    props: { agentId: 'A1' }, drive: b => b.load()
  })
  const said = visibleText(html)
  ok(/KS-00301/.test(said), 'the books are listed')
  ok(/Print \/ Save/.test(said), 'and can be printed')
}

console.log('and the fixture speaks the handler\'s language, not mine')
{
  // Scraped from the source that builds it. A hand-kept list would drift the
  // moment somebody renamed a field, which is exactly what happened: org became
  // orgName and generatedAt became issuedAt, and the screen stopped rendering.
  const people = readFileSync(new URL('../supabase/functions/api/people.ts', import.meta.url), 'utf8')
  const fn = people.slice(people.indexOf('export async function handoverReceipt'))
  /*
   * Both ends checked. indexOf returns -1 when the marker is gone, and
   * slice(start, -1) then runs to the end of the function — so a scrape aimed
   * at one object silently reports another's keys. A guard that misreports when
   * its subject is broken is worst placed exactly where it is needed.
   */
  const cut = (text, from, to, what) => {
    const a = text.indexOf(from), b = text.indexOf(to)
    if (a < 0 || b < 0 || b <= a) throw new Error(`could not find ${what} in people.ts`)
    return text.slice(a, b)
  }
  const ret = cut(fn, '  return {', '\n  }\n}', 'the receipt return block')
  // Shorthand counts too: `ticketCount,` is a key the handler sends, and a
  // pattern that only knows `key:` quietly under-reports what the wire carries.
  const sent = [...ret.matchAll(/^\s{4}(\w+)\s*[:,]/gm)].map(m => m[1])
  ok(sent.length >= 8, `the handler's keys were parsed (${sent.length})`)

  const mine = Object.keys(RECEIPT)
  for (const k of sent) ok(mine.includes(k), `the fixture carries ${k}, which the handler sends`)
  for (const k of mine) ok(sent.includes(k), `and invents nothing: ${k} is really sent`)

  const list = cut(fn, 'const list =', 'const ticketCount', 'the per-book list')
  const perBook = [...list.matchAll(/^\s{4}(\w+)\s*[:,]/gm)].map(m => m[1])
  // Both directions, per book as well. Checking only one way lets a handler
  // DROP a field and still pass — which is how the receipt came to be missing
  // ticketCount in the first place.
  const bookKeys = Object.keys(RECEIPT.books[0])
  for (const k of perBook) ok(bookKeys.includes(k), `and each book carries ${k}`)
  for (const k of bookKeys) ok(perBook.includes(k), `with nothing invented: ${k} is really sent per book`)
}

console.log('nothing closes itself any more')
{
  const src = readFileSync(new URL('../src/components/modals/Receipt.vue', import.meta.url), 'utf8')
  const mounted = src.slice(src.indexOf('async function load'), src.indexOf('const givenOn'))
  ok(!/emit\('close'\)/.test(mounted),
     'the load path never dismisses the sheet — that is what was reported as a bug')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
