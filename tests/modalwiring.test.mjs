/*
 * Every button that opens a screen has a screen to open.
 *
 * This has now failed twice, the same way both times. A button calls
 * openModal('winner'); App.vue has no branch for 'winner'; the click is taken,
 * the state is set, and nothing renders. The button is not disabled and not
 * greyed — it looks live, and pressing it does nothing at all. Nothing throws,
 * the console stays clean, and the build passes, because a string that matches
 * no branch is perfectly valid Vue.
 *
 * It is the worst shape of bug for a volunteer: there is no error to report, so
 * they conclude the app is broken in some general way, or that they are doing
 * it wrong. The first time it was the handover receipt. The second was adding a
 * winner, found by somebody trying to test the draw.
 *
 * So: the two sets have to match exactly, both directions. A kind that opens
 * nothing is a dead button. A branch nothing opens is a screen no one can reach
 * — less urgent, more confusing, and the same class of mistake.
 */
import { readFileSync } from 'node:fs'
const ROOT = new URL('..', import.meta.url).pathname
const app = readFileSync(ROOT + 'src/App.vue', 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const opened = [...app.matchAll(/openModal\(\s*'([a-zA-Z]+)'/g)].map(m => m[1])
const rendered = [...app.matchAll(/modal\?\.kind\s*===\s*'([a-zA-Z]+)'/g)].map(m => m[1])

console.log('the file was actually read')
{
  // A matcher that silently matches nothing reports a clean result, and a
  // clean result and a broken one look identical from outside.
  ok(app.length > 2000, 'App.vue is not empty')
  ok(opened.length >= 10, `found the openModal calls: ${opened.length}`)
  ok(rendered.length >= 10, `found the render branches: ${rendered.length}`)
}

console.log('every button opens something')
{
  const dead = [...new Set(opened)].filter(k => !rendered.includes(k))
  ok(dead.length === 0,
    `these set a modal kind nothing renders — the button would do nothing: ${dead.join(', ')}`)
}

console.log('and every screen is reachable')
{
  const orphan = [...new Set(rendered)].filter(k => !opened.includes(k))
  ok(orphan.length === 0, `these render for a kind nothing ever sets: ${orphan.join(', ')}`)
}

console.log('and each screen is imported')
{
  // A branch naming a component that was never imported fails at build, so this
  // is belt and braces — but it costs nothing and names the file if it happens.
  // Any component, not just ones under modals/ — SellTicket is rendered as a
  // modal branch and lives a directory up.
  const imports = [...app.matchAll(/^import\s+(\w+)\s+from\s+'\.\/components\//gm)].map(m => m[1])
  ok(imports.length >= 10, `found the modal imports: ${imports.length}`)

  // Each branch line should carry a component whose tag is imported.
  const branches = [...app.matchAll(/<(\w+)\s[^>]*modal\?\.kind\s*===\s*'([a-zA-Z]+)'/g)]
  ok(branches.length >= 10, `matched branch tags: ${branches.length}`)
  const missing = branches.filter(([, tag]) => !imports.includes(tag)).map(([, tag]) => tag)
  ok(missing.length === 0, `rendered but not imported: ${missing.join(', ')}`)
}

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
