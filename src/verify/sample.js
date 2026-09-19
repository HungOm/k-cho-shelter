/*
 * THE SAMPLE BOOK — ten tickets that are not tickets.
 *
 * A committee has to be shown what they are buying, a printer has to be given
 * something to test registration on, and a volunteer has to be taught what a
 * ticket looks like. None of that should cost a real ticket number, and until
 * now the only way to get paper was to print from the raffle.
 *
 * NOTHING HERE IS WRITTEN DOWN ANYWHERE. No row in `tickets`, none in `books`,
 * none in `ticket_codes`. Every figure in this app is derived from the tickets
 * table — the totals, the book list, what a seller owes, whether the draw is
 * ready — so a sample that existed as a row would have to be excluded from all
 * of them, and supabase/AUDIT.md is the record of what "everything except X"
 * costs here: the exclusion gets written in twelve places and forgotten in the
 * thirteenth. A sample with no row cannot be miscounted, because there is
 * nothing to count. It also means samples print on a fresh install, before the
 * raffle has been numbered at all.
 *
 * WHY THIS FILE IS UNDER src/verify AND NOT src/lib. The public check page may
 * not import from the app's lib — tests/verifypage.test.mjs fails the build if
 * it ever does, because one import drags the Supabase client and twenty
 * thousand tickets onto a page a stranger opens on mobile data. Both sides
 * need the same answer to "is this a sample", and two copies of that answer
 * would drift the first time one was edited. So the definition lives on the
 * side with the strict rule, and the app reaches across to it.
 *
 * It imports nothing, on purpose.
 */

/** Crockford's base32, the same alphabet a real code is printed in. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const SAMPLE_PREFIX = 'Sample-'
export const SAMPLE_COUNT = 10
export const SAMPLE_BOOK = 'Sample book'
const CODE_LENGTH = 12

/** Sample-001 … Sample-010. Three digits, because ten never needs four. */
export function sampleNumber(n) {
  return SAMPLE_PREFIX + String(n).padStart(3, '0')
}

/*
 * A SAMPLE'S CODE IS WORKED OUT, WHERE A REAL ONE IS STORED.
 *
 * _shared/ticketcode.ts explains at length why real codes are random and kept:
 * a code that can be computed can be forged, and the code is the only thing
 * separating a real ticket from one printed at home. Every word of that is
 * still true and none of it applies here, because there is nothing to protect.
 * A sample is not evidence of anything and is marked, on the paper and on the
 * page, as not being a ticket.
 *
 * What a derived code buys is that the check page can recognise a sample with
 * no database and no request — which is the whole reason a sample QR works the
 * moment it comes off the printer, on a laptop with no connection, years after
 * the raffle it was printed for has been wiped.
 */
export function sampleCode(number) {
  const text = String(number ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    h ^= h << 13; h >>>= 0
    h ^= h >>> 17
    h ^= h << 5; h >>>= 0
    out += ALPHABET[h % 32]
  }
  return out
}

/** The parameter a sample QR carries. Deliberately not the compact form. */
export const SAMPLE_PARAM = 's'

/*
 * WHY THE MARKER IS ITS OWN PARAMETER AND CARRIES NO DOT.
 *
 * The page forwards anything of the shape `?<number>.<code>` to the server,
 * so a sample printed in that form would be looked up, found not to exist and
 * shown in red — a sample ticket accused of being a forgery. `?s=Sample-001`
 * is a shape the lookup path cannot take.
 *
 * It also fixes the direction this fails in. Strip the marker, or scan a
 * sample with an older cached bundle that has never heard of samples, and you
 * get a lookup for a ticket that does not exist: "not a valid ticket". That is
 * the safe way round. The dangerous failure would be a sample answering as
 * genuine, and no edit of this URL can produce one.
 */
export function sampleVerifyUrl(base, number) {
  const root = String(base || '').replace(/\/+$/, '')
  return `${root}/?${SAMPLE_PARAM}=${encodeURIComponent(String(number ?? ''))}`
}

/** The sample this address names, or '' — which means "not a sample, carry on". */
export function sampleFromSearch(search) {
  const m = new RegExp(`(?:^\\?|[?&])${SAMPLE_PARAM}=([^&]*)`).exec(String(search ?? ''))
  if (!m) return ''
  let n = ''
  try { n = decodeURIComponent(m[1]) } catch { return '' }
  return new RegExp(`^${SAMPLE_PREFIX}\\d{3}$`).test(n) ? n : ''
}

/** The book, in printing order. */
export function sampleBook() {
  const out = []
  for (let i = 1; i <= SAMPLE_COUNT; i++) {
    const number = sampleNumber(i)
    out.push({ number, code: sampleCode(number), book: SAMPLE_BOOK, status: 'Sample' })
  }
  return out
}
