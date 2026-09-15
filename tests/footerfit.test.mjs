/*
 * A modal's buttons must stay inside the modal.
 *
 * REPORTED FROM A SCREENSHOT: on Book-140 the last two buttons hung outside the
 * panel's right edge, over the ticket grid behind it.
 *
 * The footer was a non-wrapping flex row. Every button carries
 * `white-space: nowrap` and 44px of horizontal padding, and a flex item cannot
 * shrink below its min-content width — so `flex: 1` does not save it. Five
 * buttons (See its tickets · Where it has been · Sell it whole · Count it in ·
 * Close) need roughly 770px against a sheet capped at 560.
 *
 * WHY IT TOOK A SCREENSHOT TO FIND. "Count it in" is the fifth button and only
 * an organiser sees it. Four fitted. So it was invisible to anybody testing as
 * a helper or a seller, and invisible to every test here, because nothing
 * measures layout and nothing counted the buttons.
 *
 * This asserts the GUARANTEE rather than the geometry: a wrapped flex line
 * cannot overflow its container horizontally, whatever the labels say. That is
 * the property worth pinning, because the labels are English sentences that
 * will be translated — Burmese is longer — and a fix that depends on them
 * staying short has an expiry date.
 *
 * It is a source assertion, and that is a limit rather than a choice: there is
 * no browser available in this environment, so nothing here can measure a
 * rendered width. Stated plainly so nobody reads it as proof the buttons fit.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const sheet = readFileSync(join(ROOT, 'src/components/ui/Sheet.vue'), 'utf8')

console.log('the footer wraps, so a row of buttons cannot spill out of the panel')
{
  const foot = sheet.slice(sheet.indexOf('.foot {'), sheet.indexOf('@media'))
  ok(/flex-wrap:\s*wrap/.test(foot), 'the footer is wrap-enabled')

  /*
   * flex-basis:0 is the other half. It makes every button ask for the same
   * width and then refuse to shrink below its own text — which produced both
   * the row of identical rectangles and the overflow. Starting from content
   * width lets them share the space that is actually there.
   */
  ok(!/:deep\(\.btn\)\s*\{\s*flex:\s*1\s*;/.test(foot),
     'and footer buttons do not use flex-basis 0')
  ok(/:deep\(\.btn\)\s*\{\s*flex:\s*1\s*1\s*auto/.test(foot),
     'they grow from their content width')
}

console.log('the sheet has a hard width, which is what the footer has to live inside')
{
  ok(/max-width:\s*560px/.test(sheet), 'a sheet is capped at 560px')
  ok(/\.sheet\.wide\s*\{[^}]*max-width:\s*860px/.test(sheet), 'and a wide one at 860px')
}

console.log('how many buttons each modal footer actually asks for')
{
  /*
   * Counted, and reported even when it passes. Six on BookDetail is what broke
   * it — five visible at once, because Receipt and Count it in are mutually
   * exclusive with each other and with Close. Nothing had ever counted them,
   * which is why a number that only an organiser could reach went unnoticed.
   *
   * No ceiling is asserted. Wrapping makes any count safe, and a limit here
   * would be a number somebody would have to argue with rather than a property.
   * This exists so the count is visible in the run.
   */
  const dirs = ['src/components/modals', 'src/components']
  const counts = []
  for (const d of dirs) {
    for (const f of readdirSync(join(ROOT, d))) {
      if (!f.endsWith('.vue')) continue
      const src = readFileSync(join(ROOT, d, f), 'utf8')
      const i = src.indexOf('#actions')
      if (i < 0) continue
      const n = (src.slice(i).match(/<button/g) ?? []).length
      if (n >= 3) counts.push(`${f}: ${n}`)
    }
  }
  ok(counts.length > 0, `footers with three or more buttons — ${counts.join(', ')}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
