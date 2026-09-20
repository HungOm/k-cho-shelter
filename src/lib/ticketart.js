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
// For the boundary between the ticket and its stub. Imported rather than
// copied — see watermarkSVG, where the copy is what went wrong.
import { stubShare } from './ticketdesign.js'

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
/*
 * WHY THERE IS NO LOGO IN THE MIDDLE OF THE QR. Asked for on 2026-09-20,
 * measured, and declined — written here because the next person to ask will
 * be standing exactly where this function is.
 *
 * A logo in the centre destroys modules, so it is paid for out of the error
 * correction budget. The usual way to afford one is level H. Both cost module
 * size, and this code has very little to spend:
 *
 * IT DEPENDS ON THE ADDRESS, so the boundaries are here rather than one
 * number. Measured across the span, at a 190mm ticket:
 *
 *   address length    M          Q          H
 *   54 – 58        0.353 mm   0.322 mm   0.296 mm
 *   59 – 60        0.353 mm   0.322 mm   0.273 mm   <- this deployment, at 60
 *   61 – 62        0.353 mm   0.296 mm   0.273 mm
 *   63 +           0.322 mm   0.296 mm   0.273 mm
 *
 * H steps at 59 characters, Q at 61, M not until 63 — so the level being
 * proposed for a logo is also the only one sensitive to an address somebody
 * might lengthen without thinking about it.
 *
 * WHAT THIS DEPLOYMENT PRINTS IS 60: the base falls back to
 * `location.origin + '/v'`, so it is the host, plus /v/?, plus the number,
 * plus a twelve-character code. Sixty is what ticketcode.ts predicted when it
 * chose that length. Anyone re-deriving this should print the URL rather than
 * assume it — an earlier pass of this note said 58 because it dropped the /v,
 * and the two answers sit on opposite sides of the H boundary.
 *
 * Against that, _shared/ticketcode.ts — written by whoever chose the code
 * length, about this same millimetre — says two things. That "below roughly a
 * third of a millimetre a square, ordinary phone cameras start failing on
 * paper". And that dropping from 0.35 to "about 0.32 mm" is "still probably
 * fine, and not worth the risk for strength nobody needs". Q lands exactly on
 * the value that argument already declined, and H lands below anything it
 * contemplates.
 *
 * Staying at M and spending the correction budget on the logo instead is the
 * same decision wearing a different hat: that budget is what survives a fold
 * down the middle of a pocket, a thumb, cheap paper, and a phone held at an
 * angle in a hall. It is not spare.
 *
 * AND THE TICKET IS ALREADY BRANDED. The artwork behind all of this is the
 * organisation's own upload — the whole face of the ticket. The QR is the one
 * place on it where identity costs legibility.
 *
 * WHERE IT WOULD BE AFFORDABLE, if it is ever wanted: the digital ticket,
 * which is canvas pixels rather than millimetres and has no floor of this
 * kind.
 *
 * ONE TRAP THERE, AND IT HAS NOW CAUGHT TWO PEOPLE IN ONE EVENING, which is
 * why it is written as a rule and not as advice. Everything drawn into that
 * canvas goes through an Image, and an Image loading an SVG parses it as
 * STRICT XML with no access to the page's own resources. A backslash-escaped
 * quote in a font-family attribute killed it once; an externally referenced
 * asset would kill it the same way. Anything a canvas-bound layer needs must
 * be inlined — a data URI, or nothing. The failure is silent: the export
 * falls through to its own fallback, which looks exactly like ordinary
 * behaviour.
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
    // Before the codes, so their white backing punches it out. Same rule as
    // the element renderer; both paths draw the same ticket or neither is
    // worth having.
    watermarkSVG(design, opts.watermark ?? '', opts),
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
/*
 * A DIAGONAL WATERMARK, DRAWN TWICE BECAUSE THE TICKET HAS TWO BACKGROUNDS.
 *
 * The main half of this artwork is dark and the stub is white. One ink cannot
 * serve both: an opacity that reads on the dark half is invisible on the stub,
 * and one that reads on the stub is a smear on the dark half. So each half is
 * drawn into its own nested <svg> — which clips at its own edges, needing no
 * clipPath and therefore no id, which matters because a printed sheet puts
 * fifty of these overlays in one document and ids would collide across them.
 * `design.stubAt` is the boundary, a share of the width, and exists for
 * exactly this kind of question.
 *
 * THE INKS ARE CHOSEN BY LUMINANCE, NOT HUE, because these are printed on an
 * office laser as often as not and two colours that look distinct on screen
 * converge to one gray on paper. White on the dark half, near-black on the
 * stub, both at an opacity low enough to read a serial number through.
 *
 * THE TWO OPACITIES ARE NOT THE SAME NUMBER AND MUST NOT BE MADE ONE. They
 * were measured, by rendering the artwork with and without the watermark and
 * comparing mean luma per half: white at 0.24 on the dark side is a stroke of
 * about 33, and matching it on the white stub takes 0.18. At 0.13 — which
 * looks right on screen — the stub carries three-quarters the weight of the
 * main half, and the gap widens rather than closes in grayscale.
 *
 * THE ANGLE IS THE TICKET'S OWN DIAGONAL, atan(height / width) — about 18° on
 * a 1600×517 ticket. A 45° line leaves a ticket this wide almost immediately
 * and reads as a slash in one corner rather than as a watermark across it.
 *
 * NO textLength ANYWHERE. Pinning a width is only honest for text measured in
 * FONT.advance; on anything else it stretches or crushes the glyphs, which is
 * how a place name once printed as "K l a n g".
 *
 * IT SURVIVES A NON-LATIN LABEL, AND ONE PATH WILL NOT DRAW IT WELL. The
 * repeat count is estimated rather than measured when the glyphs have no
 * measured width, so "နမူနာ" renders instead of throwing — the print sheet
 * and the on-screen preview both parse this SVG inline, where the page's own
 * Padauk applies, and they are fine. The DIGITAL TICKET is not: it rasterises
 * the overlay through an Image onto a canvas, a webfont does not load on that
 * path, and the picture falls back to whatever Myanmar font the device has.
 * A phone with none draws boxes, silently, in the exported picture only. The
 * same limitation as a Burmese buyer's name on a digital ticket, for the same
 * reason. So: the caller decides the label, and today every caller passes
 * "SAMPLE". Anything that lets somebody TYPE one needs a Burmese reader to
 * look at an exported picture first — "it rendered" is not "it is correct"
 * in a script none of us reads.
 *
 * IT IS PAINTED FIRST, BEFORE THE CODES, and that is a correctness matter
 * rather than an aesthetic one. qrLayer lays a white backing rectangle under
 * every QR, so a watermark drawn first is punched cleanly out from under the
 * code: quiet zone intact, modules unobstructed. Drawn afterwards it would lie
 * a diagonal stroke across a live QR whose modules are about 0.39mm, and the
 * ticket would photograph as unscannable.
 */
export function watermarkSVG(design, text, opts = {}) {
  const label = String(text ?? '').trim()
  if (!label) return ''
  const width = Number(design?.artwork?.width ?? 1600)
  const height = Number(design?.artwork?.height ?? 517)
  /*
   * THE BOUNDARY IS ASKED FOR, NOT ASSUMED, AND NOT CLAMPED HERE EITHER.
   *
   * This read `?? 0.6875` until the perforation was measured off the artwork
   * and turned out to be at 0.7394 — 83px further right. Five files had the
   * old number written into them and not one moved with it, which is how a
   * constant kept in five places behaves the first time it is wrong. The cost
   * here was quiet: the strip between the two values is the buyer's DARK half
   * and it was being painted with the stub's near-black ink, so five per cent
   * of the ticket width carried a watermark nobody could see.
   *
   * stubShare answers the whole question — missing, not a number, or out of
   * range — because each of those five sites had also grown its own clamp and
   * the clamps disagreed. Deduplicating the default alone would have left four
   * opinions about the range.
   */
  const split = width * stubShare(design)

  const angle = -(Math.atan2(height, width) * 180) / Math.PI
  const size = Number(opts.watermarkSize ?? height * 0.2)
  const rows = 3
  const gap = size * 1.45

  // Enough repeats to cross the longest half on the diagonal, plus one so the
  // ends are never visible inside the ticket.
  const half = (x0, x1, fill, opacity) => {
    const w = x1 - x0
    if (w <= 1) return ''
    const span = Math.hypot(w, height)
    /*
     * MEASURED IF IT CAN BE, ESTIMATED OTHERWISE, AND NEVER THROWN OVER.
     *
     * advanceOf raises on any glyph with no measured width, which is every
     * Burmese one — and "နမူနာ" is the obvious thing for somebody to put here
     * on a ticket that is bilingual everywhere else. An unguarded call turns
     * that request into an exception that takes the whole print sheet with it,
     * not just the watermark.
     *
     * All this number does is decide how many times to repeat the word, and
     * the nested viewport clips whatever overspills, so an estimate is worth
     * exactly as much as a measurement here. It is also why the width is never
     * pinned: see the textLength note above.
     */
    const advance = measurable(label, 'bold') ? advanceOf(label, 'bold') : label.length * 0.62
    const per = Math.max(1, Math.ceil(span / (Math.max(advance, 0.1) * size * 0.9)) + 1)
    const line = Array(per).fill(label).join('   ')
    const lines = []
    for (let i = 0; i < rows; i++) {
      const y = height / 2 + (i - (rows - 1) / 2) * gap + size * 0.35
      lines.push(`<text x="${round(w / 2)}" y="${round(y)}" text-anchor="middle">${esc(line)}</text>`)
    }
    return `<svg x="${round(x0)}" y="0" width="${round(w)}" height="${round(height)}" ` +
      `viewBox="0 0 ${round(w)} ${round(height)}" preserveAspectRatio="none">` +
      `<g transform="rotate(${round(angle)} ${round(w / 2)} ${round(height / 2)})" ` +
      `fill="${fill}" fill-opacity="${opacity}" font-family='${TEXT_FAMILY}' ` +
      `font-size="${round(size)}" font-weight="700" letter-spacing="${round(size * 0.12)}">` +
      `${lines.join('')}</g></svg>`
  }

  return half(0, split, opts.watermarkInkMain ?? '#ffffff', opts.watermarkOpacityMain ?? 0.24) +
    half(split, width, opts.watermarkInkStub ?? '#111111', opts.watermarkOpacityStub ?? 0.18)
}

export function elementLayerSVG(design, values = {}, opts = {}) {
  const { guides = false, pinWidth = true, qrBoxes = false, qrUrl = '', encode, watermark = '' } = opts
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
    // First, so that qrLayer's white backing punches it out from under the code.
    watermarkSVG(design, watermark, opts),
    ...codes,
    ...texts,
    ...(guides ? placed.map(elementGuide) : []),
  ].join('')
  return `<svg class="numbers" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}

/* ============ the card a buyer is sent ============ */

/*
 * THE DIGITAL TICKET IS DRAWN, NOT PHOTOGRAPHED.
 *
 * Everything else in this file puts ink on a picture of a printed ticket. This
 * makes a different object, and the reason is that the printed one cannot be
 * cropped into what a buyer should receive.
 *
 * On the artwork the buyer's NAME is on the stub and the QR is on the main
 * half, on opposite sides of the perforation. So a picture of the whole ticket
 * carries the name, the phone, the area and the seller — a forwardable image of
 * somebody's own contact details, and a picture of the organiser's counterfoil,
 * which is the half that comes back for the draw. A picture of the buyer's half
 * carries the QR and no name at all, which loses the one thing that made a
 * forwarded copy visibly somebody else's.
 *
 * Neither is right, so the card takes what belongs to the buyer from both
 * sides: the number, the book, their name, and the code. Nobody's phone, area
 * or seller is on it.
 *
 * ITS COLOURS COME FROM THE DESIGN rather than from here, so a second charity's
 * card matches their own ticket without anybody restyling this. The dark is the
 * ink the stub is printed in — on this artwork that is the green of the main
 * half — and the lettering is the ink the number is printed in.
 */
export const CARD = { width: 1200, height: 760 }

/*
 * Card 8b draws the same ticket three ways, all from the one brand colour:
 * Grand (landscape, foil rule, serif number, watermark), Certificate (light
 * stock, tinted border, seal) and Stub (portrait, phone-shaped, number first).
 *
 * Grand is the in-app keepsake. Stub is the one to send: a chat is a phone, so
 * portrait fills the screen where landscape letterboxes, and the number leads
 * because the number is what gets read down a telephone.
 */
export const CARD_STUB = { width: 1080, height: 1920 }

/*
 * WHAT GOES ON IT, and why each line earns its place.
 *
 * A digital ticket is a receipt and a claim check at once, so it answers the
 * questions somebody actually asks of one, in the order they ask them:
 *
 *   who issued it   the organisation's mark and name — a stranger's screenshot
 *                   of a green rectangle proves nothing without an issuer
 *   what it is      the event, when a raffle has a name of its own
 *   which ticket    the number, largest thing on the card, because it is what
 *                   gets read out on the phone
 *   whose it is     the buyer's name — the marker that makes a forwarded copy
 *                   visibly somebody else's. Name only: no phone, no area, no
 *                   seller, all of which live on the stub and stay there
 *   when            the draw date. A ticket that does not say when to look is a
 *                   ticket somebody forgets they hold
 *   what was paid   the price, because this is the only receipt they get
 *   how to check    the QR, and the SAME ADDRESS IN TEXT underneath it. A QR
 *                   that will not scan — a cracked screen, a bad camera, a
 *                   photo of a photo — leaves a link somebody can still type
 *
 * The book number is deliberately absent. It is how the raffle files a stub,
 * not something the buyer has any use for.
 *
 * ITS COLOUR IS THE ORGANISATION'S, NOT THE ARTWORK'S. This used to take the
 * ticket's printed inks, which tied the card to a template that may not exist
 * — a raffle can sell before it has uploaded artwork, and the card should not
 * wait for a picture it never draws. brandColor is one value an organisation
 * already sets, and the lettering on it is COMPUTED rather than chosen, for the
 * reason brand.js gives: an organisation picking a colour is not picking a
 * contrast ratio, and white on pale yellow is unreadable in sunlight.
 */
/*
 * THE STUB TREATMENT — card 8b, portrait, number first.
 *
 * Shares the Grand card's values and its gold; differs in shape and in what it
 * leads with. No foil rule: 8b gives that to Grand alone.
 */
/*
 * CARD 8b, THE CERTIFICATE — the third treatment, and the only one printed.
 *
 * Grand and Stub are screens: they put light ink on the brand colour, which is
 * how a phone shows something. A certificate is paper somebody keeps, and paper
 * is not a dark rectangle — a treatment that filled an A4 sheet with solid
 * colour would be an ink cartridge and a curled page. So this one inverts: pale
 * stock, the brand as a tinted border and a seal, and the type dark enough to
 * read after a photocopier has had it.
 *
 * TWO DIFFERENCES FROM ITS SIBLINGS ARE IN THE CARD ITSELF and neither is mine
 * to smooth over. It carries no SOLD chip — a certificate is not a status
 * badge, it is a record of one — and it spells out "Issued to" where Grand and
 * Stub run the name into a facts line. Both are how the card distinguishes a
 * keepsake from a receipt.
 */
export const CARD_CERT = { width: 1200, height: 850 }

/* A pale wash of the brand for the stock, and a deeper one for rules. Computed
 * rather than configured: an organisation choosing a colour has not chosen a
 * tint of it, and asking them to would be asking the wrong question. */
function mixHex(hex, towards, amount) {
  const h = String(hex).replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const to = String(towards).replace('#', '')
  const p = (v, i) => parseInt(v.slice(i * 2, i * 2 + 2), 16)
  const out = [0, 1, 2].map((i) => Math.round(p(n, i) + (p(to, i) - p(n, i)) * amount))
  return '#' + out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
}

/** Relative luminance, the sRGB way — the same test brand.js uses for ink. */
function lumOf(hex) {
  const h = String(hex).replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const ch = [0, 1, 2].map((i) => {
    const v = parseInt(n.slice(i * 2, i * 2 + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function certificateCardSVG(values = {}, opts = {}) {
  const { width: W, height: H } = CARD_CERT
  const brand = /^#[0-9a-f]{6}$/i.test(String(values.brand || '')) ? String(values.brand) : '#12343B'

  /*
   * The stock is nearly white — a 6% wash, enough that it is not a browser
   * default and not so much that a printer spends ink on it.
   */
  const stock = mixHex(brand, '#ffffff', 0.94)
  /*
   * THE INK IS DARKENED UNTIL IT MEASURES, not until a threshold says so.
   *
   * A luminance cutoff was the obvious way and it was wrong twice out of seven:
   * a mid green at 3.3:1 and a mid blue at 4.0:1 both sat under the bar while
   * passing the test, because "is this colour light" is not the question. The
   * question is whether THIS ink on THIS stock clears 4.5:1, and that is
   * measurable, so it is measured — step the brand toward black until it does.
   *
   * It matters more here than on the other two treatments because this is the
   * one that gets printed, photocopied, and read in a hall by somebody who has
   * kept it in a pocket.
   */
  const ratio = (a, b) => {
    const [hi, lo] = [lumOf(a), lumOf(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  let ink = brand
  for (let step = 0; step < 20 && ratio(ink, stock) < 4.5; step += 1) {
    ink = mixHex(brand, '#000000', (step + 1) * 0.05)
  }
  const quiet = mixHex(ink, stock, 0.42)
  const rule = mixHex(ink, stock, 0.62)

  const s = (v) => String(v ?? '').trim()
  const t = (str, x, y, size, fill, family, extra = '') => (str
    ? `<text x="${round(x)}" y="${round(y)}" font-family='${family}' font-size="${round(size)}" `
      + `fill="${fill}" ${extra} xml:space="preserve">${esc(str)}</text>`
    : '')
  const mid = (str, y, size, fill, family, extra = '') =>
    t(str, W / 2, y, size, fill, family, `text-anchor="middle" ${extra}`)

  const org = s(values.org)
  const number = s(values.number)
  const name = s(values.name)
  const price = s(values.price)
  const motto = s(values.motto)
  const logo = s(values.logo)
  const initial = (org || '?').charAt(0).toUpperCase()

  /* A double rule inset from the trim, which is what says "certificate" before
   * a word has been read. The inner one is hairline so the pair reads as one
   * border rather than as two boxes. */
  const border =
    `<rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${rule}" stroke-width="3"/>`
    + `<rect x="60" y="60" width="${W - 120}" height="${H - 120}" fill="none" stroke="${rule}" stroke-width="1"/>`

  /*
   * THE SEAL, bottom right, where a signature and a stamp go on anything
   * official. It is the logo when there is one and the initial when there is
   * not — the same fallback the other two use, so a raffle with no logo gets a
   * mark rather than a hole.
   */
  const seal = `<circle cx="${W - 190}" cy="${H - 178}" r="76" fill="none" stroke="${rule}" stroke-width="2"/>`
    + `<circle cx="${W - 190}" cy="${H - 178}" r="64" fill="none" stroke="${rule}" stroke-width="1"/>`
    + (logo
      ? `<image href="${esc(logo)}" x="${W - 234}" y="${H - 222}" width="88" height="88" preserveAspectRatio="xMidYMid meet"/>`
      : t(initial, W - 190, H - 156, 52, ink, TEXT_FAMILY, 'text-anchor="middle" font-weight="700"'))

  const qr = { enabled: true, x: 96, y: H - 268, size: 172, ecc: 'M', backing: false }
  const code = opts.qrUrl && opts.encode ? qrLayer(qr, opts.qrUrl, { encode: opts.encode }) : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${stock}"/>
    ${border}
    ${mid(org, 152, 30, quiet, TEXT_FAMILY, 'letter-spacing="6"')}
    ${mid('TICKET', 214, 22, quiet, TEXT_FAMILY, 'letter-spacing="8"')}
    ${mid(number, 318, 92, ink, FONT.family, 'font-weight="700" letter-spacing="4"')}
    <line x1="${W / 2 - 150}" y1="360" x2="${W / 2 + 150}" y2="360" stroke="${rule}" stroke-width="1"/>
    ${mid('Issued to', 418, 22, quiet, TEXT_FAMILY, 'letter-spacing="3"')}
    ${mid(name, 478, 46, ink, TEXT_FAMILY)}
    ${mid(price, 534, 26, quiet, FONT.family)}
    ${motto ? mid(motto, 622, 24, quiet, TEXT_FAMILY, 'font-style="italic"') : ''}
    ${code}
    ${seal}
  </svg>`
}

export function stubCardSVG(values = {}, opts = {}) {
  const { width: W, height: H } = CARD_STUB
  const paper = /^#[0-9a-f]{6}$/i.test(String(values.brand || '')) ? String(values.brand) : '#12343B'
  const ink = String(values.ink || '#ffffff')
  const white = ink.toLowerCase() === '#ffffff'
  const quiet = white ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.62)'
  const hair = white ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)'
  const gold = white ? '#ffe9a3' : ink

  const s = (v) => String(v ?? '').trim()
  const t = (str, x, y, size, fill, family, extra = '') => (str
    ? `<text x="${round(x)}" y="${round(y)}" font-family='${family}' font-size="${round(size)}" `
      + `fill="${fill}" ${extra} xml:space="preserve">${esc(str)}</text>`
    : '')
  const cap = (str, x, y) => t(str, x, y, 26, quiet, TEXT_FAMILY, 'letter-spacing="3"')

  const number = s(values.number)
  const org = s(values.org)
  const logo = s(values.logo)
  const initial = (org || '?').charAt(0).toUpperCase()
  const motto = s(values.motto)
  /* One line of facts rather than a column: 8b's stub reads
     "John Kui · RM 10.00 · Book-004". */
  const facts = [s(values.name), s(values.price), s(values.book)].filter(Boolean).join('  ·  ')

  const mark = logo
    ? `<rect x="72" y="72" width="84" height="84" rx="22" fill="rgba(255,255,255,.10)"/>`
      + `<image href="${esc(logo)}" x="81" y="81" width="66" height="66" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="72" y="72" width="84" height="84" rx="22" fill="rgba(255,255,255,.10)"/>`
      + t(initial, 114, 128, 44, ink, TEXT_FAMILY, 'text-anchor="middle" font-weight="700"')

  const chip = values.sold
    ? `<rect x="${W - 232}" y="82" width="160" height="52" rx="26" fill="none" stroke="${gold}" stroke-width="2"/>`
      + t('SOLD', W - 152, 118, 24, gold, TEXT_FAMILY, 'text-anchor="middle" font-weight="700" letter-spacing="2"')
    : ''

  /* The QR sits with the number rather than at the top: on a phone the thumb is
     at the bottom, and the code is the thing somebody holds up to be scanned. */
  /* Beside the number rather than under the motto: at the bottom it sat across
     the rule that separates the ticket from what the raffle says for itself. */
  const qr = { enabled: true, x: W - 302, y: H - 660, size: 230, ecc: 'M', backing: true }
  const code = opts.qrUrl && opts.encode ? qrLayer(qr, opts.qrUrl, { encode: opts.encode }) : ''

  const weave = `<pattern id="sweave" width="18" height="18" patternUnits="userSpaceOnUse" `
    + `patternTransform="rotate(-24)"><line x1="0" y1="0" x2="0" y2="18" `
    + `stroke="rgba(255,255,255,.035)" stroke-width="7"/></pattern>`
  /* Centred and large enough to hold the upper two-thirds. Portrait leaves a
     tall gap between the masthead and the number; the watermark is what makes
     that space read as a ticket face rather than as nothing. */
  const watermark = `<g opacity=".055" transform="translate(190 620) scale(7)">`
    + `<path d="M8 14h84a8 8 0 0 1 8 8v16a14 14 0 0 0 0 28v16a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V66a14 14 0 0 0 0-28V22a8 8 0 0 1 8-8z" `
    + `fill="none" stroke="${ink}" stroke-width="6"/></g>`

  const R = 40
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
    + `<defs>${weave}</defs>`
    + `<rect width="${W}" height="${H}" rx="${R}" fill="${paper}"/>`
    + `<rect width="${W}" height="${H}" rx="${R}" fill="url(#sweave)"/>`
    + watermark
    + mark
    + t(org, 180, 128, 38, ink, TEXT_FAMILY, 'font-weight="700"')
    + chip

    /* NUMBER FIRST is the whole of this treatment, so it takes the lower half
       where a thumb is and where the eye lands last. */
    + cap('TICKET NUMBER', 72, H - 620)
    + t(number, 72, H - 500, 104, gold, FONT.family, 'font-weight="700"')
    + t(facts, 72, H - 420, 32, ink, TEXT_FAMILY)

    + code
    + t(code ? 'Scan to check this ticket' : '', W - 187, H - 400, 22, quiet, TEXT_FAMILY, 'text-anchor="middle"')

    + `<line x1="72" y1="${H - 330}" x2="${W - 72}" y2="${H - 330}" stroke="${hair}" stroke-width="2"/>`
    + t(motto ? `\u201C${motto}\u201D` : '', 72, H - 270, 32, gold, FONT.family, 'font-style="italic"')
    + t(s(values.thanks), 72, motto ? H - 220 : H - 270, 30, ink, TEXT_FAMILY)
    + t(s(values.link), 72, H - 90, 22, quiet, FONT.family)
    + '</svg>'
}

/* No `design` here on purpose. This card is not the printed ticket: it is drawn
 * from the raffle's own colour, ink and logo, and the template's layout has no
 * say in it. The parameter used to be first in this list, was never once read,
 * and had ViewTicket linking organisers to the studio to change a card the
 * studio cannot touch. */
/*
 * THE THREE DESIGNS, NAMED.
 *
 * Card 8b drew the same ticket three ways and shipped all three; nothing
 * outside this file ever called two of them, so Certificate and Stub have been
 * built and unreachable. A renderer nobody can choose is a drawing, not a
 * feature.
 *
 * Named rather than exported as three functions a caller picks between,
 * because the choice is a stored setting and a stored setting is a string. The
 * shapes differ — Stub is portrait and phone-shaped, the other two landscape —
 * so `size` travels with the renderer rather than being looked up separately
 * by every caller that has to lay one out.
 */
export const CARD_DESIGNS = [
  { id: 'grand', name: 'Grand', size: CARD,
    note: 'Landscape, foil rule, serif number' },
  { id: 'certificate', name: 'Certificate', size: CARD_CERT,
    note: 'Light stock, tinted border, seal' },
  { id: 'stub', name: 'Stub', size: CARD_STUB,
    note: 'Portrait, phone-shaped, number first' },
]

/** The chosen design, falling back to Grand rather than to nothing drawn. */
export function cardDesign(id) {
  return CARD_DESIGNS.find((d) => d.id === id) || CARD_DESIGNS[0]
}

/*
 * ONE DOOR TO ALL THREE. Callers name a design and hand over the same values;
 * which function draws it is this file's business. Anything else spreads a
 * three-way branch across every screen that shows a card, and the third branch
 * is the one somebody forgets.
 */
export function cardSVG(id, values = {}, opts = {}) {
  if (id === 'certificate') return certificateCardSVG(values, opts)
  if (id === 'stub') return stubCardSVG(values, opts)
  return digitalCardSVG(values, opts)
}

export function digitalCardSVG(values = {}, opts = {}) {
  const { width: W, height: H } = CARD
  const paper = /^#[0-9a-f]{6}$/i.test(String(values.brand || '')) ? String(values.brand) : '#12343B'
  const ink = String(values.ink || '#ffffff')
  const quiet = ink.toLowerCase() === '#ffffff' ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.62)'
  const hair = ink.toLowerCase() === '#ffffff' ? 'rgba(255,255,255,.28)' : 'rgba(0,0,0,.22)'

  const s = (v) => String(v ?? '').trim()
  const number = s(values.number)
  const name = s(values.name)
  const org = s(values.org)
  const event = s(values.event)
  const draw = s(values.drawOn)
  const price = s(values.price)
  const book = s(values.book)
  const soldOn = s(values.soldOn)
  const motto = s(values.motto)
  const sold = !!values.sold
  const link = s(values.link)
  const logo = s(values.logo)

  /* The number is the one string whose width is known, so it is the only one in
   * the measured stack. Everything else may be Burmese — Myanmar chain, and no
   * width pinned, which is the bug that printed "Klang" as "K l a n g". */
  const t = (str, x, y, size, fill, family, extra = '') => (str
    ? `<text x="${round(x)}" y="${round(y)}" font-family='${family}' font-size="${round(size)}" `
      + `fill="${fill}" ${extra} xml:space="preserve">${esc(str)}</text>`
    : '')
  const cap = (str, x, y) => t(str, x, y, 24, quiet, TEXT_FAMILY, 'letter-spacing="3"')

  /*
   * The mark. An organisation's own logo when there is one and it could be
   * inlined — an <img>-rendered SVG will not fetch anything external, so the
   * caller hands it over as a data URI or not at all. Otherwise the initial in
   * a roundel, which is a mark rather than an apology for not having one.
   */
  const initial = (org || event || '?').trim().charAt(0).toUpperCase()
  /* A rounded tile rather than a hairline circle: 8a draws the mark as a solid
   * object, which reads as an emblem where an outline reads as a placeholder. */
  const mark = logo
    ? `<rect x="64" y="52" width="76" height="76" rx="20" fill="rgba(255,255,255,.10)"/>`
      + `<image href="${esc(logo)}" x="72" y="60" width="60" height="60" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="64" y="52" width="76" height="76" rx="20" fill="rgba(255,255,255,.10)"/>`
      + t(initial, 102, 104, 40, ink, TEXT_FAMILY, 'text-anchor="middle" font-weight="700"')

  /* The serial and the motto take the ticket's own gold — --ticket-gold, which
   * style.css says is the printed ticket's colour and never chrome. Only on a
   * dark face: on a light brand colour it would be unreadable, so the ink
   * stands instead. */
  const gold = ink.toLowerCase() === '#ffffff' ? '#ffe9a3' : ink

  const qr = { enabled: true, x: W - 316, y: 250, size: 236, ecc: 'M', backing: true }
  const code = opts.qrUrl && opts.encode ? qrLayer(qr, opts.qrUrl, { encode: opts.encode }) : ''

  /* A chip, not a word in the corner: the mock puts the state where a ticket
   * puts it, and "SOLD" is the one fact a buyer checks before anything else. */
  /* Outlined rather than filled, as 8a draws it. A solid gold lozenge competes
   * with the serial, which is the one thing on the card that should be loudest. */
  const chip = sold
    ? `<rect x="${W - 232}" y="56" width="168" height="52" rx="26" fill="none" stroke="${gold}" stroke-width="2"/>`
      + t('SOLD', W - 148, 92, 24, gold, TEXT_FAMILY, 'text-anchor="middle" font-weight="700" letter-spacing="2"')
    : ''

  /* Three facts on one line, evenly spaced, because they answer three
   * different questions — what it cost, which book it came from, when it sold. */
  const facts = [
    price && ['PRICE', price], book && ['BOOK', book], soldOn && ['SOLD', soldOn],
  ].filter(Boolean)
  const factRow = facts.map(([label, value], i) =>
    cap(label, 64 + i * 224, 520) + t(value, 64 + i * 224, 566, 34, ink, TEXT_FAMILY)).join('')

  /*
   * WHERE IT TEARS. Dashed, with the two notches genuinely cut out of the card
   * rather than painted on — a mask, so they composite over whatever the card
   * is shown against instead of being white blobs on WhatsApp's background.
   * This is what makes a rectangle read as a ticket.
   */
  const tearY = 628
  const R = 28
  const notchMask = `<mask id="notch"><rect width="${W}" height="${H}" rx="${R}" fill="#fff"/>`
    + `<circle cx="0" cy="${tearY}" r="18" fill="#000"/><circle cx="${W}" cy="${tearY}" r="18" fill="#000"/></mask>`

  /*
   * THE THREE THINGS THAT MAKE IT A KEEPSAKE RATHER THAN A PANEL, all from 8a.
   * A foil rule along the top edge; a diagonal weave at a few per cent, which
   * is what stops a large flat field looking like a screen; and the ticket
   * glyph as a watermark, large and faint, bottom right.
   */
  const weave = `<pattern id="weave" width="18" height="18" patternUnits="userSpaceOnUse" `
    + `patternTransform="rotate(-24)"><line x1="0" y1="0" x2="0" y2="18" `
    + `stroke="rgba(255,255,255,.035)" stroke-width="7"/></pattern>`
  const foil = `<rect x="${R}" y="0" width="${W - R * 2}" height="7" fill="${gold}"/>`
  const watermark = `<g opacity=".05" transform="translate(${W - 360} ${H - 430}) scale(4.3)">`
    + `<path d="M8 14h84a8 8 0 0 1 8 8v16a14 14 0 0 0 0 28v16a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V66a14 14 0 0 0 0-28V22a8 8 0 0 1 8-8z" `
    + `fill="none" stroke="${ink}" stroke-width="6"/></g>`
  /* Drawn INSIDE the group and after the paper. Outside it the paper covers it,
   * which is how the first version shipped a tear line nobody could see. */
  const tearLine = `<line x1="100" y1="${tearY}" x2="${W - 100}" y2="${tearY}" stroke="${hair}" `
    + `stroke-width="2" stroke-dasharray="10 8"/>`

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
    + `<defs>${weave}</defs>`
    + notchMask
    + `<g mask="url(#notch)">`
    + `<rect width="${W}" height="${H}" rx="${R}" fill="${paper}"/>`
    + `<rect width="${W}" height="${H}" rx="${R}" fill="url(#weave)"/>`
    + watermark
    + foil
    + tearLine
    + mark
    + t(org, 166, 84, 38, ink, TEXT_FAMILY, 'font-weight="700"')
    + t(event, 166, 124, 28, quiet, TEXT_FAMILY)
    + chip
    + `<line x1="64" y1="168" x2="${W - 64}" y2="168" stroke="${hair}" stroke-width="2"/>`

    + cap('TICKET NUMBER', 64, 226)
    + t(number, 64, 310, 76, gold, FONT.family, 'font-weight="700"')

    + (name ? cap('ISSUED TO', 64, 386) : '')
    + t(name, 64, 438, 42, ink, TEXT_FAMILY, 'font-weight="700"')

    + factRow
    + (facts.length ? '' : (draw ? cap('DRAW', 64, 520) + t(draw, 64, 566, 34, ink, TEXT_FAMILY) : ''))

    + code
    + t(code ? 'Scan to check this ticket' : '', W - 198, 528, 22, quiet, TEXT_FAMILY, 'text-anchor="middle"')

    + `</g>`
    /* Below the tear: the stub half — what the raffle says for itself. */
    + t(motto ? `“${motto}”` : '', 64, 664, 30, gold, FONT.family, 'font-style="italic"')
    + t(s(values.thanks), 64, motto ? 702 : 676, 30, ink, TEXT_FAMILY)
    /* The address in words as well as in the code: a QR that will not scan is
     * still a link somebody can type. Kept clear of the edge: at 752 its
     * descenders sat on the card’s bottom border. */
    + t(link, 64, motto ? 736 : 718, 22, quiet, FONT.family)
    + '</svg>'
}
