/*
 * THE EDGE FUNCTIONS, TYPE-CHECKED — decision D-010 in MULTI-TENANCY-DECISIONS.md.
 *
 * Nothing in the gate compiled the TypeScript. `ActionSpec.feature` became a
 * required field and the only thing enforcing it was a test reading the source
 * text. `deno check` is the tool that matches how these files are written
 * (npm: specifiers, explicit .ts and .js imports) and how they are bundled.
 *
 * A RATCHET, NOT A WALL. On the day this landed the check found 78 errors in
 * code that runs in production. Failing on all of them would block every deploy
 * until somebody rewrote a dozen files, which is not this card. So the errors
 * that exist are recorded in tests/typecheck-baseline.txt, and this fails on:
 *
 *   - any error NOT on that list, which is the point: a new mistake is caught
 *   - any error on the list that no longer occurs: a fixed error must come off,
 *     so the list only ever shrinks and cannot quietly hide a new error that
 *     happens to share a count with an old one
 *
 * AN ERROR IS KEYED ON ITS FILE, ITS CODE, ITS MESSAGE AND THE TEXT OF THE LINE
 * it points at, not on the line number. Code moving down a file changes no key;
 * a new error, or an old error on a different line of code, does.
 *
 * DENO MISSING IS A FAILURE, not a skip. A check that quietly does not run is a
 * gate reporting green about something it never looked at.
 *
 * To rewrite the list after fixing errors:  node tests/typecheck.test.mjs --write-baseline
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const BASELINE = join(ROOT, 'tests/typecheck-baseline.txt')
const ENTRIES = ['supabase/functions/api/index.ts', 'supabase/functions/verify/index.ts',
                 'supabase/functions/main/index.ts']

function findDeno() {
  const fromPath = spawnSync('sh', ['-c', 'command -v deno'], { encoding: 'utf8' }).stdout.trim()
  if (fromPath) return fromPath
  const home = join(homedir(), '.deno/bin/deno')
  return existsSync(home) ? home : ''
}

console.log('1. deno is here to ask')
const deno = findDeno()
ok(!!deno, 'deno is installed (PATH or ~/.deno/bin) — see SETUP.md; a missing checker is a failure, not a pass')
if (!deno) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1) }

const run = spawnSync(deno, ['check', ...ENTRIES], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 64 << 20,
})
const out = (run.stdout ?? '') + (run.stderr ?? '')

/* Every error, as "file | code | message | source line". */
const found = []
const lines = out.split('\n')
for (let i = 0; i < lines.length; i++) {
  const head = /^(TS\d+) \[ERROR\]: (.*)$/.exec(lines[i])
  if (!head) continue
  let at = null
  for (let j = i + 1; j < lines.length && j < i + 40; j++) {
    const m = /^\s+at file:\/\/(.+):(\d+):(\d+)$/.exec(lines[j])
    if (m) { at = m; break }
    if (/^TS\d+ \[ERROR\]/.test(lines[j])) break
  }
  if (!at) { found.push(`? | ${head[1]} | ${head[2]} | (no location)`); continue }
  const file = relative(ROOT, at[1])
  let src = ''
  try { src = readFileSync(at[1], 'utf8').split('\n')[Number(at[2]) - 1]?.trim() ?? '' } catch { /* keep blank */ }
  found.push(`${file} | ${head[1]} | ${head[2]} | ${src}`)
}
found.sort()

const summary = /Found (\d+) errors?/.exec(out)
const claimed = summary ? Number(summary[1]) : (run.status === 0 ? 0 : -1)

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, found.join('\n') + (found.length ? '\n' : ''))
  console.log(`wrote ${found.length} errors to tests/typecheck-baseline.txt`)
  process.exit(0)
}

console.log('2. the output was read, not just the exit code')
/* A parse that finds nothing passes everything below it. */
ok(claimed >= 0, `deno said how many errors it found (exit ${run.status})`)
ok(found.length === claimed,
   `every error deno counted was parsed (${found.length} parsed, ${claimed} counted)` +
   (found.length === claimed ? '' : '\n' + out.split('\n').slice(-15).join('\n')))
ok(!/error: (Module not found|Import|Relative import|Failed)/i.test(out),
   'no module failed to resolve (that is a broken check, not a type error)')

console.log('3. no type error that is not already on the list')
const baseline = existsSync(BASELINE)
  ? readFileSync(BASELINE, 'utf8').split('\n').filter(Boolean)
  : []
ok(existsSync(BASELINE), 'tests/typecheck-baseline.txt exists')
const count = (list) => list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())
const want = count(baseline), got = count(found)
for (const [k, n] of got) {
  const allowed = want.get(k) ?? 0
  ok(n <= allowed, `NEW type error${n - allowed > 1 ? ` x${n - allowed}` : ''}: ${k}`)
}

console.log('4. and none on the list that has since been fixed')
for (const [k, n] of want) {
  const now = got.get(k) ?? 0
  ok(now >= n, `fixed, so take it off tests/typecheck-baseline.txt: ${k}`)
}

console.log(`\n${pass} passed, ${fail} failed  (${found.length} known type errors remain)`)
process.exit(fail ? 1 : 0)
