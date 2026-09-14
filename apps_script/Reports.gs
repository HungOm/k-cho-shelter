/**
 * K'Cho Shelter — Reports.gs
 *
 * Every report obeys one rule, stated once so the totals can never
 * double-count:
 *
 *   Each book contributes from EXACTLY ONE source, chosen by its status.
 *     Unassigned / Out / Returned / Void -> sum its ticket rows.
 *     Settled / Lost                     -> use its declared figures,
 *                                           because the money that actually
 *                                           arrived is the truth.
 *
 * Recorded vs declared always appear side by side as a cross-check, but only
 * one of them ever feeds the total.
 */

/**
 * Deliberately a function rather than a top-level array.
 *
 * BOOK_STATUS is declared in Config.gs, and Apps Script concatenates .gs files
 * in whatever order the project holds them — not alphabetically, and not in an
 * order this file controls. Evaluated at load time, [BOOK_STATUS.SETTLED,
 * BOOK_STATUS.LOST] silently becomes [undefined, undefined] if Reports.gs is
 * ever placed first, and nothing throws: settled and lost books would simply
 * stop matching, and start counting toward the total on recorded figures
 * instead of declared ones. A money bug with no error message. Resolved at call
 * time, the order cannot matter.
 */
function declaredStatuses_() {
  return [BOOK_STATUS.SETTLED, BOOK_STATUS.LOST];
}

/** Loads tickets once and groups them by book. */
function ticketsByBook_() {
  var tickets = readTicketsRaw_();
  var byBook = {};
  for (var i = 0; i < tickets.length; i++) {
    var key = String(tickets[i].Book_Number || '').toUpperCase();
    if (!byBook[key]) byBook[key] = [];
    byBook[key].push(tickets[i]);
  }
  return { all: tickets, byBook: byBook };
}

function summariseTickets_(list, price) {
  var s = { sold: 0, reserved: 0, available: 0, donated: 0, voided: 0, amount: 0, missingContact: 0 };
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    switch (String(t.Status)) {
      case TICKET_STATUS.SOLD:
        s.sold++;
        s.amount += parseFloat(t.Amount) || price;
        if (isBlank_(t.Buyer_Name) || isBlank_(t.Buyer_Phone)) s.missingContact++;
        break;
      case TICKET_STATUS.DONATED:
        s.donated++;
        s.amount += parseFloat(t.Amount) || price;
        break;
      case TICKET_STATUS.RESERVED: s.reserved++; break;
      case TICKET_STATUS.VOID: s.voided++; break;
      default: s.available++;
    }
  }
  return s;
}

/**
 * The heart of every report: one pass over books and tickets producing a
 * per-book row that already knows which figures count.
 */
function buildBookLedger_() {
  var cfg = getConfig();
  var price = cfgFloat(cfg, 'TICKET_PRICE', 10);
  var data = ticketsByBook_();
  var books = readBooksRaw_();
  var agents = agentNameMap_();
  var now = new Date();
  // The wall, read once. A book past this is not late for a checkpoint that
  // will move again next month — it is late for the raffle itself, and that
  // difference is what tells an organiser which books to actually chase.
  var lastDay = cfgDate_(cfg, 'FINAL_DEADLINE');
  var finalPassed = !!(lastDay && lastDay < dayStart_(now));

  var rows = [];
  for (var i = 0; i < books.length; i++) {
    var b = books[i];
    var key = String(b.Book_Number).toUpperCase();
    var recorded = summariseTickets_(data.byBook[key] || [], price);
    var useDeclared = declaredStatuses_().indexOf(String(b.Status)) !== -1;

    var declaredSold = parseInt(b.Declared_Sold, 10) || 0;
    var amountDue = parseFloat(b.Amount_Due);
    var amountPaid = parseFloat(b.Amount_Paid);
    if (isNaN(amountDue)) amountDue = declaredSold * price;
    if (isNaN(amountPaid)) amountPaid = 0;

    var dueDate = dayStart_(b.Due_Date);
    var isOut = b.Status === BOOK_STATUS.OUT;
    var daysOverdue = (dueDate && isOut)
      ? Math.floor((now - dueDate) / 86400000)
      : 0;

    var agentId = String(b.Held_By_Agent || '').trim();
    rows.push({
      book: b.Book_Number,
      firstTicket: b.First_Ticket,
      lastTicket: b.Last_Ticket,
      status: String(b.Status || BOOK_STATUS.UNASSIGNED),
      agentId: agentId,
      agentName: agents[agentId] ? agents[agentId].name : '',
      agentPhone: agents[agentId] ? agents[agentId].phone : '',
      issued: toIso_(b.Issued_Date),
      due: toIso_(b.Due_Date),
      daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
      pastFinal: finalPassed && isOut,

      recordedSold: recorded.sold + recorded.donated,
      recordedAmount: recorded.amount,
      declaredSold: declaredSold,
      amountDue: amountDue,
      amountPaid: amountPaid,

      // Which numbers actually count toward org totals.
      countedSold: useDeclared ? declaredSold : (recorded.sold + recorded.donated),
      countedExpected: useDeclared ? amountDue : recorded.amount,
      countedCollected: useDeclared ? amountPaid : 0,
      source: useDeclared ? 'declared' : 'recorded',

      varianceSold: useDeclared ? declaredSold - (recorded.sold + recorded.donated) : 0,
      varianceAmount: useDeclared ? amountPaid - amountDue : 0,
      missingContact: recorded.missingContact,
      available: recorded.available,
      reserved: recorded.reserved
    });
  }
  return { rows: rows, tickets: data.all, price: price, currency: cfg.CURRENCY || 'RM' };
}

// ============ OUTSTANDING PER AGENT ============
// The number you actually chase.

function handleReportOutstanding(payload, user) {
  var ledger = buildBookLedger_();
  var agents = agentNameMap_();
  var byAgent = {};

  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    if (!r.agentId) continue;
    if (user.role === ROLES.AGENT && r.agentId !== user.agentId) continue;

    if (!byAgent[r.agentId]) {
      byAgent[r.agentId] = {
        agentId: r.agentId,
        name: agents[r.agentId] ? agents[r.agentId].name : r.agentId,
        phone: agents[r.agentId] ? agents[r.agentId].phone : '',
        zone: agents[r.agentId] ? agents[r.agentId].zone : '',
        booksOut: 0, booksSettled: 0, ticketsSold: 0,
        expected: 0, collected: 0, outstanding: 0, overdueBooks: 0
      };
    }
    var a = byAgent[r.agentId];
    if (r.status === BOOK_STATUS.OUT) a.booksOut++;
    if (r.status === BOOK_STATUS.SETTLED) a.booksSettled++;
    if (r.daysOverdue > 0) a.overdueBooks++;
    a.ticketsSold += r.countedSold;
    a.expected += r.countedExpected;
    a.collected += r.countedCollected;
  }

  var list = [];
  for (var id in byAgent) {
    var x = byAgent[id];
    x.outstanding = Math.round((x.expected - x.collected) * 100) / 100;
    list.push(x);
  }
  list.sort(function (p, q) { return q.outstanding - p.outstanding; });

  return { currency: ledger.currency, agents: list };
}

// ============ OVERDUE BOOKS ============
// Chasing books is the most tedious job in a raffle and the one nobody does.
// Unchased books are how the money goes missing.

function handleReportOverdue(payload, user) {
  var ledger = buildBookLedger_();
  var out = [];
  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    if (r.status !== BOOK_STATUS.OUT) continue;
    if (r.daysOverdue <= 0) continue;
    out.push({
      book: r.book,
      agentId: r.agentId,
      agentName: r.agentName,
      agentPhone: user.role === ROLES.VIEWER ? maskPhone_(r.agentPhone) : r.agentPhone,
      due: r.due,
      daysOverdue: r.daysOverdue,
      pastFinal: r.pastFinal,
      recordedSold: r.recordedSold,
      expected: r.countedExpected
    });
  }
  out.sort(function (p, q) { return q.daysOverdue - p.daysOverdue; });
  var cfg = getConfig();
  var pastFinal = 0;
  for (var k = 0; k < out.length; k++) if (out[k].pastFinal) pastFinal++;
  return {
    currency: ledger.currency,
    overdue: out,
    count: out.length,
    pastFinalCount: pastFinal,
    checkInDate: isoDay_(cfgDate_(cfg, 'CHECK_IN_DATE')),
    finalDeadline: isoDay_(cfgDate_(cfg, 'FINAL_DEADLINE'))
  };
}

// ============ MISSING CONTACT ============
// A sold ticket with no name or phone is a ticket whose winner cannot be
// found. This report exists so that number is visible from day one instead of
// being discovered on draw night.

function handleReportMissingContact(payload, user) {
  var cfg = getConfig();
  var tickets = readTicketsRaw_();
  var limit = Math.min(parseInt(payload.limit || 500, 10) || 500, 2000);

  var rows = [];
  var total = 0;
  for (var i = 0; i < tickets.length; i++) {
    var t = tickets[i];
    if (t.Status !== TICKET_STATUS.SOLD && t.Status !== TICKET_STATUS.DONATED) continue;
    if (!isBlank_(t.Buyer_Name) && !isBlank_(t.Buyer_Phone)) continue;
    total++;
    if (rows.length < limit) {
      rows.push({
        ticket: t.Ticket_Number,
        book: t.Book_Number,
        agentId: t.Sold_By_Agent,
        buyerName: t.Buyer_Name || '',
        buyerPhone: t.Buyer_Phone || '',
        source: t.Source || '',
        saleDate: toIso_(t.Sale_Date)
      });
    }
  }
  return { total: total, returned: rows.length, tickets: rows };
}

// ============ DRAW READINESS ============

function handleReportDrawReady(payload, user) {
  var ledger = buildBookLedger_();
  var cfg = getConfig();

  var totals = {
    sold: 0, available: 0, reserved: 0, voided: 0, donated: 0,
    expected: 0, collected: 0, missingContact: 0
  };
  var booksByStatus = {};
  var unsettled = 0, overdue = 0;

  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    booksByStatus[r.status] = (booksByStatus[r.status] || 0) + 1;
    totals.sold += r.countedSold;
    totals.expected += r.countedExpected;
    totals.collected += r.countedCollected;
    totals.available += r.available;
    totals.reserved += r.reserved;
    totals.missingContact += r.missingContact;
    if (r.status === BOOK_STATUS.OUT || r.status === BOOK_STATUS.RETURNED) unsettled++;
    if (r.daysOverdue > 0) overdue++;
  }

  for (var j = 0; j < ledger.tickets.length; j++) {
    var st = String(ledger.tickets[j].Status);
    if (st === TICKET_STATUS.VOID) totals.voided++;
    if (st === TICKET_STATUS.DONATED) totals.donated++;
  }

  var blockers = [];
  if (totals.missingContact > 0) {
    blockers.push(totals.missingContact + ' sold tickets have no name or phone — those winners cannot be contacted.');
  }
  if (unsettled > 0) blockers.push(unsettled + ' books are still out or unsettled.');
  if (overdue > 0) blockers.push(overdue + ' books are past their due date.');
  // The draw is what happens AFTER the final deadline. Running it early draws
  // winners from a pool that sellers are still adding to, which cannot be
  // undone once a name has been read out.
  var lastDay = cfgDate_(cfg, 'FINAL_DEADLINE');
  if (lastDay && lastDay >= today_()) {
    blockers.push('The final deadline is ' + isoDay_(lastDay) + ', ' +
      daysBetween_(today_(), lastDay) + ' days away. Sellers still have time to hand tickets in.');
  }
  if (totals.reserved > 0) blockers.push(totals.reserved + ' tickets are still reserved and unpaid.');
  var shortfall = Math.round((totals.expected - totals.collected) * 100) / 100;
  if (shortfall > 0) blockers.push(ledger.currency + ' ' + shortfall + ' of expected money has not been handed in.');

  return {
    currency: ledger.currency,
    drawDate: cfg.DRAW_DATE || '',
    checkInDate: isoDay_(cfgDate_(cfg, 'CHECK_IN_DATE')),
    finalDeadline: isoDay_(lastDay),
    finalPassed: !!(lastDay && lastDay < today_()),
    ready: blockers.length === 0,
    blockers: blockers,
    totals: {
      ticketsSold: totals.sold,
      ticketsAvailable: totals.available,
      ticketsReserved: totals.reserved,
      ticketsVoid: totals.voided,
      eligibleEntries: totals.sold - totals.voided < 0 ? 0 : totals.sold,
      expected: Math.round(totals.expected * 100) / 100,
      collected: Math.round(totals.collected * 100) / 100,
      outstanding: shortfall,
      missingContact: totals.missingContact
    },
    booksByStatus: booksByStatus
  };
}

// ============ ELIGIBLE ENTRIES (the draw list) ============

function handleExportEntries(payload, user) {
  var tickets = readTicketsRaw_();
  var agents = agentNameMap_();
  var rows = [];

  for (var i = 0; i < tickets.length; i++) {
    var t = tickets[i];
    // Only real, paid-for entries can win. Void and unsold are excluded here,
    // which is the whole point of this report.
    if (t.Status !== TICKET_STATUS.SOLD && t.Status !== TICKET_STATUS.DONATED) continue;
    var agentId = String(t.Sold_By_Agent || '').trim();
    rows.push({
      ticket: t.Ticket_Number,
      book: t.Book_Number,
      buyerName: t.Buyer_Name || '',
      buyerPhone: t.Buyer_Phone || '',
      buyerZone: t.Buyer_Zone || '',
      agentId: agentId,
      agentName: agents[agentId] ? agents[agentId].name : '',
      contactable: !isBlank_(t.Buyer_Name) && !isBlank_(t.Buyer_Phone),
      source: t.Source || ''
    });
  }

  logAudit('EXPORT_ENTRIES', { count: rows.length }, user.email);
  return { count: rows.length, entries: rows };
}

// ============ AGENT STATEMENT ============

function handleAgentStatement(payload, user) {
  var agentId = String(payload.agentId || user.agentId || '').trim();
  if (!agentId) throw new ApiError('MISSING_FIELD', 'agentId is required.');
  if (!user.isAdmin && user.role !== ROLES.RECORDER && agentId !== user.agentId) {
    throw new ApiError('NOT_AUTHORIZED', 'You can only view your own statement.');
  }

  var agent = findAgent_(agentId);
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', 'No agent with ID "' + agentId + '".');

  var ledger = buildBookLedger_();
  var cfg = getConfig();
  var books = [];
  var totals = { booksHeld: 0, ticketsSold: 0, expected: 0, collected: 0 };

  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    if (r.agentId !== agentId) continue;
    books.push({
      book: r.book,
      firstTicket: r.firstTicket,
      lastTicket: r.lastTicket,
      status: r.status,
      due: r.due,
      daysOverdue: r.daysOverdue,
      sold: r.countedSold,
      expected: r.countedExpected,
      paid: r.countedCollected,
      variance: r.varianceAmount
    });
    if (r.status === BOOK_STATUS.OUT) totals.booksHeld++;
    totals.ticketsSold += r.countedSold;
    totals.expected += r.countedExpected;
    totals.collected += r.countedCollected;
  }

  totals.outstanding = Math.round((totals.expected - totals.collected) * 100) / 100;
  totals.expected = Math.round(totals.expected * 100) / 100;
  totals.collected = Math.round(totals.collected * 100) / 100;

  return {
    org: cfg.ORG_NAME || '',
    event: cfg.EVENT_NAME || '',
    currency: ledger.currency,
    agent: { id: agentId, name: agent.Name, phone: agent.Phone, zone: agent.Zone },
    books: books,
    totals: totals,
    generatedAt: new Date().toISOString()
  };
}

// ============ AUDIT ============

function handleReadAudit(payload, user) {
  var sheet = ss_().getSheetByName(SHEET.AUDIT);
  if (!sheet || sheet.getLastRow() < 2) return { entries: [] };

  var limit = Math.min(parseInt(payload.limit || 200, 10) || 200, 1000);
  var last = sheet.getLastRow();
  var start = Math.max(2, last - limit + 1);
  var values = sheet.getRange(start, 1, last - start + 1, 4).getValues();

  var entries = [];
  for (var i = values.length - 1; i >= 0; i--) {
    entries.push({
      time: toIso_(values[i][0]),
      action: values[i][1],
      details: values[i][2],
      email: values[i][3]
    });
  }
  return { entries: entries, total: last - 1 };
}

// ============ WINNERS ============

function handleRecordWinner(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var prize = requireField_(payload, 'prize');

  var ctx = loadTicket_(ticketNumber);
  var t = ctx.ticket;
  if (t.Status !== TICKET_STATUS.SOLD && t.Status !== TICKET_STATUS.DONATED) {
    throw new ApiError('NOT_ELIGIBLE',
      'Ticket ' + ticketNumber + ' is ' + String(t.Status).toLowerCase() + ' and was not entered in the draw.');
  }

  var sheet = sheet_(SHEET.WINNERS);
  var map = headerMap(sheet);
  var existingRow = 0;
  if (sheet.getLastRow() > 1) {
    var nums = sheet.getRange(2, map.Ticket_Number, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < nums.length; i++) {
      if (String(nums[i][0]).trim().toUpperCase() === ticketNumber.toUpperCase()) { existingRow = i + 2; break; }
    }
  }

  var row = [
    ticketNumber, prize, payload.drawnDate ? new Date(payload.drawnDate) : new Date(),
    t.Buyer_Name || '', t.Buyer_Phone || '',
    payload.notified === undefined ? false : !!payload.notified,
    payload.claimed === undefined ? false : !!payload.claimed,
    payload.claimed ? new Date() : '',
    payload.notes || '',
    user.email
  ];

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, COLS.WINNERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  logAudit('RECORD_WINNER', { ticket: ticketNumber, prize: prize }, user.email);
  return {
    ticket: ticketNumber,
    prize: prize,
    buyerName: t.Buyer_Name || '',
    contactable: !isBlank_(t.Buyer_Name) && !isBlank_(t.Buyer_Phone)
  };
}

function handleListWinners(payload, user) {
  var sheet = ss_().getSheetByName(SHEET.WINNERS);
  if (!sheet || sheet.getLastRow() < 2) return { winners: [] };
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = rowToObject_(values[i], map);
    if (!r.Ticket_Number) continue;
    out.push({
      ticket: r.Ticket_Number,
      prize: r.Prize,
      drawnDate: toIso_(r.Drawn_Date),
      buyerName: r.Buyer_Name || '',
      buyerPhone: user.role === ROLES.VIEWER ? maskPhone_(r.Buyer_Phone) : (r.Buyer_Phone || ''),
      notified: isTrue_(r.Notified),
      claimed: isTrue_(r.Claimed),
      claimedDate: toIso_(r.Claimed_Date),
      notes: r.Notes || ''
    });
  }
  return { winners: out };
}
