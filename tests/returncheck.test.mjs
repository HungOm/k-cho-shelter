/*
 * What a seller said came back, against what an organiser actually counted in.
 *
 * Two records of the same event that nobody ever put side by side. A seller
 * declares "five books are coming back" in their check-in; an organiser later
 * takes books off them and records the returns. Both are stored, both are
 * trusted, and nothing compared them — so a seller who declared five and handed
 * over three looked, on every screen, exactly like one who declared five and
 * handed over five. The gap is the whole reason for asking them to declare.
 *
 * VERIFIED MEANS AN ORGANISER TOUCHED IT, and that was already in the data:
 * returning a book writes a book_history row with the organiser's email in
 * by_user, and so does settling, which is a return counted on the spot. No new
 * column was needed. What was missing was the question.
 *
 * THE TESTS THAT MATTER ARE THE ONES ABOUT NOT ACCUSING ANYBODY. A seller who
 * has not reported yet is not short — they are silent, which is a different
 * thing and already counted elsewhere. A seller who brought back more than they
 * promised is not short either. And a book returned before the round opened
 * belongs to the round it was returned in, not to this one.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const books = await loadModule('books.ts')

const seller = { ...users.agent, agentId: 'A001', email: 'hla@x.com' }
const other = { ...users.agent, agentId: 'A002', email: 'kyaw@x.com' }

const book = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-00001', last_ticket: 'KS-00010',
  status: 'Out', held_by_agent: 'A001', ...over,
})
const ret = (idx, agent, at, by = 'admin@x.com', action = 'return') =>
  ({ book_idx: idx, from_agent: agent, action, by_user: by, at, note: '' })

/**
 * Round 3 is live; round 2 was due 2026-08-01, which is this round's edge.
 * A001 said four books are coming back. A002 has said nothing.
 */
function world(over = {}) {
  return fakeDb({
    config: baseConfig({ CHECK_IN_ROUND: String(over.round ?? 3) }),
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
    ],
    books: over.books ?? [
      book(1, { status: 'Returned' }), book(2, { status: 'Returned' }),
      book(3), book(4), book(5),
      book(9, { held_by_agent: 'A002' }),
    ],
    check_in_reports: over.reports ?? [
      { agent_id: 'A001', round: 3, due_at: '2026-09-01', books_back: 4,
        reported_at: '2026-08-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
      { agent_id: 'A001', round: 2, due_at: '2026-08-01', books_back: 0,
        reported_at: '2026-07-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
      { agent_id: 'A002', round: 2, due_at: '2026-08-01', books_back: 0,
        reported_at: '2026-07-21T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
    ],
    book_history: over.history ?? [
      ret(1, 'A001', '2026-08-15T00:00:00.000Z'),
      ret(2, 'A001', '2026-08-16T00:00:00.000Z'),
    ],
  })
}
const lineFor = (r, id) => r.lines.find((l) => l.agentId === id)

console.log('1. the declaration and the returns are put side by side')
{
  const r = await books.returnCheck({}, users.admin, world().ctx)
  eq(r.round, 3, 'the live round')
  eq(r.since, '2026-08-01', "windowed at the previous round's due date, as it stood then")

  const a1 = lineFor(r, 'A001')
  eq(a1.declared, 4, 'they said four were coming')
  eq(a1.verified, 2, 'an organiser has counted in two')
  eq(a1.shortBy, 2, 'so two are unaccounted for')
  eq(a1.books.map((b) => b.book).join(','), 'Book-001,Book-002', 'and the two are named')
  eq(a1.stillOut.join(','), 'Book-003,Book-004,Book-005', 'as are the ones still with them')
  eq(r.unaccounted, 2, 'the one number an organiser is looking for')
}

console.log('2. it names who verified each one, and how')
{
  const r = await books.returnCheck({}, users.admin, world({
    history: [
      ret(1, 'A001', '2026-08-15T00:00:00.000Z', 'kate@x.com'),
      ret(2, 'A001', '2026-08-16T00:00:00.000Z', 'sam@x.com', 'settle'),
    ],
  }).ctx)
  const a1 = lineFor(r, 'A001')
  eq(a1.books[0].verifiedBy, 'kate@x.com', 'the organiser who took the first one back')
  eq(a1.books[0].how, 'taken back', 'recorded as a return')
  eq(a1.books[1].verifiedBy, 'sam@x.com', 'a different one counted the second')
  eq(a1.books[1].how, 'counted in', 'a settlement is a return counted on the spot')
}

console.log('3. a seller who has not reported is not called short')
{
  const r = await books.returnCheck({}, users.admin, world().ctx)
  const a2 = lineFor(r, 'A002')
  ok(!!a2, 'they still appear — they are holding a book')
  eq(a2.reported, false, 'they have not answered this round')
  eq(a2.declared, 'null', 'so there is nothing they said')
  eq(a2.shortBy, 'null', 'and no gap to accuse them of')
  eq(r.unaccounted, 2, 'they add nothing to the total')
}

console.log('4. bringing back more than promised is not a shortfall')
{
  const r = await books.returnCheck({}, users.admin, world({
    reports: [{ agent_id: 'A001', round: 3, due_at: '2026-09-01', books_back: 1,
                reported_at: '2026-08-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
               { agent_id: 'A001', round: 2, due_at: '2026-08-01', books_back: 0,
                 reported_at: '2026-07-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' }],
  }).ctx)
  const a1 = lineFor(r, 'A001')
  eq(a1.declared, 1, 'they said one')
  eq(a1.verified, 2, 'two came back')
  eq(a1.shortBy, -1, 'the difference is stated, negative')
  eq(r.unaccounted, 0, 'but nothing is unaccounted for — a surplus is not a shortfall')
}

console.log('5. a book returned before this round belongs to the round it was returned in')
{
  const r = await books.returnCheck({}, users.admin, world({
    history: [
      ret(1, 'A001', '2026-07-15T00:00:00.000Z'),   // before round 2's due date
      ret(2, 'A001', '2026-08-16T00:00:00.000Z'),
    ],
  }).ctx)
  const a1 = lineFor(r, 'A001')
  eq(a1.verified, 1, 'only the one inside the window counts')
  eq(a1.books[0].book, 'Book-002', 'and it is the right one')
  eq(a1.shortBy, 3, 'so the gap is measured against this round alone')
}

console.log('6. round 1 has no edge, so everything counts')
{
  const r = await books.returnCheck({}, users.admin, world({
    round: 1,
    reports: [{ agent_id: 'A001', round: 1, due_at: '2026-07-01', books_back: 2,
                reported_at: '2026-06-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' }],
    history: [ret(1, 'A001', '2020-01-01T00:00:00.000Z'), ret(2, 'A001', '2026-08-16T00:00:00.000Z')],
  }).ctx)
  eq(r.since, 'null', 'nothing has closed yet, so there is no edge')
  eq(lineFor(r, 'A001').verified, 2, 'and both count')
  eq(lineFor(r, 'A001').shortBy, 0, 'they are straight')
}

console.log('7. one book handled twice is one book')
{
  const r = await books.returnCheck({}, users.admin, world({
    history: [
      ret(1, 'A001', '2026-08-15T00:00:00.000Z'),
      ret(1, 'A001', '2026-08-18T00:00:00.000Z', 'admin@x.com', 'settle'),
      ret(2, 'A001', '2026-08-16T00:00:00.000Z'),
    ],
  }).ctx)
  eq(lineFor(r, 'A001').verified, 2, 'returned and then settled is still one book back')
}

console.log('8. the return is credited to whoever was holding it')
{
  // from_agent is who it came back FROM, which is the seller being measured —
  // not whoever holds the book now, which after a return is nobody.
  const r = await books.returnCheck({}, users.admin, world({
    history: [ret(1, 'A002', '2026-08-15T00:00:00.000Z'), ret(2, 'A001', '2026-08-16T00:00:00.000Z')],
  }).ctx)
  eq(lineFor(r, 'A001').verified, 1, 'A001 gets only their own')
  eq(lineFor(r, 'A002').verified, 1, 'and A002 gets theirs')
}

console.log('9. a seller sees their own line and nobody else\'s')
{
  const w = world()
  const mine = await books.returnCheck({}, seller, w.ctx)
  eq(mine.lines.length, 1, 'one line')
  eq(mine.lines[0].agentId, 'A001', 'their own')

  eq(await codeOf(() => books.returnCheck({ agentId: 'A001' }, other, w.ctx)),
    'NOT_YOURS', 'and another seller cannot ask about them')

  const asked = await books.returnCheck({ agentId: 'A001' }, users.admin, w.ctx)
  eq(asked.lines.length, 1, 'an organiser may ask about one seller')
  eq(asked.lines[0].agentId, 'A001', 'and gets that one')
}

console.log('10. the worst gap is at the top')
{
  const r = await books.returnCheck({}, users.admin, world({
    reports: [
      { agent_id: 'A001', round: 3, due_at: '2026-09-01', books_back: 3,
        reported_at: '2026-08-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
      { agent_id: 'A002', round: 3, due_at: '2026-09-01', books_back: 9,
        reported_at: '2026-08-21T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
      { agent_id: 'A001', round: 2, due_at: '2026-08-01', books_back: 0,
        reported_at: '2026-07-20T00:00:00.000Z', tickets_sold: 0, amount_paid: 0, note: '' },
    ],
  }).ctx)
  eq(r.lines[0].agentId, 'A002', 'the seller with nine promised and none counted in comes first')
  eq(r.unaccounted, 10, 'and the total is every shortfall added up')
}

console.log('11. nobody holding anything and nobody reporting is an empty list, not a wall of zeros')
{
  const r = await books.returnCheck({}, users.admin, world({
    books: [], reports: [], history: [],
  }).ctx)
  eq(r.lines.length, 0, 'a seller with nothing out, nothing said and nothing back is not a line')
  eq(r.unaccounted, 0, 'and nothing is unaccounted for')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
