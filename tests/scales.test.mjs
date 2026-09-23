/*
 * THE DIMENSIONAL SYSTEM EXISTS, AND IT WAS DERIVED FROM THIS TREE.
 *
 * WHY THIS SUITE EXISTS. `tokens.test.mjs` proves every colour name a rule
 * draws with is a name something declares. Nothing did the same for anything
 * with a dimension, and the audit in UI-EVIDENCE.md §4 found what that costs:
 *
 *     62 font sizes across rem, px AND em     |  1 font-size token
 *      9 font weights incl. 550, 650, 850     |  0 weight tokens
 *     29 spacing values, every int 2..14      |  0 spacing tokens
 *     16 radii + three spellings of "pill"    |  3 radius tokens
 *      6 border widths incl. .5px             |  0 width tokens
 *     25 shadows                              |  2 shadow tokens
 *
 * `--brand` exists, so nobody picks a teal. No `--fs-*` existed, so everybody
 * picked a size — which is how .8rem, .82rem and .84rem come to be in one
 * codebase 2.5% apart, each correct in the moment it was typed.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS SHAPED THIS WAY ───────────────────
 *
 * The first draft of this suite was going to assert that Phase 0 CHANGED
 * NOTHING — that no rendered value moved. kcho-shelter-25 killed it, and was
 * right: "nothing moved" is an ABSENCE. It passes identically against a Phase 0
 * that was never written, against a :root block that failed to parse, and
 * against a token file truncated at byte 400. All three produce "nothing
 * moved", which is also what success looks like. A suite that cannot fail in
 * the direction you care about is a suite that reports on its own regex.
 *
 * So every block below is a POSITIVE IDENTITY: two strings extracted from the
 * tree and compared to each other, with the number of comparisons asserted
 * BEFORE any comparison is made. A regex that stops matching then yields zero
 * pairs and fails loudly, instead of yielding zero pairs and passing.
 *
 * (That guard is this repository's own rule — a test that enumerates must
 * assert its enumeration found something. It is here because the alternative
 * has already been paid for twice.)
 *
 * ── TOKENS WITH NO CONSUMER YET ─────────────────────────────────────────────
 *
 * Phase 0 is additive on purpose: it declares the scales without moving a
 * single rendered value, so the migration can proceed file by file as files
 * are opened for other reasons (UI-EVIDENCE.md §7.6). That means some tokens
 * below ship with no callers, and a dead token is indistinguishable from a
 * token whose wiring somebody forgot — so the deliberate gaps are named here
 * rather than left for a future `grep` to puzzle over. Also kcho-shelter-25's
 * point, from the same lesson as be37c17, "a colour you can use and not keep
 * is half a library".
 *
 *   --elev-1, --elev-3, --elev-4   NEW values, not derived. The app had two
 *                                  shadows and twenty-three one-offs; these
 *                                  are the missing rungs. First consumer is
 *                                  whoever next puts a dropdown or a sheet on
 *                                  screen, and they should be tuned against a
 *                                  rendered page at that point, not before.
 *   --fw-*, --sp-*, --r-xs,        Derived from the tree. Consumed by Phase 6,
 *   --r-md, --r-pill, --rule*      as each file is migrated.
 *   --fs-*                         Derived. --fs-md and --fs-2xs are already
 *                                  live through --fs-ui; the rest land in
 *                                  Phase 6.
 *
 * WHAT THIS FILE DOES NOT ASSERT. Whether any given screen uses the RIGHT step
 * of the scale is a design judgement and belongs to review, not to a test.
 * This proves the scale exists, that it was derived rather than invented, that
 * the aliases are bit-identical, and that the population of raw literals is
 * falling.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/* Comments out first, newlines kept, so a reported line number is a line
   number in the file. tokens.test.mjs learned this the hard way: it once
   reported `--line` as a live reference, reading the comment that explained
   the token had been retired. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))

const styleFiles = (dir, acc = []) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f.startsWith('.')) continue
    const p = dir + '/' + f
    statSync(p).isDirectory() ? styleFiles(p, acc) : (/\.(css|vue)$/.test(f) && acc.push(p))
  }
  return acc
}

const files = styleFiles(ROOT + 'src')
const sources = files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))])
const css = readFileSync(ROOT + 'src/style.css', 'utf8')
const cssBare = stripComments(css)

/** Every `--name: value` declaration in style.css, last one wins per name. */
const declared = new Map()
for (const m of cssBare.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi))
  if (!declared.has(m[1])) declared.set(m[1], m[2].trim())

console.log('the scale exists')
{
  ok(files.length > 50, `read every stylesheet and component (${files.length} files)`)

  const groups = {
    'type': ['--fs-3xs', '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md',
             '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl', '--fs-4xl'],
    'weight': ['--fw-regular', '--fw-medium', '--fw-bold'],
    'space': ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5',
              '--sp-6', '--sp-7', '--sp-8', '--sp-9'],
    'radius': ['--r-xs', '--r-md', '--r-pill'],
    'rule': ['--rule', '--rule-strong'],
    'elevation': ['--elev-1', '--elev-2', '--elev-3', '--elev-4', '--elev-5'],
  }
  for (const [name, names] of Object.entries(groups)) {
    const missing = names.filter((n) => !declared.has(n))
    ok(missing.length === 0, `the ${name} scale is declared in full (missing: ${missing.join(', ') || 'none'})`)
  }
}

console.log('and it was DERIVED from this tree, not invented beside it')
{
  /*
   * THE ASSERTION THAT MAKES THE SCALE HONEST. A scale picked out of the air
   * is a second system competing with the first, and the migration then has to
   * move every value twice. Each step below must be a number this app was
   * already drawing with somewhere — so the scale is the existing system with
   * its duplicates removed, which is a thing you can prove.
   *
   * --elev-1/3/4 are exempt and named in the header: the app had a two-rung
   * ladder, so the missing rungs cannot be found in it by definition.
   */
  const derived = [
    '--fs-3xs', '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg',
    '--fs-xl', '--fs-2xl', '--fs-3xl', '--fs-4xl',
    '--fw-regular', '--fw-medium', '--fw-bold',
    '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7',
    '--sp-8', '--sp-9',
    '--r-xs', '--r-md', '--r-pill', '--rule', '--rule-strong',
  ]

  let checked = 0
  const orphans = []
  for (const name of derived) {
    const value = declared.get(name)
    if (!value) continue
    /* Found in a DECLARATION somewhere, not merely as a substring: `4px`
       must not be satisfied by `24px`, and `600` must not be satisfied by
       a `600ms` transition or a z-index. */
    const needle = new RegExp(`:\\s*[^;{}]*(^|[^0-9.a-z-])${value.replace('.', '\\.')}(?![0-9a-z%-])`, 'im')
    const hit = sources.some(([f, src]) => f !== ROOT + 'src/style.css' && needle.test(src))
      || (cssBare.match(new RegExp(`(^|[^0-9.a-z-])${value.replace('.', '\\.')}(?![0-9a-z%-])`, 'gm')) || []).length > 1
    checked++
    if (!hit) orphans.push(`${name}: ${value} appears nowhere else in src/`)
  }

  /* Asserted BEFORE the orphan check, per the header. A broken regex here
     produces zero comparisons, and zero comparisons must not look like
     twenty-seven clean ones. */
  ok(checked === derived.length,
     `compared every derived step against the tree (${checked} of ${derived.length})`)
  for (const o of orphans) console.log('  FAIL ' + o)
  fail += orphans.length
  ok(orphans.length === 0, `every derived step is a value this app already used (${orphans.length} are not)`)
}

console.log('and the aliases are bit-identical, so Phase 0 moved nothing')
{
  /*
   * THE OTHER HALF OF "NOTHING MOVED", stated as an identity rather than as an
   * absence. These four pairs are the only places where a new token claims to
   * BE an existing one; if a later edit drifts either side, the claim in
   * style.css becomes false and this goes red. An absence-shaped test would
   * have stayed green.
   */
  /*
   * `flips: true` means the pair must hold in BOTH themes. Only the shadows
   * do: they are rgba, so they are colours, and they are redeclared in the
   * dark block. `--fs-md`/`--fs-ui` is theme-free and is checked once against
   * the whole file — and it HAS to be, because `--fs-ui` is declared in the
   * density `:root` that sits AFTER the dark media query, so a light/dark
   * split would look for it in the light scope and not find it. That is a
   * property of where the density block lives, not a bug in either token, and
   * writing the check as "both themes, always" reported it as one.
   */
  const pairs = [
    ['--elev-2', '--shadow', 'the card shadow', true],
    ['--elev-5', '--shadow-lg', 'the modal shadow', true],
    ['--fs-md', '--fs-ui', 'the base type size', false],
  ]
  /*
   * BOTH THEMES, because the first draft of Phase 0 declared the elevation
   * ladder in :root only. `--elev-2` was bit-identical to `--shadow` in light
   * and served the LIGHT shadow in dark, where `--shadow` had flipped out from
   * under it. tokens.test.mjs caught that; this checks it here too, where the
   * claim is actually made, so the two pairs cannot drift apart one theme at a
   * time.
   */
  const darkAt = cssBare.indexOf('@media (prefers-color-scheme: dark)')
  ok(darkAt > 0, 'found the dark block')
  const scopeOf = (s) => {
    const m = new Map()
    for (const d of s.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) if (!m.has(d[1])) m.set(d[1], d[2].trim())
    return m
  }
  const lightDecl = scopeOf(cssBare.slice(0, darkAt))
  const darkDecl = scopeOf(cssBare.slice(darkAt))

  let compared = 0
  const expected = pairs.reduce((n, p) => n + (p[3] ? 2 : 1), 0)
  for (const [a, b, what, flips] of pairs) {
    const scopes = flips
      ? [['light', lightDecl], ['dark', darkDecl]]
      : [['either theme', declared]]
    for (const [scope, decl] of scopes) {
      const va = decl.get(a), vb = decl.get(b)
      compared++
      if (va === undefined || vb === undefined) {
        ok(false, `${what} (${scope}): ${va === undefined ? a : b} is not declared there`)
        continue
      }
      ok(va === vb, `${what} (${scope}): ${a} is still exactly ${b}`)
    }
  }
  ok(compared === expected,
     `compared every alias pair, both themes where it flips (${compared} of ${expected})`)

  /* The dense scope's --fs-ui is the same number as --fs-2xs, which is why
     that step is in the scale at all. Read from the .dense block rather than
     from :root, so it is the density value that is checked. */
  const denseBlock = cssBare.match(/\.dense\s*\{([^}]*)\}/)
  ok(!!denseBlock, 'found the dense scope')
  if (denseBlock) {
    const denseUi = denseBlock[1].match(/--fs-ui\s*:\s*([^;]+);/)
    ok(!!denseUi, 'and its --fs-ui')
    if (denseUi) ok(denseUi[1].trim() === declared.get('--fs-2xs'),
                    `and it is exactly --fs-2xs (${denseUi[1].trim()} vs ${declared.get('--fs-2xs')})`)
  }
}

console.log('and the population of raw literals is falling')
{
  /*
   * A RATCHET, NOT A BAN. 1,196 literal dimensions cannot become tokens in one
   * commit, and a gate that fails on the day it ships is a gate somebody
   * deletes on the day after. These numbers are the count at Phase 0. They may
   * FALL and never RISE — so new work has to reach for the scale, and the
   * migration has somewhere to show up.
   *
   * WHEN YOU LOWER A NUMBER: run the suite, take the count it prints, put that
   * in. Do not lower it by more than you actually migrated, or the next
   * person inherits a gate that fails for reasons that are not theirs.
   */
  const BASELINE = {
    /* Lowered 2026-09-23 by the Ticket Studio Phase 5 work, which migrated
       studio.css, TemplateRail, ShapesPanel, ArtworkVerdict and SheetTab off
       their literals while those files were open — 9 font sizes, 3 weights,
       6 radii, 45 spacing values and 11 border widths. Counted with this
       file's own regexes, not estimated. */
    /* Lowered again 2026-09-23 by STUDIO-ESSENTIALS Phase 0 (kcho-shelter-0c):
       the studio shell's tabs and zoom, the three inspectors, Ink, ToolButton,
       ToolBar and LibraryPanel, migrated while open, plus the rules that went
       with the controls they styled — 15 sizes, 3 weights, 12 radii, 51
       spacing values, 10 border widths. Counted with the regexes below. */
    'font-size': 163,
    'font-weight': 76,
    'border-radius': 64,
    'spacing (px)': 614,
    'border-width': 101,
    'box-shadow': 16,
  }
  const comps = sources.filter(([f]) => f.includes('/components/'))
  ok(comps.length > 40, `read the components (${comps.length} files)`)

  const count = (re, post) => comps.reduce((n, [, src]) => {
    const found = src.match(re) || []
    return n + (post ? found.filter(post).length : found.length)
  }, 0)

  const actual = {
    'font-size': count(/font-size:[^;}]*/g, (s) => !s.includes('var(') && /[0-9]/.test(s)),
    'font-weight': count(/font-weight:[^;}]*/g, (s) => !s.includes('var(') && /[0-9]/.test(s)),
    'border-radius': count(/border-radius:[^;}]*/g, (s) => !s.includes('var(') && /[0-9]/.test(s)),
    'spacing (px)': comps.reduce((n, [, src]) => n + ((src.match(/(margin|padding|gap)[a-z-]*:[^;}]*/g) || [])
      .join(' ').match(/\b[0-9]+px/g) || []).length, 0),
    'border-width': count(/border(-(top|right|bottom|left))?:\s*[0-9.]+px/g),
    'box-shadow': count(/box-shadow:[^;}]*/g, (s) => !s.includes('var(') && !/none/.test(s)),
  }

  const total = Object.values(actual).reduce((a, b) => a + b, 0)
  /* The parse guard. A regex that stops matching gives every category a zero,
     and every zero is "below baseline" — a green run reporting that the app
     has no dimensions in it at all. */
  ok(total > 400, `and found dimensions in them (${total} literals; a near-zero here means the scan broke, not that the work is done)`)

  for (const [k, max] of Object.entries(BASELINE)) {
    const n = actual[k]
    ok(n <= max, `${k}: ${n} literals, baseline ${max}${n < max ? ` — lower the baseline to ${n}` : ''}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
