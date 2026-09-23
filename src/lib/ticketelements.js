/*
 * WHAT IS PRINTED ON A TICKET, AS A LIST RATHER THAN AS A FIXED SET OF SLOTS.
 *
 * The design used to name its parts: `main`, `stub`, `book.main`, `buyer.name`
 * and two QR boxes. That is six things the system chose and an organiser could
 * only switch off. A raffle that wanted the price on the ticket, or the draw
 * date, or the word "COMPLIMENTARY" across the stub, had nowhere to put it.
 *
 * So the design now carries `elements`: a list, any length, each one a box
 * drawn on the artwork with something in it. Nothing in it is privileged and
 * nothing is required. Three kinds:
 *
 *   field   a column the register holds — the ticket number, the book, the
 *           buyer's name, the price, the date it sold
 *   text    words the organiser typed, the same on every ticket
 *   code    the QR that proves the ticket is genuine
 *
 * SHARES, NOT PIXELS. Every coordinate is a fraction of the artwork: 0 is its
 * left edge, 1 its right. The old model stored pixels against a 1600-wide
 * reference frame and scaled them on load, which worked but meant the stored
 * numbers were only meaningful next to the frame they were measured in. A
 * share needs no frame. Re-export the artwork at any size and the design is
 * still correct; hand it to a different charity with different artwork and the
 * boxes land in the same relative places rather than off the edge.
 *
 * A BOX'S BOTTOM EDGE IS THE BASELINE. This is the one thing to know before
 * reading the geometry. `top + height` is the line the text sits on, and
 * `height` is the height of its capitals — so a box is not a bounding box in
 * the CSS sense, it is the space the lettering occupies. That keeps SVG's
 * baseline placement, which is what makes a printed number land on the same
 * line as the label beside it, rather than near it.
 */

/*
 * The reference artwork's size, repeated here rather than imported.
 *
 * ticketdesign.js imports this module to build its element list, so importing
 * it back would make a cycle — and the two numbers are only ever a fallback for
 * an artwork whose real size is unknown, which is a case that should not arise.
 * A stale copy of a constant is a smaller problem than an import cycle between
 * the model and its own vocabulary.
 */
const FALLBACK = { width: 1600, height: 517 }

/*
 * WHAT CAN GO IN A FIELD.
 *
 * Everything the register knows about a ticket at the moment it is drawn. The
 * ids are the shape the renderer is handed values in, so adding one here means
 * the print path has to supply it — see `valueFor` at the bottom, which is the
 * single place that turns a source id into the string that gets printed.
 *
 * `numeric` says the value can be measured with the Times advance table, which
 * decides whether it can be shrunk or cut to fit. A ticket number always can.
 * A buyer's name may be in Burmese and so cannot — see FONT vs TEXT_FAMILY in
 * ticketart.js.
 */
export const SOURCES = [
  { id: 'ticket.number', name: 'Ticket number', numeric: true, why: 'The number this ticket is known by' },
  { id: 'book.number', name: 'Book number', numeric: true, why: 'Which book it was torn out of' },
  { id: 'buyer.name', name: "Buyer's name", why: 'Who bought it, once the sale is recorded' },
  { id: 'buyer.phone', name: 'Phone', numeric: true, why: 'The number recorded against the sale' },
  { id: 'buyer.address', name: 'Address', why: 'The app stores this as their area' },
  { id: 'seller', name: 'Sold by', why: 'The seller who handed it over' },
  { id: 'price', name: 'Price', numeric: true, why: 'What this raffle charges a ticket' },
  { id: 'sold.on', name: 'Sold on', why: 'The date the sale was recorded' },
  { id: 'draw.on', name: 'Draw date', why: 'When this raffle is drawn' },
  { id: 'code', name: 'Check code', numeric: true, why: 'The twelve characters behind the QR' },
]

export const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s]))

/** How a value that will not fit is made to fit. */
export const OVERFLOW = [
  { id: 'shrink', name: 'Shrink it', why: 'Reduce the lettering until it fits on one line' },
  { id: 'wrap', name: 'Wrap', why: 'Run on to a second line underneath' },
  { id: 'cut', name: 'Cut', why: 'Stop, and end with a full stop' },
]

export const ALIGN = [
  { id: 'left', name: 'Left' },
  { id: 'centre', name: 'Centre' },
  { id: 'right', name: 'Right' },
]

/*
 * Which font a thing is drawn in.
 *
 * `number` is the Times stack whose advance widths are written down, so
 * anything drawn in it can be measured before it is drawn — which is what lets
 * a serial number be checked against the logo it must not touch.
 * `text` is the Myanmar chain, which cannot be measured here but can render a
 * buyer's name. The distinction is load-bearing, not cosmetic.
 */
/*
 * THE `stack` IS THE FACE THE PICKER RENDERS ITS OWN OPTIONS IN, so choosing a
 * typeface shows the typeface instead of naming it.
 *
 * DUPLICATED FROM ticketart.js, the same way GAP_EM below is, and for the same
 * reason: ticketart already imports THIS file, so importing it back would make
 * the model depend on the thing that draws it. Unlike that one, this pair is
 * pinned — tests/ticketart.test.mjs asserts these two strings are still
 * FONT.family and TEXT_FAMILY, because a picker that previews a face the
 * printer will not use is worse than a picker that shows no face at all.
 */
export const FAMILIES = [
  {
    id: 'number',
    name: 'Times',
    why: 'Measured widths — serial numbers keep their column',
    stack: '"Times New Roman", "Liberation Serif", Tinos, "Nimbus Roman No9 L", Times, serif',
  },
  {
    id: 'text',
    name: 'Padauk',
    why: 'Renders Burmese; widths are left to the browser',
    stack: 'Padauk, "Noto Sans Myanmar", "Myanmar Text", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
]

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0))

/*
 * Shares are stored to SEVEN places, which is more than it looks like it needs.
 *
 * The point is not precision of placement — nobody positions a ticket number to
 * a ten-thousandth of a pixel. It is that converting a stored pixel design into
 * shares and back must land on the same pixel it started from, because the
 * geometry tests check the drawn coordinates against the measured ones to
 * within a thousandth. At five places the round trip is out by up to 0.008 px
 * on a 1600-wide artwork, which is invisible on paper and still fails the test
 * that proves the migration changed nothing. Seven places is 0.0001 px there,
 * and 0.0008 px on artwork four times the size.
 */
const share = (v) => Math.round(clamp01(v) * 1e7) / 1e7

/** A box of shares, clamped and rounded, with a positive extent. */
/**
 * DRAGGING WITH SHIFT HELD, as two pure decisions.
 *
 * A box on a ticket is nearly always meant to be level with something — a
 * line of type, the box above it, the edge of the stub. Moving with a mouse
 * on a preview 15% of actual size puts a serial number a third of a
 * millimetre out of true, which is invisible on screen and obvious on a sheet
 * of forty. Holding shift is how every drawing tool has said "I meant this
 * exactly" for thirty years.
 *
 * Pure, and here rather than in the component, because what they decide is
 * geometry and the thing worth testing is the decision and not the pointer.
 */

/** Shift while moving: whichever way you went furthest is the way you meant. */
export function lockAxis(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy]
}

/**
 * Shift while resizing: keep the shape the box already had.
 *
 * The WIDTH leads, because these boxes are overwhelmingly wider than they are
 * tall — a serial number, a line of address — so width is the dimension a
 * person is actually dragging. A zero-height box would divide by nothing, so
 * a box with no shape yet keeps whatever height it is given.
 */
export function keepRatio(box, width, height) {
  const w = Number(box?.width) || 0
  const h = Number(box?.height) || 0
  if (!(w > 0 && h > 0)) return { width, height }
  return { width, height: Math.max(0.002, width * (h / w)) }
}

/**
 * WHAT TO CALL AN ELEMENT ON SCREEN.
 *
 * Lives here rather than in a component because two of them ask now — the
 * element list and the inspector — and a name that differs between the list
 * you click and the panel that opens is a name that makes somebody doubt
 * they clicked the right thing.
 *
 * Typed words are quoted so that an empty one still reads as a thing rather
 * than as a blank: "Words you type" is a placeholder, “Sold by” is a value.
 */
export function nameOf(el) {
  if (!el) return ''
  if (el.kind === 'text') return el.text ? `“${el.text}”` : 'Words you type'
  if (el.kind === 'code') return 'Check code'
  return SOURCE[el.source]?.name ?? 'A field'
}

export function normalBox(box) {
  const left = share(box?.left)
  const top = share(box?.top)
  return {
    left,
    top,
    width: share(Math.max(0.001, Number(box?.width) || 0)),
    height: share(Math.max(0.001, Number(box?.height) || 0)),
  }
}

let seq = 0
/* Ids only have to be unique inside one design, and are never shown. */
export const nextId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * One element, with every optional property filled in.
 *
 * Defaulting here rather than at each use means a design written by an older
 * version of this screen — or by hand — draws rather than throwing on a
 * missing `align`.
 */
export function normalElement(raw) {
  const kind = raw?.kind === 'code' || raw?.kind === 'text' ? raw.kind : 'field'
  const src = SOURCE[raw?.source] ? raw.source : (kind === 'field' ? 'ticket.number' : '')
  return {
    id: String(raw?.id || nextId()),
    kind,
    source: kind === 'field' ? src : '',
    text: kind === 'text' ? String(raw?.text ?? '') : '',
    half: raw?.half === 'stub' ? 'stub' : 'main',
    enabled: raw?.enabled !== false,
    /*
     * PINNED — a drag and the arrow keys leave it where it is, and nothing
     * else. The same pin a drawn shape has, and for the same reason: a field
     * measured to the tenth of a millimetre is the thing somebody keeps
     * catching while they work on what sits around it. Not carried into the
     * old fixed slots (legacyFromElements), which have nowhere to put it and
     * are read only by a browser too old to pin anything.
     */
    locked: raw?.locked === true,
    box: normalBox(raw?.box),
    align: ALIGN.some((a) => a.id === raw?.align) ? raw.align : 'left',
    overflow: OVERFLOW.some((o) => o.id === raw?.overflow) ? raw.overflow : 'shrink',
    family: raw?.family === 'text' ? 'text' : (kind === 'field' && !SOURCE[src]?.numeric ? 'text' : 'number'),
    weight: raw?.weight === 'bold' ? 'bold' : 'regular',
    ink: typeof raw?.ink === 'string' && raw.ink ? raw.ink : '#000000',
    /*
     * FLOWING AFTER ANOTHER ELEMENT, instead of sitting at a fixed left edge.
     *
     * The book number is printed beside the ticket number, and it has to move
     * when the ticket number is longer — otherwise a raffle that lengthens its
     * prefix prints the book over the top of its own serial. `after` names the
     * element to start from and `gap` is the distance in ems of this element's
     * own size. Absent means the box's own left edge is used, which is what
     * almost everything does.
     */
    after: raw?.after ? String(raw.after) : '',
    gap: Number.isFinite(Number(raw?.gap)) ? Number(raw.gap) : 1.1,
    /* code only */
    ecc: ['L', 'M', 'Q', 'H'].includes(raw?.ecc) ? raw.ecc : 'M',
    backing: raw?.backing !== false,
  }
}

/* ---------- turning the old fixed slots into elements ---------- */

/*
 * THE MIGRATION, AND WHY IT IS ARITHMETIC RATHER THAN A TABLE OF NEW NUMBERS.
 *
 * Every design already saved — including the one CEAM is printing from — is in
 * the old shape. Retyping its positions as shares would be a second set of
 * measurements to get wrong, and the first ticket printed after the change
 * would be the proof. So the boxes are COMPUTED from the old numbers by the
 * same arithmetic the renderer used, which means a migrated design draws the
 * identical ticket rather than a similar one.
 *
 * For a number slot the old model said: start a gap past the label, stop a
 * clearance before the logo. Both distances are in ems of the number's own
 * size, so both are known once capHeight is. The box is exactly that span.
 */

/* Matches SPACING in ticketart.js. Duplicated deliberately: importing the
 * renderer here would make the model depend on the thing that draws it. */
const GAP_EM = 0.45
const CLEAR_EM = 0.4
const DIGIT_HEIGHT = 0.676

function numberBox(slot, W, H) {
  const capHeight = Number(slot?.capHeight) || 0
  const fontSize = capHeight / DIGIT_HEIGHT
  const x = Number(slot?.label?.right ?? 0) + GAP_EM * fontSize
  const limit = Number(slot?.clearRight ?? 0) - CLEAR_EM * fontSize
  const baseline = Number(slot?.label?.baseline ?? 0)
  return normalBox({
    left: x / W,
    top: (baseline - capHeight) / H,
    width: Math.max(1, limit - x) / W,
    height: capHeight / H,
  })
}

/*
 * The book label. Beside the number it FLOWS — see `after` above — so its box
 * only has to say how tall it is and where it may stop; its left edge comes
 * from wherever the number actually ended. Underneath the number it is at a
 * fixed offset already, so it converts to a plain box.
 */
function bookElement(design, half, W, H, numberId) {
  const box = design?.book?.[half]
  const slot = design?.[half]
  if (!box || !slot) return null
  const capHeight = Number(box.capHeight) || 9
  const below = box.below === true
  const fontSize = capHeight / DIGIT_HEIGHT
  const numberBaseline = Number(slot.label?.baseline ?? 0)

  if (below) {
    const baseline = numberBaseline + Number(box.drop ?? 1.25) * fontSize
    const left = Number(slot.label?.right ?? 0) + GAP_EM * (Number(slot.capHeight) / DIGIT_HEIGHT)
    return normalElement({
      id: `book-${half}`,
      kind: 'field',
      source: 'book.number',
      half,
      enabled: box.enabled !== false,
      box: {
        left: left / W,
        top: (baseline - capHeight) / H,
        width: Math.max(1, Number(slot.clearRight ?? W) - left) / W,
        height: capHeight / H,
      },
      ink: box.ink ?? slot.ink,
      weight: box.weight ?? 'regular',
      overflow: 'shrink',
    })
  }

  return normalElement({
    id: `book-${half}`,
    kind: 'field',
    source: 'book.number',
    half,
    enabled: box.enabled !== false,
    /* Its left edge is supplied by the flow; the box still carries the height
     * it is drawn at and the point it must stop before. */
    box: {
      left: Number(slot.label?.right ?? 0) / W,
      top: (numberBaseline - capHeight) / H,
      width: Math.max(1, Number(slot.clearRight ?? W) - Number(slot.label?.right ?? 0)) / W,
      height: capHeight / H,
    },
    ink: box.ink ?? slot.ink,
    weight: box.weight ?? 'regular',
    after: numberId,
    gap: Number(box.gap ?? 1.1),
    overflow: 'shrink',
  })
}

/**
 * The element list for a design that has not got one.
 *
 * Reads the old fixed slots and produces the same ticket. Called by
 * `designFor`, so nothing downstream has to know which shape a stored design
 * was written in.
 */
export function elementsFromLegacy(design, artwork) {
  const W = Number(artwork?.width ?? design?.artwork?.width ?? FALLBACK.width) || FALLBACK.width
  const H = Number(artwork?.height ?? design?.artwork?.height ?? FALLBACK.height) || FALLBACK.height
  const out = []

  for (const half of ['main', 'stub']) {
    const slot = design?.[half]
    if (!slot?.label) continue
    const id = `number-${half}`
    out.push(normalElement({
      id,
      kind: 'field',
      source: 'ticket.number',
      half,
      box: numberBox(slot, W, H),
      ink: slot.ink,
      weight: slot.weight ?? 'bold',
      family: 'number',
      overflow: 'shrink',
    }))
    const book = bookElement(design, half, W, H, id)
    if (book) out.push(book)
  }

  /*
   * The QR boxes. A code is square and its box is its whole extent, so unlike
   * text its height is a real height rather than a cap height.
   */
  for (const [key, half] of [['qrMain', 'main'], ['qrStub', 'stub']]) {
    const q = design?.[key]
    if (!q) continue
    out.push(normalElement({
      id: key,
      kind: 'code',
      half,
      enabled: q.enabled !== false,
      box: {
        left: Number(q.x ?? 0) / W,
        top: Number(q.y ?? 0) / H,
        width: Number(q.size ?? 0) / W,
        height: Number(q.size ?? 0) / H,
      },
      ecc: q.ecc,
      backing: q.backing,
    }))
  }

  /* The buyer's four ruled lines, in the order they are printed down the stub. */
  const fields = design?.buyer?.fields ?? {}
  const SOURCE_OF = {
    name: 'buyer.name', phone: 'buyer.phone', address: 'buyer.address', seller: 'seller',
  }
  for (const [key, f] of Object.entries(fields)) {
    const source = SOURCE_OF[key]
    if (!source || !f) continue
    const capHeight = Number(f.capHeight) || 15
    out.push(normalElement({
      id: `buyer-${key}`,
      kind: 'field',
      source,
      half: 'stub',
      /* The buyer section had its own on/off switch above the four fields.
       * An element list has no such tier, so a switched-off section becomes
       * four switched-off elements rather than four missing ones. */
      enabled: design?.buyer?.enabled !== false && f.enabled !== false,
      box: {
        left: Number(f.x ?? 0) / W,
        top: (Number(f.baseline ?? 0) - capHeight) / H,
        width: Math.max(1, Number(f.maxRight ?? 0) - Number(f.x ?? 0)) / W,
        height: capHeight / H,
      },
      ink: f.ink,
      weight: f.weight ?? 'regular',
      family: 'text',
      /* Cut, because that is what placeBuyer did: a name too long for a ruled
       * line was truncated with a full stop. Changing it during a migration
       * would be a design decision smuggled in as a data conversion. */
      overflow: 'cut',
    }))
  }

  return out
}

/**
 * The elements of a design, whichever shape it was stored in.
 *
 * An explicit list wins outright — once a design has been edited on the new
 * screen, the old slots are history and merging them back in would resurrect
 * something the organiser deleted.
 */
export function elementsOf(design, artwork) {
  const raw = design?.elements
  if (Array.isArray(raw)) return raw.map(normalElement)
  return elementsFromLegacy(design, artwork)
}

/*
 * THE VALUE A FIELD PRINTS, from whatever the caller knows about the ticket.
 *
 * One function so that a preview, a printed sheet and a digital ticket cannot
 * disagree about what "sold on" means. Anything missing prints as empty rather
 * than as "undefined" — a stub for a ticket with no address recorded shows the
 * blank line it came with.
 */
export function valueFor(el, values = {}) {
  if (el?.kind === 'text') return String(el.text ?? '')
  const v = values?.[el?.source]
  return v === undefined || v === null ? '' : String(v)
}

/**
 * Is this element list drawable?
 *
 * Returns sentences rather than throwing, so the screen can show every problem
 * at once beside the boxes that caused them.
 */
/*
 * `stubAt` is where the ticket tears, as a share of the width. Passed in rather
 * than imported so this file stays free of ticketdesign.js, which imports from
 * here. Omit it and the perforation check is skipped.
 */
export function validateElements(elements, stubAt) {
  const problems = []
  const seen = new Set()
  const tear = Number(stubAt)
  const tears = Number.isFinite(tear) && tear > 0 && tear < 1
  for (const el of elements ?? []) {
    const name = el.kind === 'text'
      ? `"${el.text || 'empty words'}"`
      : (SOURCE[el.source]?.name ?? (el.kind === 'code' ? 'The check code' : 'A field'))

    if (seen.has(el.id)) problems.push(`Two elements share the id ${el.id}.`)
    seen.add(el.id)

    const b = el.box
    if (![b.left, b.top, b.width, b.height].every((n) => Number.isFinite(n))) {
      problems.push(`${name} has a measurement that is not a number.`)
      continue
    }
    if (b.width <= 0 || b.height <= 0) problems.push(`${name} has a box with no size.`)
    if (b.left + b.width > 1.0001 || b.top + b.height > 1.0001) {
      problems.push(`${name} runs off the edge of the artwork.`)
    }
    /*
     * A BOX THAT SPANS THE TEAR PRINTS ACROSS IT. Half the value goes home with
     * the buyer and half stays in the book, and neither half is readable — the
     * same class of defect as running off the artwork, which is why it sits
     * beside it and blocks the save the same way.
     *
     * Not visible on screen: the perforation is a hairline over artwork, the
     * box is a dashed outline, and at the zoom anybody designs at the overlap
     * is a few pixels. It is arithmetic the screen was asking the designer to
     * do — left 35.3 plus width 34.9 is 70.2, against a tear at 68.8.
     */
    if (tears && b.left < tear - 0.0005 && b.left + b.width > tear + 0.0005) {
      const pc = (v) => `${(v * 100).toFixed(1)}%`
      problems.push(
        `${name} crosses the perforation: it runs from ${pc(b.left)} to ` +
        `${pc(b.left + b.width)} and the ticket tears at ${pc(tear)}, so it would ` +
        'be printed across the tear.')
    }
    if (el.kind === 'text' && !String(el.text ?? '').trim()) {
      problems.push('One element is set to print words, but no words were typed.')
    }
    if (el.after && !(elements ?? []).some((o) => o.id === el.after)) {
      problems.push(`${name} is set to follow an element that is no longer here.`)
    }
  }
  return problems
}

/* ---------- writing the elements back into the old slots ---------- */

/*
 * WHY A DESIGN IS STORED TWICE, AND WHY THAT IS NOT A SECOND SOURCE OF TRUTH.
 *
 * `elementsFromLegacy` above reads the old named slots and produces the list.
 * This goes the other way, and it exists for one narrow reason: the browser is
 * not the only thing that will read a saved design.
 *
 * A design is saved with both shapes in it. An organiser who drags the buyer's
 * name and saves has updated `elements`; the `buyer.fields.name` underneath it
 * still holds where the name used to be. A browser running the PREVIOUS bundle
 * — an organiser who had the app open across a deploy and has not reloaded —
 * knows nothing about elements and draws from those stale slots. It does not
 * fail, which is the problem: it prints a whole run with the name 300 px from
 * where the designer showed it, and the two machines disagree with no error on
 * either.
 *
 * So the old slots are kept in step. They are not consulted once a list exists
 * — `elementsOf` takes the explicit list outright — so this is a projection for
 * older readers, not a second place the truth lives.
 *
 * WHAT IT CANNOT CARRY. An element an organiser ADDED has no slot to go in;
 * an older reader simply will not draw it, which is safe, because drawing less
 * is not the same as drawing something in the wrong place. An element they
 * DELETED is switched off where the old shape has a switch (the book, the
 * buyer's lines, the QR boxes) and left alone where it has none (the two ticket
 * numbers, which the old model treated as always present).
 */
export function legacyFromElements(design) {
  const W = Number(design?.artwork?.width ?? FALLBACK.width) || FALLBACK.width
  const H = Number(design?.artwork?.height ?? FALLBACK.height) || FALLBACK.height
  const list = Array.isArray(design?.elements) ? design.elements : []
  const by = new Map(list.map((e) => [e.id, e]))

  /* Deep-copied, so a caller merging this over a design cannot alias into it. */
  const out = JSON.parse(JSON.stringify({
    main: design?.main ?? {}, stub: design?.stub ?? {},
    book: design?.book ?? {}, buyer: design?.buyer ?? {},
    qrMain: design?.qrMain ?? {}, qrStub: design?.qrStub ?? {},
  }))

  const px = (b) => ({
    x: b.left * W,
    right: (b.left + b.width) * W,
    capHeight: b.height * H,
    baseline: (b.top + b.height) * H,
    top: b.top * H,
  })

  for (const half of ['main', 'stub']) {
    const el = by.get(`number-${half}`)
    const slot = out[half]
    if (!el || !slot?.label) continue
    const m = px(el.box)
    const fontSize = m.capHeight / DIGIT_HEIGHT
    slot.capHeight = Math.round(m.capHeight)
    slot.label.baseline = Math.round(m.baseline)
    slot.label.capTop = Math.round(m.top)
    /* The inverse of numberBox: the number starts a gap past the label and
     * stops a clearance before the logo, both in ems of its own size. */
    slot.label.right = Math.round(m.x - GAP_EM * fontSize)
    slot.clearRight = Math.round(m.right + CLEAR_EM * fontSize)
    if (el.ink) slot.ink = el.ink
    slot.weight = el.weight === 'bold' ? 'bold' : 'regular'

    const bk = by.get(`book-${half}`)
    const box = out.book?.[half]
    if (bk && box) {
      const b = px(bk.box)
      box.enabled = bk.enabled !== false
      box.capHeight = Math.round(b.capHeight)
      box.ink = bk.ink ?? box.ink
      /* It flowed after the number when it carried `after`, and sat on its own
       * line underneath when it did not. */
      box.below = !bk.after
      if (bk.after) {
        box.gap = Number(bk.gap ?? box.gap ?? 1.1)
      } else {
        const fs = b.capHeight / DIGIT_HEIGHT
        box.drop = fs ? Math.round(((b.baseline - m.baseline) / fs) * 100) / 100 : box.drop
      }
    } else if (box) {
      box.enabled = false
    }
  }

  const SOURCE_OF = {
    name: 'buyer.name', phone: 'buyer.phone', address: 'buyer.address', seller: 'seller',
  }
  let anyBuyer = false
  for (const [key, f] of Object.entries(out.buyer?.fields ?? {})) {
    if (!SOURCE_OF[key]) continue
    const el = by.get(`buyer-${key}`)
    if (!el) { f.enabled = false; continue }
    const m = px(el.box)
    f.enabled = el.enabled !== false
    f.x = Math.round(m.x)
    f.baseline = Math.round(m.baseline)
    f.capHeight = Math.round(m.capHeight)
    f.maxRight = Math.round(m.right)
    if (el.ink) f.ink = el.ink
    if (f.enabled) anyBuyer = true
  }
  /* The old shape had a switch above the four lines; the list has no such tier,
   * so it is on when any of them is. */
  if (out.buyer) out.buyer.enabled = anyBuyer

  for (const key of ['qrMain', 'qrStub']) {
    const el = by.get(key)
    const q = out[key]
    if (!q) continue
    if (!el) { q.enabled = false; continue }
    q.enabled = el.enabled !== false
    q.x = Math.round(el.box.left * W)
    q.y = Math.round(el.box.top * H)
    q.size = Math.round(Math.min(el.box.width * W, el.box.height * H))
    q.ecc = el.ecc ?? q.ecc
    q.backing = el.backing !== false
  }

  return out
}
