/*
 * The super admin: one root account, defined outside the database.
 *
 * These tests exist because every check here is one an ordinary admin would
 * pass. Getting them wrong does not throw — it quietly hands a second person
 * the top of the tree.
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

/** Returns the ApiError code a call throws, or 'NO_THROW'. */
function codeOf(fn) {
  try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); }
}

/** A Users tab with a super admin, a plain admin, a recorder and a viewer. */
function world(opts) {
  opts = opts || {};
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);

  const U = __sheets[SHEET.USERS];
  if (!opts.noSuperRow) {
    U.appendRow([SUPER, 'Boss', opts.superRole || ROLES.ADMIN,
      opts.superActive === undefined ? true : opts.superActive, '', '', 'setup', new Date()]);
  }
  U.appendRow(['admin@x.com', 'Admin', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  U.appendRow(['rec@x.com', 'Recorder', ROLES.RECORDER, true, '', '', 'setup', new Date()]);
  U.appendRow(['view@x.com', 'Viewer', ROLES.VIEWER, true, '', '', 'setup', new Date()]);

  PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_EMAIL', SUPER);
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLIENT_ID', CLIENT_ID);
}

/** Drives the real requireUser, with Google's tokeninfo stubbed out. */
function signIn(email, allowedRoles, needSuper) {
  global.UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        aud: CLIENT_ID, iss: 'https://accounts.google.com',
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        email: email, email_verified: 'true', sub: 'sub-' + email, name: email
      })
    })
  };
  global.__clearCache();
  return requireUser('a-token-long-enough-to-pass', allowedRoles, needSuper);
}

// ============ 1. where the super admin comes from ============
console.log('super admin identity');
{
  world();
  eq(superAdminEmail_(), SUPER, 'reads SUPER_ADMIN_EMAIL');

  // The old property name must keep an existing deployment working.
  delete global.__props.SUPER_ADMIN_EMAIL;
  PropertiesService.getScriptProperties().setProperty('ADMIN_BOOTSTRAP_EMAIL', '  BOSS@X.com  ');
  eq(superAdminEmail_(), SUPER, 'falls back to ADMIN_BOOTSTRAP_EMAIL, trimmed and lowercased');

  ok(isSuperAdminEmail_('BOSS@X.COM'), 'match ignores case');
  ok(isSuperAdminEmail_(' boss@x.com '), 'match ignores whitespace');
  ok(!isSuperAdminEmail_('admin@x.com'), 'a plain admin is not the super admin');

  // With no property set, nobody is super — the check must not match ''.
  delete global.__props.ADMIN_BOOTSTRAP_EMAIL;
  ok(!isSuperAdminEmail_(''), 'empty email is not super when unset');
  ok(!isSuperAdminEmail_(null), 'null email is not super when unset');
}

// ============ 2. the gate ============
console.log('gate: super-only actions');
{
  world();
  const reg = actionRegistry();
  const superOnly = ['void_ticket', 'export_entries', 'read_audit', 'record_winner'];

  for (const a of superOnly) {
    ok(reg[a].sup === true, `${a} is marked super-only in the registry`);
    eq(codeOf(() => signIn('admin@x.com', reg[a].roles, reg[a].sup)),
      'SUPER_ADMIN_ONLY', `admin refused ${a}`);
    eq(codeOf(() => signIn('rec@x.com', reg[a].roles, reg[a].sup)),
      'SUPER_ADMIN_ONLY', `recorder refused ${a}`);
    ok(signIn(SUPER, reg[a].roles, reg[a].sup).isSuperAdmin, `super admin allowed ${a}`);
  }

  // Everything else an admin does must still work.
  for (const a of ['issue_books', 'settle_book', 'upsert_user', 'set_user_status', 'list_users']) {
    ok(!reg[a].sup, `${a} is not super-only`);
    ok(signIn('admin@x.com', reg[a].roles, reg[a].sup).isAdmin, `admin still allowed ${a}`);
  }
  eq(codeOf(() => signIn('rec@x.com', reg['issue_books'].roles, reg['issue_books'].sup)),
    'INSUFFICIENT_ROLE', 'recorder still refused issue_books by role');
}

// ============ 3. the super admin cannot be switched off in the sheet ============
console.log('super admin survives the Users tab');
{
  world({ superRole: ROLES.VIEWER });
  const u = signIn(SUPER, null, false);
  eq(u.role, ROLES.ADMIN, 'role demoted to viewer in the sheet is ignored');
  ok(u.isAdmin && u.isSuperAdmin, 'still admin and super');

  world({ superActive: false });
  const u2 = signIn(SUPER, null, false);
  ok(u2.active, 'Active=FALSE in the sheet does not lock the super admin out');

  world({ noSuperRow: true });
  const u3 = signIn(SUPER, null, false);
  ok(u3.isSuperAdmin && u3.isAdmin, 'works with no Users row at all');

  // A disabled ordinary admin is still shut out.
  world();
  __sheets[SHEET.USERS]._data[2][3] = false;
  eq(codeOf(() => signIn('admin@x.com', null, false)), 'ACCOUNT_DISABLED', 'disabled admin refused');
}

// ============ 4. only the super admin may make an admin ============
console.log('upsert_user guards');
{
  const admin = () => signIn('admin@x.com', [], false);
  const boss = () => signIn(SUPER, [], false);

  world();
  eq(codeOf(() => handleUpsertUser({ email: 'new@x.com', role: 'admin' }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot mint a new admin');

  world();
  eq(codeOf(() => handleUpsertUser({ email: 'admin@x.com', role: 'viewer' }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot demote another admin');

  world();
  eq(codeOf(() => handleUpsertUser({ email: SUPER, role: 'viewer' }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot touch the super admin row');

  world({ noSuperRow: true });
  eq(codeOf(() => handleUpsertUser({ email: SUPER, role: 'viewer' }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot create a row for the super admin either');

  // An organiser may no longer hand out ANY role, not just the admin one.
  //
  // The old rule let an organiser mint a recorder or a viewer. That is one
  // account away from a problem: an organiser creates an account, signs into it
  // themselves, and the rule "only the super admin decides who is an organiser"
  // has been walked around rather than broken. Running the raffle and deciding
  // who else runs it are different jobs.
  world();
  eq(codeOf(() => handleUpsertUser({ email: 'new@x.com', role: 'recorder' }, admin())),
    'SUPER_ADMIN_ONLY', 'an organiser cannot add a recorder');
  world();
  eq(codeOf(() => handleUpsertUser({ email: 'rec@x.com', role: 'viewer' }, admin())),
    'SUPER_ADMIN_ONLY', 'nor change an existing account');
  world();
  eq(codeOf(() => handleUpsertUser({ email: 'new@x.com', role: 'agent' }, admin())),
    'SUPER_ADMIN_ONLY', 'nor give somebody a sign-in as a seller');

  // But the daily work of running the raffle is untouched: an agent RECORD is
  // a seller holding paper, and grants nobody any access to this system.
  world();
  ok(handleUpsertAgent({ name: 'Daw Mya', phone: '0125557777' }, admin()).agentId,
    'an organiser still adds a seller');
  world();
  const made = handleUpsertAgent({ name: 'Daw Hla', phone: '0125551111' }, admin());
  ok(handleUpsertAgent({ agentId: made.agentId, name: 'Daw Hla', active: false }, admin()).updated,
    'and still bans one');

  // And what the super admin can do.
  world();
  ok(handleUpsertUser({ email: 'new@x.com', role: 'admin' }, boss()).created,
    'super admin can mint an admin');
  world();
  ok(handleUpsertUser({ email: 'admin@x.com', role: 'viewer' }, boss()).updated,
    'super admin can demote an admin');
}

// ============ 5. only the super admin may switch an admin off ============
console.log('set_user_status guards');
{
  const admin = () => signIn('admin@x.com', [], false);
  const boss = () => signIn(SUPER, [], false);

  world();
  eq(codeOf(() => handleSetUserStatus({ email: SUPER, active: false }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot disable the super admin');

  world();
  eq(codeOf(() => handleSetUserStatus({ email: SUPER, active: false }, boss())),
    'SUPER_ADMIN_ONLY', 'not even the super admin can disable the super admin');

  world({ noSuperRow: true });
  eq(codeOf(() => handleSetUserStatus({ email: SUPER, active: false }, admin())),
    'SUPER_ADMIN_ONLY', 'refused before the row lookup, so a missing row still says why');

  world();
  handleUpsertUser({ email: 'admin2@x.com', role: 'admin' }, boss());
  eq(codeOf(() => handleSetUserStatus({ email: 'admin2@x.com', active: false }, admin())),
    'SUPER_ADMIN_ONLY', 'admin cannot disable another admin');

  world();
  handleUpsertUser({ email: 'admin2@x.com', role: 'admin' }, boss());
  eq(handleSetUserStatus({ email: 'admin2@x.com', active: false }, boss()).active, 'false',
    'super admin can disable an admin');

  // An organiser may cut off a SELLER — a lost phone at a Sunday service should
  // not wait for the super admin to wake up — and nobody above one.
  world();
  eq(codeOf(() => handleSetUserStatus({ email: 'rec@x.com', active: false }, admin())),
    'SUPER_ADMIN_ONLY', 'an organiser cannot disable a recorder');

  world();
  const seller = handleUpsertAgent({ name: 'Daw Hla', phone: '0125551111' }, admin());
  handleUpsertUser({ email: 'seller@x.com', role: 'agent', agentId: seller.agentId }, boss());
  eq(handleSetUserStatus({ email: 'seller@x.com', active: false }, admin()).active, 'false',
    'but can disable a seller');
}

// ============ 6. an admin is not shown the super admin ============
console.log('list_users hides the super admin');
{
  world();
  const asAdmin = handleListUsers({}, signIn('admin@x.com', [], false));
  const emails = asAdmin.users.map(u => u.email);
  ok(emails.indexOf(SUPER) === -1, 'super admin row is absent for an admin');
  ok(emails.indexOf('admin@x.com') !== -1, 'other rows are still there');
  eq(asAdmin.superAdmin, '', 'super admin address is not returned to an admin');
  eq(asAdmin.youAreSuperAdmin, 'false', 'admin is told they are not super');

  // The old shape leaked the address to every admin — make sure it is gone.
  ok(!('bootstrapAdmin' in asAdmin), 'the bootstrapAdmin field is gone');
  ok(JSON.stringify(asAdmin).indexOf(SUPER) === -1, 'address appears nowhere in the payload');

  const asBoss = handleListUsers({}, signIn(SUPER, [], false));
  ok(asBoss.users.map(u => u.email).indexOf(SUPER) !== -1, 'super admin sees their own row');
  eq(asBoss.superAdmin, SUPER, 'super admin is told the address');
  ok(asBoss.users.find(u => u.email === SUPER).isSuperAdmin, 'the row is flagged');
  ok(!asBoss.users.find(u => u.email === 'admin@x.com').isSuperAdmin, 'a plain admin is not flagged');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
