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

function ticketToWire_(t, user) {
  var row = [];
  for (var i = 0; i < TICKET_WIRE_FIELDS.length; i++) {
    var f = TICKET_WIRE_FIELDS[i];
    var v = t[f];
    if (f === 'Buyer_Phone' && user && user.role === ROLES.VIEWER) v = maskPhone_(v);
    if (v instanceof Date) v = v.toISOString();
    row.push(v === null || v === undefined ? '' : v);
  }
  return row;
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

  var tickets = readTicketsRaw_();
  var slice = tickets.slice(offset, offset + limit);
  var rows = [];
  for (var i = 0; i < slice.length; i++) rows.push(ticketToWire_(slice[i], user));

  return {
    fields: TICKET_WIRE_FIELDS,
    rows: rows,
    offset: offset,
    returned: rows.length,
    total: tickets.length,
    hasMore: offset + rows.length < tickets.length
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

  var tickets = readTicketsRaw_();
  var rows = [];
  for (var i = 0; i < tickets.length; i++) {
    var modified = tickets[i].Modified_Date;
    if (modified instanceof Date && modified.getTime() > since.getTime()) {
      rows.push(ticketToWire_(tickets[i], user));
    }
  }
  return { fields: TICKET_WIRE_FIELDS, rows: rows, count: rows.length };
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
  if (patch.Status && !user.isAdmin && patch.Status === TICKET_STATUS.VOID) {
    throw new ApiError('INSUFFICIENT_ROLE', 'Only an admin can void a ticket.');
  }

  var version = writeTicketRow_(ctx.sheet, ctx.map, ctx.row, t, patch, user);
  logAudit('CORRECT', { ticket: ticketNumber, reason: reason, before: before, after: patch }, user.email);
  return { ticketNumber: ticketNumber, version: version };
}

function handleVoidTicket(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var reason = requireField_(payload, 'reason');

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
