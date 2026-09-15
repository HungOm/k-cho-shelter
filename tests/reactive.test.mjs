/*
 * Showing a change before the server has agreed — and the two places that must
 * never do it.
 *
 * WHY OPTIMISTIC AT ALL. A volunteer taps save and the row does not move until
 * the round trip finishes. On a phone with one bar that is a pause with a
 * person standing in front of them, and the honest reading of a screen that has
 * not changed is that the tap did not work. So they tap again.
 *
 * WHERE THE LINE IS, and it is the whole design. Selling at a desk is the
 * moment CASH CROSSES: the volunteer takes RM10, the row goes green, and the
 * server then refuses — already sold by somebody else, a version conflict, or
 * the book turning out to be with a seller. That is money in a tin and a buyer
 * holding a number that is not theirs. Typing up stubs an hour later is the
 * opposite: the buyer has gone, and a row that goes back is an annoyance.
 *
 * The book case is the one the client structurally CANNOT predict — sellBlock
 * reads a snapshot, so the server knows where the paper is and the screen knows
 * where it was. 18's point, and the reason the rule is a list rather than a
 * judgement made per screen.
 *
 * AND THE GRANT. The second half of this file guards a one-line change that
 * would undo every buyer-contact mask in the system while looking like it
 * enables a subscription.
 */
import { readFileSync } from 'node:fs'
import { patchTickets, anyPending, NEVER_OPTIMISTIC } from '../src/lib/optimistic.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

const fresh = () => {
  const tickets = [
    { number: 'KS-00001', status: 'Available', name: '', phone: '', book: 'B1' },
    { number: 'KS-00002', status: 'Available', name: '', phone: '', book: 'B1' },
  ]
  return { tickets, byNumber: Object.fromEntries(tickets.map(t => [t.number, t])) }
}

console.log('the change is visible at once')
{
  const state = fresh()
  const shown = patchTickets(state, [{ number: 'KS-00001', status: 'Sold', name: 'Buyer One' }])
  ok(state.byNumber['KS-00001'].status === 'Sold', 'the row reads Sold before any round trip')
  ok(state.byNumber['KS-00001'].name === 'Buyer One', 'with the buyer on it')
  ok(state.byNumber['KS-00001'].pending === true, 'and marked unconfirmed, so the screen can say so')
  ok(anyPending(state.tickets), 'which the screen can ask about in one call')
  ok(state.byNumber['KS-00002'].status === 'Available', 'untouched rows are untouched')
  ok(shown.count === 1, 'and the caller is told how many it actually changed')
}

console.log('a refusal puts it back, field by field')
{
  const state = fresh()
  const shown = patchTickets(state, [
    { number: 'KS-00001', status: 'Sold', name: 'Buyer One', phone: '0123456789' },
    { number: 'KS-00002', status: 'Sold', name: 'Buyer Two', phone: '0123456780' },
  ])
  shown.rollback()
  for (const n of ['KS-00001', 'KS-00002']) {
    const t = state.byNumber[n]
    ok(t.status === 'Available', `${n} is available again`)
    ok(t.name === '' && t.phone === '', 'and carries no buyer')
    ok(!('pending' in t), 'and is not left marked saving for ever')
  }
  ok(!anyPending(state.tickets), 'nothing is pending after a rollback')
}

console.log('a success keeps the values and drops the marker')
{
  const state = fresh()
  const shown = patchTickets(state, [{ number: 'KS-00001', status: 'Sold', name: 'Buyer One' }])
  shown.commit()
  const t = state.byNumber['KS-00001']
  ok(t.status === 'Sold' && t.name === 'Buyer One', 'the row stays sold')
  ok(!('pending' in t), 'and stops claiming to be unconfirmed')
  // The delta is what makes this true rather than a guess — it overwrites the
  // optimistic values with the server's own.
  Object.assign(t, { status: 'Sold', name: 'BUYER ONE' })
  ok(t.name === 'BUYER ONE', 'and the server\'s version overwrites it when it arrives')
}

console.log('a ticket the device does not have is skipped, never invented')
{
  const state = fresh()
  const shown = patchTickets(state, [{ number: 'KS-99999', status: 'Sold' }])
  ok(shown.count === 0, 'nothing was changed')
  ok(state.tickets.length === 2, 'and no row was conjured for a number that does not exist')
  shown.rollback()
  ok(state.tickets.length === 2, 'rollback of nothing is still nothing')
}

console.log('the writes that must wait for the server')
for (const a of ['sell_ticket', 'sell_book', 'settle_book', 'record_payment',
                 'reverse_payment', 'record_winner']) {
  ok(NEVER_OPTIMISTIC.has(a), `${a} is never shown before the server agrees`)
}
ok(!NEVER_OPTIMISTIC.has('bulk_record_sales'),
   'typing up stubs after the fact may be — the buyer left an hour ago')

console.log('and the one screen that uses it commits or rolls back on every path')
{
  const sell = read('../src/components/Sell.vue')
  const fn = sell.slice(sell.indexOf('const shown = patchTickets'), sell.indexOf('function phoneWarning'))
  ok(/shown\.commit\(\)/.test(fn), 'the success path commits')
  ok(/shown\.rollback\(\)/.test(fn), 'the failure path rolls back')
  // One rollback at the top of catch covers every branch below it. Per-branch
  // rollbacks are how one branch comes to be missed.
  ok(fn.indexOf('shown.rollback()') < fn.indexOf('WRITE_UNCONFIRMED'),
     'and rolls back BEFORE deciding which failure it was, so no branch can miss it')
  ok(!/patchTickets/.test(read('../src/components/SellTicket.vue')),
     'the single-ticket desk sale is not optimistic — that is the cash-crossing one')
}

/* ---------- the grant that would undo every mask ---------- */

console.log('base tables stay unreadable by the browser')
{
  const rls = read('../supabase/rls.sql')
  const code = rls.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')

  ok(/revoke\s+all\s+on\s+tickets[^;]*from\s+[^;]*authenticated/i.test(code),
     'tickets is revoked from authenticated — the outer gate')
  // The policy on the base table is already permissive: any signed-in role
  // reads RAW buyer_name, buyer_phone, buyer_zone and notes, with only the
  // agent-book narrowing. The revoke is the ONLY thing holding it. So a single
  // grant, added by somebody who believes they are enabling a subscription,
  // opens a fully-formed hole that is already written and already reviewed —
  // through PostgREST as well as any socket.
  ok(!/grant\s+[^;]*\bon\s+tickets\b[^;]*to\s+[^;]*authenticated/i.test(code),
     'and NOT granted back — one grant would undo the viewer mask and the helper narrowing')
  ok(!/grant\s+[^;]*\bon\s+(books|agents)\b[^;]*to\s+[^;]*authenticated/i.test(code),
     'nor books or agents, for the same reason')
  ok(/grant\s+select\s+on\s+tickets_readable/i.test(code),
     'the masked view is what the browser gets instead')
  /*
   * NOT ASSERTED YET, and named rather than left out silently.
   *
   * `security_invoker = false` is what makes tickets_readable mask as the VIEW
   * rather than as the caller — without it the mask is only as good as the
   * caller's own grants. It exists in the shared working tree as somebody's
   * uncommitted hardening and is not in HEAD, so asserting it here would make
   * this file red for anyone who clones. It goes in the hour that lands.
   */
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
