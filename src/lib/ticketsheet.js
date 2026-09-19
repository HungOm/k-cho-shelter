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

/**
 * @param {object}   design    from designFor(template)
 * @param {string[]} numbers   the ticket numbers, in order
 * @param {string}   imageHref the artwork: a URL, or a data: URI to stand alone
 * @param {object}   opts      title, and anything numberLayerSVG takes
 */
export function sheetHTML(design, numbers, imageHref, opts = {}) {
  const sheet = design?.sheet ?? {}
  const widthMM = Number(opts.widthMM ?? sheet.widthMM ?? 190)
  const gapMM = Number(opts.gapMM ?? sheet.gapMM ?? 4)
  const marginMM = Number(opts.marginMM ?? sheet.marginMM ?? 10)
  const cutlines = opts.cutlines ?? sheet.cutlines ?? true
  const page = String(opts.page ?? 'A4 portrait')
  const title = String(opts.title ?? 'Raffle tickets')

  const artW = Number(design?.artwork?.width ?? 1600)
  const artH = Number(design?.artwork?.height ?? 517)
  const heightMM = widthMM * (artH / artW)

  const list = Array.isArray(numbers) ? numbers : []
  const tickets = list.map((n) => `
    <div class="ticket" data-number="${esc(n)}">
      <div class="art"></div>
      ${numberLayerSVG(design, n, { ...opts, guides: false, qrBoxes: false })}
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
</body>
</html>`
}
