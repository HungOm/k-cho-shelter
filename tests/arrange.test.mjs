/*
 * THE ARITHMETIC OF ARRANGING, PINNED BEFORE ANY OF IT REACHES A TOOLBAR.
 *
 * Align, distribute and order are the tools the studio has never had, and all
 * three are the kind of operation that looks right on one carefully chosen
 * example and is wrong everywhere else. Distribute spacing CENTRES instead of
 * GAPS passes any test where every box is the same width. "Bring forward" that
 * steps over the next index instead of the next unselected thing passes any
 * test with one item selected. Both of those are the version somebody writes
 * first, and both are pinned here with the case that separates them.
 *
 * Every function is pure, so this file needs no DOM, no store and no fixture —
 * which is the reason the arithmetic lives in src/lib/arrange.js at all rather
 * than inside the two screens that use it.
 */
import { EDGES, ORDER_MOVES, boundsOf, alignBoxes, distributeBoxes, orderMoved, offsetBox, NUDGE }
  from '../src/lib/arrange.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}
const box = (left, top, width, height) => ({ left, top, width, height })
const ARTBOARD = box(0, 0, 1, 1)

console.log('the rectangle a set of boxes sits inside')
{
  eq(boundsOf([]), null, 'nothing has no bounds, and says so rather than returning a zero box')
  const b = boundsOf([box(0.1, 0.2, 0.2, 0.1), box(0.5, 0.1, 0.1, 0.4)])
  eq(b.left, 0.1, 'left is the leftmost edge')
  eq(b.top, 0.1, 'top is the topmost')
  eq(b.width, 0.5, 'width reaches the far side of the rightmost box, not its origin')
  eq(b.height, 0.4, 'and height the bottom of the lowest')
}

console.log('align puts every box against one edge of what it is given')
{
  eq(EDGES.length, 6, 'six edges to check, not zero')
  const one = [box(0.3, 0.3, 0.2, 0.1)]
  const at = (edge, k) => alignBoxes(one, edge, ARTBOARD)[0][k]

  eq(at('left', 'left'), 0, 'left goes to the left edge')
  eq(at('right', 'left'), 0.8, 'right accounts for the box\'s own width')
  eq(at('centre', 'left'), 0.4, 'centre halves the space left over')
  eq(at('top', 'top'), 0, 'top goes to the top')
  eq(at('bottom', 'top'), 0.9, 'bottom accounts for its height')
  eq(at('middle', 'top'), 0.45, 'middle halves the space left over')

  /* The axis it does not touch is untouched: an align-left that also moved a
     box vertically would be two operations on one button. */
  eq(alignBoxes(one, 'left', ARTBOARD)[0].top, 0.3, 'aligning across leaves the down alone')
  eq(alignBoxes(one, 'top', ARTBOARD)[0].left, 0.3, 'and aligning down leaves the across alone')
  eq(alignBoxes(one, 'left', ARTBOARD)[0].width, 0.2, 'nothing is resized')

  /*
   * AGAINST THE SELECTION, NOT THE ARTBOARD, when there is more than one — and
   * this is the caller's decision, so both are exercised. Aligning a SINGLE box
   * to its own bounds moves it nowhere, which on screen reads as a dead button;
   * the screens pass the artboard for one and the bounds for several.
   */
  const many = [box(0.1, 0.1, 0.2, 0.1), box(0.5, 0.4, 0.1, 0.1)]
  const together = alignBoxes(many, 'left', boundsOf(many))
  eq(together[0].left, 0.1, 'the leftmost stays put')
  eq(together[1].left, 0.1, 'and the other comes to meet it')

  const alone = alignBoxes(one, 'left', boundsOf(one))
  eq(alone[0].left, 0.3, 'one box aligned to its own bounds does not move — hence the artboard')
}

console.log('align refuses rather than guessing')
{
  eq(alignBoxes([], 'left', ARTBOARD).length, 0, 'nothing selected changes nothing')
  eq(alignBoxes([box(0.3, 0.3, 0.2, 0.1)], 'sideways', ARTBOARD)[0].left, 0.3,
    'an edge it has never heard of moves nothing, rather than picking one')
  eq(alignBoxes([box(0.3, 0.3, 0.2, 0.1)], 'left', null)[0].left, 0.3,
    'and nothing to align against moves nothing')
}

console.log('distribute shares out the GAPS, which is not the same as the centres')
{
  /*
   * THE CASE THAT SEPARATES THE TWO IMPLEMENTATIONS, and the reason it is
   * built from boxes of different widths. Spacing centres evenly leaves the
   * wide box crowding its neighbours; spacing gaps evenly is what the eye
   * reads as evenly spaced. With three equal widths both algorithms agree,
   * which is why the obvious fixture proves nothing.
   */
  const a = box(0, 0, 0.1, 0.1)      // 0.0 – 0.1
  const b = box(0.3, 0, 0.4, 0.1)    // 0.3 – 0.7   the wide one
  const c = box(0.9, 0, 0.1, 0.1)    // 0.9 – 1.0
  const out = distributeBoxes([a, b, c], 'across')

  /* run 1.0, filled 0.6, two gaps of 0.2 each. The middle box therefore starts
     at 0.1 + 0.2 = 0.3 — which it already did, so this fixture also checks the
     arithmetic against a value it cannot accidentally produce by doing nothing
     to a DIFFERENT box. */
  eq(out[0].left, 0, 'the first does not move')
  eq(out[2].left, 0.9, 'and neither does the last — they define the run')
  eq(out[1].left, 0.3, 'the middle sits one even gap after the first box ENDS')

  /* Centres-not-gaps would put the middle box at 0.5 - 0.4/2 = 0.3 here too.
     So a second fixture, where the two answers differ. */
  const d = box(0, 0, 0.1, 0.1)
  const e = box(0.2, 0, 0.5, 0.1)
  const f = box(0.8, 0, 0.2, 0.1)
  const out2 = distributeBoxes([d, e, f], 'across')
  /* run 1.0, filled 0.8, one gap 0.1 shared twice → middle starts at 0.2. */
  eq(out2[1].left, 0.2, 'gaps: the middle starts a gap after the first ends')
  ok(Math.abs(out2[1].left - 0.15) > 1e-9,
    'and NOT at 0.15, which is where spacing the centres evenly would put it')

  const down = distributeBoxes(
    [box(0, 0, 0.1, 0.1), box(0, 0.3, 0.1, 0.4), box(0, 0.9, 0.1, 0.1)], 'down')
  eq(down[1].top, 0.3, 'the same arithmetic on the other axis')
  eq(down[1].left, 0, 'and the across is left alone')
}

console.log('distribute leaves too-few alone, and keeps the caller\'s order')
{
  const two = [box(0, 0, 0.1, 0.1), box(0.8, 0, 0.1, 0.1)]
  eq(distributeBoxes(two, 'across')[1].left, 0.8,
    'two boxes have one gap and it is already even, so nothing moves')
  eq(distributeBoxes([box(0, 0, 0.1, 0.1)], 'across')[0].left, 0, 'and one is not a run')
  eq(distributeBoxes([box(0, 0, 0.1, 0.1)], 'sideways').length, 1, 'an unknown axis moves nothing')

  /*
   * ORDER IN, ORDER OUT. Distribute has to sort to do its arithmetic, and the
   * array order IS the stacking order in both renderers — so returning the
   * sorted list would silently restack the design. The fixture is deliberately
   * given out of order.
   */
  const jumbled = [box(0.9, 0, 0.1, 0.1), box(0, 0, 0.1, 0.1), box(0.5, 0, 0.2, 0.1)]
  const kept = distributeBoxes(jumbled, 'across')
  /* run 1.0, filled 0.4, two gaps of 0.3 — so the middle box by POSITION lands
     at 0.4, moving from 0.5. Chosen so it actually moves: an earlier fixture
     put it where it already was, which would have passed against a function
     that did nothing at all. */
  eq(kept[0].left, 0.9, 'the box that was last in the array is still last in it')
  eq(kept[1].left, 0, 'and the one that was first is still first')
  eq(kept[2].left, 0.4, 'while the middle one by POSITION is the one that moved, from 0.5')
}

console.log('order moves things through the stack, where later is on top')
{
  eq(ORDER_MOVES.length, 4, 'four moves to check, not zero')
  const ids = ['a', 'b', 'c', 'd']
  eq(orderMoved(ids, ['b'], 'forward').join(''), 'acbd', 'forward is one place later')
  eq(orderMoved(ids, ['c'], 'backward').join(''), 'acbd', 'backward is one place earlier')
  eq(orderMoved(ids, ['b'], 'front').join(''), 'acdb', 'front is the end of the array, which draws last')
  eq(orderMoved(ids, ['c'], 'back').join(''), 'cabd', 'back is the start')

  eq(orderMoved(ids, ['d'], 'forward').join(''), 'abcd', 'the topmost cannot go further')
  eq(orderMoved(ids, ['a'], 'backward').join(''), 'abcd', 'nor the bottom one back')

  /*
   * SEVERAL AT ONCE KEEP THEIR OWN ORDER. Pressing "bring to front" with three
   * things selected must not shuffle those three against each other.
   */
  eq(orderMoved(ids, ['a', 'c'], 'front').join(''), 'bdac', 'two to the front, still a before c')
  eq(orderMoved(ids, ['c', 'a'], 'front').join(''), 'bdac', 'and the SELECTION order does not decide it')
  eq(orderMoved(ids, ['b', 'd'], 'back').join(''), 'bdac', 'the same going the other way')

  /*
   * THE ONE THAT CATCHES THE NAIVE VERSION. A contiguous run stepping over the
   * next INDEX shuffles within itself and never leaves — which looks exactly
   * like a button that does nothing, while actually doing something to the
   * wrong pair. Stepping over the next thing that is NOT MOVING is the fix.
   */
  eq(orderMoved(ids, ['a', 'b'], 'forward').join(''), 'cabd',
    'a contiguous pair steps over the next unselected item, together')
  eq(orderMoved(ids, ['c', 'd'], 'backward').join(''), 'acdb',
    'and the same backwards')

  eq(orderMoved(ids, ['zz'], 'forward').join(''), 'abcd', 'an id the list has never heard of is ignored')
  eq(orderMoved(ids, [], 'forward').join(''), 'abcd', 'and nothing selected moves nothing')
  eq(orderMoved(ids, ['a'], 'sideways').join(''), 'abcd', 'as does a move it does not know')
}

console.log('a duplicate is offset, and stays on the artboard')
{
  const b = offsetBox(box(0.1, 0.1, 0.2, 0.1))
  /* 0.12, not `0.1 + NUDGE` — which is 0.12000000000000001 in binary floating
     point. The boxes are ROUNDED to six places on the way out precisely so a
     nudged box round-trips through storage unchanged, so the expectation here
     has to be the rounded value or the test asserts the bug back. */
  eq(b.left, 0.12, 'nudged across so the copy is visibly a copy')
  eq(b.top, 0.12, 'and down')
  ok(NUDGE > 0, 'and the nudge is a real distance')
  eq(b.width, 0.2, 'the same size')

  /*
   * CLAMPED, because a copy of something at the bottom right would otherwise be
   * created off the edge — where it is selected, invisible, and cannot be
   * clicked to get back.
   */
  const corner = offsetBox(box(0.95, 0.95, 0.1, 0.1))
  eq(corner.left, 0.9, 'a copy at the right edge stops at the edge')
  eq(corner.top, 0.9, 'and at the bottom')

  /* The watermark is wider than the card on purpose, so a box that cannot fit
     is left where it is rather than dragged back to a "valid" place it was
     never in. */
  const bleeds = offsetBox(box(-0.1, 0, 1.4, 0.5))
  eq(bleeds.left, -0.1, 'a box wider than the artboard is not hauled back onto it')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
