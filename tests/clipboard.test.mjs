/*
 * A paste is a copy that stands on its own, and says what it could not bring.
 *
 * WHY THIS IS NEEDED. src/lib/clipboard.js gives the studio copy, cut and
 * paste. The ways a paste goes wrong on a ticket are all silent:
 *
 *   a pasted field that keeps `after` flows from the ORIGINAL's anchor and
 *     prints on top of it — or, on another template, from nothing;
 *   a pasted group that keeps its group id is the same group as the original,
 *     so clicking the copy selects the original as well;
 *   a paste past the sixty-shape limit that drops the rest without a word is a
 *     library shape that arrives with a part missing;
 *   a paste in place (⇧⌘V) that is nudged anyway lands beside the thing it
 *     was meant to sit exactly over;
 *   Duplicate repeated after moving the copy must step the SAME distance again,
 *     or a row of evenly spaced things drifts by the default nudge instead.
 *
 * WHAT THIS CANNOT DO. It does not hold the system clipboard; the studio's
 * clip is in memory, which is why it survives a switch of template and not a
 * reload.
 */
import * as clip from '../src/lib/clipboard.js'
import { copyRecords, pasteRecords, repeatStep, stepBox } from '../src/lib/clipboard.js'
import { NUDGE } from '../src/lib/arrange.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

console.log('the module offers what the studio calls')
{
  const names = Object.keys(clip).filter((k) => typeof clip[k] === 'function')
  ok(names.length >= 2, `found ${names.length} functions in clipboard.js`)
  ok(names.includes('copyRecords') && names.includes('pasteRecords'), 'copy and paste are both exported')
}

const ELS = [
  { id: 'number-main', kind: 'field', box: { left: 0.1, top: 0.1, width: 0.2, height: 0.05 } },
  { id: 'book-main', kind: 'field', after: 'number-main', box: { left: 0.35, top: 0.1, width: 0.1, height: 0.05 } },
]
const DECOS = [
  { id: 'd1', kind: 'rect', group: 'g1', box: { left: 0.1, top: 0.5, width: 0.1, height: 0.1 } },
  { id: 'd2', kind: 'line', group: 'g1', box: { left: 0.1, top: 0.6, width: 0.1, height: 0 } },
  { id: 'd3', kind: 'rect', group: '', box: { left: 0.5, top: 0.5, width: 0.1, height: 0.1 } },
]
let n = 0
const ids = { nextId: () => `e${++n}`, nextDecoId: () => `d-new-${++n}`, nextGroupId: () => `g-new-${++n}` }

console.log('copying takes records, not references')
{
  const c = copyRecords(ELS, DECOS, ['book-main', 'd1'])
  eq(c.elements.length, 1, 'one field copied')
  eq(c.decorations.length, 1, 'one shape copied')
  eq(c.elements[0].after, '', 'the copy does not flow after the original\'s anchor')
  c.decorations[0].box.left = 0.9
  eq(DECOS[0].box.left, 0.1, 'and editing the copy leaves the original where it was')
}

console.log('a paste has new ids, is visibly offset, and a group stays a group — a new one')
{
  const c = copyRecords(ELS, DECOS, ['number-main', 'd1', 'd2', 'd3'])
  const p = pasteRecords(c, ids)
  ok(p.elements.every((e) => e.id.startsWith('e')) && p.elements[0].id !== 'number-main', 'fields get new ids')
  ok(p.decorations.every((d) => d.id.startsWith('d-new-')), 'shapes get new ids')
  eq(Math.round((p.decorations[0].box.left - 0.1) * 1e6) / 1e6, NUDGE, 'offset one nudge, so it is visibly a copy')
  const [a, b, c3] = p.decorations
  ok(a.group && a.group === b.group, 'the two grouped parts are still one group')
  ok(a.group !== 'g1', 'but not the ORIGINAL group, or a click on the copy would take the original too')
  eq(c3.group, '', 'an ungrouped shape stays ungrouped')

  const again = pasteRecords(c, { ...ids, times: 3 })
  eq(Math.round((again.decorations[0].box.left - 0.1) * 1e6) / 1e6, Math.round(NUDGE * 3 * 1e6) / 1e6,
    'the third paste of one clip lands three nudges away, not on top of the second')
}

console.log('what does not fit is counted, not dropped in silence')
{
  const c = copyRecords(ELS, DECOS, ['d1', 'd2', 'd3'])
  const p = pasteRecords(c, { ...ids, room: 2 })
  eq(p.decorations.length, 2, 'two shapes fit')
  eq(p.refused, 1, 'and the third is reported as refused')
  eq(pasteRecords(null, ids).elements.length, 0, 'an empty clip pastes nothing')
}

console.log('in place, and by an exact step')
{
  const src = { elements: [{ id: 'f1', box: { left: 0.2, top: 0.3, width: 0.1, height: 0.05 } }],
    decorations: [{ id: 'd1', group: 'g1', box: { left: 0.5, top: 0.1, width: 0.2, height: 0.2 } }] }
  const at = pasteRecords(src, { ...ids, inPlace: true })
  eq(`${at.elements[0].box.left},${at.elements[0].box.top}`, '0.2,0.3', 'a paste in place lands exactly on the field it copied')
  eq(`${at.decorations[0].box.left},${at.decorations[0].box.top}`, '0.5,0.1', 'and on the shape')
  eq(at.pairs.map((p) => p.from).join(), 'f1,d1', 'and says which copy came from which original')
  const stepped = pasteRecords(src, { ...ids, step: { dx: 0.15, dy: 0 } })
  ok(Math.abs(stepped.decorations[0].box.left - 0.65) < 1e-9, 'a step moves the copy by exactly that distance')
  eq(stepBox({ left: 0.95, top: 0, width: 0.1, height: 0.1 }, { dx: 0.2, dy: 0 }, false).left, 0.9,
    'a field stepped past the edge stops at it')
  eq(stepBox({ left: 0.95, top: 0, width: 0.1, height: 0.1 }, { dx: 0.2, dy: 0 }, true).left, 1.15,
    'while a drawing may hang off the artwork, as the model allows')
}

console.log('duplicate again repeats the last move')
{
  const last = [{ copy: 'd9', from: 'd1', box: { left: 0.1, top: 0.2, width: 0.1, height: 0.1 } }]
  const boxes = { d9: { left: 0.35, top: 0.2, width: 0.1, height: 0.1 } }
  const step = repeatStep(last, ['d9'], (id) => boxes[id])
  ok(step && Math.abs(step.dx - 0.25) < 1e-9 && step.dy === 0, 'the copy moved 0.25 across, so the next copy steps 0.25 across')
  eq(repeatStep(last, ['d1'], (id) => boxes[id]), null, 'with the original selected instead there is nothing to repeat')
  eq(repeatStep(last, ['d9', 'x'], (id) => boxes[id]), null, 'nor with something else selected too')
  eq(repeatStep(null, ['d9'], (id) => boxes[id]), null, 'nor before any duplicate at all')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
