/*
 * A CONTROL THAT CHOOSES BETWEEN PICTURES HAS TO SHOW THE PICTURES.
 *
 * WHY, WITH A NUMBER. Putkonen et al. (IJHCS 199:103483, 2025) measured 84
 * people over 10,282 searches of real interfaces. Being shown the target as a
 * PICTURE rather than described in WORDS made it 1.28-1.45 s faster to find,
 * every time. That is the second-largest effect in their data, behind only the
 * target not being there at all. A dropdown of names, over a set of things that
 * look different, spends that gap on every single use.
 *
 * This repo worked it out independently three times before the paper was read.
 * TemplateRail.vue: "A template is recognised by its picture, so the picture is
 * the control." LibraryPanel.vue: "Everything else is a click on a picture of
 * itself." The Place rail's shapes: "A rectangle, an ellipse and a line ARE
 * their icons." The gate exists to keep those three, not to introduce the idea.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Two halves, because a rule with only the negative half rots.
 *
 * 1. PROTECT what already shows the thing. Four controls render what they
 *    choose, and each is checked by the mechanism it uses. If somebody
 *    "simplifies" the typeface segment back into a dropdown, this goes red —
 *    which is the regression worth catching, because the dropdown is the
 *    tidier-looking code and the worse control.
 *
 * 2. ENUMERATE every <select> and require each to be declared, by name, in
 *    exactly one of two lists: it names things that genuinely are not pictures,
 *    or it is a known case that should show one and does not.
 *
 * WHY TWO LISTS RATHER THAN ONE. An allow-list alone fails open: the next
 * <select> somebody writes is simply absent from it and nothing notices. A
 * deny-list alone is "everything except X", which this repo has paid for four
 * times. Requiring EVERY hit to be in one of the two named lists means a new
 * control cannot pass by being unmentioned — it fails with "put it in a list",
 * and somebody has to decide which. The design is kcho-shelter-25's; the first
 * draft of this file had the failing shape.
 *
 * WHAT IT CANNOT DO. It cannot tell whether a set of things "looks different" —
 * that is the judgement the lists record. A seller's name is not a picture and
 * no test can discover that; somebody has to say so once. It also only sees
 * <select>, so a button grid that names things instead of drawing them is
 * invisible here and is review's job.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
const read = (rel) => stripComments(readFileSync(ROOT + 'src/' + rel, 'utf8'))

const vues = (dir, acc = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue
    const p = dir + '/' + f
    statSync(p).isDirectory() ? vues(p, acc) : (f.endsWith('.vue') && acc.push(p))
  }
  return acc
}

/*
 * THE FOUR THAT SHOW THE THING, each with the mechanism that makes it true.
 * The pattern is what is asserted, not merely that the file still exists — a
 * component can keep its name and lose its point.
 */
const SHOWS_THE_THING = [
  ['components/ticketdesign/Lettering.vue', /:style="\{\s*fontFamily:/,
   'each typeface option is SET in that typeface'],
  ['components/ticketdesign/TemplateRail.vue', /<img\s+:src="t\.url"/,
   'each template is its own thumbnail'],
  ['components/ticketdesign/LibraryPanel.vue', /v-html="tile\(/,
   'each saved shape is drawn, not named'],
  ['components/ui/Ink.vue', /:style="\{\s*background:/,
   'each colour is a swatch of itself'],
]

/*
 * EVERY <select> IN THE APP, declared. A seller, a status, a data field and a
 * sort order are words — a dropdown is the right control and naming them is
 * not a defect. The point of listing them is that the list must be COMPLETE,
 * so a new one cannot arrive unnoticed.
 */
const NAMES_WORDS_AND_THAT_IS_RIGHT = {
  'components/Search.vue': 3,          // status, seller, where it is
  'components/Books.vue': 1,           // seller filter
  'components/Money.vue': 1,           // sort order
  'components/modals/WinnerForm.vue': 1,
  'components/modals/UserForm.vue': 1,
  'components/modals/PrizeForm.vue': 2,
  'components/modals/BookAction.vue': 2,
  'components/modals/IssueBooks.vue': 1,
  'components/ticketdesign/Inspector.vue': 1,  // which FIELD prints here
}

/*
 * KNOWN, OPEN, AND OWNED. A control that chooses between pictures and offers
 * words. Listed rather than fixed because the file is being edited by another
 * session; listed rather than ignored because an unlisted one is how this comes
 * back. Shrink-checked below, so a fix cannot leave a stale entry behind.
 */
const NAMES_A_PICTURE = {
  'components/TicketDesign.vue': [1,
    'the template picker — UI-EVIDENCE F3. A template IS a picture and the '
    + 'thumbnails already exist in TemplateRail, reachable only on the Artwork '
    + 'tab. The fix is a thumbnail BESIDE the select, not instead of it, so the '
    + 'control stays keyboard-navigable. Held: TicketDesign.vue is in use by '
    + 'design-editor-ui-standards.'],
}

console.log('the controls that show what they choose still show it')
{
  let checked = 0
  for (const [rel, pattern, what] of SHOWS_THE_THING) {
    let src = ''
    try { src = read(rel) } catch { ok(false, `${rel} is missing — ${what}`); continue }
    checked++
    ok(pattern.test(src), `${rel}: ${what}`)
  }
  ok(checked === SHOWS_THE_THING.length,
     `read every protected control (${checked} of ${SHOWS_THE_THING.length})`)
}

console.log('and every dropdown in the app is declared in exactly one list')
{
  const files = vues(ROOT + 'src')
  ok(files.length > 30, `read the components (${files.length} files)`)

  const found = new Map()
  let total = 0
  for (const f of files) {
    const rel = f.replace(ROOT + 'src/', '')
    const n = (stripComments(readFileSync(f, 'utf8')).match(/<select[\s>]/g) || []).length
    if (n) { found.set(rel, n); total += n }
  }

  /* The parse guard, asserted before any verdict. A regex that stops matching
     finds no dropdowns, contradicts no list, and passes having read nothing. */
  ok(total >= 10, `found the dropdowns (${total} across ${found.size} files)`)

  const problems = []
  for (const [rel, n] of found) {
    const wordy = NAMES_WORDS_AND_THAT_IS_RIGHT[rel]
    const picture = NAMES_A_PICTURE[rel]
    if (wordy !== undefined && picture !== undefined) {
      problems.push(`${rel} is in BOTH lists — it can only be one`)
      continue
    }
    if (wordy === undefined && picture === undefined) {
      problems.push(`${rel} has ${n} <select> and is in neither list. Decide: `
        + `does it choose between things that LOOK different? If yes it should `
        + `show them (an image cue is worth ~1.3 s per use) — add it to `
        + `NAMES_A_PICTURE with an owner. If no, add it to `
        + `NAMES_WORDS_AND_THAT_IS_RIGHT with its count.`)
      continue
    }
    const want = wordy !== undefined ? wordy : picture[0]
    if (n !== want) {
      problems.push(`${rel} has ${n} <select>, but its list says ${want} — a `
        + `dropdown was added or removed and the list did not move with it`)
    }
  }

  /* Stale entries, the other direction: a list naming a file that has no
     dropdown left has stopped constraining anything and nobody can tell. */
  for (const rel of [...Object.keys(NAMES_WORDS_AND_THAT_IS_RIGHT), ...Object.keys(NAMES_A_PICTURE)])
    if (!found.has(rel)) problems.push(`${rel} is listed but has no <select> any more — remove it`)

  for (const p of problems) console.log('  FAIL ' + p)
  fail += problems.length
  ok(problems.length === 0, `every dropdown is accounted for (${problems.length} are not)`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
