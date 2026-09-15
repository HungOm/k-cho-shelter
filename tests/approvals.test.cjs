/*
 * Two-person control.
 *
 * The property worth testing is not "an approval can be given" — it is that the
 * thing approved is the thing that runs, and that nothing can run on
 * permissions the requester no longer has.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

const SUPER = 'boss@x.com';
const boss = { email: SUPER, role: 'admin', isAdmin: true, isSuperAdmin: true, active: true, displayName: 'Boss' };
const admin = { email: 'admin@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, displayName: 'Admin' };
const recorder = { email: 'rec@x.com', role: 'recorder', isAdmin: false, isSuperAdmin: false, active: true, displayName: 'Rec' };

/** 5 books of 10 tickets: 001-002 Returned (restockable), 003-005 Out. */
function world() {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];
  PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_EMAIL', SUPER);

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '50'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  const tm = headerMap(T);
  for (let i = 1; i <= 50; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[tm.Ticket_Number - 1] = 'KS-' + String(i).padStart(4, '0');
    row[tm.Status - 1] = TICKET_STATUS.AVAILABLE;
    row[tm.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0');
    row[tm.Version - 1] = 1;
    T._data.push(row);
  }

  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  const bm = headerMap(B);
  for (let b = 1; b <= 5; b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[bm.Book_Number - 1] = 'Book-' + String(b).padStart(3, '0');
    row[bm.First_Ticket - 1] = 'KS-' + String((b - 1) * 10 + 1).padStart(4, '0');
    row[bm.Last_Ticket - 1] = 'KS-' + String(b * 10).padStart(4, '0');
    row[bm.Status - 1] = b <= 2 ? BOOK_STATUS.RETURNED : BOOK_STATUS.OUT;
    row[bm.Declared_Sold - 1] = b <= 2 ? 4 : '';
    row[bm.Version - 1] = 1;
    B._data.push(row);
  }

  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);

  const U = __mkSheet(SHEET.USERS, COLS.USERS);
  U.appendRow([SUPER, 'Boss', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  U.appendRow(['admin@x.com', 'Admin', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  U.appendRow(['rec@x.com', 'Rec', ROLES.RECORDER, true, '', '', 'setup', new Date()]);
}

// ============ 1. what needs two people, and what does not ============
console.log('which actions need approval');
{
  world();
  ok(approvalSummaryFor_('set_book_status',
    { status: BOOK_STATUS.LOST, fromBook: 'Book-001', toBook: 'Book-004', dryRun: false }),
    'a range of books being marked lost needs approval');
  ok(!approvalSummaryFor_('set_book_status',
    { status: BOOK_STATUS.LOST, fromBook: 'Book-001', dryRun: false }),
    'one book does not');
  ok(!approvalSummaryFor_('set_book_status',
    { status: BOOK_STATUS.LOST, fromBook: 'Book-001', toBook: 'Book-004' }),
    'a preview writes nothing, so it does not');
  ok(approvalSummaryFor_('restock_books', { fromBook: 'Book-001', toBook: 'Book-002' }),
    'restocking needs approval');
  ok(approvalSummaryFor_('settle_book', { bookNumber: 'Book-001', force: true }),
    're-settling over a recorded settlement needs approval');
  ok(!approvalSummaryFor_('settle_book', { bookNumber: 'Book-001' }),
    'an ordinary settlement does not');

  // Recording sales is additive and must never queue.
  ok(!approvalSummaryFor_('bulk_record_sales', { sales: new Array(400).fill({}) }),
    'recording 400 sales never needs approval');
  ok(!approvalSummaryFor_('sell_ticket', { ticketNumber: 'KS-0001' }), 'nor one sale');
  ok(!approvalSummaryFor_('issue_books', { fromBook: 'Book-001', toBook: 'Book-005' }),
    'nor giving books out');

  // The summary says what will actually happen.
  const s = approvalSummaryFor_('set_book_status',
    { status: BOOK_STATUS.LOST, fromBook: 'Book-001', toBook: 'Book-004', dryRun: false });
  ok(s.text.indexOf('4 books') !== -1, 'summary counts the books');
  ok(s.text.indexOf('Book-001') !== -1 && s.text.indexOf('Book-004') !== -1, 'summary names the range');
  ok(s.text.indexOf('leave the draw') !== -1, 'summary warns that tickets leave the draw');

  // The same sentence in pieces, so another language can be composed from it
  // without parsing English prose.
  eq(s.kind, 'set_book_status', 'detail names the kind');
  eq(s.books, 4, 'detail counts the books');
  eq(s.firstBook, 'Book-001', 'detail carries the first book');
  eq(s.lastBook, 'Book-004', 'detail carries the last');
  eq(s.status, BOOK_STATUS.LOST, 'detail carries the status');
  eq(s.voidsTickets, 'true', 'detail flags that tickets are voided');
  eq(s.tickets, 40, 'detail counts the tickets at stake');

  const rs = approvalSummaryFor_('restock_books', { fromBook: 'Book-001', toBook: 'Book-002' });
  eq(rs.kind, 'restock_books', 'restock detail names the kind');
  eq(rs.books, 2, 'and counts the books');

  const fs2 = approvalSummaryFor_('settle_book', { bookNumber: 'Book-003', force: true });
  eq(fs2.kind, 'resettle_book', 're-settle detail names the kind');
  eq(fs2.firstBook, 'Book-003', 'and names the book');
}

// ============ 2. requesting ============
console.log('request_approval');
{
  world();
  const payload = { status: BOOK_STATUS.LOST, fromBook: 'Book-001', toBook: 'Book-004', dryRun: false };

  eq(codeOf(() => handleRequestApproval({ action: 'set_book_status', payload }, boss)),
    'BAD_REQUEST', 'the super admin cannot file a request with themselves');
  eq(codeOf(() => handleRequestApproval({ action: 'set_book_status', payload }, recorder)),
    'INSUFFICIENT_ROLE', 'approval is not a way round missing permission');
  eq(codeOf(() => handleRequestApproval({ action: 'sell_ticket', payload: {} }, admin)),
    'NOTHING_TO_DO', 'an action that needs nobody is refused');
  eq(codeOf(() => handleRequestApproval({ action: 'nope', payload: {} }, admin)),
    'UNKNOWN_ACTION', 'an unknown action is refused');

  const r = handleRequestApproval({ action: 'set_book_status', payload }, admin);
  ok(r.requestId, 'a request id comes back');
  ok(r.summary.indexOf('4 books') !== -1, 'the summary comes back');
  ok(new Date(r.expiresAt).getTime() > Date.now(), 'and an expiry in the future');

  // The summary is stored, not recomputed later.
  const stored = readPendingRaw_().rows[0];
  eq(stored.Summary, r.summary, 'the summary is on the row');
  ok(r.detail && r.detail.kind === 'set_book_status', 'the structured detail comes back too');
  eq(JSON.parse(stored.Detail).books, 4, 'and is stored beside the sentence');
  eq(handleListApprovals({}, boss).requests[0].detail.books, 4, 'and is handed back on read');
  eq(stored.Status, 'Pending', 'it starts pending');
  eq(stored.Requested_By, 'admin@x.com', 'and records who asked');
  eq(JSON.parse(stored.Payload).toBook, 'Book-004', 'with the exact payload');

  // Oversized payloads are refused rather than silently truncated.
  const huge = { status: BOOK_STATUS.LOST, fromBook: 'Book-001', toBook: 'Book-004',
                 dryRun: false, reason: 'x'.repeat(APPROVAL_PAYLOAD_MAX + 10) };
  eq(codeOf(() => handleRequestApproval({ action: 'set_book_status', payload: huge }, admin)),
    'PAYLOAD_TOO_LARGE', 'an oversized request is refused');
}

// ============ 3. approving runs the stored payload ============
console.log('decide_approval executes');
{
  world();
  const B = __sheets[SHEET.BOOKS], bm = headerMap(B);
  const r = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001', toBook: 'Book-002' } }, admin);

  eq(B._data[1][bm.Status - 1], BOOK_STATUS.RETURNED, 'nothing happened on request');

  const d = handleDecideApproval({ requestId: r.requestId, approve: true }, boss);
  ok(d.executed, 'approving executed it');
  eq(d.status, 'Approved', 'and marked the row approved');
  eq(d.requestedBy, 'admin@x.com', 'the result names who asked');
  eq(B._data[1][bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'book 1 went back on the shelf');
  eq(B._data[2][bm.Status - 1], BOOK_STATUS.UNASSIGNED, 'book 2 as well');
  eq(B._data[3][bm.Status - 1], BOOK_STATUS.OUT, 'book 3 was not in the request and is untouched');

  eq(codeOf(() => handleDecideApproval({ requestId: r.requestId, approve: true }, boss)),
    'NOTHING_TO_DO', 'it cannot be run twice');

  // Both names are in the audit trail.
  const audit = __sheets[SHEET.AUDIT]._data.map(r2 => JSON.stringify(r2)).join(' ');
  ok(audit.indexOf('APPROVAL_APPROVED') !== -1, 'the approval is logged');
  ok(audit.indexOf('admin@x.com') !== -1 && audit.indexOf(SUPER) !== -1,
    'the log carries both the requester and the approver');
}

// ============ 4. rejecting ============
console.log('rejecting');
{
  world();
  const B = __sheets[SHEET.BOOKS], bm = headerMap(B);
  const r = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001', toBook: 'Book-002' } }, admin);

  const d = handleDecideApproval({ requestId: r.requestId, approve: false, note: 'ask me first' }, boss);
  eq(d.status, 'Rejected', 'marked rejected');
  ok(!d.executed, 'and nothing ran');
  eq(B._data[1][bm.Status - 1], BOOK_STATUS.RETURNED, 'the book is untouched');
  eq(readPendingRaw_().rows[0].Note, 'ask me first', 'the note is kept');
}

// ============ 5. the requester's permissions are re-checked at approval ============
console.log('requester re-checked');
{
  world();
  const r = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001', toBook: 'Book-002' } }, admin);

  // Disabled between asking and approving.
  const U = __sheets[SHEET.USERS], um = headerMap(U);
  U._data[2][um.Active - 1] = false;
  invalidateUserCache('admin@x.com');
  eq(codeOf(() => handleDecideApproval({ requestId: r.requestId, approve: true }, boss)),
    'REQUESTER_UNAVAILABLE', 'a disabled requester cannot have their request run');

  // Demoted between asking and approving.
  world();
  const r2 = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001', toBook: 'Book-002' } }, admin);
  const U2 = __sheets[SHEET.USERS], um2 = headerMap(U2);
  U2._data[2][um2.Role - 1] = ROLES.RECORDER;
  invalidateUserCache('admin@x.com');
  eq(codeOf(() => handleDecideApproval({ requestId: r2.requestId, approve: true }, boss)),
    'REQUESTER_NOT_ALLOWED', 'a demoted requester cannot have their request run');
  eq(__sheets[SHEET.BOOKS]._data[1][headerMap(__sheets[SHEET.BOOKS]).Status - 1],
    BOOK_STATUS.RETURNED, 'and nothing ran');
}

// ============ 6. expiry ============
console.log('expiry');
{
  world();
  const r = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001', toBook: 'Book-002' } }, admin);

  const data = readPendingRaw_();
  data.sheet.getRange(data.rows[0]._row, data.map.Expires_At)
    .setValue(new Date(Date.now() - 60 * 1000));

  eq(codeOf(() => handleDecideApproval({ requestId: r.requestId, approve: true }, boss)),
    'APPROVAL_EXPIRED', 'a stale request cannot be approved');
  eq(readPendingRaw_().rows[0].Status, 'Expired', 'and is marked expired');
  eq(__sheets[SHEET.BOOKS]._data[1][headerMap(__sheets[SHEET.BOOKS]).Status - 1],
    BOOK_STATUS.RETURNED, 'nothing ran');
}

// ============ 7. who sees what, and who can withdraw ============
console.log('listing and cancelling');
{
  world();
  const mine = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-001' } }, admin);
  const other = { email: 'admin2@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, displayName: 'A2' };
  __sheets[SHEET.USERS].appendRow(['admin2@x.com', 'A2', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  const theirs = handleRequestApproval({ action: 'restock_books',
    payload: { fromBook: 'Book-002' } }, other);

  eq(handleListApprovals({}, boss).requests.length, 2, 'the super admin sees both');
  ok(handleListApprovals({}, boss).youDecide, 'and is told they decide');
  const asAdmin = handleListApprovals({}, admin);
  eq(asAdmin.requests.length, 1, 'an admin sees only their own');
  eq(asAdmin.requests[0].requestId, mine.requestId, 'and it is theirs');
  ok(!asAdmin.youDecide, 'and is told they do not decide');

  eq(codeOf(() => handleCancelApproval({ requestId: theirs.requestId }, admin)),
    'NOT_AUTHORIZED', 'one admin cannot withdraw another admin\'s request');
  eq(handleCancelApproval({ requestId: mine.requestId }, admin).status, 'Cancelled',
    'but can withdraw their own');
  eq(codeOf(() => handleDecideApproval({ requestId: mine.requestId, approve: true }, boss)),
    'NOTHING_TO_DO', 'a withdrawn request cannot then be approved');
}

// ============ 8. the registry gate ============
console.log('registry');
{
  const reg = actionRegistry();
  ok(reg['request_approval'] && !reg['request_approval'].sup, 'admins may request');
  ok(reg['decide_approval'].sup === true, 'only the super admin decides');
  ok(reg['list_approvals'] && !reg['list_approvals'].sup, 'admins may see their own');
  ok(reg['cancel_approval'] && !reg['cancel_approval'].sup, 'admins may withdraw');
  ok(/APPROVAL_REQUIRED/.test(fs.readFileSync(path + 'Api.gs', 'utf8')),
    'the router refuses a direct call that needs approval');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
