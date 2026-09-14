/**
 * K'Cho Shelter — Auth.gs
 *
 * The security boundary.
 *
 * The web app is deployed "Execute as: Me" + "Who has access: Anyone", which
 * is the only combination that allows cross-origin fetch from GitHub Pages.
 * That means the HTTP layer is anonymous and this file IS the authentication:
 * every request must carry a Google ID token, which we verify with Google and
 * match against the Users tab.
 *
 * Session.getActiveUser() is deliberately never used — under this deployment
 * it returns an empty string, which is exactly the bug that left the previous
 * system unable to authenticate anyone.
 */

/** Error type carrying a machine-readable code. */
function ApiError(code, message, details) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message || code;
  this.details = details || null;
}
ApiError.prototype = Object.create(Error.prototype);

// ============ GOOGLE ID TOKEN VERIFICATION ============

var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
var VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function getClientId_() {
  var id = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!id) {
    throw new ApiError('NOT_CONFIGURED',
      'GOOGLE_CLIENT_ID is not set in Script Properties. See SETUP.md step 3.');
  }
  return id.trim();
}

/**
 * Verifies a Google ID token and returns {email, sub, name, picture}.
 *
 * Apps Script cannot verify an RS256 signature locally (Utilities only signs),
 * so we ask Google's tokeninfo endpoint. UrlFetchApp has a daily quota, so the
 * result is cached against a hash of the token for the rest of its lifetime.
 */
function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 20) {
    throw new ApiError('AUTH_REQUIRED', 'No sign-in token supplied.');
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'idt_' + shortHash_(idToken);
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* re-verify */ }
  }

  var response;
  try {
    response = UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(idToken), {
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (e) {
    throw new ApiError('AUTH_UNAVAILABLE', 'Could not reach Google to verify sign-in. Try again.');
  }

  if (response.getResponseCode() !== 200) {
    throw new ApiError('AUTH_EXPIRED', 'Sign-in has expired. Please sign in again.');
  }

  var info;
  try {
    info = JSON.parse(response.getContentText());
  } catch (e) {
    throw new ApiError('AUTH_EXPIRED', 'Sign-in could not be read. Please sign in again.');
  }

  // A token minted for any other site fails here. This is what makes the
  // public endpoint safe.
  if (info.aud !== getClientId_()) {
    throw new ApiError('AUTH_REQUIRED', 'Sign-in token was not issued for this app.');
  }
  if (VALID_ISSUERS.indexOf(String(info.iss)) === -1) {
    throw new ApiError('AUTH_REQUIRED', 'Sign-in token has an unexpected issuer.');
  }
  var expSeconds = parseInt(info.exp, 10);
  var nowSeconds = Math.floor(Date.now() / 1000);
  if (!expSeconds || expSeconds <= nowSeconds) {
    throw new ApiError('AUTH_EXPIRED', 'Sign-in has expired. Please sign in again.');
  }
  if (String(info.email_verified) !== 'true') {
    throw new ApiError('AUTH_REQUIRED', 'This Google account has no verified email address.');
  }
  if (!info.email) {
    throw new ApiError('AUTH_REQUIRED', 'Sign-in token carries no email address.');
  }

  var identity = {
    email: String(info.email).trim().toLowerCase(),
    sub: String(info.sub || ''),
    name: String(info.name || info.email || '').trim()
  };

  // Cache until the token expires, capped so a long-lived token can't pin a
  // stale result for hours.
  var ttl = Math.max(1, Math.min(TOKEN_CACHE_TTL, expSeconds - nowSeconds - 5));
  cache.put(cacheKey, JSON.stringify(identity), ttl);
  return identity;
}

function shortHash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return Utilities.base64EncodeWebSafe(bytes).substring(0, 40);
}

// ============ THE ALLOWLIST ============

/**
 * Looks up an email in the Users tab.
 *
 * Cached for only 60 seconds on purpose: deleting a row or setting Active to
 * FALSE must take effect quickly, without anyone needing to redeploy.
 */
function lookupUser(email) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'usr_' + shortHash_(email);
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* re-read */ }
  }

  var sheet = ss_().getSheetByName(SHEET.USERS);
  var result = null;

  if (sheet && sheet.getLastRow() > 1) {
    var map = headerMap(sheet);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    var target = String(email).trim().toLowerCase();

    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var rowEmail = String(row[map.Email - 1] || '').trim().toLowerCase();
      if (rowEmail !== target) continue;

      var active = row[map.Active - 1];
      result = {
        email: rowEmail,
        name: String(row[map.Name - 1] || rowEmail).trim(),
        role: String(row[map.Role - 1] || ROLES.VIEWER).trim().toLowerCase(),
        active: !(active === false || String(active).toLowerCase() === 'false' || active === ''),
        agentId: map.Agent_ID ? String(row[map.Agent_ID - 1] || '').trim() : '',
        row: i + 2
      };
      break;
    }
  }

  cache.put(cacheKey, JSON.stringify(result), USER_CACHE_TTL);
  return result;
}

function invalidateUserCache(email) {
  if (email) CacheService.getScriptCache().remove('usr_' + shortHash_(email));
}

/**
 * THE SUPER ADMIN — one email, held in a Script Property, deliberately kept
 * outside the database.
 *
 * Nothing inside the app can change it: not an admin, not a row in the Users
 * tab, not somebody editing the spreadsheet by hand. Moving it means opening
 * the Apps Script project, which only the script's owner can do. That is what
 * makes it a root account rather than simply another admin.
 *
 * It also still does the original bootstrap job: this address is an admin even
 * before the Users tab has any rows, so a fresh deploy cannot lock you out.
 *
 * SUPER_ADMIN_EMAIL is the name to use. ADMIN_BOOTSTRAP_EMAIL is read as the
 * old name so a deployment set up before this change keeps working untouched.
 */
function superAdminEmail_() {
  var p = PropertiesService.getScriptProperties();
  var email = p.getProperty('SUPER_ADMIN_EMAIL') || p.getProperty('ADMIN_BOOTSTRAP_EMAIL');
  return email ? email.trim().toLowerCase() : '';
}

function isSuperAdminEmail_(email) {
  var su = superAdminEmail_();
  return !!su && String(email || '').trim().toLowerCase() === su;
}

/**
 * Guard for anything only the super admin may do. The router calls it for a
 * whole action; the user-management handlers call it for the specific parts
 * that touch an admin account.
 */
function requireSuperAdmin_(user, what) {
  if (!user || !user.isSuperAdmin) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      (what || 'That') + ' can only be done by the super admin.');
  }
}

// ============ THE GATE ============

/**
 * Role lists for the action registry:
 *   null        any signed-in user on the allowlist
 *   ADMIN_ONLY  admins and nobody else
 *   [a, b]      those roles, plus admin (admins always pass)
 */
var ADMIN_ONLY = [];

/**
 * Verifies the token, resolves the user, and checks their role.
 * Every protected action goes through here.
 *
 * @param {string} idToken       Google ID token from the browser
 * @param {Array}  allowedRoles  roles permitted; empty/null means any signed-in user
 * @return {Object} {email, name, role, active, agentId, isAdmin}
 */
function requireUser(idToken, allowedRoles, needSuper, action) {
  var identity = verifyIdToken(idToken);
  var user = lookupUser(identity.email);
  // A RESOLUTION, NOT A FIFTH TIER.
  //
  // 'superadmin' is what a user ROW may say. It resolves to role 'admin' plus the
  // super-admin flag, and the four permission tiers are untouched. That
  // distinction is the whole design: if it became a Role the registry compared
  // against, every action declaring roles: ['admin', 'recorder'] would stop
  // matching a superadmin, and they would lose the ordinary admin actions while
  // keeping the exotic ones — able to void a ticket and not list the books.
  //
  // SUPER_ADMIN_EMAIL still always wins, and is still the only authority that
  // cannot be switched off from inside the app. A superadmin BY ROW can be
  // disabled like any other account, deliberately: making the row as
  // unremovable as the secret would leave two things nobody can turn off
  // instead of one.
  var fromSecret = isSuperAdminEmail_(identity.email);
  var isSuper = fromSecret || (user && user.role === 'superadmin');

  if (!user) {
    if (isSuper) {
      user = {
        email: identity.email,
        name: identity.name,
        role: ROLES.ADMIN,
        active: true,
        agentId: '',
        row: 0
      };
    } else {
      throw new ApiError('NOT_AUTHORIZED',
        identity.email + ' is not on the access list. Ask an admin to add you.');
    }
  }

  // Decided before the active check on purpose: the super admin cannot be
  // switched off from inside the app, so a Users row set to FALSE (or a role
  // typed down to 'viewer' in the sheet) must not lock the owner out.
  user.isSuperAdmin = isSuper;
  if (isSuper) user.role = ROLES.ADMIN;
  // Only the one named in Script Properties is immune to the active flag.
  if (fromSecret) user.active = true;

  if (!user.active) {
    throw new ApiError('ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  user.isAdmin = (user.role === ROLES.ADMIN);
  user.googleSub = identity.sub;
  user.displayName = user.name || identity.name;

  // Super-admin-only actions are checked before everything else, because admins
  // pass every check below and would otherwise walk straight through.
  if (needSuper) requireSuperAdmin_(user, 'This');

  // One decision, whether or not a Permissions tab exists. Note the absence of
  // an `allowedRoles.length` test: ADMIN_ONLY is an empty list, and an empty
  // list must deny everyone who is not an admin -- short-circuiting on length
  // would skip the check and let a view-only account reach every admin action.
  if (!isActionAllowed_(action || '', { roles: allowedRoles, sup: needSuper }, user)) {
    // Two different refusals, because they need two different actions from the
    // person reading them. "Not switched on" sends an organiser to the Access
    // screen to turn it on — which is right for an ordinary permission and
    // actively misleading for a super-admin-only one, where no such switch
    // exists or ever can. Sending somebody to look for a control that is not
    // there is worse than telling them plainly that it is not theirs.
    if (needSuper) {
      throw new ApiError('SUPER_ADMIN_ONLY',
        'Only the super admin can do this. It cannot be switched on for anybody else.');
    }
    throw new ApiError('INSUFFICIENT_ROLE', 'This is not switched on for your account.');
  }

  // Record the Google subject id on first sign-in, so a recycled email address
  // can be spotted later.
  if (user.row && identity.sub) recordGoogleSub_(user, identity.sub);

  return user;
}

function recordGoogleSub_(user, sub) {
  try {
    var sheet = ss_().getSheetByName(SHEET.USERS);
    var map = headerMap(sheet);
    if (!map.Google_Sub) return;
    var cell = sheet.getRange(user.row, map.Google_Sub);
    var existing = String(cell.getValue() || '').trim();
    if (!existing) {
      cell.setValue(sub);
    } else if (existing !== sub) {
      logAudit('GOOGLE_SUB_CHANGED', { email: user.email, was: existing, now: sub }, user.email);
    }
  } catch (e) {
    // Non-critical.
  }
}

// ============ BOOK OWNERSHIP ============
// An agent may only write tickets in a book they are currently holding.
// The check has to be cheap, because it runs on every single write.

function bookCacheVersion_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('BOOK_CACHE_V') || '0';
}

/** Called after any write to the Books sheet, so every user sees it at once. */
// ============ THE PERMISSIONS TABLE ============

/**
 * The registry's `roles:` is the DEFAULT, not the law. A Permissions tab lets
 * the super admin switch any action on or off for any role from inside the app,
 * with no redeploy.
 *
 * Three things the table can never do, because each one is a way of taking the
 * system away from the person who owns it:
 *
 *   - grant anything marked sup:true. An admin who could grant themselves
 *     read_audit could then erase the record of having done it.
 *   - take user management away from admins. One toggle would otherwise leave
 *     nobody able to undo the toggle.
 *   - apply to the super admin at all, who passes everything by definition.
 *
 * A missing tab, a missing row, or a blank cell all mean "no opinion" and fall
 * through to the registry — so a spreadsheet built before this existed behaves
 * exactly as it did.
 */
var PERMISSION_ROLES = ['admin', 'recorder', 'agent', 'viewer'];
var PERMISSION_LOCKED_FOR_ADMIN = ['list_users', 'upsert_user', 'set_user_status'];
var PERMISSION_CACHE_TTL = 300;

function permissionCacheVersion_() {
  return PropertiesService.getScriptProperties().getProperty('PERM_CACHE_V') || '0';
}

function bumpPermissionCacheVersion() {
  var props = PropertiesService.getScriptProperties();
  var next = (parseInt(props.getProperty('PERM_CACHE_V') || '0', 10) + 1) % 1000000;
  props.setProperty('PERM_CACHE_V', String(next));
}

/** {action: {role: true|false}}. Empty when the tab is absent. */
function permissionsTable_() {
  var cache = CacheService.getScriptCache();
  var key = 'perms_' + permissionCacheVersion_();
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* rebuild */ } }

  var table = {};
  var sheet = null;
  try { sheet = ss_().getSheetByName(SHEET.PERMISSIONS); } catch (e) { sheet = null; }

  if (sheet && sheet.getLastRow() > 1) {
    var map = headerMap(sheet);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i++) {
      var action = String(values[i][map.Action - 1] || '').trim();
      if (!action) continue;
      var row = {};
      for (var r = 0; r < PERMISSION_ROLES.length; r++) {
        var role = PERMISSION_ROLES[r];
        if (!map[role]) continue;
        var raw = values[i][map[role] - 1];
        if (raw === '' || raw === null || raw === undefined) continue;   // blank = no opinion
        row[role] = isTrue_(raw);
      }
      table[action] = row;
    }
  }

  cache.put(key, JSON.stringify(table), PERMISSION_CACHE_TTL);
  return table;
}

/** true, false, or null when the table has no opinion. */
function permissionFor_(action, role) {
  if (!action) return null;
  var table = permissionsTable_();
  if (!table[action]) return null;
  var v = table[action][role];
  return (v === true || v === false) ? v : null;
}

/**
 * The whole decision, in the order that matters. The super admin first and the
 * sup:true bar second, so nothing below can reach past either.
 */
function isActionAllowed_(action, spec, user) {
  if (user.isSuperAdmin) return true;
  if (spec.sup) return false;
  if (user.isAdmin && PERMISSION_LOCKED_FOR_ADMIN.indexOf(action) !== -1) return true;

  var override = permissionFor_(action, user.role);
  if (override !== null) return override;

  if (!spec.roles) return true;        // any signed-in user
  if (user.isAdmin) return true;       // admins pass the registry defaults
  return spec.roles.indexOf(user.role) !== -1;
}

/** Creates the tab on first write, so an existing sheet needs no re-setup. */
function ensurePermissionsSheet_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(SHEET.PERMISSIONS);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET.PERMISSIONS);
  sheet.appendRow(COLS.PERMISSIONS);
  sheet.setFrozenRows(1);
  return sheet;
}

/** What the registry alone would say, before the table has an opinion. */
function defaultAllows_(spec, role) {
  if (spec.sup) return false;
  if (!spec.roles) return true;
  if (role === ROLES.ADMIN) return true;
  return spec.roles.indexOf(role) !== -1;
}

function handleListPermissions(payload, user) {
  var reg = actionRegistry();
  var meta = actionMeta();
  var table = permissionsTable_();
  var out = [];

  for (var action in reg) {
    var spec = reg[action];
    if (spec.pub) continue;                       // ping needs no permission
    var m = meta[action] || {};
    var defaults = {};
    var current = {};
    for (var i = 0; i < PERMISSION_ROLES.length; i++) {
      var role = PERMISSION_ROLES[i];
      var def = defaultAllows_(spec, role);
      defaults[role] = def;
      var override = (table[action] && (table[action][role] === true || table[action][role] === false))
        ? table[action][role] : null;
      current[role] = spec.sup ? false : (override === null ? def : override);
    }
    out.push({
      action: action,
      group: m.group || 'Other',
      label: m.label || action,
      danger: !!m.danger,
      sup: !!spec.sup,
      lockedFor: PERMISSION_LOCKED_FOR_ADMIN.indexOf(action) !== -1 ? [ROLES.ADMIN] : [],
      defaults: defaults,
      current: current
    });
  }

  out.sort(function (a, b) {
    if (a.group === b.group) return a.label < b.label ? -1 : 1;
    return a.group < b.group ? -1 : 1;
  });

  return { roles: PERMISSION_ROLES, actions: out };
}

function handleSetPermission(payload, user) {
  var action = requireField_(payload, 'action');
  var role = String(payload.role || '').trim().toLowerCase();
  if (payload.allowed === undefined) {
    throw new ApiError('MISSING_FIELD', 'allowed is required (true or false).');
  }
  var allowed = !!payload.allowed;

  var reg = actionRegistry();
  var spec = reg[action];
  if (!spec) throw new ApiError('UNKNOWN_ACTION', 'There is no action called "' + action + '".');
  if (PERMISSION_ROLES.indexOf(role) === -1) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + PERMISSION_ROLES.join(', '));
  }

  // The three invariants. Each one exists because breaking it is a way to take
  // the system away from the person who owns it.
  if (spec.pub) {
    throw new ApiError('BAD_REQUEST', 'That action is open to everyone and has no permission to set.');
  }
  if (spec.sup) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'That is reserved to the super admin and cannot be handed to a role.');
  }
  if (!allowed && role === ROLES.ADMIN && PERMISSION_LOCKED_FOR_ADMIN.indexOf(action) !== -1) {
    throw new ApiError('BAD_REQUEST',
      'Admins have to keep this one. Without it nobody but you could put it back.');
  }

  var sheet = ensurePermissionsSheet_();
  var map = headerMap(sheet);
  var col = map[role];
  if (!col) throw new ApiError('SHEET_MISSING', 'The Permissions tab has no "' + role + '" column.');

  var rowNum = 0;
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, map.Action, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === action) { rowNum = i + 2; break; }
    }
  }
  if (!rowNum) {
    var blank = new Array(COLS.PERMISSIONS.length).fill('');
    blank[map.Action - 1] = action;
    sheet.appendRow(blank);
    rowNum = sheet.getLastRow();
  }
  sheet.getRange(rowNum, col).setValue(allowed);

  bumpPermissionCacheVersion();
  logAudit('SET_PERMISSION', { action: action, role: role, allowed: allowed }, user.email);
  return { action: action, role: role, allowed: allowed };
}

function ticketCacheVersion_() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('TICKET_CACHE_V') || '0';
}

function bumpTicketCacheVersion() {
  var props = PropertiesService.getScriptProperties();
  var next = (parseInt(props.getProperty('TICKET_CACHE_V') || '0', 10) + 1) % 1000000;
  props.setProperty('TICKET_CACHE_V', String(next));
}

function bumpBookCacheVersion() {
  var props = PropertiesService.getScriptProperties();
  var next = (parseInt(props.getProperty('BOOK_CACHE_V') || '0', 10) + 1) % 1000000;
  props.setProperty('BOOK_CACHE_V', String(next));
}

/**
 * {bookNumber: {status, agentId}} for every book, from one range read.
 * 600 books is a few KB — comfortably inside the cache value limit.
 */
function getBookOwnerMap() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'bookmap_' + bookCacheVersion_();
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* re-read */ }
  }

  var sheet = ss_().getSheetByName(SHEET.BOOKS);
  var map = {};
  if (sheet && sheet.getLastRow() > 1) {
    var h = headerMap(sheet);
    var lastCol = Math.max(h.Book_Number, h.Status, h.Held_By_Agent);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < values.length; i++) {
      var num = String(values[i][h.Book_Number - 1] || '').trim();
      if (!num) continue;
      map[num.toUpperCase()] = {
        status: String(values[i][h.Status - 1] || BOOK_STATUS.UNASSIGNED).trim(),
        agentId: String(values[i][h.Held_By_Agent - 1] || '').trim()
      };
    }
  }

  cache.put(cacheKey, JSON.stringify(map), CONFIG_CACHE_TTL);
  return map;
}

/**
 * Decides whether this user may write this ticket. Throws on refusal.
 *
 * Cost: O(1) arithmetic to find the book, then one cached map lookup.
 */
/**
 * A ticket that has not been released is not writable by anybody, for any
 * reason. Its own function rather than a line inside assertCanWriteTicket
 * because handleVoidTicket does not go through that gate — it is the one write
 * path that never has, so gating reads alone would leave a held-back ticket
 * voidable, and it would come out of the draw before anyone had decided to
 * release it.
 */
function assertTicketReleased_(ticketNumber, cfg) {
  cfg = cfg || getConfig();
  var active = activeTickets(cfg);
  var idx = ticketIndex(ticketNumber, cfg);
  if (idx > active) {
    throw new ApiError('TICKET_NOT_RELEASED',
      'Ticket ' + ticketNumber + ' has not been released yet. This raffle is selling ' +
      'the first ' + active + ' tickets; release more before selling beyond that.',
      { active: active, requested: idx });
  }
}

function assertCanWriteTicket(user, ticketNumber, opts) {
  opts = opts || {};
  var cfg = getConfig();
  var bookNum = bookOfTicket(ticketNumber, cfg);
  if (!bookNum) {
    throw new ApiError('TICKET_NOT_FOUND', 'Ticket "' + ticketNumber + '" is not a valid number.');
  }

  assertTicketReleased_(ticketNumber, cfg);

  var book = getBookOwnerMap()[bookNum.toUpperCase()];
  if (!book) {
    throw new ApiError('BOOK_NOT_FOUND', 'Book ' + bookNum + ' does not exist.');
  }

  // Frozen books stay frozen unless an admin explicitly forces it.
  if (CLOSED_BOOK_STATUSES.indexOf(book.status) !== -1) {
    if (!(user.isAdmin && opts.force)) {
      throw new ApiError('BOOK_CLOSED',
        'Book ' + bookNum + ' is ' + book.status.toLowerCase() + ' and cannot be changed.');
    }
    logAudit('REOPEN', { book: bookNum, ticket: ticketNumber }, user.email);
  }

  if (user.isAdmin || user.role === ROLES.RECORDER) return bookNum;

  if (user.role !== ROLES.AGENT) {
    throw new ApiError('INSUFFICIENT_ROLE', 'Recording sales is not switched on for your account.');
  }
  if (book.status !== BOOK_STATUS.OUT) {
    throw new ApiError('BOOK_NOT_ASSIGNED',
      'Book ' + bookNum + ' is not out with anyone. Ask an admin to issue it first.');
  }
  if (!user.agentId || book.agentId !== user.agentId) {
    throw new ApiError('NOT_YOUR_BOOK', 'Book ' + bookNum + ' is not assigned to you.');
  }
  return bookNum;
}

// ============ RATE LIMITING ============
// Keyed on the VERIFIED email, so it cannot be sidestepped by varying an
// unauthenticated field in the request.

var RATE_LIMITS = {
  read: { max: 120, window: 60 },
  write: { max: 60, window: 60 },
  bulk: { max: 10, window: 60 },
  report: { max: 30, window: 60 }
};

function checkRateLimit(email, kind) {
  var limit = RATE_LIMITS[kind] || RATE_LIMITS.read;
  var cache = CacheService.getScriptCache();
  var key = 'rate_' + kind + '_' + shortHash_(email);
  var count = parseInt(cache.get(key) || '0', 10);
  if (count >= limit.max) {
    throw new ApiError('RATE_LIMIT', 'Too many requests. Wait a moment and try again.');
  }
  cache.put(key, String(count + 1), limit.window);
}
