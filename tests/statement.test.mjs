/*
 * A seller's statement of account, and the one property it cannot be wrong about.
 *
 * WHAT THIS REPLACED. The money screen's detail panel listed every payment row
 * a seller had, raw and unlabelled, in the order the database returned them.
 * The organiser's own screenshot of it showed six lines — RM -100.00 three
 * times, RM 100.00 three times, every one of them reading "counted in with a
 * book" — against a seller who owed RM90. Every figure was true. None of them
 * moved the balance, because a closed book's cash is counted from the book's
 * own amount_paid and settlement rows are deliberately excluded from the sum;
 * those six were a re-count reversing itself, which is bookkeeping exhaust.
 *
 * THE PROPERTY THAT MATTERS is not the layout. It is that the statement adds up
 * to the same figure as the line it expands. The table reads agent_money; the
 * statement builds its lines from the rows that view is defined over; and if
 * those two ever disagree, a seller is looking at two different debts on one
 * screen and neither they nor the organiser can tell which is the real one.
 * That is the failure this file exists to prevent, so it is asserted by summing
 * the lines rather than by trusting that both sides read the same tables.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const reports = await loadModule('reports.ts')

/*
 * ONE SELLER, EVERY SHAPE OF LINE AT ONCE, because each one enters the balance
 * by a different route and only a fixture carrying all of them proves they meet:
 *
 *   Book-001  open, two tickets sold          charge from the ticket rows
 *   Book-002  counted in, RM90 due, RM20 paid charge and credit from the book
 *   payments  a hand-over, a write-off, and a reversed settlement pair
 */
function world() {
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20', TICKET_PRICE: '10' }),
    agents: [{ agent_id: 'A001', name: 'Thang ling', phone: '0172112613', zone: 'CCFM', active: true }],
    books: [
      { idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001',
        first_ticket: 'KS-00001', last_ticket: 'KS-00010' },
      { idx: 2, number: 'Book-002', status: 'Settled', held_by_agent: null,
        settled_by_agent: 'A001', declared_sold: 9, amount_due: 90, amount_paid: 20,
        settled_at: '2026-09-17T02:00:00.000Z',
        first_ticket: 'KS-00011', last_ticket: 'KS-00020' },
    ],
    tickets: [
      { idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', amount: 10,
        sold_by_agent: 'A001', sold_at: '2026-09-15T00:00:00.000Z' },
      { idx: 2, number: 'KS-00002', book_idx: 1, status: 'Sold', amount: 10,
        sold_by_agent: 'A001', sold_at: '2026-09-16T00:00:00.000Z' },
    ],
    payments: [
      { id: 1, agent_id: 'A001', amount: 10, source: 'hand', method: 'cash', note: '',
        received_at: '2026-09-15T00:00:00.000Z', received_by: 'admin@x.com', book_idx: null, reverses: null },
      { id: 2, agent_id: 'A001', amount: 20, source: 'settlement', method: 'cash',
        note: 'Counted in with Book-002', received_at: '2026-09-16T00:00:00.000Z',
        received_by: 'admin@x.com', book_idx: 2, reverses: null },
      { id: 3, agent_id: 'A001', amount: -20, source: 'settlement', method: 'cash',
        note: 'Reversed', received_at: '2026-09-17T00:00:00.000Z',
        received_by: 'admin@x.com', book_idx: 2, reverses: 2 },
      { id: 4, agent_id: 'A001', amount: 20, source: 'settlement', method: 'cash',
        note: 'Counted in with Book-002', received_at: '2026-09-17T01:00:00.000Z',
        received_by: 'admin@x.com', book_idx: 2, reverses: null },
    ],
  })
}

const call = (w, user = users.admin) => reports.agentStatement({ agentId: 'A001' }, user, w.ctx)

console.log('1. the lines add up to the balance the table shows')
{
  const r = await call(world())
  const charged = r.entries.reduce((t, e) => t + e.charge, 0)
  const credited = r.entries.reduce((t, e) => t + e.credit, 0)
  eq(Math.round((charged - credited) * 100) / 100, r.outstanding,
     'charges less credits equals what the account says is owed')
  ok(r.reconciles === true, 'and the server says so itself, rather than leaving it to be noticed')
  eq(r.ledgerBalance, r.outstanding, 'the running balance ends where the account does')
}

console.log('2. the six meaningless lines are gone')
{
  const r = await call(world())
  /*
   * The whole reason for this rewrite. Settlement rows are already inside the
   * book's amount_paid, so putting them in the statement counts the same cash
   * twice AND fills the screen with reversal pairs that net to nothing. The
   * cash from a count-in appears once, as the book's own line.
   */
  ok(!r.entries.some((e) => e.kind === 'hand' && e.description === 'Reversed'),
     'a reversed settlement row is not a line in the statement')
  eq(r.entries.filter((e) => e.kind === 'settlement-cash').length, 1,
     'the cash that came with the count-in appears exactly once')
  eq(r.entries.filter((e) => e.credit === 20).length, 1,
     'and RM20 is credited once, not three times over')
}

console.log('3. each kind of line is there, and says which it is')
{
  const r = await call(world())
  const byKind = (k) => r.entries.filter((e) => e.kind === k)
  eq(byKind('sale').length, 1, 'the open book is one line, not one per ticket')
  eq(byKind('sale')[0].charge, 20, 'charging what its tickets came to')
  eq(byKind('sale')[0].ref, 'Book-001', 'referenced by the book, which is what people hold')
  eq(byKind('settlement')[0].charge, 90, 'the counted-in book charges what was declared')
  eq(byKind('settlement-cash')[0].credit, 20, 'and credits the cash that came with it')
  eq(byKind('hand')[0].credit, 10, 'a hand-over is its own credit')
}

console.log('4. a write-off moves the balance and is never called cash')
{
  const w = world()
  w.db.tables.payments.push({ id: 5, agent_id: 'A001', amount: 15, source: 'writeoff',
    method: 'cash', note: 'Forgiven — moved away', received_at: '2026-09-18T00:00:00.000Z',
    received_by: 'boss@x.com', book_idx: null, reverses: null })
  const r = await call(w)

  const off = r.entries.find((e) => e.kind === 'writeoff')
  ok(!!off, 'the write-off is a line of its own')
  eq(off.credit, 15, 'it reduces what is owed, because it does')
  /*
   * And the half that must not drift: it is not collected. A treasurer reading
   * "received" is reading cash that arrived, and a forgiven debt did not.
   */
  ok(!String(off.kind).includes('hand'), 'but it is not filed as money handed in')
  const r0 = await call(world())
  eq(r.collected, r0.collected, 'writing a debt off does not move what was collected')
  eq(Math.round((r0.outstanding - r.outstanding) * 100) / 100, 15,
     'it moves what is outstanding, by exactly its own amount')
}

console.log('5. the statement is ordered as a statement, oldest first with a running balance')
{
  const r = await call(world())
  const dates = r.entries.map((e) => String(e.at ?? '9999'))
  eq(dates.join('|'), [...dates].sort().join('|'), 'lines run oldest to newest')

  let running = 0
  let walked = true
  for (const e of r.entries) {
    running = Math.round((running + e.charge - e.credit) * 100) / 100
    if (Math.abs(running - e.balance) > 0.005) walked = false
  }
  ok(walked, 'and every balance is the one before it plus this line')
}

console.log('6. a seller may read their own and nobody else\'s')
{
  /*
   * Not an error, quietly their own: a seller asking for somebody else's
   * statement gets theirs. The rule is the same one agent_statement has always
   * applied — what changed is how much detail now rides on it, which is why it
   * is checked here rather than assumed to have survived the rewrite.
   */
  const seller = { ...users.agent, agentId: 'A001' }
  const r = await reports.agentStatement({ agentId: 'SOMEBODY-ELSE' }, seller, world().ctx)
  eq(r.agent.id, 'A001', 'the request is turned back into their own')
}


console.log('7. a helper cannot read a seller\'s account by naming them')
{
  /*
   * THE LEAK THIS CLOSED, and it was widened by the rewrite that found it. The
   * old rule turned an AGENT's request into their own and let everybody else
   * name anybody — which for a helper meant the whole of a seller's money, the
   * exact table moneyScope keeps off their screen. Four totals then; every
   * charge, every payment and a running balance now.
   */
  let refused = null
  try {
    await reports.agentStatement({ agentId: 'A001' }, users.recorder, world().ctx)
  } catch (err) { refused = err }
  ok(!!refused, 'a helper carrying no books is refused')
  ok(refused && /seller carrying books/i.test(refused.message),
     'and told why, rather than handed an empty statement that reads as a bug')

  // A helper who DOES carry books is a seller for this purpose, and gets theirs.
  const helperWithBooks = { ...users.recorder, agentId: 'A001' }
  const r = await reports.agentStatement({ agentId: 'SOMEBODY-ELSE' }, helperWithBooks, world().ctx)
  eq(r.agent.id, 'A001', 'their own, never the one they asked for')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
