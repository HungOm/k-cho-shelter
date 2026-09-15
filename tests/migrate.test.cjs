/*
 * Sending only what changed.
 *
 * A re-run used to push all twenty thousand tickets back across, every time,
 * which is what made a gateway timeout likely enough to actually happen. It now
 * sends what has moved since the last successful run.
 *
 * The failure this guards against is the quiet one: a watermark that is wrong
 * by a little does not error, it silently stops carrying somebody's sale across.
 * By the day of the draw that is a buyer who cannot be telephoned.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs', 'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs', 'Migrate.gs'])
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

const dateOf = r => r._srcModified ? new Date(r._srcModified) : null;
const row = (n, mod) => ({ idx: n, number: 'KS-' + n, modified_at: mod || new Date().toISOString(), _srcModified: mod || null });

// ============ 1. no watermark means everything ============
console.log('the first run carries everything');
{
  const rows = [row(1), row(2, '2026-01-01T00:00:00.000Z'), row(3)];
  eq(changedSince_(rows, null, dateOf).length, 3, 'all three, watermark absent');
}

// ============ 2. untouched rows are not resent ============
console.log('a row never touched since generation is not resent');
{
  // This is the case that broke the first attempt at this: the row builder
  // defaults a blank date to NOW so the column is never null on the other side.
  // Comparing against that default would mark every untouched ticket as changed
  // and send all twenty thousand again — exactly the bug being fixed.
  const untouched = row(1);                       // no sheet date at all
  ok(untouched.modified_at, 'it still gets a date for the database');
  eq(untouched._srcModified, 'null', 'but the sheet date stays empty');

  const mark = new Date('2026-06-01T00:00:00.000Z');
  eq(changedSince_([untouched], mark, dateOf).length, 0, 'so it is not resent');
}

// ============ 3. the boundary ============
console.log('rows on either side of the watermark');
{
  const mark = new Date('2026-06-01T00:00:00.000Z');
  const before = row(1, '2026-05-31T23:59:59.000Z');
  const exactly = row(2, '2026-06-01T00:00:00.000Z');
  const after = row(3, '2026-06-01T00:00:01.000Z');

  const sent = changedSince_([before, exactly, after], mark, dateOf);
  eq(sent.length, 1, 'only the one after');
  eq(sent[0].idx, 3, 'and it is the right one');
  // Strictly after, so a row written in the same second as the watermark is
  // carried by the NEXT run rather than skipped by this one. Re-sending a row
  // costs nothing; missing one loses a sale.
  ok(!sent.some(r => r.idx === 2), 'a row exactly on the mark is not dropped silently');
}

// ============ 4. the watermark is the START of the previous run ============
console.log('an edit made during a migration is not lost');
{
  // The run starts at 10:00 and finishes at 10:04. A sale is recorded at 10:02,
  // after its row was read. If the watermark were the FINISH time, that sale
  // would never be carried across by any later run.
  const started = new Date('2026-06-01T10:00:00.000Z');
  const saleDuringRun = row(7, '2026-06-01T10:02:00.000Z');
  eq(changedSince_([saleDuringRun], started, dateOf).length, 1,
     'the next run picks it up');

  const finished = new Date('2026-06-01T10:04:00.000Z');
  eq(changedSince_([saleDuringRun], finished, dateOf).length, 0,
     'and would NOT have, had the watermark been the finish time');
}

// ============ 5. our bookkeeping never reaches the database ============
console.log('the private field is stripped before sending');
{
  let sent = null;
  global.UrlFetchApp = { fetch: (url, opts) => {
    sent = JSON.parse(opts.payload);
    return { getResponseCode: () => 201, getContentText: () => '' };
  } };

  supaPost_({ url: 'https://x', key: 'sb_secret_x' },
            'tickets', [row(1, '2026-06-01T00:00:00.000Z')], 'idx', 'test');

  ok(sent && sent.length === 1, 'one row posted');
  ok(!('_srcModified' in sent[0]), '_srcModified never leaves this machine');
  ok('modified_at' in sent[0], 'but the real column does');
  // PostgREST refuses the whole batch over one unknown key, so this is not
  // cosmetic — it would fail all five hundred rows.
}

// ============ 6. a gateway error is retried, a bad request is not ============
console.log('retries');
{
  let calls = 0;
  global.Utilities = { sleep: () => {} };
  global.UrlFetchApp = { fetch: () => {
    calls++;
    return calls < 3
      ? { getResponseCode: () => 504, getContentText: () => '{"message":"Gateway Timeout"}' }
      : { getResponseCode: () => 201, getContentText: () => '' };
  } };
  const n = supaPost_({ url: 'https://x', key: 'k' }, 'tickets', [row(1)], 'idx', 'b1');
  eq(n, 1, 'it succeeded on the third attempt');
  eq(calls, 3, 'having retried the gateway timeout twice');

  // A 400 is the rows themselves being wrong. Sending them again fails the same
  // way, just slower.
  calls = 0;
  global.UrlFetchApp = { fetch: () => {
    calls++;
    return { getResponseCode: () => 400, getContentText: () => '{"message":"bad column"}' };
  } };
  let threw = false;
  try { supaPost_({ url: 'https://x', key: 'k' }, 'tickets', [row(1)], 'idx', 'b1'); }
  catch (e) { threw = true; ok(e.message.indexOf('bad column') !== -1, 'and says what was wrong'); }
  ok(threw, 'a bad request throws');
  eq(calls, 1, 'without retrying');
}

// ============ 7. the failure names the batch ============
console.log('a failure says where it stopped');
{
  global.Utilities = { sleep: () => {} };
  global.UrlFetchApp = { fetch: () => ({
    getResponseCode: () => 504, getContentText: () => '{"message":"Gateway Timeout"}'
  }) };
  try {
    supaPost_({ url: 'https://x', key: 'k' }, 'tickets', [row(1)], 'idx', 'tickets 501-1000 of 20000');
    ok(false, 'should have thrown');
  } catch (e) {
    ok(e.message.indexOf('501-1000') !== -1, 'the message names the batch');
    ok(e.message.indexOf('running it again') !== -1, 'and says it is safe to run again');
  }
}

// ============ 8. what the migration must not overwrite ============
console.log('the migration carries users without overwriting them');
{
  // Who may sign in is managed on the OTHER side now. A re-run reading a stale
  // role from the Sheet would demote somebody who had been promoted, or
  // re-admit an account somebody had stopped — silently, because this writes
  // straight to the table with nothing in the audit log.
  let sent = [];
  global.Utilities = { sleep: () => {} };
  global.UrlFetchApp = { fetch: (url, opts) => {
    sent.push({ url, prefer: opts.headers.Prefer, rows: JSON.parse(opts.payload) });
    return { getResponseCode: () => 201, getContentText: () => '' };
  } };

  supaPost_({ url: 'https://x', key: 'k' },
    'app_users', [{ email: 'a@x.com', role: 'viewer' }], 'email', 'users', 'ignore-duplicates');
  ok(sent[0].prefer.indexOf('ignore-duplicates') !== -1,
     'users are sent as ignore-duplicates, so an existing row is left alone');

  sent = [];
  supaPost_({ url: 'https://x', key: 'k' },
    'tickets', [{ idx: 1 }], 'idx', 'tickets');
  ok(sent[0].prefer.indexOf('merge-duplicates') !== -1,
     'but tickets still merge — that is the whole point of the migration');
}

console.log('a user row carries status, never the generated active column');
{
  // `active` is generated from status on the other side. Naming a generated
  // column in an insert does not warn — Postgres refuses the whole batch, so
  // one stale field would fail the final pre-cutover migration entirely.
  const src = fs.readFileSync(path + 'Migrate.gs', 'utf8');
  const block = src.slice(src.indexOf('uRows.push({'), src.indexOf('out.push(\'users: '));
  ok(block.indexOf('status:') !== -1, 'the user row sends status');
  ok(!/^\s*active:/m.test(block), 'and does not send active');

  // The mapping itself, since a wrong one silently locks somebody out.
  ok(block.indexOf("'suspended'") !== -1, 'a row switched off in the sheet arrives suspended');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
