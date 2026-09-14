/*
 * The two dates a raffle runs on.
 *
 * The check-in date is soft: one shared day everybody reports by, which steps
 * forward a month once the check is done. The final deadline is hard: the day
 * everything has to be back, after which the draw happens.
 *
 * The move that needs watching is the roll. Stepping the check-in date forward
 * makes late books stop being late — that is what a checkpoint is for, and also
 * exactly how "we will collect it next month" turns into a year of nobody
 * chasing anybody. These tests pin what the roll is allowed to absorb, what it
 * must refuse, and the one thing it can never do: walk past the final deadline.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const sup = { email: 'boss@x.com', displayName: 'Boss', role: 'admin', isAdmin: true, isSuperAdmin: true, agentId: '', active: true };
const admin = { email: 'admin@x.com', displayName: 'Admin', role: 'admin', isAdmin: true, isSuperAdmin: false, agentId: '', active: true };

/** A date n days from today, as the app writes them. */
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function day(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d;
}
const D = n => iso(day(n));

/**
 * A small raffle with `books` books of 10, and whatever dates are passed.
 * Books are unassigned until handed out by a test.
 */
function world(dates) {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const base = {
    TICKET_PREFIX: 'KS-', TICKET_START: '1', TICKET_DIGITS: '4', TOTAL_TICKETS: '100',
    TICKETS_PER_BOOK: '10', BOOK_PREFIX: 'Book-', BOOK_DIGITS: '3', TICKET_PRICE: '10',
    CURRENCY: 'RM', DEFAULT_DUE_DAYS: '30', CHECK_IN_DATE: '', FINAL_DEADLINE: '', DRAW_DATE: ''
  };
  Object.assign(base, dates || {});
  for (const k in base) __sheets[SHEET.CONFIG].appendRow([k, base[k], '']);

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  for (let i = 1; i <= 100; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[0] = ticketNumberAt(i, cfg); row[1] = TICKET_STATUS.AVAILABLE;
    row[2] = bookNumberAt(Math.ceil(i / 10), cfg); row[12] = 1;
    T.appendRow(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for (let b = 1; b <= 10; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[0] = bookNumberAt(b, cfg); row[1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    row[2] = ticketNumberAt(b * 10, cfg); row[3] = BOOK_STATUS.UNASSIGNED; row[13] = 1;
    B.appendRow(row);
  }
  __mkSheet(SHEET.AGENTS, COLS.AGENTS).appendRow(['A001', 'Pa Thang', '0123456789', 'Kajang', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
  return cfg;
}

/** Put book n in an agent's hands with an explicit due date. */
function handOut(n, dueIso) {
  const sheet = __sheets[SHEET.BOOKS];
  const map = headerMap(sheet);
  const row = n + 1;
  sheet.getRange(row, map.Status).setValue(BOOK_STATUS.OUT);
  sheet.getRange(row, map.Held_By_Agent).setValue('A001');
  sheet.getRange(row, map.Issued_Date).setValue(new Date());
  sheet.getRange(row, map.Due_Date).setValue(dueIso);
  bumpBookCacheVersion();
}
const dueOf = n => {
  const sheet = __sheets[SHEET.BOOKS];
  return String(sheet.getRange(n + 1, headerMap(sheet).Due_Date).getValue() || '');
};

// ---------------------------------------------------------------- 1. dates

console.log('1. reading and stepping dates');
{
  // A bare ISO day must mean that day HERE. `new Date('2026-10-14')` is UTC
  // midnight, which is still the 13th anywhere west of Greenwich, and a
  // deadline that means yesterday for half the world is not a deadline.
  eq(isoDay_(dayStart_('2026-10-14')), '2026-10-14', 'ISO string stays on its own day');
  eq(isoDay_(dayStart_(new Date(2026, 9, 14, 23, 30))), '2026-10-14', 'late-evening Date is still that day');
  eq(dayStart_(''), null, 'blank is no date');
  eq(dayStart_('not a date'), null, 'junk is no date');
  eq(dayStart_(null), null, 'null is no date');

  // Plain setMonth turns 31 January into 3 March, which would walk a
  // month-end check-in date forward a few days every year.
  eq(isoDay_(addMonths_(new Date(2026, 0, 31), 1)), '2026-02-28', '31 Jan + 1 month clamps to Feb');
  eq(isoDay_(addMonths_(new Date(2024, 0, 31), 1)), '2024-02-29', 'and to the 29th in a leap year');
  eq(isoDay_(addMonths_(new Date(2026, 7, 31), 1)), '2026-09-30', '31 Aug + 1 month clamps to 30 Sep');
  eq(isoDay_(addMonths_(new Date(2026, 0, 15), 1)), '2026-02-15', 'an ordinary day keeps its number');
  eq(isoDay_(addMonths_(new Date(2026, 11, 15), 1)), '2027-01-15', 'December rolls the year');
  eq(daysBetween_(new Date(2026, 0, 1), new Date(2026, 0, 31)), 30, 'days between');
}

// ------------------------------------------------- 2. the shared due date

console.log('2. one date for everybody');
{
  world({ CHECK_IN_DATE: D(20), FINAL_DEADLINE: D(90) });
  eq(isoDay_(defaultDueDate_(getConfig())), D(20), 'a handover is due at the shared check-in');

  // Two handovers a fortnight apart still report on the same day — the whole
  // reason the date is shared rather than counted from each handover.
  const r1 = handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', toBook: 'Book-001' }, admin);
  eq(isoDay_(dayStart_(r1.dueDate)), D(20), 'issued books take the shared date');

  world({ CHECK_IN_DATE: D(-5), FINAL_DEADLINE: D(60) });
  eq(isoDay_(defaultDueDate_(getConfig())), D(60),
    'if nobody moved a passed check-in, the final deadline is the honest next date');

  world({ CHECK_IN_DATE: D(-5), FINAL_DEADLINE: D(-1) });
  eq(isoDay_(defaultDueDate_(getConfig())), D(30), 'with both behind us, the old rolling default');

  world({});
  eq(isoDay_(defaultDueDate_(getConfig())), D(30), 'a raffle with no dates set behaves as before');

  // No book should be born overdue.
  world({ CHECK_IN_DATE: D(-9), FINAL_DEADLINE: D(40) });
  const r2 = handleIssueBooks({ agentId: 'A001', fromBook: 'Book-002', toBook: 'Book-002' }, admin);
  ok(dayStart_(r2.dueDate) >= today_(), 'a book handed over today is never already late');
}

console.log('3. no handover promises time past the final deadline');
{
  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(30) });
  eq(codeOf(() => handleIssueBooks(
    { agentId: 'A001', fromBook: 'Book-001', dueDate: D(45) }, admin)), 'DUE_AFTER_FINAL',
    'a per-book date past the wall is refused');
  eq(String(__sheets[SHEET.BOOKS].getRange(2, 4).getValue()), BOOK_STATUS.UNASSIGNED,
    'and nothing was handed over');
  ok(handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', dueDate: D(30) }, admin).issued === 1,
    'a date landing exactly on the wall is fine');
}

// ------------------------------------------------------- 4. rolling it on

console.log('4. what the roll refuses');
{
  world({ CHECK_IN_DATE: D(5) });
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'NO_FINAL_DEADLINE',
    'a checkpoint with no wall behind it is an extension that never ends');

  world({ CHECK_IN_DATE: D(-40), FINAL_DEADLINE: D(-2) });
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'FINAL_PASSED',
    'once the wall is behind you there is no next round');

  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(90) });
  eq(codeOf(() => handleRollCheckIn({ date: D(3) }, admin)), 'CANNOT_MOVE_BACK',
    'it only moves forward');
  eq(codeOf(() => handleRollCheckIn({ date: D(10) }, admin)), 'CANNOT_MOVE_BACK',
    'and standing still is not a move');
  eq(codeOf(() => handleRollCheckIn({ date: 'soon' }, admin)), 'BAD_DATE', 'a date has to be a date');

  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(4000) });
  eq(codeOf(() => handleRollCheckIn({ date: D(800) }, admin)), 'TOO_FAR',
    'a mistyped year cannot suspend the chasing for a decade');

  // The one round with nowhere further to go.
  world({ CHECK_IN_DATE: D(30), FINAL_DEADLINE: D(30) });
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'NO_CHANGE', 'the last round says so plainly');
}

console.log('5. the roll stops at the wall rather than stepping over it');
{
  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(20) });
  const p = handleRollCheckIn({}, admin);
  eq(p.to, D(20), 'a month out would overshoot, so it lands on the final deadline');
  eq(p.isLastRound, true, 'and says this is the last round');
  ok(p.dryRun === true, 'previewed, not applied');
  eq(getConfig().CHECK_IN_DATE, D(10), 'nothing was written');

  handleRollCheckIn({ dryRun: false }, admin);
  eq(getConfig().CHECK_IN_DATE, D(20), 'applying writes the clamped date');
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'NO_CHANGE', 'and there is no round after it');
}

console.log('6. the roll brings the outstanding books with it');
{
  world({ CHECK_IN_DATE: D(2), FINAL_DEADLINE: D(200) });
  handOut(1, D(2));     // on the check-in date
  handOut(2, D(-3));    // late already
  handOut(3, D(60));    // deliberately given longer
  const sheet = __sheets[SHEET.BOOKS], map = headerMap(sheet);
  sheet.getRange(5, map.Status).setValue(BOOK_STATUS.SETTLED);
  sheet.getRange(5, map.Due_Date).setValue(D(2));   // book 4, finished with
  bumpBookCacheVersion();

  const p = handleRollCheckIn({}, admin);
  eq(p.booksOut, 3, 'three books are out');
  eq(p.booksMoving, 2, 'only the two due by the old date move');
  eq(p.lateNow, 1, 'one of them is late today');
  ok(/stop counting as late/.test(p.effect), 'the preview says what the move erases');

  // Erasing lateness is the thing worth typing a date back for.
  eq(codeOf(() => handleRollCheckIn({ dryRun: false }, admin)), 'CONFIRM_REQUIRED',
    'a move that clears late books asks for the date back');
  eq(codeOf(() => handleRollCheckIn({ dryRun: false, confirm: 'yes' }, admin)), 'CONFIRM_REQUIRED',
    'and not just any word');

  const applied = handleRollCheckIn({ dryRun: false, confirm: D(32) }, admin);
  eq(applied.to, D(32), 'a month on from the 2nd');
  eq(getConfig().CHECK_IN_DATE, D(32), 'the shared date moved');
  eq(isoDay_(dayStart_(dueOf(1))), D(32), 'the book due that day came with it');
  eq(isoDay_(dayStart_(dueOf(2))), D(32), 'so did the late one');
  eq(isoDay_(dayStart_(dueOf(3))), D(60), 'the book given longer kept its own date');
  eq(isoDay_(dayStart_(dueOf(4))), D(2), 'a settled book is not re-dated');

  const after = handleReportOverdue({}, admin);
  eq(after.count, 0, 'nobody is late for the new round');
}

console.log('7. a roll with nothing late needs no confirmation');
{
  world({ CHECK_IN_DATE: D(5), FINAL_DEADLINE: D(200) });
  handOut(1, D(5));
  const p = handleRollCheckIn({}, admin);
  eq(p.lateNow, 0, 'nobody is late');
  ok(!/stop counting as late/.test(p.effect), 'so the preview does not claim otherwise');
  const applied = handleRollCheckIn({ dryRun: false }, admin);
  eq(applied.to, D(35), 'and dryRun:false is enough to apply it');
  eq(isoDay_(dayStart_(dueOf(1))), D(35), 'the book moved too');
}

// -------------------------------------------------------- 8. the hard date

console.log('8. the final deadline');
{
  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(90) });
  eq(codeOf(() => handleSetFinalDeadline({ date: D(120) }, admin)), 'SUPER_ADMIN_ONLY',
    'the promise made to ticket buyers is not an admin job');
  eq(codeOf(() => handleSetFinalDeadline({ date: 'later' }, sup)), 'BAD_DATE', 'a date has to be a date');
  eq(codeOf(() => handleSetFinalDeadline({ date: D(90) }, sup)), 'NO_CHANGE', 'no move, no write');
  eq(codeOf(() => handleSetFinalDeadline({ date: D(-1) }, sup)), 'IN_THE_PAST',
    'nobody can work towards yesterday');
  eq(codeOf(() => handleSetFinalDeadline({ date: D(3000) }, sup)), 'TOO_FAR', 'check the year');

  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(90), DRAW_DATE: D(100) });
  eq(codeOf(() => handleSetFinalDeadline({ date: D(110) }, sup)), 'AFTER_DRAW',
    'the draw cannot happen before the money is in');
  const okMove = handleSetFinalDeadline({ date: D(100), dryRun: false }, sup);
  eq(okMove.to, D(100), 'landing on the draw date is allowed');
  eq(getConfig().FINAL_DEADLINE, D(100), 'and written');
}

console.log('9. shortening the raffle takes the check-in date with it');
{
  world({ CHECK_IN_DATE: D(40), FINAL_DEADLINE: D(90) });
  const p = handleSetFinalDeadline({ date: D(20) }, sup);
  eq(p.pullsCheckInBack, true, 'the checkpoint cannot sit past the end');
  eq(p.checkInDate, D(20), 'so it comes back too');
  ok(/comes back to/.test(p.effect), 'and the preview says so before anything happens');
  eq(getConfig().CHECK_IN_DATE, D(40), 'nothing written on a preview');

  eq(codeOf(() => handleSetFinalDeadline({ date: D(20), dryRun: false }, sup)), 'CONFIRM_REQUIRED',
    'taking time away asks for the date back');
  handleSetFinalDeadline({ date: D(20), dryRun: false, confirm: D(20) }, sup);
  eq(getConfig().FINAL_DEADLINE, D(20), 'the wall moved in');
  eq(getConfig().CHECK_IN_DATE, D(20), 'and the checkpoint with it');

  // Pushing it out is the ordinary direction and does not.
  handleSetFinalDeadline({ date: D(60), dryRun: false }, sup);
  eq(getConfig().FINAL_DEADLINE, D(60), 'extending needs no typed confirmation');
  eq(getConfig().CHECK_IN_DATE, D(20), 'and leaves the checkpoint where it was');
}

console.log('10. clearing it');
{
  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(90) });
  eq(codeOf(() => handleSetFinalDeadline({ date: '', dryRun: false }, sup)), 'CONFIRM_REQUIRED',
    'removing the wall is not a slip');
  handleSetFinalDeadline({ date: '', dryRun: false, confirm: 'clear' }, sup);
  eq(getConfig().FINAL_DEADLINE, '', 'cleared');
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'NO_FINAL_DEADLINE',
    'and the monthly rhythm stops until one is set again');
  eq(codeOf(() => handleSetFinalDeadline({ date: '', dryRun: false, confirm: 'clear' }, sup)), 'NO_CHANGE',
    'clearing nothing is nothing');
}

// ---------------------------------------------------- 11. what reports say

console.log('11. late for the checkpoint vs late for the raffle');
{
  world({ CHECK_IN_DATE: D(-10), FINAL_DEADLINE: D(30) });
  handOut(1, D(-10));
  let rep = handleReportOverdue({}, admin);
  eq(rep.count, 1, 'one book is late');
  eq(rep.overdue[0].pastFinal, false, 'but only for a checkpoint that will move again');
  eq(rep.pastFinalCount, 0, 'nothing is past the raffle itself');
  eq(rep.finalDeadline, D(30), 'the report carries both dates');

  world({ CHECK_IN_DATE: D(-40), FINAL_DEADLINE: D(-5) });
  handOut(1, D(-40));
  handOut(2, D(-12));
  rep = handleReportOverdue({}, admin);
  eq(rep.pastFinalCount, 2, 'now they are late for the raffle');
  eq(rep.overdue[0].pastFinal, true, 'and every book still out says so');
  ok(rep.overdue[0].daysOverdue >= rep.overdue[1].daysOverdue, 'longest overdue still first');

  // pastFinal is a fact about the raffle, not about one book: once the wall is
  // behind you every book still out is past it. Worth pinning, because it is
  // the reason the overdue list does not need to sort on it.
  ok(rep.overdue.every(o => o.pastFinal), 'it is all of them or none of them');
}

console.log('12. the draw waits for the final deadline');
{
  world({ CHECK_IN_DATE: D(10), FINAL_DEADLINE: D(30) });
  let r = handleReportDrawReady({}, admin);
  eq(r.finalPassed, false, 'the wall is still ahead');
  ok(r.blockers.some(b => /final deadline is/.test(b)),
    'so the draw is not ready however tidy the books are');
  eq(r.ready, false, 'not ready');

  world({ FINAL_DEADLINE: D(-1) });
  r = handleReportDrawReady({}, admin);
  eq(r.finalPassed, true, 'once it has passed');
  ok(!r.blockers.some(b => /final deadline is/.test(b)), 'that blocker is gone');
  eq(r.ready, true, 'and an otherwise clean raffle is ready to draw');
}

console.log('13. the status the app shows on every load');
{
  world({ CHECK_IN_DATE: D(-2), FINAL_DEADLINE: D(40), DRAW_DATE: D(50) });
  handOut(1, D(-2));
  handOut(2, D(-2));
  const s = handleDeadlineStatus({}, admin);
  eq(s.checkInDue, true, 'the check-in is due');
  eq(s.daysToCheckIn, -2, 'two days ago');
  eq(s.daysToFinal, 40, 'and the wall is forty out');
  eq(s.booksOut, 2, 'two books out');
  eq(s.lateNow, 2, 'both late for this round');
  eq(s.finalPassed, false, 'the raffle itself is not late');
  eq(s.isLastRound, false, 'and there is another round after this one');
  eq(s.drawDate, D(50), 'the draw date comes along for the banner');
  eq(s.scope, 'all', 'an organiser sees the whole raffle');

  // A seller must be told the date — they cannot report by a day nobody named.
  // The counts are a different matter: raffle-wide totals are withheld from
  // sellers everywhere else, so these are the books in their own hands.
  handOut(3, D(-2));
  const sheet = __sheets[SHEET.BOOKS], map = headerMap(sheet);
  sheet.getRange(4, map.Held_By_Agent).setValue('A002');
  bumpBookCacheVersion();

  const agent = { email: 'a@x.com', role: 'agent', isAdmin: false, isSuperAdmin: false,
                  active: true, agentId: 'A001', displayName: 'Daw Hla' };
  const seller = handleDeadlineStatus({}, agent);
  eq(seller.checkInDate, D(-2), 'the seller is told when to report');
  eq(seller.finalDeadline, D(40), 'and when everything is due back');
  eq(seller.scope, 'mine', 'but the counts are only theirs');
  eq(seller.booksOut, 2, 'two of the three books are in their hands');
  eq(seller.lateNow, 2, 'both late');
  eq(handleDeadlineStatus({}, admin).booksOut, 3, 'while the organiser still sees all three');
}

console.log('14. a new raffle starts with a check-in date a month out');
{
  world({});
  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  seedConfig_();
  global.__clearCache();
  invalidateConfigCache();
  eq(getConfig().CHECK_IN_DATE, isoDay_(addMonths_(today_(), 1)),
    'seeded as a date, not a duration');
  eq(getConfig().FINAL_DEADLINE, '', 'the final deadline is a decision, not a default');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
