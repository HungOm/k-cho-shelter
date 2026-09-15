/*
 * No test may anchor a source slice on a comment.
 *
 * Tests here slice one function out of a file to run it, using indexOf. Two of
 * them ended that slice at a COMMENT — '/**\n * The old route' and
 * '<!-- something went wrong -->'. Rewording prose, which everybody does
 * freely, would have moved the end marker; indexOf then returns -1 and
 * slice(start, -1) runs to the end of the file, so the test carries on
 * examining a region it did not name and reports on it confidently.
 *
 * A comment is the least stable text in a file and the one nothing else
 * depends on, which is exactly what makes it look like a safe landmark.
 *
 * FOUND BY EXPERIMENT, not by reading: stripping every comment from src/ and
 * re-running the suite turned up three files, two of them anchored this way.
 * That audit is too slow and too crude to keep — it damaged a .vue file while
 * stripping — so this is the cheap standing version of the same question.
 *
 * WHAT IT CANNOT SEE: an assertion whose PATTERN is satisfied by prose rather
 * than by code. cut() does not help there; stripping comments before matching
 * does, and three tests already do. This covers the slicing half only.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('./', import.meta.url))
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const files = readdirSync(DIR).filter(f => /\.(test\.(mjs|cjs)|mjs)$/.test(f) && f !== 'sourceanchors.test.mjs')
ok(files.length > 50, `the test directory was read (${files.length} files)`)

// A marker that begins a comment in any language used here.
const PROSE = /indexOf\(\s*(['"`])\s*(\/\*|\/\/|<!--|--\s|\*\s)/

let offenders = 0
for (const f of files) {
  const src = readFileSync(DIR + f, 'utf8')
  const bad = src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => PROSE.test(line))
  for (const [n, line] of bad) {
    offenders++
    console.log(`  FAIL ${f}:${n} anchors a slice on a comment — ${line.trim().slice(0, 70)}`)
  }
}
ok(offenders === 0, 'no test slices a source file at a comment')

// And the helper that makes doing it properly no harder than doing it wrong.
const helper = readFileSync(DIR + 'source.mjs', 'utf8')
ok(/export function cut\(/.test(helper), 'cut() exists, so a slice can fail by name')
ok(/could not find the start of/.test(helper) && /could not find the end of/.test(helper),
   'and says which end it could not find, rather than returning -1')
ok(/export function codeOf\(/.test(helper),
   'codeOf() exists for the other half — a pattern satisfied by prose')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
