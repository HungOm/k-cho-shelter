/**
 * Raffled — Reports.gs
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


// ============ CASH HANDED IN ============
/*
 * TWO DIFFERENT MONEY EVENTS were being shown as one:
 *
 *   the BUYER paid the SELLER      Payment_Status on the ticket, out in the field
 *   the SELLER handed cash to us   a row here, at a table, in person
 *
 * Only the second one is a debt being cleared, and until now the only way to
 * record it was settling a whole book — so a seller who brought half the money,
 * or who kept the book to sell the rest, could not be recorded at all.
 *
 * MONEY FOLLOWS CUSTODY, NOT WHOEVER TYPED IT IN. A helper records sales that
 * are credited to the book's holder, so a helper never owes anything. Keying on
 * Agent_ID is what makes "what I owe" answerable for a seller and correctly
 * empty for a helper carrying no books — rather than a rule about roles, which
 * would disagree with itself the first time somebody was both.
 */

/** Which sellers this person may be told about BY NAME; null means everybody. */
function visibleAgents_(user) {
  if (user && user.isAdmin) return null;
  var own = String((user && user.agentId) || '').trim();
  return own ? [own] : [];
}

/**
 * Whose money counts toward the TOTALS this person is shown.
 *
 * THE SAME LIST WAS ANSWERING TWO QUESTIONS, and a viewer is where that came
 * apart: no names at all, and the whole raffle's money, because oversight is
 * the entire point of the role. visibleAgents_ said [] for them, so every sum
 * came out at nought and the Money screen read Should have 0, Handed in 0,
 * Still owed 0 to the one person there to check those figures.
 *
 * A helper holding no books still gets [] here, and that is not an oversight:
 * they are carrying nobody's money, so none of the raffle's balance is
 * answerable from what they did at a desk for an afternoon.
 */
function totalsAgents_(user) {
  if (user && (user.isAdmin || user.role === ROLES.VIEWER)) return null;
  var own = String((user && user.agentId) || '').trim();
  return own ? [own] : [];
}

/**
 * Which money screen this person gets.
 *
 *   all       an organiser: every seller, by name
 *   mine      a seller, or a helper who also carries books: their own line
 *   totals    a viewer: the raffle's figures, nobody's name
 *   recorded  a helper carrying nothing: the sales THEY wrote down
 *
 * 'totals' used to mean the last three at once, so the screen could not tell an
 * auditor from a volunteer at a desk and said the same unhelpful thing to both.
 * The fourth is deliberately not 'none': a helper owes nothing and is owed
 * nothing, but they did spend an afternoon writing sales down, and that record
 * is theirs. The client assembles it from the tickets carrying their email in
 * Recorded_By, so nothing here has to hand it to them.
 */
function moneyScope_(user) {
  if (user && user.isAdmin) return 'all';
  if (String((user && user.agentId) || '').trim()) return 'mine';
  return (user && user.role === ROLES.VIEWER) ? 'totals' : 'recorded';
}

/**
 * Whether a scope carries the WHO-OWES-WHAT table. Spelled once.
 *
 * Deliberately an allow-list rather than `scope !== 'totals'`, which is what
 * was written by hand and was correct for exactly as long as there were three
 * scopes: the moment a fourth existed a helper fell through to the table and
 * was handed every seller's debts. An unknown scope is refused, not admitted.
 */
function showsSellerNames_(scope) {
  return scope === 'all' || scope === 'mine';
}

function ensurePaymentsSheet_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(SHEET.PAYMENTS);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEET.PAYMENTS);
  sheet.appendRow(COLS.PAYMENTS);
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Every payment row. Tolerant of the sheet not existing: a raffle that has
 * never recorded one should read as "nothing handed in", not as an error on a
 * screen that worked yesterday.
 */
function readPaymentsRaw_() {
  var sheet = null;
  try { sheet = ss_().getSheetByName(SHEET.PAYMENTS); } catch (e) { sheet = null; }
  if (!sheet || sheet.getLastRow() < 2) return [];
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var o = rowToObject_(values[i], map);
    if (!o.Agent_ID) continue;
    o._row = i + 2;
    o._agent = String(o.Agent_ID).trim();
    o._amount = parseFloat(o.Amount) || 0;
    rows.push(o);
  }
  return rows;
}

/**
 * What each seller has handed in: the books' own figure, plus every handover
 * the books do not know about.
 *
 * WHY IT IS A SUM OF TWO THINGS. Amount_Paid has held every settlement since
 * before the Payments tab existed and is still written when a book is closed,
 * so it stays the authority for money counted in WITH a book. What it could
 * never express is cash arriving on its own — a seller bringing half of it, or
 * keeping the book to sell the rest — and that is what the ledger adds.
 *
 * Settlement rows are EXCLUDED here: settling writes both, and counting each
 * would charge the raffle twice for the same cash. They stay in the tab so a
 * seller's history reads as one list.
 *
 * So this is the old number plus the payments that had nowhere to go before.
 * No existing total moves.
 */
function collectedByAgent_(only, ledger) {
  var by = {};
  var rowsL = (ledger || buildBookLedger_()).rows;
  for (var i = 0; i < rowsL.length; i++) {
    var holder = rowsL[i].agentId;
    if (!holder) continue;
    if (only && only.indexOf(holder) === -1) continue;
    by[holder] = Math.round(((by[holder] || 0) + rowsL[i].countedCollected) * 100) / 100;
  }

  var pays = readPaymentsRaw_();
  for (var j = 0; j < pays.length; j++) {
    if (String(pays[j].Source || '') === 'settlement') continue;
    var id = pays[j]._agent;
    if (only && only.indexOf(id) === -1) continue;
    by[id] = Math.round(((by[id] || 0) + pays[j]._amount) * 100) / 100;
  }
  return by;
}

function nextPaymentId_() {
  return 'P' + Date.now().toString(36).toUpperCase() +
    '-' + Math.floor(Math.random() * 1679616).toString(36).toUpperCase();
}

/** What one seller still owes: expected, minus everything handed in. */
function owedBy_(agentId) {
  var ledger = buildBookLedger_();
  var expected = 0;
  for (var i = 0; i < ledger.rows.length; i++) {
    if (ledger.rows[i].agentId === agentId) expected += ledger.rows[i].countedExpected;
  }
  var paid = collectedByAgent_([agentId])[agentId] || 0;
  return Math.round((expected - paid) * 100) / 100;
}

function handleRecordPayment(payload, user) {
  var agentId = String(payload.agentId || '').trim();
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Who handed the money in?');

  var amount = Math.round(parseFloat(payload.amount) * 100) / 100;
  if (isNaN(amount) || amount <= 0) {
    throw new ApiError('MISSING_FIELD', 'How much was handed in?');
  }

  var agent = findAgent_(agentId);
  if (!agent) {
    throw new ApiError('AGENT_NOT_FOUND', 'There is no seller with the ID "' + agentId + '".');
  }

  // A helper may record what they were handed, but only for a seller — never
  // reassign it. Same scoping the reports use.
  var allowed = visibleAgents_(user);
  if (allowed && allowed.indexOf(agentId) === -1) {
    throw new ApiError('NOT_AUTHORIZED',
      'You can record money for yourself. Recording it for another seller is the ' +
      "organiser's to do, because it changes what that person is shown as owing.");
  }

  var bookNumber = String(payload.bookNumber || '').trim();
  if (bookNumber && !bookIndex(bookNumber, getConfig())) {
    throw new ApiError('BOOK_NOT_FOUND', 'Book ' + bookNumber + ' does not exist.');
  }

  var id = nextPaymentId_();
  ensurePaymentsSheet_().appendRow([
    id, agentId, amount, new Date(), user.email,
    String(payload.method || 'cash').trim() || 'cash',
    String(payload.note || '').trim(), bookNumber, '', 'hand'
  ]);

  logAudit('RECORD_PAYMENT',
    { agent: agentId, amount: amount, book: bookNumber || null }, user.email);

  return {
    paymentId: id,
    agentId: agentId,
    agentName: String(agent.Name || agentId),
    amount: amount,
    bookNumber: bookNumber,
    stillOwed: owedBy_(agentId)
  };
}

/**
 * Undoing is a NEW ROW, never a delete.
 *
 * Cash recorded against the wrong seller happens at a table with a queue in
 * front of it. Deleting would leave the trail saying the mistake never
 * occurred, which is exactly what somebody checking the books later needs to
 * see. So the reversal is its own entry and both survive.
 */
function handleReversePayment(payload, user) {
  var id = String(payload.paymentId || '').trim();
  if (!id) throw new ApiError('MISSING_FIELD', 'Which payment?');

  var rows = readPaymentsRaw_();
  var orig = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].Payment_ID).trim() === id) { orig = rows[i]; break; }
  }
  if (!orig) throw new ApiError('NOT_FOUND', 'There is no payment with that number.');
  if (String(orig.Reverses || '').trim()) {
    throw new ApiError('NOTHING_TO_DO', 'That entry is itself a reversal.');
  }
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j].Reverses || '').trim() === id) {
      throw new ApiError('NOTHING_TO_DO', 'That payment has already been reversed.');
    }
  }

  var reason = String(payload.reason || '').trim();
  if (!reason) {
    throw new ApiError('MISSING_FIELD',
      'Say why it is being reversed. The entry stays on the record either way, and ' +
      'a reversal nobody can explain is worse than the mistake.');
  }

  ensurePaymentsSheet_().appendRow([
    nextPaymentId_(), orig._agent, -orig._amount, new Date(), user.email,
    String(orig.Method || 'cash'), reason, String(orig.Book_Number || ''), id, 'hand'
  ]);

  logAudit('REVERSE_PAYMENT',
    { payment: id, agent: orig._agent, amount: orig._amount, reason: reason }, user.email);

  return {
    reversed: id, agentId: orig._agent, amount: orig._amount,
    stillOwed: owedBy_(orig._agent)
  };
}

function handleListPayments(payload, user) {
  var allowed = visibleAgents_(user);
  // Asking for somebody else's is turned back into your own rather than
  // refused: a refusal would only confirm the other seller exists.
  var agentId = allowed ? (allowed[0] || '') : String(payload.agentId || '').trim();
  if (!agentId) return { payments: [], agentId: '', scope: moneyScope_(user) };

  var rows = readPaymentsRaw_();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]._agent !== agentId) continue;
    var r = rows[i];
    out.push({
      id: String(r.Payment_ID).trim(),
      amount: r._amount,
      receivedAt: r.Received_At instanceof Date ? r.Received_At.toISOString() : String(r.Received_At || ''),
      receivedBy: r.Received_By || '',
      method: r.Method || 'cash',
      note: r.Note || '',
      bookNumber: r.Book_Number || '',
      reverses: String(r.Reverses || '') || null,
      source: r.Source || 'hand'
    });
  }
  out.sort(function (a, b) { return String(b.receivedAt).localeCompare(String(a.receivedAt)); });
  return { agentId: agentId, scope: moneyScope_(user), payments: out.slice(0, 200) };
}

/**
 * A settlement is also a handover, so it writes one too.
 *
 * Without this the book's declared figure and the seller's ledger would be two
 * separate truths, which is the disagreement this section exists to end. One
 * settlement row per book, replaced rather than added, so a forced re-settle
 * cannot count the same cash twice.
 *
 * Never throws — a settlement broken by its own bookkeeping echo would be a
 * money operation undone by a side note — but never silent either.
 */
function noteSettlementPayment_(agentId, bookNumber, amount, user) {
  try {
    var id = String(agentId || '').trim();
    if (!id || isNaN(amount)) return;
    var sheet = ensurePaymentsSheet_();
    var map = headerMap(sheet);
    var rows = readPaymentsRaw_();
    var existing = null;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].Source || '') === 'settlement' &&
          String(rows[i].Book_Number || '').trim() === bookNumber) { existing = rows[i]; break; }
    }

    if (!amount) {
      if (existing) sheet.deleteRows(existing._row, 1);
      return;
    }
    var rounded = Math.round(amount * 100) / 100;
    if (existing) {
      sheet.getRange(existing._row, map.Amount).setValue(rounded);
      sheet.getRange(existing._row, map.Received_At).setValue(new Date());
      sheet.getRange(existing._row, map.Received_By).setValue(user.email);
    } else {
      ensurePaymentsSheet_().appendRow([
        nextPaymentId_(), id, rounded, new Date(), user.email, 'cash',
        'Counted in with ' + bookNumber, bookNumber, '', 'settlement'
      ]);
    }
  } catch (e) {
    Logger.log('PAYMENT_NOT_RECORDED: ' + agentId + ' settling ' + bookNumber + ': ' + e);
    logAudit('PAYMENT_NOT_RECORDED',
      { agent: agentId, book: bookNumber, amount: amount,
        why: String(e && e.message ? e.message : e) },
      user && user.email);
  }
}

function handleReportOutstanding(payload, user) {
  /*
   * WHO MAY BE TOLD ABOUT WHOM, decided once, here.
   *
   * An organiser sees every seller. Anybody else sees their own line and no
   * other — a seller's debt is not another seller's business, and a helper at a
   * desk has no reason to carry the whole raffle's ledger. A viewer is trusted
   * with the totals and not with who owes them, so they get no rows at all
   * rather than a filtered list that hints at what is missing.
   *
   * TWO DECISIONS, AND THEY ARE NOT THE SAME ONE. `only` is whose money is in
   * the sum; `scope` is who gets the rows. A viewer is the person for whom the
   * answers differ — the whole raffle's money, and nobody's name — which no
   * single list can express. So the rows are built and summed over everyone
   * this person's TOTALS may include, and then released or withheld by name at
   * the bottom.
   */
  var only = totalsAgents_(user);
  var scope = moneyScope_(user);

  var ledger = buildBookLedger_();
  var agents = agentNameMap_();
  var byAgent = {};

  for (var i = 0; i < ledger.rows.length; i++) {
    var r = ledger.rows[i];
    if (!r.agentId) continue;
    if (only && only.indexOf(r.agentId) === -1) continue;

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
  }

  /*
   * HANDED IN COMES FROM THE LEDGER, not from the books.
   *
   * Amount_Paid only ever moves when a book is CLOSED, so a seller who brought
   * half the money and kept the book showed as having handed in nothing.
   * Settlement writes a payment row of its own, so a settled book still counts
   * exactly once and no existing total moves.
   */
  var paid = collectedByAgent_(only, ledger);

  var list = [], totalExpected = 0, totalCollected = 0;
  for (var id in byAgent) {
    var x = byAgent[id];
    x.collected = paid[id] || 0;
    x.outstanding = Math.round((x.expected - x.collected) * 100) / 100;
    totalExpected += x.expected;
    totalCollected += x.collected;
    list.push(x);
  }
  list.sort(function (p, q) { return q.outstanding - p.outstanding; });

  var totalOutstanding = 0;
  for (var k = 0; k < list.length; k++) totalOutstanding += list[k].outstanding;

  // A viewer gets the shape without the names: enough to see the raffle is
  // healthy, nothing about who is behind on what. Summed BEFORE the rows are
  // withheld, which is the whole reason the two decisions are separate.
  return {
    currency: ledger.currency,
    agents: showsSellerNames_(scope) ? list : [],
    scope: scope,
    totalExpected: Math.round(totalExpected * 100) / 100,
    totalCollected: Math.round(totalCollected * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100
  };
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
  /*
   * TICKET COUNTS ARE THE RAFFLE'S; THE MONEY IS WHOSE IT IS.
   *
   * Everyone may see how the raffle is doing — how many sold, how many books
   * are out, whether the draw is ready. Those are the shared facts a volunteer
   * needs to feel part of it. What narrows is the money: a helper holding no
   * books has no business carrying the whole raffle's outstanding balance, and
   * a seller's figure should be their own.
   *
   * SCOPED BY totalsAgents_, NOT visibleAgents_, and the difference is a
   * viewer. This is what fills state.totals, so it is the money on the HOME
   * screen as well as the Money one — and a viewer was reading "0 raised" on
   * the landing page of a raffle that had taken thousands, because the list
   * that decides whose NAME may be printed was being asked whose money to
   * count.
   */
  var onlyMoney = totalsAgents_(user);

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
    if (!onlyMoney || onlyMoney.indexOf(r.agentId) !== -1) {
      totals.expected += r.countedExpected;
    }
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
  // Handed in comes from the payments ledger, so a part payment counts even
  // though its book is still open.
  var paidMap = collectedByAgent_(onlyMoney);
  for (var pid in paidMap) totals.collected += paidMap[pid];

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
