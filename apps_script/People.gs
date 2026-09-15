/**
 * Raffled — People.gs
 *
 * Agents and Users are deliberately separate things.
 *
 *   An AGENT is a person who holds books. A name and a phone number in a
 *   sheet. No Google account, nothing to set up — so you can hand books to
 *   someone the day you meet them.
 *
 *   A USER is a person who can sign in. A Google email and a role.
 *
 * The same person is both only when they want to record their own sales, and
 * then the user row points at their Agent_ID. Most agents never become users,
 * which is why the whole system works when only the admin and one or two
 * helpers ever sign in.
 */

// ============ AGENTS ============

function readAgentsRaw_() {
  var sheet = sheet_(SHEET.AGENTS);
  if (sheet.getLastRow() < 2) return [];
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(values[i], map);
    if (!obj.Agent_ID) continue;
    obj._row = i + 2;
    out.push(obj);
  }
  return out;
}

function findAgent_(agentId) {
  var target = String(agentId || '').trim().toUpperCase();
  if (!target) return null;
  var agents = readAgentsRaw_();
  for (var i = 0; i < agents.length; i++) {
    if (String(agents[i].Agent_ID).trim().toUpperCase() === target) return agents[i];
  }
  return null;
}

function agentNameMap_() {
  var agents = readAgentsRaw_();
  var map = {};
  for (var i = 0; i < agents.length; i++) {
    map[String(agents[i].Agent_ID).trim()] = {
      name: agents[i].Name,
      phone: agents[i].Phone,
      zone: agents[i].Zone
    };
  }
  return map;
}

function handleListAgents(payload, user) {
  var agents = readAgentsRaw_();
  var books = readBooksRaw_();

  // Count what each agent is currently holding, so the picker is useful.
  var held = {};
  for (var b = 0; b < books.length; b++) {
    if (books[b].Status !== BOOK_STATUS.OUT) continue;
    var id = String(books[b].Held_By_Agent || '').trim();
    if (!id) continue;
    held[id] = (held[id] || 0) + 1;
  }

  /*
   * WHERE EACH SELLER STANDS THIS ROUND, on the list an organiser already opens
   * to chase people.
   *
   * On this list rather than a screen of its own, because a screen of its own
   * is a screen nobody opens: "who has not reported" is asked while looking at
   * the sellers, or it is not asked at all.
   *
   * Every field is DERIVED — from the round, the check-in date, and the rows
   * saying who answered. Nothing is stored against the seller and there is
   * nothing to reset: the roll moves the round number and the whole list turns
   * over by itself.
   */
  var cfg = getConfig();
  var now = today_();
  var checkIn = cfgDate_(cfg, 'CHECK_IN_DATE');
  var grace = cfgNum(cfg, 'REPORT_GRACE_DAYS', 3);
  var round = cfgNum(cfg, 'CHECK_IN_ROUND', 1);
  var answered = reportedIn_(round);
  var earlier = reportsBefore_(round);

  // Rounds that have been and gone. The live one counts only once the grace
  // after its date has run out — before that, nobody has missed anything.
  var thisRoundClosed = !!(checkIn && daysBetween_(checkIn, now) > grace);
  var roundsClosed = round - 1 + (thisRoundClosed ? 1 : 0);

  /*
   * TWO SELLERS WHO CANNOT BE TOLD APART.
   *
   * This raffle has two active sellers both called JOHN sharing one telephone
   * number, and KUI and Thang ling sharing another. Neither is necessarily a
   * mistake — a household can share a handset, and two people can be called
   * JOHN — but the app was presenting the name as if it were an identity.
   *
   * The cost, in the order it hurts: the outstanding list shows two JOHNs and
   * you cannot tell whose debt you are chasing; the chase button reaches
   * whoever answers that handset; and at the draw a winning ticket resolves to
   * "JOHN" with no way to say which one sold it.
   *
   * Not resolved here, deliberately. Whether two rows are one person entered
   * twice or two people is a question about the world, and merging them would
   * destroy a distinction somebody may have meant. The app's job is to stop
   * showing an ambiguity as a fact.
   *
   * Over ACTIVE sellers only: a retired duplicate is history rather than a
   * confusion, and flagging it would train people to ignore the flag.
   */
  var nameCount = {}, phoneCount = {};
  for (var t = 0; t < agents.length; t++) {
    if (!isTrue_(agents[t].Active)) continue;
    var nk = String(agents[t].Name || '').trim().toLowerCase();
    var pk = String(agents[t].Phone || '').replace(/\D/g, '');
    if (nk) nameCount[nk] = (nameCount[nk] || 0) + 1;
    if (pk) phoneCount[pk] = (phoneCount[pk] || 0) + 1;
  }

  var out = [];
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    if (payload.activeOnly && !isTrue_(a.Active)) continue;
    var id = String(a.Agent_ID).trim();
    var booksOut = held[id] || 0;
    var reportedAt = answered[id] || '';
    // The report for the LIVE round only cancels a miss once that round has
    // closed. Counting it earlier would let somebody who answered this month
    // look as though they had also answered the three they sat out.
    var missed = Math.max(0,
      roundsClosed - (earlier[id] || 0) - (thisRoundClosed && reportedAt ? 1 : 0));
    out.push({
      id: id,
      name: a.Name,
      phone: user.role === ROLES.VIEWER ? maskPhone_(a.Phone) : a.Phone,
      zone: a.Zone,
      active: isTrue_(a.Active),
      booksOut: booksOut,
      notes: a.Notes,
      // What this row shares with another ACTIVE seller, so a screen can say
      // "JOHN (Saremban)" rather than "JOHN" twice. False when unambiguous.
      sharesName: (nameCount[String(a.Name || '').trim().toLowerCase()] || 0) > 1,
      sharesPhone: String(a.Phone || '').replace(/\D/g, '') !== '' &&
                   (phoneCount[String(a.Phone || '').replace(/\D/g, '')] || 0) > 1,
      reportState: reportState_({
        booksOut: booksOut, reported: !!reportedAt,
        checkIn: checkIn, grace: grace, now: now
      }),
      reportedAt: reportedAt,
      reportRound: round,
      missedRounds: missed,
      daysLate: checkIn && !reportedAt && booksOut
        ? Math.max(0, daysBetween_(checkIn, now) - grace) : 0
    });
  }
  return {
    agents: out,
    /*
     * The round itself, once, beside the list it applies to.
     *
     * Per row it would be the same four values repeated behind every name, and
     * the alternative — a second call to deadline_status every time a screen
     * wants to say which day people are reporting by — is a round trip on a
     * phone for something this reply already knows.
     */
    checkIn: {
      date: isoDay_(checkIn),
      round: round,
      reportBy: checkIn ? isoDay_(addDays_(checkIn, grace)) : '',
      graceDays: grace
    }
  };
}

function handleUpsertAgent(payload, user) {
  var name = requireField_(payload, 'name');
  var sheet = sheet_(SHEET.AGENTS);
  var map = headerMap(sheet);
  var agentId = String(payload.agentId || '').trim();

  if (agentId) {
    var existing = findAgent_(agentId);
    if (!existing) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + agentId + '".');
    var row = existing._row;
    setIf_(sheet, map, row, 'Name', name);
    setIf_(sheet, map, row, 'Phone', payload.phone);
    setIf_(sheet, map, row, 'Zone', payload.zone);
    setIf_(sheet, map, row, 'Notes', payload.notes);
    if (payload.active !== undefined) sheet.getRange(row, map.Active).setValue(!!payload.active);
    logAudit('UPDATE_AGENT', { agent: agentId }, user.email);
    return { agentId: agentId, updated: true };
  }

  agentId = nextAgentId_();
  sheet.appendRow([
    agentId,
    name,
    payload.phone || '',
    payload.zone || '',
    payload.active === undefined ? true : !!payload.active,
    payload.notes || ''
  ]);
  logAudit('CREATE_AGENT', { agent: agentId, name: name }, user.email);
  return { agentId: agentId, created: true };
}

function nextAgentId_() {
  var agents = readAgentsRaw_();
  var max = 0;
  for (var i = 0; i < agents.length; i++) {
    var n = parseInt(String(agents[i].Agent_ID).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return 'A' + pad_(max + 1, 3);
}

function setIf_(sheet, map, row, field, value) {
  if (value === undefined || !map[field]) return;
  sheet.getRange(row, map[field]).setValue(value);
}

function isTrue_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

// ============ USERS (the access list) ============

function handleListUsers(payload, user) {
  var superEmail = superAdminEmail_();
  var sheet = sheet_(SHEET.USERS);
  if (sheet.getLastRow() < 2) return { users: [] };
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = rowToObject_(values[i], map);
    if (!r.Email) continue;
    var rowEmail = String(r.Email).trim().toLowerCase();

    // An ordinary admin is never shown the super admin — not the row, not the
    // address. There is nothing they could do with it here anyway, and the
    // account above you is the one worth attacking.
    var rowIsSuper = !!superEmail && rowEmail === superEmail;
    if (rowIsSuper && !user.isSuperAdmin) continue;

    out.push({
      email: rowEmail,
      name: r.Name,
      role: String(r.Role || '').toLowerCase(),
      active: isTrue_(r.Active),
      agentId: r.Agent_ID || '',
      addedBy: r.Added_By || '',
      addedDate: toIso_(r.Added_Date),
      isYou: rowEmail === user.email,
      isSuperAdmin: rowIsSuper
    });
  }

  // The super admin's address goes out only to the super admin.
  return {
    users: out,
    youAreSuperAdmin: !!user.isSuperAdmin,
    superAdmin: user.isSuperAdmin ? superEmail : ''
  };
}

/**
 * Roles an organiser may hand out.
 *
 * Everyone who does the daily work, and nobody above it. The organiser runs the
 * raffle and signs people up for it, so waiting on the System Admin to approve
 * every seller is friction in the one place there is least of it — a helper
 * standing at a table on a Sunday.
 *
 * Organiser and System Admin are not on this list, and that is the whole point.
 * An organiser who could grant those could mint a second organiser, or promote
 * themselves, and the arrangement of one person in charge of tickets would come
 * apart without anybody deciding that it should.
 */
/*
 * A function, not a var. Apps Script evaluates every file into one shared
 * global scope in an order it does not promise, so a module-scope array built
 * from Config.gs's ROLES would be [undefined, undefined, undefined] whenever
 * this file happened to load first — and nothing would throw. This project has
 * already had that bug once, in Reports.gs, where it silently made settled and
 * lost books count toward recorded figures.
 */
function organiserMayGrant_() {
  return [ROLES.RECORDER, ROLES.AGENT, ROLES.VIEWER];
}

/**
 * Whether this person may create or change a user at this role.
 *
 * Two questions, not one: what the row would BECOME, and what it already IS.
 * Checking only the first lets an organiser edit the System Admin's row down to
 * a seller, which is the same escalation approached from the other side.
 */
function assertMayGrant_(user, role, existingRole) {
  if (user && user.isSuperAdmin) return;

  if (organiserMayGrant_().indexOf(role) === -1) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'Only the System Admin can make somebody an organiser or a System Admin. ' +
      'You can add sellers, helpers and view-only accounts.',
      { role: role, mayGrant: organiserMayGrant_() });
  }
  if (existingRole && organiserMayGrant_().indexOf(existingRole) === -1) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'That account is an organiser or the System Admin, so only the System Admin ' +
      'can change it.',
      { role: existingRole });
  }
}

function handleUpsertUser(payload, user) {
  var email = requireField_(payload, 'email').toLowerCase();
  var role = String(payload.role || ROLES.VIEWER).toLowerCase();

  // 'superadmin' is assignable and resolves to admin plus the flag. It is not
  // a permission tier — ROLES stays at four and no action spec changes.
  var validRoles = [ROLES.ADMIN, ROLES.RECORDER, ROLES.AGENT, ROLES.VIEWER, 'superadmin'];
  if (validRoles.indexOf(role) === -1) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + validRoles.join(', '));
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError('BAD_REQUEST', 'That does not look like an email address.');
  }
  // After the role is known to be a real one, so a typo is named as a typo
  // rather than as a permission refusal — but before anything is written.
  var already = lookupUser(email);
  assertMayGrant_(user, role, already && already.row ? already.role : '');

  if (role === ROLES.AGENT && !payload.agentId) {
    throw new ApiError('MISSING_FIELD', 'A seller who signs in must be linked to an Agent ID.');
  }
  if (payload.agentId && !findAgent_(payload.agentId)) {
    throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + payload.agentId + '".');
  }

  var sheet = sheet_(SHEET.USERS);
  var map = headerMap(sheet);
  var existing = lookupUser(email);

  // Only the super admin may mint an admin, alter an existing admin, or touch
  // the super admin's own row. Without this any admin could promote a second
  // admin and the tree would have no top.
  // WHO MAY SIGN IN, AND AS WHAT, IS THE SUPER ADMIN'S ALONE.
  //
  // An organiser who can hand out roles can hand one to themselves, or to a
  // friendly account they then sign in as — which makes "only the super admin
  // decides who is an organiser" a rule that lasts exactly as long as nobody
  // tries. Organisers run the raffle; they do not decide who else runs it.
  //
  // Managing SELLERS is a different thing and stays with organisers: adding,
  // banning and deactivating an agent is the daily work of running the raffle,
  // and an agent record grants nobody any access to this system.
  if (isSuperAdminEmail_(email)) requireSuperAdmin_(user, 'Changing the System Admin account');

  if (existing && existing.row) {
    sheet.getRange(existing.row, map.Role).setValue(role);
    if (payload.name !== undefined) sheet.getRange(existing.row, map.Name).setValue(payload.name);
    if (payload.agentId !== undefined) sheet.getRange(existing.row, map.Agent_ID).setValue(payload.agentId || '');
    if (payload.active !== undefined) sheet.getRange(existing.row, map.Active).setValue(!!payload.active);
    invalidateUserCache(email);
    logAudit('UPDATE_USER', { email: email, role: role }, user.email);
    return { email: email, updated: true };
  }

  sheet.appendRow([
    email,
    payload.name || email,
    role,
    payload.active === undefined ? true : !!payload.active,
    payload.agentId || '',
    '',
    user.email,
    new Date()
  ]);
  invalidateUserCache(email);
  logAudit('CREATE_USER', { email: email, role: role }, user.email);
  return { email: email, created: true };
}

function handleSetUserStatus(payload, user) {
  var email = requireField_(payload, 'email').toLowerCase();
  if (payload.active === undefined) throw new ApiError('MISSING_FIELD', 'active is required.');

  // The super admin cannot be switched off from inside the app, by anybody --
  // including the super admin. Checked first so the refusal reads the same
  // whoever asks, and before the row lookup, because the account need not have
  // a row in the Users tab at all.
  if (isSuperAdminEmail_(email)) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'The System Admin account cannot be enabled or disabled from the app. '
      + 'Change SUPER_ADMIN_EMAIL in Script Properties instead.');
  }

  // Locking yourself out of your own system is a support call you cannot make.
  if (email === user.email && !payload.active) {
    throw new ApiError('BAD_REQUEST', 'You cannot disable your own account.');
  }

  var existing = lookupUser(email);
  if (!existing || !existing.row) throw new ApiError('USER_NOT_FOUND', email + ' is not on the access list.');

  // An organiser may switch off anybody they could have added — a lost phone at
  // a Sunday service should not wait for the System Admin to wake up. Turning
  // off an organiser or the System Admin is a different kind of decision and
  // stays with the System Admin, who is the only one who could undo it.
  if (organiserMayGrant_().indexOf(existing.role) === -1) {
    requireSuperAdmin_(user, 'Enabling or disabling an organiser or the System Admin');
  }

  var sheet = sheet_(SHEET.USERS);
  var map = headerMap(sheet);
  sheet.getRange(existing.row, map.Active).setValue(!!payload.active);
  invalidateUserCache(email);

  logAudit(payload.active ? 'ENABLE_USER' : 'DISABLE_USER', { email: email }, user.email);
  return { email: email, active: !!payload.active };
}
