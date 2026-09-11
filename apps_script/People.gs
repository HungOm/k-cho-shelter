/**
 * K'Cho Shelter — People.gs
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

  var out = [];
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    if (payload.activeOnly && !isTrue_(a.Active)) continue;
    out.push({
      id: String(a.Agent_ID).trim(),
      name: a.Name,
      phone: user.role === ROLES.VIEWER ? maskPhone_(a.Phone) : a.Phone,
      zone: a.Zone,
      active: isTrue_(a.Active),
      booksOut: held[String(a.Agent_ID).trim()] || 0,
      notes: a.Notes
    });
  }
  return { agents: out };
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
  var sheet = sheet_(SHEET.USERS);
  if (sheet.getLastRow() < 2) return { users: [] };
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = rowToObject_(values[i], map);
    if (!r.Email) continue;
    out.push({
      email: String(r.Email).trim().toLowerCase(),
      name: r.Name,
      role: String(r.Role || '').toLowerCase(),
      active: isTrue_(r.Active),
      agentId: r.Agent_ID || '',
      addedBy: r.Added_By || '',
      addedDate: toIso_(r.Added_Date),
      isYou: String(r.Email).trim().toLowerCase() === user.email
    });
  }
  return { users: out, bootstrapAdmin: bootstrapAdminEmail_() };
}

function handleUpsertUser(payload, user) {
  var email = requireField_(payload, 'email').toLowerCase();
  var role = String(payload.role || ROLES.VIEWER).toLowerCase();

  var validRoles = [ROLES.ADMIN, ROLES.RECORDER, ROLES.AGENT, ROLES.VIEWER];
  if (validRoles.indexOf(role) === -1) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + validRoles.join(', '));
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError('BAD_REQUEST', 'That does not look like an email address.');
  }
  if (role === ROLES.AGENT && !payload.agentId) {
    throw new ApiError('MISSING_FIELD', 'An agent user must be linked to an Agent_ID.');
  }
  if (payload.agentId && !findAgent_(payload.agentId)) {
    throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + payload.agentId + '".');
  }

  var sheet = sheet_(SHEET.USERS);
  var map = headerMap(sheet);
  var existing = lookupUser(email);

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

  // Locking yourself out of your own system is a support call you cannot make.
  if (email === user.email && !payload.active) {
    throw new ApiError('BAD_REQUEST', 'You cannot disable your own account.');
  }

  var existing = lookupUser(email);
  if (!existing || !existing.row) throw new ApiError('USER_NOT_FOUND', email + ' is not on the access list.');

  var sheet = sheet_(SHEET.USERS);
  var map = headerMap(sheet);
  sheet.getRange(existing.row, map.Active).setValue(!!payload.active);
  invalidateUserCache(email);

  logAudit(payload.active ? 'ENABLE_USER' : 'DISABLE_USER', { email: email }, user.email);
  return { email: email, active: !!payload.active };
}
