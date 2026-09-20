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
import { lockAxis, keepRatio } from '../src/lib/ticketelements.js'

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
  // The gate on the studio screen. The fixture is a desk.
  roomy: true,
})
export const api = async () => (${JSON.stringify(reply)})
export const setConfig = () => {}
export const toast = () => {}
export const go = () => {}
// The studio asks the shell for the room and gives it back on the way out.
// Present because this stub mirrors the real store's exports — a screen that
// grows an import otherwise fails the BUNDLE, which reads as a broken component
// rather than as a fixture one field behind.
export const setFocus = () => {}
export const NO_ROOM_WHY = 'The ticket studio needs a tablet or a computer.'
export const ROOM_FOR_STUDIO = '(min-width: 720px) and (min-height: 600px)'
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

console.log('and the tab really does mount it, not just intend to')
{
  /*
   * THE ASSERTION THE HARNESS COULD NOT MAKE UNTIL NOW. Children render their
   * slots and nothing of their own, so a tab that mounts the page rendered an
   * empty stage here however correct it was — the page had to be tested
   * separately and the WIRING taken on trust. `renderReal` asks for one child
   * to be drawn for real, which is also the thing that makes splitting this
   * screen into tab components possible: without it, moving a tab into a child
   * blanks every assertion about its contents while the screen is fine.
   */
  const html = await renderScreen('src/components/TicketDesign.vue', store(ONE), {
    drive: onSheetTab, renderReal: ['SheetTab.vue', 'SheetPreview.vue'],
  })
  ok(/class="a4"/.test(html), 'the page is drawn inside the tab, not merely referenced')
  const slots = (html.match(/class="slot"/g) || []).length
  ok(slots > 0, `with ${slots} ticket slots on it`)
  ok(/aspect-ratio/.test(html), 'at the shape of the paper')
}

console.log('holding shift means the drag was meant exactly')
{
  /*
   * WHAT THIS IS FOR. A box on a ticket is nearly always meant level with
   * something — a line of type, the box above it, the edge of the stub. The
   * designer previews at about 15% of actual size, so a drag that looks
   * perfect puts a serial number a third of a millimetre out of true:
   * invisible on screen, obvious on a printed sheet of forty.
   *
   * The pointer handling is not testable here and does not need to be. What
   * is worth pinning is the DECISION each modifier makes, which is geometry.
   */
  eq(lockAxis(0.05, 0.01).join(), '0.05,0', 'mostly across moves only across')
  eq(lockAxis(0.01, 0.05).join(), '0,0.05', 'mostly down moves only down')
  eq(lockAxis(-0.05, 0.01).join(), '-0.05,0', 'and direction is not what decides it, distance is')
  // A tie has to go somewhere, and it has to go there every time: a box that
  // jitters between axes at 45 degrees is worse than one that picks wrong.
  eq(lockAxis(0.03, 0.03).join(), '0.03,0', 'an exact diagonal resolves the same way every time')

  const wide = { width: 0.30, height: 0.05 }
  const r = keepRatio(wide, 0.60, 0.99)
  eq(r.width, 0.6, 'width leads, because width is what is being dragged')
  eq((r.width / r.height).toFixed(2), (wide.width / wide.height).toFixed(2),
    'and the shape it already had is kept')
  /*
   * A box with no shape yet cannot have one preserved, and dividing by its
   * height would produce Infinity — which lands in the design JSON as null
   * and takes the element off the ticket.
   */
  eq(keepRatio({ width: 0, height: 0 }, 0.2, 0.1).height, 0.1, 'a box with no shape keeps what it is given')
  ok(keepRatio(wide, 0.001, 0.5).height >= 0.002, 'and a squashed one never reaches zero height')
}

console.log('the action you cannot take back does not look like the one you can')
{
  /*
   * THREE BUTTONS SAT TOGETHER AND LOOKED THE SAME. Undo takes back one
   * step. "Back to saved" throws away this sitting's work. "Back to
   * standard" discards the whole design — every measurement anybody has
   * made on that template, including the ones read off the printed artwork
   * with a ruler — and it was a plain ghost button, first in the row, flush
   * against the other two.
   *
   * Nothing on the screen said which of the three could not be taken back,
   * and nothing in the suite would have noticed: the design rules pinned
   * here are about disabled reasons and role words, not about weight.
   */
  const src = read('src/components/TicketDesign.vue')
  const foot = src.slice(src.indexOf('<footer class="footbar">'), src.indexOf('</footer>'))
  ok(/Back to standard/.test(foot) && /Back to saved/.test(foot) && /Undo/.test(foot),
    'all three actions are still offered')
  /*
   * Matched as BUTTON ELEMENTS, not by slicing around a label. The first
   * version cut the string at indexOf('Back to standard') — which found the
   * comment above the button, not the button — and reported a correct file
   * as failing. A test that reads markup has to match markup.
   */
  const buttons = [...foot.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)]
    .map((m) => ({ attrs: m[1], label: m[2].trim() }))
  ok(buttons.length === 3, `three actions found (${buttons.map((b) => b.label).join(', ')})`)
  const by = (label) => buttons.find((b) => b.label === label)
  ok(/danger/.test(by('Back to standard').attrs), 'the one that cannot be undone is marked as dangerous')
  ok(!/danger/.test(by('Back to saved').attrs), 'the one that only loses this sitting is not')
  ok(!/danger/.test(by('Undo').attrs), 'and undo certainly is not')
  /*
   * A reason in the title, which is this repo's rule for a control whose
   * consequence is not obvious from its label — the same rule permissionui
   * enforces for controls somebody may not use.
   */
  ok(/cannot be undone/.test(foot), 'and it says so where somebody hovering will read it')
  ok(/class="gap"/.test(foot), 'with a space between it and the two that are safe')
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

  const tab = read('src/components/ticketdesign/SheetTab.vue')
  ok(/PAPERS/.test(tab), 'the tab offers the papers rather than assuming one')
  ok(/design\.sheet\.landscape = true/.test(tab), 'and the orientation is a control')
  ok(/wider than \{\{ fit\.paper\.label \}\}/.test(tab), 'the too-wide case is said in the interface')
}

console.log('and it reuses the screen\'s own controls rather than inventing them')
{
  /*
   * A SECOND `.seg` RULE LIVED HERE FOR A DAY. This screen already has a
   * segmented control — .seg with .segbtn children — used by the
   * field/code/words switch, the alignment row and the overflow row. The
   * orientation toggle was given its own `.seg { ... }` block, which does not
   * scope to the toggle: it overrode all three of the others with a border, a
   * margin and a different background. Nothing failed, nothing looked broken
   * enough to report, and three unrelated controls quietly changed shape.
   *
   * So: one rule per class name in this file, checked, because a duplicate
   * class is invisible in a diff and global in effect.
   */
  /*
   * CHECKED IN EVERY FILE THAT STYLES THIS SCREEN, not only the one where it
   * happened. studio.css is the shell the three tabs share, so a duplicate
   * there reaches further than the one that caused this — and it is about to
   * be edited repeatedly by the token work, which is exactly when a class
   * gets reintroduced.
   */
  for (const f of ['src/components/ticketdesign/SheetTab.vue',
                   'src/components/ticketdesign/studio.css',
                   'src/components/TicketDesign.vue']) {
    const text = read(f)
    const block = f.endsWith('.css') ? text : text.slice(text.indexOf('<style'))
    const names = [...block.matchAll(/^\.([a-zA-Z][\w-]*) *\{/gm)].map((m) => m[1])
    const twice = names.filter((n, i) => names.indexOf(n) !== i)
    ok(names.length > 0, `${f} has rules to check (${names.length})`)
    eq(twice.length, 0, `${f} defines no class twice (${[...new Set(twice)].join(', ') || 'none'})`)
  }
  const style = read('src/components/ticketdesign/SheetTab.vue')
  ok(/class="seg orient"/.test(style), 'orientation uses the existing segmented control')
  ok(/segbtn/.test(style.slice(style.indexOf('orient'))) || /class="segbtn"/.test(style),
    'with the same button class as the others')
}

console.log('it is the same shell as the tabs beside it')
{
  const html = await renderScreen('src/components/TicketDesign.vue', store(ONE), { drive: onSheetTab, renderReal: ['SheetTab.vue'] })
  for (const part of ['rail', 'stagewrap', 'panel']) {
    ok(new RegExp(`class="[^"]*\\b${part}\\b`).test(html), `the ${part} column is there`)
  }
  /*
   * The rule that made this tab a single column is gone. It was the direct
   * cause of the empty window: a shell built for three columns, told to use
   * one, holding about four hundred pixels of controls.
   */
  ok(!/sheettab/.test(read('src/components/ticketdesign/SheetTab.vue')),
    'and the one-column override that emptied the window is gone')
}

console.log('one drawing, shared, so the two screens cannot drift')
{
  const drawers = readdirSync(join(ROOT, 'src/components'), { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.vue'))
    .filter((f) => /class="a4"/.test(read(join('src/components', f))))
  eq(drawers.length, 1, `exactly one component draws the page (${drawers.join(', ') || 'none'})`)
  eq(drawers[0], 'ui/SheetPreview.vue', 'and it is the shared one')

  for (const f of ['src/components/ticketdesign/SheetTab.vue', 'src/components/modals/PrintTickets.vue']) {
    ok(/SheetPreview/.test(read(f)), `${f} uses it rather than its own copy`)
  }
  // Both hand it the same geometry. A preview fed anything else is a preview
  // that can disagree with the number printed beside it.
  for (const f of ['src/components/ticketdesign/SheetTab.vue', 'src/components/modals/PrintTickets.vue']) {
    ok(/:fit="fit"/.test(read(f)), `${f} feeds it the same pageFit result`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
