/*
 * A control you cannot use is shown disabled, with the reason — not enabled,
 * and not silently missing.
 *
 * THE REPORT. A Helper opened Book-406, which was out with JOHN, and "Sell it
 * whole" was offered as an ordinary button. The database refuses that — sell
 * books and sell_book_whole both reject a book that is out with somebody else —
 * so pressing it produced a refusal after the person had committed to the
 * action in front of whoever was paying.
 *
 * THREE CHOICES AND ONLY ONE IS HONEST. Enabled-then-refused blames the user
 * for something the app knew in advance. Hidden makes the screen look different
 * to different people for no stated reason, so a helper comparing notes with an
 * organiser concludes the app is broken or that they have been demoted.
 * Disabled with the reason on it is the only one that tells them anything: the
 * control exists, it is not for you right now, and here is why.
 *
 * ONE RULE, NOT TWO. bookBlock is the single answer and sellBlock is now that
 * function with a ticket's book looked up first. A ticket's answer and its
 * book's answer disagreeing is the failure this repo produced five times in a
 * day — two halves of one fact drifting apart — and this is the same fact asked
 * from two places.
 *
 * It stays a COURTESY. The backend refuses regardless, and must, because this
 * screen has been wrong about its own data before: a stale book list must never
 * be the thing that decides a sale.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const store = read('../src/lib/store.js')
const detail = read('../src/components/modals/BookDetail.vue')
const sellBook = read('../src/components/modals/SellBook.vue')

console.log('the rule exists once and is asked from both places')
{
  const body = store.slice(store.indexOf('export function bookBlock'),
                           store.indexOf('export const searchResults'))
  // `export` is illegal inside new Function; the rule itself is unchanged.
  const bookBlock = new Function('state', `${body.replace(/^export /gm, '')}; return bookBlock`)
  const asHelper = { user: { role: 'recorder', email: 'h@x.com' } }
  const asOwner = { user: { role: 'agent', agentId: 'A1' } }
  const asOther = { user: { role: 'agent', agentId: 'A2' } }
  const asOrganiser = { user: { role: 'admin' } }
  const out = { status: 'Out', agentId: 'A1', agentName: 'JOHN' }

  ok(/with JOHN/.test(bookBlock(asHelper)(out) || ''),
     `a helper is blocked and told who has it (${bookBlock(asHelper)(out)})`)
  ok(bookBlock(asOwner)(out) === null, 'the seller holding it is not blocked')
  ok(bookBlock(asOther)(out) === 'not your book', 'a different seller is told whose it is')
  ok(bookBlock(asOrganiser)(out) === null, 'an organiser transcribing a report is not blocked')
  ok(bookBlock(asHelper)({ status: 'Unassigned' }) === null, 'a book in the office is free')
  ok(/settled/.test(bookBlock(asHelper)({ status: 'Settled' }) || ''), 'a closed book says so')
  ok(bookBlock(asHelper)(null) === null, 'an unknown book blocks nothing')
}

console.log('sellBlock is that same function, not a copy of it')
ok(/export function sellBlock\(ticket\) \{\s*return bookBlock\(whereIs\(ticket\)\)\s*\}/.test(store),
   'sellBlock delegates rather than restating the rule')

console.log('the book sheet shows the control, disabled, with the reason')
ok(/:disabled="!!blocked"/.test(detail), '"Sell it whole" is disabled when blocked')
ok(/:title="blocked \?/.test(detail), 'and carries the reason')
ok(/v-if="book\.available"/.test(detail),
   'still shown whenever the book has tickets — not hidden from a helper')
ok(/bookBlock\(props\.book\)/.test(detail), 'asked of the real rule, not re-derived')

console.log('and the whole-book form refuses before the work, naming the books')
ok(/!blocked\.value\.length/.test(sellBook), 'a blocked book stops the save')
ok(/Not here to sell/.test(sellBook), 'and says so before the button')
ok(/\$\{num\} — \$\{why\}/.test(sellBook),
   'naming each book and its reason, so it is an instruction rather than a refusal')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
