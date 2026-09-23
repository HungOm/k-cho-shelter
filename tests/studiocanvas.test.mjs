/*
 * Snapping says what it caught, catches centres, and the ruler reads the paper.
 *
 * WHY THIS IS NEEDED. src/lib/studiocanvas.js carries the arithmetic behind the
 * studio's guides and rulers. Each piece fails in a way nobody sees until a
 * run is printed:
 *
 *   a snap that does not report its line draws no guide, and a box jumping two
 *     pixels with no reason on screen reads as the pointer being unreliable;
 *   a group dragged together that snaps to its OWN members' edges walks away
 *     from where it was put, a little per frame;
 *   centres missing from the candidates make "centre this under that" a sum
 *     done by hand;
 *   a ruler whose ticks do not follow the zoom is either a smear of digits or
 *     one label for the whole ticket.
 *
 * WHAT THIS CANNOT DO. It does not drag; the screen's half — that the guides
 * are drawn where the line is and cleared on release — is in ticketscreen.
 */
import * as canvas from '../src/lib/studiocanvas.js'
import { snapEdges, snapNear, snapSpan, ticksFor, SNAP, MIN_TICK_PX, MIN_LABEL_PX } from '../src/lib/studiocanvas.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const near = (a, b) => Math.abs(a - b) < 1e-9

console.log('the module offers what the studio calls')
{
  const fns = Object.keys(canvas).filter((k) => typeof canvas[k] === 'function')
  ok(fns.length >= 4, `found ${fns.length} functions in studiocanvas.js`)
  for (const f of ['snapEdges', 'snapNear', 'snapSpan', 'ticksFor']) ok(fns.includes(f), `${f} is exported`)
}

const things = [
  { id: 'a', box: { left: 0.2, top: 0.1, width: 0.2, height: 0.1 } },
  { id: 'b', box: { left: 0.6, top: 0.5, width: 0.1, height: 0.1 } },
  { id: 'hidden', enabled: false, box: { left: 0.33, top: 0.33, width: 0.1, height: 0.1 } },
]

console.log('what a moving box may snap to')
{
  const { xs, ys } = snapEdges(things, new Set(['b']), { stubAt: 0.74 })
  ok(xs.includes(0.2) && xs.includes(0.4), 'another box\'s two edges')
  ok(xs.some((x) => near(x, 0.3)), 'and its centre, which is what makes centring a drag')
  ok(xs.includes(0.5) && ys.includes(0.5), 'the artboard\'s own centre, both ways')
  ok(xs.includes(0.74), 'where the stub begins, across')
  ok(!ys.includes(0.74), 'but not down, where it means nothing')
  ok(!xs.includes(0.6) && !xs.includes(0.7), 'never the edges of a box that is itself moving')
  ok(!xs.some((x) => near(x, 0.33)), 'nor of one that is switched off')
}

console.log('a snap reports the line that caught it')
{
  const r = snapNear(0.302, [0.1, 0.3])
  ok(near(r.value, 0.3) && near(r.hit, 0.3), 'caught by 0.3, and says so')
  const free = snapNear(0.35, [0.1, 0.3])
  ok(near(free.value, 0.35) && free.hit === null, 'too far from anything, it stays and reports nothing')
  const g = snapNear(0.0201, [], 0.01)
  ok(near(g.value, 0.02) && g.hit === null && g.grid, 'a grid catch moves it but draws no guide')
  const both = snapNear(0.0405, [0.0402], 0.01)
  ok(near(both.value, 0.0402), 'the nearer of a line and a grid step wins')
  ok(SNAP > 0 && SNAP < 0.01, 'the reach is small — under a hundredth of the artboard')
}

console.log('a box snaps by whichever of its three lines is nearest something')
{
  const lead = snapSpan(0.201, 0.1, [0.2])
  ok(near(lead.start, 0.2) && near(lead.hit, 0.2), 'its leading edge onto an edge')
  const trail = snapSpan(0.498, 0.1, [0.6])
  ok(near(trail.start, 0.5) && near(trail.hit, 0.6), 'its trailing edge onto an edge')
  const centre = snapSpan(0.251, 0.1, [0.3])
  ok(near(centre.start, 0.25) && near(centre.hit, 0.3), 'its centre onto a centre line')
  const none = snapSpan(0.123, 0.1, [0.5])
  ok(near(none.start, 0.123) && none.hit === null, 'and nothing near, nothing moves')
}

console.log('the ruler reads millimetres at a spacing that suits the zoom')
{
  const small = ticksFor(190, 560 / 190)      // the studio fitted at about 35%
  const big = ticksFor(190, 3200 / 190)       // the same ticket at 200%
  ok(small.length > 10, `a ruler has ticks (${small.length} at 35%)`)
  const gap = (t) => t[1].px - t[0].px
  ok(gap(small) >= MIN_TICK_PX && gap(big) >= MIN_TICK_PX, 'ticks never closer than a readable gap')
  const labels = (t) => t.filter((x) => x.label)
  const lgap = (t) => labels(t)[1].px - labels(t)[0].px
  ok(lgap(small) >= MIN_LABEL_PX, `labels leave room for three digits at 35% (${lgap(small).toFixed(0)} px)`)
  ok(labels(big).length > labels(small).length, 'and there are more of them as the ticket grows')
  eq(small[0].mm, 0, 'it starts at nought')
  ok(labels(small).some((t) => t.mm === 180) || labels(small).some((t) => t.mm === 100), 'and labels the far end\'s neighbourhood')
  eq(ticksFor(0, 3).length, 0, 'no length, no ruler')
  eq(ticksFor(190, 0).length, 0, 'and no scale, no ruler')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
