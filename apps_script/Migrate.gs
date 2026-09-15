/**
 * Raffled — Migrate.gs
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

/**
 * One batch, with retries.
 *
 * WHY RETRIES. A 504 from the gateway says nothing about whether the rows
 * landed — the request may have been fine and the answer lost on the way back.
 * Upserting is safe to repeat (that is the whole reason this migration upserts
 * rather than inserts), so the right response to a gateway error is to send it
 * again rather than to abandon a half-finished migration.
 *
 * Only 429 and 5xx are retried. A 400 means the rows themselves are wrong and
 * sending them again would fail identically, just slower.
 */
function supaPost_(cfg, table, rows, onConflict, label, resolution) {
  if (!rows.length) return 0;

  // Anything prefixed with _ is ours, for deciding what to send, and is not a
  // column on the other side. PostgREST refuses the whole batch over one
  // unknown key, so this is stripped here rather than in each builder.
  var clean = [];
  for (var r = 0; r < rows.length; r++) {
    var src = rows[r], copy = {};
    for (var k in src) if (k.charAt(0) !== '_') copy[k] = src[k];
    clean.push(copy);
  }
  var payload = JSON.stringify(clean);
  var lastErr = '';

  for (var attempt = 1; attempt <= 4; attempt++) {
    var res = UrlFetchApp.fetch(
      cfg.url + '/rest/v1/' + table + '?on_conflict=' + onConflict,
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          apikey: cfg.key,
          Authorization: 'Bearer ' + cfg.key,
          Prefer: 'resolution=' + (resolution || 'merge-duplicates') + ',return=minimal'
        },
        payload: payload,
        muteHttpExceptions: true
      });

    var code = res.getResponseCode();
    if (code < 300) return rows.length;

    lastErr = 'HTTP ' + code + ' — ' + res.getContentText().slice(0, 300);

    // A refusal about the data will not improve with time.
    if (code !== 429 && code < 500) break;

    // 2s, 4s, 8s. Long enough for a cold project to wake up, short enough that
    // four attempts still fit inside the six minutes Apps Script allows.
    if (attempt < 4) Utilities.sleep(2000 * Math.pow(2, attempt - 1));
  }

  throw new Error(table + (label ? ' [' + label + ']' : '') + ': ' + lastErr +
    '\n\nNothing before this batch was lost — the migration only ever adds and ' +
    'updates, so running it again continues from where it stopped.');
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

/**
 * A whole LOCAL day as 'YYYY-MM-DD', or null.
 *
 * Due dates are days, not instants, and the column on the other side is a date.
 * Sending a full timestamp would let Postgres truncate it in UTC, so a date the
 * Sheet holds as local midnight would land a day early — one disputed overdue
 * book, and nobody able to explain it.
 */
function day_(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
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

function migrateDryRun() { return migrate_(true, false); }

/**
 * The one to run before cutover.
 *
 * Sends only what has changed since the last successful run. The first run has
 * no watermark and therefore sends everything; after that a re-run is a handful
 * of rows rather than twenty thousand, which is both faster and the reason a
 * gateway timeout stops being likely at all.
 */
function migrateToSupabase() { return migrate_(false, false); }

/**
 * Everything, regardless of when it changed.
 *
 * For the first run, and for the case where you are not sure the two sides
 * agree. Slower, and safe to run at any time — it only adds and updates.
 */
function migrateEverything() { return migrate_(false, true); }

/** Forget the watermark, so the next ordinary run sends everything again. */
function migrateResetWatermark() {
  PropertiesService.getScriptProperties().deleteProperty('MIGRATE_WATERMARK');
  return 'Watermark cleared. The next migrateToSupabase() will send everything.';
}

/**
 * Rows changed since the last successful migration.
 *
 * The watermark is the moment the previous run STARTED, not when it finished.
 * A row edited while that run was in flight has a Modified_Date after the start
 * and so is picked up by the next one. That re-sends a few rows occasionally,
 * which costs nothing, and it is the way round that cannot lose an edit.
 */
function changedSince_(rows, watermark, dateOf) {
  if (!watermark) return rows;
  var cut = watermark.getTime();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var d = dateOf(rows[i]);
    // No date at all means untouched since the sheet was generated, and the
    // first full run already carried it across.
    if (d && d.getTime() > cut) out.push(rows[i]);
  }
  return out;
}

function migrate_(dryRun, everything) {
  var cfg = migrateConfig_();
  var props = PropertiesService.getScriptProperties();

  // Taken before a single row is read, for the reason in changedSince_.
  var startedAt = new Date();
  var mark = props.getProperty('MIGRATE_WATERMARK');
  var watermark = (everything || !mark) ? null : new Date(mark);
  if (watermark && isNaN(watermark.getTime())) watermark = null;
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
      /*
       * A DATE CELL MUST LEAVE AS A PLAIN DAY.
       *
       * String() on a Sheets date cell gives "Tue Oct 14 2026 00:00:00
       * GMT+0800 (Singapore Standard Time)". That reaches the other side as
       * the config value, and every reader then has to cope: the server does,
       * because dayStart handles it, but the browser string-compares it
       * against today — and that string sorts ABOVE "2026-09-15", so a
       * check-in date months past reads as still ahead. It also shows as an
       * empty box in a date input, so an organiser hands out books with no due
       * date and the shared check-in quietly stops applying.
       *
       * Normalised here rather than at each reader, because the next
       * date-shaped setting to arrive would have the same problem.
       */
      var cv = cVals[i][1];
      cRows.push({
        key: String(cVals[i][0]).trim(),
        value: (cv instanceof Date && !isNaN(cv.getTime()))
          ? Utilities.formatDate(cv, Session.getScriptTimeZone(), 'yyyy-MM-dd')
          : String(cv === null ? '' : cv)
      });
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
        // STATUS, not active. `active` is generated from status on the other
        // side now, and Postgres refuses an insert that names a generated
        // column at all — so sending it fails the whole batch.
        status: (function () {
          var st = String(o.Status || '').trim().toLowerCase();
          if (['pending', 'active', 'suspended', 'banned'].indexOf(st) !== -1) return st;
          return (o.Active === false || String(o.Active).toLowerCase() === 'false')
            ? 'suspended' : 'active';
        })(),
        agent_id: o.Agent_ID ? String(o.Agent_ID).trim() : null,
        added_by: String(o.Added_By || ''),
        added_at: iso_(o.Added_Date) || new Date().toISOString()
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
      due_at: day_(b.Due_Date),
      declared_sold: numOrNull_(b.Declared_Sold),
      amount_due: numOrNull_(b.Amount_Due),
      amount_paid: numOrNull_(b.Amount_Paid),
      settled_at: iso_(b.Settled_Date),
      settled_by: String(b.Settled_By || ''),
      notes: String(b.Notes || ''),
      version: parseInt(b.Version, 10) || 1,
      modified_by: String(b.Modified_By || ''),
      modified_at: iso_(b.Modified_Date) || new Date().toISOString(),
      _srcModified: iso_(b.Modified_Date)
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
      modified_at: iso_(k.Modified_Date) || new Date().toISOString(),
      _srcModified: iso_(k.Modified_Date)
    });
  }
  out.push('tickets: ' + tRows.length + (skipped ? ' (' + skipped + ' skipped: unreadable number)' : ''));

  if (dryRun) {
    var wouldBooks = changedSince_(bRows, watermark, function (r) {
      return r._srcModified ? new Date(r._srcModified) : null;
    }).length;
    var wouldTickets = changedSince_(tRows, watermark, function (r) {
      return r._srcModified ? new Date(r._srcModified) : null;
    }).length;
    var preview = 'DRY RUN — nothing was written.\n\n' + out.join('\n') +
      '\n\n' + (watermark
        ? 'Would send ' + wouldTickets + ' tickets and ' + wouldBooks +
          ' books changed since ' + watermark.toISOString() + '.'
        : 'No previous run recorded — would send everything.') +
      '\n\nRun migrateToSupabase() to do it.';
    Logger.log(preview);
    try { SpreadsheetApp.getUi().alert(preview); } catch (e) {}
    return preview;
  }

  // Order matters: agents, then books (which reference agents), then tickets
  // (which reference books). Users last because they reference agents too.
  // Dependency order, smallest first. Agents before users and books because
  // both reference them; books before tickets for the same reason. Users ahead
  // of the two big tables on purpose: the first run failed on a column name in
  // app_users AFTER twenty-two thousand rows had already moved, and the whole
  // point of a retryable migration is that you find that out cheaply.
  // The small tables go every time: they are a few dozen rows between them, and
  // config in particular decides how the other side reads everything else.
  supaPost_(cfg, 'config', cRows, 'key', 'config');
  supaPost_(cfg, 'agents', aRows, 'agent_id', 'agents');
  /*
   * USERS ARE CARRIED, NEVER OVERWRITTEN.
   *
   * Everything else here is a copy: the Sheet is the source and the other side
   * should end up matching it. Who may sign in is the exception, because it is
   * now managed on the other side — roles are assigned there, accounts are
   * suspended there, and the Sheet's copy is stale the moment anybody does.
   *
   * Merging would quietly undo that. A re-run before cutover would read a role
   * from the Sheet and demote somebody who had been promoted, or re-admit an
   * account somebody had stopped — with no error and nothing in the audit log
   * to say it happened, because this writes straight to the table.
   *
   * ignore-duplicates: a user the other side has never seen is created, and one
   * it already knows is left exactly as it stands.
   */
  supaPost_(cfg, 'app_users', uRows, 'email', 'users', 'ignore-duplicates');


  var bSend = changedSince_(bRows, watermark, function (r) {
    return r._srcModified ? new Date(r._srcModified) : null;
  });
  var tSend = changedSince_(tRows, watermark, function (r) {
    return r._srcModified ? new Date(r._srcModified) : null;
  });

  for (var bi = 0; bi < bSend.length; bi += MIGRATE_BATCH) {
    supaPost_(cfg, 'books', bSend.slice(bi, bi + MIGRATE_BATCH), 'idx',
      'books ' + (bi + 1) + '-' + Math.min(bi + MIGRATE_BATCH, bSend.length) +
      ' of ' + bSend.length);
  }
  for (var ti = 0; ti < tSend.length; ti += MIGRATE_BATCH) {
    supaPost_(cfg, 'tickets', tSend.slice(ti, ti + MIGRATE_BATCH), 'idx',
      'tickets ' + (ti + 1) + '-' + Math.min(ti + MIGRATE_BATCH, tSend.length) +
      ' of ' + tSend.length);
  }

  // A line in the audit log saying the migration ran, because otherwise rows
  // appear on the other side with no account of where they came from — which
  // is the question that started this.
  try {
    supaPost_(cfg, 'audit_log', [{
      action: 'MIGRATE',
      email: Session.getActiveUser().getEmail() || 'migration',
      details: {
        tickets: tSend.length, books: bSend.length,
        agents: aRows.length, usersOffered: uRows.length,
        note: 'Users are created if missing and never overwritten.'
      }
    }], 'id', 'audit');
  } catch (e) { /* a missing audit row must not fail a good migration */ }

  // Only after every batch has landed. A watermark written after a partial run
  // would quietly skip the rows the failed batches were carrying.
  props.setProperty('MIGRATE_WATERMARK', startedAt.toISOString());

  var scope = watermark
    ? 'Changed since ' + watermark.toISOString() + ':\n' +
      '  books sent: ' + bSend.length + ' of ' + bRows.length + '\n' +
      '  tickets sent: ' + tSend.length + ' of ' + tRows.length
    : 'Full copy (no previous run recorded).';

  var done = 'Migrated.\n\n' + out.join('\n') + '\n\n' + scope +
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
