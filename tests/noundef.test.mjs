/*
 * No component uses a name that does not exist.
 *
 * THE BUG THIS EXISTS FOR. SettleBook.vue called map(resolve) where the import
 * is resolveTicketNumber. It shipped, went live, and threw "resolve is not
 * defined" on "Finish this book" — the one action in this system that decides
 * how much money a seller owes.
 *
 * NOTHING IN THE PIPELINE COULD SEE IT, and that is the point:
 *   - Vite does not resolve identifiers, so the production build passed
 *   - no suite drove that component, so all 45 files stayed green
 *   - reaching the line in a browser needs a book, a seller and an open settle
 *     dialog, so no smoke test came near it
 * The first thing that executed it was a volunteer pressing the button.
 *
 * It is a different class from the three shape bugs of the same day. Those were
 * two ends of a wire disagreeing, and a test that drove both ends would have
 * caught them. This one is a single file that is simply wrong, in a language
 * where nothing checks, and the only honest guard is something that reads the
 * code rather than running it.
 *
 * Exactly one rule is on. A hundred style warnings is a linter nobody runs, and
 * a linter nobody runs is worse than none — it makes the gap look covered.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const bin = ROOT + 'node_modules/.bin/eslint'
if (!existsSync(bin)) {
  console.log('  FAIL eslint is not installed — run npm install')
  console.log('\n0 passed, 1 failed')
  process.exit(1)
}

let out = '', failed = false
try {
  out = execFileSync(bin, ['src', '--no-warn-ignored', '-f', 'json'],
    { cwd: ROOT, encoding: 'utf8' })
} catch (e) {
  out = e.stdout || ''
  failed = true
}

let results
try { results = JSON.parse(out) } catch {
  console.log('  FAIL eslint did not return JSON:\n' + out.slice(0, 400))
  console.log('\n0 passed, 1 failed')
  process.exit(1)
}

// A linter that inspects nothing reports nothing, which is indistinguishable
// from a clean run. Check it actually looked at the components.
const seen = results.map(r => r.filePath)
ok(seen.length > 20, `eslint inspected the source (${seen.length} files)`)
ok(seen.some(f => f.endsWith('.vue')), 'including .vue components')
ok(seen.some(f => f.endsWith('SettleBook.vue')), 'including the one that shipped this bug')

const problems = results.flatMap(r =>
  r.messages.map(m => `${r.filePath.replace(ROOT, '')}:${m.line}:${m.column} ${m.message}`))

for (const p of problems) console.log('  FAIL ' + p)
fail += problems.length
ok(!failed || problems.length > 0, 'eslint exited cleanly or said why')
ok(problems.length === 0, `no undefined names (${problems.length} found)`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
