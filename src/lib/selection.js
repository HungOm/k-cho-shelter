/*
 * WHAT IS SELECTED, AS ARITHMETIC — the marquee and groups, with nothing on
 * screen.
 *
 * The studio could select by clicking, one box at a time with shift held, and
 * in no other way. Twelve buyer lines on a stub are twelve shift-clicks on
 * boxes a few pixels tall at 40% zoom, and every one that misses starts a drag
 * instead. A rubber band — press on empty artboard, drag, release — is how
 * every drawing tool has answered that for thirty years.
 *
 * Groups are the other half: a library shape placed on a ticket is four drawn
 * parts that mean one thing, and a click on any of them should take all four.
 *
 * PURE, IN SHARES, and in the same `{ sel, also }` shape the shell keeps:
 * `sel` is the primary — the one the inspector describes and the handles sit
 * on — and `also` is everything else selected with it.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** The band between where the pointer went down and where it is now. */
export function bandOf(origin, point) {
  const x0 = num(origin?.left), y0 = num(origin?.top)
  const x1 = num(point?.left), y1 = num(point?.top)
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  }
}

/*
 * A band this small was a click, not a drag. In shares of the artboard, so it
 * is the same distance at any zoom — about a millimetre and a half across a
 * 190 mm ticket.
 */
export const CLICK = 0.008
export const isClick = (band) => !band || (num(band.width) < CLICK && num(band.height) < CLICK)

/*
 * TOUCHING, NOT ENCLOSED. A band that has to swallow a box whole misses every
 * field whose box runs past the edge the band was dragged to, and on a ticket
 * those are most of them: the buyer's lines run to the perforation. Touching
 * is what people mean when they drag across a row of fields.
 *
 * A box with no height — a horizontal rule — is still touched when the band
 * crosses its line, which is why the comparisons are inclusive.
 *
 * HIDDEN THINGS ARE NOT HIT. Something switched off in the layer list is not
 * on the ticket, and selecting it by dragging over empty-looking artboard
 * would hand the arrange tools a box nobody can see move. Pinned things ARE
 * hit: a pin refuses a drag, not a selection.
 */
export function hitsIn(things, band) {
  if (!band) return []
  const l = num(band.left), t = num(band.top)
  const r = l + num(band.width), b = t + num(band.height)
  return (things || [])
    .filter((x) => x && x.enabled !== false && x.box)
    .filter((x) => {
      const xl = num(x.box.left), xt = num(x.box.top)
      const xr = xl + num(x.box.width), xb = xt + num(x.box.height)
      return xl <= r && xr >= l && xt <= b && xb >= t
    })
    .map((x) => x.id)
}

/**
 * The ids, plus every drawn shape that shares a group with any of them.
 * Order is kept — the ids first as given, then the group members they pulled
 * in, in draw order — so the primary stays the thing somebody actually hit.
 */
export function expandGroups(ids, decorations) {
  const list = decorations || []
  const want = new Set((ids || []).filter(Boolean))
  const groups = new Set(list.filter((d) => want.has(d.id) && d.group).map((d) => d.group))
  const out = [...want]
  for (const d of list) {
    if (d.group && groups.has(d.group) && !want.has(d.id)) { out.push(d.id); want.add(d.id) }
  }
  return out
}

/**
 * A new selection from what a band hit.
 *
 * Without `add`, the band replaces the selection and its first hit is the
 * primary. With `add` (shift held), the band's hits join what was already
 * selected and the primary does not move — somebody extending a selection is
 * not asking for the inspector to switch to a different box.
 */
export function mergeSelection(current, hits, add = false) {
  const now = [current?.sel, ...(current?.also || [])].filter(Boolean)
  const got = (hits || []).filter(Boolean)
  if (!add) return { sel: got[0] || '', also: got.slice(1) }
  const all = [...now]
  for (const id of got) if (!all.includes(id)) all.push(id)
  return { sel: all[0] || '', also: all.slice(1) }
}

/*
 * DRAWING A BOX WITH THE MODIFIERS EVERY DRAWING PROGRAM USES.
 *
 * Shift keeps the shape regular: a square, a circle, and for a line one of the
 * eight directions — level, upright or at 45°. Alt (⌥) draws out from where
 * the press was, so the press is the middle rather than a corner. Both at once
 * is a regular shape centred on the press.
 *
 * "Square" is square on the SCREEN, not in shares: shares of a 3 : 1 ticket
 * are three times longer across than down, so a box equal in shares is a
 * rectangle. `aspect` is the artboard's width over its height, in pixels.
 */
export function drawBox(origin, point, { square = false, centre = false, aspect = 1, line = false } = {}) {
  const ox = num(origin?.left), oy = num(origin?.top)
  let dx = num(point?.left) - ox
  let dy = num(point?.top) - oy
  const a = aspect > 0 ? aspect : 1
  if (square) {
    const X = Math.abs(dx * a), Y = Math.abs(dy)
    const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1
    const angle = Math.atan2(Y, X) * 180 / Math.PI
    if (line && angle < 22.5) dy = 0
    else if (line && angle > 67.5) dx = 0
    else { const s = Math.max(X, Y); dx = sx * s / a; dy = sy * s }
  }
  if (centre) {
    return { left: ox - Math.abs(dx), top: oy - Math.abs(dy), width: 2 * Math.abs(dx), height: 2 * Math.abs(dy) }
  }
  return bandOf(origin, { left: ox + dx, top: oy + dy })
}

/*
 * RESIZING ABOUT THE CENTRE (⌥ on a handle). Whatever the dragged edge did,
 * the opposite edge does the mirror of it, so the box grows or shrinks around
 * its middle and stays where it was centred. `start` is the box when the drag
 * began and `now` the box the ordinary resize produced; with Shift that box
 * already kept its proportions, and growing both sides equally keeps them.
 */
export function aboutCentre(start, now, least = 0.002) {
  const w = Math.max(least, start.width + 2 * (num(now.width) - start.width))
  const h = Math.max(least, start.height + 2 * (num(now.height) - start.height))
  const cx = start.left + start.width / 2
  const cy = start.top + start.height / 2
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h }
}
