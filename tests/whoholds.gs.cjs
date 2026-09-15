/*
 * The Apps Script half of whoholds.test.mjs.
 *
 * Separate file because the .gs sources are eval'd into a CommonJS global
 * scope and the Supabase modules are ESM; mixing them in one process means the
 * .gs globals shadow things the other half needs. The ESM file runs this one
 * and folds the counts in, so `node whoholds.test.mjs` still reports one total.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = (fn) => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const admin    = { email: 'admin@x.com', role: 'admin',    isAdmin: true,  isSuperAdmin: false, active: true, agentId: '',     displayName: 'Admin' };
const recorder = { email: 'r@x.com',     role: 'recorder', isAdmin: false, isSuperAdmin: false, active: true, agentId: '',     displayName: 'R' };
const agentA   = { email: 'a@x.com',     role: 'agent',    isAdmin: false, isSuperAdmin: false, active: true, agentId: 'A001', displayName: 'Daw Hla' };
const agentB   = { email: 'k@x.com',     role: 'agent',    isAdmin: false, isSuperAdmin: false, active: true, agentId: 'A002', displayName: 'U Kyaw' };

let T, tm, B, bm;
/** Same four books as the Supabase half: Out, Unassigned, Returned, Lost. */
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '40'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  tm = headerMap(T);
  for (let i = 1; i <= 40; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = 'KS-' + String(i).padStart(4, '0');
    row[tm.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0');
    row[tm.Status - 1] = TICKET_STATUS.AVAILABLE;
    row[tm.Version - 1] = 1;
    T._data.push(row);
  }

  B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  bm = headerMap(B);
  [[1, BOOK_STATUS.OUT, 'A001'], [2, BOOK_STATUS.UNASSIGNED, ''],
   [3, BOOK_STATUS.RETURNED, 'A001'], [4, BOOK_STATUS.LOST, '']].forEach(([b, st, held]) => {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = 'Book-' + String(b).padStart(3, '0');
    row[bm.First_Ticket - 1] = 'KS-' + String((b - 1) * 10 + 1).padStart(4, '0');
    row[bm.Last_Ticket - 1] = 'KS-' + String(b * 10).padStart(4, '0');
    row[bm.Status - 1] = st;
    row[bm.Held_By_Agent - 1] = held;
    row[bm.Version - 1] = 1;
    B._data.push(row);
  });

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

// expectedVersion is required of everyone but an admin, and every fixture row
// starts at 1, so it is supplied rather than threaded through each call.
const sell = (num, user, extra) => handleSellTicket(
  Object.assign({ ticketNumber: num, buyerName: 'Ma Nu', buyerPhone: '0125550100', expectedVersion: 1 },
                extra || {}), user);
/** _data[0] is the header row, so ticket i sits at _data[i]. */
const ticketRow = (i) => T._data[i];

console.log('a helper cannot sell out of a book that is with a seller');
{
  world();
  const e = errOf(() => sell('KS-0001', recorder));
  eq(e && e.code, 'BOOK_WITH_SELLER', 'refused');
  ok(e && /Daw Hla/.test(e.message), 'it says who has the book');
  ok(e && /Book-001/.test(e.message), 'and which book');
  ok(e && /returned/i.test(e.message), 'and how to make it sellable');
  eq(ticketRow(1)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'and nothing was written');
}

console.log('the same helper sells freely from the books that are here');
{
  world();
  sell('KS-0011', recorder);
  eq(ticketRow(11)[tm.Status - 1], TICKET_STATUS.SOLD, 'a book on the shelf sells');
  sell('KS-0021', recorder);
  eq(ticketRow(21)[tm.Status - 1], TICKET_STATUS.SOLD, 'and one that has been handed back');
}

console.log('the seller holding the book can sell from it');
{
  world();
  sell('KS-0002', agentA);
  eq(ticketRow(2)[tm.Status - 1], TICKET_STATUS.SOLD, 'their own book is theirs to sell');
  world();
  eq(codeOf(() => sell('KS-0002', agentB)), 'NOT_YOUR_BOOK',
     'another seller is refused as not-your-book');
}

console.log('an organiser may write down what the seller reported');
{
  world();
  sell('KS-0003', admin);
  eq(ticketRow(3)[tm.Status - 1], TICKET_STATUS.SOLD, 'transcription keeps working');
  eq(ticketRow(3)[tm.Sold_By_Agent - 1], 'A001', 'credited to whoever holds the book');
}

console.log('and cannot quietly credit the sale to somebody else');
{
  world();
  sell('KS-0004', admin, { agentId: 'A002' });
  eq(ticketRow(4)[tm.Sold_By_Agent - 1], 'A001',
     'the holder is credited, not the agent named in the request');
  world();
  sell('KS-0012', admin, { agentId: 'A002' });
  eq(ticketRow(12)[tm.Sold_By_Agent - 1], 'A002',
     'but a book on the shelf credits whoever the request names');
}

console.log('an Out book with nobody recorded is refused, even to an organiser');
{
  world();
  B._data[1][bm.Held_By_Agent - 1] = '';   // _data[0] is the header
  global.__clearCache();
  eq(codeOf(() => sell('KS-0005', admin)), 'BOOK_WITH_SELLER', 'out with nobody is not a licence');
}

console.log('the rule is about claiming a ticket, not about touching the row');
{
  world();
  sell('KS-0006', agentA);
  const fixed = handleCorrectTicket(
    { ticketNumber: 'KS-0006', Buyer_Name: 'Ma Nu Corrected', reason: 'spelling', expectedVersion: 2 }, recorder);
  ok(fixed && fixed.ticketNumber === 'KS-0006', 'a helper can still correct a sale in that book');

  world();
  handleReserveTicket({ ticketNumber: 'KS-0007', buyerName: 'Ma Nu', expectedVersion: 1 }, agentA);
  const freed = handleReleaseTicket({ ticketNumber: 'KS-0007', expectedVersion: 2 }, recorder);
  eq(freed.status, TICKET_STATUS.AVAILABLE, 'and can still release a hold on it');
}

console.log('holding a ticket for somebody is claiming it too');
{
  world();
  eq(codeOf(() => handleReserveTicket({ ticketNumber: 'KS-0008', buyerName: 'Ma Nu', expectedVersion: 1 }, recorder)),
     'BOOK_WITH_SELLER', 'a helper cannot hold a ticket out of a seller\'s book');
}

console.log('a lost book is closed to everyone');
{
  world();
  eq(codeOf(() => sell('KS-0031', admin)), 'BOOK_CLOSED', 'lost sits with settled and void');
  world();
  eq(codeOf(() => sell('KS-0031', recorder)), 'BOOK_CLOSED', 'for a helper as well');
}

console.log('selling a whole book obeys the same rule');
{
  // The one that had no check at all: until today sell_book asked only whether
  // the book existed, so a helper could sell Book-001 entire while it sat in
  // Daw Hla's bag.
  world();
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, recorder)),
     'BOOK_WITH_SELLER', 'a helper cannot sell a book that is out with somebody');
  eq(ticketRow(1)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'and not one ticket was written');

  world();
  const r = handleSellBook({ fromBook: 'Book-002', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, recorder);
  eq(r.sold, 10, 'a book on the shelf sells whole');
}

console.log('a batch of stubs obeys it as well');
{
  world();
  const e = errOf(() => handleBulkRecordSales({ sales: [
    { ticketNumber: 'KS-0011', buyerName: 'A', buyerPhone: '0125550100' },
    { ticketNumber: 'KS-0001', buyerName: 'B', buyerPhone: '0125550101' },
  ] }, recorder));
  eq(e && e.code, 'BATCH_REJECTED', 'a batch reaching into a seller\'s book is rejected');
  ok(e && JSON.stringify(e.details).indexOf('BOOK_WITH_SELLER') !== -1, 'naming the reason');
  eq(ticketRow(11)[tm.Status - 1], TICKET_STATUS.AVAILABLE,
     'and the good row in that batch is not written either');

  // The organiser typing the same pile in is exactly what this screen is for.
  world();
  const okRes = handleBulkRecordSales({ sales: [
    { ticketNumber: 'KS-0001', buyerName: 'B', buyerPhone: '0125550101' },
  ] }, admin);
  eq(okRes.recorded, 1, 'an organiser transcribing the seller\'s pile is fine');
  eq(ticketRow(1)[tm.Sold_By_Agent - 1], 'A001', 'and it is credited to the seller');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
