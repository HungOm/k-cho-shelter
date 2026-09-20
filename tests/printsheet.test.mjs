/*
 * THE SHEET PRINTS ITSELF, AND WAITS FOR ITS OWN PICTURES FIRST.
 *
 * Two print paths were reported as "sometimes it just opens the tickets on a
 * blank page instead of printing", and they turned out to be two different
 * faults with one shape.
 *
 * PrintTickets opened the sheet in a new window and called print() on it after
 * a fixed 600ms. On a warm cache that is plenty. On a cold one, a large
 * artwork, or a phone tethered in a hall, the images have not arrived — so the
 * dialog opens over a blank page, or the browser declines to print an
 * unfinished document and leaves somebody looking at the sheet wondering what
 * they did wrong. A timer cannot tell those apart because it never asked.
 *
 * The design screen's test page had the simpler version of the same bug: it
 * never called print at all. It opened a page and waited to be noticed, which
 * is indistinguishable from the failure above to the person standing there.
 *
 * Both are now one thing: the document carries a script that prints once every
 * image in it has loaded or failed. The tests below are about the properties
 * that make that safe rather than about the mechanism — that it never fires
 * early, that a dead image cannot hang it forever, and that no caller can
 * accidentally get a self-printing document when it wanted a file to keep.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sheetHTML } from '../src/lib/ticketsheet.js'
import { DEFAULT_DESIGN, designFor } from '../src/lib/ticketdesign.js'
import { elementLayerSVG } from '../src/lib/ticketart.js'
import { sampleBook, sampleVerifyUrl, sampleFromSearch } from '../src/verify/sample.js'
import { encode } from '../src/lib/qrcodegen.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(join(ROOT, f), 'utf8')

const NUMBERS = ['KS-00001', 'KS-00002']

console.log('a sheet prints itself only when it was asked to')
{
  const quiet = sheetHTML(DEFAULT_DESIGN, NUMBERS, 'art.png', {})
  const loud = sheetHTML(DEFAULT_DESIGN, NUMBERS, 'art.png', { autoPrint: true })
  ok(!/window\.print/.test(quiet), 'opening a sheet to keep does not print it')
  ok(/window\.print/.test(loud), 'and asking for print puts the trigger in the document')
  /*
   * "Open without marking printed" exists so somebody can save or inspect the
   * sheet. If that opened a print dialog, the one button that promised not to
   * touch anything would be the loudest one on the screen.
   */
  const print = read('src/components/modals/PrintTickets.vue')
  ok(/autoPrint: !download/.test(print), 'the print screen asks for it only when printing')
  ok(!/setTimeout\([^)]*w\.print/.test(print), 'and the old 600ms timer is gone')
}

console.log('and only after its pictures have arrived')
{
  const html = sheetHTML(DEFAULT_DESIGN, NUMBERS, 'art.png', { autoPrint: true })
  ok(/document\.images/.test(html), 'it looks at the images it contains')
  ok(/img\.complete/.test(html), 'counts the ones already loaded')
  ok(/addEventListener\('load'/.test(html) && /addEventListener\('error'/.test(html),
    'and waits for the rest, treating a failed one as arrived')
  /*
   * A 404 artwork must cost that picture and not the print run — the sheet
   * still prints, and what comes out says plainly which ticket lost its
   * background. An image that never settles must not hang it either.
   */
  ok(/setTimeout\(go, 10000\)/.test(html), 'with a long stop so a hung request cannot strand it')
  ok(/if \(done\) return/.test(html), 'and it cannot fire twice')
}

console.log('the test page is marked as what it is')
{
  /*
   * It printed four tickets carrying the raffle's own prefix and the next
   * four numbers in sequence, with nothing on the paper to say they were not
   * stock. The box that said "test page" was the one that does not print.
   */
  const design = read('src/components/TicketDesign.vue')
  const fn = design.slice(design.indexOf('function printTest'), design.indexOf('const kb ='))
  ok(/watermark: 'SAMPLE'/.test(fn), 'the test page carries the sample watermark')
  ok(/autoPrint: true/.test(fn), 'and actually prints, rather than opening a page')
  const html = sheetHTML(DEFAULT_DESIGN, NUMBERS, 'art.png', { watermark: 'SAMPLE' })
  ok(/SAMPLE/.test(html), 'a watermark asked of the sheet reaches the tickets on it')
  ok(!/SAMPLE/.test(sheetHTML(DEFAULT_DESIGN, NUMBERS, 'art.png', {})),
    'and a real sheet carries none')
}

console.log('a sample sheet opens the dialog, because that is where PDF lives')
{
  /*
   * "Open the sample sheet" opened a page and did nothing, and the person
   * looking at it wanted a PDF. There is no library here and there should not
   * be one: a browser writes PDF from this sheet with live text and vector QR
   * codes, where jsPDF would rasterise every ticket to fit in the bundle and
   * produce a bigger, worse file. So the dialog IS the export, and for samples
   * there is nothing to stamp as printed — "open" and "print" were never two
   * different actions on that path.
   */
  const print = read('src/components/modals/PrintTickets.vue')
  ok(/autoPrint: !download \|\| isSample\.value/.test(print),
    'a sample sheet opens the print dialog even from the open button')
  ok(/Print or save as PDF/.test(print), 'and the button says what it will do')
  // The real-ticket path keeps both, because there the two differ: one stamps
  // the batch as printed and the other deliberately does not.
  ok(/Open without marking printed/.test(print), 'a real batch still has a silent open')
}

console.log('the test page carries a QR that says something true')
{
  /*
   * WHAT SHIPPED. printTest passed no qrUrl and no encoder, so it drew no QR
   * at all — and nobody could tell, because the artwork has a code-looking
   * square PRINTED INTO THE PICTURE. The paper looked right, the screen looked
   * right, the suite was green, and what somebody scanned across a desk was a
   * code for nothing. It also printed the raffle's own next four ticket
   * numbers, which are real tickets somebody may be holding.
   *
   * WHY THE ASSERTION IS ABOUT THE LAYER and not the screen: the placeholder
   * that hid the bug lives in the artwork, and the artwork is not in the
   * layer. So the layer is the lowest place the absence is visible at all.
   */
  const design = designFor(null)
  const book = sampleBook().slice(0, 4)
  const layerFor = (t, withCode) => elementLayerSVG(
    design,
    { 'ticket.number': t.number, 'book.number': t.book, code: t.code },
    withCode
      ? { qrUrl: sampleVerifyUrl('https://x.org/v', t.number), encode, watermark: 'SAMPLE' }
      : { watermark: 'SAMPLE' })

  const rectsOf = (l) => (l.match(/<rect[^>]*>/g) || [])
  const drawn = book.map((t) => rectsOf(layerFor(t, true)))

  /*
   * THE ONE THAT FAILS ON THE CODE THAT SHIPPED. A layer with an encoder
   * carries two hundred-odd rects; the same layer without one carries none,
   * because every rect in it IS the code.
   */
  for (const [i, r] of drawn.entries()) {
    ok(r.length > 100, `${book[i].number} carries a real code (${r.length} modules drawn)`)
  }
  ok(rectsOf(layerFor(book[0], false)).length < 10,
    'and the check would fail on the version that drew none — it is not vacuous')

  /*
   * FOUR TICKETS, FOUR CODES. Compared by GEOMETRY rather than by count: two
   * different codes can have the same number of modules, so a distinct-counts
   * test calls correct work a failure — which is how a guard gets switched
   * off. Identical geometry is the real failure, and it cannot be innocent.
   */
  const shapes = drawn.map((r) => r.join('|'))
  eq(new Set(shapes).size, shapes.length, 'each ticket gets its own code, not one repeated')

  /*
   * AND THE CODE SAYS SOMETHING TRUE. Well-formed is not the same as correct:
   * a QR encoding the wrong address scans perfectly and lands nowhere.
   */
  for (const t of book) {
    const url = sampleVerifyUrl('https://x.org/v', t.number)
    eq(sampleFromSearch('?' + url.split('?')[1]), t.number,
      `${t.number}'s code points at ${t.number}`)
  }

  /* No real ticket number reaches sample paper. */
  const cfgPrefixed = book.filter((t) => !/^Sample-/.test(t.number))
  eq(cfgPrefixed.length, 0, 'and the numbers on it are samples, not the next four real tickets')

  /*
   * AND printTest MUST ASK FOR ONE. Everything above proves the renderer CAN
   * draw a code; the bug was that the test page never requested it. So the
   * last assertion is about that function's own body — the two arguments
   * whose absence was the whole defect, in the place they were missing from.
   */
  const src = read('src/components/TicketDesign.vue')
  const fn = src.slice(src.indexOf('function printTest'), src.indexOf('const kb ='))
  ok(fn.length > 200, 'printTest was found and read')
  ok(/qrUrl:/.test(fn), 'printTest asks for a QR — its absence was the bug')
  ok(/\bencode\b/.test(fn), 'and hands over the encoder that draws it')
  ok(/sampleVerifyUrl/.test(fn), 'pointing at the sample marker')
  ok(/sampleBook\(\)/.test(fn), 'for sample numbers rather than the next real four')
  ok(/watermark:/.test(fn), 'with the watermark in the layer, which `layers` would otherwise replace')
}

console.log('every way in to printing offers the samples too')
{
  const app = read('src/App.vue')
  const wired = (app.match(/@print-sample=/g) || []).length
  ok(wired >= 3, `the sample entry is wired in ${wired} places`)
  ok(/printtickets', \{ sample: true \}/.test(app), 'and opens the print screen in the sample scope')
  for (const f of ['src/components/Books.vue', 'src/components/modals/BookDetail.vue',
                   'src/components/modals/ViewTicket.vue']) {
    const src = read(f)
    ok(/print-sample/.test(src), `${f} offers it beside its own print button`)
    ok(/defineEmits\([^)]*'print-sample'/.test(src), `${f} declares the emit`)
  }
  ok(/props\.payload\?\.sample \? 'sample'/.test(read('src/components/modals/PrintTickets.vue')),
    'and the print screen opens straight into it')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
