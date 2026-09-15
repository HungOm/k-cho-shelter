/*
 * Who to message today, as one list with one line per person.
 *
 * Everything needed for this already existed and none of it was in one place.
 * Overdue books are on the Books screen, who has not reported is on Sellers,
 * what is owed is on Money, and the WhatsApp link is on each of them
 * separately. An organiser chasing people on a Sunday afternoon had to visit
 * three screens, hold the overlap in their head, and work out for themselves
 * that the person late with two books is the same person who owes RM80 and
 * never answered the check-in.
 *
 * ONE LINE PER PERSON IS THE WHOLE SHAPE OF IT, and it is the test that
 * matters most here. Three screens would have had somebody appear on all
 * three; a chase list that messages a volunteer four times in an afternoon for
 * four halves of one conversation is worse than no list. It reads as
 * harassment, and the fourth message is the one that gets a seller to stop
 * replying at all.
 *
 * The rest is about not being wrong in the directions that cost something: a
 * seller who is straight is not on the list, somebody with no usable telephone
 * number is marked rather than dropped, and past the final deadline is not the
 * same kind of late as three days past a checkpoint.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const reports = await loadModule('reports.ts')

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  status: 'Out', held_by_agent: 'A001', agent_name: '', due_at: day(-5), days_overdue: 0,
  counted_sold: 0, counted_expected: 0, counted_collected: 0,
  recorded_sold: 0, recorded_amount: 0, unidentified_sold: 0,
  available: 10, reserved: 0, missing_contact: 0, past_final: false, ...over,
})

/*
 * A001 is the overlap: two books overdue, never reported, and owing money.
 * A002 owes money and nothing else. A003 is straight. A004 has no usable
 * number.
 */
function world(over = {}) {
  return fakeDb({
    config: baseConfig({
      CHECK_IN_DATE: over.checkIn ?? day(-10),
      FINAL_DEADLINE: over.final ?? day(60),
      REPORT_GRACE_DAYS: '3',
      CURRENCY: 'RM',
    }),
    agents: over.agents ?? [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
      { agent_id: 'A003', name: 'Ma Nu', phone: '0125553333', active: true },
      { agent_id: 'A004', name: 'No Phone', phone: '5551234', active: true },
    ],
    book_ledger_all: over.ledger ?? [
      ledger(1, { days_overdue: 5 }),
      ledger(2, { days_overdue: 12 }),
      ledger(3, { held_by_agent: 'A002', days_overdue: 0, due_at: day(20) }),
      ledger(4, { held_by_agent: 'A004', days_overdue: 2 }),
    ],
    payments: over.payments ?? [],
    check_in_reports: over.reports ?? [],
  })
}
const who = (r, id) => r.people.find((p) => p.agentId === id)

console.log('1. one line per person, however many reasons they have')
{
  const w = world({
    ledger: [ledger(1, { days_overdue: 5, counted_expected: 50, counted_collected: 0 }),
             ledger(2, { days_overdue: 12, counted_expected: 30, counted_collected: 0 })],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)

  eq(r.people.filter((p) => p.agentId === 'A001').length, 1,
    'A001 is late, silent AND owes money, and appears exactly once')
  const a1 = who(r, 'A001')
  eq(a1.reasons.length, 3, 'with all three reasons on the one line')
  const codes = a1.reasons.map((x) => x.code).sort().join(',')
  eq(codes, 'no-report,overdue,owes', 'named, so the message can say all of it')
  eq(a1.booksLate.join(','), 'Book-001,Book-002', 'and the books are named')
  eq(a1.daysOverdue, 12, 'by the worst of them, not the most recent')
}

console.log('2. the message covers every reason at once')
{
  const w = world({
    ledger: [ledger(1, { days_overdue: 5, counted_expected: 50, counted_collected: 0 })],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  const m = who(r, 'A001').message
  ok(/Daw Hla/.test(m), 'it uses their name')
  ok(/overdue/.test(m), 'mentions the late book')
  ok(/RM50/.test(m), 'and the money, in the raffle\'s own currency')
  ok(/has not reported/.test(m), 'and the check-in')
  ok(m.split('Hello').length === 2, 'as ONE message, not three stuck together')
}

console.log('3. a seller who is straight is not on the list')
{
  const r = await reports.chaseToday({}, users.admin, world().ctx)
  ok(!who(r, 'A003'), 'nobody is chased for nothing')
}

console.log('4. somebody with no usable number is marked, never dropped')
{
  const r = await reports.chaseToday({}, users.admin, world().ctx)
  const a4 = who(r, 'A004')
  ok(!!a4, 'the seller nobody can telephone is still on the list')
  eq(a4.reachable, false, 'marked unreachable')
  eq(r.unreachable, 1, 'and counted, because finding another way takes longer')

  const reachable = who(r, 'A001')
  eq(reachable.reachable, true, 'a number starting 0 can be acted on')
}

console.log('5. past the final deadline is a different kind of late')
{
  const w = world({ final: day(-1) })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  eq(r.pastFinal, true, 'the wall has passed')
  const a1 = who(r, 'A001')
  eq(a1.reasons[0].code, 'past-final', 'which is what the line leads with')
  ok(/after the final deadline/.test(a1.reasons[0].what), 'said plainly')
  ok(!a1.reasons.some((x) => x.code === 'overdue'),
    'and it replaces "overdue" rather than being listed beside it — one lateness, not two')
}

console.log('6. the worst is at the top, and the unreachable before the reachable')
{
  const w = world({
    final: day(60),
    ledger: [ledger(1, { days_overdue: 2 }), ledger(4, { held_by_agent: 'A004', days_overdue: 40 })],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  eq(r.people[0].agentId, 'A004', 'forty days beats two')

  // Same urgency, one reachable and one not: the one nobody can ring first.
  const tie = world({
    agents: [
      { agent_id: 'B1', name: 'Bee', phone: '0125551111', active: true },
      { agent_id: 'B2', name: 'Cee', phone: '5551234', active: true },
    ],
    ledger: [ledger(1, { held_by_agent: 'B1', days_overdue: 4 }),
             ledger(2, { held_by_agent: 'B2', days_overdue: 4 })],
  })
  const t = await reports.chaseToday({}, users.admin, tie.ctx)
  eq(t.people[0].agentId, 'B2', 'the one nobody can message comes first')
}

console.log('7. reporting takes somebody off the silent list, not off the late one')
{
  const w = world({
    reports: [{ agent_id: 'A001', round: 1, due_at: day(-10), books_back: 0,
                reported_at: new Date().toISOString(), tickets_sold: 0, amount_paid: 0, note: '' }],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  const a1 = who(r, 'A001')
  ok(!!a1, 'they are still on the list — their books are still late')
  ok(!a1.reasons.some((x) => x.code === 'no-report'),
    'but not for silence, because they answered')
}

console.log('8. money alone is enough to be on it')
{
  const w = world({
    // Settled, so they hold nothing and are not silent — money is the only
    // thing left to say to them.
    ledger: [ledger(3, { held_by_agent: 'A002', status: 'Settled', days_overdue: 0,
                         due_at: day(20), counted_expected: 80, counted_collected: 0 })],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  const a2 = who(r, 'A002')
  ok(!!a2, 'owing money is a reason to be messaged')
  eq(a2.reasons.length, 1, 'and the only one')
  eq(a2.reasons[0].code, 'owes', 'named as money')
  eq(a2.daysOverdue, 0, 'nothing of theirs is late')
}

console.log('9. money already handed in is not chased')
{
  const w = world({
    ledger: [ledger(3, { held_by_agent: 'A002', status: 'Settled', days_overdue: 0,
                         due_at: day(20), counted_expected: 80, counted_collected: 80 })],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  ok(!who(r, 'A002'), 'a seller who has paid is not on the list')
}

console.log('10. nor is money that was written off')
{
  // The decision was made and signed. Chasing it afterwards asks somebody for
  // money the raffle already agreed would never come.
  const w = world({
    ledger: [ledger(3, { held_by_agent: 'A002', status: 'Settled', days_overdue: 0,
                         due_at: day(20), counted_expected: 80, counted_collected: 0 })],
    payments: [{ id: 1, agent_id: 'A002', amount: 80, source: 'writeoff', note: 'gone away' }],
  })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  ok(!who(r, 'A002'), 'a forgiven debt is not chased')
}

console.log('11. a seller sees their own line and nobody else\'s')
{
  const w = world({
    ledger: [ledger(1, { days_overdue: 5 }), ledger(3, { held_by_agent: 'A002', days_overdue: 9 })],
  })
  const seller = { ...users.agent, agentId: 'A001' }
  const mine = await reports.chaseToday({}, seller, w.ctx)
  eq(mine.people.length, 1, 'one line')
  eq(mine.people[0].agentId, 'A001', 'their own')
}

console.log('12. an empty list is empty, not a page of zeros')
{
  const w = world({ ledger: [], payments: [], reports: [] })
  const r = await reports.chaseToday({}, users.admin, w.ctx)
  eq(r.total, 0, 'nobody to chase')
  eq(r.people.length, 0, 'and no lines')
  eq(r.unreachable, 0, 'and nothing unreachable')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
