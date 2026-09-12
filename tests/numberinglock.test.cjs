/*
 * The numbering lock.
 *
 * Every ticket number is a string stored in the Tickets tab, while every lookup
 * recomputes that number from the Config tab. Change the prefix and the two
 * stop agreeing — searching finds nothing, selling says the ticket does not
 * exist, and the paper in somebody's hand refers to nothing. Nothing throws.
 *
 * LOCKED_CONFIG_KEYS existed for this and was referenced nowhere. These tests
 * pin the enforcement so it cannot quietly lapse again.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };

function world(prefix) {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];
  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', prefix || 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'],
   ['TOTAL_TICKETS', '50'], ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'],
   ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'], ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']]
    .forEach(r => __sheets[SHEET.CONFIG].appendRow(r));
}

/** Rewrites one config value the way somebody editing the sheet by hand would. */
function setConfig(key, value) {
  const s = __sheets[SHEET.CONFIG];
  for (let i = 1; i < s._data.length; i++) {
    if (String(s._data[i][0]) === key) { s._data[i][1] = value; break; }
  }
  invalidateConfigCache();
  global.__clearCache();
}

// ============ 1. the list is actually used ============
console.log('the lock is enforced, not just declared');
{
  const sources = ['Config.gs', 'Api.gs'].map(f => fs.readFileSync(path + f, 'utf8')).join('\n');
  const uses = (sources.match(/LOCKED_CONFIG_KEYS/g) || []).length;
  ok(uses >= 2, 'LOCKED_CONFIG_KEYS is referenced somewhere other than its own declaration');
  ok(/assertNumberingUnchanged_\(\)/.test(fs.readFileSync(path + 'Api.gs', 'utf8')),
    'the router calls the guard');
  ok(/kind === 'write' \|\| spec\.kind === 'bulk'\) assertNumberingUnchanged_/.test(
       fs.readFileSync(path + 'Api.gs', 'utf8')),
    'and calls it on writes, before the action runs');

  // Every setting that feeds a ticket or book number must be covered.
  for (const key of ['TICKET_PREFIX', 'TICKET_START', 'TICKET_DIGITS', 'TICKETS_PER_BOOK',
                     'BOOK_PREFIX', 'BOOK_DIGITS', 'TOTAL_TICKETS']) {
    ok(LOCKED_CONFIG_KEYS.indexOf(key) !== -1, key + ' is locked');
  }
  // And things that are safe to change must NOT be locked, or nobody can fix a typo.
  for (const key of ['TICKET_PRICE', 'CURRENCY', 'EVENT_NAME', 'ORG_NAME',
                     'PROJECT_CODE', 'DEFAULT_DUE_DAYS', 'DRAW_DATE']) {
    ok(LOCKED_CONFIG_KEYS.indexOf(key) === -1, key + ' is free to change');
  }
}

// ============ 2. it records a fingerprint, then holds it ============
console.log('first sight records, later sight checks');
{
  world('KS-');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'first call records rather than failing');
  ok(global.__props.NUMBERING_FINGERPRINT, 'a fingerprint was stored');
  ok(global.__props.NUMBERING_FINGERPRINT.indexOf('TICKET_PREFIX=KS-') !== -1,
    'and it carries the prefix');

  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'an unchanged config passes');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'and keeps passing');
}

// ============ 3. the change the user was about to make ============
console.log('KS- to CS- is refused');
{
  world('KS-');
  assertNumberingUnchanged_();                 // records KS-
  setConfig('TICKET_PREFIX', 'CS-');

  eq(codeOf(() => assertNumberingUnchanged_()), 'NUMBERING_CHANGED',
    'changing the prefix is refused');

  let err = null;
  try { assertNumberingUnchanged_(); } catch (e) { err = e; }
  ok(/KS-/.test(err.message) && /CS-/.test(err.message),
    'the message names both the old and the new value');
  ok(err.details && err.details.changed.length === 1, 'and reports exactly what moved');
  ok(/Config tab/.test(err.message), 'and says where to put it back');

  // Putting it back clears the refusal — this must be recoverable.
  setConfig('TICKET_PREFIX', 'KS-');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'restoring it lifts the refusal');
}

// ============ 4. every locked key, not just the prefix ============
console.log('all the locked settings');
{
  const moves = {
    TICKET_START: '5', TICKET_DIGITS: '5', TOTAL_TICKETS: '80',
    TICKETS_PER_BOOK: '20', BOOK_PREFIX: 'B-', BOOK_DIGITS: '4'
  };
  for (const key in moves) {
    world('KS-');
    assertNumberingUnchanged_();
    setConfig(key, moves[key]);
    eq(codeOf(() => assertNumberingUnchanged_()), 'NUMBERING_CHANGED', key + ' is caught');
  }

  // A safe key must not trip it, or every price change becomes an outage.
  world('KS-');
  assertNumberingUnchanged_();
  setConfig('TICKET_PRICE', '25');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'changing the price is fine');
  setConfig('CURRENCY', 'USD');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'changing the currency is fine');
}

// ============ 5. the project code is identity, not numbering ============
console.log('project code is safe to change');
{
  world('KS-');
  assertNumberingUnchanged_();
  __sheets[SHEET.CONFIG].appendRow(['PROJECT_CODE', 'CS-2026']);
  invalidateConfigCache();
  global.__clearCache();
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'setting a project code changes nothing');
  eq(getConfig().PROJECT_CODE, 'CS-2026', 'and it reads back');

  setConfig('PROJECT_CODE', 'CEAM-SHELTER-2027');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'and it can be changed again later');

  // It must never leak into a ticket number.
  eq(ticketNumberAt(1, getConfig()), 'KS-0001', 'ticket numbers ignore the project code');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
