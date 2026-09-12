/*
 * Selling a whole book to one buyer.
 *
 * The thing that makes this worth having rather than dangerous is that it
 * writes a real buyer onto every ticket — so a winner drawn out of a book sale
 * can still be telephoned. The tests below are mostly about what it must NOT
 * overwrite.
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
const agentA = { email: 'a@x.com', role: 'agent', isAdmin: false, isSuperAdmin: false, active: true, agentId: 'A001', displayName: 'A' };
const agentB = { email: 'b@x.com', role: 'agent', isAdmin: false, isSuperAdmin: false, active: true, agentId: 'A002', displayName: 'B' };

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
    row[bm.Status - 1] = BOOK_STATUS.OUT;
    row[bm.Held_By_Agent - 1] = b <= 3 ? 'A001' : 'A002';
    row[bm.Version - 1] = 1;
    B._data.push(row);
  }

  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
}

const ticket = n => T._data[n];   // row index == ticket number for this fixture

// ============ 1. one book, one buyer ============
console.log('one book');
{
  world();
  const r = handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu', buyerPhone: '012 555 0100' }, admin);

  eq(r.sold, 10, 'all ten tickets sold');
  eq(r.amount, 100, 'at RM 10 each');
  eq(r.currency, 'RM', 'currency reported');
  eq(r.skipped.length, 0, 'nothing skipped');

  for (let i = 1; i <= 10; i++) {
    eq(ticket(i)[tm.Status - 1], TICKET_STATUS.SOLD, `ticket ${i} sold`);
    eq(ticket(i)[tm.Buyer_Name - 1], 'Ma Nu', `ticket ${i} carries the buyer`);
    eq(ticket(i)[tm.Amount - 1], 10, `ticket ${i} carries the price`);
  }
  // The phone is normalised once and written to every row.
  const phone = ticket(1)[tm.Buyer_Phone - 1];
  ok(String(phone).length >= 7, 'phone normalised and stored');
  for (let i = 2; i <= 10; i++) eq(ticket(i)[tm.Buyer_Phone - 1], phone, `ticket ${i} has the same phone`);

  eq(ticket(11)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'the next book is untouched');
  eq(ticket(1)[tm.Source - 1], 'book sale', 'the source says how it was recorded');
  eq(ticket(1)[tm.Version - 1], 2, 'version bumped');
}

// ============ 2. several books to one buyer ============
console.log('two books');
{
  world();
  const r = handleSellBook({ fromBook: 'Book-001', toBook: 'Book-002',
    buyerName: 'Pa Thang', buyerPhone: '0125550111' }, admin);
  eq(r.sold, 20, 'twenty tickets across two books');
  eq(r.amount, 200, 'and the money adds up');
  eq(r.books.length, 2, 'both books reported');
  eq(ticket(20)[tm.Buyer_Name - 1], 'Pa Thang', 'last ticket of book two carries the buyer');
  eq(ticket(21)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'book three untouched');

  // A named list works as well as a range.
  world();
  const r2 = handleSellBook({ bookNumbers: ['Book-001', 'Book-004'],
    buyerName: 'Ma Hlaing', buyerPhone: '0125550122' }, admin);
  eq(r2.sold, 20, 'two non-adjacent books');
  eq(ticket(31)[tm.Buyer_Name - 1], 'Ma Hlaing', 'book four sold');
  eq(ticket(11)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'book two skipped as asked');
}

// ============ 3. it never overwrites somebody else's sale ============
console.log('existing sales are not overwritten');
{
  world();
  ticket(3)[tm.Status - 1] = TICKET_STATUS.SOLD;
  ticket(3)[tm.Buyer_Name - 1] = 'Someone Else';
  ticket(3)[tm.Buyer_Phone - 1] = '0199999999';
  ticket(5)[tm.Status - 1] = TICKET_STATUS.VOID;

  const r = handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, admin);

  eq(r.sold, 8, 'the other eight sold');
  eq(r.skipped.length, 2, 'two reported as skipped');
  eq(ticket(3)[tm.Buyer_Name - 1], 'Someone Else', "the earlier buyer's name survives");
  eq(ticket(3)[tm.Buyer_Phone - 1], '0199999999', 'and their phone number');
  eq(ticket(5)[tm.Status - 1], TICKET_STATUS.VOID, 'the void ticket stays void');
  eq(ticket(5)[tm.Buyer_Name - 1], '', 'and gains no buyer');
  ok(r.skipped.some(s => s.reason === 'already sold'), 'says why it skipped the sold one');
  ok(r.skipped.some(s => s.reason === 'voided'), 'and why it skipped the void one');

  // A book with nothing left refuses rather than reporting a sale of zero.
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-001', buyerName: 'X', buyerPhone: '0125550100' }, admin)),
    'NOTHING_TO_DO', 'a fully sold book is refused');
}

// ============ 4. contact details are required, as everywhere else ============
console.log('buyer details required');
{
  world();
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-001', buyerPhone: '0125550100' }, admin)),
    'MISSING_FIELD', 'a name is required');
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu' }, admin)),
    'BAD_PHONE', 'a phone number is required');
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu', buyerPhone: '123' }, admin)),
    'BAD_PHONE', 'and it has to be long enough to ring');
  eq(ticket(1)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'nothing was written on a refusal');
}

// ============ 5. an agent can only sell their own books ============
console.log('book ownership');
{
  world();
  ok(handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, agentA).sold,
    'the agent holding Book-001 can sell it');

  world();
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-004', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, agentB)),
    'NO_THROW', 'the agent holding Book-004 can sell it');

  world();
  const code = codeOf(() => handleSellBook({ fromBook: 'Book-004', buyerName: 'Ma Nu', buyerPhone: '0125550100' }, agentA));
  ok(code !== 'NO_THROW', 'an agent cannot sell a book held by somebody else (' + code + ')');
  eq(ticket(31)[tm.Status - 1], TICKET_STATUS.AVAILABLE, 'and nothing was written');

  // Nothing is written when a later book in the range fails the check.
  world();
  const code2 = codeOf(() => handleSellBook({ fromBook: 'Book-001', toBook: 'Book-004',
    buyerName: 'Ma Nu', buyerPhone: '0125550100' }, agentA));
  ok(code2 !== 'NO_THROW', 'a range crossing into another agent is refused');
  eq(ticket(1)[tm.Status - 1], TICKET_STATUS.AVAILABLE,
    'and the books before the failure are untouched — checked before any write');
}

// ============ 6. donations, and the range cap ============
console.log('donations and limits');
{
  world();
  const r = handleSellBook({ fromBook: 'Book-001', buyerName: 'Ma Nu',
    buyerPhone: '0125550100', donated: true }, admin);
  eq(r.sold, 10, 'a donated book still records ten tickets');
  eq(r.amount, 0, 'but no money');
  eq(ticket(1)[tm.Status - 1], TICKET_STATUS.DONATED, 'marked donated');
  eq(ticket(1)[tm.Buyer_Name - 1], 'Ma Nu', 'and still carries who has it');

  world();
  eq(codeOf(() => handleSellBook({ bookNumbers: new Array(21).fill('Book-001'),
    buyerName: 'X', buyerPhone: '0125550100' }, admin)),
    'RANGE_TOO_LARGE', 'more than twenty books at once is refused');
}

// ============ 7. registered so the right people can reach it ============
console.log('registry');
{
  const reg = actionRegistry();
  ok(reg['sell_book'], 'sell_book is registered');
  eq(reg['sell_book'].kind, 'bulk', 'counted as a bulk action for rate limiting');
  ok(reg['sell_book'].lock, 'takes the write lock');
  ok(!reg['sell_book'].sup, 'not super-admin-only — it is an ordinary sale');
  ok(reg['sell_book'].roles.indexOf(ROLES.AGENT) !== -1, 'an agent may use it');
  ok(reg['sell_book'].roles.indexOf(ROLES.RECORDER) !== -1, 'a recorder may use it');
  eq(actionMeta()['sell_book'].group, 'Tickets', 'grouped for the access screen');
  ok(!approvalSummaryFor_('sell_book', { fromBook: 'Book-001', toBook: 'Book-020' }),
    'selling never needs a second person — it is additive');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
