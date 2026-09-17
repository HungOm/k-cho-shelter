/*
 * A book that has sold, on the one screen that shows every book.
 *
 * REPORTED FROM PRODUCTION, in the way this always gets reported: somebody sold
 * a whole book, looked at the grid, and saw nothing change. Then they refreshed
 * the page and still saw nothing change, which is the part that makes it feel
 * like the app has lost the sale.
 *
 * Nothing had been lost. The sale was recorded, the ticket list showed all ten
 * as Sold, and the book's own panel said "10 of 10". The grid simply had no way
 * to draw it: the square's colour is the book's CUSTODY — office, seller,
 * brought back, finished — and selling every ticket in a book changes none of
 * those. It comes back brown whether it sold out or sold nothing.
 *
 * WHICH IS THE HARDER KIND OF BUG. A screen that cannot show a thing that
 * happened is indistinguishable, to the person looking at it, from a screen
 * that never heard about it — and the second one is what they reasonably
 * conclude, because the first is not a thing software is supposed to do.
 *
 * So the colour still answers "where is it" and the sales are a mark on top.
 * The tests below are about the three states being TOLD APART, and in
 * particular about the one that has to keep looking like nothing: a book that
 * has not been released yet has no sales and no tickets left, and must not be
 * drawn as sold out.
 */
import { renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/** BookGrid imports no store; the stub is here because the harness asks for one. */
const store = `export const state = { }`

const book = (over) => ({
  book: 'Book-001', status: 'Returned', sold: 0, available: 10,
  agentName: '', daysOverdue: 0, ...over,
})

/** The rendered square for one book, as markup. */
async function tile(b) {
  const html = await renderScreen('src/components/ui/BookGrid.vue', store, {
    props: { books: [b] },
  })
  // The legend carries the same class names, so the assertion has to look at
  // the square rather than at the whole page.
  const m = html.match(/<button[^>]*class="[^"]*\bbk\b[^"]*"[^>]*>/)
  return m ? m[0] : ''
}

console.log('1. a book with every ticket sold is marked')
{
  const t = await tile(book({ sold: 10, available: 0 }))
  ok(/sold-all/.test(t), 'the square says the book is finished selling')
  ok(/s-Returned/.test(t), 'and still says where the paper is — the two are different questions')
}

console.log('2. a book part sold is told apart from both')
{
  const t = await tile(book({ sold: 4, available: 6 }))
  ok(/sold-some/.test(t), 'marked as started')
  ok(!/sold-all/.test(t), 'and not as finished')
}

console.log('3. a book nobody has sold from carries no mark')
{
  const t = await tile(book({ sold: 0, available: 10 }))
  ok(!/sold-all/.test(t) && !/sold-some/.test(t), 'nothing sold, nothing drawn')
}

console.log('4. a book not in play yet must not read as sold out')
{
  /*
   * THE CASE THAT MAKES THIS ARITHMETIC RATHER THAN A FLAG. Held-back tickets
   * are not loaded at all, so a book beyond the released line has nothing sold
   * AND nothing available. Asking only "is anything left?" draws it with the
   * same ring as a book that sold out this morning, on hundreds of squares at
   * once — which would make the mark meaningless the day it shipped.
   */
  const t = await tile(book({ status: 'Unassigned', sold: 0, available: 0 }))
  ok(!/sold-all/.test(t),
     'nothing sold and nothing left is a book that has not been released, not a sold-out one')
}

console.log('5. the number on it is still the number, and the hover still reads')
{
  const html = await renderScreen('src/components/ui/BookGrid.vue', store, {
    props: { books: [book({ sold: 10, available: 0, agentName: 'Thang ling' })] },
  })
  ok(/10 of 10 sold/.test(html), 'the title says how much of it went')
  ok(/Thang ling/.test(html), 'and who had it')
  // The words live in a <Bi text="…"> whose PROPS this harness does not render —
  // it renders slots — so the legend is checked by its swatches, which are this
  // component's own markup. Aiming at the words would fail looking exactly like
  // a missing legend.
  ok(/<i class="s-Returned sold-all"/.test(html) && /<i class="s-Returned sold-some"/.test(html),
     'and the legend carries both marks, because a mark nobody can look up is decoration')
}

/*
 * CASE 6 IS HELD BACK, DELIBERATELY, and this note is why rather than a gap.
 *
 * It exercises SellBook.vue's seller picker — who a whole-book sale is
 * credited to — which is a MONEY-ATTRIBUTION change still waiting on the
 * organiser's decision. The four books it was written for are credited in the
 * live database to sellers who had already handed them back, and correcting
 * the ticket rows does not move the money, because what is expected follows
 * books.held_by_agent. That is a decision with two volunteers' names on it.
 *
 * The cases above are the DISPLAY half and drag none of it in: a grid that can
 * draw what sold, and a history panel that stops contradicting the panel
 * behind it. Kept apart so the screens the organiser photographed can be fixed
 * without shipping an attribution rule nobody has agreed to yet.
 */

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
