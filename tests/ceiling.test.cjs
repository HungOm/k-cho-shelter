/*
 * The ticket ceiling, and the trap next to it.
 *
 * Releasing tickets in batches is append-only and cannot be undone: shrinking a
 * raffle silently un-sells everything above the new line, so expand_tickets
 * refuses it outright. That makes a slipped digit the real hazard here — 100000
 * where 10000 was meant appends ninety thousand rows and there is no way back.
 * TICKET_CEILING is the guard that stands in front of that.
 *
 * The second half of this file covers the trap the ceiling does not close:
 * raising TOTAL_TICKETS by hand in the Config tab. That is the obvious thing to
 * try, the Config tab is documented as editable, and it stops every sale in the
 * raffle until the number goes back.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };
const codeOf = fn => { try { fn(); return 'NO_THROW'; } catch (e) { return e.code || ('ERR:' + e.message); } };
const errOf = fn => { try { fn(); return null; } catch (e) { return e; } };

const sup = { email: 'boss@x.com', displayName: 'Boss', role: 'admin', isAdmin: true, isSuperAdmin: true, agentId: '', active: true };

/** A running raffle of `total` tickets in books of 10, optionally with a ceiling. */
function world(total, ceiling) {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  const rows = [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '5'],
    ['TOTAL_TICKETS', String(total)], ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'],
    ['BOOK_DIGITS', '4'], ['TICKET_PRICE', '10'], ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']];
  if (ceiling !== undefined) rows.push(['TICKET_CEILING', String(ceiling)]);
  rows.forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const cfg = getConfig();
  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  for (let i = 1; i <= total; i++) {
    const row = new Array(COLS.TICKETS.length).fill('');
    row[0] = ticketNumberAt(i, cfg); row[1] = TICKET_STATUS.AVAILABLE;
    row[2] = bookNumberAt(Math.ceil(i / 10), cfg); row[12] = 1;
    T.appendRow(row);
  }
  const B = __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  for (let b = 1; b <= Math.ceil(total / 10); b++) {
    const row = new Array(COLS.BOOKS.length).fill('');
    row[0] = bookNumberAt(b, cfg); row[1] = ticketNumberAt((b - 1) * 10 + 1, cfg);
    row[2] = ticketNumberAt(Math.min(b * 10, total), cfg);
    row[3] = BOOK_STATUS.UNASSIGNED; row[13] = 1;
    B.appendRow(row);
  }
  __mkSheet(SHEET.AGENTS, COLS.AGENTS).appendRow(['A001', 'Pa Thang', '0123456789', '', true, '']);
  __mkSheet(SHEET.USERS, COLS.USERS);
  __mkSheet(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY);
  __mkSheet(SHEET.WINNERS, COLS.WINNERS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);
  bumpBookCacheVersion();
  assertNumberingUnchanged_();       // record the starting fingerprint
}

/** Runs a real expansion the way the action requires: preview, then confirm. */
const release = (to) => handleExpandTickets({ totalTickets: to, dryRun: false, confirm: String(to) }, sup);

function setConfig(key, value) {
  const s = __sheets[SHEET.CONFIG];
  for (let i = 1; i < s._data.length; i++) {
    if (String(s._data[i][0]) === key) { s._data[i][1] = value; invalidateConfigCache(); global.__clearCache(); return; }
  }
  s.appendRow([key, value]);
  invalidateConfigCache();
  global.__clearCache();
}

// ============ 1. the ceiling is a guard, not a promise ============
console.log('releasing within the ceiling');
{
  world(100, 200);
  eq(cfgNum(getConfig(), 'TICKET_CEILING', 0), 200, 'the ceiling reads back');

  const r = release(150);
  eq(r.to, 150, 'releasing part of the plan works');
  eq(r.addedTickets, 50, 'and reports how many were added');
  eq(r.firstNewTicket, 'KS-00101', 'naming the first new ticket');
  eq(r.lastNewTicket, 'KS-00150', 'and the last');
  eq(__sheets[SHEET.TICKETS].getLastRow() - 1, 150, 'the rows were written');
  eq(cfgNum(getConfig(), 'TOTAL_TICKETS', 0), 150, 'and the setting moved with them');

  // Right up to the ceiling is allowed — it is a limit, not a margin.
  const r2 = release(200);
  eq(r2.to, 200, 'releasing exactly the ceiling is allowed');
  eq(__sheets[SHEET.TICKETS].getLastRow() - 1, 200, 'all the rows exist');
}

// ============ 2. the slipped digit ============
console.log('the ceiling refuses a slipped digit');
{
  world(10000, 20000);

  // 100000 for 10000 — the mistake the ceiling exists to catch.
  eq(codeOf(() => release(100000)), 'ABOVE_CEILING', 'ten times too many is refused');
  eq(__sheets[SHEET.TICKETS].getLastRow() - 1, 10000, 'and not one row was written');
  eq(cfgNum(getConfig(), 'TOTAL_TICKETS', 0), 10000, 'the setting did not move either');

  const e = errOf(() => release(100000));
  ok(/20000/.test(e.message) && /100000/.test(e.message),
    'the message names the plan and what was asked for');
  ok(/TICKET_CEILING/.test(e.message), 'and names the setting to change if it was deliberate');
  eq(e.details.ceiling, 20000, 'details carry the ceiling');
  eq(e.details.requested, 100000, 'and the request');

  // Raising the ceiling on purpose lets it through.
  setConfig('TICKET_CEILING', '100000');
  eq(codeOf(() => release(20000)), 'NO_THROW', 'a deliberate raise unblocks it');
}

// ============ 3. a blank ceiling means no ceiling ============
console.log('no ceiling set');
{
  world(100);                       // no TICKET_CEILING row at all
  eq(codeOf(() => release(200)), 'NO_THROW', 'expansion still works with no ceiling');

  world(100, '');                   // present but blank
  eq(codeOf(() => release(200)), 'NO_THROW', 'a blank ceiling does not block anything');

  // The system limit still applies underneath.
  world(100, 0);
  eq(codeOf(() => handleExpandTickets(
    { totalTickets: MAX_TOTAL_TICKETS + 1, dryRun: false, confirm: String(MAX_TOTAL_TICKETS + 1) }, sup)),
    'TOO_MANY', 'the system limit is still enforced');
}

// ============ 4. the ceiling never weakens what already guarded this ============
console.log('the other guards still hold');
{
  world(100, 20000);
  eq(codeOf(() => release(50)), 'CANNOT_SHRINK', 'shrinking is still refused');
  eq(codeOf(() => release(100)), 'NO_CHANGE', 'no change is still refused');

  // A preview under the ceiling still writes nothing.
  world(100, 200);
  const preview = handleExpandTickets({ totalTickets: 200 }, sup);
  ok(preview.dryRun, 'preview is still the default');
  eq(__sheets[SHEET.TICKETS].getLastRow() - 1, 100, 'and it wrote nothing');

  // Still super-admin only.
  world(100, 200);
  const plainAdmin = { email: 'a@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, displayName: 'A' };
  eq(codeOf(() => handleExpandTickets({ totalTickets: 150, dryRun: false, confirm: '150' }, plainAdmin)),
    'SUPER_ADMIN_ONLY', 'an ordinary admin still cannot release tickets');

  // The ceiling itself is NOT part of numbering, so changing it breaks nothing.
  world(100, 200);
  setConfig('TICKET_CEILING', '900');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW',
    'moving the ceiling does not trip the numbering lock');
  ok(LOCKED_CONFIG_KEYS.indexOf('TICKET_CEILING') === -1, 'and it is not a locked key');
}

// ============ 5. the trap: raising TOTAL_TICKETS by hand ============
console.log('raising the total by hand is explained, not just refused');
{
  world(100, 20000);

  // Somebody opens the Config tab and edits the number, which is the obvious
  // thing to try and the documented way to change every other setting.
  setConfig('TOTAL_TICKETS', '200');

  const e = errOf(() => assertNumberingUnchanged_());
  eq(e.code, 'NUMBERING_CHANGED', 'it is still refused');
  ok(/no ticket rows were created/.test(e.message),
    'the message says what is actually wrong — the rows do not exist');
  ok(/Add more tickets/.test(e.message), 'and names the tool that does it properly');
  eq(e.details.fixBySetting, '100', 'details carry the value to restore');
  eq(e.details.useAction, 'expand_tickets', 'and the action to use instead');

  // Putting it back clears it — this has to be recoverable.
  setConfig('TOTAL_TICKETS', '100');
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW', 'restoring it lifts the block');

  // A genuine numbering change keeps the original, blunter message.
  world(100, 20000);
  setConfig('TICKET_PREFIX', 'CS-');
  const e2 = errOf(() => assertNumberingUnchanged_());
  eq(e2.code, 'NUMBERING_CHANGED', 'a prefix change is still refused');
  ok(!/Add more tickets/.test(e2.message),
    'and is not mistaken for an attempt to release tickets');

  // Lowering TOTAL_TICKETS by hand is not the friendly case either — it is the
  // dangerous direction, and must not be offered the helpful advice.
  world(100, 20000);
  setConfig('TOTAL_TICKETS', '50');
  const e3 = errOf(() => assertNumberingUnchanged_());
  ok(!/Add more tickets/.test(e3.message), 'lowering is not treated as a release attempt');
}

// ============ 6. a sanctioned release leaves the raffle writable ============
console.log('after a release, work continues');
{
  world(100, 500);
  release(200);
  eq(codeOf(() => assertNumberingUnchanged_()), 'NO_THROW',
    'the fingerprint was restamped, so writes are not blocked');

  const cfg = getConfig();
  eq(totalBooks(cfg), 20, 'the book count followed the tickets');
  eq(__sheets[SHEET.BOOKS].getLastRow() - 1, 20, 'and the book rows exist');

  // Every newly released ticket is sellable, and the old ones kept their numbers.
  eq(ticketNumberAt(1, cfg), 'KS-00001', 'the first ticket is unchanged');
  eq(ticketNumberAt(200, cfg), 'KS-00200', 'the last new ticket numbers correctly');
  ok(ticketIndex('KS-00150', cfg) > 0, 'a newly released ticket now exists');
  eq(ticketIndex('KS-00201', cfg), 0, 'one past the line still does not');
}

// ============ 7. changing the ceiling from the app ============
console.log('the ceiling is changeable without editing the sheet');
{
  world(100, 200);
  const r = handleSetTicketCeiling({ ceiling: 500 }, sup);
  eq(r.to, 500, 'the ceiling moved');
  eq(r.from, 200, 'and reports what it was');
  eq(r.stillToRelease, 400, 'and how much headroom that leaves');
  eq(cfgNum(getConfig(), 'TICKET_CEILING', 0), 500, 'it stuck');
  eq(codeOf(() => release(400)), 'NO_THROW', 'and releasing up to the new ceiling works');

  // Clearing it.
  world(100, 200);
  eq(handleSetTicketCeiling({ ceiling: '' }, sup).to, 0, 'blank clears the ceiling');
  eq(cfgNum(getConfig(), 'TICKET_CEILING', 0), 0, 'and it reads back as none');
  eq(codeOf(() => release(900)), 'NO_THROW', 'with no ceiling, larger releases pass');

  // Refusals.
  world(500, 900);
  eq(codeOf(() => handleSetTicketCeiling({ ceiling: 300 }, sup)), 'BELOW_GENERATED',
    'a ceiling below the tickets that exist is refused');
  const e = errOf(() => handleSetTicketCeiling({ ceiling: 300 }, sup));
  ok(/500/.test(e.message), 'and says how many exist');
  eq(codeOf(() => handleSetTicketCeiling({ ceiling: 900 }, sup)), 'NO_CHANGE', 'no change is refused');
  eq(codeOf(() => handleSetTicketCeiling({ ceiling: -5 }, sup)), 'BAD_REQUEST', 'negative is refused');
  eq(codeOf(() => handleSetTicketCeiling({ ceiling: MAX_TOTAL_TICKETS + 1 }, sup)), 'TOO_MANY',
    'above the system limit is refused');

  world(500, 900);
  const plainAdmin = { email: 'a@x.com', role: 'admin', isAdmin: true, isSuperAdmin: false, active: true, displayName: 'A' };
  eq(codeOf(() => handleSetTicketCeiling({ ceiling: 1000 }, plainAdmin)), 'SUPER_ADMIN_ONLY',
    'an ordinary admin cannot change the plan');

  // Exactly at what exists is allowed — that is "this raffle is finished growing".
  world(500, 900);
  eq(handleSetTicketCeiling({ ceiling: 500 }, sup).to, 500, 'a ceiling equal to what exists is allowed');
  eq(codeOf(() => release(510)), 'ABOVE_CEILING', 'and it closes the raffle to further growth');

  const reg = actionRegistry();
  ok(reg['set_ticket_ceiling'].sup === true, 'it is super-admin only');
  eq(reg['set_ticket_ceiling'].kind, 'write', 'and a write');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
