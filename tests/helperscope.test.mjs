/*
 * What a helper may read.
 *
 * A helper (recorder) is usually a volunteer at a desk for one afternoon. Until
 * now they read every buyer in the raffle: name, telephone number, area and the
 * note about them, several thousand rows of it, most of them refugees. That is
 * the same mistake this project already made once with sellers — the row was
 * masked for viewers only — and it is being closed the same way.
 *
 * The rule: a helper sees every ticket's NUMBER and STATUS, because "is 03291
 * still going?" has to have an answer for anybody. They see the BUYER only on
 * sales they wrote down themselves. To reach a buyer they did not record they
 * ring the SELLER, whose name and number they can still see — which is how this
 * organisation actually escalates.
 *
 * THREE PATHS, and that is the point of this file. The same rule lives in
 * tickets_readable (direct reads, the default), mask() in the edge function
 * (?directreads=off, and every non-direct action), and maskWireRow_ in Apps
 * Script. A narrowing applied to one of the three is not a narrowing — it is a
 * switch a volunteer can flip to see everything, wearing the label of a
 * performance setting.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = await loadModule('index.ts')
const WIRE = [
  'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
  'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
  'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date',
]

/*
 * Driven through the router, not by calling mask() directly.
 *
 * mask() is module-private and that is correct — what matters is not that a
 * function blanks a field but that the rows leaving read_snapshot have it
 * blanked. Every privacy bug in this project has been a masker that was right
 * and a path that did not call it.
 */
import { fakeDb, baseConfig } from './fakedb.mjs'

const F = WIRE
const col = (row, name) => row[F.indexOf(name)]

function world() {
  const tickets = Array.from({ length: 20 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: Math.ceil((i + 1) / 10), status: 'Sold',
    buyer_name: 'Buyer ' + (i + 1), buyer_phone: '01255500' + String(i + 1).padStart(2, '0'),
    buyer_zone: 'Klang', notes: 'note ' + (i + 1), amount: 10,
    // Odd tickets were written down by rec@x.com, even ones by somebody else.
    recorded_by: (i % 2 === 0) ? 'rec@x.com' : 'other@x.com',
    sold_by_agent: 'A001', payment_status: 'Paid', sold_at: new Date().toISOString(),
    source: 'app', version: 1, modified_at: new Date().toISOString(),
  }))
  const books = [1, 2].map((n) => ({
    idx: n, number: 'Book-' + String(n).padStart(3, '0'),
    first_ticket: 'KS-00001', last_ticket: 'KS-00010',
    status: 'Out', held_by_agent: 'A001', declared_sold: null, amount_due: null,
    amount_paid: null, due_at: null, settled_at: null, settled_by: '', notes: '', version: 1,
  }))
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
    tickets, books,
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true }],
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agent_id: null },
    ],
  })
}

async function snapshot(email) {
  const w = world()
  const res = await api.default.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_snapshot', payload: { offset: 0, limit: 100 } }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email } })
  const body = await res.json()
  if (!body.ok) throw new Error(body.error?.code + ': ' + body.error?.message)
  return body.data
}

console.log('a helper reading the whole table sees only the buyers they wrote down')
{
  const snap = await snapshot('rec@x.com')
  eq(snap.rows.length, 20, 'every ticket is still listed — no holes in the grid')

  const mine = snap.rows.find((r) => col(r, 'Ticket_Number') === 'KS-00001')
  eq(col(mine, 'Buyer_Name'), 'Buyer 1', 'their own entry keeps the buyer')
  eq(col(mine, 'Buyer_Phone'), '0125550001', 'and the telephone number')

  const theirs = snap.rows.find((r) => col(r, 'Ticket_Number') === 'KS-00002')
  eq(col(theirs, 'Status'), 'Sold', 'somebody else\'s entry still shows its status')
  eq(col(theirs, 'Ticket_Number'), 'KS-00002', 'and its number')
  eq(col(theirs, 'Sold_By_Agent'), 'A001', 'and who sold it — the route to the buyer')
  eq(col(theirs, 'Buyer_Name'), '', 'but not the buyer')
  eq(col(theirs, 'Buyer_Phone'), '', 'nor their telephone number')
  eq(col(theirs, 'Buyer_Zone'), '', 'nor where they live')
  eq(col(theirs, 'Notes'), '', 'nor the note about them')

  // The whole point, stated as a count.
  const leaked = snap.rows.filter((r) =>
    col(r, 'Recorded_By') !== 'rec@x.com' && col(r, 'Buyer_Phone') !== '')
  eq(leaked.length, 0, 'not one telephone number they did not write down')
  eq(snap.rows.filter((r) => col(r, 'Buyer_Phone') !== '').length, 10,
     'and the ten that are theirs are all readable')
}

console.log('an organiser still sees the whole raffle')
{
  const snap = await snapshot('boss@x.com')
  eq(snap.rows.filter((r) => col(r, 'Buyer_Phone') !== '').length, 20,
     'every buyer is reachable — somebody has to be able to run the draw')
}

/*
 * The three implementations, checked as source.
 *
 * Running all three needs Postgres, Deno and Apps Script in one process. What
 * can be checked cheaply and every time is that none of them has been left
 * behind — which is the failure that actually happens. A rule enforced in two
 * places out of three is the one that looks fixed.
 */
console.log('all three read paths carry the rule')
{
  const rls = readFileSync(new URL('../supabase/rls.sql', import.meta.url), 'utf8')
  /*
   * THE WHOLE api/ DIRECTORY, not a named file. This read index.ts, because that
   * is where mask() lived — and when mask() moved to gate.ts so reports.ts could
   * share it, the assertion went looking in the wrong place and failed. It was
   * right to fail: it had pinned a LOCATION when the claim is about a RULE.
   * Concatenating the handlers asks the question the test is actually about, and
   * survives the next move.
   */
  const apiDir = new URL('../supabase/functions/api/', import.meta.url)
  const edge = readdirSync(apiDir).filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(new URL(f, apiDir), 'utf8')).join('\n')
  const gs = readFileSync(new URL('../apps_script/Tickets.gs', import.meta.url), 'utf8')

  ok(/when 'recorder' then\s+t\.recorded_by = auth_email\(\)/.test(rls),
     'tickets_readable narrows a recorder to their own entries')
  ok(/user\.role === 'recorder'[\s\S]{0,120}recorded_by/.test(edge),
     "the edge function's mask() narrows a recorder")
  ok(/ROLES\.RECORDER[\s\S]{0,200}WIRE_RECORDED_BY/.test(gs),
     'maskWireRow_ narrows a recorder')

  // Each path must blank the same four columns. A rule that hides the phone in
  // one place and the phone plus the note in another is two rules.
  for (const [name, src, fields] of [
    ['the view', rls, ['buyer_name', 'buyer_phone', 'buyer_zone', 'notes']],
    ['the edge function', edge, ['buyer_name', 'buyer_phone', 'buyer_zone', 'notes']],
    ['Apps Script', gs, ['WIRE_NAME', 'WIRE_PHONE', 'WIRE_ZONE', 'WIRE_NOTES']],
  ]) {
    for (const f of fields) ok(src.includes(f), `${name} handles ${f}`)
  }

  // Status and number must NOT be gated anywhere — a helper who cannot answer
  // "is this one still going?" cannot work the desk at all.
  ok(!/when 'recorder' then[\s\S]{0,400}case when mine then status/.test(rls),
     'status is never gated on mine')
}

console.log('the seller stays reachable, which is what makes the narrowing workable')
{
  const rls = readFileSync(new URL('../supabase/rls.sql', import.meta.url), 'utf8')
  // agents_readable blanks the phone for 'viewer' only. If that ever widens to
  // recorder, a helper loses both the buyer AND the route to them, and the
  // narrowing becomes an obstruction rather than a boundary.
  // From the VIEW, not the first mention of the name — my own comment above
  // contains the word, and slicing from indexOf found that instead.
  const agents = rls.slice(rls.indexOf('create view agents_readable'))
  const phoneRule = agents.slice(0, agents.indexOf('from agents'))
  ok(/app_role\(\) = 'viewer'/.test(phoneRule),
     'agents_readable hides a seller phone from viewers')
  ok(!/recorder/.test(phoneRule),
     'and NOT from a helper — otherwise the narrowing removes the route to the buyer too')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
