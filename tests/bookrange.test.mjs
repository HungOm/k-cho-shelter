/**
 * Resolving a typed book range against what is already loaded.
 *
 * This is what stops somebody typing 300–320, waiting for a save, and only then
 * being told the books are out. Every answer here is computed locally.
 */
// The store is a browser module; give it the globals it touches at import time.
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}
// Deliberately no `document`: Vue's DOM runtime short-circuits when there is
// none, but a half-built stub makes it try to use it and fail at import.

const { state } = await import('../src/lib/store.js')
const { inspectRange, bookNumber, describeRuns } = await import('../src/lib/books.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

state.cfg = { bookPrefix: 'Book-', bookDigits: 3, ticketsPerBook: 10, ticketPrice: 10, currency: 'RM' }
// 20 books: 1–5 out with JOHN, 6–8 out with MARY, 9–20 free
state.books = []
for (let i = 1; i <= 20; i++) {
  const out = i <= 8
  state.books.push({
    book: 'Book-' + String(i).padStart(3, '0'),
    status: out ? 'Out' : 'Unassigned',
    agentId: out ? (i <= 5 ? 'A001' : 'A002') : '',
    agentName: out ? (i <= 5 ? 'JOHN' : 'MARY') : '',
    available: out ? 4 : 10
  })
}

console.log('reading a typed number')
eq(bookNumber('31'), 'Book-031', 'pads')
eq(bookNumber('Book-031'), 'Book-031', 'accepts the full form')
eq(bookNumber(''), '', 'empty stays empty')

console.log('describing runs readably')
eq(describeRuns([1, 2, 3]), '1–3', 'one run')
eq(describeRuns([1, 2, 3, 7, 8]), '1–3 and 7–8', 'two runs')
eq(describeRuns([5]), '5', 'single number')
eq(describeRuns([1, 3, 5]), '1, 3 and 5', 'three singles')

console.log('a clean range')
{
  const r = inspectRange('9', '20')
  ok(r.allFree, 'all free')
  eq(r.count, 12, '12 books')
  eq(r.taken.length, 0, 'nothing taken')
  eq(r.message, '', 'nothing to warn about')
}

console.log('a range that overlaps books already out')
{
  const r = inspectRange('1', '12')
  ok(!r.allFree, 'not clean')
  ok(!r.noneFree, 'some are free')
  eq(r.freeCount, 4, '4 free (9–12)')
  ok(r.message.includes('1–8'), 'names the taken run')
  ok(r.message.includes('JOHN') && r.message.includes('MARY'), 'names both holders')
  ok(r.message.includes('4 of 12 are free'), 'says how many are left')
}

console.log('a range entirely taken')
{
  const r = inspectRange('1', '5')
  ok(r.noneFree, 'none free — save must be blocked')
  ok(r.message.includes('JOHN'), 'names who has them')
  ok(r.message.includes('None of them are free'), 'says so plainly')
}

console.log('a book that does not exist')
{
  const r = inspectRange('19', '22')
  eq(r.missing.length, 2, '21 and 22 do not exist')
  ok(r.message.includes('do not exist'), 'says so rather than counting them free')
  ok(!r.allFree, 'a typo past the end is never "clean"')
  const solo = inspectRange('3000', '')
  eq(solo.missing.length, 1, 'a single bad number')
  ok(solo.message.includes('does not exist'), 'singular wording')
}

console.log('suggesting where to go instead')
{
  const r = inspectRange('1', '5')
  ok(r.nextRun, 'offers somewhere')
  eq(r.nextRun.from, 9, 'first free block starts at 9')
  eq(r.nextRun.to, 13, 'and is the size asked for')
  ok(!r.nextRun.short, 'a full run was available')
}
{
  // Ask for more than exists free: offer the biggest block instead of nothing.
  const r = inspectRange('1', '20')
  ok(r.nextRun.short, 'flagged as smaller than asked')
  eq(r.nextRun.available, 12, '12 free in a row')
  eq(r.nextRun.from, 9, 'starting at 9')
}

console.log('a single book')
{
  eq(inspectRange('9', '').count, 1, 'empty "to" means one book')
  ok(inspectRange('9', '').allFree, 'and it is free')
  ok(inspectRange('1', '').noneFree, 'or it is not')
}

console.log('reversed and messy input')
{
  const r = inspectRange('20', '9')
  eq(r.count, 12, 'reversed range is read the right way round')
  ok(r.allFree, 'and resolved correctly')
  eq(inspectRange('', ''), null, 'nothing typed yet is not an error')
  eq(inspectRange('abc', ''), null, 'letters alone are not a range')
}

console.log('what counts as free depends on the job')
{
  // Transferring only makes sense for books that are out.
  const out = b => b.status === 'Out'
  const r = inspectRange('1', '12', out)
  eq(r.freeCount, 8, '8 are out and can be moved')
  ok(!r.noneFree, 'so it is allowed')
  const none = inspectRange('9', '20', out)
  ok(none.noneFree, 'none of the shelf books can be transferred')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
