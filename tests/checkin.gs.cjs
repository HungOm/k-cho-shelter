/*
 * The Apps Script half of checkin.test.mjs.
 *
 * Separate file because the .gs sources are eval'd into a CommonJS global scope
 * and the Supabase modules are ESM; mixing them in one process means the .gs
 * globals shadow things the other half needs. The ESM file runs this one and
 * folds the counts in, so `node checkin.test.mjs` still reports one total.
 *
 * This is not a re-test of the logic. It is a check that the two backends have
 * not drifted on the three things that would be silent if they did: the roll
 * target, what clears the badge, and what survives a roll.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const admin = { email: 'admin@x.com', displayName: 'Admin', role: 'admin', isAdmin: true, isSuperAdmin: false, agentId: '', active: true };
const seller = { email: 'a@x.com', displayName: 'Daw Hla', role: 'agent', isAdmin: false, isSuperAdmin: false, agentId: 'A001', active: true };

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function dayOf(n) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; }
const D = n => iso(dayOf(n));

/** Three sellers: two holding a book each, one holding nothing. */
function world(over) {
  over = over || {};
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const base = {
    TICKET_PREFIX: 'KS-', TICKET_START: '1', TICKET_DIGITS: '4', TOTAL_TICKETS: '30',
    TICKETS_PER_BOOK: '10', BOOK_PREFIX: 'Book-', BOOK_DIGITS: '3', TICKET_PRICE: '10',
    CURRENCY: 'RM', DEFAULT_DUE_DAYS: '30',
    CHECK_IN_DATE: over.checkIn === undefined ? D(2) : over.checkIn,
    FINAL_DEADLINE: over.final === undefined ? D(200) : over.final,
    DRAW_DATE: '',
    CHECK_IN_EVERY_MONTHS: String(over.months === undefined ? 1 : over.months),
    REPORT_GRACE_DAYS: String(over.grace === undefined ? 3 : over.grace),
    CHECK_IN_ROUND: String(over.round === undefined ? 1 : over.round)
  };
  for (const k in base) __sheets[SHEET.CONFIG].appendRow([k, base[k], '']);

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  for (let i = 1; i <= 30; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[0] = ticketNumberAt(i, cfg); row[1] = TICKET_STATUS.AVAILABLE;
    row[2] = bookNumberAt(Math.ceil(i / 10), cfg); row[12] = 1;
    T.appendRow(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  const map = { Book_Number: 1, First_Ticket: 2, Last_Ticket: 3, Status: 4, Held_By_Agent: 5 };
  for (let b = 1; b <= 3; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[map.Book_Number - 1] = bookNumberAt(b, cfg);
    row[map.First_Ticket - 1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    row[map.Last_Ticket - 1] = ticketNumberAt(b * 10, cfg);
    row[map.Status - 1] = b <= 2 ? BOOK_STATUS.OUT : BOOK_STATUS.UNASSIGNED;
    row[map.Held_By_Agent - 1] = b === 1 ? 'A001' : b === 2 ? 'A002' : '';
    row[6] = b <= 2 ? (over.due === undefined ? D(2) : over.due) : '';   // Due_Date
    row[13] = 1;
    B.appendRow(row);
  }
  const A = __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  A.appendRow(['A001', 'Daw Hla', '0125551111', 'KL', true, '']);
  A.appendRow(['A002', 'U Kyaw', '0125552222', 'Klang', true, '']);
  A.appendRow(['A003', 'Ma Nu', '0125553333', 'Ipoh', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
}

const standing = (id, user) =>
  handleListAgents({}, user || admin).agents.filter(a => a.id === id)[0];

// ---------------------------------------------- 1. the dates, worked out

console.log('the schedule is every step that fits, then the wall');
{
  world();
  const plan = checkInSchedule_(dayStart_('2026-10-14'), dayStart_('2026-12-06'), 1).map(isoDay_);
  eq(plan.join(' '), '2026-10-14 2026-11-14 2026-12-06', 'three rounds from two dates');

  const tight = checkInSchedule_(dayStart_('2026-11-01'), dayStart_('2026-12-06'), 1).map(isoDay_);
  eq(tight.join(' '), '2026-11-01 2026-12-01 2026-12-06',
    'a step landing days before the wall is kept, not folded into it');

  const quarterly = checkInSchedule_(dayStart_('2026-10-14'), dayStart_('2027-04-10'), 3).map(isoDay_);
  eq(quarterly.join(' '), '2026-10-14 2027-01-14 2027-04-10', 'quarterly gets quarterly rounds');

  eq(checkInSchedule_(dayStart_('2026-10-14'), null, 1).length, 0,
    'with no wall there is no schedule');
}

// ------------------------------------------- 2. the roll, and the round

console.log('the roll steps the stored date and clamps at the wall');
{
  world();
  const p = handleRollCheckIn({}, admin);
  eq(p.to, isoDay_(addMonths_(dayOf(2), 1)), 'a plain cadence step, not a schedule lookup');
  eq(getConfig().CHECK_IN_ROUND, '1', 'a preview writes no round');

  world({ checkIn: D(30), final: D(30) });
  eq(codeOf(() => handleRollCheckIn({}, admin)), 'NO_CHANGE',
    'a raffle already on its wall says so plainly, not CANNOT_MOVE_BACK');

  world({ months: 3 });
  eq(handleRollCheckIn({}, admin).to, isoDay_(addMonths_(dayOf(2), 3)),
    'a quarterly raffle steps three months');

  world();
  const applied = handleRollCheckIn({ dryRun: false }, admin);
  eq(getConfig().CHECK_IN_ROUND, '2', 'applying moves the round on');
  eq(applied.nextRound, 2, 'and says so');
}

// --------------------------------------------------- 3. reporting in

console.log('recording a report');
{
  world();
  const r = handleRecordCheckIn(
    { agentId: 'A001', booksBack: 1, ticketsSold: 6, amountPaid: 60 }, admin);
  eq(r.round, 1, 'filed against the live round');
  eq(r.updated, false, 'the first is not an update');
  eq(__sheets[SHEET.CHECK_INS].getLastRow(), 2, 'one row under the header');

  const again = handleRecordCheckIn({ agentId: 'A001', ticketsSold: 9 }, admin);
  eq(again.updated, true, 'the second replaces rather than refuses');
  eq(__sheets[SHEET.CHECK_INS].getLastRow(), 2, 'still one row for the round');
  eq(readCheckInsRaw_()[0].Tickets_Sold, 9, 'the later word wins');
}

console.log('what it refuses');
{
  world();
  eq(codeOf(() => handleRecordCheckIn({}, admin)), 'MISSING_FIELD', 'somebody has to be reporting');
  eq(codeOf(() => handleRecordCheckIn({ agentId: 'A404' }, admin)), 'AGENT_NOT_FOUND',
    'and they have to exist');
  eq(codeOf(() => handleRecordCheckIn({ agentId: 'A002', undo: true }, admin)), 'NOTHING_TO_DO',
    'undoing what was never recorded says so');

  world({ checkIn: '' });
  eq(codeOf(() => handleRecordCheckIn({ agentId: 'A001' }, admin)), 'NO_CHECK_IN_DATE',
    'with no round there is nothing for a report to answer');
}

console.log('undo removes the record rather than hiding it');
{
  world();
  handleRecordCheckIn({ agentId: 'A001' }, admin);
  eq(standing('A001').reportState, 'reported', 'recorded');
  const u = handleRecordCheckIn({ agentId: 'A001', undo: true }, admin);
  eq(u.undone, true, 'undone');
  eq(readCheckInsRaw_().length, 0, 'the row is gone, so they are back on the list');
}

// ------------------------------------------------- 4. where people stand

console.log('where each seller stands');
{
  world({ checkIn: D(-9), grace: 3, due: D(-9) });
  handleRecordCheckIn({ agentId: 'A001' }, admin);

  eq(standing('A001').reportState, 'reported', 'the one who answered is clear');
  eq(standing('A002').reportState, 'late', 'the one who did not, nine days on, is late');
  eq(standing('A002').daysLate, 6, 'counted from the END of the grace, not the date');
  eq(standing('A003').reportState, 'clear', 'somebody holding nothing is not marked');
}

console.log('the grace is a real gap, not decoration');
{
  world({ checkIn: D(0), grace: 3, due: D(0) });
  eq(standing('A002').reportState, 'due', 'on the day itself, due — not late');

  world({ checkIn: D(-3), grace: 3, due: D(-3) });
  eq(standing('A002').reportState, 'due', 'still only due on the last day of the grace');

  world({ checkIn: D(-4), grace: 3, due: D(-4) });
  eq(standing('A002').reportState, 'late', 'the day after it, late');

  world({ checkIn: D(20), grace: 3, due: D(20) });
  eq(standing('A002').reportState, 'waiting', 'three weeks out, nobody is chased');
}

console.log('the roll forgives a late book, never the silence');
{
  world({ checkIn: D(-9), grace: 3, due: D(-9) });
  handleRecordCheckIn({ agentId: 'A001' }, admin);

  handleRollCheckIn({ dryRun: false, confirm: isoDay_(addMonths_(dayOf(-9), 1)) }, admin);
  eq(getConfig().CHECK_IN_ROUND, '2', 'round two');

  eq(handleReportOverdue({}, admin).count, 0, 'no book is late for the new round');
  eq(readCheckInsRaw_().length, 1, 'and no report was cleared by the roll');

  eq(standing('A001').missedRounds, 0, 'the one who answered round one has missed nothing');
  eq(standing('A002').missedRounds, 1, 'the one who did not still carries it');
  eq(standing('A001').reportState, 'waiting', 'both start the new round un-reported');
  eq(standing('A002').reportState, 'waiting', 'including the one who is behind');

  handleRecordCheckIn({ agentId: 'A002' }, admin);
  eq(standing('A002').reportState, 'reported', 'clear for the round being answered');
  eq(standing('A002').missedRounds, 1, 'and still one behind overall');
}

console.log('settling a book is itself a report');
{
  world({ checkIn: D(-9), grace: 3, due: D(-9) });
  eq(standing('A001').reportState, 'late', 'holding a book and silent, nine days on');

  handleSettleBook({ bookNumber: 'Book-001', amountPaid: 0, unsoldTickets: [] }, admin);
  eq(standing('A001').reportState, 'reported',
    'counting their book and taking their money is them reporting');
  eq(readCheckInsRaw_()[0].Note, 'Reported by settling Book-001', 'and it says how it is known');
  eq(readCheckInsRaw_()[0].Amount_Paid, 0,
    'the money stays in the settlement — a figure echoed here would read as a second one');
  eq(standing('A002').reportState, 'late', 'nobody else is marked by it');
}

console.log('and it never overwrites what somebody typed');
{
  world({ checkIn: D(-9), grace: 3, due: D(-9) });
  handleRecordCheckIn({ agentId: 'A001', ticketsSold: 7, note: 'Came to the hall' }, admin);
  handleSettleBook({ bookNumber: 'Book-001', amountPaid: 0, unsoldTickets: [] }, admin);
  eq(readCheckInsRaw_().length, 1, 'still one row for the round');
  eq(readCheckInsRaw_()[0].Note, 'Came to the hall', 'the typed report stands');
  eq(readCheckInsRaw_()[0].Tickets_Sold, 7, 'with what was written down');
}

console.log('what the deadline screen is told');
{
  world({ checkIn: D(-9), grace: 3, due: D(-9) });
  handleRecordCheckIn({ agentId: 'A001' }, admin);

  const st = handleDeadlineStatus({}, admin);
  eq(st.sellersHolding, 2, 'two sellers are holding books');
  eq(st.sellersReported, 1, 'one has answered');
  eq(st.sellersNotReported, 1, 'one has not');
  eq(st.reportBy, D(-6), 'and the day the chasing starts');
  ok(st.schedule.length >= 2, 'the plan travels with it');
  eq(st.schedule[st.schedule.length - 1].last, true, 'and ends on the wall');
  eq(st.youReported, null, 'an organiser is not asked about themselves');

  const mine = handleDeadlineStatus({}, seller);
  eq(mine.scope, 'mine', 'a seller is scoped');
  eq(mine.booksOut, 1, 'to their own book');
  eq(mine.sellersHolding, 1, 'with no raffle-wide headcount');
  eq(mine.youReported, true, 'and told whether THEY have answered');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
