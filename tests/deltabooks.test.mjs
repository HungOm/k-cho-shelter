/*
 * THE PAGE WAS WOKEN UP AND THEN ASKED THE WRONG QUESTION.
 *
 * 20260916001500 puts a statement trigger on `books`, so counting a book in has
 * always nudged every open page. The page then called read_delta — which read
 * TICKETS and nothing else — applied the ticket rows, and left state.books
 * exactly as it was at sign-in. The grid stayed at whatever it said when the
 * page loaded, for as long as the page stayed open.
 *
 * Reported from an admin screen: a book already given out, sold or handed back
 * still reading as free, and the only way to find out was to reload.
 *
 * NOBODY LOST MONEY TO IT, which is worth stating because it decides how
 * alarming this is. sell_books refuses with BOOK_CLOSED or BOOK_WITH_SELLER,
 * and issue_books_tx carries a per-book status predicate with a rowcount check.
 * The cost is a volunteer who reads a book as free, commits to giving it out in
 * front of somebody, and is refused for a reason the screen never showed.
 *
 * BOTH HALVES OR NEITHER. A server that sends books to a client that ignores
 * them is the same bug with more code, so the handler is tested against a real
 * fixture and the client against its own loop.
 */
import { readFileSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

const OLD = '2026-09-01T00:00:00.000Z'
const NOW = '2026-09-16T10:00:00.000Z'

/*
 * Two books. Book-001 is out with A001 and its ROW moved; Book-002 is quiet but
 * one of its TICKETS moved. They are the two different reasons a tile changes
 * and only one of them touches the book row.
 */
const W = fakeDb({
  config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
  agents: [{ agent_id: 'A001', name: 'Josh', active: true },
           { agent_id: 'A002', name: 'Mary', active: true }],
  app_users: [
    { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
    { email: 'josh@x.com', name: 'Josh', role: 'agent', active: true, agent_id: 'A001' },
  ],
  books: [
    { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001',
      first_ticket: 'KS-00001', last_ticket: 'KS-00010', modified_at: NOW },
    { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002',
      first_ticket: 'KS-00011', last_ticket: 'KS-00020', modified_at: OLD },
  ],
  /*
   * SEEDED, not derived. In production book_ledger_all is a view over books and
   * tickets; the fake keeps it as a table that fixtures fill, which is the
   * convention every other books test here follows. So `books` above is what
   * the delta's CURSOR reads and this is what it SENDS, and a fixture that
   * seeded only one of them would test half the path.
   */
  book_ledger_all: [
    { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001',
      agent_name: 'Josh', first_ticket: 'KS-00001', last_ticket: 'KS-00010',
      counted_sold: 0, available: 10, counted_expected: 0, counted_collected: 0,
      variance_amount: 0, missing_contact: 0, declared_sold: null },
    { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002',
      agent_name: 'Mary', first_ticket: 'KS-00011', last_ticket: 'KS-00020',
      counted_sold: 1, available: 9, counted_expected: 10, counted_collected: 0,
      variance_amount: 0, missing_contact: 0, declared_sold: null },
  ],
  tickets: Array.from({ length: 20 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: i < 10 ? 1 : 2, status: 'Available', version: 1,
    // One ticket in the QUIET book moved. Nothing else did.
    modified_at: i === 14 ? NOW : OLD,
  })),
})

const call = async (since, email = 'boss@x.com') => {
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_delta', payload: { since } }),
    }),
    { ...W.ctx, userClaims: { id: 'u1', email } })
  return (await res.json()).data
}

console.log('1. a book whose own row moved arrives')
{
  const d = await call(OLD)
  ok(Array.isArray(d.books), 'the delta carries a books array at all')
  ok(d.books.some((b) => b.book === 'Book-001'), 'Book-001, whose status changed, is in it')
  eq(d.booksComplete, true, 'and the server says it sent all of them')
}

console.log('2. and a book whose TICKETS moved, though its own row did not')
{
  /*
   * THE HALF THAT books.modified_at ALONE WOULD MISS. counted_sold, available
   * and counted_expected are derived in book_ledger_all FROM THE TICKETS, so
   * selling out of a book changes what its tile shows while the book row sits
   * untouched. Asking books.modified_at alone would leave a book reading "3
   * left" after its last ticket sold, until somebody reloaded.
   *
   * It needs no second query: the changed tickets are already in hand and the
   * books they belong to are their book_idx.
   */
  const d = await call(OLD)
  eq(W.db.tables.books[1].modified_at, OLD, 'Book-002 row really is untouched (fixture check)')
  ok(d.books.some((b) => b.book === 'Book-002'),
     'Book-002 arrives because one of its tickets changed')
}

console.log('3. nothing changed means no books, and that is said rather than implied')
{
  const d = await call('2026-12-31T00:00:00.000Z')
  eq((d.books ?? []).length, 0, 'no books travel')
  eq(d.booksComplete, true,
     'and booksComplete is TRUE — an empty array is also what "too many to send" would look like')
}

console.log('4. a seller is sent their own books and not the raffle')
{
  /*
   * The bigger leak than the bug. list_books scopes a seller to the books in
   * their hands plus the ones offered to them; a delta that skipped that would
   * stream every book in the raffle to every seller, with the holder and the
   * money on each one.
   */
  const d = await call(OLD, 'josh@x.com')
  // POSITIVE FIRST. `every` over an empty array is true, so a delta that sent a
  // seller NOTHING would have passed both of the checks below — which is the
  // assertion-that-cannot-fail shape, and it would have hidden the opposite
  // bug: a seller whose grid never updates at all.
  ok(d.books.some((b) => b.book === 'Book-001'), 'Josh is sent his own changed book')
  ok(d.books.every((b) => b.book !== 'Book-002'), "and Mary's book does not travel to him")
  ok(d.books.every((b) => b.agentId === 'A001'), 'every book he is sent is his')
}

console.log('5. the shape is defined once, not twice that agree today')
{
  /*
   * list_books and read_delta send books to the same grid. Two mappings is the
   * arrangement this repository has paid for four times: the copies agree on
   * the day they are written and drift on the day one changes, and the symptom
   * is a grid that renders half-right. BookGrid calls bookShort(b.book) and the
   * view's column is `number`, so a delta that forgot that one line would send
   * tiles reading "0".
   */
  const src = readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')
  eq((src.match(/function bookWire\(/g) || []).length, 1, 'bookWire is defined once')
  eq((src.match(/function scopeBooks[<(]/g) || []).length, 1, 'scopeBooks is defined once')
  ok((src.match(/bookWire\(/g) || []).length >= 3, 'and both handlers go through it')
  ok(/book: r\.number/.test(src), 'the mapping still renames number to book')
  // The delta must read the VIEW, not the table: counted_sold, days_overdue and
  // agent_name are the view's and not the book row's.
  ok(/from\('book_ledger_all'\)[\s\S]{0,120}\.in\('idx'/.test(src.replace(/\n/g, ' ')),
     'the delta reads book_ledger_all by idx, so a streamed tile matches a snapshot one')
}

console.log('6. the client applies them, and asks again when told to')
{
  const src = readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8')
  const at = src.indexOf('export async function loadDelta')
  const fn = src.slice(at, src.indexOf('\n}\n', at))

  ok(/for \(const b of d\.books \?\? \[\]\)/.test(fn), 'it reads the books the delta sent')
  ok(/state\.books\.findIndex/.test(fn) && /Object\.assign\(state\.books\[at\], b\)/.test(fn),
     'merging in place, because bookHolders and whereIs are computed over that array')
  ok(/state\.books\.push\(b\)/.test(fn), 'and a book it has never seen is added rather than dropped')
  ok(/if \(d\.booksComplete === false\)/.test(fn),
     'too many to stream means ask for the whole list')
  ok(/api\('list_books'/.test(fn), 'which it does')
  // === false, not falsy: an older backend sends no such field, and treating
  // undefined as "incomplete" would refetch the entire list on every poll.
  ok(!/if \(!d\.booksComplete\)/.test(fn),
     'tested against false exactly, so an older backend that omits it is not refetched every poll')
}

console.log('7. the number above the grid describes the grid')
{
  const src = readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8')
  const at = src.indexOf('export function reindex')
  const fn = src.slice(at, src.indexOf('\n}\n', at))

  ok(/state\.bookStats = counts/.test(fn), 'the counts are derived from the list that is shown')
  /*
   * ONLY WHEN THAT LIST IS THE WHOLE RAFFLE, and the margin here is nil rather
   * than comfortable: book_ledger_all is scoped to ACTIVE books, so at
   * ACTIVE_TICKETS = 10000 and ten to a book it returns exactly 1000 rows —
   * precisely list_books' cap. Right today and silently short the first time
   * somebody releases more tickets. A count derived from a truncated list would
   * describe part of the raffle while looking like all of it.
   */
  ok(/if \(state\.booksAllLoaded\)/.test(fn),
     'and only when the client holds all of them')
  ok(/complete: books\.length < BOOKS_LIMIT/.test(
       readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8')),
     'which the server states rather than leaving the client to infer from a cap it would have to know')

  const store = readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8')
  ok(/if \(!state\.booksAllLoaded\) state\.bookStats = draw\.booksByStatus/.test(store),
     'and report_draw_ready no longer overwrites a count derived from the list beneath it')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
