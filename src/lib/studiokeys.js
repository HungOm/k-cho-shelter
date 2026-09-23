/*
 * EVERY KEY THE STUDIO ANSWERS, AS ONE TABLE.
 *
 * The studio's shortcuts were a chain of `if` statements in one handler, and
 * the only record of them was two tooltips that mentioned ⌘Z. So the keys
 * could not be found without reading the source, and nothing stopped a key
 * being added to the handler and to no documentation, or the other way round.
 *
 * Now the handler looks keys up here and the shortcuts sheet lists them from
 * here, so the two cannot disagree: tests/studiokeys.test.mjs holds that every
 * action named in this table is one the studio performs, and every one it
 * performs is named here.
 *
 * WHAT A ROW IS
 *
 *   id       the name a tooltip asks for (`keyOf('duplicate')`)
 *   group    the sheet's heading
 *   label    what it does, in the words the tool itself uses
 *   action   the studio function it runs — or absent for a row that only
 *            documents a key handled elsewhere (the arrows nudge through the
 *            focused box; Space is released on keyup)
 *   when     'place' — only on the Place tab, where the selection is; or
 *            'any' — on every tab
 *   combo    { key | code, cmd, shift, alt }. `code` is the PHYSICAL key, for
 *            the brackets: on a Mac, ⌥ changes the character a key types, so
 *            ⌥⌘] arrives as a quotation mark and only its code is still ].
 *            `shift: null` means "whatever shift is" — for ? and +, which are
 *            shifted characters on most keyboards and not on others.
 *   also     other combos that do the same, shown after "or"
 *   inFields true where the key still works while typing in a field — only
 *            ⌘\, which cannot be typed
 */

export const KEYS = [
  /* ---- tools: put something on the ticket ---- */
  { id: 'toolSelect', group: 'Tools', label: 'Select — put the tool down', action: 'toolSelect', when: 'place', combo: { key: 'v' } },
  { id: 'toolRect', group: 'Tools', label: 'Rectangle', action: 'toolRect', when: 'place', combo: { key: 'r' } },
  { id: 'toolEllipse', group: 'Tools', label: 'Ellipse', action: 'toolEllipse', when: 'place', combo: { key: 'e' } },
  { id: 'toolLine', group: 'Tools', label: 'Line', action: 'toolLine', when: 'place', combo: { key: 'l' } },
  { id: 'toolWords', group: 'Tools', label: 'Words', action: 'toolWords', when: 'place', combo: { key: 't' } },
  { id: 'toolMark', group: 'Tools', label: 'Mark', action: 'toolMark', when: 'place', combo: { key: 'm' } },
  { id: 'toolPicture', group: 'Tools', label: 'Picture', action: 'toolPicture', when: 'place', combo: { key: 'i' } },
  { id: 'toolPen', group: 'Tools', label: 'Pen — click for corners, drag for curves', action: 'toolPen', when: 'place', combo: { key: 'p' } },
  { id: 'editNodes', group: 'Tools', label: 'Edit the nodes of the selected path', action: 'editNodes', when: 'place', combo: { key: 'a' } },
  { id: 'penFinish', group: 'Tools', label: 'Finish the path being drawn', action: 'penFinish', when: 'place', combo: { key: 'Enter' } },

  /* ---- the selection ---- */
  { id: 'selectAll', group: 'Selection', label: 'Select everything on the ticket', action: 'selectAll', when: 'place', combo: { key: 'a', cmd: true } },
  { id: 'escape', group: 'Selection', label: 'Put the tool down, then let go', action: 'escape', when: 'place', combo: { key: 'Escape' } },
  { id: 'copy', group: 'Selection', label: 'Copy', action: 'copy', when: 'place', combo: { key: 'c', cmd: true } },
  { id: 'cut', group: 'Selection', label: 'Cut', action: 'cut', when: 'place', combo: { key: 'x', cmd: true } },
  { id: 'paste', group: 'Selection', label: 'Paste', action: 'paste', when: 'place', combo: { key: 'v', cmd: true } },
  { id: 'duplicate', group: 'Selection', label: 'Duplicate', action: 'duplicate', when: 'place', combo: { key: 'd', cmd: true } },
  { id: 'remove', group: 'Selection', label: 'Remove', action: 'remove', when: 'place', combo: { key: 'Delete' }, also: [{ key: 'Backspace' }] },
  { id: 'group', group: 'Selection', label: 'Group', action: 'group', when: 'place', combo: { key: 'g', cmd: true } },
  { id: 'ungroup', group: 'Selection', label: 'Ungroup', action: 'ungroup', when: 'place', combo: { key: 'g', cmd: true, shift: true } },
  { id: 'nudge', group: 'Selection', label: 'Nudge a tenth of a percent', when: 'place', combo: { key: 'ArrowRight' }, doc: 'Arrow keys' },
  { id: 'nudgeFar', group: 'Selection', label: 'Nudge one percent', when: 'place', combo: { key: 'ArrowRight', shift: true }, doc: '⇧ + arrow keys' },

  /* ---- stacking ---- */
  { id: 'forward', group: 'Stacking', label: 'Bring forward', action: 'forward', when: 'place', combo: { code: 'BracketRight', cmd: true } },
  { id: 'backward', group: 'Stacking', label: 'Send backward', action: 'backward', when: 'place', combo: { code: 'BracketLeft', cmd: true } },
  { id: 'front', group: 'Stacking', label: 'Bring to front', action: 'front', when: 'place', combo: { code: 'BracketRight', cmd: true, alt: true } },
  { id: 'back', group: 'Stacking', label: 'Send to back', action: 'back', when: 'place', combo: { code: 'BracketLeft', cmd: true, alt: true } },

  /* ---- history ---- */
  /* On every tab, against that tab's own history: the digital card keeps a
     stack of its own, and its Redo had promised ⇧⌘Z while the key did
     nothing anywhere but Place. */
  { id: 'undo', group: 'History', label: 'Undo', action: 'undo', when: 'any', combo: { key: 'z', cmd: true } },
  { id: 'redo', group: 'History', label: 'Redo', action: 'redo', when: 'any', combo: { key: 'z', cmd: true, shift: true } },

  /* ---- the view ---- */
  { id: 'zoomIn', group: 'View', label: 'Zoom in', action: 'zoomIn', when: 'place', combo: { key: '+', shift: null }, also: [{ key: '=' }] },
  { id: 'zoomOut', group: 'View', label: 'Zoom out', action: 'zoomOut', when: 'place', combo: { key: '-' }, also: [{ key: '_', shift: null }] },
  { id: 'fit', group: 'View', label: 'Fit', action: 'fit', when: 'place', combo: { key: '0', cmd: true }, also: [{ key: '0' }] },
  /* ⌘1 is also on the table, but Chrome on a Mac keeps ⌘1 for its own tabs and
     never hands it to the page — so the bare 1 is what reliably works, and the
     sheet shows both. */
  { id: 'actual', group: 'View', label: 'Actual size', action: 'actual', when: 'place', combo: { key: '1' }, also: [{ key: '1', cmd: true }] },
  { id: 'hand', group: 'View', label: 'Hold to pan — drag the artboard', action: 'hand', when: 'place', combo: { key: ' ' }, doc: 'Space + drag' },

  /* ---- the studio ---- */
  { id: 'focus', group: 'Studio', label: 'Bring the navigation back', action: 'focus', when: 'any', inFields: true, combo: { key: '\\', cmd: true } },
  { id: 'help', group: 'Studio', label: 'These shortcuts', action: 'help', when: 'any', combo: { key: '?', shift: null } },
]

const NAMES = {
  ' ': 'Space', Escape: 'Esc', Delete: 'Delete', Backspace: '⌫',
  ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', '\\': '\\',
}
const CODES = { BracketRight: ']', BracketLeft: '[' }

/** How one combo is written: ⇧⌘G, ⌥⌘], Esc. Modifiers in the macOS order. */
export function comboLabel(c) {
  if (!c) return ''
  const mods = `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.cmd ? '⌘' : ''}`
  const k = c.code ? CODES[c.code] || c.code
    : NAMES[c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key)
  return mods + k
}

/** The short form a tooltip carries: the row's first combo, or its doc text. */
export function keyLabel(row) {
  if (!row) return ''
  return row.doc || comboLabel(row.combo)
}

/** Every way a row may be pressed, first one first. */
export const combosOf = (row) => [row.combo, ...(row.also || [])].filter(Boolean)

/**
 * Whether a keyboard event is this combo. ⌘ on a Mac and Ctrl elsewhere are
 * the same modifier here, as the studio has always treated them.
 */
export function keyMatches(c, e) {
  if (!c || !e) return false
  const cmd = !!(e.metaKey || e.ctrlKey)
  if (cmd !== !!c.cmd) return false
  if (!!e.altKey !== !!c.alt) return false
  if (c.shift !== null && !!e.shiftKey !== !!c.shift) return false
  if (c.code) return e.code === c.code
  const k = String(e.key || '')
  return k.length === 1 ? k.toLowerCase() === c.key.toLowerCase() : k === c.key
}

/** The row a keypress means on this tab, or null. Documentation-only rows never match. */
export function findBinding(e, where, keys = KEYS) {
  for (const row of keys) {
    if (!row.action) continue
    if (row.when !== 'any' && row.when !== where) continue
    if (combosOf(row).some((c) => keyMatches(c, e))) return row
  }
  return null
}
