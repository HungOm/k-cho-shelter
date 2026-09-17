/**
 * The store actually loads data, exercised as a module.
 *
 * Every other suite tests a pure function or reads source text. Nothing ran
 * store.js itself, which is how renaming an import to `rawApi` — and leaving
 * every internal `api(...)` call pointing at a name that no longer existed —
 * passed 1,422 assertions while breaking every data load in the app.
 *
 * It was invisible because refresh() wraps each section in a try/catch that
 * turns a failure into a line in state.problems. That is the right behaviour
 * for a flaky network and the wrong behaviour for a typo, so the typo has to
 * be caught here instead.
 */
// Minimal browser surface. The store reads localStorage at module load and the
// cache layer wants IndexedDB; neither may throw on import.
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] }
}

/*
 * DIRECT READS OFF, because these suites stub `fetch` and drive the store.
 *
 * backend.js sends row reads straight to PostgREST rather than through the Edge
 * Function — that shortcut is the whole performance difference and is on by
 * default. It goes through the Supabase client, not through `fetch`, so a
 * stubbed transport never sees the call and every read comes back NO_CONNECTION.
 *
 * Set before backend.js is imported: `directReads` is decided once, at module
 * load, from this key.
 */
globalThis.localStorage.setItem('kcho_direct_reads', 'off')
globalThis.indexedDB = undefined

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const FIELDS = ['Ticket_Number','Status','Book_Number','Buyer_Name','Buyer_Phone',
  'Buyer_Zone','Sold_By_Agent','Amount','Payment_Status','Sale_Date','Notes',
  'Source','Version','Recorded_By','Modified_Date']
const row = (n, status) => {
  const r = new Array(FIELDS.length).fill('')
  r[0] = 'KS-' + String(n).padStart(5, '0'); r[1] = status
  r[2] = 'Book-' + String(Math.ceil(n / 10)).padStart(3, '0'); r[12] = 1
  return r
}

const calls = []
globalThis.fetch = async (url, o) => {
  const { action } = JSON.parse(o.body)
  calls.push(action)
  // json(), not text(): the Apps Script transport read the body as text
  // because its responses were text/plain to dodge a CORS preflight. The
  // Edge Function answers JSON and this stub answers what it answers.
  const ok_ = d => ({ ok: true, status: 200, json: async () => ({ ok: true, data: d }) })
  if (action === 'read_snapshot') {
    const rows = []
    for (let i = 1; i <= 20; i++) rows.push(row(i, i <= 3 ? 'Sold' : 'Available'))
    return ok_({ fields: FIELDS, rows, offset: 0, returned: 20, total: 20,
      hasMore: false, version: 7, serverTime: '2026-01-01T00:00:00Z' })
  }
  if (action === 'read_delta') {
    return ok_({ fields: FIELDS, rows: [row(4, 'Sold')], count: 1, version: 8,
      serverTime: '2026-01-01T00:05:00Z' })
  }
  if (action === 'list_agents') return ok_({ agents: [] })
  if (action === 'list_books') return ok_({ books: [], stats: {}, currency: 'RM', total: 0 })
  return ok_({})
}

const store = await import('../src/lib/store.js')
const { state, configure, loadSnapshot, loadDelta } = {
  ...store, configure: (await import('../src/lib/supabaseApi.js')).configure
}
configure({ apiUrl: 'https://example.test/exec', idToken: 'x.y.z' })

console.log('the store can load a snapshot')
await loadSnapshot()
ok(calls.includes('read_snapshot'), 'read_snapshot was actually requested')
ok(state.tickets.length === 20, `20 tickets landed (got ${state.tickets.length})`)
ok(!!state.byNumber['KS-00001'], 'the index is keyed by full ticket number')
ok(state.byNumber['KS-00001'].status === 'Sold', 'status came through')
ok(state.ticketVersion === 7, 'the version was recorded')

console.log('and a delta on top of it')
await loadDelta()
ok(state.byNumber['KS-00004'].status === 'Sold', 'the delta row was merged in')
ok(state.tickets.length === 20, 'a changed row updates rather than duplicating')
ok(state.ticketVersion === 8, 'the version moved')

console.log('every exported function is actually callable')
for (const name of ['loadSnapshot', 'loadDelta', 'refresh', 'toast', 'whereIs']) {
  ok(typeof store[name] === 'function', `${name} is exported as a function`)
}

console.log('refresh reports trouble instead of throwing')
{
  const boom = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  state.tickets = []
  await store.refresh()
  ok(state.problems.length > 0, 'a dead network becomes a reported problem')
  ok(state.problems.every(p => p.code && p.message), 'each problem names a code and a message')
  globalThis.fetch = boom
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
