/**
 * Calendar days, as the interface has to handle them.
 *
 * A deadline is a day, not a moment, and the two backends do not always say it
 * the same way. Apps Script normalises a config date before sending it; the
 * edge function passes the stored value through. A value that began life in a
 * date-formatted spreadsheet cell migrates into the database as
 * "Tue Oct 14 2026 00:00:00 GMT+0800 (Singapore Standard Time)", and arrives
 * looking nothing like the '2026-10-14' the same field carries on the other
 * backend.
 *
 * That difference is quiet in the worst way. Compared as a string it sorts
 * ABOVE '2026-09-15', so a stale date reads as a future one; handed to an
 * <input type="date"> it renders as an empty box with no error anywhere.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A plain calendar day, or '' for anything else.
 *
 * Deliberately a GUARD rather than a parser. A date box speaks YYYY-MM-DD and
 * nothing else, so a value in another shape is not something to repair and
 * hand over — repairing it would mean guessing a timezone, and guessing wrong
 * moves somebody's deadline by a day. Declining it lets the caller fall through
 * to the next answer down, which is always a date it can trust.
 *
 * It also keeps callers' comparisons to two plain days, which is the only
 * shape lexicographic comparison is actually safe on.
 */
export function asDay(value) {
  const s = String(value ?? '').trim()
  return DAY.test(s) ? s : ''
}

/** Today, as a plain day, for comparing against one. */
export function todayDay() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A plain day, n days from today, in the reader's own timezone.
 *
 * Not `toISOString().slice(0, 10)`, which is the same day-early bug one level
 * down: that converts to UTC first, so anywhere east of Greenwich it returns
 * yesterday for the whole of the early morning. A raffle run from UTC+8 would
 * have handed out books with a due date a day short, every morning before 8am,
 * and nowhere else.
 */
export function dayFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + (days || 0))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
