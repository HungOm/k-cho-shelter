/*
 * Who had this before me, and may I ring them.
 *
 * A book comes back and goes out again to somebody else. The person taking it
 * on has one ordinary question — who was carrying this, and did they sell any
 * of it — and until now the answer was two taps down inside a sheet that also
 * gives books out and records sales. A question that costs you a form which can
 * change things is a question people stop asking.
 *
 * A NAME ON ITS OWN IS NOT ENOUGH TO ACT ON. There are two sellers called JOHN
 * in this raffle. The one somebody means is the one from their own church, so
 * the zone travels with the name and the screen says Josh (CCFM) — which is how
 * people refer to each other here anyway.
 *
 * AND THE TELEPHONE NUMBER IS NOT FOR EVERYBODY. Whoever holds the book next
 * should know who had it before them. They should not be handed a directory of
 * every seller's number as a side effect of looking at a history. So the server
 * fills the number in for an organiser and the system admin — the people whose
 * job is chasing — and leaves it empty for everyone else, and the screen makes
 * a name contactable only when there is something to contact.
 *
 * That split is the thing worth testing. Everything else about this screen is
 * presentation; this decides who gets a list of phone numbers.
 */
import { readFileSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'
import { renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const books = await loadModule('books.ts')

function world() {
  return fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20' }),
    agents: [
      { agent_id: 'A001', name: 'Josh', phone: '0125551111', zone: 'CCFM', active: true },
      { agent_id: 'A002', name: 'Mary', phone: '0125552222', zone: '', active: true },
    ],
    books: [{ idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A002',
              first_ticket: 'KS-00001', last_ticket: 'KS-00010' }],
    tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available', recorded_by: '' }],
    book_history: [
      { id: 1, book_idx: 1, at: '2026-09-01T00:00:00.000Z', action: 'issue',
        from_agent: null, to_agent: 'A001', by_user: 'admin@x.com', note: '' },
      { id: 2, book_idx: 1, at: '2026-09-05T00:00:00.000Z', action: 'return',
        from_agent: 'A001', to_agent: null, by_user: 'admin@x.com', note: '' },
      { id: 3, book_idx: 1, at: '2026-09-06T00:00:00.000Z', action: 'issue',
        from_agent: null, to_agent: 'A002', by_user: 'admin@x.com', note: '' },
    ],
  })
}
const step = (r, action) => r.history.find((h) => h.action === action)

console.log('1. the trail says who had it, and where they are from')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, world().ctx)
  const back = step(r, 'return')
  eq(back.fromWho.name, 'Josh', 'the seller who brought it back is named')
  eq(back.fromWho.zone, 'CCFM', 'with the zone that tells one JOHN from another')
  eq(back.fromWho.id, 'A001', 'and the id, so a screen can link to them')
  eq(step(r, 'issue').toWho.name, 'Josh', 'and the handover that started it')
}

console.log('2. an organiser may ring them')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, world().ctx)
  eq(step(r, 'return').fromWho.phone, '0125551111', 'the number is there for an organiser')
}

console.log('3. the system admin may too')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.boss, world().ctx)
  eq(step(r, 'return').fromWho.phone, '0125551111', 'the system admin is an organiser plus a flag')
}

console.log('4. a seller sees WHO, and not their number')
{
  /*
   * The half that matters. A seller taking the book on is told who had it —
   * that is the whole point — and is not handed a way to ring every seller in
   * the raffle because they looked at a history.
   */
  const seller = { ...users.agent, agentId: 'A002' }
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, seller, world().ctx)
  const back = step(r, 'return')
  eq(back.fromWho.name, 'Josh', 'they are told who had it')
  eq(back.fromWho.zone, 'CCFM', 'and where they are from')
  eq(back.fromWho.phone, '', 'and given no telephone number')
}

console.log('5. nor does a helper, or somebody who may only look')
{
  const r1 = await books.bookHistory({ bookNumber: 'Book-001' }, users.recorder, world().ctx)
  eq(step(r1, 'return').fromWho.phone, '', 'a helper gets the name and no number')
  eq(step(r1, 'return').fromWho.name, 'Josh', 'the name is still there')

  const viewer = { ...users.admin, role: 'viewer', isAdmin: false, agentId: null }
  const r2 = await books.bookHistory({ bookNumber: 'Book-001' }, viewer, world().ctx)
  eq(step(r2, 'return').fromWho.phone, '', 'and so does a viewer')
}

console.log('6. a seller with no zone is a name, not a name and an empty bracket')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, world().ctx)
  const on = r.history.filter((h) => h.action === 'issue').pop()
  eq(on.toWho.name, 'Mary', 'the seller holding it now')
  eq(on.toWho.zone, '', 'has no zone recorded')
}

console.log('7. the old plain names are still there, so the existing trail keeps working')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, world().ctx)
  eq(step(r, 'return').from, 'Josh', 'from is still the bare name it always was')
  eq(step(r, 'issue').to, 'Josh', 'and so is to')
}

console.log('8. a step with nobody on it says nobody, rather than inventing one')
{
  const w = world()
  w.db.tables.book_history.push({ id: 4, book_idx: 1, at: '2026-09-07T00:00:00.000Z',
    action: 'restock', from_agent: null, to_agent: null, by_user: 'admin@x.com', note: '' })
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, w.ctx)
  const s = step(r, 'restock')
  eq(s.fromWho, 'null', 'no one it came from')
  eq(s.toWho, 'null', 'and no one it went to')
}

console.log('9. every movement is in the list, not only the last one')
{
  const r = await books.bookHistory({ bookNumber: 'Book-001' }, users.admin, world().ctx)
  eq(r.history.length, 3, 'given out, brought back, given out again')
  eq(r.history.map((h) => h.action).join(','), 'issue,return,issue', 'in the order they happened')
}


/*
 * AND IT HAS TO BE REACHABLE FROM THE LIST, which is the other half of the ask.
 *
 * The trail existed and was two taps down: open a ticket, find the button
 * inside the sheet that also records sales. The question "who had this before
 * me" is asked while somebody is standing in front of you holding the book, and
 * a question that costs you a form which can change things is one people stop
 * asking. So every row carries its own control.
 *
 * It has to be its OWN control, not the row. The row already opens the sell
 * sheet; a row that does two things from one tap does the wrong one eventually,
 * and a button inside a button is invalid HTML that browsers resolve by
 * dropping one of them.
 */
const ticketStore = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10, ticketStart: 1, ticketDigits: 5, ticketPrefix: 'KS-' },
  agents: [{ id: 'A001', name: 'Josh', zone: 'CCFM', active: true }],
  tickets: [{ number: 'KS-00001', book: 'Book-001', status: 'Available' }],
  books: [], user: { role: 'admin' }
})
export const searchResults = computed(() => ({
  results: [{ number: 'KS-00001', book: 'Book-001', status: 'Available', agent: 'A001' }],
  total: 1, truncated: false,
}))
export const agentMap = computed(() => ({ A001: { id: 'A001', name: 'Josh', zone: 'CCFM' } }))
export const whereIs = () => ({ book: 'Book-001', status: 'Out', agentName: 'Josh' })
export const isSold = () => false
/* Find asks this before offering the S shortcut. Null here: this fixture is
   about the history control on a row, not about what may be sold. */
export const sellBlock = () => null
export const api = async () => ({ book: {}, history: [], tickets: [] })
export const toast = () => {}
export const refresh = async () => {}
export const isAdmin = computed(() => true)
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const go = () => {}
`

console.log('10. every ticket row carries its own way into the history')
{
  const html = await renderScreen('src/components/Search.vue', ticketStore)
  ok(/class="rowhist"/.test(html), 'the row has a history control of its own')
  ok(/Where KS-00001 has been/.test(html), 'labelled with the ticket it is about')
  ok(/aria-label="Where KS-00001 has been"/.test(html), 'and named for a screen reader')
  // Siblings, never nested: the row's own button must CLOSE before the history
  // one opens. A button inside a button is invalid HTML and browsers resolve it
  // by dropping one of them — usually the one you wanted.
  const row = html.slice(html.indexOf('<li'), html.indexOf('</li>'))
  const between = row.slice(row.indexOf('class="item"'), row.indexOf('class="rowhist"'))
  ok(between.includes('</button>'), 'the row button closes before the history button opens')
}

console.log('11. and so does every book row')
{
  const bookStore = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketsPerBook: 10 },
  agents: [{ id: 'A001', name: 'Josh', zone: 'CCFM', active: true }],
  books: [{ book: 'Book-001', firstTicket: 'KS-00001', lastTicket: 'KS-00010',
            status: 'Out', agentId: 'A001', agentName: 'Josh', sold: 0, daysOverdue: 0 }],
  tickets: [], user: { role: 'admin' }
})
export const isAdmin = computed(() => true)
export const go = () => {}
export const api = async () => ({ book: {}, history: [], tickets: [] })
export const toast = () => {}
export const refresh = async () => {}
export const isSuper = computed(() => false)
export const canWrite = computed(() => true)
export const agentMap = computed(() => ({}))
export const isSold = () => false
`
  const html = await renderScreen('src/components/Books.vue', bookStore)
  ok(/class="rowhist"/.test(html), 'the book row has a history control of its own')
  ok(/Where Book-001 has been/.test(html), 'labelled with the book it is about')
  const row = html.slice(html.indexOf('<li'), html.indexOf('</li>'))
  const between = row.slice(row.indexOf('class="item"'), row.indexOf('class="rowhist"'))
  ok(between.includes('</button>'), 'and closes before it, like the ticket row')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
