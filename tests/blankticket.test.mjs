/*
 * THE TICKET YOU START FROM WHEN NOBODY HAS SENT ARTWORK.
 *
 * WHY THIS IS NEEDED. The studio places fields onto a picture and holds every
 * position as a share of it, so a raffle with no artwork could not begin — the
 * screen sent you to the upload tab and there was nothing to upload. The answer
 * is a generated PNG of the ticket's own size rather than a special "blank"
 * mode, so that placement, the print sheet and the QR all work unchanged
 * because none of them knows anything happened.
 *
 * WHAT IS WORTH ASSERTING, and it is only the geometry. The rasterising needs a
 * browser and does nothing interesting — it draws the string this file checks.
 * What can be WRONG is the arithmetic: a millimetre converted at the wrong
 * resolution gives a ticket that prints at the wrong size, which nobody notices
 * until two hundred of them are on paper and the stub is in the wrong place.
 *
 * WHAT THIS CANNOT DO is tell you the picture looks right. It says the numbers
 * are the numbers.
 */
import { artboardSVG, mmToPx } from '../src/lib/blankticket.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

console.log('millimetres become pixels at the resolution it will print at')
{
  eq(mmToPx(25.4, 300), 300, 'one inch at 300 dpi is 300 pixels')
  eq(mmToPx(190, 300), 2244, '190 mm at 300 dpi is the width the studio already uses')
  eq(mmToPx(210, 300), 2480, 'and A4 across is 2480')
  /*
   * The resolution is an argument, not a constant, because a raffle printing at
   * home and one going to a trade printer are not the same job. Asserted so
   * nobody quietly hard-codes 300 back into the conversion.
   */
  eq(mmToPx(190, 150), 1122, 'halving the dpi halves the pixels')
  eq(mmToPx(0, 300), 0, 'nothing is nothing')
  eq(mmToPx(undefined, 300), 0, 'and a missing measurement is not NaN')
}

console.log('the artboard is the size that was asked for')
{
  const svg = artboardSVG(190, 61.5, 0.688, 300)
  ok(svg.startsWith('<svg'), 'it is an SVG document')
  ok(svg.includes('width="2244"'), '2244 px wide — 190 mm at 300 dpi')
  ok(svg.includes('height="726"'), 'and 726 px tall')
  ok(svg.includes('viewBox="0 0 2244 726"'), 'with a viewBox that agrees with both')
}

console.log('it carries the two lines that make a rectangle read as a ticket')
{
  const svg = artboardSVG(190, 61.5, 0.688, 300)
  ok((svg.match(/<rect/g) || []).length === 2, 'the paper, and the trim edge drawn on it')
  ok(svg.includes('<line'), 'and the perforation where the stub tears off')
  ok(/stroke-dasharray="\d+ \d+"/.test(svg), 'dashed, because that is what a perforation looks like')

  /*
   * THE STUB LINE IS WHERE THE DESIGN SAYS, which is the one number on here
   * that a person chose. 0.688 of 2244 is 1544; a stub drawn anywhere else is a
   * ticket that tears in the wrong place, and it is only visible once it is
   * printed and torn.
   */
  const x = Number((svg.match(/<line x1="(\d+)"/) || [])[1])
  eq(x, 1544, 'the perforation sits at the share the design gives')
}

console.log('a stub share that would land on the edge is brought inside')
{
  /*
   * NOT A TIDINESS GUARD. A design carrying 0 or 1 — an old one, or a number
   * dragged to the end — would draw the perforation exactly on top of the trim
   * edge, and the ticket would read as having no stub at all rather than as
   * carrying a bad value. Two wrongs that look identical are worth one clamp.
   */
  const at0 = Number((artboardSVG(190, 61.5, 0, 300).match(/<line x1="(\d+)"/) || [])[1])
  const at1 = Number((artboardSVG(190, 61.5, 1, 300).match(/<line x1="(\d+)"/) || [])[1])
  ok(at0 > 0, `a share of 0 is brought inside the trim (${at0})`)
  ok(at1 < 2244, `and a share of 1 is too (${at1})`)
  const missing = Number((artboardSVG(190, 61.5, undefined, 300).match(/<line x1="(\d+)"/) || [])[1])
  ok(missing > 0 && missing < 2244, `and no share at all still draws a stub (${missing})`)
}

console.log('the rules scale with the artboard, so a small ticket is not drawn in bold')
{
  const small = artboardSVG(74, 52, 0.7, 300)
  const big = artboardSVG(297, 105, 0.7, 300)
  const w = (s) => Number((s.match(/stroke-width="(\d+)"/) || [])[1])
  eq(w(small), w(big), 'the same weight at both sizes, because it is a print measure not a pixel one')
  const low = artboardSVG(190, 61.5, 0.7, 72)
  ok(w(low) < w(small), `and a lower resolution draws a thinner rule (${w(low)} against ${w(small)})`)
}

console.log('the paper is painted, not left transparent')
{
  /*
   * A PNG with an alpha channel looks right on screen and comes out of a
   * printer as a ticket with no face. The fill is asserted here because the
   * canvas half cannot be tested without a browser, and this is the half that
   * says what colour the paper is.
   */
  const svg = artboardSVG(190, 61.5, 0.7, 300)
  ok(/<rect width="2244" height="726" fill="#ffffff"\/>/.test(svg),
     'the first rect fills the whole artboard with white')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
