/*
 * The Apps Script half of money.test.mjs.
 *
 * Separate file because the .gs sources are eval'd into a CommonJS global scope
 * and the Supabase modules are ESM. The ESM file runs this one and folds the
 * counts in, so `node money.test.mjs` still reports one total.
 *
 * Not a re-test of the logic — a check that the two backends have not drifted
 * on the three things that would be silent if they did: who may see whose
 * money, that cash can be recorded without closing a book, and that undoing
 * leaves both rows behind.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const boss     = { email: 'boss@x.com',  role: 'admin',    isAdmin: true,  isSuperAdmin: true,  agentId: '',     active: true, displayName: 'Boss' };
const helper   = { email: 'r@x.com',     role: 'recorder', isAdmin: false, isSuperAdmin: false, agentId: '',     active: true, displayName: 'R' };
const sellerH  = { email: 'rh@x.com',    role: 'recorder', isAdmin: false, isSuperAdmin: false, agentId: 'A001', active: true, displayName: 'RH' };
const seller   = { email: 'a@x.com',     role: 'agent',    isAdmin: false, isSuperAdmin: false, agentId: 'A001', active: true, displayName: 'Daw Hla' };
const viewer   = { email: 'v@x.com',     role: 'viewer',   isAdmin: false, isSuperAdmin: false, agentId: '',     active: true, displayName: 'V' };

/** Two sellers, a book each; ten tickets sold in one, five in the other. */
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const base = {
    TICKET_PREFIX: 'KS-', TICKET_START: '1', TICKET_DIGITS: '4', TOTAL_TICKETS: '20',
    TICKETS_PER_BOOK: '10', BOOK_PREFIX: 'Book-', BOOK_DIGITS: '3', TICKET_PRICE: '10',
    CURRENCY: 'RM', DEFAULT_DUE_DAYS: '30'
  };
  for (const k in base) __sheets[SHEET.CONFIG].appendRow([k, base[k], '']);

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  const tm = { Ticket_Number: 1, Status: 2, Book_Number: 3, Amount: 8, Payment_Status: 9, Sold_By_Agent: 7 };
  for (let i = 1; i <= 20; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[0] = ticketNumberAt(i, cfg);
    row[2] = bookNumberAt(Math.ceil(i / 10), cfg);
    // Ten sold in book one, five in book two.
    const sold = i <= 10 || (i > 10 && i <= 15);
    row[1] = sold ? TICKET_STATUS.SOLD : TICKET_STATUS.AVAILABLE;
    if (sold) {
      row[6] = i <= 10 ? 'A001' : 'A002';
      row[7] = 10;
      row[8] = 'Paid';
    }
    row[12] = 1;
    T.appendRow(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for (let b = 1; b <= 2; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[0] = bookNumberAt(b, cfg);
    row[1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    row[2] = ticketNumberAt(b * 10, cfg);
    row[3] = BOOK_STATUS.OUT;
    row[4] = b === 1 ? 'A001' : 'A002';
    row[13] = 1;
    B.appendRow(row);
  }
  const A = __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  A.appendRow(['A001', 'Daw Hla', '0125551111', 'KL', true, '']);
  A.appendRow(['A002', 'U Kyaw', '0125552222', 'Klang', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
}

const lineFor = (id, user) => {
  const r = handleReportOutstanding({}, user || boss);
  return r.agents.filter(x => x.agentId === id)[0];
};

console.log('the scope rule, stated once');
{
  world();
  eq(moneyScope_(boss), 'all', 'an organiser sees every seller');
  eq(moneyScope_(seller), 'mine', 'a seller sees their own line');
  eq(moneyScope_(sellerH), 'mine', 'so does a helper who also carries books');
  eq(moneyScope_(helper), 'totals', 'a helper carrying nothing gets totals, not names');
  eq(moneyScope_(viewer), 'totals', 'and so does a viewer');
  eq(visibleAgents_(boss), null, 'null means everybody');
  eq(JSON.stringify(visibleAgents_(seller)), '["A001"]', 'a seller: only themselves');
  eq(JSON.stringify(visibleAgents_(helper)), '[]', 'a helper with no books: nobody');
}

console.log('and the report obeys it');
{
  world();
  eq(handleReportOutstanding({}, boss).agents.length, 2, 'an organiser sees both sellers');
  const mine = handleReportOutstanding({}, seller);
  eq(mine.agents.length, 1, 'a seller sees one line');
  eq(mine.agents[0].agentId, 'A001', 'their own');
  eq(handleReportOutstanding({}, helper).agents.length, 0, 'a helper holding nothing sees no names');
  eq(handleReportOutstanding({}, viewer).agents.length, 0, 'nor does a viewer');
  eq(handleReportOutstanding({}, viewer).scope, 'totals', 'and is told why');
}

console.log('money can be handed in without closing a book');
{
  world();
  const r = handleRecordPayment({ agentId: 'A001', amount: 40, note: 'at the hall' }, boss);
  eq(r.amount, 40, 'recorded');
  eq(r.stillOwed, 60, 'and what is left is worked out, not guessed');
  eq(readPaymentsRaw_().length, 1, 'one ledger row');
  eq(String(__sheets[SHEET.BOOKS].getRange(2, 4).getValue()), BOOK_STATUS.OUT,
    'the book is untouched — recording cash is not settling');
  eq(lineFor('A001').collected, 40, 'handed in reflects the part payment');
  eq(lineFor('A001').outstanding, 60, 'and so does what they owe');
}

console.log('what recording refuses');
{
  world();
  eq(codeOf(() => handleRecordPayment({ amount: 10 }, boss)), 'MISSING_FIELD',
    'somebody has to have handed it in');
  eq(codeOf(() => handleRecordPayment({ agentId: 'A001' }, boss)), 'MISSING_FIELD',
    'and an amount is required');
  eq(codeOf(() => handleRecordPayment({ agentId: 'A001', amount: 0 }, boss)), 'MISSING_FIELD',
    'zero is not a payment');
  eq(codeOf(() => handleRecordPayment({ agentId: 'A001', amount: -5 }, boss)), 'MISSING_FIELD',
    'and a negative is a reversal, which has its own door');
  eq(codeOf(() => handleRecordPayment({ agentId: 'A404', amount: 10 }, boss)), 'AGENT_NOT_FOUND',
    'the seller has to exist');
  eq(codeOf(() => handleRecordPayment({ agentId: 'A001', amount: 10, bookNumber: 'Book-999' }, boss)),
    'BOOK_NOT_FOUND', 'and a named book has to exist');
}

console.log('a helper cannot record money against somebody else');
{
  world();
  eq(codeOf(() => handleRecordPayment({ agentId: 'A002', amount: 10 }, sellerH)), 'NOT_AUTHORIZED',
    'recording for another seller changes what THEY are shown as owing');
  eq(handleRecordPayment({ agentId: 'A001', amount: 10 }, sellerH).amount, 10,
    'but their own is theirs to write down');
}

console.log('undoing is a new row, never a delete');
{
  world();
  const made = handleRecordPayment({ agentId: 'A001', amount: 40 }, boss);
  eq(codeOf(() => handleReversePayment({ paymentId: made.paymentId }, boss)), 'MISSING_FIELD',
    'a reversal nobody can explain is worse than the mistake');

  const undone = handleReversePayment({ paymentId: made.paymentId, reason: 'wrong seller' }, boss);
  eq(undone.stillOwed, 100, 'the debt comes back');
  eq(readPaymentsRaw_().length, 2, 'BOTH rows survive — the trail keeps the mistake');
  eq(readPaymentsRaw_().filter(p => String(p.Reverses || ''))[0]._amount, -40,
    'the reversal is the negative of it');
  eq(codeOf(() => handleReversePayment({ paymentId: made.paymentId, reason: 'again' }, boss)),
    'NOTHING_TO_DO', 'and it cannot be reversed twice');
  eq(codeOf(() => handleReversePayment({ paymentId: 'nope', reason: 'x' }, boss)), 'NOT_FOUND',
    'nor can a payment that does not exist');
}

console.log('settling writes to the same ledger');
{
  world();
  handleSettleBook({ bookNumber: 'Book-001', amountPaid: 70, unsoldTickets: [] }, boss);
  const rows = readPaymentsRaw_();
  eq(rows.length, 1, 'the settlement recorded a handover');
  eq(rows[0].Source, 'settlement', 'marked as counted in with a book');
  eq(rows[0]._amount, 70, 'for what was actually handed over');

  world();
  handleRecordPayment({ agentId: 'A001', amount: 30 }, boss);
  handleSettleBook({ bookNumber: 'Book-001', amountPaid: 70, unsoldTickets: [] }, boss);
  eq(lineFor('A001').collected, 100,
    'a part payment and a settlement add up rather than replacing');
  eq(lineFor('A001').outstanding, 0, 'and the debt clears');
}

console.log('a seller is shown their own payments and nobody else\'s');
{
  world();
  handleRecordPayment({ agentId: 'A001', amount: 40 }, boss);
  handleRecordPayment({ agentId: 'A002', amount: 25 }, boss);

  const mine = handleListPayments({ agentId: 'A002' }, seller);
  eq(mine.agentId, 'A001', 'asking for another seller quietly returns your own');
  eq(mine.payments.length, 1, 'one row');
  eq(mine.payments[0].amount, 40, 'their own money');
  eq(handleListPayments({ agentId: 'A002' }, boss).payments[0].amount, 25,
    'an organiser may ask about anybody');
  eq(handleListPayments({ agentId: 'A001' }, helper).payments.length, 0,
    'a helper holding nothing is shown nothing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
