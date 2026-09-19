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
    `font-family='${FONT.family}'`,
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
    ...(pinWidth ? [`textLength="${round(p.width)}"`, 'lengthAdjust="spacing"'] : []),
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
  const { guides = false, pinWidth = true, qrBoxes = false, ...placeOpts } = opts
  const p = placeBoth(design, text, placeOpts)
  const width = Number(design?.artwork?.width ?? 1600)
  const height = Number(design?.artwork?.height ?? 517)
  const body = [
    qrBoxes ? qrPlaceholder(design.qrMain, 'QR') : '',
    qrBoxes ? qrPlaceholder(design.qrStub, 'QR') : '',
    textEl(p.main, pinWidth),
    textEl(p.stub, pinWidth),
    ...(guides ? [guidesFor(design, 'main', p.main), guidesFor(design, 'stub', p.stub)] : []),
  ].join('')
  return `<svg class="numbers" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}
