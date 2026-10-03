/**
 * The search index.
 *
 * Built once in the browser and queried on every keystroke, so it has to work
 * on six thousand rows without a server round trip.
 *
 * Spelling tolerance is not a nicety here. K'Cho and Burmese names transliterate
 * inconsistently — Thang/Thuang, Za/Zaa, Cung/Chung. Exact matching fails
 * constantly, the helper decides the person is not in the system, and records a
 * duplicate.
 */

/** Case, accents and punctuation removed, so spellings can be compared. */
export function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['’\-.]/g, '').replace(/\s+/g, ' ').trim()
}

/** Digits only, with a Malaysian +60 normalised back to a leading 0. */
export function phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '')
  if (d.startsWith('60') && d.length > 9) d = '0' + d.slice(2)
  return d
}

/** Phone in the form WhatsApp wants: country code, no plus, no leading zero. */
/**
 * The wa.me form: digits, with a local leading 0 replaced by the country code.
 *
 * MALAYSIA IS HARDCODED, and under the name Raffled that is now a limitation
 * rather than a fact. It is correct for this raffle and silently wrong for any
 * other: a Myanmar local number 09 123 456 789 comes out as 609123456789, and
 * an Indonesian 081-234-5678 as 60812345678 — both real, dialable Malaysian
 * numbers belonging to somebody else. The chase button would then open WhatsApp
 * to a stranger with a message naming a seller and what they owe.
 *
 * Not changed here on purpose. The live raffle depends on this behaviour, so
 * the country belongs in config the way the logo and the colour now are, and
 * the value has to exist on both backends before the code stops assuming it.
 * Until then this is pinned by tests so it cannot drift, and written down so
 * the next deployment does not discover it by ringing the wrong person.
 */
/**
 * Whether we know enough about this number to offer to dial it.
 *
 * Absent was handled; UNUSABLE was not, and the two look identical to whoever
 * presses the button. The live raffle has four sellers whose numbers lost their
 * leading zero — almost certainly a spreadsheet storing a phone as a number —
 * so 0123367462 is stored as 123367462. That does not start with 0, nothing is
 * prepended, and wa.me/123367462 reads as country code 1: the chase message,
 * naming a seller and what they owe, goes to North America or nowhere.
 *
 * So the rule is about CONFIDENCE, not validity. A number written in full with
 * a +, or in local form with a leading 0, or already carrying this raffle's
 * country code, we can act on. Anything else is a number whose country we are
 * guessing at, and a guess that produces a working-looking link is worse than
 * no link — the second sends somebody to check, the first sends a stranger a
 * stranger's debt.
 *
 * The 60 here is the same assumption waNumber makes and moves to config with
 * it; the shape of this function does not change when it does.
 */
export function isDialable(phone) {
  const raw = String(phone || '').trim()
  const d = raw.replace(/\D/g, '')
  if (d.length < 8) return false
  if (raw.startsWith('+')) return true
  if (d.startsWith('0')) return true
  if (d.startsWith('60')) return true
  return false
}

export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '60' + d.slice(1)
  return d
}

/**
 * Bounded edit distance — catches a one or two letter difference, and bails
 * early so it stays cheap across thousands of rows.
 */
export function closeEnough(a, b) {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 2) return false
  if (a.length < 4 || b.length < 4) return false
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > 2) return false
    prev = cur
  }
  return prev[n] <= 2
}

export function buildIndex(tickets, agentMap, bookHolders = {}) {
  return tickets.map(t => {
    const digits = t.number.replace(/\D/g, '')
    const name = fold(t.name)
    const held = bookHolders[t.book.toUpperCase()] || null
    return {
      // Who is holding the book this ticket is in — separate from who sold it.
      // Searching a seller's name must find their whole stock, not only the
      // part they have already sold.
      held,
      holderName: fold(held?.agentName || ''),
      isOut: !!held?.out,
      t,
      digits,
      name,
      nameTokens: name.split(' ').filter(Boolean),
      phone: phoneDigits(t.phone),
      book: t.book.toUpperCase(),
      // Folded too, because fold() strips the hyphen: a search for "Book-003"
      // becomes "book003" and would never match the raw "BOOK-003".
      bookFolded: fold(t.book),
      numFolded: fold(t.number),
      agentName: fold(agentMap[t.agent]?.name || ''),
      zone: fold(t.zone)
    }
  })
}

/** "Book-031..045", "book 3 to 9" — a range of books in one query. */
// WHY `bare` WAS ADDED: on the ticket Find screen "3291-3300" is a ticket range
// and must NOT be read as books, so the word "book" stays required there (the
// default, unchanged). On the Books screen everything typed is about books, and
// making somebody write "book 31-45" to find books 31 to 45 is a rule for the
// other screen. Only a range with NO letters at all is accepted bare: "KS-03291-
// KS-03300" has letters, so it is still not a book range even there.
export function parseBookRange(raw, { bare = false } = {}) {
  const m = raw.match(/^\s*([A-Za-z-]*)\s*(\d+)\s*(?:\.\.|–|-|to)\s*([A-Za-z-]*)\s*(\d+)\s*$/i)
  if (!m) return null
  // WAS: if (!/book|b$/i.test((m[1] || m[3] || '').trim())) return null
  const label = (m[1] || m[3] || '').trim()
  if (label ? !/book|b$/i.test(label) : !bare) return null
  return [parseInt(m[2], 10), parseInt(m[4], 10)].sort((a, b) => a - b)
}

/**
 * Scores an index entry against a query. Higher is a better match; 0 means no
 * match at all.
 */
export function scoreEntry(e, q, qDigits, bookRange) {
  if (bookRange) {
    const bn = parseInt(e.book.replace(/\D/g, ''), 10)
    return bn >= bookRange[0] && bn <= bookRange[1] ? 90 : 0
  }

  if (/[a-z]/.test(q)) {
    // A query with letters is a name, a book, or a whole ticket number — never
    // a bare digit lookup. Letting it fall through to the digit rules is what
    // made "Book-003" return ticket 0003 alongside the book's ten tickets.
    if (e.numFolded === q) return 100
    if (e.bookFolded === q) return 95
    if (e.numFolded.startsWith(q)) return 88
    if (e.bookFolded.includes(q)) return 86
  } else {
    // Trailing-digit lookup: people remember "it ends in 721".
    if (qDigits && e.digits.endsWith(qDigits)) return qDigits.length >= e.digits.length ? 100 : 80
    if (qDigits && qDigits.length >= 5 && e.phone && e.phone.includes(qDigits)) return 85
  }

  if (!q) return 0
  if (e.name && e.name.includes(q)) return 60
  if (e.agentName && e.agentName.includes(q)) return 40
  if (e.holderName && e.holderName.includes(q)) return 38
  if (e.zone && e.zone.includes(q)) return 30
  if (q.length >= 4 && e.nameTokens.some(tok => closeEnough(tok, q))) return 25
  return 0
}

export function runSearch(index, { query = '', status = '', agent = '', where = '', limit = 300 } = {}) {
  const raw = query.trim()
  const q = fold(raw)
  const qDigits = raw.replace(/\D/g, '')
  const bookRange = parseBookRange(raw)

  const hits = []
  for (const e of index) {
    if (status && e.t.status !== status) continue
    // An agent filter means "anything to do with this person": tickets they
    // sold, and tickets sitting in books they are holding.
    if (agent && e.t.agent !== agent && e.held?.agentId !== agent) continue
    if (where === 'out' && !e.isOut) continue
    if (where === 'office' && e.isOut) continue
    if (!q && !bookRange) {
      hits.push({ e, score: 1 })
      if (hits.length > 600) break
      continue
    }
    const score = scoreEntry(e, q, qDigits, bookRange)
    if (score) hits.push({ e, score })
  }

  hits.sort((a, b) => b.score - a.score || a.e.t.number.localeCompare(b.e.t.number))
  return { total: hits.length, results: hits.slice(0, limit).map(h => h.e.t) }
}

/*
 * ================= BOOKS =================
 *
 * THE SAME SEARCH, OVER BOOKS. Tickets were the only thing that could be found:
 * the Books screen had a status chip and a seller menu and nothing to type into,
 * and Find drew a book's ten tickets for "Book-003" but never the book. So this
 * reuses what is already here rather than growing a second idea of matching:
 * the same fold(), the same closeEnough() spelling tolerance for a seller's name
 * (Thang/Thuang), the same range syntax, and the same { total, results } shape
 * runSearch returns, so a screen can treat the two alike.
 *
 * WHAT A PERSON TYPES, and what each reads as:
 *   31, 031, book 31, Book-0031   the book with that number (exactly)
 *   31-45, book 31 to 45          a run of books (see parseBookRange `bare`)
 *   KS-03291, or all five digits  the book that ticket is printed in
 *   Pa Thang, A001                books held by, or offered to, that seller
 *   a bare few digits             also books whose number ENDS that way ("it
 *                                 ends in 31") — `tail`, below
 *
 * A book row carries what this needs already: book, firstTicket, lastTicket,
 * agentId, agentName, offeredTo, status. Nothing new is fetched.
 */
const bookNo = (s) => parseInt(String(s ?? '').replace(/\D/g, ''), 10)

/**
 * Scores one book against a query. Higher is better; 0 is no match.
 * `ctx` is built once per search in searchBooks, not per book.
 */
export function scoreBook(b, ctx) {
  const { q, qDigits, range, asBook, tail, agents } = ctx
  const n = bookNo(b.book)

  if (range) return n >= range[0] && n <= range[1] ? 90 : 0
  if (asBook) return n === parseInt(asBook[1], 10) ? 100 : 0

  const first = bookNo(b.firstTicket)
  const last = bookNo(b.lastTicket)
  // The width the ticket numbers are printed to (5 for KS-00001), read off the
  // book itself so this needs no config and cannot disagree with the raffle.
  const width = (String(b.firstTicket ?? '').match(/\d+$/) || [''])[0].length
  const prefix = fold(String(b.firstTicket ?? '').replace(/\d+$/, ''))

  if (!/[a-z]/.test(q)) {
    if (!qDigits) return 0
    const want = parseInt(qDigits, 10)
    // A WHOLE ticket number names its book, and is checked BEFORE the exact book
    // number: "00131" is five digits, the width tickets are printed to, so it is
    // unmistakably ticket 131 (in book 14) and not book 131, which would be
    // written to the book width. Anything shorter is ambiguous between the two
    // and the book wins below. 101 so it outranks an exact book number (100).
    if (width && qDigits.length >= width && want >= first && want <= last) return 101
    if (n === want) return 100
    if (tail && want > 0 && String(n).endsWith(String(want))) return 80
    // A SHORTER NUMBER THAT IS NO BOOK, BUT IS A TICKET. "3291" is not one of
    // 2,000 books, and it is not five digits either, so neither rule above
    // takes it — and it is exactly how somebody reads a number off a ticket.
    // Where a book of that number exists the book still wins (above), so this
    // only ever fills a silence. Below the book matches; above name matches.
    if (want >= first && want <= last && !ctx.bookNums?.has(want)) return 70
    return 0
  }

  // "KS-03291": the ticket prefix and a number, so it is a ticket, not a name.
  if (prefix && q.startsWith(prefix) && qDigits) {
    const want = parseInt(qDigits, 10)
    if (want >= first && want <= last) return 101
  }

  const holder = fold(b.agentName)
  if (holder && holder.includes(q)) return 60
  // The seller's ID as typed ("A001"), which is how an organiser says it on the phone.
  if (b.agentId && fold(b.agentId) === q) return 58
  // An offered book has no holder yet; it is waiting on somebody, and that is who
  // a person looking for "Pa Thang's books" also means.
  const offered = fold(agents?.[b.offeredTo]?.name)
  if (offered && offered.includes(q)) return 50
  if (q.length >= 4 && holder.split(' ').some((tok) => closeEnough(tok, q))) return 25
  return 0
}

export function searchBooks(books, {
  query = '', status = '', agent = '', where = '', agents = {}, tail = true, limit = Infinity,
} = {}) {
  const raw = String(query ?? '').trim()
  const q = fold(raw)
  const ctx = {
    q,
    qDigits: raw.replace(/\D/g, ''),
    range: parseBookRange(raw, { bare: true }),
    asBook: raw.match(/^\s*b(?:ook)?[\s-]*0*(\d+)\s*$/i),
    tail,
    agents,
    bookNums: new Set(books.map((b) => bookNo(b.book))),
  }
  const plain = !q && !ctx.range

  const hits = []
  for (const b of books) {
    if (status && b.status !== status) continue
    // "Anything to do with this person", as for tickets: books they hold, and
    // books that are waiting on them to accept.
    if (agent && b.agentId !== agent && b.offeredTo !== agent) continue
    if (where === 'out' && b.status !== 'Out') continue
    if (where === 'office' && b.status === 'Out') continue
    const score = plain ? 1 : scoreBook(b, ctx)
    if (score) hits.push({ b, score })
  }

  hits.sort((x, y) => y.score - x.score || bookNo(x.b.book) - bookNo(y.b.book))
  return { total: hits.length, results: hits.slice(0, limit).map((h) => h.b) }
}

/**
 * "Which book is this ticket in?" — answered from the book list alone.
 *
 * Every book row carries its first and last ticket, so the answer needs no
 * ticket data and works before the tickets have loaded. Returns
 * { ticket, book } or null, where `ticket` is the number as it is printed
 * (KS-03291) and `book` is the row to open.
 *
 * WHAT COUNTS AS A TICKET, and the same rules scoreBook uses so the grid and
 * this line never disagree:
 *   KS-03291, ks 3291    the prefix and a number, always a ticket
 *   03291                every digit of it (the printed width): a ticket
 *   3291                 fewer digits: a ticket ONLY if no book has that
 *                        number, since a book wins an ambiguous one
 * A run (31-45) or "book 31" is about books and is never a ticket.
 */
export function ticketBookOf(books, query) {
  const raw = String(query ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (!digits || !books?.length) return null
  if (parseBookRange(raw, { bare: true }) || /^\s*b(?:ook)?[\s-]*\d+\s*$/i.test(raw)) return null

  const want = parseInt(digits, 10)
  const sample = String(books[0].firstTicket ?? '')
  const width = (sample.match(/\d+$/) || [''])[0].length
  const prefix = sample.replace(/\d+$/, '')
  const q = fold(raw)

  if (/[a-z]/.test(q)) {
    const p = fold(prefix)
    if (!p || !q.startsWith(p) || !/^\s*\d+$/.test(q.slice(p.length))) return null
  } else if (digits.length < width && books.some((b) => bookNo(b.book) === want)) {
    return null
  }

  const book = books.find((b) => want >= bookNo(b.firstTicket) && want <= bookNo(b.lastTicket))
  if (!book) return null
  return { ticket: prefix + String(want).padStart(width, '0'), book }
}
