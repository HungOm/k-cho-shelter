/*
 * THE PRINT SHEET TAB DRAWS THE SHEET.
 *
 * It did not. The tab that configures how tickets sit on A4 offered three
 * sliders and a line of arithmetic — "4 × 61.5 + 3 × 4.0 + 2 × 10.0 = 277.9 of
 * 297.0 mm" — and nothing else, in a single narrow column inside a shell built
 * for three. Sixty per cent of the window was empty, it did not look like its
 * own sibling tabs, and the question somebody dragging a margin is actually
 * asking — does the last ticket still fit on the page — could only be answered
 * by checking a sum against a sheet of paper in their head.
 *
 * The drawing already existed. It was built in the PRINTING modal, so the
 * screen that prints a sheet drew the page and the screen that configures one
 * did not. Two drawings of one geometry drift the first time either is edited,
 * so there is now one component and both screens hand it the same pageFit.
 *
 * WHAT THIS PINS is the property rather than the pixels: that the tab renders
 * a page, that the page is shared rather than copied, and that the shell is
 * the same one its siblings use. Nothing here asserts a colour, a size or a
 * word — those are the designer's to change without asking a test.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderScreen } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

const ADMIN = { email: 'a@x.com', role: 'admin', isSuperAdmin: false }
const ONE = {
  templates: [{
    id: 'tpl-1', name: 'Front', contentType: 'image/png',
    width: 1600, height: 517, bytes: 576542,
    url: 'https://x/storage/v1/object/public/ticket-artwork/tpl-1.png',
    design: {}, uploadedBy: 'a@x.com', uploadedAt: '2026-09-20T10:00:00Z',
  }],
  active: 'tpl-1',
  sizes: [{ id: 'ceam-190x61', label: '190 × 61 mm', widthMM: 190, heightMM: 61.39, tolerance: 0.02, minWidthPx: 1600 }],
  verifyUrl: '',
}
const store = (reply) => `
import { reactive } from 'vue'
export const state = reactive({
  cfg: { ticketPrefix: 'KS-', ticketDigits: 5, currency: 'RM', ticketArtwork: true },
  user: ${JSON.stringify(ADMIN)},
})
export const api = async () => (${JSON.stringify(reply)})
export const setConfig = () => {}
export const toast = () => {}
export const go = () => {}
export const isAdmin = true
export const isSuper = false
`

/* Load the artwork the way the mounted hook does, then open the sheet tab. */
const onSheetTab = async (b) => { await b.load(); b.tab.value = 'sheet' }

console.log('the page itself draws, at the shape of the paper')
{
  /*
   * RENDERED DIRECTLY, because the screen harness does not resolve child
   * components — a tab that mounts SheetPreview renders an empty stage here
   * however correct it is. So the page is rendered on its own terms, which is
   * also the honest place to test it: it is a component about geometry and it
   * takes that geometry as a prop.
   */
  const FIT = { per: 4, widthMM: 190, heightMM: 61.4, gapMM: 4, marginMM: 10, pageHeightMM: 297, pageWidthMM: 210, paper: { widthMM: 210, heightMM: 297, label: 'A4', landscape: false }, used: 277.6, fits: true }
  const html = await renderScreen('src/components/ui/SheetPreview.vue', 'export const state = {}', {
    props: { fit: FIT, art: 'art.png', cutlines: true },
  })
  ok(/class="a4"/.test(html), 'a sheet of A4 is drawn')
  eq((html.match(/class="slot"/g) || []).length, FIT.per,
    'one slot per ticket that fits, so the drawing cannot disagree with the count')
  /*
   * The shape of the PAPER, not of A4. This asserted a hardcoded 210 / 297
   * until the paper became a choice — which is the assertion doing its job
   * the wrong way round: it was pinning an assumption rather than a property.
   */
  ok(/210 *\/ *297/.test(html), 'drawn at the proportions of the paper it was given')
  const a3 = await renderScreen('src/components/ui/SheetPreview.vue', 'export const state = {}', {
    props: {
      fit: { ...FIT, paper: { widthMM: 420, heightMM: 297, label: 'A3', landscape: true } },
      art: 'art.png', cutlines: true, items: [],
    },
  })
  ok(/420 *\/ *297/.test(a3), 'and reshapes when the paper or the orientation changes')
  ok(/art\.png/.test(html), 'with the artwork in each slot')
  ok(/dashed/.test(html), 'and the cut lines when they are asked for')

  const plain = await renderScreen('src/components/ui/SheetPreview.vue', 'export const state = {}', {
    props: { fit: FIT, art: 'art.png', cutlines: false },
  })
  ok(!/dashed/.test(plain), 'and none when they are not')

  /*
   * The margin is a share of the real page, not a fixed inset — so a 25mm
   * margin on screen is a 25mm margin on paper, which is the whole reason
   * somebody looks at this rather than reading the number back.
   */
  ok(/inset:[^"]*%/.test(html), 'the margin is drawn as a share of the page')
}

console.log('the paper is named, chosen, and obeyed')
{
  const { pageFit, PAPERS, paperOf } = await import('../src/lib/ticketsheet.js')
  const { DEFAULT_DESIGN } = await import('../src/lib/ticketdesign.js')
  const on = (paper, landscape) => {
    const d = JSON.parse(JSON.stringify(DEFAULT_DESIGN))
    d.sheet.paper = paper
    d.sheet.landscape = landscape
    return pageFit(d)
  }
  ok(PAPERS.length >= 5, `${PAPERS.length} papers offered, by name and millimetres`)
  eq(paperOf({}).label, 'A4', 'a design that never chose one is A4')
  eq(paperOf({ sheet: { paper: 'nonsense' } }).label, 'A4', 'and so is one that chose nothing real')

  /*
   * Capacity has to follow the paper, or the number beside the preview is
   * about a different sheet from the one in it.
   */
  ok(on('a3', false).per > on('a4', false).per, 'A3 holds more than A4')
  ok(on('a4', true).per < on('a4', false).per, 'and a turned sheet holds fewer')
  eq(on('a4', true).paper.widthMM, 297, 'landscape swaps the dimensions')

  /*
   * THE FAILURE THAT USED TO READ AS SUCCESS. The old arithmetic was about
   * height alone, so a 190mm ticket on A5 — 148mm wide — answered "2 per
   * page" and printed off the side of the paper.
   */
  const a5 = on('a5', false)
  ok(a5.tooWide, 'a ticket wider than the paper is caught')
  ok(!a5.fits, 'and is not reported as fitting')
  ok(on('a4', false).fits && !on('a4', false).tooWide, 'while a real fit still fits')

  const design = read('src/components/TicketDesign.vue')
  ok(/PAPERS/.test(design), 'the tab offers the papers rather than assuming one')
  ok(/design\.sheet\.landscape = true/.test(design), 'and the orientation is a control')
  ok(/wider than \{\{ fit\.paper\.label \}\}/.test(design), 'the too-wide case is said in the interface')
}

console.log('it is the same shell as the tabs beside it')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ONE), { drive: onSheetTab })
  for (const part of ['rail', 'stagewrap', 'panel']) {
    ok(new RegExp(`class="[^"]*\\b${part}\\b`).test(html), `the ${part} column is there`)
  }
  /*
   * The rule that made this tab a single column is gone. It was the direct
   * cause of the empty window: a shell built for three columns, told to use
   * one, holding about four hundred pixels of controls.
   */
  ok(!/sheettab/.test(read('src/components/TicketDesign.vue')),
    'and the one-column override that emptied the window is gone')
}

console.log('one drawing, shared, so the two screens cannot drift')
{
  const drawers = readdirSync(join(ROOT, 'src/components'), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.vue'))
    .filter((f) => /class="a4"/.test(read(join('src/components', f))))
  eq(drawers.length, 1, `exactly one component draws the page (${drawers.join(', ') || 'none'})`)
  eq(drawers[0], 'ui/SheetPreview.vue', 'and it is the shared one')

  for (const f of ['src/components/TicketDesign.vue', 'src/components/modals/PrintTickets.vue']) {
    ok(/SheetPreview/.test(read(f)), `${f} uses it rather than its own copy`)
  }
  // Both hand it the same geometry. A preview fed anything else is a preview
  // that can disagree with the number printed beside it.
  for (const f of ['src/components/TicketDesign.vue', 'src/components/modals/PrintTickets.vue']) {
    ok(/:fit="fit"/.test(read(f)), `${f} feeds it the same pageFit result`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
