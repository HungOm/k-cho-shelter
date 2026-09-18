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

/**
 * Whatever somebody typed, turned into the exact ticket number stored in the
 * sheet — or null if it is not a real ticket.
 *
 * This matters more than it looks. It used to be copied into two components,
 * and the settlement screen is one of them: that is the list of tickets an
 * agent physically handed back, and anything NOT on it is counted as sold and
 * charged to them. A "KS-3" that fails to match KS-00003 does not error — it
 * quietly moves one ticket to the sold side and adds its price to what that
 * volunteer owes.
 *
 * The server canonicalises now too, so this is belt and braces. It costs
 * nothing and it keeps the screen honest about what it is about to send.
 */
export function resolveTicketNumber(raw) {
  const cfg = state.cfg
  if (!cfg) return null
  const text = String(raw ?? '').trim()
  if (!text) return null

  // Exactly as stored, or the same but for case.
  if (state.byNumber[text]) return text
  const upper = text.toUpperCase()
  if (state.byNumber[upper]) return upper

  const digits = text.replace(/\D/g, '')
  if (!digits) return null

  // The canonical form: prefix plus the number padded to its full width.
  const padded = cfg.ticketPrefix + digits.padStart(cfg.ticketDigits, '0')
  if (state.byNumber[padded]) return padded

  // Last resort, and only when it is unambiguous. Matching the first ticket
  // whose digits merely END with what was typed would resolve "13" to KS-00013
  // or KS-00113 depending on row order, which is exactly the kind of silent
  // wrong answer this function exists to prevent.
  const hits = state.tickets.filter(t => t.number.replace(/\D/g, '').endsWith(digits))
  return hits.length === 1 ? hits[0].number : null
}

/**
 * A typed range of ticket numbers, expanded into the tickets it names.
 *
 * WHY THIS EXISTS. The settlement screen tells you, in its own hint, that "this
 * book holds 3291–3300" — and then refused 3291–3300 as "not a ticket in this
 * raffle". It was showing a format it would not accept, which reads as the app
 * being broken rather than as a syntax it never had.
 *
 * WHAT COUNTS AS A SEPARATOR. A hyphen, an en dash, an em dash, or the word
 * "to". The en dash matters most: every range this app PRINTS uses one — see
 * `runsOf` below and the hint on the settle screen — so somebody copying the
 * format they were shown types an en dash, not a hyphen.
 *
 * THE TRAP, AND WHY THIS LOOKS HARDER THAN IT IS. The ticket prefix ends in a
 * hyphen. `KS-03291-KS-03300` therefore has three of them and only the middle
 * one is the range. So rather than guessing which character is the separator,
 * every candidate is TRIED and the first split whose two halves are both real
 * tickets wins. "KS" is not a ticket, so the first hyphen is discarded on its
 * own merits instead of by a rule about where prefixes end.
 *
 * REFUSED RATHER THAN TRIMMED when any number between the ends is not a ticket
 * in play. A range that quietly returned only the parts that exist would drop
 * the rest onto the SOLD side of a settlement and charge them to a volunteer,
 * which is the exact failure `resolveTicketNumber` was written to prevent. The
 * caller gets null and shows the range back unresolved.
 *
 * Returns the ticket numbers in order, or null if this is not a range at all.
 */
export function expandTicketRange(raw) {
  const cfg = state.cfg
  if (!cfg) return null
  const text = String(raw ?? '').trim()
  if (!text) return null

  const pre = cfg.ticketPrefix || ''
  const width = cfg.ticketDigits || 5

  for (const m of text.matchAll(/\s*(?:[-\u2010-\u2015]|\bto\b)\s*/gi)) {
    const left = text.slice(0, m.index).trim()
    const right = text.slice(m.index + m[0].length).trim()
    if (!left || !right) continue

    const a = resolveTicketNumber(left)
    const b = resolveTicketNumber(right)
    if (!a || !b) continue

    let lo = parseInt(a.slice(pre.length), 10)
    let hi = parseInt(b.slice(pre.length), 10)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    // Typed backwards is still a clear intention, so it is read rather than
    // refused — nobody means an empty range by "3300-3291".
    if (lo > hi) [lo, hi] = [hi, lo]

    /*
     * A CAP, because a slipped digit is the realistic input. "3291-33000" is
     * one keystroke away from a legitimate range and would otherwise build
     * thirty thousand entries, hang the screen and then fail anyway.
     */
    if (hi - lo + 1 > 1000) return null

    const out = []
    for (let n = lo; n <= hi; n++) {
      const number = pre + String(n).padStart(width, '0')
      // Held-back tickets are not loaded, so this is also what stops a range
      // running off the end of what is actually in play.
      if (!state.byNumber[number]) return null
      out.push(number)
    }
    return out
  }
  return null
}

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
 * "Pa Thang (Agent ID: A001)" — the same shape the server puts on a blocked
 * line, so the warning you get before sending and the refusal you get back
 * name the person the same way.
 */
export function holderLabel(book) {
  const id = book.agentId || ''
  const name = book.agentName || ''
  return (name && id) ? `${name} (Agent ID: ${id})` : (name || id)
}

/**
 * Inspects a typed range.
 *
 * @param from,to     whatever the person typed
 * @param isFree      what counts as available for this job
 * @returns { count, free, taken, missing, holders, message, nextRun }
 */
/**
 * WHAT COUNTS AS FREE TO HAND OUT, which is no longer just "in the office".
 *
 * A book that came back with nothing sold from it can go straight out again —
 * see issueBooks in books.ts, which reads the same condition off the ledger.
 * Until then it had to be counted in with a settlement declaring nought sold
 * and then restocked, which is two screens and a signed-off figure to move
 * paper that never left the desk.
 *
 * WITH SALES ON IT, NO, and this is the half that must not soften. Handing a
 * part-sold book to somebody else carries the first seller's money to the
 * second and takes their debt off the chase list with nobody deciding it.
 *
 * `sold` on a book row is counted_sold, which for a Returned book is the count
 * of tickets actually written down in it. Absent or nought means untouched.
 *
 * A COURTESY, like every other client-side rule here: the server decides, and
 * offering a book it would refuse is the wasted typing this exists to remove.
 */
/*
 * AND THE RULE APPLIES TO BOTH STATUSES, WHICH IT DID NOT.
 *
 * "With sales on it, no" was asked only of a RETURNED book, because when this
 * was written an Unassigned book could not have a sold ticket in it — nothing
 * put a book back without wiping it. Restocking does: it returns the unsold
 * tickets to the pool and every sold ticket KEEPS ITS BUYER, by design, so a
 * restocked book is Unassigned with sales in it.
 *
 * The result was a part-sold book counted among "1,000 books free" and offered
 * to a seller, who would be handed a book of ten with eight already gone. The
 * two that are left are sold at the desk, one at a time, which is what the Sell
 * screen is for.
 */
/*
 * AND "NONE SOLD" IS NOT THE SAME AS "ALL THERE".
 *
 * Asking only about sales let through a book with tickets RESERVED or VOIDED in
 * it — nothing sold, so nothing to carry to the wrong seller, but not a whole
 * book either. What a seller should be handed is ten tickets they can sell, and
 * the honest test of that is that every ticket in the book is Available.
 *
 * `available` is the count of Available tickets in the book, straight from the
 * ledger view. Compared against the configured book size rather than against
 * "not sold", so reserved, voided and any status invented later all fail it
 * without this line having to learn their names.
 */
export const isFreeToIssue = (b) => {
  const per = Number(state.cfg?.ticketsPerBook || 0)
  if (!per) return false          // no config yet: offer nothing rather than everything
  return Number(b?.available ?? -1) === per &&
    (b?.status === 'Unassigned' || b?.status === 'Returned')
}

export function inspectRange(from, to, isFree = isFreeToIssue) {
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
    const who = holderLabel(book)
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

/**
 * Every unbroken run of free books.
 *
 * Deliberately runs and not numbers. Roughly 1,780 of 2,000 books are free at
 * the start, and a list of 1,780 numbers tells nobody anything. Four runs tell
 * them everything, and a run is also how books are actually handed over — one
 * unbroken stretch to one person.
 *
 * "Free" is isFreeToIssue: in the office, or handed back with nothing sold from
 * it. A Settled book is not — its figures are declared and its money
 * reconciled, so it is restocked rather than re-issued — and neither is a
 * Returned book with sales on it, which has to be counted in first. Offering
 * either here would produce a refusal at save time, which is exactly the wasted
 * typing this is meant to remove.
 */
export function freeRuns(isFree = isFreeToIssue) {
  if (!state.books.length) return { runs: [], total: 0 }
  const sorted = [...state.books].sort((x, y) => num(x.book) - num(y.book))
  const runs = []
  let start = null, prev = null, total = 0

  for (const book of sorted) {
    const n = num(book.book)
    if (isFree(book)) {
      total++
      if (start === null) { start = prev = n; continue }
      if (n === prev + 1) { prev = n; continue }
      runs.push({ from: start, to: prev, count: prev - start + 1 })
      start = prev = n
    } else if (start !== null) {
      runs.push({ from: start, to: prev, count: prev - start + 1 })
      start = prev = null
    }
  }
  if (start !== null) runs.push({ from: start, to: prev, count: prev - start + 1 })
  return { runs, total }
}

/** "1–30", or just "77" when the run is a single book. */
export function runLabel(r) {
  return r.from === r.to ? String(r.from) : `${r.from}–${r.to}`
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
