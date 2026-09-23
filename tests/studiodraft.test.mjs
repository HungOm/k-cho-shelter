/*
 * A studio design that was not saved is kept, and offered back honestly.
 *
 * WHY THIS IS NEEDED. Unsaved placement work lived only in memory, so a reload
 * or a crashed tab lost everything since the last Save with nothing on screen
 * to say so. src/lib/studiodraft.js keeps it per template. The part that can go
 * wrong quietly is the COMPARISON: a draft that equals what is saved must not
 * be offered (a "restore" that changes nothing teaches people to ignore the
 * offer), and a draft made on top of an older save must be told apart from one
 * made on top of this one, because restoring it discards somebody's later save.
 *
 * WHAT THIS CANNOT DO. It does not open a browser. Whether local storage is
 * available, and whether the studio calls these at the right moments, is the
 * screen's half — see tests/ticketscreen.test.mjs.
 */
import {
  draftKey, designText, writeDraft, readDraft, clearDraft, compareDraft, browserStorage,
} from '../src/lib/studiodraft.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/* A Storage-shaped object, and one that refuses every write the way a full or
   locked-down browser does. */
const memory = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    get size() { return m.size },
  }
}
const refusing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }

const SAVED = { stubAt: 0.74, elements: [{ id: 'a', box: { left: 0.1 } }], artwork: { width: 1600, height: 517 } }
const EDITED = { ...SAVED, elements: [{ id: 'a', box: { left: 0.2 } }] }

console.log('the design is compared as it would be saved, without the picture')
{
  eq(designText(SAVED).includes('artwork'), false, 'the artwork size is left out, because saving leaves it out')
  eq(designText({ ...SAVED, artwork: { width: 9 } }), designText(SAVED),
    'so the same work on a differently sized picture reads as the same work')
  eq(designText(null), '', 'nothing is nothing')
}

console.log('four states, and each is reached')
{
  const s = memory()
  eq(compareDraft(readDraft(s, 't1'), designText(SAVED)), 'none', 'with nothing kept, there is nothing to offer')

  ok(writeDraft(s, 't1', { design: designText(EDITED), saved: designText(SAVED), editedAt: '14:02' }, 1000),
    'a draft is kept')
  const d = readDraft(s, 't1')
  ok(d && d.editedAt === '14:02' && d.keptAt === 1000, 'and reads back with its time')
  eq(compareDraft(d, designText(SAVED)), 'newer', 'edits on top of the design that is saved now are NEWER')

  eq(compareDraft(d, designText(EDITED)), 'same',
    'once those edits are saved, the draft is the SAME as the save and must not be offered')

  const later = { ...SAVED, stubAt: 0.7 }
  eq(compareDraft(d, designText(later)), 'stale',
    'if somebody saved something else since, the draft is STALE — still offered, but not as if nothing happened')
}

console.log('drafts belong to one template each')
{
  const s = memory()
  writeDraft(s, 't1', { design: designText(EDITED), saved: designText(SAVED) })
  eq(readDraft(s, 't2'), null, 'a second template has no draft of the first')
  ok(draftKey('t1') !== draftKey('t2'), 'because the keys differ')
  clearDraft(s, 't1')
  eq(readDraft(s, 't1'), null, 'and a cleared draft is gone')
}

console.log('nothing here throws, whatever the storage does')
{
  eq(writeDraft(refusing, 't1', { design: '{}', saved: '{}' }), false, 'a refused write says false')
  eq(readDraft(refusing, 't1'), null, 'a refused read is no draft')
  clearDraft(refusing, 't1')
  ok(true, 'and a refused clear is survived')

  const s = memory()
  s.setItem(draftKey('bad'), '{not json')
  eq(readDraft(s, 'bad'), null, 'garbage in the slot is no draft')
  s.setItem(draftKey('old'), JSON.stringify({ v: 0, design: '{}' }))
  eq(readDraft(s, 'old'), null, 'a draft from another version of this format is not trusted')
  s.setItem(draftKey('broken'), JSON.stringify({ v: 1, design: '{half' }))
  eq(readDraft(s, 'broken'), null, 'a draft whose design will not parse is not offered to the canvas')

  eq(writeDraft(null, 't1', { design: '{}' }), false, 'no storage at all is a refusal, not a crash')
  eq(browserStorage(), null, 'and in this runtime there is no local storage, which is answered, not thrown')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
