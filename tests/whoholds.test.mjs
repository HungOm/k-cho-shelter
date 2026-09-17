/*
 * Who may sell a ticket, decided by where the paper is.
 *
 * WHY THIS EXISTS. Until today the only person fenced into a set of books was
 * an AGENT. A helper or an organiser could sell any ticket in the raffle from
 * their phone, including one sitting in a seller's bag in Klang — and
 * sell_books, the whole-book sale, checked nothing at all beyond "does this
 * book exist". So the same physical ticket could go to two buyers: one at the
 * desk who got a number and no paper, one in the field who got the paper. Only
 * one of them can win, and the argument happens at the draw in front of
 * everybody.
 *
 * The rule, stated once: you can only sell paper you can hand to the buyer.
 *
 *   Unassigned  the book is on the shelf here       anyone permitted
 *   Out         it is in a seller's bag             the holder, or an organiser
 *                                                   WRITING DOWN what the
 *                                                   seller reported — and the
 *                                                   sale is credited to the
 *                                                   holder either way
 *   Returned    handed back, not counted yet        anyone permitted: the paper
 *                                                   is on the desk
 *   Settled     counted; the figures are declared   nobody — restock it first
 *   Lost, Void  gone                                nobody
 *
 * The organiser exception is not a softening. Writing down what a seller
 * reported is most of what the recording screen is FOR, and blocking it would
 * push people to mark books returned when they are not, which corrupts the
 * ledger worse than the thing being prevented. What keeps it honest is the
 * credit: the sale lands on the holder's balance, where settlement checks it
 * against the stubs they hand back. A sale invented at the desk shows up as a
 * discrepancy with a name on it.
 *
 * Both backends, because they have disagreed before.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const tickets = await loadModule('tickets.ts')

/**
 * Four books, one in each state that matters, ten tickets each.
 * Book-001 Out with A001 · Book-002 Unassigned · Book-003 Returned (still
 * recorded against A001, which is how settlement finds it) · Book-004 Lost.
 */
function world() {
  const books = [
    { idx: 1, status: 'Out', held: 'A001' },
    { idx: 2, status: 'Unassigned', held: null },
    { idx: 3, status: 'Returned', held: 'A001' },
    { idx: 4, status: 'Lost', held: null },
  ].map((b) => ({
    idx: b.idx, number: 'Book-' + String(b.idx).padStart(3, '0'),
    first_ticket: 'KS-' + String((b.idx - 1) * 10 + 1).padStart(5, '0'),
    last_ticket: 'KS-' + String(b.idx * 10).padStart(5, '0'),
    status: b.status, held_by_agent: b.held,
    declared_sold: null, amount_due: null, amount_paid: null,
    due_at: null, settled_at: null, settled_by: '', notes: '', version: 1,
  }))
  const rows = Array.from({ length: 40 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: Math.ceil((i + 1) / 10), status: 'Available',
    buyer_name: '', buyer_phone: '', buyer_zone: '', amount: null,
    sold_by_agent: null, payment_status: '', sold_at: null, notes: '',
    source: '', version: 1, recorded_by: '', modified_at: new Date().toISOString(),
  }))
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '40', ACTIVE_TICKETS: '40', TICKET_PRICE: '10' }),
    tickets: rows, books,
    agents: [{ agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
             { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'KL', active: true }],
  })
}

const buyer = { buyerName: 'Ma Nu', buyerPhone: '0125550100' }
const sell = (w, n, user, extra = {}) =>
  tickets.sellTicket({ ticketNumber: n, ...buyer, ...extra }, user, w.ctx)

// ============ 1. a helper and a book that is not here ============
console.log('a helper cannot sell a ticket out of a book that is with a seller')
{
  const w = world()
  const e = await errOf(() => sell(w, 'KS-00001', users.recorder))
  eq(e?.code, 'BOOK_WITH_SELLER', 'refused')
  eq(e?.status, 403, 'as a permission refusal, not a validation one')

  // The message has to name the person and the way out, because the helper is
  // standing in front of a buyer holding money and needs to know what to do.
  ok(/Daw Hla/.test(e?.message ?? ''), 'it says who has the book')
  ok(/Book-001/.test(e?.message ?? ''), 'and which book')
  ok(/returned/i.test(e?.message ?? ''), 'and how to make it sellable')
  eq(e?.details?.book, 'Book-001', 'the details carry the book')
  eq(e?.details?.heldBy, 'A001', 'and the holder')

  // Nothing written.
  const row = w.db.tables.tickets.find((t) => t.number === 'KS-00001')
  eq(row.status, 'Available', 'and the ticket is untouched')
}

console.log('the same helper sells freely from the books that are here')
{
  const shelf = world()
  const a = await sell(shelf, 'KS-00011', users.recorder)
  eq(a.status, 'Sold', 'a book on the shelf sells')

  // The one that would be easy to get wrong: a book handed back but not yet
  // counted. The paper IS on the desk — you can see whether the ticket is
  // still in the book — so this must keep working, or counting one in
  // becomes impossible.
  const back = world()
  const b = await sell(back, 'KS-00021', users.recorder)
  eq(b.status, 'Sold', 'and so does one that has been handed back')
}

// ============ 2. the seller holding it ============
console.log('the seller holding the book can sell from it')
{
  const w = world()
  const r = await sell(w, 'KS-00002', users.agent)
  eq(r.status, 'Sold', 'their own book is theirs to sell')

  // A different seller gets the words that fit their situation, not the ones
  // written for somebody at the office desk.
  const other = { ...users.agent, agentId: 'A002', email: 'k@x.com' }
  eq(await codeOf(() => sell(world(), 'KS-00002', other)), 'NOT_YOUR_BOOK',
     'another seller is refused as not-your-book')
}

// ============ 3. the organiser, and the credit that keeps it honest ============
console.log('an organiser may write down what the seller reported')
{
  const w = world()
  const r = await sell(w, 'KS-00003', users.admin)
  eq(r.status, 'Sold', 'transcription keeps working')

  const row = w.db.tables.tickets.find((t) => t.number === 'KS-00003')
  eq(row.sold_by_agent, 'A001', 'and the sale is credited to whoever holds the book')
  eq(row.recorded_by, 'admin@x.com', 'while the audit trail still says who typed it')
}

console.log('and cannot quietly credit the sale to somebody else')
{
  // The abuse this closes: an organiser sells a ticket out of Daw Hla's book
  // at the desk and puts the money on U Kyaw, or on nobody. Then it never
  // surfaces at settlement, because settlement reconciles what a seller owes
  // against what was sold IN THEIR NAME.
  const w = world()
  await sell(w, 'KS-00004', users.admin, { agentId: 'A002' })
  const row = w.db.tables.tickets.find((t) => t.number === 'KS-00004')
  eq(row.sold_by_agent, 'A001', 'the holder is credited, not the agent named in the request')

  // On a book that is here, the named seller stands — that is a real case,
  // somebody selling on behalf of a seller at a church event.
  const shelf = world()
  await sell(shelf, 'KS-00012', users.admin, { agentId: 'A002' })
  eq(shelf.db.tables.tickets.find((t) => t.number === 'KS-00012').sold_by_agent, 'A002',
     'but a book on the shelf credits whoever the request names')
}

console.log('an Out book with nobody recorded is refused, even to an organiser')
{
  // This state should not exist. Guessing in the permissive direction is how
  // it would go unnoticed for a month.
  const w = world()
  w.db.tables.books.find((b) => b.idx === 1).held_by_agent = null
  eq(await codeOf(() => sell(w, 'KS-00005', users.admin)), 'BOOK_WITH_SELLER',
     'out with nobody is not a licence')
}

// ============ 4. what the rule does NOT touch ============
console.log('the rule is about claiming a ticket, not about touching the row')
{
  // Correcting a spelling on a ticket in a book that is out with somebody is
  // ordinary office work. So is releasing a hold. If those were fenced too,
  // the fence would be the thing people work around.
  const w = world()
  await sell(w, 'KS-00006', users.agent)
  const fixed = await tickets.correctTicket(
    { ticketNumber: 'KS-00006', buyerName: 'Ma Nu Corrected', reason: 'spelling' },
    users.recorder, w.ctx)
  ok(fixed.ticketNumber === 'KS-00006', 'a helper can still correct a sale in that book')

  const held = world()
  await tickets.reserveTicket({ ticketNumber: 'KS-00007', buyerName: 'Ma Nu' }, users.agent, held.ctx)
  const freed = await tickets.releaseTicket({ ticketNumber: 'KS-00007' }, users.recorder, held.ctx)
  eq(freed.status, 'Available', 'and can still release a hold on it')
}

console.log('holding a ticket for somebody is claiming it too')
{
  // Reserving takes the ticket out of circulation under a name. Same harm,
  // one step earlier.
  eq(await codeOf(() => tickets.reserveTicket(
       { ticketNumber: 'KS-00008', buyerName: 'Ma Nu' }, users.recorder, world().ctx)),
     'BOOK_WITH_SELLER', 'a helper cannot hold a ticket out of a seller\'s book')
}

console.log('a lost book is closed to everyone')
{
  eq(await codeOf(() => sell(world(), 'KS-00031', users.admin)), 'BOOK_CLOSED',
     'lost sits with settled and void')
  eq(await codeOf(() => sell(world(), 'KS-00031', users.recorder)), 'BOOK_CLOSED',
     'for a helper as well')
}

// ============ 4b. the correction wire, both spellings ============
console.log('a correction is accepted in either spelling')
{
  /*
   * WHY THIS IS HERE. correct_ticket was DEAD on Supabase for every user since
   * it became the default. Apps Script's correction reads sheet column names
   * (Buyer_Name); this port read camelCase (buyerName). Both read camelCase for
   * a SALE, so selling worked and only correcting broke — which is why nobody
   * noticed.
   *
   * My own tests hid it. This file called correctTicket({buyerName}); its Apps
   * Script twin called handleCorrectTicket({Buyer_Name}). I wrote both, used
   * whichever spelling made each pass, and never compared them. A parity suite
   * with a different spelling on each side is not a parity suite.
   *
   * The twin is gone with that backend. Both spellings are still asserted here,
   * against the one handler that remains, because the handler still accepts
   * both and a correction that silently does nothing is the failure this
   * catches.
   */
  const w = world()
  await sell(w, 'KS-00013', users.recorder)
  // Caught, not awaited bare. A regression here throws NOTHING_TO_DO, and an
  // uncaught throw ends the run with a stack trace instead of a sentence —
  // losing exactly the message that tells the next person the wire diverged.
  const err = await errOf(() => tickets.correctTicket(
    { ticketNumber: 'KS-00013', Buyer_Name: 'Corrected By Sheet Name',
      Buyer_Phone: '0125559999', reason: 'spelling' }, users.recorder, w.ctx))
  ok(!err, `the sheet spelling is accepted${err ? ` — got ${err.code}: ${err.message}` : ''}`)
  const row = w.db.tables.tickets.find((t) => t.number === 'KS-00013')
  eq(row.buyer_name, 'Corrected By Sheet Name', 'and it actually changed the row')
  eq(row.buyer_phone, '0125559999', 'phone too')

  const w2 = world()
  await sell(w2, 'KS-00014', users.recorder)
  const err2 = await errOf(() => tickets.correctTicket(
    { ticketNumber: 'KS-00014', buyerName: 'Corrected By camelCase', reason: 'spelling' },
    users.recorder, w2.ctx))
  ok(!err2, `camelCase is accepted${err2 ? ` — got ${err2.code}: ${err2.message}` : ''}`)
  eq(w2.db.tables.tickets.find((t) => t.number === 'KS-00014')?.buyer_name,
     'Corrected By camelCase', 'and so is camelCase')

  // The silent failure this replaces: a correction that supplied nothing the
  // server recognised came back "No changed fields were supplied" — true,
  // useless, and it reads as the volunteer's fault rather than the wire's.
  const w3 = world()
  await sell(w3, 'KS-00015', users.recorder)
  eq(await codeOf(() => tickets.correctTicket(
       { ticketNumber: 'KS-00015', reason: 'spelling' }, users.recorder, w3.ctx)),
     'NOTHING_TO_DO', 'a correction with genuinely nothing in it still refuses')
}

console.log('widening the input did not widen what a helper may do')
{
  /*
   * THE TRAP IN THE FIX ITSELF. The guard above read only `p.status`. Accepting
   * `Status` as an alias while guarding one spelling would have handed a helper
   * a way to void a ticket through a correction — the exact hole the guard was
   * written to close, reopened by the fix for something else, and silently.
   */
  for (const key of ['status', 'Status']) {
    const w = world()
    await sell(w, 'KS-00016', users.recorder)
    eq(await codeOf(() => tickets.correctTicket(
         { ticketNumber: 'KS-00016', [key]: 'Void', reason: 'x' }, users.recorder, w.ctx)),
       'USE_VOID_ACTION', `voiding via ${key} is refused`)

    const w2 = world()
    await sell(w2, 'KS-00017', users.recorder)
    eq(await codeOf(() => tickets.correctTicket(
         { ticketNumber: 'KS-00017', [key]: 'Available', reason: 'x' }, users.recorder, w2.ctx)),
       'INSUFFICIENT_ROLE', `a helper cannot change status via ${key}`)

    const w3 = world()
    await sell(w3, 'KS-00018', users.recorder)
    eq(await codeOf(() => tickets.correctTicket(
         { ticketNumber: 'KS-00018', [key]: 'Donated', reason: 'x' }, users.recorder, w3.ctx)),
       'USE_SELL_ACTION', `donating via ${key} is refused`)
  }
}


console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
