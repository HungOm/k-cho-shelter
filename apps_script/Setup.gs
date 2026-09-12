/**
 * K'Cho Shelter — Setup.gs
 *
 * Run these from the Apps Script editor, not over the web.
 *
 *   setup()            create every tab and generate tickets + books
 *   regenerate()       re-create tickets after changing the numbering config
 *                      (refuses once anything has been sold)
 *   installBackupTrigger()  turn on the daily Drive backup
 *   verifyIntegrity()  health check, writes a _Health tab
 *   showConfig()       print the current config to the log
 */

// ============ SETUP ============

function setup() {
  var ss = ss_();

  createSheet_(SHEET.CONFIG, COLS.CONFIG, '#475569');
  seedConfig_();
  invalidateConfigCache();

  var cfg = getConfig();
  validateConfig_(cfg);

  createSheet_(SHEET.TICKETS, COLS.TICKETS, '#1A4B8C');
  createSheet_(SHEET.BOOKS, COLS.BOOKS, '#0f766e');
  createSheet_(SHEET.BOOK_HISTORY, COLS.BOOK_HISTORY, '#7c3aed');
  createSheet_(SHEET.AGENTS, COLS.AGENTS, '#b45309');
  createSheet_(SHEET.USERS, COLS.USERS, '#9333ea');
  createSheet_(SHEET.WINNERS, COLS.WINNERS, '#be123c');
  createSheet_(SHEET.AUDIT, COLS.AUDIT, '#525252');

  invalidateHeaderCaches();

  var made = generateTicketsAndBooks_(cfg, false);
  installBookFormulas_();
  applyValidationAndFormatting_(cfg);
  seedBootstrapAdmin_();
  bumpBookCacheVersion();

  var summary = 'Setup complete.\n' +
    '  Tickets: ' + made.tickets + ' (' + ticketNumberAt(1, cfg) + ' .. ' + ticketNumberAt(made.tickets, cfg) + ')\n' +
    '  Books:   ' + made.books + ' (' + bookNumberAt(1, cfg) + ' .. ' + bookNumberAt(made.books, cfg) + ')\n' +
    '  Price:   ' + cfg.CURRENCY + ' ' + cfg.TICKET_PRICE + ' each\n\n' +
    'Next: deploy as a web app (Execute as: Me, Who has access: Anyone).';
  Logger.log(summary);
  try { SpreadsheetApp.getUi().alert(summary); } catch (e) { /* no UI when run headless */ }
  return summary;
}

/**
 * Re-create tickets and books after changing the numbering config.
 * Refuses once any ticket has been sold — at that point the printed tickets in
 * people's hands are the real record, and renumbering would orphan every one.
 */
function regenerate() {
  var sold = countNonAvailableTickets_();
  if (sold > 0) {
    var msg = 'REFUSED: ' + sold + ' tickets are already sold, reserved or donated.\n' +
      'Renumbering now would disconnect every record from the printed tickets.\n' +
      'If you really mean to start over, clear the Tickets and Books tabs by hand first.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
    return msg;
  }

  invalidateConfigCache();
  var cfg = getConfig();
  validateConfig_(cfg);

  clearDataRows_(SHEET.TICKETS);
  clearDataRows_(SHEET.BOOKS);
  var made = generateTicketsAndBooks_(cfg, true);
  installBookFormulas_();
  applyValidationAndFormatting_(cfg);
  bumpBookCacheVersion();

  var out = 'Regenerated ' + made.tickets + ' tickets in ' + made.books + ' books.';
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert(out); } catch (e) {}
  return out;
}

function countNonAvailableTickets_() {
  var sheet = ss_().getSheetByName(SHEET.TICKETS);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var map = headerMap(sheet);
  if (!map.Status) return 0;
  var values = sheet.getRange(2, map.Status, sheet.getLastRow() - 1, 1).getValues();
  var n = 0;
  for (var i = 0; i < values.length; i++) {
    var s = String(values[i][0] || '').trim();
    if (s && s !== TICKET_STATUS.AVAILABLE) n++;
  }
  return n;
}

// ============ SHEET CREATION ============

function createSheet_(name, headers, colour) {
  var ss = ss_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    // Reuse a default "Sheet1" rather than leaving it lying around.
    var first = ss.getSheets()[0];
    if (ss.getSheets().length === 1 && first.getName() === 'Sheet1' && first.getLastRow() === 0) {
      sheet = first;
      sheet.setName(name);
    } else {
      sheet = ss.insertSheet(name);
    }
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
       .setFontWeight('bold').setBackground(colour).setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  if (sheet.getMaxColumns() > headers.length) {
    sheet.deleteColumns(headers.length + 1, sheet.getMaxColumns() - headers.length);
  }
  return sheet;
}

function seedConfig_() {
  var sheet = ss_().getSheetByName(SHEET.CONFIG);
  var existing = {};
  if (sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < rows.length; i++) existing[String(rows[i][0]).trim()] = true;
  }
  var toAdd = [];
  for (var j = 0; j < CONFIG_DEFAULTS.length; j++) {
    // Never overwrite a value a human has already set.
    if (!existing[CONFIG_DEFAULTS[j][0]]) toAdd.push(CONFIG_DEFAULTS[j]);
  }
  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 420);
}

var MAX_TOTAL_TICKETS = 50000;

/**
 * Whether the padding settings can still express the highest ticket and book
 * number a given total implies.
 *
 * Shared by setup and by expandTickets, so a raise on a running raffle is held
 * to exactly the rule a fresh project is held to. Widening the padding later is
 * not an option — it renumbers every ticket already printed — so the only place
 * this can be got right is before the tickets are made.
 *
 * Returns '' when it fits, otherwise the sentence saying what does not.
 */
function numberingFitProblem_(cfg, total) {
  var start = cfgNum(cfg, 'TICKET_START', 1);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);
  var tDigits = cfgNum(cfg, 'TICKET_DIGITS', 4);
  var bDigits = cfgNum(cfg, 'BOOK_DIGITS', 3);

  var highest = start + total - 1;
  if (String(highest).length > tDigits) {
    return 'TICKET_DIGITS is ' + tDigits + ', too small for the highest ticket number ' +
      highest + '. Use at least ' + String(highest).length + ' digits.';
  }

  // Never checked before this existed: a 1000-book raffle on BOOK_DIGITS=3
  // throws nothing, it just prints Book-001 next to Book-1000.
  var books = Math.ceil(total / per);
  if (String(books).length > bDigits) {
    return 'BOOK_DIGITS is ' + bDigits + ', too small for the highest book number ' +
      books + '. Use at least ' + String(books).length + ' digits.';
  }
  return '';
}

function validateConfig_(cfg) {
  var total = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 0);
  var digits = cfgNum(cfg, 'TICKET_DIGITS', 0);

  if (total < 1 || total > MAX_TOTAL_TICKETS) {
    throw new Error('TOTAL_TICKETS must be between 1 and ' + MAX_TOTAL_TICKETS + '.');
  }
  if (per < 1 || per > 1000) throw new Error('TICKETS_PER_BOOK must be between 1 and 1000.');
  if (digits < 1 || digits > 10) throw new Error('TICKET_DIGITS must be between 1 and 10.');

  var fit = numberingFitProblem_(cfg, total);
  if (fit) throw new Error(fit);

  if (cfgFloat(cfg, 'TICKET_PRICE', 0) <= 0) throw new Error('TICKET_PRICE must be greater than zero.');
}

// ============ GENERATION ============

function generateTicketsAndBooks_(cfg, force) {
  var ticketsSheet = ss_().getSheetByName(SHEET.TICKETS);
  var booksSheet = ss_().getSheetByName(SHEET.BOOKS);

  if (!force && ticketsSheet.getLastRow() > 1) {
    Logger.log('Tickets already exist — leaving them alone. Use regenerate() to rebuild.');
    return { tickets: ticketsSheet.getLastRow() - 1, books: Math.max(0, booksSheet.getLastRow() - 1) };
  }

  var total = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);
  var nBooks = totalBooks(cfg);
  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);

  // --- tickets ---
  var tMap = {};
  for (var c = 0; c < COLS.TICKETS.length; c++) tMap[COLS.TICKETS[c]] = c;
  var rows = [];
  for (var i = 1; i <= total; i++) {
    var row = new Array(COLS.TICKETS.length).fill('');
    row[tMap.Ticket_Number] = ticketNumberAt(i, cfg);
    row[tMap.Status] = TICKET_STATUS.AVAILABLE;
    row[tMap.Book_Number] = bookNumberAt(Math.ceil(i / per), cfg);
    row[tMap.Version] = 1;
    rows.push(row);
  }
  writeInChunks_(ticketsSheet, rows);

  // --- books ---
  var bRows = [];
  for (var b = 1; b <= nBooks; b++) {
    var first = (b - 1) * per + 1;
    var last = Math.min(b * per, total);
    var br = new Array(COLS.BOOKS.length).fill('');
    br[0] = bookNumberAt(b, cfg);       // Book_Number
    br[1] = ticketNumberAt(first, cfg); // First_Ticket
    br[2] = ticketNumberAt(last, cfg);  // Last_Ticket
    br[3] = BOOK_STATUS.UNASSIGNED;     // Status
    br[13] = 1;                         // Version
    bRows.push(br.slice(0, 16));        // stop before the formula columns
  }
  writeInChunks_(booksSheet, bRows);

  Logger.log('Generated ' + total + ' tickets and ' + nBooks + ' books.');
  return { tickets: total, books: nBooks };
}

/** Writes large blocks in chunks so a 6000-row generate does not time out. */
function writeInChunks_(sheet, rows, startRow) {
  if (!rows.length) return;
  var CHUNK = 1000;
  var width = rows[0].length;
  startRow = startRow || 2;
  for (var i = 0; i < rows.length; i += CHUNK) {
    var slice = rows.slice(i, i + CHUNK);
    sheet.getRange(startRow + i, 1, slice.length, width).setValues(slice);
    SpreadsheetApp.flush();
  }
}

function clearDataRows_(sheetName) {
  var sheet = ss_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getMaxColumns()).clearContent();
}

// ============ LIVE RECONCILIATION FORMULAS ============
// Four ARRAYFORMULA cells that put declared vs recorded side by side with the
// difference already worked out — visible to anyone who opens the Sheet, with
// no report to run and no server round trip. The server never writes these
// columns; see writeBookFields_ in Books.gs.

function installBookFormulas_() {
  var sheet = ss_().getSheetByName(SHEET.BOOKS);
  var map = headerMap(sheet);
  var cfg = getConfig();
  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);

  var bookCol = colLetter_(map.Book_Number);
  var declaredCol = colLetter_(map.Declared_Sold);
  var paidCol = colLetter_(map.Amount_Paid);

  var tSheet = ss_().getSheetByName(SHEET.TICKETS);
  var tMap = headerMap(tSheet);
  var tBook = colLetter_(tMap.Book_Number);
  var tStatus = colLetter_(tMap.Status);
  var tAmount = colLetter_(tMap.Amount);

  var T = "'" + SHEET.TICKETS + "'!";

  var recordedSold =
    '=ARRAYFORMULA(IF(' + bookCol + '2:' + bookCol + '="",,' +
    'COUNTIFS(' + T + '$' + tBook + '$2:$' + tBook + ',' + bookCol + '2:' + bookCol + ',' +
    T + '$' + tStatus + '$2:$' + tStatus + ',"' + TICKET_STATUS.SOLD + '")' +
    '+COUNTIFS(' + T + '$' + tBook + '$2:$' + tBook + ',' + bookCol + '2:' + bookCol + ',' +
    T + '$' + tStatus + '$2:$' + tStatus + ',"' + TICKET_STATUS.DONATED + '")))';

  var recordedAmount =
    '=ARRAYFORMULA(IF(' + bookCol + '2:' + bookCol + '="",,' +
    'SUMIFS(' + T + '$' + tAmount + '$2:$' + tAmount + ',' +
    T + '$' + tBook + '$2:$' + tBook + ',' + bookCol + '2:' + bookCol + ',' +
    T + '$' + tStatus + '$2:$' + tStatus + ',"' + TICKET_STATUS.SOLD + '")))';

  var recSoldCol = colLetter_(map.Recorded_Sold);
  var recAmtCol = colLetter_(map.Recorded_Amount);

  var varianceSold =
    '=ARRAYFORMULA(IF(' + bookCol + '2:' + bookCol + '="",,' +
    'N(' + declaredCol + '2:' + declaredCol + ')-N(' + recSoldCol + '2:' + recSoldCol + ')))';

  var varianceAmount =
    '=ARRAYFORMULA(IF(' + bookCol + '2:' + bookCol + '="",,' +
    'N(' + paidCol + '2:' + paidCol + ')-N(' + declaredCol + '2:' + declaredCol + ')*' + price + '))';

  sheet.getRange(2, map.Recorded_Sold).setFormula(recordedSold);
  sheet.getRange(2, map.Recorded_Amount).setFormula(recordedAmount);
  sheet.getRange(2, map.Variance_Sold).setFormula(varianceSold);
  sheet.getRange(2, map.Variance_Amount).setFormula(varianceAmount);

  // Make a mismatch impossible to miss without running anything.
  var lastRow = Math.max(2, sheet.getLastRow());
  var varRange = sheet.getRange(2, map.Variance_Amount, lastRow - 1, 1);
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberNotEqualTo(0)
    .setBackground('#fee2e2')
    .setFontColor('#991b1b')
    .setRanges([varRange])
    .build();
  var rules = sheet.getConditionalFormatRules();
  rules.push(rule);
  sheet.setConditionalFormatRules(rules);
}

function colLetter_(index) {
  var s = '';
  while (index > 0) {
    var m = (index - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    index = Math.floor((index - m) / 26);
  }
  return s;
}

// ============ VALIDATION AND FORMATTING ============

function applyValidationAndFormatting_(cfg) {
  var tSheet = ss_().getSheetByName(SHEET.TICKETS);
  var tMap = headerMap(tSheet);
  var rows = Math.max(1, tSheet.getLastRow() - 1);

  var ticketStatuses = [TICKET_STATUS.AVAILABLE, TICKET_STATUS.RESERVED, TICKET_STATUS.SOLD,
                        TICKET_STATUS.DONATED, TICKET_STATUS.VOID];
  tSheet.getRange(2, tMap.Status, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ticketStatuses, true).build());
  tSheet.getRange(2, tMap.Sale_Date, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  tSheet.getRange(2, tMap.Modified_Date, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  // Phone numbers are text: a leading zero must survive.
  tSheet.getRange(2, tMap.Buyer_Phone, rows, 1).setNumberFormat('@');

  var bSheet = ss_().getSheetByName(SHEET.BOOKS);
  var bMap = headerMap(bSheet);
  var bRows = Math.max(1, bSheet.getLastRow() - 1);
  var bookStatuses = [BOOK_STATUS.UNASSIGNED, BOOK_STATUS.OUT, BOOK_STATUS.RETURNED,
                      BOOK_STATUS.SETTLED, BOOK_STATUS.LOST, BOOK_STATUS.VOID];
  bSheet.getRange(2, bMap.Status, bRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(bookStatuses, true).build());
  bSheet.getRange(2, bMap.Issued_Date, bRows, 1).setNumberFormat('yyyy-mm-dd');
  bSheet.getRange(2, bMap.Due_Date, bRows, 1).setNumberFormat('yyyy-mm-dd');
  bSheet.getRange(2, bMap.Settled_Date, bRows, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  var money = cfg.CURRENCY ? '"' + cfg.CURRENCY + ' "#,##0.00' : '#,##0.00';
  bSheet.getRange(2, bMap.Amount_Due, bRows, 1).setNumberFormat(money);
  bSheet.getRange(2, bMap.Amount_Paid, bRows, 1).setNumberFormat(money);
  bSheet.getRange(2, bMap.Recorded_Amount, bRows, 1).setNumberFormat(money);
  bSheet.getRange(2, bMap.Variance_Amount, bRows, 1).setNumberFormat(money);

  var aSheet = ss_().getSheetByName(SHEET.AGENTS);
  var aMap = headerMap(aSheet);
  aSheet.getRange(2, aMap.Phone, Math.max(1, aSheet.getMaxRows() - 1), 1).setNumberFormat('@');

  var uSheet = ss_().getSheetByName(SHEET.USERS);
  var uMap = headerMap(uSheet);
  uSheet.getRange(2, uMap.Role, Math.max(1, uSheet.getMaxRows() - 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([ROLES.ADMIN, ROLES.RECORDER, ROLES.AGENT, ROLES.VIEWER], true).build());
}

function seedBootstrapAdmin_() {
  var email = superAdminEmail_();
  if (!email) {
    Logger.log('No SUPER_ADMIN_EMAIL set in Script Properties — do that before deploying.');
    return;
  }
  var sheet = ss_().getSheetByName(SHEET.USERS);
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim().toLowerCase() === email) return;
    }
  }
  sheet.appendRow([email, 'Super administrator', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  Logger.log('Added ' + email + ' as the super admin.');
}

// ============ BACKUP ============
// This is the only record of the money. Backing it up is not housekeeping.

function installBackupTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('dailyBackup').timeBased().atHour(2).everyDays(1).create();
  Logger.log('Daily backup trigger installed (runs about 2am).');
  return 'Daily backup installed.';
}

function dailyBackup() {
  try {
    var ss = ss_();
    var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd_HHmm');
    var folder = backupFolder_();
    var copy = DriveApp.getFileById(ss.getId()).makeCopy("K'Cho Shelter backup " + stamp, folder);
    pruneBackups_(folder, 30);
    logAudit('BACKUP', { file: copy.getName() });
    return copy.getName();
  } catch (e) {
    logAudit('BACKUP_FAILED', { error: String(e) });
    throw e;
  }
}

function backupFolder_() {
  var name = "K'Cho Shelter Backups";
  var folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function pruneBackups_(folder, keep) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  if (files.length <= keep) return;
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = keep; i < files.length; i++) files[i].setTrashed(true);
}

// ============ HEALTH CHECK ============

function verifyIntegrity() {
  var cfg = getConfig();
  var problems = [];

  var tSheet = ss_().getSheetByName(SHEET.TICKETS);
  var expectedTickets = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var actualTickets = tSheet ? Math.max(0, tSheet.getLastRow() - 1) : 0;
  if (actualTickets !== expectedTickets) {
    problems.push('Tickets: expected ' + expectedTickets + ', found ' + actualTickets);
  }

  var bSheet = ss_().getSheetByName(SHEET.BOOKS);
  var expectedBooks = totalBooks(cfg);
  var actualBooks = bSheet ? Math.max(0, bSheet.getLastRow() - 1) : 0;
  if (actualBooks !== expectedBooks) {
    problems.push('Books: expected ' + expectedBooks + ', found ' + actualBooks);
  }

  // The one thing set_active_tickets guards against and a hand edit does not:
  // an ACTIVE_TICKETS typed straight into the Config tab, below tickets that
  // are already sold. Those tickets stop being loaded, so the money they
  // represent disappears from every total while the sale itself still sits in
  // the sheet. Loud rather than silent, and reversible by raising the number
  // back — but worth naming here rather than leaving somebody to work it out
  // from a total that dropped overnight.
  var live = activeTickets(cfg);
  if (tSheet && live < actualTickets) {
    var sMap = headerMap(tSheet);
    var above = actualTickets - live;
    var stat = tSheet.getRange(live + 2, sMap.Status, above, 1).getValues();
    var nums = tSheet.getRange(live + 2, sMap.Ticket_Number, above, 1).getValues();
    var stranded = [];
    for (var s = 0; s < stat.length && stranded.length < 5; s++) {
      var v = String(stat[s][0] || '');
      if (v === TICKET_STATUS.SOLD || v === TICKET_STATUS.DONATED || v === TICKET_STATUS.RESERVED) {
        stranded.push(String(nums[s][0]).trim() + ' (' + v.toLowerCase() + ')');
      }
    }
    if (stranded.length) {
      problems.push('ACTIVE_TICKETS is ' + live + ', but tickets above that line are already ' +
        'spoken for — ' + stranded.join(', ') + '. They are not being loaded, so their money ' +
        'is missing from every total. Raise ACTIVE_TICKETS back to at least ' + actualTickets +
        ', or change it on the "Tickets in play" screen, which refuses this.');
    }
  }

  // Ticket numbers must sit in the row the arithmetic predicts, or every fast
  // path falls back to a scan.
  if (tSheet && actualTickets > 0) {
    var map = headerMap(tSheet);
    var nums = tSheet.getRange(2, map.Ticket_Number, actualTickets, 1).getValues();
    var outOfOrder = 0, wrongBook = 0;
    var books = tSheet.getRange(2, map.Book_Number, actualTickets, 1).getValues();
    for (var i = 0; i < nums.length; i++) {
      if (String(nums[i][0]).trim() !== ticketNumberAt(i + 1, cfg)) outOfOrder++;
      var expectBook = bookOfTicket(String(nums[i][0]).trim(), cfg);
      if (expectBook && String(books[i][0]).trim() !== expectBook) wrongBook++;
    }
    if (outOfOrder) problems.push(outOfOrder + ' ticket rows are not in numbered order (sort the Tickets tab by Ticket_Number)');
    if (wrongBook) problems.push(wrongBook + ' tickets have the wrong Book_Number');
  }

  // A book cannot be out with someone who is not on the agent list.
  var agents = agentNameMap_();
  var booksData = readBooksRaw_();
  var orphans = 0, overSold = 0;
  for (var j = 0; j < booksData.length; j++) {
    var id = String(booksData[j].Held_By_Agent || '').trim();
    if (id && !agents[id]) orphans++;
    var declared = parseInt(booksData[j].Declared_Sold, 10) || 0;
    if (declared > cfgNum(cfg, 'TICKETS_PER_BOOK', 10)) overSold++;
  }
  if (orphans) problems.push(orphans + ' books are held by an agent ID that is not in the Agents tab');
  if (overSold) problems.push(overSold + ' books declare more sales than the book contains');

  var sheet = ss_().getSheetByName('_Health') || ss_().insertSheet('_Health');
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['Checked', new Date()]]);
  if (problems.length) {
    var out = problems.map(function (p) { return [p]; });
    sheet.getRange(3, 1, 1, 1).setValues([['Problems found:']]).setFontWeight('bold');
    sheet.getRange(4, 1, out.length, 1).setValues(out);
  } else {
    sheet.getRange(3, 1).setValue('All checks passed.');
  }
  sheet.autoResizeColumn(1);

  Logger.log(problems.length ? problems.join('\n') : 'All checks passed.');
  return problems;
}

function showConfig() {
  var cfg = getConfig();
  var lines = [];
  for (var k in cfg) lines.push(k + ' = ' + cfg[k]);
  lines.push('--- derived ---');
  lines.push('total books = ' + totalBooks(cfg));
  lines.push('first ticket = ' + ticketNumberAt(1, cfg));
  lines.push('last ticket  = ' + ticketNumberAt(cfgNum(cfg, 'TOTAL_TICKETS', 0), cfg));
  Logger.log(lines.join('\n'));
  return lines.join('\n');
}

// ============ GROWING A RAFFLE THAT OUTGREW ITS RANGE ============
/**
 * Adding tickets to a raffle that is already running.
 *
 * Raising the total is safe in a way that lowering it never is. A ticket number
 * is prefix + pad(start + i - 1, digits), and this moves none of those three
 * inputs — so every ticket already printed keeps the number on the paper, every
 * book keeps its range, and the only thing that happens is new rows on the end.
 *
 * Lowering is refused outright and always will be. ticketIndex() treats any
 * position past TOTAL_TICKETS as "no such ticket", so a smaller total does not
 * raise an error anywhere: it silently un-sells every ticket above the new line,
 * including ones somebody has paid for.
 *
 * This is also the only sanctioned way to move a key in LOCKED_CONFIG_KEYS. It
 * is allowed to because it re-stamps the numbering fingerprint itself, at the
 * very end, once the rows the new total promises actually exist.
 */
/**
 * Changes the planned final size of the raffle.
 *
 * The ceiling is a guard against a slipped digit, not a commitment, so it is
 * meant to move when the plan does. It refuses to sit below the tickets that
 * already exist, because a ceiling under the floor would read as "this raffle
 * is over its limit" for ever without describing anything anybody can fix.
 */
function handleSetTicketCeiling(payload, user) {
  requireSuperAdmin_(user, 'Changing the planned size of the raffle');

  var cfg = getConfig();
  var generated = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var current = cfgNum(cfg, 'TICKET_CEILING', 0);
  var raw = payload.ceiling;
  if (raw === undefined || raw === null || String(raw).trim() === '') raw = 0;

  var target = parseInt(raw, 10);
  if (isNaN(target) || target < 0) {
    throw new ApiError('BAD_REQUEST', 'The ceiling must be a whole number, or blank for none.');
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', target ? 'The ceiling is already ' + target + '.'
                                           : 'There is already no ceiling.');
  }
  if (target > 0 && target < generated) {
    throw new ApiError('BELOW_GENERATED',
      'This raffle already has ' + generated + ' tickets, so a ceiling of ' + target +
      ' would be below what exists. Tickets cannot be removed, so set the ceiling to ' +
      generated + ' or more.',
      { generated: generated, requested: target });
  }
  if (target > MAX_TOTAL_TICKETS) {
    throw new ApiError('TOO_MANY',
      'The most this system holds is ' + MAX_TOTAL_TICKETS + ' tickets.');
  }

  setConfigValue_('TICKET_CEILING', target || '');
  logAudit('SET_TICKET_CEILING', { from: current || 'none', to: target || 'none' }, user.email);

  return {
    from: current, to: target,
    generated: generated,
    stillToRelease: target > 0 ? Math.max(0, target - generated) : null
  };
}

/**
 * Moves the line between tickets that are in play and tickets held back.
 *
 * Unlike expand_tickets this writes one cell, not ten thousand rows, and it is
 * reversible in both directions — a held-back ticket keeps its row, its number
 * and anything written on it, so releasing and un-releasing destroy nothing.
 * That is what makes it safe to offer without the typed confirmation expansion
 * demands.
 *
 * The one direction that needs a guard is DOWN, and only because of what is
 * already recorded above the line: pulling back a ticket somebody has bought,
 * or a book a seller is holding, would hide a real obligation rather than
 * cancel it. Those are refused and named.
 */
function handleSetActiveTickets(payload, user) {
  requireSuperAdmin_(user, 'Releasing or holding back tickets');

  var cfg = getConfig();
  var generated = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);
  var current = activeTickets(cfg);
  var target = parseInt(requireField_(payload, 'activeTickets'), 10);

  if (isNaN(target) || target < 1) {
    throw new ApiError('BAD_REQUEST', 'activeTickets must be a whole number of at least 1.');
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', current + ' tickets are already in play.');
  }
  if (target > generated) {
    throw new ApiError('NOT_GENERATED',
      'Only ' + generated + ' tickets have been created, so ' + target + ' cannot be put ' +
      'into play. Use "Make more tickets" first, which writes the rows.',
      { generated: generated, requested: target, useAction: 'expand_tickets' });
  }
  // A book is one physical object. Half a book in play would mean a seller
  // holding paper where some stubs record a sale and some refuse.
  if (target % per !== 0 && target !== generated) {
    throw new ApiError('PARTIAL_BOOK',
      target + ' is not a whole number of books of ' + per + '. Choose a multiple of ' +
      per + ' so no book is half in play.');
  }

  // --- pulling back: only what nobody is relying on ---
  if (target < current) {
    var rows = cachedTicketRows_();
    var statusAt = TICKET_WIRE_FIELDS.indexOf('Status');
    var committed = [];
    for (var i = target; i < Math.min(current, rows.length) && committed.length < 6; i++) {
      var st = String(rows[i][statusAt] || '');
      if (st === TICKET_STATUS.SOLD || st === TICKET_STATUS.DONATED ||
          st === TICKET_STATUS.RESERVED) {
        committed.push(rows[i][0] + ' (' + st.toLowerCase() + ')');
      }
    }
    if (committed.length) {
      throw new ApiError('TICKETS_IN_USE',
        'Tickets above ' + target + ' are already spoken for — ' + committed.join(', ') +
        '. Holding them back would hide them rather than undo them, so it is refused.',
        { examples: committed });
    }

    var heldBooks = [];
    var index = indexBooks_(readBooksRaw_());
    for (var b = Math.floor(target / per) + 1; b <= activeBooks(cfg) && heldBooks.length < 6; b++) {
      var book = index[bookNumberAt(b, cfg).toUpperCase()];
      if (book && book.Status !== BOOK_STATUS.UNASSIGNED) {
        heldBooks.push(book.Book_Number + ' (' + String(book.Status).toLowerCase() + ')');
      }
    }
    if (heldBooks.length) {
      throw new ApiError('BOOKS_IN_USE',
        'Books above ' + target + ' are out or already counted — ' + heldBooks.join(', ') +
        '. Take them back before holding those tickets back.',
        { examples: heldBooks });
    }
  }

  setConfigValue_('ACTIVE_TICKETS', target);
  bumpTicketCacheVersion();
  bumpBookCacheVersion();

  logAudit('SET_ACTIVE_TICKETS', { from: current, to: target, generated: generated }, user.email);

  return {
    from: current, to: target,
    generated: generated,
    heldBack: generated - target,
    activeBooks: Math.ceil(target / per),
    firstTicket: ticketNumberAt(1, cfg),
    lastTicket: ticketNumberAt(target, cfg),
    released: target > current ? target - current : 0,
    pulledBack: target < current ? current - target : 0
  };
}

function handleExpandTickets(payload, user) {
  requireSuperAdmin_(user, 'Adding more tickets to a running raffle');

  var cfg = getConfig();
  var current = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);
  var target = parseInt(requireField_(payload, 'totalTickets'), 10);

  if (isNaN(target)) {
    throw new ApiError('BAD_REQUEST', 'totalTickets must be a whole number.');
  }

  // --- the conditions, cheapest and most alarming first ---

  if (target < current) {
    throw new ApiError('CANNOT_SHRINK',
      'The raffle has ' + current + ' tickets and cannot be reduced to ' + target + '. ' +
      'Every ticket above ' + target + ' would stop existing, including ones already sold, ' +
      'and nothing would report an error. Tickets can only be added.');
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', 'The raffle already has ' + current + ' tickets.');
  }
  // The planned size of this particular raffle, checked before the system limit
  // because it is the more specific answer. It exists because the dangerous
  // mistake here is not asking for too many on purpose — it is a slipped digit
  // turning 10,000 into 100,000, which would append ninety thousand rows and
  // cannot be undone by shrinking afterwards.
  var ceiling = cfgNum(cfg, 'TICKET_CEILING', 0);
  if (ceiling > 0 && target > ceiling) {
    throw new ApiError('ABOVE_CEILING',
      'This raffle is planned to reach ' + ceiling + ' tickets and you have asked for ' +
      target + '. If that is really the intention, raise TICKET_CEILING in the Config ' +
      'tab first. Tickets cannot be taken back once released, so the ceiling is checked ' +
      'before anything is written.',
      { ceiling: ceiling, requested: target, current: current });
  }

  if (target > MAX_TOTAL_TICKETS) {
    throw new ApiError('TOO_MANY',
      'The most this system holds is ' + MAX_TOTAL_TICKETS + ' tickets.');
  }

  // A partial last book would have to be rewritten rather than appended to,
  // which would take this out of append-only territory for one row.
  if (current % per !== 0) {
    throw new ApiError('PARTIAL_BOOK',
      'The last book is not full: ' + current + ' tickets does not divide into books of ' +
      per + '. Growing would have to rewrite that book rather than add to the end, ' +
      'so it is refused. This raffle has to keep the range it started with.');
  }

  var fit = numberingFitProblem_(cfg, target);
  if (fit) {
    throw new ApiError('NUMBERING_TOO_SMALL', fit +
      ' The padding cannot be widened now — that would renumber every ticket already ' +
      'printed — so this raffle cannot grow that far.');
  }

  // The arithmetic that makes a ticket cost zero lookups assumes ticket i sits
  // on row i+1. If the sheet has drifted from that, appending to the end would
  // put new tickets on rows that do not match their numbers.
  var ticketsSheet = sheet_(SHEET.TICKETS);
  var booksSheet = sheet_(SHEET.BOOKS);
  var currentBooks = totalBooks(cfg);
  var ticketRows = Math.max(0, ticketsSheet.getLastRow() - 1);
  var bookRows = Math.max(0, booksSheet.getLastRow() - 1);

  if (ticketRows !== current || bookRows !== currentBooks) {
    throw new ApiError('SHEET_DRIFT',
      'The sheet does not match the settings: the Config tab says ' + current + ' tickets in ' +
      currentBooks + ' books, but the sheet holds ' + ticketRows + ' ticket rows and ' +
      bookRows + ' book rows. Adding to the end would put new tickets on the wrong rows. ' +
      'Sort this out before growing the raffle.');
  }

  var newBooks = Math.ceil(target / per);
  var addedTickets = target - current;
  var addedBooks = newBooks - currentBooks;

  // --- preview by default, like every other wide operation here ---
  var dryRun = payload.dryRun === undefined ? true : !!payload.dryRun;
  if (dryRun) {
    return {
      dryRun: true,
      from: current, to: target,
      addedTickets: addedTickets, addedBooks: addedBooks,
      firstNewTicket: ticketNumberAt(current + 1, cfg),
      lastNewTicket: ticketNumberAt(target, cfg),
      firstNewBook: bookNumberAt(currentBooks + 1, cfg),
      lastNewBook: bookNumberAt(newBooks, cfg),
      unchanged: 'Tickets ' + ticketNumberAt(1, cfg) + ' to ' + ticketNumberAt(current, cfg) +
        ' keep the numbers they were printed with.',
      message: 'Nothing was changed. Send the same request with dryRun:false and ' +
        'confirm:"' + target + '" to apply it.'
    };
  }

  // Typing the number back is the last thing between a slip of the finger and
  // four thousand rows.
  if (String(payload.confirm || '') !== String(target)) {
    throw new ApiError('CONFIRM_REQUIRED',
      'Send confirm:"' + target + '" to add ' + addedTickets + ' tickets.');
  }

  // --- rows first, settings last ---
  // If this dies halfway the sheet carries rows the app cannot see, because
  // ticketIndex stops at TOTAL_TICKETS, and running it again finishes the job.
  // Writing the setting first would leave a raffle promising tickets that do
  // not exist, which is the failure that cannot be walked back.

  var tMap = {};
  for (var c = 0; c < COLS.TICKETS.length; c++) tMap[COLS.TICKETS[c]] = c;
  var tRows = [];
  for (var i = current + 1; i <= target; i++) {
    var row = new Array(COLS.TICKETS.length).fill('');
    row[tMap.Ticket_Number] = ticketNumberAt(i, cfg);
    row[tMap.Status] = TICKET_STATUS.AVAILABLE;
    row[tMap.Book_Number] = bookNumberAt(Math.ceil(i / per), cfg);
    row[tMap.Version] = 1;
    tRows.push(row);
  }
  writeInChunks_(ticketsSheet, tRows, current + 2);

  var bRows = [];
  for (var b = currentBooks + 1; b <= newBooks; b++) {
    var br = new Array(COLS.BOOKS.length).fill('');
    br[0] = bookNumberAt(b, cfg);
    br[1] = ticketNumberAt((b - 1) * per + 1, cfg);
    br[2] = ticketNumberAt(Math.min(b * per, target), cfg);
    br[3] = BOOK_STATUS.UNASSIGNED;
    br[13] = 1;
    bRows.push(br.slice(0, 16));
  }
  writeInChunks_(booksSheet, bRows, currentBooks + 2);
  SpreadsheetApp.flush();

  // Now the rows exist, the setting may name them, and the fingerprint may
  // bless the setting. In that order.
  setConfigValue_('TOTAL_TICKETS', target);
  restampNumberingFingerprint_();

  // The variance highlight was ranged to the last row it found at install
  // time, so without this the new books never turn red on a mismatch.
  reapplyVarianceHighlight_();

  bumpBookCacheVersion();
  logAudit('EXPAND_TICKETS', {
    from: current, to: target, addedTickets: addedTickets, addedBooks: addedBooks
  }, user.email);

  return {
    from: current, to: target,
    addedTickets: addedTickets, addedBooks: addedBooks,
    firstNewTicket: ticketNumberAt(current + 1, cfg),
    lastNewTicket: ticketNumberAt(target, cfg),
    firstNewBook: bookNumberAt(currentBooks + 1, cfg),
    lastNewBook: bookNumberAt(newBooks, cfg)
  };
}

/**
 * Re-ranges the red "declared and recorded disagree" highlight over every book
 * row, replacing the bounded rule installed at setup rather than stacking a
 * second one on top of it.
 */
function reapplyVarianceHighlight_() {
  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var col = map.Variance_Amount;
  if (!col) return;

  var kept = [];
  var rules = sheet.getConditionalFormatRules();
  for (var i = 0; i < rules.length; i++) {
    var ranges = rules[i].getRanges();
    var touchesVariance = false;
    for (var r = 0; r < ranges.length; r++) {
      if (ranges[r].getColumn() === col) { touchesVariance = true; break; }
    }
    if (!touchesVariance) kept.push(rules[i]);
  }

  var lastRow = Math.max(2, sheet.getLastRow());
  kept.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberNotEqualTo(0)
    .setBackground('#fee2e2')
    .setFontColor('#991b1b')
    .setRanges([sheet.getRange(2, col, lastRow - 1, 1)])
    .build());
  sheet.setConditionalFormatRules(kept);
}
