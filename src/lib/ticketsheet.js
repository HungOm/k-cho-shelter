/*
 * A PAGE OF TICKETS, READY FOR A PRINTER.
 *
 * Builds one self-contained HTML document: the artwork as a CSS background, the
 * numbers as an SVG overlay on top, several to a sheet of A4, with a dashed
 * outline to cut along. It is a string — nothing here touches the DOM — so the
 * same function serves the print preview, the "download a file for the print
 * shop" button, and the tests.
 *
 * THE ARTWORK GOES IN ONCE, however many tickets are on the page. Inlining it
 * per ticket would turn a book of a hundred into a file no browser would open,
 * let alone print. When the caller passes a data: URI the whole document stands
 * alone and can be emailed to whoever is printing; when it passes a URL the
 * document is small and the picture is fetched.
 *
 * THE TICKET'S HEIGHT IS DERIVED FROM ITS WIDTH and the artwork's own aspect
 * ratio, never given separately. A second number is a second thing to get
 * wrong, and getting it wrong would stretch the artwork — which would take the
 * number off the baseline it was so carefully placed on.
 */

import { numberLayerSVG } from './ticketart.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The paper this prints on. A4 portrait is the only sheet the app offers. */
export const PAGE = { widthMM: 210, heightMM: 297 }

/*
 * HOW MANY TICKETS FIT DOWN ONE PAGE, AND THE SUM THAT SAYS SO.
 *
 * This existed as a stored setting — `sheet.perPage`, a slider on the design
 * screen from one to twelve — and NOTHING EVER READ IT. The tickets were laid
 * out in a column and the browser broke the page wherever it happened to run
 * out of paper. So the control said four, the page took four, and the two facts
 * were unrelated: set it to twelve and the printout did not change.
 *
 * It was never a setting. A ticket is as tall as its width and the artwork's
 * shape make it, and the page is 297 mm; how many fit is then arithmetic with
 * no free variable in it. Deriving it here means the screen and the printer
 * cannot disagree, and returning the terms rather than just the answer means a
 * screen can show the sum — which is the only form in which "4" is checkable by
 * somebody holding a ruler and a sheet of A4.
 */
export function pageFit(design, opts = {}) {
  const sheet = design?.sheet ?? {}
  const widthMM = Number(opts.widthMM ?? sheet.widthMM ?? 190)
  const gapMM = Number(opts.gapMM ?? sheet.gapMM ?? 4)
  const marginMM = Number(opts.marginMM ?? sheet.marginMM ?? 10)
  const pageHeightMM = Number(opts.pageHeightMM ?? PAGE.heightMM)

  const artW = Number(design?.artwork?.width ?? 1600)
  const artH = Number(design?.artwork?.height ?? 517)
  const heightMM = widthMM * (artH / artW)

  /* One ticket needs its own height; each one after it needs a gap as well. */
  const usable = pageHeightMM - 2 * marginMM
  const per = Math.max(1, Math.floor((usable + gapMM) / (heightMM + gapMM)))
  const used = per * heightMM + (per - 1) * gapMM + 2 * marginMM
  return { per, heightMM, widthMM, gapMM, marginMM, pageHeightMM, used, fits: used <= pageHeightMM + 1e-9 }
}

/**
 * @param {object}   design    from designFor(template)
 * @param {string[]} numbers   the ticket numbers, in order
 * @param {string}   imageHref the artwork: a URL, or a data: URI to stand alone
 * @param {object}   opts      title, and anything numberLayerSVG takes
 */
/*
 * PRINTING WHEN THE PAPER IS ACTUALLY READY, WHICH A TIMER CANNOT KNOW.
 *
 * The caller used to open this document and call print() on it 600ms later.
 * On a warm cache that is plenty and it looks perfect; on a cold one, a large
 * artwork, or a phone tethered in a hall, the images have not arrived and the
 * dialog opens over a blank page — or the browser declines to print an
 * unfinished document at all and you are left looking at the sheet wondering
 * why nothing happened. Both were reported, and a timer cannot tell the two
 * apart because it never asked.
 *
 * So the document prints ITSELF, once every image it contains has either
 * loaded or failed. It lives here rather than in the caller because every
 * caller has the same problem, and the one that forgot — the design screen's
 * test page, which never called print at all — is exactly the kind of thing
 * that survives for months as "sometimes it just opens a page".
 *
 * `error` counts as ready on purpose: one artwork that 404s should cost that
 * picture, not the whole print run. What comes out says clearly which ticket
 * is missing its background.
 */
const AUTO_PRINT = `<script>
(function () {
  var done = false
  function go() {
    if (done) return
    done = true
    try { window.focus() } catch (e) {}
    try { window.print() } catch (e) {}
  }
  var imgs = [].slice.call(document.images)
  var left = imgs.length
  if (!left) return setTimeout(go, 60)
  // A long stop, so a hung request cannot leave somebody staring at a sheet
  // that will never print. Ten seconds is past any reasonable artwork.
  var bell = setTimeout(go, 10000)
  imgs.forEach(function (img) {
    if (img.complete) return ready()
    img.addEventListener('load', ready)
    img.addEventListener('error', ready)
  })
  function ready() {
    if (--left > 0) return
    clearTimeout(bell)
    // One frame, so the last decode is painted before the dialog freezes it.
    setTimeout(go, 120)
  }
}())
<\/script>`

export function sheetHTML(design, numbers, imageHref, opts = {}) {
  const sheet = design?.sheet ?? {}
  const widthMM = Number(opts.widthMM ?? sheet.widthMM ?? 190)
  const gapMM = Number(opts.gapMM ?? sheet.gapMM ?? 4)
  const marginMM = Number(opts.marginMM ?? sheet.marginMM ?? 10)
  const cutlines = opts.cutlines ?? sheet.cutlines ?? true
  const page = String(opts.page ?? 'A4 portrait')
  const title = String(opts.title ?? 'Raffle tickets')
  const autoPrint = opts.autoPrint === true

  const artW = Number(design?.artwork?.width ?? 1600)
  const artH = Number(design?.artwork?.height ?? 517)
  const heightMM = widthMM * (artH / artW)

  const list = Array.isArray(numbers) ? numbers : []
  /*
   * `layers` lets the caller hand in an overlay it has already drawn, and the
   * printing screen always does: an overlay carries the ticket's QR code, and
   * the code is a fact about that ticket that this file has no way to look up.
   * Without one it falls back to drawing the number alone, which is what a
   * design-screen test page wants.
   */
  const layers = opts.layers && typeof opts.layers === 'object' ? opts.layers : null
  /*
   * The page is broken where the arithmetic says it breaks, rather than
   * wherever the browser runs out of paper. Left to itself a browser will fit
   * whatever it can, which is the same answer until a margin changes and then
   * silently is not — and a sheet that took four tickets yesterday and takes
   * three today is a book that comes off the guillotine in the wrong order.
   */
  const { per } = pageFit(design, opts)
  const tickets = list.map((n, i) => `
    <div class="ticket${(i + 1) % per === 0 && i + 1 < list.length ? ' lastonpage' : ''}" data-number="${esc(n)}">
      <div class="art"></div>
      ${(layers && layers[n]) || numberLayerSVG(design, n, { ...opts, guides: false, qrBoxes: false })}
    </div>`).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: ${page}; margin: ${marginMM}mm; }
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f4f5; font: 13px/1.5 system-ui, sans-serif; color: #222; }
  .sheet { padding: ${marginMM}mm; }
  .note { max-width: ${widthMM}mm; margin: 0 auto ${gapMM}mm; padding: 8px 10px;
          background: #fff; border: 1px solid #ddd; border-radius: 6px; }
  .ticket {
    position: relative;
    width: ${widthMM}mm;
    height: ${heightMM.toFixed(4)}mm;
    margin: 0 auto ${gapMM}mm;
    ${cutlines ? 'outline: 0.2mm dashed #9aa0a6;' : ''}
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .ticket.lastonpage { break-after: page; page-break-after: always; }
  .ticket .art {
    position: absolute; inset: 0;
    background-image: url("${imageHref}");
    background-size: 100% 100%;
    background-repeat: no-repeat;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .ticket svg.numbers { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  @media print {
    body { background: #fff; }
    .sheet { padding: 0; }
    .note { display: none; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="note">
    <b>${esc(title)}</b><br>
    ${list.length} ticket${list.length === 1 ? '' : 's'}${list.length ? `, ${esc(list[0])} to ${esc(list[list.length - 1])}` : ''} —
    ${widthMM}&nbsp;mm &times; ${heightMM.toFixed(2)}&nbsp;mm each.
    Print at 100% scale with background graphics on. This box does not print.
  </div>
${tickets}
</div>
${autoPrint ? AUTO_PRINT : ''}
</body>
</html>`
}
