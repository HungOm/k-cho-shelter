/**
 * Show the change now; let the server correct it.
 *
 * WHAT THIS IS FOR. A volunteer at a table taps "Sold", and today the row does
 * not move until the round trip finishes. On a phone with one bar that is a
 * pause with a person standing in front of them, and the honest reading of a
 * screen that has not changed is that the tap did not work — so they tap again.
 *
 * WHAT IT IS NOT FOR, and the line matters more than the feature. Anything
 * printed, handed over, or said out loud as settled must wait for the server.
 * A volunteer telling a seller their cash is recorded and then having it
 * refused is a conversation that cannot be taken back; a row that flickers back
 * to unsold is merely annoying. So money and finality are NEVER optimistic, and
 * asking for it throws rather than being quietly ignored.
 *
 * OPT-IN, NOT OPT-OUT. A mutation is optimistic only when its caller says what
 * the local change is. Everything else behaves exactly as it did. A blanket
 * rule would have made the money paths optimistic by default, which is the one
 * outcome worth designing against.
 */

/**
 * Writes that must not be shown before the server has agreed.
 *
 * Each is something a person acts on immediately and cannot retract: a book
 * closed, a winner announced, cash declared received. If a new write belongs
 * here, adding it is cheaper than the conversation it prevents.
 */
export const NEVER_OPTIMISTIC = new Set([
  'settle_book',
  'record_payment',
  'reverse_payment',
  'record_winner',
  'set_book_status',
  // Selling at a desk is the moment CASH CROSSES. The volunteer takes RM10, the
  // row goes green, and the server then refuses — ALREADY_SOLD because somebody
  // else just sold it, a version conflict, or the book turning out to be with a
  // seller. That is money in a tin and a buyer holding a number that is not
  // theirs, which is a far worse conversation than a pause.
  //
  // The book case is the one the client structurally CANNOT predict: sellBlock
  // reads a snapshot of the books, so the server knows where the paper is and
  // the screen knows where it was.
  'sell_ticket',
  'sell_book',
])

/**
 * Apply ticket changes locally and hand back the two ways out.
 *
 * Returns commit() and rollback(). Neither is optional: a write that neither
 * commits nor rolls back leaves rows marked pending for ever, and a permanent
 * "saving…" is a worse lie than a slow screen.
 *
 * A ticket the device does not have is SKIPPED rather than invented. The one
 * thing worse than not showing a sale is showing a sale for a ticket number
 * that does not exist.
 */
export function patchTickets(state, updates) {
  const touched = []
  for (const u of updates || []) {
    const t = state.byNumber?.[u.number]
    if (!t) continue
    const before = {}
    for (const k of Object.keys(u)) if (k !== 'number') before[k] = t[k]
    touched.push({ t, before })
    Object.assign(t, u)
    t.pending = true
  }
  return {
    count: touched.length,
    commit() {
      // The row keeps the optimistic values until the delta overwrites them
      // with the server's. Only the marker goes.
      for (const { t } of touched) delete t.pending
    },
    rollback() {
      for (const { t, before } of touched) {
        Object.assign(t, before)
        delete t.pending
      }
    }
  }
}

/** Is anything on this screen still unconfirmed? */
export function anyPending(tickets) {
  return (tickets || []).some(t => t && t.pending)
}
