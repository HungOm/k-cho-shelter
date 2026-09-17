/**
 * Raffled — Prizes.gs
 *
 * The prize schedule: what is on offer, how many of each, what it is worth,
 * and the awarding of it.
 *
 * WHY IT EXISTS. `record_winner` took a free-text prize. So "First prize",
 * "1st Prize" and "Grand prize" were three different prizes to everything
 * downstream; nobody could be told how many of the ten consolation prizes were
 * still to come; and the Grand Prize could be given away twice, which is a
 * thing you find out in front of the room.
 *
 * THE TYPES ARE ROWS, NOT A LIST IN THIS FILE. The obvious shape is a constant
 * array of 'cash', 'goods', 'voucher'. The day somebody has an experience day
 * or a goat to give away, a constant means editing and redeploying the script,
 * which nobody running a raffle on a Saturday morning can do. So an organiser
 * adds a type and the set that may pass is named by what is in the sheet.
 *
 * WHAT IS CLOSED IS `Valuing`, and it is not the same thing — it says how the
 * code READS Value_Amount, and the code can only read it the ways it has
 * branches for:
 *
 *   fixed    an amount of money — a car, a hamper, a voucher
 *   percent  a percentage of what has been collected. The split-the-pot draw,
 *            where the prize is not knowable until the selling stops.
 *   none     nothing declared. A donated service with no agreed value is not
 *            worth zero — zero would quietly join the totals as a valuation.
 *
 * THE PORT. Every rule here has a twin in supabase/functions/api/prizes.ts and
 * portparity.test.mjs compares the registries, so an action added on one side
 * and forgotten on the other fails a test rather than a draw.
 */

// ============ SEEDING ============

/** The four every raffle starts with. Called from setup(); safe to run twice. */
function seedPrizeTypes_() {
  var sheet = ss_().getSheetByName(SHEET.PRIZE_TYPES);
  if (!sheet) return;
  var have = {};
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) have[String(existing[i][0]).trim()] = true;
  }
  var seed = [
    ['cash', 'Cash', 'fixed', 10, true, true, ''],
    ['goods', 'Donated goods', 'fixed', 20, true, true, ''],
    ['voucher', 'Voucher', 'fixed', 30, true, true, ''],
    ['pot_share', 'Share of takings', 'percent', 40, true, true, '']
  ];
  for (var j = 0; j < seed.length; j++) {
    if (!have[seed[j][0]]) sheet.appendRow(seed[j]);
  }
}

// ============ READING ============

/** Every row of a sheet as objects, or [] if the sheet is empty or absent. */
function prizeRows_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var map = headerMap(sheet);
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = rowToObject_(values[i], map);
    r._row = i + 2;
    out.push(r);
  }
  return out;
}

/**
 * The schedule, with how much of it is gone.
 *
 * ANYONE SIGNED IN, sellers included. "What can I win?" is the question a
 * seller is asked by every person they sell a ticket to, and an answer only an
 * organiser can open is an answer given from memory at the table. There is
 * nothing to mask here — no name, no telephone number, no seller's position.
 */
function handleListPrizes(payload, user) {
  var types = prizeRows_(SHEET.PRIZE_TYPES);
  var prizes = prizeRows_(SHEET.PRIZES);
  var winners = prizeRows_(SHEET.WINNERS);

  var typeById = {};
  for (var i = 0; i < types.length; i++) typeById[String(types[i].Type_ID)] = types[i];

  /*
   * A FORFEITED PRIZE IS NOT AWARDED. It was, and then the winner could not be
   * found or never came, and the seat goes back into the schedule to be
   * redrawn. Counting it as given would leave a hamper in a cupboard with the
   * board saying it had gone.
   */
  var awarded = {}, seats = {};
  for (var w = 0; w < winners.length; w++) {
    var id = String(winners[w].Prize_ID || '').trim();
    if (!id || !isBlank_(winners[w].Forfeited_Date)) continue;
    awarded[id] = (awarded[id] || 0) + 1;
    if (!seats[id]) seats[id] = [];
    seats[id].push(Number(winners[w].Seq) || 0);
  }

  // The pot, for a share-of-takings prize, is what has actually been handed in
  // — not what the tickets are worth. A prize announced as half of money we
  // hope to collect is a promise made on somebody else's behalf.
  var collected = 0;
  var pay = ss_().getSheetByName(SHEET.PAYMENTS);
  if (pay && pay.getLastRow() > 1) {
    var pmap = headerMap(pay);
    var amounts = pay.getRange(2, pmap.Amount, pay.getLastRow() - 1, 1).getValues();
    for (var a = 0; a < amounts.length; a++) collected += Number(amounts[a][0]) || 0;
  }

  var out = [];
  for (var p = 0; p < prizes.length; p++) {
    var row = prizes[p];
    var pid = String(row.Prize_ID || '');
    if (!pid) continue;
    var t = typeById[String(row.Type_ID)] || {};
    var quantity = Number(row.Quantity) || 1;
    out.push({
      prize_id: pid,
      tier: row.Tier || '',
      name: row.Name || '',
      description: row.Description || '',
      type_id: row.Type_ID || '',
      typeLabel: t.Label || String(row.Type_ID || ''),
      valuing: t.Valuing || 'fixed',
      value_amount: Number(row.Value_Amount) || 0,
      unitValue: prizeUnitValue_(row, t, collected),
      quantity: quantity,
      rank: Number(row.Rank) || 1,
      draw_order: isBlank_(row.Draw_Order) ? null : Number(row.Draw_Order),
      donor: row.Donor || '',
      active: isTrue_(row.Active),
      awarded: awarded[pid] || 0,
      remaining: Math.max(0, quantity - (awarded[pid] || 0)),
      takenSeats: (seats[pid] || []).sort(function (x, y) { return x - y; })
    });
  }
  out.sort(function (x, y) { return x.rank - y.rank; });

  var typeOut = [];
  for (var k = 0; k < types.length; k++) {
    typeOut.push({
      type_id: types[k].Type_ID, label: types[k].Label,
      valuing: types[k].Valuing || 'fixed', sort: Number(types[k].Sort) || 0,
      active: isTrue_(types[k].Active), built_in: isTrue_(types[k].Built_In)
    });
  }
  typeOut.sort(function (x, y) { return x.sort - y.sort; });

  return { prizes: out, types: typeOut, collected: Math.round(collected * 100) / 100 };
}

/**
 * What one of a prize is worth.
 *
 * `null` for a prize with nothing declared, and null is NOT zero: zero would
 * join a total as though somebody had valued the thing at nothing.
 */
function prizeUnitValue_(prize, type, collected) {
  var amount = Number(prize.Value_Amount) || 0;
  switch (String(type.Valuing || 'fixed')) {
    case 'none': return null;
    case 'percent': return Math.round((collected || 0) * amount) / 100;
    default: return amount;
  }
}

// ============ CHANGING THE SCHEDULE ============

/**
 * An id from a name: "Grand Prize" -> "grand-prize".
 *
 * Generated rather than typed, because the id is a key the organiser never
 * sees and a key somebody types is a key somebody typos. Collisions get a
 * numeric tail rather than overwriting what is there — two prizes really can
 * both be called "Hamper".
 */
function prizeId_(base, rows, field) {
  var root = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!root) root = 'prize';
  var taken = {};
  for (var i = 0; i < rows.length; i++) taken[String(rows[i][field])] = true;
  if (!taken[root]) return root;
  for (var n = 2; ; n++) if (!taken[root + '-' + n]) return root + '-' + n;
}

function handleUpsertPrize(payload, user) {
  var tier = requireField_(payload, 'tier');
  var name = requireField_(payload, 'name');

  var types = prizeRows_(SHEET.PRIZE_TYPES);
  var typeId = String(payload.typeId || 'goods').trim();
  var type = null;
  for (var i = 0; i < types.length; i++) {
    if (String(types[i].Type_ID) === typeId) { type = types[i]; break; }
  }
  if (!type) throw new ApiError('BAD_REQUEST', 'There is no prize type called "' + typeId + '".');

  var quantity = Math.floor(Number(payload.quantity) || 1);
  if (quantity < 1) throw new ApiError('BAD_REQUEST', 'A prize has to be given at least once.');
  var value = Number(payload.value) || 0;
  if (value < 0) throw new ApiError('BAD_REQUEST', 'A prize cannot be worth less than nothing.');

  var sheet = sheet_(SHEET.PRIZES);
  var map = headerMap(sheet);
  var prizes = prizeRows_(SHEET.PRIZES);
  var existing = String(payload.prizeId || '').trim();

  if (existing) {
    var was = null;
    for (var j = 0; j < prizes.length; j++) {
      if (String(prizes[j].Prize_ID) === existing) { was = prizes[j]; break; }
    }
    if (!was) throw new ApiError('NOT_FOUND', 'There is no prize called "' + existing + '".');

    /*
     * THE LINE BETWEEN SETUP AND A DECISION. Editing a prize nobody has won is
     * setup, and any organiser does it. Editing one already AWARDED is changing
     * what somebody was told they had won — by then it has usually been said
     * out loud — so it sits with the super admin, where record_winner sits.
     */
    var given = prizeAwardedCount_(existing);
    if (!user.isSuperAdmin && given > 0) {
      throw new ApiError('SUPER_ADMIN_ONLY',
        'The ' + was.Tier + ' has already been given to somebody. Only the System Admin can change it now.');
    }
    // The quantity cannot be cut below what has already gone out, and a seat
    // number cannot be stranded above the new ceiling.
    if (quantity < given) {
      throw new ApiError('BAD_REQUEST',
        'The ' + was.Tier + ' has been given ' + given + ' times already, so it cannot be cut to ' + quantity + '.');
    }
    if (prizeHighestSeat_(existing) > quantity) {
      throw new ApiError('BAD_REQUEST', 'Somebody holds a ' + was.Tier + ' above number ' + quantity + '.');
    }

    var row = [
      existing, tier, name, payload.description || '', typeId, value, quantity,
      Math.max(1, Math.floor(Number(payload.rank) || Number(was.Rank) || 1)),
      isBlank_(payload.drawOrder) ? '' : Math.floor(Number(payload.drawOrder)),
      payload.donor || '',
      payload.active === undefined ? isTrue_(was.Active) : !!payload.active,
      was.Created_By || '', was.Created_Date || new Date()
    ];
    sheet.getRange(was._row, 1, 1, COLS.PRIZES.length).setValues([row]);
    logAudit('UPDATE_PRIZE', { prize: existing, tier: tier, name: name, quantity: quantity }, user.email);
    return { prizeId: existing, tier: tier, name: name, quantity: quantity };
  }

  var id = prizeId_(tier + ' ' + name, prizes, 'Prize_ID');
  sheet.appendRow([
    id, tier, name, payload.description || '', typeId, value, quantity,
    Math.max(1, Math.floor(Number(payload.rank) || 1)),
    isBlank_(payload.drawOrder) ? '' : Math.floor(Number(payload.drawOrder)),
    payload.donor || '', true, user.email, new Date()
  ]);
  logAudit('ADD_PRIZE', { prize: id, tier: tier, name: name, quantity: quantity }, user.email);
  return { prizeId: id, tier: tier, name: name, quantity: quantity };
}

/** How many of this prize are being held right now — forfeited ones excluded. */
function prizeAwardedCount_(prizeId) {
  var winners = prizeRows_(SHEET.WINNERS);
  var n = 0;
  for (var i = 0; i < winners.length; i++) {
    if (String(winners[i].Prize_ID || '') === prizeId && isBlank_(winners[i].Forfeited_Date)) n++;
  }
  return n;
}

/** The highest seat number anybody holds for this prize, forfeited excluded. */
function prizeHighestSeat_(prizeId) {
  var winners = prizeRows_(SHEET.WINNERS);
  var top = 0;
  for (var i = 0; i < winners.length; i++) {
    if (String(winners[i].Prize_ID || '') === prizeId && isBlank_(winners[i].Forfeited_Date)) {
      top = Math.max(top, Number(winners[i].Seq) || 0);
    }
  }
  return top;
}

/**
 * The next free seat for a prize — "the 3rd of the 10 consolation prizes".
 *
 * WHAT MAKES OVER-AWARDING IMPOSSIBLE. Not a count the caller checks and then
 * trusts: the Apps Script backend takes a document lock for every write marked
 * `lock`, and record_winner is one, so the read and the write of a seat cannot
 * be split by a second organiser. The Supabase twin has no lock and uses a
 * unique index on (prize_id, seq) to the same end.
 */
function nextPrizeSeat_(prizeId) {
  var prizes = prizeRows_(SHEET.PRIZES);
  var prize = null;
  for (var i = 0; i < prizes.length; i++) {
    if (String(prizes[i].Prize_ID) === prizeId) { prize = prizes[i]; break; }
  }
  if (!prize) throw new ApiError('NOT_FOUND', 'There is no prize called "' + prizeId + '".');
  if (!isTrue_(prize.Active)) {
    throw new ApiError('BAD_REQUEST', 'The ' + prize.Tier + ' is not being offered.');
  }

  var quantity = Number(prize.Quantity) || 1;
  var taken = {};
  var winners = prizeRows_(SHEET.WINNERS);
  for (var w = 0; w < winners.length; w++) {
    if (String(winners[w].Prize_ID || '') === prizeId && isBlank_(winners[w].Forfeited_Date)) {
      taken[Number(winners[w].Seq) || 0] = true;
    }
  }
  for (var s = 1; s <= quantity; s++) if (!taken[s]) return { seat: s, prize: prize };
  throw new ApiError('BAD_REQUEST',
    'All ' + quantity + ' of the ' + prize.Tier + ' have been given out.');
}

/**
 * Taking a prize off the schedule.
 *
 * REFUSED once anybody has won it, and deliberately not soft-deleted instead.
 * Active=false already means "not offering this after all"; a prize somebody
 * HOLDS is a different thing, and the honest move is to say what is in the way
 * rather than to hide the row and leave a winner pointing at nothing.
 */
function handleRemovePrize(payload, user) {
  var prizeId = requireField_(payload, 'prizeId');
  var sheet = sheet_(SHEET.PRIZES);
  var prizes = prizeRows_(SHEET.PRIZES);
  var found = null;
  for (var i = 0; i < prizes.length; i++) {
    if (String(prizes[i].Prize_ID) === prizeId) { found = prizes[i]; break; }
  }
  if (!found) throw new ApiError('NOT_FOUND', 'There is no prize called "' + prizeId + '".');

  // Forfeited ones count HERE, unlike everywhere else: the row still names this
  // prize, and deleting would leave it pointing at nothing.
  var winners = prizeRows_(SHEET.WINNERS);
  var drawn = 0;
  for (var w = 0; w < winners.length; w++) {
    if (String(winners[w].Prize_ID || '') === prizeId) drawn++;
  }
  if (drawn) {
    throw new ApiError('BAD_REQUEST',
      'The ' + found.Tier + ' has been drawn ' + drawn + ' time' + (drawn === 1 ? '' : 's') +
      ', so it cannot be removed. Turn it off instead and it stays on the record.');
  }

  sheet.deleteRow(found._row);
  invalidateHeaderCaches();
  logAudit('REMOVE_PRIZE', { prize: prizeId, tier: found.Tier }, user.email);
  return { prizeId: prizeId, removed: true };
}

/**
 * A new KIND of prize.
 *
 * Organisers, not the owner alone — see the header for why the types are open.
 */
function handleUpsertPrizeType(payload, user) {
  var label = requireField_(payload, 'label');
  var valuing = String(payload.valuing || 'fixed').trim();
  // Named rather than excluded. "Anything that is not X" is the shape that put
  // three defects in this repository in one day — supabase/AUDIT.md §X.
  if (valuing !== 'fixed' && valuing !== 'percent' && valuing !== 'none') {
    throw new ApiError('BAD_REQUEST',
      'A prize is worth a fixed amount, a share of what is collected, or nothing stated.');
  }

  var sheet = sheet_(SHEET.PRIZE_TYPES);
  var types = prizeRows_(SHEET.PRIZE_TYPES);
  var existing = String(payload.typeId || '').trim();

  if (existing) {
    var was = null;
    for (var i = 0; i < types.length; i++) {
      if (String(types[i].Type_ID) === existing) { was = types[i]; break; }
    }
    if (!was) throw new ApiError('NOT_FOUND', 'There is no prize type called "' + existing + '".');
    sheet.getRange(was._row, 1, 1, COLS.PRIZE_TYPES.length).setValues([[
      existing, label, valuing, Math.floor(Number(payload.sort) || Number(was.Sort) || 0),
      payload.active === undefined ? isTrue_(was.Active) : !!payload.active,
      isTrue_(was.Built_In), was.Added_By || ''
    ]]);
    logAudit('UPDATE_PRIZE_TYPE', { type: existing, label: label }, user.email);
    return { typeId: existing, label: label };
  }

  var id = prizeId_(label, types, 'Type_ID');
  var last = 0;
  for (var j = 0; j < types.length; j++) last = Math.max(last, Number(types[j].Sort) || 0);
  sheet.appendRow([id, label, valuing, last + 10, true, false, user.email]);
  logAudit('ADD_PRIZE_TYPE', { type: id, label: label, valuing: valuing }, user.email);
  return { typeId: id, label: label };
}

/**
 * Where a winner has got to: told, collected, or out of time.
 *
 * THE COLUMNS EXISTED AND NOTHING COULD WRITE THEM ON THEIR OWN. Notified and
 * Claimed could only be set by re-recording the whole winner row through
 * record_winner, which is a super-admin action — so the helper who actually
 * rings the winners and hands over the hampers could not write down that they
 * had. Every winner read "new" for ever, including the ones holding the hamper.
 */
function handleSetWinnerStatus(payload, user) {
  var ticketNumber = requireField_(payload, 'ticketNumber');
  var sheet = sheet_(SHEET.WINNERS);
  var map = headerMap(sheet);
  var winners = prizeRows_(SHEET.WINNERS);

  var row = null;
  for (var i = 0; i < winners.length; i++) {
    if (String(winners[i].Ticket_Number || '').trim().toUpperCase() === ticketNumber.toUpperCase()) {
      row = winners[i]; break;
    }
  }
  if (!row) throw new ApiError('NOT_FOUND', 'Ticket ' + ticketNumber + ' has not won anything.');

  var changed = {};
  if (payload.notified !== undefined) {
    sheet.getRange(row._row, map.Notified).setValue(!!payload.notified);
    changed.notified = !!payload.notified;
  }
  if (payload.claimed !== undefined) {
    sheet.getRange(row._row, map.Claimed).setValue(!!payload.claimed);
    // The DATE follows the flag rather than arriving beside it, so the two
    // cannot disagree. Un-claiming clears it: a date left on a prize nobody has
    // collected is a date somebody later reads as proof.
    sheet.getRange(row._row, map.Claimed_Date).setValue(payload.claimed ? new Date() : '');
    // Collecting is the opposite of forfeiting. Leaving the older mark would
    // have the row saying both at once, and every count of what is left to give
    // would then depend on which column it happened to read.
    if (payload.claimed && map.Forfeited_Date) sheet.getRange(row._row, map.Forfeited_Date).setValue('');
    changed.claimed = !!payload.claimed;
  }
  if (payload.forfeited !== undefined && map.Forfeited_Date) {
    if (payload.forfeited && isTrue_(row.Claimed) && payload.claimed === undefined) {
      throw new ApiError('BAD_REQUEST',
        ticketNumber + ' has already collected. Mark it as not collected first if that was wrong.');
    }
    sheet.getRange(row._row, map.Forfeited_Date).setValue(payload.forfeited ? new Date() : '');
    if (payload.forfeited) {
      sheet.getRange(row._row, map.Claimed).setValue(false);
      sheet.getRange(row._row, map.Claimed_Date).setValue('');
    }
    changed.forfeited = !!payload.forfeited;
  }
  if (payload.notes !== undefined) {
    sheet.getRange(row._row, map.Notes).setValue(String(payload.notes));
    changed.notes = String(payload.notes);
  }
  if (!Object.keys(changed).length) {
    throw new ApiError('MISSING_FIELD', 'Nothing was changed.');
  }

  logAudit('SET_WINNER_STATUS', { ticket: ticketNumber, changed: changed }, user.email);
  changed.ticketNumber = ticketNumber;
  return changed;
}
