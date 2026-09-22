/*
 * An immediate watcher must come after the refs its callback writes.
 *
 * THE BUG THIS EXISTS FOR. Admin.vue had `watch(c, loadBands, { immediate:
 * true })` sitting thirty lines ABOVE `const bands = ref(...)`. `immediate`
 * means the callback runs synchronously as the watcher is created, so it
 * reached `bands.value` inside that const's temporal dead zone and threw
 * ReferenceError on every single mount. The supporter titles never loaded:
 * the organiser opened Setup and saw an empty rung list and no preset
 * selected, forever, and nothing on the screen or in the suite said why.
 *
 * NOTHING COULD SEE IT. Vue catches a watcher callback's throw and hands it to
 * the app's error handler; this app installs none, so it goes to console and
 * the screen simply renders the un-loaded state. The build passes — the code
 * is valid JavaScript, it is only in the wrong ORDER. Every other suite passed
 * too: the handler is right, the save is right, the layout is right, and none
 * of them run setup with an immediate watcher at the top of the file.
 *
 * IT WAS ALREADY KNOWN, WHICH IS THE ARGUMENT FOR A TEST. TicketDesign.vue
 * carries a comment above `cardState` explaining that it is declared where it
 * is *because* loadCard runs from an immediate watcher during setup, and that
 * a const further down "would be in its temporal dead zone at that moment,
 * which is a blank screen and one line in a console". Somebody reasoned this
 * out by hand, wrote it down, got it right — and the next instance of it, in a
 * sibling file, shipped broken anyway. A hazard that has to be remembered at
 * every `watch` call is one that should be checked instead of remembered.
 *
 * WHY A RULE AND NOT A FIXTURE. The house pattern in this file is refs, then
 * the loader, then the watch, written by hand in six places. Five of them are
 * ordered correctly and the sixth drifted during an edit — which is the shape
 * of a mistake that recurs, because nothing about the wrong order looks wrong.
 *
 * WHAT THIS CANNOT DO. It reads named-function handlers only, so an inline
 * arrow body (SignIn.vue, PrintTickets.vue) is not inspected — those close
 * over what is above them and are declared at the point of use, so the mistake
 * is much harder to make there. It also matches the single-line `watch(...)`
 * form the repo uses; a multi-line watch call would be skipped silently, which
 * is why the count of watchers found is asserted before anything is checked.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/components/', import.meta.url))

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/**
 * Comments out, every newline kept.
 *
 * codeOf() in source.mjs collapses a block comment to one space, which is
 * right for "does the code say X" and wrong here: this test compares POSITIONS,
 * so a stripper that shortens the file would move every offset after it.
 */
const blank = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))

const lineOf = (src, at) => src.slice(0, at).split('\n').length

/** Every .vue under src/components, one level of subdirectory deep. */
function components(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) components(join(dir, e.name), out)
    else if (e.name.endsWith('.vue')) out.push(join(dir, e.name))
  }
  return out
}

/** The body of `function NAME(...) { ... }`, by brace matching. */
function bodyOf(src, name) {
  const m = new RegExp('\\bfunction\\s+' + name + '\\s*\\(').exec(src)
  if (!m) return null
  let i = src.indexOf('{', m.index)
  if (i < 0) return null
  for (let d = 0, j = i; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1)
  }
  return null
}

const WATCH = /\bwatch\([^\n]*?,\s*([A-Za-z_$][\w$]*)\s*,\s*\{[^\n]*immediate:\s*true/g

console.log('every immediate watcher sits below the refs its callback touches')
let watchers = 0, checked = 0
{
  for (const file of components(SRC)) {
    const src = blank(readFileSync(file, 'utf8'))
    const where = file.slice(file.indexOf('/components/') + 1)
    for (const m of src.matchAll(WATCH)) {
      const [, handler] = m
      const body = bodyOf(src, handler)
      if (!body) continue          // an imported or arrow-assigned handler
      watchers++
      for (const r of new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*)\.value\b/g)].map((x) => x[1]))) {
        const decl = new RegExp('\\b(?:const|let)\\s+' + r + '\\s*=').exec(src)
        if (!decl) continue        // imported, or a prop — not this file's to order
        checked++
        ok(decl.index < m.index,
          `${where}: watch(..., ${handler}, { immediate: true }) on line ${lineOf(src, m.index)} runs before `
          + `${r} is declared on line ${lineOf(src, decl.index)}, so it reads that const inside its dead zone`)
      }
    }
  }
}

/*
 * The parse has to prove it found something. A regex that stops matching gives
 * a loop that runs zero times and a suite that passes having read nothing —
 * and this one matches a single-line call shape, which a reformat could break.
 */
console.log('the scan actually read the watchers it claims to cover')
{
  ok(watchers >= 5, `found ${watchers} immediate watchers with a named handler, expected at least 5`)
  ok(checked >= 8, `inspected ${checked} watcher/ref pairs, expected at least 8`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
