/**
 * THE DIGITAL TICKET AS A LIST OF PARTS.
 *
 * The printed ticket has been a list of elements since `ticketelements.js` —
 * an organiser puts a box on the artwork and drags it. The card a buyer is
 * SENT had none of that: `digitalCardSVG` and its two siblings carried about
 * ninety hard-coded coordinates each, so the studio's "Digital ticket" tab
 * could offer a treatment, a motto, and nothing else. Two screens in the same
 * studio, one of which you design and one of which you pick from three.
 *
 * WHY THIS IS NOT `ticketelements.js` AGAIN, which was the first instinct.
 *
 * A printed element is a box with ONE string in it, and the organiser decides
 * what that string is. A card's parts are compositions the card owns: the
 * masthead is a mark, an organisation and an event; the number is a caption
 * and a serial; the facts row is three label-and-value pairs whose count
 * depends on what the raffle knows. Turning those into forty free elements
 * would hand an organiser forty ways to take the card apart and no way to get
 * it back, and it would make "what a buyer receives" a thing nobody could
 * describe without opening the design.
 *
 * So a part is a NAMED, FIXED composition that can be moved, resized, hidden,
 * recoloured and realigned — and cannot be split, duplicated or invented. That
 * is the whole difference from the printed side, and it is deliberate: the
 * printed ticket is somebody's artwork with fields dropped on it, the card is
 * this app's own drawing with the raffle's colour in it.
 *
 * WHAT IS STORED IS ONLY WHAT WAS CHANGED.
 *
 * `standardParts` is the layout below; a saved layout is a SPARSE overlay on
 * it, keyed by treatment and then by part. A raffle that has never opened the
 * tab stores nothing and draws exactly what it drew before this file existed.
 * A raffle that moved the motto stores the motto's box and nothing else, so
 * when a later version moves the fact row or adds a part, that raffle gets the
 * improvement instead of being frozen at the layout it happened to save. The
 * alternative — storing the whole list — is how a card stops improving the
 * first time somebody nudges one line of it.
 *
 * A stored part the code no longer has is IGNORED rather than refused, for the
 * same reason in the other direction: a browser still running the previous
 * bundle must not be able to write a layout the new one throws on.
 *
 * GEOMETRY IS IN PIXELS HERE AND IN SHARES ON THE WIRE. The card is drawn at a
 * fixed pixel size per treatment, so pixels are the natural unit to WRITE the
 * standard in — they are the numbers that came out of the renderers. Shares are
 * what gets stored, because a treatment that is ever redrawn at another size
 * must not take every saved layout with it. `boxOf` is the one conversion.
 */

/*
 * THE THREE SHAPES LIVE HERE AND NOT IN `ticketart.js`, which is where they
 * were and where `import { CARD } from './ticketart.js'` still finds them —
 * that file re-exports these three names, so nothing that already imports them
 * had to change.
 *
 * They moved because of a cycle, and the cycle is worth stating: the renderers
 * ask this file where each part goes, so `ticketart.js` imports
 * `cardelements.js`. If this file then imported the sizes back, whichever of
 * the two a bundle loaded second would read a `const` still in its temporal
 * dead zone and throw at import time — a failure that shows up as a blank
 * screen with one line in the console, and only in the load order the bundler
 * happened to choose. A size is a fact about the shape of a layout, so the
 * file that owns layouts owns it, and the drawing imports it. One direction.
 */
export const CARD = { width: 1200, height: 760 }
export const CARD_CERT = { width: 1200, height: 850 }
export const CARD_STUB = { width: 1080, height: 1920 }

/** The three treatments, by the id `state.cfg.cardDesign` holds. */
export const CARD_SIZES = { grand: CARD, certificate: CARD_CERT, stub: CARD_STUB }

/*
 * WHAT A PART CAN BE ASKED, and what it cannot.
 *
 * `textual` parts take a colour, a lettering and an alignment; a QR and a
 * watermark do not, and offering the controls anyway would be three dead rows
 * in the inspector. `square` keeps a QR square whichever handle is dragged —
 * a stretched QR is an unscannable QR, which is a failure nobody sees until a
 * buyer is standing at the door with a phone.
 *
 * `locked` is the background: it IS the card, so there is nothing to move it
 * relative to. It stays in the list because it is a real part of the drawing
 * and because its row is where the card's colour is explained.
 */

/*
 * px → shares of the card, at FULL precision, which is the opposite of what
 * the printed side does and is deliberate.
 *
 * `ticketelements.js` rounds a stored share to seven places, and rightly: it
 * is a number somebody typed or dragged, on its way to a database. This one is
 * never stored — the standard layout is what a saved layout is measured
 * AGAINST, and only the difference is written down. Rounding it costs the one
 * property it has to have, which is that share → pixel → share lands back on
 * the pixel it started from. Seven places put the certificate's QR 0.000035 px
 * from where it was, `qrLayer` divided that across forty-one modules, and a
 * refactor that changed nothing moved a hundred rectangles by a thousandth.
 */
function boxOf(size, [x, y, w, h]) {
  return { left: x / size.width, top: y / size.height, width: w / size.width, height: h / size.height }
}

/*
 * THE STANDARD LAYOUT OF EACH TREATMENT, lifted out of the renderers.
 *
 * Every box here is the bounding box the renderer already drew that part in,
 * read off the coordinates that were in `ticketart.js`. That is why there is a
 * golden test beside this file: the standard layout must reproduce the old
 * cards to the character, or this change is a redesign of what every buyer has
 * already been sent, wearing a refactor's clothes.
 *
 * `what` is the line under the part's name in the inspector. It says where the
 * part is on the card rather than repeating the name, because "Motto — text"
 * tells a reader nothing they cannot see and "below the tear line" tells them
 * which of the two halves they are about to move something out of.
 */
const PARTS = {
  grand: [
    { id: 'background', name: 'Background', kind: 'paper', what: 'the card itself',
      px: [0, 0, 1200, 760], locked: true },
    { id: 'watermark', role: 'ink', name: 'Watermark', kind: 'design', what: 'the faint ticket, behind everything',
      px: [840, 330, 430, 387], opacity: 0.05 },
    { id: 'masthead', role: 'ink', name: 'Logo mark', kind: 'image', what: 'who issued it, top left',
      px: [64, 52, 600, 76], textual: true, weight: 'bold' },
    { id: 'status', role: 'gold', name: 'Sold chip', kind: 'label', what: 'top right',
      px: [968, 56, 168, 52] },
    /*
     * 760 WIDE, NOT 420, AND A SINGLE TICKET CANNOT TELL.
     *
     * A serial is about 320 px at 76 pt, so 420 was the box drawn round one.
     * A digital ticket covering a whole holding puts a DESCRIPTION here —
     * `Book-0001 / KS-00023 - KS-00025 / AND 5 MORE` — and that box is what
     * decides how much of it gets named rather than counted. At 420 a mixed
     * holding degraded to one book and a number; at 760 it names three parts
     * of itself and still clears the QR at x=884 by forty pixels.
     *
     * Invisible on a single ticket: this part is left-aligned, so its text
     * hangs off `box.left` and the width is only the measure — which is why
     * the golden renders in tests/cardlayout did not move.
     */
    { id: 'number', role: 'gold', name: 'Ticket number', kind: 'ticket', what: 'the largest thing on the card',
      px: [64, 196, 760, 124], textual: true, family: 'number', weight: 'bold' },
    { id: 'buyer', role: 'ink', name: 'Buyer name', kind: 'name', what: 'whose ticket this is',
      px: [64, 356, 560, 130], textual: true, weight: 'bold' },
    { id: 'facts', role: 'ink', name: 'Price & book', kind: 'money', what: 'three facts on one line',
      px: [64, 496, 672, 88], textual: true },
    { id: 'code', role: 'ink', name: 'Check code', kind: 'code', what: 'the QR a door scans',
      px: [884, 250, 236, 236], square: true },
    { id: 'motto', role: 'gold', name: 'Motto', kind: 'type', what: 'below the tear line',
      px: [64, 634, 760, 40], textual: true, family: 'number', italic: true },
    { id: 'footer', role: 'ink', name: 'Thanks & link', kind: 'type', what: 'the last two lines',
      px: [64, 672, 900, 74], textual: true },
  ],
  certificate: [
    { id: 'background', name: 'Background', kind: 'paper', what: 'stock and the double rule',
      px: [0, 0, 1200, 850], locked: true },
    { id: 'masthead', role: 'quiet', name: 'Logo mark', kind: 'image', what: 'the organisation, centred',
      px: [300, 122, 600, 92], textual: true, align: 'centre' },
    { id: 'number', role: 'ink', name: 'Ticket number', kind: 'ticket', what: 'under the word TICKET',
      px: [300, 226, 600, 134], textual: true, align: 'centre', family: 'number', weight: 'bold' },
    { id: 'buyer', role: 'ink', name: 'Buyer name', kind: 'name', what: 'under the rule',
      px: [300, 396, 600, 126], textual: true, align: 'centre' },
    { id: 'price', role: 'quiet', name: 'Price', kind: 'money', what: 'what was paid',
      px: [300, 508, 600, 60], textual: true, align: 'centre', family: 'number' },
    { id: 'motto', role: 'quiet', name: 'Motto', kind: 'type', what: 'above the seal',
      px: [300, 598, 600, 34], textual: true, align: 'centre', italic: true },
    { id: 'code', role: 'ink', name: 'Check code', kind: 'code', what: 'bottom left',
      px: [96, 582, 172, 172], square: true },
    { id: 'seal', role: 'hair', name: 'Seal', kind: 'image', what: 'bottom right, where a stamp goes',
      px: [934, 596, 152, 152] },
  ],
  stub: [
    { id: 'background', name: 'Background', kind: 'paper', what: 'the card and its two rules',
      px: [0, 0, 1080, 1920], locked: true },
    { id: 'watermark', role: 'ink', name: 'Watermark', kind: 'design', what: 'the faint ticket, behind everything',
      px: [190, 780, 600, 540], opacity: 0.055 },
    { id: 'masthead', role: 'ink', name: 'Logo mark', kind: 'image', what: 'who issued it, top left',
      px: [72, 72, 700, 84], textual: true, weight: 'bold' },
    { id: 'status', role: 'gold', name: 'Sold chip', kind: 'label', what: 'top right',
      px: [848, 82, 160, 52] },
    { id: 'number', role: 'gold', name: 'Ticket number', kind: 'ticket', what: 'what this treatment leads with',
      px: [72, 374, 800, 186], textual: true, family: 'number', weight: 'bold' },
    { id: 'facts', role: 'ink', name: 'Buyer, price & book', kind: 'money', what: 'one line under the number',
      px: [72, 626, 900, 100], textual: true },
    { id: 'code', role: 'ink', name: 'Check code', kind: 'code', what: 'centred, held up to be scanned',
      px: [370, 900, 340, 340], square: true },
    { id: 'motto', role: 'gold', name: 'Motto', kind: 'type', what: 'below the lower rule',
      px: [72, 1456, 900, 44], textual: true, family: 'number', italic: true },
    { id: 'footer', role: 'ink', name: 'Thanks & link', kind: 'type', what: 'the last two lines',
      px: [72, 1526, 900, 340], textual: true },
  ],
}

/** The treatments this file knows how to lay out, in the order the rail shows. */
export const CARD_TREATMENTS = Object.keys(PARTS)

/*
 * WHAT AN UNEDITED PART IS. Every field is present and named, so nothing in
 * this system has to ask "is this undefined because it is standard or because
 * somebody has not saved yet" — the question that makes sparse storage go
 * wrong. Sparseness lives on the WIRE; in memory a part is always whole.
 *
 * `ink: ''` is the important one. Empty means "whatever colour the card prints
 * this part in", which is computed from the raffle's brand colour and is not a
 * value this file could name without pinning the card to one palette. A hex
 * overrides it. See `name-tokens-for-the-role`: the role is the default, the
 * value is the exception.
 */
export function standardParts(treatment) {
  const size = CARD_SIZES[treatment]
  const list = PARTS[treatment]
  if (!size || !list) return []
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    what: p.what,
    locked: !!p.locked,
    square: !!p.square,
    textual: !!p.textual,
    italic: !!p.italic,
    /*
     * WHICH OF THE CARD'S OWN COLOURS THIS PART IS PRINTED IN when nobody has
     * set one — `gold`, `ink`, `quiet` or `hair`, the names `cardPalette`
     * returns. Not a colour: the values depend on the raffle's brand and are
     * worked out, so storing one here would pin every raffle to this one's.
     * The inspector reads it so its swatch shows the colour actually on the
     * card rather than a plausible white.
     */
    role: p.role || 'ink',
    box: boxOf(size, p.px),
    enabled: true,
    align: p.align || 'left',
    ink: '',
    family: p.family || 'text',
    weight: p.weight || 'regular',
    opacity: typeof p.opacity === 'number' ? p.opacity : 1,
  }))
}

/** Only the fields an organiser can change; everything else is this file's. */
const EDITABLE = ['box', 'enabled', 'align', 'ink', 'family', 'weight', 'opacity']

/**
 * The standard layout with a saved overlay applied.
 *
 * Unknown treatments and unknown part ids in the overlay are skipped, not
 * refused — see the header. A part that is present but malformed keeps its
 * standard value for the field that is wrong rather than for all of them,
 * because one bad number in a box should not silently move a whole card.
 */
export function resolveParts(treatment, layout) {
  const parts = standardParts(treatment)
  const over = layout && typeof layout === 'object' ? layout[treatment] : null
  if (!over || typeof over !== 'object') return parts
  return parts.map((p) => {
    const o = over[p.id]
    if (!o || typeof o !== 'object') return p
    const out = { ...p }
    /*
     * A LOCKED PART TAKES NO GEOMETRY AND NO EYE, whatever is stored for it.
     *
     * The background IS the card: there is nothing behind it to reveal and
     * nothing to move it relative to. The screen already disables both
     * controls, but a stored value has to be refused here as well — the model
     * is what the renderer reads, and a hidden background would be a card
     * drawn as a transparent rectangle in a JPEG, which is a black one.
     */
    if (o.box && typeof o.box === 'object' && !p.locked) {
      const b = { ...p.box }
      for (const k of ['left', 'top', 'width', 'height']) {
        if (Number.isFinite(Number(o.box[k]))) b[k] = Number(o.box[k])
      }
      /* A zero-width box is a part nobody can find again, including whoever
         stored it. The standard size stands in rather than a hidden part. */
      if (b.width > 0.0005 && b.height > 0.0005) out.box = b
    }
    if (typeof o.enabled === 'boolean' && !p.locked) out.enabled = o.enabled
    if (['left', 'centre', 'right'].includes(o.align)) out.align = o.align
    if (typeof o.ink === 'string' && (o.ink === '' || /^#[0-9a-f]{6}$/i.test(o.ink))) out.ink = o.ink
    if (['number', 'text'].includes(o.family)) out.family = o.family
    if (['regular', 'bold'].includes(o.weight)) out.weight = o.weight
    if (Number.isFinite(Number(o.opacity))) out.opacity = Math.max(0, Math.min(1, Number(o.opacity)))
    return out
  })
}

/**
 * The sparse overlay to store, given the parts as they now stand.
 *
 * Only fields that differ from standard survive, and a treatment with nothing
 * changed drops out entirely — so "has this raffle designed its card" is
 * answerable by looking at the stored value rather than by comparing it to a
 * table the server would also have to hold.
 */
export function layoutFrom(treatment, parts, layout = {}) {
  const std = Object.fromEntries(standardParts(treatment).map((p) => [p.id, p]))
  const out = {}
  for (const p of parts) {
    const s = std[p.id]
    if (!s) continue
    const diff = {}
    for (const k of EDITABLE) {
      if (k === 'box') {
        if (JSON.stringify(p.box) !== JSON.stringify(s.box)) diff.box = { ...p.box }
      } else if (p[k] !== s[k]) diff[k] = p[k]
    }
    if (Object.keys(diff).length) out[p.id] = diff
  }
  const rest = { ...(layout && typeof layout === 'object' ? layout : {}) }
  delete rest[treatment]
  return Object.keys(out).length ? { ...rest, [treatment]: out } : rest
}

/*
 * WHERE EACH PART LANDS, in the card's own pixels, for the renderer.
 *
 * `k` IS THE SCALE ITS CONTENTS ARE DRAWN AT, and it is read off a different
 * axis depending on what the part is.
 *
 * A PICTURE FITS ITS BOX — the QR, the seal, the watermark, the sold chip.
 * Whichever axis is tighter decides, which is the same arithmetic as fitting a
 * photograph into a frame without distorting it, and it is why a QR dragged
 * wide stays square instead of becoming unscannable.
 *
 * TYPE IS SIZED BY ITS HEIGHT, and its width is the measure it is aligned in.
 * That is how a text frame behaves everywhere else, and the alternative was
 * tried and is wrong: the motto's standard box is nineteen times as wide as it
 * is tall, so making the lettering twice the size by the fitting rule would
 * have needed a box 1520 px wide on a card 1200 px across. Width does nothing
 * to a left-aligned line, which is true of every layout program there is —
 * it is the thing centre and right are measured against.
 *
 * `x`, `y` and `w` are the BOX, untouched. Alignment is the renderer's to
 * apply, because the two ways to apply it are different: a single line of type
 * takes an SVG text-anchor, and a block of several columns has to be shifted
 * whole. `own` is what the contents measure at this scale, which is what a
 * block shift needs.
 */
export function partBoxes(treatment, layout) {
  const size = CARD_SIZES[treatment]
  const std = Object.fromEntries((PARTS[treatment] || []).map((p) => [p.id, p.px]))
  const out = {}
  if (!size) return out
  /*
   * SIX PLACES, TO PUT A SHARE BACK ON THE PIXEL IT CAME FROM. 96/1200 times
   * 1200 is 96.00000000000001 in a double, and `qrLayer` turns a tail like
   * that into forty-one modules each a thousandth out of place. Nothing on a
   * card is positioned to a millionth of a pixel, so rounding there is free
   * and makes the standard layout exact.
   */
  const tidy = (v) => Math.round(v * 1e6) / 1e6
  for (const p of resolveParts(treatment, layout)) {
    const s = std[p.id]
    const w = tidy(p.box.width * size.width)
    const h = tidy(p.box.height * size.height)
    const k = !s || !(s[2] > 0) || !(s[3] > 0)
      ? 1
      : tidy(p.textual ? h / s[3] : Math.min(w / s[2], h / s[3]))
    out[p.id] = {
      on: p.enabled !== false,
      x: tidy(p.box.left * size.width),
      y: tidy(p.box.top * size.height),
      w,
      h,
      own: s ? tidy(s[2] * k) : w,
      k,
      align: p.align,
      ink: p.ink,
      family: p.family,
      weight: p.weight,
      opacity: p.opacity,
    }
  }
  return out
}

/*
 * WHAT THE SERVER AND THE SCREEN BOTH REFUSE.
 *
 * Returned as sentences rather than thrown, because the screen shows them all
 * at once beside a disabled Save — the same shape `validateDesign` uses on the
 * printed side, and for the same reason: a form that reports its first problem
 * only is a form somebody fixes four times.
 *
 * THE BOUNDS ARE NOT 0 AND 1. The watermark's standard box runs off the right
 * edge of the card on purpose — it is a bleed, and a rule that clamped it to
 * the card would refuse the layout this file ships with. So the limit is what
 * is actually unrecoverable: a part so far out that nobody can drag it back.
 */
export function validateCardLayout(layout) {
  const bad = []
  if (layout == null) return bad
  if (typeof layout !== 'object' || Array.isArray(layout)) {
    return ['The card layout has to be an object keyed by treatment.']
  }
  for (const [treatment, parts] of Object.entries(layout)) {
    if (!CARD_TREATMENTS.includes(treatment)) {
      bad.push(`${treatment} is not one of the treatments (${CARD_TREATMENTS.join(', ')}).`)
      continue
    }
    if (!parts || typeof parts !== 'object' || Array.isArray(parts)) {
      bad.push(`The ${treatment} layout has to be an object keyed by part.`)
      continue
    }
    const known = new Set(standardParts(treatment).map((p) => p.id))
    for (const [id, p] of Object.entries(parts)) {
      /* Unknown ids pass on purpose — an older browser writing a part this
         build has dropped must not be refused. resolveParts ignores them. */
      if (!known.has(id)) continue
      if (!p || typeof p !== 'object') { bad.push(`${treatment}/${id} is not an object.`); continue }
      if (p.box) {
        for (const k of ['left', 'top']) {
          const v = Number(p.box[k])
          if (p.box[k] !== undefined && !(v >= -1 && v <= 2)) {
            bad.push(`${treatment}/${id} is off the card — ${k} is ${p.box[k]}.`)
          }
        }
        for (const k of ['width', 'height']) {
          const v = Number(p.box[k])
          if (p.box[k] !== undefined && !(v > 0.0005 && v <= 3)) {
            bad.push(`${treatment}/${id} has no usable ${k}.`)
          }
        }
      }
      if (p.ink !== undefined && p.ink !== '' && !/^#[0-9a-f]{6}$/i.test(String(p.ink))) {
        bad.push(`${treatment}/${id} has a colour that is not a hex value.`)
      }
      if (p.opacity !== undefined && !(Number(p.opacity) >= 0 && Number(p.opacity) <= 1)) {
        bad.push(`${treatment}/${id} has a strength outside 0 to 1.`)
      }
    }
  }
  return bad
}
