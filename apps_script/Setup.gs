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

function validateConfig_(cfg) {
  var total = cfgNum(cfg, 'TOTAL_TICKETS', 0);
  var per = cfgNum(cfg, 'TICKETS_PER_BOOK', 0);
  var digits = cfgNum(cfg, 'TICKET_DIGITS', 0);
  var start = cfgNum(cfg, 'TICKET_START', 1);

  if (total < 1 || total > 50000) throw new Error('TOTAL_TICKETS must be between 1 and 50000.');
  if (per < 1 || per > 1000) throw new Error('TICKETS_PER_BOOK must be between 1 and 1000.');
  if (digits < 1 || digits > 10) throw new Error('TICKET_DIGITS must be between 1 and 10.');

  var highest = start + total - 1;
  if (String(highest).length > digits) {
    throw new Error('TICKET_DIGITS is ' + digits + ', too small for the highest ticket number ' +
      highest + '. Use at least ' + String(highest).length + ' digits.');
  }
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
function writeInChunks_(sheet, rows) {
  if (!rows.length) return;
  var CHUNK = 1000;
  var width = rows[0].length;
  var startRow = 2;
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
  var email = bootstrapAdminEmail_();
  if (!email) {
    Logger.log('No ADMIN_BOOTSTRAP_EMAIL set in Script Properties — do that before deploying.');
    return;
  }
  var sheet = ss_().getSheetByName(SHEET.USERS);
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim().toLowerCase() === email) return;
    }
  }
  sheet.appendRow([email, 'Administrator', ROLES.ADMIN, true, '', '', 'setup', new Date()]);
  Logger.log('Added ' + email + ' as admin.');
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
