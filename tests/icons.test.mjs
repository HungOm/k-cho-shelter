/*
 * An icon that does not exist, and the three ways this set could stop being
 * language-independent.
 *
 * WHY THIS IS NEEDED. Icon.vue answered an unknown name with `more` — the
 * three-dot ellipsis, which is a REAL control in the sidebar. A misspelt name
 * therefore drew a plausible button that did nothing unusual, so the mistake
 * arrived at whoever was looking at the screen rather than at whoever typed
 * it. Nothing in the suite mentioned Icon.vue at all, and the ticket studio is
 * being extracted right now against about twenty new names. That is a typo
 * looking for somewhere to land.
 *
 * WHY IT MATTERS MORE HERE THAN IN MOST APPS. Every label in this app is
 * English with a Burmese gloss under it, so on a control the icon is often the
 * only part that needs no language at all. A drawing that carries a letter is
 * a drawing that has quietly become text — untranslated, and unreadable to the
 * volunteer it was for. So the table is checked for letters, for colours that
 * would not follow dark mode, and for names nobody can reach.
 *
 * WHAT THIS CANNOT DO is tell you an icon is the WRONG drawing. That `bleed`
 * shows crop marks rather than a paint bucket is a judgement, and no test
 * holds a judgement. It can only hold that something is drawn, that it is
 * reachable, and that it is made of the things this set is made of.
 *
 * ONE KNOWN FALSE POSITIVE, stated so it is not a surprise: the scan for names
 * in use reads every `icon: '…'` in src/, which is where AppShell.vue and
 * store.js keep theirs. An unrelated object that happens to use the key
 * `icon:` for something that is not an icon name would fail here. That has not
 * happened, and the alternative — scanning only the four files that contain
 * `<Icon` — would miss store.js, which is precisely where the names live.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cut, codeOf } from './source.mjs'
import { renderScreen } from './screen.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ICON = 'src/components/ui/Icon.vue'
const src = readFileSync(join(ROOT, ICON), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/*
 * THE TABLE, READ OUT OF THE COMPONENT — and the parse is checked before it is
 * trusted.
 *
 * Every loop below runs over what this regex found. If the table were
 * reformatted and the pattern stopped matching, the loops would run zero times
 * and this file would pass having tested nothing, which is the shape of dead
 * test this repository has been bitten by before. So it states what it expects
 * to have found first. Both slices anchor on CODE — `const PATHS = {` — never
 * on a comment, which sourceanchors.test.mjs requires of every file here.
 */
const PATHS = (() => {
  const body = cut(src, 'const PATHS = {', '\n}', 'the icon table')
  const out = {}
  for (const m of body.matchAll(/^ {2}([a-zA-Z]+): *'([^']+)'/gm)) out[m[1]] = m[2]
  return out
})()

const ALIASES = (() => {
  const body = cut(src, 'const ALIASES = {', '}', 'the alias table')
  const out = {}
  for (const m of body.matchAll(/([a-zA-Z]+): *'([a-zA-Z]+)'/g)) out[m[1]] = m[2]
  return out
})()

const NAMES = Object.keys(PATHS)

console.log('the icon table was actually read')
{
  ok(NAMES.length > 30, `parsed ${NAMES.length} drawings out of Icon.vue`)
  ok(Object.keys(ALIASES).length > 0, `and ${Object.keys(ALIASES).length} alias(es)`)
  ok(NAMES.includes('missing'), 'including the mark shown when a name does not exist')
}

console.log('every icon a component asks for exists')
{
  /*
   * Both ways a name reaches this component: written at the call site, and
   * carried in data — the sidebar's sections and the store's nudges name their
   * icons as strings, and `<Icon :name="s.icon">` is what draws them. A scan
   * of the templates alone would see none of those.
   */
  const files = []
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(vue|js)$/.test(f)) files.push(p)
    }
  }
  walk(join(ROOT, 'src'))
  ok(files.length > 40, `read ${files.length} source files`)

  const asked = new Map()
  for (const p of files) {
    const text = codeOf(readFileSync(p, 'utf8'))
    const where = p.slice(ROOT.length)
    // `\s` before the name is what keeps `:name="a.icon"` out of this: the
    // colon is not whitespace, so a bound name is correctly ignored here and
    // caught by the data scan below instead.
    for (const m of text.matchAll(/<Icon[^>]*\sname="([^"]+)"/g)) asked.set(m[1], where)
    for (const m of text.matchAll(/\bicon: *'([a-zA-Z]+)'/g)) asked.set(m[1], where)
  }

  ok(asked.size > 10, `found ${asked.size} icon names in use`)
  for (const [name, where] of asked) {
    ok(NAMES.includes(name) || name in ALIASES,
       `${where} asks for "${name}" — there is no such icon, so it would draw the missing mark`)
  }
}

console.log('an alias is a second name for one drawing, not a second drawing')
{
  for (const [from, to] of Object.entries(ALIASES)) {
    ok(NAMES.includes(to), `${from} points at ${to}, which exists`)
    ok(!NAMES.includes(from), `${from} is an alias and must not also be a drawing of its own`)
  }
}

console.log('nothing in the set carries a letter, a word, or a colour')
{
  for (const [name, d] of Object.entries(PATHS)) {
    /*
     * A path is made of path commands and numbers. Anything else in there is
     * either a letterform somebody has drawn as a glyph or — far likelier — a
     * <text> element that has been folded in, which is the exact failure this
     * file exists to prevent: an icon that needs translating.
     */
    ok(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/.test(d),
       `${name} is drawn only in path commands and numbers`)
    ok(d.trim().length > 3, `${name} actually draws something`)
  }

  const code = codeOf(src)
  ok(!/<text[\s>]/i.test(code), 'there is no <text> element anywhere in the set')
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), 'no literal colour — the set takes the colour it sits in')
  ok(!/\b(rgb|hsl)a?\(/.test(code), 'and none by another spelling')
  ok(/stroke="currentColor"/.test(code), 'stroke is currentColor, so dark mode needs no second set')
  ok(/fill="none"/.test(code), 'and nothing is filled, so one weight reads across the whole set')
}

console.log('the component itself, rendered')
{
  /*
   * Rendered rather than read, because what matters is what reaches the
   * screen. The assertions the source cannot make are here: that an unknown
   * name draws the missing mark and NOT a real control, and that an icon
   * standing alone can be given a name a screen reader will say.
   */
  const unknown = await renderScreen(ICON, 'export const store = {}', {
    props: { name: 'thisIconDoesNotExist' }
  })
  ok(unknown.includes(PATHS.missing),
     'an unknown name draws the missing mark')
  ok(!unknown.includes(PATHS.more),
     'and NOT the sidebar ellipsis, which is a real control and hid this for months')
  ok(/aria-hidden="true"/.test(unknown),
     'an unlabelled icon is hidden from a screen reader, because a <Bi> beside it says the same thing')

  const labelled = await renderScreen(ICON, 'export const store = {}', {
    props: { name: 'bleed', label: 'Bleed' }
  })
  ok(labelled.includes(PATHS.bleed), 'a known name draws its own path')
  ok(/aria-label="Bleed"/.test(labelled), 'and a label names an icon that is the whole of a control')
  ok(!/aria-hidden/.test(labelled), 'a labelled icon is not hidden from the people who need the label')
  /*
   * An aria-label and not a <title>: a <title> inside the svg becomes the
   * tooltip of the control it sits in, which would override the `title` a
   * disabled control carries its reason in — the rule permissionui.test.mjs
   * exists to enforce. The two must not be able to collide.
   */
  ok(!/<title/.test(labelled), 'the label is not a <title>, which would steal a disabled control\'s reason')
}

console.log('stroke weight is optical, so the set holds at both ends of its range')
{
  /*
   * stroke-width is in grid units against a 24 box, so a constant value gets
   * thinner as the icon gets smaller. 16px is an organiser's dense table and
   * 52px is --tap, a seller's thumb outdoors; the same drawing serves both.
   */
  const px = (size, w) => w * size / 24
  const at = {}
  for (const size of [16, 24, 30, 52]) {
    const html = await renderScreen(ICON, 'export const store = {}', { props: { name: 'check', size } })
    const w = Number((html.match(/stroke-width="([\d.]+)"/) || [])[1])
    at[size] = px(size, w)
    ok(w > 0, `size ${size} renders a stroke width (${w})`)
  }
  ok(at[16] >= 1.4 && at[16] <= 1.7, `at 16px the stroke is ${at[16].toFixed(2)}px — readable, not hairline`)
  ok(at[52] >= 2 && at[52] <= 2.4, `at 52px it is ${at[52].toFixed(2)}px — heavier, but not a marker pen`)
  ok(at[52] > at[16], 'the drawing gains weight as it grows, rather than keeping the same grid value')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
