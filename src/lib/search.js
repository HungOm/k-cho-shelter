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
export function parseBookRange(raw) {
  const m = raw.match(/^\s*([A-Za-z-]*)\s*(\d+)\s*(?:\.\.|–|-|to)\s*([A-Za-z-]*)\s*(\d+)\s*$/i)
  if (!m) return null
  if (!/book|b$/i.test((m[1] || m[3] || '').trim())) return null
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
