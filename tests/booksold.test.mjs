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
import { readFileSync } from 'node:fs'
import { renderScreen } from './screen.mjs'
import { cut } from './source.mjs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

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

console.log('5b. a sold-out book carries a mark you can see, and still says where it is')
{
  /*
   * FOUR FORMS, BECAUSE THE FIRST TWO COULD NOT BE SEEN AND THE THIRD COST TOO
   * MUCH.
   *
   * A 2px white ring, a solid white band, a violet fill, now a corner seal. The
   * organiser looked at the real grid and said "same colour" three times, and
   * each time the class was present, the data was right and the mark was
   * rendering. Then the fill fixed it and broke something else: custody had to
   * move to the edge, and a finished sold-out book drew violet-ringed-in-green.
   * "Ugly" was the word, and it was a fault, not a taste — two full-strength
   * hues on a 40px tile make the reader decode which half means what.
   *
   * WHAT THIS PINS is neither the hue nor the shape, both of which somebody may
   * improve. It is the three properties whose loss caused a reported failure:
   *
   *   1. the mark has AREA — the ring and the band died as hairlines
   *   2. custody keeps the FILL — losing it is what made the violet unreadable
   *   3. the legend wears the same mark, or it teaches a thing that is not there
   */
  const css = read('src/components/ui/BookGrid.vue')

  const mark = cut(css, '.bk.sold-all::after', '}', 'the sold-out mark')
  // Sized either literally or through --seal; the test reads whichever it is,
  // because pinning the mechanism would fail the next time somebody tidies it.
  const size = Number(mark.match(/width:\s*(\d+(?:\.\d+)?)px/)?.[1]
                   ?? css.match(/--seal:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
  ok(size >= 10,
     `the mark is ${size}px across — a hairline is what the ring and the band died of`)
  ok(/background:/.test(mark),
     'and it is a filled shape, not an outline drawn on another one')

  // No such rule at all is the healthy case: nothing overrides the fill.
  const fill = css.match(/\.bk\.sold-all\s*\{[^}]*\}/)?.[0] ?? ''
  ok(!/background:\s*#[0-9a-f]{3,8}/i.test(fill),
     'the tile keeps its custody colour — a sold-out book still says where it is')
  /*
   * WHAT CHANGED HERE, AND WHY IT IS NOT A WEAKENING.
   *
   * This used to name five literal hexes — #2563eb and four others — and assert
   * each was still present. The hexes were a PROXY for the real property: that
   * every place a book can be has its own colour, declared once, so the sales
   * mark can borrow it. Pinning the values instead of the property meant the
   * palette could not be corrected without editing the test, and it said
   * nothing at all about the fault that was actually shipping: the values were
   * bare hexes inside this component, so the grid that shows the whole raffle
   * kept its daylight palette on a dark screen.
   *
   * So the property is asserted directly, and the theme fault is asserted too —
   * which the old form could never have caught, because a hard-coded hex passed
   * it by definition.
   */
  const STATES = ['Offered', 'Out', 'Returned', 'Settled', 'Lost', 'Void']
  const declared = {}
  for (const st of STATES) {
    const rule = cut(css, `.s-${st}`, '}', `the ${st} rule`)
    const m = rule.match(/--custody:\s*([^;]+);/)
    ok(m, `${st} names its own custody colour`)
    if (m) declared[st] = m[1].trim()
  }

  // Offered is deliberately the same hue as Out — a book on its way to a seller
  // is that seller's custody, drawn hollow. Every other state is its own.
  const filled = STATES.filter((s2) => s2 !== 'Offered').map((s2) => declared[s2])
  ok(new Set(filled).size === filled.length,
     `the five filled states are five different colours (${filled.join(' ')})`)
  ok(declared.Offered === declared.Out,
     'and a book offered to a seller wears that seller\'s colour, hollow')

  // Every one goes through a token, or it cannot follow dark mode.
  for (const st of STATES) {
    ok(/^var\(--custody-[a-z]+\)$/.test(declared[st] || ''),
       `${st} takes its colour from a token, not a literal (${declared[st]})`)
  }

  /*
   * AND THE TOKENS EXIST, IN BOTH THEMES. A var() pointing at nothing is not a
   * wrong colour, it is NO colour — the tile falls through to a bare square and
   * the grid stops answering the one question it exists for. The light block is
   * the file's :root; the dark one is inside the prefers-color-scheme block.
   */
  const tokens = read('src/style.css')
  const darkBlock = cut(tokens, '@media (prefers-color-scheme: dark)', '\n}\n', 'the dark theme')
  for (const st of STATES) {
    const name = (declared[st] || '').replace(/^var\(|\)$/g, '')
    if (!name) continue
    ok(new RegExp(`${name}:\\s*#`).test(tokens), `${name} is defined for the light theme`)
    ok(new RegExp(`${name}:\\s*#`).test(darkBlock), `${name} is defined for the dark theme too`)
  }
  ok(/--custody:/.test(cut(css, '.s-Out', '}', 'the out-state rule')),
     'and each state names its colour once, so the mark can borrow it')

  const some = cut(css, '.bk.sold-some::after', '}', 'the part-sold dot')
  const someSize = Number(some.match(/width:\s*(\d+(?:\.\d+)?)px/)?.[1] || 0)
  ok(someSize > 0 && someSize < size,
     `part-sold stays the smaller mark (${someSize}px against ${size}px), so the two do not read alike`)

  // The key teaches the mark. If they diverge the legend is a lie.
  const key = cut(css, '.keys i.sold-all::after', '}', 'the legend swatch')
  ok(/border-radius:\s*50%/.test(key) && /background:/.test(key),
     'the legend wears the same seal, smaller, rather than a drawing of it')
}

console.log('6. and the form does NOT ask who sold it — the book decides')
{
  /*
   * A book OUT with somebody is theirs whatever this box says — the server
   * credits the holder. The box is for the other case, which is the one that
   * went wrong: a book in the office, or brought back and not given out again,
   * is sold across a desk by whoever is standing at it. That person was
   * recorded as the seller who had handed the book in, and the price of ten
   * tickets landed on her balance.
   */
  const store = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM', bookPrefix: 'Book-', bookDigits: 3 },
  agents: [{ id: 'A001', name: 'Amos Hung' }, { id: 'A002', name: 'Thang ling' }],
  user: { role: 'recorder', agentId: 'A001' }, books: [], tickets: [],
})
export const api = async (a, p) => { globalThis.__sold = p; return { sold: 10, books: ['Book-001'], amount: 100, tickets: [], skipped: [] } }
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
export const isAdmin = computed(() => false)
export const bookBlock = () => null
// The organiser's override asks why; these screens import the predicate that
// decides whether to ask. Default false: no stub here puts a book in somebody
// else's hands, and a stub that says yes would make every render demand a reason.
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
`
  const { setupOf } = await import('./screen.mjs')
  const { ctx, cleanup } = await setupOf('src/components/modals/SellBook.vue', store, { book: null })

  /*
   * THE FORM NO LONGER ASKS, AND THAT IS THE POINT NOW.
   *
   * This block used to assert the opposite: a "Who sold it?" list, defaulting
   * to whoever was signed in, sent to the server so it "does not have to
   * guess". The server was not guessing — it knows who is holding the book,
   * which is the only thing that decides whose money a sale is.
   *
   * What the asking produced: Book-004 went out to a seller at 01:02, came back
   * to the office at 01:04, and was sold whole at the desk at 01:27 — credited
   * to the seller who had returned it, because the list offered their name and
   * sell_books accepted it. Money on the balance of somebody who had already
   * settled up.
   *
   * The rule now is the raffle owner's: a seller is credited only when a book
   * GIVEN OUT TO THEM is sold. Out with somebody — theirs. At the office — the
   * office's, and the organiser is on recorded_by where their name belongs.
   */
  ok(ctx.soldBy === undefined, 'the form does not carry a seller to credit any more')

  globalThis.__sold = null
  ctx.from.value = '1'
  ctx.name.value = 'HTNAG'
  ctx.phone.value = '012345678'
  await ctx.sell()
  ok(globalThis.__sold && !('soldBy' in globalThis.__sold),
     'and does not send one, so the book decides rather than the person pressing')
  cleanup()
}

console.log('7. a book with tickets already sold is refused WHILE TYPING, not after pressing')
{
  /*
   * REPORTED FROM THE SCREEN. An organiser typed books 3 to 12, filled in the
   * buyer and the telephone number, pressed Sell, and was told "Book Book-0003
   * is not whole — 10 of its tickets are already sold." The live summary had
   * said "10 books · 100 tickets · RM 1,000.00" the entire time.
   *
   * The modal already pre-checked the CUSTODY half of what the server refuses —
   * settled, lost, out with a seller — precisely so that nobody commits to a
   * sale in front of whoever is paying and is then refused. The WHOLENESS half
   * had no client side at all, so it could only ever arrive after the press,
   * which is the one outcome that pre-check exists to prevent.
   *
   * THE TEST DRIVES THE RANGE RATHER THAN CALLING sell(). What went wrong is
   * that the form stayed VALID; asserting on the refusal would be asserting on
   * the server's behaviour, which was already correct.
   */
  const store = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { ticketsPerBook: 10, ticketPrice: 10, currency: 'RM', bookPrefix: 'Book-', bookDigits: 4 },
  agents: [],
  user: { role: 'recorder', agentId: 'A001' },
  /* Book-0003 has had ten tickets sold from it; the other two are untouched.
     The sold field is the one bookWire puts on every book, from counted_sold. */
  books: [
    { book: 'Book-0002', status: 'Available', sold: 0, available: 10 },
    { book: 'Book-0003', status: 'Available', sold: 10, available: 0 },
    { book: 'Book-0004', status: 'Available', sold: 0, available: 10 },
  ],
  tickets: [],
})
export const api = async () => ({ sold: 0, books: [], amount: 0, tickets: [], skipped: [] })
export const toast = () => {}
export const refresh = async () => {}
export const loadDelta = async () => {}
export const isAdmin = computed(() => false)
export const bookBlock = () => null
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
`
  const { setupOf } = await import('./screen.mjs')
  const { ctx, cleanup } = await setupOf('src/components/modals/SellBook.vue', store, { book: null })

  ctx.name.value = 'John Thang Test'
  ctx.phone.value = '0172112613'

  /*
   * ASSERTED BEFORE IT IS READ, so a modal without the check FAILS rather than
   * throwing. An uncaught TypeError kills the suite before its summary, and
   * run.sh reads a missing summary as no line at all rather than as a failure.
   */
  ok(!!ctx.notWhole, 'the modal computes which books in the range are not whole')
  const nw = () => (ctx.notWhole?.value ?? [])

  /* A range with nothing sold in it stays sellable — the guard must not fire
     on every range, which is the failure a guard like this has. */
  ctx.from.value = '2'
  ctx.to.value = '2'
  ok(nw().length === 0, 'a whole book on its own raises nothing')
  ok(ctx.ok.value === true, 'and the form is sellable')

  /* The reported case: the part-sold book is FIRST in the range. */
  ctx.from.value = '3'
  ctx.to.value = '4'
  ok(nw().length === 1,
     `the part-sold book is named before anything is pressed (got ${nw().length})`)
  ok(/Book-0003/.test(nw()[0] || ''),
     `and named by its number rather than counted (${nw()[0]})`)
  ok(/10/.test(nw()[0] || ''),
     'and says how many are gone, which is what the server refusal says')
  ok(ctx.ok.value === false, 'and the form cannot be submitted')

  /* And in the MIDDLE of a range, which a check on the first book alone would
     miss — the server walks every book in the range. */
  ctx.from.value = '2'
  ctx.to.value = '4'
  ok(nw().length === 1, 'a part-sold book inside the range is caught too')
  ok(ctx.ok.value === false, 'and still blocks the form')

  cleanup()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
