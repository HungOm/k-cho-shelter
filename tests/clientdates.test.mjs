/*
 * A due date is a calendar day, and must survive the reader's timezone.
 *
 * books.due_at became a DATE and now arrives as 'YYYY-MM-DD'. `new Date(...)`
 * on a date-only string is specified to mean UTC MIDNIGHT, so every browser
 * west of Greenwich formatted it as the day before: the handover receipt told
 * an agent to bring the money back on the 19th when the book was due on the
 * 20th, and the overdue list agreed with the receipt.
 *
 * dates.test.mjs covers the server's side of this. Nothing covered the client's
 * — where the sentence a volunteer actually reads is assembled.
 *
 * Timezones are the point, so the test runs the real module in real ones rather
 * than stubbing a clock. Anywhere east of Greenwich the bug is invisible, which
 * is why it survived: the people who built this are in UTC+8.
 */
import { execFileSync } from 'node:child_process'

const ZONES = [
  'Pacific/Honolulu',     // UTC-10, the worst case
  'America/Los_Angeles',  // UTC-8
  'America/New_York',     // UTC-5
  'UTC',
  'Asia/Kuala_Lumpur',    // UTC+8, where this is deployed and where it looked fine
  'Pacific/Auckland',     // UTC+13
]

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const MODULE = new URL('../src/lib/format.js', import.meta.url).pathname

/** Run the real formatters inside a given timezone and bring back the answers. */
function inZone(tz) {
  const script = `
    import { date, dateTime, relative } from ${JSON.stringify(MODULE)}
    const pad = n => String(n).padStart(2, '0')
    const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const now = new Date()
    const day = n => { const d = new Date(now); d.setDate(d.getDate() + n); return ymd(d) }
    console.log(JSON.stringify({
      fixed:     date('2026-09-20'),
      today:     relative(day(0)),
      tomorrow:  relative(day(1)),
      yesterday: relative(day(-1)),
      inAWeek:   relative(day(7)),
      empty:     date(''),
      rubbish:   date('not a date'),
      instant:   dateTime('2026-09-20T23:30:00Z'),
    }))`
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' }))
}

for (const tz of ZONES) {
  const r = inZone(tz)
  console.log(`${tz}: ${r.fixed}`)

  // The calendar day must be the one the database stored, everywhere.
  ok(/\b20\b/.test(r.fixed), `${tz}: 2026-09-20 renders as the 20th, got "${r.fixed}"`)
  ok(!/\b19\b/.test(r.fixed), `${tz}: and never as the 19th, got "${r.fixed}"`)
  ok(/Sep/.test(r.fixed), `${tz}: in September, got "${r.fixed}"`)

  // Counting days, not hours. An hour either side of midnight must not move it.
  ok(r.today === 'today', `${tz}: a book due today reads "today", got "${r.today}"`)
  ok(r.tomorrow === 'tomorrow', `${tz}: due tomorrow reads "tomorrow", got "${r.tomorrow}"`)
  ok(r.yesterday === 'yesterday', `${tz}: a day late reads "yesterday", got "${r.yesterday}"`)
  ok(r.inAWeek === 'in 7 days', `${tz}: a week out reads "in 7 days", got "${r.inAWeek}"`)

  // Unchanged behaviour for the things that are not calendar days.
  ok(r.empty === '—', `${tz}: nothing renders as a dash`)
  ok(r.rubbish === 'not a date', `${tz}: unparseable input is shown, not swallowed`)
  ok(/Sep/.test(r.instant), `${tz}: a real timestamp still formats, got "${r.instant}"`)
}

// An instant genuinely has a zone and should move with the reader — the fix
// must not have flattened timestamps into calendar days too.
const west = inZone('Pacific/Honolulu').instant
const east = inZone('Pacific/Auckland').instant
ok(west !== east, `a timestamp still moves with the reader (${west} vs ${east})`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
