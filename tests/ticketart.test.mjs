/*
 * THE NUMBER LANDS IN THE SPACE THE ARTWORK LEAVES FOR IT.
 *
 * "Exact" here is not a feeling. It is three checks with no tolerance in them:
 * the digits sit on the printed label's own baseline, they stand exactly as
 * tall as the printed label's capitals, and they start after the colon and stop
 * before the logo. Everything else in this file exists to stop one of those
 * three quietly ceasing to be true.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. A number three pixels off its line is not
 * a rendering bug that somebody notices and reports; it is a box of two
 * thousand printed tickets that look slightly wrong and cannot be reprinted
 * without paying for them twice.
 *
 * These assertions were written against ticket-lab/, the standalone pilot that
 * established the geometry, and moved here when it was wired into the app. They
 * now run against DEFAULT_DESIGN, which is the same measurements in the place
 * the app reads them from.
 */
import { DEFAULT_DESIGN, REFERENCE, designFor, validateDesign } from '../src/lib/ticketdesign.js'
import {
  FONT, SPACING, advanceOf, checkSerial, place, placeFitted, placeBoth, numberLayerSVG, qrModuleMM,
} from '../src/lib/ticketart.js'
import { sheetHTML } from '../src/lib/ticketsheet.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const near = (g, w, what, tol = 1e-9) => { Math.abs(g - w) <= tol ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const throws = (fn, what) => { try { fn(); fail++; console.log('  FAIL ' + what + ': did not throw') } catch { pass++ } }

const D = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
const HALVES = ['main', 'stub']

console.log('it sits on the printed label\'s own line')
/*
 * Not near it. The baseline handed to the renderer is the baseline measured off
 * the printed label, and it is passed through untouched — an SVG <text> y IS
 * its baseline, so there is no rounding step between this number and the ink on
 * the paper.
 */
for (const half of HALVES) {
  const p = place(D, half, 'KS-03291')
  eq(p.baseline, D[half].label.baseline, `${half}: baseline is the label's baseline`)
  near(p.top, D[half].label.capTop, `${half}: digits start at the label's cap height`)
  near(p.digitHeight, D[half].capHeight, `${half}: digits are as tall as the label's capitals`)
}

console.log('it starts after the colon, by the same optical gap on both halves')
/*
 * The gap is the number's own size times SPACING.gap, so the main half and the
 * stub read alike even though the stub's number is a shade over half the size.
 * A gap measured in pixels would look twice as wide on the stub.
 */
for (const half of HALVES) {
  const p = place(D, half, 'KS-03291')
  ok(p.x > D[half].label.right, `${half}: the number begins to the right of the colon`)
  near(p.x - D[half].label.right, SPACING.gap * p.fontSize, `${half}: the gap is ${SPACING.gap}em`)
}
{
  const m = place(D, 'main', 'KS-03291'), s = place(D, 'stub', 'KS-03291')
  near((m.x - D.main.label.right) / m.fontSize, (s.x - D.stub.label.right) / s.fontSize,
    'both halves share one optical gap')
}

console.log('it stops before the logo')
for (const half of HALVES) {
  const p = place(D, half, 'KS-99999')
  ok(p.fits, `${half}: this raffle's numbering fits`)
  ok(p.limit < D[half].clearRight, `${half}: the limit stops short of the logo`)
  ok(p.right <= p.limit, `${half}: the number ends inside the limit`)
  ok(p.spareDigits > 0, `${half}: there is room for more digits (${p.spareDigits})`)
  ok(p.clearsBelow, `${half}: and it sits above whatever follows it`)
  ok(p.clearsTop, `${half}: and inside the top of the ticket`)
}

console.log('every digit is the same width, so a column does not wobble')
for (const half of HALVES) {
  const a = place(D, half, '00000'), b = place(D, half, '99999'), c = place(D, half, '10101')
  near(a.width, b.width, `${half}: 00000 and 99999 are the same width`)
  near(a.width, c.width, `${half}: and so is every other combination`)
  near(a.x, b.x, `${half}: the number always starts in the same place`)
}

console.log('a bigger number grows upward, off the shared baseline')
for (const half of HALVES) {
  const one = place(D, half, 'KS-03291'), two = place(D, half, 'KS-03291', { scale: 2 })
  eq(two.baseline, one.baseline, `${half}: scale leaves the baseline alone`)
  near(two.digitHeight, one.digitHeight * 2, `${half}: scale 2 doubles the digit height`)
  ok(two.top < one.top, `${half}: so it grows upward`)
}
{
  // An override may be bold; it may not be silent. A number taller than the
  // ticket is reported rather than clamped, because it is not noticed until it
  // is printed with its heads sliced off.
  const wild = place(D, 'main', 'KS-03291', { scale: 4 })
  ok(!wild.clearsTop, 'a number taller than the ticket says so')
  ok(place(D, 'main', 'KS-03291', { scale: 3 }).clearsTop, 'while one that still fits does not')
}

console.log('too long is reported first, and only then solved')
/*
 * `place` is the honest one: it says a number does not fit and by how much, and
 * does not touch the size. `placeFitted` is what the renderer calls, and the
 * guarantee that matters is that whatever it returns is inside the limit — a
 * serial printed across the logo would be taken for a misprint at the draw,
 * which is worse than one a point or two smaller.
 */
{
  const long = 'CEAM-000001-XXXXXXXXXX'
  const raw = place(D, 'stub', long)
  ok(!raw.fits, 'a number too long is reported as not fitting')
  ok(raw.overflow > 0, 'and by how much')
  ok(raw.spareDigits < 0, 'and that it is already past the limit')

  const fitted = placeFitted(D, 'stub', long)
  ok(fitted.shrunk, 'placeFitted says it shrank the number')
  ok(fitted.fits, 'and what it returns fits')
  eq(fitted.baseline, raw.baseline, 'shrinking does not move the baseline')
  ok(fitted.appliedScale < 1, 'the applied scale is reported')
  near(fitted.right, fitted.limit, 'and it shrinks to exactly the limit, not to a safe-looking guess', 1e-6)

  const easy = placeFitted(D, 'main', 'KS-03291')
  ok(!easy.shrunk, 'a number that fits is not touched')
}

console.log('both halves carry the same number')
{
  const both = placeBoth(D, 'KS-03291')
  eq(both.main.text, both.stub.text, 'they are only a pair because they match')
  eq(both.main.text, 'KS-03291', 'and it is the one that was asked for')
  ok(both.main.fill !== both.stub.fill, 'each half uses its own ink colour')
}

console.log('a width that cannot be known is refused, not guessed')
/*
 * A glyph with no measured width does not draw wrong — it makes the width
 * unknowable, and a number whose width is unknown cannot be checked against the
 * logo it must not touch.
 */
{
  near(advanceOf('00000'), 2.5, 'five digits are 2.5 em')
  eq(advanceOf('ks-1'), advanceOf('KS-1'), 'case does not change the width')
  throws(() => advanceOf('0★0'), 'an unmeasurable glyph is refused')
  throws(() => place(D, 'front', '00001'), 'an unknown half is refused')
  ok(checkSerial('KS-03291').ok, 'this raffle\'s own numbering is drawable')
  ok(!checkSerial('KS-03291★').ok, 'a glyph with no width is not')
  ok(checkSerial('KS-03291★').problems[0].includes('★'), 'and it is named')
  eq(checkSerial('00000').emWidth, 2.5, 'a drawable number reports its width')
}

console.log('the measurements scale to whatever artwork was uploaded')
/*
 * The same ticket at twice the resolution is the same ticket. An organiser who
 * re-exports their artwork for the press must not have to place the number
 * again — so the defaults scale, and the proportions survive.
 */
{
  const big = designFor({ width: 3200, height: 1034, design: {} })
  eq(big.main.label.baseline, DEFAULT_DESIGN.main.label.baseline * 2, 'the baseline doubles')
  eq(big.main.capHeight, DEFAULT_DESIGN.main.capHeight * 2, 'and so does the digit height')
  eq(big.qrMain.size, DEFAULT_DESIGN.qrMain.size * 2, 'and the QR box')

  const a = place(D, 'main', 'KS-03291')
  const b = place(big, 'main', 'KS-03291')
  near(b.x / a.x, 2, 'so the number starts in the same relative place', 1e-6)
  near(b.width / a.width, 2, 'and measures the same fraction of the ticket', 1e-6)
}

console.log('what an organiser saved wins over the defaults')
{
  const moved = designFor({ width: 1600, height: 517, design: { main: { capHeight: 30 } } })
  eq(moved.main.capHeight, 30, 'a saved measurement is used')
  eq(moved.main.label.baseline, DEFAULT_DESIGN.main.label.baseline, 'and the rest is left alone')
  eq(moved.stub.capHeight, DEFAULT_DESIGN.stub.capHeight, 'including the other half')
}

console.log('a design that would put the number nowhere is caught')
{
  eq(validateDesign(D, { width: 1600, height: 517 }).length, 0, 'the standard design is fine')

  const noRoom = designFor({ width: 1600, height: 517, design: { main: { clearRight: 100 } } })
  ok(validateDesign(noRoom, { width: 1600, height: 517 }).length > 0,
    'a slot whose number must stop before it starts is refused')

  const offPage = designFor({ width: 1600, height: 517, design: { qrMain: { x: 1590 } } })
  ok(validateDesign(offPage, { width: 1600, height: 517 }).some((p) => /outside/.test(p)),
    'a QR box off the edge of the picture is refused, by name')

  const nan = designFor({ width: 1600, height: 517, design: { stub: { capHeight: NaN } } })
  ok(validateDesign(nan, { width: 1600, height: 517 }).length > 0,
    'a measurement that is not a number is refused')
}

console.log('the drawing keeps the measurements')
/*
 * The arithmetic above is worth nothing if it does not survive the trip into
 * the SVG. A renderer that is three pixels out undoes every measurement in the
 * file, and it would do it invisibly.
 */
{
  const attrs = (svg) => [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = {}
    for (const p of m[1].matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)) a[p[1]] = p[2] ?? p[3]
    return { ...a, content: m[2] }
  })

  const svg = numberLayerSVG(D, 'KS-03291')
  ok(svg.includes(`viewBox="0 0 ${REFERENCE.width} ${REFERENCE.height}"`), 'the overlay uses the artwork\'s pixel space')
  ok(svg.includes('preserveAspectRatio="none"'), 'and is stretched to the ticket exactly as the background is')

  const p = placeBoth(D, 'KS-03291')
  const t = attrs(svg)
  eq(t.length, 2, 'one number on each half')
  for (const [i, half] of [[0, 'main'], [1, 'stub']]) {
    near(Number(t[i].x), p[half].x, `${half}: x is the measured x`, 0.001)
    near(Number(t[i].y), p[half].baseline, `${half}: y is the measured baseline`, 0.001)
    near(Number(t[i]['font-size']), p[half].fontSize, `${half}: font-size is the measured size`, 0.001)
    near(Number(t[i].textLength), p[half].width, `${half}: textLength is the measured width`, 0.001)
    eq(t[i].lengthAdjust, 'spacing', `${half}: width is held by spacing, not by squashing the glyphs`)
    eq(t[i].fill, p[half].fill, `${half}: the ink is the half's own colour`)
    eq(t[i].content, 'KS-03291', `${half}: the number is the one asked for`)
  }

  ok(numberLayerSVG(D, 'KS-1').includes('textLength='), 'the measured width is pinned by default')
  ok(!numberLayerSVG(D, 'KS-1', { pinWidth: false }).includes('textLength='), 'and can be released on request')
}

console.log('the guides and the QR box are tools, never defaults')
{
  const plain = numberLayerSVG(D, 'KS-03291')
  ok(!plain.includes('<rect'), 'nothing extra is drawn unless it is asked for')
  ok(numberLayerSVG(D, 'KS-03291', { guides: true }).includes('<rect'), 'guides draw the number\'s box')
  ok(numberLayerSVG(D, 'KS-03291', { qrBoxes: true }).includes('<rect'), 'and the QR box can be shown')
  // An outline is not a QR and must never reach paper going to a buyer.
  ok(!sheetHTML(D, ['KS-00001'], 'x').includes('stroke-dasharray'), 'a printed sheet carries neither')
}

console.log('a number the lab cannot measure never reaches the markup')
{
  let threw = false
  try { numberLayerSVG(D, 'A&B') } catch { threw = true }
  ok(threw, 'it is refused while the geometry is worked out, not escaped afterwards')
  const html = sheetHTML(D, ['KS-00001'], 'x', { title: 'Books 1 & 2 <draft>' })
  ok(html.includes('Books 1 &amp; 2 &lt;draft&gt;'), 'text around the tickets is escaped')
  ok(!html.includes('<draft>'), 'and cannot open a tag')
}

console.log('the printed sheet keeps the artwork\'s shape and carries it once')
{
  const html = sheetHTML(D, ['KS-00001', 'KS-00002', 'KS-00003'], 'data:image/jpeg;base64,AAAA')
  eq(html.split('data:image/jpeg;base64,AAAA').length - 1, 1,
    'the artwork appears once for the whole sheet, not once per ticket')
  eq([...html.matchAll(/class="ticket"/g)].length, 3, 'and every ticket is on the page')
  for (const n of ['KS-00001', 'KS-00002', 'KS-00003']) {
    eq((html.match(new RegExp(`>${n}</text>`, 'g')) || []).length, 2, `${n} is printed on both halves`)
  }

  const w = Number(html.match(/width:\s*([\d.]+)mm/)[1])
  const h = Number(html.match(/height:\s*([\d.]+)mm/)[1])
  eq(w, D.sheet.widthMM, 'the width is the one that was set')
  near(h, w * (REFERENCE.height / REFERENCE.width), 'and the height follows the artwork\'s own shape', 0.001)

  const narrow = sheetHTML(D, ['KS-00001'], 'x', { widthMM: 100 })
  near(Number(narrow.match(/height:\s*([\d.]+)mm/)[1]), 100 * (REFERENCE.height / REFERENCE.width),
    'at any width', 0.001)
}

console.log('the QR density is arithmetic, and it is the number that decides scanning')
{
  /*
   * A QR is read off paper by a phone camera. Below about 0.3 mm a module, that
   * stops being reliable — so the design screen shows this figure rather than
   * leaving somebody to find out from a press run.
   */
  const mm = qrModuleMM(D, D.qrMain)
  ok(mm > 0.3, `the standard QR box prints ${mm.toFixed(2)} mm a module, which scans`)
  const tiny = qrModuleMM(D, { ...D.qrMain, size: 40 })
  ok(tiny < mm, 'a smaller box gives a smaller module')
  const wide = qrModuleMM({ ...D, sheet: { ...D.sheet, widthMM: 380 } }, D.qrMain)
  near(wide, mm * 2, 'and printing the ticket twice as wide doubles it', 1e-9)
}

console.log('the font is the one whose widths are written down')
{
  ok(/Times New Roman/.test(FONT.family), 'Times, whose digits are all half an em')
  ok(/Liberation Serif|Tinos/.test(FONT.family),
    'with its metric clones behind it, so a print shop on Linux gets the same widths')
  const d = FONT.advance.bold
  ok('0123456789'.split('').every((c) => d[c] === 0.5), 'every digit is exactly 0.5 em, in bold')
  ok('0123456789'.split('').every((c) => FONT.advance.regular[c] === 0.5), 'and in regular')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
