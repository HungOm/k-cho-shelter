/**
 * Giving up on a request, and what we claim afterwards.
 *
 * The endpoint is genuinely slow — a write can take 30s legitimately — so the
 * dangerous mistake here is not waiting too long, it is telling somebody their
 * save failed when it actually succeeded. That is how a stack of counterfoils
 * gets entered twice.
 */
import { readFileSync } from 'node:fs'
import { api, configure, ApiError } from '../src/lib/supabaseApi.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const codeOf = async fn => { try { await fn(); return 'NO_THROW' } catch (e) { return e.code } }

const realFetch = globalThis.fetch
function stubFetch(handler) { globalThis.fetch = handler }

configure({ apiUrl: 'https://example.test/exec', idToken: 'x.y.z' })

console.log('reads and writes are told apart')
{
  /*
   * A NAMED LIST, AND WHAT KEEPS IT HONEST.
   *
   * The Apps Script transport exported an `isRead` that named the READS, so an
   * action it had never heard of counted as a write and got the careful
   * wording. This one names the WRITES, so the unknown case falls the other
   * way — an action missing from the list is given the read timeout and told
   * "it failed", which is the sentence that makes a volunteer enter a sale
   * twice.
   *
   * What stands in for the safer default is clientcoverage.test.mjs, which
   * compares this list against the server's own registry in BOTH directions:
   * every action the registry marks write or bulk must be here, and nothing
   * here may be a read or an action that does not exist. The list cannot
   * silently miss one. That check is load-bearing, not tidiness.
   */
  const src = readFileSync(new URL('../src/lib/supabaseApi.js', import.meta.url), 'utf8')
  const list = src.slice(src.indexOf('const WRITES'), src.indexOf('])', src.indexOf('const WRITES')))
  const writes = new Set([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
  ok(writes.size > 25, `the write list was found (${writes.size} actions)`)
  ok(!writes.has('read_delta') && !writes.has('whoami') && !writes.has('list_books'),
     'known reads are not on it')
  ok(writes.has('sell_ticket') && writes.has('bulk_record_sales'), 'and the writes are')
}

console.log('a hung request does not hang the app')
{
  // Never settles unless aborted. Without a timeout this is the stuck "Saving…".
  stubFetch((url, o) => new Promise((_, reject) => {
    o.signal?.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
    })
  }))
  const started = Date.now()
  const code = await codeOf(() => api('sell_ticket', {}, { timeoutMs: 120 }))
  ok(code === 'WRITE_UNCONFIRMED', `a hung write gives up (got ${code})`)
  ok(Date.now() - started < 2000, 'and gives up promptly rather than never')

  const readCode = await codeOf(() => api('read_delta', {}, { timeoutMs: 120 }))
  ok(readCode === 'TIMEOUT', `a hung read is TIMEOUT, not WRITE_UNCONFIRMED (got ${readCode})`)
}

console.log('the wording never claims a timed-out write failed')
{
  stubFetch((url, o) => new Promise((_, reject) => {
    o.signal?.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
    })
  }))
  let err
  try { await api('bulk_record_sales', {}, { timeoutMs: 100 }) } catch (e) { err = e }
  const m = err.message.toLowerCase()
  ok(!/\bfail(ed|ure)?\b/.test(m), `does not say "failed": ${err.message}`)
  ok(!/could not save|was not saved|not saved/.test(m), 'does not assert it was not saved')
  ok(/longer than expected|cannot yet tell|checking/.test(m),
     'says it is being checked instead')
  ok(err.details?.action === 'bulk_record_sales', 'names the action for the log')
}

console.log('a real network failure is still a network failure')
{
  stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
  ok(await codeOf(() => api('sell_ticket', {})) === 'NETWORK',
     'a refused connection is NETWORK, not a timeout')
}

console.log('a slow but successful write still succeeds')
{
  stubFetch(() => new Promise(res => setTimeout(() =>
    res({ ok: true, status: 200, json: async () => ({ ok: true, data: { recorded: 3 } }) }), 60)))
  const r = await api('bulk_record_sales', {}, { timeoutMs: 1000 })
  ok(r.recorded === 3, 'a 60ms answer inside a 1000ms budget is not aborted')
}

console.log('the timeout does not leak into the next call')
{
  let seenAborted = false
  stubFetch((url, o) => {
    seenAborted = o.signal?.aborted
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: 1 }) })
  })
  await api('sell_ticket', {})
  ok(seenAborted === false, 'each request gets a fresh controller')
}

globalThis.fetch = realFetch
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
