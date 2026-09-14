/**
 * K'Cho Shelter — Migrate.gs
 *
 * Copies the raffle out of this spreadsheet and into Supabase. Run from the
 * Apps Script editor; nothing calls it over the web.
 *
 *   1. Script Properties: add SUPABASE_URL and SUPABASE_SECRET_KEY
 *   2. Run migrateDryRun()   — counts what would move, writes nothing
 *   3. Run migrateToSupabase() — does it
 *   4. Run verifyMigration()  — counts both sides and compares
 *
 * WHY IT RUNS FROM HERE rather than pulling from outside: this script already
 * has the spreadsheet open and already knows the schema. Anything reading the
 * Sheet from outside would need a second set of credentials and would have to
 * reimplement the column mapping, which is the part most likely to be got
 * subtly wrong.
 *
 * IT IS SAFE TO RUN TWICE. Every write is an upsert keyed on the ticket or book
 * index, so a run that fails halfway can simply be run again. That matters more
 * than it sounds: a migration you are afraid to retry is one you do at the
 * worst possible moment, carefully, once.
 *
 * IT COPIES. It does not delete, move, or alter a single cell in this
 * spreadsheet. If the migration is abandoned, nothing here has changed.
 */

var MIGRATE_BATCH = 500;

function migrateConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = props.getProperty('SUPABASE_SECRET_KEY') || '';
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY in Script Properties first ' +
      '(Project Settings, at the bottom). The secret key starts sb_secret_.');
  }
  if (key.indexOf('sb_publishable_') === 0) {
    throw new Error('That is the publishable key. The secret one starts sb_secret_.');
  }
  return { url: url, key: key };
}

function supaPost_(cfg, table, rows, onConflict) {
  if (!rows.length) return 0;
  var res = UrlFetchApp.fetch(
    cfg.url + '/rest/v1/' + table + '?on_conflict=' + onConflict,
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(rows),
      muteHttpExceptions: true
    });
  var code = res.getResponseCode();
  if (code >= 300) {
    throw new Error(table + ': HTTP ' + code + ' — ' + res.getContentText().slice(0, 400));
  }
  return rows.length;
}

function supaCount_(cfg, table) {
  var res = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + table + '?select=*', {
    method: 'get',
    headers: {
      apikey: cfg.key, Authorization: 'Bearer ' + cfg.key,
      Prefer: 'count=exact', Range: '0-0'
    },
    muteHttpExceptions: true
  });
  var range = res.getHeaders()['content-range'] || res.getHeaders()['Content-Range'] || '';
  return parseInt(String(range).split('/')[1], 10) || 0;
}

/** ISO, or null. Sheets hands back Date objects and blank strings. */
function iso_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// ============ THE MIGRATION ============

function migrateDryRun() { return migrate_(true); }
function migrateToSupabase() { return migrate_(false); }

function migrate_(dryRun) {
  var cfg = migrateConfig_();
  var sheetCfg = getConfig();
  var per = cfgNum(sheetCfg, 'TICKETS_PER_BOOK', 10);
  var out = [];

  // --- config ---
  // Copied as it stands, including ACTIVE_TICKETS and TICKET_CEILING, so the
  // raffle arrives on the other side in exactly the state it is in here.
  var cRows = [];
  var cSheet = ss_().getSheetByName(SHEET.CONFIG);
  if (cSheet && cSheet.getLastRow() > 1) {
    var cVals = cSheet.getRange(2, 1, cSheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < cVals.length; i++) {
      if (!cVals[i][0]) continue;
      cRows.push({ key: String(cVals[i][0]).trim(), value: String(cVals[i][1] === null ? '' : cVals[i][1]) });
    }
  }
  out.push('config: ' + cRows.length);

  // --- agents ---
  var agents = readAgentsRaw_();
  var aRows = agents.map(function (a) {
    return {
      agent_id: String(a.Agent_ID).trim(),
      name: String(a.Name || ''),
      phone: String(a.Phone || ''),
      zone: String(a.Zone || ''),
      active: !(a.Active === false || String(a.Active).toLowerCase() === 'false'),
      notes: String(a.Notes || '')
    };
  });
  out.push('agents: ' + aRows.length);

  // --- users ---
  var uRows = [];
  var uSheet = ss_().getSheetByName(SHEET.USERS);
  if (uSheet && uSheet.getLastRow() > 1) {
    var uMap = headerMap(uSheet);
    var uVals = uSheet.getRange(2, 1, uSheet.getLastRow() - 1, uSheet.getLastColumn()).getValues();
    for (var u = 0; u < uVals.length; u++) {
      var o = rowToObject_(uVals[u], uMap);
      if (!o.Email) continue;
      uRows.push({
        email: String(o.Email).trim().toLowerCase(),
        name: String(o.Name || ''),
        role: String(o.Role || 'viewer').trim().toLowerCase(),
        active: !(o.Active === false || String(o.Active).toLowerCase() === 'false'),
        agent_id: o.Agent_ID ? String(o.Agent_ID).trim() : null,
        added_by: String(o.Added_By || ''),
        added_date: iso_(o.Added_Date) || new Date().toISOString()
      });
    }
  }
  out.push('users: ' + uRows.length);

  // --- books ---
  // Books before tickets: a ticket row references its book, and the other way
  // round the foreign key refuses every single one.
  var books = readBooksRaw_();
  var bRows = books.map(function (b) {
    var idx = bookIndex(b.Book_Number, sheetCfg);
    return {
      idx: idx,
      number: String(b.Book_Number).trim(),
      first_ticket: String(b.First_Ticket || ''),
      last_ticket: String(b.Last_Ticket || ''),
      status: String(b.Status || 'Unassigned'),
      held_by_agent: b.Held_By_Agent ? String(b.Held_By_Agent).trim() : null,
      issued_at: iso_(b.Issued_Date),
      due_at: iso_(b.Due_Date),
      declared_sold: numOrNull_(b.Declared_Sold),
      amount_due: numOrNull_(b.Amount_Due),
      amount_paid: numOrNull_(b.Amount_Paid),
      settled_at: iso_(b.Settled_Date),
      settled_by: String(b.Settled_By || ''),
      notes: String(b.Notes || ''),
      version: parseInt(b.Version, 10) || 1,
      modified_by: String(b.Modified_By || ''),
      modified_at: iso_(b.Modified_Date) || new Date().toISOString()
    };
  }).filter(function (r) { return r.idx > 0; });
  out.push('books: ' + bRows.length);

  // --- tickets ---
  var tickets = readTicketsRaw_();
  var tRows = [];
  var skipped = 0;
  for (var t = 0; t < tickets.length; t++) {
    var k = tickets[t];
    var tIdx = ticketIndex(k.Ticket_Number, sheetCfg);
    if (!tIdx) { skipped++; continue; }

    var status = String(k.Status || 'Available');
    var phone = String(k.Buyer_Phone || '');
    var name = String(k.Buyer_Name || '');

    // The database refuses a Sold ticket with no name or no usable phone — the
    // rule the Sheet enforced in three handlers and could not enforce against a
    // hand edit. Anything that would be refused is marked source 'settlement',
    // which is the constraint's own exception and is honest: the sale happened,
    // nobody recorded who from. It is NOT silently downgraded to Available,
    // because that would lose the money.
    var source = String(k.Source || '');
    if ((status === 'Sold' || status === 'Donated') &&
        (!name || phone.replace(/\D/g, '').length < 7)) {
      source = 'settlement';
    }

    tRows.push({
      idx: tIdx,
      number: String(k.Ticket_Number).trim(),
      book_idx: Math.ceil(tIdx / per),
      status: status,
      buyer_name: name,
      buyer_phone: phone,
      buyer_zone: String(k.Buyer_Zone || ''),
      sold_by_agent: k.Sold_By_Agent ? String(k.Sold_By_Agent).trim() : null,
      amount: numOrNull_(k.Amount),
      payment_status: String(k.Payment_Status || ''),
      sold_at: iso_(k.Sale_Date),
      notes: String(k.Notes || ''),
      source: source,
      version: parseInt(k.Version, 10) || 1,
      recorded_by: String(k.Recorded_By || ''),
      modified_at: iso_(k.Modified_Date) || new Date().toISOString()
    });
  }
  out.push('tickets: ' + tRows.length + (skipped ? ' (' + skipped + ' skipped: unreadable number)' : ''));

  if (dryRun) {
    var preview = 'DRY RUN — nothing was written.\n\n' + out.join('\n') +
      '\n\nRun migrateToSupabase() to do it.';
    Logger.log(preview);
    try { SpreadsheetApp.getUi().alert(preview); } catch (e) {}
    return preview;
  }

  // Order matters: agents, then books (which reference agents), then tickets
  // (which reference books). Users last because they reference agents too.
  supaPost_(cfg, 'config', cRows, 'key');
  supaPost_(cfg, 'agents', aRows, 'agent_id');
  for (var bi = 0; bi < bRows.length; bi += MIGRATE_BATCH) {
    supaPost_(cfg, 'books', bRows.slice(bi, bi + MIGRATE_BATCH), 'idx');
  }
  for (var ti = 0; ti < tRows.length; ti += MIGRATE_BATCH) {
    supaPost_(cfg, 'tickets', tRows.slice(ti, ti + MIGRATE_BATCH), 'idx');
  }
  supaPost_(cfg, 'app_users', uRows, 'email');

  var done = 'Migrated.\n\n' + out.join('\n') +
    '\n\nNothing in this spreadsheet was changed. Run verifyMigration() to check both sides.';
  Logger.log(done);
  try { SpreadsheetApp.getUi().alert(done); } catch (e) {}
  return done;
}

/**
 * Counts both sides and compares.
 *
 * Worth running even when the migration reported success: a batch that failed
 * silently, or a foreign key that rejected a slice, shows up here as a number
 * that does not match, and nowhere else.
 */
function verifyMigration() {
  var cfg = migrateConfig_();
  var sheetCfg = getConfig();

  var here = {
    tickets: readTicketsRaw_().length,
    books: readBooksRaw_().length,
    agents: readAgentsRaw_().length
  };
  var there = {
    tickets: supaCount_(cfg, 'tickets'),
    books: supaCount_(cfg, 'books'),
    agents: supaCount_(cfg, 'agents')
  };

  var lines = ['                 sheet    supabase'];
  var ok = true;
  ['tickets', 'books', 'agents'].forEach(function (k) {
    var match = here[k] === there[k];
    if (!match) ok = false;
    lines.push(
      pad_right_(k, 14) + pad_left_(String(here[k]), 6) + pad_left_(String(there[k]), 12) +
      (match ? '   ok' : '   MISMATCH'));
  });

  // The money is the check that matters most, and a row count does not make it.
  var soldHere = 0;
  var tickets = readTicketsRaw_();
  for (var i = 0; i < tickets.length; i++) {
    var s = String(tickets[i].Status);
    if (s === TICKET_STATUS.SOLD || s === TICKET_STATUS.DONATED) soldHere++;
  }
  var soldThere = supaCount_(cfg, 'tickets?status=in.(Sold,Donated)');
  if (soldHere !== soldThere) ok = false;
  lines.push(pad_right_('sold tickets', 14) + pad_left_(String(soldHere), 6) +
             pad_left_(String(soldThere), 12) + (soldHere === soldThere ? '   ok' : '   MISMATCH'));

  var msg = (ok ? 'Both sides agree.' : 'THEY DO NOT AGREE — do not cut over yet.') +
    '\n\n' + lines.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function pad_right_(s, n) { while (s.length < n) s += ' '; return s; }
function pad_left_(s, n) { while (s.length < n) s = ' ' + s; return s; }
