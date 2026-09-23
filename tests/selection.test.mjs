/*
 * A rubber band selects what it touches, and a group is taken whole.
 *
 * WHY THIS IS NEEDED. Selecting twelve buyer lines on a stub was twelve
 * shift-clicks on boxes a few pixels tall, each miss starting a drag instead.
 * src/lib/selection.js adds the marquee and groups. Three things in it are
 * easy to get quietly wrong and each has a cost on a ticket:
 *
 *   a band that must ENCLOSE a box misses every field running past its edge —
 *     on this artwork, most of the stub;
 *   a band that hits HIDDEN things hands the arrange tools boxes nobody can
 *     see move;
 *   a group expanded from the wrong member makes a click on one placed library
 *     shape select a different placement's parts.
 *
 * WHAT THIS CANNOT DO. It does not press a pointer; whether the studio calls
 * these on the right gesture is tests/ticketscreen.test.mjs's half.
 */
import * as sel from '../src/lib/selection.js'
import { bandOf, isClick, hitsIn, expandGroups, mergeSelection } from '../src/lib/selection.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

console.log('the module offers what the studio calls')
{
  const names = Object.keys(sel).filter((k) => typeof sel[k] === 'function')
  ok(names.length >= 5, `found ${names.length} functions in selection.js`)
  for (const f of ['bandOf', 'isClick', 'hitsIn', 'expandGroups', 'mergeSelection']) ok(names.includes(f), `${f} is exported`)
}

const box = (left, top, width, height) => ({ left, top, width, height })
const THINGS = [
  { id: 'a', box: box(0.10, 0.10, 0.20, 0.05) },
  { id: 'b', box: box(0.10, 0.30, 0.60, 0.05) },           // runs well past the band's right edge
  { id: 'rule', box: box(0.10, 0.50, 0.30, 0) },          // a horizontal rule, no height
  { id: 'off', enabled: false, box: box(0.10, 0.20, 0.10, 0.05) },
  { id: 'far', box: box(0.80, 0.80, 0.10, 0.10) },
]

console.log('the band is the rectangle between the two points, whichever way it was dragged')
{
  const b = bandOf({ left: 0.4, top: 0.6 }, { left: 0.1, top: 0.2 })
  const near = (x, y) => Math.abs(x - y) < 1e-9
  ok(near(b.left, 0.1) && near(b.top, 0.2) && near(b.width, 0.3) && near(b.height, 0.4),
    'dragged up and left, it is the same band as down and right')
  ok(isClick(bandOf({ left: 0.5, top: 0.5 }, { left: 0.503, top: 0.504 })), 'a few thousandths is a click')
  ok(!isClick(box(0.1, 0.1, 0.1, 0)), 'a flat band dragged across a row is not a click')
}

console.log('a band takes what it touches')
{
  const hit = hitsIn(THINGS, box(0.05, 0.05, 0.3, 0.5))
  ok(hit.includes('a'), 'a box wholly inside is taken')
  ok(hit.includes('b'), 'a box running past the band\'s edge is taken — touched, not enclosed')
  ok(hit.includes('rule'), 'a rule with no height is taken when the band crosses its line')
  ok(!hit.includes('off'), 'a hidden box is NOT taken, though the band covers it')
  ok(!hit.includes('far'), 'and a box elsewhere is not')
  eq(hitsIn(THINGS, null).length, 0, 'no band, nothing')
}

console.log('a group is taken whole, and only its own members')
{
  const decos = [
    { id: 'd1', group: 'g1' }, { id: 'd2', group: 'g1' }, { id: 'd3', group: 'g2' },
    { id: 'd4', group: '' }, { id: 'd5', group: 'g1' },
  ]
  eq(expandGroups(['d2'], decos).join(), 'd2,d1,d5', 'one member brings its whole group, the hit first')
  ok(!expandGroups(['d2'], decos).includes('d3'), 'and nothing from another group')
  eq(expandGroups(['d4'], decos).join(), 'd4', 'an ungrouped shape is taken alone')
  eq(expandGroups(['number-main', 'd3'], decos).join(), 'number-main,d3',
    'a field passes through untouched beside a group of one')
}

console.log('a new band replaces the selection; with shift it joins it')
{
  const current = { sel: 'a', also: ['b'] }
  const fresh = mergeSelection(current, ['c', 'd'], false)
  eq(`${fresh.sel}|${fresh.also.join()}`, 'c|d', 'without shift, the band\'s first hit is the primary')
  const joined = mergeSelection(current, ['b', 'c'], true)
  eq(`${joined.sel}|${joined.also.join()}`, 'a|b,c',
    'with shift, the primary stays where it was and nothing is listed twice')
  const none = mergeSelection(current, [], false)
  eq(`${none.sel}|${none.also.length}`, '|0', 'a band that hits nothing clears the selection')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
