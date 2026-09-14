/*
 * No undefined identifiers in the Apps Script files.
 *
 * The counterpart to the linter over src/. That one exists because a component
 * called map(resolve) where the import was resolveTicketNumber — a
 * ReferenceError that the build did not catch, the suite did not reach, and a
 * volunteer found by pressing the button that counts a book in.
 *
 * .gs has the same exposure and one extra hazard: every top-level function and
 * var in ANY file is visible from EVERY other, because Apps Script evaluates
 * them into one shared global scope. So a name can look defined while sitting
 * in a file that happens to load later — and file order is not guaranteed,
 * which is a bug this project has already had and fixed once.
 *
 * That shared scope is why the globals list is BUILT from the sources rather
 * than typed: a hand-maintained list goes stale, and it goes stale in the
 * direction that reports clean.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const GS = join(ROOT, 'apps_script')
const ESLINT = join(ROOT, 'node_modules', '.bin', 'eslint')

/** Every name Apps Script puts in the shared global scope. */
function sharedGlobals() {
  const names = new Set()
  for (const f of readdirSync(GS).filter((x) => x.endsWith('.gs'))) {
    const src = readFileSync(join(GS, f), 'utf8')
    for (const m of src.matchAll(/^function\s+(\w+)/gm)) names.add(m[1])
    for (const m of src.matchAll(/^var\s+(\w+)/gm)) names.add(m[1])
  }
  return names
}

// The platform's own objects. Listed rather than derived because they come
// from the runtime, not from this repository.
const PLATFORM = [
  'SpreadsheetApp', 'PropertiesService', 'CacheService', 'UrlFetchApp',
  'Utilities', 'Session', 'LockService', 'ScriptApp', 'Logger', 'HtmlService',
  'ContentService', 'DriveApp', 'MailApp', 'GmailApp', 'CalendarApp',
]

function runLint() {
  const globals = {}
  for (const n of [...sharedGlobals(), ...PLATFORM]) globals[n] = 'readonly'
  const dir = mkdtempSync(join(tmpdir(), 'gslint-'))
  const cfg = join(dir, 'eslint.config.mjs')
  writeFileSync(cfg,
    `export default [{files:["**/*.gs"],languageOptions:{ecmaVersion:2019,` +
    `sourceType:"script",globals:${JSON.stringify(globals)}},` +
    `rules:{"no-undef":"error"}}];\n`)
  try {
    const out = execFileSync(ESLINT,
      ['--no-config-lookup', '--config', cfg, '--format', 'json', 'apps_script'],
      { cwd: ROOT, encoding: 'utf8' })
    return JSON.parse(out)
  } catch (e) {
    // eslint exits non-zero when it finds problems; the report is still on stdout.
    if (e.stdout) return JSON.parse(e.stdout)
    throw e
  }
}

console.log('the linter actually reads the Apps Script files')
{
  const report = runLint()
  const seen = report.map((r) => r.filePath.split('/').pop()).filter((f) => f.endsWith('.gs'))

  // A linter that reads nothing reports nothing, and the two look identical
  // from outside. Same trap as a switch wired to nothing, one layer out.
  ok(seen.length >= 9, `it inspected ${seen.length} .gs files`)
  for (const f of ['Auth.gs', 'Api.gs', 'Books.gs', 'Tickets.gs', 'People.gs', 'Migrate.gs']) {
    ok(seen.includes(f), `including ${f}`)
  }
  ok(sharedGlobals().size > 150, `and it was told about ${sharedGlobals().size} shared names`)
}

console.log('no .gs file calls a name that does not exist')
{
  const report = runLint()
  const problems = report.flatMap((r) =>
    r.messages.filter((m) => m.ruleId === 'no-undef')
      .map((m) => `${r.filePath.split('/').pop()}:${m.line}:${m.column} ${m.message}`))

  ok(problems.length === 0,
    problems.length ? `undefined identifiers:\n    ${problems.join('\n    ')}` : 'all names resolve')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
