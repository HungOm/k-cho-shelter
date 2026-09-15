/*
 * Naming the person who has the books.
 *
 * A refusal that reads "Book-400 — already out with A001" asks whoever is
 * looking at it to know the agent IDs by heart. Nobody does, so the screen
 * that is meant to say "these are not free" says nothing useful about who to
 * go and ask.
 *
 * The name leads, the ID stays: two sellers called Pa Thang is not a
 * hypothetical, and the ID is what the Books tab and every report are keyed on.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];
  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '30'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  for (let i = 1; i <= 30; i++) {
    const r = new Array(COLS.TICKETS.length).fill('');
    r[0] = ticketNumberAt(i, cfg); r[1] = TICKET_STATUS.AVAILABLE;
    r[2] = bookOfTicket(r[0], cfg); r[12] = 1; T.appendRow(r);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for (let b = 1; b <= 3; b++) {
    const r = new Array(COLS.BOOKS.length).fill('');
    r[0] = bookNumberAt(b, cfg); r[1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    r[2] = ticketNumberAt(b * 10, cfg); r[3] = BOOK_STATUS.UNASSIGNED; r[13] = 1; B.appendRow(r);
  }
  const A = __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  A.appendRow(['A001', 'Pa Thang', '0123456789', 'Kajang', true, '']);
  A.appendRow(['A002', 'Daw Hla', '0129998888', 'Cheras', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
}
const admin = { email: 'a@x.com', displayName: 'A', role: 'admin', isAdmin: true, agentId: '', active: true };
const blockedFrom = fn => { try { fn(); return null; } catch (e) { return e.details && e.details.blocked; } };

// ============ 1. issuing books somebody already has ============
console.log('issuing books that are already out');
world();
handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', toBook: 'Book-002' }, admin);
const bl = blockedFrom(() => handleIssueBooks({ agentId: 'A002', fromBook: 'Book-001', toBook: 'Book-003' }, admin));

ok(bl && bl.length === 2, 'both held books are blocked, the free one is not');
eq(bl[0].book, 'Book-001', 'it names the book');
eq(bl[0].reason, 'already out with Pa Thang (Agent ID: A001)', 'the name leads and the ID follows');
eq(bl[1].reason, 'already out with Pa Thang (Agent ID: A001)', 'on every line');
ok(bl[0].reason.indexOf('Pa Thang') < bl[0].reason.indexOf('A001'), 'name before ID, not the other way round');

// the pieces travel with the sentence, so another language can rebuild it
eq(bl[0].agentId, 'A001', 'the id is carried separately');
eq(bl[0].agentName, 'Pa Thang', 'and so is the name');
eq(bl[0].status, 'out', 'and the status');
eq(bl[0].holder, 'Pa Thang (Agent ID: A001)', 'and the composed holder');

// ============ 2. an ID with nobody behind it ============
console.log('an agent ID with no row in the Agents tab');
world();
const bs = __sheets[SHEET.BOOKS];
bs._data[1][3] = BOOK_STATUS.OUT; bs._data[1][4] = 'A999';
bumpBookCacheVersion();
const gone = blockedFrom(() => handleIssueBooks({ agentId: 'A002', fromBook: 'Book-001', toBook: 'Book-001' }, admin));
eq(gone[0].reason, 'already out with A999', 'falls back to the bare ID rather than showing nothing');
eq(gone[0].agentName, '', 'and says plainly that no name was found');

// ============ 3. a book the Config tab claims but the sheet does not have ============
// A number outside the raffle is refused earlier, by expandBookRange_. This
// line only fires when the Books tab has lost a row it is supposed to have,
// which is exactly when inventing a holder would be worst.
console.log('a book the sheet has lost');
world();
__sheets[SHEET.BOOKS]._data.splice(2, 1);        // Book-002 disappears
bumpBookCacheVersion();
const missing = blockedFrom(() => handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', toBook: 'Book-003' }, admin));
const notFound = missing.filter(x => x.reason === 'not found');
ok(notFound.length === 1, 'the missing book is reported as not found');
eq(notFound[0].book, 'Book-002', 'and named');
ok(!notFound[0].holder, 'with no phantom holder invented for it');
ok(!notFound[0].agentName, 'and no phantom name');

// ============ 4. transferring to the person who already has them ============
console.log('transferring to the agent who already holds them');
world();
handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', toBook: 'Book-001' }, admin);
const tb = blockedFrom(() => handleTransferBooks({ toAgentId: 'A001', fromBook: 'Book-001', toBook: 'Book-001' }, admin));
eq(tb[0].reason, 'already held by Pa Thang (Agent ID: A001)', 'reads as English: held BY, not held WITH');

// a book nobody is carrying cannot be transferred, and names nobody
const tb2 = blockedFrom(() => handleTransferBooks({ toAgentId: 'A001', fromBook: 'Book-002', toBook: 'Book-002' }, admin));
eq(tb2[0].reason, 'is unassigned, not out with anyone', 'an unheld book keeps its own wording');
ok(!tb2[0].holder, 'and names nobody');

// ============ 5. the ordinary path pays nothing for this ============
console.log('the names are only looked up when something is blocked');
world();
let lookups = 0;
const realMap = agentNameMap_;
agentNameMap_ = function () { lookups++; return realMap.apply(null, arguments); };

handleIssueBooks({ agentId: 'A001', fromBook: 'Book-001', toBook: 'Book-003' }, admin);
eq(lookups, 0, 'a clean issue looks up no names at all');

blockedFrom(() => handleIssueBooks({ agentId: 'A002', fromBook: 'Book-001', toBook: 'Book-001' }, admin));
eq(lookups, 1, 'a blocked one looks them up exactly once, not once per book');

lookups = 0;
blockedFrom(() => handleIssueBooks({ agentId: 'A002', fromBook: 'Book-001', toBook: 'Book-003' }, admin));
eq(lookups, 1, 'still once across three blocked books');
agentNameMap_ = realMap;

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
