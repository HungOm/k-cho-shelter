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
 *     library shape that arrives with a part missing.
 *
 * WHAT THIS CANNOT DO. It does not hold the system clipboard; the studio's
 * clip is in memory, which is why it survives a switch of template and not a
 * reload.
 */
import * as clip from '../src/lib/clipboard.js'
import { copyRecords, pasteRecords } from '../src/lib/clipboard.js'
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
