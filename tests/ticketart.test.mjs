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
import { legacyFromElements, validateElements } from '../src/lib/ticketelements.js'
import { stubShare } from '../src/lib/ticketdesign.js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FONT, SPACING, advanceOf, checkSerial, place, placeFitted, placeBoth, numberLayerSVG, qrModuleMM,
  placeBook, placeBuyer, measurable, TEXT_FAMILY,
  stubCardSVG, CARD_STUB,
} from '../src/lib/ticketart.js'
import { sheetHTML, pageFit, PAGE } from '../src/lib/ticketsheet.js'

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

console.log('the book a ticket came out of is printed on it')
{
  /*
   * The number identifies the ticket; the book is what a person is holding.
   * Stubs come back as a book, a seller is handed books, and a counted-in book
   * is reconciled as a book — so a ticket that does not say which one it
   * belongs to has to be looked up before it can be filed.
   */
  const p = placeBoth(D, 'KS-03291')
  const main = placeBook(D, 'main', 'Book-0007', p.main)
  ok(!!main, 'the buyer\'s half carries it')
  ok(main.x > p.main.right, 'after the number, not over it')
  eq(main.baseline, p.main.baseline, 'on the same line')
  ok(main.right <= main.limit, 'and still clear of the roundel')
  ok(main.fontSize < p.main.fontSize, 'smaller than the number — it is the secondary fact')

  /*
   * A LONGER NUMBER PUSHES IT ALONG. The gap is measured from where the number
   * actually ended, not from a fixed point, so the two can never overprint.
   */
  const long = placeBoth(D, 'KS-9999999999')
  const after = placeBook(D, 'main', 'Book-0007', long.main)
  ok(after.x > main.x, 'a longer ticket number moves the book label right')
  ok(after.x > long.main.right, 'and it still starts after the number')

  /*
   * THE STUB GOES UNDERNEATH, and that is not a fallback. Its number ends about
   * 45 px before the small roundel and a book label needs nearer 70, so beside
   * the number there is nowhere to put it. Below it there are 27 px of clear
   * white before the stub's own printing starts.
   */
  const stub = placeBook(D, 'stub', 'Book-0007', p.stub)
  ok(!!stub, 'the stub carries it too')
  ok(stub.baseline > p.stub.baseline, 'on its own line, under the number')
  ok(stub.baseline < D.stub.clearBelow, 'and above the stub\'s own printing')
  eq(Math.round(stub.x), Math.round(p.stub.x), 'lined up with the number above it')

  // No room is no label. Overprinting a logo is worse than leaving it off.
  const cramped = designFor({ width: 1600, height: 517, design: { book: { main: { gap: 60 } } } })
  eq(placeBook(cramped, 'main', 'Book-0007', place(cramped, 'main', 'KS-03291')), null,
    'a label with nowhere to go is dropped rather than printed over the logo')
  const off = designFor({ width: 1600, height: 517, design: { book: { main: { enabled: false } } } })
  eq(placeBook(off, 'main', 'Book-0007', p.main), null, 'and it can simply be switched off')
}

console.log('a sold ticket\'s stub is filled in on its own ruled lines')
{
  const values = { name: 'Daw Hla', phone: '012-555 0001', address: 'Klang', seller: 'Pa Thang' }
  const fields = placeBuyer(D, values)
  eq(fields.length, 4, 'all four lines the stub is printed with')
  eq(fields.map((f) => f.field).sort().join(), 'address,name,phone,seller', 'by name')
  for (const f of fields) {
    ok(f.baseline < D.stub.clearBelow || f.baseline > D.stub.label.baseline,
      `${f.field} sits on the stub, not over the heading`)
    ok(f.family === TEXT_FAMILY, `${f.field} is drawn in a font that has Myanmar glyphs`)
  }

  /*
   * THE WIDTH IS NEVER PINNED, and that is a fix rather than an omission. The
   * only advance widths this app has written down are Times', and these lines
   * are drawn in the Myanmar stack — so pinning the Times estimate made the
   * browser spread the glyphs to reach it, and "Klang" printed as "K l a n g".
   */
  ok(fields.every((f) => f.width === null), 'no width is pinned for buyer text')
  const svg = numberLayerSVG(D, 'KS-1', { buyer: { name: 'Klang' } })
  const at = svg.indexOf('>Klang<')
  ok(at > 0, 'the name is drawn')
  ok(!svg.slice(svg.lastIndexOf('<text', at), at).includes('textLength'),
    'and without a textLength that would stretch it')

  /* An empty field prints the blank line the stub came with. */
  eq(placeBuyer(D, { name: 'Daw Hla' }).length, 1, 'only the fields that have something in them')
  eq(placeBuyer(D, {}).length, 0, 'and none at all for a ticket with nothing recorded')
  eq(placeBuyer(D, null).length, 0, 'nor for no buyer at all')

  /* A name too long for its line stops visibly rather than running off the edge. */
  const long = placeBuyer(D, { seller: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })[0]
  ok(long.truncated, 'an overlong value is cut')
  ok(long.text.endsWith('.'), 'and says so')
  ok(long.text.length < 26, 'and is shorter than what it was given')

  /* Burmese cannot be measured from the Times table, and must not be refused. */
  ok(!measurable('\u1012\u1031\u102b\u103a'), 'Burmese is not measurable from the advance table')
  const my = placeBuyer(D, { name: '\u1012\u1031\u102b\u103a\u101c\u103e\u1019\u103c\u1004\u1037\u103a' })
  eq(my.length, 1, 'but it is still placed')
  ok(!my[0].truncated, 'and not truncated on a width nobody could compute')
}

console.log('the buyer is drawn only when the caller passes one')
{
  const blank = numberLayerSVG(D, 'KS-03291')
  ok(!blank.includes('Daw Hla'), 'a blank ticket carries no buyer')
  const filled = numberLayerSVG(D, 'KS-03291', { buyer: { name: 'Daw Hla' }, book: 'Book-0007' })
  ok(filled.includes('Daw Hla'), 'and a sold one does')
  ok(filled.includes('Book-0007'), 'along with its book')
  eq((filled.match(/<text/g) || []).length, 5, 'two numbers, two book labels and one name')
}


/*
 * THE MIGRATION DRAWS THE SAME TICKET.
 *
 * The design model grew an element list — a box of shares per printed thing —
 * and every design already stored is in the older shape of named slots. The
 * list is DERIVED from those slots rather than retyped, so this is the test
 * that the derivation is arithmetic and not a second set of measurements: draw
 * the same ticket both ways and compare the coordinates that reach the markup.
 *
 * If this fails, a raffle that has been printing happily gets a different
 * ticket the first time somebody opens the design screen, and the two halves of
 * a book stop matching. It is the most expensive failure in this file.
 */
console.log('a design migrated to elements draws what it drew before')
{
  const attrs = (svg) => [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = {}
    for (const q of m[1].matchAll(/([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)) a[q[1]] = q[2] ?? q[3]
    return { ...a, content: m[2] }
  })

  const BUYER = { name: 'Daw Hla', phone: '012-555 0001', address: 'Klang', seller: 'Pa Thang' }
  const opts = { book: 'Book-007', buyer: BUYER }

  // The same design with the element list taken off, which sends numberLayerSVG
  // down the original path — the one every printed ticket so far came from.
  const legacy = { ...D }
  delete legacy.elements

  ok(Array.isArray(D.elements) && D.elements.length > 0, 'the standard design has an element list')
  ok(!legacy.elements, 'and it can be taken off to get the old path')

  const before = attrs(numberLayerSVG(legacy, 'KS-03291', opts))
  const after = attrs(numberLayerSVG(D, 'KS-03291', opts))

  eq(after.length, before.length, 'the same number of things are drawn')

  /*
   * Matched by what they say, then by where they are — the element list draws
   * in its own order and the order is not what is being tested. The ticket
   * number and the book both appear TWICE, once per half, so comparing by
   * content alone silently compares the main half against the stub and reports
   * a migration failure that is really a test failure.
   */
  const byText = (list) => {
    const m = new Map()
    for (const t of list) {
      if (!m.has(t.content)) m.set(t.content, [])
      m.get(t.content).push(t)
    }
    for (const v of m.values()) v.sort((p, q) => Number(p.x) - Number(q.x))
    return m
  }
  const wasDrawn = byText(before)
  const isDrawn = byText(after)

  for (const [text, olds] of wasDrawn) {
    const news = isDrawn.get(text) ?? []
    eq(news.length, olds.length, `"${text}" is still drawn ${olds.length} time(s)`)
    for (let i = 0; i < olds.length && i < news.length; i++) {
      const b = olds[i]
      const a = news[i]
      near(Number(a.x), Number(b.x), `"${text}" #${i + 1}: x is unchanged`, 0.01)
      near(Number(a.y), Number(b.y), `"${text}" #${i + 1}: baseline is unchanged`, 0.01)
      near(Number(a['font-size']), Number(b['font-size']), `"${text}" #${i + 1}: size is unchanged`, 0.01)
      eq(a.fill, b.fill, `"${text}" #${i + 1}: ink is unchanged`)
    }
  }

  /* A buyer's name is drawn in the Myanmar stack and must NOT carry a pinned
   * width, in either path — pinning one spreads the glyphs to reach a number
   * measured from a font the text is not drawn in. "Klang" came out "K l a n g". */
  const name = after.find((x) => x.content === 'Daw Hla')
  ok(name && name.textLength === undefined, 'a name in the text stack has no pinned width')
}

/*
 * HOW MANY TICKETS FIT ON A PAGE IS ARITHMETIC, NOT A SETTING.
 *
 * `sheet.perPage` was a slider from one to twelve that nothing read: the
 * tickets were laid out in a column and the browser broke the page wherever it
 * ran out of paper. So the control said four, the page took four, and neither
 * fact caused the other — setting it to twelve changed nothing on the printout.
 *
 * pageFit derives it instead, and returns the terms as well as the answer so a
 * screen can show the sum. These numbers are checkable with a ruler and a sheet
 * of A4, which is the point of showing them.
 */
console.log('what fits on a page is worked out, not guessed')
{
  const f = pageFit(D)
  eq(PAGE.heightMM, 297, 'the page is A4')
  eq(f.per, 4, 'four 61.4 mm tickets fit down 297 mm with 10 mm margins')
  near(f.heightMM, 190 * (REFERENCE.height / REFERENCE.width), 'the height comes from the artwork\'s shape', 1e-6)
  near(f.used, f.per * f.heightMM + (f.per - 1) * f.gapMM + 2 * f.marginMM, 'the sum is the terms', 1e-9)
  ok(f.used <= f.pageHeightMM, 'and it is inside the page')
  ok(f.fits, 'which it reports')

  // A bigger margin takes one off the page. This is the case the old slider got
  // wrong in silence: the number on screen stayed at four.
  eq(pageFit(D, { marginMM: 30 }).per, 3, 'a 30 mm margin leaves room for three')
  eq(pageFit(D, { widthMM: 100 }).per, 7, 'a smaller ticket fits more — 32.3 mm tall, so seven')
  ok(pageFit(D, { widthMM: 210, marginMM: 0, gapMM: 0 }).per >= 4, 'a full-width ticket still fits several')

  // Never nought, whatever it is asked. A page that holds no tickets is a loop
  // that never advances.
  eq(pageFit(D, { widthMM: 210, marginMM: 140 }).per, 1, 'a page too small for one still says one')
}

console.log('the printed sheet breaks where the arithmetic says it breaks')
{
  const numbers = Array.from({ length: 9 }, (_, i) => `KS-0000${i + 1}`)
  const html = sheetHTML(D, numbers, 'x')
  const breaks = (html.match(/class="ticket lastonpage"/g) ?? []).length
  // Nine tickets at four to a page breaks after the 4th and the 8th — and never
  // after the last one, which would emit a trailing blank page.
  eq(breaks, 2, 'nine tickets at four a page break twice')
  ok(html.includes('page-break-after: always'), 'the break is stated for older engines too')
  const one = sheetHTML(D, ['KS-00001'], 'x')
  // The class name is in the stylesheet either way, so this has to look for it
  // on a ticket rather than in the document.
  ok(!/class="ticket lastonpage"/.test(one), 'a single ticket needs no break at all')
  eq((sheetHTML(D, numbers.slice(0, 4), 'x').match(/class="ticket lastonpage"/g) ?? []).length, 0,
    'and neither does an exact pageful — a trailing break is a blank page')
}


/*
 * A SAVED DESIGN IS READ BY MORE THAN THE BROWSER THAT WROTE IT.
 *
 * The design carries both shapes: the element list, and the named slots it was
 * derived from. Nothing in this codebase reads the slots once a list exists —
 * but a browser still running the PREVIOUS bundle does, and it knows nothing
 * about elements. An organiser who had the app open across a deploy and has not
 * reloaded is that browser.
 *
 * The failure is silent, which is what makes it worth a test. Nothing throws.
 * The old bundle prints a whole run from where an element used to be, the new
 * one shows it where it now is, and the two machines disagree with no error on
 * either. So the slots are written back in step on save.
 */
console.log('the old slots are kept in step, for a reader that has not reloaded')
{
  const moved = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  const el = moved.elements.find((e) => e.source === 'buyer.name')
  ok(!!el, "the buyer's name is an element")
  el.box.left = 0.6

  const { artwork, ...rest } = moved
  void artwork
  const stored = { ...rest, ...legacyFromElements(moved) }

  const reread = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: stored })
  const asElement = reread.elements.find((e) => e.source === 'buyer.name').box.left * REFERENCE.width

  /* The old path: the same stored design with the list taken away. */
  const asSlots = { ...reread }
  delete asSlots.elements
  const svg = numberLayerSVG(asSlots, 'KS-88888', { buyer: { name: 'Daw Hla' } })
  const drawn = Number((svg.match(/<text[^>]*x="([\d.]+)"[^>]*>Daw Hla/) ?? [])[1] ?? NaN)

  near(drawn, asElement, 'both readers put the name in the same place', 1)
  near(drawn, 0.6 * REFERENCE.width, 'and it is where it was dragged to', 1)
}

/*
 * AND SAVING WITHOUT CHANGING ANYTHING CHANGES NOTHING.
 *
 * The write-back goes through shares and back, so it rounds. If that rounding
 * did not land on the number it started from, every save would nudge the design
 * by a pixel — and an organiser who opened the screen and pressed Save out of
 * habit would walk the ticket across the artwork over a few weeks.
 */
console.log('and a save that changed nothing stores the same numbers')
{
  const d = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  const back = legacyFromElements(d)
  for (const half of ['main', 'stub']) {
    eq(back[half].capHeight, DEFAULT_DESIGN[half].capHeight, `${half}: the digit height is unmoved`)
    eq(back[half].label.baseline, DEFAULT_DESIGN[half].label.baseline, `${half}: the baseline is unmoved`)
    eq(back[half].label.right, DEFAULT_DESIGN[half].label.right, `${half}: the label's edge is unmoved`)
    eq(back[half].clearRight, DEFAULT_DESIGN[half].clearRight, `${half}: the logo's edge is unmoved`)
  }
  for (const [k, f] of Object.entries(DEFAULT_DESIGN.buyer.fields)) {
    eq(back.buyer.fields[k].x, f.x, `buyer.${k}: x is unmoved`)
    eq(back.buyer.fields[k].baseline, f.baseline, `buyer.${k}: the rule is unmoved`)
    eq(back.buyer.fields[k].maxRight, f.maxRight, `buyer.${k}: the stopping point is unmoved`)
  }
  eq(back.qrMain.x, DEFAULT_DESIGN.qrMain.x, 'the QR box is unmoved')
  eq(back.qrMain.size, DEFAULT_DESIGN.qrMain.size, 'and unresized')

  /* Twice, because "close enough once" and "stable" are different properties. */
  const again = legacyFromElements(designFor({ width: REFERENCE.width, height: REFERENCE.height, design: { ...d, ...back } }))
  eq(JSON.stringify(again.main), JSON.stringify(back.main), 'a second save is identical to the first')
  eq(JSON.stringify(again.buyer), JSON.stringify(back.buyer), 'for the buyer lines too')
}

/*
 * WHAT CANNOT BE CARRIED BACK, stated so it is a decision rather than a gap.
 * An element with no slot to live in is not drawn by an older reader, which is
 * safe: drawing less is not the same as drawing something in the wrong place.
 */
console.log('an element the old shape has no room for is left out, not faked')
{
  const d = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  const before = JSON.stringify(legacyFromElements(d))
  d.elements = [...d.elements, {
    id: 'brand-new', kind: 'field', source: 'price', half: 'main', enabled: true,
    box: { left: 0.4, top: 0.6, width: 0.1, height: 0.04 }, align: 'left',
    overflow: 'shrink', family: 'number', weight: 'regular', ink: '#FFFFFF',
    after: '', gap: 1.1, ecc: 'M', backing: true, text: '',
  }]
  eq(JSON.stringify(legacyFromElements(d)), before, 'a new element adds nothing to the old slots')

  // And one that was deleted is switched off where the old shape has a switch.
  const gone = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  gone.elements = gone.elements.filter((e) => e.id !== 'qrMain' && e.id !== 'buyer-phone')
  const out = legacyFromElements(gone)
  eq(out.qrMain.enabled, false, 'a removed QR is switched off for the older reader')
  eq(out.buyer.fields.phone.enabled, false, 'and so is a removed buyer line')
}


/*
 * WHERE THE STUB BEGINS HAS ONE HOME, AND NOBODY KEEPS A COPY.
 *
 * The perforation was written as `design.stubAt ?? 0.6875` in five places, each
 * with its own clamp. The number came from a mockup rather than from the
 * artwork and was eighty-three pixels out — it ran through the QR box, so the
 * digital ticket cropped the buyer's half with half a code on it.
 *
 * Correcting DEFAULT_DESIGN fixed exactly none of the five. That is the bug
 * this test is about: not the wrong number, but a constant copied to the point
 * where correcting it does nothing. The literal is deliberately NOT asserted
 * here — it will change again the next time somebody measures, and pinning it
 * would make this the sixth copy.
 */
console.log('where the stub begins has one home')
{
  const SRC = new URL('../src/', import.meta.url).pathname
  const files = (function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(js|vue)$/.test(e.name) ? [join(dir, e.name)] : []))
  })(SRC)
  ok(files.length > 20, `read the source (${files.length} files)`)

  /* A default written at the point of use, in any of the shapes people reach
   * for. Comments are stripped first: the history of the wrong number is
   * recorded in several files on purpose and must not trip this. */
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const OWN_DEFAULT = /stubAt\s*(\?\?|\|\|)\s*[\d.]/

  for (const f of files) {
    const name = f.split('/src/')[1]
    if (name === 'lib/ticketdesign.js') continue          // the one home
    ok(!OWN_DEFAULT.test(strip(readFileSync(f, 'utf8'))),
      `${name} does not keep its own default for stubAt`)
  }
}

console.log('and it answers for a design that never carried one')
{
  const D2 = designFor({ width: REFERENCE.width, height: REFERENCE.height, design: {} })
  eq(stubShare(D2), D2.stubAt, 'a design with the field gets its own value')
  eq(stubShare({}), D2.stubAt, 'one without it gets the measured default, not a guess')
  eq(stubShare(undefined), D2.stubAt, 'and so does no design at all')
  eq(stubShare({ stubAt: 'x' }), D2.stubAt, 'and so does one whose value is not a number')
  eq(stubShare({ stubAt: 2 }), 1, 'past the right edge clamps to the whole ticket')
  eq(stubShare({ stubAt: 0 }), 0.05, 'and nought clamps to something with a ticket in it')
  eq(stubShare({ stubAt: 1 }), 1, 'exactly 1 is allowed — a ticket with no stub')

  /*
   * THE PROPERTY THAT MADE THIS SURFACE. The digital ticket crops the buyer's
   * half at this boundary, so a QR box straddling it is sent out as half a
   * code. Asserted against the default design, where it was true for a day.
   */
  const cut = stubShare(D2) * REFERENCE.width
  const qr = D2.qrMain
  ok(qr.x + qr.size <= cut,
    `the QR box ends at ${qr.x + qr.size} and the cut is at ${Math.round(cut)} — the code survives the crop`)
}

console.log('a box that spans the tear is refused, because it would be torn in half')
{
  /*
   * FOUND BY A REVIEWER DOING THE ARITHMETIC THE SCREEN WAS ASKING FOR. The
   * live studio showed Left 35.3, Width 34.9 and a stub marker at 68.8%.
   * 35.3 + 34.9 = 70.2, so the ticket number crossed the perforation by 1.4%
   * and nothing said so — half the serial would go home with the buyer and
   * half would stay in the book.
   *
   * Invisible on screen by construction: the perforation is a hairline over
   * artwork, the box is a dashed outline, and at the zoom anybody designs at
   * the overlap is a couple of pixels. Only the numbers show it, and the
   * numbers were three fields apart.
   */
  const box = (left, width) => ({
    id: 'a', kind: 'field', source: 'ticket.number', text: '',
    box: { left, top: 0.1, width, height: 0.041 },
  })

  const crossed = validateElements([box(0.353, 0.349)], 0.688)
  eq(crossed.length, 1, 'the live case is refused')
  ok(/crosses the perforation/.test(crossed[0]), 'and says what is wrong')
  ok(/35\.3% to 70\.2%/.test(crossed[0]) && /68\.8%/.test(crossed[0]),
     'with both numbers, so the designer does not have to do the sum again')

  eq(validateElements([box(0.353, 0.300)], 0.688).length, 0, 'a box that clears the tear is fine')
  eq(validateElements([box(0.72, 0.20)], 0.688).length, 0, 'and one wholly on the stub is fine')
  /* Touching the line is not crossing it — a box may butt up against the tear,
     and flagging that would make the check something people route around. */
  eq(validateElements([box(0.4, 0.288)], 0.688).length, 0, 'ending exactly on the tear is fine')
  /* Older callers pass no stub share; the check is skipped rather than guessed. */
  eq(validateElements([box(0.353, 0.349)]).length, 0, 'and with no tear given it says nothing')
}

console.log('the stub treatment is portrait and leads with the number')
{
  /*
   * Card 8b: "Stub — portrait, phone-shaped, number first". It is the one to
   * send, because a chat is a phone: portrait fills the screen where landscape
   * letterboxes, and the number is what gets read down a telephone.
   */
  const svg = stubCardSVG(null, {
    number: 'KS-00031', name: 'John Kui', org: 'Fundraising Raffle',
    price: 'RM 10.00', book: 'Book-004', sold: true,
    motto: 'Love is patient, love is kind', brand: '#0e2a30', ink: '#ffffff',
    thanks: 'Thank you.', link: 'example.org/v/?KS-00031.ABC',
  }, {})

  ok(svg.includes(`viewBox="0 0 ${CARD_STUB.width} ${CARD_STUB.height}"`), 'it is the stub size')
  ok(CARD_STUB.height > CARD_STUB.width, 'which is portrait')
  ok(svg.includes('KS-00031'), 'the number is on it')
  ok(svg.includes('TICKET NUMBER'), 'under its label')
  ok(/John Kui\s+·\s+RM 10\.00\s+·\s+Book-004/.test(svg),
     'and the three facts run as one line, as 8b draws them')
  ok(svg.includes('SOLD'), 'a sold ticket says so')
  ok(!stubCardSVG(null, { number: 'KS-1' }, {}).includes('SOLD'), 'and an unsold one does not')

  /*
   * THE RULE MUST CLEAR THE QR. The first version put the QR at the foot and
   * drew the motto's rule straight across it — a line through a QR is a QR that
   * may not scan. Both are absolute coordinates in one viewBox, so the overlap
   * is arithmetic even though the render is a string.
   */
  const qrY = CARD_STUB.height - 660
  const qrBottom = qrY + 230
  const ruleY = Number((svg.match(/<line x1="72" y1="(\d+)"/) || [])[1])
  ok(ruleY > qrBottom, `the rule sits clear of the QR (${ruleY} against ${qrBottom})`)
  ok(ruleY < CARD_STUB.height, 'and inside the card')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
