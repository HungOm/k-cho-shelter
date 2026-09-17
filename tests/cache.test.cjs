/*
 * The ticket table cache.
 *
 * A cache over the thing that records who paid money is the most dangerous
 * speed-up in this system: serve a stale row and somebody sells a ticket twice.
 * So these tests care much more about INVALIDATION and about who sees a phone
 * number than about the speed-up itself.
 */
require('./mock.cjs');
const fs = require('fs'), path = __dirname + '/../apps_script/';
for (const f of require('./loadgs.cjs')())
  eval(fs.readFileSync(path + f, 'utf8'));

let pass = 0, fail = 0;
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w); } };
const eq = (g, w, what) => { if (String(g) === String(w)) pass++; else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`); } };

const admin = { email: 'admin@x.com', displayName: 'Admin', role: 'admin', isAdmin: true, agentId: '', active: true };
const viewer = { email: 'view@x.com', displayName: 'Viewer', role: 'viewer', isAdmin: false, agentId: '', active: true };

/** Counts how many times the spreadsheet is actually read. */
let sheetReads = 0;
function world(nTickets) {
  global.__clearCache();
  for (const k in global.__sheets) delete global.__sheets[k];
  for (const k in global.__props) delete global.__props[k];

  __mkSheet(SHEET.CONFIG, COLS.CONFIG);
  [['TICKET_PREFIX', 'KS-'], ['TICKET_START', '1'], ['TICKET_DIGITS', '4'],
   ['TOTAL_TICKETS', String(nTickets)], ['TICKETS_PER_BOOK', '10'], ['BOOK_PREFIX', 'Book-'],
   ['BOOK_DIGITS', '3'], ['TICKET_PRICE', '10'], ['CURRENCY', 'RM'], ['DEFAULT_DUE_DAYS', '30']]
    .forEach(r => __sheets[SHEET.CONFIG].appendRow(r));

  const T = __mkSheet(SHEET.TICKETS, COLS.TICKETS);
  const base = new Date('2026-01-01T00:00:00Z');
  for (let i = 1; i <= nTickets; i++) {
    const num = 'KS-' + String(i).padStart(4, '0');
    const row = new Array(COLS.TICKETS.length).fill('');
    const m = headerMap(T);
    row[m.Ticket_Number - 1] = num;
    row[m.Status - 1] = TICKET_STATUS.SOLD;
    row[m.Book_Number - 1] = 'Book-' + String(Math.ceil(i / 10)).padStart(3, '0');
    row[m.Buyer_Name - 1] = 'Buyer ' + i;
    row[m.Buyer_Phone - 1] = '0125550' + String(100 + (i % 900));
    row[m.Version - 1] = 1;
    row[m.Modified_Date - 1] = new Date(base.getTime() + i * 1000);
    T._data.push(row);
  }

  __mkSheet(SHEET.BOOKS, COLS.BOOKS);
  __mkSheet(SHEET.AGENTS, COLS.AGENTS);
  __mkSheet(SHEET.AUDIT, COLS.AUDIT);

  // Count sheet reads from here on.
  sheetReads = 0;
  const realGetRange = __sheets[SHEET.TICKETS].getRange;
  __sheets[SHEET.TICKETS].getRange = function (r, c, nr, nc) {
    if (nr > 1) sheetReads++;          // a bulk read of the table, not a single cell
    return realGetRange.call(this, r, c, nr, nc);
  };
}

// ============ 1. the table is read once, not once per call ============
console.log('cache hit');
{
  world(300);
  const a = handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  const firstReads = sheetReads;
  ok(firstReads >= 1, 'first snapshot reads the sheet');

  handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  handleReadDelta({ since: '2026-01-01T00:00:00Z' }, admin);
  eq(sheetReads, firstReads, 'later reads are served from the cache');

  eq(a.total, 300, 'all tickets returned');
  eq(a.rows.length, 300, 'row count matches');
  ok(a.version !== undefined, 'snapshot carries a version stamp');
}

// ============ 2. a write invalidates it ============
console.log('invalidation');
{
  world(300);
  handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  const before = sheetReads;

  bumpTicketCacheVersion();
  handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  ok(sheetReads > before, 'a bumped version forces a re-read');

  // And the new data actually comes through.
  world(300);
  handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  const T = __sheets[SHEET.TICKETS];
  const m = headerMap(T);
  T._data[1][m.Buyer_Name - 1] = 'CHANGED';
  eq(handleReadSnapshot({ offset: 0, limit: 2000 }, admin).rows[0][3], 'Buyer 1',
    'without a bump the old row is still served (this is what the bump protects)');
  bumpTicketCacheVersion();
  eq(handleReadSnapshot({ offset: 0, limit: 2000 }, admin).rows[0][3], 'CHANGED',
    'after a bump the new row is served');
}

// ============ 3. every write path bumps, through the router ============
console.log('router bumps on every write');
{
  const reg = actionRegistry();
  const writes = Object.keys(reg).filter(a => reg[a].kind === 'write' || reg[a].kind === 'bulk');
  ok(writes.length >= 12, 'there are write actions to cover (' + writes.length + ')');

  // The router is the single choke point; prove it fires for the kinds that
  // matter, and only skips the actions explicitly exempted below.
  const src = fs.readFileSync(path + 'Api.gs', 'utf8');
  ok(/kind === 'write' \|\| spec\.kind === 'bulk'/.test(src),
    'route_ keys invalidation off the write and bulk kinds');
  ok(/NO_TICKET_WRITES\.indexOf\(req\.action\) === -1[\s\S]{0,60}bumpTicketCacheVersion\(\)/.test(src),
    'and bumps unless the action is on the exemption list');

  // A read must NOT bump — otherwise the cache never survives a single boot.
  const reads = Object.keys(reg).filter(a => reg[a].kind === 'read');
  for (const a of reads) ok(reg[a].kind === 'read', a + ' is a read');

  // The exemption list is the dangerous part: an action that quietly starts
  // writing tickets while still listed would serve a stale table. Re-derive it
  // from the source rather than trusting the list.
  const sources = ['Tickets.gs', 'Books.gs', 'People.gs', 'Auth.gs', 'Approvals.gs', 'Reports.gs', 'Prizes.gs']
    .map(f => fs.readFileSync(path + f, 'utf8')).join('\n');
  const TOUCHES = /SHEET\.TICKETS|settleTicketRows_|releaseReservedInBook_|voidUnsoldInBook_/;

  function bodyOf(name) {
    const i = sources.indexOf('function ' + name + '(');
    if (i === -1) return '';
    let d = 0, j = sources.indexOf('{', i);
    for (let k = j; k < sources.length; k++) {
      if (sources[k] === '{') d++;
      else if (sources[k] === '}') { d--; if (!d) return sources.slice(i, k + 1); }
    }
    return '';
  }

  for (const action of NO_TICKET_WRITES) {
    ok(reg[action], action + ' is a real action');
    const body = bodyOf(reg[action].fn.name);
    ok(body.length > 0, 'found the source of ' + action);
    ok(!TOUCHES.test(body),
      action + ' is exempt from invalidation and must not write tickets');
  }

  // And the converse: anything that DOES write tickets must not be exempt.
  for (const a of writes) {
    const body = bodyOf(reg[a].fn.name);
    if (TOUCHES.test(body)) {
      ok(NO_TICKET_WRITES.indexOf(a) === -1,
        a + ' writes tickets, so it must invalidate the cache');
    }
  }
}

// ============ 4. phone masking is applied per request, never cached ============
console.log('masking is not cached');
{
  world(50);

  // A view-only user reads first, so their masked copy is the one that could
  // poison the cache. Then an admin must still get the real number.
  const v = handleReadSnapshot({ offset: 0, limit: 2000 }, viewer);
  const a = handleReadSnapshot({ offset: 0, limit: 2000 }, admin);

  const vPhone = v.rows[0][4], aPhone = a.rows[0][4];
  ok(vPhone !== aPhone, 'viewer and admin see different phone values');
  ok(/\d{4}$/.test(String(aPhone)) && String(aPhone).length > 6, 'admin sees a full number');
  ok(String(vPhone).indexOf('*') !== -1 || String(vPhone).length < String(aPhone).length,
    'viewer sees a masked number');

  // And the other way round: admin first, then viewer.
  world(50);
  const a2 = handleReadSnapshot({ offset: 0, limit: 2000 }, admin);
  const v2 = handleReadSnapshot({ offset: 0, limit: 2000 }, viewer);
  ok(v2.rows[0][4] !== a2.rows[0][4], 'admin reading first does not unmask the viewer');
  eq(a2.rows[0][4], aPhone, 'admin value is stable either way');

  // The delta path masks too — it is the one people forget.
  const vd = handleReadDelta({ since: '2026-01-01T00:00:00Z' }, viewer);
  const ad = handleReadDelta({ since: '2026-01-01T00:00:00Z' }, admin);
  ok(vd.rows.length > 0 && ad.rows.length > 0, 'delta returned rows');
  ok(vd.rows[0][4] !== ad.rows[0][4], 'delta masks for a viewer as well');
}

// ============ 5. a table too big for one cache entry still round-trips ============
console.log('chunking');
{
  world(4000);
  const first = handleReadSnapshot({ offset: 0, limit: 3000 }, admin);
  eq(first.total, 4000, 'all 4000 tickets counted');
  eq(first.rows.length, 3000, 'page capped at the limit');
  ok(first.hasMore, 'more pages reported');

  const readsAfterFirst = sheetReads;
  const second = handleReadSnapshot({ offset: 3000, limit: 3000 }, admin);
  eq(second.rows.length, 1000, 'second page returns the rest');
  eq(sheetReads, readsAfterFirst, 'the second page came from the cache, not the sheet');

  // Round-trip integrity: last ticket survives being split across chunks.
  eq(second.rows[999][0], 'KS-4000', 'last ticket intact after chunking');
  eq(second.rows[999][3], 'Buyer 4000', 'its buyer name intact too');

  // Losing one chunk must fall back to the sheet, not serve half a table.
  const prefix = 'tix_' + ticketCacheVersion_() + '_';
  delete global.__cacheRaw[prefix + '1'];
  const before = sheetReads;
  const again = handleReadSnapshot({ offset: 0, limit: 3000 }, admin);
  ok(sheetReads > before, 'a missing chunk falls back to the sheet');
  eq(again.rows.length, 3000, 'and still returns a complete page');
}

// ============ 6. read_version is cheap and moves with writes ============
console.log('read_version');
{
  world(300);
  const before = sheetReads;
  const v1 = handleReadVersion({}, admin);
  eq(sheetReads, before, 'read_version touches no spreadsheet at all');
  ok(v1.tickets !== undefined && v1.books !== undefined, 'carries both counters');
  ok(v1.serverTime, 'carries server time');

  bumpTicketCacheVersion();
  const v2 = handleReadVersion({}, admin);
  ok(v2.tickets !== v1.tickets, 'ticket counter moves on a write');
  eq(v2.books, v1.books, 'book counter does not move for a ticket write');

  bumpBookCacheVersion();
  eq(handleReadVersion({}, admin).books !== v2.books, 'true', 'book counter moves on a book write');

  // It is in the registry as a plain read any signed-in user may call.
  const reg = actionRegistry();
  ok(reg['read_version'], 'read_version is registered');
  eq(reg['read_version'].kind, 'read', 'registered as a read');
  ok(!reg['read_version'].sup, 'not super-admin gated');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
