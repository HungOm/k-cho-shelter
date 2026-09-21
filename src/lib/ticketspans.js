/**
 * WHAT ONE BUYER HOLDS, SAID IN AS FEW WORDS AS IT IS TRUE IN.
 *
 * A digital ticket is not a picture of one printed ticket. It is the buyer's
 * own artefact: one per buyer, covering everything they hold, behind one QR.
 * So something has to turn "these forty-one ticket numbers" into a line a
 * person reads — `Book-0001 · Book-0002 · KS-00047 – KS-00052 · +3 more` —
 * and it has to be the SAME something everywhere, or the card, the check page
 * and the WhatsApp message will describe one purchase three different ways and
 * the buyer will count them.
 *
 * THE RULE THAT MATTERS, AND IT IS NOT THE ONE IT LOOKS LIKE.
 *
 * "Ten consecutive numbers is a book" is nearly right and fails in the case
 * that costs money. With books of ten, a buyer holding KS-00006 … KS-00015
 * holds ten consecutive numbers and NO book: that is the back half of
 * Book-0001 and the front half of Book-0002, and at the office those
 * counterfoils are in two different books. Meanwhile a raffle's last book may
 * hold six tickets, and holding all six IS a book.
 *
 * So the count never decides it. A set is a book when it contains EVERY ticket
 * that book contains — which is a fact this app already stores, because
 * `tickets.book_idx` is a column and `books` carries its own first and last.
 * Nothing here infers a book from arithmetic on numbers.
 *
 * WHAT A NUMBER IS, WITHOUT BEING TOLD.
 *
 * Adjacency needs an integer, and ticket numbers are a prefix and a padded
 * figure. Rather than being handed the raffle's prefix — a second copy of a
 * fact, and one that a caller can pass wrongly — a number is split into its
 * trailing run of digits and everything before it. Two numbers may be merged
 * only when the part before the digits is identical, the digits are the same
 * WIDTH, and the values differ by one.
 *
 * That is deliberately a rule about what MAY merge rather than what may not.
 * A number this file cannot read stands alone; a raffle that changed its
 * prefix stops merging across the change instead of silently spanning it.
 * "Everything except X" is the shape supabase/AUDIT.md §X names after three
 * defects in one day, and a span is exactly where it would hurt — a line
 * reading `KS-00001 – KS-00500` on a card for somebody holding two tickets.
 */

/**
 * A ticket number, taken apart: what comes before the figures, how many
 * figures, and what they say. `ord` is null when there are no trailing
 * figures at all, and a null ord never merges with anything.
 */
export function shapeOf(number) {
  const s = String(number ?? '')
  const m = /^(.*?)(\d+)$/.exec(s)
  if (!m) return { head: s, width: 0, ord: null }
  return { head: m[1], width: m[2].length, ord: Number(m[2]) }
}

/** Whether `b` is the very next ticket after `a`, in the same numbering. */
function follows(a, b) {
  return a.ord !== null && b.ord !== null
    && a.head === b.head && a.width === b.width
    && b.ord === a.ord + 1
}

/*
 * HOW MANY TICKETS A BOOK CONTAINS, from its own first and last.
 *
 * Read off the book rather than off the raffle's tickets-per-book setting,
 * which is what a NEW book is created with and not what an old one holds. A
 * raffle that changed the setting has books of both sizes, and the last book
 * of a run is routinely short.
 *
 * Null when it cannot be worked out — a book whose row is not loaded, or whose
 * two ends are not in the same numbering. A book of unknown size is never
 * folded, so its tickets fall through and are listed. That is the right
 * failure: a listed book reads as slightly long, where a wrongly folded one
 * tells a buyer they own ten tickets they do not.
 */
export function bookSize(book) {
  if (!book) return null
  const a = shapeOf(book.firstTicket)
  const b = shapeOf(book.lastTicket)
  if (a.ord === null || b.ord === null) return null
  if (a.head !== b.head || a.width !== b.width) return null
  const n = b.ord - a.ord + 1
  return n > 0 ? n : null
}

/**
 * The buyer's tickets, folded into books and spans.
 *
 * @param tickets  `[{ number, book }]` — the buyer's SOLD tickets. Order does
 *                 not matter; duplicates are dropped.
 * @param books    `[{ book, firstTicket, lastTicket }]` — the raffle's books,
 *                 or just the ones touched. `number` is accepted for `book`,
 *                 because the two shapes exist in this codebase already.
 * @returns        chunks in reading order:
 *                 `{ kind: 'book', book, from, to, count }`
 *                 `{ kind: 'span', from, to, count }`  (count 1 → from === to)
 */
export function spansOf(tickets, books = []) {
  const byNumber = new Map()
  for (const t of tickets ?? []) {
    const number = String(t?.number ?? '').trim()
    if (number) byNumber.set(number, String(t?.book ?? '').trim())
  }

  const sizes = new Map()
  for (const b of books ?? []) {
    const name = String(b?.book ?? b?.number ?? '').trim()
    if (name) sizes.set(name, bookSize(b))
  }

  /* ---- pass one: fold the books the buyer holds ENTIRELY ---- */
  const held = new Map()
  for (const [number, book] of byNumber) {
    if (!book) continue
    if (!held.has(book)) held.set(book, [])
    held.get(book).push(number)
  }

  const chunks = []
  const loose = []
  const foldedBooks = new Set()
  for (const [book, numbers] of held) {
    const size = sizes.get(book) ?? null
    /*
     * `numbers.length === size` proves containment on its own, and only
     * because two other things are true: a ticket number is unique, and the
     * book each one names came off its own row. Without either, this would be
     * counting rather than checking.
     */
    if (size !== null && numbers.length === size) {
      const sorted = [...numbers].sort(compareNumbers)
      chunks.push({
        kind: 'book',
        book,
        from: sorted[0],
        to: sorted[sorted.length - 1],
        count: sorted.length,
      })
      foldedBooks.add(book)
    }
  }
  for (const [number, book] of byNumber) {
    if (!foldedBooks.has(book)) loose.push(number)
  }

  /* ---- pass two: fold what is left into runs ---- */
  /*
   * A RUN MAY CROSS A BOOK BOUNDARY, now that no whole book is left in here.
   * To the buyer a span of numbers is a span of numbers; which book a
   * counterfoil is filed in is the office's business and is on the check page
   * behind the QR. Refusing to cross would print
   * `KS-00009 – KS-00010 · KS-00011 – KS-00012` where one span is true.
   */
  loose.sort(compareNumbers)
  let run = null
  const runs = []
  for (const number of loose) {
    const shape = shapeOf(number)
    if (run && follows(run.shape, shape)) {
      run.to = number
      run.shape = shape
      run.count += 1
      continue
    }
    run = { kind: 'span', from: number, to: number, count: 1, shape }
    runs.push(run)
  }
  for (const r of runs) chunks.push({ kind: r.kind, from: r.from, to: r.to, count: r.count })

  /* Books first, then spans in numbering order — the same order a person
     reading a shelf would say them in, and stable between two renders of the
     same holding, which a Map's insertion order alone would not be. */
  chunks.sort((a, b) => {
    if ((a.kind === 'book') !== (b.kind === 'book')) return a.kind === 'book' ? -1 : 1
    return compareNumbers(a.from, b.from)
  })
  return chunks
}

/*
 * Numbers sorted as NUMBERS where they can be, and as text where they cannot.
 * Sorting ticket numbers as strings happens to be right while the width is
 * fixed, and quietly stops being right the first time a raffle's is not.
 */
function compareNumbers(a, b) {
  const x = shapeOf(a)
  const y = shapeOf(b)
  if (x.head !== y.head) return x.head < y.head ? -1 : 1
  if (x.ord === null || y.ord === null) return String(a) < String(b) ? -1 : 1
  return x.ord - y.ord
}

/*
 * THE PUNCTUATION IS THE CALLER'S, AND THERE IS ONE REASON FOR IT.
 *
 * The digital card draws its headline in the serial-number face, and that face
 * is the one this app has MEASURED — `FONT.advance` in ticketart.js, read out
 * of the font file — because a number whose width is unknown cannot be shrunk
 * to fit a box. The measured set is A-Z, the figures, space, hyphen, full stop,
 * slash and hash. An en dash, a middle dot, a comma and a plus sign are not in
 * it, and `advanceOf` refuses rather than guessing.
 *
 * So the card asks for `MEASURABLE`, which says the same thing in glyphs the
 * font has widths for, and everything else — the check page, the WhatsApp
 * message — takes the defaults and reads properly. The CONTENT is identical
 * either way, which is the part that matters and the reason this lives here
 * rather than being punctuated twice in two files.
 */
export const MEASURABLE = {
  dash: ' - ',
  /* A pair is drawn as a range here rather than listed, because the comma that
     makes a list readable is one of the glyphs with no measured width. */
  pair: ' - ',
  join: '  /  ',
  more: (n) => `AND ${n} MORE`,
}

/** One chunk, in the words a buyer reads. */
export function chunkText(chunk, { dash = ' – ', pair = ', ' } = {}) {
  if (chunk.kind === 'book') return chunk.book
  if (chunk.count === 1) return chunk.from
  /*
   * A PAIR IS LISTED, NOT SPANNED. `KS-00023 – KS-00024` is longer than
   * `KS-00023, KS-00024` and says less plainly that there are two of them.
   * Three is where a span starts being shorter than the thing it replaces.
   */
  if (chunk.count === 2) return `${chunk.from}${pair}${chunk.to}`
  return `${chunk.from}${dash}${chunk.to}`
}

/**
 * The line to print, within the room there is for it.
 *
 * @param chunks  from `spansOf`
 * @param max     how many chunks the space will take. Beyond it the rest are
 *                counted rather than named.
 * @returns `{ text, shown, hidden, tickets }` — `hidden` is a count of
 *          TICKETS, not of chunks, because "+3 more" meaning three entries
 *          when it is thirty tickets is the page misleading the person it is
 *          addressed to.
 */
export function describeSpans(chunks, opts = {}) {
  const { max = 3, join = ' · ', more = (n) => `+${n} more` } = opts
  const all = chunks ?? []
  const tickets = all.reduce((n, c) => n + c.count, 0)
  const write = (c) => chunkText(c, opts)
  if (all.length <= max) {
    return { text: all.map(write).join(join), shown: all.length, hidden: 0, tickets }
  }
  const shown = all.slice(0, max)
  const rest = all.slice(max)
  const hidden = rest.reduce((n, c) => n + c.count, 0)
  return {
    text: [...shown.map(write), more(hidden)].join(join),
    shown: shown.length,
    hidden,
    tickets,
  }
}

/**
 * The whole answer in one call, for a caller that has a buyer's tickets and
 * the raffle's books and wants a line and a count.
 *
 * THE COUNT IS ALWAYS THE TRUE ONE. `text` may be abbreviated by `max` and
 * `tickets` never is, so a card can print "14 tickets" beside a line naming
 * six of them. That pairing is the whole of how a small card tells the truth
 * about a large holding: the number is exact, the line is as much of it as
 * fits, and the QR under both is the rest.
 */
export function summarise(tickets, books = [], opts = {}) {
  const chunks = spansOf(tickets, books)
  return { chunks, ...describeSpans(chunks, opts) }
}
