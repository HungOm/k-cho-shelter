/*
 * What a seller reads on the report screen when the money is the question.
 *
 * WHY THIS FILE EXISTS. A checkpoint asks a volunteer two things — what is in
 * your hands, and what is in your pocket — and this screen used to answer them
 * in one run-on sentence that mixed a count of books, a count of tickets and
 * two different sums of money. The sentence was also wrong: it compared the
 * cash against the books being COUNTED IN and nothing else, so a seller handing
 * over exactly what they owed while keeping their books was told they had
 * overpaid, and a seller counting one book in while owing for two was told they
 * were square.
 *
 * The rules underneath are small and worth pinning: the books and the money are
 * two blocks and never one, the balance is the raffle's own figure rather than
 * this screen's arithmetic, and a balance left over is no longer a mistake —
 * it is what a seller halfway through a book looks like.
 */
import { renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${what}`) } }

const store = () => `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10, ticketsPerBook: 10 },
  user: { role: 'agent', agentId: 'A001' },
})
export const api = async () => ({})
export const toast = () => {}
export const refresh = () => {}
export const loadDelta = async () => ({})
`

/**
 * Two books in her hands. Book-002 is part sold — six written down, four live
 * tickets left — which is the whole case this workflow was built for. Book-003
 * has not been opened.
 */
const draft = (over = {}) => ({
  agentId: 'A001', agentName: 'Daw Hla', round: 2,
  checkInDate: '2026-10-01', dueBy: '2026-10-01',
  currency: 'RM', ticketPrice: 10,
  stillSelling: true,
  booksOut: 2, recordedSold: 6, ticketsHeld: 20,
  expected: 60, collected: 0, owed: 60, booksExpected: 60, handedIn: 0,
  alreadyReported: null,
  books: [
    { book: 'Book-002', firstTicket: 'KS-00011', lastTicket: 'KS-00020',
      due: '2026-10-01', held: 10, recordedSold: 6,
      unsoldNumbers: ['KS-00017', 'KS-00018', 'KS-00019', 'KS-00020'],
      suggest: 'keep', inReport: false },
    { book: 'Book-003', firstTicket: 'KS-00021', lastTicket: 'KS-00030',
      due: '2026-10-01', held: 10, recordedSold: 0,
      unsoldNumbers: Array.from({ length: 10 }, (_, i) => `KS-000${21 + i}`),
      suggest: 'keep', inReport: false },
  ],
  ...over,
})

/** Open the screen on a draft, as a mounted component would have it. */
const open = (over = {}, then = () => {}) => renderScreen(
  'src/components/modals/ReportBack.vue', store(),
  { drive: (b) => {
      const d = draft(over)
      b.draft.value = d
      for (const bk of d.books) {
        b.choice.value[bk.book] = bk.suggest
        b.unsold.value[bk.book] = new Set(bk.unsoldNumbers)
      }
      b.handed.value = d.owed > 0 ? String(d.owed) : ''
      then(b)
    } })

console.log('1. carrying on selling is the first thing offered, and the one already chosen')
{
  const html = await open()
  ok(/Still selling it/.test(html), 'the third option exists and is named plainly')
  ok(html.indexOf('Still selling it') < html.indexOf('Counting it in'),
     'and is read before either of the two endings')
  // The chosen one is the one the draft suggested, which is now "keep".
  const first = html.slice(html.indexOf('Still selling it') - 200, html.indexOf('Still selling it'))
  ok(/pick on|on pick/.test(first),
     'a book with tickets left opens on it, rather than on closing the book')
}

console.log('2. the books and the money are two blocks, never one sentence')
{
  const html = await open()
  ok(/2<\/b> staying with you/.test(html), 'the paper is counted as paper')
  ok(/You owe/.test(html) && /Handing over/.test(html) && /After this you owe/.test(html),
     'and the cash is a balance with three lines, not a clause')
  ok(!/more than those books come to/.test(html),
     'the old per-book comparison is gone — it is not a question anybody asked')
}

console.log('3. the balance is what she owes, not what the counted books come to')
{
  // Nothing is being counted in: both books are staying with her. The old
  // screen made that RM0 and called the sixty pounds an overpayment.
  const html = await open()
  ok(/RM\s?60\.00/.test(html), 'the sixty she owes is on the screen')
  ok(!/in credit/.test(html), 'and handing over exactly that is not an overpayment')
}

console.log('4. what is left after handing over is stated, and it is the last word')
{
  const html = await open({}, (b) => { b.handed.value = '20' })
  ok(/After this you owe/.test(html), 'the line that answers the question')
  ok(/RM\s?40\.00/.test(html), 'sixty owed less twenty handed over')
  ok(/still selling/i.test(html),
     'and owing the rest is explained rather than flagged — she has four tickets left')
}

console.log('5. handing over more than she owes is called credit, not a short')
{
  const html = await open({}, (b) => { b.handed.value = '80' })
  ok(/in credit/.test(html), 'said in the word somebody would use for it')
}

console.log('6. sales this report declares are added, and shown as their own line')
{
  /*
   * Counting a book in can charge tickets nobody had written down. That money
   * is real and belongs in the balance — but it is not what she owed when she
   * opened the screen, so it is named rather than folded silently into a bigger
   * number.
   */
  const html = await open({}, (b) => {
    b.choice.value['Book-002'] = 'count'
    // Two of the four leftovers are sold after all, so two more tickets are
    // being declared: RM20 on top of the RM60 already written down.
    b.unsold.value['Book-002'] = new Set(['KS-00019', 'KS-00020'])
  })
  ok(/new sales/.test(html), 'the added money is labelled as coming from this report')
  ok(/RM\s?80\.00/.test(html), 'and the balance is the sixty plus the twenty')
}

console.log('7. once selling has closed, keeping a book is not offered at all')
{
  const html = await open({ stillSelling: false })
  ok(!/Still selling it/.test(html),
     'an option that leads to a refusal is worse than no option')
  ok(/Counting it in/.test(html) && /Bringing it back/.test(html),
     'and the two endings are still there')
}

console.log('8. "nothing sold yet, both books still with me" can be sent')
{
  /*
   * The report that used to be unsendable. No book is moving and there is no
   * money, so every old test of "is there anything here" said no — and the
   * seller who had turned up to the checkpoint was recorded as silent.
   */
  const html = await open({ owed: 0, expected: 0, recordedSold: 0 }, (b) => {
    b.handed.value = ''
  })
  ok(!/disabled/.test(html.slice(html.indexOf('Send to the organiser') - 260,
                                 html.indexOf('Send to the organiser'))),
     'the send button is live')
}

/*
 * THE OTHER END OF THE SAME WORKFLOW.
 *
 * Interim money is recorded against the SELLER and leaves the book showing
 * nothing paid — correctly, because nobody has counted it in yet. Weeks later
 * an organiser finally counts that book in, reads "10 sold, comes to RM100"
 * and types 100 over sixty pounds that is already in the tin. Both figures are
 * right on their own; agent_money adds them and the seller comes out RM60 in
 * credit on money nobody ever received twice.
 *
 * Nothing else in the system can catch it. The book's own row cannot know
 * about money that was never against a book, and the seller's balance cannot
 * know which of two screens was wrong. So it is caught HERE, before the number
 * is typed, by saying what is already in.
 */
const settleStore = `
import { reactive } from 'vue'
const TICKETS = Array.from({ length: 10 }, (_, i) => ({
  number: 'KS-000' + String(11 + i), book: 'Book-002', status: 'Available',
  name: '', phone: '', source: '',
}))
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM',
         ticketPrefix: 'KS-', ticketDigits: 5 },
  user: { role: 'admin', agentId: null },
  tickets: TICKETS,
  byNumber: Object.fromEntries(TICKETS.map((t) => [t.number, t])),
})
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
export const api = async () => ({})
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
`

const BOOK = { book: 'Book-002', agentName: 'Daw Hla', agentId: 'A001', status: 'Out' }

/** The count-in screen, with what the seller has already handed over. */
const countIn = (handedIn, owed = 100) => renderScreen(
  'src/components/modals/SettleBook.vue', settleStore,
  { props: { book: BOOK },
    drive: (b) => {
      b.standing.value = handedIn > 0 || owed > 0
        ? { handedIn, owed, currency: 'RM' } : null
    } })

console.log('9. money already handed in is said before the number is typed')
{
  const html = await countIn(60)
  ok(/already handed in/.test(html), 'the screen names it')
  ok(/RM\s?60\.00/.test(html), 'with the amount')
  ok(/Do not take it twice/.test(html), 'and says plainly what the mistake would be')
}

console.log('10. and the balance is offered as a tap, not left as arithmetic')
{
  const html = await countIn(60)
  ok(/RM\s?40\.00/.test(html),
     'a hundred less the sixty already in — the number that is actually owed now')
  ok(/RM\s?100\.00/.test(html),
     'the book\'s own value is still shown, because that is what was sold')
}

console.log('11. with nothing handed in, the screen says nothing about it')
{
  /*
   * The ordinary count-in is most count-ins, and a permanent warning about
   * money that does not exist is a warning people learn to scroll past.
   */
  const html = await countIn(0)
  ok(!/already handed in/.test(html), 'no panel')
  ok(!/Do not take it twice/.test(html), 'and no instruction about a mistake nobody can make here')
}

/*
 * AND THE SHEET AN ORGANISER DECIDES TO CHASE SOMEBODY FROM.
 *
 * A book counted in for the balance records the balance, so "Should have 100,
 * Handed in 40" leaves "Still owed 60" — in red, on the screen whose whole
 * purpose is deciding whether to go after somebody. The sixty is in the tin
 * and went in weeks earlier against no book. A wrong red figure is worse than
 * no figure, because somebody acts on it.
 */
const bookStore = `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM' },
  user: { role: 'admin', agentId: null },
  tickets: [], byNumber: {},
})
export const isAdmin = () => true
export const go = () => {}
export const bookBlock = () => ''
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
export const api = async () => ({})
`

const COUNTED = {
  book: 'Book-002', firstTicket: 'KS-00011', lastTicket: 'KS-00020',
  status: 'Settled', agentId: 'A001', agentName: 'Daw Hla',
  countedIn: true, sold: 10, expected: 100, paid: 40, variance: 0, available: 0,
}

const sheet = (handedIn, owed) => renderScreen(
  'src/components/modals/BookDetail.vue', bookStore,
  { props: { book: COUNTED },
    drive: (b) => { b.standing.value = { handedIn, owed, currency: 'RM' } } })

console.log('12. a book short by money that is already in is not a debt to chase')
{
  const html = await sheet(60, 0)
  ok(/Still owed/.test(html), 'the book really is short, and the sheet still says so')
  ok(/before this book was counted in/.test(html),
     'and says where the rest of it went')
  ok(/They owe nothing/.test(html), 'naming what the PERSON owes, which is the decision')
  const row = html.slice(html.indexOf('Still owed'), html.indexOf('Still owed') + 220)
  ok(!/--bad/.test(row), 'so it is not drawn in red — there is nobody to chase')
}

console.log('13. a book short by money nobody has handed over still is')
{
  const html = await sheet(0, 60)
  ok(/Still owed/.test(html), 'the row is there')
  ok(!/before this book was counted in/.test(html), 'with nothing to explain away')
  const row = html.slice(html.indexOf('Still owed'), html.indexOf('Still owed') + 220)
  ok(/--bad/.test(row), 'and it is red, because it is real')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
