/*
 * THE STUDIO'S QUIET TEXT NEVER OUTGROWS WHAT IT EXPLAINS.
 *
 * On 2026-09-23 the rail's empty states were `class="tiny muted"` — .82rem,
 * from a raw literal in style.css — sitting directly under library tile labels
 * drawn at --fs-3xs (.66rem). The sentence ABOUT a panel was a quarter larger
 * than the names of the things IN it, so "None kept. Pick a colour, then +."
 * read before Rule, Double rule, Tint panel, Seal. The user looked at that rail
 * and said the texts "still look unprofessional — make neat, padded and
 * smaller, not competing with tools and icons".
 *
 * WHY A TEST AND NOT JUST A FIX. Nothing in the suite could see it. The
 * literal .82 lives in a GLOBAL utility, so scales.test.mjs counts it once for
 * the whole app and has no opinion about where it is used; render tests read
 * visibleText, which is identical at any size; and the classes all resolve, so
 * reachableclass is satisfied. Every gate was green while the loudest text in
 * the studio was an empty state. The only thing that catches it is an
 * assertion about WHICH VOICE a panel is allowed to speak in.
 *
 * The three voices are set out in studio.css. This pins the two rules that the
 * screenshot showed being broken:
 *
 *   - a rail or inspector's empty state uses `.blank`, never `.tiny`
 *   - `.blank` and `.say` are the same size, and that size is a scale token
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

/*
 * The panels that sit beside the artboard. TicketDesign.vue is deliberately
 * NOT in this list: its one remaining `.tiny muted` is the full-page "needs a
 * bigger screen" refusal shown INSTEAD of the studio on a phone, where there
 * are no tools or icons for it to compete with.
 */
const PANELS = [
  'src/components/ticketdesign/LibraryPanel.vue',
  'src/components/ticketdesign/TemplateRail.vue',
  'src/components/ticketdesign/Inspector.vue',
  'src/components/ticketdesign/CardInspector.vue',
  'src/components/ticketdesign/DecorationInspector.vue',
  'src/components/ticketdesign/DigitalTab.vue',
]

console.log('no panel beside the artboard speaks in the .82 voice')
{
  let checked = 0
  for (const rel of PANELS) {
    const src = read(rel)
    checked += 1
    const hits = [...src.matchAll(/class="[^"]*\btiny\b[^"]*"/g)].map((m) => m[0])
    /*
     * TWO THINGS ARE NOT CAPTIONS AND KEEP EVERY PIXEL.
     *
     * `.tiny` with a TONE — bad, warn — is a refusal or a consequence, and
     * permissionui requires a disabled control's reason stay legible; a
     * warning that shrinks with the captions is a warning nobody sees.
     *
     * `.tiny` with `mono` or `data` is a NUMERIC READOUT: an element's pixel
     * box, a watermark's percentage. UI-STANDARD §3 is that numbers are the
     * product, not text that happens to be numeric, and these are the figures
     * a designer checks a placement against. Shrinking them to caption size
     * was the first thing this test tried to make me do, and it would have
     * been the same mistake in the opposite direction.
     *
     * What is left is prose ABOUT a panel, which is the voice that was
     * outgrowing the labels it explained.
     */
    const captions = hits.filter((h) => /\bmuted\b/.test(h) && !/\b(mono|data)\b/.test(h))
    eq(captions.length, 0, `${rel.split('/').pop()} has no 'tiny muted' caption`)
  }
  /* GUARD THE ENUMERATION. A typo'd path list reads as zero violations. */
  eq(checked, PANELS.length, 'every panel in the list was actually read')
}

console.log('the empty-state voice is the explanation voice, on the scale')
{
  const css = read('src/components/ticketdesign/studio.css')
  const sizeOf = (sel) => {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*?font-size:\\s*([^;]+);`, 's'))
    return m && m[1].trim()
  }
  const blank = sizeOf('.blank')
  const say = sizeOf('.say')
  ok(blank, '.blank declares a font-size')
  ok(say, '.say declares a font-size')
  eq(blank, say, 'an empty state is drawn at the same size as an explanation')
  ok(/^var\(--fs-/.test(blank || ''), 'and it is a scale token, not a literal')

  /* It is an aside, so it is spaced away from the control above it rather than
     reading as one more item in the group. */
  ok(/\.blank\s*\{[^}]*padding:/s.test(css), '.blank is padded')
}

console.log('prose is never larger than the labels of what it describes')
{
  const scale = read('src/style.css')
  /* The steps, smallest first, read off the scale itself rather than retyped —
     a rank table copied by hand is the next thing to drift. */
  const steps = [...scale.matchAll(/--fs-(3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl):\s*([\d.]+)rem/g)]
    .map((m) => ({ name: `--fs-${m[1]}`, rem: parseFloat(m[2]) }))
  ok(steps.length >= 6, 'the type scale was found and parsed')
  const remOf = (tok) => steps.find((s) => s.name === tok)?.rem

  const css = read('src/components/ticketdesign/studio.css')
  const lib = read('src/components/ticketdesign/LibraryPanel.vue')
  const tokenIn = (src, sel) => {
    const m = src.match(new RegExp(`\\${sel}\\s*\\{[^}]*?font-size:\\s*var\\((--fs-[a-z0-9]+)\\)`, 's'))
    return m && m[1]
  }
  const prose = tokenIn(css, '.say')
  const label = tokenIn(lib, '.tname')
  ok(prose, '.say resolves to a scale token')
  ok(label, '.tname resolves to a scale token')
  /*
   * THE WHOLE POINT, IN ONE LINE. A library tile is a picture with its name
   * under it; the sentence beneath the group explains the group. When the
   * sentence is drawn larger than the names, the eye reads the explanation
   * before the things — which is what the rail did for as long as it existed.
   */
  ok(remOf(prose) <= remOf(label),
    `prose (${prose} ${remOf(prose)}rem) is not larger than a tile label (${label} ${remOf(label)}rem)`)
}

console.log('the draft bar does not inherit the global panel size')
{
  const src = read('src/components/TicketDesign.vue')
  const rule = src.match(/\.note\.draftbar\s*\{[^}]*\}/s)
  /* TWO CLASSES, or it loses to `.note.info` and the property has no effect
     at all — which is how it shipped the first time. */
  ok(rule, '.draftbar is scoped as .note.draftbar, beating .note.info')
  ok(/font-size:\s*var\(--fs-/.test(rule?.[0] ?? ''),
    'it sets its own size, rather than taking .note.info at .95rem')
  ok(/padding:/.test(rule?.[0] ?? ''), 'and its own padding')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
