/*
 * EVERY COLOUR THIS APP DRAWS WITH EXISTS, AND FLIPS.
 *
 * THE BUG THIS EXISTS FOR, twice in one day and once before that.
 *
 *   .hint.warnish { color: var(--warn-ink, var(--muted)) }   TicketsInPlay.vue
 *
 * `--warn-ink` was never defined anywhere, so that resolved to its fallback
 * every single time and the line rendered in ordinary supporting grey. The two
 * branches it distinguished — "that puts N more into play" and "that holds N
 * back" — were therefore identical on screen, and the second is the one that
 * takes printed tickets out of a seller's hands.
 *
 *   .orgfoot { border-top: 1px solid var(--line, rgba(0,0,0,.1)) }  verify.css
 *
 * `--line` belonged to the verify page's own palette, retired when that page
 * was brought onto the app's tokens. The fallback fired every time: a hairline
 * in light mode and nothing whatever against a dark surface.
 *
 * And style.css records the original, above `.sr`: `:class="ok ? 'muted' :
 * 'bad'"` on the QR density warning resolved to nothing, so the one line
 * telling an organiser their QR was too coarse to scan rendered in grey.
 *
 * WHY NOTHING ELSE CATCHES IT. A `var()` with a fallback is VALID CSS that
 * renders without complaint, so there is no error anywhere — no build warning,
 * no console message, no failing assertion, because the markup and the rule
 * are both well-formed. The defect is that a name means nothing, and the
 * fallback is what makes it invisible: the text is still a colour, just the
 * wrong one, and only somebody who knew the warning was supposed to be amber
 * would ever notice. A rule that silently does nothing is worse than no rule,
 * because the code reads as though the case is handled.
 *
 * It is also not reachable by looking. A render shows a colour that is
 * plausible; you cannot see a token that is missing unless you already knew to
 * expect it. This asserts the positive instead — every name used is a name
 * defined — which is the rule the tests skill opens with.
 *
 * WHAT THIS CANNOT DO: it reads text. A token assembled at runtime, or set
 * from JavaScript through style.setProperty, is invisible here. applyBrand()
 * does exactly that for the organiser's colour, which is why the check is
 * against declarations in the stylesheets rather than against a computed page.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const styleFiles = (dir, acc = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) continue
    const p = dir + '/' + f
    statSync(p).isDirectory() ? styleFiles(p, acc) : (/\.(css|vue)$/.test(f) && acc.push(p))
  }
  return acc
}

/*
 * COMMENTS COME OUT FIRST, and this is not fussiness. The first run of this
 * audit reported `--line` as a live reference in verify.css — from the comment
 * explaining that `--line` had been retired. A check that reads prose as code
 * cries wolf about the very fix that removed the bug.
 *
 * EACH COMMENT LEAVES ITS NEWLINES BEHIND, so the line numbers this reports are
 * line numbers in the FILE. Deleting comments outright shifts everything after
 * them: the first version of this told ticket-printing-qr-integration that
 * verify.css:95 used --ink when the only such reference was at 207, and line 95
 * was the middle of a comment. They checked with grep -n before touching
 * anything, which is the only reason it cost minutes rather than an hour.
 *
 * A check whose whole value is finding the one line nobody can see by looking
 * has to point at the right line. A wrong one sends the reader somewhere that
 * looks fine, and the natural conclusion is that the test is broken.
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))

const files = styleFiles(ROOT + 'src')

console.log('every token that is used is a token that is declared')
{
  const defined = new Set()
  for (const f of files)
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/(--[a-z0-9-]+)\s*:/gi))
      defined.add(m[1])

  let used = 0
  const undef = []
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      used++
      if (defined.has(m[1])) continue
      undef.push(`${f.replace(ROOT, '')}:${src.slice(0, m.index).split('\n').length} uses ${m[1]}`)
    }
  }

  /*
   * The counts are asserted, not just the absence of names. A walk that found
   * no files and a repo with no undefined tokens produce identical output, and
   * those are the two states that have to be told apart.
   */
  ok(files.length > 50, `read every stylesheet and component (${files.length} files)`)
  ok(defined.size > 30, `and found the token declarations (${defined.size} tokens)`)
  ok(used > 300, `and the places they are used (${used} references)`)
  for (const u of undef) console.log('  FAIL ' + u)
  fail += undef.length
  ok(undef.length === 0, `no rule draws with a name nothing defines (${undef.length} do)`)
}

console.log('and every token that varies by theme has a dark value')
{
  /*
   * THE SIX THAT DO NOT ARE NAMED, rather than the check being written as
   * "everything except". This repo has paid three times for conditions phrased
   * as an exclusion: the set that may pass is the set that gets written down,
   * so a seventh token added without a dark value fails here and has to be
   * argued for rather than slipping in under a rule about what is not covered.
   *
   *   --ease       a timing function; time does not have a colour
   *   --font-data  a font stack
   *   --r, --r-sm  radii
   *   --tap        a touch target in pixels, and never overridden anywhere
   *   --ticket-gold the PRINTED ticket's own colour — ink on paper, the same
   *                 under any lamp, and the design system says it is never
   *                 chrome. The verify page's --seal is the same argument.
   */
  const THEME_FREE = ['--ease', '--font-data', '--r', '--r-sm', '--tap', '--ticket-gold']

  const css = readFileSync(ROOT + 'src/style.css', 'utf8')
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)')
  ok(darkAt > 0, 'style.css has a dark block at all')

  const names = (s) => new Set([...s.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]))
  const light = names(css.slice(css.indexOf(':root {'), darkAt))
  const dark = names(css.slice(darkAt))

  ok(light.size > 30, `the light palette was read (${light.size} tokens)`)
  ok(dark.size > 20, `and the dark one (${dark.size} tokens)`)

  const unflipped = [...light].filter((t) => !dark.has(t) && !THEME_FREE.includes(t))
  for (const t of unflipped) console.log(`  FAIL ${t} has no dark value and is not named as theme-free`)
  fail += unflipped.length
  ok(unflipped.length === 0, `every colour token flips (${unflipped.length} do not)`)

  /*
   * And the named six are checked to still EXIST. An allowlist whose entries
   * have been deleted is a list that quietly stops constraining anything,
   * which is the same failure as a test that asserts nothing.
   */
  const stale = THEME_FREE.filter((t) => !light.has(t))
  for (const t of stale) console.log(`  FAIL ${t} is named theme-free but is not declared any more`)
  fail += stale.length
  ok(stale.length === 0, 'the theme-free list names only tokens that exist')
}

console.log('and nothing writes hard-coded text onto a semantic fill')
{
  /*
   * THE THIRD INSTANCE OF ONE MISTAKE, and the reason this is a rule rather
   * than three fixes.
   *
   *   .toast.bad { background: var(--bad); color: #fff }
   *   .toast.ok  { background: var(--ok);  color: #fff }
   *
   * --ok, --bad, --warn, --info and --brand are FOREGROUND values: tuned to
   * stay legible as text on --surface, which means that in dark mode they are
   * LIGHT. --ok is #6ee7a0 there. So white text on a fill of one of them was
   * 1.54:1 for every confirmation this app has ever shown and 1.90:1 for every
   * refusal, on every phone in dark mode. .btn.danger and a badge in the studio
   * had it too, and the verify page's action button had it this afternoon.
   *
   * WHY NOTHING ELSE SEES IT. The literal is correct in whichever theme the
   * author happens to have open — #fff on #b3261e is 6.54:1 and perfectly
   * fine — so it cannot be caught by reading the rule or by looking at the
   * screen you are already looking at. It needs the ratio computed, or the
   * token present so that reaching for it is easier than typing #fff.
   *
   * The base .toast rule got it right by using var(--text) on var(--bg), which
   * is what makes the two variants beneath it so easy to miss.
   */
  const SEMANTIC = ['--brand', '--ok', '--bad', '--warn', '--info']
  let filled = 0
  const bare = []

  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
      const body = m[1]
      const bg = body.match(/background(?:-color)?:\s*([^;]+)/)
      if (!bg) continue
      const sem = SEMANTIC.find((t) => bg[1].includes(`var(${t})`))
      if (!sem) continue
      filled++
      const col = body.match(/(?:^|;)\s*color:\s*([^;]+)/)
      if (!col) continue                       // inherits, or set in another rule
      const v = col[1].trim()
      if (/^var\(/.test(v)) continue            // a token: --*-ink, --surface, --bg
      bare.push(`${f.replace(ROOT, '')} fills with ${sem} and writes color: ${v}`)
    }
  }

  ok(filled > 8, `found the rules that fill with a semantic colour (${filled})`)
  for (const b of bare) console.log('  FAIL ' + b)
  fail += bare.length
  ok(bare.length === 0, `each of them takes its text colour from a token (${bare.length} do not)`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
