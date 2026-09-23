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
 *
 * `inPlace` lands the copies exactly on their originals (⇧⌘V, and ⌥-drag,
 * which then drags the copies away). `step` moves them by an exact distance
 * instead of the usual nudge — Duplicate repeating the last move. `pairs` says
 * which new id came from which old one, which is what a repeat is measured
 * from.
 */
export function pasteRecords(clip, {
  nextId, nextDecoId, nextGroupId, room = Infinity, times = 1, inPlace = false, step = null,
} = {}) {
  const by = NUDGE * Math.max(1, times)
  const place = (b, drawn) => (step ? stepBox(b, step, drawn) : inPlace ? { ...b } : offsetBox(b, by))
  const groups = new Map()
  const freshGroup = (g) => {
    if (!g) return ''
    if (!groups.has(g)) groups.set(g, nextGroupId())
    return groups.get(g)
  }
  const pairs = []
  const elements = (clip?.elements || []).map((e) => {
    const id = nextId()
    pairs.push({ copy: id, from: e.id, box: { ...e.box } })
    return { ...clone(e), id, after: '', box: place(e.box, false) }
  })
  const all = (clip?.decorations || [])
  const fits = Math.max(0, Math.min(all.length, room))
  const decorations = all.slice(0, fits).map((d) => {
    const id = nextDecoId()
    pairs.push({ copy: id, from: d.id, box: { ...d.box } })
    return { ...clone(d), id, group: freshGroup(d.group), box: place(d.box, true) }
  })
  return { elements, decorations, refused: all.length - fits, pairs }
}

/*
 * A BOX MOVED BY AN EXACT STEP, kept where its kind may be: a field stays on
 * the artwork, a drawing may hang off it within the model's own limits.
 */
const tidy = (v) => Math.round(v * 1e7) / 1e7
export function stepBox(box, { dx = 0, dy = 0 } = {}, drawn = false) {
  const [lo, hi] = drawn ? [-1, 2] : [0, 1]
  const at = (v, size) => tidy(Math.max(lo, Math.min(hi - size, v)))
  return { ...box, left: at(box.left + dx, box.width), top: at(box.top + dy, box.height) }
}

/*
 * DUPLICATE, AGAIN, REPEATS THE LAST MOVE.
 *
 * Duplicate a box, drag the copy 100px to the right, press Duplicate again:
 * the next copy lands another 100px on, and the one after that another. That
 * is how a row of evenly spaced things is made in every drawing program, and
 * it only works if the step is measured, not assumed. `last` is the `pairs`
 * of the previous duplicate; the step is where its copy is NOW minus where its
 * original WAS. Anything else selected, and there is nothing to repeat.
 */
export function repeatStep(last, pickedIds, boxOf) {
  if (!last?.length || !pickedIds?.length || pickedIds.length !== last.length) return null
  const want = new Set(pickedIds)
  if (!last.every((p) => want.has(p.copy))) return null
  const now = boxOf(last[0].copy)
  if (!now) return null
  return { dx: tidy(now.left - last[0].box.left), dy: tidy(now.top - last[0].box.top) }
}
