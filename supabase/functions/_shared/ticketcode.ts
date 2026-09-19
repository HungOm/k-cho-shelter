/*
 * THE CODE PRINTED ON A TICKET.
 *
 * A ticket number is public: it is printed in large type, it runs in sequence,
 * and anybody holding one ticket can work out what the next one is called. That
 * is fine — it is a label, not a secret. What it cannot do is tell a real ticket
 * from one somebody printed at home with a plausible number written on it.
 *
 * The code is the part that can. It is sixteen characters of nothing in
 * particular, generated once when a ticket is printed and kept, and a ticket is
 * genuine when the code on the paper matches the code in the books.
 *
 * WHY RANDOM AND STORED, rather than worked out from the number.
 *
 * The alternative is a signature: code = HMAC(secret, number), computed on
 * demand, stored nowhere. It is a good design and it was the first one. It has
 * one clear advantage — somebody who steals a copy of the database still cannot
 * forge a ticket, because the key is not in it.
 *
 * It was not chosen because it buys that advantage with a key that has to be
 * set at deploy, kept, and rotated between raffles, and because the thing worth
 * more than the codes is already in that same database: several thousand
 * people's names and telephone numbers. A stolen backup is a catastrophe
 * whichever way this goes, and adding a secret to manage makes the ordinary
 * case — a raffle that just needs to print tickets — harder to run.
 *
 * Stored codes also give something a signature cannot: a record of which
 * tickets have been printed, and when, and by whom. Phase 3 prints from it.
 *
 * WHAT NEITHER DESIGN CAN DO. A photocopy of a genuine ticket carries a genuine
 * code and verifies. That is true of anything printed, and it is written down
 * here rather than left to be discovered: what defeats a photocopy is the
 * books, which say whether that number was sold and to whom. The verify page
 * reports that, and the draw is settled by the record rather than the paper.
 *
 * SHARED BY BOTH FUNCTIONS, which is why it is here and not in api/. The api
 * function generates codes; the public verify function checks them. One
 * definition of what a code looks like, or the two drift and every ticket
 * printed in between is unverifiable.
 */

/*
 * Crockford's base32: the digits and the capitals, less I, L, O and U.
 *
 * I and L are the ones that look like 1, O looks like 0, and U is dropped by
 * Crockford so that the alphabet cannot spell an unfortunate word by accident.
 * It matters because this code is not only scanned — it is PRINTED under the
 * QR, and somebody at a desk with a torn ticket reads it out over the phone.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/*
 * How long a code is, unless a raffle asks for another length.
 *
 * TWELVE, AND THE REASON IS THE PRINTER RATHER THAN THE MATHS.
 *
 * The code has to fit inside a QR that is printed in a box the artwork already
 * leaves, about 122 pixels on a 1600-pixel ticket. Every character added to the
 * address pushes the QR to a denser version, and a denser QR prints with
 * smaller squares. Below roughly a third of a millimetre a square, ordinary
 * phone cameras start failing on paper — and the whole point of the code is
 * that somebody in a hall can scan it.
 *
 * At twelve characters the printed address is about sixty bytes, which is the
 * last length that fits the smaller QR version, and each square prints around
 * 0.35 mm at a 190 mm ticket. Sixteen would cross into the next version and
 * drop to about 0.32 mm — still probably fine, and not worth the risk for
 * strength nobody needs.
 *
 * Because twelve is plenty. Sixty bits, and the only way to test a guess is to
 * ask the verify endpoint, one guess per request. A script at a thousand
 * guesses a second against a raffle of twenty thousand printed tickets would
 * expect its first hit in something like a million years. The limit on forging
 * a ticket is not the length of this number.
 *
 * IT CANNOT BE CHANGED RETROSPECTIVELY. A code is minted once and kept, so
 * raising this only affects tickets generated afterwards; the ones already
 * printed keep the length they were born with. That is fine — `looksLikeCode`
 * accepts the whole range — but it does mean a raffle ends up with two lengths
 * in circulation, which is worth knowing before changing it mid-print-run.
 */
export const DEFAULT_LENGTH = 12

/*
 * A code.
 *
 * `crypto.getRandomValues`, never Math.random. Math.random is seeded, shared
 * and predictable from its own output, and a "random" code somebody can
 * continue is not a code at all.
 *
 * The modulo below is not biased: 256 is a whole multiple of 32, so every byte
 * maps to exactly eight alphabet positions and each is equally likely. That is
 * only true because the alphabet is a power of two — a 36-character alphabet
 * here would quietly favour its first sixteen characters.
 */
export function newCode(length: number = DEFAULT_LENGTH): string {
  const n = Math.max(8, Math.min(32, Math.floor(length) || DEFAULT_LENGTH))
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % 32]
  return out
}

/** Is this something this system could have issued? Shape only, not truth. */
export function looksLikeCode(raw: unknown): boolean {
  const s = String(raw ?? '')
  return s.length >= 8 && s.length <= 32 && [...s].every((c) => ALPHABET.includes(c))
}

/*
 * Are these the same code?
 *
 * Constant time, and the reason is narrow but real. `a === b` on strings stops
 * at the first character that differs, so the time it takes leaks how much of a
 * guess was right — and an attacker who learns that can find a valid code one
 * character at a time instead of all at once, which turns an impossible search
 * into a few thousand requests.
 *
 * The length is folded in rather than checked first, because returning early on
 * a length mismatch leaks the length.
 */
export function equalCodes(a: unknown, b: unknown): boolean {
  const x = String(a ?? '')
  const y = String(b ?? '')
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0)
  }
  return diff === 0
}

/*
 * Whatever somebody typed or scanned, turned into the ticket number this raffle
 * actually stores — or null if it could not be.
 *
 * The same rules as resolveTicketNumber in src/lib/books.js, minus the part
 * that needs the full ticket list: try it verbatim, then uppercased, then
 * rebuild it from the digits with this raffle's prefix and padding. The last of
 * those is what makes a QR scan and a number typed by hand land on the same
 * ticket — "3291" and "KS-03291" are the same ticket to everybody except a
 * string comparison.
 *
 * It does NOT guess. A number that resolves to nothing is refused rather than
 * matched to the nearest thing, because on the verify page the answer to a
 * near-miss is "this is not a ticket", not a different ticket's status.
 */
export function canonicalNumber(raw: unknown, cfg: { prefix?: string; digits?: number }): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  if (!s) return null
  if (!/^[A-Z0-9-]{1,32}$/.test(s)) return null

  const prefix = String(cfg.prefix ?? '').toUpperCase()
  const digits = Number(cfg.digits ?? 5) || 5

  // Already in the stored shape.
  if (prefix && s.startsWith(prefix) && /^[0-9]+$/.test(s.slice(prefix.length))) return s
  if (!prefix && /^[0-9]+$/.test(s)) return s.padStart(digits, '0')

  // Digits only, or digits with something in front that is not the prefix.
  const onlyDigits = s.replace(/[^0-9]/g, '')
  if (!onlyDigits || !/^[0-9]+$/.test(onlyDigits)) return null
  // A number with no non-digit noise at all, or one whose noise IS the prefix
  // with its punctuation mangled, both rebuild the same way.
  return prefix + onlyDigits.padStart(digits, '0')
}
