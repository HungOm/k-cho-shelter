/*
 * What the book sheet says about a book, in each state it can be in.
 *
 * THE REPORT THAT PROMPTED THIS was "some UI/UX are unprofessional", with a
 * screenshot of a book that had been brought back. The sheet said, in two
 * consecutive lines:
 *
 *     Where it is     Brought back
 *     Who has it      JOHN
 *
 * The book is on the desk and the screen says JOHN has it. Nothing was broken —
 * held_by_agent is deliberately kept through Returned and Settled so settlement
 * knows whose money it is — but the LABEL was written for one state and shown in
 * all of them. A screen that contradicts itself in adjacent rows is read as a
 * broken app, and reasonably so.
 *
 * Rendered rather than read, because the defect was in what a person sees
 * assembled, not in any one value. Every assertion here is on visible text.
 */
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const STORE = `
import { reactive, computed } from 'vue'
export const state = reactive({ cfg: { ticketsPerBook: 10, currency: 'RM' }, books: [], agents: [] })
export const isAdmin = computed(() => false)
export function go() {}
export function bookBlock() { return null }
export const agentMap = computed(() => ({}))
export function toast() {}
`

const BASE = {
  book: 'Book-070', firstTicket: 'KS-00691', lastTicket: 'KS-00700',
  agentName: 'JOHN', agentId: 'A001', due: '2026-12-10', daysOverdue: 0,
  sold: 0, expected: 0, paid: 0, variance: 0, missingContact: 0, available: 10,
}
const sheet = async (over = {}) => {
  const html = await renderScreen('src/components/modals/BookDetail.vue', STORE,
    { props: { book: { ...BASE, ...over } } })
  return { text: visibleText(html), html }
}

console.log('the sheet never says somebody has a book that is back')
{
  const out = await sheet({ status: 'Out' })
  ok(/Who has it JOHN/.test(out.text), 'a book that is out says who has it')

  const back = await sheet({ status: 'Returned' })
  ok(!/Who has it/.test(back.text),
     'a book that is back does NOT say who has it')
  ok(/Brought back by JOHN/.test(back.text),
     `it says who brought it back (${back.text.slice(0, 60)})`)

  const settled = await sheet({ status: 'Settled' })
  ok(/Was with JOHN/.test(settled.text), 'and a counted book says who it was with')
}

console.log('a due date is shown only while something is actually due')
{
  ok(/Due back/.test((await sheet({ status: 'Out' })).text),
     'an out book shows when it is due')
  for (const status of ['Returned', 'Settled', 'Lost']) {
    ok(!/Due back/.test((await sheet({ status })).text),
       `a ${status.toLowerCase()} book does not — the obligation is over`)
  }
}

console.log('no row says "nobody" where the status already said it')
{
  const free = await sheet({ status: 'Unassigned', agentName: '', due: null })
  ok(!/nobody/i.test(free.text),
     'an unheld book drops the holder row rather than filling it with nobody')
  ok(!/Who has it|Brought back by|Was with/.test(free.text),
     'and shows no holder label at all')
}

console.log('closing does not compete with the things that do something')
{
  /*
   * Four controls of identical weight is a row with no answer to "what am I
   * meant to do here" — and the browser's focus ring lands on the last one, so
   * Close, the only control that does nothing, was the one that looked chosen.
   */
  const { html } = await sheet({ status: 'Returned' })
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []
  const close = buttons.find((b) => /Close/.test(b)) ?? ''
  ok(/ghost/.test(close), `Close is a ghost button (${close.replace(/\s+/g, ' ')})`)
  ok(buttons.filter((b) => /class="btn"/.test(b)).length >= 2,
     'while the real actions keep their weight')
  ok(!/class="btn primary"[^>]*>[^<]*Close/.test(html), 'and Close is never the primary')
}

console.log('an empty title attribute is not rendered')
{
  // `:title="''"` renders as a bare `title` attribute, which is a stray in the
  // markup and shows an empty tooltip on some browsers.
  const { html } = await sheet({ status: 'Out' })
  ok(!/<button[^>]*\stitle(?=[\s>])/.test(html),
     'no button carries a valueless title')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
