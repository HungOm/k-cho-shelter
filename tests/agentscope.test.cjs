/*
 * What a seller is allowed to see.
 *
 * The gap these tests close: the wire carried every buyer's name and telephone
 * number to every signed-in seller — twenty thousand rows of it — because the
 * row was masked for viewers only. That made a seller more trusted with other
 * people's contact details than somebody deliberately given read-only access,
 * and most of those buyers are refugees.
 *
 * The rule: full detail on the books in their hands, number and status only on
 * everybody else's.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

const admin   = { email: 'admin@x.com', role: 'admin',    isAdmin: true,  isSuperAdmin: false, active: true, agentId: '',     displayName: 'Admin' };
const agentA  = { email: 'a@x.com',     role: 'agent',    isAdmin: false, isSuperAdmin: false, active: true, agentId: 'A001', displayName: 'Daw Hla' };
const viewer  = { email: 'v@x.com',     role: 'viewer',   isAdmin: false, isSuperAdmin: false, active: true, agentId: '',     displayName: 'V' };
const recorder= { email: 'r@x.com',     role: 'recorder', isAdmin: false, isSuperAdmin: false, active: true, agentId: '',     displayName: 'R' };

let T, tm, B, bm;
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '30'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  tm = headerMap(T);
  for (let i = 1; i <= 30; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = 'KS-' + String(i).padStart(4, '0');
    row[tm.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0');
    // Every ticket is sold, to a named person with a telephone number.
    row[tm.Status - 1] = TICKET_STATUS.SOLD;
    row[tm.Buyer_Name - 1] = 'Buyer ' + i;
    row[tm.Buyer_Phone - 1] = '01255500' + String(i).padStart(2, '0');
    row[tm.Buyer_Zone - 1] = 'Zone ' + i;
    row[tm.Notes - 1] = 'note ' + i;
    row[tm.Version - 1] = 1;
    row[tm.Modified_Date - 1] = new Date().toISOString();
    T._data.push(row);
  }

  B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  bm = headerMap(B);
  for (let b = 1; b <= 3; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = 'Book-' + String(b).padStart(3, '0');
    row[bm.First_Ticket - 1] = 'KS-' + String((b - 1) * 10 + 1).padStart(4, '0');
    row[bm.Last_Ticket - 1] = 'KS-' + String(b * 10).padStart(4, '0');
    row[bm.Status - 1] = BOOK_STATUS.OUT;
    row[bm.Held_By_Agent - 1] = b === 1 ? 'A001' : 'A002';   // book 1 is Daw Hla's
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

const F = TICKET_WIRE_FIELDS;
const col = (row, name) => row[F.indexOf(name)];
const byNumber = (rows, n) => rows.find(r => col(r, 'Ticket_Number') === n);

// ============ 1. a seller reading the whole table ============
console.log('a seller sees their own buyers and nobody else\'s');
{
  world();
  const snap = handleReadSnapshot({}, agentA);
  eq(snap.rows.length, 30, 'every ticket is still listed');

  // Book-001 is theirs: they sold these and must be able to ring the buyers.
  const mine = byNumber(snap.rows, 'KS-0001');
  eq(col(mine, 'Buyer_Name'), 'Buyer 1', 'their own buyer is named');
  eq(col(mine, 'Buyer_Phone'), '0125550001', 'with a telephone number');

  // Book-002 belongs to U Kyaw.
  const theirs = byNumber(snap.rows, 'KS-0011');
  eq(col(theirs, 'Ticket_Number'), 'KS-0011', 'the number is still visible');
  eq(col(theirs, 'Status'), TICKET_STATUS.SOLD, 'and so is the status — "is it still going?" has an answer');
  eq(col(theirs, 'Book_Number'), 'Book-002', 'and which book it is in');
  eq(col(theirs, 'Buyer_Name'), '', 'but not who bought it');
  eq(col(theirs, 'Buyer_Phone'), '', 'and not their telephone number');
  eq(col(theirs, 'Buyer_Zone'), '', 'nor where they live');
  eq(col(theirs, 'Notes'), '', 'nor any note about them');

  // The whole point, stated as a count: no stranger's phone number on the wire.
  const leaked = snap.rows.filter(r =>
    col(r, 'Book_Number') !== 'Book-001' && col(r, 'Buyer_Phone') !== '');
  eq(leaked.length, 0, 'not one telephone number outside their own book');
}

// ============ 2. an organiser sees everything; a helper does not ============
console.log('an organiser sees every buyer, a helper only their own entries');
{
  world();
  // Somebody has to be able to run the draw, and that is the organiser.
  const a = handleReadSnapshot({}, admin).rows;
  eq(col(byNumber(a, 'KS-0011'), 'Buyer_Phone'), '0125550011', 'an organiser sees every buyer');

  /*
   * A helper used to be here too, and this assertion used to read "a recorder
   * sees every buyer". It was changed deliberately, not because it broke: a
   * helper is usually a volunteer at a desk for one afternoon, and a desk shift
   * is not a reason to hold several thousand refugees' telephone numbers.
   *
   * The fixture records every ticket with no Recorded_By, so none of them is
   * this helper's — which is the case that matters. They can still read the
   * number, the status and who sold it.
   */
  const r = handleReadSnapshot({}, recorder).rows;
  const row = byNumber(r, 'KS-0011');
  eq(col(row, 'Buyer_Phone'), '', 'a helper does not see a buyer they did not record');
  eq(col(row, 'Buyer_Name'), '', 'nor the name');
  eq(col(row, 'Status'), TICKET_STATUS.SOLD, 'but the status is still readable');
  eq(col(row, 'Ticket_Number'), 'KS-0011', 'and the number');
  eq(r.length, 30, 'and no rows are missing — no holes in the grid');

  // The entries they DID write down stay theirs to work with.
  T._data[11][tm.Recorded_By - 1] = recorder.email;
  global.__clearCache();
  const own = byNumber(handleReadSnapshot({}, recorder).rows, 'KS-0011');
  eq(col(own, 'Buyer_Phone'), '0125550011', 'a sale they recorded keeps its buyer');

  // A viewer keeps the partial mask they always had.
  world();
  const v = handleReadSnapshot({}, viewer).rows;
  const p = col(byNumber(v, 'KS-0011'), 'Buyer_Phone');
  ok(p.indexOf('\u2022') !== -1, 'a viewer still gets the phone partly hidden');
  ok(p !== '' && p !== '0125550011', 'neither blank nor complete');
}

// ============ 3. the same rule on the delta path ============
console.log('the incremental path masks identically');
{
  world();
  const rows = handleReadDelta({ since: new Date(Date.now() - 86400000).toISOString() }, agentA).rows;
  ok(rows.length > 0, 'the delta returns rows');
  const theirs = byNumber(rows, 'KS-0011');
  eq(col(theirs, 'Buyer_Phone'), '', 'a stranger\'s number is blank here too');
  // Worth its own test: a masker applied on the full read and forgotten on the
  // incremental one leaks everything to anybody who stays signed in.
  eq(col(byNumber(rows, 'KS-0001'), 'Buyer_Phone'), '0125550001', 'and their own is intact');
}

// ============ 4. a seller who holds nothing ============
console.log('a seller carrying no books');
{
  world();
  const orphan = { ...agentA, agentId: 'A999' };
  const rows = handleReadSnapshot({}, orphan).rows;
  const leaked = rows.filter(r => col(r, 'Buyer_Phone') !== '');
  eq(leaked.length, 0, 'sees no buyer details at all');
  eq(rows.length, 30, 'but can still see what is sold and what is free');
}

// ============ 4b. a seller linked to no seller record ============
console.log('an agent account with no Agent_ID sees nothing, not everything');
{
  world();
  // This is a real state: an organiser creates the sign-in before deciding
  // which seller it belongs to. It used to skip the narrowing entirely, so the
  // account with the LEAST claim to anybody's details got all of them.
  const unlinked = { ...agentA, agentId: '' };
  const rows = handleReadSnapshot({}, unlinked).rows;

  eq(rows.length, 30, 'they can still see what is sold and what is free');
  const leaked = rows.filter(r => col(r, 'Buyer_Phone') !== '');
  eq(leaked.length, 0, 'and not one telephone number');
  const named = rows.filter(r => col(r, 'Buyer_Name') !== '');
  eq(named.length, 0, 'nor one buyer name');

  // Fails closed on the delta path too, or one full load fixes it and every
  // refresh afterwards leaks.
  const d = handleReadDelta({ since: new Date(Date.now() - 86400000).toISOString() }, unlinked).rows;
  eq(d.filter(r => col(r, 'Buyer_Phone') !== '').length, 0, 'the same on a refresh');

  // null agentId, not just empty string — both reach this the same way.
  const nullish = { ...agentA, agentId: null };
  eq(handleReadSnapshot({}, nullish).rows.filter(r => col(r, 'Buyer_Phone') !== '').length, 0,
     'and with a null Agent_ID');
}

// ============ 5. the book list ============
console.log('a seller\'s book list is the books in their hands');
{
  world();
  eq(handleListBooks({}, agentA).books.length, 1, 'one book, not three');
  eq(handleListBooks({}, agentA).books[0].book, 'Book-001', 'and it is theirs');
  eq(handleListBooks({}, admin).books.length, 3, 'an organiser sees them all');
}

// ============ 6. writing is already scoped — pinned so it stays that way ============
console.log('a seller cannot record a sale in somebody else\'s book');
{
  world();
  T._data[11][tm.Status - 1] = TICKET_STATUS.AVAILABLE;   // KS-0011, U Kyaw's book
  let code = 'NO_THROW';
  try {
    handleSellTicket({ ticketNumber: 'KS-0011', buyerName: 'X', buyerPhone: '0125559999' }, agentA);
  } catch (e) { code = e.code; }
  eq(code, 'NOT_YOUR_BOOK', 'refused');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
