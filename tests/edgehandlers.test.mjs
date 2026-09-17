/*
 * The edge-function handlers, actually run.
 *
 * Every write action on the Supabase side had no behavioural test of any kind,
 * while its Apps Script twin had thousands of assertions. The gate tests check
 * permission, the RLS tests ask the database, the parity tests compare
 * registries — none of them runs a handler. So a ported handler could agree
 * with its contract on every surface anybody was checking and still do the
 * wrong thing to the rows.
 *
 * What is tested here is chosen by what costs money or cannot be undone:
 * expanding the raffle, moving the line of what is in play, settling a book,
 * putting one back on the shelf, and the two deadlines. The deadline cases
 * follow the contract ceam-raffle-7c wrote out, and two of them are the ones
 * they named as most likely to drift — the ORDER of the refusals, and
 * CONFIRM_REQUIRED firing only when something is already late.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const deadlines = await loadModule('deadlines.ts')
const people = await loadModule('people.ts')
const books = await loadModule('books.ts')

const today = deadlines.today()
const plus = (days) => new Date(Date.parse(today + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)

/** A raffle with `n` books out, each with a due date. */
function world(cfg = {}, out = []) {
  const bookRows = out.map((b, i) => ({
    idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'),
    first_ticket: 'KS-' + String(i * 10 + 1).padStart(5, '0'),
    last_ticket: 'KS-' + String((i + 1) * 10).padStart(5, '0'),
    status: b.status ?? 'Out', held_by_agent: b.agent ?? 'A001',
    due_at: b.due ?? null, declared_sold: null, amount_due: null, amount_paid: null,
    settled_at: null, settled_by: '', notes: '', version: 1,
  }))
  return fakeDb({
    config: baseConfig(cfg),
    books: bookRows,
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true }],
  })
}

// ============ 1. the order of the refusals ============
console.log('roll_check_in refuses in the contracted order')
{
  // The order is the design, not an accident of how it was written. The wrong
  // refusal first sends somebody to fix the wrong thing — told their date is
  // unreadable when the real problem is that no final deadline exists.
  const noFinal = world({ CHECK_IN_DATE: plus(10) })
  eq(await codeOf(() => deadlines.rollCheckIn({ date: 'rubbish' }, users.admin, noFinal.ctx)),
    'NO_FINAL_DEADLINE', 'no final deadline outranks an unreadable date')

  const w = world({ FINAL_DEADLINE: plus(90), CHECK_IN_DATE: plus(10) })
  eq(await codeOf(() => deadlines.rollCheckIn({ date: 'rubbish' }, users.admin, w.ctx)),
    'BAD_DATE', 'then an unreadable date')

  // A raffle already past its wall has no next round to open.
  const passed = world({ FINAL_DEADLINE: plus(-5), CHECK_IN_DATE: plus(-30) })
  eq(await codeOf(() => deadlines.rollCheckIn({ date: plus(30) }, users.admin, passed.ctx)),
    'FINAL_PASSED', 'a passed final deadline outranks a perfectly good date')

  eq(await codeOf(() => deadlines.rollCheckIn({ date: plus(-1) }, users.admin, w.ctx)),
    'IN_THE_PAST', 'then a date in the past')

  eq(await codeOf(() => deadlines.rollCheckIn({ date: plus(5) }, users.admin, w.ctx)),
    'CANNOT_MOVE_BACK', 'then one that moves the check-in backwards')

  const far = world({ FINAL_DEADLINE: plus(4000), CHECK_IN_DATE: plus(10) })
  eq(await codeOf(() => deadlines.rollCheckIn({ date: plus(3000) }, users.admin, far.ctx)),
    'TOO_FAR', 'then a leap no sane round makes')
}

// ============ 2. THE GUARD ON THE WHOLE FEATURE ============
console.log('a round that forgives lateness has to be typed out; one that does not, does not')
{
  // If this inverts, a volunteer absolves every late book with one tap and the
  // preview they never had to read is the only record it happened.
  const late = world({ FINAL_DEADLINE: plus(90), CHECK_IN_DATE: plus(-1) },
    [{ due: plus(-3) }, { due: plus(-2) }])

  const code = await codeOf(() =>
    deadlines.rollCheckIn({ date: plus(30), dryRun: false }, users.admin, late.ctx))
  eq(code, 'CONFIRM_REQUIRED', 'two books already late: refused without confirmation')
  eq(late.wrote().length, 0, 'and nothing was written')

  const err = await errOf(() =>
    deadlines.rollCheckIn({ date: plus(30), dryRun: false }, users.admin, late.ctx))
  eq(err.details.lateNow, 2, 'the refusal says how many are late')
  eq(err.details.confirm, plus(30), 'and exactly what to send back')

  // Wrong word is still a refusal — otherwise the confirmation is decoration.
  eq(await codeOf(() => deadlines.rollCheckIn(
    { date: plus(30), dryRun: false, confirm: 'yes' }, users.admin, late.ctx)),
    'CONFIRM_REQUIRED', 'a confirmation that is not the date does not count')

  const done = await deadlines.rollCheckIn(
    { date: plus(30), dryRun: false, confirm: plus(30) }, users.admin, late.ctx)
  eq(done.to, plus(30), 'with the right word it applies')
  eq(late.config('CHECK_IN_DATE'), plus(30), 'and the check-in moved')

  // Nothing late: routine, and must not demand a password.
  const clean = world({ FINAL_DEADLINE: plus(90), CHECK_IN_DATE: plus(5) },
    [{ due: plus(5) }, { due: plus(5) }])
  const r = await deadlines.rollCheckIn({ date: plus(35), dryRun: false }, users.admin, clean.ctx)
  eq(r.to, plus(35), 'a clean round applies on dryRun:false alone')
  eq(r.booksMoving, 2, 'and moves the books that were due')
}

// ============ 3. which books move, and which keep their date ============
console.log('rolling moves only books due by the old check-in')
{
  const w = world({ FINAL_DEADLINE: plus(200), CHECK_IN_DATE: plus(10) }, [
    { due: plus(10) },    // due on the old check-in — moves
    { due: plus(5) },     // due earlier — moves
    { due: plus(60) },    // already given longer — must NOT be pulled back
    { due: null },        // never given one — moves
    { due: plus(10), status: 'Settled' },   // finished with — untouched
  ])

  const r = await deadlines.rollCheckIn({ date: plus(40), dryRun: false }, users.admin, w.ctx)
  eq(r.booksMoving, 3, 'three of the four out move')

  eq(w.row('books', (b) => b.idx === 1).due_at, plus(40), 'the one due on the date moved')
  eq(w.row('books', (b) => b.idx === 2).due_at, plus(40), 'the earlier one moved')
  // The one that matters: a book already given until later keeps it. Moving it
  // would pull a due date backwards, which the contract forbids outright.
  eq(w.row('books', (b) => b.idx === 3).due_at, plus(60), 'the later one KEEPS its date')
  eq(w.row('books', (b) => b.idx === 4).due_at, plus(40), 'the one with no date got one')
  eq(w.row('books', (b) => b.idx === 5).due_at, plus(10), 'a settled book is untouched')
}

// ============ 4. the clamp, and the last round ============
console.log('the check-in stops ON the wall rather than past it')
{
  const w = world({ FINAL_DEADLINE: plus(20), CHECK_IN_DATE: plus(5) }, [{ due: plus(5) }])
  const r = await deadlines.rollCheckIn({ date: plus(90), dryRun: false }, users.admin, w.ctx)

  eq(r.to, plus(20), 'clamped to the final deadline, not refused')
  ok(r.isLastRound, 'and flagged as the last round')
  eq(w.config('CHECK_IN_DATE'), plus(20), 'the config value is the clamp, not the ask')
  // Refusing would leave the date stuck in the past for the rest of the raffle,
  // which is the one state that stops the check-in working at all.
}

// ============ 5. a dry run writes nothing ============
console.log('previews are previews')
{
  const w = world({ FINAL_DEADLINE: plus(90), CHECK_IN_DATE: plus(5) }, [{ due: plus(5) }])
  const r = await deadlines.rollCheckIn({ date: plus(35) }, users.admin, w.ctx)
  ok(r.dryRun, 'dryRun defaults to true')
  eq(w.wrote().length, 0, 'nothing written')
  eq(w.config('CHECK_IN_DATE'), plus(5), 'the check-in did not move')
  eq(w.row('books', (b) => b.idx === 1).due_at, plus(5), 'nor the book')
}

// ============ 6. the wall ============
console.log('set_final_deadline')
{
  const w = () => world({ DRAW_DATE: plus(120), CHECK_IN_DATE: plus(30), FINAL_DEADLINE: plus(90) })

  eq(await codeOf(() => deadlines.setFinalDeadline({ date: plus(10) }, users.admin, w().ctx)),
    'SUPER_ADMIN_ONLY', 'an organiser cannot move the wall')

  eq(await codeOf(() => deadlines.setFinalDeadline({ date: plus(-1) }, users.boss, w().ctx)),
    'IN_THE_PAST', 'nor can it be set behind us')

  // The draw cannot happen before the books are back.
  eq(await codeOf(() => deadlines.setFinalDeadline({ date: plus(150) }, users.boss, w().ctx)),
    'AFTER_DRAW', 'nor after the draw')

  eq(await codeOf(() => deadlines.setFinalDeadline({ date: plus(90) }, users.boss, w().ctx)),
    'NO_CHANGE', 'nor to the date it already is')

  // Shortening takes time away from everybody, so it is typed out.
  eq(await codeOf(() => deadlines.setFinalDeadline(
    { date: plus(60), dryRun: false }, users.boss, w().ctx)),
    'CONFIRM_REQUIRED', 'bringing it forward needs confirmation')

  // Lengthening does not: nobody loses anything.
  const longer = w()
  const r = await deadlines.setFinalDeadline({ date: plus(110), dryRun: false }, users.boss, longer.ctx)
  eq(r.to, plus(110), 'pushing it back applies without a password')

  // The side effect, stated rather than silent.
  const pull = world({ DRAW_DATE: plus(120), CHECK_IN_DATE: plus(80), FINAL_DEADLINE: plus(90) })
  const preview = await deadlines.setFinalDeadline({ date: plus(50) }, users.boss, pull.ctx)
  ok(preview.pullsCheckInBack, 'the preview says the check-in will be pulled back')
  ok(String(preview.effect).includes(plus(80)), 'and names the date it is moving from')

  const applied = await deadlines.setFinalDeadline(
    { date: plus(50), dryRun: false, confirm: plus(50) }, users.boss, pull.ctx)
  eq(applied.checkInDate, plus(50), 'applying pulls the check-in to match')
  eq(pull.config('CHECK_IN_DATE'), plus(50), 'so the invariant holds: check-in <= final')

  // Clearing stops every countdown, so it has its own word.
  const clear = w()
  eq(await codeOf(() => deadlines.setFinalDeadline({ date: '', dryRun: false }, users.boss, clear.ctx)),
    'CONFIRM_REQUIRED', 'clearing needs confirmation')
  const cleared = await deadlines.setFinalDeadline(
    { date: '', dryRun: false, confirm: 'clear' }, users.boss, clear.ctx)
  ok(cleared.clearing, 'and clears with the literal word')
  eq(clear.config('FINAL_DEADLINE'), '', 'the wall is gone')
}

// ============ 7. a seller is told about their own books ============
console.log('deadline_status is scoped like every other read')
{
  const w = world({ FINAL_DEADLINE: plus(30), CHECK_IN_DATE: plus(10) }, [
    { due: plus(-2), agent: 'A001' },
    { due: plus(-2), agent: 'A002' },
    { due: plus(5), agent: 'A002' },
  ])

  const all = await deadlines.deadlineStatus({}, users.admin, w.ctx)
  eq(all.scope, 'all', 'an organiser sees the whole raffle')
  eq(all.booksOut, 3, 'three books out')
  eq(all.lateNow, 2, 'two late')

  const mine = await deadlines.deadlineStatus({}, users.agent, w.ctx)
  eq(mine.scope, 'mine', 'a seller sees their own')
  eq(mine.booksOut, 1, 'one book out')
  eq(mine.lateNow, 1, 'one late — theirs, not the other seller\'s')
}

// ============ 8. THE MOST DANGEROUS ACTION IN THE SYSTEM ============
console.log('expand_tickets refuses everything it should')
{
  const w = () => {
    const f = fakeDb({
      config: baseConfig({ TOTAL_TICKETS: '50', ACTIVE_TICKETS: '50', TICKET_CEILING: '100' }),
      tickets: Array.from({ length: 50 }, (_, i) => ({ idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'), book_idx: Math.ceil((i + 1) / 10), status: 'Available' })),
      books: Array.from({ length: 5 }, (_, i) => ({ idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'), status: 'Unassigned' })),
    })
    return f
  }

  eq(await codeOf(() => people.expandTickets({ totalTickets: 100 }, users.admin, w().ctx)),
    'SUPER_ADMIN_ONLY', 'an organiser cannot grow the raffle')

  // The refusal that matters most: shrinking would delete tickets that may
  // already be sold, and nothing would report an error.
  eq(await codeOf(() => people.expandTickets({ totalTickets: 30 }, users.boss, w().ctx)),
    'CANNOT_SHRINK', 'the raffle cannot be made smaller')

  // The slipped digit. 50 -> 500 with a ceiling of 100.
  eq(await codeOf(() => people.expandTickets({ totalTickets: 500 }, users.boss, w().ctx)),
    'ABOVE_CEILING', 'a mistyped size is caught by the planned ceiling')

  eq(await codeOf(() => people.expandTickets({ totalTickets: 50 }, users.boss, w().ctx)),
    'NO_CHANGE', 'growing to the size it already is')

  eq(await codeOf(() => people.expandTickets({ totalTickets: 'lots' }, users.boss, w().ctx)),
    'BAD_REQUEST', 'and a number that is not one')

  // Drift: if the rows and the settings disagree, appending puts new tickets on
  // the wrong numbers, which is unrecoverable without renumbering.
  const drifted = w()
  drifted.db.tables.tickets.pop()
  eq(await codeOf(() => people.expandTickets({ totalTickets: 100 }, users.boss, drifted.ctx)),
    'SCHEMA_DRIFT', 'a database that disagrees with the config refuses to grow')
}

console.log('expand_tickets previews, then appends exactly')
{
  const mk = () => fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '50', ACTIVE_TICKETS: '50', TICKET_CEILING: '100' }),
    tickets: Array.from({ length: 50 }, (_, i) => ({ idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'), book_idx: Math.ceil((i + 1) / 10), status: 'Available' })),
    books: Array.from({ length: 5 }, (_, i) => ({ idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'), status: 'Unassigned' })),
  })

  const preview = mk()
  const p = await people.expandTickets({ totalTickets: 100 }, users.boss, preview.ctx)
  ok(p.dryRun, 'dry run by default')
  eq(preview.table('tickets').length, 50, 'nothing appended')
  eq(p.addedTickets, 50, 'but it says how many would be')
  eq(p.firstNewTicket, 'KS-00051', 'and where they would start')

  const w = mk()
  const r = await people.expandTickets({ totalTickets: 100, dryRun: false }, users.boss, w.ctx)
  eq(r.addedTickets, 50, 'fifty added')
  eq(r.addedBooks, 5, 'in five books')
  eq(w.table('tickets').length, 100, 'the rows exist')
  eq(w.table('books').length, 10, 'and the books')

  // Append only: ticket N must still sit at idx N, or the arithmetic that makes
  // a lookup free stops being true.
  const t = w.table('tickets')
  eq(t[50].idx, 51, 'ticket 51 is at index 51')
  eq(t[50].number, 'KS-00051', 'and numbered accordingly')
  eq(t[50].book_idx, 6, 'in book 6')
  eq(t[99].number, 'KS-00100', 'through to the last')
  eq(w.table('books')[9].last_ticket, 'KS-00100', 'the final book ends where it should')

  // The existing rows are untouched — this is the whole point of append-only.
  eq(t[0].number, 'KS-00001', 'the first ticket is unchanged')
  eq(t[49].number, 'KS-00050', 'and the old last one')

  // Created is not released. Two decisions, deliberately kept apart.
  eq(w.config('TOTAL_TICKETS'), '100', 'the total grew')
  eq(w.config('ACTIVE_TICKETS'), '50', 'but what is in play did NOT')
  ok(String(r.note).includes('not yet in play'), 'and it says so')
}

// ============ 9. moving the line of what is in play ============
console.log('set_active_tickets')
{
  const mk = (over = {}, ticketOver = () => ({}), bookOver = () => ({})) => fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '50', ACTIVE_TICKETS: '50', ...over }),
    tickets: Array.from({ length: 50 }, (_, i) => ({
      idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
      book_idx: Math.ceil((i + 1) / 10), status: 'Available', ...ticketOver(i + 1),
    })),
    books: Array.from({ length: 5 }, (_, i) => ({
      idx: i + 1, number: 'Book-' + String(i + 1).padStart(3, '0'),
      status: 'Unassigned', ...bookOver(i + 1),
    })),
  })

  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 20 }, users.admin, mk().ctx)),
    'SUPER_ADMIN_ONLY', 'an organiser cannot move the line')

  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 60 }, users.boss, mk().ctx)),
    'NOT_GENERATED', 'cannot put more in play than exist')

  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 25 }, users.boss, mk().ctx)),
    'PARTIAL_BOOK', 'and never half a book')

  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 50 }, users.boss, mk().ctx)),
    'NO_CHANGE', 'nor to where it already is')

  // THE ONE THAT PROTECTS A BUYER. Pulling the line back behind a sold ticket
  // does not undo the sale, it hides it — and the buyer turns up on draw day
  // holding a number the system says is not in the raffle.
  const sold = mk({}, (i) => (i === 45 ? { status: 'Sold', buyer_name: 'Ma Nu' } : {}))
  const code = await codeOf(() => people.setActiveTickets({ activeTickets: 40 }, users.boss, sold.ctx))
  eq(code, 'TICKETS_IN_USE', 'a sold ticket above the line refuses the pull-back')
  eq(sold.config('ACTIVE_TICKETS'), '50', 'and nothing moved')

  const err = await errOf(() => people.setActiveTickets({ activeTickets: 40 }, users.boss, sold.ctx))
  ok(String(err.details.examples[0]).includes('KS-00045'), 'the refusal names the ticket')

  // A reserved ticket counts too: somebody is holding it for a buyer.
  const held = mk({}, (i) => (i === 45 ? { status: 'Reserved' } : {}))
  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 40 }, users.boss, held.ctx)),
    'TICKETS_IN_USE', 'so does a reserved one')

  // A book that has left the office, even with nothing sold from it yet.
  const out = mk({}, () => ({}), (b) => (b === 5 ? { status: 'Out', held_by_agent: 'A001' } : {}))
  eq(await codeOf(() => people.setActiveTickets({ activeTickets: 40 }, users.boss, out.ctx)),
    'BOOKS_IN_USE', 'a book already out refuses it too')

  // Releasing more is the ordinary direction and needs none of that.
  const grow = mk({ ACTIVE_TICKETS: '20' })
  const r = await people.setActiveTickets({ activeTickets: 40 }, users.boss, grow.ctx)
  eq(r.released, 20, 'twenty more released')
  eq(r.heldBack, 10, 'ten still held back')
  eq(grow.config('ACTIVE_TICKETS'), '40', 'and the line moved')

  // Pulling back over untouched tickets is allowed — nobody is relying on them.
  const shrink = mk()
  const s = await people.setActiveTickets({ activeTickets: 30 }, users.boss, shrink.ctx)
  eq(s.pulledBack, 20, 'twenty pulled back when nothing is spoken for')
}

// ============ 10. a book brought back can go out again ============
console.log('restock_books guards the money')
{
  const mk = (bookOver = {}, ticketOver = () => ({})) => fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
    tickets: Array.from({ length: 20 }, (_, i) => ({
      idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
      book_idx: Math.ceil((i + 1) / 10), status: 'Available',
      buyer_name: '', buyer_phone: '', amount: null, ...ticketOver(i + 1),
    })),
    books: [
      { idx: 1, number: 'Book-001', status: 'Returned', held_by_agent: 'A001', declared_sold: null, amount_due: null, amount_paid: null, ...bookOver },
      { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A001' },
    ],
    book_ledger_all: [],
    agents: [{ agent_id: 'A001', name: 'Daw Hla' }],
  })

  // A book that came back untouched owes nothing and goes straight back.
  const clean = mk()
  clean.db.tables.book_ledger_all = [{ idx: 1, number: 'Book-001', status: 'Returned', agent_name: 'Daw Hla', held_by_agent: 'A001', counted_expected: 0, counted_collected: 0 }]
  const r = await books.restockBooks({ fromBook: 'Book-001', dryRun: false }, users.admin, clean.ctx)
  eq(r.restocked, 1, 'restocked without settling first')
  eq(clean.row('books', (b) => b.idx === 1).status, 'Unassigned', 'and is free to give out')

  /*
   * MONEY OWED IS NOT A REFUSAL, AND THAT IS THE CHANGE.
   *
   * This used to refuse any book with an unpaid balance, on the reasoning that
   * restocking clears held_by_agent and the outstanding report finds debts by
   * who holds a book. That stopped being how the report works when money began
   * following the sale: agent_money adds sold tickets on OPEN books to
   * amount_due on CLOSED ones, so a restock moves the same debt from the second
   * half to the first and the seller still owes it.
   *
   * The advice was also impossible to follow. The books it refused were counted
   * in already, and it told the organiser to count them in first.
   */
  const owed = mk()
  owed.db.tables.book_ledger_all = [{ idx: 1, number: 'Book-001', status: 'Settled', agent_name: 'Daw Hla', held_by_agent: 'A001', counted_expected: 80, counted_collected: 0, recorded_amount: 80 }]
  await books.restockBooks({ fromBook: 'Book-001', dryRun: false }, users.admin, owed.ctx)
  eq(owed.row('books', (b) => b.idx === 1).status, 'Unassigned',
    'a book counted in with nothing handed in CAN go back on the shelf — the debt is on its tickets')

  /*
   * WHAT IS STILL REFUSED: a count-in that declared more than the tickets
   * account for. Somebody typed "8 sold" while only three were ever written
   * down, and that difference lives on the book and nowhere else — clearing it
   * destroys it. RM80 declared against RM30 on the tickets loses RM50.
   */
  const losing = mk()
  losing.db.tables.book_ledger_all = [{ idx: 1, number: 'Book-001', status: 'Settled', agent_name: 'Daw Hla', held_by_agent: 'A001', counted_expected: 80, counted_collected: 0, recorded_amount: 30 }]
  // Read, not assumed: the fixture's own starting status, so this asserts
  // "unchanged" rather than a literal that is true of some other fixture.
  const wasStatus = losing.row('books', (b) => b.idx === 1).status
  eq(await codeOf(() => books.restockBooks({ fromBook: 'Book-001', dryRun: false }, users.admin, losing.ctx)),
    'MONEY_WOULD_BE_LOST', 'a book counted in for more than its tickets carry is refused')
  eq(losing.row('books', (b) => b.idx === 1).status, wasStatus, 'and nothing changed')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
