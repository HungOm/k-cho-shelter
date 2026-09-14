/*
 * Whole local days, never instants.
 *
 * These four helpers carry the entire two-deadline feature, and the bug they
 * exist to prevent has already happened once on the Apps Script side: a due
 * date round-tripped through toISOString came back a day early, which would
 * have surfaced as one seller chased for a book that was not late, with nobody
 * able to explain why.
 *
 * Two of these tests fail if the machine's clock is set to a US timezone and
 * the helpers are wrong — which is the point. The raffle's calendar is
 * Asia/Singapore and the server's is not.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The module is TypeScript; strip the types rather than add a build step for
// four pure functions.
const src = readFileSync(new URL('../supabase/functions/api/deadlines.ts', import.meta.url), 'utf8')
const pure = src
  .slice(src.indexOf("const ZONE"), src.indexOf('export async function configDate'))
  .replace(/export function/g, 'export function')
  .replace(/: string\b/g, '').replace(/: number\b/g, '').replace(/: unknown\b/g, '')
  .replace(/: Date\b/g, '').replace(/\bconst asDay = \(d\) =>/, 'const asDay = (d) =>')

const dir = mkdtempSync(join(tmpdir(), 'dates-'))
const file = join(dir, 'dates.mjs')
writeFileSync(file, pure)
const { today, dayStart, addMonths, daysBetween } = await import('file://' + file)

let pass = 0, fail = 0
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

console.log('a date string survives being a date string')
{
  eq(dayStart('2026-10-14'), '2026-10-14', 'already a day, left alone')
  eq(dayStart(''), '', 'blank stays blank')
  eq(dayStart('not a date'), '', 'nonsense is refused rather than guessed at')
  eq(dayStart(null), '', 'null is blank')
  eq(dayStart(undefined), '', 'undefined is blank')
}

console.log('THE TRAP: a full timestamp is read in the raffle calendar, not UTC')
{
  // 14 October, 8pm UTC. In Singapore that is already the 15th.
  eq(dayStart('2026-10-14T20:00:00.000Z'), '2026-10-15',
     'an evening-UTC instant is the next day here')

  // Local midnight on the 14th in Singapore is 16:00 UTC on the 13th. Read as
  // a UTC calendar date it is the 13th — the day-early bug, exactly.
  eq(dayStart('2026-10-13T16:00:00.000Z'), '2026-10-14',
     'local midnight is NOT read as the previous day')

  // And the regex is anchored, so a timestamp goes through Date rather than
  // having its leading ten characters lifted off.
  ok(dayStart('2026-10-13T16:00:00.000Z') !== '2026-10-13',
     'the leading UTC date is not taken off the front of the string')
}

console.log('adding months clamps to the end of the month')
{
  eq(addMonths('2026-01-31', 1), '2026-02-28', '31 Jan + 1 month is 28 Feb, not 3 March')
  eq(addMonths('2028-01-31', 1), '2028-02-29', 'and 29 Feb in a leap year')
  eq(addMonths('2026-03-31', 1), '2026-04-30', '31 March + 1 is 30 April')
  eq(addMonths('2026-10-14', 1), '2026-11-14', 'an ordinary day is just the same day next month')
  eq(addMonths('2026-12-15', 1), '2027-01-15', 'and it rolls the year')

  // The reason the clamp matters: without it a month-end check-in walks forward
  // a few days every year, and the date everybody was told drifts away from the
  // date the system checks.
  let d = '2026-01-31'
  for (let i = 0; i < 12; i++) d = addMonths(d, 1)
  eq(d, '2027-01-28', 'twelve rolls from 31 Jan do not walk into February')
}

console.log('days between are whole days')
{
  eq(daysBetween('2026-10-14', '2026-10-15'), 1, 'one day')
  eq(daysBetween('2026-10-15', '2026-10-14'), -1, 'backwards is negative')
  eq(daysBetween('2026-10-14', '2026-10-14'), 0, 'same day is zero')
  eq(daysBetween('2026-01-01', '2027-01-01'), 365, 'a year')
  eq(daysBetween('2028-01-01', '2029-01-01'), 366, 'a leap year')

  // Across a DST boundary in a zone that has one. Singapore does not, which is
  // half the reason it is the calendar used — but the arithmetic is date-only
  // anyway, so an hour cannot creep in and round a day to 0 or 2.
  eq(daysBetween('2026-03-28', '2026-03-29'), 1, 'a European DST night is still one day')
  eq(daysBetween('2026-11-01', '2026-11-02'), 1, 'and a US one')
}

console.log("today() is a day in the raffle's calendar")
{
  const t = today()
  ok(/^\d{4}-\d{2}-\d{2}$/.test(t), `today() is a plain day (${t})`)
  // It must agree with dayStart of this instant, or the two disagree about what
  // "today" means and every comparison between them is off by a day sometimes.
  eq(t, dayStart(new Date().toISOString()), 'today() agrees with dayStart(now)')
}

console.log('the ordering the whole feature rests on')
{
  // Plain string comparison is the ordering, which only works because the
  // format is zero-padded ISO. Worth pinning: if the format ever changed to
  // something like 14/10/2026, every < and > in deadlines.ts silently inverts.
  ok('2026-10-14' < '2026-10-15', 'string comparison orders days correctly')
  ok('2026-09-30' < '2026-10-01', 'across a month boundary')
  ok('2026-12-31' < '2027-01-01', 'and a year boundary')
  ok(addMonths('2026-10-14', 1) > '2026-10-14', 'a rolled check-in is always later')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
