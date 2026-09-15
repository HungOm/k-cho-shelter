/*
 * Tolerant in, canonical out.
 *
 * ticketIndex and bookIndex accept what a person would reasonably type:
 * "KS-3721" plainly means KS-03721. The bug this file pins is what happened
 * next — the parsed value was used to decide the input was VALID, and then the
 * unparsed input was used to MATCH. Those two disagree for anything missing a
 * leading zero, and the disagreement was silent every time.
 *
 * Three consequences, in rising order of seriousness:
 *   - a lookup missed and logged SCHEMA_DRIFT, an alarm meaning "the sheet has
 *     been re-sorted", on a sheet in perfect order
 *   - a book range resolved to nothing and reported the book missing
 *   - a ticket the agent had handed back was marked SOLD, and its price added
 *     to what they owed
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

const admin = { email: 'admin@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, agentId: '', displayName: 'Admin' };

let T, tm, B, bm;
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  // Five digits and four, so a dropped leading zero is possible — the live shape.
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '5'], ['TOTAL_TICKETS', '50'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '4'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  tm = headerMap(T);
  for (let i = 1; i <= 50; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = 'KS-' + String(i).padStart(5, '0');
    row[tm.Status - 1] = TICKET_STATUS.AVAILABLE;
    row[tm.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(4, '0');
    row[tm.Version - 1] = 1;
    T._data.push(row);
  }

  B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  bm = headerMap(B);
  for (let b = 1; b <= 5; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = 'Book-' + String(b).padStart(4, '0');
    row[bm.First_Ticket - 1] = 'KS-' + String((b - 1) * 10 + 1).padStart(5, '0');
    row[bm.Last_Ticket - 1] = 'KS-' + String(b * 10).padStart(5, '0');
    row[bm.Status - 1] = BOOK_STATUS.OUT;
    row[bm.Held_By_Agent - 1] = 'A001';
    row[bm.Version - 1] = 1;
    B._data.push(row);
  }

  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  const A = __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  A.appendRow(['A001', 'John', '0123456789', '', 'TRUE', '']);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
}

const auditText = () => __sheets[SHEET.AUDIT]._data.map(r => JSON.stringify(r)).join(' ');

// ============ 1. the lookup finds it, and stays quiet ============
console.log('a dropped leading zero still resolves');
{
  world();
  const cfg = getConfig();

  eq(findTicketRow(__sheets[SHEET.TICKETS], 'KS-00007', cfg), 8, 'canonical form found');
  eq(findTicketRow(__sheets[SHEET.TICKETS], 'KS-7', cfg), 8, 'unpadded form found too');
  eq(findTicketRow(__sheets[SHEET.TICKETS], 'ks-7', cfg), 8, 'lower case found too');
  eq(findTicketRow(__sheets[SHEET.TICKETS], '  KS-7  ', cfg), 8, 'and with stray spaces');

  eq(findBookRow(__sheets[SHEET.BOOKS], 'Book-0003', cfg), 4, 'canonical book found');
  eq(findBookRow(__sheets[SHEET.BOOKS], 'Book-3', cfg), 4, 'unpadded book found');

  // The alarm must not have fired. This is the whole point.
  ok(auditText().indexOf('SCHEMA_DRIFT') === -1,
    'no SCHEMA_DRIFT logged for a well-ordered sheet');

  // And a genuinely absent ticket still returns nothing, quietly.
  eq(findTicketRow(__sheets[SHEET.TICKETS], 'KS-99999', cfg), 0, 'a ticket outside the raffle is not found');
  eq(findTicketRow(__sheets[SHEET.TICKETS], 'rubbish', cfg), 0, 'nonsense is not found');
}

// ============ 2. SCHEMA_DRIFT still fires when it should ============
console.log('the alarm still works');
{
  world();
  const cfg = getConfig();
  // Genuinely move a row out of position, which is what the alarm is for.
  const moved = T._data[7];        // KS-00007, the one we then look up
  T._data.splice(7, 1);
  T._data.push(moved);

  const row = findTicketRow(__sheets[SHEET.TICKETS], 'KS-7', cfg);
  ok(row > 0, 'the ticket is still found by scanning');
  ok(auditText().indexOf('SCHEMA_DRIFT') !== -1,
    'and a genuinely displaced row does log SCHEMA_DRIFT');
}

// ============ 3. the money bug ============
console.log('settlement counts a handed-back ticket as unsold');
{
  world();
  // Book-0001 holds KS-00001..KS-00010. Two came back, typed without padding.
  const r = handleSettleBook({
    bookNumber: 'Book-0001',
    unsoldTickets: ['KS-3', 'KS-7'],
    amountPaid: 80
  }, admin);

  eq(r.declaredSold, 8, 'eight sold, not ten');
  eq(r.amountDue, 80, 'and the agent owes for eight');
  eq(r.variance, 0, 'so the cash reconciles');

  eq(T._data[3][tm.Status - 1], TICKET_STATUS.AVAILABLE, 'KS-00003 is back on the shelf');
  eq(T._data[7][tm.Status - 1], TICKET_STATUS.AVAILABLE, 'KS-00007 is back on the shelf');
  eq(T._data[1][tm.Status - 1], TICKET_STATUS.SOLD, 'the rest of the book is sold');
  eq(T._data[10][tm.Status - 1], TICKET_STATUS.SOLD, 'including the last one');

  // The padded spelling must behave identically.
  world();
  const r2 = handleSettleBook({
    bookNumber: 'Book-0001',
    unsoldTickets: ['KS-00003', 'KS-00007'],
    amountPaid: 80
  }, admin);
  eq(r2.declaredSold, 8, 'padded input gives the same answer');
  eq(r2.amountDue, 80, 'and the same amount due');

  // Mixed spellings in one list.
  world();
  eq(handleSettleBook({ bookNumber: 'Book-0001',
    unsoldTickets: ['KS-3', 'KS-00007'], amountPaid: 80 }, admin).declaredSold, 8,
    'a mixed list works too');
}

// ============ 4. book ranges resolve either way ============
console.log('book ranges');
{
  world();
  const cfg = getConfig();
  eq(expandBookRange_({ fromBook: 'Book-0002', toBook: 'Book-0004' }, cfg).join(','),
    'Book-0002,Book-0003,Book-0004', 'a padded range');
  eq(expandBookRange_({ fromBook: 'Book-2', toBook: 'Book-4' }, cfg).join(','),
    'Book-0002,Book-0003,Book-0004', 'an unpadded range returns canonical numbers');
  eq(expandBookRange_({ bookNumbers: ['Book-2', 'Book-0004'] }, cfg).join(','),
    'Book-0002,Book-0004', 'a mixed explicit list is canonicalised');

  // And that canonical list actually matches the sheet when used.
  world();
  const issued = handleIssueBooks({ agentId: 'A001', fromBook: 'Book-2', toBook: 'Book-3',
    force: true }, admin);
  eq(issued.issued, 2, 'issuing by unpadded numbers works');
  eq(issued.books.join(','), 'Book-0002,Book-0003', 'and reports canonical numbers back');
}

// ============ 5. no tolerant parse is left comparing raw input ============
console.log('the pattern does not survive anywhere else');
{
  const sources = ['Config.gs', 'Books.gs', 'Tickets.gs'].map(f => fs.readFileSync(path + f, 'utf8'));
  const joined = sources.join('\n');

  // Every place that parses must use the parsed index to build the key it
  // compares or stores — never the caller's string.
  ok(!/scanForKey_\(sheet,\s*(ticketNumber|bookNumber),/.test(joined),
    'scanForKey_ is never handed the raw input');
  ok(!/probe\.toUpperCase\(\) === String\((ticketNumber|bookNumber)\)/.test(joined),
    'no fast path compares against the raw input');
  ok(!/unsoldSet\[un\] = true/.test(joined),
    'the unsold set is not keyed by the raw input');
  ok(/unsoldSet\[ticketNumberAt\(uIdx, cfg\)\] = true/.test(joined),
    'it is keyed by the canonical number');
  ok(/list\.push\(bookNumberAt\(nIdx, cfg\)\)/.test(joined),
    'explicit book lists are canonicalised');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
