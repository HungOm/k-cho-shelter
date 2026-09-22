/*
 * ALIGNING, SPACING AND STACKING — the arithmetic, with nothing on screen.
 *
 * The studio has had drag, resize, snap, a grid and rulers since it was built,
 * and none of the tools that arrange what is already there: no align, no
 * distribute, no order, no duplicate. That is the gap between a canvas you can
 * push things around on and a design tool, and it is the whole of this file.
 *
 * WHY IT IS A LIBRARY AND NOT TWO METHODS ON TWO SCREENS. The printed ticket
 * and the digital card keep different models — `ticketelements.js` has a
 * `source` and an `overflow`, `cardelements.js` has a `role` and a `locked` —
 * but both hold position the same way, as `{left, top, width, height}` in
 * SHARES of the artboard, 0 to 1. Every operation here is arithmetic on that
 * one shape, so it serves both tabs and neither owns it. Two copies of this
 * would agree on the day they were written; the first time somebody fixed a
 * rounding rule in one, a card and a ticket would start disagreeing about what
 * "centre" means.
 *
 * NOTHING HERE MUTATES AND NOTHING HERE THROWS. Every function takes boxes and
 * returns new boxes. That is not tidiness: the undo stack in both tabs records
 * one entry per gesture by snapshotting before the change, so an operation that
 * edited in place would be recorded as having already happened. And these run
 * from a toolbar somebody is clicking, so a bad input has to produce an
 * unchanged box rather than a broken screen — the same contract `ladderFrom`
 * and `parseLayout` carry for the same reason.
 */

/** Shares, and only ever shares. Anything unusable reads as zero. */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/* Six decimal places is the precision the card layout stores at, and matching
   it here means an aligned box round-trips through storage unchanged rather
   than drifting by a millionth every time somebody opens the screen. */
const tidy = (n) => Math.round(n * 1e6) / 1e6

const boxOf = (b) => ({
  left: num(b?.left),
  top: num(b?.top),
  width: Math.max(0, num(b?.width)),
  height: Math.max(0, num(b?.height)),
})

/**
 * The rectangle a set of boxes sits inside.
 *
 * Used for two different jobs and it is worth knowing which, because they look
 * the same and are not: aligning SEVERAL things uses this, and aligning ONE
 * thing uses the artboard instead. Aligning a single box to its own bounds
 * moves it nowhere, which reads on screen as a broken button.
 */
export function boundsOf(boxes) {
  const list = (boxes || []).map(boxOf)
  if (!list.length) return null
  const left = Math.min(...list.map((b) => b.left))
  const top = Math.min(...list.map((b) => b.top))
  const right = Math.max(...list.map((b) => b.left + b.width))
  const bottom = Math.max(...list.map((b) => b.top + b.height))
  return { left, top, width: right - left, height: bottom - top }
}

/*
 * THE SIX EDGES, and `centre` is spelled the way ticketelements.js spells it.
 * That file's ALIGN is left/centre/right for text inside a box; these are the
 * same three words for a box inside something else, plus the vertical three.
 * One spelling of one word across the app, because the alternative is a screen
 * where "center" and "centre" both appear and neither is wrong.
 */
export const EDGES = ['left', 'centre', 'right', 'top', 'middle', 'bottom']

const VERTICAL = new Set(['top', 'middle', 'bottom'])

/**
 * Put every box against one edge of `within`.
 *
 * `within` is the artboard for a single selection and the selection's own
 * bounds for several — the caller decides, because only the caller knows how
 * many are selected and this file would have to guess.
 *
 * An unknown edge returns the boxes unchanged rather than picking one. A
 * toolbar that silently did something else when a name was misspelled is worse
 * than one that does nothing: the second is a bug somebody reports, the first
 * is a layout somebody has to undo without knowing what happened.
 */
export function alignBoxes(boxes, edge, within) {
  const list = (boxes || []).map(boxOf)
  if (!list.length || !EDGES.includes(edge) || !within) return list
  const w = boxOf(within)

  return list.map((b) => {
    if (VERTICAL.has(edge)) {
      const top = edge === 'top' ? w.top
        : edge === 'bottom' ? w.top + w.height - b.height
          : w.top + (w.height - b.height) / 2
      return { ...b, top: tidy(top) }
    }
    const left = edge === 'left' ? w.left
      : edge === 'right' ? w.left + w.width - b.width
        : w.left + (w.width - b.width) / 2
    return { ...b, left: tidy(left) }
  })
}

/**
 * Equal GAPS between boxes, not equal centres.
 *
 * The distinction is the whole of this function and it is the one people get
 * wrong. Spacing centres evenly leaves a wide box crowding its neighbours and
 * a narrow one marooned; spacing the gaps evenly is what the eye reads as
 * "evenly spaced", and it is what every design tool means by distribute.
 *
 * THE OUTERMOST TWO DO NOT MOVE. They define the run being shared out. Moving
 * them would change the extent of the selection as well as its spacing, which
 * is two operations wearing one button.
 *
 * Fewer than three boxes is returned unchanged, and that is not a refusal —
 * with two there is exactly one gap and it is already even. The caller shows
 * the control disabled with that as its reason rather than letting somebody
 * press a button that cannot do anything.
 */
export function distributeBoxes(boxes, axis) {
  const list = (boxes || []).map(boxOf)
  if (list.length < 3 || (axis !== 'across' && axis !== 'down')) return list

  const down = axis === 'down'
  const start = (b) => (down ? b.top : b.left)
  const span = (b) => (down ? b.height : b.width)

  /* Sorted for the arithmetic and put back in the caller's order afterwards:
     a distribute that also reordered the list would silently change z-order,
     which is a different tool on the same toolbar. */
  const order = list.map((b, i) => i).sort((a, b) => start(list[a]) - start(list[b]))
  const sorted = order.map((i) => list[i])

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const run = (start(last) + span(last)) - start(first)
  const filled = sorted.reduce((sum, b) => sum + span(b), 0)
  const gap = (run - filled) / (sorted.length - 1)

  const out = list.slice()
  let at = start(first)
  sorted.forEach((b, i) => {
    const placed = i === 0 ? start(first)
      : i === sorted.length - 1 ? start(last)
        : at
    out[order[i]] = down ? { ...b, top: tidy(placed) } : { ...b, left: tidy(placed) }
    at = placed + span(b) + gap
  })
  return out
}

/*
 * STACKING ORDER IS ARRAY ORDER, and later is on top.
 *
 * Both renderers draw the list front to back in the order they are given, so
 * "bring forward" is "move one place later". That is stated here because it is
 * the opposite of how the LAYER LIST reads it — a layer list shows the topmost
 * thing at the top, so it renders the array reversed, and somebody reasoning
 * from the list will get the direction backwards every time.
 */
export const ORDER_MOVES = ['forward', 'backward', 'front', 'back']

/**
 * Move the named ids one step, or all the way, through the stack.
 *
 * Returns a new array of ids in their new order; the caller maps that back to
 * its own objects. Ids it has never heard of are ignored rather than appended,
 * because an id that is not in the list is a bug somewhere else and inventing a
 * position for it would hide that.
 *
 * MOVING SEVERAL AT ONCE KEEPS THEM IN THEIR OWN ORDER. Selecting three things
 * and pressing "bring to front" should not shuffle them relative to each other,
 * which is what a naive per-item loop does — each one jumps over the ones that
 * have already moved.
 */
export function orderMoved(ids, moving, move) {
  const all = (ids || []).map(String)
  const set = new Set((moving || []).map(String).filter((id) => all.includes(id)))
  if (!set.size || !ORDER_MOVES.includes(move)) return all

  const kept = all.filter((id) => !set.has(id))
  const taken = all.filter((id) => set.has(id))

  if (move === 'front') return [...kept, ...taken]
  if (move === 'back') return [...taken, ...kept]

  /*
   * ONE STEP, AND THE STEP IS OVER THE NEXT THING THAT IS NOT MOVING. Stepping
   * over the next INDEX makes a contiguous run of selected items shuffle within
   * itself and never leave, which looks exactly like a button that does nothing
   * — it is doing something, to the wrong pair.
   */
  const out = all.slice()
  const idxs = out.map((id, i) => [id, i]).filter(([id]) => set.has(id)).map(([, i]) => i)
  const step = move === 'forward' ? 1 : -1
  const sweep = move === 'forward' ? idxs.slice().reverse() : idxs

  for (const i of sweep) {
    let j = i + step
    while (j >= 0 && j < out.length && set.has(out[j])) j += step
    if (j < 0 || j >= out.length) continue
    const [moved] = out.splice(i, 1)
    out.splice(j, 0, moved)
  }
  return out
}

/**
 * A copy, offset so it is visibly a copy.
 *
 * Nudged down and right by a fixed share rather than dropped exactly on top:
 * a duplicate that lands perfectly behind its original reads as nothing having
 * happened, and somebody presses it four more times before dragging a stack of
 * five apart.
 *
 * CLAMPED TO STAY ON THE ARTBOARD. A copy of something already at the bottom
 * right would otherwise be created off the edge, where it is selected,
 * undeletable by clicking, and invisible.
 */
export const NUDGE = 0.02

export function offsetBox(box, by = NUDGE) {
  const b = boxOf(box)
  const room = (at, size) => Math.max(0, Math.min(at + by, 1 - size))
  return {
    ...b,
    left: tidy(b.width >= 1 ? b.left : room(b.left, b.width)),
    top: tidy(b.height >= 1 ? b.top : room(b.top, b.height)),
  }
}
