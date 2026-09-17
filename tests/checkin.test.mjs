/*
 * Reporting rounds: the dates nobody types, and the mark nobody can tick away.
 *
 * TWO THINGS ARE BEING PINNED HERE, and they fail in opposite directions.
 *
 * THE SCHEDULE must never decide anything. It is worked out from the current
 * check-in date, the cadence and the wall, purely so people can be shown the
 * plan — and the moment the roll starts taking its target from it, whether a
 * seller is late depends on a derivation rather than on the one stored date
 * that defaultDueDate and every overdue calculation read. That is not
 * hypothetical: it was written that way first, and the first thing it broke was
 * a raffle already sitting on its final deadline, where the derived "next
 * round" came back as today and the roll refused itself with the wrong
 * sentence. So the roll target is asserted to be a plain cadence step, clamped.
 *
 * AND THE SCHEDULE MUST NOT SKIP A ROUND. The tempting tidy-up — folding a step
 * that lands a few days short of the wall INTO the wall, to avoid two reports
 * in one week — leaves a gap longer than the monthly rhythm the feature
 * promises, and deletes the single most useful checkpoint in the cycle: the
 * last moment anybody finds out forty books are still out while there are days
 * left to ring people. Redundancy is the cheaper failure, so a round is
 * asserted for every step that fits.
 *
 * THE REPORTING half exists because a seller reporting is not a book coming
 * back. Somebody can honestly say "sold six, here is the money, I am keeping
 * the book for the rest" and still be holding it, so nothing derived from the
 * books can answer "who has not reported". It is a recorded row, and the tests
 * that matter most are the ones about what the row survives: rolling the round
 * forward must forgive a late BOOK, which is what a checkpoint is for, without
 * also forgiving the silence.
 *
 * Both backends, because they have disagreed before.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  if (String(g) === String(w)) pass++
  else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) }
}

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const D = await loadModule('deadlines.ts')
const people = await loadModule('people.ts')

/** A day n days from today, as the app writes them. */
const day = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ============ 1. the dates are worked out, not typed ============

console.log('1. every step that fits, and the wall on the end')
{
  const s = D.checkInSchedule('2026-10-14', '2026-12-06', 1)
  eq(s.join(' '), '2026-10-14 2026-11-14 2026-12-06', 'three rounds from two dates')
  eq(s[s.length - 1], '2026-12-06', 'the last round IS the final deadline')

  // The fold that must not come back. 1 Dec is five days before the wall and it
  // is the last chance to chase anybody, so it stays.
  const tight = D.checkInSchedule('2026-11-01', '2026-12-06', 1)
  eq(tight.join(' '), '2026-11-01 2026-12-01 2026-12-06',
     'a step landing days before the wall is kept, not folded into it')

  /*
   * CHAINED FROM EACH DATE, exactly as the roll chains from the stored one.
   *
   * 31 January clamps to 28 February and the NEXT step then counts from the
   * 28th, so the month-end walks inward and stays there. That is a real
   * property of stepping a stored date rather than re-deriving it from an
   * anchor, and the schedule has to show the dates the roll will actually
   * produce — a plan that predicts the 31st while the roll lands on the 28th is
   * worse than no plan, because the date was printed on somebody's slip.
   */
  eq(D.checkInSchedule('2026-01-31', '2026-05-01', 1).join(' '),
     '2026-01-31 2026-02-28 2026-03-28 2026-04-28 2026-05-01',
     'a month-end clamps to February and the rest of the plan counts from there')
  eq(D.addMonths(D.addMonths('2026-01-31', 1), 1), '2026-03-28',
     'which is what rolling twice from the 31st really does — never 3 March')

  eq(D.checkInSchedule('2026-10-14', '2027-04-10', 3).join(' '),
     '2026-10-14 2027-01-14 2027-04-10', 'a quarterly raffle gets quarterly rounds')

  eq(D.checkInSchedule('2026-12-06', '2026-12-06', 1).join(' '), '2026-12-06',
     'sitting on the wall is one round, not two')
  eq(D.checkInSchedule('2026-10-14', '', 1).length, 0,
     'with no wall there is no schedule — a checkpoint needs something to count to')
  eq(D.checkInSchedule('', '2026-12-06', 1).join(' '), '2026-12-06',
     'and with no check-in date yet, only the wall is known')

  // A cadence that disagrees with the wall must not spin.
  ok(D.checkInSchedule('2026-01-01', '2031-01-01', 1).length <= 62,
     'a five-year raffle at one month is bounded')
  ok(D.checkInSchedule('2026-01-01', '2031-01-01', 0).length > 1,
     'a cadence of 0 is read as 1 rather than looping for ever')
}

// ============ 2. the roll does not read the schedule ============

function world(over = {}, reports = []) {
  const books = [
    { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001', due_at: over.due1 ?? day(2) },
    { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002', due_at: over.due2 ?? day(2) },
    { idx: 3, number: 'Book-003', status: 'Unassigned', held_by_agent: null, due_at: null },
  ]
  return fakeDb({
    config: baseConfig({
      CHECK_IN_DATE: over.checkIn ?? day(2),
      FINAL_DEADLINE: over.final ?? day(200),
      CHECK_IN_ROUND: String(over.round ?? 1),
      REPORT_GRACE_DAYS: String(over.grace ?? 3),
      CHECK_IN_EVERY_MONTHS: String(over.months ?? 1),
    }),
    books,
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'Klang', active: true },
      { agent_id: 'A003', name: 'Ma Nu', phone: '0125553333', zone: 'Ipoh', active: true },
    ],
    check_in_reports: reports,
  })
}

console.log('2. the roll steps the stored date and clamps at the wall')
{
  const w = world()
  const p = await D.rollCheckIn({}, users.admin, w.ctx)
  eq(p.to, D.addMonths(day(2), 1), 'the target is a plain cadence step, not the next schedule entry')
  eq(p.dryRun, true, 'and it previews rather than applies')

  // The case that caught the derivation: already sitting on the wall.
  const onWall = world({ checkIn: day(30), final: day(30) })
  eq(await codeOf(() => D.rollCheckIn({}, users.admin, onWall.ctx)), 'NO_CHANGE',
     'a raffle already on its final deadline says so plainly, not CANNOT_MOVE_BACK')

  const q = world({ months: 3 })
  const r3 = await D.rollCheckIn({}, users.admin, q.ctx)
  eq(r3.to, D.addMonths(day(2), 3), 'a quarterly raffle steps three months')
}

console.log('3. the round number moves with the date, and only then')
{
  const w = world()
  await D.rollCheckIn({ dryRun: true }, users.admin, w.ctx)
  eq(w.config('CHECK_IN_ROUND'), '1', 'a preview writes no round')

  const w2 = world()
  const applied = await D.rollCheckIn({ dryRun: false }, users.admin, w2.ctx)
  eq(w2.config('CHECK_IN_ROUND'), '2', 'applying moves the round on')
  eq(applied.round, 2, 'and says which round is now live')
  eq(applied.closedRound, 1, 'and which one just closed')
}

// ============ 3. reporting ============

console.log('4. recording a report')
{
  const w = world()
  const r = await D.recordCheckIn(
    { agentId: 'A001', booksBack: 1, ticketsSold: 6, amountPaid: 60 }, users.admin, w.ctx)
  eq(r.round, 1, 'filed against the live round')
  eq(r.updated, false, 'the first one is not an update')
  eq(w.table('check_in_reports').length, 1, 'one row')
  const row = w.row('check_in_reports', (x) => x.agent_id === 'A001')
  eq(row.due_at, day(2), 'the row keeps the date the round was at')
  eq(row.tickets_sold, 6, 'and what they said')
  eq(row.recorded_by, users.admin.email, 'and who wrote it down')

  // Came back with more later in the same round.
  const again = await D.recordCheckIn(
    { agentId: 'A001', ticketsSold: 9 }, users.admin, w.ctx)
  eq(again.updated, true, 'the second one replaces rather than refuses')
  eq(w.table('check_in_reports').length, 1, 'still one row for the round')
  eq(w.row('check_in_reports', (x) => x.agent_id === 'A001').tickets_sold, 9, 'the later word wins')
}

console.log('5. what it refuses')
{
  const w = world()
  eq(await codeOf(() => D.recordCheckIn({}, users.admin, w.ctx)), 'MISSING_FIELD',
     'somebody has to be reporting')
  eq(await codeOf(() => D.recordCheckIn({ agentId: 'A404' }, users.admin, w.ctx)),
     'AGENT_NOT_FOUND', 'and they have to exist')

  const noDate = world({ checkIn: '' })
  eq(await codeOf(() => D.recordCheckIn({ agentId: 'A001' }, users.admin, noDate.ctx)),
     'NO_CHECK_IN_DATE', 'with no round there is nothing for a report to answer')

  eq(await codeOf(() => D.recordCheckIn({ agentId: 'A002', undo: true }, users.admin, w.ctx)),
     'NOTHING_TO_DO', 'undoing what was never recorded says so')
}

/*
 * THIS USED TO ASSERT THE ROW WAS GONE, and the row was gone, and that was the
 * bug. Phase 0 said remove the three hard deletes; deleting answered "is she on
 * the chase list" correctly and destroyed the only evidence that anybody had
 * ever said otherwise — on a raffle whose acknowledgement rule exists precisely
 * because whose word a confirmation is matters.
 *
 * So the assertion moved rather than relaxed. What it asks now is the thing the
 * old one was USING the row count to approximate: she is back on the list. That
 * goes through listAgents, which is what the screen reads, instead of counting
 * rows in a table — and it would have caught a soft delete whose predicate was
 * forgotten, which counting the raw table cannot.
 */
console.log('6. undoing a check-in puts them back on the list without erasing that it happened')
{
  const w = world({ checkIn: day(-9), grace: 3 })
  await D.recordCheckIn({ agentId: 'A001' }, users.admin, w.ctx)
  eq(w.table('check_in_reports').length, 1, 'recorded')
  eq((await people.listAgents({}, users.admin, w.ctx)).agents.find((a) => a.id === 'A001').reportState,
     'reported', 'and she is off the chase list')

  const u = await D.recordCheckIn({ agentId: 'A001', undo: true }, users.admin, w.ctx)
  eq(u.undone, true, 'undone')

  // THE POINT OF THE UNDO, unchanged: she is chased again, immediately.
  eq((await people.listAgents({}, users.admin, w.ctx)).agents.find((a) => a.id === 'A001').reportState,
     'late', 'and she is back on it')

  // AND THE POINT OF THE CHANGE: what happened is still readable.
  eq(w.table('check_in_reports').length, 1, 'the row is still there')
  const row = w.table('check_in_reports')[0]
  ok(!!row.undone_at, 'marked with when it was taken back')
  eq(row.undone_by, users.admin.email, 'and by whom, which is the part a delete threw away')

  // Undoing twice reads, to the person asking, exactly like never recorded.
  eq(await codeOf(() => D.recordCheckIn({ agentId: 'A001', undo: true }, users.admin, w.ctx)),
     'NOTHING_TO_DO', 'undoing it again has nothing to undo')

  /*
   * AND RECORDING AGAIN REVIVES IT. The key is (agent_id, round), so a soft
   * delete that did not clear the mark would either leave the new report
   * invisible or collide on insert — and the seller would be unrecordable for
   * the rest of the round, by the very act meant to correct a mistake.
   */
  await D.recordCheckIn({ agentId: 'A001', booksBack: 2 }, users.admin, w.ctx)
  eq(w.table('check_in_reports').length, 1, 'still one row, not a second')
  eq(w.table('check_in_reports')[0].undone_at, null, 'live again')
  eq((await people.listAgents({}, users.admin, w.ctx)).agents.find((a) => a.id === 'A001').reportState,
     'reported', 'and off the list again')
}

console.log('7. where each seller stands')
{
  const now = new Date()
  // A001 answered; A002 has not; A003 holds nothing at all.
  const w = world({ checkIn: day(-9), grace: 3 },
    [{ agent_id: 'A001', round: 1, due_at: day(-9), reported_at: now.toISOString() }])
  const { agents, checkIn } = await people.listAgents({}, users.admin, w.ctx)
  const by = Object.fromEntries(agents.map((a) => [a.id, a]))

  eq(by.A001.reportState, 'reported', 'the one who answered is clear')
  eq(by.A002.reportState, 'late', 'the one who did not, nine days on, is late')
  eq(by.A002.daysLate, 6, 'late is counted from the END of the grace, not the date')
  eq(by.A003.reportState, 'clear',
     'somebody holding nothing has nothing to report and is not marked')
  eq(checkIn.round, 1, 'the round travels with the list')
  eq(checkIn.reportBy, day(-6), 'and the day the chasing starts')
}

console.log('8. the grace is a real gap, not decoration')
{
  const onTheDay = world({ checkIn: day(0), grace: 3 })
  const a = (await people.listAgents({}, users.admin, onTheDay.ctx)).agents
  eq(a.find((x) => x.id === 'A002').reportState, 'due',
     'on the check-in date itself somebody is due, not late')

  const inGrace = world({ checkIn: day(-3), grace: 3 })
  const b = (await people.listAgents({}, users.admin, inGrace.ctx)).agents
  eq(b.find((x) => x.id === 'A002').reportState, 'due',
     'and still only due on the last day of the grace')

  const past = world({ checkIn: day(-4), grace: 3 })
  const c = (await people.listAgents({}, users.admin, past.ctx)).agents
  eq(c.find((x) => x.id === 'A002').reportState, 'late', 'the day after it, late')

  const far = world({ checkIn: day(20), grace: 3 })
  const d = (await people.listAgents({}, users.admin, far.ctx)).agents
  eq(d.find((x) => x.id === 'A002').reportState, 'waiting',
     'three weeks out, nobody is being chased for anything')
}

console.log('9. the roll forgives a late book, never the silence')
{
  /*
   * The whole point of the table, in one test. A001 answered round 1 and A002
   * did not. The check-in rolls. Both their books stop being late — that is
   * what a checkpoint is for — but only A002 carries a missed round, and it
   * stays carried.
   */
  const w = world({ checkIn: day(-9), due1: day(-9), due2: day(-9) },
    [{ agent_id: 'A001', round: 1, due_at: day(-9), reported_at: new Date().toISOString() }])

  await D.rollCheckIn({ dryRun: false, confirm: D.addMonths(day(-9), 1) }, users.admin, w.ctx)
  eq(w.config('CHECK_IN_ROUND'), '2', 'round two')

  const { agents } = await people.listAgents({}, users.admin, w.ctx)
  const by = Object.fromEntries(agents.map((a) => [a.id, a]))

  eq(by.A001.missedRounds, 0, 'the one who answered round one has missed nothing')
  eq(by.A002.missedRounds, 1, 'the one who did not still carries it after the roll')
  eq(by.A001.reportState, 'waiting', 'and both start the new round un-reported')
  eq(by.A002.reportState, 'waiting', 'including the one who is behind')
  eq(w.table('check_in_reports').length, 1, 'no report was cleared by the roll')

  // Answering round two does not retroactively answer round one.
  await D.recordCheckIn({ agentId: 'A002' }, users.admin, w.ctx)
  const after = (await people.listAgents({}, users.admin, w.ctx)).agents
    .find((a) => a.id === 'A002')
  eq(after.reportState, 'reported', 'they are clear for the round being answered')
  eq(after.missedRounds, 1, 'and still one behind overall')
}

console.log('10. what the deadline screen is told')
{
  const w = world({ checkIn: day(-9), grace: 3 },
    [{ agent_id: 'A001', round: 1, due_at: day(-9), reported_at: new Date().toISOString() }])
  const st = await D.deadlineStatus({}, users.admin, w.ctx)
  eq(st.sellersHolding, 2, 'two sellers are holding books')
  eq(st.sellersReported, 1, 'one has answered')
  eq(st.sellersNotReported, 1, 'one has not')
  eq(st.round, 1, 'the round')
  eq(st.reportBy, day(-6), 'and the day the chasing starts')
  ok(Array.isArray(st.schedule) && st.schedule.length >= 2, 'the plan travels with it')
  eq(st.schedule[st.schedule.length - 1].last, true, 'and ends on the wall')
  eq(st.youReported, null, 'an organiser is not asked about themselves')

  // A seller is told about their own books and their own standing, never the
  // raffle's — the same rule every other read here follows.
  const mine = await D.deadlineStatus({}, users.agent, w.ctx)
  eq(mine.scope, 'mine', 'scoped')
  eq(mine.booksOut, 1, 'their own book')
  eq(mine.sellersHolding, 1, 'and no raffle-wide headcount')
  eq(mine.youReported, true, 'they are told whether THEY have answered')
}

console.log('11. settling a book is itself a report')
{
  const books = await loadModule('books.ts')
  const w = world({ checkIn: day(-9) })

  const before = (await people.listAgents({}, users.admin, w.ctx)).agents
    .find((a) => a.id === 'A001')
  eq(before.reportState, 'late', 'holding a book and silent, nine days on')

  await books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 0, unsoldTickets: [] }, users.admin, w.ctx)

  const after = (await people.listAgents({}, users.admin, w.ctx)).agents
    .find((a) => a.id === 'A001')
  eq(after.reportState, 'reported',
     'counting their book and taking their money is them reporting')
  const row = w.row('check_in_reports', (x) => x.agent_id === 'A001')
  eq(row.note, 'Reported by settling Book-001', 'and it says how it is known')
  eq(row.amount_paid, 0,
     'the money stays in the settlement — a figure echoed here would read as a second one')
  eq((await people.listAgents({}, users.admin, w.ctx)).agents
    .find((a) => a.id === 'A002').reportState, 'late', 'nobody else is marked by it')
}

console.log('12. and it never overwrites what somebody typed')
{
  const books = await loadModule('books.ts')
  const w = world({ checkIn: day(-9) })
  await D.recordCheckIn(
    { agentId: 'A001', ticketsSold: 7, note: 'Came to the hall' }, users.admin, w.ctx)
  await books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 0, unsoldTickets: [] }, users.admin, w.ctx)

  eq(w.table('check_in_reports').length, 1, 'still one row for the round')
  const row = w.row('check_in_reports', (x) => x.agent_id === 'A001')
  eq(row.note, 'Came to the hall', 'the typed report stands')
  eq(row.tickets_sold, 7, 'with what was written down')
}

console.log('13. and when the side note fails, it fails LOUDLY and alone')
{
  /*
   * The half that is easy to get wrong in the safe-looking direction.
   *
   * Swallowing this failure gets the priority right — a settlement must not be
   * undone by a side note — and the discoverability catastrophically wrong. If
   * it breaks on some deployment, every settle from then on records nothing,
   * and an organiser chases people who did in fact report with nothing
   * anywhere to say why. So: the settle still succeeds, and the failure is
   * findable.
   *
   * The table is removed rather than mocked, which also exercises the likelier
   * silence of the two: a rejected write comes back as a returned `error`, not
   * as an exception, so a handler that only catches throws sees nothing wrong.
   */
  const books = await loadModule('books.ts')
  const w = world({ checkIn: day(-9) })
  delete w.db.tables.check_in_reports

  const settled = await books.settleBook(
    { bookNumber: 'Book-001', amountPaid: 40, unsoldTickets: [] }, users.admin, w.ctx)
  ok(!!settled, 'the settlement still goes through — the money is not held hostage')

  const complaint = w.table('audit_log').find((r) => r.action === 'CHECK_IN_NOT_RECORDED')
  ok(!!complaint, 'and the failure is written down where somebody can find it')
  eq(complaint?.details?.agent, 'A001', 'naming who it was for')
  eq(complaint?.details?.book, 'Book-001', 'and what was being settled')
  ok(String(complaint?.details?.why ?? '').length > 0, 'and why it failed')
}


console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
