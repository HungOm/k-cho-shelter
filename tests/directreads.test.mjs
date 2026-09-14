/*
 * Row reads go straight to the database, and mean the same thing when they get
 * back.
 *
 * This drives the REAL supabase-js against a stubbed HTTP layer rather than
 * stubbing the client, because the thing most likely to be wrong is the query
 * itself — the wrong view, a missing keyset, an agent filter applied twice, a
 * column list that drifts from the view. A stubbed client would agree with
 * whatever the code asked for and prove nothing. So the requests are inspected
 * as URLs.
 *
 * The contract under test is one sentence: the direct path returns EXACTLY the
 * envelope the Edge Function returns. store.js, the ticket cache and
 * supabaseload.test.mjs are all written against that shape, and every bug in
 * this repo today was two things that were supposed to be the same shape and
 * were not.
 *
 * Its counterpart is supabaseload.test.mjs, which turns this path OFF and
 * drives the same store through the Edge Function. Both paths are real — one
 * is the default, the other is what ?directreads=off returns to — so both are
 * tested rather than one being assumed to still work.
 */
globalThis.localStorage = {
  _d: { kcho_backend: 'supabase',
        kcho_sb_url: 'https://proj.supabase.co',
        kcho_sb_key: 'sb_publishable_test' },
  getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] }
}
globalThis.indexedDB = undefined
// supabase-js builds a RealtimeClient inside createClient, and Node 20 has no
// native WebSocket. The browser does, and this app never opens a channel — the
// shim exists so the test can reach PostgREST, not because anything subscribes.
globalThis.WebSocket = class { constructor() {} close() {} addEventListener() {} }
globalThis.location = { search: '', pathname: '/', hash: '', origin: 'https://app.test' }
globalThis.history = { replaceState() {} }

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => ok(String(g) === String(w), `${what}: got ${g}, want ${w}`)

const TOTAL = 2500
const NOW = '2026-09-14T10:00:00+00:00'
const seen = []

function ticketRow(i) {
  return {
    idx: i, number: 'KS-' + String(i).padStart(5, '0'),
    status: i <= 3 ? 'Sold' : 'Available',
    book_number: 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0'),
    buyer_name: '', buyer_phone: '', buyer_zone: '', sold_by_agent: '',
    amount: 0, payment_status: '', sold_at: '', notes: '', source: '',
    version: 1, recorded_by: '', modified_at: '2026-09-01T00:00:00+00:00',
  }
}

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url))
  seen.push(u)
  const json = (body, headers) => new Response(JSON.stringify(body),
    { status: 200, headers: { 'content-type': 'application/json', ...headers } })

  if (u.pathname.endsWith('/rpc/server_now')) return json(NOW)

  if (u.pathname.endsWith('/tickets_readable')) {
    const limit = Number(u.searchParams.get('limit') || 1000)
    const gt = u.searchParams.get('idx')            // e.g. "gt.1000"
    const since = u.searchParams.get('modified_at') // e.g. "gte.<iso>"
    if (since) return json([{ ...ticketRow(4), status: 'Sold' }])
    const after = gt ? Number(gt.split('.')[1]) : 0
    const rows = []
    for (let i = after + 1; i <= Math.min(after + limit, TOTAL); i++) rows.push(ticketRow(i))
    // PostgREST reports an exact count in content-range, which is where
    // supabase-js reads `count` from.
    return json(rows, { 'content-range': `${after}-${after + rows.length - 1}/${TOTAL - after}` })
  }
  if (u.pathname.endsWith('/book_ledger')) {
    return json([{ idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A1',
                   due_at: '2026-09-20', past_final: false, days_overdue: 0 }])
  }
  if (u.pathname.endsWith('/agents_readable')) {
    return json([{ agent_id: 'A1', name: 'Ma Ma', phone: '', zone: '', active: true }])
  }
  return json({})
}

const { directReads } = await import('../src/lib/backend.js')
const reads = await import('../src/lib/supabaseReads.js')
const store = await import('../src/lib/store.js')

console.log('direct reads are on by default for Supabase')
ok(directReads, 'the switch defaulted to the fast path')
ok(reads.DIRECT_READS.has('read_snapshot') && reads.DIRECT_READS.has('read_delta'),
   'the ticket reads are claimed by the direct path')
ok(reads.DIRECT_READS.size === 2,
   `only the ticket reads go direct, got ${[...reads.DIRECT_READS].join(',')}`)
for (const write of ['sell_ticket', 'settle_book', 'decide_approval', 'record_winner']) {
  ok(!reads.DIRECT_READS.has(write), `${write} still goes through the function`)
}
// list_books returns counts, currency and the generated/held-back totals as
// well as rows. Computing those here too would put the same number in two
// places, and books are few enough that the function's overhead costs least
// exactly here.
// list_agents joined list_books here: both return a computed field the client
// needs (booksOut, stats) and both key on the client's shape rather than the
// database's. A direct read that skips the function has to translate, and where
// the translation is more than a rename it belongs on one side only.
for (const agg of ['list_books', 'list_agents', 'search', 'report_draw_ready',
                   'list_approvals', 'report_overdue']) {
  ok(!reads.DIRECT_READS.has(agg), `${agg} stays server-side`)
}

console.log('the wire order matches the function, field for field')
const fnSrc = (await import('node:fs'))
  .readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')
const theirs = fnSrc.match(/const WIRE_FIELDS = \[([\s\S]*?)\]/)[1]
  .match(/'([A-Za-z_]+)'/g).map(s => s.replace(/'/g, ''))
eq(reads.WIRE_FIELDS.join(','), theirs.join(','), 'WIRE_FIELDS is identical to the function\'s')

console.log('a snapshot loads through the store, paging by keyset')
await store.loadSnapshot()
eq(store.state.tickets.length, TOTAL, 'every active ticket landed')
const ticketCalls = seen.filter(u => u.pathname.endsWith('/tickets_readable'))
eq(ticketCalls.length, 3, 'three pages, not one repeated')
ok(ticketCalls[0].searchParams.get('select')?.includes('book_number'),
   'the query asks for book_number — the client must never derive it')
ok(!ticketCalls[0].searchParams.has('offset'),
   'paged by keyset, not offset — OFFSET 19000 walks 19,000 rows and discards them')
eq(ticketCalls[1].searchParams.get('idx'), 'gt.1000', 'the second page seeks past the first')
eq(ticketCalls[2].searchParams.get('idx'), 'gt.2000', 'and the third past the second')
ok(ticketCalls.every(u => u.pathname.includes('tickets_readable')),
   'never the base table — only the view is readable')

console.log('and the rows mean what the app thinks they mean')
const t = store.state.byNumber['KS-00001']
ok(!!t, 'the index is keyed by full ticket number')
eq(t.status, 'Sold', 'status came through')
eq(t.book, 'Book-001', 'the book is a NUMBER, not the integer index')
eq(store.state.lastSync, NOW, 'the cursor is the database clock, not the phone\'s')

console.log('a delta asks the database for the time before it asks for the rows')
const before = seen.length
await store.loadDelta()
const after = seen.slice(before)
const clock = after.findIndex(u => u.pathname.endsWith('/rpc/server_now'))
const rows = after.findIndex(u => u.pathname.endsWith('/tickets_readable'))
ok(clock >= 0 && clock < rows,
   'server_now() is read BEFORE the rows, so a write mid-query is not lost in the gap')
ok(after[rows].searchParams.get('modified_at')?.startsWith('gte.'),
   'gte, not gt — a row written in the cursor\'s millisecond must not fall through')
eq(store.state.byNumber['KS-00004'].status, 'Sold', 'the changed row merged in')
eq(store.state.tickets.length, TOTAL, 'and did not duplicate')


console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
