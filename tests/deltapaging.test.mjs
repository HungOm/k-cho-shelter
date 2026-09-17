/*
 * The thousandth changed ticket was the last anybody heard of.
 *
 * read_delta capped at a thousand rows and said nothing about the cap. A device
 * shut for an afternoon in which more than that changed — one bulk import, one
 * sale of a large book range, one settlement of twenty books — was sent the
 * oldest thousand, moved its clock to the newest of THOSE, and asked again from
 * a point it had already passed. Everything after the cap was never sent and
 * never asked for again.
 *
 * It is the worst shape of staleness, because nothing looks broken: the rows
 * that arrived are correct, the count is plausible, and the sale the volunteer
 * is standing at the desk querying is simply not on the screen until somebody
 * reloads the whole app.
 *
 * TWO HALVES, AND EITHER ALONE IS USELESS. The server has to say there is more
 * and where to carry on from; the client has to follow it. A server that pages
 * to a client that takes one page is the same bug with more code, so both are
 * tested here — the server against a real handler, the client against its own
 * loop.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

const OLD = '2026-09-01T00:00:00.000Z'

/** A raffle where `n` tickets all changed after the caller's cursor. */
function world(n, { sameInstant = false } = {}) {
  const at = (i) => sameInstant
    ? '2026-09-16T10:00:00.000Z'
    : new Date(Date.parse('2026-09-16T10:00:00.000Z') + i * 1000).toISOString()
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: String(n), ACTIVE_TICKETS: String(n) }),
    agents: [{ agent_id: 'A001', name: 'Josh', active: true }],
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null }],
    books: [{ idx: 1, number: 'Book-001', status: 'Unassigned',
              first_ticket: 'KS-00001', last_ticket: 'KS-00010' }],
    tickets: Array.from({ length: n }, (_, i) => ({
      idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'), book_idx: 1,
      status: 'Available', version: 1, modified_at: at(i),
    })),
  })
}

const call = async (w, since) => {
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_delta', payload: { since } }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email: 'boss@x.com' } })
  return await res.json()
}

/*
 * ONE WORLD FOR EVERY SERVER CASE. readConfig caches for sixty seconds by
 * design, so a second fixture's config is never read in the same process and a
 * second world silently answers with the first one's ticket ceiling. That cost
 * twenty minutes; it is written here so the next person spends none.
 *
 * The scenarios are driven by WHERE the caller's clock is instead, which is how
 * they differ in life anyway.
 */
const W = world(1001)
const STAMP = (i) => W.db.tables.tickets[i - 1].modified_at

console.log('1. a page that fits says there is nothing more')
{
  const w = W
  const d = (await call(w, STAMP(996))).data
  eq(d.count, 5, 'every changed ticket arrives')
  eq(d.hasMore, false, 'and the server says that is all of them')
  eq(d.nextSince, '', 'with no cursor to carry on from')
}

console.log('2. a full page says there is more, and where to carry on')
{
  /*
   * 1001 changed rows against a cap of 1000. The old answer was a thousand rows
   * and silence; the missing one was never mentioned again.
   */
  const w = W
  const first = (await call(w, OLD)).data
  eq(first.count, 1000, 'the page is capped, as it always was')
  eq(first.hasMore, true, 'but the server admits there is more')
  ok(!!first.nextSince, 'and hands back where to carry on from')

  const second = (await call(w, first.nextSince)).data
  eq(second.count, 1, 'the rest arrives on the next ask')
  eq(second.hasMore, false, 'and then it really is all of them')

  // The whole point, stated as the thing a volunteer would notice.
  const seen = new Set([...first.rows, ...second.rows].map((r) => r[first.fields.indexOf('Ticket_Number')]))
  eq(seen.size, 1001, 'no changed ticket was silently dropped')
}

console.log('3. rows sharing one timestamp are not skipped past')
{
  /*
   * modified_at is not unique: everything written in one transaction shares it
   * to the microsecond. A cursor of "greater than the last row's stamp" landing
   * inside such a group would skip the remainder for ever, so a full page whose
   * timestamp continues is still reported as having more — and the client asks
   * again from that stamp, receiving the overlap rather than losing the tail.
   */
  /*
   * The cap falls inside a group of rows written in one transaction. Asking
   * "everything after this timestamp" next time would skip the rest of that
   * group for ever — the original bug with an extra step, and harder to find
   * because it needs a bulk write to land across a page boundary.
   */
  const w = W
  const shared = STAMP(1000)
  for (let i = 995; i <= 1001; i++) w.db.tables.tickets[i - 1].modified_at = shared

  const page = (await call(w, OLD)).data
  ok(page.count >= 1000, `the page is completed past the cap (${page.count} rows)`)
  const numbers = new Set(page.rows.map((r) => r[page.fields.indexOf('Ticket_Number')]))
  for (let i = 995; i <= 1001; i++) {
    const n = 'KS-' + String(i).padStart(5, '0')
    ok(numbers.has(n), `${n}, written in the same instant as the cap, is in the page`)
  }
  eq(page.nextSince, shared, 'and the cursor points at that instant, with its group complete')
}

console.log('4. the client follows the cursor rather than taking one page')
{
  /*
   * Read from the store's own source: the loop is the half that makes the
   * server's answer worth anything, and a test that only checked the handler
   * would pass against a client that still takes the first page and stops.
   */
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function loadDelta'), src.indexOf('\n}\n', src.indexOf('export async function loadDelta')))

  ok(/for \(let page = 0; page < \d+; page\+\+\)/.test(fn), 'it loops over pages')
  ok(/if \(!d\.hasMore \|\| !d\.nextSince\) break/.test(fn), 'stopping when the server says there is no more')
  ok(/since = d\.nextSince/.test(fn), 'and carrying on from where it was told')
  ok(/page < 20/.test(fn), 'bounded, so a bad answer cannot hang the app')

  /*
   * And the clock moves once, at the end. Moving it per page leaves a hole if a
   * later page fails: those rows are missed and the cursor is already past them.
   */
  const clockLine = fn.slice(fn.indexOf('if (serverTime) state.lastSync'))
  ok(clockLine.startsWith('if (serverTime) state.lastSync = serverTime'),
     'the cursor is written after every page has been applied, not during')
  ok(!/state\.lastSync = d\.serverTime/.test(fn),
     'and never from inside the loop')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
