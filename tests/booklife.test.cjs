/*
 * A book's life, and the record of it.
 *
 * The question behind these tests: a book brought back should be available to
 * give out again — but not at the cost of losing what the person who had it
 * still owes. Restocking clears Held_By_Agent, and the outstanding report finds
 * debts by looking at who holds a book, so restocking an unsettled book with
 * sales on it takes a real debt off the chase list with nothing left to show it.
 *
 * The rule these tests pin down: owing nothing restocks freely, owing something
 * has to be settled first.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const admin = { email: 'admin@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, agentId: '', displayName: 'Admin' };
const viewer = { email: 'v@x.com', role: 'viewer', isAdmin: false, isSuperAdmin: false, active: true, agentId: '', displayName: 'V' };

let T, tm, B, bm;
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '50'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  tm = headerMap(T);
  for (let i = 1; i <= 50; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = 'KS-' + String(i).padStart(4, '0');
    row[tm.Status - 1] = TICKET_STATUS.AVAILABLE;
    row[tm.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0');
    row[tm.Version - 1] = 1;
    T._data.push(row);
  }

  B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  bm = headerMap(B);
  for (let b = 1; b <= 5; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = 'Book-' + String(b).padStart(3, '0');
    row[bm.First_Ticket - 1] = 'KS-' + String((b - 1) * 10 + 1).padStart(4, '0');
    row[bm.Last_Ticket - 1] = 'KS-' + String(b * 10).padStart(4, '0');
    row[bm.Status - 1] = BOOK_STATUS.UNASSIGNED;
    row[bm.Version - 1] = 1;
    B._data.push(row);
  }

  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  const A = __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  const am = headerMap(A);
  [['A001', 'Daw Hla'], ['A002', 'U Kyaw']].forEach(([id, name]) => {
    const r = new Array(COLS.AGENTS.length).fill('');
    r[am.Agent_ID - 1] = id; r[am.Name - 1] = name; r[am.Active - 1] = true;
    A._data.push(r);
  });
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
}

const book = n => B._data[n];   // row index == book number for this fixture

// ============ 1. the ordinary case: came back untouched ============
console.log('a book that came back untouched goes straight back on the shelf');
{
  world();
  handleIssueBooks({ fromBook: 'Book-001', agentId: 'A001', note: 'Sunday service' }, admin);
  handleReturnBooks({ fromBook: 'Book-001', note: 'Did not manage to sell any' }, admin);
  eq(book(1)[bm.Status - 1], BOOK_STATUS.RETURNED, 'it is back');

  // Nothing was sold, so nothing is owed, so nothing blocks it.
  const r = handleRestockBooks({ fromBook: 'Book-001' }, admin);
  eq(r.restocked, 1, 'restocked without needing settlement first');
  eq(book(1)[bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'available again');
  eq(book(1)[bm.Held_By_Agent - 1], '', 'nobody holds it');

  // And it can genuinely be given out again — the point of the whole exercise.
  const again = handleIssueBooks({ fromBook: 'Book-001', agentId: 'A002' }, admin);
  eq(again.issued, 1, 'issued to somebody else');
  eq(book(1)[bm.Held_By_Agent - 1], 'A002', 'now held by the new seller');
}

// ============ 2. the case that protects the money ============
console.log('a book with unpaid sales on it must be settled first');
{
  world();
  handleIssueBooks({ fromBook: 'Book-002', agentId: 'A001' }, admin);
  // Three sold, nothing handed in yet.
  handleSellTicket({ ticketNumber: 'KS-0011', buyerName: 'Ma Nu', buyerPhone: '0125550100', agentId: 'A001' }, admin);
  handleSellTicket({ ticketNumber: 'KS-0012', buyerName: 'Ko Zaw', buyerPhone: '0125550101', agentId: 'A001' }, admin);
  handleSellTicket({ ticketNumber: 'KS-0013', buyerName: 'Ma Aye', buyerPhone: '0125550102', agentId: 'A001' }, admin);
  handleReturnBooks({ fromBook: 'Book-002' }, admin);

  eq(codeOf(() => handleRestockBooks({ fromBook: 'Book-002' }, admin)), 'MONEY_STILL_OWED',
     'refused while RM 30 is unaccounted for');
  eq(book(2)[bm.Status - 1], BOOK_STATUS.RETURNED, 'and nothing was changed');

  // The refusal says which book and how much, so it can be acted on.
  let detail = null;
  try { handleRestockBooks({ fromBook: 'Book-002' }, admin); } catch (e) { detail = e.details; }
  ok(detail && detail.books && detail.books.length === 1, 'the refusal names the book');
  eq(detail.books[0].owed, 30, 'and says how much is owed');
  eq(detail.books[0].agent, 'Daw Hla', 'and who owes it, by name');

  // Settle it — three sold, RM 30 handed in — and now it may go back.
  handleSettleBook({ bookNumber: 'Book-002', unsoldTickets: ['KS-0014','KS-0015','KS-0016','KS-0017','KS-0018','KS-0019','KS-0020'],
                     amountPaid: 30, note: 'Paid in full at the office' }, admin);
  const r = handleRestockBooks({ fromBook: 'Book-002' }, admin);
  eq(r.restocked, 1, 'restocked once it was settled and paid');
  eq(book(2)[bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'back on the shelf');

  // The sold tickets stay sold — somebody paid for those and may yet win.
  eq(T._data[11][tm.Status - 1], TICKET_STATUS.SOLD, 'sold ticket untouched by restocking');
  eq(T._data[11][tm.Buyer_Name - 1], 'Ma Nu', 'and the buyer can still be telephoned');
}

// ============ 3. settled but only part paid ============
console.log('a part-paid settlement is still money owed');
{
  world();
  handleIssueBooks({ fromBook: 'Book-003', agentId: 'A001' }, admin);
  handleSellTicket({ ticketNumber: 'KS-0021', buyerName: 'Ma Nu', buyerPhone: '0125550100', agentId: 'A001' }, admin);
  handleSellTicket({ ticketNumber: 'KS-0022', buyerName: 'Ko Zaw', buyerPhone: '0125550101', agentId: 'A001' }, admin);
  handleReturnBooks({ fromBook: 'Book-003' }, admin);
  handleSettleBook({ bookNumber: 'Book-003',
                     unsoldTickets: ['KS-0023','KS-0024','KS-0025','KS-0026','KS-0027','KS-0028','KS-0029','KS-0030'],
                     amountPaid: 10, note: 'Only half handed in' }, admin);

  // RM 20 due, RM 10 in. Restocking here would quietly erase the RM 10 still out.
  eq(codeOf(() => handleRestockBooks({ fromBook: 'Book-003' }, admin)), 'MONEY_STILL_OWED',
     'a part-paid book is not finished with');
}

// ============ 4. a range is all-or-nothing ============
console.log('one owing book blocks the whole range');
{
  world();
  handleIssueBooks({ fromBook: 'Book-001', toBook: 'Book-003', agentId: 'A001' }, admin);
  handleSellTicket({ ticketNumber: 'KS-0021', buyerName: 'Ma Nu', buyerPhone: '0125550100', agentId: 'A001' }, admin);
  handleReturnBooks({ fromBook: 'Book-001', toBook: 'Book-003' }, admin);

  eq(codeOf(() => handleRestockBooks({ fromBook: 'Book-001', toBook: 'Book-003' }, admin)), 'MONEY_STILL_OWED',
     'the range is refused');
  eq(book(1)[bm.Status - 1], BOOK_STATUS.RETURNED, 'the clean book was not restocked either');
  eq(book(2)[bm.Status - 1], BOOK_STATUS.RETURNED, 'nor the second');
  // All or nothing, deliberately: a partial restock over a range leaves the
  // operator unsure which books actually moved.
}

// ============ 5. the history is readable, and says why ============
console.log('a book history that can actually be read');
{
  world();
  handleIssueBooks({ fromBook: 'Book-004', agentId: 'A001', note: 'For the Sunday service' }, admin);
  handleTransferBooks({ fromBook: 'Book-004', toAgentId: 'A002', note: 'Daw Hla went to Yangon' }, admin);
  handleReturnBooks({ fromBook: 'Book-004', note: 'Brought back unsold' }, admin);

  const h = handleBookHistory({ bookNumber: 'Book-004' }, viewer);
  eq(h.book.number, 'Book-004', 'the book it is about');
  eq(h.history.length, 3, 'three movements recorded');

  eq(h.history[0].action, 'issue', 'first it went out');
  eq(h.history[0].to, 'Daw Hla', 'to a person, by name — not an agent id');
  eq(h.history[0].note, 'For the Sunday service', 'and why');

  eq(h.history[1].action, 'transfer', 'then it was passed on');
  eq(h.history[1].from, 'Daw Hla', 'from one name');
  eq(h.history[1].to, 'U Kyaw', 'to another');
  eq(h.history[1].note, 'Daw Hla went to Yangon', 'with the reason');

  eq(h.history[2].action, 'return', 'then it came back');
  eq(h.history[2].note, 'Brought back unsold', 'with the reason');

  // Typed short, found anyway — the same tolerance every other book action has.
  eq(handleBookHistory({ bookNumber: 'Book-4' }, viewer).history.length, 3, 'Book-4 finds Book-004');
  eq(codeOf(() => handleBookHistory({ bookNumber: 'Book-999' }, viewer)), 'BOOK_NOT_FOUND', 'unknown book refused');
  eq(codeOf(() => handleBookHistory({}, viewer)), 'MISSING_FIELD', 'no book named at all');
}

// ============ 6. restocking is itself a history point ============
console.log('the restock is recorded, with the figures it cleared');
{
  world();
  handleIssueBooks({ fromBook: 'Book-005', agentId: 'A001' }, admin);
  handleReturnBooks({ fromBook: 'Book-005' }, admin);
  handleRestockBooks({ fromBook: 'Book-005' }, admin);

  const h = handleBookHistory({ bookNumber: 'Book-005' }, viewer);
  eq(h.history.length, 3, 'issue, return, restock');
  eq(h.history[2].action, 'restock', 'the restock is on the record');
  ok(String(h.history[2].note).indexOf('was sold') !== -1,
     'and it snapshots the figures it cleared, so settlement history is not lost');

  // The whole point: after all that, the book is available again.
  eq(h.book.status, BOOK_STATUS.UNASSIGNED, 'and the book is free to give out');
}

// ============ 7. the history is a read, open to anyone signed in ============
console.log('who may read a history');
{
  const spec = actionRegistry().book_history;
  ok(spec, 'book_history is registered');
  eq(spec.kind, 'read', 'it is a read');
  eq(spec.roles, null, 'open to anyone signed in — agent names and dates, no buyer details');
  ok(isActionAllowed_('book_history', spec, viewer), 'a viewer may read it');
  ok(isActionAllowed_('book_history', spec, admin), 'so may an organiser');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
