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
import { existsSync, readFileSync } from 'node:fs'

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

/*
 * ---------------------------------------------------------------------------
 * AND THE SAME QUESTION ASKED WITHOUT ESLINT, because eslint is blind to a name.
 *
 * `vue/no-undef-components` does not flag `<Ink>`. Every other component name
 * in this repo reports — tested one at a time, 21 of the 22 in ui/ are caught
 * and `Ink` alone is silent. It is not the config (no ignorePatterns) and not
 * the tag tables (isHtmlWellKnownElementName, isSvgWellKnownElementName and
 * isMathWellKnownElementName all return false for `Ink` and `ink`), so the
 * mechanism is upstream and unknown.
 *
 * What makes that worth a second check rather than a bug report is WHICH name
 * it is. Inspector.vue used `<Ink>` without importing it from e6db02e onward,
 * so the studio's colour control for a text element never rendered once. The
 * one real instance of this bug in the tree is the one the guard cannot see.
 *
 * SO THIS ASSERTS THE POSITIVE. The block above trusts the ABSENCE of an eslint
 * error, which is the shape that fails when the checker and the thing checked
 * can fail together. This one counts the good signal instead: every capitalised
 * tag in a template has a matching import in that file's script. It does not
 * care what eslint's tables think, and it cannot be blind to a name, because it
 * never consults a list of names.
 *
 * Proved red before it was trusted green: run against HEAD's Inspector.vue it
 * reports `Ink`, and against HEAD's AppShell.vue — nine imported components —
 * it reports nothing.
 *
 * WHAT IT CANNOT DO: it reads text, not modules. A component registered
 * globally, or resolved dynamically through `<component :is>`, is invisible to
 * it. Nothing here does either, and if something starts to, this is the file
 * that has to learn about it rather than the rule to delete.
 */
import { readdirSync, statSync } from 'node:fs'

const BUILTIN = new Set([
  'Transition', 'TransitionGroup', 'KeepAlive', 'Teleport', 'Suspense', 'Component',
])

const vueFiles = (dir, acc = []) => {
  for (const f of readdirSync(dir)) {
    const p = dir + '/' + f
    statSync(p).isDirectory() ? vueFiles(p, acc) : (f.endsWith('.vue') && acc.push(p))
  }
  return acc
}

/*
 * Every name an import statement brings into scope: the default, the named
 * bindings, and the local half of `as`. Written out rather than regexed in one
 * pass because `import X, { a as b } from` has three shapes in one line and a
 * single pattern over it silently misses two of them — which would make this
 * check report components that are imported, i.e. noise, i.e. a check nobody
 * leaves switched on.
 */
const importedNames = (script) => {
  const names = new Set()
  for (const m of script.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/gm)) {
    const clause = m[1]
    for (const b of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const part of b[1].split(',')) {
        const t = part.trim()
        if (t) names.add((t.split(/\s+as\s+/).pop() || t).trim())
      }
    }
    const dflt = clause.replace(/\{[^}]*\}/g, '').replace(/,/g, ' ').trim()
    if (dflt && /^[A-Za-z_$][\w$]*$/.test(dflt)) names.add(dflt)
  }
  return names
}

// Comments are stripped first: a <Foo> inside an HTML comment is prose about
// the markup, not markup, and flagging it teaches people to comment less.
const usedComponents = (tpl) => new Set(
  [...tpl.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)].map((m) => m[1]))

const files = vueFiles(ROOT + 'src')
ok(files.length > 40, `read every component (${files.length} .vue files)`)

let undef = 0
let checked = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const tpl = (src.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1]
  if (!tpl.trim()) continue
  const script = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
  const imported = importedNames(script)
  for (const c of usedComponents(tpl)) {
    checked++
    if (BUILTIN.has(c) || imported.has(c)) continue
    undef++
    console.log(`  FAIL ${f.replace(ROOT, '')} uses <${c}> and never imports it`)
  }
}
fail += undef

/*
 * The count is asserted, not merely the absence of failures. A scan that walked
 * no files, or a template regex that matched nothing, reports zero undefined
 * components — which is the same output as a clean repo at exactly the moment
 * you need to tell them apart.
 */
ok(checked > 100, `and actually looked at the tags in them (${checked} component uses)`)
ok(undef === 0, `every component used in a template is imported in that file (${undef} are not)`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
