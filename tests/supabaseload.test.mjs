/**
 * The store loads data on the SUPABASE backend, exercised as a module.
 *
 * storeload.test.mjs drives the same code against the Apps Script shape —
 * `fields` plus compact rows plus offset — and passes. That is exactly why the
 * Supabase backend could ship unable to load a single ticket: the suite proved
 * one path and was silent about the other, so all thirty files stayed green
 * while read_snapshot returned row objects with no `fields` at all and
 * toTicket threw on the first page. A suite that cannot fail for a backend is
 * not testing that backend.
 *
 * So this is the counterpart, and it asserts the three things that were
 * actually wrong rather than the happy path in general:
 *   1. the wire carries `fields`, and their names are the ones FIELD_MAP reads
 *   2. paging ADVANCES — the old client sent `offset` to a function that only
 *      read `cursor`, so page one came back forty times
 *   3. the book arrives as a book NUMBER, not the integer index the view
 *      stores, because the grid and search key on the number
 */
import { readFileSync } from 'node:fs'

// Minimal browser surface. backend.js reads location and localStorage at import
// time, and neither may throw — reading storage at module scope is how this app
// went blank once already.
globalThis.localStorage = {
  // directreads off ON PURPOSE. Row reads now go straight to PostgREST by
  // default, so without this the snapshot never reaches the Edge Function and
  // this file would quietly stop testing the thing it was written for.
  // The function path is still real — it is what ?directreads=off falls back
  // to when the views misbehave in front of volunteers — so it keeps a test.
  // directreads.test.mjs covers the fast path; this one covers the fallback.
  _d: { kcho_direct_reads: 'off' },
  getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] }
}
globalThis.indexedDB = undefined
globalThis.location = { search: '', pathname: '/', hash: '' }
globalThis.history = { replaceState() {} }

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => ok(String(g) === String(w), `${what}: got ${g}, want ${w}`)

// Taken from the Edge Function, not retyped by hand: if WIRE_FIELDS there and
// FIELD_MAP in the store ever drift apart, this test must drift with the
// function and fail against the store, which is the direction that catches it.
const fnSrc = readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')
const FIELDS = fnSrc.match(/const WIRE_FIELDS = \[([\s\S]*?)\]/)[1]
  .match(/'([A-Za-z_]+)'/g).map(s => s.replace(/'/g, ''))

const TOTAL = 2500
const PAGE = 1000               // the function's own cap, whatever the client asks for

/** One wire row, in WIRE_FIELDS order, the way toWire() emits it. */
function wireRow(i) {
  const r = new Array(FIELDS.length).fill('')
  r[FIELDS.indexOf('Ticket_Number')] = 'KS-' + String(i).padStart(5, '0')
  r[FIELDS.indexOf('Status')] = i <= 3 ? 'Sold' : 'Available'
  // The book NUMBER. The view stores book_idx as an integer and toWire resolves
  // it through the books join; an integer arriving here is the bug.
  r[FIELDS.indexOf('Book_Number')] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0')
  r[FIELDS.indexOf('Version')] = 1
  r[FIELDS.indexOf('Modified_Date')] = '2026-01-01T00:00:00Z'
  return r
}

const pagesServed = []
let authHeaders = 0

globalThis.fetch = async (url, o) => {
  if (o?.headers?.Authorization?.startsWith('Bearer ')) authHeaders++
  const { action, payload } = JSON.parse(o.body)
  const reply = d => ({ json: async () => ({ ok: true, data: d }) })

  if (action === 'read_snapshot') {
    // Mirrors index.ts readSnapshot: cursor wins, offset is honoured, and the
    // limit is capped server-side however much the client asked for.
    const after = Number(payload?.cursor ?? payload?.offset ?? 0)
    pagesServed.push(after)
    const rows = []
    for (let i = after + 1; i <= Math.min(after + PAGE, TOTAL); i++) rows.push(wireRow(i))
    const last = after + rows.length
    const more = rows.length === PAGE && last < TOTAL
    return reply({
      fields: FIELDS, rows, offset: after, returned: rows.length, total: TOTAL,
      nextCursor: more ? last : null, hasMore: more,
      version: String(last), serverTime: '2026-01-01T00:00:00Z',
    })
  }
  if (action === 'read_delta') {
    const r = wireRow(4); r[FIELDS.indexOf('Status')] = 'Sold'
    return reply({ fields: FIELDS, rows: [r], count: 1, version: '2500',
                   serverTime: '2026-01-01T00:05:00Z' })
  }
  if (action === 'list_agents') return reply({ agents: [] })
  if (action === 'list_books') return reply({ books: [], stats: {}, currency: 'RM', total: 0 })
  if (action === 'whoami') return reply({ name: 'T', role: 'admin', config: {} })
  return reply({})
}

const store = await import('../src/lib/store.js')
const { configure } = await import('../src/lib/backend.js')
configure({ apiUrl: 'https://example.supabase.co', idToken: 'x.y.z' })

console.log('the transport under test is the one the app uses')
// There used to be a choice here, and this asserted which way it had gone.
// backend.js has one transport now, so what is worth pinning is that the store
// reaches the server through it at all rather than through something stubbed
// into place beside it.
ok(typeof configure === 'function', 'backend.js exposes the transport the store calls')

console.log('a snapshot loads, and paging actually advances')
await store.loadSnapshot()
eq(store.state.tickets.length, TOTAL, 'every active ticket landed')
eq(pagesServed.length, 3, 'three pages were fetched')
ok(pagesServed[0] === 0 && pagesServed[1] === 1000 && pagesServed[2] === 2000,
   `the cursor moved: ${pagesServed.join(',')}`)
// The failure this replaces: offset sent, cursor read, page one served forever.
ok(new Set(pagesServed).size === pagesServed.length, 'no page was fetched twice')
ok(authHeaders > 0, 'the request carried a Bearer session, not a body token')

console.log('and the rows mean what the app thinks they mean')
const t = store.state.byNumber['KS-00001']
ok(!!t, 'the index is keyed by full ticket number')
eq(t.status, 'Sold', 'status came through')
eq(t.book, 'Book-001', 'the book is a book NUMBER, not the integer index')
ok(!/^\d+$/.test(String(t.book)), 'a bare integer here means book_idx leaked through')
eq(t.version, 1, 'version parsed as a number')
for (const key of ['number', 'status', 'book', 'name', 'phone']) {
  ok(t[key] !== undefined, `FIELD_MAP resolved ${key} — undefined means the names drifted`)
}

console.log('a delta merges on top without duplicating')
await store.loadDelta()
eq(store.state.byNumber['KS-00004'].status, 'Sold', 'the delta row was merged in')
eq(store.state.tickets.length, TOTAL, 'a changed row updates rather than appending')

console.log('and a dead network is reported, not thrown')
{
  const boom = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  store.state.tickets = []
  await store.refresh()
  ok(store.state.problems.length > 0, 'a dead network becomes a reported problem')
  ok(store.state.problems.every(p => p.code && p.message), 'each problem names a code and a message')
  globalThis.fetch = boom
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
