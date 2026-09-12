/*
 * The permissions table.
 *
 * The registry's `roles:` is now a default the super admin can override from
 * the app. That is a screen which rewrites the access control of a system
 * holding several thousand people's phone numbers, so most of what follows is
 * about what the table must REFUSE to do — not what it can do.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

const SUPER = 'boss@x.com';
const CLIENT_ID = '123-abc.apps.googleusercontent.com';

function codeOf(fn) { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } }

function world(opts) {
  opts = opts || {};
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  if (opts.withTable) __mkSheet(SHEET.PERMISSIONS, COLS.PERMISSIONS);

  const U = __sheets[SHEET.USERS];
  U.appendRow([SUPER, 'Boss', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  U.appendRow(['admin@x.com', 'Admin', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  U.appendRow(['rec@x.com', 'Recorder', ROLES.RECORDER, true, '', '', 'setup', new Date()]);
  U.appendRow(['view@x.com', 'Viewer', ROLES.VIEWER, true, '', '', 'setup', new Date()]);

  PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_EMAIL', SUPER);
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLIENT_ID', CLIENT_ID);
}

function signIn(email, action) {
  const reg = actionRegistry();
  const spec = reg[action];
  global.UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        aud: CLIENT_ID, iss: 'https://accounts.google.com',
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email, email_verified: 'true', sub: 'sub-' + email, name: email
      })
    })
  };
  global.__clearCache();
  return requireUser('a-token-long-enough-to-pass', spec.roles, spec.sup, action);
}

/** Does this person get through the gate for this action? */
function can(email, action) {
  try { signIn(email, action); return true; } catch (e) { return false; }
}

function setRow(action, role, value) {
  const sheet = __sheets[SHEET.PERMISSIONS] || ensurePermissionsSheet_();
  const map = headerMap(sheet);
  let rowNum = 0;
  if (sheet.getLastRow() > 1) {
    const col = sheet.getRange(2, map.Action, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < col.length; i++) if (String(col[i][0]).trim() === action) { rowNum = i + 2; break; }
  }
  if (!rowNum) {
    const blank = new Array(COLS.PERMISSIONS.length).fill('');
    blank[map.Action - 1] = action;
    sheet.appendRow(blank);
    rowNum = sheet.getLastRow();
  }
  sheet.getRange(rowNum, map[role]).setValue(value);
  bumpPermissionCacheVersion();
}

// ============ 1. no table means nothing changes ============
console.log('no table = registry behaviour');
{
  world();
  ok(can('rec@x.com', 'sell_ticket'), 'recorder can still sell');
  ok(!can('rec@x.com', 'issue_books'), 'recorder still cannot issue books');
  ok(can('admin@x.com', 'issue_books'), 'admin can still issue books');
  ok(!can('view@x.com', 'sell_ticket'), 'viewer still cannot sell');
  ok(can('view@x.com', 'read_snapshot'), 'viewer can still read');
  eq(JSON.stringify(permissionsTable_()), '{}', 'the table reads as empty');
}

// ============ 2. the table grants and revokes ============
console.log('grant and revoke');
{
  world({ withTable: true });
  ok(!can('rec@x.com', 'issue_books'), 'denied by default');
  setRow('issue_books', 'recorder', true);
  ok(can('rec@x.com', 'issue_books'), 'the table granted it');

  setRow('sell_ticket', 'recorder', false);
  ok(!can('rec@x.com', 'sell_ticket'), 'the table revoked it');

  // An admin can be held back too — that is the point of the screen.
  setRow('settle_book', 'admin', false);
  ok(!can('admin@x.com', 'settle_book'), 'an admin can be denied a default');
  ok(can(SUPER, 'settle_book'), 'the super admin is never affected');
}

// ============ 3. a blank cell is not a "no" ============
console.log('blank means no opinion');
{
  world({ withTable: true });
  setRow('issue_books', 'recorder', true);        // creates the row
  ok(can('admin@x.com', 'issue_books'), 'admin keeps the default from a blank cell');
  ok(!can('view@x.com', 'issue_books'), 'viewer keeps the default from a blank cell');
  eq(permissionFor_('issue_books', 'admin'), 'null', 'blank reads as no opinion');
  eq(permissionFor_('issue_books', 'recorder'), 'true', 'a set cell reads as an opinion');
  eq(permissionFor_('nothing_here', 'admin'), 'null', 'an unknown action has no opinion');
}

// ============ 4. super-admin-only actions ignore the table entirely ============
console.log('sup actions cannot be granted');
{
  world({ withTable: true });
  for (const action of ['void_ticket', 'export_entries', 'read_audit', 'record_winner']) {
    setRow(action, 'admin', true);
    setRow(action, 'recorder', true);
    ok(!can('admin@x.com', action), `table cannot grant ${action} to an admin`);
    ok(!can('rec@x.com', action), `table cannot grant ${action} to a recorder`);
    ok(can(SUPER, action), `the super admin still has ${action}`);
  }
}

// ============ 5. set_permission refuses the dangerous writes ============
console.log('set_permission invariants');
{
  world({ withTable: true });
  const boss = signIn(SUPER, 'whoami');

  eq(codeOf(() => handleSetPermission({ action: 'read_audit', role: 'admin', allowed: true }, boss)),
    'SUPER_ADMIN_ONLY', 'refuses to hand out a super-admin-only action');
  eq(codeOf(() => handleSetPermission({ action: 'ping', role: 'admin', allowed: false }, boss)),
    'BAD_REQUEST', 'refuses a public action');
  eq(codeOf(() => handleSetPermission({ action: 'not_an_action', role: 'admin', allowed: true }, boss)),
    'UNKNOWN_ACTION', 'refuses an unknown action');
  eq(codeOf(() => handleSetPermission({ action: 'sell_ticket', role: 'wizard', allowed: true }, boss)),
    'BAD_REQUEST', 'refuses an unknown role');
  eq(codeOf(() => handleSetPermission({ action: 'sell_ticket', role: 'admin' }, boss)),
    'MISSING_FIELD', 'refuses a missing allowed flag');

  for (const locked of ['list_users', 'upsert_user', 'set_user_status']) {
    eq(codeOf(() => handleSetPermission({ action: locked, role: 'admin', allowed: false }, boss)),
      'BAD_REQUEST', `admins cannot be stripped of ${locked}`);
    // but a lesser role can still be denied it
    ok(handleSetPermission({ action: locked, role: 'recorder', allowed: false }, boss).allowed === false,
      `a recorder can still be denied ${locked}`);
  }

  // The happy path writes, and takes effect without a redeploy.
  ok(handleSetPermission({ action: 'issue_books', role: 'recorder', allowed: true }, boss).allowed,
    'a legitimate grant is written');
  ok(can('rec@x.com', 'issue_books'), 'and takes effect immediately');
  ok(handleSetPermission({ action: 'issue_books', role: 'recorder', allowed: false }, boss).allowed === false,
    'and can be taken back');
  ok(!can('rec@x.com', 'issue_books'), 'which also takes effect immediately');
}

// ============ 6. even with the table wide open, admins keep user management ============
console.log('admins cannot be locked out');
{
  world({ withTable: true });
  // Write the row directly, bypassing handleSetPermission's refusal, to prove
  // the gate holds even if somebody edits the spreadsheet by hand.
  setRow('upsert_user', 'admin', false);
  setRow('list_users', 'admin', false);
  setRow('set_user_status', 'admin', false);
  ok(can('admin@x.com', 'upsert_user'), 'a hand-edited FALSE cannot strip upsert_user');
  ok(can('admin@x.com', 'list_users'), 'nor list_users');
  ok(can('admin@x.com', 'set_user_status'), 'nor set_user_status');
  ok(!can('rec@x.com', 'upsert_user'), 'a recorder is still not an admin');
}

// ============ 7. the screen's data ============
console.log('list_permissions shape');
{
  world({ withTable: true });
  const boss = signIn(SUPER, 'whoami');
  const r = handleListPermissions({}, boss);

  ok(Array.isArray(r.actions) && r.actions.length > 25, 'every action listed (' + r.actions.length + ')');
  eq(r.roles.join(','), 'admin,recorder,agent,viewer', 'roles in a fixed order');
  ok(!r.actions.some(a => a.action === 'ping'), 'the public action is not listed');

  const byAction = {};
  r.actions.forEach(a => { byAction[a.action] = a; });

  ok(byAction['void_ticket'].sup, 'void_ticket flagged super-admin-only');
  ok(byAction['void_ticket'].danger, 'void_ticket flagged dangerous');
  eq(byAction['void_ticket'].current.admin, 'false', 'and shown as off for admins');
  ok(byAction['upsert_user'].lockedFor.indexOf('admin') !== -1, 'upsert_user locked for admins');
  ok(!byAction['sell_ticket'].lockedFor.length, 'ordinary actions are not locked');
  eq(byAction['sell_ticket'].group, 'Tickets', 'grouped for the screen');
  eq(byAction['sell_ticket'].label, 'Record a sale', 'labelled in plain words');
  ok(r.actions.every(a => a.label && a.group), 'every action has a label and a group');

  // current reflects an override, defaults do not.
  setRow('issue_books', 'recorder', true);
  const r2 = handleListPermissions({}, boss);
  const ib = r2.actions.filter(a => a.action === 'issue_books')[0];
  eq(ib.defaults.recorder, 'false', 'default still says no');
  eq(ib.current.recorder, 'true', 'current says yes');
}

// ============ 8. the void bypass in correct_ticket is closed ============
console.log('correct_ticket cannot void');
{
  world();
  const admin = { email: 'admin@x.com', role: 'admin', isAdmin: true, active: true, displayName: 'A' };

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'], ['TOTAL_TICKETS', '10'],
   ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'], ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'],
   ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']].forEach(r => __sheets[SHEET.CONFIG].appendRow(r));
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  const m = headerMap(T);
  for (let i = 1; i <= 10; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[m.Ticket_Number - 1] = 'KS-' + String(i).padStart(4, '0');
    row[m.Status - 1] = TICKET_STATUS.SOLD;
    row[m.Book_Number - 1] = 'Book-001';
    row[m.Buyer_Name - 1] = 'Buyer ' + i;
    row[m.Version - 1] = 1;
    T._data.push(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  const bm = headerMap(B);
  const brow = new Array(COLS.BOOKS.length).fill('');
  brow[bm.Book_Number - 1] = 'Book-001';
  brow[bm.First_Ticket - 1] = 'KS-0001';
  brow[bm.Last_Ticket - 1] = 'KS-0010';
  brow[bm.Status - 1] = BOOK_STATUS.OUT;
  brow[bm.Version - 1] = 1;
  B._data.push(brow);

  eq(codeOf(() => handleCorrectTicket(
    { ticketNumber: 'KS-0001', reason: 'x', Status: TICKET_STATUS.VOID }, admin)),
    'USE_VOID_ACTION', 'an admin cannot void through a correction');
  eq(codeOf(() => handleCorrectTicket(
    { ticketNumber: 'KS-0001', reason: 'x', Status: TICKET_STATUS.DONATED }, admin)),
    'USE_SELL_ACTION', 'nor turn a sale into a donation through one');

  const recorder = { email: 'rec@x.com', role: 'recorder', isAdmin: false, active: true, displayName: 'R' };
  eq(codeOf(() => handleCorrectTicket(
    { ticketNumber: 'KS-0001', reason: 'x', expectedVersion: 1, Status: TICKET_STATUS.AVAILABLE }, recorder)),
    'INSUFFICIENT_ROLE', 'a recorder cannot change status at all');

  // The ordinary correction still works.
  ok(handleCorrectTicket({ ticketNumber: 'KS-0001', reason: 'wrong name', expectedVersion: 1, Buyer_Name: 'Fixed' }, recorder).version,
    'a recorder can still fix a buyer name');
  eq(T._data[1][m.Buyer_Name - 1], 'Fixed', 'and the correction landed');
  eq(T._data[1][m.Status - 1], TICKET_STATUS.SOLD, 'with the status untouched');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
