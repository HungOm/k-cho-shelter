/*
 * Generated vs in play.
 *
 * TOTAL_TICKETS is how many ticket rows exist and can only grow. ACTIVE_TICKETS
 * is how many of those are in play, and moves both ways — nothing is destroyed
 * either direction, which is exactly why it is a second number and not a ticket
 * status. A status would have to be written onto ten thousand rows to change,
 * and would land in the book summaries as if it said something about the sale.
 *
 * The danger here is not the concept, it is partial enforcement. If reads are
 * filtered but writes are not, a held-back ticket is merely invisible — and
 * somebody typing its number still sells it. So most of this file is about the
 * write paths.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };
const errOf = fn => { try { fn(); return null; } catch (e) { return e; } };

const sup = { email: 'boss@x.com', displayName: 'Boss', role: 'admin', isAdmin: true, isSuperAdmin: true, agentId: '', active: true };
const admin = { email: 'admin@x.com', displayName: 'Admin', role: 'admin', isAdmin: true, isSuperAdmin: false, agentId: '', active: true };

let T, tm, B, bm;
/** `generated` tickets exist; `active` are in play (undefined = all). */
function world(generated, active) {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const rows = [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '5'],
    ['TOTAL_TICKETS', String(generated)], ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'],
    ['BOOK_DIGITS', '4'], ['TICKET_PRICE', '10'], ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']];
  if (active !== undefined) rows.push(['ACTIVE_TICKETS', String(active)]);
  rows.forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const cfg = getConfig();
  T = __mkSheet(SHEET.TICKETS, COLS.TICKETS); tm = headerMap(T);
  for (let i = 1; i <= generated; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = ticketNumberAt(i, cfg);
    row[tm.Status - 1] = TICKET_STATUS.AVAILABLE;
    row[tm.Book_Number - 1] = bookNumberAt(Math.ceil(i / 10), cfg);
    row[tm.Version - 1] = 1;
    row[tm.Modified_Date - 1] = new Date('2026-01-01T00:00:00Z');
    T._data.push(row);
  }
  B = __mkSheet(SHEET.BOOKS, COLS.BOOKS); bm = headerMap(B);
  for (let b = 1; b <= Math.ceil(generated / 10); b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = bookNumberAt(b, cfg);
    row[bm.First_Ticket - 1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    row[bm.Last_Ticket - 1] = ticketNumberAt(Math.min(b * 10, generated), cfg);
    row[bm.Status - 1] = BOOK_STATUS.UNASSIGNED;
    row[bm.Version - 1] = 1;
    B._data.push(row);
  }
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS).appendRow(['A001', 'Pa Thang', '0123456789', '', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
  assertNumberingUnchanged_();
}

const sale = (n) => ({ ticketNumber: n, buyerName: 'Ma Nu', buyerPhone: '0125550100' });

// ============ 1. the two numbers ============
console.log('generated and active are different numbers');
{
  world(200, 100);
  const cfg = getConfig();
  eq(cfgNum(cfg, 'TOTAL_TICKETS', 0), 200, 'two hundred exist');
  eq(activeTickets(cfg), 100, 'one hundred are in play');
  eq(activeBooks(cfg), 10, 'ten books are in play');
  eq(totalBooks(cfg), 20, 'twenty books exist');
  ok(hasHeldBackTickets(cfg), 'the raffle is holding some back');

  // Blank, absent, zero and oversized all mean "all of them" — an existing
  // raffle must behave exactly as it did before this concept existed.
  world(200);
  eq(activeTickets(getConfig()), 200, 'absent means all');
  ok(!hasHeldBackTickets(getConfig()), 'and nothing is held back');
  world(200, '');
  eq(activeTickets(getConfig()), 200, 'blank means all');
  world(200, 0);
  eq(activeTickets(getConfig()), 200, 'zero means all');
  world(200, 500);
  eq(activeTickets(getConfig()), 200, 'more than exist is capped at what exists');

  // It is not part of numbering, so moving it must not trip the lock.
  world(200, 100);
  ok(LOCKED_CONFIG_KEYS.indexOf('ACTIVE_TICKETS') === -1, 'it is not a locked key');
  setConfigValue_('ACTIVE_TICKETS', 150);
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'moving it does not trip the numbering lock');
}

// ============ 2. the part that matters: writes ============
console.log('a held-back ticket cannot be sold');
{
  world(200, 100);

  // In play — works.
  eq(codeOf(() => handleSellTicket(sale('KS-00100'), admin)), 'NO_THROW', 'the last live ticket sells');

  // One past the line — refused, whoever asks.
  world(200, 100);
  eq(codeOf(() => handleSellTicket(sale('KS-00101'), admin)), 'TICKET_NOT_RELEASED',
    'the first held-back ticket cannot be sold');
  eq(T._data[101][tm.Status - 1], TICKET_STATUS.AVAILABLE, 'and nothing was written');

  const e = errOf(() => handleSellTicket(sale('KS-00101'), admin));
  ok(/not been released/.test(e.message), 'the message says why');
  eq(e.details.active, 100, 'details carry the line');

  // Every other write path goes through the same gate. This is the whole point:
  // filtering reads alone would leave all of these open.
  world(200, 100);
  eq(codeOf(() => handleReserveTicket({ ticketNumber: 'KS-00150', buyerName: 'Ma Nu' }, admin)),
    'TICKET_NOT_RELEASED', 'reserve is gated');
  eq(codeOf(() => handleCorrectTicket({ ticketNumber: 'KS-00150', reason: 'x', expectedVersion: 1, Buyer_Name: 'X' }, admin)),
    'TICKET_NOT_RELEASED', 'correct is gated');
  eq(codeOf(() => handleVoidTicket({ ticketNumber: 'KS-00150', reason: 'x' }, sup)), 'TICKET_NOT_RELEASED', 'void is gated');
  eq(codeOf(() => handleBulkRecordSales({ sales: [sale('KS-00150')] }, admin)), 'BATCH_REJECTED', 'bulk entry is gated');
  eq(codeOf(() => handleSellBook({ fromBook: 'Book-0015', buyerName: 'X', buyerPhone: '0125550100' }, admin)),
    'TICKET_NOT_RELEASED', 'selling a held-back book is gated');

  // Superpowers do not bypass it — it is about the raffle, not about rank.
  eq(codeOf(() => handleSellTicket(sale('KS-00150'), sup)), 'TICKET_NOT_RELEASED',
    'not even the super admin can sell a ticket that is not in play');
}

// ============ 3. reads only carry what is in play ============
console.log('only live tickets are fetched');
{
  world(200, 100);
  const snap = handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  eq(snap.rows.length, 100, 'only the live tickets come back');
  eq(snap.total, 100, 'the total reported is the live count');
  eq(snap.generated, 200, 'and the generated count is reported separately');
  ok(!snap.hasMore, 'there is no more to page through');
  eq(snap.rows[99][0], 'KS-00100', 'the last row is the last live ticket');

  // Paging must not walk past the line.
  const paged = handleReadSnapshot({ offset: 0, limit: 60 }, admin);
  eq(paged.rows.length, 60, 'first page is a full page');
  ok(paged.hasMore, 'and reports more');
  const page2 = handleReadSnapshot({ offset: 60, limit: 60 }, admin);
  eq(page2.rows.length, 40, 'the second page stops at the line, not at the limit');
  ok(!page2.hasMore, 'and reports no more');

  // The delta is the path people forget.
  const d = handleReadDelta({ since: '2025-01-01T00:00:00Z' }, admin);
  eq(d.rows.length, 100, 'the delta stops at the line too');

  // With nothing held back, everything comes through as before.
  world(200);
  eq(handleReadSnapshot({ offset: 0, limit: 2000 }, admin).rows.length, 200, 'no line means everything');
  eq(handleReadDelta({ since: '2025-01-01T00:00:00Z' }, admin).rows.length, 200, 'delta too');
}

// ============ 4. books follow the tickets ============
console.log('held-back books are not stock');
{
  world(200, 100);
  const list = handleListBooks({}, admin);
  eq(list.books.length, 10, 'only live books are listed');
  eq(list.total, 10, 'the count matches');
  eq(list.generatedBooks, 20, 'generated books reported separately');
  eq(list.heldBackBooks, 10, 'and how many are held back');
  ok(!list.books.some(b => b.book === 'Book-0015'), 'a held-back book is absent');

  // Giving one out is refused before anything is written.
  eq(codeOf(() => handleIssueBooks({ agentId: 'A001', fromBook: 'Book-0015' }, admin)),
    'BOOKS_NOT_AVAILABLE', 'a held-back book cannot be given out');
  eq(B._data[15][bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'and it was not changed');

  // A range that crosses the line is refused whole, not half-applied.
  world(200, 100);
  eq(codeOf(() => handleIssueBooks({ agentId: 'A001', fromBook: 'Book-0008', toBook: 'Book-0012' }, admin)),
    'BOOKS_NOT_AVAILABLE', 'a range crossing the line is refused');
  eq(B._data[8][bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'and the live books in it were untouched');

  // Wholly live ranges still work.
  world(200, 100);
  eq(handleIssueBooks({ agentId: 'A001', fromBook: 'Book-0001', toBook: 'Book-0010' }, admin).issued, 10,
    'a range inside the line still works');
}

// ============ 5. moving the line ============
console.log('releasing and holding back');
{
  world(200, 100);
  const r = handleSetActiveTickets({ activeTickets: 150 }, sup);
  eq(r.to, 150, 'the line moved');
  eq(r.released, 50, 'fifty were released');
  eq(r.heldBack, 50, 'fifty are still held back');
  eq(r.activeBooks, 15, 'fifteen books are now in play');
  eq(activeTickets(getConfig()), 150, 'and it stuck');
  eq(codeOf(() => handleSellTicket(sale('KS-00150'), admin)), 'NO_THROW', 'a newly released ticket sells');
  eq(codeOf(() => handleSellTicket(sale('KS-00151'), admin)), 'TICKET_NOT_RELEASED', 'the next one still cannot');

  // Refusals.
  world(200, 100);
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 300 }, sup)), 'NOT_GENERATED',
    'cannot put more into play than exist');
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup)), 'NO_CHANGE', 'no change is refused');
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 105 }, sup)), 'PARTIAL_BOOK',
    'half a book is refused');
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 0 }, sup)), 'BAD_REQUEST', 'zero is refused');
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 150 }, admin)), 'SUPER_ADMIN_ONLY',
    'an ordinary admin cannot move the line');

  const e = errOf(() => handleSetActiveTickets({ activeTickets: 300 }, sup));
  eq(e.details.useAction, 'expand_tickets', 'and it points at the action that creates rows');
}

// ============ 6. pulling back only what nobody is relying on ============
console.log('holding back is guarded');
{
  // A sold ticket above the line must not be hidden.
  world(200, 150);
  handleSellTicket(sale('KS-00120'), admin);
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup)), 'TICKETS_IN_USE',
    'cannot hold back a ticket that is sold');
  const e = errOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup));
  ok(/KS-00120/.test(e.message), 'and it names the ticket');
  eq(activeTickets(getConfig()), 150, 'the line did not move');

  // A reserved one counts too — somebody is holding it for a buyer.
  world(200, 150);
  handleReserveTicket({ ticketNumber: 'KS-00130', buyerName: 'Ma Nu' }, admin);
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup)), 'TICKETS_IN_USE',
    'a reserved ticket blocks it too');

  // A book that is out must not be hidden either.
  world(200, 150);
  handleIssueBooks({ agentId: 'A001', fromBook: 'Book-0012' }, admin);
  eq(codeOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup)), 'BOOKS_IN_USE',
    'cannot hold back a book a seller is carrying');
  ok(/Book-0012/.test(errOf(() => handleSetActiveTickets({ activeTickets: 100 }, sup)).message),
    'and it names the book');

  // When nothing above the line is spoken for, pulling back is allowed —
  // this has to work, or a mistaken release could never be undone.
  world(200, 150);
  const back = handleSetActiveTickets({ activeTickets: 100 }, sup);
  eq(back.to, 100, 'an unused release can be pulled back');
  eq(back.pulledBack, 50, 'and says how many');
  eq(T._data[120][tm.Status - 1], TICKET_STATUS.AVAILABLE, 'the rows are untouched');
  eq(T._data[120][tm.Ticket_Number - 1], 'KS-00120', 'and keep their numbers — nothing is destroyed');
  eq(handleSetActiveTickets({ activeTickets: 150 }, sup).to, 150, 'and it can be released again');
}

// ============ 7. what the client is told ============
console.log('whoami reports both');
{
  world(200, 100);
  const me = handleWhoami({}, admin);
  eq(me.config.totalTickets, 100, 'the app works in live tickets');
  eq(me.config.generatedTickets, 200, 'generated is available for the release screen');
  eq(me.config.heldBackTickets, 100, 'and the difference is given directly');

  world(200);
  const me2 = handleWhoami({}, admin);
  eq(me2.config.totalTickets, 200, 'with no line, live equals generated');
  eq(me2.config.heldBackTickets, 0, 'and nothing is held back');

  const reg = actionRegistry();
  ok(reg['set_active_tickets'].sup === true, 'moving the line is super-admin only');
  eq(reg['set_active_tickets'].kind, 'write', 'it is a write');
  ok(reg['set_active_tickets'].lock, 'and takes the lock');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
