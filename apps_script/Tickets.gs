/**
 * K'Cho Shelter — Tickets.gs
 *
 * Reading the ticket table, and every write that touches a ticket.
 *
 * Two rules run through all of it:
 *   1. Tickets are addressed by Ticket_Number, never by row number. A stale
 *      row number silently overwriting the wrong ticket is the single worst
 *      failure mode a system like this has.
 *   2. A sale must carry a buyer name and phone. A sold ticket with no contact
 *      details is a ticket whose winner you cannot find on draw night.
 */

// ============ READING ============

function readTicketsRaw_() {
  var sheet = sheet_(SHEET.TICKETS);
  if (sheet.getLastRow() < 2) return [];
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(values[i], map);
    if (!obj.Ticket_Number) continue;
    obj._row = i + 2;
    out.push(obj);
  }
  return out;
}

function rowToObject_(row, map) {
  var obj = {};
  for (var name in map) obj[name] = row[map[name] - 1];
  return obj;
}

/** Ticket fields sent to the browser, in a fixed order, as a compact array. */
var TICKET_WIRE_FIELDS = [
  'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
  'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
  'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date'
];

var WIRE_PHONE = TICKET_WIRE_FIELDS.indexOf('Buyer_Phone');
var WIRE_MODIFIED = TICKET_WIRE_FIELDS.indexOf('Modified_Date');
var WIRE_BOOK = TICKET_WIRE_FIELDS.indexOf('Book_Number');
var WIRE_NAME = TICKET_WIRE_FIELDS.indexOf('Buyer_Name');
var WIRE_ZONE = TICKET_WIRE_FIELDS.indexOf('Buyer_Zone');
var WIRE_NOTES = TICKET_WIRE_FIELDS.indexOf('Notes');

/** The row as it is cached: every field, nothing masked, dates already ISO. */
function ticketToWireRaw_(t) {
  var row = [];
  for (var i = 0; i < TICKET_WIRE_FIELDS.length; i++) {
    var v = t[TICKET_WIRE_FIELDS[i]];
    if (v instanceof Date) v = v.toISOString();
    row.push(v === null || v === undefined ? '' : v);
  }
  return row;
}

/**
 * Masking happens on the way OUT, never on the way into the cache: it depends
 * on who is asking, and caching one view-only user's masked copy would serve
 * that copy to everybody.
 */
/**
 * The books one seller is physically carrying, as a lookup.
 *
 * Built once per request rather than per row: an agent with 20,000 tickets on
 * the wire would otherwise re-read the books sheet twenty thousand times.
 * Returns null for everybody who is not an agent, which is the signal to the
 * masker that no book-level narrowing applies.
 */
function agentBookSet_(user) {
  if (!user || user.role !== ROLES.AGENT) return null;

  // A seller linked to no seller record sees NOTHING, not everything.
  //
  // This returned null when agentId was missing, and null is the masker's
  // signal that no book-level narrowing applies — so an agent-role account with
  // no Agent_ID got every buyer's name and telephone number, which is the exact
  // thing the narrowing exists to prevent. The account is real: it is what an
  // organiser creates before they have decided which seller it belongs to.
  //
  // Failing to an empty set is the only safe direction. Somebody who should see
  // their books and sees none will say so within the hour; somebody who should
  // see none and sees twenty thousand says nothing at all.
  if (!user.agentId) return {};

  var books = readBooksRaw_();
  var set = {};
  for (var i = 0; i < books.length; i++) {
    if (books[i].Held_By_Agent === user.agentId) {
      set[String(books[i].Book_Number).toUpperCase()] = true;
    }
  }
  return set;
}

/**
 * What each kind of user is allowed to see on a ticket row.
 *
 * A VIEWER gets the phone partly hidden, as before.
 *
 * An AGENT gets everything on the tickets in the books they are carrying —
 * they made those sales and have to be able to telephone those buyers — and
 * NOTHING PERSONAL on anybody else's. The number, the status and the book stay
 * visible so "is KS-1234 still going?" still has an answer, which is a question
 * sellers genuinely ask each other; the buyer's name, phone, area and any note
 * do not, because they are none of that seller's business.
 *
 * This was the gap worth closing. Until now the wire carried every buyer's name
 * and telephone number to every signed-in seller — twenty thousand rows of it —
 * and most of those buyers are refugees. The row was masked for viewers only,
 * which quietly made a seller more trusted with other people's contact details
 * than somebody given read-only access on purpose.
 */
function maskWireRow_(row, user, holds) {
  if (!user) return row;

  if (user.role === ROLES.VIEWER) {
    var v = row.slice();
    v[WIRE_PHONE] = maskPhone_(v[WIRE_PHONE]);
    return v;
  }

  if (holds && user.role === ROLES.AGENT) {
    if (holds[String(row[WIRE_BOOK]).toUpperCase()]) return row;   // their own book
    var c = row.slice();
    c[WIRE_NAME] = '';
    c[WIRE_PHONE] = '';
    c[WIRE_ZONE] = '';
    c[WIRE_NOTES] = '';
    return c;
  }

  return row;
}

function ticketToWire_(t, user) {
  return maskWireRow_(ticketToWireRaw_(t), user, agentBookSet_(user));
}

// ============ THE TICKET TABLE CACHE ============

/**
 * Reading six thousand rows out of the spreadsheet takes the better part of a
 * second, and a cold boot did it three times over — once per snapshot page —
 * while read_delta did it again just to find the four rows that had changed.
 *
 * The wire payload is cached instead, keyed by a counter the router bumps after
 * every write. Keying by version rather than by time is the point: a stale
 * table cannot outlive the write that invalidated it, so nobody is ever offered
 * a ticket that somebody else has already sold.
 *
 * CacheService refuses a value over 100 KB, so the JSON is split across
 * numbered keys with a count key beside it. A missing chunk (eviction is always
 * allowed) falls back to the sheet rather than serving half a table.
 */
var TICKET_CACHE_TTL = 21600;      // 6 hours; the version key is the real expiry
var TICKET_CHUNK_CHARS = 90000;    // under the 100 KB per-value ceiling

function cachedTicketRows_() {
  var cache = CacheService.getScriptCache();
  var prefix = 'tix_' + ticketCacheVersion_() + '_';

  var countRaw = cache.get(prefix + 'n');
  if (countRaw) {
    var n = parseInt(countRaw, 10);
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(prefix + i);
    var got = cache.getAll(keys) || {};
    var parts = [];
    var complete = true;
    for (var k = 0; k < n; k++) {
      var piece = got[prefix + k];
      if (piece === null || piece === undefined) { complete = false; break; }
      parts.push(piece);
    }
    if (complete) {
      try { return JSON.parse(parts.join('')); } catch (e) { /* rebuild below */ }
    }
  }

  var tickets = readTicketsRaw_();
  var rows = [];
  for (var t = 0; t < tickets.length; t++) rows.push(ticketToWireRaw_(tickets[t]));

  var json = JSON.stringify(rows);
  var chunks = {};
  var count = 0;
  for (var p = 0; p < json.length; p += TICKET_CHUNK_CHARS) {
    chunks[prefix + count] = json.substring(p, p + TICKET_CHUNK_CHARS);
    count++;
  }
  chunks[prefix + 'n'] = String(count);
  try { cache.putAll(chunks, TICKET_CACHE_TTL); } catch (e) { /* over quota: serve uncached */ }

  return rows;
}

function maskPhone_(phone) {
  var s = String(phone || '');
  if (s.length < 4) return s ? '••••' : '';
  return '••••' + s.slice(-3);
}

/**
 * Full ticket table, in pages. The browser builds its search index from this
 * once on load, then keeps up with read_delta.
 */
function handleReadSnapshot(payload, user) {
  var offset = parseInt(payload.offset || 0, 10) || 0;
  var limit = Math.min(parseInt(payload.limit || 2000, 10) || 2000, 3000);

  // Only what is in play. Held-back tickets keep their rows and their cache
  // entry — the line moves by changing one number, so nothing is rebuilt when
  // more are released — but they are not sent, which is the point: a raffle
  // holding back half its tickets loads half the data.
  var cfg = getConfig();
  var all = cachedTicketRows_();
  var active = Math.min(activeTickets(cfg), all.length);

  var slice = all.slice(offset, Math.min(offset + limit, active));
  var holds = agentBookSet_(user);
  var rows = [];
  for (var i = 0; i < slice.length; i++) rows.push(maskWireRow_(slice[i], user, holds));

  return {
    fields: TICKET_WIRE_FIELDS,
    rows: rows,
    offset: offset,
    returned: rows.length,
    total: active,
    generated: all.length,
    hasMore: offset + rows.length < active,
    // Stamped so the client can tell later whether anything has moved without
    // asking for the rows again.
    version: ticketCacheVersion_(),
    serverTime: new Date().toISOString()
  };
}

/**
 * Only tickets changed since a timestamp. This replaces the old design's
 * 30-second full-table fetch, which overwrote local edits every time it ran.
 */
function handleReadDelta(payload, user) {
  var since = payload.since ? new Date(payload.since) : null;
  if (!since || isNaN(since.getTime())) {
    throw new ApiError('BAD_REQUEST', 'read_delta needs a valid "since" timestamp.');
  }

  var all = cachedTicketRows_();
  var active = Math.min(activeTickets(getConfig()), all.length);
  var cutoff = since.getTime();
  var holds = agentBookSet_(user);
  var rows = [];
  for (var i = 0; i < active; i++) {          // held-back tickets never appear
    var modified = all[i][WIRE_MODIFIED];
    if (!modified) continue;
    var at = new Date(modified).getTime();
    if (at > cutoff) rows.push(maskWireRow_(all[i], user, holds));
  }
  return {
    fields: TICKET_WIRE_FIELDS,
    rows: rows,
    count: rows.length,
    version: ticketCacheVersion_(),
    serverTime: new Date().toISOString()
  };
}

/**
 * The cheapest call in the API: two Script Property reads and no spreadsheet at
 * all. A client polls this to find out whether it is out of date, and only asks
 * for rows when one of the counters has moved.
 */
function handleReadVersion(payload, user) {
  // The waiting-approvals count rides along on the poll that already happens,
  // so an owner sitting on the Approvals screen learns that a request arrived
  // without a second round trip. A request nobody is told about is the same as
  // no request, and the person who asked is left wondering whether the button
  // worked.
  var waiting = 0;
  try {
    var pending = readPendingRaw_();
    var now = new Date();
    for (var i = 0; i < pending.rows.length; i++) {
      var r = pending.rows[i];
      if (String(r.Status) !== APPROVAL_STATUS.PENDING) continue;
      if (isStale_(r, now)) continue;
      // Anybody but the owner is told only about their own — which is what
      // they are waiting on: has mine been decided yet.
      if (!user.isSuperAdmin &&
          String(r.Requested_By || '').trim().toLowerCase() !== user.email) continue;
      waiting++;
    }
  } catch (e) { waiting = 0; }   // an older deployment has no approvals tab

  // Books coming due, so a banner can clear itself rather than be dismissed.
  // The counts come from the books; there is nothing to tick away. Scoped the
  // same as every other read — a seller is told about the books in their own
  // hands, because a seller shown the whole raffle's overdue count cannot act
  // on it and learns to ignore the banner.
  var booksLate = 0, booksDueSoon = 0, dueSoonBy = '';
  try {
    var cfgD = getConfig();
    var todayD = dayStart_(new Date());
    var soonD = new Date(todayD.getTime() + 7 * 86400000);
    dueSoonBy = isoDay_(soonD);
    var allBooks = readBooksRaw_();
    for (var bi = 0; bi < allBooks.length; bi++) {
      var bk = allBooks[bi];
      if (bk.Status !== BOOK_STATUS.OUT) continue;
      if (user.role === ROLES.AGENT && bk.Held_By_Agent !== user.agentId) continue;
      if (!bk.Due_Date) continue;
      var due = dayStart_(bk.Due_Date);
      if (!due) continue;
      if (due.getTime() < todayD.getTime()) booksLate++;
      else if (due.getTime() <= soonD.getTime()) booksDueSoon++;
    }
  } catch (e) { booksLate = 0; booksDueSoon = 0; }

  return {
    tickets: ticketCacheVersion_(),
    books: bookCacheVersion_(),
    approvalsWaiting: waiting,
    booksLate: booksLate,
    booksDueSoon: booksDueSoon,
    dueSoonBy: dueSoonBy,
    scope: user.role === ROLES.AGENT ? 'mine' : 'all',
    serverTime: new Date().toISOString()
  };
}

// ============ WRITING ============

/**
 * Applies a field patch to one ticket row and writes it back in a single call.
 * Bumps Version and stamps who changed it.
 *
 * The Tickets sheet has no formula columns, so writing the whole row back is
 * safe here. (Books does — see writeBookFields_.)
 */
function writeTicketRow_(sheet, map, rowNum, current, patch, user) {
  var lastCol = sheet.getLastColumn();
  var values = current._raw.slice();

  for (var field in patch) {
    if (!map[field]) continue;
    values[map[field] - 1] = patch[field];
  }
  values[map.Version - 1] = (parseInt(current.Version, 10) || 0) + 1;
  values[map.Recorded_By - 1] = user.email;
  values[map.Modified_Date - 1] = new Date();

  sheet.getRange(rowNum, 1, 1, lastCol).setValues([values]);
  return values[map.Version - 1];
}

/** Loads one ticket with its raw row, ready for patching. */
function loadTicket_(ticketNumber) {
  var sheet = sheet_(SHEET.TICKETS);
  var cfg = getConfig();
  var rowNum = findTicketRow(sheet, ticketNumber, cfg);
  if (!rowNum) {
    throw new ApiError('TICKET_NOT_FOUND', 'Ticket ' + ticketNumber + ' was not found.');
  }
  var map = headerMap(sheet);
  var raw = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  var obj = rowToObject_(raw, map);
  obj._raw = raw;
  obj._row = rowNum;
  return { sheet: sheet, map: map, row: rowNum, ticket: obj };
}

/**
 * Optimistic concurrency. Two helpers with the same ticket open must not both
 * be able to sell it — the second one is told what happened instead of
 * silently overwriting the first.
 */
function assertVersion_(ticket, expectedVersion, user) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') {
    if (user.isAdmin) return; // admins may force through the UI's "overwrite" path
    throw new ApiError('MISSING_FIELD', 'expectedVersion is required.');
  }
  var current = parseInt(ticket.Version, 10) || 0;
  if (parseInt(expectedVersion, 10) !== current) {
    throw new ApiError('VERSION_CONFLICT',
      'This ticket was changed by ' + (ticket.Recorded_By || 'someone else') + ' while you were working on it.',
      { currentVersion: current, yourVersion: parseInt(expectedVersion, 10), current: ticketToWire_(ticket, user) });
  }
}

function handleSellTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var buyerName = requireField_(payload, 'buyerName');
  var buyerPhone = requireField_(payload, 'buyerPhone');

  if (normalisePhone(buyerPhone).length < 7) {
    throw new ApiError('BAD_PHONE', 'That phone number looks too short to call back.');
  }

  var bookNum = assertCanWriteTicket(user, ticketNumber, { force: payload.force });
  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;

  if (t.Status === TICKET_STATUS.SOLD) {
    throw new ApiError('ALREADY_SOLD',
      'Ticket ' + ticketNumber + ' was already sold to ' + (t.Buyer_Name || 'someone') + '.',
      { current: ticketToWire_(t, user) });
  }
  if (t.Status === TICKET_STATUS.VOID) {
    throw new ApiError('TICKET_VOID', 'Ticket ' + ticketNumber + ' has been voided.');
  }
  assertVersion_(t, payload.expectedVersion, user);

  var cfg = getConfig();
  var agentId = payload.agentId || user.agentId || heldByAgent_(bookNum);

  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, {
    Status: payload.donated ? TICKET_STATUS.DONATED : TICKET_STATUS.SOLD,
    Buyer_Name: buyerName,
    Buyer_Phone: String(buyerPhone).trim(),
    Buyer_Zone: payload.buyerZone || '',
    Sold_By_Agent: agentId,
    Amount: payload.amount !== undefined && user.isAdmin
      ? parseFloat(payload.amount)
      : cfgFloat(cfg, 'TICKET_PRICE', 10),
    Payment_Status: payload.paymentStatus || 'Paid',
    Sale_Date: new Date(),
    Notes: payload.notes || t.Notes || '',
    Source: user.isAdmin && !user.agentId ? 'admin' : 'live'
  }, user);

  logAudit('SELL', { ticket: ticketNumber, book: bookNum, buyer: buyerName, agent: agentId }, user.email);
  return { ticketNumber: ticketNumber, status: TICKET_STATUS.SOLD, version: version };
}

function handleReserveTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var buyerName = requireField_(payload, 'buyerName');

  var bookNum = assertCanWriteTicket(user, ticketNumber, { force: payload.force });
  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;

  if (t.Status !== TICKET_STATUS.AVAILABLE) {
    throw new ApiError('NOT_AVAILABLE',
      'Ticket ' + ticketNumber + ' is ' + String(t.Status).toLowerCase() + ', so it cannot be reserved.',
      { current: ticketToWire_(t, user) });
  }
  assertVersion_(t, payload.expectedVersion, user);

  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, {
    Status: TICKET_STATUS.RESERVED,
    Buyer_Name: buyerName,
    Buyer_Phone: payload.buyerPhone || '',
    Buyer_Zone: payload.buyerZone || '',
    Sold_By_Agent: user.agentId || heldByAgent_(bookNum),
    Payment_Status: 'Unpaid',
    Notes: payload.notes || ''
  }, user);

  logAudit('RESERVE', { ticket: ticketNumber, buyer: buyerName }, user.email);
  return { ticketNumber: ticketNumber, status: TICKET_STATUS.RESERVED, version: version };
}

function handleReleaseTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  assertCanWriteTicket(user, ticketNumber, { force: payload.force });

  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;
  if (t.Status !== TICKET_STATUS.RESERVED) {
    throw new ApiError('NOT_RESERVED', 'Ticket ' + ticketNumber + ' is not reserved.');
  }
  assertVersion_(t, payload.expectedVersion, user);

  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, blankSaleFields_(), user);
  logAudit('RELEASE', { ticket: ticketNumber }, user.email);
  return { ticketNumber: ticketNumber, status: TICKET_STATUS.AVAILABLE, version: version };
}

function blankSaleFields_() {
  return {
    Status: TICKET_STATUS.AVAILABLE,
    Buyer_Name: '', Buyer_Phone: '', Buyer_Zone: '',
    Sold_By_Agent: '', Amount: '', Payment_Status: '',
    Sale_Date: '', Source: ''
  };
}

/**
 * Fix a mistake. Always leaves a trail — if correcting an error is hard or
 * invisible, volunteers stop using the system and the data rots.
 */
function handleCorrectTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var reason = requireField_(payload, 'reason');

  assertCanWriteTicket(user, ticketNumber, { force: payload.force });
  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;
  assertVersion_(t, payload.expectedVersion, user);

  var allowed = ['Buyer_Name', 'Buyer_Phone', 'Buyer_Zone', 'Payment_Status', 'Notes', 'Status', 'Sold_By_Agent'];
  var patch = {};
  var before = {};
  for (var i = 0; i < allowed.length; i++) {
    var f = allowed[i];
    if (payload[f] !== undefined) {
      before[f] = t[f] instanceof Date ? t[f].toISOString() : t[f];
      patch[f] = payload[f];
    }
  }
  if (!Object.keys(patch).length) {
    throw new ApiError('NOTHING_TO_DO', 'No changed fields were supplied.');
  }
  // A status change is not an ordinary correction, and this is the field that
  // makes correct_ticket dangerous: Void and Donated each have their own action
  // with its own gate. void_ticket is super-admin-only, so allowing the same
  // value through here was a way straight around that gate -- and it logged as
  // CORRECT rather than VOID, so the audit trail did not show a ticket leaving
  // the draw. Both statuses are now refused outright, for everyone.
  if (patch.Status !== undefined) {
    var nextStatus = String(patch.Status);
    if (nextStatus === TICKET_STATUS.VOID) {
      throw new ApiError('USE_VOID_ACTION',
        'Voiding a ticket is done with the void action, not a correction.');
    }
    if (nextStatus === TICKET_STATUS.DONATED) {
      throw new ApiError('USE_SELL_ACTION',
        'A donated ticket is recorded when the sale is recorded, not by correction.');
    }
    if (!user.isAdmin) {
      throw new ApiError('INSUFFICIENT_ROLE', 'Only an organiser can change a ticket status.');
    }
  }

  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, patch, user);
  logAudit('CORRECT', { ticket: ticketNumber, reason: reason, before: before, after: patch }, user.email);
  return { ticketNumber: ticketNumber, version: version };
}

function handleVoidTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var reason = requireField_(payload, 'reason');

  // This handler deliberately does not go through assertCanWriteTicket — a
  // super admin voids a ticket regardless of who holds the book. But a ticket
  // that is not in play yet is a different matter: voiding it would take it out
  // of the draw before anybody had decided to release it.
  assertTicketReleased_(ticketNumber);

  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;
  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, {
    Status: TICKET_STATUS.VOID,
    Notes: (t.Notes ? t.Notes + ' | ' : '') + 'Voided: ' + reason
  }, user);

  logAudit('VOID', { ticket: ticketNumber, reason: reason }, user.email);
  return { ticketNumber: ticketNumber, status: TICKET_STATUS.VOID, version: version };
}

/**
 * The counterfoil stack: a pile of returned stubs keyed in one go.
 *
 * Atomic on purpose — everything is validated before anything is written. A
 * half-applied batch of 180 sales is worse than a rejected one.
 */
function handleBulkRecordSales(payload, user) {
  var sales = payload.sales;
  if (!sales || !sales.length) throw new ApiError('BAD_REQUEST', 'No sales supplied.');
  if (sales.length > 500) throw new ApiError('RANGE_TOO_LARGE', 'Record at most 500 sales at a time.');

  var cfg = getConfig();
  var sheet = sheet_(SHEET.TICKETS);
  var map = headerMap(sheet);
  var lastCol = sheet.getLastColumn();
  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);

  // --- Pass 1: validate everything ---
  var prepared = [];
  var failures = [];
  var seen = {};

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i] || {};
    var num = String(s.ticketNumber || '').trim();
    try {
      if (!num) throw new ApiError('MISSING_FIELD', 'Ticket number is blank.');
      if (seen[num.toUpperCase()]) throw new ApiError('DUPLICATE_IN_BATCH', 'Listed twice in this batch.');
      seen[num.toUpperCase()] = true;

      if (isBlank_(s.buyerName)) throw new ApiError('MISSING_FIELD', 'Buyer name is required.');
      if (normalisePhone(s.buyerPhone).length < 7) throw new ApiError('BAD_PHONE', 'Phone number is too short.');

      var bookNum = assertCanWriteTicket(user, num, { force: payload.force });
      var rowNum = findTicketRow(sheet, num, cfg);
      if (!rowNum) throw new ApiError('TICKET_NOT_FOUND', 'Not found.');

      prepared.push({ num: num, row: rowNum, book: bookNum, sale: s });
    } catch (err) {
      failures.push({ ticketNumber: num, code: err.code || 'ERROR', message: err.message });
    }
  }

  if (failures.length) {
    throw new ApiError('BATCH_REJECTED',
      failures.length + ' of ' + sales.length + ' entries have problems. Nothing was saved.',
      { failures: failures });
  }

  // --- Pass 2: read current rows, check they are still sellable ---
  for (var j = 0; j < prepared.length; j++) {
    var raw = sheet.getRange(prepared[j].row, 1, 1, lastCol).getValues()[0];
    var cur = rowToObject_(raw, map);
    if (cur.Status === TICKET_STATUS.SOLD || cur.Status === TICKET_STATUS.VOID) {
      failures.push({
        ticketNumber: prepared[j].num,
        code: cur.Status === TICKET_STATUS.SOLD ? 'ALREADY_SOLD' : 'TICKET_VOID',
        message: 'Ticket is already ' + String(cur.Status).toLowerCase() + '.'
      });
    }
    prepared[j].raw = raw;
    prepared[j].current = cur;
  }
  if (failures.length) {
    throw new ApiError('BATCH_REJECTED',
      failures.length + ' entries could not be saved. Nothing was written.',
      { failures: failures });
  }

  // --- Pass 3: write ---
  var now = new Date();
  var written = 0;
  for (var k = 0; k < prepared.length; k++) {
    var p = prepared[k];
    var vals = p.raw.slice();
    vals[map.Status - 1] = TICKET_STATUS.SOLD;
    vals[map.Buyer_Name - 1] = String(p.sale.buyerName).trim();
    vals[map.Buyer_Phone - 1] = String(p.sale.buyerPhone).trim();
    vals[map.Buyer_Zone - 1] = p.sale.buyerZone || '';
    vals[map.Sold_By_Agent - 1] = p.sale.agentId || heldByAgent_(p.book) || '';
    vals[map.Amount - 1] = price;
    vals[map.Payment_Status - 1] = 'Paid';
    vals[map.Sale_Date - 1] = now;
    vals[map.Source - 1] = 'settlement';
    vals[map.Version - 1] = (parseInt(p.current.Version, 10) || 0) + 1;
    vals[map.Recorded_By - 1] = user.email;
    vals[map.Modified_Date - 1] = now;

    sheet.getRange(p.row, 1, 1, lastCol).setValues([vals]);
    written++;
  }

  logAudit('BULK_RECORD', { count: written, first: prepared[0].num }, user.email);
  return { recorded: written };
}
