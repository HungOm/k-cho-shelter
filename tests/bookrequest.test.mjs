/*
 * A seller asking for a book, and an organiser granting it.
 *
 * WHAT THIS IS FOR. The fence that matters most in this raffle is "you can only
 * sell paper you can hand to the buyer" — a seller may sell out of the books
 * they are carrying and no others. It is enforced in three places and it is
 * right. What it had no answer for was the obvious next question: somebody
 * standing at a table, holding a buyer's money, looking at ticket 3291 on their
 * phone and being told it is in Book-330 in the office. There was no way to ask
 * for Book-330 except to telephone somebody.
 *
 * WHY IT IS NOT A NEW TABLE. pending_approvals already does the hard parts: a
 * server-written summary stored with the exact payload, a 24-hour lapse applied
 * on read AND on decide, a per-requester scoped list, and a decision that
 * executes rather than unlocking something for later.
 *
 * WHAT IS GENUINELY DIFFERENT, and the reason this file exists rather than a
 * few lines in router.test.mjs: WHOSE ACT IT IS.
 *
 *   A two-person control is a permitted person stopped until somebody agrees.
 *   It runs as the REQUESTER, whose permissions are re-checked at that moment.
 *
 *   A petition is somebody who may NOT do the thing asking somebody who may.
 *   Re-checking the requester would refuse every book request at the instant it
 *   was granted — a seller will never be allowed to issue books. So it runs as
 *   the APPROVER, because the organiser granting it IS the person handing the
 *   book over.
 *
 * Get that backwards and the feature looks complete, passes review, and fails
 * for every user on the first grant.
 */
import { readFileSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

const book = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'),
  first_ticket: 'KS-' + String((idx - 1) * 10 + 1).padStart(5, '0'),
  last_ticket: 'KS-' + String(idx * 10).padStart(5, '0'),
  status: 'Unassigned', held_by_agent: null, due_at: null,
  declared_sold: null, amount_due: null, amount_paid: null, version: 1, ...over,
})
const ledger = (idx, over = {}) => ({
  idx, number: 'Book-' + String(idx).padStart(3, '0'), status: 'Unassigned',
  held_by_agent: null, agent_name: '', days_overdue: 0, recorded_sold: 0, recorded_amount: 0,
  counted_sold: 0, counted_expected: 0, counted_collected: 0, ...over,
})

/**
 * A raffle with three books in the office and two people who might want one:
 * a seller with an agent row, and a helper whose account is not linked to one.
 */
const world = () => fakeDb({
  config: baseConfig({ TOTAL_TICKETS: '30', ACTIVE_TICKETS: '30', TICKETS_PER_BOOK: '10' }),
  app_users: [
    { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
    { email: 'org@x.com', name: 'Hung Om', role: 'admin', active: true, agent_id: null },
    { email: 'seller@x.com', name: 'Daw Hla', role: 'agent', active: true, agent_id: 'A001' },
    { email: 'seller2@x.com', name: 'U Kyaw', role: 'agent', active: true, agent_id: 'A002' },
    { email: 'helper@x.com', name: 'Thang', role: 'recorder', active: true, agent_id: null },
  ],
  agents: [
    { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
    { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', zone: 'KL', active: true },
  ],
  books: [book(1), book(2), book(3, { status: 'Out', held_by_agent: 'A002' })],
  book_ledger_all: [ledger(1), ledger(2),
                    ledger(3, { status: 'Out', held_by_agent: 'A002', agent_name: 'U Kyaw' })],
})

async function call(action, payload, email, w) {
  const req = new Request('https://x/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload ?? {} }),
  })
  const res = await api.fetch(req, { ...w.ctx, userClaims: { id: 'u1', email } })
  return { status: res.status, body: await res.json() }
}
const ask = (w, books, who = 'seller@x.com') =>
  call('request_approval', { action: 'issue_books', payload: { bookNumbers: books } }, who, w)

console.log('1. a seller can ask, which they could not before')
{
  const w = world()
  const { body } = await ask(w, ['Book-001'])
  ok(body.ok, `the request is accepted (${body.error?.code ?? ''} ${body.error?.message ?? ''})`)
  ok(/Daw Hla/.test(body.data.summary), 'the summary names who is asking')
  ok(/Book-001/.test(body.data.summary), 'and which book')

  const row = w.table('pending_approvals')[0]
  eq(row.action, 'issue_books', 'one row, naming the action it would run')
  eq(row.requested_by, 'seller@x.com', 'and who asked')
  eq(row.status, 'Pending', 'waiting for somebody')
  // PINNED AT REQUEST TIME. A seller asking that books go to somebody else is a
  // different act with consequences for that person's balance, and nothing
  // should let one be typed as the other.
  eq(row.payload.agentId, 'A001', 'the books are for whoever asked, written in by the server')
  eq(row.detail.runAs, 'approver', 'and it is marked as somebody else\'s act to perform')

  // The screen keys its "look before you decide" link on this.
  eq(row.detail.firstBook, 'Book-001', 'the approver can look inside it before deciding')
}

console.log('2. and cannot ask for books to be given to somebody else')
{
  const w = world()
  const { body } = await call('request_approval',
    { action: 'issue_books', payload: { bookNumbers: ['Book-001'], agentId: 'A002' } },
    'seller@x.com', w)
  ok(body.ok, 'the request is still accepted')
  eq(w.table('pending_approvals')[0].payload.agentId, 'A001',
     'but the agent named in the request is ignored — it goes to whoever asked')
}

console.log('3. somebody with no seller row is told why, not refused blankly')
{
  const w = world()
  const { body } = await ask(w, ['Book-001'], 'helper@x.com')
  ok(!body.ok, 'refused')
  eq(body.error.code, 'NOT_A_SELLER', 'with a code of its own')
  ok(/not linked/.test(body.error.message), 'saying what is missing')
  ok(/People screen/.test(body.error.message), 'and who can fix it')
  eq(w.table('pending_approvals').length, 0, 'and nothing was queued')
}

console.log('4. an organiser is not offered a queue to talk to themselves in')
{
  const w = world()
  const { body } = await ask(w, ['Book-001'], 'org@x.com')
  ok(!body.ok, 'refused')
  eq(body.error.code, 'NOTHING_TO_DO', 'because they can simply hand the book over')
  eq(w.table('pending_approvals').length, 0, 'nothing queued')
}

console.log('5. an organiser can still issue books directly — the queue did not swallow the action')
{
  /*
   * THE FAILURE THIS PREVENTS. The router blocks a direct call to any action
   * approvalNeeded returns a summary for. Putting issue_books in there would
   * have made this feature work by stopping organisers giving out books at all,
   * which is the single most common thing this app does.
   */
  const w = world()
  const { body } = await call('issue_books', { bookNumbers: ['Book-002'], agentId: 'A002' }, 'org@x.com', w)
  ok(body.ok, `issuing directly still works (${body.error?.code ?? ''})`)
  eq(w.db.tables.books.find((b) => b.idx === 2).held_by_agent, 'A002', 'and the book moved')
}

console.log('6. the organiser grants it, and the books are theirs to sell')
{
  const w = world()
  const asked = await ask(w, ['Book-001'])
  const id = asked.body.data.requestId

  const { body } = await call('decide_book_request', { requestId: id, approve: true }, 'org@x.com', w)
  ok(body.ok, `an organiser may grant it (${body.error?.code ?? ''}: ${body.error?.message ?? ''})`)
  ok(body.data.executed, 'and granting hands the book over there and then')

  const b = w.db.tables.books.find((x) => x.idx === 1)
  eq(b.status, 'Out', 'the book is out')
  eq(b.held_by_agent, 'A001', 'with the seller who asked for it')
  eq(w.table('pending_approvals')[0].status, 'Approved', 'the request is closed')
  eq(w.table('pending_approvals')[0].decided_by, 'org@x.com', 'naming who granted it')

  // A→B on the book's own record, which is what the trail screen reads.
  const h = w.table('book_history').filter((x) => x.book_idx === 1)
  eq(h.length, 1, 'one handover on the book')
  eq(h[0].to_agent, 'A001', 'to the seller')
  eq(h[0].by_user, 'org@x.com', 'by the organiser — it is their act, not the seller\'s')
}

console.log('7. and refusing leaves the book where it was')
{
  const w = world()
  const asked = await ask(w, ['Book-001'])
  const { body } = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: false, note: 'Keep it for the desk' }, 'org@x.com', w)
  ok(body.ok, 'saying no is an ordinary answer')
  ok(!body.data.executed, 'nothing ran')
  eq(w.db.tables.books.find((x) => x.idx === 1).status, 'Unassigned', 'the book stayed in the office')
  eq(w.table('pending_approvals')[0].status, 'Rejected', 'and the request says so')
  eq(w.table('pending_approvals')[0].note, 'Keep it for the desk', 'with the reason, which the seller reads')
}

console.log('8. the organiser\'s door does not reach the System Admin\'s queue')
{
  /*
   * THE BAR THAT MUST NOT MOVE. Two-person controls exist to put somebody ABOVE
   * an organiser — writing off a debt, marking a run of books void. Granting a
   * book is not one of those, and giving organisers a decision button had to not
   * become a way round the ones that are.
   */
  const w = world()
  const req = await call('request_approval',
    { action: 'write_off', payload: { agentId: 'A002', amount: 10 } }, 'org@x.com', w)
  ok(req.body.ok, `an organiser can still lodge a control (${req.body.error?.code ?? ''})`)

  const { body } = await call('decide_book_request',
    { requestId: req.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(!body.ok, 'and cannot decide it through the book-request door')
  eq(body.error.code, 'SUPER_ADMIN_ONLY', 'it says who can')
  eq(w.table('pending_approvals')[0].status, 'Pending', 'the request is untouched')

  // And the front door is still shut to them.
  const direct = await call('decide_approval',
    { requestId: req.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(!direct.body.ok, 'nor through the front one')
  eq(direct.body.error.code, 'SUPER_ADMIN_ONLY', 'same answer, from the registry')
}

console.log('9. who sees which requests')
{
  const w = world()
  await ask(w, ['Book-001'], 'seller@x.com')
  await ask(w, ['Book-002'], 'seller2@x.com')

  const mine = await call('list_approvals', {}, 'seller@x.com', w)
  eq(mine.body.data.requests.length, 1, 'a seller sees their own')
  eq(mine.body.data.requests[0].requestedBy, 'seller@x.com', 'and only their own')
  ok(!mine.body.data.youDecide, 'and is not offered the decision')

  const org = await call('list_approvals', {}, 'org@x.com', w)
  eq(org.body.data.requests.length, 2, 'an organiser sees every book request')

  const boss = await call('list_approvals', {}, 'boss@x.com', w)
  eq(boss.body.data.requests.length, 2, 'and the System Admin sees everything')
  ok(boss.body.data.youDecide, 'as the one who decides the controls')
}

console.log('10. a seller can withdraw their own and nobody else\'s')
{
  const w = world()
  const mine = await ask(w, ['Book-001'], 'seller@x.com')
  const theirs = await ask(w, ['Book-002'], 'seller2@x.com')

  const no = await call('cancel_approval', { requestId: theirs.body.data.requestId }, 'seller@x.com', w)
  ok(!no.body.ok, "somebody else's request is not theirs to withdraw")

  const yes = await call('cancel_approval', { requestId: mine.body.data.requestId }, 'seller@x.com', w)
  ok(yes.body.ok, 'their own is')
  eq(w.table('pending_approvals').find((r) => r.request_id === mine.body.data.requestId).status,
     'Cancelled', 'and it is marked withdrawn rather than deleted')
}

console.log('11. a book already in somebody else\'s bag')
{
  /*
   * The request is allowed to be lodged — what is in the office changes while
   * somebody is typing, and refusing at request time would mean a seller
   * watching a button disappear as they reach for it. It fails at the grant,
   * where an organiser is looking at the book and can say what to do instead.
   */
  const w = world()
  const asked = await ask(w, ['Book-003'])
  ok(asked.body.ok, 'asking for a book that is out is not refused out of hand')

  const { body } = await call('decide_book_request',
    { requestId: asked.body.data.requestId, approve: true }, 'org@x.com', w)
  ok(!body.ok, 'but granting it is refused')
  eq(body.error.code, 'BOOKS_NOT_AVAILABLE', 'by the issuing rule itself, not a second copy of it')
  eq(w.db.tables.books.find((x) => x.idx === 3).held_by_agent, 'A002', 'and the book did not move')
}

console.log('12. and the screens offer it to the right person, in the right place')
{
  /*
   * Read rather than rendered: what matters here is WHO is offered the control
   * and which door the decision goes through, and both are decided by
   * expressions rather than by anything that appears as text. The behaviour
   * either side of them is sections 1–11.
   */
  const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')

  const find = read('src/components/Search.vue')
  // OFFERED TO THE PERSON THE FENCE STOPS: somebody who cannot issue books and
  // whose account is linked to a seller. An organiser can simply take the book.
  ok(/!isAdmin\.value && !!state\.user\?\.agentId/.test(find),
     'Find offers it to a seller and not to an organiser')
  // AND ONLY FOR A BOOK THAT CAN ACTUALLY BE GIVEN, using the same rule the
  // issuing screen uses rather than a second copy of it.
  ok(/isFreeToIssue\(w\)/.test(find), 'and only for a book that is free to hand out')
  ok(/from '\.\.\/lib\/books\.js'/.test(find), 'imported, not retyped')
  // THE BOOK, NOT THE TICKET: a ticket has no custody of its own.
  ok(/bookNumbers: \[book\.book\]/.test(find), 'it asks for the book the ticket is in')
  // Its own control, like the history button beside it: a row that does several
  // things from one tap does the wrong one eventually.
  ok(/class="rowhist ask"/.test(find), 'as a control of its own on the row')

  const approvals = read('src/components/Approvals.vue')
  ok(/r\.detail\?\.runAs === 'approver'/.test(approvals),
     'the queue tells a book request apart by what the server wrote, not by guessing from the action')
  /*
   * THREE DOORS NOW, not two. Offering books added a reader this queue never
   * had: a SELLER, answering a row an organiser wrote. The other two doors both
   * key on role and neither can express "this one named person", so an offer
   * goes through decide_offer and the server refuses it any row whose
   * decide_by_agent is not the caller's own seller id.
   *
   * Asserted as three separate presences rather than as one exact expression.
   * The previous version pinned the literal ternary, so adding the third door
   * failed this line for being a third door — which is not what it is here to
   * catch. What matters is that no reader is quietly sharing another's door.
   */
  for (const door of ['decide_approval', 'decide_book_request', 'decide_offer']) {
    ok(approvals.includes(`'${door}'`), `the queue reaches ${door}`)
  }
  ok(/isOffer\(r\) \? 'decide_offer'/.test(approvals),
     'and an offer goes through the seller\'s door, chosen by the row and not by role')
  ok(/youDecide\.value \|\| \(isAdmin\.value && isRequest\(r\)\)/.test(approvals),
     'an organiser is offered the decision on a book request and on nothing else')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
