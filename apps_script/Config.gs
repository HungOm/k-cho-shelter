/**
 * K'Cho Shelter — Config.gs
 *
 * Sheet names, column layouts, the Config tab reader, and the ticket<->book
 * arithmetic that the rest of the system depends on.
 *
 * Nothing about ticket numbering is hardcoded. Everything lives in the Config
 * tab so it can be changed before tickets are printed.
 */

// ============ SHEET NAMES ============

var SHEET = {
  TICKETS: 'Tickets',
  BOOKS: 'Books',
  BOOK_HISTORY: 'Book_History',
  AGENTS: 'Agents',
  USERS: 'Users',
  PERMISSIONS: 'Permissions',
  PENDING: 'Pending',
  WINNERS: 'Winners',
  CONFIG: 'Config',
  AUDIT: '_AuditLog'
};

// ============ COLUMN LAYOUTS ============
// Order matters only at creation time. Everything afterwards resolves
// positions by header name, so inserting a column later is harmless.

var COLS = {
  TICKETS: [
    'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
    'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
    'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date'
  ],
  // The last four are ARRAYFORMULA columns. The server must never write them.
  BOOKS: [
    'Book_Number', 'First_Ticket', 'Last_Ticket', 'Status', 'Held_By_Agent',
    'Issued_Date', 'Due_Date', 'Declared_Sold', 'Amount_Due', 'Amount_Paid',
    'Settled_Date', 'Settled_By', 'Notes', 'Version', 'Modified_By',
    'Modified_Date', 'Recorded_Sold', 'Recorded_Amount', 'Variance_Sold',
    'Variance_Amount'
  ],
  BOOK_HISTORY: ['Timestamp', 'Book_Number', 'From_Agent', 'To_Agent', 'Action', 'By_User', 'Note'],
  AGENTS: ['Agent_ID', 'Name', 'Phone', 'Zone', 'Active', 'Notes'],
  USERS: ['Email', 'Name', 'Role', 'Active', 'Agent_ID', 'Google_Sub', 'Added_By', 'Added_Date'],
  PERMISSIONS: ['Action', 'admin', 'recorder', 'agent', 'viewer'],
  PENDING: [
    'Request_ID', 'Action', 'Payload', 'Summary', 'Detail', 'Requested_By', 'Requested_At',
    'Expires_At', 'Status', 'Decided_By', 'Decided_At', 'Note'
  ],
  WINNERS: ['Ticket_Number', 'Prize', 'Drawn_Date', 'Buyer_Name', 'Buyer_Phone',
            'Notified', 'Claimed', 'Claimed_Date', 'Notes', 'Recorded_By'],
  CONFIG: ['Key', 'Value', 'Notes'],
  AUDIT: ['Timestamp', 'Action', 'Details', 'Email']
};

/** Books columns the server is forbidden to write (they hold formulas). */
var BOOKS_FORMULA_COLS = ['Recorded_Sold', 'Recorded_Amount', 'Variance_Sold', 'Variance_Amount'];

// ============ STATUS VALUES ============

var TICKET_STATUS = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  DONATED: 'Donated',
  VOID: 'Void'
};

var BOOK_STATUS = {
  UNASSIGNED: 'Unassigned',
  OUT: 'Out',
  RETURNED: 'Returned',
  SETTLED: 'Settled',
  LOST: 'Lost',
  VOID: 'Void'
};

var ROLES = { ADMIN: 'admin', RECORDER: 'recorder', AGENT: 'agent', VIEWER: 'viewer' };

/** Books in these states are frozen — no ticket writes without admin force. */
var CLOSED_BOOK_STATUSES = [BOOK_STATUS.SETTLED, BOOK_STATUS.VOID];

// ============ CONFIG DEFAULTS ============
// Seeded into the Config tab by setup(). Change them IN THE SHEET, not here.

var CONFIG_DEFAULTS = [
  ['TICKET_PREFIX', 'KS-', 'Text before the number. May be empty. LOCKED after setup.'],
  ['TICKET_START', '1', 'First ticket number. LOCKED after setup.'],
  ['TICKET_DIGITS', '5', 'Zero padding, e.g. 5 gives KS-00001. LOCKED after setup.'],
  ['TOTAL_TICKETS', '10000', 'How many tickets exist. Only the super admin can raise it later, '
    + 'and only upwards — see expandTickets. Never lower it.'],
  ['TICKETS_PER_BOOK', '10', 'Tickets in one physical book. LOCKED after setup.'],
  ['BOOK_PREFIX', 'Book-', 'Text before the book number. LOCKED after setup.'],
  ['BOOK_DIGITS', '4', 'Zero padding, e.g. 4 gives Book-0001. LOCKED after setup.'],
  ['TICKET_PRICE', '10', 'Price of one ticket. Can be changed later.'],
  ['CURRENCY', 'RM', 'Shown on reports and receipts.'],
  ['DEFAULT_DUE_DAYS', '30', 'Default return period when books are issued.'],
  ['EVENT_NAME', "K'Cho Shelter Fundraising Raffle", 'Shown on receipts.'],
  ['ORG_NAME', "K'Cho Ethnic Association Malaysia", 'Shown on receipts.'],
  ['PROJECT_CODE', '', 'Short code for this raffle, e.g. CS-2026. Shown on receipts and reports. '
    + 'NOT part of ticket numbers, so it is safe to change at any time.'],
  ['DRAW_DATE', '', 'Draw date, e.g. 2026-12-20.']
];

/**
 * Keys that define ticket numbering. Once tickets exist these are refused,
 * because changing a prefix after tickets are printed silently orphans
 * every record in the Sheet.
 */
/**
 * The numbering settings, which the documentation promises are locked once
 * tickets exist — because every ticket number in the Tickets tab is a stored
 * string, while every lookup recomputes the number from these settings. Change
 * the prefix and the two stop agreeing: searching for a ticket finds nothing,
 * selling one says it does not exist, and the paper in somebody's hand no
 * longer refers to anything. Nothing throws, it simply stops matching.
 *
 * This list existed but was never referenced. assertNumberingUnchanged_ below
 * is what actually enforces it.
 */
var LOCKED_CONFIG_KEYS = [
  'TICKET_PREFIX', 'TICKET_START', 'TICKET_DIGITS', 'TOTAL_TICKETS',
  'TICKETS_PER_BOOK', 'BOOK_PREFIX', 'BOOK_DIGITS'
];

var CONFIG_CACHE_TTL = 300;   // seconds
var USER_CACHE_TTL = 60;      // short, so revoking access takes effect fast
var TOKEN_CACHE_TTL = 300;    // capped again by the token's own expiry
var LOCK_TIMEOUT_MS = 20000;

// ============ CONFIG READER ============

/**
 * Refuses every write if the numbering settings have moved since setup.
 *
 * The fingerprint is kept in Script Properties, out of the spreadsheet, so
 * editing the Config tab by hand cannot quietly rewrite the thing it is being
 * checked against.
 *
 * A deployment from before this existed has no fingerprint. It is recorded on
 * first sight rather than treated as a failure — otherwise turning this on
 * would lock out every raffle already running.
 */
/**
 * The fingerprint itself, in one place. It is written by two callers — the
 * check below and the re-stamp that ends a sanctioned expand — and two copies
 * of this loop would drift the first time the key list changed.
 */
function numberingFingerprint_(cfg) {
  cfg = cfg || getConfig();
  var parts = [];
  for (var i = 0; i < LOCKED_CONFIG_KEYS.length; i++) {
    parts.push(LOCKED_CONFIG_KEYS[i] + '=' + String(cfg[LOCKED_CONFIG_KEYS[i]] || ''));
  }
  return parts.join('|');
}

/**
 * Re-records the fingerprint after the one operation allowed to move a locked
 * key. Called LAST, once the rows the new setting promises actually exist —
 * stamping it earlier would bless a total the sheet cannot back.
 */
function restampNumberingFingerprint_() {
  invalidateConfigCache();
  PropertiesService.getScriptProperties()
    .setProperty('NUMBERING_FINGERPRINT', numberingFingerprint_(getConfig()));
}

function assertNumberingUnchanged_() {
  var props = PropertiesService.getScriptProperties();
  var cfg = getConfig();

  var now = numberingFingerprint_(cfg);
  var seen = props.getProperty('NUMBERING_FINGERPRINT');

  if (!seen) { props.setProperty('NUMBERING_FINGERPRINT', now); return; }
  if (seen === now) return;

  var changed = [];
  var before = {};
  var parts = seen.split('|');
  for (var p = 0; p < parts.length; p++) {
    var kv = parts[p].split('=');
    before[kv[0]] = kv.slice(1).join('=');
  }
  for (var k = 0; k < LOCKED_CONFIG_KEYS.length; k++) {
    var key = LOCKED_CONFIG_KEYS[k];
    var nowVal = String(cfg[key] || '');
    if (before[key] !== undefined && before[key] !== nowVal) {
      changed.push(key + ': "' + before[key] + '" became "' + nowVal + '"');
    }
  }

  throw new ApiError('NUMBERING_CHANGED',
    'The ticket numbering has been changed since the tickets were made (' +
    changed.join('; ') + '). Every ticket number already recorded was worked out ' +
    'with the old setting, so nothing will match until it is put back. Restore it ' +
    'in the Config tab, or start a new spreadsheet if the tickets have not been printed.',
    { changed: changed });
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new ApiError('SHEET_MISSING', 'Sheet "' + name + '" not found. Run setup() first.');
  return s;
}

/**
 * Reads the Config tab into a plain object. Cached, because almost every
 * request needs it.
 */
function getConfig() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('config_v1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fall through and re-read */ }
  }

  var sheet = ss_().getSheetByName(SHEET.CONFIG);
  var cfg = {};
  if (sheet && sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i][0] || '').trim();
      if (key) cfg[key] = String(rows[i][1] === null || rows[i][1] === undefined ? '' : rows[i][1]).trim();
    }
  }

  // Fill any key a human deleted from the sheet, so the system still runs.
  for (var j = 0; j < CONFIG_DEFAULTS.length; j++) {
    var k = CONFIG_DEFAULTS[j][0];
    if (cfg[k] === undefined || cfg[k] === '') {
      if (k !== 'DRAW_DATE') cfg[k] = CONFIG_DEFAULTS[j][1];
    }
  }

  cache.put('config_v1', JSON.stringify(cfg), CONFIG_CACHE_TTL);
  return cfg;
}

/**
 * Writes one Config value back to the sheet. Deliberately not exposed as an
 * API action: the only caller is the expand below, which has already proved
 * the change is safe. Anything else belongs in the Config tab, by hand.
 */
function setConfigValue_(key, value) {
  var sheet = sheet_(SHEET.CONFIG);
  var last = sheet.getLastRow();
  if (last > 1) {
    var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || '').trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        invalidateConfigCache();
        return;
      }
    }
  }
  sheet.appendRow([key, value, '']);
  invalidateConfigCache();
}

function invalidateConfigCache() {
  CacheService.getScriptCache().remove('config_v1');
}

/** Numeric config value with a sane fallback. */
function cfgNum(cfg, key, fallback) {
  var n = parseInt(cfg[key], 10);
  return isNaN(n) ? fallback : n;
}

function cfgFloat(cfg, key, fallback) {
  var n = parseFloat(cfg[key]);
  return isNaN(n) ? fallback : n;
}

// ============ TICKET <-> BOOK ARITHMETIC ============
// This is the idea the whole system rests on: ticket and book numbers are
// arithmetically linked, so "which book does this ticket belong to" and
// "which row is it in" cost zero lookups.

function pad_(n, digits) {
  var s = String(n);
  while (s.length < digits) s = '0' + s;
  return s;
}

/** 1-based position of a ticket, or 0 if the number is not valid. */
function ticketIndex(ticketNumber, cfg) {
  cfg = cfg || getConfig();
  var prefix = cfg.TICKET_PREFIX || '';
  var raw = String(ticketNumber || '').trim();
  if (prefix && raw.toUpperCase().indexOf(prefix.toUpperCase()) !== 0) return 0;
  var numPart = prefix ? raw.slice(prefix.length) : raw;
  var n = parseInt(numPart, 10);
  if (isNaN(n)) return 0;
  var index = n - cfgNum(cfg, 'TICKET_START', 1) + 1;
  if (index < 1 || index > cfgNum(cfg, 'TOTAL_TICKETS', 0)) return 0;
  return index;
}

/** Builds a ticket number from a 1-based position. */
function ticketNumberAt(index, cfg) {
  cfg = cfg || getConfig();
  var n = cfgNum(cfg, 'TICKET_START', 1) + index - 1;
  return (cfg.TICKET_PREFIX || '') + pad_(n, cfgNum(cfg, 'TICKET_DIGITS', 4));
}

/** 1-based position of a book. */
function bookIndex(bookNumber, cfg) {
  cfg = cfg || getConfig();
  var prefix = cfg.BOOK_PREFIX || '';
  var raw = String(bookNumber || '').trim();
  if (prefix && raw.toUpperCase().indexOf(prefix.toUpperCase()) !== 0) return 0;
  var n = parseInt(prefix ? raw.slice(prefix.length) : raw, 10);
  if (isNaN(n) || n < 1 || n > totalBooks(cfg)) return 0;
  return n;
}

function bookNumberAt(index, cfg) {
  cfg = cfg || getConfig();
  return (cfg.BOOK_PREFIX || '') + pad_(index, cfgNum(cfg, 'BOOK_DIGITS', 3));
}

function totalBooks(cfg) {
  cfg = cfg || getConfig();
  return Math.ceil(cfgNum(cfg, 'TOTAL_TICKETS', 0) / cfgNum(cfg, 'TICKETS_PER_BOOK', 10));
}

/** The book a ticket belongs to — pure arithmetic, no I/O. */
function bookOfTicket(ticketNumber, cfg) {
  cfg = cfg || getConfig();
  var idx = ticketIndex(ticketNumber, cfg);
  if (!idx) return null;
  return bookNumberAt(Math.ceil(idx / cfgNum(cfg, 'TICKETS_PER_BOOK', 10)), cfg);
}

/** Inclusive 1-based ticket positions covered by a book. */
function ticketRangeOfBook(bookNumber, cfg) {
  cfg = cfg || getConfig();
  var bIdx = bookIndex(bookNumber, cfg);
  if (!bIdx) return null;
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);
  var total = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  return { first: (bIdx - 1) * per + 1, last: Math.min(bIdx * per, total) };
}

// ============ ROW RESOLUTION (fast path + verify) ============
// Correctness never depends on the sheet being in order; only speed does.

/**
 * Sheet row for a ticket. Tries the arithmetic row first and verifies the key
 * cell matches; falls back to a single-column scan if a human re-sorted the
 * sheet, and records that as SCHEMA_DRIFT.
 */
function findTicketRow(sheet, ticketNumber, cfg) {
  cfg = cfg || getConfig();
  var idx = ticketIndex(ticketNumber, cfg);
  if (!idx) return 0;

  // Compare against the canonical spelling, never against what the caller
  // typed. ticketIndex is deliberately tolerant — "KS-3721" plainly means
  // KS-03721, and refusing it would be unhelpful — so matching the raw input
  // against the stored key misses, falls through to the scan, misses again,
  // and logs SCHEMA_DRIFT on the way past. That alarm means "the sheet has
  // been re-sorted and the arithmetic no longer holds", which is a serious
  // thing to go looking for, and it was firing on a perfectly ordered sheet
  // because somebody left off a leading zero.
  var canonical = ticketNumberAt(idx, cfg);

  var fastRow = idx + 1; // +1 for the header row
  if (fastRow <= sheet.getLastRow()) {
    var probe = String(sheet.getRange(fastRow, 1).getValue() || '').trim();
    if (probe.toUpperCase() === canonical.toUpperCase()) return fastRow;
  }
  return scanForKey_(sheet, canonical, 'ticket');
}

function findBookRow(sheet, bookNumber, cfg) {
  cfg = cfg || getConfig();
  var idx = bookIndex(bookNumber, cfg);
  if (!idx) return 0;

  var canonical = bookNumberAt(idx, cfg);   // same reason as findTicketRow

  var fastRow = idx + 1;
  if (fastRow <= sheet.getLastRow()) {
    var probe = String(sheet.getRange(fastRow, 1).getValue() || '').trim();
    if (probe.toUpperCase() === canonical.toUpperCase()) return fastRow;
  }
  return scanForKey_(sheet, canonical, 'book');
}

function scanForKey_(sheet, key, kind) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
  var target = String(key).trim().toUpperCase();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0] || '').trim().toUpperCase() === target) {
      logAudit('SCHEMA_DRIFT', { kind: kind, key: key, foundAtRow: i + 2 });
      return i + 2;
    }
  }
  return 0;
}

// ============ HEADER INDEX ============

/** Map of header name -> 1-based column, cached per sheet. */
function headerMap(sheet) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'hdr_' + sheet.getSheetId();
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* re-read */ }
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim();
    if (h) map[h] = i + 1;
  }
  cache.put(cacheKey, JSON.stringify(map), CONFIG_CACHE_TTL);
  return map;
}

function invalidateHeaderCaches() {
  var cache = CacheService.getScriptCache();
  var names = [SHEET.TICKETS, SHEET.BOOKS, SHEET.BOOK_HISTORY, SHEET.AGENTS,
               SHEET.USERS, SHEET.WINNERS, SHEET.CONFIG, SHEET.AUDIT];
  for (var i = 0; i < names.length; i++) {
    var s = ss_().getSheetByName(names[i]);
    if (s) cache.remove('hdr_' + s.getSheetId());
  }
}

// ============ AUDIT LOG ============

function logAudit(action, details, email) {
  try {
    var sheet = ss_().getSheetByName(SHEET.AUDIT);
    if (!sheet) return;
    sheet.appendRow([
      new Date(),
      action,
      typeof details === 'string' ? details : JSON.stringify(details || {}),
      email || ''
    ]);
    // Keep the log from growing without bound.
    var last = sheet.getLastRow();
    if (last > 5200) sheet.deleteRows(2, last - 5000);
  } catch (e) {
    // Never let audit logging break a real operation.
  }
}
