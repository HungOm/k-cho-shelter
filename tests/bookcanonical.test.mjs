/*
 * A BOOK NUMBER REACHES THE SERVER AS THE RAFFLE SPELLS IT.
 *
 * The server matches `books.number` exactly — functions/api/printing.ts throws
 * BOOK_NOT_FOUND on a string miss — so every screen that takes a typed book has
 * to turn what somebody typed into the label the raffle actually stores. Most
 * of them do: IssueBooks sends bookNumber(), which pads using the raffle's own
 * BOOK_PREFIX and BOOK_DIGITS, so "1", "01" and "Book-1" all arrive as one
 * thing.
 *
 * PrintTickets did not. It sent the box's own text, so a raffle numbered
 * Book-001 answered "Book-0001 is not a book in this raffle." to somebody
 * holding a book with 0001 printed on it — refusing the padding rather than
 * the book, and saying nothing about which padding would work. The app had
 * already taught them that typing 1 works, because everywhere else it does.
 *
 * WHY A TEST AND NOT A FIXED BUG. Nothing else would catch the next one. The
 * screen renders, the field accepts text, the request is well formed and the
 * server's refusal is correct — it is only wrong about whose fault it is. That
 * is invisible to every other suite here, and the same mistake is available to
 * every new screen that adds a book box.
 *
 * It asserts the SHAPE — a book sent to the server is not a raw v-model ref —
 * rather than naming components, so a screen added tomorrow is covered without
 * anybody remembering this file exists. The two fixtures at the bottom are the
 * evidence it can tell the difference: the original bug fails it, and correct
 * code that looks very like the bug passes.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SRC = join(ROOT, 'src/components')

function vueFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...vueFiles(join(dir, e.name)))
    else if (e.name.endsWith('.vue')) out.push(join(dir, e.name))
  }
  return out
}

/*
 * The identifiers a person types into, and the book values a component sends.
 * A payload book whose value is one of those refs, unwrapped, is the bug.
 */
const RESOLVERS = /^(bookNumber|storedBook|resolveBook|bookLabel)\(/
function rawBookSends(src) {
  const typed = new Set([...src.matchAll(/v-model="(\w+)"/g)].map((m) => m[1]))
  const bad = []
  for (const m of src.matchAll(/\b(book|bookNumber|fromBook|toBook)\s*:\s*([^,\n}]+)/g)) {
    const value = m[2].trim()
    const ref = /^(\w+)\.value\b/.exec(value)
    if (!ref || !typed.has(ref[1])) continue
    if (RESOLVERS.test(value)) continue
    bad.push(`${m[1]}: ${value}`)
  }
  return bad
}

console.log('every typed book is canonicalised before it is sent')
{
  const files = vueFiles(SRC)
  ok(files.length > 20, `${files.length} components scanned`)
  for (const f of files) {
    const rel = f.slice(ROOT.length)
    const bad = rawBookSends(readFileSync(f, 'utf8'))
    ok(bad.length === 0, `${rel} sends a typed book straight through (${bad.join('; ')})`)
  }
}

/*
 * A HARDCODED EXAMPLE LABEL GOES STALE THE DAY THE RAFFLE IS NUMBERED
 * DIFFERENTLY. PrintTickets suggested "Book-001" while the seeded default is
 * four digits, so its own hint showed a format the server would refuse. The
 * client already has bookPrefix and bookDigits; a placeholder can be built.
 */
console.log('and no screen hardcodes what a book number looks like')
{
  for (const f of vueFiles(SRC)) {
    const rel = f.slice(ROOT.length)
    const src = readFileSync(f, 'utf8')
    const hits = [...src.matchAll(/\splaceholder="([A-Za-z]+-\d+)"/g)].map((m) => m[1])
    ok(hits.length === 0, `${rel} hardcodes a sample number in a placeholder (${hits.join(', ')})`)
  }
}

/*
 * THE DETECTOR ITSELF, against the code that produced the bug and against code
 * that resembles it and is right. A guard nobody has seen fail is a guard
 * nobody knows the shape of.
 */
console.log('the check fails on the original bug and passes correct code')
{
  const wasBroken = `
    <input v-model="fromBook"><input v-model="toBook">
    const scope = computed(() => ({ fromBook: fromBook.value, toBook: toBook.value || fromBook.value }))`
  ok(rawBookSends(wasBroken).length === 2, 'the original PrintTickets range is caught')

  const isFixed = `
    <input v-model="fromBook"><input v-model="toBook">
    const scope = computed(() => ({ fromBook: storedBook(fromBook.value), toBook: storedBook(toBook.value) }))`
  ok(rawBookSends(isFixed).length === 0, 'the same screen, resolved first, is not')

  // A label read off a book RECORD is already the stored spelling. Flagging it
  // would make the guard cry wolf on every detail screen that passes one on.
  // The payment screen had the same bug under a different payload name, and
  // money.ts does the same exact eq() on it — so the key list is not just the
  // three the print modal happened to use.
  const wasBrokenToo = `<input v-model="bookNumber">
    api('record_payment', { bookNumber: bookNumber.value.trim() })`
  ok(rawBookSends(wasBrokenToo).length === 1, 'the payment screen\'s book box is caught too')

  const fromRecord = `<div>{{ b.book }}</div>
    api('settle_book', { book: props.book.book })`
  ok(rawBookSends(fromRecord).length === 0, 'a label taken from a book row is left alone')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
