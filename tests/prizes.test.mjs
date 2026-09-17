/*
 * The prize schedule, and the awarding of it.
 *
 * WHAT THIS IS GUARDING. `winners.prize` was free text, and three things
 * followed that this file now refuses to let back in:
 *
 *   1. "First prize" and "1st Prize" were different prizes to everything
 *      downstream, so nothing could count what had been given out.
 *   2. Nothing stopped the Grand Prize being awarded twice.
 *   3. On the Apps Script side, recording a second winner against a ticket that
 *      had already won OVERWROTE the first one — silently, with no error and no
 *      trace of who had been announced — while the Supabase side refused it.
 *      The two backends disagreed about the single least recoverable write in
 *      the system.
 *
 * The seat arithmetic gets the most attention here because it is the part that
 * is wrong in the most expensive way. Over-awarding is not a bug somebody
 * reports; it is two people holding a receipt for one car.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// The codes that mean the server broke, as opposed to the server refusing. The
// client branches on the difference: an unknown action is a deploy that has not
// caught up, and is not worth a toast the organiser cannot act on.
const BROKEN_SHAPES = ['QUERY_FAILED', 'SERVER_ERROR']

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

/**
 * A raffle with six sold tickets and a schedule of two prizes: one Grand and
 * ten hampers. Fresh for every call, so nothing leaks between assertions.
 */
function world(over = {}) {
  const tickets = Array.from({ length: 20 }, (_, i) => ({
    idx: i + 1, number: 'KS-' + String(i + 1).padStart(5, '0'),
    book_idx: Math.ceil((i + 1) / 10),
    status: i < 6 ? 'Sold' : 'Available',
    buyer_name: i < 6 ? 'Buyer ' + (i + 1) : '',
    buyer_phone: i < 6 ? '01255501' + String(i).padStart(2, '0') : '',
    buyer_zone: '', amount: i < 6 ? 10 : null, sold_by_agent: i < 6 ? 'A001' : null,
    payment_status: '', sold_at: null, notes: '', source: '', version: 1,
    recorded_by: '', modified_at: new Date().toISOString(),
  }))
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
    tickets,
    books: [{ idx: 1, number: 'Book-001', first_ticket: 'KS-00001', last_ticket: 'KS-00010',
              status: 'Out', held_by_agent: 'A001', version: 1 }],
    agents: [{ agent_id: 'A001', name: 'Daw Hla', active: true }],
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'org@x.com', name: 'Organiser', role: 'admin', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agent_id: null },
      { email: 'view@x.com', name: 'Viewer', role: 'viewer', active: true, agent_id: null },
    ],
    prize_types: [
      { type_id: 'cash', label: 'Cash', valuing: 'fixed', sort: 10, built_in: true },
      { type_id: 'goods', label: 'Donated goods', valuing: 'fixed', sort: 20, built_in: true },
      { type_id: 'pot_share', label: 'Share of takings', valuing: 'percent', sort: 40, built_in: true },
      { type_id: 'unstated', label: 'Nothing declared', valuing: 'none', sort: 50 },
    ],
    prizes: [
      { prize_id: 'grand', tier: 'Grand Prize', name: 'Toyota Hilux', type_id: 'goods',
        value_amount: 120000, quantity: 1, rank: 1, created_by: 'boss@x.com' },
      { prize_id: 'hampers', tier: 'Consolation', name: 'Hamper', type_id: 'goods',
        value_amount: 250, quantity: 10, rank: 3, created_by: 'boss@x.com' },
    ],
    winners: [],
    book_ledger_all: [],
    ...over,
  })
}

async function call(action, payload = {}, email = 'boss@x.com', w = world()) {
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email } })
  return { body: await res.json(), db: w }
}

/** Several calls against ONE raffle, which is how a draw actually happens. */
function session(email = 'boss@x.com', over = {}) {
  const w = world(over)
  return {
    db: w,
    call: (action, payload = {}, who = email) => call(action, payload, who, w),
  }
}

// ============ 1. reading the schedule ============

console.log('1. the schedule says how much of it is left')
{
  const { body } = await call('list_prizes')
  ok(body.ok, 'list_prizes answers')
  const grand = body.data.prizes.find((p) => p.prize_id === 'grand')
  const hampers = body.data.prizes.find((p) => p.prize_id === 'hampers')
  ok(grand.remaining === 1 && grand.awarded === 0, 'nothing given yet')
  ok(hampers.quantity === 10 && hampers.remaining === 10, 'ten hampers, ten left')
  ok(grand.typeLabel === 'Donated goods', 'the type is named, not just keyed')
  ok(grand.unitValue === 120000, 'a fixed prize is worth what it says')
  // Ordered by rank so the board reads Grand first, whatever order the rows
  // happen to sit in.
  ok(body.data.prizes[0].prize_id === 'grand', 'the Grand Prize leads the board')
}

console.log('2. a seller may read it; that is the whole point of it')
{
  // "What can I win?" is the question a seller is asked by everybody they sell
  // to. An answer only an organiser can open is an answer given from memory.
  const { body } = await call('list_prizes', {}, 'rec@x.com')
  ok(body.ok, 'a helper can read the prizes')
}

console.log('3. a share of the takings is worth what has actually come in')
{
  const s = session('boss@x.com', {
    prizes: [{ prize_id: 'half', tier: 'Split the Pot', name: 'Half the takings',
               type_id: 'pot_share', value_amount: 50, quantity: 1, rank: 1 }],
    payments: [{ id: 1, agent_id: 'A001', amount: 400 }, { id: 2, agent_id: 'A001', amount: 200 }],
  })
  const { body } = await s.call('list_prizes')
  const half = body.data.prizes[0]
  ok(body.data.collected === 600, 'the pot is what was handed in')
  ok(half.unitValue === 300, 'half of 600 is 300, worked out rather than typed')
}

console.log('4. a prize with nothing declared is worth unstated, not zero')
{
  const s = session('boss@x.com', {
    prizes: [{ prize_id: 'day', tier: 'Special Prize', name: 'A day out',
               type_id: 'unstated', value_amount: 0, quantity: 1, rank: 1 }],
  })
  const { body } = await s.call('list_prizes')
  // null, not 0. Zero would join a total as though somebody had valued the
  // thing at nothing, which is a different claim from having no figure.
  ok(body.data.prizes[0].unitValue === null, 'unstated comes back as null')
}

// ============ 2. awarding ============

console.log('5. the seats fill in order, and the count follows')
{
  const s = session()
  const a = await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })
  const b = await s.call('record_winner', { ticketNumber: 'KS-00002', prizeId: 'hampers' })
  ok(a.body.ok && a.body.data.seq === 1, 'the first hamper is number 1')
  ok(b.body.ok && b.body.data.seq === 2, 'the second is number 2')
  const { body } = await s.call('list_prizes')
  const h = body.data.prizes.find((p) => p.prize_id === 'hampers')
  ok(h.awarded === 2 && h.remaining === 8, 'two given, eight to come')
  ok(String(h.takenSeats) === '1,2', 'and it can say which two')
}

console.log('6. the label and the value are frozen at the moment of the award')
{
  const s = session()
  const { body } = await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })
  ok(body.data.prize === 'Grand Prize — Toyota Hilux', 'the prize is named in full')
  const row = s.db.table('winners')[0]
  ok(row.prize_value === 120000, 'what it was worth on the night is written down')

  // Renaming the prize afterwards must not rewrite what was read out.
  await s.call('upsert_prize', { prizeId: 'grand', tier: 'Grand Prize',
                                 name: 'Toyota Hilux Double Cab', typeId: 'goods',
                                 value: 130000, quantity: 1 })
  const after = s.db.table('winners')[0]
  ok(after.prize === 'Grand Prize — Toyota Hilux', 'the record of the night is unchanged')
  ok(after.prize_value === 120000, 'and so is the value it was announced at')
}

console.log('7. the Grand Prize cannot be given twice')
{
  const s = session()
  const first = await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })
  ok(first.body.ok, 'the first award goes through')
  const second = await s.call('record_winner', { ticketNumber: 'KS-00002', prizeId: 'grand' })
  ok(!second.body.ok, 'the second is refused')
  ok(/All 1 of the Grand Prize/.test(second.body.error.message),
     'and it says so in words a person can act on')
}

console.log('8. one ticket, one prize')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })
  const again = await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })
  ok(!again.body.ok, 'a ticket that has won cannot win again')
  ok(/already won/.test(again.body.error.message), 'and it says what it already won')
  // THE BUG THIS REPLACES: the Apps Script twin found the row and rewrote it,
  // so the first winner vanished with no error and no trace.
  ok(s.db.table('winners').length === 1, 'and the first winner is still there')
}

console.log('9. a ticket nobody bought was never in the draw')
{
  const { body } = await call('record_winner', { ticketNumber: 'KS-00009', prizeId: 'grand' })
  ok(!body.ok && body.error.code === 'NOT_ELIGIBLE', 'an unsold ticket cannot win')
}

console.log('10. free text still works when no schedule was ever set up')
{
  // A raffle whose organiser never opened the prize screen must still be able
  // to write down that somebody won something. Refusing would turn a missed
  // setup step into a draw that cannot be recorded while the room waits.
  const s = session('boss@x.com', { prizes: [] })
  const { body } = await s.call('record_winner', { ticketNumber: 'KS-00001', prize: 'First prize' })
  ok(body.ok, 'a typed prize is still accepted')
  ok(s.db.table('winners')[0].prize_id === null, 'and it is honest about having no prize behind it')
}

console.log('11. but something has to be said')
{
  const { body } = await call('record_winner', { ticketNumber: 'KS-00001' })
  ok(!body.ok && body.error.code === 'MISSING_FIELD', 'a winner of nothing is not recorded')
}

// ============ 3. changing the schedule ============

console.log('12. adding a prize, with an id nobody has to type')
{
  const s = session()
  const { body } = await s.call('upsert_prize', {
    tier: 'Second Prize', name: 'Motorbike', typeId: 'goods', value: 8000, quantity: 1, rank: 2,
  })
  ok(body.ok && body.data.prizeId === 'second-prize-motorbike', 'the id comes from the name')
  const listed = await s.call('list_prizes')
  ok(listed.body.data.prizes.length === 3, 'and it is on the board')
  ok(listed.body.data.prizes[1].prize_id === 'second-prize-motorbike',
     'in rank order, between the Grand and the Consolation')
}

console.log('13. two prizes really can both be called Hamper')
{
  const s = session()
  const a = await s.call('upsert_prize', { tier: 'Consolation', name: 'Hamper', typeId: 'goods', quantity: 1 })
  const b = await s.call('upsert_prize', { tier: 'Consolation', name: 'Hamper', typeId: 'goods', quantity: 1 })
  ok(a.body.data.prizeId !== b.body.data.prizeId, 'the second gets its own id')
  ok(/-2$/.test(b.body.data.prizeId), 'rather than overwriting the first')
}

console.log('14. the quantity cannot be cut below what has gone out')
{
  const s = session()
  for (const n of [1, 2, 3]) {
    await s.call('record_winner', { ticketNumber: 'KS-0000' + n, prizeId: 'hampers' })
  }
  const { body } = await s.call('upsert_prize', {
    prizeId: 'hampers', tier: 'Consolation', name: 'Hamper', typeId: 'goods',
    value: 250, quantity: 2,
  })
  // The database trigger is the real guard; this is the handler passing its
  // sentence through rather than turning it into "query failed".
  ok(!body.ok, 'cutting ten hampers to two after three are out is refused')
  ok(/given 3 times|above number 2/.test(body.error.message),
     'and the refusal names the three people already holding one')
}

console.log('15. changing a prize somebody has already won needs the owner')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })

  const org = await s.call('upsert_prize', {
    prizeId: 'grand', tier: 'Grand Prize', name: 'Something else', typeId: 'goods',
    value: 1, quantity: 1,
  }, 'org@x.com')
  ok(!org.body.ok && org.body.error.code === 'SUPER_ADMIN_ONLY',
     'an organiser cannot change what somebody was told they had won')

  const boss = await s.call('upsert_prize', {
    prizeId: 'grand', tier: 'Grand Prize', name: 'Something else', typeId: 'goods',
    value: 1, quantity: 1,
  })
  ok(boss.body.ok, 'the System Admin can')
}

console.log('16. an organiser sets up freely until the first prize is given')
{
  const s = session()
  const { body } = await s.call('upsert_prize', {
    prizeId: 'grand', tier: 'Grand Prize', name: 'Toyota Hilux', typeId: 'goods',
    value: 125000, quantity: 1,
  }, 'org@x.com')
  ok(body.ok, 'setting up the prizes is ordinary organising')
}

console.log('17. a prize somebody holds cannot be removed')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })
  const held = await s.call('remove_prize', { prizeId: 'hampers' })
  ok(!held.body.ok, 'a prize that has been drawn stays on the record')
  ok(/Turn it off instead/.test(held.body.error.message), 'and it says what to do instead')

  const free = await s.call('remove_prize', { prizeId: 'grand' })
  ok(free.body.ok, 'one nobody holds can go')
}

console.log('18. a new KIND of prize, without a migration')
{
  const s = session()
  const { body } = await s.call('upsert_prize_type', { label: 'Experience day', valuing: 'none' })
  ok(body.ok && body.data.typeId === 'experience-day', 'an organiser can add a type')

  const used = await s.call('upsert_prize', {
    tier: 'Special Prize', name: 'Hot air balloon', typeId: 'experience-day', quantity: 1,
  })
  ok(used.body.ok, 'and use it the same minute')

  const listed = await s.call('list_prizes')
  const p = listed.body.data.prizes.find((x) => x.prize_id === 'special-prize-hot-air-balloon')
  ok(p.unitValue === null, 'a type that declares nothing values nothing')
}

console.log('19. the ways a prize can be valued are not open, and say so')
{
  const { body } = await call('upsert_prize_type', { label: 'Mystery', valuing: 'vibes' })
  ok(!body.ok && body.error.code === 'BAD_REQUEST', 'an unknown valuing rule is refused')
  // Named rather than excluded — "anything that is not X" is the shape that put
  // three defects in this repository in one day (supabase/AUDIT.md §X).
  ok(/fixed amount|share of what is collected|nothing stated/.test(body.error.message),
     'and the refusal names the three that do work')
}

console.log('20. a prize that is not on the schedule cannot be awarded')
{
  const { body } = await call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'unicorn' })
  ok(!body.ok && body.error.code === 'NOT_FOUND', 'there is no prize called that')
}

console.log('21. a prize turned off is not being offered')
{
  const s = session('boss@x.com', {
    prizes: [{ prize_id: 'grand', tier: 'Grand Prize', name: 'Hilux', type_id: 'goods',
               value_amount: 1, quantity: 1, rank: 1, active: false }],
  })
  const { body } = await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })
  ok(!body.ok && /not being offered/.test(body.error.message), 'and cannot be drawn')
}

// ============ 4. what happened to the winner ============

console.log('22. told, collected, and out of time')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })

  // A HELPER does this, not the owner: a helper rings the winners and a helper
  // is standing there when one turns up for their hamper.
  const told = await s.call('set_winner_status', { ticketNumber: 'KS-00001', notified: true }, 'rec@x.com')
  ok(told.body.ok, 'a helper can write down that a winner was told')
  ok(s.db.table('winners')[0].notified === true, 'and it sticks')

  const got = await s.call('set_winner_status', { ticketNumber: 'KS-00001', claimed: true }, 'rec@x.com')
  ok(got.body.ok && s.db.table('winners')[0].claimed === true, 'and that they collected')
  ok(s.db.table('winners')[0].claimed_at, 'the date follows the flag rather than being sent beside it')
}

console.log('23. un-claiming clears the date rather than leaving it as proof')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })
  await s.call('set_winner_status', { ticketNumber: 'KS-00001', claimed: true }, 'rec@x.com')
  await s.call('set_winner_status', { ticketNumber: 'KS-00001', claimed: false }, 'rec@x.com')
  ok(s.db.table('winners')[0].claimed_at === null, 'the collection date goes with the collection')
}

console.log('24. a forfeited prize goes back on the board')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })
  const gone = await s.call('list_prizes')
  ok(gone.body.data.prizes.find((p) => p.prize_id === 'grand').remaining === 0, 'the car is gone')

  await s.call('set_winner_status', { ticketNumber: 'KS-00001', forfeited: true }, 'rec@x.com')
  const back = await s.call('list_prizes')
  ok(back.body.data.prizes.find((p) => p.prize_id === 'grand').remaining === 1,
     'and comes back when nobody claims it')

  // The row STAYS. Deleting it would leave the audit of a draw with a hole
  // exactly where somebody would want to look.
  ok(s.db.table('winners').length === 1, 'the record that it was drawn survives')

  const redrawn = await s.call('record_winner', { ticketNumber: 'KS-00002', prizeId: 'grand' })
  ok(redrawn.body.ok && redrawn.body.data.seq === 1, 'and the seat can be drawn again')
}

console.log('25. collected and forfeited cannot both be true')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'hampers' })
  await s.call('set_winner_status', { ticketNumber: 'KS-00001', forfeited: true }, 'rec@x.com')
  await s.call('set_winner_status', { ticketNumber: 'KS-00001', claimed: true }, 'rec@x.com')
  const row = s.db.table('winners')[0]
  ok(row.claimed === true && row.forfeited_at === null,
     'collecting it undoes the forfeit, so no count depends on which column it reads')

  const back = await s.call('set_winner_status', { ticketNumber: 'KS-00001', forfeited: true }, 'rec@x.com')
  ok(!back.body.ok, 'and forfeiting a prize already collected is refused')
}

console.log('26. a ticket that has not won has no status to set')
{
  const { body } = await call('set_winner_status', { ticketNumber: 'KS-00003', notified: true }, 'rec@x.com')
  ok(!body.ok && body.error.code === 'NOT_FOUND', 'there is nothing there to change')
}

console.log('26b. a viewer is not handed the winners\' telephone numbers')
{
  const s = session()
  await s.call('record_winner', { ticketNumber: 'KS-00001', prizeId: 'grand' })

  const boss = await s.call('list_winners', {})
  ok(boss.body.data.winners[0].buyer_phone === '0125550100', 'the organiser gets the number')

  /*
   * THE WINNER ROW CARRIES ITS OWN FROZEN COPY of the number, and it was going
   * out unmasked: the masker was applied to the joined ticket and stopped
   * there. Nothing displayed it, because the draw screen read a field name only
   * the Apps Script backend used — so a viewer had every winner's number in the
   * reply and never on the screen. A leak that depends on a client not reading
   * a field is a leak.
   */
  const viewer = await s.call('list_winners', {}, 'view@x.com')
  const w = viewer.body.data.winners[0]
  ok(w.buyer_phone !== '0125550100', 'a viewer does not get it in full')
  ok(/^•+\d{3}$/.test(w.buyer_phone), `and gets the masked form instead (${w.buyer_phone})`)
  // Announcing who won is what a draw is for. The NAME survives.
  ok(w.buyer_name === 'Buyer 1', 'but the name survives, which is what a draw is for')
}

// ============ 5. the draw is not ready without prizes ============

console.log('27. a raffle with nothing to win is not ready to draw')
{
  const s = session('boss@x.com', { prizes: [] })
  const { body } = await s.call('report_draw_ready')
  ok(body.data.totals.prizesOffered === 0, 'the report counts what is on offer')
  ok(body.data.blockers.some((b) => /no prizes/.test(b)), 'and blocks the draw on it')

  const withPrizes = await call('report_draw_ready')
  ok(!withPrizes.body.data.blockers.some((b) => /no prizes/.test(b)),
     'a raffle with a schedule is not blocked on this')
  ok(withPrizes.body.data.totals.prizesOffered === 2, 'and is told how many')
}

console.log('28. prizes switched off are the same as no prizes on the night')
{
  const s = session('boss@x.com', {
    prizes: [{ prize_id: 'grand', tier: 'Grand Prize', name: 'Hilux', type_id: 'goods',
               value_amount: 1, quantity: 1, rank: 1, active: false }],
  })
  const { body } = await s.call('report_draw_ready')
  ok(body.data.blockers.some((b) => /no prizes/.test(b)), 'three switched-off prizes are nothing to draw for')
}

console.log('29. a backend that has never heard of the prize list still answers')
{
  /*
   * A push to master deploys the FRONTEND alone — the Edge Function and the
   * migration are both applied by hand. So there is a real window, on a raffle
   * already running, where the new draw screen is live against a server that
   * does not have list_prizes. This is what the client is told in that window,
   * and it has to be a refusal it can recognise rather than a crash: the draw
   * screen and the winner form both fall back to the typed prize on exactly
   * this code, and a room is usually waiting when they do.
   */
  const { body } = await call('list_prizes_that_do_not_exist', {})
  ok(!body.ok && body.error.code === 'UNKNOWN_ACTION',
     'an action this backend does not have is named as unknown, not as a failure')
  ok(!BROKEN_SHAPES.includes(body.error.code),
     'so the client can tell "not deployed yet" from "the server broke"')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
