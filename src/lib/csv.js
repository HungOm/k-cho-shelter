/**
 * A table, as a file somebody opens in a spreadsheet.
 *
 * LIFTED OUT OF Draw.vue RATHER THAN COPIED. It was a local function there, and
 * the Money statement needs the same thing — card 4d puts Export beside the
 * account-history filters. A second copy is the cheaper diff and it is exactly
 * how two exports come to disagree about what a quoted field looks like, which
 * is the sort of difference nobody notices until a name with a comma in it
 * splits one row into two in somebody's reconciliation.
 *
 * THE BOM IS LOAD-BEARING, not a superstition. Excel reads a .csv without one
 * as the system's legacy codepage, so a Burmese buyer's name arrives as
 * mojibake on the machine most likely to open this file. It is three bytes and
 * it is the difference between a usable export and a support conversation.
 */

/** One field, quoted only when it has to be. */
const cell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** `head` is an array of column names; `rows` an array of arrays. */
export function toCsv(head, rows) {
  return [head.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
}

/**
 * Hand the file to the browser.
 *
 * The object URL is revoked on a timer rather than immediately: revoking in the
 * same tick as the click cancels the download in some browsers, which fails by
 * doing nothing at all.
 */
export function downloadCsv(filename, head, rows) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + toCsv(head, rows)], {
    type: 'text/csv;charset=utf-8',
  }))
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

/**
 * A filename that says what is in the file.
 *
 * Exports land in a downloads folder beside a dozen others, and "statement.csv"
 * three times is three files nobody can tell apart. The parts are joined with
 * hyphens and anything that is not a letter, digit or hyphen is dropped, so a
 * seller's name with a slash in it cannot produce a path.
 */
export function csvName(...parts) {
  /*
   * \p{L}\p{M}\p{N}, and every part of that is load-bearing.
   *
   * `\w` is ASCII-only in JavaScript, so a Burmese seller's name was stripped to
   * nothing and their export came out named after the agent id alone. Replacing
   * it with \p{L} fixed that and introduced a subtler version of it: Burmese
   * writes vowels as COMBINING MARKS, which are category M and not L, so
   * "ကို ထာ" came out as "က-ထ" — a name mangled into different letters rather
   * than a name missing. \p{M} keeps the marks attached to the letters they
   * belong to.
   *
   * Both were found by running it on a Burmese name. Neither is visible in the
   * English case, which looked perfect throughout.
   */
  const slug = parts
    .filter(Boolean)
    .map((p) => String(p).trim().replace(/[^\p{L}\p{M}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('-')
  return `${slug || 'export'}.csv`
}
