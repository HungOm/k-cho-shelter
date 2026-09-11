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

export function date(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d) ? String(iso)
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d) ? String(iso)
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "3 days ago", "in 2 weeks" — easier to judge than a date. */
export function relative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const days = Math.round((d - new Date()) / 86400000)
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
