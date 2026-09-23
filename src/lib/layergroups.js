/*
 * THE LAYER LIST, WITH GROUPS FOLDED.
 *
 * A placed library shape, or seventeen copies of a logo grouped into one row,
 * is ONE thing to the person who made it and seventeen rows to a flat list —
 * which pushes everything else in the panel off the bottom of the screen and
 * makes the list a scroll to get past rather than a register to read. Every
 * layer list in every drawing program shows a group as one row that opens.
 *
 * This is the arithmetic of that: which rows there are, in what order, and
 * what a group row says about its members. The screens draw it. Pure, so the
 * printed tab and the card tab fold the same way and the tests can reach it.
 *
 * ORDER. Rows read from the front, as the list always has: the drawing that
 * prints on top is the top row. A group sits where its FRONTMOST member is,
 * and its members follow it, front first, when it is open.
 *
 * OPEN. A group is open when somebody opened it, and also while one part of
 * it is selected on its own (a double-click or ⌘-click into the group) —
 * otherwise the selected row would be folded away where nobody can see it.
 *
 * PINNED AND SHOWN are "all of it". A group is pinned only when every member
 * is, and pressing pin on a half-pinned group pins the rest — the same rule
 * as ⇧⌘L on a selection (lockPicked), so the row and the key never disagree
 * about what a half-pinned group is. The eye follows the same rule.
 */

/* As pairs: the icons gate reads every `icon: '…'` in src as a glyph being
   asked for, and the Mark kind is called `icon`. */
const PLURAL = Object.fromEntries([
  ['rect', 'rectangles'], ['ellipse', 'ellipses'], ['line', 'rules'], ['text', 'words'],
  ['icon', 'marks'], ['image', 'pictures'], ['path', 'paths'],
])

/** What a group row is called: "17 pictures", or "Group of 5" when mixed. */
export function groupLabel(members) {
  const n = members.length
  const kinds = new Set(members.map((m) => m.kind))
  if (kinds.size === 1) return `${n} ${PLURAL[[...kinds][0]] || 'shapes'}`
  return `Group of ${n}`
}

/**
 * The rows of the list. `decorations` in draw order (back first), as the model
 * stores them. `open` is the set of group ids somebody has opened; `picked` is
 * the selection. A group of one is not folded: a row that opens to show the
 * same row is a click that does nothing.
 */
export function layerRows(decorations, { open = new Set(), picked = [] } = {}) {
  const front = [...(decorations || [])].reverse()
  const byGroup = new Map()
  for (const d of front) {
    if (!d.group) continue
    if (!byGroup.has(d.group)) byGroup.set(d.group, [])
    byGroup.get(d.group).push(d)
  }
  const want = new Set(picked)
  const done = new Set()
  const rows = []
  for (const d of front) {
    const members = d.group ? byGroup.get(d.group) : null
    if (!members || members.length < 2) { rows.push({ kind: 'item', id: d.id, deco: d, depth: 0 }); continue }
    if (done.has(d.group)) continue
    done.add(d.group)
    const some = members.some((m) => want.has(m.id))
    const all = members.every((m) => want.has(m.id))
    const isOpen = open.has(d.group) || (some && !all)
    rows.push({
      kind: 'group', id: `group:${d.group}`, group: d.group, members, open: isOpen,
      picked: all, pinned: members.every((m) => m.locked), shown: members.every((m) => m.enabled !== false),
      label: groupLabel(members),
    })
    if (isOpen) for (const m of members) rows.push({ kind: 'item', id: m.id, deco: m, depth: 1 })
  }
  return rows
}

/** Pin a group: all of it if any is loose, otherwise release all of it. */
export const nextPinned = (members) => members.some((m) => !m.locked)
/** Show a group: all of it if any is hidden, otherwise hide all of it. */
export const nextShown = (members) => members.some((m) => m.enabled === false)

/*
 * WHAT A DRAWING IS CALLED IN A LIST, on both tabs. What somebody named it
 * first; then its words, if it has words; the mark's name, if it is a mark;
 * the kind otherwise. Every one is stable when something above is deleted.
 * One function, because the card's list had its own copy that stopped at the
 * kind — five text drawings on the card all read "Words", and the same
 * drawing was called two things depending on the tab it was seen from.
 */
const WORD = Object.fromEntries([
  ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Rule'], ['text', 'Words'],
  ['icon', 'Mark'], ['image', 'Picture'], ['path', 'Path'],
])
export const drawingWord = (kind) => WORD[kind] || 'Shape'
export function drawingName(d) {
  if (d?.name) return d.name
  const typed = String(d?.text?.value ?? '').trim()
  if (d?.kind === 'text' && typed) return `“${typed.length > 22 ? `${typed.slice(0, 21)}…` : typed}”`
  if (d?.kind === 'icon' && d.icon?.name) return `Mark · ${d.icon.name}`
  return drawingWord(d?.kind)
}

/* The glyph a drawing's row wears — the same one its tool on the rail wears,
   so the list and the rail name a kind the same way. (Pairs, for the icons
   gate, as above.) */
const GLYPH = Object.fromEntries([
  ['rect', 'shape'], ['ellipse', 'ellipse'], ['line', 'minus'], ['text', 'type'],
  ['icon', 'design'], ['image', 'image'], ['path', 'pen'],
])
export const drawingIcon = (kind) => GLYPH[kind] || 'shape'
