/**
 * Raffled — Api.gs
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

    // ---- who may do what ----
    list_permissions:      { fn: handleListPermissions,   roles: ADMIN_ONLY, sup: true, kind: 'read' },
    set_permission:        { fn: handleSetPermission,     roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },

    // ---- two-person control ----
    request_approval:      { fn: handleRequestApproval,   roles: ADMIN_ONLY, kind: 'write', lock: true },
    list_approvals:        { fn: handleListApprovals,     roles: ADMIN_ONLY, kind: 'read' },
    cancel_approval:       { fn: handleCancelApproval,    roles: ADMIN_ONLY, kind: 'write', lock: true },
    decide_approval:       { fn: handleDecideApproval,    roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },

    // --- tickets ---
    sell_ticket:           { fn: handleSellTicket,        roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    reserve_ticket:        { fn: handleReserveTicket,     roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    release_ticket:        { fn: handleReleaseTicket,     roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    correct_ticket:        { fn: handleCorrectTicket,     roles: [ROLES.RECORDER], kind: 'write', lock: true },
    void_ticket:           { fn: handleVoidTicket,        roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    bulk_record_sales:     { fn: handleBulkRecordSales,   roles: [ROLES.RECORDER], kind: 'bulk', lock: true },
    sell_book:             { fn: handleSellBook,          roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'bulk', lock: true },

    // --- books ---
    list_books:            { fn: handleListBooks,         roles: null, kind: 'read' },
    issue_books:           { fn: handleIssueBooks,        roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    transfer_books:        { fn: handleTransferBooks,     roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    return_books:          { fn: handleReturnBooks,       roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    settle_book:           { fn: handleSettleBook,        roles: ADMIN_ONLY, kind: 'write', lock: true },
    // A helper takes cash at the table and must be able to write it down there
    // and then. What they cannot do is record it against somebody else, or
    // close a book — both change what another person is shown as owing.
    record_payment:        { fn: handleRecordPayment,     roles: [ROLES.RECORDER, ROLES.AGENT], kind: 'write', lock: true },
    reverse_payment:       { fn: handleReversePayment,    roles: ADMIN_ONLY, kind: 'write', lock: true },
    list_payments:         { fn: handleListPayments,      roles: [ROLES.VIEWER, ROLES.RECORDER, ROLES.AGENT], kind: 'read' },
    set_book_status:       { fn: handleSetBookStatus,     roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    restock_books:         { fn: handleRestockBooks,      roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    book_history:          { fn: handleBookHistory,       roles: null, kind: 'read' },
    handover_receipt:      { fn: handleHandoverReceipt,   roles: ADMIN_ONLY, kind: 'report' },
    expand_tickets:        { fn: handleExpandTickets,     roles: ADMIN_ONLY, sup: true, kind: 'bulk', lock: true },
    set_active_tickets:    { fn: handleSetActiveTickets,  roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    set_ticket_ceiling:    { fn: handleSetTicketCeiling,  roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },

    // --- deadlines ---
    // The monthly check-in is an admin's routine job: if it needed the super
    // admin every month it would stop happening, and a checkpoint nobody
    // reaches is worse than none. The final deadline is the promise made to
    // ticket buyers, so that one does not move without the super admin.
    deadline_status:       { fn: handleDeadlineStatus,    roles: null, kind: 'read' },
    roll_check_in:         { fn: handleRollCheckIn,       roles: ADMIN_ONLY, kind: 'bulk', lock: true },
    // A recorder too: this is whoever is at the table when a seller walks up
    // with a bag of counterfoils, and a report that has to wait for an
    // organiser to be free is a report written on the back of an envelope.
    record_check_in:       { fn: handleRecordCheckIn,     roles: [ROLES.RECORDER], kind: 'write', lock: true },
    set_final_deadline:    { fn: handleSetFinalDeadline,  roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    // Organisers only, enforced HERE rather than by hiding a button. Branding is
    // what a buyer sees on a receipt; it is not a thing a desk volunteer changes.
    upload_logo:           { fn: handleUploadLogo,        roles: ADMIN_ONLY, kind: 'write' },
    set_brand_color:       { fn: handleSetBrandColor,     roles: ADMIN_ONLY, kind: 'write' },

    // --- agents & users ---
    list_agents:           { fn: handleListAgents,        roles: null, kind: 'read' },
    upsert_agent:          { fn: handleUpsertAgent,       roles: ADMIN_ONLY, kind: 'write', lock: true },
    list_users:            { fn: handleListUsers,         roles: ADMIN_ONLY, kind: 'read' },
    upsert_user:           { fn: handleUpsertUser,        roles: ADMIN_ONLY, kind: 'write', lock: true },
    set_user_status:       { fn: handleSetUserStatus,     roles: ADMIN_ONLY, kind: 'write', lock: true },

    // --- reports ---
    report_outstanding:    { fn: handleReportOutstanding, roles: [ROLES.VIEWER, ROLES.RECORDER, ROLES.AGENT], kind: 'report' },
    report_overdue:        { fn: handleReportOverdue,     roles: [ROLES.RECORDER], kind: 'report' },
    report_missing_contact:{ fn: handleReportMissingContact, roles: [ROLES.RECORDER], kind: 'report' },
    report_draw_ready:     { fn: handleReportDrawReady,   roles: [ROLES.VIEWER, ROLES.RECORDER], kind: 'report' },
    export_entries:        { fn: handleExportEntries,     roles: ADMIN_ONLY, sup: true, kind: 'report' },
    agent_statement:       { fn: handleAgentStatement,    roles: [ROLES.AGENT, ROLES.RECORDER], kind: 'report' },
    read_audit:            { fn: handleReadAudit,         roles: ADMIN_ONLY, sup: true, kind: 'read' },

    // --- the prize schedule ---
    // Anyone signed in, sellers included. "What can I win?" is the question a
    // seller is asked by everybody they sell to, and an answer only an
    // organiser can open is an answer given from memory at the table.
    list_prizes:           { fn: handleListPrizes,        roles: null, kind: 'read' },
    // Organisers, NOT the owner alone. Setting up what is on offer is ordinary
    // organising, decided at a meeting like the sales-close date. The handler
    // holds the line that matters: changing a prize somebody has ALREADY WON
    // needs the System Admin, because by then it has been said out loud.
    upsert_prize:          { fn: handleUpsertPrize,       roles: ADMIN_ONLY, kind: 'write', lock: true },
    remove_prize:          { fn: handleRemovePrize,       roles: ADMIN_ONLY, kind: 'write', lock: true },
    upsert_prize_type:     { fn: handleUpsertPrizeType,   roles: ADMIN_ONLY, kind: 'write', lock: true },

    // --- winners ---
    record_winner:         { fn: handleRecordWinner,      roles: ADMIN_ONLY, sup: true, kind: 'write', lock: true },
    list_winners:          { fn: handleListWinners,       roles: [ROLES.VIEWER, ROLES.RECORDER], kind: 'read' },
    // A helper rings the winners and a helper is who is standing there when one
    // turns up for their hamper. Recording that is not the owner's job — it is
    // the job of whoever is at the table, which is what record_payment already
    // assumes about cash.
    set_winner_status:     { fn: handleSetWinnerStatus,   roles: [ROLES.RECORDER], kind: 'write', lock: true }
  };
}

/**
 * Labels for the permissions screen. Kept beside the registry rather than in it
 * so the registry stays a list of gates, but out of it so the gates stay
 * readable. `danger` marks the ones that take something away from somebody:
 * money already recorded, or a ticket's place in the draw.
 */
function actionMeta() {
  return {
    whoami:                 { group: 'Basics',  label: 'Sign in' },
    read_snapshot:          { group: 'Basics',  label: 'Load the tickets' },
    read_delta:             { group: 'Basics',  label: 'Load what changed' },
    read_version:          { group: 'Basics',  label: 'Check for changes' },

    sell_ticket:            { group: 'Tickets', label: 'Record a sale' },
    reserve_ticket:         { group: 'Tickets', label: 'Hold a ticket' },
    release_ticket:         { group: 'Tickets', label: 'Let a held ticket go' },
    correct_ticket:         { group: 'Tickets', label: 'Correct a sale', danger: true },
    void_ticket:            { group: 'Tickets', label: 'Void a ticket', danger: true },
    bulk_record_sales:      { group: 'Tickets', label: 'Record many sales at once' },
    sell_book:              { group: 'Tickets', label: 'Sell a whole book to one buyer' },

    list_books:             { group: 'Books',   label: 'See the books' },
    issue_books:            { group: 'Books',   label: 'Give books to a seller' },
    transfer_books:         { group: 'Books',   label: 'Move books between sellers' },
    return_books:           { group: 'Books',   label: 'Take books back' },
    set_book_status:        { group: 'Books',   label: 'Mark a book lost, or reopen it', danger: true },
    restock_books:          { group: 'Books',   label: 'Put unsold tickets back', danger: true },
    book_history:           { group: 'Books',   label: 'See where a book has been' },
    handover_receipt:       { group: 'Books',   label: 'Print a handover receipt' },
    expand_tickets:         { group: 'Books',   label: 'Make more tickets', danger: true },
    set_active_tickets:     { group: 'Books',   label: 'Change how many tickets are in play', danger: true },
    set_ticket_ceiling:     { group: 'Books',   label: 'Change the planned size of the raffle' },

    deadline_status:        { group: 'Books',   label: 'See the check-in and final dates' },
    roll_check_in:          { group: 'Books',   label: 'Move the check-in date on a month', danger: true },
    record_check_in:        { group: 'Books',   label: 'Record that a seller has reported' },
    set_final_deadline:     { group: 'Books',   label: 'Change the final deadline', danger: true },
    upload_logo:            { group: 'Access',  label: "Change the raffle's logo" },
    set_brand_color:        { group: 'Access',  label: "Change the raffle's colour" },

    settle_book:            { group: 'Money',   label: 'Settle a book', danger: true },
    record_payment:         { group: 'Money',   label: 'Record money handed in' },
    reverse_payment:        { group: 'Money',   label: 'Undo a recorded payment', danger: true },
    list_payments:          { group: 'Money',   label: 'See what has been handed in' },
    report_outstanding:     { group: 'Money',   label: 'Who still owes money' },
    agent_statement:        { group: 'Money',   label: "A seller's statement" },

    list_agents:            { group: 'People',  label: 'See the sellers' },
    upsert_agent:           { group: 'People',  label: 'Add or change a seller' },
    list_users:             { group: 'People',  label: 'See who can sign in' },
    upsert_user:            { group: 'People',  label: 'Add or change a user' },
    set_user_status:        { group: 'People',  label: 'Turn an account on or off', danger: true },

    report_overdue:         { group: 'Reports', label: 'Books that are late' },
    report_missing_contact: { group: 'Reports', label: 'Tickets with no phone number' },
    report_draw_ready:      { group: 'Reports', label: 'Is the draw ready' },
    export_entries:         { group: 'Reports', label: 'Download the entry list', danger: true },
    read_audit:             { group: 'Reports', label: 'The activity log' },
    record_winner:          { group: 'Reports', label: 'Record a winner', danger: true },
    list_winners:           { group: 'Reports', label: 'See the winners' },
    set_winner_status:      { group: 'Reports', label: 'Say a winner has been told or has collected' },
    list_prizes:            { group: 'Reports', label: 'See the prizes' },
    upsert_prize:           { group: 'Reports', label: 'Add or change a prize' },
    remove_prize:           { group: 'Reports', label: 'Take a prize off the list', danger: true },
    upsert_prize_type:      { group: 'Reports', label: 'Add or change a kind of prize' },

    list_permissions:       { group: 'Access',  label: 'See who can do what' },
    request_approval:       { group: 'Access',  label: 'Ask the organiser to approve something' },
    list_approvals:         { group: 'Access',  label: 'See what is waiting for approval' },
    cancel_approval:        { group: 'Access',  label: 'Withdraw your own request' },
    decide_approval:        { group: 'Access',  label: 'Approve or refuse a request', danger: true },
    set_permission:         { group: 'Access',  label: 'Change who can do what', danger: true }
  };
}

/**
 * Writes that provably never touch the Tickets sheet.
 *
 * The ticket cache is invalidated after every write, deliberately bluntly —
 * a missed invalidation offers somebody a ticket that is already sold, which is
 * far worse than a wasted one. But blunt had a cost worth removing: adding a
 * seller threw away the whole cached ticket table, so the next screen re-read
 * six thousand rows to show a name that has nothing to do with tickets.
 *
 * Only actions that touch people, permissions, approvals or book bookkeeping
 * are listed. Anything that reaches a ticket — directly, or through
 * settleTicketRows_, releaseReservedInBook_ or voidUnsoldInBook_ — is left off,
 * and a test re-derives this list from the source so it cannot go stale
 * quietly.
 */
var NO_TICKET_WRITES = [
  'upsert_agent', 'upsert_user', 'set_user_status', 'set_permission',
  'request_approval', 'cancel_approval', 'record_winner',
  'issue_books', 'transfer_books',
  // The prize schedule is not the ticket table. Throwing away six thousand
  // cached ticket rows because somebody renamed a hamper is the exact waste
  // this list exists to stop.
  'upsert_prize', 'remove_prize', 'upsert_prize_type', 'set_winner_status'
];

// ============ ENTRY POINTS ============

function doGet(e) {
  if (!e || !e.parameter) {
    return jsonOut_({
      ok: true,
      message: "Raffled API is running. Deploy as a web app and call it from the tracker."
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

    var user = requireUser(req.idToken, spec.roles, spec.sup, req.action);

    // Before anything is written, not after. A changed prefix means the numbers
    // in the sheet and the numbers the code computes have stopped agreeing, and
    // writing into that gap makes the damage permanent.
    if (spec.kind === 'write' || spec.kind === 'bulk') assertNumberingUnchanged_();
    checkRateLimit(user.email, spec.kind || 'read');

    // Two-person control, checked before the action runs rather than after.
    // The super admin is exempt: they are the person who would approve it.
    if (!user.isSuperAdmin) {
      var needsTwo = approvalSummaryFor_(req.action, req.payload);
      if (needsTwo) {
        throw new ApiError('APPROVAL_REQUIRED', needsTwo.text,
          { action: req.action, summary: needsTwo.text, detail: needsTwo });
      }
    }

    var result = spec.lock
      ? withLock_(function () { return spec.fn(req.payload, user); })
      : spec.fn(req.payload, user);

    // One choke point, deliberately blunt. A cached ticket table that outlives
    // the write which changed it would offer somebody a ticket that has already
    // been sold, so every successful write invalidates it -- including the few
    // that touch no tickets at all. An unnecessary bump costs one sheet read;
    // a missed one costs the raffle its integrity.
    if ((spec.kind === 'write' || spec.kind === 'bulk') &&
        NO_TICKET_WRITES.indexOf(req.action) === -1) {
      bumpTicketCacheVersion();
    }

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
 * The config the client reads, built in one place.
 *
 * Pulled out of handleWhoami so the branding handlers can answer with the SAME
 * object rather than a second one shaped like it. Both write config and both
 * return it, and a screen assigning state.cfg from one and then the other would
 * be reading two contracts — which is how six field-shape divergences happened
 * in this repository, every one a key built one way and read another.
 *
 * The Supabase half does the same thing in config.ts, for the same reason.
 */
function whoamiConfig_(cfg) {
  cfg = cfg || getConfig();
  return {
    ticketPrefix: cfg.TICKET_PREFIX,
    ticketDigits: cfgNum(cfg, 'TICKET_DIGITS', 4),
    ticketStart: cfgNum(cfg, 'TICKET_START', 1),
    totalTickets: activeTickets(cfg),          // what is in play — the number the app works in
    generatedTickets: cfgNum(cfg, 'TOTAL_TICKETS', 0),
    heldBackTickets: Math.max(0, cfgNum(cfg, 'TOTAL_TICKETS', 0) - activeTickets(cfg)),
    // The planned final size, so the release screen can show how much is left
    // to come and stop offering steps that would go past it. Zero means no
    // ceiling was set. The server still refuses ABOVE_CEILING regardless.
    ticketCeiling: cfgNum(cfg, 'TICKET_CEILING', 0),
    ticketsPerBook: cfgNum(cfg, 'TICKETS_PER_BOOK', 10),
    bookPrefix: cfg.BOOK_PREFIX,
    bookDigits: cfgNum(cfg, 'BOOK_DIGITS', 3),
    totalBooks: totalBooks(cfg),
    ticketPrice: cfgFloat(cfg, 'TICKET_PRICE', 10),
    currency: cfg.CURRENCY || 'RM',
    defaultDueDays: cfgNum(cfg, 'DEFAULT_DUE_DAYS', 30),
    checkInDate: isoDay_(cfgDate_(cfg, 'CHECK_IN_DATE')),
    finalDeadline: isoDay_(cfgDate_(cfg, 'FINAL_DEADLINE')),
    // Carried so the two backends hand the client the same config object. The
    // cutoff is ENFORCED on Supabase only, where the write rules live; here it
    // is a date the screens can show, which is what this payload is for.
    salesCloseDate: isoDay_(cfgDate_(cfg, 'SALES_CLOSE_DATE')),
    eventName: cfg.EVENT_NAME || '',
    orgName: cfg.ORG_NAME || '',
    // The organiser's mark, by URL. Blank means no mark rather than somebody
    // else's — see Logo.vue. Small is optional and only ever a size choice.
    orgLogo: cfg.ORG_LOGO || '',
    orgLogoSmall: cfg.ORG_LOGO_SMALL || '',
    // One colour; the stylesheet derives the rest. Blank is a real no-op —
    // applyBrand removes the tokens and the stylesheet's own colour stands,
    // rather than half a theme being applied over it.
    brandColor: cfg.BRAND_COLOR || '',
    projectCode: cfg.PROJECT_CODE || '',
    drawDate: cfg.DRAW_DATE || ''
  };
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
    config: whoamiConfig_(cfg),
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
