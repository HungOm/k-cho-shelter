/*
 * Counting a book in can only name tickets from that book.
 *
 * THE COSMETIC HALF AND THE DANGEROUS HALF LOOK THE SAME.
 *
 * The placeholder was a fixed "313, 317" whatever book was open. On Book-092,
 * whose tickets are 911-920, that is an example nobody can follow — and it is
 * worse than useless, because 313 and 317 ARE real tickets. They belong to
 * Book-032.
 *
 * resolveTicketNumber searches the whole raffle, so a number from another book
 * resolves perfectly and passes the "not a ticket in this raffle" check that
 * already existed. It would then be sent as unsold FOR THIS BOOK. Everything
 * not named counts as sold and is charged to the seller, so one stray number
 * moves a ticket to the wrong side of two different books' accounts — and the
 * screen showed no sign of it.
 *
 * So the range is read from the tickets rather than computed from the book
 * number times the tickets per book: a book at the end of a part-released run
 * holds fewer, and arithmetic would confidently name numbers that are not in
 * play.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/components/modals/SettleBook.vue', import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

console.log('the example comes from the book in front of you')
ok(/:placeholder="example"/.test(src), 'the placeholder is bound, not hardcoded')
ok(!/placeholder="313, 317"/.test(src), 'the fixed 313, 317 is gone')
ok(/const example = computed/.test(src), 'and is computed per book')

console.log('the range is read from the tickets, not multiplied out')
ok(/t\.book === props\.book\.book/.test(src), 'inBook filters the tickets of this book')
ok(!/per\.value \* |idx \* per/.test(src.slice(src.indexOf('const inBook'), src.indexOf('const example'))),
   'the range is not derived from tickets-per-book arithmetic')
ok(/This book holds/.test(src), 'and the range is shown to the person typing')

console.log('a real ticket from another book is refused')
ok(/const wrongBook = computed/.test(src), 'wrong-book numbers are detected')
ok(/state\.byNumber\[x\.num\]\.book !== props\.book\.book/.test(src),
   'by comparing the ticket\'s own book, not by guessing from the number')
// Matched as a SET rather than as one exact string: the list of things that
// block the save grows, and pinning its spelling makes every addition look like
// a regression. What matters is that each one is in there.
//
// READ OFF THE SAVE BUTTON, not off the first :disabled in the file. It was the
// first one, and the footer now holds a second control — "Mark it brought back",
// for a book with nothing sold in it — which is disabled on `busy` alone and
// legitimately so. That harmless button became the one this read, and three
// guards that had not moved reported as missing. An assertion about which
// button carries the guards has to say which button it is looking at.
{
  const at = src.indexOf('@click="settle"')
  ok(at > 0, 'the save button is in the template')
  const button = src.slice(src.lastIndexOf('<button', at), at)
  const disabled = (button.match(/:disabled="[^"]*"/) || [''])[0]
  for (const guard of ['unresolved.length', 'wrongBook.length', 'alreadySold.length']) {
    ok(disabled.includes(guard), `${guard} blocks the save (${disabled})`)
  }
}
ok(/Not in \{\{ book\.book \}\}/.test(src), 'the warning names the book it is not in')

console.log('the existing guard is untouched')
ok(/Not a ticket in this raffle/.test(src), 'a number that is no ticket at all still says so')
ok(/unresolved\.length/.test(src), 'and still blocks the save')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
