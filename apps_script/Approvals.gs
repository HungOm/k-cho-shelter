/**
 * Raffled — Approvals.gs
 *
 * Two-person control over the handful of actions that take something away: a
 * range of books marked lost, tickets put back on the shelf, a settled book
 * re-opened over figures already recorded. An admin asks, the super admin
 * approves, and the action runs.
 *
 * Approving EXECUTES, in the same call. An approval that merely unlocked the
 * action for later would leave a gap between what was read and what runs —
 * approve a three-book restock, and a two-hundred-book one fires. The exact
 * payload is stored at request time and executed at approval time, so what was
 * approved is what happens.
 *
 * It executes as the REQUESTER, re-checked at that moment. If they were
 * disabled or demoted while the request sat in the queue, it fails rather than
 * running on permissions they no longer have. The audit line carries both
 * names: the person who asked owns it, the person who approved signed for it.
 *
 * Recording sales is deliberately NOT in here. It is additive — the sale
 * already happened on paper — and putting a second person between a volunteer
 * and a stack of stubs is how a system stops being used.
 */

var APPROVAL_TTL_HOURS = 24;
var APPROVAL_PAYLOAD_MAX = 40000;   // a spreadsheet cell holds 50,000 characters

var APPROVAL_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled'
};

// ============ WHAT NEEDS TWO PEOPLE ============

/**
 * Decides whether an action needs two people, and if so writes the sentence the
 * approver will read — HERE, at request time, so the words come from the same
 * code that made the decision. Deriving them again in the browser would let the
 * two drift, and the drift would only show up on the day it mattered.
 *
 * Returns '' when the action can just be done, otherwise
 * `{ text, kind, ...facts }`. The facts are the same sentence in pieces, so a
 * client can compose it in another language without parsing English prose. The
 * stored `text` stays the record of what was actually approved.
 */
function approvalSummaryFor_(action, payload) {
  payload = payload || {};

  if (action === 'set_book_status') {
    // A preview writes nothing, so it needs nobody's permission.
    var dry = payload.dryRun === undefined ? true : !!payload.dryRun;
    if (dry) return '';
    var status = String(payload.status || '');
    var books = expandBookRange_(payload, getConfig());
    if (books.length <= 1) return '';
    var voids = (status === BOOK_STATUS.LOST || status === BOOK_STATUS.VOID);
    var tail = voids ? ' Unsold tickets in them are voided and leave the draw.' : '';
    return {
      kind: 'set_book_status',
      books: books.length,
      firstBook: books[0],
      lastBook: books[books.length - 1],
      status: status,
      voidsTickets: voids,
      tickets: books.length * cfgNum(getConfig(), 'TICKETS_PER_BOOK', 10),
      text: 'Mark ' + books.length + ' books as ' + status + ' — ' +
        books[0] + ' to ' + books[books.length - 1] + '.' + tail
    };
  }

  if (action === 'restock_books') {
    var r = expandBookRange_(payload, getConfig());
    if (!r.length) return '';
    return {
      kind: 'restock_books',
      books: r.length,
      firstBook: r[0],
      lastBook: r[r.length - 1],
      text: 'Put ' + r.length + ' book' + (r.length === 1 ? '' : 's') +
        ' back on the shelf — ' + r[0] +
        (r.length > 1 ? ' to ' + r[r.length - 1] : '') +
        '. The settlement figures already recorded against ' +
        (r.length === 1 ? 'it' : 'them') + ' are cleared.'
    };
  }

  if (action === 'settle_book' && payload.force) {
    var bn = String(payload.bookNumber || '');
    return {
      kind: 'resettle_book',
      books: 1,
      firstBook: bn,
      lastBook: bn,
      text: 'Settle ' + (bn || 'a book') +
        ' again, over a settlement that is already recorded.'
    };
  }

  return '';
}

// ============ THE QUEUE ============

function ensurePendingSheet_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(SHEET.PENDING);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET.PENDING);
  sheet.appendRow(COLS.PENDING);
  sheet.setFrozenRows(1);
  return sheet;
}

function newRequestId_() {
  return 'R' + Date.now().toString(36).toUpperCase() +
    '-' + Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
}

function readPendingRaw_() {
  var sheet = null;
  try { sheet = ss_().getSheetByName(SHEET.PENDING); } catch (e) { sheet = null; }
  if (!sheet || sheet.getLastRow() < 2) return { sheet: sheet, map: null, rows: [] };

  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(values[i], map);
    if (!obj.Request_ID) continue;
    obj._row = i + 2;
    rows.push(obj);
  }
  return { sheet: sheet, map: map, rows: rows };
}

function approvalToWire_(r) {
  var detail = null;
  if (r.Detail) { try { detail = JSON.parse(r.Detail); } catch (e) { detail = null; } }
  return {
    requestId: String(r.Request_ID),
    action: String(r.Action),
    summary: String(r.Summary || ''),
    detail: detail,
    requestedBy: String(r.Requested_By || ''),
    requestedAt: toIso_(r.Requested_At),
    expiresAt: toIso_(r.Expires_At),
    status: String(r.Status || ''),
    decidedBy: String(r.Decided_By || ''),
    decidedAt: toIso_(r.Decided_At),
    note: String(r.Note || '')
  };
}

/** Pending, but past its expiry. Treated as expired wherever it is read. */
function isStale_(r, now) {
  if (String(r.Status) !== APPROVAL_STATUS.PENDING) return false;
  var exp = r.Expires_At instanceof Date ? r.Expires_At : new Date(r.Expires_At);
  return !exp || isNaN(exp.getTime()) || exp.getTime() <= now.getTime();
}

function markStatus_(sheet, map, rowNum, status, user, note) {
  sheet.getRange(rowNum, map.Status).setValue(status);
  if (user) {
    sheet.getRange(rowNum, map.Decided_By).setValue(user.email);
    sheet.getRange(rowNum, map.Decided_At).setValue(new Date());
  }
  if (note !== undefined) sheet.getRange(rowNum, map.Note).setValue(note);
}

// ============ HANDLERS ============

function handleRequestApproval(payload, user) {
  var action = requireField_(payload, 'action');
  var inner = payload.payload || {};

  var reg = actionRegistry();
  var spec = reg[action];
  if (!spec) throw new ApiError('UNKNOWN_ACTION', 'There is no action called "' + action + '".');

  // The super admin would only be approving themselves. Theatre, and it would
  // make the queue look like a control when it is not one.
  if (user.isSuperAdmin) {
    throw new ApiError('BAD_REQUEST',
      'You can do this yourself — an approval request would only come back to you.');
  }

  // They must be able to do the action in the first place. Approval is a second
  // check on top of permission, never a way around missing permission.
  if (!isActionAllowed_(action, spec, user)) {
    throw new ApiError('INSUFFICIENT_ROLE', 'This is not switched on for your account.');
  }

  var need = approvalSummaryFor_(action, inner);
  if (!need) {
    throw new ApiError('NOTHING_TO_DO', 'That action does not need anybody else to approve it.');
  }
  var summary = need.text;

  var json = JSON.stringify(inner);
  if (json.length > APPROVAL_PAYLOAD_MAX) {
    throw new ApiError('PAYLOAD_TOO_LARGE',
      'That request is too big to hold for approval. Do it in smaller pieces.');
  }

  var now = new Date();
  var expires = new Date(now.getTime() + APPROVAL_TTL_HOURS * 3600 * 1000);
  var requestId = newRequestId_();

  var sheet = ensurePendingSheet_();
  var map = headerMap(sheet);
  var row = new Array(COLS.PENDING.length).fill('');
  row[map.Request_ID - 1] = requestId;
  row[map.Action - 1] = action;
  row[map.Payload - 1] = json;
  row[map.Summary - 1] = summary;
  // Tolerated as absent: a Pending tab made before this column existed still
  // works, it just cannot be re-rendered in another language.
  if (map.Detail) row[map.Detail - 1] = JSON.stringify(need);
  row[map.Requested_By - 1] = user.email;
  row[map.Requested_At - 1] = now;
  row[map.Expires_At - 1] = expires;
  row[map.Status - 1] = APPROVAL_STATUS.PENDING;
  sheet.appendRow(row);

  logAudit('APPROVAL_REQUESTED', { requestId: requestId, action: action, summary: summary }, user.email);
  return {
    requestId: requestId,
    action: action,
    summary: summary,
    detail: need,
    expiresAt: expires.toISOString()
  };
}

function handleListApprovals(payload, user) {
  var data = readPendingRaw_();
  if (!data.rows.length) return { requests: [], youDecide: !!user.isSuperAdmin };

  var now = new Date();
  var wanted = payload && payload.status ? String(payload.status) : '';
  var out = [];

  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];

    // Anybody but the super admin sees only what they asked for themselves.
    if (!user.isSuperAdmin && String(r.Requested_By).toLowerCase() !== user.email) continue;

    var status = String(r.Status);
    if (isStale_(r, now)) {
      markStatus_(data.sheet, data.map, r._row, APPROVAL_STATUS.EXPIRED, null,
        'Nobody decided within ' + APPROVAL_TTL_HOURS + ' hours.');
      r.Status = status = APPROVAL_STATUS.EXPIRED;
    }
    if (wanted && status !== wanted) continue;
    out.push(approvalToWire_(r));
  }

  out.sort(function (a, b) { return (b.requestedAt || '') < (a.requestedAt || '') ? -1 : 1; });
  return { requests: out, youDecide: !!user.isSuperAdmin };
}

function handleCancelApproval(payload, user) {
  var requestId = requireField_(payload, 'requestId');
  var data = readPendingRaw_();

  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    if (String(r.Request_ID) !== requestId) continue;
    if (String(r.Status) !== APPROVAL_STATUS.PENDING) {
      throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.');
    }
    if (!user.isSuperAdmin && String(r.Requested_By).toLowerCase() !== user.email) {
      throw new ApiError('NOT_AUTHORIZED', 'That is not your request.');
    }
    markStatus_(data.sheet, data.map, r._row, APPROVAL_STATUS.CANCELLED, user, payload.note || '');
    logAudit('APPROVAL_CANCELLED', { requestId: requestId }, user.email);
    return { requestId: requestId, status: APPROVAL_STATUS.CANCELLED };
  }
  throw new ApiError('NOT_FOUND', 'No request with that id.');
}

/**
 * Approve and run, or reject. Super-admin-only through the registry.
 */
function handleDecideApproval(payload, user) {
  var requestId = requireField_(payload, 'requestId');
  if (payload.approve === undefined) {
    throw new ApiError('MISSING_FIELD', 'approve is required (true or false).');
  }
  var approve = !!payload.approve;
  var note = payload.note || '';

  var data = readPendingRaw_();
  var found = null;
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i].Request_ID) === requestId) { found = data.rows[i]; break; }
  }
  if (!found) throw new ApiError('NOT_FOUND', 'No request with that id.');
  if (String(found.Status) !== APPROVAL_STATUS.PENDING) {
    throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.');
  }

  // Checked here as well as on read: a row that went stale while nobody was
  // looking must not execute because somebody finally opened the screen.
  var now = new Date();
  if (isStale_(found, now)) {
    markStatus_(data.sheet, data.map, found._row, APPROVAL_STATUS.EXPIRED, null,
      'Nobody decided within ' + APPROVAL_TTL_HOURS + ' hours.');
    throw new ApiError('APPROVAL_EXPIRED',
      'That request is more than ' + APPROVAL_TTL_HOURS + ' hours old. Ask for it again.');
  }

  if (!approve) {
    markStatus_(data.sheet, data.map, found._row, APPROVAL_STATUS.REJECTED, user, note);
    logAudit('APPROVAL_REJECTED',
      { requestId: requestId, action: found.Action, requestedBy: found.Requested_By, note: note },
      user.email);
    return { requestId: requestId, status: APPROVAL_STATUS.REJECTED, executed: false };
  }

  // --- approve: re-establish who asked, as they are NOW ---
  var requesterEmail = String(found.Requested_By || '').toLowerCase();
  var requester = lookupUser(requesterEmail);
  if (!requester || !requester.active) {
    throw new ApiError('REQUESTER_UNAVAILABLE',
      requesterEmail + ' is no longer an active user, so their request cannot run.');
  }
  requester.isSuperAdmin = isSuperAdminEmail_(requesterEmail);
  requester.isAdmin = requester.isSuperAdmin || requester.role === ROLES.ADMIN;
  requester.displayName = requester.name || requesterEmail;

  var reg = actionRegistry();
  var spec = reg[String(found.Action)];
  if (!spec) throw new ApiError('UNKNOWN_ACTION', 'That request names an action that no longer exists.');
  if (!isActionAllowed_(String(found.Action), spec, requester)) {
    throw new ApiError('REQUESTER_NOT_ALLOWED',
      requesterEmail + ' can no longer do that, so their request cannot run.');
  }

  var inner;
  try {
    inner = JSON.parse(found.Payload);
  } catch (e) {
    throw new ApiError('BAD_REQUEST', 'That request could not be read back.');
  }

  // The registry entry already ran inside the router's lock for this call, so
  // the action is called directly rather than through the router again.
  var result = spec.fn(inner, requester);
  if (spec.kind === 'write' || spec.kind === 'bulk') bumpTicketCacheVersion();

  markStatus_(data.sheet, data.map, found._row, APPROVAL_STATUS.APPROVED, user, note);

  logAudit('APPROVAL_APPROVED', {
    requestId: requestId,
    action: found.Action,
    summary: found.Summary,
    requestedBy: requesterEmail,
    approvedBy: user.email,
    note: note
  }, user.email);

  return {
    requestId: requestId,
    status: APPROVAL_STATUS.APPROVED,
    executed: true,
    action: String(found.Action),
    summary: String(found.Summary || ''),
    requestedBy: requesterEmail,
    result: result
  };
}
