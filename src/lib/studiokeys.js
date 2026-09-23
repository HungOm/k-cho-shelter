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
 *   when     'place' — only on the Place tab; 'canvas' — on both drawing
 *            surfaces, the Place tab and the Digital ticket tab, which each
 *            run it against their own selection; 'any' — on every tab
 *   combo    { key | code, cmd, shift, alt }, or null for a COMMAND — a row
 *            with no key, offered only by the command palette (⌘K). `code` is the PHYSICAL key, for
 *            the brackets: on a Mac, ⌥ changes the character a key types, so
 *            ⌥⌘] arrives as a quotation mark and only its code is still ].
 *            `shift: null` means "whatever shift is" — for ? and +, which are
 *            shifted characters on most keyboards and not on others.
 *   also     other combos that do the same, shown after "or"
 *   inFields true where the key still works while typing in a field — ⌘\,
 *            which cannot be typed, and ⌘S, which every editor saves on
 *            wherever the cursor is
 *   doc      how the sheet writes a gesture rather than a combo; {cmd},
 *            {shift} and {alt} become ⌘ ⇧ ⌥ on a Mac and Ctrl Shift Alt
 *            elsewhere
 *
 * WHICH CONVENTIONS, AND WHY THESE. Undo, copy, paste, duplicate, group,
 * the arrows, ⌥-drag to copy, Shift to constrain and Space to pan are the
 * conventions every drawing program shares, and they are all here with the
 * keys those programs use. Where programs disagree the table takes the most
 * common reading — ⇧⌘] to the front, O for an ellipse, I for the eyedropper —
 * and keeps the studio's earlier key as an `also`, so nobody's habit breaks.
 * Keys the browser keeps for itself (⌘N, ⌘W, ⌘T; ⌘1 and ⌘2 on a Mac) are not
 * bound: a shortcut the page is never handed is a promise that fails.
 */

export const KEYS = [
  /* ---- tools: put something on the ticket ---- */
  { id: 'toolSelect', group: 'Tools', label: 'Select — put the tool down', action: 'toolSelect', when: 'canvas', combo: { key: 'v' } },
  { id: 'toolHand', group: 'Tools', label: 'Hand — drag to move around', action: 'toolHand', when: 'canvas', combo: { key: 'h' } },
  { id: 'toolRect', group: 'Tools', label: 'Rectangle', action: 'toolRect', when: 'canvas', combo: { key: 'r' } },
  { id: 'toolEllipse', group: 'Tools', label: 'Ellipse', action: 'toolEllipse', when: 'canvas', combo: { key: 'o' }, also: [{ key: 'e' }] },
  { id: 'toolLine', group: 'Tools', label: 'Line', action: 'toolLine', when: 'canvas', combo: { key: 'l' } },
  { id: 'toolWords', group: 'Tools', label: 'Words', action: 'toolWords', when: 'canvas', combo: { key: 't' } },
  { id: 'toolMark', group: 'Tools', label: 'Mark', action: 'toolMark', when: 'canvas', combo: { key: 'm' } },
  { id: 'toolPen', group: 'Tools', label: 'Pen — click for corners, drag for curves', action: 'toolPen', when: 'canvas', combo: { key: 'p' } },
  { id: 'toolPicture', group: 'Tools', label: 'Place a picture', action: 'toolPicture', when: 'canvas', combo: { key: 'k', cmd: true, shift: true } },
  { id: 'eyedropper', group: 'Tools', label: 'Eyedropper — colour the selection from the screen', action: 'eyedropper', when: 'canvas', combo: { key: 'i' } },
  { id: 'editNodes', group: 'Tools', label: 'Edit the nodes of the selected path', action: 'editNodes', when: 'canvas', combo: { key: 'a' } },
  { id: 'penFinish', group: 'Tools', label: 'Finish the path being drawn', action: 'penFinish', when: 'canvas', combo: { key: 'Enter' } },

  /* ---- the selection ---- */
  { id: 'selectAll', group: 'Selection', label: 'Select everything', action: 'selectAll', when: 'canvas', combo: { key: 'a', cmd: true } },
  { id: 'deselect', group: 'Selection', label: 'Select nothing', action: 'deselect', when: 'canvas', combo: { key: 'a', cmd: true, shift: true } },
  { id: 'escape', group: 'Selection', label: 'Put the tool down, leave the group, then let go', action: 'escape', when: 'canvas', combo: { key: 'Escape' } },
  { id: 'addToSelection', group: 'Selection', label: 'Add to the selection, or take out of it', when: 'canvas', combo: null, doc: '{shift} + click' },
  { id: 'enterGroup', group: 'Selection', label: 'One part of a group', when: 'canvas', combo: null, doc: 'Double-click · {cmd} + click' },
  { id: 'copy', group: 'Selection', label: 'Copy', action: 'copy', when: 'canvas', combo: { key: 'c', cmd: true } },
  { id: 'cut', group: 'Selection', label: 'Cut', action: 'cut', when: 'canvas', combo: { key: 'x', cmd: true } },
  { id: 'paste', group: 'Selection', label: 'Paste', action: 'paste', when: 'canvas', combo: { key: 'v', cmd: true } },
  { id: 'pasteInPlace', group: 'Selection', label: 'Paste in place', action: 'pasteInPlace', when: 'canvas', combo: { key: 'v', cmd: true, shift: true } },
  { id: 'duplicate', group: 'Selection', label: 'Duplicate — again repeats the last move', action: 'duplicate', when: 'canvas', combo: { key: 'd', cmd: true } },
  { id: 'remove', group: 'Selection', label: 'Remove', action: 'remove', when: 'canvas', combo: { key: 'Delete' }, also: [{ key: 'Backspace' }] },
  { id: 'group', group: 'Selection', label: 'Group', action: 'group', when: 'canvas', combo: { key: 'g', cmd: true } },
  { id: 'ungroup', group: 'Selection', label: 'Ungroup', action: 'ungroup', when: 'canvas', combo: { key: 'g', cmd: true, shift: true } },
  { id: 'lock', group: 'Selection', label: 'Pin or unpin — a pinned thing cannot be dragged', action: 'lock', when: 'canvas', combo: { key: 'l', cmd: true, shift: true } },
  { id: 'bold', group: 'Selection', label: 'Bold lettering on or off', action: 'bold', when: 'canvas', combo: { key: 'b', cmd: true } },

  /* ---- moving and sizing ---- */
  { id: 'nudge', group: 'Move and size', label: 'Nudge one pixel', action: 'nudge', when: 'canvas',
    combo: { key: 'ArrowRight' }, also: [{ key: 'ArrowLeft' }, { key: 'ArrowUp' }, { key: 'ArrowDown' }], doc: 'Arrow keys' },
  { id: 'nudgeFar', group: 'Move and size', label: 'Nudge ten pixels', action: 'nudge', when: 'canvas',
    combo: { key: 'ArrowRight', shift: true },
    also: [{ key: 'ArrowLeft', shift: true }, { key: 'ArrowUp', shift: true }, { key: 'ArrowDown', shift: true }], doc: '{shift} + arrow keys' },
  { id: 'altDrag', group: 'Move and size', label: 'Drag a copy, leaving the original', when: 'canvas', combo: null, doc: '{alt} + drag' },
  { id: 'shiftDrag', group: 'Move and size', label: 'Drag in a straight line', when: 'canvas', combo: null, doc: '{shift} + drag' },
  { id: 'shiftResize', group: 'Move and size', label: 'Keep the proportions', when: 'canvas', combo: null, doc: '{shift} + drag a handle' },
  { id: 'altResize', group: 'Move and size', label: 'Resize about the centre', when: 'canvas', combo: null, doc: '{alt} + drag a handle' },
  { id: 'shiftDraw', group: 'Move and size', label: 'Draw a square, a circle, or a level or 45° line', when: 'canvas', combo: null, doc: '{shift} + draw' },
  { id: 'altDraw', group: 'Move and size', label: 'Draw out from the centre', when: 'canvas', combo: null, doc: '{alt} + draw' },

  /* ---- stacking ---- */
  { id: 'forward', group: 'Stacking', label: 'Bring forward', action: 'forward', when: 'canvas', combo: { code: 'BracketRight', cmd: true } },
  { id: 'backward', group: 'Stacking', label: 'Send backward', action: 'backward', when: 'canvas', combo: { code: 'BracketLeft', cmd: true } },
  { id: 'front', group: 'Stacking', label: 'Bring to front', action: 'front', when: 'canvas',
    combo: { code: 'BracketRight', cmd: true, shift: true }, also: [{ code: 'BracketRight', cmd: true, alt: true }] },
  { id: 'back', group: 'Stacking', label: 'Send to back', action: 'back', when: 'canvas',
    combo: { code: 'BracketLeft', cmd: true, shift: true }, also: [{ code: 'BracketLeft', cmd: true, alt: true }] },

  /* ---- history ---- */
  /* On every tab, against that tab's own history: the digital card keeps a
     stack of its own, and its Redo had promised ⇧⌘Z while the key did
     nothing anywhere but Place. */
  { id: 'undo', group: 'History', label: 'Undo', action: 'undo', when: 'any', combo: { key: 'z', cmd: true } },
  { id: 'redo', group: 'History', label: 'Redo', action: 'redo', when: 'any', combo: { key: 'z', cmd: true, shift: true } },

  /* ---- the view ---- */
  /* ⌘+ arrives as ⌘= on most keyboards, because + is the shifted =; both are
     taken, and the page keeps them from the browser's own zoom. The bare keys
     stay as they were. */
  { id: 'zoomIn', group: 'View', label: 'Zoom in', action: 'zoomIn', when: 'canvas',
    combo: { key: '+', cmd: true, shift: null }, also: [{ key: '+', shift: null }, { key: '=', cmd: true, shift: null }, { key: '=' }] },
  { id: 'zoomOut', group: 'View', label: 'Zoom out', action: 'zoomOut', when: 'canvas',
    combo: { key: '-', cmd: true }, also: [{ key: '-' }, { key: '_', cmd: true, shift: null }, { key: '_', shift: null }] },
  { id: 'wheelZoom', group: 'View', label: 'Zoom about the pointer', when: 'canvas', combo: null, doc: '{cmd} + scroll · pinch' },
  { id: 'fit', group: 'View', label: 'Fit', action: 'fit', when: 'canvas', combo: { key: '0', cmd: true }, also: [{ key: '0' }] },
  /* ⌘1 is also on the table, but Chrome on a Mac keeps ⌘1 for its own tabs and
     never hands it to the page — so the bare 1 is what reliably works, and the
     sheet shows both. */
  { id: 'actual', group: 'View', label: 'Actual size', action: 'actual', when: 'canvas', combo: { key: '1' }, also: [{ key: '1', cmd: true }] },
  { id: 'hand', group: 'View', label: 'Hold to pan — drag the artboard', action: 'hand', when: 'canvas', combo: { key: ' ' }, doc: 'Space + drag' },

  /* ---- the file ---- */
  { id: 'save', group: 'File', label: 'Save', action: 'save', when: 'any', inFields: true, combo: { key: 's', cmd: true } },
  { id: 'exportPng', group: 'File', label: 'Download a sample ticket as PNG', action: 'exportPng', when: 'place', combo: { key: 'e', cmd: true } },

  /* ---- the studio ---- */
  { id: 'palette', group: 'Studio', label: 'Find a command', action: 'palette', when: 'any', combo: { key: 'k', cmd: true } },
  { id: 'focus', group: 'Studio', label: 'Bring the navigation back', action: 'focus', when: 'any', inFields: true, combo: { key: '\\', cmd: true } },
  { id: 'help', group: 'Studio', label: 'These shortcuts', action: 'help', when: 'any', combo: { key: '?', shift: null } },

  /* ---- commands with no key: the palette (⌘K) offers them by name ---- */
  { id: 'alignLeft', group: 'Arrange', label: 'Align left', action: 'alignLeft', when: 'canvas', combo: null },
  { id: 'alignCentre', group: 'Arrange', label: 'Centre across', action: 'alignCentre', when: 'canvas', combo: null },
  { id: 'alignRight', group: 'Arrange', label: 'Align right', action: 'alignRight', when: 'canvas', combo: null },
  { id: 'alignTop', group: 'Arrange', label: 'Align top', action: 'alignTop', when: 'canvas', combo: null },
  { id: 'alignMiddle', group: 'Arrange', label: 'Centre down', action: 'alignMiddle', when: 'canvas', combo: null },
  { id: 'alignBottom', group: 'Arrange', label: 'Align bottom', action: 'alignBottom', when: 'canvas', combo: null },
  { id: 'spaceAcross', group: 'Arrange', label: 'Space evenly across', action: 'spaceAcross', when: 'canvas', combo: null },
  { id: 'spaceDown', group: 'Arrange', label: 'Space evenly down', action: 'spaceDown', when: 'canvas', combo: null },
  { id: 'flipAcross', group: 'Arrange', label: 'Flip across', action: 'flipAcross', when: 'place', combo: null },
  { id: 'flipDown', group: 'Arrange', label: 'Flip down', action: 'flipDown', when: 'place', combo: null },
  { id: 'toggleSnap', group: 'View', label: 'Snap on or off', action: 'toggleSnap', when: 'canvas', combo: null },
  { id: 'toggleGrid', group: 'View', label: 'Grid on or off', action: 'toggleGrid', when: 'canvas', combo: null },
  { id: 'greyPreview', group: 'View', label: 'Preview in grey on or off', action: 'greyPreview', when: 'place', combo: null },
  { id: 'exportSvg', group: 'File', label: 'Download a sample ticket as SVG', action: 'exportSvg', when: 'place', combo: null },
]

/* A Mac, where ⌘ is the modifier and the glyphs are the way keys are written.
   Everywhere else the same combos are pressed with Ctrl and spelt in words. */
export const IS_MAC = (() => {
  if (typeof navigator === 'undefined') return true
  const p = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(p)
})()

const NAMES = {
  ' ': 'Space', Escape: 'Esc', Delete: 'Delete', Backspace: '⌫', Enter: 'Enter',
  ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', '\\': '\\',
}
const PC_NAMES = { Backspace: 'Backspace' }
const CODES = { BracketRight: ']', BracketLeft: '[' }

/** How one combo is written: ⇧⌘G, ⌥⌘], Esc on a Mac; Ctrl+Shift+G elsewhere. */
export function comboLabel(c, mac = IS_MAC) {
  if (!c) return ''
  const k = c.code ? CODES[c.code] || c.code
    : (!mac && PC_NAMES[c.key]) || NAMES[c.key] || (c.key.length === 1 ? c.key.toUpperCase() : c.key)
  if (mac) return `${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.cmd ? '⌘' : ''}${k}`
  return [c.cmd && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', k].filter(Boolean).join('+')
}

/** A gesture's words, with its modifiers spelt for this platform. */
export function docLabel(doc, mac = IS_MAC) {
  const m = mac ? { cmd: '⌘', shift: '⇧', alt: '⌥' } : { cmd: 'Ctrl', shift: 'Shift', alt: 'Alt' }
  return String(doc || '').replace(/\{(cmd|shift|alt)\}/g, (_, n) => m[n])
}

/** The short form a tooltip carries: the row's first combo, or its doc text. */
export function keyLabel(row, mac = IS_MAC) {
  if (!row) return ''
  return row.doc ? docLabel(row.doc, mac) : comboLabel(row.combo, mac)
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

/** Whether a row answers on this tab: 'place', 'digital', or any other tab's id. */
export const answersOn = (row, where) => row.when === 'any' || row.when === where
  || (row.when === 'canvas' && (where === 'place' || where === 'digital'))

/** The row a keypress means on this tab, or null. Documentation-only rows never match. */
export function findBinding(e, where, keys = KEYS) {
  for (const row of keys) {
    if (!row.action || !answersOn(row, where)) continue
    if (combosOf(row).some((c) => keyMatches(c, e))) return row
  }
  return null
}

/*
 * WHEN A KEY BELONGS TO THE FIELD UNDER THE CURSOR, NOT TO THE STUDIO.
 *
 * Everything that TYPES keeps every key but the ones that cannot be typed —
 * Delete in a motto deletes a character, ⌘A selects the words in the box. But
 * a checkbox, a slider or a dropdown types nothing, and treating them as text
 * fields was a trap: one click on a switch and every shortcut in the studio
 * went dead until somebody clicked the artboard again. Those keep only the
 * keys they use themselves: Space and the arrows on a checkbox or slider, and
 * the plain keys a dropdown searches its options with.
 */
const TEXTUAL = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'])
export function fieldOwns(target, e, row) {
  if (!target || row?.inFields) return false
  const tag = String(target.tagName || '').toUpperCase()
  const cmd = !!(e.metaKey || e.ctrlKey)
  if (target.isContentEditable || tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = String(target.type || '').toLowerCase()
    if (TEXTUAL.has(type)) return true
    return !cmd && (e.key === ' ' || e.key === 'Enter' || String(e.key).startsWith('Arrow'))
  }
  if (tag === 'SELECT') return !cmd
  return false
}
