/*
 * ONE ID, ONE WORD — no template retypes a label a vocabulary already owns.
 *
 * THE BUG THIS EXISTS FOR, found by this file on the day it was written.
 * `BOOK_WORDS.Unassigned` is "In the office". `BookAction.vue` — the dialog
 * that PUTS a book there — offered "Back in the office" for the same id, typed
 * inline, in a file that already imports from format.js and simply did not
 * import that map. So a volunteer chose one phrase in the dialog and saw a
 * different one on the book a second later, for the state they had just set.
 *
 * WHY IT MATTERS MORE HERE THAN IT LOOKS. This raffle is supported over the
 * phone: `rolewords.test.mjs` exists because an organiser reads a word aloud
 * and the person on the other end has to find it on their own screen. A state
 * with two names is that failure with the two screens one tap apart instead of
 * one phone call apart.
 *
 * ── WHAT IT CHECKS, AND THE LINE IT DOES NOT CROSS ──────────────────────────
 *
 * It checks INLINE LITERALS ONLY: `<option value="X">Word</option>` where X is
 * a key of a shared vocabulary. It does NOT check whether two named constants
 * agree about the same id, and that restraint is the whole design.
 *
 * `FAMILIES` in ticketelements.js names the two typefaces Padauk and Times.
 * `FACES` in CardInspector.vue names the SAME two ids Everyday and Figures.
 * That is not drift — it is a decision, with its reason written above it: a
 * print shop asks which font, and nobody asks that of a picture sent on
 * WhatsApp. A test that demanded one word per id across both would delete a
 * decision, and it would be the reading of P2's objective that makes
 * interfaces worse, since eq. (14) asks for consistency IN PROPORTION TO
 * SIMILARITY rather than everywhere.
 *
 * So the distinction this file draws is: a second NAMED CONSTANT, with a
 * comment, is a choice somebody made and can defend. A string retyped into a
 * template is a copy, and a copy drifts — which is precisely what
 * BookAction.vue proves, since two of its three copies still matched and the
 * third did not.
 *
 * (The same mistake in its worst form was DecorationInspector.vue, which
 * hard-coded a copy of the DIGITAL card's two words and used them on the
 * PRINTED tab — so one rail offered two ways to put words on a ticket, forty
 * lines apart, naming the same font differently. Fixed in 1343354 by importing
 * the constant. This file is the gate that would have refused it.)
 *
 * WHAT IT CANNOT DO. It sees `<option>` with a literal value and literal text.
 * A label built by interpolation, a `:value` binding, or a word rendered
 * anywhere other than an option is invisible to it. Widening it to "any string
 * that equals a vocabulary word" would flag every legitimate use of the word
 * in prose, which is a category-shaped rule and would be switched off within a
 * week. Narrow and mechanical beats broad and argued.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))

const vues = (dir, acc = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue
    const p = dir + '/' + f
    statSync(p).isDirectory() ? vues(p, acc) : (f.endsWith('.vue') && acc.push(p))
  }
  return acc
}

/*
 * THE VOCABULARIES, BY NAME. Not "every exported object that looks like a map"
 * — that is a category, and a category quietly adopts the next constant
 * somebody exports, including ones whose values are not labels at all. Each
 * entry here is a map from a stored value to the word a person reads.
 */
const VOCABULARIES = [
  ['STATUS_WORDS', 'src/lib/format.js'],
  ['BOOK_WORDS', 'src/lib/format.js'],
  ['ROLE_WORDS', 'src/lib/format.js'],
]

/*
 * NAMED EXCEPTIONS, each with its reason, and checked below for staleness.
 * Empty on the day this was written: BookAction.vue's drift was fixed rather
 * than exempted, because a dialog that sets a state should offer the word the
 * state will then be called.
 */
const ALLOWED = new Map([
  // ['components/modals/Foo.vue Unassigned', 'why this one legitimately differs'],
])

console.log('the vocabularies were read')
const words = new Map()   // key -> { word, from }
{
  let parsed = 0
  for (const [name, file] of VOCABULARIES) {
    const src = stripComments(readFileSync(ROOT + file, 'utf8'))
    const block = new RegExp(`export const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
    ok(!!block, `${name} is declared in ${file}`)
    if (!block) continue
    let n = 0
    for (const m of block[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'/gm)) {
      words.set(m[1], { word: m[2], from: name })
      n++
    }
    ok(n > 0, `${name} has entries (${n})`)
    parsed += n
  }
  /* The parse guard. A renamed export or a reformatted object leaves every
     map empty, and an empty map matches no option, which is a clean green run
     that has checked nothing at all. */
  ok(parsed >= 15, `enough vocabulary to be worth checking (${parsed} words)`)
}

/**
 * Every inline option in one file whose label disagrees with its vocabulary.
 * A function so the self-test below can run the REAL matcher over a sample
 * rather than a copy of it that could drift from the thing being shipped.
 */
function driftIn(rel, src) {
  const out = []
  let seen = 0
  for (const m of stripComments(src).matchAll(/<option\s+value="([^"{]+)"\s*>([^<]+)<\/option>/g)) {
    seen++
    const [, value, label] = m
    const known = words.get(value)
    if (!known) continue
    const got = label.trim()
    if (got === known.word) continue
    if (ALLOWED.has(`${rel} ${value}`)) continue
    out.push(`${rel}: <option value="${value}"> says “${got}”, `
      + `but ${known.from}.${value} is “${known.word}” — import the map rather than `
      + `retyping it, or the two drift and only one of them is on the book`)
  }
  return { drift: out, seen }
}

console.log('the matcher itself works, proved against a sample rather than assumed')
{
  /*
   * WHY THIS BLOCK EXISTS, and it is not belt-and-braces.
   *
   * The obvious guard — "assert some option matched a vocabulary value" —
   * is WRONG here, and quietly so: the correct end state of this gate is that
   * NO template retypes a vocabulary word, at which point the intersection is
   * legitimately zero and the guard fires on a clean codebase. A guard that
   * goes red when the work is finished is a guard somebody deletes.
   *
   * So the scan is proved on a sample instead. This asserts the whole path
   * end to end — the parsed map, the regex, the lookup, the comparison — and
   * keeps asserting it when the tree has nothing left to find.
   */
  const sample = `<select>
      <option value="Unassigned">Somewhere else entirely</option>
      <option value="Unassigned">${words.get('Unassigned')?.word}</option>
      <option value="not-a-vocabulary-value">Left alone</option>
    </select>`
  const { drift, seen } = driftIn('SAMPLE', sample)
  ok(seen === 3, `the option regex reads a sample (${seen} of 3)`)
  ok(drift.length === 1, `it flags a word that disagrees, and only that one (${drift.length} of 1)`)
  ok(/Unassigned/.test(drift[0] || ''), 'and names the id it disagreed about')
}

console.log('and no template retypes a word one of them owns')
{
  const files = vues(ROOT + 'src')
  ok(files.length > 30, `read the components (${files.length} files)`)

  let inspected = 0
  const drift = []
  for (const f of files) {
    const rel = f.replace(ROOT + 'src/', '')
    const r = driftIn(rel, readFileSync(f, 'utf8'))
    inspected += r.seen
    drift.push(...r.drift)
  }

  /* Asserted before the verdict: a regex that stops matching gives zero
     options, zero drift and a clean green run. Zero-inspected is a broken
     scan, not a tidy codebase. */
  ok(inspected >= 4, `found literal <option> labels in the tree (${inspected})`)
  for (const d of drift) console.log('  FAIL ' + d)
  fail += drift.length
  ok(drift.length === 0, `every retyped label matches its vocabulary (${drift.length} do not)`)
}

console.log('and the exception list still describes something real')
{
  /* An allowlist whose entries have been fixed stops constraining anything and
     nobody notices, which is the same failure as a test that asserts nothing.
     tokens.test.mjs and reachableclass.test.mjs both check this; so does this. */
  const stale = []
  for (const key of ALLOWED.keys()) {
    const [rel, value] = key.split(' ')
    let live = false
    try {
      const src = stripComments(readFileSync(ROOT + 'src/' + rel, 'utf8'))
      live = new RegExp(`<option\\s+value="${value}"\\s*>`).test(src)
    } catch { live = false }
    if (!live) stale.push(`${key} is exempted but no longer exists`)
  }
  for (const s of stale) console.log('  FAIL ' + s)
  fail += stale.length
  ok(stale.length === 0, `the exception list names only live cases (${ALLOWED.size} entries)`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
