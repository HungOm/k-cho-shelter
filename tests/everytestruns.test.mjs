/*
 * Every test file is actually run, and every name in the runner exists.
 *
 * WHY THIS IS NEEDED. tests/run.sh keeps a hand-written list of all seventy-odd
 * suites on ONE line. Twice today a session rewrote that line from a copy made
 * before somebody else appended to it, and the appended name disappeared inside
 * a line they had legitimately rewritten. contactpoints and screenrender were
 * committed, correct, and did not run for three commits — 48 assertions,
 * including the ones that caught a payment chip hardcoded to "paid", silently
 * absent from every green run.
 *
 * A diff cannot express that loss. The unit of a diff is the LINE, and when a
 * list is denser than a line the deletion hides inside an edit that is
 * otherwise yours to make. 93's observation, and the reason this file compares
 * SETS rather than reading the diff.
 *
 * The other direction matters as much and fails more quietly: run.sh skips a
 * named file that is absent (`[ -f "$t" ] || continue`), so renaming a test
 * without updating the list removes it from the suite with no output at all.
 *
 * WHAT THIS CANNOT DO is protect itself. Dropped from the list, it stops
 * running like any other. It covers the other seventy-six, which is the whole
 * of the problem except for one file — and that one is named here so the next
 * person knows the gap is known rather than missed.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('./', import.meta.url))
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const onDisk = readdirSync(DIR).filter(f => /\.test\.(mjs|cjs)$/.test(f)).sort()

const runner = readFileSync(DIR + 'run.sh', 'utf8')
const listed = [...new Set(
  runner.split(/\s+/).map(w => w.replace(/[;].*$/, '')).filter(w => /\.test\.(mjs|cjs)$/.test(w))
)].sort()

console.log('the runner and the directory agree')
ok(onDisk.length > 50, `the directory was read (${onDisk.length} suites)`)
ok(listed.length > 50, `and the runner was parsed (${listed.length} names)`)

// Both directions. One alone is half a check: the first catches a suite that
// stopped running, the second catches a name the runner will silently skip.
for (const f of onDisk) {
  ok(listed.includes(f), `${f} exists and is RUN — not committed and forgotten`)
}
for (const f of listed) {
  ok(onDisk.includes(f), `${f} is named by the runner and really exists — not silently skipped`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
