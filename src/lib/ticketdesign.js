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

import { elementsOf, validateElements } from './ticketelements.js'
import { faultsIn } from './designelements.js'

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
   * WHICH BOOK THE TICKET CAME OUT OF, printed beside its number.
   *
   * The ticket number identifies the ticket; the book is what a person is
   * holding. Stubs come back as a book, a seller is handed books, and a
   * counted-in book is reconciled as a book — so a ticket that does not say
   * which one it belongs to has to be looked up before it can be filed.
   *
   * PLACED AFTER THE NUMBER, not at a fixed point. `gap` is in ems of its own
   * size, measured from wherever the ticket number actually ended, so a longer
   * number pushes it along instead of being overprinted by it. It is smaller
   * than the number and in the lighter weight, because it is the secondary
   * fact: somebody reads the ticket number aloud and files by the book.
   */
  book: {
    // The buyer's half has room to the right of the number, so it goes there.
    main: { enabled: true, below: false, gap: 1.1, capHeight: 12, ink: '#FDEFB0', weight: 'regular' },
    /*
     * The stub does not. Its number ends about 45 px before the small roundel,
     * and "Book-0007" needs nearer 70 — so beside the number it would either
     * overprint the logo or be dropped. It goes on its own line underneath
     * instead, where there are 27 px of clear white before the stub's own text
     * begins. `drop` is in ems of its own size, measured down from the ticket
     * number's baseline.
     */
    stub: { enabled: true, below: true, drop: 1.25, capHeight: 9, ink: '#0F490E', weight: 'regular' },
  },

  /*
   * THE BUYER'S DETAILS, WRITTEN ONTO THE STUB'S OWN LINES.
   *
   * The stub is printed with four ruled lines and a Burmese caption beside each
   * — name, phone, address, and who sold it. They exist to be filled in by
   * hand at the desk. For a ticket that is ALREADY recorded as sold, the raffle
   * already knows all four, and printing them saves somebody copying them back
   * out of the app onto paper they will then have to read again.
   *
   * ONLY FOR SOLD TICKETS, AND ONLY WHEN ASKED. A blank book going out to a
   * seller must print blank lines; the server sends no buyer at all unless the
   * caller says `withBuyer`, and then only for tickets it has a sale recorded
   * against. See supabase/functions/api/printing.ts.
   *
   * The rules were measured off the artwork at y 211, 297, 390 and 484, and
   * each caption's right edge decides where its field can start. `baseline`
   * sits a few pixels above the rule, the way handwriting sits on a line
   * rather than through it.
   */
  buyer: {
    enabled: true,
    fields: {
      name:    { enabled: true, x: 1270, baseline: 207, capHeight: 15, maxRight: 1552, ink: '#0F490E' },
      phone:   { enabled: true, x: 1265, baseline: 293, capHeight: 15, maxRight: 1552, ink: '#0F490E' },
      address: { enabled: true, x: 1285, baseline: 386, capHeight: 15, maxRight: 1552, ink: '#0F490E' },
      seller:  { enabled: true, x: 1380, baseline: 480, capHeight: 12, maxRight: 1552, ink: '#0F490E' },
    },
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

  /*
   * WHERE THE STUB BEGINS, as a share of the ticket's width.
   *
   * MEASURED OFF THE ARTWORK, not taken from a drawing of it. The printed
   * perforation is a red dashed rule, and scanning the artwork for the column
   * with the most red pixels finds it at x 1183 of 1600 — 392 of the 517 rows,
   * which is a dashed line and not a coincidence.
   *
   * It was 0.6875 (1100 px) for a day, taken from a mockup rather than from the
   * picture. Eighty-three pixels too far left, which put the boundary THROUGH
   * the QR box at 1025..1147 — so the digital ticket, which cuts the buyer's
   * half here, sent out a picture with half a QR on it, and the sample
   * watermark shaded a strip of the buyer's half as though it were stub. A
   * number that is only ever compared against itself looks right for as long as
   * nothing crosses it.
   *
   * It is not used to cut paper: the artwork already carries the line. It is
   * here because every element belongs to one side of it or the other, and
   * "which half is this on" is what the design screen groups by, what the
   * watermark inks differ across, and where the digital ticket is cropped.
   */
  stubAt: 0.7394,

  /* How it is printed. 190 mm across, four to a sheet of A4. */
  sheet: {
    widthMM: 190,
    perPage: 4,
    gapMM: 4,
    marginMM: 10,
    cutlines: true,
  },

  /*
   * The card a buyer is sent. Only its size and quality live here: what is ON
   * it comes from the organisation — brand colour, logo, name — rather than
   * from this artwork, because a raffle can sell tickets before it has uploaded
   * any. See digitalCardSVG.
   */
  digital: { widthPx: 1200, quality: 0.92 },
}

/**
 * Where the stub begins on this design, as a share of the width.
 *
 * ONE HOME FOR THE QUESTION, because the answer was copied into five places and
 * one of them was wrong for a day. Every caller wrote `design.stubAt ?? 0.6875`
 * with its own clamp, so correcting the measured default in DEFAULT_DESIGN
 * corrected exactly none of them — a design that arrived without the field kept
 * cutting at the old boundary, which on this artwork runs through the QR box.
 *
 * `designFor` always merges the defaults, so in practice the field is present
 * and the fallback is for a design assembled some other way. That is precisely
 * the path nobody exercises and nobody would notice: it does not throw, it
 * quietly cuts in the wrong place.
 */
export function stubShare(design) {
  const v = Number(design?.stubAt)
  if (!Number.isFinite(v)) return DEFAULT_DESIGN.stubAt
  /* 1 is legitimate and means a ticket with no stub at all. */
  return Math.max(0.05, Math.min(1, v))
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

/* The buyer fields are positions on the stub, so all four numbers scale. */
const SCALED_BUYER = ['x', 'baseline', 'capHeight', 'maxRight']

/* The book label's height scales too; its gap is already in ems and does not. */
const SCALED_BOOK = ['capHeight']

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
  out.book = {
    main: { ...DEFAULT_DESIGN.book.main },
    stub: { ...DEFAULT_DESIGN.book.stub },
  }
  for (const half of ['main', 'stub']) {
    for (const k of SCALED_BOOK) out.book[half][k] = Math.round(DEFAULT_DESIGN.book[half][k] * factor)
  }
  out.buyer = { ...DEFAULT_DESIGN.buyer, fields: {} }
  for (const [name, f] of Object.entries(DEFAULT_DESIGN.buyer.fields)) {
    const next = { ...f }
    for (const k of SCALED_BUYER) next[k] = Math.round(f[k] * factor)
    out.buyer.fields[name] = next
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
  const merged = { ...merge(base, saved), artwork: { width, height } }
  /*
   * THE ELEMENT LIST IS ALWAYS PRESENT, even for a design stored before it
   * existed — `elementsOf` derives one from the old fixed slots by the same
   * arithmetic the renderer used, so a template that has never been opened on
   * the new screen draws the identical ticket. The old slots are left in place
   * underneath: they are what the derivation reads, and deleting them would
   * make every stored design unmigratable rather than merely old.
   */
  return { ...merged, elements: elementsOf(merged, merged.artwork) }
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

  /* Whatever the organiser has actually placed. The checks above are about the
   * slots the defaults ship with; this is about the list that replaced them. */
  if (Array.isArray(design?.elements)) problems.push(...validateElements(design.elements, stubShare(design)))


  /*
   * AND THE THINGS SOMEBODY DREW, by the same module the server refuses them
   * with — so the studio says what is wrong BEFORE Save rather than the save
   * coming back refused. `faultsIn` is the one implementation; this is the one
   * call to it on this side of the wall.
   *
   * The code boxes are read off the design's own elements, both halves, so the
   * rule is checked against where the QR is on THIS ticket rather than where a
   * ticket usually has one.
   */
  const codeBoxes = (design?.elements || [])
    .filter((e) => e?.kind === 'code' && e?.enabled !== false)
    .map((e) => e.box)
  problems.push(...faultsIn(design?.decorations, { codeBoxes }))

  return problems
}
