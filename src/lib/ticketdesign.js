/*
 * WHERE THINGS GO ON A TICKET, AND WHAT THE DEFAULTS ARE.
 *
 * Every number in DEFAULT_DESIGN was read out of the CEAM artwork by scanning
 * its pixels, not estimated by eye: the printed "TICKET NO:" label's ink
 * boundaries, the baseline its capitals sit on, and the first pixel of the CEA
 * roundel the number must not touch. They are in the artwork's own pixel space,
 * origin top-left, in a 1600 x 517 reference frame.
 *
 * WHY A REFERENCE FRAME AND NOT MILLIMETRES. The artwork arrives as a picture
 * of some size; the same design has to work whether somebody uploads it at 1600
 * pixels or at 3200. `designFor` scales these numbers to whatever was actually
 * uploaded, so an organiser who re-exports their artwork at print resolution
 * does not have to place the number again.
 *
 * WHAT IS A DEFAULT AND WHAT IS A SETTING. All of it is a setting — the Ticket
 * design screen can move any of it, and what it saves is stored per artwork and
 * merged over these. The defaults exist so that the common case, which is the
 * ticket CEAM already prints, needs nothing configured at all.
 *
 * HOW THE MEASUREMENTS WERE TAKEN, for whoever re-takes them: on the main half
 * the label is cream ink on dark green, so its pixels are the ones brighter
 * than the board; on the stub it is dark green on white, so its pixels are the
 * ones darker than the paper. The ink's bounding box gives the label's left
 * edge, the right edge of the colon, the top of the capitals and the baseline.
 */

/** The frame DEFAULT_DESIGN's numbers are expressed in. */
export const REFERENCE = { width: 1600, height: 517 }

/*
 * The measured ticket.
 *
 * Per half:
 *   label.right     one past the last inked pixel of the colon — the number
 *                   starts a gap after this
 *   label.capTop    top of the capital T
 *   label.baseline  the line the capitals sit on, which the digits share
 *   capHeight       baseline - capTop, kept explicit so a reader can see what
 *                   the number is being matched to
 *   clearRight      first pixel of whatever the number must not touch
 *   clearBelow      first row of whatever sits underneath
 *   ink             the label's own colour, sampled from the artwork
 */
export const DEFAULT_DESIGN = {
  main: {
    label: { left: 366, right: 552, capTop: 52, baseline: 73 },
    capHeight: 21,
    // clearRight is where the roundel at the top right begins; clearBelow is
    // the first row of the headline underneath. Both were measured off the
    // artwork this raffle happens to print, and both are editable.
    clearRight: 1066,
    clearBelow: 85,
    ink: '#FDEFB0',       // sampled from the brightest quarter of the label
    scale: 1,             // digit height as a multiple of the label's capitals
    weight: 'bold',
  },
  stub: {
    label: { left: 1272, right: 1378, capTop: 52, baseline: 64 },
    capHeight: 12,
    // The small roundel on the stub, and the first row of the line beneath it.
    clearRight: 1512,
    clearBelow: 91,
    ink: '#0F490E',       // sampled from the darkest core of the label
    scale: 1,
    weight: 'bold',
  },

  /*
   * The QR box, which is where the artwork already prints a placeholder QR —
   * measured at x 1025..1147, y 368..489, of which 1032..1139 is dark modules.
   * Taking that exact spot means the ticket does not get busier: one QR goes
   * where one QR already was.
   *
   * `backing` draws white under it with a quiet zone, because the placeholder
   * is still printed on the artwork underneath and a QR drawn over another QR
   * scans as neither.
   */
  qrMain: {
    enabled: true,
    x: 1025,
    y: 368,
    size: 122,
    ecc: 'M',
    backing: true,
    showText: false,
  },
  // The stub has no QR box on this artwork, so it is off. An organiser whose
  // ticket has room can turn it on and place it.
  qrStub: {
    enabled: false,
    x: 1400,
    y: 380,
    size: 90,
    ecc: 'M',
    backing: true,
    showText: false,
  },

  /* How it is printed. 190 mm across, four to a sheet of A4. */
  sheet: {
    widthMM: 190,
    perPage: 4,
    gapMM: 4,
    marginMM: 10,
    cutlines: true,
  },

  /* The picture a buyer is sent. Phase 4 draws it; the settings live here. */
  digital: { widthPx: 1200, quality: 0.92 },
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Deep merge of plain objects; arrays and scalars from `over` win outright. */
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v
  return out
}

/** Every key whose value is a length in artwork pixels, and so scales. */
const SCALED = {
  main: { label: ['left', 'right', 'capTop', 'baseline'], own: ['capHeight', 'clearRight', 'clearBelow'] },
  stub: { label: ['left', 'right', 'capTop', 'baseline'], own: ['capHeight', 'clearRight', 'clearBelow'] },
  qrMain: { own: ['x', 'y', 'size'] },
  qrStub: { own: ['x', 'y', 'size'] },
}

/*
 * Scale the measured defaults to the artwork that was actually uploaded.
 *
 * Rounded to whole pixels, because these are pixel positions in a raster and a
 * baseline at 146.3 is a baseline at 146 with a misleading decimal on it. The
 * drawing code works in fractional units anyway once the SVG scales.
 */
function scaleDefaults(factor) {
  if (!(factor > 0) || factor === 1) return DEFAULT_DESIGN
  const out = { ...DEFAULT_DESIGN }
  for (const [section, spec] of Object.entries(SCALED)) {
    const src = DEFAULT_DESIGN[section]
    const next = { ...src }
    for (const k of spec.own ?? []) next[k] = Math.round(src[k] * factor)
    if (spec.label) {
      next.label = { ...src.label }
      for (const k of spec.label) next.label[k] = Math.round(src.label[k] * factor)
    }
    out[section] = next
  }
  return out
}

/**
 * The design to draw this artwork with.
 *
 * The defaults, scaled to the artwork's size, with whatever the organiser saved
 * for THIS artwork merged over the top. A template that has never been opened
 * on the design screen therefore still draws correctly, which is the whole
 * point: upload the ticket, print the ticket.
 */
export function designFor(template) {
  const width = Number(template?.width ?? 0) || REFERENCE.width
  const height = Number(template?.height ?? 0) || REFERENCE.height
  const base = scaleDefaults(width / REFERENCE.width)
  const saved = isObj(template?.design) ? template.design : {}
  return { ...merge(base, saved), artwork: { width, height } }
}

/*
 * Is this design drawable?
 *
 * Checks the things that would put a number somewhere nobody can read it: a
 * measurement that is not a number, a slot whose number would start past the
 * edge it must stop before, or anything outside the picture. Returns a list of
 * sentences, empty when it is fine — a list rather than a throw, because the
 * design screen shows all of them at once beside the fields that caused them.
 */
export function validateDesign(design, artwork) {
  const problems = []
  const width = Number(artwork?.width ?? design?.artwork?.width ?? REFERENCE.width)
  const height = Number(artwork?.height ?? design?.artwork?.height ?? REFERENCE.height)
  const finite = (v) => typeof v === 'number' && Number.isFinite(v)

  for (const half of ['main', 'stub']) {
    const slot = design?.[half]
    if (!slot) { problems.push(`The ${half} half has no measurements.`); continue }
    const L = slot.label ?? {}
    if (![L.left, L.right, L.capTop, L.baseline, slot.capHeight, slot.clearRight].every(finite)) {
      problems.push(`The ${half} half has a measurement that is not a number.`)
      continue
    }
    if (slot.capHeight <= 0) problems.push(`The ${half} half's number has no height.`)
    if (L.right >= slot.clearRight) {
      problems.push(`On the ${half} half the number starts at ${Math.round(L.right)} and must stop ` +
        `before ${Math.round(slot.clearRight)}, so there is no room for it.`)
    }
    if (L.baseline > height || L.capTop < 0) {
      problems.push(`The ${half} half's number is outside the picture.`)
    }
  }

  for (const [name, box] of [['main', design?.qrMain], ['stub', design?.qrStub]]) {
    if (!box?.enabled) continue
    if (![box.x, box.y, box.size].every(finite) || box.size <= 0) {
      problems.push(`The ${name} QR box has a measurement that is not a number.`)
      continue
    }
    if (box.x < 0 || box.y < 0 || box.x + box.size > width || box.y + box.size > height) {
      problems.push(`The ${name} QR box is outside the picture.`)
    }
  }

  const sheet = design?.sheet ?? {}
  if (!(Number(sheet.widthMM) > 0)) problems.push('The printed width must be a number of millimetres above nought.')
  if (!(Number(sheet.perPage) >= 1)) problems.push('There must be at least one ticket to a page.')

  return problems
}
