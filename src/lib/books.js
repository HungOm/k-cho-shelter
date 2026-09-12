/**
 * Working out what a typed book range actually contains, locally.
 *
 * Every book's status and holder is already loaded, so the answer to "are books
 * 300 to 320 free?" needs no round trip. Telling somebody after they press Save
 * — and after waiting for it — is the worst moment to find out.
 */

import { state } from './store.js'

/** "31" or "Book-031" or "31 " -> the padded book number, or '' if unusable. */
export function bookNumber(raw) {
  const cfg = state.cfg
  if (!cfg) return ''
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return cfg.bookPrefix + digits.padStart(cfg.bookDigits, '0')
}

const num = b => parseInt(String(b).replace(/\D/g, ''), 10)

/** Turns [1,2,3,7,8] into "1–3 and 7–8" — a list of numbers is unreadable. */
export function describeRuns(numbers) {
  if (!numbers.length) return ''
  const sorted = [...numbers].sort((a, b) => a - b)
  const runs = []
  let start = sorted[0], prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) { prev = n; continue }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = prev = n
  }
  const parts = runs.filter(Boolean)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts.join(' and ')
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

/**
 * Inspects a typed range.
 *
 * @param from,to     whatever the person typed
 * @param isFree      what counts as available for this job
 * @returns { count, free, taken, missing, holders, message, nextRun }
 */
export function inspectRange(from, to, isFree = b => b.status === 'Unassigned') {
  const cfg = state.cfg
  const a = parseInt(String(from ?? '').replace(/\D/g, ''), 10)
  const bRaw = String(to ?? '').replace(/\D/g, '')
  const b = bRaw ? parseInt(bRaw, 10) : a
  if (!cfg || isNaN(a)) return null

  const lo = Math.min(a, isNaN(b) ? a : b)
  const hi = Math.max(a, isNaN(b) ? a : b)
  const count = hi - lo + 1
  if (count < 1) return null

  const byNumber = new Map(state.books.map(x => [num(x.book), x]))

  const free = [], taken = [], missing = []
  const holders = new Map()

  for (let n = lo; n <= hi; n++) {
    const book = byNumber.get(n)
    // A number outside the raffle is blocked, never silently free — typing
    // 3000 into a 2,000-book raffle must not read as "available".
    if (!book) { missing.push(n); continue }
    if (isFree(book)) { free.push(n); continue }
    taken.push(n)
    const who = book.agentName || book.agentId || ''
    if (who) holders.set(who, (holders.get(who) || 0) + 1)
  }

  return {
    count,
    lo, hi,
    free, taken, missing,
    freeCount: free.length,
    holders: [...holders.keys()],
    allFree: taken.length === 0 && missing.length === 0,
    noneFree: free.length === 0,
    message: buildMessage(taken, missing, free, holders, count),
    nextRun: nextFreeRun(count, isFree)
  }
}

function buildMessage(taken, missing, free, holders, count) {
  const parts = []
  if (missing.length) {
    parts.push(`Book${missing.length === 1 ? '' : 's'} ${describeRuns(missing)} ` +
      `${missing.length === 1 ? 'does' : 'do'} not exist.`)
  }
  if (taken.length) {
    const who = [...holders.keys()]
    const withWhom = who.length === 1 ? ` with ${who[0]}`
      : who.length === 2 ? ` with ${who[0]} and ${who[1]}`
      : who.length > 2 ? ` with ${who.length} different people`
      : ''
    parts.push(`Book${taken.length === 1 ? '' : 's'} ${describeRuns(taken)} ` +
      `${taken.length === 1 ? 'is' : 'are'} already out${withWhom}.`)
  }
  if (parts.length && free.length) parts.push(`${free.length} of ${count} are free.`)
  else if (parts.length) parts.push('None of them are free.')
  return parts.join(' ')
}

/** The first run of this many consecutive free books, so nobody has to guess. */
export function nextFreeRun(size, isFree = b => b.status === 'Unassigned') {
  if (!size || !state.books.length) return null
  const sorted = [...state.books].sort((x, y) => num(x.book) - num(y.book))
  let start = null, run = 0
  for (const book of sorted) {
    if (isFree(book)) {
      if (start === null) start = num(book.book)
      run++
      if (run >= size) return { from: start, to: start + size - 1 }
    } else {
      start = null; run = 0
    }
  }
  // Nowhere holds the whole run — offer the longest block there is instead.
  let bestStart = null, best = 0
  start = null; run = 0
  for (const book of sorted) {
    if (isFree(book)) {
      if (start === null) start = num(book.book)
      run++
      if (run > best) { best = run; bestStart = start }
    } else { start = null; run = 0 }
  }
  return best ? { from: bestStart, to: bestStart + best - 1, short: true, available: best } : null
}
