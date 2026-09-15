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
const FULL = `return { books: [{ book: '31', firstTicket: 'KS-00301', lastTicket: 'KS-00310', due: '2026-10-11', issued: '2026-09-01' }],
  bookCount: 1, ticketCount: 10, valueIfAllSold: 100, currency: 'RM',
  org: 'Somebody', event: 'Raffle', agent: { name: 'JOHN', phone: '0123456789' },
  generatedAt: '2026-09-15T00:00:00Z' }`

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

console.log('nothing closes itself any more')
{
  const src = readFileSync(new URL('../src/components/modals/Receipt.vue', import.meta.url), 'utf8')
  const mounted = src.slice(src.indexOf('async function load'), src.indexOf('const givenOn'))
  ok(!/emit\('close'\)/.test(mounted),
     'the load path never dismisses the sheet — that is what was reported as a bug')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
