/*
 * Can this raffle be installed from nothing?
 *
 * WHY THIS EXISTS. It could not. Every config row in production arrived through
 * the one-off migration out of the Google Sheet, and the 26 defaults behind them
 * were seeded by `seedConfig_()` in the Apps Script Setup.gs. A Supabase project
 * built from schema.sql alone had an EMPTY config table — and the code that
 * generates tickets reads its prefix, its padding and its book size out of that
 * table, treating absent as "no prefix, no padding, ten per book".
 *
 * So a fresh install would have produced a raffle whose tickets were numbered
 * `1` to `10000`, with nothing reporting an error, and the only working setup
 * path in the repository ran through a spreadsheet the project is trying to
 * delete. That is not a setup path; it is an accident of history that happened
 * to be true once.
 *
 * WHAT THIS TEST IS CAREFUL ABOUT. It reads the defaults out of `schema.sql`
 * itself rather than from a fixture typed here. A fixture would prove that
 * SOME config can number a ticket, which was never in doubt. The claim is that
 * the config a new project actually gets is enough — so the file that gives it
 * to them is the only honest source.
 *
 * It deliberately does NOT re-test expand_tickets' own rules (ceilings, shrink
 * refusals, dry runs). ceiling/expand/active cover those. This asks one
 * question: start with nothing but the schema, and do you end up with a raffle
 * whose tickets are numbered the way the settings say?
 */
import { readFileSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = new URL('..', import.meta.url).pathname
const schema = readFileSync(ROOT + 'supabase/schema.sql', 'utf8')

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

// ---------- the defaults a new project is actually given ----------

console.log('1. the schema seeds a config a new project can work from')
const seed = (() => {
  const at = schema.indexOf('insert into config (key, value, notes) values')
  if (at === -1) return null
  const end = schema.indexOf('on conflict (key) do nothing;', at)
  if (end === -1) return null
  const body = schema.slice(at, end)
  const out = {}
  // ('KEY', 'value', 'notes…') — the value is the second quoted field, and it
  // may be empty, which is meaningful for half of these keys.
  for (const m of body.matchAll(/\n\s*\('([A-Z_]+)',\s*'((?:[^']|'')*)'/g)) {
    out[m[1]] = m[2].replace(/''/g, "'")
  }
  return out
})()

ok(!!seed, 'the config seed block was found in schema.sql')
/*
 * THE COUNT IS A TRIPWIRE, not the point. It fails when the seed block loses a
 * key and when the regex above stops matching — the second being the reason it
 * is exact rather than a lower bound, since a broken parse returns zero and a
 * `>=` would let that through as "no keys lost".
 *
 * 32: the 29 that were here plus ORG_PHONE, ORG_EMAIL and ORG_WEBSITE, added
 * when the public check page needed somewhere for "call the office" to point.
 */
ok(Object.keys(seed ?? {}).length === 32, `32 keys are seeded (found ${Object.keys(seed ?? {}).length})`)

/*
 * AND THE KEYS THE SERVER ACTUALLY READS ARE ALL THERE — which a count cannot
 * say. A key renamed on one side of the wall keeps the count identical and
 * gives every install a silently empty setting; this compares the two lists
 * rather than their lengths.
 */
{
  const payload = readFileSync(ROOT + 'supabase/functions/api/config.ts', 'utf8')
  const read = [...payload.matchAll(/cfg\.([A-Z_]+)/g)].map((m) => m[1])
  ok(read.length > 15, `configPayload reads ${read.length} keys out of config`)
  for (const k of new Set(read)) {
    ok(k in (seed ?? {}), `${k} is read by configPayload and seeded by schema.sql`)
  }
}

/*
 * The three the ticket artwork added. Blank is the right starting value for all
 * of them and each blank means something specific: no artwork has been uploaded
 * yet, use the built-in list of paper sizes, and point printed QR codes at this
 * site. A raffle is printable the moment somebody uploads a ticket, with
 * nothing else to set.
 */
for (const k of ['TICKET_ARTWORK_ID', 'TICKET_SIZES', 'VERIFY_URL']) {
  ok(k in seed, `${k} is seeded — the ticket artwork reads it and treats absent as a guess`)
  ok(seed[k] === '', `${k} starts blank`)
}

/*
 * The five the generator cannot do without. Absent, each one has a silent
 * default that produces a raffle nobody asked for rather than an error.
 */
for (const k of ['TICKET_PREFIX', 'TICKET_START', 'TICKET_DIGITS',
                 'TICKETS_PER_BOOK', 'BOOK_PREFIX', 'BOOK_DIGITS']) {
  ok(k in seed, `${k} is seeded — the generator reads it and treats absent as a guess`)
}
// Blank is a real value here and must not be confused with missing.
ok(seed.TICKET_PREFIX !== '' && seed.TICKET_DIGITS !== '',
   'and the two that decide what a ticket is CALLED are not blank')
ok(seed.TOTAL_TICKETS === '0',
   'while TOTAL_TICKETS starts at nothing — a new project has no tickets until somebody makes them')

// ---------- build the raffle from exactly those defaults ----------

/** A database with the schema applied and nothing else done to it. */
function freshProject() {
  return fakeDb({
    config: Object.entries(seed).map(([key, value]) => ({ key, value })),
    tickets: [], books: [], agents: [],
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null }],
    book_ledger_all: [],
  })
}

async function call(action, payload, w, email = 'boss@x.com') {
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email } })
  return await res.json()
}

console.log('2. a preview first, because every wide operation here previews')
{
  const w = freshProject()
  const r = await call('expand_tickets', { totalTickets: 50 }, w)
  ok(r.ok, `the preview answers (${r.error?.code ?? 'ok'}: ${r.error?.message ?? ''})`)
  ok(r.data?.dryRun === true, 'and says it is a preview')
  ok(w.table('tickets').length === 0, 'having written nothing at all')
}

console.log('3. and then it builds the raffle')
{
  const w = freshProject()
  const r = await call('expand_tickets', { totalTickets: 50, dryRun: false }, w)
  ok(r.ok, `it runs (${r.error?.code ?? 'ok'}: ${r.error?.message ?? ''})`)

  const tickets = w.table('tickets')
  const books = w.table('books')
  ok(tickets.length === 50, `50 tickets exist (got ${tickets.length})`)
  ok(books.length === 5, `and 5 books of ten (got ${books.length})`)

  /*
   * THE ASSERTION THIS FILE IS FOR. Without the seed these come out as "1" and
   * "50" — no prefix, no padding — and nothing anywhere reports a problem.
   */
  const first = tickets.find(t => t.idx === 1)
  const last = tickets.find(t => t.idx === 50)
  ok(first?.number === 'KS-00001', `the first ticket is KS-00001 (got ${first?.number})`)
  ok(last?.number === 'KS-00050', `the last is KS-00050 (got ${last?.number})`)
  ok(books.find(b => b.idx === 1)?.number === 'Book-0001',
     `the first book is Book-0001 (got ${books.find(b => b.idx === 1)?.number})`)

  // Padding is a width, not a coincidence of this size: every number is the
  // same length, which is what makes a printed book legible.
  const widths = new Set(tickets.map(t => String(t.number).length))
  ok(widths.size === 1, `every ticket number is the same width (${[...widths].join(', ')})`)

  // A book has to say which tickets are in it, or nobody can hand one over.
  const b1 = books.find(b => b.idx === 1)
  ok(b1?.first_ticket === 'KS-00001' && b1?.last_ticket === 'KS-00010',
     `and book one spans KS-00001..KS-00010 (got ${b1?.first_ticket}..${b1?.last_ticket})`)

  ok(w.config('TOTAL_TICKETS') === '50', 'the raffle now says how big it is')
}

console.log('4. and the app can read what was built')
{
  // The point of a setup path is a raffle somebody can open, not rows in a
  // table. read_snapshot is what the client boots on.
  const w = freshProject()
  await call('expand_tickets', { totalTickets: 50, dryRun: false }, w)
  const r = await call('read_snapshot', { offset: 0, limit: 100 }, w)
  ok(r.ok, `read_snapshot answers (${r.error?.code ?? 'ok'})`)
  ok((r.data?.rows?.length ?? 0) > 0, `and hands back tickets (${r.data?.rows?.length ?? 0})`)

  const who = await call('whoami', {}, w)
  ok(who.ok && who.data?.config?.ticketPrefix === 'KS-',
     'and the config the app boots on carries the prefix it was set up with')
  ok(who.data?.config?.currency === 'RM', 'and a currency, so money has a name on every screen')
  ok(who.data?.config?.eventName === 'Fundraising Raffle',
     'and a name, so a receipt says what it is a receipt for')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
