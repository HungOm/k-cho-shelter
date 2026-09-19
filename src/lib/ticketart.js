/*
 * DRAWING A TICKET NUMBER ONTO THE ARTWORK.
 *
 * The number is drawn as SVG text, never as HTML text, and that is the whole
 * trick of this file. SVG positions text BY ITS BASELINE, which is the one
 * thing that has to be exact: the digits must sit on the same line as the
 * printed "TICKET NO:" beside them. CSS has no way to say "put the baseline
 * here" — it can only place a box and hope the line-height lands right — so an
 * HTML overlay would have to be nudged by eye and would drift the moment the
 * font, the zoom or the printer changed.
 *
 * The overlay's viewBox is the artwork's own pixel space, so every coordinate
 * from ticketdesign.js is used verbatim. Scaling the ticket to any paper size
 * scales the overlay with it, and the number cannot come adrift.
 *
 * NO DOM AT IMPORT. This runs in the browser and under node in the tests, and
 * builds strings either way. Nothing here touches document or canvas.
 *
 * Measured, proved and moved here from ticket-lab/, the standalone pilot that
 * established the geometry before any of it was wired to the app.
 */

import { valueFor } from './ticketelements.js'

/*
 * THE FONT, AND WHY ITS NUMBERS ARE IN HERE.
 *
 * A serial number is only correctly placed if you know how wide it will be
 * BEFORE it is drawn, and neither node nor a print job can measure text for
 * you. The advance widths below were read straight out of Times New Roman and
 * are stored per 1 em. They are exact, not approximate: they came from the
 * font file.
 *
 * WHY TIMES. Two reasons, neither of them taste. Its digits all have the same
 * advance — exactly 0.5 em, lining, tabular by design — so 00001 and 99999 are
 * the same width and a column of tickets does not wobble down the page. And
 * Liberation Serif and Tinos are metric clones of it, so a print shop on Linux
 * gets glyphs of the same widths rather than a silent reflow. The stack is
 * ordered so that every common machine lands on one of the three.
 *
 * `digitHeight` is what the font calls the lining figure height (0.676 em) and
 * is what gets matched to the label's capHeight. `capHeight` (0.663 em) is here
 * for a caller who sets a prefix in capitals and wants THOSE matched.
 */
export const FONT = {
  family: '"Times New Roman", "Liberation Serif", Tinos, "Nimbus Roman No9 L", Times, serif',
  digitHeight: 0.676,
  capHeight: 0.663,
  advance: {
    bold: {
      A: 0.72217, B: 0.667, C: 0.72217, D: 0.72217, E: 0.667, F: 0.61084,
      G: 0.77783, H: 0.77783, I: 0.38916, J: 0.5, K: 0.77783, L: 0.667,
      M: 0.94384, N: 0.72217, O: 0.77783, P: 0.61084, Q: 0.77783, R: 0.72217,
      S: 0.55616, T: 0.667, U: 0.72217, V: 0.72217, W: 1.0, X: 0.72217,
      Y: 0.72217, Z: 0.667,
      0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5,
      6: 0.5, 7: 0.5, 8: 0.5, 9: 0.5,
      '-': 0.33302, '/': 0.27783, '.': 0.25, ' ': 0.25, '#': 0.5,
    },
    regular: {
      A: 0.72217, B: 0.667, C: 0.667, D: 0.72217, E: 0.61084, F: 0.55616,
      G: 0.72217, H: 0.72217, I: 0.33302, J: 0.38916, K: 0.72217, L: 0.61084,
      M: 0.88916, N: 0.72217, O: 0.72217, P: 0.55616, Q: 0.72217, R: 0.667,
      S: 0.55616, T: 0.61084, U: 0.72217, V: 0.72217, W: 0.94384, X: 0.72217,
      Y: 0.72217, Z: 0.61084,
      0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5,
      6: 0.5, 7: 0.5, 8: 0.5, 9: 0.5,
      '-': 0.33302, '/': 0.27783, '.': 0.25, ' ': 0.25, '#': 0.5,
    },
  },
}

/*
 * The two distances that are NOT in the artwork, expressed in ems of the
 * number's own size so that the main half and the stub get the same optical
 * treatment even though one is nearly twice the size of the other.
 *
 *   gap    from the colon to the first digit. 0.45 em is a shade wider than a
 *          Times word space (0.25 em), which is what makes it read as a filled
 *          field rather than as part of the label.
 *   clear  from the last digit to whatever `clearRight` names. The number is
 *          never allowed inside this.
 */
export const SPACING = { gap: 0.45, clear: 0.4 }

/*
 * A SECOND FONT STACK, FOR TEXT THAT IS NOT A TICKET NUMBER.
 *
 * The buyer's name on a stub may be in Burmese, and Times has no Myanmar
 * glyphs — it would print as empty boxes on a ticket somebody is meant to file
 * by. Padauk and Noto Sans Myanmar are the two the rest of this app already
 * loads, so a machine that can render the app can render this.
 *
 * It is a SEPARATE constant because the numbering stack must not gain a
 * fallback: the ticket number's width is computed from Times' advance widths,
 * and a fallback that reflowed it would put the number somewhere the
 * measurements did not allow for.
 */
export const TEXT_FAMILY =
  'Padauk, "Noto Sans Myanmar", "Myanmar Text", system-ui, -apple-system, "Segoe UI", sans-serif'

/** Total advance of `text` at 1 em. Throws on a glyph we have no width for. */
export function advanceOf(text, weight = 'bold') {
  const table = FONT.advance[weight]
  if (!table) throw new Error(`no advance table for weight "${weight}"`)
  let sum = 0
  for (const ch of String(text).toUpperCase()) {
    const w = table[ch]
    if (w === undefined) throw new Error(`no measured width for "${ch}" — add it to FONT.advance`)
    sum += w
  }
  return sum
}

/**
 * Can this string be drawn at all, and how wide is it?
 *
 * The allowed set is NAMED rather than described as "everything except": A-Z,
 * the digits, hyphen, slash, full stop, space and hash. A glyph with no
 * measured width does not draw wrong — it makes the width unknowable, and a
 * number whose width is unknown cannot be checked against the logo it must not
 * touch.
 */
export function checkSerial(text) {
  const s = String(text ?? '')
  const problems = []
  if (s.length === 0) problems.push('empty')
  const table = FONT.advance.bold
  const unknown = [...new Set([...s.toUpperCase()].filter((c) => table[c] === undefined))]
  if (unknown.length) problems.push(`no measured width for ${unknown.map((c) => `"${c}"`).join(', ')}`)
  return { text: s, ok: problems.length === 0, problems, emWidth: problems.length ? null : advanceOf(s) }
}

/*
 * Place `text` in one half's number slot.
 *
 * `scale` multiplies the label's capHeight: 1 means the digits stand exactly as
 * tall as the printed "TICKET NO:" beside them, which is the default.
 *
 * Returns the geometry a renderer needs plus an honest fit report. It does NOT
 * shrink anything — see `placeFitted` — because a caller that wants to know
 * whether a number is too long must be able to ask without being quietly given
 * a smaller one.
 */
export function place(design, slotName, text, opts = {}) {
  const slot = design?.[slotName]
  if (!slot) throw new Error(`unknown slot "${slotName}" — expected main or stub`)
  const scale = opts.scale ?? slot.scale ?? 1
  const weight = opts.weight ?? slot.weight ?? 'bold'
  const gap = opts.gap ?? SPACING.gap
  const clear = opts.clear ?? SPACING.clear

  const digitHeight = slot.capHeight * scale
  const fontSize = digitHeight / FONT.digitHeight
  const x = slot.label.right + gap * fontSize
  const width = advanceOf(text, weight) * fontSize
  const right = x + width
  const limit = slot.clearRight - clear * fontSize

  return {
    slot: slotName,
    text: String(text),
    x,
    /* SVG draws text from its baseline, which is the whole point: the number
     * lands on the label's baseline by construction, not by nudging. */
    baseline: slot.label.baseline,
    fontSize,
    weight,
    width,
    right,
    top: slot.label.baseline - digitHeight,
    digitHeight,
    fill: slot.ink,
    limit,
    fits: right <= limit + 1e-9,
    overflow: Math.max(0, right - limit),
    spareDigits: Math.floor((limit - right) / (0.5 * fontSize)),
    /*
     * Sideways is the interesting direction — that is where the logo is — but
     * `scale` grows the number upward off the baseline without limit, and a
     * caller who asks for a number three times the label's height gets one with
     * its heads cut off by the edge of the ticket. Reported rather than
     * clamped: an override is allowed to be bold, just not silent.
     */
    clearsTop: slot.label.baseline - digitHeight >= 0,
    clearsBelow: slot.label.baseline < slot.clearBelow,
  }
}

/*
 * The same, but allowed to give ground.
 *
 * On today's numbering — KS- and five digits — this never fires; the main half
 * has room for thirty-one digits. It is here for the day somebody lengthens the
 * prefix, and the failure it prevents is a serial printed across the CEA
 * roundel, which would look like a misprint and be argued about at the draw.
 * Shrinking is the lesser evil, and it reports that it happened.
 */
export function placeFitted(design, slotName, text, opts = {}) {
  const first = place(design, slotName, text, opts)
  const requested = opts.scale ?? design?.[slotName]?.scale ?? 1
  if (first.fits) return { ...first, shrunk: false, appliedScale: requested }

  const slot = design[slotName]
  const weight = opts.weight ?? slot.weight ?? 'bold'
  const gap = opts.gap ?? SPACING.gap
  const clear = opts.clear ?? SPACING.clear
  /* Solve for the font size at which right === limit. Both the gap before the
   * number and the clearance after it scale with the font, so it is linear:
   *   label.right + gap*f + adv*f  =  clearRight - clear*f            */
  const adv = advanceOf(text, weight)
  const f = (slot.clearRight - slot.label.right) / (gap + adv + clear)
  const fitted = (f * FONT.digitHeight) / slot.capHeight
  const out = place(design, slotName, text, { ...opts, scale: fitted })
  return { ...out, shrunk: true, requestedScale: requested, appliedScale: fitted }
}

/*
 * The book label, placed after the ticket number rather than at a fixed point.
 *
 * `gap` is in ems of the book label's own size and is measured from wherever
 * the NUMBER actually ended, so a longer ticket number pushes this along
 * instead of being overprinted by it. Returns null when it is switched off or
 * when there is no room left before whatever the number had to stop short of —
 * a book label overlapping the logo is worse than no book label.
 */
export function placeBook(design, slotName, bookText, numberPlacement) {
  const slot = design?.[slotName]
  const box = design?.book?.[slotName]
  if (!slot || !box?.enabled || !bookText) return null

  const weight = box.weight ?? 'regular'
  const capHeight = Number(box.capHeight ?? 12)
  const fontSize = capHeight / FONT.digitHeight
  const width = advanceOf(bookText, weight) * fontSize

  /*
   * Beside the number, or under it.
   *
   * Under it is not a fallback — it is what the stub needs. The stub's number
   * ends about 45 px before its roundel and a book label wants nearer 70, so
   * beside the number there is nowhere to put it; below it there are 27 px of
   * clear white before the stub's own printing starts.
   */
  const below = box.below === true
  const x = below ? numberPlacement.x : numberPlacement.right + Number(box.gap ?? 1) * fontSize
  const baseline = below
    ? numberPlacement.baseline + Number(box.drop ?? 1.25) * fontSize
    : slot.label.baseline
  const right = x + width
  const limit = below ? slot.clearRight : numberPlacement.limit

  /* No room is no label. Overprinting the logo is worse than leaving it off. */
  if (right > limit + 1e-9) return null
  if (below && baseline > slot.clearBelow) return null

  return {
    slot: slotName,
    text: String(bookText),
    x,
    baseline,
    fontSize,
    weight,
    width,
    right,
    top: baseline - capHeight,
    digitHeight: capHeight,
    fill: box.ink ?? slot.ink,
    limit,
    fits: true,
  }
}

/*
 * Can this string's width be computed from the advance table?
 *
 * A ticket number always can — digits and capitals from a font whose widths are
 * written down. A buyer's name often cannot: it may be Burmese, or carry an
 * apostrophe, or a letter nobody measured. That is not an error, only a fact
 * that changes how it is drawn — see textEl, which pins a width it knows and
 * lets the browser lay out one it does not.
 */
export function measurable(text, weight = 'regular') {
  const table = FONT.advance[weight] ?? FONT.advance.regular
  return [...String(text ?? '').toUpperCase()].every((c) => table[c] !== undefined)
}

/*
 * THE BUYER'S DETAILS, on the stub's own ruled lines.
 *
 * The stub is printed with four ruled lines and a Burmese caption beside each —
 * name, phone, address, and who sold it — meant to be filled in by hand. For a
 * ticket already recorded as sold the raffle knows all four, and printing them
 * saves somebody copying them out of the app onto paper.
 *
 * Nothing is placed for a field the design has switched off, and nothing for an
 * empty value: a stub for a ticket with no address recorded prints the blank
 * line it came with, rather than the word "undefined".
 *
 * Long values are TRUNCATED to what the line holds, and only when the width can
 * be measured at all. A name running off the edge of the ticket is worse than
 * one that visibly stops.
 */
export function placeBuyer(design, values) {
  const cfg = design?.buyer
  if (!cfg?.enabled || !values) return []
  const out = []
  for (const [key, f] of Object.entries(cfg.fields ?? {})) {
    if (!f?.enabled) continue
    const raw = String(values[key] ?? '').trim()
    if (!raw) continue

    const weight = f.weight ?? 'regular'
    const capHeight = Number(f.capHeight ?? 15)
    const fontSize = capHeight / FONT.digitHeight
    const room = Number(f.maxRight ?? 0) - Number(f.x ?? 0)

    /*
     * The width is ESTIMATED for trimming and never pinned when drawing.
     *
     * The estimate uses Times' advance widths because those are the ones
     * written down, but this text is drawn in the Myanmar stack — so the two
     * numbers do not agree, and emitting the estimate as textLength made the
     * browser spread the glyphs to reach it. "Klang" came out as "K l a n g".
     * The estimate is close enough to decide whether a name will overrun a
     * ruled line; it is not close enough to lay that name out, so it is only
     * ever used for the first job.
     */
    let text = raw
    if (measurable(raw, weight) && room > 0) {
      const est = (t) => advanceOf(t, weight) * fontSize
      if (est(raw) > room) {
        let cut = raw
        while (cut.length > 1 && est(cut + '.') > room) cut = cut.slice(0, -1)
        text = cut + '.'
      }
    }

    out.push({
      field: key,
      text,
      truncated: text !== raw,
      x: Number(f.x),
      baseline: Number(f.baseline),
      fontSize,
      weight,
      /* Always null: see above. The browser lays this out, not the arithmetic. */
      width: null,
      fill: f.ink ?? '#0F490E',
      family: TEXT_FAMILY,
    })
  }
  return out
}

/** Both halves at once, from one source number. */
export function placeBoth(design, text, opts = {}) {
  return {
    main: placeFitted(design, 'main', text, opts),
    stub: placeFitted(design, 'stub', text, opts),
  }
}

/* ============ the SVG ============ */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const round = (n, p = 3) => Number(n.toFixed(p))

function textEl(p, pinWidth) {
  const attrs = [
    `x="${round(p.x)}"`,
    `y="${round(p.baseline)}"`,
    `font-family='${p.family ?? FONT.family}'`,
    `font-size="${round(p.fontSize)}"`,
    `font-weight="${p.weight === 'bold' ? 700 : 400}"`,
    `fill="${p.fill}"`,
    /*
     * textLength pins the total advance to the width that was already checked
     * against the logo. On a machine that really has Times it changes nothing —
     * the numbers agree. On one that falls back to some other serif it keeps the
     * number inside the space it was measured for instead of letting it run
     * long. lengthAdjust="spacing" moves the glyphs apart or together and never
     * distorts their shapes.
     */
    /*
     * A width is pinned only when it is known. It always is for a ticket
     * number; for a buyer's name in Burmese it is not, and inventing one would
     * squeeze or stretch the glyphs of somebody's name to fit a guess.
     */
    ...(pinWidth && typeof p.width === 'number' ? [`textLength="${round(p.width)}"`, 'lengthAdjust="spacing"'] : []),
    /* Alignment inside a box. Omitted when it is the default, so the markup a
     * left-aligned number produces is unchanged from before elements existed. */
    ...(p.anchor && p.anchor !== 'start' ? [`text-anchor="${p.anchor}"`] : []),
    'xml:space="preserve"',
  ]
  return `<text ${attrs.join(' ')}>${esc(p.text)}</text>`
}

/*
 * The measuring guides.
 *
 * Off by default and never part of anything printed for sale. They answer the
 * one question this needs answered — is it in the right place — by looking
 * rather than by trusting the arithmetic. They draw the label's baseline
 * extended across the slot, the top of its capitals, the box the number
 * occupies, and the edge it must not cross.
 */
function guidesFor(design, name, p) {
  const slot = design[name]
  return [
    `<line x1="${slot.label.left}" y1="${slot.label.baseline}" x2="${round(p.limit)}" y2="${slot.label.baseline}" stroke="#ff2d55" stroke-width="0.7"/>`,
    `<line x1="${slot.label.left}" y1="${slot.label.capTop}" x2="${round(p.limit)}" y2="${slot.label.capTop}" stroke="#ff2d55" stroke-width="0.7" stroke-dasharray="3 3"/>`,
    `<rect x="${round(p.x)}" y="${round(p.top)}" width="${round(p.width)}" height="${round(p.digitHeight)}" fill="none" stroke="#00b0ff" stroke-width="0.7"/>`,
    `<line x1="${slot.clearRight}" y1="20" x2="${slot.clearRight}" y2="${slot.clearBelow}" stroke="#ffd60a" stroke-width="0.7"/>`,
  ].join('')
}

/*
 * THE QR BOX — its place, not yet its contents.
 *
 * Phase 1 has nothing to encode: a ticket does not carry a code until phase 2
 * mints one. What the design screen needs in order to POSITION the box is its
 * exact outline and how coarse its modules would be, and both are arithmetic
 * rather than encoding. `qrModuleMM` below is the number that actually decides
 * whether a printed QR will scan, and it is reported on the screen beside the
 * box.
 *
 * When the encoder lands, this is the seam: the same box, filled with modules.
 */
export function qrModuleMM(design, box, modules = 33) {
  const widthMM = Number(design?.sheet?.widthMM ?? 190)
  const artworkWidth = Number(design?.artwork?.width ?? 1600)
  const quiet = 4                       // the spec's quiet zone, in modules
  const perModulePx = Number(box?.size ?? 0) / (modules + quiet * 2)
  return (perModulePx * widthMM) / artworkWidth
}

/*
 * THE QR ITSELF, drawn as rectangles in the artwork's own coordinate space.
 *
 * One <rect> per dark module rather than an image, for two reasons. It prints
 * at whatever resolution the printer has, instead of at whatever resolution a
 * raster was generated at — which on a 300 dpi press is the difference between
 * crisp edges and soft ones. And it needs no canvas, so the same code runs in a
 * print preview, in a downloaded file and under node in the tests.
 *
 * THE WHITE BACKING IS NOT DECORATION. The artwork already has a placeholder QR
 * printed in this box, and a code drawn over another code scans as neither. The
 * backing also supplies the quiet zone the specification requires — four
 * modules of light on every side, without which many scanners will not see the
 * code at all.
 */
export function qrLayer(box, url, opts = {}) {
  if (!box?.enabled) return ''
  const { encode } = opts
  if (typeof encode !== 'function') throw new Error('qrLayer needs the encoder passed in')

  const code = encode(url, { ecc: box.ecc || 'M' })
  const quiet = 4
  const span = code.size + quiet * 2
  const unit = Number(box.size) / span
  const originX = Number(box.x) + quiet * unit
  const originY = Number(box.y) + quiet * unit

  const parts = []
  if (box.backing !== false) {
    parts.push(`<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.size)}" height="${round(box.size)}" fill="#ffffff"/>`)
  }
  /*
   * Runs of adjacent dark modules become one rectangle. A version 4 code is
   * 1089 modules and about 540 of them are dark; merging runs takes that to
   * roughly 200 rectangles, which matters when a sheet carries ten tickets and
   * a browser has to lay all of it out to print.
   */
  for (let y = 0; y < code.size; y++) {
    let run = 0
    for (let x = 0; x <= code.size; x++) {
      const dark = x < code.size && code.modules[y][x]
      if (dark) { run++; continue }
      if (run > 0) {
        parts.push(`<rect x="${round(originX + (x - run) * unit)}" y="${round(originY + y * unit)}" width="${round(run * unit)}" height="${round(unit)}" fill="#000000"/>`)
        run = 0
      }
    }
  }
  return parts.join('')
}

function qrPlaceholder(box, label) {
  if (!box?.enabled) return ''
  const x = round(box.x)
  const y = round(box.y)
  const s = round(box.size)
  const inset = round(box.size * (4 / 41))     // where the modules would begin
  return [
    box.backing ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#ffffff"/>` : '',
    `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="#00b0ff" stroke-width="1" stroke-dasharray="4 3"/>`,
    `<rect x="${round(box.x + inset)}" y="${round(box.y + inset)}" width="${round(box.size - inset * 2)}" height="${round(box.size - inset * 2)}" fill="none" stroke="#9aa0a6" stroke-width="0.8"/>`,
    `<text x="${round(box.x + box.size / 2)}" y="${round(box.y + box.size / 2)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${round(box.size / 9)}" fill="#5f6368">${esc(label)}</text>`,
  ].join('')
}

/**
 * The overlay: an `<svg>` carrying both numbers, sized to the artwork.
 *
 * `qrBoxes` draws the QR placeholders — on for the design screen, off for
 * anything printed, because an outline is not a QR and should never reach
 * paper that is going to a buyer.
 */
export function numberLayerSVG(design, text, opts = {}) {
  /*
   * A DESIGN WITH AN ELEMENT LIST IS DRAWN BY THE ELEMENT RENDERER.
   *
   * Every design has one now — designFor derives it from the old slots when
   * nothing was stored — so in practice this is the path everything takes. The
   * body below still runs for a design assembled by hand without elements,
   * which is what the geometry tests do when they are testing the old slots
   * themselves. Keeping both was the only way to prove the migration draws the
   * same ticket: one of them has to be the thing being compared against.
   *
   * The old options are the vocabulary callers already speak, so they are
   * translated into sources here rather than at six call sites.
   */
  if (Array.isArray(design?.elements) && design.elements.length) {
    const b = opts.buyer || null
    return elementLayerSVG(design, {
      'ticket.number': text,
      'book.number': opts.book || '',
      'buyer.name': b?.name ?? '',
      'buyer.phone': b?.phone ?? '',
      'buyer.address': b?.address ?? '',
      seller: b?.seller ?? '',
      price: opts.price ?? '',
      'sold.on': opts.soldOn ?? '',
      'draw.on': opts.drawOn ?? '',
      code: opts.code ?? '',
    }, opts)
  }
  const { guides = false, pinWidth = true, qrBoxes = false, qrUrl = '', encode, book = '', ...placeOpts } = opts
  const p = placeBoth(design, text, placeOpts)
  /*
   * The book this ticket came out of, if the caller knows it. A design-screen
   * preview has no real ticket, so it shows a sample; a printed ticket always
   * has the real one.
   */
  const bookMain = book ? placeBook(design, 'main', book, p.main) : null
  const bookStub = book ? placeBook(design, 'stub', book, p.stub) : null
  const width = Number(design?.artwork?.width ?? 1600)
  const height = Number(design?.artwork?.height ?? 517)
  /*
   * A real code when there is an address to put in it, an outline when there is
   * not. The design screen has no ticket and no code, so it shows the box; a
   * printed ticket always has both.
   */
  const real = qrUrl && encode
  const body = [
    real ? qrLayer(design.qrMain, qrUrl, { encode }) : (qrBoxes ? qrPlaceholder(design.qrMain, 'QR') : ''),
    real ? qrLayer(design.qrStub, qrUrl, { encode }) : (qrBoxes ? qrPlaceholder(design.qrStub, 'QR') : ''),
    textEl(p.main, pinWidth),
    textEl(p.stub, pinWidth),
    bookMain ? textEl(bookMain, pinWidth) : '',
    bookStub ? textEl(bookStub, pinWidth) : '',
    ...placeBuyer(design, opts.buyer).map((f) => textEl(f, pinWidth)),
    ...(guides ? [guidesFor(design, 'main', p.main), guidesFor(design, 'stub', p.stub)] : []),
  ].join('')
  return `<svg class="numbers" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}

/**
 * The address a printed ticket's QR points at.
 *
 * `base` is the raffle's VERIFY_URL if an organiser has set one, and otherwise
 * this site — printed codes outlive the raffle, so an organiser has to be able
 * to aim them somewhere they will still control.
 *
 * THE COMPACT FORM, `?KS-00123.CODE`, and not `?t=..&c=..`. Every character in
 * the address is a module in the QR, and a shorter address prints with larger
 * squares, which is the difference between scanning from across a table and
 * having to hold a phone against the paper. The verify function accepts both.
 */
export function ticketVerifyUrl(base, number, code) {
  const root = String(base || '').replace(/\/+$/, '')
  return `${root}/?${encodeURIComponent(String(number))}.${encodeURIComponent(String(code))}`
}

/* ============ elements: a box, and something in it ============ */

/*
 * THE SECOND GEOMETRY, AND WHY IT REPLACED THE FIRST.
 *
 * Everything above places one of six things the system named. This places
 * anything: a box drawn on the artwork as shares of it, with a value from the
 * register in it. See src/lib/ticketelements.js for the model and for why the
 * box's BOTTOM edge is the baseline.
 *
 * It is not a rewrite of the arithmetic — it is the same arithmetic with the
 * inputs arriving as a box instead of as a label to measure from. A design
 * migrated out of the old shape draws coordinates identical to within a
 * ten-thousandth of a pixel, and tests/ticketart proves that rather than
 * asserting it.
 */


/** Lines wrap at 1.45 of their own cap height — tight, because these are short. */
const LINE = 1.45

/*
 * Can this be measured, and must it be?
 *
 * A number-stack element MUST be measurable: its whole purpose is to be checked
 * against the thing it must not touch, and a width that cannot be computed
 * cannot be checked. So an unknown glyph there is refused outright, exactly as
 * the ticket number always was.
 *
 * A text-stack element must not be. A buyer's name in Burmese has no entry in
 * an advance table built from Times, and refusing it would refuse the language
 * the ticket is printed in. It draws, and the browser lays it out.
 */
function widthOf(text, el, fontSize) {
  const weight = el.weight === 'bold' ? 'bold' : 'regular'
  if (el.family === 'number') {
    /* Throws by design on a glyph with no measured width. */
    return advanceOf(text, weight) * fontSize
  }
  return measurable(text, weight) ? advanceOf(text, weight) * fontSize : null
}

/**
 * Place one element's value inside its box.
 *
 * `prior` is the placements already made, so an element that flows after
 * another can read where that one actually ended. Returns null when there is
 * nothing to draw — switched off, or no value — because a stub for a ticket
 * with no address recorded should print the blank line it came with.
 */
export function placeElement(design, el, values, prior = {}) {
  if (!el || el.enabled === false) return null
  const W = Number(design?.artwork?.width ?? 1600)
  const H = Number(design?.artwork?.height ?? 517)

  const bx = el.box.left * W
  const by = el.box.top * H
  const bw = el.box.width * W
  const bh = el.box.height * H

  if (el.kind === 'code') {
    return { id: el.id, el, kind: 'code', x: bx, y: by, size: Math.min(bw, bh), right: bx + bw, box: { x: bx, y: by, w: bw, h: bh } }
  }

  const raw = String(valueFor(el, values) ?? '').trim()
  if (!raw) return null

  const weight = el.weight === 'bold' ? 'bold' : 'regular'
  const family = el.family === 'text' ? TEXT_FAMILY : FONT.family
  let fontSize = bh / FONT.digitHeight

  /* Where the left edge actually is. Almost everything uses its own box; an
   * element that flows starts from wherever the one before it ended, so a
   * longer ticket number pushes the book along instead of being overprinted. */
  const from = el.after ? prior[el.after] : null
  const x0 = from ? from.right + Number(el.gap ?? 1.1) * fontSize : bx
  const limit = bx + bw

  let text = raw
  let lines = [raw]
  let width = widthOf(text, el, fontSize)
  let shrunk = false
  const room = Math.max(0, limit - x0)

  if (width !== null && width > room && room > 0) {
    if (el.overflow === 'shrink') {
      /* Solve for the size at which it exactly fills the room. Linear, because
       * every width in this arithmetic scales with the font. */
      fontSize *= room / width
      width = widthOf(text, el, fontSize)
      shrunk = true
    } else if (el.overflow === 'cut') {
      let cut = text
      while (cut.length > 1 && widthOf(cut + '.', el, fontSize) > room) cut = cut.slice(0, -1)
      text = cut + '.'
      width = widthOf(text, el, fontSize)
      lines = [text]
    } else {
      /* Wrap. Broken on spaces only — a serial number has none and must never
       * be split, and a Burmese name has no space to break at either. */
      const words = text.split(/\s+/)
      const out = []
      let line = ''
      for (const w of words) {
        const next = line ? `${line} ${w}` : w
        if (line && widthOf(next, el, fontSize) > room) { out.push(line); line = w } else line = next
      }
      if (line) out.push(line)
      lines = out.length ? out : [text]
      width = Math.max(...lines.map((l) => widthOf(l, el, fontSize) ?? 0))
    }
  }

  /*
   * Alignment is left to SVG's own text-anchor rather than computed here.
   * Centring by arithmetic needs a width, and the whole point of the text stack
   * is that its width is not knowable — so a centred Burmese name would be
   * centred on a guess. text-anchor is applied by whatever is laying the glyphs
   * out, which is the only thing that knows how wide they came out.
   */
  const anchor = el.align === 'centre' ? 'middle' : (el.align === 'right' ? 'end' : 'start')
  const x = el.align === 'centre' ? bx + bw / 2 : (el.align === 'right' ? limit : x0)

  const baseline = by + bh
  const placed = lines.map((t, i) => ({
    text: t,
    x,
    baseline: baseline + i * bh * LINE,
    /* A width is pinned only for the number stack, where it is known and where
     * holding it is what keeps a serial inside the space measured for it. */
    width: el.family === 'number' ? widthOf(t, el, fontSize) : null,
  }))

  return {
    id: el.id,
    el,
    kind: 'text',
    text,
    lines: placed,
    x,
    baseline,
    fontSize,
    weight,
    family,
    anchor,
    fill: el.ink,
    width,
    /* Where this one ended, so anything flowing after it knows. Unmeasurable
     * text cannot say, and reports its box's right edge instead of a guess. */
    right: width === null ? limit : x0 + width,
    limit,
    room,
    shrunk,
    wrapped: placed.length > 1,
    measured: width !== null,
    fits: width === null ? true : x0 + width <= limit + 1e-9,
    box: { x: bx, y: by, w: bw, h: bh },
  }
}

/**
 * Every element of a design, placed.
 *
 * Ordered so that anything flowing after something else is placed second —
 * one pass in list order is enough because `after` may only point backwards,
 * which `validateElements` is what keeps true.
 */
export function placeElements(design, values = {}) {
  const out = []
  const prior = {}
  for (const el of design?.elements ?? []) {
    const p = placeElement(design, el, values, prior)
    if (!p) continue
    prior[p.id] = p
    out.push(p)
  }
  return out
}

/* An element's box, drawn as a guide. The baseline is solid because that is the
 * line the lettering actually sits on; the box itself is dashed. */
function elementGuide(p) {
  const b = p.box
  return [
    `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" fill="none" stroke="#00b0ff" stroke-width="0.7" stroke-dasharray="4 3"/>`,
    p.kind === 'text'
      ? `<line x1="${round(b.x)}" y1="${round(b.y + b.h)}" x2="${round(b.x + b.w)}" y2="${round(b.y + b.h)}" stroke="#ff2d55" stroke-width="0.7"/>`
      : '',
  ].join('')
}

/**
 * The overlay, drawn from the element list.
 *
 * `values` is keyed by source id — see SOURCES in ticketelements.js. Anything
 * absent is simply not drawn.
 *
 * CODES ARE DRAWN FIRST, and that is not a style choice. A QR carries a white
 * backing that covers whatever is under it, so a code painted after a number
 * would erase the number. Paint order here is the z-order on paper.
 */
export function elementLayerSVG(design, values = {}, opts = {}) {
  const { guides = false, pinWidth = true, qrBoxes = false, qrUrl = '', encode } = opts
  const width = Number(design?.artwork?.width ?? 1600)
  const height = Number(design?.artwork?.height ?? 517)
  const placed = placeElements(design, values)

  const codes = []
  const texts = []
  for (const p of placed) {
    if (p.kind === 'code') {
      const box = { enabled: true, x: p.x, y: p.y, size: p.size, ecc: p.el.ecc, backing: p.el.backing }
      if (qrUrl && encode) codes.push(qrLayer(box, qrUrl, { encode }))
      else if (qrBoxes) codes.push(qrPlaceholder(box, 'QR'))
      continue
    }
    for (const line of p.lines) {
      texts.push(textEl({
        text: line.text,
        x: line.x,
        baseline: line.baseline,
        fontSize: p.fontSize,
        weight: p.weight,
        fill: p.fill,
        family: p.family,
        width: line.width,
        anchor: p.anchor,
      }, pinWidth))
    }
  }

  const body = [
    ...codes,
    ...texts,
    ...(guides ? placed.map(elementGuide) : []),
  ].join('')
  return `<svg class="numbers" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}
