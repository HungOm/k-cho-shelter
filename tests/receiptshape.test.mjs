/*
 * The receipt, rendered against the payload the LIVE backend actually sends.
 *
 * THE BUG THIS EXISTS FOR: handoverReceipt on Supabase is a port of the Apps
 * Script handler, and the port renamed half the payload and dropped the rest.
 * org became orgName, generatedAt became issuedAt, and ticketCount,
 * valueIfAllSold, issuedBy and the per-book ticket count were never built at
 * all. Receipt.vue reads the original spellings. So on Supabase the receipt
 * headed itself "undefined", stamped every first print as a reprint — an
 * invalid date never equals the day the books went out — and then threw on
 * `valueIfAllSold.toFixed(2)` inside a computed the template consults to decide
 * whether to show the WhatsApp button. A computed that throws during render
 * takes the sheet with it: the receipt did not appear AT ALL for any seller
 * with a dialable phone.
 *
 * WHY NOTHING CAUGHT IT, which matters more than the bug:
 *
 *   1. readshape.test.mjs asks whether SOME backend builds each key, and unions
 *      the two. Apps Script builds all of them, so a field missing from the
 *      backend that is running reads as present.
 *   2. Its scanner follows `const r = await api(...)` for sixty lines. Receipt
 *      .vue assigns the answer to a ref and reads it back as `r.value.org`, so
 *      the scanner found exactly one key — `books` — and checked that one.
 *   3. receiptempty.test.mjs renders a full receipt and asserts it works, with a
 *      fixture written in the Apps Script vocabulary. It proved the screen CAN
 *      render a receipt, not that it renders the one it will be given. That is
 *      the same mistake a commit message in this repo had just finished
 *      describing about a paid/unpaid chip.
 *
 * So this file does the two things none of those do: it compares the backends'
 * payloads to each other rather than to a union, and it builds its fixture FROM
 * the handler source, so a fixture can never again describe a payload the
 * system does not send.
 */
import { readFileSync } from 'node:fs'
import { codeOf } from './source.mjs'
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/*
 * CODE ONLY, for every scrape in this file.
 *
 * These assertions are about what a handler BUILDS and what a screen READS, and
 * both files discuss those keys at length in prose — people.ts now carries a
 * paragraph naming org, orgName, generatedAt, issuedAt, ticketCount and
 * valueIfAllSold, because that is the bug it documents. A scrape over the raw
 * text would find the vocabulary in the explanation of the vocabulary and
 * report the payload as correct on the strength of a comment about it.
 * 12ae61's point, and this file was one match away from it.
 *
 * It also makes the brace matching honest: a comment holding an unbalanced
 * brace would otherwise end the return literal in the wrong place.
 */
const read = (p) => codeOf(readFileSync(new URL('../' + p, import.meta.url), 'utf8'))

/** The body of one function, from its signature to the next top-level one. */
function bodyOf(src, signature) {
  const at = src.indexOf(signature)
  if (at < 0) return ''
  const rest = src.slice(at + signature.length)
  const next = rest.search(/\n(?:export async function|function) /)
  return next < 0 ? rest : rest.slice(0, next)
}

/**
 * The keys of the object literal a function RETURNS.
 *
 * Brace-matched rather than regexed to the end, because a nested object — the
 * `agent: { ... }` both handlers build — would otherwise contribute its own
 * keys and make two different payloads look alike.
 */
function returnedKeys(body) {
  const at = body.lastIndexOf('return {')
  if (at < 0) return new Set()
  let depth = 0, end = at
  for (let i = at + 'return '.length; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}' && --depth === 0) { end = i; break }
  }
  const literal = body.slice(at + 'return {'.length, end)

  const keys = new Set()
  let nest = 0
  for (const line of literal.split('\n')) {
    // `key: value` and bare `key,` alike. Missing the shorthand form would
    // report a key as unbuilt while the handler builds it — a false alarm is
    // how an instrument like this stops being read.
    const key = nest === 0 && line.match(/^\s*([A-Za-z_]\w*)\s*[:,]/)
    if (key) keys.add(key[1])
    for (const ch of line) {
      if (ch === '{' || ch === '[') nest++
      else if (ch === '}' || ch === ']') nest--
    }
  }
  return keys
}

const supa = returnedKeys(bodyOf(read('supabase/functions/api/people.ts'),
  'export async function handoverReceipt'))
console.log('the instrument found the payload')
{
  /*
   * WHAT THIS USED TO DO was diff the handler's keys against the Apps Script
   * one in both directions, because `handleHandoverReceipt` was the reference
   * and a key only it built was the bug that had been live. With one backend
   * there is no second opinion to diff against, so the reference moves to the
   * SCREEN — which is what the receipt is for and is the half that could always
   * catch a key going missing.
   */
  ok(supa.size >= 8, `the handler builds ${supa.size} keys`)
}

console.log('and the screen reads exactly those names')
{
  const vue = read('src/components/modals/Receipt.vue')
  // Every r.value.<key> and r.<key> the receipt reaches for, minus the ones
  // that belong to the arrays it walks rather than to the payload itself.
  const reads = new Set([...vue.matchAll(/\br(?:\.value)?\.(\w+)/g)].map((m) => m[1]))
  reads.delete('value')
  const unbuilt = [...reads].filter((k) => !supa.has(k))
  ok(unbuilt.length === 0,
    unbuilt.length ? `the receipt reads keys Supabase never sends: ${unbuilt.join(', ')}`
                   : `all ${reads.size} keys the screen reads are built`)
}

/*
 * The fixture is BUILT FROM the handler's own key list.
 *
 * Every value is supplied here, but the KEYS come from the set above — so a
 * handler that stops sending one makes this fixture stop sending it too, and
 * the assertions below fail on the screen rather than passing against a payload
 * the system no longer produces. That is the hole the last receipt fixture fell
 * into, in the opposite direction.
 */
const VALUES = {
  org: "'Chin Evangelical Association'",
  event: "'Shelter Raffle 2026'",
  currency: "'RM'",
  agent: "{ id: 'A1', name: 'JOHN', phone: '0123456789', zone: 'North' }",
  books: "[{ book: 'Book-031', firstTicket: 'KS-00301', lastTicket: 'KS-00310', " +
         "tickets: 10, issued: TODAY, due: '2026-10-11', soldSoFar: 3 }]",
  bookCount: '1',
  ticketCount: '10',

  valueIfAllSold: '100',
  issuedBy: "'organiser@example.org'",
  generatedAt: 'TODAY',
}

const missingValue = [...supa].filter((k) => !(k in VALUES))
ok(missingValue.length === 0,
  missingValue.length ? `this test has no value for new key(s): ${missingValue.join(', ')}`
                      : 'the fixture covers every key the handler builds')

const payload = [...supa].map((k) => `  ${k}: ${VALUES[k] ?? 'null'},`).join('\n')
const storeStub = `
import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { currency: 'RM' }, agents: [], user: { role: 'admin' } })
const TODAY = '2026-09-15T09:00:00Z'
export const api = async () => ({
${payload}
})
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`

console.log('the receipt renders what that backend sends')
{
  let html = '', threw = null
  try {
    html = await renderScreen('src/components/modals/Receipt.vue', storeStub, {
      props: { agentId: 'A1' }, drive: (b) => b.load(),
    })
  } catch (err) { threw = err }

  // First, because every other assertion here is meaningless if it did not.
  ok(!threw, threw ? `the sheet threw while rendering: ${threw.message}` : 'it renders at all')

  const said = visibleText(html)
  ok(/Chin Evangelical Association/.test(said), 'the organisation heads the paper')
  ok(/Shelter Raffle 2026/.test(said), 'and the event is named under it')
  ok(/JOHN/.test(said), 'the seller it was given to')
  ok(/Book-031/.test(said), 'the book')
  ok(/KS-00301/.test(said) && /KS-00310/.test(said), 'and the range of tickets in it')
  ok(/organiser@example\.org/.test(said), 'who handed them over — a receipt nobody signed for is not one')
  ok(/100\.00/.test(said), 'what it is worth if it all sells')
  ok(!/undefined/.test(said), 'and nothing on the paper reads "undefined"')

  // The count of tickets in the book. It is its own column on the printed
  // table, and it was empty on every row: the port never built `tickets`.
  const rows = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'))
  ok(/>\s*10\s*</.test(rows), 'the how-many column is filled in, not blank')
}

console.log('a receipt printed the day the books went out is not stamped a copy')
{
  const html = await renderScreen('src/components/modals/Receipt.vue', storeStub, {
    props: { agentId: 'A1' }, drive: (b) => b.load(),
  })
  ok(!/Reprint/.test(visibleText(html)),
     'no Reprint stamp — issued today, printed today')
}

console.log('a real reprint still says so')
{
  const older = storeStub.replace("issued: TODAY", "issued: '2026-09-01T00:00:00Z'")
  const html = await renderScreen('src/components/modals/Receipt.vue', older, {
    props: { agentId: 'A1' }, drive: (b) => b.load(),
  })
  ok(/Reprint/.test(visibleText(html)),
     'books that went out a fortnight ago print as a copy, not a fresh handover')
}

console.log('and a payload missing its total cannot take the sheet down')
{
  /*
   * The specific crash, pinned. `valueIfAllSold.toFixed(2)` threw inside the
   * computed the template consults for the WhatsApp button, so ONE absent
   * number meant no receipt at all rather than a receipt with a gap in it. A
   * screen should degrade at the field that is missing and nowhere else.
   */
  const gutted = storeStub.replace(/^\s*valueIfAllSold:.*$/m, '')
  let threw = null, said = ''
  try {
    said = visibleText(await renderScreen('src/components/modals/Receipt.vue', gutted, {
      props: { agentId: 'A1' }, drive: (b) => b.load(),
    }))
  } catch (err) { threw = err }
  ok(!threw, threw ? `one missing field still breaks the sheet: ${threw.message}` : 'the sheet still renders')
  ok(/Book-031/.test(said), 'and still lists the books that went out')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
