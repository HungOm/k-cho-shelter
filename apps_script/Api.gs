/**
 * K'Cho Shelter — Api.gs
 *
 * Request router, response envelopes, and the write lock.
 *
 * Transport note that matters more than it looks: the browser sends writes as
 * POST with Content-Type "text/plain". That keeps them CORS "simple requests",
 * so the browser never sends an OPTIONS preflight — which Apps Script has no
 * way to answer. Using application/json here would make every write fail with
 * an opaque CORS error.
 */

// ============ ACTION REGISTRY ============
//   roles: null         any signed-in user on the allowlist
//   roles: ADMIN_ONLY   admins and nobody else
//   roles: [a, b]       those roles, plus admin (admins always pass)
//   lock: true          wrap the handler in the script-wide write lock
//   kind                which rate-limit bucket it counts against

function actionRegistry() {
  return {
    // --- session ---
    ping:                  { fn: handlePing,              pub: true },
    whoami:                { fn: handleWhoami,            roles: null, kind: 'read' },

    // --- reading ---
    read_snapshot:         { fn: handleReadSnapshot,      roles: null, kind: 'read' },
    read_delta:            { fn: handleReadDelta,         roles: null, kind: 'read' },
    read_version:          { fn: handleReadVersion,       roles: null, kind: 'read' },

    // --- tickets ---
    sell_ticket:           { fn: handleSellTicket,        roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    reserve_ticket:        { fn: handleReserveTicket,     roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    release_ticket:        { fn: handleReleaseTicket,     roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    correct_ticket:        { fn: handleCorrectTicket,     roles: [ROLES.RECORDER], kind: 'write', lock: true },
    void_ticket:           { fn: handleVoidTicket,        roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    bulk_record_sales:     { fn: handleBulkRecordSales,   roles: [ROLES.RECORDER], kind: 'bulk', lock: true },

    // --- books ---
    list_books:            { fn: handleListBooks,         roles: null, kind: 'read' },
    issue_books:           { fn: handleIssueBooks,        roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    transfer_books:        { fn: handleTransferBooks,     roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    return_books:          { fn: handleReturnBooks,       roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    settle_book:           { fn: handleSettleBook,        roles: ADMIN_ONLY, kind: 'write', lock: true },
    set_book_status:       { fn: handleSetBookStatus,     roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    restock_books:         { fn: handleRestockBooks,      roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    handover_receipt:      { fn: handleHandoverReceipt,   roles: ADMIN_ONLY, kind: 'report' },

    // --- agents & users ---
    list_agents:           { fn: handleListAgents,        roles: null, kind: 'read' },
    upsert_agent:          { fn: handleUpsertAgent,       roles: ADMIN_ONLY, kind: 'write', lock: true },
    list_users:            { fn: handleListUsers,         roles: ADMIN_ONLY, kind: 'read' },
    upsert_user:           { fn: handleUpsertUser,        roles: ADMIN_ONLY, kind: 'write', lock: true },
    set_user_status:       { fn: handleSetUserStatus,     roles: ADMIN_ONLY, kind: 'write', lock: true },

    // --- reports ---
    report_outstanding:    { fn: handleReportOutstanding, roles: [ROLES.VIEWER, ROLES.RECORDER], kind: 'report' },
    report_overdue:        { fn: handleReportOverdue,     roles: [ROLES.RECORDER], kind: 'report' },
    report_missing_contact:{ fn: handleReportMissingContact, roles: [ROLES.RECORDER], kind: 'report' },
    report_draw_ready:     { fn: handleReportDrawReady,   roles: [ROLES.VIEWER, ROLES.RECORDER], kind: 'report' },
    export_entries:        { fn: handleExportEntries,     roles: ADMIN_ONLY, sup: true, kind: 'report' },
    agent_statement:       { fn: handleAgentStatement,    roles: [ROLES.AGENT, ROLES.RECORDER], kind: 'report' },
    read_audit:            { fn: handleReadAudit,         roles: ADMIN_ONLY, sup: true, kind: 'read' },

    // --- winners ---
    record_winner:         { fn: handleRecordWinner,      roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    list_winners:          { fn: handleListWinners,       roles: [ROLES.VIEWER, ROLES.RECORDER], kind: 'read' }
  };
}

// ============ ENTRY POINTS ============

function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOut_({
      ok: true,
      message: "K'Cho Shelter API is running. Deploy as a web app and call it from the tracker."
    });
  }
  return route_(readGetRequest_(e));
}

function doPost(e) {
  return route_(readPostRequest_(e));
}

function readGetRequest_(e) {
  var payload = {};
  for (var k in e.parameter) {
    if (k !== 'action' && k !== 'idToken') payload[k] = e.parameter[k];
  }
  return {
    action: e.parameter.action || 'ping',
    idToken: e.parameter.idToken || '',
    payload: payload
  };
}

function readPostRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    // A POST with no body usually means the client sent JSON content-type and
    // the browser turned it into a preflight that never arrived.
    return { action: '__bad_body__', idToken: '', payload: {} };
  }
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return { action: '__bad_body__', idToken: '', payload: {} };
  }
  return {
    action: body.action || '',
    idToken: body.idToken || '',
    payload: body.payload || {}
  };
}

// ============ ROUTER ============

function route_(req) {
  try {
    if (req.action === '__bad_body__') {
      throw new ApiError('BAD_REQUEST',
        'Request body could not be read. Send POST as Content-Type: text/plain with a JSON body.');
    }

    var spec = actionRegistry()[req.action];
    if (!spec) throw new ApiError('UNKNOWN_ACTION', 'Unknown action: ' + req.action);

    // ping is the only action reachable without signing in, and it returns
    // nothing about the data.
    if (spec.pub) return jsonOut_({ ok: true, data: spec.fn(req.payload) });

    var user = requireUser(req.idToken, spec.roles, spec.sup);
    checkRateLimit(user.email, spec.kind || 'read');

    var result = spec.lock
      ? withLock_(function () { return spec.fn(req.payload, user); })
      : spec.fn(req.payload, user);

    // One choke point, deliberately blunt. A cached ticket table that outlives
    // the write which changed it would offer somebody a ticket that has already
    // been sold, so every successful write invalidates it -- including the few
    // that touch no tickets at all. An unnecessary bump costs one sheet read;
    // a missed one costs the raffle its integrity.
    if (spec.kind === 'write' || spec.kind === 'bulk') bumpTicketCacheVersion();

    return jsonOut_({ ok: true, data: result });

  } catch (err) {
    if (err instanceof ApiError || err.code) {
      return jsonOut_({
        ok: false,
        error: { code: err.code, message: err.message, details: err.details || null }
      });
    }
    logAudit('SERVER_ERROR', { action: req && req.action, error: String(err), stack: err.stack });
    return jsonOut_({
      ok: false,
      error: { code: 'SERVER_ERROR', message: String(err && err.message ? err.message : err) }
    });
  }
}

function jsonOut_(obj) {
  obj.serverTime = new Date().toISOString();
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * One script-wide lock for all writes.
 *
 * Script scope rather than user scope on purpose: Apps Script already
 * serialises one user's own calls, but every helper writes to the same Sheet,
 * so user-level locking would protect nothing. With a handful of concurrent
 * users and sub-second writes, serialising them is invisible.
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new ApiError('LOCK_TIMEOUT', 'Someone else is saving right now. Try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ============ SHARED HANDLERS ============

function handlePing() {
  return { message: 'Connected', schema: 1 };
}

function handleWhoami(payload, user) {
  var cfg = getConfig();
  var myBooks = [];

  if (user.agentId) {
    var books = readBooksRaw_();
    for (var i = 0; i < books.length; i++) {
      if (books[i].Held_By_Agent === user.agentId && books[i].Status === BOOK_STATUS.OUT) {
        myBooks.push({
          book: books[i].Book_Number,
          first: books[i].First_Ticket,
          last: books[i].Last_Ticket,
          due: toIso_(books[i].Due_Date)
        });
      }
    }
  }

  return {
    email: user.email,
    name: user.displayName,
    role: user.role,
    isSuperAdmin: !!user.isSuperAdmin,
    agentId: user.agentId,
    myBooks: myBooks,
    config: {
      ticketPrefix: cfg.TICKET_PREFIX,
      ticketDigits: cfgNum(cfg, 'TICKET_DIGITS', 4),
      ticketStart: cfgNum(cfg, 'TICKET_START', 1),
      totalTickets: cfgNum(cfg, 'TOTAL_TICKETS', 0),
      ticketsPerBook: cfgNum(cfg, 'TICKETS_PER_BOOK', 10),
      bookPrefix: cfg.BOOK_PREFIX,
      bookDigits: cfgNum(cfg, 'BOOK_DIGITS', 3),
      totalBooks: totalBooks(cfg),
      ticketPrice: cfgFloat(cfg, 'TICKET_PRICE', 10),
      currency: cfg.CURRENCY || 'RM',
      defaultDueDays: cfgNum(cfg, 'DEFAULT_DUE_DAYS', 30),
      eventName: cfg.EVENT_NAME || '',
      orgName: cfg.ORG_NAME || '',
      drawDate: cfg.DRAW_DATE || ''
    }
  };
}

// ============ HELPERS USED ACROSS HANDLERS ============

function toIso_(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function requireField_(payload, name) {
  var v = payload[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new ApiError('MISSING_FIELD', 'Missing required field: ' + name);
  }
  return String(v).trim();
}

/** Digits only, with a Malaysian leading 60 normalised away, for matching. */
function normalisePhone(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.indexOf('60') === 0 && digits.length > 9) digits = '0' + digits.slice(2);
  return digits;
}

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}
