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
export const state = reactive({ cfg: { ticketsPerBook: 10, currency: 'RM' }, books: [], agents: [],
  tickets: __TICKETS__, user: __USER__ })
export const isAdmin = computed(() => false)
export function go() {}
export function bookBlock() { return null }
export const agentMap = computed(() => ({}))
export function toast() {}
// Behaviour stub of the store's own helper; the real one is the single place
// the two sold statuses are spelled.
export const isSold = t => /^(Sold|Donated)$/.test(String(t?.status || ''))
`

/*
 * The sheet now asks WHO WROTE THE SALES DOWN, so the stub has to carry
 * tickets and a signed-in user. Defaults are an empty raffle and a user with no
 * email, which is the state every assertion above was written against.
 */
const withStore = (over = {}) => STORE
  .replace('__TICKETS__', JSON.stringify(over.tickets ?? []))
  .replace('__USER__', JSON.stringify(over.user ?? { email: '' }))

const BASE = {
  book: 'Book-070', firstTicket: 'KS-00691', lastTicket: 'KS-00700',
  agentName: 'JOHN', agentId: 'A001', due: '2026-12-10', daysOverdue: 0,
  sold: 0, expected: 0, paid: 0, variance: 0, missingContact: 0, available: 10,
}
const sheet = async (over = {}) => {
  const html = await renderScreen('src/components/modals/BookDetail.vue', withStore(over.$store),
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

console.log('"Count it in" says what counting in means, because the words do not')
{
  /*
   * ASKED DIRECTLY, looking at a brought-back book with every ticket gone:
   * "if the whole book is sold, why does it still have an active Count in?"
   *
   * Because sold and counted-in are different facts and the screen never said
   * so. Sold 10 of 10 is the tickets; Handed in RM 0.00 is the money; the
   * button is the step that closes the gap. Everything needed to work that out
   * was on the panel, in figures, for a reader who already knew the two were
   * separate — which is the reader who did not need the panel.
   */
  const ADMIN = withStore().replace('computed(() => false)', 'computed(() => true)')
  const html = await renderScreen('src/components/modals/BookDetail.vue', ADMIN,
    { props: { book: { ...BASE, status: 'Returned', sold: 10, available: 0, expected: 100, paid: 0 } } })

  ok(/Count it in/.test(visibleText(html)),
     'a brought-back book still offers it, however much of it sold')
  ok(/title="Counting a book in is its last step/.test(html),
     'and hovering it explains what that means')
  ok(/sold out and still owe money/.test(html),
     'naming the case that prompted the question, rather than defining a term in the abstract')
}

console.log('there is nobody to collect from when you sold it yourself')
{
  /*
   * REPORTED FROM FOUR REAL BOOKS, and the question was the right one: the book
   * is back, every ticket in it is sold, so why is the screen still asking me
   * to count it in?
   *
   * Because counting a book in is a transaction with a person on the other side
   * of it — a seller hands back leftovers and cash. Book-001, 002, 003 and 116
   * were sold whole at the office by the organiser two days after they came
   * back, so the money went into the tin at the time and there is nobody to
   * collect from. The button was inviting them to collect from themselves.
   *
   * ALL, NOT ANY, and this is the assertion that matters most. A book with one
   * desk sale and nine a seller made still has that seller's cash to collect,
   * and disabling it there would strand it — silently, because the button would
   * simply look unavailable.
   */
  const ADMIN = (o) => withStore(o).replace('computed(() => false)', 'computed(() => true)')
  const me = 'organiser@example.com'
  const sheet2 = async (store, over = {}) => {
    const html = await renderScreen('src/components/modals/BookDetail.vue', ADMIN(store),
      { props: { book: { ...BASE, status: 'Returned', sold: 10, available: 0, expected: 100, paid: 0, ...over } } })
    return html
  }
  const t = (n, by) => ({ number: 'KS-' + n, book: 'Book-070', status: 'Sold', by })

  const mine = await sheet2({ user: { email: me }, tickets: [t(1, me), t(2, me)] })
  ok(/Count it in/.test(visibleText(mine)), 'the button is still there, so the state is legible')
  ok(/<button[^>]*disabled[^>]*>\s*Count it in/.test(mine)
     || /Count it in[^<]*<\/button>/.test(mine) && /disabled/.test(mine),
     'but greyed, because every sale in it was written down by the reader')
  ok(/nobody to collect from here/.test(mine),
     'and hovering says why, rather than leaving a dead button unexplained')

  const theirs = await sheet2({ user: { email: me }, tickets: [t(1, 'someone@else.org'), t(2, 'someone@else.org')] })
  ok(!/disabled/.test(theirs), 'a book somebody else wrote down is still countable')

  const mixed = await sheet2({ user: { email: me }, tickets: [t(1, me), t(2, 'someone@else.org')] })
  ok(!/disabled/.test(mixed),
     'and ONE desk sale among a seller\'s nine does not strand the seller\'s money')

  const loading = await sheet2({ user: { email: me }, tickets: [] })
  ok(!/disabled/.test(loading),
     'before the tickets have loaded it fails toward the button working, not away from it')
}

console.log('and the sentence is written once, for every place the phrase appears')
{
  /*
   * THREE SITES, ONE SENTENCE. It is a button on this sheet, a verb in the
   * trail ("Counted in"), and the note on a settlement row in Money. Three
   * hand-written tooltips would drift into three different promises about what
   * the button does, which is worse than none: a volunteer who reads two of
   * them learns that the app is not sure either.
   */
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { codeOf } = await import('./source.mjs')

  const ROOT = fileURLToPath(new URL('../', import.meta.url))
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
  const files = walk(join(ROOT, 'src')).filter((f) => /\.(vue|js)$/.test(f))
  const rel = (f) => f.slice(ROOT.length)

  const defs = files.filter((f) => /export const COUNTED_IN_HELP/.test(readFileSync(f, 'utf8')))
  ok(defs.length === 1 && rel(defs[0]) === 'src/lib/format.js',
     `the sentence is defined once, in format.js (found ${defs.map(rel).join(', ') || 'nowhere'})`)

  // Retyped rather than imported is the failure this catches: a copy reads as
  // correct on the day it is made and drifts on the day the original changes.
  const retyped = files.filter((f) =>
    rel(f) !== 'src/lib/format.js' && /Counting a book in is its last step/.test(readFileSync(f, 'utf8')))
  ok(retyped.length === 0, `nobody retypes it (${retyped.map(rel).join(', ') || 'none do'})`)

  /*
   * EMPTY, AND THE ONE ENTRY IT HELD WAS A FALSE POSITIVE WORTH THE TROUBLE.
   *
   * CheckIn.vue matched on "counted in" and did not carry the tooltip, so it
   * was listed here as a pending gap. It was not one: that screen was saying
   * "ten tickets have been counted in", meaning stubs tallied onto a table,
   * not a book being closed. Bolting COUNTED_IN_HELP onto it would have
   * explained settlement on a line about counting paper.
   *
   * The real fault was the collision. "Counted in" is this app's word for the
   * last step of a book — numbers read back, cash written down, Finished — and
   * a check-in closes nothing. A term that means the ordinary English thing on
   * one screen and a particular irreversible act on another is how somebody
   * thinks they have finished a book by reporting on it. So that screen says
   * "handed over" now, and the list is empty rather than carrying an exemption
   * for a file that never needed one.
   */
  const PENDING = []

  const missing = files.filter((f) => {
    const r = rel(f)
    if (r === 'src/lib/format.js' || PENDING.includes(r)) return false
    const code = codeOf(readFileSync(f, 'utf8'))
    if (!/[Cc]ount(ed|ing)? it in|[Cc]ounted in/.test(code)) return false
    return !/COUNTED_IN_HELP/.test(code)
  })
  ok(missing.length === 0,
     `every screen that names it also explains it (${missing.map(rel).join(', ') || 'all do'})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
