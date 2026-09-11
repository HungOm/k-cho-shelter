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
      if (!bookIndex(n, cfg)) throw new ApiError('BOOK_NOT_FOUND', 'Book "' + n + '" does not exist.');
      list.push(n);
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

  // An agent only ever sees their own books.
  if (user.role === ROLES.AGENT) agentId = user.agentId;

  var books = [];
  var stats = {};
  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
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

  return { books: books, stats: stats, currency: ledger.currency, total: ledger.rows.length };
}

// ============ ISSUE ============

function handleIssueBooks(payload, user) {
  var cfg = getConfig();
  var agentId = requireField_(payload, 'agentId');
  var numbers = expandBookRange_(payload, cfg);
  var agent = findAgent_(agentId);
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + agentId + '".');

  var sheet = sheet_(SHEET.BOOKS);
  var map = headerMap(sheet);
  var index = indexBooks_(readBooksRaw_());

  var dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
  if (!dueDate || isNaN(dueDate.getTime())) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + cfgNum(cfg, 'DEFAULT_DUE_DAYS', 30));
  }

  // Validate all before writing any.
  var blocked = [];
  for (var i = 0; i < numbers.length; i++) {
    var b = index[numbers[i].toUpperCase()];
    if (!b) { blocked.push({ book: numbers[i], reason: 'not found' }); continue; }
    if (b.Status !== BOOK_STATUS.UNASSIGNED && !payload.force) {
      blocked.push({ book: numbers[i], reason: 'already ' + String(b.Status).toLowerCase() +
        (b.Held_By_Agent ? ' with ' + b.Held_By_Agent : '') });
    }
  }
  if (blocked.length) {
    throw new ApiError('BOOKS_NOT_AVAILABLE',
      blocked.length + ' of ' + numbers.length + ' books are not free to issue. Nothing was changed.',
      { blocked: blocked });
  }

  var now = new Date();
  var history = [];
  for (var j = 0; j < numbers.length; j++) {
    var book = index[numbers[j].toUpperCase()];
    writeBookFields_(sheet, map, book._row, book, {
      Status: BOOK_STATUS.OUT,
      Held_By_Agent: agentId,
      Issued_Date: now,
      Due_Date: dueDate,
      Notes: payload.note || book.Notes || ''
    }, user);
    history.push([now, numbers[j], book.Held_By_Agent || '', agentId, 'issue', user.email, payload.note || '']);
  }
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
    if (!b) { blocked.push({ book: numbers[i], reason: 'not found' }); continue; }
    if (b.Status !== BOOK_STATUS.OUT) {
      blocked.push({ book: numbers[i], reason: 'is ' + String(b.Status).toLowerCase() + ', not out with anyone' });
    }
    if (String(b.Held_By_Agent) === toAgentId) {
      blocked.push({ book: numbers[i], reason: 'already held by ' + toAgentId });
    }
  }
  if (blocked.length) {
    throw new ApiError('TRANSFER_BLOCKED',
      'Some books cannot be transferred. Nothing was changed.', { blocked: blocked });
  }

  var now = new Date();
  var history = [];
  for (var j = 0; j < numbers.length; j++) {
    var book = index[numbers[j].toUpperCase()];
    var fromAgent = book.Held_By_Agent || '';
    writeBookFields_(sheet, map, book._row, book, {
      Held_By_Agent: toAgentId,
      Issued_Date: now
    }, user);
    history.push([now, numbers[j], fromAgent, toAgentId, 'transfer', user.email, payload.note || '']);
  }
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
  var released = 0;
  var returned = [];

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book || book.Status !== BOOK_STATUS.OUT) continue;

    // Reservations die with custody: a ticket someone was "holding" through an
    // agent who no longer has the book goes back on the shelf.
    released += releaseReservedInBook_(numbers[i], user);

    writeBookFields_(sheet, map, book._row, book, {
      Status: BOOK_STATUS.RETURNED,
      Notes: payload.note || book.Notes || ''
    }, user);
    history.push([now, numbers[i], book.Held_By_Agent || '', '', 'return', user.email, payload.note || '']);
    returned.push(numbers[i]);
  }

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
      unsoldSet[un] = true;
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
  var voided = 0;

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book) continue;

    // A lost book's remaining tickets can never be drawn — they were never
    // entered, so they must not be able to win.
    if (status === BOOK_STATUS.LOST || status === BOOK_STATUS.VOID) {
      voided += voidUnsoldInBook_(numbers[i], user, reason);
    }

    writeBookFields_(sheet, map, book._row, book, {
      Status: status,
      Notes: (book.Notes ? book.Notes + ' | ' : '') + status + ': ' + reason
    }, user);
    history.push([now, numbers[i], book.Held_By_Agent || '', '', status.toLowerCase(), user.email, reason]);
  }

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
  var done = [];

  for (var i = 0; i < numbers.length; i++) {
    var book = index[numbers[i].toUpperCase()];
    if (!book) continue;
    if (book.Status !== BOOK_STATUS.RETURNED && book.Status !== BOOK_STATUS.SETTLED) continue;

    // Snapshot the declared figures before clearing them, so settlement history
    // is not lost when a book goes back on the shelf.
    history.push([now, numbers[i], book.Held_By_Agent || '', '', 'restock', user.email,
      'was sold ' + (book.Declared_Sold || 0) + ', paid ' + (book.Amount_Paid || 0)]);

    writeBookFields_(sheet, map, book._row, book, {
      Status: BOOK_STATUS.UNASSIGNED,
      Held_By_Agent: '', Issued_Date: '', Due_Date: '',
      Declared_Sold: '', Amount_Due: '', Amount_Paid: '',
      Settled_Date: '', Settled_By: '', Notes: ''
    }, user);
    done.push(numbers[i]);
  }

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
