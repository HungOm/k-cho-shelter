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

export const BOOK_WORDS = {
  Unassigned: 'In the office',
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
  superadmin: 'Owner',
  admin: 'Organiser',
  recorder: 'Helper',
  agent: 'Seller who signs in',
  viewer: 'Can only look',
}

export const ROLE_BLURB = {
  superadmin: 'Decides who else can sign in, and approves the big changes',
  admin: 'Runs the raffle day to day',
  recorder: 'Writes down sales and looks after books',
  agent: 'A seller who also uses the app, for their own books only',
  viewer: 'Sees totals, never phone numbers',
}
