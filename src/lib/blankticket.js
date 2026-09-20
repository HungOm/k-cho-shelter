/**
 * A ticket to start from when there is no artwork.
 *
 * WHY THIS EXISTS. The studio places fields, codes and text ONTO an uploaded
 * picture, and every position is held as a share of that picture. So a raffle
 * with no artwork — a new one, or one whose designer has not delivered — could
 * not begin: the screen sent you to the upload tab and there was nothing to
 * upload. "Draw the ticket first, get the artwork later" was not a route the
 * product had.
 *
 * WHAT IT MAKES, and the important word is REAL. Not a placeholder, not an
 * empty state, not a special "blank" mode the rest of the pipeline has to know
 * about: a genuine PNG of the ticket's own size, print-friendly, which goes
 * through the ordinary upload path and is thereafter indistinguishable from
 * artwork somebody sent in. Placement, scaling, the print sheet and the verify
 * QR all work unchanged because nothing about them is special-cased.
 *
 * That choice is the whole design. The alternative was a template row with no
 * artwork, which needs a schema change — `ticket_templates.content_type` is
 * CHECK-constrained to png, jpeg and webp — plus a migration on a live stack
 * and a branch in every consumer for "the artwork that is not there". A
 * generated picture needs none of it and is, unlike a null, true.
 *
 * WHAT IS ON IT: a trim edge and the stub's perforation, and nothing else. It
 * is a sheet to lay fields out on, not a design — the moment somebody wants it
 * to look like something they should be uploading artwork or drawing it
 * elsewhere. Two lines are what make an empty rectangle legible as a ticket:
 * where it is cut, and where it tears.
 */

/** Millimetres to pixels at a print resolution. 25.4 mm to the inch. */
export const mmToPx = (mm, dpi) => Math.round((Number(mm) || 0) / 25.4 * (Number(dpi) || 300))

/**
 * The artboard as an SVG string.
 *
 * SEPARATE FROM THE RASTERISING ON PURPOSE. A canvas needs a browser, so a
 * function that draws and encodes in one step can only be tested by opening
 * one. This half is a string and can be asserted on directly — which is where
 * the geometry lives, and the geometry is the part that can be wrong.
 *
 * @param widthMM   the ticket's width in millimetres
 * @param heightMM  its height
 * @param stubAt    where the stub begins, as a share of the width (0–1)
 * @param dpi       print resolution; 300 unless somebody has a reason
 */
export function artboardSVG(widthMM, heightMM, stubAt = 0.7, dpi = 300) {
  const w = mmToPx(widthMM, dpi)
  const h = mmToPx(heightMM, dpi)
  /*
   * The stub line is clamped INSIDE the ticket rather than trusted. A design
   * carrying stubAt: 0 or 1 — an older one, or a number somebody dragged to the
   * end — would otherwise draw the perforation on top of the trim edge, which
   * reads as a ticket with no stub at all rather than as a bad value.
   */
  const at = Math.min(0.97, Math.max(0.03, Number(stubAt) || 0.7))
  const x = Math.round(w * at)

  /*
   * Hairlines in print terms: 1pt at the given resolution, so the trim edge is
   * the same visual weight on any artboard size. A fixed pixel width would be
   * bold on an A6 ticket and invisible on a long one.
   */
  const rule = Math.max(1, Math.round(dpi / 72))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    // The trim edge, inset by its own width so the stroke sits inside the page.
    `<rect x="${rule / 2}" y="${rule / 2}" width="${w - rule}" height="${h - rule}" ` +
      `fill="none" stroke="#c8d0cd" stroke-width="${rule}"/>` +
    // Where it tears. Dashed, because that is what a perforation looks like on
    // every ticket anybody has ever been handed.
    `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#c8d0cd" ` +
      `stroke-width="${rule}" stroke-dasharray="${rule * 6} ${rule * 4}"/>` +
    `</svg>`
}

/**
 * The same artboard as a PNG File, ready for the ordinary upload path.
 *
 * Browser only — it rasterises through a canvas. Returns a File rather than a
 * Blob so it can be handed to `toPayload` exactly as a file somebody picked,
 * which is what keeps this off a code path of its own.
 */
export async function blankArtboardFile(widthMM, heightMM, stubAt, dpi = 300, name = 'Blank ticket') {
  const svg = artboardSVG(widthMM, heightMM, stubAt, dpi)
  const w = mmToPx(widthMM, dpi)
  const h = mmToPx(heightMM, dpi)

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('The blank ticket could not be drawn.'))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    /*
     * PAINTED WHITE FIRST. A canvas starts transparent, and a PNG with an alpha
     * channel prints as nothing where the paper should be — which looks right
     * on screen and comes out of a printer as a ticket with no face.
     */
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The blank ticket could not be saved as a picture.')
    return new File([blob], `${name}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
