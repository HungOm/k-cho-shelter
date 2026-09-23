/*
 * A group is one row in the layer list, and it opens to show its parts.
 *
 * WHY THIS IS NEEDED. The user placed seventeen copies of a logo, grouped
 * them, and the list still showed seventeen "Picture" rows: every other layer
 * went off the bottom of the panel, and the list became something to scroll
 * past rather than read. src/lib/layergroups.js folds a group into one row.
 * What can go wrong is quiet:
 *
 *   a group row placed where its BACKMOST part is would move the group down
 *     the list from where it prints;
 *   a part selected on its own inside a folded group would be selected with no
 *     row showing it;
 *   a group row that says "pinned" when half of it is pinned would disagree
 *     with ⇧⌘L, which pins the rest — press the row and the key and get two
 *     different answers;
 *   a group of one folded into a row that opens onto the same row is a click
 *     that does nothing.
 *
 * WHAT THIS CANNOT DO. It does not draw the rows; ticketscreen does that half.
 */
import * as lg from '../src/lib/layergroups.js'
import { layerRows, groupLabel, nextPinned, nextShown, drawingName } from '../src/lib/layergroups.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const pic = (id, group = '', more = {}) => ({ id, kind: 'image', group, ...more })

console.log('the module offers what the lists call')
{
  const fns = Object.keys(lg).filter((k) => typeof lg[k] === 'function')
  ok(fns.length >= 4, `found ${fns.length} functions in layergroups.js`)
}

console.log('a group is one row, where its frontmost part prints')
{
  /* Draw order, back first: a rule at the back, seventeen logos grouped, a
     tint in front of them, and one more logo of the group in front of that. */
  const deco = [{ id: 'rule', kind: 'line' }]
  for (let i = 1; i <= 16; i++) deco.push(pic(`p${i}`, 'logos'))
  deco.push({ id: 'tint', kind: 'rect' }, pic('p17', 'logos'))
  const rows = layerRows(deco)
  eq(rows.length, 3, 'nineteen drawings read as three rows: the group, the tint, the rule')
  eq(rows.map((r) => r.id).join(), 'group:logos,tint,rule', 'the group sits where its frontmost part prints')
  eq(rows[0].members.length, 17, 'and it holds all seventeen, wherever they sit in the order')
  eq(rows[0].label, '17 pictures', 'named for what it holds')
  eq(groupLabel([pic('a'), { id: 'b', kind: 'rect' }]), 'Group of 2', 'and for a mix, by its size')
}

console.log('it opens to show its parts, and opens itself for a part selected alone')
{
  const deco = [pic('a', 'g'), pic('b', 'g'), { id: 'c', kind: 'rect' }]
  const open = layerRows(deco, { open: new Set(['g']) })
  eq(open.map((r) => `${r.id}:${r.depth ?? '-'}`).join(), 'c:0,group:g:-,b:1,a:1', 'opened, its parts follow it, front first, indented')
  const solo = layerRows(deco, { picked: ['a'] })
  ok(solo.some((r) => r.id === 'a'), 'one part picked alone keeps its row in view')
  const whole = layerRows(deco, { picked: ['a', 'b'] })
  ok(!whole.some((r) => r.id === 'a'), 'the whole group picked stays folded')
  ok(whole.find((r) => r.kind === 'group').picked, 'and its row reads as selected')
  eq(layerRows([pic('a', 'lonely')])[0].kind, 'item', 'a group of one is not folded')
}

console.log('pinned and shown mean all of it, as ⇧⌘L does')
{
  const half = [pic('a', 'g', { locked: true }), pic('b', 'g', { locked: false })]
  eq(layerRows(half)[0].pinned, false, 'half pinned is not pinned')
  eq(nextPinned(half), true, 'and pressing pin pins the rest')
  eq(nextPinned(half.map((m) => ({ ...m, locked: true }))), false, 'all pinned releases all')
  const hidden = [pic('a', 'g', { enabled: false }), pic('b', 'g')]
  eq(layerRows(hidden)[0].shown, false, 'half hidden is not shown')
  eq(nextShown(hidden), true, 'and pressing the eye shows the rest')
}

console.log('a drawing is called the same thing on both tabs')
{
  eq(drawingName({ kind: 'text', text: { value: 'Grand prize' } }), '“Grand prize”', 'words are called by their words')
  eq(drawingName({ kind: 'text', text: { value: '' } }), 'Words', 'and empty words by the kind')
  eq(drawingName({ kind: 'text', name: 'Price tag', text: { value: 'RM 10' } }), 'Price tag', 'a name somebody typed wins')
  eq(drawingName({ kind: 'icon', icon: { name: 'ticket' } }), 'Mark · ticket', 'a mark by the mark it is')
  const tabs = ['src/components/TicketDesign.vue', 'src/components/ticketdesign/DigitalTab.vue']
  const { readFileSync } = await import('node:fs')
  const card = readFileSync(new URL('../' + tabs[1], import.meta.url), 'utf8')
  ok(/const decoName = drawingName/.test(card), 'the card names its drawings with this function, not a copy of its own')
  const shell = readFileSync(new URL('../' + tabs[0], import.meta.url), 'utf8')
  ok(/const decoName = drawingName/.test(shell), 'and so does the printed tab — one name for one drawing')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
