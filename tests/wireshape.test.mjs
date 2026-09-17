/*
 * Does the wire between the server and the client still hold its shape?
 *
 * WHAT THIS WAS. portparity.test.mjs, which compared the two backends' action
 * registries and their ticket-row declarations against each other. The
 * comparison went with the Apps Script backend; what it was protecting did not.
 *
 * WHY IT IS STILL A FILE. The failure it exists for was never really about two
 * backends. `read_snapshot` sends the field NAMES once and then a bare array
 * per ticket, so the client indexes into each row POSITIONALLY. Nothing on
 * either side of that carries a name. Reorder the declaration and every buyer's
 * telephone number arrives in the amount column — no error, no warning, just a
 * table of plausible nonsense, on a raffle where the amount column is money
 * somebody owes.
 *
 * The other half is the same shape one layer up: 681 parity assertions and 33
 * RLS assertions were once green while the Supabase backend could not load a
 * single ticket, because the gate tests check the gate, the RLS tests ask the
 * database, and neither of them drives the client. So this file also checks
 * that a snapshot page carries what the client pages with, that `list_books`
 * returns what the books screen reads off it, and that no handler reads through
 * an RLS-filtered view with a key that bypasses RLS.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// ---------- the two registries, read from the source of truth ----------

const ts = read('../supabase/functions/api/index.ts')

const tsStart = ts.indexOf('const REGISTRY')
const tsBody = ts.slice(tsStart, ts.indexOf('\n}', tsStart))
const supabase = new Set(
  [...tsBody.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map(m => m[1]))

console.log('the registry was found')
ok(supabase.size > 25, `the registry parsed (${supabase.size} actions)`)


// ---------- the ticket wire ----------

console.log('the ticket wire is the shape the client indexes into')
{
  const fieldsOf = (src, name) => {
    const m = src.match(new RegExp(name + String.raw`\s*=\s*\[([\s\S]*?)\]`))
    return m ? [...m[1].matchAll(/'([A-Za-z_]+)'/g)].map(x => x[1]) : []
  }

  const tsFields = fieldsOf(ts, 'WIRE_FIELDS')

  /*
   * ORDER, NOT JUST MEMBERSHIP, and it is still the point after the second
   * backend has gone.
   *
   * This compared the two declarations against each other, because agreeing on
   * the names while disagreeing on the order would have put every buyer's phone
   * number in the amount column. The client still indexes rows POSITIONALLY
   * against this array — `fields` is sent once and each row is a bare array —
   * so the order is load-bearing on its own, with nothing to disagree with.
   *
   * Written down here rather than derived, because a list compared against
   * itself asserts nothing. This is the wire, and changing it means changing
   * both ends in the same commit.
   */
  const WIRE = [
    'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
    'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
    'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date',
  ]
  ok(tsFields.length === 15, `the backend declares 15 wire fields (got ${tsFields.length})`)
  ok(JSON.stringify(tsFields) === JSON.stringify(WIRE),
    `the wire changed order:\n    declared: ${tsFields.join(',')}\n    expected: ${WIRE.join(',')}`)

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
                 'approvals.ts', 'deadlines.ts', 'money.ts']

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

console.log('the server calls the person at the top by the CURRENT word')
{
  /*
   * HOLDS THE CURRENT WORD, not the absence of the old one.
   *
   * This is the third name in a day — super admin, then owner, now system
   * admin — and each was the user's call. A test that merely forbade "super
   * admin" would pass happily while a message said "owner", because both read
   * as correct to somebody who was not here for the reversals. The one that
   * creeps back is always the middle one.
   *
   * Comments are stripped before looking. "the super admin is an environment
   * variable" is a note to us about where authority lives, and rewording it
   * every time the volunteers' word changes would lose the history for nothing.
   */
  const files = ['index.ts', 'gate.ts', 'people.ts', 'books.ts', 'tickets.ts',
                 'reports.ts', 'approvals.ts', 'deadlines.ts', 'money.ts']
  const STALE = ['super admin', 'superadmin', 'the owner', 'owner account', 'owner role']

  let checked = 0
  for (const f of files) {
    let src
    try { src = read('../supabase/functions/api/' + f) } catch { continue }
    checked++

    // Strings only: drop block comments and line comments first.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const strings = [...code.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`]*)`/g)]
      .map((m) => m[1] ?? m[2] ?? '')

    for (const s of strings) {
      const low = s.toLowerCase()
      // Only sentences a person reads — an identifier or a column name is not.
      if (!/[a-z] [a-z]/.test(low)) continue
      for (const stale of STALE) {
        ok(!low.includes(stale),
          `${f} says "${stale}" to a person: "${s.slice(0, 64)}"`)
      }
    }
  }
  ok(checked >= 7, `checked ${checked} handler files`)

  // And the current word is actually in use, so this cannot pass by saying
  // nothing at all.
  const all = files.map((f) => { try { return read('../supabase/functions/api/' + f) } catch { return '' } }).join('\n')
  ok(/system admin/i.test(all), 'the current word appears in the messages')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
