/*
 * The pen's arithmetic measures a curve where it is drawn, not where its nodes are.
 *
 * WHY THIS IS NEEDED. supabase/functions/_shared/pathgeometry.js is the whole
 * geometry of the pen tool, shared by the studio, the renderer and the server.
 * Its failures are the kind nobody sees on a screen until a ticket is printed:
 *
 *   bounds taken from the NODES cut off a curve's bulge, so the selection box
 *     does not surround the shape and a snap lands where the curve is not;
 *   a refit that is not an identity creeps a path a little every time a node
 *     is touched, until it is visibly somewhere else;
 *   a split that is not exact changes the shape when a node is added, which is
 *     the one edit that must change nothing;
 *   a node count with no floor leaves a "path" of one point that draws nothing
 *     and cannot be selected on the canvas.
 *
 * WHAT THIS CANNOT DO. It does not press a pen; that is ticketscreen's half.
 */
import * as geo from '../supabase/functions/_shared/pathgeometry.js'
import {
  segments, pathData, boundsOfPath, fromUnit, refitPath, moveNode, setHandle,
  toggleSmooth, removeNode, insertOnSegment, nearestOnPath, constrain45,
} from '../supabase/functions/_shared/pathgeometry.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e

console.log('the module offers what the pen needs')
{
  const fns = Object.keys(geo).filter((k) => typeof geo[k] === 'function')
  ok(fns.length >= 12, `found ${fns.length} functions in pathgeometry.js`)
}

/* An arch: two corners on the ground and a smooth top whose handles are level. */
const ARCH = [{ x: 0, y: 100 }, { x: 50, y: 0, hx1: 20, hy1: 0, hx2: 80, hy2: 0 }, { x: 100, y: 100 }]
/* A single bump whose curve rises ABOVE both its nodes. */
const BUMP = [{ x: 0, y: 50, hx2: 0, hy2: 0 }, { x: 100, y: 50, hx1: 100, hy1: 0 }]

console.log('a path is its segments, straight or curved')
{
  const s = segments(ARCH)
  eq(s.length, 2, 'three nodes open is two segments')
  eq(segments(ARCH, true).length, 3, 'and closed, three — the last back to the first')
  ok(!s[0].straight && !s[1].straight, 'a segment with a handle at either end is a curve')
  ok(segments([{ x: 0, y: 0 }, { x: 1, y: 1 }])[0].straight, 'and one with none is straight')
  eq(pathData([{ x: 0, y: 0 }, { x: 10, y: 5 }]), 'M0.00 0.00 L10.00 5.00', 'a straight path is written with L')
  ok(/^M0\.00 100\.00 C/.test(pathData(ARCH)), 'a curved one with C')
  ok(/ Z$/.test(pathData(ARCH, true)), 'and a closed one ends with Z')
  eq(pathData([{ x: 1, y: 1 }]), '', 'one node is not a path, and draws nothing')
  eq(pathData([{ x: 0, y: 0 }, { x: 1, y: 1 }], false, ([x, y]) => [x * 100, y * 10]), 'M0.00 0.00 L100.00 10.00',
    'and every point goes through the map it is given — unit of box to pixels, in the renderer')
}

console.log('the bounds are where the curve goes, not where its nodes are')
{
  const b = boundsOfPath(BUMP)
  ok(b.top < 50 - 1, `a curve bulging above its nodes has its bulge in the box (top ${b.top.toFixed(2)})`)
  ok(near(b.top, 12.5, 0.01), `exactly: the cubic's peak is at 12.5 (got ${b.top.toFixed(4)})`)
  const straight = boundsOfPath([{ x: 10, y: 20 }, { x: 40, y: 20 }])
  eq(`${straight.left},${straight.top},${straight.width},${straight.height}`, '10,20,30,0',
    'a straight level stroke has no height, like a rule')
}

console.log('refitting is an identity: a path does not creep when it is touched')
{
  const { box, nodes } = refitPath(ARCH)
  const back = fromUnit(nodes, box)
  ok(back.every((n, i) => near(n.x, ARCH[i].x, 1e-2) && near(n.y, ARCH[i].y, 1e-2)), 'nodes come back where they were')
  ok(near(back[1].hx1, 20, 1e-2) && near(back[1].hx2, 80, 1e-2), 'and so do their handles')
  const again = refitPath(back)
  eq(JSON.stringify(again.nodes), JSON.stringify(nodes), 'and refitting the result changes nothing at all')
  const flat = refitPath([{ x: 10, y: 20 }, { x: 40, y: 20 }])
  eq(flat.box.height, 0, 'a flat stroke keeps a zero-height box')
  ok(flat.nodes.every((n) => n.y === 0), 'with its unit height at nought, not a division by zero')
}

console.log('a node added on a curve does not change the curve')
{
  const before = boundsOfPath(ARCH)
  const split = insertOnSegment(ARCH, 0, 0.5)
  eq(split.length, 4, 'one more node')
  const after = boundsOfPath(split)
  ok(near(before.top, after.top, 1e-6) && near(before.width, after.width, 1e-6), 'and the drawn shape is the same shape')
  const hit = nearestOnPath(split, false, [split[1].x, split[1].y])
  ok(hit.dist < 1e-3, 'the new node lies on the path')
  const straight = insertOnSegment([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, 0.3)
  ok(near(straight[1].x, 3) && straight[1].hx1 === undefined, 'on a straight segment it is a corner at that point')
}

console.log('editing: move, shape, smooth, remove')
{
  const m = moveNode(ARCH[1], 5, -5)
  ok(m.x === 55 && m.hx1 === 25 && m.hy2 === -5, 'moving a node carries its handles')
  const h = setHandle(ARCH[1], 'h2', [90, 10], true)
  ok(h.hx2 === 90 && h.hx1 === 10 && h.hy1 === -10, 'a handle moved mirrors the other through the node — it stays smooth')
  const cusp = setHandle(ARCH[1], 'h2', [90, 10], false)
  ok(cusp.hx1 === 20 && cusp.hy1 === 0, 'and with symmetry off, the other stays — a cusp')
  const corners = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }]
  const smooth = toggleSmooth(corners, 1)
  ok(smooth[1].hx1 !== undefined && smooth[1].hx2 !== undefined, 'a corner made smooth gains two handles')
  ok(near(smooth[1].hy1, smooth[1].hy2), 'lined up through the node')
  ok(toggleSmooth(smooth, 1)[1].hx1 === undefined, 'and made a corner again, loses them')
  eq(removeNode(corners, 1).length, 2, 'a node can be removed')
  eq(removeNode(removeNode(corners, 1), 0).length, 2, 'but never below two — a path of one point is not a path')
}

console.log('shift draws in eight directions')
{
  const c = constrain45([0, 0], [10, 1])
  ok(near(c[1], 0, 1e-9) && near(c[0], Math.hypot(10, 1)), 'nearly level becomes level, at the same length')
  const d = constrain45([0, 0], [10, 9])
  ok(near(d[0], d[1]), 'nearly diagonal becomes diagonal')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
