/*
 * Typing a run of ticket numbers instead of every one of them.
 *
 * WHY THIS IS WORTH ITS OWN FILE. The settlement screen's hint says "this book
 * holds 3291–3300" and the box beside it refused 3291–3300 as "not a ticket in
 * this raffle" — it was showing a format it would not accept. But the reason
 * this is tested hard rather than merely fixed is what the box IS: the list of
 * tickets a seller physically handed back, where anything NOT on it counts as
 * sold and is charged to them.
 *
 * So the dangerous failure is not a rejected range. It is a range that is
 * ACCEPTED and quietly expands to fewer tickets than the person meant, because
 * every ticket it drops moves to the sold side and adds its price to what a
 * volunteer owes. Every case below is aimed at that.
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}

const { state } = await import('../src/lib/store.js')
const { expandTicketRange, resolveTicketNumber } = await import('../src/lib/books.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

state.cfg = {
  ticketPrefix: 'KS-', ticketDigits: 5, ticketsPerBook: 10,
  bookPrefix: 'Book-', bookDigits: 3, ticketPrice: 10, currency: 'RM',
}

/*
 * Tickets 3291–3310, which is Book-330 and Book-331 — the two books in the
 * screenshot this came from. 3311 onwards is deliberately NOT created: those
 * are the held-back tickets, and a range must not run into them.
 */
state.tickets = []
for (let n = 3291; n <= 3310; n++) {
  state.tickets.push({
    number: 'KS-' + String(n).padStart(5, '0'),
    book: 'Book-' + String(n <= 3300 ? 330 : 331).padStart(3, '0'),
    status: 'Available', name: '', phone: '', source: '', version: 1,
  })
}
state.byNumber = Object.fromEntries(state.tickets.map(t => [t.number, t]))

const nums = r => (r ? r.map(n => n.replace(/\D/g, '').replace(/^0+/, '')).join(',') : String(r))

console.log('1. the format the screen itself prints')
{
  // The hint says "This book holds 3291–3300" with an EN DASH, so that is what
  // somebody copying it types. This is the exact string from the screenshot.
  const r = expandTicketRange('3291–3300')
  ok(!!r, 'an en-dash range is a range')
  eq(r?.length, 10, 'it names ten tickets')
  eq(r?.[0], 'KS-03291', 'starting at the first')
  eq(r?.[9], 'KS-03300', 'and ending at the last')
}

console.log('2. the other ways people write a run')
{
  eq(nums(expandTicketRange('3291-3300')), nums(expandTicketRange('3291–3300')), 'a hyphen means the same')
  eq(nums(expandTicketRange('3291—3300')), nums(expandTicketRange('3291–3300')), 'an em dash too')
  eq(nums(expandTicketRange('3291 - 3300')), nums(expandTicketRange('3291–3300')), 'spaces around it are fine')
  eq(nums(expandTicketRange('3291 to 3300')), nums(expandTicketRange('3291–3300')), 'and the word "to"')
  // Typed backwards is a clear intention, not an empty range.
  eq(nums(expandTicketRange('3300-3291')), nums(expandTicketRange('3291–3300')), 'backwards reads the same')
}

console.log('3. the prefix has a hyphen in it, which is the whole difficulty')
{
  /*
   * KS-03291-KS-03300 contains THREE hyphens and only the middle one is the
   * range. Splitting on the first would ask whether "KS" is a ticket.
   */
  eq(nums(expandTicketRange('KS-03291-KS-03300')), '3291,3292,3293,3294,3295,3296,3297,3298,3299,3300',
     'a fully-written range splits at the right hyphen')
  eq(nums(expandTicketRange('KS-03291–KS-03300')), nums(expandTicketRange('3291–3300')),
     'and with an en dash between them')
  eq(nums(expandTicketRange('KS-03291 to KS-03300')), nums(expandTicketRange('3291–3300')),
     'and spelled out')
}

console.log('4. what is not a range is left alone')
{
  ok(expandTicketRange('3291') === null, 'a single number is not a range')
  ok(expandTicketRange('KS-03291') === null, 'nor is a single written-out ticket')
  ok(expandTicketRange('') === null, 'nor is nothing')
  ok(expandTicketRange('   ') === null, 'nor is whitespace')
  ok(expandTicketRange('-3291') === null, 'a leading dash names no start')
  ok(expandTicketRange('3291-') === null, 'and a trailing one no end')
  ok(expandTicketRange('nonsense-rubbish') === null, 'and words are not tickets')
}

console.log('5. A RANGE IS NEVER TRIMMED TO THE PART THAT EXISTS')
{
  /*
   * THE ASSERTION THIS FILE IS FOR. 3311 onwards is held back and not in play.
   * A range that returned only 3291–3310 would put ten tickets nobody mentioned
   * onto the SOLD side of a settlement and charge them to a volunteer — the
   * exact failure resolveTicketNumber was written to prevent, arriving through
   * a different door.
   */
  ok(expandTicketRange('3291–3320') === null,
     'a range running past what is in play is refused whole, not trimmed')
  ok(expandTicketRange('3305–3400') === null, 'however far past it goes')
  ok(expandTicketRange('1–3300') === null, 'and one that starts before the first ticket')

  // And the refusal is not a quiet empty list, which a caller could treat as
  // "no tickets came back" and charge the seller for the lot.
  const r = expandTicketRange('3291–3320')
  ok(r === null && !Array.isArray(r), 'it is null rather than an empty array')
}

console.log('6. a slipped digit cannot build thirty thousand entries')
{
  // "3291-33000" is one keystroke from a real range. Without a cap it expands,
  // hangs the screen, and fails anyway.
  const started = Date.now()
  ok(expandTicketRange('3291-33000') === null, 'an implausibly long range is refused')
  ok(Date.now() - started < 500, 'and refused promptly rather than by grinding through it')
}

console.log('7. it spans books, so the screen can say which are not this one')
{
  /*
   * Deliberately NOT refused here. 3291–3310 crosses from Book-330 into
   * Book-331, and this function's job is to say which tickets were named — the
   * settle screen then reports the strays by name, the same way it always has
   * for a single number from another book. Refusing here would make the
   * message "not a ticket in this raffle", which is false and unhelpful.
   */
  const r = expandTicketRange('3291–3310')
  eq(r?.length, 20, 'a range across two books names all twenty')
  const books = new Set(r.map(n => state.byNumber[n].book))
  eq([...books].sort().join(','), 'Book-330,Book-331', 'and they really are two books')
}

console.log('8. it agrees with the resolver it is built on')
{
  // Every number a range produces has to be one resolveTicketNumber would
  // accept on its own, or the two disagree about what a ticket is.
  const r = expandTicketRange('3291–3300')
  ok(r.every(n => resolveTicketNumber(n) === n), 'every number resolves to itself')
  ok(r.every(n => state.byNumber[n]), 'and every one is a loaded ticket')
}

console.log('9. nothing is assumed about the prefix or the padding')
{
  // A raffle with no prefix and three digits is a legitimate setup, and the
  // range must not be built from this raffle's shape.
  const keep = { cfg: state.cfg, tickets: state.tickets, byNumber: state.byNumber }
  state.cfg = { ...keep.cfg, ticketPrefix: '', ticketDigits: 3 }
  state.tickets = []
  for (let n = 100; n <= 110; n++) {
    state.tickets.push({ number: String(n), book: 'Book-010', status: 'Available', name: '', phone: '' })
  }
  state.byNumber = Object.fromEntries(state.tickets.map(t => [t.number, t]))

  const r = expandTicketRange('101–104')
  eq(r?.join(','), '101,102,103,104', 'a prefixless raffle ranges the same way')
  ok(expandTicketRange('105–120') === null, 'and still refuses running past the end')

  Object.assign(state, keep)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
