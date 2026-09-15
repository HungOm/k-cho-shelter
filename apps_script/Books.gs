/**
 * K'Cho Shelter — Books.gs
 *
 * Custody. The Books sheet is the single source of truth for who is holding
 * which physical book; a ticket's owning agent is always derived from its
 * book, never stored on the ticket, so the two can never disagree.
 */

// ============ READING ============

function readBooksRaw_() {
  var sheet = sheet_(SHEET.BOOKS);
  if (sheet.getLastRow() < 2) return [];
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(values[i], map);
    if (!obj.Book_Number) continue;
    obj._raw = values[i];
    obj._row = i + 2;
    out.push(obj);
  }
  return out;
}

function heldByAgent_(bookNumber) {
  var b = getBookOwnerMap()[String(bookNumber).toUpperCase()];
  return b ? b.agentId : '';
}

/**
 * The holder of a book that is OUT, or ''.
 *
 * The second half of the out-with-a-seller rule. If the book is in somebody's
 * bag then they handed the ticket over, whoever typed it in afterwards, so the
 * sale is credited to them and not to whoever the payload names. That is what
 * makes an organiser transcribing a seller's report safe: the money lands on
 * the seller's balance, where settlement checks it against their stubs.
 */
function heldByAgentIfOut_(bookNumber) {
  var b = getBookOwnerMap()[String(bookNumber).toUpperCase()];
  return b && b.status === BOOK_STATUS.OUT ? (b.agentId || '') : '';
}

/**
 * Writes named columns of a book row.
 *
 * Unlike Tickets, the Books sheet ends in four ARRAYFORMULA columns
 * (Recorded_Sold, Recorded_Amount, Variance_Sold, Variance_Amount). Writing
 * the whole row would overwrite those formulas with static values and the
 * live reconciliation in the Sheet would quietly stop working — so the write
 * span stops at Modified_Date.
 */
function writeBookFields_(sheet, map, rowNum, current, patch, user) {
  var writeUpTo = map.Modified_Date;
  var values = current._raw.slice(0, writeUpTo);

  for (var field in patch) {
    if (!map[field]) continue;
    if (BOOKS_FORMULA_COLS.indexOf(field) !== -1) continue; // never
    if (map[field] > writeUpTo) continue;
    values[map[field] - 1] = patch[field];
  }
  values[map.Version - 1] = (parseInt(current.Version, 10) || 0) + 1;
  values[map.Modified_By - 1] = user.email;
  values[map.Modified_Date - 1] = new Date();

  sheet.getRange(rowNum, 1, 1, writeUpTo).setValues([values]);
}

/**
 * The same write, for many books at once.
 *
 * Every caller here used to loop and call writeBookFields_ per book, which is
 * one Sheets round trip each: handing out twenty-one books meant twenty-one
 * calls, and the spinner sat there for seconds while an admin wondered whether
 * to press it again. A range of books lands on consecutive rows, so they
 * collapse into a single setValues.
 *
 * No read is needed — readBooksRaw_ already handed us each row, on `_raw`.
 * A scattered selection costs one call per island of consecutive rows, which is
 * still never worse than the per-row version it replaces.
 */
function writeBookFieldsBatch_(sheet, map, edits, user) {
  if (!edits.length) return;
  var writeUpTo = map.Modified_Date;
  var now = new Date();

  var prepared = [];
  for (var e = 0; e < edits.length; e++) {
    var current = edits[e].current;
    var patch = edits[e].patch;
    var values = current._raw.slice(0, writeUpTo);

    for (var field in patch) {
      if (!map[field]) continue;
      if (BOOKS_FORMULA_COLS.indexOf(field) !== -1) continue;   // never
      if (map[field] > writeUpTo) continue;
      values[map[field] - 1] = patch[field];
    }
    values[map.Version - 1] = (parseInt(current.Version, 10) || 0) + 1;
    values[map.Modified_By - 1] = user.email;
    values[map.Modified_Date - 1] = now;

    prepared.push({ row: current._row, values: values });
  }

  prepared.sort(function (a, b) { return a.row - b.row; });

  var i = 0;
  while (i < prepared.length) {
    var start = i;
    while (i + 1 < prepared.length && prepared[i + 1].row === prepared[i].row + 1) i++;
    var block = [];
    for (var k = start; k <= i; k++) block.push(prepared[k].values);
    sheet.getRange(prepared[start].row, 1, block.length, writeUpTo).setValues(block);
    i++;
  }
}

function logBookHistory_(entries) {
  if (!entries.length) return;
  var sheet = sheet_(SHEET.BOOK_HISTORY);
  sheet.getRange(sheet.getLastRow() + 1, 1, entries.length, COLS.BOOK_HISTORY.length)
       .setValues(entries);
}

// ============ RANGE EXPANSION ============

/**
 * Turns {fromBook, toBook} or {bookNumbers:[...]} into a list of book numbers.
 */
function expandBookRange_(payload, cfg) {
  cfg = cfg || getConfig();

  if (payload.bookNumbers && payload.bookNumbers.length) {
    var list = [];
    for (var i = 0; i < payload.bookNumbers.length; i++) {
      var n = String(payload.bookNumbers[i]).trim();
      var nIdx = bookIndex(n, cfg);
      if (!nIdx) throw new ApiError('BOOK_NOT_FOUND', 'Book "' + n + '" does not exist.');
      list.push(bookNumberAt(nIdx, cfg));   // canonical, for the same reason
    }
    return list;
  }

  var from = requireField_(payload, 'fromBook');
  var to = payload.toBook ? String(payload.toBook).trim() : from;
  var fi = bookIndex(from, cfg);
  var ti = bookIndex(to, cfg);
  if (!fi) throw new ApiError('BOOK_NOT_FOUND', 'Book "' + from + '" does not exist.');
  if (!ti) throw new ApiError('BOOK_NOT_FOUND', 'Book "' + to + '" does not exist.');
  if (ti < fi) { var t = fi; fi = ti; ti = t; }
  if (ti - fi + 1 > 300) throw new ApiError('RANGE_TOO_LARGE', 'Handle at most 300 books at once.');

  var out = [];
  for (var b = fi; b <= ti; b++) out.push(bookNumberAt(b, cfg));
  return out;
}

/** Index book rows by number for one bulk operation. */
function indexBooks_(books) {
  var idx = {};
  for (var i = 0; i < books.length; i++) idx[String(books[i].Book_Number).toUpperCase()] = books[i];
  return idx;
}

// ============ LISTING ============

/**
 * All books, already reconciled, in one call. Filtering happens here rather
 * than the client asking per agent — otherwise browsing the books screen costs
 * one request per agent.
 */
function handleListBooks(payload, user) {
  var ledger = buildBookLedger_();
  var status = String(payload.status || '').trim();
  var agentId = String(payload.agentId || '').trim();

  // Books whose tickets are held back are left out entirely rather than shown
  // as stock. The books screen is what an organiser counts when deciding how
  // much is left to give out, and counting tickets nobody can sell yet would
  // make that number a lie.
  var cfg = getConfig();
  var liveBooks = activeBooks(cfg);
  var generatedBooks = totalBooks(cfg);

  // An agent only ever sees their own books.
  if (user.role === ROLES.AGENT) agentId = user.agentId;

  var books = [];
  var stats = {};
  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    if (bookIndex(r.book, cfg) > liveBooks) continue;   // held back
    stats[r.status] = (stats[r.status] || 0) + 1;
    if (status && r.status !== status) continue;
    if (agentId && r.agentId !== agentId) continue;
    books.push({
      book: r.book,
      firstTicket: r.firstTicket,
      lastTicket: r.lastTicket,
      status: r.status,
      agentId: r.agentId,
      agentName: r.agentName,
      due: r.due,
      daysOverdue: r.daysOverdue,
      sold: r.countedSold,
      available: r.available,
      expected: r.countedExpected,
      paid: r.countedCollected,
      variance: r.varianceAmount,
      missingContact: r.missingContact
    });
  }

  return {
    books: books, stats: stats, currency: ledger.currency,
    total: Math.min(liveBooks, ledger.rows.length),
    generatedBooks: generatedBooks,
    heldBackBooks: Math.max(0, generatedBooks - liveBooks)
  };
}

// ============ ISSUE ============

/**
 * "Pa Thang (Agent ID: A001)".
 *
 * A blocked line that says only "already out with A001" asks whoever is
 * reading it to know the agent IDs by heart, which nobody does. The name goes
 * first because that is what they actually know; the ID stays because it is
 * what the Books tab and every report are keyed on, and because two people
 * called Pa Thang is not a hypothetical.
 */
function holderLabel_(agentId, names) {
  var id = String(agentId || '').trim();
  if (!id) return '';
  var who = names[id];
  return (who && who.name) ? who.name + ' (Agent ID: ' + id + ')' : id;
}

/**
 * Turns the facts gathered during validation into the sentence the client
 * shows. The names are read only when something is actually blocked, so the
 * ordinary path never pays for a lookup it does not use.
 *
 * Each entry keeps its parts alongside the finished sentence, so a client can
 * compose it in another language without parsing English prose.
 */
function describeBlocked_(blocked, verb) {
  if (!blocked.length) return blocked;
  var names = agentNameMap_();
  for (var i = 0; i < blocked.length; i++) {
    var e = blocked[i];
    if (e.missing) { e.reason = 'not found'; continue; }
    var who = names[e.agentId];
    e.agentName = (who && who.name) ? who.name : '';
    e.holder = holderLabel_(e.agentId, names);
    e.reason = e.reason ||
      (verb + ' ' + e.status + (e.holder ? ' ' + (e.prep || 'with') + ' ' + e.holder : ''));
  }
  return blocked;
}

function handleIssueBooks(payload, user) {
  var cfg = getConfig();
  var agentId = requireField_(payload, 'agentId');
  var numbers = expandBookRange_(payload, cfg);
  var agent = findAgent_(agentId);
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + agentId + '".');

  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var index = indexBooks_(readBooksRaw_());

  // One date for everybody, not a private month per handover. Somebody who
  // collects books a fortnight late still reports at the same check-in as the
  // rest of the team, which is what makes a single reminder and a single late
  // list possible at all.
  var dueDate = dayStart_(payload.dueDate) || defaultDueDate_(cfg);

  // A per-book date is allowed to land anywhere up to the final deadline and
  // nowhere past it. Past it the paper in somebody's hand would promise them
  // time the raffle does not have, and the draw would be waiting on a book
  // that is not even late yet.
  var lastDay = cfgDate_(cfg, 'FINAL_DEADLINE');
  if (lastDay && dueDate > lastDay) {
    throw new ApiError('DUE_AFTER_FINAL',
      'These books would be due back on ' + isoDay_(dueDate) + ', after the final deadline of ' +
      isoDay_(lastDay) + '. Everything has to be back by then. Give them an earlier date, or ' +
      'move the final deadline first.',
      { due: isoDay_(dueDate), finalDeadline: isoDay_(lastDay) });
  }

  // Validate all before writing any.
  var liveBooks = activeBooks(cfg);
  var blocked = [];
  for (var i = 0; i < numbers.length; i++) {
    var b = index[numbers[i].toUpperCase()];
    if (!b) { blocked.push({ book: numbers[i], missing: true }); continue; }
    // Held back. Handing this over would give somebody paper whose tickets
    // refuse to record a sale, which they would only discover at the doorstep.
    if (bookIndex(numbers[i], cfg) > liveBooks) {
      blocked.push({ book: numbers[i], status: 'not released yet', agentId: '' });
      continue;
    }
    if (b.Status !== BOOK_STATUS.UNASSIGNED && !payload.force) {
      blocked.push({
        book: numbers[i],
        status: String(b.Status).toLowerCase(),
        agentId: String(b.Held_By_Agent || '').trim()
      });
    }
  }
  if (blocked.length) {
    describeBlocked_(blocked, 'already');
    throw new ApiError('BOOKS_NOT_AVAILABLE',
      blocked.length + ' of ' + numbers.length + ' books are not free to issue. Nothing was changed.',
      { blocked: blocked });
  }

  var now = new Date();
  var history = [];
  var edits = [];
  for (var j = 0; j < numbers.length; j++) {
    var book = index[numbers[j].toUpperCase()];
    edits.push({ current: book, patch: {
      Status: BOOK_STATUS.OUT,
      Held_By_Agent: agentId,
      Issued_Date: now,
      Due_Date: dueDate,
      Notes: payload.note || book.Notes || ''
    } });
    history.push([now, numbers[j], book.Held_By_Agent || '', agentId, 'issue', user.email, payload.note || '']);
  }
  writeBookFieldsBatch_(sheet, map, edits, user);
  logBookHistory_(history);
  bumpBookCacheVersion();

  logAudit('ISSUE_BOOKS', { count: numbers.length, agent: agentId, from: numbers[0], to: numbers[numbers.length - 1] }, user.email);
  return {
    issued: numbers.length,
    books: numbers,
    agent: { id: agentId, name: agent.Name, phone: agent.Phone },
    dueDate: dueDate.toISOString(),
    firstTicket: index[numbers[0].toUpperCase()].First_Ticket,
    lastTicket: index[numbers[numbers.length - 1].toUpperCase()].Last_Ticket
  };
}

// ============ TRANSFER ============
// Agent A hands books to Agent B. This happens constantly in the field; if the
// system can't express it in one step, people stop recording it and the
// custody data becomes fiction within a week.

function handleTransferBooks(payload, user) {
  var cfg = getConfig();
  var toAgentId = requireField_(payload, 'toAgentId');
  var numbers = expandBookRange_(payload, cfg);
  var toAgent = findAgent_(toAgentId);
  if (!toAgent) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + toAgentId + '".');

  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var index = indexBooks_(readBooksRaw_());

  var blocked = [];
  for (var i = 0; i < numbers.length; i++) {
    var b = index[numbers[i].toUpperCase()];
    if (!b) { blocked.push({ book: numbers[i], missing: true }); continue; }
    if (b.Status !== BOOK_STATUS.OUT) {
      blocked.push({ book: numbers[i], status: String(b.Status).toLowerCase(), agentId: '',
        reason: 'is ' + String(b.Status).toLowerCase() + ', not out with anyone' });
    }
    if (String(b.Held_By_Agent) === toAgentId) {
      blocked.push({ book: numbers[i], status: 'held', prep: 'by', agentId: toAgentId });
    }
  }
  if (blocked.length) {
    describeBlocked_(blocked, 'already');
    throw new ApiError('TRANSFER_BLOCKED',
      'Some books cannot be transferred. Nothing was changed.', { blocked: blocked });
  }

  var now = new Date();
  var history = [];
  var edits = [];
  for (var j = 0; j < numbers.length; j++) {
    var book = index[numbers[j].toUpperCase()];
    var fromAgent = book.Held_By_Agent || '';
    edits.push({ current: book, patch: {
      Held_By_Agent: toAgentId,
      Issued_Date: now
    } });
    history.push([now, numbers[j], fromAgent, toAgentId, 'transfer', user.email, payload.note || '']);
  }
  writeBookFieldsBatch_(sheet, map, edits, user);
  logBookHistory_(history);
  bumpBookCacheVersion();

  logAudit('TRANSFER_BOOKS', { count: numbers.length, to: toAgentId }, user.email);
  return { transferred: numbers.length, books: numbers, toAgent: toAgent.Name };
}

// ============ RETURN ============

function handleReturnBooks(payload, user) {
  var cfg = getConfig();
  var numbers = expandBookRange_(payload, cfg);

  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var index = indexBooks_(readBooksRaw_());

  var now = new Date();
  var history = [];
  var edits = [];
  var released = 0;
  var returned = [];

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book || book.Status !== BOOK_STATUS.OUT) continue;

    // Reservations die with custody: a ticket someone was "holding" through an
    // agent who no longer has the book goes back on the shelf.
    released += releaseReservedInBook_(numbers[i], user);

    edits.push({ current: book, patch: {
      Status: BOOK_STATUS.RETURNED,
      Notes: payload.note || book.Notes || ''
    } });
    history.push([now, numbers[i], book.Held_By_Agent || '', '', 'return', user.email, payload.note || '']);
    returned.push(numbers[i]);
  }

  writeBookFieldsBatch_(sheet, map, edits, user);
  logBookHistory_(history);
  bumpBookCacheVersion();
  logAudit('RETURN_BOOKS', { count: returned.length, releasedReservations: released }, user.email);
  return { returned: returned.length, books: returned, reservationsReleased: released };
}

function releaseReservedInBook_(bookNumber, user) {
  var cfg = getConfig();
  var range = ticketRangeOfBook(bookNumber, cfg);
  if (!range) return 0;

  var sheet = sheet_(SHEET.TICKETS);
  var map = headerMap(sheet);
  var count = range.last - range.first + 1;
  var startRow = range.first + 1;
  var values = sheet.getRange(startRow, 1, count, sheet.getLastColumn()).getValues();

  var changed = 0;
  var now = new Date();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][map.Status - 1]) !== TICKET_STATUS.RESERVED) continue;
    values[i][map.Status - 1] = TICKET_STATUS.AVAILABLE;
    values[i][map.Buyer_Name - 1] = '';
    values[i][map.Buyer_Phone - 1] = '';
    values[i][map.Buyer_Zone - 1] = '';
    values[i][map.Sold_By_Agent - 1] = '';
    values[i][map.Payment_Status - 1] = '';
    values[i][map.Version - 1] = (parseInt(values[i][map.Version - 1], 10) || 0) + 1;
    values[i][map.Recorded_By - 1] = user.email;
    values[i][map.Modified_Date - 1] = now;
    changed++;
  }
  if (changed) sheet.getRange(startRow, 1, count, sheet.getLastColumn()).setValues(values);
  return changed;
}

// ============ SETTLE ============
// The agent comes back holding the tickets that did not sell. Asking for those
// numbers takes five seconds and is exact; asking "how many did you sell?"
// throws away the ticket-to-buyer mapping the draw depends on.

function handleSettleBook(payload, user) {
  var cfg = getConfig();
  var bookNumber = requireField_(payload, 'bookNumber');
  var amountPaid = parseFloat(payload.amountPaid);
  if (isNaN(amountPaid) || amountPaid < 0) {
    throw new ApiError('MISSING_FIELD', 'How much money was handed in? (amountPaid)');
  }

  var range = ticketRangeOfBook(bookNumber, cfg);
  if (!range) throw new ApiError('BOOK_NOT_FOUND', 'Book ' + bookNumber + ' does not exist.');

  var booksSheet = sheet_(SHEET.BOOKS);
  var booksMap = headerMap(booksSheet);
  var bookRow = findBookRow(booksSheet, bookNumber, cfg);
  if (!bookRow) throw new ApiError('BOOK_NOT_FOUND', 'Book ' + bookNumber + ' was not found.');

  var bookRaw = booksSheet.getRange(bookRow, 1, 1, booksSheet.getLastColumn()).getValues()[0];
  var book = rowToObject_(bookRaw, booksMap);
  book._raw = bookRaw;

  if (book.Status === BOOK_STATUS.SETTLED && !payload.force) {
    throw new ApiError('ALREADY_SETTLED', 'Book ' + bookNumber + ' is already settled.');
  }

  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);
  var agentId = book.Held_By_Agent || '';
  var now = new Date();
  var declaredSold;

  if (payload.allowUnidentified) {
    // Fallback: the leftovers were lost, so we record the book total and do NOT
    // invent ticket rows. A fabricated "Sold" on the wrong number is a lie the
    // system would then defend.
    declaredSold = parseInt(payload.soldCount, 10);
    if (isNaN(declaredSold) || declaredSold < 0) {
      throw new ApiError('MISSING_FIELD', 'How many tickets were sold? (soldCount)');
    }
    if (declaredSold > (range.last - range.first + 1)) {
      throw new ApiError('BAD_REQUEST', 'That is more tickets than the book contains.');
    }
  } else {
    var unsold = payload.unsoldTickets || [];
    var unsoldSet = {};
    for (var u = 0; u < unsold.length; u++) {
      var un = String(unsold[u]).trim().toUpperCase();
      var uIdx = ticketIndex(un, cfg);
      if (!uIdx || uIdx < range.first || uIdx > range.last) {
        throw new ApiError('NOT_IN_BOOK', 'Ticket ' + unsold[u] + ' is not in book ' + bookNumber + '.');
      }
      // Keyed by the canonical number, because settleTicketRows_ looks these up
      // against what is stored in the sheet. Keyed by the raw input, "KS-3721"
      // passed the check above and then failed to match KS-03721 — so a ticket
      // the agent had physically handed back was marked SOLD and its price
      // added to what they owed. The tolerant parse has to be followed through
      // to the comparison, or it turns into a silent charge.
      unsoldSet[ticketNumberAt(uIdx, cfg)] = true;
    }
    declaredSold = settleTicketRows_(bookNumber, range, unsoldSet, agentId, price, user, now);
  }

  var amountDue = declaredSold * price;
  writeBookFields_(booksSheet, booksMap, bookRow, book, {
    Status: BOOK_STATUS.SETTLED,
    Declared_Sold: declaredSold,
    Amount_Due: amountDue,
    Amount_Paid: amountPaid,
    Settled_Date: now,
    Settled_By: user.email,
    Notes: payload.note || book.Notes || ''
  }, user);

  logBookHistory_([[now, bookNumber, agentId, '', 'settle', user.email,
    'sold ' + declaredSold + ', due ' + amountDue + ', paid ' + amountPaid]]);
  bumpBookCacheVersion();
  logAudit('SETTLE', { book: bookNumber, sold: declaredSold, due: amountDue, paid: amountPaid }, user.email);

  // Somebody who has just settled a book has reported, and should not also have
  // to be ticked off a list by the person who counted it.
  noteReportFromSettle_(agentId, bookNumber, user);

  return {
    book: bookNumber,
    declaredSold: declaredSold,
    amountDue: amountDue,
    amountPaid: amountPaid,
    variance: amountPaid - amountDue,
    unidentified: !!payload.allowUnidentified
  };
}

/**
 * Marks everything in the book sold except the tickets handed back, in one
 * range write. Tickets already Sold or Donated keep their real buyer details.
 */
function settleTicketRows_(bookNumber, range, unsoldSet, agentId, price, user, now) {
  var sheet = sheet_(SHEET.TICKETS);
  var map = headerMap(sheet);
  var lastCol = sheet.getLastColumn();
  var count = range.last - range.first + 1;
  var startRow = range.first + 1;
  var values = sheet.getRange(startRow, 1, count, lastCol).getValues();
  var cfg = getConfig();

  var sold = 0;
  for (var i = 0; i < values.length; i++) {
    var num = String(values[i][map.Ticket_Number - 1] || '').trim().toUpperCase();
    var status = String(values[i][map.Status - 1] || '');
    var touched = false;

    if (status === TICKET_STATUS.VOID) continue;

    if (unsoldSet[num]) {
      if (status !== TICKET_STATUS.AVAILABLE) {
        values[i][map.Status - 1] = TICKET_STATUS.AVAILABLE;
        values[i][map.Buyer_Name - 1] = '';
        values[i][map.Buyer_Phone - 1] = '';
        values[i][map.Buyer_Zone - 1] = '';
        values[i][map.Sold_By_Agent - 1] = '';
        values[i][map.Amount - 1] = '';
        values[i][map.Payment_Status - 1] = '';
        values[i][map.Sale_Date - 1] = '';
        values[i][map.Source - 1] = '';
        touched = true;
      }
    } else {
      sold++;
      if (status !== TICKET_STATUS.SOLD && status !== TICKET_STATUS.DONATED) {
        // Sold, but nobody recorded who bought it. Buyer fields stay blank —
        // that is honest, and the missing-contact report will surface it.
        values[i][map.Status - 1] = TICKET_STATUS.SOLD;
        values[i][map.Sold_By_Agent - 1] = agentId;
        values[i][map.Amount - 1] = price;
        values[i][map.Payment_Status - 1] = 'Paid';
        values[i][map.Sale_Date - 1] = now;
        values[i][map.Source - 1] = 'settlement';
        touched = true;
      }
    }

    if (touched) {
      values[i][map.Version - 1] = (parseInt(values[i][map.Version - 1], 10) || 0) + 1;
      values[i][map.Recorded_By - 1] = user.email;
      values[i][map.Modified_Date - 1] = now;
    }
  }

  sheet.getRange(startRow, 1, count, lastCol).setValues(values);
  return sold;
}

// ============ SELLING A WHOLE BOOK ============

/**
 * One buyer takes a whole book, or several.
 *
 * Ten tickets to the same person is an ordinary way to sell at a community
 * event, and typing ten identical rows by hand is both slow and the easiest
 * place in the app to mistype a phone number — which is the field the draw
 * depends on.
 *
 * Every ticket carries the same buyer. That is correct rather than a shortcut:
 * they really do hold all ten, and each one still resolves to a findable person
 * when a number comes up. This is the difference from settlement, which marks a
 * book sold with the buyer fields left blank on purpose.
 *
 * Tickets already sold to somebody else are skipped and reported, never
 * overwritten.
 */
function handleSellBook(payload, user) {
  var cfg = getConfig();
  var books = expandBookRange_(payload, cfg);
  if (!books.length) throw new ApiError('BAD_REQUEST', 'No books were named.');
  if (books.length > 20) {
    throw new ApiError('RANGE_TOO_LARGE', 'Sell at most 20 books to one buyer at a time.');
  }

  var buyerName = requireField_(payload, 'buyerName');
  var buyerPhone = normalisePhone(payload.buyerPhone);
  if (buyerPhone.length < 7) {
    throw new ApiError('BAD_PHONE',
      'A phone number is needed — without one you cannot tell them if they win.');
  }

  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);
  var donated = !!payload.donated;
  var status = donated ? TICKET_STATUS.DONATED : TICKET_STATUS.SOLD;
  var now = new Date();

  var sheet = sheet_(SHEET.TICKETS);
  var map = headerMap(sheet);
  var lastCol = sheet.getLastColumn();

  // Pass 1: check every book before writing any of them, so a range that goes
  // wrong half way through does not leave half a sale recorded.
  var plan = [];
  for (var i = 0; i < books.length; i++) {
    var range = ticketRangeOfBook(books[i], cfg);
    if (!range) throw new ApiError('BOOK_NOT_FOUND', 'Book ' + books[i] + ' does not exist.');
    assertCanWriteTicket(user, ticketNumberAt(range.first, cfg),
      { force: payload.force, claiming: true });
    plan.push({ book: books[i], range: range });
  }

  var sold = [];
  var skipped = [];

  for (var p = 0; p < plan.length; p++) {
    var r = plan[p].range;
    var count = r.last - r.first + 1;
    var startRow = r.first + 1;
    var values = sheet.getRange(startRow, 1, count, lastCol).getValues();
    var agentId = heldByAgentIfOut_(plan[p].book) || payload.agentId ||
                  heldByAgent_(plan[p].book) || user.agentId || '';

    for (var v = 0; v < values.length; v++) {
      var num = String(values[v][map.Ticket_Number - 1] || '').trim();
      var st = String(values[v][map.Status - 1] || '');

      if (st === TICKET_STATUS.SOLD || st === TICKET_STATUS.DONATED) {
        skipped.push({ ticketNumber: num, reason: 'already sold' });
        continue;
      }
      if (st === TICKET_STATUS.VOID) {
        skipped.push({ ticketNumber: num, reason: 'voided' });
        continue;
      }

      values[v][map.Status - 1] = status;
      values[v][map.Buyer_Name - 1] = buyerName;
      values[v][map.Buyer_Phone - 1] = buyerPhone;
      values[v][map.Buyer_Zone - 1] = payload.buyerZone || '';
      values[v][map.Sold_By_Agent - 1] = agentId;
      values[v][map.Amount - 1] = donated ? 0 : price;
      values[v][map.Payment_Status - 1] = payload.paymentStatus || 'Paid';
      values[v][map.Sale_Date - 1] = now;
      values[v][map.Source - 1] = 'book sale';
      values[v][map.Version - 1] = (parseInt(values[v][map.Version - 1], 10) || 0) + 1;
      values[v][map.Recorded_By - 1] = user.email;
      values[v][map.Modified_Date - 1] = now;
      sold.push(num);
    }

    sheet.getRange(startRow, 1, count, lastCol).setValues(values);
  }

  if (!sold.length) {
    throw new ApiError('NOTHING_TO_DO',
      'Every ticket in ' + (books.length === 1 ? 'that book' : 'those books') +
      ' was already sold or voided. Nothing was changed.');
  }

  bumpBookCacheVersion();
  logAudit('SELL_BOOK', {
    books: books, buyer: buyerName, sold: sold.length, skipped: skipped.length, donated: donated
  }, user.email);

  return {
    books: books,
    sold: sold.length,
    tickets: sold,
    skipped: skipped,
    amount: donated ? 0 : sold.length * price,
    currency: cfg.CURRENCY || 'RM',
    buyerName: buyerName
  };
}

// ============ STATUS CHANGES (lost / void / reopen) ============

function handleSetBookStatus(payload, user) {
  var cfg = getConfig();
  var status = requireField_(payload, 'status');
  var reason = requireField_(payload, 'reason');
  var numbers = expandBookRange_(payload, cfg);

  var valid = [BOOK_STATUS.LOST, BOOK_STATUS.VOID, BOOK_STATUS.OUT, BOOK_STATUS.RETURNED, BOOK_STATUS.UNASSIGNED];
  if (valid.indexOf(status) === -1) {
    throw new ApiError('BAD_REQUEST', 'Status must be one of: ' + valid.join(', '));
  }

  var index = indexBooks_(readBooksRaw_());
  var perBook = cfgNum(cfg, 'TICKETS_PER_BOOK', 10);

  // Destructive and wide-reaching, so it previews by default. A mistyped range
  // across hundreds of books would otherwise be one click.
  var dryRun = payload.dryRun === undefined ? true : !!payload.dryRun;
  if (dryRun) {
    var sample = [];
    for (var s = 0; s < Math.min(numbers.length, 10); s++) {
      var bs = index[numbers[s].toUpperCase()];
      sample.push({ book: numbers[s], currentStatus: bs ? bs.Status : '?', agent: bs ? bs.Held_By_Agent : '' });
    }
    return {
      dryRun: true,
      wouldChangeBooks: numbers.length,
      wouldAffectTickets: numbers.length * perBook,
      newStatus: status,
      sample: sample,
      message: 'Nothing was changed. Send the same request with dryRun:false to apply it.'
    };
  }

  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var now = new Date();
  var history = [];
  var edits = [];
  var voided = 0;

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book) continue;

    // A lost book's remaining tickets can never be drawn — they were never
    // entered, so they must not be able to win.
    if (status === BOOK_STATUS.LOST || status === BOOK_STATUS.VOID) {
      voided += voidUnsoldInBook_(numbers[i], user, reason);
    }

    edits.push({ current: book, patch: {
      Status: status,
      Notes: (book.Notes ? book.Notes + ' | ' : '') + status + ': ' + reason
    } });
    history.push([now, numbers[i], book.Held_By_Agent || '', '', status.toLowerCase(), user.email, reason]);
  }

  writeBookFieldsBatch_(sheet, map, edits, user);
  logBookHistory_(history);
  bumpBookCacheVersion();
  logAudit('SET_BOOK_STATUS', { count: numbers.length, status: status, reason: reason, ticketsVoided: voided }, user.email);
  return { changed: numbers.length, newStatus: status, ticketsVoided: voided };
}

function voidUnsoldInBook_(bookNumber, user, reason) {
  var cfg = getConfig();
  var range = ticketRangeOfBook(bookNumber, cfg);
  if (!range) return 0;

  var sheet = sheet_(SHEET.TICKETS);
  var map = headerMap(sheet);
  var count = range.last - range.first + 1;
  var startRow = range.first + 1;
  var values = sheet.getRange(startRow, 1, count, sheet.getLastColumn()).getValues();

  var changed = 0;
  var now = new Date();
  for (var i = 0; i < values.length; i++) {
    var st = String(values[i][map.Status - 1] || '');
    if (st !== TICKET_STATUS.AVAILABLE && st !== TICKET_STATUS.RESERVED) continue;
    values[i][map.Status - 1] = TICKET_STATUS.VOID;
    values[i][map.Notes - 1] = 'Void (book ' + reason + ')';
    values[i][map.Version - 1] = (parseInt(values[i][map.Version - 1], 10) || 0) + 1;
    values[i][map.Recorded_By - 1] = user.email;
    values[i][map.Modified_Date - 1] = now;
    changed++;
  }
  if (changed) sheet.getRange(startRow, 1, count, sheet.getLastColumn()).setValues(values);
  return changed;
}

// ============ RESTOCK ============

function handleRestockBooks(payload, user) {
  var cfg = getConfig();
  var numbers = expandBookRange_(payload, cfg);
  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var index = indexBooks_(readBooksRaw_());

  var now = new Date();
  var history = [];
  var edits = [];
  var done = [];

  // WHY THIS CHECK EXISTS. Restocking clears Held_By_Agent, and the outstanding
  // report finds debts by looking at which agent holds a book. So restocking a
  // book somebody still owes money on does not just lose the figure — it takes
  // the debt off the chase list entirely, silently, with nothing left to show
  // it was ever there. The tickets keep Sold_By_Agent, but no report reads it.
  //
  // A book that came back untouched owes nothing and restocks freely, which is
  // the ordinary case: hand out twenty, five come back unopened. A book with
  // sales on it has to be settled first, because settling is precisely the step
  // that records what was sold and what was handed in.
  var ledger = {};
  var led = buildBookLedger_().rows;
  for (var L = 0; L < led.length; L++) ledger[String(led[L].book).toUpperCase()] = led[L];

  var owing = [];
  for (var c = 0; c < numbers.length; c++) {
    var row = ledger[numbers[c].toUpperCase()];
    if (!row) continue;
    var owed = row.countedExpected - row.countedCollected;
    if (owed > 0.005) {
      owing.push({ book: numbers[c], status: row.status, agent: row.agentName || row.agentId,
                   owed: Math.round(owed * 100) / 100 });
    }
  }
  if (owing.length) {
    throw new ApiError('MONEY_STILL_OWED',
      owing.length + ' of these books still have money owed on them. Settle them first, ' +
      'or the amount owed disappears from the outstanding report. Nothing was changed.',
      { books: owing });
  }

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book) continue;
    if (book.Status !== BOOK_STATUS.RETURNED && book.Status !== BOOK_STATUS.SETTLED) continue;

    // Snapshot the declared figures before clearing them, so settlement history
    // is not lost when a book goes back on the shelf.
    history.push([now, numbers[i], book.Held_By_Agent || '', '', 'restock', user.email,
      'was sold ' + (book.Declared_Sold || 0) + ', paid ' + (book.Amount_Paid || 0)]);

    edits.push({ current: book, patch: {
      Status: BOOK_STATUS.UNASSIGNED,
      Held_By_Agent: '', Issued_Date: '', Due_Date: '',
      Declared_Sold: '', Amount_Due: '', Amount_Paid: '',
      Settled_Date: '', Settled_By: '', Notes: ''
    } });
    done.push(numbers[i]);
  }

  writeBookFieldsBatch_(sheet, map, edits, user);
  logBookHistory_(history);
  bumpBookCacheVersion();
  logAudit('RESTOCK', { count: done.length }, user.email);
  return { restocked: done.length, books: done };
}

// ============ HANDOVER RECEIPT ============
// Without a signed record of what went out, "I never got those books" is an
// argument you cannot win.

function handleHandoverReceipt(payload, user) {
  var cfg = getConfig();
  var agentId = requireField_(payload, 'agentId');
  var agent = findAgent_(agentId);
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + agentId + '".');

  var books = readBooksRaw_();
  var held = [];
  var totalTickets = 0;

  for (var i = 0; i < books.length; i++) {
    if (String(books[i].Held_By_Agent) !== agentId) continue;
    if (books[i].Status !== BOOK_STATUS.OUT) continue;
    var range = ticketRangeOfBook(books[i].Book_Number, cfg);
    var n = range ? (range.last - range.first + 1) : 0;
    totalTickets += n;
    held.push({
      book: books[i].Book_Number,
      firstTicket: books[i].First_Ticket,
      lastTicket: books[i].Last_Ticket,
      tickets: n,
      issued: toIso_(books[i].Issued_Date),
      due: toIso_(books[i].Due_Date)
    });
  }

  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);
  return {
    org: cfg.ORG_NAME || '',
    event: cfg.EVENT_NAME || '',
    currency: cfg.CURRENCY || 'RM',
    agent: { id: agentId, name: agent.Name, phone: agent.Phone, zone: agent.Zone },
    books: held,
    bookCount: held.length,
    ticketCount: totalTickets,
    valueIfAllSold: totalTickets * price,
    issuedBy: user.displayName || user.email,
    generatedAt: new Date().toISOString()
  };
}

// ============ WHERE A BOOK HAS BEEN ============

/**
 * The history of one book: who held it, when it moved, and why.
 *
 * Every movement has been recorded since the first version — and until now
 * nothing could read it back. The Book_History sheet was a write-only log,
 * which is the worst shape for a record to be in: the cost of keeping it was
 * paid and the benefit never collected. The question it answers is an ordinary
 * one on a Saturday morning ("who had book 41 before Hla?"), and the only way
 * to answer it was to open the spreadsheet and scroll.
 *
 * Readable by anybody who can see books at all, deliberately. This is not
 * sensitive — it is agent names and dates, no buyer details — and a history
 * only an admin can open answers nobody's question.
 */
function handleBookHistory(payload, user) {
  var cfg = getConfig();
  var raw = String(payload.bookNumber || '').trim();
  if (!raw) throw new ApiError('MISSING_FIELD', 'Which book?');

  // Canonicalised, so Book-7 and Book-0007 both find it — the same tolerance
  // every other book action has.
  var idx = bookIndex(raw, cfg);
  if (!idx) throw new ApiError('BOOK_NOT_FOUND', 'Book "' + raw + '" does not exist.');
  var bookNumber = bookNumberAt(idx, cfg);

  var sheet = sheet_(SHEET.BOOK_HISTORY);
  var entries = [];
  if (sheet.getLastRow() >= 2) {
    var map = headerMap(sheet);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = rowToObject_(values[i], map);
      if (String(r.Book_Number).trim() !== bookNumber) continue;
      entries.push({
        at: toIso_(r.Timestamp),
        action: r.Action,
        from: r.From_Agent || '',
        to: r.To_Agent || '',
        by: r.By_User,
        note: r.Note || ''
      });
    }
  }

  // Agent ids are not what anybody wants to read in a history.
  var agents = readAgentsRaw_();
  var names = {};
  for (var a = 0; a < agents.length; a++) names[agents[a].Agent_ID] = agents[a].Name;
  for (var e = 0; e < entries.length; e++) {
    if (entries[e].from) entries[e].from = names[entries[e].from] || entries[e].from;
    if (entries[e].to) entries[e].to = names[entries[e].to] || entries[e].to;
  }

  var books = readBooksRaw_();
  var status = '';
  for (var b = 0; b < books.length; b++) {
    if (books[b].Book_Number === bookNumber) { status = books[b].Status; break; }
  }

  return { book: { number: bookNumber, status: status }, history: entries };
}

// ============ DEADLINES ============
// A raffle has two dates, and confusing them is how money goes missing.
//
// The CHECK-IN date is soft. It is one shared day on which everybody reports:
// what has sold, what is left, what has been collected. Nobody is finished on
// that day — the point is to find out where things stand while there is still
// time to do something about it. Once the check is done the date steps forward
// a month and the next round begins.
//
// The FINAL deadline is hard. Every book and every ringgit has to be back by
// then, because the draw happens after it. It does not step forward on its own
// and it is the wall the check-in date walks towards: CHECK_IN_DATE can never
// pass FINAL_DEADLINE, and FINAL_DEADLINE can never pass DRAW_DATE.
//
// The dangerous operation is not setting a date, it is moving one. Moving the
// check-in date forward makes late books stop being late — that is the whole
// point of a checkpoint, and also exactly how "we will collect it next month"
// becomes a year of nobody chasing anything. So both actions preview by
// default, and the preview says in plain numbers what the move erases.

/** How far ahead a single move is allowed to jump, as a typo guard. */
var MAX_CHECK_IN_MONTHS = 12;
var MAX_FINAL_YEARS = 5;

/** A week — where "due soon" starts everywhere else in this system. */
var REPORT_NOTICE_DAYS = 7;

/**
 * Every reporting round from `anchor` to `lastDay`, worked out rather than typed.
 *
 * NOBODY ENTERS THE MIDDLE DATES. A raffle has one date somebody chose — the
 * wall — and a rhythm. Asking an organiser to type each round by hand is asking
 * them to keep a calendar in their head, and it is how a round goes missing in
 * the month nobody was watching. Given the two dates that already exist, the
 * rest is arithmetic.
 *
 * It is also what lets a seller be told every one of their dates on the day
 * they collect their books, which is the only moment anybody has their
 * attention.
 *
 * A ROUND FOR EVERY STEP THAT FITS, and the wall on the end even when it falls
 * days after the last one. Two reports in one week is redundant; the obvious
 * tidy-up — folding a step that lands just short of the wall INTO the wall —
 * costs far more than it saves. That step is the last moment anybody finds out
 * forty books are still out while there are still five days to ring people, and
 * dropping it leaves a gap longer than the monthly rhythm this promises. The
 * redundancy is the cheaper failure by a distance.
 *
 * DISPLAY AND PLANNING ONLY. The roll does not take its target from here: it
 * steps the current date and clamps at the wall, exactly as it did before this
 * existed. Whether a seller is late must not depend on a derivation.
 */
function checkInSchedule_(anchor, lastDay, everyMonths) {
  if (!lastDay) return [];
  if (!anchor || anchor >= lastDay) return [lastDay];

  var step = Math.max(1, Math.floor(everyMonths) || 1);
  var out = [anchor];
  var d = anchor;
  // Capped rather than trusted: a one-month step and a raffle somebody dated
  // five years out must not spin here.
  for (var i = 0; i < 60; i++) {
    d = addMonths_(d, step);
    if (d >= lastDay) break;
    out.push(d);
  }
  out.push(lastDay);
  return out;
}

/**
 * Where one seller stands this round.
 *
 * `clear` is not `reported`: somebody holding nothing has nothing to report on,
 * and a red mark beside the name of a seller who brought everything back is how
 * a list stops being read.
 */
function reportState_(o) {
  if (o.reported) return 'reported';
  if (!o.booksOut) return 'clear';
  if (!o.checkIn) return 'waiting';
  if (daysBetween_(o.checkIn, o.now) > o.grace) return 'late';
  if (daysBetween_(o.now, o.checkIn) <= REPORT_NOTICE_DAYS) return 'due';
  return 'waiting';
}

/**
 * Which books a check-in move would re-date, and how many of them are late.
 *
 * Only books still OUT and due on or before the old check-in date move. A book
 * somebody deliberately gave a later date keeps it: pulling a due date
 * backwards would invent lateness nobody agreed to.
 */
function checkInSweep_(books, oldDate, now) {
  var moving = [], late = 0, out = 0;
  for (var i = 0; i < books.length; i++) {
    var b = books[i];
    if (b.Status !== BOOK_STATUS.OUT) continue;
    out++;
    var due = dayStart_(b.Due_Date);
    if (due && due < now) late++;
    if (!due || (oldDate && due <= oldDate)) moving.push(b);
  }
  return { moving: moving, late: late, out: out };
}

/**
 * Steps the shared check-in date forward and brings the outstanding books with
 * it, which is the monthly ritual: check where everything stands, then re-date
 * what is still out so the next round has a deadline of its own.
 */
function handleRollCheckIn(payload, user) {
  var cfg = getConfig();
  var now = today_();
  var current = cfgDate_(cfg, 'CHECK_IN_DATE');
  var lastDay = cfgDate_(cfg, 'FINAL_DEADLINE');

  // --- the conditions ---

  // A checkpoint with no wall behind it is not a checkpoint, it is an
  // extension that can be granted for ever. The final deadline is what makes
  // the monthly rhythm finite, so it has to exist before the rhythm starts.
  if (!lastDay) {
    throw new ApiError('NO_FINAL_DEADLINE',
      'There is no final deadline yet, so there is nothing for the check-in date to count ' +
      'down to. The System Admin sets that first, on the same screen.');
  }

  var from = current || now;
  var months = cfgNum(cfg, 'CHECK_IN_EVERY_MONTHS', 1);
  var round = cfgNum(cfg, 'CHECK_IN_ROUND', 1);
  // A step of the configured cadence, clamped at the wall further down. The
  // schedule is for showing people the plan, never for choosing this date.
  var target = payload.date ? dayStart_(payload.date) : addMonths_(from, months);
  if (!target) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-10-14.');
  }

  // Once the wall is behind you there is no next round to open. What is still
  // out is not late for a checkpoint any more, it is late for the raffle.
  if (lastDay < now) {
    throw new ApiError('FINAL_PASSED',
      'The final deadline was ' + isoDay_(lastDay) + ' and it has passed, so there are no ' +
      'more check-ins. Anything still out is overdue outright — chase it, or move the final ' +
      'deadline if the whole raffle is running late.',
      { finalDeadline: isoDay_(lastDay) });
  }
  if (target < now) {
    throw new ApiError('IN_THE_PAST',
      isoDay_(target) + ' has already passed. A check-in date has to be a day people can ' +
      'still report by.');
  }

  if (current && target <= current) {
    throw new ApiError('CANNOT_MOVE_BACK',
      'The check-in date is ' + isoDay_(current) + ' and you have asked for ' + isoDay_(target) +
      '. Pulling it backwards would make books late for a date that had already passed when ' +
      'they were handed over. It only moves forward.',
      { current: isoDay_(current), requested: isoDay_(target) });
  }

  var jumped = daysBetween_(from, target);
  if (jumped > MAX_CHECK_IN_MONTHS * 31) {
    throw new ApiError('TOO_FAR',
      'That is ' + jumped + ' days ahead. A check-in moves at most ' + MAX_CHECK_IN_MONTHS +
      ' months at a time, so a mistyped year cannot quietly suspend the chasing for a decade.');
  }

  // The last check-in lands ON the final deadline rather than being refused
  // for overshooting it. Refusing would leave the date stuck in the past for
  // the rest of the raffle, which is the one state that stops the check
  // happening at all.
  var isLast = target >= lastDay;
  if (isLast) target = lastDay;

  if (current && target.getTime() === current.getTime()) {
    throw new ApiError('NO_CHANGE',
      'The check-in date is already ' + isoDay_(current) + ', which is the final deadline. ' +
      'This is the last round — there is nowhere further to move it.');
  }

  var books = readBooksRaw_();
  var sweep = checkInSweep_(books, current, now);

  // --- preview by default ---
  var dryRun = payload.dryRun === undefined ? true : !!payload.dryRun;
  var summary = {
    from: current ? isoDay_(current) : '',
    to: isoDay_(target),
    finalDeadline: isoDay_(lastDay),
    isLastRound: isLast,
    round: round,
    nextRound: round + 1,
    roundsLeft: checkInSchedule_(target, lastDay, months).length,
    booksOut: sweep.out,
    booksMoving: sweep.moving.length,
    lateNow: sweep.late,
    daysGiven: daysBetween_(now, target)
  };

  if (dryRun) {
    summary.dryRun = true;
    summary.effect = sweep.late
      ? sweep.moving.length + ' books get ' + isoDay_(target) + ' as their new date, and ' +
        sweep.late + ' that are late today stop counting as late. They are not settled — ' +
        'they are being given until ' + isoDay_(target) + '.'
      : sweep.moving.length + ' books get ' + isoDay_(target) + ' as their new date. ' +
        'None are late today.';
    summary.message = sweep.late
      ? 'Nothing was changed. Send dryRun:false and confirm:"' + isoDay_(target) + '" to apply it.'
      : 'Nothing was changed. Send dryRun:false to apply it.';
    return summary;
  }

  // Typing the date back is asked for only when the move erases something:
  // books that are late today and would not be afterwards.
  if (sweep.late && String(payload.confirm || '') !== isoDay_(target)) {
    throw new ApiError('CONFIRM_REQUIRED',
      sweep.late + ' books are late today and would stop being late. Send confirm:"' +
      isoDay_(target) + '" to move the check-in date anyway.',
      { lateNow: sweep.late, to: isoDay_(target) });
  }

  if (sweep.moving.length) {
    var sheet = sheet_(SHEET.BOOKS);
    var map = headerMap(sheet);
    var edits = [];
    for (var i = 0; i < sweep.moving.length; i++) {
      edits.push({ current: sweep.moving[i], patch: { Due_Date: target } });
    }
    writeBookFieldsBatch_(sheet, map, edits, user);
    bumpBookCacheVersion();
  }

  setConfigValue_('CHECK_IN_DATE', isoDay_(target));

  /*
   * THE ROUND NUMBER MOVES WITH THE DATE, and this line is what makes the
   * reporting survive the roll.
   *
   * Everybody is un-reported for the new round the instant this is written —
   * there is no reset to run over every seller and nothing to clear — while the
   * rows for the round just closed stay exactly as they are. So rolling forward
   * forgives a late BOOK, which is the whole point of a checkpoint, without
   * also forgiving the silence, which is not.
   */
  setConfigValue_('CHECK_IN_ROUND', String(round + 1));

  // One audit line rather than a history row per book: this is not a custody
  // move, and a thousand identical "due date changed" entries would bury the
  // handovers that history exists to record.
  logAudit('ROLL_CHECK_IN', {
    from: summary.from || 'none', to: summary.to,
    books: sweep.moving.length, wasLate: sweep.late, last: isLast,
    round: round, nextRound: round + 1
  }, user.email);

  return summary;
}

/**
 * Sets the day everything has to be back by.
 *
 * Super admin only, because this is the promise the raffle makes to everybody
 * who bought a ticket: the draw happens after it. Moving it later is how a
 * fundraiser drifts for a year; moving it earlier shortens the time sellers
 * were told they had. Neither is a thing to do without meaning it.
 */
function handleSetFinalDeadline(payload, user) {
  requireSuperAdmin_(user, 'Changing the final deadline');

  var cfg = getConfig();
  var now = today_();
  var current = cfgDate_(cfg, 'FINAL_DEADLINE');
  var checkIn = cfgDate_(cfg, 'CHECK_IN_DATE');
  var draw = cfgDate_(cfg, 'DRAW_DATE');

  var raw = payload.date;
  var clearing = raw === '' || raw === null || raw === undefined;
  var target = clearing ? null : dayStart_(raw);

  if (!clearing && !target) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-12-06.');
  }
  if (!target && !current) {
    throw new ApiError('NO_CHANGE', 'There is no final deadline set.');
  }
  if (target && current && target.getTime() === current.getTime()) {
    throw new ApiError('NO_CHANGE', 'The final deadline is already ' + isoDay_(current) + '.');
  }
  if (target && target < now) {
    throw new ApiError('IN_THE_PAST',
      isoDay_(target) + ' has already passed, so nobody could meet it. ' +
      'A deadline has to be a day people can still work towards.');
  }
  if (target && daysBetween_(now, target) > MAX_FINAL_YEARS * 366) {
    throw new ApiError('TOO_FAR',
      isoDay_(target) + ' is more than ' + MAX_FINAL_YEARS + ' years away. ' +
      'Check the year before sending it again.');
  }
  // The draw cannot be run before the money is in, so a final deadline after
  // the draw date describes a raffle that draws winners from books nobody has
  // counted yet.
  if (target && draw && target > draw) {
    throw new ApiError('AFTER_DRAW',
      'The draw is set for ' + isoDay_(draw) + ' and a final deadline of ' + isoDay_(target) +
      ' would fall after it. Everything has to be back before the draw, so move DRAW_DATE ' +
      'first if the whole raffle is running later.',
      { drawDate: isoDay_(draw), requested: isoDay_(target) });
  }

  // Nothing may sit later than the wall, so shortening the raffle pulls the
  // check-in date in with it rather than leaving a checkpoint stranded past
  // the end. Said out loud in the preview, not done quietly.
  var pullsCheckIn = !!(target && checkIn && checkIn > target);

  var summary = {
    from: current ? isoDay_(current) : '',
    to: target ? isoDay_(target) : '',
    cleared: !target,
    checkInDate: isoDay_(pullsCheckIn ? target : checkIn),
    pullsCheckInBack: pullsCheckIn,
    shortens: !!(target && current && target < current),
    daysFromToday: target ? daysBetween_(now, target) : null
  };

  var dryRun = payload.dryRun === undefined ? true : !!payload.dryRun;
  if (dryRun) {
    summary.dryRun = true;
    summary.effect = !target
      ? 'The raffle would have no final deadline, and the check-in date could not be moved ' +
        'until one is set again.'
      : (pullsCheckIn
          ? 'The check-in date of ' + isoDay_(checkIn) + ' is later than that, so it comes ' +
            'back to ' + isoDay_(target) + ' as well.'
          : 'The check-in date of ' + (checkIn ? isoDay_(checkIn) : 'none') + ' is unaffected.');
    summary.message = summary.shortens || !target
      ? 'Nothing was changed. Send dryRun:false and confirm:"' + (target ? isoDay_(target) : 'clear') +
        '" to apply it.'
      : 'Nothing was changed. Send dryRun:false to apply it.';
    return summary;
  }

  // Confirmation is asked for in the two directions that take time away:
  // bringing the deadline forward, and removing it entirely.
  if (summary.shortens || !target) {
    var word = target ? isoDay_(target) : 'clear';
    if (String(payload.confirm || '') !== word) {
      throw new ApiError('CONFIRM_REQUIRED',
        (target
          ? 'That brings the final deadline forward from ' + isoDay_(current) + '. '
          : 'That removes the final deadline altogether. ') +
        'Send confirm:"' + word + '" to go ahead.');
    }
  }

  setConfigValue_('FINAL_DEADLINE', target ? isoDay_(target) : '');
  if (pullsCheckIn) setConfigValue_('CHECK_IN_DATE', isoDay_(target));

  logAudit('SET_FINAL_DEADLINE', {
    from: summary.from || 'none', to: summary.to || 'none', pulledCheckIn: pullsCheckIn
  }, user.email);

  return summary;
}

/**
 * Where the raffle stands against its two dates.
 *
 * Read-only and cheap enough for the app to show on every load, because the
 * question it answers — "is the check-in due, and is anybody late for it" —
 * is the one that stops being asked the moment it takes effort to ask.
 */
function handleDeadlineStatus(payload, user) {
  var cfg = getConfig();
  var now = today_();
  var checkIn = cfgDate_(cfg, 'CHECK_IN_DATE');
  var lastDay = cfgDate_(cfg, 'FINAL_DEADLINE');
  // The dates belong to everybody — a seller cannot report by a day nobody
  // told them about. The counts do not: raffle-wide totals are held back from
  // sellers everywhere else in this system, so here they are the books in that
  // person's own hands, which is the number they can actually act on.
  var books = readBooksRaw_();
  var mine = user && user.role === ROLES.AGENT;
  if (mine) {
    var own = [];
    for (var i = 0; i < books.length; i++) {
      if (String(books[i].Held_By_Agent || '').trim() === user.agentId) own.push(books[i]);
    }
    books = own;
  }
  var sweep = checkInSweep_(books, checkIn, now);

  // WHO STILL HAS TO REPORT is asked of the people holding books, not of every
  // name on the list. Somebody carrying nothing this round is not silent, they
  // are finished, and counting them as outstanding makes the number too big to
  // act on. `books` is already scoped above, so a seller's answer is about
  // themselves and an organiser's is about everybody.
  var holders = {}, holderCount = 0;
  for (var h = 0; h < books.length; h++) {
    if (books[h].Status !== BOOK_STATUS.OUT) continue;
    var hid = String(books[h].Held_By_Agent || '').trim();
    if (!hid || holders[hid]) continue;
    holders[hid] = true;
    holderCount++;
  }

  var months = cfgNum(cfg, 'CHECK_IN_EVERY_MONTHS', 1);
  var grace = cfgNum(cfg, 'REPORT_GRACE_DAYS', 3);
  var round = cfgNum(cfg, 'CHECK_IN_ROUND', 1);
  var answered = reportedIn_(round);

  var outstanding = 0;
  for (var hid2 in holders) { if (!answered[hid2]) outstanding++; }

  var plan = checkInSchedule_(checkIn, lastDay, months);
  var steps = [];
  for (var st = 0; st < plan.length; st++) {
    steps.push({
      date: isoDay_(plan[st]),
      round: round + st,
      last: lastDay && plan[st].getTime() === lastDay.getTime(),
      done: plan[st] < now
    });
  }

  return {
    today: isoDay_(now),
    scope: mine ? 'mine' : 'all',
    checkInDate: isoDay_(checkIn),
    finalDeadline: isoDay_(lastDay),
    drawDate: isoDay_(cfgDate_(cfg, 'DRAW_DATE')),
    daysToCheckIn: checkIn ? daysBetween_(now, checkIn) : null,
    daysToFinal: lastDay ? daysBetween_(now, lastDay) : null,
    checkInDue: !!(checkIn && checkIn <= now),
    finalPassed: !!(lastDay && lastDay < now),
    isLastRound: !!(checkIn && lastDay && checkIn.getTime() === lastDay.getTime()),
    booksOut: sweep.out,
    lateNow: sweep.late,
    // The rounds, as a plan rather than one date at a time. The DATES belong to
    // everybody — a seller cannot report by a day nobody told them about — so
    // these are not scoped the way the counts above are.
    round: round,
    everyMonths: months,
    graceDays: grace,
    reportBy: checkIn ? isoDay_(addDays_(checkIn, grace)) : '',
    schedule: steps,
    roundsLeft: steps.length,
    sellersHolding: holderCount,
    sellersReported: holderCount - outstanding,
    sellersNotReported: outstanding,
    // A seller is answered about themselves. Null for anybody else, so a screen
    // can tell "not applicable" from "no".
    youReported: mine ? !!answered[String(user.agentId || '')] : null
  };
}

// ============ REPORTING IN ============
/*
 * THE THING THAT CLEARS THE BADGE, and the reason it cannot be a dismissal.
 *
 * Every other alert in this system is derived from the books, because an alert
 * somebody can tick away is an alert everybody ticks away, and by the one time
 * it matters it has been trained into furniture. This one is about a PERSON
 * rather than a book, so it cannot be derived from the books: a seller can
 * honestly report "sold six, here is the money, I am keeping the book for the
 * rest" and still be holding it afterwards.
 *
 * So the badge clears on a RECORDED FACT — a row saying this seller answered
 * this round, who wrote it down, and what came back with them. There is still
 * nothing to dismiss: clearing the mark and recording the report are the same
 * action, and the row is what the next round is measured against.
 *
 * ONE ROW PER SELLER PER ROUND, keyed by the round NUMBER rather than the date,
 * because the date moves and the round a report answered does not. The absent
 * row for a round nobody answered stays absent for the rest of the raffle,
 * which is what lets "has missed three check-ins" survive a roll that makes
 * every book look current.
 */

function ensureCheckInsSheet_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(SHEET.CHECK_INS);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET.CHECK_INS);
  sheet.appendRow(COLS.CHECK_INS);
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Every recorded report. Tolerant of the sheet not existing: a raffle that has
 * never recorded one should read as "nobody has reported", not as an error on
 * a screen that was working yesterday.
 */
function readCheckInsRaw_() {
  var sheet = null;
  try { sheet = ss_().getSheetByName(SHEET.CHECK_INS); } catch (e) { sheet = null; }
  if (!sheet || sheet.getLastRow() < 2) return [];

  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(values[i], map);
    if (!obj.Agent_ID) continue;
    obj._row = i + 2;
    obj._round = parseInt(obj.Round, 10) || 0;
    obj._agent = String(obj.Agent_ID).trim();
    rows.push(obj);
  }
  return rows;
}

/** Who has answered THIS round: agent id -> when they did. */
function reportedIn_(round) {
  var rows = readCheckInsRaw_();
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]._round !== round) continue;
    var when = rows[i].Reported_At;
    out[rows[i]._agent] = when instanceof Date ? when.toISOString() : String(when || '');
  }
  return out;
}

/**
 * How many EARLIER rounds each seller answered.
 *
 * Subtracted from the rounds that have been and gone, this is the count of
 * check-ins somebody let pass in silence — the number the roll cannot launder.
 */
function reportsBefore_(round) {
  var rows = readCheckInsRaw_();
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]._round >= round || rows[i]._round < 1) continue;
    out[rows[i]._agent] = (out[rows[i]._agent] || 0) + 1;
  }
  return out;
}

/**
 * A settlement IS a report, so it is recorded as one.
 *
 * WITHOUT THIS, an organiser who has just counted a seller's book and taken
 * their money is then asked to tick them off a list as having reported. Asking
 * somebody to write the same fact down twice is how the second one stops
 * happening, and then the chase list shows people who were standing in front of
 * you an hour ago — which is how a list stops being believed.
 *
 * WHAT IT DOES NOT DO is copy the figures across. The money is decided by the
 * settlement and lives in the ledger; a partial amount echoed into a report
 * would read as a second, smaller settlement. This records only the fact and
 * how it is known.
 *
 * IT NEVER OVERWRITES A TYPED REPORT, and it never throws. A settle that failed
 * because of a check-in row would be a money operation broken by a side note.
 *
 * BUT IT IS NEVER SILENT EITHER, which is the harder half. Swallowing the
 * failure gets the priority right and the discoverability catastrophically
 * wrong: if the tab cannot be created on some deployment, every settle from
 * then on records nothing, the reports never appear, and an organiser chases
 * people who did in fact report — with nothing anywhere to explain why. So it
 * goes to the execution log AND to the audit log, which is a screen somebody
 * can actually open. logAudit carries its own try/catch, so saying so cannot
 * become the thing that breaks the settlement.
 */
function noteReportFromSettle_(agentId, bookNumber, user) {
  try {
    var id = String(agentId || '').trim();
    if (!id) return;
    var cfg = getConfig();
    var checkIn = cfgDate_(cfg, 'CHECK_IN_DATE');
    if (!checkIn) return;
    var round = cfgNum(cfg, 'CHECK_IN_ROUND', 1);

    var rows = readCheckInsRaw_();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]._agent === id && rows[i]._round === round) return;
    }

    ensureCheckInsSheet_().appendRow([
      id, round, isoDay_(checkIn), new Date(), 0, 0, 0,
      'Reported by settling ' + bookNumber, user.email
    ]);
  } catch (e) {
    // Caught and not rethrown — the money is already written and must not be
    // undone by a side note — but said out loud, twice, so a failure that
    // repeats can be found rather than merely suffered.
    Logger.log('CHECK_IN_NOT_RECORDED: ' + agentId + ' settling ' + bookNumber + ': ' + e);
    logAudit('CHECK_IN_NOT_RECORDED',
      { agent: agentId, book: bookNumber, why: String(e && e.message ? e.message : e) },
      user && user.email);
  }
}

/** A whole number from a form field: never NaN, never negative. */
function countField_(v) {
  var n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function amountField_(v) {
  var n = parseFloat(v);
  return isNaN(n) || n < 0 ? 0 : n;
}

function handleRecordCheckIn(payload, user) {
  var agentId = String(payload.agentId || '').trim();
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller is reporting?');

  var agent = findAgent_(agentId);
  if (!agent) {
    throw new ApiError('AGENT_NOT_FOUND', 'There is no seller with the ID "' + agentId + '".');
  }

  var cfg = getConfig();
  var checkIn = cfgDate_(cfg, 'CHECK_IN_DATE');
  if (!checkIn) {
    throw new ApiError('NO_CHECK_IN_DATE',
      'There is no check-in date, so there is no round for this to be a report on. ' +
      'Set the dates on the "Deadlines" screen first.');
  }

  var round = cfgNum(cfg, 'CHECK_IN_ROUND', 1);
  var name = String(agent.Name || agentId);

  var sheet = ensureCheckInsSheet_();
  var map = headerMap(sheet);
  var rows = readCheckInsRaw_();
  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]._agent === agentId && rows[i]._round === round) { existing = rows[i]; break; }
  }

  // UNDOING IS DELETING THE RECORD, not hiding it. Recorded against the wrong
  // seller is a thing that happens on a phone in a car park, and the fix has to
  // put that person back on the chase list rather than leave them quietly
  // marked as having answered.
  if (payload.undo) {
    if (!existing) {
      throw new ApiError('NOTHING_TO_DO',
        name + ' has not been recorded as reporting this round.');
    }
    sheet.deleteRows(existing._row, 1);
    logAudit('UNDO_CHECK_IN', { agent: agentId, round: round }, user.email);
    return {
      agentId: agentId, agentName: name, round: round,
      checkInDate: isoDay_(checkIn), undone: true
    };
  }

  var booksBack = countField_(payload.booksBack);
  var ticketsSold = countField_(payload.ticketsSold);
  var amountPaid = amountField_(payload.amountPaid);
  var note = String(payload.note || '').trim();
  var when = new Date();

  if (existing) {
    // Recorded twice is a seller who came back with more, not an error to
    // refuse: a round holds one answer per person and the later one is true.
    sheet.getRange(existing._row, map.Due_Date).setValue(isoDay_(checkIn));
    sheet.getRange(existing._row, map.Reported_At).setValue(when);
    sheet.getRange(existing._row, map.Books_Back).setValue(booksBack);
    sheet.getRange(existing._row, map.Tickets_Sold).setValue(ticketsSold);
    sheet.getRange(existing._row, map.Amount_Paid).setValue(amountPaid);
    sheet.getRange(existing._row, map.Note).setValue(note);
    sheet.getRange(existing._row, map.Recorded_By).setValue(user.email);
  } else {
    sheet.appendRow([
      agentId, round, isoDay_(checkIn), when,
      booksBack, ticketsSold, amountPaid, note, user.email
    ]);
  }

  logAudit('RECORD_CHECK_IN', {
    agent: agentId, round: round, booksBack: booksBack, amountPaid: amountPaid
  }, user.email);

  return {
    agentId: agentId,
    agentName: name,
    round: round,
    checkInDate: isoDay_(checkIn),
    updated: !!existing,
    booksBack: booksBack,
    ticketsSold: ticketsSold,
    amountPaid: amountPaid
  };
}
