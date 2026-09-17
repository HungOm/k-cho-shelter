/*
 * How many of a book sold, as the screen says it before anybody hands money over.
 *
 * THE SCREEN AND THE SERVER HAVE TO AGREE, and they did not.
 *
 * Counting a book in asks for the numbers that came BACK; everything else is
 * sold and is charged to the seller. The server works that out by counting
 * ticket ROWS. The screen worked it out by counting the LENGTH OF THE TYPED
 * LIST, and those are the same number only when the list is perfect.
 *
 * Two ways it was not. A number read out twice from a stack of stubs — "5052,
 * 5052" — took a ticket off the sold side and RM10 off what the seller owed,
 * while the server counted nine sold and recorded RM90 due. The organiser takes
 * RM80, the book says RM90, and the shortfall lands on a volunteer who did
 * nothing wrong. And the book's size came from TICKETS_PER_BOOK rather than
 * from the tickets, so a book at the end of a part-released run — holding six,
 * not ten — read as four more sold than exist.
 *
 * Neither fails. Neither errors. Both produce a confident total that is wrong
 * in the direction of somebody being short of money, which is the shape of
 * nearly every bug this project has found in itself.
 *
 * WHY THIS RUNS THE COMPUTEDS rather than reading the source: the arithmetic is
 * four lines and the wrong version of it is also four lines. Only working it
 * out on real input tells them apart.
 */
import { setupOf } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  if (String(g) === String(w)) pass++
  else { fail++; console.log(`  FAIL ${what}: got ${g}, want ${w}`) }
}

/**
 * A raffle with two books: one full, one short.
 *
 * Book-506 holds 5051–5060, which is the book in the screenshot this was
 * reported from. Book-507 holds three tickets — the tail of a part-released
 * run, which is the case TICKETS_PER_BOOK gets wrong.
 */
const ticket = (n, book) => ({ number: 'KS-0' + n, book, status: 'Available' })
const TICKETS = [
  ...Array.from({ length: 10 }, (_, i) => ticket(5051 + i, 'Book-506')),
  ...Array.from({ length: 3 }, (_, i) => ticket(5061 + i, 'Book-507')),
]

const store = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM',
         ticketPrefix: 'KS-', ticketDigits: 5 },
  tickets: ${JSON.stringify(TICKETS)},
  byNumber: ${JSON.stringify(Object.fromEntries(TICKETS.map((t) => [t.number, t])))},
})
export const api = async () => ({ declaredSold: 0, variance: 0 })
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
`

const BOOK = { book: 'Book-506', agentName: 'Kee Thang', status: 'Out' }
const SHORT_BOOK = { book: 'Book-507', agentName: 'Kee Thang', status: 'Out' }

/** The screen, with a list typed into it. */
async function counting(text, book = BOOK) {
  const { ctx, cleanup } = await setupOf('src/components/modals/SettleBook.vue', store, { book })
  ctx.unsold.value = text
  return { ctx, cleanup }
}

console.log('1. the same number twice is one ticket')
{
  const { ctx, cleanup } = await counting('5051, 5052, 5052')
  eq(ctx.sold.value, 8, 'two tickets came back, so eight sold — not seven')
  eq(ctx.due.value, 80, 'and RM80 is what the seller owes')
  eq(ctx.returned.value.length, 2, 'the list sent to the server carries each ticket once')
  eq(ctx.repeated.value.join(' '), '5052 (2×)',
     'and the repeat is named, because occasionally one of them should have been a different number')
  cleanup()
}

console.log('2. the whole book read out, in any spacing, is the whole book')
{
  // Exactly the input from the report: mixed commas and spaces, ten numbers.
  const { ctx, cleanup } = await counting(
    '5051, 5052, 5053, 5054, 5055,5056,5057, 5058,5059,5060')
  eq(ctx.sold.value, 0, 'nothing sold')
  eq(ctx.due.value, 0, 'and nothing owed')
  eq(ctx.repeated.value.length, 0, 'nothing was typed twice')
  eq(ctx.unresolved.value.length, 0, 'and every number resolved')
  cleanup()
}

console.log('3. one button for it, because ten numbers is ten chances to fumble a digit')
{
  const { ctx, cleanup } = await counting('')
  eq(ctx.sold.value, 10, 'an empty box is the whole book sold, as it always was')
  ctx.wholeBookBack()
  eq(ctx.sold.value, 0, 'and the button turns it into the whole book coming back')
  eq(ctx.returned.value.length, 10, 'every ticket in it')
  ok(ctx.allBack.value, 'the button then has nothing left to add and says so')
  ok(/5051/.test(ctx.unsold.value) && /5060/.test(ctx.unsold.value),
     'by filling the box, so the organiser can see what is about to be claimed')
  cleanup()
}

console.log('4. a book that holds fewer than a full book')
{
  const { ctx, cleanup } = await counting('5061', SHORT_BOOK)
  eq(ctx.sold.value, 2,
     'three tickets less the one that came back — not nine, which is what ' +
     'subtracting from TICKETS_PER_BOOK gives on the tail of a part-released run')
  eq(ctx.due.value, 20, 'and RM20, which is what the server will record')
  cleanup()
}

console.log('5. what does not belong here is not counted as coming back')
{
  const { ctx, cleanup } = await counting('5051, 5061, 9999')
  eq(ctx.wrongBook.value.length, 1, 'a real ticket from another book is named')
  eq(ctx.unresolved.value.length, 1, 'and a number that is no ticket at all')
  eq(ctx.sold.value, 9,
     'only the one ticket that is actually in this book counts as returned — ' +
     'counting the others would show the seller owing less than they are charged')
  cleanup()
}

console.log('6. a list with a bad number in it is not sent at all')
{
  // The screen has warned in red since long before this that a number it cannot
  // match "would be counted as sold" — and then sent it anyway, as a null the
  // server ignored. The warning was right and nobody was stopped.

  const { ctx, cleanup } = await setupOf('src/components/modals/SettleBook.vue',
    store.replace('export const api = async () => ({ declaredSold: 0, variance: 0 })',
      'export const api = async (a, p) => { globalThis.__sent = p; return { declaredSold: 0, variance: 0 } }'),
    { book: BOOK })
  globalThis.__sent = null
  ctx.unsold.value = '5051, 9999'
  ctx.paid.value = '90'
  await ctx.settle()
  eq(globalThis.__sent, null, 'nothing was sent while a number on the list is wrong')

  ctx.unsold.value = '5051, 5051'
  await ctx.settle()
  eq(globalThis.__sent?.unsoldTickets?.length, 1,
     'and once it is right, what is sent is what the screen counted — once each')

  cleanup()
}

console.log('7. a lost-leftovers count is still whatever was typed')
{
  const { ctx, cleanup } = await counting('5051, 5051')
  ctx.lost.value = true
  ctx.soldCount.value = '7'
  eq(ctx.sold.value, 7, 'the declared figure stands on its own; no ticket is marked')
  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
