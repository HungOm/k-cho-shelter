/*
 * Do the two backends offer the same actions, and speak the same wire?
 *
 * WHY THIS EXISTS. gateparity.test.mjs compares the two GATES — given an action
 * and a role, do both permit the same thing — and it does that by feeding both
 * the Apps Script spec. So an action that exists in Apps Script and was never
 * ported to Supabase passes every one of its 697 assertions: the gate agrees
 * about an action the Supabase backend cannot perform at all.
 *
 * The same hole, one layer down, let the Supabase backend ship a snapshot the
 * client could not parse. 681 parity assertions and 33 RLS assertions were
 * green while `?backend=supabase` could not load a single ticket, because the
 * gate tests check the gate, the RLS tests ask the database, and neither of
 * them drives the client.
 *
 * So this file compares the two things those tests take for granted: the set of
 * actions each backend actually registers, and the shape of the ticket rows the
 * client is handed.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// ---------- the two registries, read from the source of truth ----------

const gs = read('../apps_script/Api.gs')
const ts = read('../supabase/functions/api/index.ts')

const gsBody = gs.slice(gs.indexOf('function actionRegistry()'), gs.indexOf('function actionMeta'))
const appsScript = new Set(
  [...gsBody.matchAll(/^\s{4}([a-z_]+):\s*\{\s*fn:/gm)].map(m => m[1]))

const tsStart = ts.indexOf('const REGISTRY')
const tsBody = ts.slice(tsStart, ts.indexOf('\n}', tsStart))
const supabase = new Set(
  [...tsBody.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]))

console.log('both registries were found')
ok(appsScript.size > 25, `Apps Script registry parsed (${appsScript.size} actions)`)
ok(supabase.size > 25, `Supabase registry parsed (${supabase.size} actions)`)

/*
 * Actions deliberately not ported, each with the reason.
 *
 * An explicit list rather than silence: "not ported yet" and "nobody noticed"
 * look identical from outside, and this is the file that has to tell them
 * apart. Anything here still fails the moment somebody calls it on Supabase —
 * the point is that the omission is a decision somebody wrote down.
 */
const NOT_PORTED = new Map([
  // Apps Script owns the spreadsheet that generates tickets; on Supabase the
  // rows already exist and the ceiling is a config row.
  // The edge function is auth:'user'. There is no unauthenticated path through
  // it, so a pre-flight before sign-in could only ever report a working backend
  // as broken. The Supabase client does not ping.
  ['ping', 'no unauthenticated path through an auth:user function'],
])

console.log('every Apps Script action is either ported or listed as not ported')
{
  const missing = [...appsScript].filter(a => !supabase.has(a) && !NOT_PORTED.has(a)).sort()
  ok(missing.length === 0,
    `actions on Apps Script with no Supabase handler and no reason given:\n    ${missing.join('\n    ')}`)

  // The other direction matters too: an action only Supabase has is one the
  // Apps Script backend silently cannot do, which is the same surprise
  // wearing the other hat.
  // Supabase-only by design, each with its reason.
  const SUPABASE_ONLY = new Map([
    // Apps Script has no search ACTION — the client downloads every ticket and
    // searches locally, which is the habit this migration exists to end.
    ['search', 'Apps Script searches client-side over a full download'],
  ])
  const extra = [...supabase].filter(a => !appsScript.has(a) && !SUPABASE_ONLY.has(a)).sort()
  ok(extra.length === 0,
    `actions on Supabase that Apps Script does not have:\n    ${extra.join('\n    ')}`)

  // A stale exemption is worse than none: it says a gap was considered when it
  // has actually been closed.
  const stale = [...NOT_PORTED.keys()].filter(a => supabase.has(a) || !appsScript.has(a))
  ok(stale.length === 0, `NOT_PORTED lists something that no longer applies: ${stale.join(', ')}`)
}

// ---------- the ticket wire ----------

console.log('both backends send ticket rows in the same shape')
{
  const fieldsOf = (src, name) => {
    const m = src.match(new RegExp(name + String.raw`\s*=\s*\[([\s\S]*?)\]`))
    return m ? [...m[1].matchAll(/'([A-Za-z_]+)'/g)].map(x => x[1]) : []
  }

  const gsFields = fieldsOf(read('../apps_script/Tickets.gs'), 'TICKET_WIRE_FIELDS')
  const tsFields = fieldsOf(ts, 'WIRE_FIELDS')

  ok(gsFields.length === 15, `Apps Script declares 15 wire fields (got ${gsFields.length})`)
  ok(tsFields.length === 15, `Supabase declares 15 wire fields (got ${tsFields.length})`)

  // ORDER, not just membership. The client indexes rows positionally against
  // this array, so two backends agreeing on the names while disagreeing on the
  // order would put every buyer's phone number in the amount column.
  ok(JSON.stringify(gsFields) === JSON.stringify(tsFields),
    `wire fields differ:\n    apps script: ${gsFields.join(',')}\n    supabase:    ${tsFields.join(',')}`)

  // And the client has to be able to read them.
  const store = read('../src/lib/store.js')
  const mapBody = store.slice(store.indexOf('const FIELD_MAP'), store.indexOf('function toTicket'))
  const mapped = new Set([...mapBody.matchAll(/([A-Z][A-Za-z_]+):\s*'/g)].map(m => m[1]))

  const unreadable = tsFields.filter(f => !mapped.has(f))
  ok(unreadable.length === 0,
    `fields the client's FIELD_MAP cannot read: ${unreadable.join(', ')}`)

  // The three the client cannot work without. Each was actually wrong on the
  // Supabase path: it sent number/status/book_idx as object keys.
  for (const f of ['Ticket_Number', 'Status', 'Book_Number']) {
    ok(tsFields.includes(f), `Supabase sends ${f}`)
  }
}

console.log('a snapshot page carries what the client pages with')
{
  const snap = ts.slice(ts.indexOf('async function readSnapshot'), ts.indexOf('async function readDelta'))
  for (const key of ['fields:', 'rows:', 'returned:', 'hasMore:', 'total:']) {
    ok(snap.includes(key), `read_snapshot returns ${key.replace(':', '')}`)
  }
  // The client sends {offset}. A server that reads only `cursor` pages the
  // first thousand rows forty times and calls it twenty thousand tickets.
  ok(/int\(p\.cursor,\s*int\(p\.offset/.test(snap),
    'read_snapshot honours offset as well as cursor')

  const delta = ts.slice(ts.indexOf('async function readDelta'), ts.indexOf('async function search'))
  ok(delta.includes('fields:') && delta.includes('WIRE_FIELDS'),
    'read_delta speaks the same dialect as a snapshot')
}

console.log('list_books returns what the client actually reads off it')
{
  const fn = ts.slice(ts.indexOf('async function listBooks'), ts.indexOf('async function readAudit'))
  // store.js does `state.bookStats = books.stats`. This returned no stats at
  // all, and the gap was invisible because report_draw_ready overwrote
  // bookStats moments later — so it only showed when that report failed, and
  // then the grid lost its counts for a reason nobody would connect to here.
  // Shorthand counts: `books,` is the same promise as `books: books`.
  const returns = (src, key) => new RegExp(`\\b${key}\\s*[,:]`).test(src)
  for (const key of ['stats', 'books', 'total', 'currency', 'generatedBooks', 'heldBackBooks']) {
    ok(returns(fn, key), `list_books returns ${key}`)
  }

  // The Apps Script side is the contract both have to meet.
  const gsFn = read('../apps_script/Books.gs')
  const gsRet = gsFn.slice(gsFn.indexOf('function handleListBooks'))
  for (const key of ['stats', 'currency', 'generatedBooks', 'heldBackBooks']) {
    ok(returns(gsRet, key), `and Apps Script returns ${key} too`)
  }
}

console.log('the edge function never reads an RLS-filtered view')
{
  /*
   * The filtered views carry their own WHERE clause on app_role(), because they
   * run with owner rights and a policy would not apply to them. That is right
   * for a browser reading directly, and fatal for the edge function: it reads as
   * the service role, carries no JWT, so app_role() is null and those views
   * return NOTHING to it.
   *
   * It happened. Every action built on book_ledger reported an empty raffle —
   * no books free to give out, no money expected or collected — and worst, the
   * restock guard that refuses a book with money still owed saw no rows and so
   * never refused anything. The function must read the base tables or the _all
   * twin, and do its own scoping, because being above the policies it is the
   * only thing that can.
   */
  const FILTERED = ['book_ledger', 'tickets_readable', 'agents_readable', 'config_readable']
  const files = ['index.ts', 'books.ts', 'tickets.ts', 'people.ts', 'reports.ts',
                 'approvals.ts', 'deadlines.ts']

  for (const f of files) {
    let src
    try { src = read('../supabase/functions/api/' + f) } catch { continue }
    for (const view of FILTERED) {
      // from('book_ledger_all') is the allowed twin, so match the closing quote.
      const bad = src.includes(`from('${view}')`)
      ok(!bad, `${f} does not read the filtered view ${view} (it would see nothing)`)
    }
  }

  // And the unfiltered twin must exist, or the advice above is unfollowable.
  const rls = read('../supabase/rls.sql')
  ok(rls.includes('create view book_ledger_all as'), 'book_ledger_all is defined')
  ok(/revoke all on book_ledger_all from anon, authenticated/.test(rls),
     'and is revoked from the browser roles, so the unfiltered one is server-only')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
