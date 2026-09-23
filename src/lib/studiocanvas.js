/*
 * WHAT THE CANVAS SHOWS WHILE SOMETHING MOVES — snapping that says what it
 * caught, and a ruler that measures the paper.
 *
 * The studio snapped a dragged box to other boxes' edges and to a 2 mm grid,
 * and showed nothing when it did. A box jumping two pixels sideways with no
 * line to say why reads as the pointer being unreliable; the same jump with a
 * hairline drawn to the edge it caught reads as the tool helping. And it
 * snapped only to EDGES, so centring a line of type under a heading meant
 * reading two percentages and doing the arithmetic.
 *
 * The ruler measured shares — 0, 25%, 50%, 75% — which is what is stored but
 * not what a print shop, a ruler on a desk or a guillotine speaks. It now reads
 * millimetres along both sides, with tick spacing chosen for the zoom.
 *
 * PURE, IN SHARES, and nothing here knows about a pointer.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/*
 * How close, in shares of the artboard, a value must come to a candidate to be
 * caught. The same distance at every zoom — about three quarters of a
 * millimetre across a 190 mm ticket — which is what the shell's own snapping
 * has always used.
 */
export const SNAP = 0.004

/**
 * The lines a moving box may snap to, as positions across (`xs`) and down
 * (`ys`): every other visible thing's two edges AND its centre, the artboard's
 * edges and centre, and — across only — where the stub begins.
 *
 * `moving` is every id travelling with the drag: a group dragged together must
 * not snap to its own members, whose edges move as it moves.
 */
export function snapEdges(things, moving, { stubAt = null } = {}) {
  const skip = moving instanceof Set ? moving : new Set([].concat(moving || []))
  const xs = [0, 0.5, 1]
  const ys = [0, 0.5, 1]
  if (stubAt !== null && Number.isFinite(Number(stubAt))) xs.push(Number(stubAt))
  for (const t of things || []) {
    if (!t?.box || skip.has(t.id) || t.enabled === false) continue
    const l = num(t.box.left), w = num(t.box.width), top = num(t.box.top), h = num(t.box.height)
    xs.push(l, l + w / 2, l + w)
    ys.push(top, top + h / 2, top + h)
  }
  return { xs, ys }
}

/**
 * Snap one value, and say what caught it.
 *
 * Nearest wins between a candidate line and the grid — neither has precedence,
 * so a box dragged past an edge that happens to sit half a grid step away lands
 * on whichever it is actually closer to. `hit` is the line that caught it, so
 * a guide can be drawn there; a grid catch is reported as `grid` and draws no
 * guide, because the grid is already on screen.
 */
export function snapNear(value, candidates, step = 0, threshold = SNAP) {
  const v = num(value)
  let best = v
  let dist = threshold
  let hit = null
  let grid = false
  for (const c of candidates || []) {
    const d = Math.abs(num(c) - v)
    if (d < dist) { dist = d; best = num(c); hit = num(c); grid = false }
  }
  if (step > 0) {
    const g = Math.round(v / step) * step
    const d = Math.abs(g - v)
    if (d < dist) { best = g; hit = null; grid = true }
  }
  return { value: best, hit, grid }
}

/**
 * Snap a box along one axis by whichever of its three lines — leading edge,
 * centre, trailing edge — comes nearest to something. Returns the new leading
 * edge and the line that caught, or `hit: null` when nothing did.
 *
 * The leading edge used to be the only line that snapped, then the trailing
 * one; the centre is what makes "centre this under that" a drag instead of a
 * sum.
 */
export function snapSpan(start, size, candidates, step = 0, threshold = SNAP) {
  const s = num(start), w = num(size)
  const tries = [
    { off: 0, r: snapNear(s, candidates, step, threshold) },
    { off: w / 2, r: snapNear(s + w / 2, candidates, 0, threshold) },
    { off: w, r: snapNear(s + w, candidates, step, threshold) },
  ].map((t) => ({ ...t, moved: Math.abs(t.r.value - (s + t.off)), caught: t.r.hit !== null || t.r.grid }))
  const caught = tries.filter((t) => t.caught)
  if (!caught.length) return { start: s, hit: null }
  const best = caught.reduce((a, b) => (b.moved < a.moved ? b : a))
  return { start: best.r.value - best.off, hit: best.r.hit }
}

/*
 * RULER TICKS, in millimetres. The step is the smallest that leaves at least
 * six pixels between ticks at this zoom, and labels go on the smallest step
 * that leaves room for a three-digit number — so a ticket at 35% shows a label
 * every 20 mm and at 200% one every 10, and neither is a smear of digits.
 */
const STEPS = [1, 2, 5, 10, 20, 50, 100]
const LABEL_STEPS = [5, 10, 20, 50, 100, 200]
export const MIN_TICK_PX = 6
export const MIN_LABEL_PX = 40

export function ticksFor(lengthMM, pxPerMM) {
  const L = num(lengthMM), k = num(pxPerMM)
  if (!(L > 0) || !(k > 0)) return []
  const step = STEPS.find((s) => s * k >= MIN_TICK_PX) ?? STEPS[STEPS.length - 1]
  const labelStep = LABEL_STEPS.find((s) => s * k >= MIN_LABEL_PX && s % step === 0)
    ?? LABEL_STEPS[LABEL_STEPS.length - 1]
  const out = []
  for (let mm = 0; mm <= L + 1e-9; mm += step) {
    const at = Math.round(mm * 1e6) / 1e6
    const label = Math.round(at / labelStep) * labelStep === at
    out.push({ mm: at, px: at * k, major: label, label })
  }
  return out
}

/*
 * THE NEXT STEP ON A ZOOM LADDER, FROM WHEREVER THE ZOOM IS.
 *
 * The zoom used to be only ever a rung of the ladder, so "the rung I am on,
 * plus one" was enough. A pinch or ⌘-scroll now leaves it anywhere — 300%,
 * above the top rung, or 41% between two — and "the rung I am on" did not
 * exist: findIndex gave -1, and zoom out from 300% dropped straight to the
 * bottom rung. The next rung is the nearest one strictly beyond the zoom in
 * the direction asked; past either end, the end.
 */
export function nextZoom(ladder, zoom, dir, eps = 1e-6) {
  const z = Number(zoom) || 0
  if (dir > 0) return ladder.find((r) => r > z + eps) ?? ladder[ladder.length - 1]
  return [...ladder].reverse().find((r) => r < z - eps) ?? ladder[0]
}
