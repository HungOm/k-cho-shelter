/*
 * What a round said when it closed, and why it has to be said at the roll.
 *
 * Every money figure in this system is live. That is right for "what does this
 * seller owe today" and useless for "what did round 2 say" — the question
 * asked when a seller disputes a total, when an organiser wants to know what
 * has moved since the last checkpoint, and at the end when somebody has to
 * explain the raffle to whoever paid for it. Correcting money afterwards is
 * the design, not the problem; the problem was that afterwards nothing
 * remembered what it had been corrected FROM.
 *
 * THE ONE THAT CANNOT BE BUILT LATE. Every other item on the audit's backlog
 * could be written the week after and lose nothing. A round that closes
 * without a snapshot can never be snapshotted afterwards, because the figures
 * it would have frozen have already moved. So the tests that matter most here
 * are about WHEN the row is written, not what is in it: before the books move,
 * before the round number moves, never on a dry run, and never twice with
 * different figures.
 *
 * The append-only half is a trigger and belongs to Postgres — UPDATE, DELETE
 * and TRUNCATE are each refused there, and supabase/test-functions.sh is where
 * that is proven. This is the handler half.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const D = await loadModule('deadlines.ts')

const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  status: 'Out', held_by_agent: 'A001', agent_name: 'Daw Hla', days_overdue: 0,
  counted_sold: 0, counted_expected: 0, counted_collected: 0, ...over,
})

/**
 * Two sellers carrying real money: A001 owes RM30 of RM50, A002 has settled
 * clean. A003 holds nothing, which is a line worth freezing too.
 */
function world(over = {}, reports = [], snapshots = []) {
  return fakeDb({
    config: baseConfig({
      CHECK_IN_DATE: over.checkIn ?? day(2),
      FINAL_DEADLINE: over.final ?? day(200),
      CHECK_IN_ROUND: String(over.round ?? 3),
      REPORT_GRACE_DAYS: '3',
      CHECK_IN_EVERY_MONTHS: '1',
    }),
    books: [
      { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001', due_at: over.due1 ?? day(2) },
      { idx: 2, number: 'Book-002', status: 'Settled', held_by_agent: 'A002', due_at: null },
    ],
    book_ledger_all: over.ledger ?? [
      ledger(1, { counted_sold: 5, counted_expected: 50, counted_collected: 20 }),
      ledger(2, { status: 'Settled', held_by_agent: 'A002', agent_name: 'U Kyaw',
                  counted_sold: 3, counted_expected: 30, counted_collected: 30 }),
    ],
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'Klang', active: true },
      { agent_id: 'A003', name: 'Ma Nu', phone: '0125553333', zone: 'Ipoh', active: true },
    ],
    check_in_reports: reports,
    round_snapshots: snapshots,
  })
}

const snaps = (w) => w.db.tables.round_snapshots
const lineFor = (w, id) => snaps(w).find((r) => r.agent_id === id)

console.log('1. the roll freezes the round it is closing')
{
  const w = world()
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)

  eq(snaps(w).length, 2, 'one row per seller with something to freeze')
  // A003 holds nothing, has never paid and has not reported: there is nothing
  // about them for the closing round to record, and an empty row asserting so
  // would be a row somebody has to read before learning it says nothing.
  ok(!lineFor(w, 'A003'), 'a seller with no books, no money and no report gets no row')

  const a1 = lineFor(w, 'A001')
  eq(a1.round, 3, 'stamped with the round that CLOSED, not the one opening')
  eq(a1.expected, 50, 'what they should have')
  eq(a1.collected, 20, 'what came in')
  eq(a1.outstanding, 30, 'and the gap, stored rather than derived')
  eq(a1.books_out, 1, 'books still out at the close')
  eq(a1.recorded_sold, 5, 'tickets recorded sold')
  eq(a1.taken_by, 'admin@x.com', 'and who moved the date')

  const a2 = lineFor(w, 'A002')
  eq(a2.books_settled, 1, 'a settled book counts as settled')
  eq(a2.outstanding, 0, 'and a seller straight with the raffle is frozen at zero')
}

console.log('2. the round number in the row is the closing one, and the config has moved past it')
{
  const w = world({ round: 7 })
  const r = await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)
  eq(lineFor(w, 'A001').round, 7, 'the snapshot belongs to round 7')
  eq(r.round, 8, 'and the roll reports round 8 as live')
  const cfg = w.db.tables.config.find((c) => c.key === 'CHECK_IN_ROUND')
  eq(cfg.value, '8', 'the stored round moved on')
}

console.log('3. a dry run freezes nothing')
{
  const w = world()
  const p = await D.rollCheckIn({ dryRun: true }, users.admin, w.ctx)
  eq(p.dryRun, true, 'it previewed')
  eq(snaps(w).length, 0, 'and wrote no snapshot — a preview that records the round is not a preview')
}

console.log('4. a refused roll freezes nothing')
{
  // NO_CHANGE: the date is already where it is being moved to.
  const onWall = world({ checkIn: day(200), final: day(200) })
  await codeOf(() => D.rollCheckIn({ dryRun: false }, users.admin, onWall.ctx))
  eq(snaps(onWall).length, 0, 'a roll that refuses itself closes no round')

  // CONFIRM_REQUIRED: somebody is already late and nobody typed the date.
  const late = world({ checkIn: day(-9), due1: day(-9) })
  eq(await codeOf(() => D.rollCheckIn({ dryRun: false }, users.admin, late.ctx)),
    'CONFIRM_REQUIRED', 'a roll forgiving lateness asks first')
  eq(snaps(late).length, 0, 'and freezes nothing while it is still asking')
}

console.log('5. what the round said does not move when the money does')
{
  const w = world()
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)
  eq(lineFor(w, 'A001').outstanding, 30, 'frozen at RM30')

  // The seller pays up after the round closed. This is the whole point: the
  // live figure is right to change and the record of what was said is not.
  w.db.tables.book_ledger_all[0].counted_collected = 50
  const read = await D.readRoundSnapshot({ round: 3 }, users.admin, w.ctx)
  const line = read.lines.find((l) => l.agentId === 'A001')
  eq(line.then.outstanding, 30, 'round 3 still says RM30 was owed')
  eq(line.now.outstanding, 0, 'today says nothing is')
  eq(line.changed.collected, 30, 'and the difference is the RM30 that came in after')
  eq(lineFor(w, 'A001').outstanding, 30, 'the stored row was not rewritten by reading it')
}

console.log('6. a retried roll keeps the figures from the attempt that closed the round')
{
  // A roll that wrote its snapshot and then failed is retried later, by which
  // time somebody has been paid. ON CONFLICT DO NOTHING, not an upsert: the
  // round closed at the first attempt and the second must not restate it.
  const w = world()
  await D.snapshotRound(w.ctx, 3, 'admin@x.com')
  eq(lineFor(w, 'A001').collected, 20, 'first attempt froze RM20')

  w.db.tables.book_ledger_all[0].counted_collected = 45
  const wrote = await D.snapshotRound(w.ctx, 3, 'someone.else@x.com')

  eq(snaps(w).length, 2, 'the retry added no second row for the same seller and round')
  eq(lineFor(w, 'A001').collected, 20, 'and did not overwrite RM20 with RM45')
  eq(lineFor(w, 'A001').taken_by, 'admin@x.com', 'the row still names who closed the round')
  eq(wrote, 2, 'the call reports the lines it offered, having changed none of them')
}

console.log('7. a later round is a new row, not a replacement')
{
  const w = world({ round: 4 }, [], [
    { round: 3, agent_id: 'A001', expected: 50, collected: 20, outstanding: 30 },
  ])
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)
  eq(snaps(w).length, 3, 'round 4 adds its own rows beside round 3')
  eq(snaps(w).filter((r) => r.round === 3).length, 1, 'round 3 is untouched')
  eq(snaps(w).find((r) => r.round === 3 && r.agent_id === 'A001').outstanding, 30,
    'and still says what it said')
}

console.log('8. who answered, and who had already stopped answering')
{
  // A001 answered the round being closed. A002 answered one of the two before
  // it and not this one. Round 3 closing means rounds 1 and 2 are the earlier
  // ones that came and went.
  const w = world({ round: 3 }, [
    { agent_id: 'A001', round: 3, due_at: day(2) },
    { agent_id: 'A002', round: 1, due_at: day(-30) },
  ])
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)

  eq(lineFor(w, 'A001').reported, 'true', 'A001 answered the round that closed')
  eq(lineFor(w, 'A001').missed_before, 2, 'and had let both earlier ones pass')
  eq(lineFor(w, 'A002').reported, 'false', 'A002 did not answer this one')
  eq(lineFor(w, 'A002').missed_before, 1, 'and had answered one of the two before it')
}

console.log('9. the roll survives a snapshot that will not write')
{
  /*
   * The roll is what keeps the chasing honest. A raffle must not be left
   * unable to move its own check-in date because a bookkeeping row would not
   * write — the same trade noteSettlementPayment makes, and loud in the log
   * for the same reason.
   */
  const w = world()
  delete w.db.tables.round_snapshots           // the table is not there at all
  const errs = []
  const realError = console.error
  console.error = (m) => errs.push(String(m))
  try {
    const r = await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)
    eq(r.round, 4, 'the round still moved on')
    const cfg = w.db.tables.config.find((c) => c.key === 'CHECK_IN_DATE')
    ok(cfg.value !== day(2), 'and so did the date')
  } finally { console.error = realError }
  ok(errs.some((m) => m.includes('SNAPSHOT_NOT_TAKEN')), 'and it said so where somebody will find it')
}

console.log('10. reading a round back')
{
  const w = world()
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)

  const read = await D.readRoundSnapshot({}, users.admin, w.ctx)
  eq(read.round, 3, 'with no round asked for, the most recent closed one')
  eq(read.rounds.join(','), '3', 'and the rounds there are to choose from')
  eq(read.lines.length, 2, 'every seller, to an organiser')
  eq(read.totals.then.outstanding, 30, 'the totals the lines add to')
  eq(read.totals.sellers, 2, 'over the sellers the round measured')
  ok(read.lines.every((l) => l.name && l.name !== l.agentId), 'by name, not by ID')
}

console.log('11. nothing has closed yet')
{
  const w = world()
  const read = await D.readRoundSnapshot({}, users.admin, w.ctx)
  eq(read.round, 0, 'there is no round to look back at')
  eq(read.lines.length, 0, 'so there are no lines')
  ok(/first snapshot is taken/.test(read.message),
    'and it says when the first one will be, rather than reading as an error')
}

console.log('12. a closed round is scoped exactly as the money screen is')
{
  const w = world()
  await D.rollCheckIn({ dryRun: false }, users.admin, w.ctx)

  // A seller: their own line and nobody else's. One seller's debt, frozen or
  // live, is not another seller's business.
  const mine = await D.readRoundSnapshot({ round: 3 }, users.agent, w.ctx)
  eq(mine.lines.length, 1, 'a seller sees one line')
  eq(mine.lines[0].agentId, 'A001', 'their own')
  eq(mine.totals.then.outstanding, 30, 'and their own total')

  /*
   * A viewer gets nothing here YET, and that is deliberate rather than
   * finished. money.ts is midway through separating "whose names may I see"
   * from "whose money is in my totals"; this reads the first for both, so a
   * viewer is shown no lines and empty totals instead of somebody else's
   * figures. The safe half of the split — widen it when the other half exists,
   * and this assertion is where to change it.
   */
  const viewer = { ...users.admin, role: 'viewer', isAdmin: false, agentId: null }
  const seen = await D.readRoundSnapshot({ round: 3 }, viewer, w.ctx)
  eq(seen.lines.length, 0, 'a viewer gets no names')
  eq(seen.totals.then.outstanding, 0, 'and, for now, no figures either')
  eq(seen.totals.sellers, 0, 'rather than somebody else\'s')

  // A helper carrying no books: neither. They never owed anything, so a closed
  // round has nothing to say about them.
  const helper = await D.readRoundSnapshot({ round: 3 }, users.recorder, w.ctx)
  eq(helper.lines.length, 0, 'a helper gets no lines')
  eq(helper.totals.then.outstanding, 0, 'and no money that was never theirs')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
