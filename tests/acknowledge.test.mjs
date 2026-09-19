/*
 * Whose word it is.
 *
 * Every handover in this system is recorded by the person giving the books
 * away. The trail says an organiser gave JOHN books 31 to 35; nothing anywhere
 * said JOHN agreed he received them. When JOHN says months later that he only
 * ever got three, the system has one person's word written down twice — once
 * in `books`, once in `book_history` — and calls that a record. Both rows came
 * from the same hand.
 *
 * THE WHOLE VALUE IS IN THE DISTINCTION, AND SO IS THE WHOLE RISK.
 *
 *   'app'   — the seller signed in and tapped it. Their word, in their session.
 *   'paper' — the seller signed the printed receipt and an organiser is
 *             recording that they saw it. Still the organiser typing.
 *
 * Collapsing those into one "acknowledged" flag would be WORSE than having
 * none: an organiser could produce, with one tap, a record that reads exactly
 * like the seller's own confirmation — against the seller, in the dispute the
 * record exists for. So the tests that matter most here are not that
 * acknowledging works. They are that an organiser cannot make an 'app'
 * acknowledgement, that the method is never taken from the request, and that
 * one seller cannot acknowledge for another.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf } from './fakedb.mjs'
import { readFileSync } from 'node:fs'
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const people = await loadModule('people.ts')

const seller = { ...users.agent, agentId: 'A001', email: 'hla@x.com', name: 'Daw Hla' }
const otherSeller = { ...users.agent, agentId: 'A002', email: 'kyaw@x.com', name: 'U Kyaw' }

function world(books = null) {
  return fakeDb({
    config: baseConfig({}),
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', active: true },
      { agent_id: 'A002', name: 'U Kyaw', phone: '0125552222', active: true },
    ],
    books: books ?? [
      { idx: 31, number: 'Book-031', status: 'Out', held_by_agent: 'A001', issued_at: '2026-09-01' },
      { idx: 32, number: 'Book-032', status: 'Out', held_by_agent: 'A001', issued_at: '2026-09-01' },
      { idx: 33, number: 'Book-033', status: 'Out', held_by_agent: 'A001', issued_at: '2026-09-01' },
      { idx: 40, number: 'Book-040', status: 'Out', held_by_agent: 'A002', issued_at: '2026-09-01' },
      { idx: 50, number: 'Book-050', status: 'Unassigned', held_by_agent: null, issued_at: null },
    ],
  })
}
const hist = (w) => w.db.tables.book_history
const acks = (w) => hist(w).filter((r) => String(r.action).startsWith('acknowledge'))

console.log('1. the seller confirms their own books, in their own words')
{
  const w = world()
  const r = await people.acknowledgeBooks({}, seller, w.ctx)
  eq(r.method, 'app', 'the seller signing in and tapping is their own word')
  eq(r.confirmed.length, 3, 'all three they are holding')
  eq(acks(w).length, 3, 'one row per book, not one row per handover')
  eq(acks(w)[0].action, 'acknowledge', 'recorded as the seller\'s own')
  eq(acks(w)[0].by_user, 'hla@x.com', 'signed with their email')
  ok(acks(w).every((r2) => r2.to_agent === 'A001'), 'against the seller who confirmed')
}

console.log('2. an organiser CANNOT make the seller\'s own confirmation')
{
  /*
   * The one that matters. If an organiser can produce a row indistinguishable
   * from the seller's tap, the feature is worse than not existing: it puts a
   * confirmation the seller never gave into the record of the dispute they are
   * having with the person who made it.
   */
  const w = world()
  const r = await people.acknowledgeBooks({ agentId: 'A001' }, users.admin, w.ctx)
  eq(r.method, 'paper', 'an organiser records paper, never the seller\'s own tap')
  ok(acks(w).every((x) => x.action === 'acknowledge_paper'),
    'and every row says so in the action, not in prose a translation could reword')
  ok(acks(w).every((x) => x.by_user === 'admin@x.com'), 'named as the witness')
  ok(/witnessed by/i.test(acks(w)[0].note), 'the note says who watched them sign')
}

console.log('3. the method cannot be asked for')
{
  // Sending method:'app' is the obvious attack and the obvious mistake.
  const w = world()
  const r = await people.acknowledgeBooks({ agentId: 'A001', method: 'app' }, users.admin, w.ctx)
  eq(r.method, 'paper', 'what the caller sends is ignored — it follows from who they are')
  ok(acks(w).every((x) => x.action === 'acknowledge_paper'), 'and the rows agree')

  // And the other direction: a seller cannot downgrade their own to paper.
  const w2 = world()
  const r2 = await people.acknowledgeBooks({ method: 'paper' }, seller, w2.ctx)
  eq(r2.method, 'app', 'a seller\'s own tap stays their own word')
}

console.log('4. one seller cannot confirm for another')
{
  const w = world()
  eq(await codeOf(() => people.acknowledgeBooks({ agentId: 'A001' }, otherSeller, w.ctx)),
    'NOT_YOURS', 'a seller acknowledging somebody else\'s handover is refused')
  eq(acks(w).length, 0, 'and nothing was written')
}

console.log('5. a seller naming themselves is still themselves')
{
  const w = world()
  const r = await people.acknowledgeBooks({ agentId: 'A001' }, seller, w.ctx)
  eq(r.method, 'app', 'passing their own id changes nothing')
}

console.log('6. confirming some of them is the normal case')
{
  // Five went out, four arrived. Saying so is the point.
  const w = world()
  const r = await people.acknowledgeBooks({ books: ['Book-031', 'Book-033'] }, seller, w.ctx)
  eq(r.confirmed.join(','), 'Book-031,Book-033', 'only the two named')
  eq(acks(w).length, 2, 'and only two rows')

  const view = await people.acknowledgedBooks({}, seller, w.ctx)
  eq(view.confirmed, 2, 'two confirmed')
  eq(view.unconfirmed.join(','), 'Book-032', 'and the one they did not get is named, not merely absent')
}

console.log('7. a book they are not holding is named, never silently confirmed')
{
  const w = world()
  const r = await people.acknowledgeBooks({ books: ['Book-031', 'Book-040', 'Book-999'] }, seller, w.ctx)
  eq(r.confirmed.join(','), 'Book-031', 'only the one actually out with them')
  eq(r.unknown.sort().join(','), 'Book-040,Book-999',
    'somebody else\'s book and a number that does not exist are both reported back')
  eq(acks(w).length, 1, 'and nothing was written for either')

  const none = world()
  eq(await codeOf(() => people.acknowledgeBooks({ books: ['Book-999'] }, seller, none.ctx)),
    'NOT_HELD', 'naming only books they do not hold is refused outright')
}

console.log('8. tapping twice is not two handovers')
{
  const w = world()
  await people.acknowledgeBooks({}, seller, w.ctx)
  const again = await people.acknowledgeBooks({}, seller, w.ctx)
  eq(acks(w).length, 3, 'a slow connection and a second tap leave three rows, not six')
  eq(again.confirmed.length, 0, 'the second says it confirmed nothing new')
  eq(again.alreadyConfirmed.length, 3, 'and names what was already confirmed, rather than erroring')
}

console.log('9. an organiser cannot overwrite the seller\'s own word with paper')
{
  // The seller confirmed. An organiser then records a paper acknowledgement
  // for the same books. The seller's row must survive as the seller's.
  const w = world()
  await people.acknowledgeBooks({}, seller, w.ctx)
  await people.acknowledgeBooks({ agentId: 'A001' }, users.admin, w.ctx)
  eq(acks(w).length, 3, 'no second row for a book already confirmed')
  ok(acks(w).every((x) => x.action === 'acknowledge'),
    'and all three are still the seller\'s own, not downgraded to paper')
}

console.log('10. nothing to confirm says so')
{
  const w = world([{ idx: 50, number: 'Book-050', status: 'Unassigned', held_by_agent: null }])
  eq(await codeOf(() => people.acknowledgeBooks({}, seller, w.ctx)), 'NOTHING_TO_CONFIRM',
    'a seller holding nothing is told so rather than getting an empty success')
}

console.log('11. reading it back says which kind each one is')
{
  const w = world()
  await people.acknowledgeBooks({ books: ['Book-031'] }, seller, w.ctx)
  await people.acknowledgeBooks({ agentId: 'A001', books: ['Book-032'] }, users.admin, w.ctx)

  const view = await people.acknowledgedBooks({ agentId: 'A001' }, users.admin, w.ctx)
  const by = Object.fromEntries(view.books.map((b) => [b.book, b]))
  eq(by['Book-031'].method, 'app', 'the seller\'s own tap reads as their own')
  eq(by['Book-032'].method, 'paper', 'the witnessed paper reads as paper')
  eq(by['Book-033'].method, 'null', 'and an unconfirmed book claims nothing')
  eq(by['Book-033'].confirmed, 'false', 'not even quietly')
  eq(view.held, 3, 'over everything they hold')
}

console.log('12. one seller cannot read another\'s handover')
{
  const w = world()
  eq(await codeOf(() => people.acknowledgedBooks({ agentId: 'A001' }, otherSeller, w.ctx)),
    'NOT_YOURS', 'refused')
  const mine = await people.acknowledgedBooks({}, otherSeller, w.ctx)
  eq(mine.agentId, 'A002', 'and with nothing asked for they get their own')
  eq(mine.held, 1, 'holding their own one book')
}

console.log('13. it is written down as a thing that happened to the book')
{
  const w = world()
  await people.acknowledgeBooks({}, seller, w.ctx)
  const logged = w.db.tables.audit_log.filter((r) => r.action === 'ACKNOWLEDGE_BOOKS')
  eq(logged.length, 1, 'the audit log has it')
  eq(logged[0].details.method, 'app', 'with the method, so the log can be read without the books')
  eq(logged[0].email, 'hla@x.com', 'and who did it')
}


/*
 * AND THE SCREEN HAS TO BE HONEST ABOUT WHICH KIND IT IS ABOUT TO MAKE.
 *
 * The server refuses to let an organiser produce the seller's own word. That
 * is the guarantee. But an organiser who taps a button labelled "I received
 * these" and is told "confirmed" has been allowed to believe they recorded
 * something stronger than they did — and will say so later, in good faith, to
 * the seller disputing it. So the button says a different thing to each of
 * them, and so does the sentence above it.
 */
const receiptStore = (opts) => `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM' },
  user: ${JSON.stringify(opts.user)},
  agents: [], books: [], tickets: []
})
export const toast = () => {}
export const refresh = async () => {}
export const api = async (action) => {
  if (action === 'handover_receipt') return ${JSON.stringify(opts.receipt)}
  if (action === 'acknowledged_books') return ${JSON.stringify(opts.ack)}
  return {}
}
export const isAdmin = computed(() => ${!!opts.user.isAdmin})
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`

const receipt = {
  org: 'CEA', event: 'Raffle', currency: 'RM',
  agent: { id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL' },
  books: [{ book: 'Book-031', firstTicket: 'KS-00301', lastTicket: 'KS-00310', tickets: 10,
            issued: '2026-09-01', due: '2026-10-11', soldSoFar: 0 }],
  bookCount: 1, ticketCount: 10, valueIfAllSold: 100,
  issuedBy: 'admin@x.com', generatedAt: '2026-09-16T00:00:00.000Z',
}
const unconfirmedAck = {
  agentId: 'A001', held: 2, confirmed: 0, unconfirmed: ['Book-031', 'Book-032'],
  books: [{ book: 'Book-031', confirmed: false, method: null, at: null, by: null },
          { book: 'Book-032', confirmed: false, method: null, at: null, by: null }],
}

/*
 * DRIVEN BY SETTING `ack` RATHER THAN BY LOADING IT, and the reason is the
 * backend flag. A screen compiled by this harness believes it is on Apps
 * Script unless told otherwise, `loadAck` returns early there on purpose, and a
 * render that quietly produced no panel would let every assertion below pass
 * over an empty document. So the panel's own state is set, and the fact that
 * it is NOT fetched on the other backend is asserted separately, below, where
 * the default build makes it the real question rather than an accident.
 */
const render = (user, ack) => renderScreen('src/components/modals/Receipt.vue',
  receiptStore({ user, receipt, ack }),
  { props: { agentId: 'A001' },
    drive: async (c) => { await c.load(); c.ack.value = ack } })

console.log('14. the seller is told it is their own word')
{
  const text = visibleText(await render({ role: 'agent', agentId: 'A001' }, unconfirmedAck))
  ok(/2 of 2 not yet confirmed received/.test(text), 'it says how many are outstanding')
  ok(/Book-031, Book-032/.test(text), 'and names them')
  ok(/received them/.test(text) && /only you can give/.test(text),
    'the sentence says it is their own confirmation, which only they can give')
  ok(!/watched them sign/.test(text), 'and says nothing about witnessing somebody else')
}

console.log('15. an organiser is told it is only a witnessed paper')
{
  const text = visibleText(await render({ role: 'admin', agentId: null, isAdmin: true }, unconfirmedAck))
  ok(/watched them sign/.test(text), 'the sentence says what the tap actually means')
  ok(/witnessed by you, not by them/.test(text),
    'and names the weakness outright, because that is the whole difference')
  ok(!/only you can give/.test(text), 'it never claims to be the seller\'s own')
}

console.log('16. once confirmed, it says which kind each one was')
{
  const done = {
    agentId: 'A001', held: 2, confirmed: 2, unconfirmed: [],
    books: [{ book: 'Book-031', confirmed: true, method: 'app', at: '2026-09-10', by: 'hla@x.com' },
            { book: 'Book-032', confirmed: true, method: 'paper', at: '2026-09-11', by: 'admin@x.com' }],
  }
  const text = visibleText(await render({ role: 'admin', agentId: null, isAdmin: true }, done))
  ok(/All 2 confirmed received/.test(text), 'it says they are all in')
  ok(/confirmed by the seller/.test(text), 'the seller\'s own is named as theirs')
  ok(/signed paper/.test(text), 'and the witnessed one as paper — never merged into one word')
}

console.log('17. the confirmation is the record, not the paper')
{
  const html = await render({ role: 'agent', agentId: 'A001' }, unconfirmedAck)
  ok(/class="noprint ackbox"/.test(html),
    'the panel is marked noprint — the printed sheet is the copy, this is the record')
  ok(/Seller.s signature/.test(visibleText(html)),
    'and the paper keeps its signature lines, which is what somebody signs')
}


console.log('19. the two taps are never given the same words')
{
  /*
   * Read off the source rather than rendered, because the button only exists
   * where isSupabase is true and this harness builds the other backend. The
   * property is worth pinning anyway: one label for both is exactly what a
   * single "acknowledged" flag would produce, and it would let an organiser
   * tap "I received these" and believe they recorded the seller's word.
   */
  const src = readFileSync(new URL('../src/components/modals/Receipt.vue', import.meta.url), 'utf8')
  const button = src.slice(src.indexOf('v-if="canConfirm"'), src.indexOf('Print / Save as PDF'))
  ok(/isTheSeller \?/.test(button), 'the label is chosen by who is tapping')
  ok(/I received these/.test(button) && /They signed for these/.test(button),
    'and there are two different labels, not one')
  const sellerFirst = button.indexOf('I received these') < button.indexOf('They signed for these')
  ok(sellerFirst, 'the seller\'s own wording is the one behind isTheSeller')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
