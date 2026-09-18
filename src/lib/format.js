/** Display helpers. Plain words, not jargon — volunteers read these. */

export function money(n, currency) {
  const v = Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
  return currency ? `${currency} ${v}` : v
}

/** Rounded money for headline numbers, where the cents are noise. */
export function moneyShort(n, currency) {
  const v = Math.round(Number(n || 0)).toLocaleString()
  return currency ? `${currency} ${v}` : v
}

/**
 * A date with no time is a calendar day, not an instant.
 *
 * books.due_at is a DATE and arrives as 'YYYY-MM-DD'. `new Date('2026-09-20')`
 * is specified to mean UTC midnight, so every browser west of Greenwich formats
 * it as the 19th — a handover receipt that tells an agent to bring the money
 * back a day early, and an overdue list that starts a day early with it. Read
 * as local parts instead, the day survives the timezone.
 *
 * Timestamps keep their own parsing: an instant genuinely has a zone, and
 * "sold at" should move with the reader.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function parse(iso) {
  if (!iso) return null
  const m = DATE_ONLY.exec(String(iso).trim())
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso)
  return isNaN(d) ? null : d
}

/** Midnight local, so "how many days" counts days and not hours. */
function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function date(iso) {
  if (!iso) return '—'
  const d = parse(iso)
  return d === null ? String(iso)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateTime(iso) {
  if (!iso) return '—'
  const d = parse(iso)
  return d === null ? String(iso)
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "3 days ago", "in 2 weeks" — easier to judge than a date. */
export function relative(iso) {
  if (!iso) return ''
  const d = parse(iso)
  if (d === null) return ''
  // Whole days between calendar days, not hours between instants: an hour of
  // drift either side of midnight must not turn "tomorrow" into "today", and a
  // clock change must not make a week 6.96 days long.
  const days = Math.round((dayStart(d) - dayStart(new Date())) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  return `in ${days} days`
}

export function maskPhone(phone) {
  const s = String(phone || '')
  if (!s) return ''
  return s.length < 4 ? '••••' : '••••' + s.slice(-3)
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || one + 's')}`
}

/** Book number with the padding stripped, for tiles: "Book-031" -> "31". */
export function bookShort(book) {
  return String(book).replace(/\D/g, '').replace(/^0+/, '') || '0'
}

export const STATUS_WORDS = {
  Available: 'Not sold yet',
  Reserved: 'Being held',
  Sold: 'Sold',
  Donated: 'Given',
  Void: 'Cancelled'
}

/**
 * What "counting a book in" means, in one sentence, for the tooltip wherever
 * the phrase appears.
 *
 * IT IS THE ONE STEP A VOLUNTEER CANNOT GUESS FROM THE WORDS. "Brought back"
 * sounds finished and is not: the paper has returned, the money has not been
 * counted, and the book is still open. The panel says so in figures — sold 10
 * of 10, handed in RM 0, difference RM -100 — but only to somebody who already
 * knows that those are two different facts. It was asked directly: if the whole
 * book is sold, why is "Count it in" still there.
 *
 * Spelled HERE and nowhere else, because it appears as a button, as a verb in
 * the trail, and as the note on a payment row. Three copies of a sentence drift
 * into three different promises about what the button does.
 */
export const COUNTED_IN_HELP =
  'Counting a book in is its last step: the unsold ticket numbers are read ' +
  'back, the cash that came with them is written down, and the book closes as ' +
  'Finished. A book that is Brought back has returned but has not been counted ' +
  'in yet — which is why it can be sold out and still owe money.'

export const BOOK_WORDS = {
  Unassigned: 'In the office',
  // Offered is custody in mid-air: reserved for one seller, on nobody's balance,
  // and not theirs until they say yes. "Offered" alone read as a place the book
  // could be; this says what is actually waiting to happen.
  Offered: 'Waiting to be accepted',
  Out: 'With a seller',
  Returned: 'Brought back',
  Settled: 'Finished',
  Lost: 'Lost',
  Void: 'Cancelled'
}

/**
 * What each role is called, in words a volunteer recognises.
 *
 * Here rather than in the two screens that show them, because it was in both
 * and they had to agree. A fifth role arriving is exactly when two copies stop
 * matching, and a system where the Access screen and the People screen name the
 * same person differently is one nobody can be talked through on the phone.
 *
 * superadmin is an ASSIGNMENT, not a rung above Organiser: the gate resolves it
 * to admin plus a flag, so the powers are the same everywhere except the few
 * things only the owner may do. "Owner" says that better than "Super admin",
 * which sounds like a bigger Organiser rather than a different kind of one.
 */
export const ROLE_WORDS = {
  superadmin: 'System Admin',
  admin: 'Organiser',
  recorder: 'Helper',
  agent: 'Seller who signs in',
  viewer: 'Can only look',
}

/**
 * The word that follows a name, lowercase and one word.
 *
 * SEPARATE FROM ROLE_WORDS on purpose. Those are the labels on the Access
 * screen, where somebody is choosing what to make a person — "Seller who signs
 * in" tells them what they are picking. After a name it would read as part of
 * the name. This is a tag, so it is short, lowercase, and stays out of the way
 * of the thing it describes: "Amos Hung helper", not "Amos Hung Helper".
 *
 * superadmin resolves to organiser, matching what the server sends and what
 * list_users already does — the top role is not announced on a ticket row.
 */
export const ROLE_TAG = {
  superadmin: 'organiser',
  admin: 'organiser',
  recorder: 'helper',
  agent: 'seller',
  viewer: 'viewer',
}

/** A seller who carries paper but never signs in is still a seller. */
export const SELLER_TAG = 'seller'

export const ROLE_BLURB = {
  superadmin: 'Decides who else can sign in, and approves the big changes',
  admin: 'Runs the raffle day to day',
  recorder: 'Writes down sales and looks after books',
  agent: 'A seller who also uses the app, for their own books only',
  viewer: 'Sees totals, never phone numbers',
}

/**
 * A ticket sold out of a seller's own book carries the SELLER as the contact.
 *
 * The settlement writes the seller's name with " (seller)" appended and the
 * seller's phone, because that is who you would actually ring: the seller sold
 * it, knows who to, and may never have passed the buyer's details on. The
 * marker is what keeps the field honest — without it the winners list would say
 * the seller bought their own ticket, and "the seller knows the buyer" and "the
 * seller bought it" are different things that both happen.
 *
 * Written by settle_book as exactly one trailing " (seller)", so this strips
 * exactly that and nothing else. Anchored at the end on purpose: somebody whose
 * real name contains the word should be left alone.
 */
const SELLER_MARK = / \(seller\)$/

/** The bare name, for showing next to a marker rather than inside one. */
export function plainName(name) {
  return String(name ?? '').replace(SELLER_MARK, '')
}

/** True when the contact on this ticket is the seller, not the buyer. */
export function isSellerContact(name) {
  return SELLER_MARK.test(String(name ?? ''))
}
