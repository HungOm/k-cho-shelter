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
function requireUser(idToken, allowedRoles, needSuper) {
  var identity = verifyIdToken(idToken);
  var user = lookupUser(identity.email);
  var isSuper = isSuperAdminEmail_(identity.email);

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
  if (isSuper) {
    user.role = ROLES.ADMIN;
    user.active = true;
  }

  if (!user.active) {
    throw new ApiError('ACCOUNT_DISABLED', 'This account has been disabled.');
  }

  user.isAdmin = (user.role === ROLES.ADMIN);
  user.googleSub = identity.sub;
  user.displayName = user.name || identity.name;

  // Super-admin-only actions are checked before the role list, because admins
  // pass every role check below and would otherwise walk straight through.
  if (needSuper) requireSuperAdmin_(user, 'This');

  // Note the absence of an `allowedRoles.length` test here. ADMIN_ONLY is an
  // empty list, and an empty list must deny everyone who is not an admin --
  // short-circuiting on length would skip the check entirely and let a
  // view-only account reach every admin action.
  if (allowedRoles && !user.isAdmin) {
    if (allowedRoles.indexOf(user.role) === -1) {
      throw new ApiError('INSUFFICIENT_ROLE',
        'Your role (' + user.role + ') cannot do this.');
    }
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
function assertCanWriteTicket(user, ticketNumber, opts) {
  opts = opts || {};
  var cfg = getConfig();
  var bookNum = bookOfTicket(ticketNumber, cfg);
  if (!bookNum) {
    throw new ApiError('TICKET_NOT_FOUND', 'Ticket "' + ticketNumber + '" is not a valid number.');
  }

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
    throw new ApiError('INSUFFICIENT_ROLE', 'Your role cannot record sales.');
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
