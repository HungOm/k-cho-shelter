/*
 * The check-in report: the paper, the rhythm, and the day selling stops.
 *
 * WHAT THIS FILE IS ABOUT, in one sentence: a checkpoint that only restates
 * figures the system already had is a checkpoint that cannot find anything.
 *
 * The round used to record three numbers — books back, tickets sold, money paid
 * — and two of them are the seller's word about things the database counts for
 * itself. So the "report" could say what the screens already said, and the one
 * question an organiser at a table actually needs answered, does the PAPER add
 * up, had no data behind it at all. A seller carrying four books is carrying
 * forty physical tickets; every one of them is a stub handed in, a ticket handed
 * back unsold, paper still in a book they kept, or missing. Only the fourth
 * matters and only the first two had to be written down to find it.
 *
 * THE COMPARISON HAS TO BE FAIR OR IT TRAINS PEOPLE TO IGNORE IT. Stubs handed
 * in at one visit are a per-visit quantity; sales recorded against a seller's
 * books are a running total for the raffle. Comparing those directly shows a
 * discrepancy every round after the first, on every sheet, for every seller —
 * and a number that is always wrong is a number nobody reads. So the
 * declarations are summed to the round and compared like with like, and the
 * test that matters most here is the one that walks two rounds.
 *
 * THE DATES are two changes with one shape: the plan is still derived, because
 * nobody should have to keep a calendar in their head, and now a single round
 * can be moved off the rhythm without changing the rhythm for everybody. What
 * must not move is the LIVE round — CHECK_IN_DATE is the one stored date that
 * decides who is late, it already has an owner in rollCheckIn with a dry run
 * and a typed confirmation, and a second door onto it with none of those guards
 * is how a raffle gets two current check-in dates and finds out later that the
 * one nobody could see was the one doing the chasing.
 *
 * AND THE CUTOFF exists because there wasn't one: a ticket could be sold the
 * morning after the draw, and the only thing preventing it was everybody
 * remembering. The half of that test that matters is what stays OPEN after the
 * cutoff — settling, correcting, voiding — because they are the work that
 * happens because selling stopped.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  if (String(g) === String(w)) pass++
  else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) }
}

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const D = await loadModule('deadlines.ts')
const T = await loadModule('tickets.ts')

/*
 * ANCHORED ON THE APP'S OWN today(), NOT ON THIS MACHINE'S CLOCK.
 *
 * The obvious version of this helper — new Date(), setHours(0,0,0,0),
 * setDate(+n) — builds days in whatever timezone the runner happens to be in.
 * The app does not: deadlines.ts works in the raffle's zone, Asia/Singapore, so
 * that "today" means the day it is where the books are rather than the day it is
 * on the server. Those two agree on a laptop in Malaysia and disagree in CI,
 * which runs UTC — and for the eight hours after 16:00 UTC it is already
 * tomorrow where the raffle is, so every date built here lands a day out and the
 * grace-period arithmetic comes back off by one.
 *
 * THAT IS NOT HYPOTHETICAL AND IT COST A DAY'S DEPLOYS. On 2026-09-17 the Pages
 * workflow began failing at 16:43 UTC on `Run tests` and published nothing after
 * 14:12, while the same suite was green on every machine anybody checked it on.
 * Six commits sat on master looking deployed, including the fix for a seller
 * being refused their own book. The failure was not in any of them: this helper
 * had been fragile since it was written and had simply never been run in the
 * part of the day where it breaks.
 *
 * Deriving from D.today() means the test cannot disagree with the code about
 * what day it is, because it is asking the code.
 */
const day = (n) => {
  const [y, m, d] = D.today().split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const agents = [
  { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
  { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'Klang', active: true },
]
const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-' + String((idx - 1) * 10 + 1).padStart(5, '0'),
  last_ticket: 'KS-' + String(idx * 10).padStart(5, '0'),
  status: 'Out', held_by_agent: 'A001', agent_name: 'Daw Hla', due_at: day(7),
  days_overdue: 0, recorded_sold: 0, recorded_amount: 0, available: 10, reserved: 0,
  missing_contact: 0, declared_sold: null, amount_due: null, amount_paid: null,
  counted_sold: 0, counted_expected: 0, counted_collected: 0, ...over,
})
const book = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-' + String((idx - 1) * 10 + 1).padStart(5, '0'),
  last_ticket: 'KS-' + String(idx * 10).padStart(5, '0'),
  status: 'Out', held_by_agent: 'A001', due_at: day(7),
  declared_sold: null, amount_due: null, amount_paid: null, version: 1, ...over,
})

// ============ 1. a rhythm months cannot say ============

console.log('1. twice a month, which was unsayable')
{
  eq(JSON.stringify(D.parseCadence('2w')), '{"n":14,"unit":"d"}', 'a fortnight is fourteen days')
  eq(JSON.stringify(D.parseCadence('10d')), '{"n":10,"unit":"d"}', 'ten days is ten days')
  eq(JSON.stringify(D.parseCadence('3m')), '{"n":3,"unit":"m"}', 'quarterly is three months')
  eq(JSON.stringify(D.parseCadence('2')), '{"n":2,"unit":"m"}',
     'a bare number is months — which is exactly what the old key held')
  eq(JSON.stringify(D.parseCadence('', 3)), '{"n":3,"unit":"m"}',
     'and blank falls back to it, so a raffle set up before today keeps its rhythm')
  eq(JSON.stringify(D.parseCadence('nonsense', 1)), '{"n":1,"unit":"m"}',
     'a value nobody can read falls back rather than throwing at a volunteer')
  eq(JSON.stringify(D.parseCadence('0d')), '{"n":1,"unit":"d"}',
     '0 is not "never" — it asks the check-in to stand still, and is read as 1')
  eq(JSON.stringify(D.parseCadence('9999d')), '{"n":366,"unit":"d"}',
     'and a mistyped cadence is capped at a year rather than suspending the raffle')

  eq(D.cadenceWords({ n: 1, unit: 'm' }), 'a month', 'the screens say it in words')
  eq(D.cadenceWords({ n: 14, unit: 'd' }), 'a fortnight', 'and say fortnight, not 14 days')
  eq(D.cadenceWords({ n: 7, unit: 'd' }), 'a week', 'or a week')
  eq(D.cadenceWords({ n: 21, unit: 'd' }), '3 weeks', 'or whole weeks where they are whole')
  eq(D.cadenceWords({ n: 10, unit: 'd' }), '10 days', 'and days where they are not')

  const s = D.checkInSchedule('2026-10-14', '2026-12-06', { n: 14, unit: 'd' })
  eq(s.join(' '), '2026-10-14 2026-10-28 2026-11-11 2026-11-25 2026-12-06',
     'a fortnightly raffle gets its fortnights, and the wall on the end')

  // The old signature has to keep meaning what it meant. Four cases in
  // checkin.test.mjs and the whole Apps Script twin call it with a bare number,
  // and reading those as DAYS would move every date in the plan while every one
  // of those tests went on passing.
  eq(D.checkInSchedule('2026-10-14', '2026-12-06', 1).join(' '),
     '2026-10-14 2026-11-14 2026-12-06', 'a plain number is still months')
}

// ============ 2. one round moved, and the rhythm left alone ============

console.log('2. a round that lands on a holiday moves on its own')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(10), FINAL_DEADLINE: day(100), CHECK_IN_ROUND: '1' })
  const w = fakeDb({ config: cfg, agents, books: [], check_in_dates: [] })

  const before = await D.deadlineStatus({}, users.admin, w.ctx)
  const round2 = before.schedule.find((r) => r.round === 2)
  ok(!!round2, 'the plan has a round 2 to move')

  const moved = day(45)
  const r = await D.setCheckInDate({ round: 2, date: moved, note: 'hall is booked' }, users.admin, w.ctx)
  eq(r.to, moved, 'round 2 moves')
  eq(r.from, round2.date, 'and says where it was')

  const after = await D.deadlineStatus({}, users.admin, w.ctx)
  eq(after.schedule.find((x) => x.round === 2).date, moved, 'the plan shows the new date')
  ok(after.schedule.find((x) => x.round === 2).moved,
     'and marks it as moved — a date off the rhythm is one people must be told about twice')
  eq(after.checkInDate, day(10), 'the live date is untouched: only the roll moves that')

  // The property that makes this safe to offer at all.
  eq(after.schedule.find((x) => x.round === 3)?.date,
     before.schedule.find((x) => x.round === 3)?.date,
     'round 3 did not walk sideways with it — the plan is anchored, not chained')

  const back = await D.setCheckInDate({ round: 2 }, users.admin, w.ctx)
  eq(back.cleared, 'true', 'clearing puts it back')
  eq(back.to, round2.date, 'on the date the rhythm would have given it')
}

console.log('3. the refusals, each naming what to do instead')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(10), FINAL_DEADLINE: day(100), CHECK_IN_ROUND: '3' })
  const w = fakeDb({ config: cfg, agents, books: [], check_in_dates: [] })

  eq(await codeOf(() => D.setCheckInDate({ round: 2, date: day(20) }, users.admin, w.ctx)),
     'ROUND_CLOSED', 'a round people have already reported to is history')
  eq(await codeOf(() => D.setCheckInDate({ round: 3, date: day(20) }, users.admin, w.ctx)),
     'ROUND_IS_LIVE', 'and the live one belongs to the roll, which asks what it would forgive')
  eq(await codeOf(() => D.setCheckInDate({ round: 4, date: day(-1) }, users.admin, w.ctx)),
     'IN_THE_PAST', 'a reporting date has to be a day somebody can still report by')
  eq(await codeOf(() => D.setCheckInDate({ round: 4, date: day(200) }, users.admin, w.ctx)),
     'PAST_THE_WALL', 'and cannot fall after the final deadline')
  eq(await codeOf(() => D.setCheckInDate({ round: 4, date: day(10) }, users.admin, w.ctx)),
     'OUT_OF_ORDER', 'two reporting dates cannot cross')
  eq(await codeOf(() => D.setCheckInDate({ round: 4 }, users.admin, w.ctx)),
     'NO_CHANGE', 'clearing a round nobody moved changes nothing and says so')
  eq(await codeOf(() => D.setCheckInDate({ round: 99, date: day(20) }, users.admin, w.ctx)),
     'NO_SUCH_ROUND', 'and a round this raffle does not have is named as such')

  const err = await errOf(() => D.setCheckInDate({ round: 4, date: day(10) }, users.admin, w.ctx))
  ok(!!err?.details?.window, 'the window comes back with the refusal')
  ok(/has to fall after/.test(err.message), 'said as a sentence, not a rule number')
}

console.log('4. the roll takes a moved date, and never a derived one')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(2), FINAL_DEADLINE: day(300), CHECK_IN_ROUND: '1' })
  const w = fakeDb({
    config: cfg, agents, books: [book(1)],
    check_in_dates: [{ round: 2, due_at: day(9), note: '', set_by: 'admin@x.com' }],
  })
  const p = await D.rollCheckIn({}, users.admin, w.ctx)
  eq(p.to, day(9), 'the next round goes where somebody put it, not where the month would')

  const plain = fakeDb({ config: baseConfig({ CHECK_IN_DATE: day(2), FINAL_DEADLINE: day(300) }), agents, books: [book(1)] })
  const q = await D.rollCheckIn({}, users.admin, plain.ctx)
  eq(q.to, D.addMonths(day(2), 1),
     'and with nothing stored it is a plain cadence step — never read off the plan')
}

// ============ 3. the paper ============

console.log('5. what the seller physically brought is written down')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(0), FINAL_DEADLINE: day(60) })
  const w = fakeDb({
    config: cfg, agents,
    books: [book(1), book(2), book(3)],
    book_ledger_all: [ledger(1), ledger(2), ledger(3)],
    check_in_reports: [],
  })
  const r = await D.recordCheckIn({
    agentId: 'A001', booksBack: 1, stubsReturned: 6, unsoldReturned: 4,
    ticketsSold: 6, amountPaid: 60, note: 'rest next month',
  }, users.recorder, w.ctx)

  eq(r.stubsReturned, 6, 'the stubs are recorded')
  eq(r.unsoldReturned, 4, 'and the unsold tickets that came back with them')
  eq(r.booksOutAt, 3, 'and how many books they were holding when they said it')

  const row = w.row('check_in_reports', (x) => x.agent_id === 'A001')
  eq(row.stubs_returned, 6, 'stored on the round')
  eq(row.books_out_at, 3,
     'and the holding is stored rather than looked up later — a reprint has to agree ' +
     'with the copy they signed')
}

console.log('6. the sheet: declared beside recorded, and the paper in four places')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(0), FINAL_DEADLINE: day(60), CHECK_IN_ROUND: '1' })
  const w = fakeDb({
    config: cfg, agents,
    books: [book(1), book(2), book(3)],
    book_ledger_all: [
      ledger(1, { counted_sold: 4, counted_expected: 40, available: 6, missing_contact: 1 }),
      ledger(2, { counted_sold: 0, counted_expected: 0 }),
      ledger(3, { counted_sold: 0, counted_expected: 0, days_overdue: 5, due_at: day(-5) }),
    ],
    check_in_reports: [{
      agent_id: 'A001', round: 1, due_at: day(0), reported_at: new Date().toISOString(),
      books_back: 1, tickets_sold: 6, amount_paid: 60, stubs_returned: 6, unsold_returned: 4,
      books_out_at: 3, note: 'rest next month', recorded_by: 'rec@x.com',
    }],
    payments: [],
  })

  const s = await D.checkInSheet({ agentId: 'A001' }, users.recorder, w.ctx)

  eq(s.agent.name, 'Daw Hla', 'the seller, by name')
  eq(s.round, 1, 'the round it answers')
  eq(s.ticketsPerBook, 10, 'and how many tickets a book holds, which the arithmetic needs')

  eq(s.paper.ticketsInHand, 30, 'three books is thirty tickets of paper')
  eq(s.paper.inBooksHandedBack, 10, 'one book back is ten tickets of it')
  eq(s.paper.handedIn, 10, 'six stubs and four unsold is ten counted in')
  eq(s.paper.unaccounted, 0, 'so nothing is missing — the number the sheet exists for')
  eq(s.paper.stillWithThem, 20, 'and twenty tickets are still out with them')

  // Declared and recorded, never merged.
  eq(s.declared.stubsReturned, 6, 'what they said')
  eq(s.recorded.ticketsSold, 4, 'what the system was told')
  eq(s.gap.tickets, 2,
     'and the gap is two: two sales in the envelope that nobody has typed in yet')
  eq(s.gap.money, 60, 'the same for money — RM60 handed over, nothing recorded against it')

  eq(s.recorded.outstanding, 40, 'what they owe on the books they hold')
  eq(s.recorded.missingContact, 1,
     'and the one sale nobody can draw, which is the fault that cannot be fixed afterwards')
  eq(s.recorded.booksOverdue, 1, 'and the book that is late')
  eq(s.books.length, 3, 'every book, so the sheet can be read book by book')
  eq(s.books[0].available, 6, 'with what is left in it — the remains a seller is carrying')
  eq(s.frozen, null, 'nothing is frozen: this round has not closed')
}

console.log('7. paper missing from a book handed back is visible as a number')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(0), FINAL_DEADLINE: day(60) })
  const w = fakeDb({
    config: cfg, agents, books: [book(1), book(2)],
    book_ledger_all: [ledger(1), ledger(2)],
    check_in_reports: [{
      agent_id: 'A001', round: 1, due_at: day(0), reported_at: new Date().toISOString(),
      // Two books back; only fifteen tickets of the twenty came with them.
      books_back: 2, tickets_sold: 9, amount_paid: 90, stubs_returned: 9, unsold_returned: 6,
      books_out_at: 2, note: '', recorded_by: 'rec@x.com',
    }],
  })
  const s = await D.checkInSheet({ agentId: 'A001' }, users.recorder, w.ctx)
  eq(s.paper.unaccounted, 5, 'five tickets went back in books that did not contain them')
}

console.log('8. the gap is cumulative, or it is wrong on every sheet after the first')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(0), FINAL_DEADLINE: day(60), CHECK_IN_ROUND: '2' })
  const w = fakeDb({
    config: cfg, agents, books: [book(1)],
    book_ledger_all: [ledger(1, { counted_sold: 9, counted_expected: 90 })],
    check_in_reports: [
      { agent_id: 'A001', round: 1, due_at: day(-30), reported_at: new Date().toISOString(),
        books_back: 0, tickets_sold: 5, amount_paid: 50, stubs_returned: 5, unsold_returned: 0,
        books_out_at: 1, note: '', recorded_by: 'rec@x.com' },
      { agent_id: 'A001', round: 2, due_at: day(0), reported_at: new Date().toISOString(),
        books_back: 0, tickets_sold: 4, amount_paid: 40, stubs_returned: 4, unsold_returned: 0,
        books_out_at: 1, note: '', recorded_by: 'rec@x.com' },
    ],
  })
  const s = await D.checkInSheet({ agentId: 'A001' }, users.recorder, w.ctx)
  eq(s.declared.stubsReturned, 4, "this round's own figure is what they handed over today")
  eq(s.gap.stubsToDate, 9, 'but nine stubs have come in across the raffle')
  eq(s.gap.tickets, 0,
     'which is exactly what is recorded — a per-visit number compared with a running ' +
     'total would have shown a discrepancy here on every sheet, for everybody, for ever')
}

console.log('9. a seller may print their own sheet and nobody else\'s')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(0), FINAL_DEADLINE: day(60) })
  const w = fakeDb({
    config: cfg, agents,
    books: [book(1), book(4, { held_by_agent: 'A002' })],
    book_ledger_all: [ledger(1), ledger(4, { held_by_agent: 'A002', agent_name: 'U Kyaw' })],
  })
  const mine = await D.checkInSheet({ agentId: 'A002' }, users.agent, w.ctx)
  eq(mine.agent.id, 'A001',
     "asking for somebody else's is turned back into their own, not explained")

  const theirs = await D.checkInSheet({ agentId: 'A002' }, users.recorder, w.ctx)
  eq(theirs.agent.id, 'A002', 'an organiser or helper prints anybody\'s, which is the job')
  eq(await codeOf(() => D.checkInSheet({ agentId: 'NOPE' }, users.recorder, w.ctx)),
     'AGENT_NOT_FOUND', 'and a seller who does not exist is said so plainly')
}

console.log('10. a sheet reprinted after the round closed still says what it said')
{
  const cfg = baseConfig({ CHECK_IN_DATE: day(30), FINAL_DEADLINE: day(60), CHECK_IN_ROUND: '2' })
  const w = fakeDb({
    config: cfg, agents, books: [book(1)],
    book_ledger_all: [ledger(1, { counted_sold: 9, counted_expected: 90, counted_collected: 90 })],
    check_in_reports: [{
      agent_id: 'A001', round: 1, due_at: day(-30), reported_at: new Date().toISOString(),
      books_back: 0, tickets_sold: 4, amount_paid: 40, stubs_returned: 4, unsold_returned: 0,
      books_out_at: 1, note: '', recorded_by: 'rec@x.com',
    }],
    round_snapshots: [{
      round: 1, agent_id: 'A001', taken_at: '2026-09-01T00:00:00Z', taken_by: 'admin@x.com',
      books_out: 1, books_settled: 0, recorded_sold: 4, expected: 40, collected: 0,
      outstanding: 40, reported: true, missed_before: 0,
    }],
  })
  const s = await D.checkInSheet({ agentId: 'A001', round: 1 }, users.recorder, w.ctx)
  eq(s.roundClosed, 'true', 'the round has closed')
  eq(s.frozen.outstanding, 40, 'and the sheet still says the RM40 the October copy said')
  eq(s.recorded.outstanding, 0, 'beside what is true today, which is that it came in')
  eq(s.dueAt, day(-30), 'dated by the round it answers, not by where the plan sits now')
}

// ============ 4. the day selling stops ============

console.log('11. a ticket cannot be sold after the raffle stopped selling')
{
  const make = (close) => fakeDb({
    config: baseConfig({ SALES_CLOSE_DATE: close }), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null })],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', version: 1 }],
  })

  const shut = make(day(-1))
  const err = await errOf(() => T.sellTicket(
    { ticketNumber: 'KS-00001', buyerName: 'Pa Thang', buyerPhone: '0123456789', amount: 10 },
    users.recorder, shut.ctx))
  eq(err?.code, 'SALES_CLOSED', 'a sale the day after the cutoff is refused')
  eq(err?.details?.salesCloseDate, day(-1), 'and the refusal carries the date')
  ok(/An organiser can still record one/.test(err.message),
     'and tells a helper who can, rather than leaving them with a closed door')

  const today = make(day(0))
  const okSale = await T.sellTicket(
    { ticketNumber: 'KS-00001', buyerName: 'Pa Thang', buyerPhone: '0123456789', amount: 10 },
    users.recorder, today.ctx)
  eq(okSale.status, 'Sold', 'the closing day itself is still a selling day')

  const open = fakeDb({
    config: baseConfig(), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null })],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', version: 1 }],
  })
  const none = await T.sellTicket(
    { ticketNumber: 'KS-00001', buyerName: 'Pa Thang', buyerPhone: '0123456789', amount: 10 },
    users.recorder, open.ctx)
  eq(none.status, 'Sold', 'and with no cutoff set, nothing changes for anybody')
}

console.log('12. an organiser can still take cash at the draw table, with their name on it')
{
  const w = fakeDb({
    config: baseConfig({ SALES_CLOSE_DATE: day(-1) }), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null })],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', version: 1 }],
  })
  eq(await codeOf(() => T.sellTicket(
    { ticketNumber: 'KS-00001', buyerName: 'X', buyerPhone: '0123456789', amount: 10, force: true },
    users.recorder, w.ctx)), 'SALES_CLOSED', 'a helper cannot force it')

  const r = await T.sellTicket(
    { ticketNumber: 'KS-00001', buyerName: 'Late Buyer', buyerPhone: '0123456789', amount: 10, force: true },
    users.admin, w.ctx)
  eq(r.status, 'Sold', 'an organiser can')
  ok(w.table('audit_log').some((a) => /SELL/i.test(String(a.action))),
     'and it is in the log, so a late sale is a decision with a name on it')
}

console.log('13. what stays open after the cutoff is the point of having one')
{
  const w = fakeDb({
    config: baseConfig({ SALES_CLOSE_DATE: day(-1) }), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null })],
    tickets: [{
      idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', version: 1,
      buyer_name: 'Pa Thang', buyer_phone: '0123456789', amount: 10,
      payment_status: 'Unpaid', sold_at: '2026-09-01T00:00:00Z', recorded_by: 'rec@x.com',
    }],
  })
  const fixed = await T.correctTicket(
    { ticketNumber: 'KS-00001', buyerName: 'Pa Thaung', reason: 'spelt wrong on the stub' },
    users.recorder, w.ctx)
  ok(!!fixed, 'a name spelt wrong in September can still be corrected in December')
  eq(w.row('tickets', (t) => t.idx === 1).buyer_name, 'Pa Thaung', 'and the correction lands')
}

console.log('14. and the bulk doors, which are the ones a desk actually uses')
{
  const w = fakeDb({
    config: baseConfig({ SALES_CLOSE_DATE: day(-1) }), agents,
    books: [book(1, { status: 'Unassigned', held_by_agent: null })],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', version: 1 }],
  })
  eq(await codeOf(() => T.bulkRecordSales(
    { sales: [{ ticketNumber: 'KS-00001', buyerName: 'X', buyerPhone: '0123456789' }] },
    users.recorder, w.ctx)), 'SALES_CLOSED',
    'five hundred at a time goes straight to SQL and would have walked past a guard ' +
    'that only stood on the single-ticket door')
  eq(await codeOf(() => T.sellBook(
    { bookNumber: 'Book-001', buyerName: 'X', buyerPhone: '0123456789' },
    users.recorder, w.ctx)), 'SALES_CLOSED', 'and so would a whole book')
}


// ============ 5. the page itself ============

/*
 * THE HANDLER IS HALF OF IT. Every number above is one this server can produce;
 * none of that is worth anything until the page prints them where somebody
 * reads them, and this repository has four separate cases of a correct, tested
 * helper that no screen ever called. So the document is rendered.
 *
 * Compiled as the SUPABASE build on purpose. backend.js decides at import time
 * and falls through to Apps Script under Node, which is the right default for
 * every other screen and would render this one as a single sentence explaining
 * that the report lives elsewhere — a test asserting on the document would then
 * fail looking exactly like a broken component.
 */
const SHEET = {
  round: 2, isCurrentRound: true, roundClosed: false,
  dueAt: '2026-10-14', checkInDate: '2026-10-14', finalDeadline: '2026-12-06',
  salesCloseDate: '2026-12-01', cadence: 'a fortnight', graceDays: 3,
  ticketsPerBook: 10, currency: 'RM',
  takenAt: '2026-10-14T02:00:00Z', printedBy: 'organiser@example.org',
  agent: { id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'Klang' },
  declared: {
    reportedAt: '2026-10-14T01:00:00Z', recordedBy: 'organiser@example.org',
    booksOutAt: 3, booksBack: 1, stubsReturned: 6, unsoldReturned: 2,
    ticketsSold: 6, amountPaid: 60, note: 'keeping two books for the market',
  },
  recorded: {
    books: 3, booksOut: 3, booksOverdue: 1, ticketsSold: 4,
    expected: 40, collected: 0, outstanding: 40, missingContact: 2,
  },
  paper: {
    booksAtHand: 3, ticketsInHand: 30, booksBack: 1, inBooksHandedBack: 10,
    stubsReturned: 6, unsoldReturned: 2, handedIn: 8,
    stillWithThem: 22, unaccounted: 2,
  },
  gap: { stubsToDate: 6, ticketsRecorded: 4, tickets: 2, paidToDate: 60, moneyRecorded: 0, money: 60 },
  standing: { state: 'reported', reported: true, daysLate: 0, missedBefore: 1 },
  frozen: null,
  books: [
    { number: 'Book-001', firstTicket: 'KS-00001', lastTicket: 'KS-00010', status: 'Out',
      due: '2026-10-14', daysOverdue: 0, ticketsInBook: 10, sold: 4, available: 6,
      reserved: 0, missingContact: 2, expected: 40, collected: 0 },
    { number: 'Book-002', firstTicket: 'KS-00011', lastTicket: 'KS-00020', status: 'Out',
      due: '2026-10-01', daysOverdue: 13, ticketsInBook: 10, sold: 0, available: 10,
      reserved: 0, missingContact: 0, expected: 0, collected: 0 },
  ],
}

const storeFor = (result) => `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10, orgName: 'Shelter Fund', eventName: 'Winter Raffle',
         projectCode: 'CS-2026', finalDeadline: '2026-12-06', salesCloseDate: '2026-12-01',
         drawDate: '2026-12-20' },
  agents: [], user: { role: 'admin' },
})
export const api = async (action) => { ${result} }
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
export const isSold = (t) => t?.status === 'Sold'
`

console.log('15. the seller sheet says what was brought, what is recorded, and the difference')
{
  const html = await renderScreen('src/components/modals/CheckInSheet.vue',
    storeFor(`return ${JSON.stringify(SHEET)}`),
    { props: { agentId: 'A001' }, drive: (b) => b.load() })
  const said = visibleText(html)

  ok(/Daw Hla/.test(said), 'the seller, by name')
  ok(/Shelter Fund/.test(said), 'on a letterhead — a page that leaves the building says who is asking')
  ok(/Winter Raffle/.test(said) && /CS-2026/.test(said), 'and which raffle it is about')

  // The paper, in four places.
  ok(/30/.test(said), 'the tickets they were carrying')
  ok(/Stubs handed in/.test(said), 'the stubs')
  ok(/Unsold tickets handed back/.test(said), 'the unsold tickets')
  ok(/2 tickets are not accounted for/.test(said),
     'and the number the whole sheet exists to produce, in a sentence')

  // Declared beside recorded, never merged.
  ok(/They said/.test(said) && /On record/.test(said), 'both columns are printed')
  ok(/Tickets sold/.test(said), 'for the tickets')
  ok(/Money handed over/.test(said), 'and for the money')

  ok(/RM\s?40/.test(said), 'what is still owed')
  ok(/2 sold tickets have/.test(said) && /cannot be drawn/.test(said),
     'and the one fault that cannot be repaired after the draw is spelt out')

  ok(/keeping two books for the market/.test(said), 'what the seller actually said is kept')
  ok(/Organiser/.test(said) && /Seller/.test(said),
     'with two lines to sign, because the page records an agreement')
  ok(/Selling stops/.test(said), 'and the dates that matter are on the page they carry away')
  ok(!/undefined/.test(said) && !/NaN/.test(said), 'nothing on it reads as a missing value')
}

console.log('16. a sheet for somebody who has not reported is still worth carrying to the table')
{
  const blank = { ...SHEET, declared: null, gap: null,
    paper: { ...SHEET.paper, stubsReturned: 0, unsoldReturned: 0, handedIn: 0, booksBack: 0,
             inBooksHandedBack: 0, unaccounted: 0, stillWithThem: 30 } }
  const html = await renderScreen('src/components/modals/CheckInSheet.vue',
    storeFor(`return ${JSON.stringify(blank)}`),
    { props: { agentId: 'A001' }, drive: (b) => b.load() })
  const said = visibleText(html)
  ok(/Has not reported/.test(said), 'it says so at the top')
  ok(/this sheet is the one to take to the table/.test(said),
     'and offers itself as the blank form rather than as an error')
  ok(/Book-001/.test(said), 'with their books already on it, which is the point of printing it early')
}

console.log('18. the round report puts what the round said beside what is true now')
{
  const SNAP = {
    round: 2, rounds: [1, 2], scope: 'all', takenAt: '2026-10-14T02:00:00Z',
    totals: {
      sellers: 2,
      then: { expected: 300, collected: 100, outstanding: 200, reported: 1 },
      now: { expected: 300, collected: 260, outstanding: 40 },
    },
    lines: [
      { agentId: 'A001', name: 'Daw Hla', phone: '0125551111', takenAt: '2026-10-14T02:00:00Z',
        then: { booksOut: 3, booksSettled: 0, ticketsSold: 12, expected: 120, collected: 0,
                outstanding: 120, reported: true, missedBefore: 0 },
        now: { expected: 120, collected: 120, outstanding: 0 } },
      { agentId: 'A002', name: 'U Kyaw', phone: '0125552222', takenAt: '2026-10-14T02:00:00Z',
        then: { booksOut: 2, booksSettled: 1, ticketsSold: 8, expected: 180, collected: 100,
                outstanding: 80, reported: false, missedBefore: 2 },
        now: { expected: 180, collected: 140, outstanding: 40 } },
    ],
  }
  const DRAW = {
    ready: false, blockers: ['tickets sold but not identified (6)'],
    totals: { ticketsSold: 20, expected: 300, collected: 260, outstanding: 40, missingContact: 6 },
  }
  const store = storeFor(
    `if (action === 'round_snapshot') return ${JSON.stringify(SNAP)}\n` +
    `  return ${JSON.stringify(DRAW)}`)

  const html = await renderScreen('src/components/modals/RoundReport.vue', store,
    { props: { round: 2 }, drive: (b) => b.load() })
  const said = visibleText(html)

  ok(/Outstanding when the round closed/.test(said), 'what the round said')
  ok(/Outstanding today/.test(said), 'and what is true now')
  ok(/has come in since the round closed/.test(said),
     'with the difference named — either number alone is half an answer')
  ok(/1 seller did not answer/.test(said), 'who was silent')
  ok(/Daw Hla/.test(said) && /U Kyaw/.test(said), 'every seller, by name, for an organiser')
  ok(said.indexOf('U Kyaw') < said.indexOf('Daw Hla'),
     'ordered by what is still owed, because that is the list somebody acts on')
  ok(/missed 2/.test(said), 'and a seller who has been silent for rounds is marked')
  ok(/not identified/.test(said), 'the draw blockers ride along')
  ok(/Checked by/.test(said), 'and it is signed, like the seller sheet')
  ok(!/undefined/.test(said) && !/NaN/.test(said), 'nothing reads as a missing value')
}

console.log('19. a viewer gets the totals and no names, and the page still adds up')
{
  const TOTALS_ONLY = {
    round: 2, rounds: [2], scope: 'totals', takenAt: '2026-10-14T02:00:00Z',
    totals: {
      sellers: 2,
      then: { expected: 300, collected: 100, outstanding: 200, reported: 1 },
      now: { expected: 300, collected: 260, outstanding: 40 },
    },
    lines: [],
  }
  const html = await renderScreen('src/components/modals/RoundReport.vue',
    storeFor(`if (action === 'round_snapshot') return ${JSON.stringify(TOTALS_ONLY)}\n  throw new Error('no')`),
    { props: { round: 2 }, drive: (b) => b.load() })
  const said = visibleText(html)
  ok(/Totals only/.test(said), 'the names are withheld and the page says so')
  ok(/RM\s?200/.test(said),
     'and the totals are the SERVER\'S — a page that added up its own empty table ' +
     'would show this person a column of noughts and call it the raffle')
}

console.log('19b. a helper is told why the list is not there, not shown a heading over nothing')
{
  /*
   * `scope !== 'totals'` is the shape money.ts warns about by name: two screens
   * wrote it for themselves and both broke when a fourth scope existed. This
   * one was the third. It never leaked — the server sends a helper no lines —
   * but it rendered the heading and then offered no explanation, because the
   * fallback only fired for the one scope somebody had thought of.
   */
  const helper = {
    round: 2, rounds: [2], scope: 'recorded', takenAt: '2026-10-14T02:00:00Z',
    totals: {
      sellers: 2,
      then: { expected: 300, collected: 100, outstanding: 200, reported: 1 },
      now: { expected: 300, collected: 260, outstanding: 40 },
    },
    lines: [],
  }
  const said = visibleText(await renderScreen('src/components/modals/RoundReport.vue',
    storeFor(`if (action === 'round_snapshot') return ${JSON.stringify(helper)}\n  throw new Error('no')`),
    { props: { round: 2 }, drive: (b) => b.load() }))
  ok(!/Seller by seller/.test(said), 'no heading over an empty table')
  ok(/goes to organisers/.test(said), 'and a sentence saying who the list is for')
  ok(/RM\s?200/.test(said), 'while the totals, which are theirs to see, are still there')
}

console.log('19c. and a scope nobody has invented yet gets nothing, which is the only test that can catch this')
{
  /*
   * THE CASE THAT THE FOUR REAL SCOPES CANNOT TEST.
   *
   * Every assertion above names a scope that exists — all, mine, totals,
   * recorded — so all of them pass against the negation `scope !== 'totals'`
   * as readily as against the rule, for three of the four. The whole failure
   * mode of "everything except X" is a value that is not in the set yet, and no
   * case keyed on the values that ARE in it can reach that.
   *
   * So the scope here is one nobody has written: it must get the totals, which
   * are computed for whoever the server decided this caller may be told about,
   * and NOT the seller-by-seller list. An unrecognised reader falls on the
   * withholding side, which is the only safe side to fall on.
   */
  const unknown = {
    round: 2, rounds: [2], scope: 'added-next-year', takenAt: '2026-10-14T02:00:00Z',
    totals: {
      sellers: 2,
      then: { expected: 300, collected: 100, outstanding: 200, reported: 1 },
      now: { expected: 300, collected: 260, outstanding: 40 },
    },
    // The server withholds them for any scope that is not all-or-mine, so an
    // unknown one arrives empty. The screen must not be the thing relying on
    // that: it has to withhold on its own account too.
    lines: [
      { agentId: 'A001', name: 'Daw Hla', phone: '0125551111',
        then: { booksOut: 3, booksSettled: 0, ticketsSold: 12, expected: 120,
                collected: 0, outstanding: 120, reported: true, missedBefore: 0 },
        now: { expected: 120, collected: 120, outstanding: 0 } },
    ],
  }
  const said = visibleText(await renderScreen('src/components/modals/RoundReport.vue',
    storeFor(`if (action === 'round_snapshot') return ${JSON.stringify(unknown)}\n  throw new Error('no')`),
    { props: { round: 2 }, drive: (b) => b.load() }))
  ok(!/Daw Hla/.test(said),
     'a reader nobody planned for is not handed a seller by name, even when the rows arrive')
  ok(!/Seller by seller/.test(said), 'nor a heading promising them')
  ok(/goes to organisers/.test(said), 'and is told who the list is for')
  ok(/RM\s?200/.test(said), 'while the totals the server computed for them still show')
}

console.log('20. no round has closed yet is an answer, not an empty page')
{
  const html = await renderScreen('src/components/modals/RoundReport.vue',
    storeFor("return { round: 0, rounds: [], lines: [], totals: null, scope: 'all', message: 'No round has closed yet, so there is nothing frozen to look back at.' }"),
    { props: {}, drive: (b) => b.load() })
  ok(/No round has closed yet/.test(visibleText(html)), 'it says so in the server\'s own words')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
