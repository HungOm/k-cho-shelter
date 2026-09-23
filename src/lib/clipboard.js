/*
 * COPY AND PASTE, AS ARITHMETIC.
 *
 * The studio had Duplicate and nothing else: a copy could only land next to
 * its original, on the same template. Copy and paste is the version that
 * travels — to the stub from the main half with one drag after, or to another
 * template the organiser switches to — and it is the pair of keys every hand
 * reaches for before looking for a button.
 *
 * WHAT IS COPIED IS A RECORD, NOT A REFERENCE. Deep clones, so pasting and then
 * editing the paste cannot reach back into the original; and in the stored
 * shape, so the same normalisers that read a saved design read a paste.
 *
 * `after` IS DROPPED, the rule duplicate already follows: it names another
 * element to flow from, and two elements flowing from one anchor print on top
 * of each other. A paste stands on its own, which is the only version of it
 * that is always correct — on another template the anchor may not exist.
 *
 * GROUPS STAY GROUPS, AS NEW GROUPS. A pasted group must hold together, and it
 * must not be the SAME group as the original — or a click on the copy would
 * select the original too. So each source group maps to one fresh group.
 */
import { offsetBox, NUDGE } from './arrange.js'

const clone = (x) => JSON.parse(JSON.stringify(x))

/** What is selected, as records ready to be pasted. */
export function copyRecords(elements, decorations, pickedIds) {
  const want = new Set(pickedIds || [])
  return {
    elements: (elements || []).filter((e) => want.has(e.id)).map((e) => ({ ...clone(e), after: '' })),
    decorations: (decorations || []).filter((d) => want.has(d.id)).map(clone),
  }
}

/**
 * New records from a clip, with fresh ids, offset so they are visibly copies.
 *
 * `times` is how many pastes of this clip have gone before, so the fifth paste
 * is offset five steps rather than landing on the fourth. `room` is how many
 * more drawn shapes the design will hold; anything past it is left out and
 * counted in `refused`, so the screen can say so rather than dropping them in
 * silence. Fields have no cap here — a field is a column of the register, and
 * the design's own validator is the place that says a design is wrong.
 */
export function pasteRecords(clip, { nextId, nextDecoId, nextGroupId, room = Infinity, times = 1 } = {}) {
  const by = NUDGE * Math.max(1, times)
  const groups = new Map()
  const freshGroup = (g) => {
    if (!g) return ''
    if (!groups.has(g)) groups.set(g, nextGroupId())
    return groups.get(g)
  }
  const elements = (clip?.elements || []).map((e) => ({
    ...clone(e), id: nextId(), after: '', box: offsetBox(e.box, by),
  }))
  const all = (clip?.decorations || [])
  const fits = Math.max(0, Math.min(all.length, room))
  const decorations = all.slice(0, fits).map((d) => ({
    ...clone(d), id: nextDecoId(), group: freshGroup(d.group), box: offsetBox(d.box, by),
  }))
  return { elements, decorations, refused: all.length - fits }
}
