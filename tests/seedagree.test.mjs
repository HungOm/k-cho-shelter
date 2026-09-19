/*
 * THE THREE WAYS INTO A RAFFLE MUST AGREE ON WHAT A TICKET IS CALLED.
 *
 * A project is created one of three ways — schema.sql for a fresh database, the
 * config-defaults migration for one that already existed, and reset.sql when a
 * raffle ends and the next begins. Each seeds the numbering independently, and
 * for a while they disagreed: schema and the migration said four book digits,
 * reset said three. Whichever route a raffle happened to take decided whether
 * its books were called Book-0001 or Book-001, which is not something anybody
 * chose. The owner settled it on 2026-09-19 — four, and five for tickets — and
 * this is what stops it drifting again.
 *
 * WHY IT IS WORTH A FILE. Numbering is frozen by a database trigger the moment
 * the first ticket exists, so it cannot be corrected afterwards: it is printed
 * on paper in volunteers' hands, and the app's idea of it and the paper's must
 * match for the life of the raffle. The moment to catch a disagreement is
 * before anybody generates anything.
 *
 * Moved here from ticket-lab/, the standalone pilot, which checked the same
 * thing so that the numbers it printed matched the numbers the app stored.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(ROOT + f, 'utf8')

const SOURCES = [
  'supabase/schema.sql',
  'supabase/reset.sql',
  'supabase/migrations/20260917180000_config_defaults.sql',
]

/*
 * A seed is a tuple inside the config table's own insert:
 *
 *   insert into config (key, value, notes) values
 *     ('BOOK_DIGITS', '4', 'Zero padding, ...'),
 *
 * The insert block is found first and tuples are read only from inside it.
 * Matching tuples anywhere in the file does not work: the same schema holds a
 * trigger with the list of keys that lock once tickets exist —
 *
 *   if have_tickets and new.key in ('TICKET_PREFIX', 'TICKET_START', ...)
 *
 * — which has exactly the shape of a seed and would be read as TICKET_PREFIX
 * having the value "TICKET_START". Saying plainly what a seed IS beats listing
 * the things that are not one; the pilot found that out the hard way.
 */
/*
 * Comments come off first, and that is not tidiness.
 *
 * The block runs to its closing semicolon, and these files carry long
 * explanations between the rows — one of which contains a semicolon mid
 * sentence. Reading the raw text ended the block early, silently, and reported
 * that reset.sql seeds no BOOK_PREFIX at all. A parser that a piece of prose
 * can steer is worse than no parser, because it fails by finding LESS and
 * "nothing is wrong here" is what an absent seed looks like.
 *
 * Only comments that begin a line are removed, so a note containing two dashes
 * mid-string is left intact.
 */
const uncommented = (src) => src.replace(/^[ \t]*--.*$/gm, '')

const seedBlocks = (src) =>
  [...uncommented(src).matchAll(/insert\s+into\s+config\s*\([^)]*\)\s*values([\s\S]*?);/gi)]
    .map((m) => m[1])

const seedsOf = (src, key) => seedBlocks(src).flatMap((block) =>
  [...block.matchAll(new RegExp(`\\(\\s*'${key}'\\s*,\\s*'([^']*)'\\s*,`, 'g'))].map((m) => m[1]))

/*
 * The six the generator cannot do without. Absent or disagreeing, each one
 * produces a raffle numbered differently from the paper in somebody's hand.
 */
const KEYS = ['TICKET_PREFIX', 'TICKET_START', 'TICKET_DIGITS',
  'TICKETS_PER_BOOK', 'BOOK_PREFIX', 'BOOK_DIGITS']

console.log('every file that creates a raffle seeds the numbering')
const found = {}
for (const key of KEYS) found[key] = []
for (const file of SOURCES) {
  const src = read(file)
  ok(seedBlocks(src).length > 0, `${file} has a config insert`)
  for (const key of KEYS) {
    const values = seedsOf(src, key)
    eq(values.length, 1, `${file} seeds ${key} exactly once`)
    if (values.length) found[key].push({ file, value: values[0] })
  }
}

console.log('and they all say the same thing')
for (const key of KEYS) {
  const values = [...new Set(found[key].map((s) => s.value))]
  ok(values.length === 1,
    values.length === 1
      ? `${key} is ${JSON.stringify(values[0])} everywhere`
      : `${key} DISAGREES — ${found[key].map((s) => `${s.value} in ${s.file}`).join(', ')}`)
}

console.log('and it is what the owner settled on')
/*
 * Pinned by value, not merely "they agree". Three files agreeing on the wrong
 * number is still the wrong number, and these two are what every printed ticket
 * and every printed book label reads.
 */
{
  eq(found.TICKET_DIGITS[0]?.value, '5', 'a ticket is five digits — KS-00001')
  eq(found.BOOK_DIGITS[0]?.value, '4', 'a book is four — Book-0001')
  eq(found.TICKET_PREFIX[0]?.value, 'KS-', 'and a ticket number begins KS-')
  eq(found.BOOK_PREFIX[0]?.value, 'Book-', 'and a book number Book-')
  eq(found.TICKET_START[0]?.value, '1', 'the first ticket is number one')
  eq(found.TICKETS_PER_BOOK[0]?.value, '10', 'and a book holds ten')
}

console.log('the reset proves its own arithmetic against those numbers')
/*
 * reset.sql checks what it built before it commits. Those checks spell the
 * expected numbers out, so they are a fourth place the padding is written down
 * — and the one that would fail loudly at 2am rather than quietly at the press.
 */
{
  const reset = read('supabase/reset.sql')
  const digits = Number(found.TICKET_DIGITS[0]?.value ?? 5)
  const bookDigits = Number(found.BOOK_DIGITS[0]?.value ?? 4)
  const firstTicket = found.TICKET_PREFIX[0].value + '1'.padStart(digits, '0').replace(/1$/, '1')
  const firstBook = found.BOOK_PREFIX[0].value + String(1).padStart(bookDigits, '0')
  ok(reset.includes(`number = '${firstTicket}'`),
    `the reset checks its first ticket is ${firstTicket}`)
  ok(reset.includes(`number = '${firstBook}'`),
    `and its first book is ${firstBook}`)
}

console.log('the app builds a number the same way')
/*
 * Read out of the file rather than restated. The client and the function each
 * assemble a ticket number from these settings, and a change to HOW they do it
 * would not show up in any comparison of the seeds.
 */
{
  const books = read('src/lib/books.js')
  ok(books.includes("cfg.ticketPrefix + digits.padStart(cfg.ticketDigits, '0')"),
    'the app still builds a ticket number as prefix + zero-padded digits')
  ok(books.includes("cfg.bookPrefix + digits.padStart(cfg.bookDigits, '0')"),
    'and a book number the same way')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
