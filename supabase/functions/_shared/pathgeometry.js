/*
 * PATHS — THE ARITHMETIC UNDER THE PEN TOOL.
 *
 * A path is a list of NODES and a flag saying whether it closes. Each node is a
 * point with up to two handles: `h1` pulls the curve arriving at it, `h2` the
 * curve leaving it. A node with no handles is a corner and the segments either
 * side of it are straight; a node with both, lined up, is smooth.
 *
 *   { x, y, hx1?, hy1?, hx2?, hy2? }
 *
 * WHY THIS IS A FILE OF ITS OWN AND NOT A LIBRARY. It runs in three places —
 * the studio in the browser, the Edge Function that refuses a design it will
 * not store, and the tests in plain Node — and it has to be the same arithmetic
 * in all three, or a path drawn on screen could be measured differently where
 * it is saved. Paper.js would do this and more, in about three hundred
 * kilobytes of canvas-bound code that runs in none of the three as they are.
 * What the pen needs is below: some two hundred lines.
 *
 * COORDINATES ARE WHATEVER THEY ARE HANDED IN. The model stores nodes in UNIT
 * space of the path's own box (0–1 across and down), so moving, resizing and
 * aligning a path is arithmetic on its box like every other decoration; the
 * studio works in shares of the artboard while somebody is drawing; the
 * renderer maps to pixels. A cubic curve is unchanged in shape by any of those
 * mappings, which is why one set of functions serves all three.
 *
 * PURE. Nothing here mutates what it is given, and nothing throws.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const has = (v) => v !== undefined && v !== null && Number.isFinite(Number(v))

/** A node with every field a number or absent — never NaN, never a string. */
export function cleanNode(n) {
  const out = { x: num(n?.x), y: num(n?.y) }
  if (has(n?.hx1) && has(n?.hy1)) { out.hx1 = num(n.hx1); out.hy1 = num(n.hy1) }
  if (has(n?.hx2) && has(n?.hy2)) { out.hx2 = num(n.hx2); out.hy2 = num(n.hy2) }
  return out
}

/** The handle a node pulls the curve LEAVING it with, or the node itself. */
const outOf = (n) => (has(n.hx2) ? [n.hx2, n.hy2] : [n.x, n.y])
/** The handle a node pulls the curve ARRIVING at it with, or the node itself. */
const inOf = (n) => (has(n.hx1) ? [n.hx1, n.hy1] : [n.x, n.y])

/**
 * The path as cubic segments: [p0, c1, c2, p3] per pair of neighbouring nodes,
 * plus the closing segment back to the first node when the path is closed.
 * A straight segment is still returned as a cubic, with its controls on its
 * ends, so everything downstream handles one shape of thing.
 */
export function segments(nodes, closed = false) {
  const list = (nodes || []).map(cleanNode)
  const out = []
  const n = list.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last && n > 1; i++) {
    const a = list[i], b = list[(i + 1) % n]
    out.push({ i, straight: !has(a.hx2) && !has(b.hx1), p0: [a.x, a.y], c1: outOf(a), c2: inOf(b), p3: [b.x, b.y] })
  }
  return out
}

/**
 * SVG path data. `map([x, y])` turns a stored point into drawing coordinates —
 * unit-of-box to pixels in the renderer, identity in the tests.
 */
export function pathData(nodes, closed = false, map = (p) => p) {
  const list = (nodes || []).map(cleanNode)
  if (list.length < 2) return ''
  const f = (p) => { const [x, y] = map(p); return `${num(x).toFixed(2)} ${num(y).toFixed(2)}` }
  let d = `M${f([list[0].x, list[0].y])}`
  for (const s of segments(list, closed)) {
    d += s.straight ? ` L${f(s.p3)}` : ` C${f(s.c1)} ${f(s.c2)} ${f(s.p3)}`
  }
  return closed ? `${d} Z` : d
}

/* ---------- where a curve really goes ---------- */

const at = (p0, c1, c2, p3, t) => {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3
}

/* The t in (0, 1) where one coordinate of a cubic turns — the roots of its
   derivative, a quadratic. These are where the curve bulges past its ends. */
function turning(p0, c1, c2, p3) {
  const a = -p0 + 3 * c1 - 3 * c2 + p3
  const b = 2 * (p0 - 2 * c1 + c2)
  const c = c1 - p0
  const ts = []
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const r = Math.sqrt(disc)
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a))
    }
  }
  return ts.filter((t) => t > 0 && t < 1)
}

/**
 * The box the DRAWN path occupies — not the box of its nodes. A smooth curve
 * bulges past the points it passes through, and a box drawn round the nodes
 * alone would cut the bulge off: the selection outline would not surround the
 * shape, and a snap to its edge would snap to where the curve is not.
 */
export function boundsOfPath(nodes, closed = false) {
  const list = (nodes || []).map(cleanNode)
  if (!list.length) return { left: 0, top: 0, width: 0, height: 0 }
  let xs = list.map((n) => n.x), ys = list.map((n) => n.y)
  for (const s of segments(list, closed)) {
    for (const t of turning(s.p0[0], s.c1[0], s.c2[0], s.p3[0])) xs.push(at(s.p0[0], s.c1[0], s.c2[0], s.p3[0], t))
    for (const t of turning(s.p0[1], s.c1[1], s.c2[1], s.p3[1])) ys.push(at(s.p0[1], s.c1[1], s.c2[1], s.p3[1], t))
  }
  const left = Math.min(...xs), top = Math.min(...ys)
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

/* ---------- moving between the artboard and a path's own box ---------- */

const r4 = (v) => Math.round(v * 1e4) / 1e4
const r7 = (v) => Math.round(v * 1e7) / 1e7

/** Nodes in artboard coordinates, from nodes in the unit space of `box`. */
export function fromUnit(nodes, box) {
  const b = { left: num(box?.left), top: num(box?.top), width: num(box?.width), height: num(box?.height) }
  const X = (u) => b.left + u * b.width, Y = (u) => b.top + u * b.height
  return (nodes || []).map(cleanNode).map((n) => {
    const o = { x: X(n.x), y: Y(n.y) }
    if (has(n.hx1)) { o.hx1 = X(n.hx1); o.hy1 = Y(n.hy1) }
    if (has(n.hx2)) { o.hx2 = X(n.hx2); o.hy2 = Y(n.hy2) }
    return o
  })
}

/**
 * THE BOX A PATH NEEDS, and its nodes re-expressed inside it.
 *
 * Called after anything moves a node or a handle, so a node dragged outside the
 * path's box grows the box rather than being drawn outside it. A path with no
 * extent on one axis — a straight horizontal stroke — keeps a zero side, the
 * way a horizontal rule does, and its unit coordinate on that axis is 0.
 */
export function refitPath(nodes, closed = false) {
  const list = (nodes || []).map(cleanNode)
  const b = boundsOfPath(list, closed)
  const U = (v, lo, span) => (span > 1e-9 ? r4((v - lo) / span) : 0)
  const unit = list.map((n) => {
    const o = { x: U(n.x, b.left, b.width), y: U(n.y, b.top, b.height) }
    if (has(n.hx1)) { o.hx1 = U(n.hx1, b.left, b.width); o.hy1 = U(n.hy1, b.top, b.height) }
    if (has(n.hx2)) { o.hx2 = U(n.hx2, b.left, b.width); o.hy2 = U(n.hy2, b.top, b.height) }
    return o
  })
  return { box: { left: r7(b.left), top: r7(b.top), width: r7(b.width), height: r7(b.height) }, nodes: unit }
}

/* ---------- editing ---------- */

/** A node moved by (dx, dy), its handles with it. */
export function moveNode(n, dx, dy) {
  const o = cleanNode(n)
  const out = { x: o.x + dx, y: o.y + dy }
  if (has(o.hx1)) { out.hx1 = o.hx1 + dx; out.hy1 = o.hy1 + dy }
  if (has(o.hx2)) { out.hx2 = o.hx2 + dx; out.hy2 = o.hy2 + dy }
  return out
}

/**
 * One handle set to a point. `symmetric` mirrors the other through the node,
 * which is what keeps a smooth node smooth while it is shaped; with ⌥ held the
 * studio passes false and the node becomes a cusp.
 */
export function setHandle(n, which, p, symmetric = true) {
  const o = cleanNode(n)
  const [px, py] = [num(p?.[0]), num(p?.[1])]
  const out = { ...o }
  if (which === 'h1') { out.hx1 = px; out.hy1 = py } else { out.hx2 = px; out.hy2 = py }
  if (symmetric) {
    const mx = 2 * o.x - px, my = 2 * o.y - py
    if (which === 'h1') { out.hx2 = mx; out.hy2 = my } else { out.hx1 = mx; out.hy1 = my }
  }
  return out
}

/**
 * Corner to smooth and back. A corner gains handles along the line through its
 * neighbours, a third of the way to each — the length a hand-drawn curve
 * usually starts at; a smooth node loses both.
 */
export function toggleSmooth(nodes, i, closed = false) {
  const list = (nodes || []).map(cleanNode)
  const n = list[i]
  if (!n) return list
  if (has(n.hx1) || has(n.hx2)) {
    list[i] = { x: n.x, y: n.y }
    return list
  }
  const prev = list[i - 1] || (closed ? list[list.length - 1] : null)
  const next = list[i + 1] || (closed ? list[0] : null)
  const a = prev || n, b = next || n
  let dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  dx /= len; dy /= len
  const back = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0
  const fwd = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : 0
  list[i] = { x: n.x, y: n.y, hx1: n.x - dx * back, hy1: n.y - dy * back, hx2: n.x + dx * fwd, hy2: n.y + dy * fwd }
  return list
}

/** Without node i — refused, returning the list unchanged, below two nodes. */
export function removeNode(nodes, i) {
  const list = (nodes || []).map(cleanNode)
  if (list.length <= 2 || i < 0 || i >= list.length) return list
  return list.filter((_, k) => k !== i)
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/**
 * A node added on segment `seg` at `t`, without changing the drawn shape — de
 * Casteljau's split, which is exact. The neighbours' handles are shortened to
 * match, which is why this is not simply "push a point".
 */
export function insertOnSegment(nodes, seg, t, closed = false) {
  const list = (nodes || []).map(cleanNode)
  const s = segments(list, closed)[seg]
  if (!s) return list
  const tt = Math.min(1, Math.max(0, num(t)))
  const a = list[s.i], j = (s.i + 1) % list.length, b = list[j]
  if (s.straight) {
    const [x, y] = lerp(s.p0, s.p3, tt)
    const out = [...list]
    out.splice(s.i + 1, 0, { x, y })
    return out
  }
  const p01 = lerp(s.p0, s.c1, tt), p12 = lerp(s.c1, s.c2, tt), p23 = lerp(s.c2, s.p3, tt)
  const p012 = lerp(p01, p12, tt), p123 = lerp(p12, p23, tt)
  const mid = lerp(p012, p123, tt)
  const na = { ...a, hx2: p01[0], hy2: p01[1] }
  const nb = { ...b, hx1: p23[0], hy1: p23[1] }
  const nm = { x: mid[0], y: mid[1], hx1: p012[0], hy1: p012[1], hx2: p123[0], hy2: p123[1] }
  const out = [...list]
  out[s.i] = na
  out[j] = nb
  out.splice(s.i + 1, 0, nm)
  return out
}

/**
 * The point of the path nearest `p`: which segment, how far along it, and how
 * far away. Sampled, then refined around the best sample — close enough for a
 * pointer, which is all it is for.
 */
export function nearestOnPath(nodes, closed, p, samples = 32) {
  const [px, py] = [num(p?.[0]), num(p?.[1])]
  let best = { seg: -1, t: 0, dist: Infinity }
  segments(nodes, closed).forEach((s, k) => {
    const pt = (t) => [at(s.p0[0], s.c1[0], s.c2[0], s.p3[0], t), at(s.p0[1], s.c1[1], s.c2[1], s.p3[1], t)]
    const d = (t) => { const [x, y] = pt(t); return Math.hypot(x - px, y - py) }
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const dist = d(t)
      if (dist < best.dist) best = { seg: k, t, dist }
    }
    if (best.seg === k) {
      let lo = Math.max(0, best.t - 1 / samples), hi = Math.min(1, best.t + 1 / samples)
      for (let n = 0; n < 20; n++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
        if (d(m1) < d(m2)) hi = m2; else lo = m1
      }
      const t = (lo + hi) / 2
      best = { seg: k, t, dist: d(t) }
    }
  })
  return best
}

/**
 * Where a pen segment should end with shift held: on the nearest of the eight
 * compass directions from where it starts, at the distance the pointer is.
 */
export function constrain45(from, to) {
  const dx = num(to?.[0]) - num(from?.[0]), dy = num(to?.[1]) - num(from?.[1])
  const len = Math.hypot(dx, dy)
  if (!len) return [num(from?.[0]), num(from?.[1])]
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  return [num(from[0]) + Math.cos(a) * len, num(from[1]) + Math.sin(a) * len]
}
