/*
 * GIVING TICKETS THE CODES THAT MAKE THEM PROVABLE.
 *
 * Two failures this guards against, and they are opposite.
 *
 * THE FIRST IS RE-MINTING. A ticket is printed, sold, and carried around in
 * somebody's wallet. Months later an organiser reprints that book — because one
 * was damaged, or because the first run was lost in the post. If generating ran
 * again and rolled a new code, every ticket already in circulation from that
 * book would stop verifying, and nobody would find out until the draw. So
 * generating is once-only and says so: running it twice generates nothing.
 *
 * THE SECOND IS A GAP. A run that generates for eight of the ten tickets
 * somebody asked for leaves two tickets that cannot be printed, in the middle
 * of a book, and reports success. So a scope containing anything unknown is
 * refused whole rather than trimmed.
 *
 * AND ONE THING THAT IS NOT ABOUT CORRECTNESS AT ALL: this must not touch the
 * `tickets` table. Every update there fires bump_version() and
 * record_ticket_history(), so minting twenty thousand codes on the ticket row
 * would raise twenty thousand versions and hand every connected phone twenty
 * thousand changed tickets to re-download. Asserted below, because "it works"
 * and "it works without melting every volunteer's phone" look identical from
 * the outside.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const printing = await loadModule('printing.ts')

/* Three books of ten, the shape this raffle actually uses. */
function world(cfg = {}) {
  const tickets = []
  const books = []
  for (let b = 1; b <= 3; b++) {
    books.push({ idx: b, number: `Book-${String(b).padStart(4, '0')}`, status: 'Unassigned' })
    for (let t = 1; t <= 10; t++) {
      const idx = (b - 1) * 10 + t
      tickets.push({
        idx, number: `KS-${String(idx).padStart(5, '0')}`,
        book_idx: b, status: 'Available', version: 1,
      })
    }
  }
  return fakeDb({
    config: baseConfig({ TICKET_ARTWORK_ID: 'tpl-1', TOTAL_TICKETS: '30', ...cfg }),
    tickets, books, ticket_codes: [], audit_log: [],
  })
}
const gen = (w, p) => printing.generateTickets(p, users.admin, w.ctx)

console.log('without artwork there is nothing to print onto')
{
  const w = world({ TICKET_ARTWORK_ID: '' })
  const err = await errOf(() => gen(w, { book: 'Book-0001' }))
  eq(err.code, 'NO_TEMPLATE', 'generating is refused')
  ok(/Ticket design/.test(err.message), 'and the refusal says where to fix it')
  eq(w.table('ticket_codes').length, 0, 'and nothing was minted')
}

console.log('a book gets ten codes, once')
{
  const w = world()
  const r = await gen(w, { book: 'Book-0001' })
  eq(r.generated, 10, 'ten tickets, ten codes')
  eq(r.alreadyGenerated, 0, 'none of them had one before')
  eq(w.table('ticket_codes').length, 10, 'and ten rows were written')
  ok(!!r.batchId, 'the run has an id')
  eq(new Set(w.table('ticket_codes').map((c) => c.batch_id)).size, 1, 'and every row carries it')
  eq(r.first, 'KS-00001', 'it reports where it started')
  eq(r.last, 'KS-00010', 'and where it stopped')

  /*
   * The important one. A reprint must produce the SAME code, or every ticket
   * already in somebody's wallet stops verifying.
   */
  const before = w.table('ticket_codes').map((c) => c.code).sort()
  const again = await gen(w, { book: 'Book-0001' })
  eq(again.generated, 0, 'running it again generates nothing')
  eq(again.alreadyGenerated, 10, 'and says all ten already had one')
  eq(again.batchId, null, 'there is no new batch, because nothing was minted')
  eq(w.table('ticket_codes').map((c) => c.code).sort().join(), before.join(),
    'and every code is the one it already was')
}

console.log('every code is different, and belongs to one ticket')
{
  const w = world()
  await gen(w, { all: true })
  const rows = w.table('ticket_codes')
  eq(rows.length, 30, 'the whole raffle')
  eq(new Set(rows.map((c) => c.code)).size, 30, 'thirty different codes')
  eq(new Set(rows.map((c) => c.ticket_idx)).size, 30, 'one per ticket')
  ok(rows.every((c) => /^[0-9A-HJKMNP-TV-Z]{8,32}$/.test(c.code)), 'all in the readable alphabet')
  ok(rows.every((c) => c.template_id === 'tpl-1'), 'each records which artwork it was made for')
  ok(rows.every((c) => c.generated_by === users.admin.email), 'and who made it')
  ok(rows.every((c) => !c.printed_at), 'and none is marked printed — generated is not printed')
}

console.log('the tickets themselves are not touched')
{
  /*
   * If this fails, generating a raffle looks to every connected phone like the
   * whole raffle changing at once: twenty thousand version bumps, twenty
   * thousand history rows, and a delta that re-downloads everything.
   */
  const w = world()
  await gen(w, { all: true })
  ok(w.table('tickets').every((t) => t.version === 1), 'no ticket version was raised')
  eq(w.table('ticket_history').length, 0, 'no ticket history was written')
  eq(w.db.writes.filter((x) => x.table === 'tickets').length, 0, 'the tickets table was not written to at all')
}

console.log('the scope is what the caller asked for, exactly')
{
  {
    const w = world()
    const r = await gen(w, { fromBook: 'Book-0001', toBook: 'Book-0002' })
    eq(r.generated, 20, 'a range of books is both of them')
  }
  {
    const w = world()
    const r = await gen(w, { numbers: ['KS-00003', 'KS-00025'] })
    eq(r.generated, 2, 'named tickets are just those')
    eq(w.table('ticket_codes').map((c) => c.ticket_idx).sort((a, b) => a - b).join(), '3,25',
      'and the right ones')
  }
  {
    const w = world()
    const r = await gen(w, { all: true })
    eq(r.generated, 30, 'all of them is all of them')
  }
}

console.log('a scope with anything unknown in it is refused whole')
{
  const w = world()
  const err = await errOf(() => gen(w, { numbers: ['KS-00003', 'KS-99999'] }))
  eq(err.code, 'TICKET_NOT_FOUND', 'an unknown number refuses the run')
  ok(/KS-99999/.test(err.message), 'and names the one that is wrong')
  /*
   * Nothing at all was written. Generating for the nine that were fine would
   * leave a gap in a printed book that reports as a success.
   */
  eq(w.table('ticket_codes').length, 0, 'and the good ones were not quietly generated')

  eq(await codeOf(() => gen(w, { book: 'Book-9999' })), 'BOOK_NOT_FOUND', 'an unknown book too')
  eq(await codeOf(() => gen(w, { fromBook: 'Book-0002', toBook: 'Book-0001' })), 'BAD_REQUEST',
    'and a range that runs backwards')
}

console.log('the caller has to say what it means')
{
  const w = world()
  eq(await codeOf(() => gen(w, {})), 'MISSING_FIELD', 'no scope at all is refused')
  eq(await codeOf(() => gen(w, { numbers: [] })), 'MISSING_FIELD', 'an empty list is refused')
  eq(await codeOf(() => gen(w, { book: 'Book-0001', fromBook: 'Book-0002' })), 'BAD_REQUEST',
    'a book and a range at once is refused rather than one of them being picked')
}

console.log('one call will not try to do a whole press run')
{
  const w = world()
  const many = Array.from({ length: printing.MAX_PER_CALL + 1 }, (_, i) => `KS-${String(i + 1).padStart(5, '0')}`)
  const err = await errOf(() => gen(w, { numbers: many }))
  eq(err.code, 'RANGE_TOO_LARGE', 'too many at once is refused')
  ok(new RegExp(String(printing.MAX_PER_CALL)).test(err.message), 'and the limit is named')
}

console.log('it is on the record')
{
  const w = world()
  await gen(w, { book: 'Book-0002' })
  const rows = w.table('audit_log')
  eq(rows.length, 1, 'one audit row')
  eq(rows[0].action, 'TICKETS_GENERATED', 'by name')
  eq(rows[0].details.generated, 10, 'saying how many')
  eq(rows[0].details.first, 'KS-00011', 'and which tickets')
  ok(!!rows[0].details.batch, 'and which batch, so the run can be found again whole')
  eq(rows[0].email, users.admin.email, 'and who did it')

  // A run that mints nothing does not pretend to be an event.
  await gen(w, { book: 'Book-0002' })
  eq(w.table('audit_log').length, 1, 'a second run that generated nothing writes no second row')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
