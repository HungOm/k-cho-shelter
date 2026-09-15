/*
 * Growing a raffle that outgrew its range.
 *
 * This is the only action allowed to move a key in LOCKED_CONFIG_KEYS, which
 * makes it the most dangerous one in the system. Two things have to hold and
 * keep holding: a total can never go DOWN — ticketIndex() silently un-sells
 * everything above a lowered line, paid-for tickets included — and every ticket
 * already printed has to keep the number it was printed with.
 *
 * The rest of these tests pin the conditions that stand between a super admin
 * and four thousand rows written to the wrong place.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const sup = { email: 'boss@x.com', displayName: 'Boss', role: 'admin', isAdmin: true, isSuperAdmin: true, agentId: '', active: true };
const admin = { email: 'admin@x.com', displayName: 'Admin', role: 'admin', isAdmin: true, isSuperAdmin: false, agentId: '', active: true };

/** total tickets, books of `per`, padded to `tDigits`/`bDigits`. */
function world(total, per, tDigits, bDigits) {
  per = per || 10; tDigits = tDigits || 4; bDigits = bDigits || 3;
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', String(tDigits)],
   ['TOTAL_TICKETS', String(total)], ['TICKETS_PER_BOOK', String(per)], ['BOOK_PREFIX', 'Book-'],
   ['BOOK_DIGITS', String(bDigits)], ['TICKET_PRICE', '10'], ['CURRENCY', 'RM'],
   ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  for (let i = 1; i <= total; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[0] = ticketNumberAt(i, cfg); row[1] = TICKET_STATUS.AVAILABLE;
    row[2] = bookNumberAt(Math.ceil(i / per), cfg); row[12] = 1;
    T.appendRow(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for (let b = 1; b <= Math.ceil(total / per); b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[0] = bookNumberAt(b, cfg); row[1] = ticketNumberAt((b - 1) * per + 1, cfg);
    row[2] = ticketNumberAt(Math.min(b * per, total), cfg);
    row[3] = BOOK_STATUS.UNASSIGNED; row[13] = 1;
    B.appendRow(row);
  }
  __mkSheet(SHEET.AGENTS, COLS.AGENTS).appendRow(['A001', 'Pa Thang', '0123456789', 'Kajang', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
  assertNumberingUnchanged_();   // records the starting fingerprint
}
const go = (p, u) => handleExpandTickets(p, u || sup);

// ============ 1. it can never go down ============
console.log('a total can only go up');
world(50);
eq(codeOf(() => go({ totalTickets: 40, dryRun: false, confirm: '40' })), 'CANNOT_SHRINK', 'lowering refused');
eq(codeOf(() => go({ totalTickets: 49, dryRun: true })), 'CANNOT_SHRINK', 'refused even as a preview');
eq(codeOf(() => go({ totalTickets: 0, dryRun: true })), 'CANNOT_SHRINK', 'zero refused');
eq(codeOf(() => go({ totalTickets: 50, dryRun: true })), 'NO_CHANGE', 'same total is not a change');
eq(getConfig().TOTAL_TICKETS, '50', 'and none of that touched the setting');

// ============ 2. only the super admin ============
console.log('only the super admin');
world(50);
eq(codeOf(() => go({ totalTickets: 100, dryRun: true }, admin)), 'SUPER_ADMIN_ONLY', 'a plain admin cannot');
ok(actionRegistry().expand_tickets.sup === true, 'and the registry says so too');
ok(actionRegistry().expand_tickets.lock === true, 'it takes the lock');
eq(actionRegistry().expand_tickets.kind, 'bulk', 'and counts as a bulk write');

// ============ 3. the padding has to fit ============
console.log('the padding has to fit the new numbers');
world(50, 10, 4, 3);
eq(codeOf(() => go({ totalTickets: 10000, dryRun: true })), 'NUMBERING_TOO_SMALL', '10000 will not fit 4 ticket digits');
world(50, 10, 5, 3);
eq(codeOf(() => go({ totalTickets: 10000, dryRun: true })), 'NUMBERING_TOO_SMALL', '1000 books will not fit 3 book digits');
world(50, 10, 5, 4);
ok(codeOf(() => go({ totalTickets: 10000, dryRun: true })) === 'NO_THROW', 'with 5 and 4 it fits');

// the same rule a fresh project is held to
eq(numberingFitProblem_({ TICKET_START: '1', TICKETS_PER_BOOK: '10', TICKET_DIGITS: '5', BOOK_DIGITS: '4' }, 10000), '', '10000 fits 5/4');
ok(numberingFitProblem_({ TICKET_START: '1', TICKETS_PER_BOOK: '10', TICKET_DIGITS: '4', BOOK_DIGITS: '4' }, 10000) !== '', '...but not 4 ticket digits');
ok(numberingFitProblem_({ TICKET_START: '1', TICKETS_PER_BOOK: '10', TICKET_DIGITS: '5', BOOK_DIGITS: '3' }, 10000) !== '', '...nor 3 book digits');

// ============ 4. the ceiling, and a partial last book ============
console.log('the ceiling and the partial book');
world(50);
eq(codeOf(() => go({ totalTickets: MAX_TOTAL_TICKETS + 1, dryRun: true })), 'TOO_MANY', 'past the ceiling refused');
world(55);   // 5 books of 10 plus a half-full sixth
eq(codeOf(() => go({ totalTickets: 100, dryRun: true })), 'PARTIAL_BOOK', 'a half-full last book cannot be grown past');

// ============ 5. a sheet that has drifted ============
console.log('a sheet that no longer matches its settings');
world(50);
__sheets[SHEET.TICKETS]._data.pop();          // somebody deleted a row by hand
eq(codeOf(() => go({ totalTickets: 100, dryRun: true })), 'SHEET_DRIFT', 'refused rather than appended to the wrong rows');

// ============ 6. preview changes nothing, and confirmation is required ============
console.log('preview, then confirm');
world(50);
const pre = go({ totalTickets: 100 });        // dryRun defaults to true
ok(pre.dryRun === true, 'it previews by default');
eq(pre.addedTickets, 50, 'preview counts the tickets');
eq(pre.addedBooks, 5, 'preview counts the books');
eq(pre.firstNewTicket, 'KS-0051', 'preview names the first new ticket');
eq(pre.lastNewBook, 'Book-010', 'preview names the last new book');
eq(getConfig().TOTAL_TICKETS, '50', 'and wrote nothing');
eq(__sheets[SHEET.TICKETS]._data.length - 1, 50, 'no rows appeared');

eq(codeOf(() => go({ totalTickets: 100, dryRun: false })), 'CONFIRM_REQUIRED', 'applying needs the number typed back');
eq(codeOf(() => go({ totalTickets: 100, dryRun: false, confirm: '99' })), 'CONFIRM_REQUIRED', 'and the right number');
eq(getConfig().TOTAL_TICKETS, '50', 'still nothing written');

// ============ 7. the real thing ============
console.log('50 tickets becomes 100');
world(50);
const before = [];
for (let i = 1; i <= 50; i++) before.push(__sheets[SHEET.TICKETS]._data[i][0]);

const res = go({ totalTickets: 100, dryRun: false, confirm: '100' });
eq(res.from, 50, 'reports where it started');
eq(res.to, 100, 'and where it ended');
eq(res.addedTickets, 50, 'added 50 tickets');
eq(res.addedBooks, 5, 'added 5 books');

eq(getConfig().TOTAL_TICKETS, '100', 'the setting moved');
eq(__sheets[SHEET.TICKETS]._data.length - 1, 100, '100 ticket rows');
eq(__sheets[SHEET.BOOKS]._data.length - 1, 10, '10 book rows');

// the whole point: nothing already printed changed
let same = true;
for (let i = 1; i <= 50; i++) if (__sheets[SHEET.TICKETS]._data[i][0] !== before[i - 1]) same = false;
ok(same, 'every ticket already printed kept its number');
eq(__sheets[SHEET.BOOKS]._data[1][0], 'Book-001', 'book one is untouched');
eq(__sheets[SHEET.BOOKS]._data[5][2], 'KS-0050', 'and the old last book still ends where it did');

// the new rows are where the arithmetic expects them
eq(__sheets[SHEET.TICKETS]._data[51][0], 'KS-0051', 'ticket 51 is on row 52');
eq(__sheets[SHEET.TICKETS]._data[100][0], 'KS-0100', 'ticket 100 is on row 101');
eq(__sheets[SHEET.TICKETS]._data[51][1], TICKET_STATUS.AVAILABLE, 'and is for sale');
eq(__sheets[SHEET.TICKETS]._data[51][2], 'Book-006', 'in the right book');
eq(__sheets[SHEET.BOOKS]._data[6][0], 'Book-006', 'book six exists');
eq(__sheets[SHEET.BOOKS]._data[6][1], 'KS-0051', 'starting at 51');
eq(__sheets[SHEET.BOOKS]._data[6][2], 'KS-0060', 'ending at 60');
eq(__sheets[SHEET.BOOKS]._data[6][3], BOOK_STATUS.UNASSIGNED, 'and is on the shelf');

// a new ticket is a real ticket, reachable the ordinary way
eq(ticketIndex('KS-0100', getConfig()), 100, 'the last new ticket resolves');
eq(bookOfTicket('KS-0100', getConfig()), 'Book-010', 'and knows its book');

// ============ 8. the lock is left in a working state ============
console.log('the numbering lock still passes afterwards');
eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'writes are not blocked after a sanctioned expand');
ok(__props.NUMBERING_FINGERPRINT.indexOf('TOTAL_TICKETS=100') !== -1, 'the fingerprint records the new total');

// and an unsanctioned edit is still caught
const cs = __sheets[SHEET.CONFIG];
for (let i = 1; i < cs._data.length; i++) if (cs._data[i][0] === 'TICKET_PREFIX') cs._data[i][1] = 'ZZ-';
invalidateConfigCache(); global.__clearCache();
eq(codeOf(() => assertNumberingUnchanged_()), 'NUMBERING_CHANGED', 'a hand-edited prefix is still refused');

// ============ 9. it can be run twice ============
console.log('and again, from 100 to 120');
world(50);
go({ totalTickets: 100, dryRun: false, confirm: '100' });
go({ totalTickets: 120, dryRun: false, confirm: '120' });
eq(getConfig().TOTAL_TICKETS, '120', 'the second raise landed');
eq(__sheets[SHEET.TICKETS]._data.length - 1, 120, '120 ticket rows');
eq(__sheets[SHEET.BOOKS]._data.length - 1, 12, '12 book rows');
eq(__sheets[SHEET.TICKETS]._data[120][0], 'KS-0120', 'the last one is right');
eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'and the lock is still happy');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
