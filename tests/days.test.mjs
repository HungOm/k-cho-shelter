/*
 * Calendar days on the client, and the two ways they go wrong by one.
 *
 * FIRST: the same field does not arrive in the same shape from both backends.
 * Apps Script normalises a config date before sending it. The edge function
 * sends what is stored, and a value that began in a date-formatted spreadsheet
 * cell migrated as "Tue Oct 14 2026 00:00:00 GMT+0800 (...)". Compared as a
 * string that sorts ABOVE "2026-09-15", so a passed check-in date reads as a
 * future one; handed to an <input type="date"> it renders an empty box and
 * reports nothing. Both failures are silent and neither is a crash.
 *
 * SECOND: toISOString().slice(0, 10) converts to UTC first. Run from UTC+8 it
 * returns YESTERDAY for the whole of the early morning, so books given out
 * before 8am got a due date a day short — and only there, which is why nobody
 * building this from Kuala Lumpur would see it in an afternoon of testing.
 *
 * Every assertion below is run again in three timezones, because one side of
 * UTC only ever proves half of it.
 */
import { execFileSync } from 'node:child_process'
import { asDay, todayDay, dayFromNow } from '../src/lib/days.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const MIGRATED = 'Tue Oct 14 2026 00:00:00 GMT+0800 (Singapore Standard Time)'

console.log('a plain day is kept, and anything else is declined')
{
  eq(asDay('2026-10-14'), '2026-10-14', 'a plain day')
  eq(asDay('  2026-10-14  '), '2026-10-14', 'surrounding space')

  // Declined rather than repaired: repairing means guessing a timezone, and
  // guessing wrong moves somebody's deadline by a day.
  eq(asDay(MIGRATED), '', 'a migrated spreadsheet date is not a day box can show')
  eq(asDay('2026-10-14T00:00:00.000Z'), '', 'nor is a full timestamp')
  eq(asDay('14/10/2026'), '', 'nor a local format')
  eq(asDay(''), '', 'blank')
  eq(asDay(null), '', 'null')
  eq(asDay(undefined), '', 'undefined')
  eq(asDay('2026-10-14 '), '2026-10-14', 'trailing space only')
}

console.log('and the reason the guard exists, stated as a fact')
{
  // This is the whole bug in one line. Without the guard, a check-in date that
  // passed months ago compares as though it were still ahead.
  ok(MIGRATED > '2026-09-15', 'the migrated shape sorts above a real day — string comparison lies')

  // The caller's test is `day && day >= today`. Unguarded that is true for a
  // date months past; guarded the value is empty, so the comparison is never
  // reached at all and the next fallback answers instead.
  const unguarded = MIGRATED && MIGRATED >= '2026-09-15'
  ok(unguarded === true, 'unguarded, a long-passed check-in reads as still ahead')
  const guarded = asDay(MIGRATED) && asDay(MIGRATED) >= '2026-09-15'
  ok(!guarded, 'guarded, it never reaches the comparison')
}

console.log('today is the reader\'s today, not UTC\'s')
{
  const d = new Date()
  const localParts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  eq(todayDay(), localParts, 'built from local calendar parts')
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayDay()), 'and is a plain day')
  eq(asDay(todayDay()), todayDay(), 'so it survives its own guard')
  eq(dayFromNow(0), todayDay(), 'nought days from now is today')

  const in30 = dayFromNow(30)
  ok(/^\d{4}-\d{2}-\d{2}$/.test(in30), '30 days on is a plain day')
  const diff = Math.round((new Date(in30 + 'T00:00:00Z') - new Date(todayDay() + 'T00:00:00Z')) / 864e5)
  eq(diff, 30, 'and is exactly 30 days later')
}

// --------------------------------------------- the half UTC+8 cannot show you

console.log('and the same holds on both sides of UTC')
{
  const probe = `
    import { todayDay, dayFromNow } from '${new URL('../src/lib/days.js', import.meta.url).pathname}'
    const d = new Date()
    const local = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    console.log(JSON.stringify({ today: todayDay(), local, utc: d.toISOString().slice(0,10),
      plus0: dayFromNow(0), plus1: dayFromNow(1) }))
  `
  for (const tz of ['Pacific/Auckland', 'America/New_York', 'Asia/Singapore']) {
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' }))
    eq(out.today, out.local, `${tz}: today is the local calendar day`)
    ok(/^\d{4}-\d{2}-\d{2}$/.test(out.plus1), `${tz}: tomorrow is a plain day`)
    // Not asserting today !== utc — they agree for most of the day. The point
    // is that todayDay never follows UTC when the two disagree.
    if (out.local !== out.utc) {
      ok(out.today === out.local, `${tz}: local and UTC disagree right now, and it followed local`)
    } else {
      pass++
    }
  }
}

/**
 * The half the clock usually hides.
 *
 * Every check above passes for most of the day even with the UTC bug in place,
 * because local and UTC agree for most of the day — which is exactly why the
 * bug survived being written. These two zones make it deterministic: at UTC+14
 * the local date runs ahead of UTC whenever the UTC hour is 10 or later, and at
 * UTC-12 it runs behind whenever the UTC hour is under 12. One of those is true
 * at every instant, so at least one of these zones always disagrees with UTC,
 * whatever time this suite happens to run.
 */
console.log('and at the extremes, where local and UTC always disagree')
{
  const probe = `
    import { todayDay, dayFromNow } from '${new URL('../src/lib/days.js', import.meta.url).pathname}'
    const d = new Date()
    const local = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
    console.log(JSON.stringify({ today: todayDay(), plus0: dayFromNow(0), local, utc: d.toISOString().slice(0,10) }))
  `
  const seen = []
  for (const tz of ['Etc/GMT-14', 'Etc/GMT+12']) {
    seen.push(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8' })))
  }
  const diverged = seen.filter(r => r.local !== r.utc)
  ok(diverged.length > 0, 'at least one extreme zone disagrees with UTC right now')
  for (const r of diverged) {
    eq(r.today, r.local, 'todayDay follows the local calendar, not UTC')
    eq(r.plus0, r.local, 'dayFromNow(0) follows it too — this is the one toISOString gets wrong')
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
