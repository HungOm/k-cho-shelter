/*
 * What a ticket costs was whatever the request body said.
 *
 * `amount: Number(p.amount ?? cfg.TICKET_PRICE ?? 10)` — the price taken from
 * the caller, unbounded, and written to tickets.amount, which has no check
 * constraint. Every balance in the raffle is the sum of those figures, so a
 * seller posting the action by hand could record their own sales at any price,
 * including a negative one, and come out owed money by the charity.
 *
 * NOBODY DID IT, and that is not the point. The screen never offered the field,
 * so the only way to reach it was to bypass the screen — which is precisely the
 * case an authorisation rule exists for. Every other money path in this system
 * is decided by the server: settlement multiplies the configured price, the
 * bulk paths read it from config, payments are checked against what is owed.
 * This was the one place the figure was taken on trust.
 *
 * AN ORGANISER MAY STILL OVERRIDE IT, because a real raffle discounts a book
 * for the church that took twenty, and refusing that would push the discount
 * into a cash adjustment nobody records. The override is theirs alone, it is
 * bounded against a typo, and the sale is logged like every other.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const tickets = await loadModule('tickets.ts')

/*
 * The book is on the DESK by default and out with its seller when a case says
 * so. Selling from a book that is out is an organiser transcribing a report and
 * needs a reason; that rule has its own tests and is not what this file is
 * about, so the fixture stays out of its way.
 */
function world({ out = false } = {}) {
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20', TICKET_PRICE: '10' }),
    agents: [{ agent_id: 'A001', name: 'Josh', phone: '0125551111', active: true }],
    books: [{ idx: 1, number: 'Book-001',
              status: out ? 'Out' : 'Unassigned',
              held_by_agent: out ? 'A001' : null,
              first_ticket: 'KS-00001', last_ticket: 'KS-00010' }],
    tickets: [
      { idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', version: 1 },
      { idx: 2, number: 'KS-00002', book_idx: 1, status: 'Available', version: 1 },
      { idx: 3, number: 'KS-00003', book_idx: 1, status: 'Available', version: 1 },
    ],
  })
}
const sell = (w, p, user) => tickets.sellTicket(
  { buyerName: 'A Buyer', buyerPhone: '0125550001', ...p }, user, w.ctx)
const amountOf = (w, number) =>
  w.db.tables.tickets.find((t) => t.number === number)?.amount

console.log('1. the price comes from the raffle, not from the request')
{
  const w = world()
  await sell(w, { ticketNumber: 'KS-00001' }, users.admin)
  eq(amountOf(w, 'KS-00001'), 10, 'a sale with no amount charges the configured price')
}

console.log('2. a seller cannot write their own price')
{
  const w = world({ out: true })
  const seller = { ...users.agent, agentId: 'A001' }
  let refused = null
  try {
    await sell(w, { ticketNumber: 'KS-00001', amount: -500 }, seller)
  } catch (err) { refused = err }
  ok(!!refused, 'a negative price is refused')
  eq(refused?.code, 'PRICE_NOT_YOURS', 'and refused as a permission, which is what it is')
  eq(amountOf(w, 'KS-00001'), undefined, 'nothing was written')

  // The sharper half: not just negatives. Any figure that is not the price.
  let high = null
  try {
    await sell(w, { ticketNumber: 'KS-00002', amount: 10000 }, seller)
  } catch (err) { high = err }
  ok(!!high, 'and so is a large one — a seller does not set prices at all')
}

console.log('3. a seller sending the right price is not tripped up by it')
{
  /*
   * The client does send `amount` on an ordinary sale. Refusing every amount
   * would have broken every seller's sell button, which is how a security fix
   * becomes an outage.
   */
  const w = world({ out: true })
  const seller = { ...users.agent, agentId: 'A001' }
  await sell(w, { ticketNumber: 'KS-00001', amount: 10 }, seller)
  eq(amountOf(w, 'KS-00001'), 10, 'the ordinary sale still goes through')
}

console.log('4. an organiser may discount, within reason')
{
  const w = world()
  await sell(w, { ticketNumber: 'KS-00001', amount: 5 }, users.admin)
  eq(amountOf(w, 'KS-00001'), 5, 'an organiser may sell one cheaper')

  let silly = null
  try {
    await sell(w, { ticketNumber: 'KS-00002', amount: 100000 }, users.admin)
  } catch (err) { silly = err }
  ok(!!silly, 'and a figure ten times over the price is caught as the typo it is')
  ok(silly && /change the price in Setup/.test(silly.message),
     'with the way to do it properly if it was not a typo')

  let below = null
  try {
    await sell(w, { ticketNumber: 'KS-00003', amount: -1 }, users.admin)
  } catch (err) { below = err }
  ok(!!below, 'nobody may sell a ticket for less than nothing, organiser included')
}

console.log('5. a donation is still free, and is not an amount to be argued about')
{
  const w = world()
  await sell(w, { ticketNumber: 'KS-00001', donated: true, amount: 999 }, users.admin)
  eq(amountOf(w, 'KS-00001'), 0, 'a donated ticket costs nothing whatever the body said')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
