/*
 * Every key the studio answers is on its sheet, and every key on the sheet works.
 *
 * WHY THIS IS NEEDED. The studio's shortcuts were a chain of `if`s in one
 * handler and two tooltips that mentioned ⌘Z — and one of those tooltips was
 * false: the digital card's Redo said ⇧⌘Z, and the handler answered nothing
 * off the Place tab. src/lib/studiokeys.js is now the one table both the
 * handler and the shortcuts sheet read. What can still drift is the studio's
 * ACTIONS object against the table's `action` names, and a tooltip naming a key
 * id that does not exist; both are checked here as IDENTITIES, both ways.
 *
 * THE CARD ANSWERS TOO. The Digital ticket tab had drawings, a pen and a
 * library, and not one of copy, paste, Delete or the arrows: the studio's
 * table said 'place' and the card had no table of its own. A 'canvas' row is
 * now answered by whichever surface is showing, so the card's CARD_ACTIONS is
 * held to the table here the same way the studio's ACTIONS is.
 *
 * AND A CHECKBOX IS NOT A TEXT FIELD. Treating every <input> as somewhere
 * somebody types meant one click on a switch silenced every shortcut in the
 * studio. fieldOwns is checked against each kind of field.
 *
 * WHAT THIS CANNOT DO. It does not press keys in a browser. Two platform facts
 * it cannot see are recorded in the table itself: ⌥ changes the character a Mac
 * key types (so the brackets match by `code`), and Chrome on a Mac never hands
 * ⌘1 to the page (so actual size also answers a bare 1).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KEYS, keyMatches, findBinding, keyLabel, comboLabel, combosOf, fieldOwns, docLabel, STUDIO_HOLDS } from '../src/lib/studiokeys.js'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')

const ev = (key, mods = {}) => ({ key, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })

console.log('the table was read, and its rows are distinct')
{
  ok(KEYS.length > 20, `${KEYS.length} rows in the table`)
  const ids = KEYS.map((k) => k.id)
  eq(new Set(ids).size, ids.length, 'every row has its own id')
  /* Two rows answering one combo on one tab would make the second unreachable. */
  const seen = new Map()
  for (const row of KEYS.filter((k) => k.action)) {
    for (const c of combosOf(row)) {
      const tabs = { any: ['place', 'artwork', 'digital'], canvas: ['place', 'digital'] }[row.when] || [row.when]
      for (const where of tabs) {
        const sig = `${where}|${c.code || c.key.toLowerCase()}|${!!c.cmd}|${c.shift === null ? '*' : !!c.shift}|${!!c.alt}`
        ok(!seen.has(sig), `${row.id} does not share ${comboLabel(c)} with ${seen.get(sig)} on ${where}`)
        seen.set(sig, row.id)
      }
    }
  }
}

console.log('a keypress finds the row it means')
{
  eq(findBinding(ev('c', { metaKey: true }), 'place')?.id, 'copy', '⌘C is copy')
  eq(findBinding(ev('c', { ctrlKey: true }), 'place')?.id, 'copy', 'and so is Ctrl+C, off a Mac')
  eq(findBinding(ev('Z', { metaKey: true, shiftKey: true }), 'place')?.id, 'redo', '⇧⌘Z is redo, whatever case the letter arrives in')
  eq(findBinding(ev('z', { metaKey: true }), 'digital')?.id, 'undo', 'and undo answers on the card\'s tab too')
  eq(findBinding(ev('v'), 'place')?.id, 'toolSelect', 'a bare V puts the tool down')
  eq(findBinding(ev('v', { metaKey: true }), 'place')?.id, 'paste', 'while ⌘V pastes')
  eq(findBinding(ev('“', { code: 'BracketRight', metaKey: true, altKey: true }), 'place')?.id, 'front',
    '⌥⌘] is found by the physical key, though a Mac types a quotation mark for it')
  eq(findBinding(ev('?', { shiftKey: true }), 'artwork')?.id, 'help', '? opens the sheet on any tab')
  eq(findBinding(ev('r'), 'artwork'), null, 'a Place tool key does nothing on another tab')
  eq(findBinding(ev('ArrowRight'), 'place')?.action, 'nudge', 'an arrow nudges, from the window rather than from a focused box')
  eq(findBinding(ev('ArrowUp', { shiftKey: true }), 'place')?.id, 'nudgeFar', 'and with shift it nudges ten')
  const docOnly = KEYS.filter((k) => !k.action)
  ok(docOnly.length >= 6, `${docOnly.length} rows document a gesture`)
  ok(docOnly.every((k) => k.combo === null), 'and none of them has a key a press could match')
  ok(keyMatches({ key: '+', shift: null }, ev('+', { shiftKey: true })), '+ matches with or without shift')
}

console.log('the conventions every drawing program shares are bound')
{
  const on = (e, where = 'place') => findBinding(e, where)?.id
  const cmd = { metaKey: true }
  const ctrl = { ctrlKey: true }
  eq(on(ev('v', { ...cmd, shiftKey: true })), 'pasteInPlace', '⇧⌘V pastes in place')
  eq(on(ev('a', { ...ctrl, shiftKey: true })), 'deselect', 'Ctrl+Shift+A selects nothing')
  eq(on(ev('}', { code: 'BracketRight', ...cmd, shiftKey: true })), 'front', '⇧⌘] brings to front, by the physical key')
  eq(on(ev('{', { code: 'BracketLeft', ...ctrl, shiftKey: true })), 'back', 'Ctrl+Shift+[ sends to back')
  eq(on(ev('o')), 'toolEllipse', 'O is the ellipse')
  eq(on(ev('e')), 'toolEllipse', 'and E, the studio\'s earlier key for it, still is')
  eq(on(ev('h')), 'toolHand', 'H picks up the hand')
  eq(on(ev('i')), 'eyedropper', 'I is the eyedropper')
  eq(on(ev('g', ctrl)), 'group', 'Ctrl+G groups')
  eq(on(ev('l', { ...cmd, shiftKey: true })), 'lock', '⇧⌘L pins')
  eq(on(ev('b', cmd)), 'bold', '⌘B makes lettering bold')
  eq(on(ev('=', cmd)), 'zoomIn', '⌘= zooms in — ⌘+ on a keyboard where + is shifted =')
  eq(on(ev('+', { ...cmd, shiftKey: true })), 'zoomIn', 'and ⌘+ typed as +')
  eq(on(ev('-', ctrl)), 'zoomOut', 'Ctrl+- zooms out')
  eq(on(ev('s', cmd), 'artwork'), 'save', '⌘S saves on any tab')
  eq(on(ev('k', ctrl), 'digital'), 'palette', 'Ctrl+K finds a command on any tab')
  eq(on(ev('e', cmd)), 'exportPng', '⌘E downloads a sample on the Place tab')
}

console.log('the digital ticket tab answers the same keys as the printed one')
{
  for (const [e, id] of [
    [ev('c', { metaKey: true }), 'copy'], [ev('v', { metaKey: true }), 'paste'],
    [ev('d', { ctrlKey: true }), 'duplicate'], [ev('Delete'), 'remove'], [ev('Backspace'), 'remove'],
    [ev('a', { metaKey: true }), 'selectAll'], [ev('Escape'), 'escape'], [ev('r'), 'toolRect'],
    [ev('p'), 'toolPen'], [ev('ArrowLeft'), 'nudge'],
  ]) eq(findBinding(e, 'digital')?.id, id, `${id} answers on the card's tab`)
  eq(findBinding(ev('c', { metaKey: true }), 'artwork'), null, 'but not on a tab with nothing to select')
  eq(findBinding(ev('r'), 'artwork'), null, 'nor a tool key')
}

console.log('keys are written the way this computer writes them')
{
  const row = (id) => KEYS.find((k) => k.id === id)
  eq(keyLabel(row('ungroup'), true), '⇧⌘G', 'on a Mac, in the order a Mac writes them')
  eq(keyLabel(row('ungroup'), false), 'Ctrl+Shift+G', 'and elsewhere with Ctrl, in words')
  eq(keyLabel(row('front'), false), 'Ctrl+Shift+]', 'the brackets by their key')
  eq(keyLabel(row('altDrag'), true), '⌥ + drag', 'a gesture\'s modifier on a Mac')
  eq(keyLabel(row('altDrag'), false), 'Alt + drag', 'and elsewhere')
  eq(comboLabel({ key: 'Backspace' }, false), 'Backspace', 'Backspace is named off a Mac, not drawn')
  ok(!/[{}]/.test(KEYS.filter((k) => k.doc).map((k) => docLabel(k.doc, false)).join('')),
    'no gesture is left with a placeholder unspelt')
}

console.log('a key belongs to a field only when that field uses it')
{
  const text = { tagName: 'INPUT', type: 'text' }
  const box = { tagName: 'INPUT', type: 'checkbox' }
  const drop = { tagName: 'SELECT' }
  const area = { tagName: 'TEXTAREA' }
  const row = (id) => KEYS.find((k) => k.id === id)
  ok(fieldOwns(text, ev('Delete'), row('remove')), 'Delete in a text field deletes a character')
  ok(fieldOwns(text, ev('a', { metaKey: true }), row('selectAll')), '⌘A in a text field selects its words')
  ok(!fieldOwns(area, ev('s', { metaKey: true }), row('save')), 'but ⌘S saves from inside one')
  ok(!fieldOwns(box, ev('Delete'), row('remove')), 'a checkbox types nothing, so Delete is the studio\'s')
  ok(!fieldOwns(box, ev('z', { metaKey: true }), row('undo')), 'and so is ⌘Z')
  ok(fieldOwns(box, ev(' '), row('hand')), 'while Space still ticks it')
  ok(fieldOwns(drop, ev('v'), row('toolSelect')), 'a dropdown keeps the letters it searches with')
  ok(!fieldOwns(drop, ev('c', { metaKey: true }), row('copy')), 'but not ⌘C')
  ok(!fieldOwns({ tagName: 'BUTTON' }, ev('Delete'), row('remove')), 'a focused button leaves Delete to the studio')
  ok(fieldOwns({ tagName: 'DIV', isContentEditable: true }, ev('b', { metaKey: true }), row('bold')), 'editable text keeps ⌘B')
}

console.log('the studio runs every action on the table, and nothing that is not on it')
{
  const shell = read('src/components/TicketDesign.vue')
  const start = shell.indexOf('const ACTIONS = {')
  ok(start > 0, 'the studio has an ACTIONS table')
  /* The block ends at the first line that is exactly "}" after it. */
  const body = shell.slice(start, shell.indexOf('\n}\n', start))
  const performed = new Set([...body.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]))
  ok(performed.size > 20, `found ${performed.size} actions in the studio`)
  const listed = new Set(KEYS.filter((k) => k.action).map((k) => k.action))
  for (const a of listed) ok(performed.has(a), `the table's "${a}" is something the studio does`)
  for (const a of performed) ok(listed.has(a), `the studio's "${a}" is on the table, and so on the sheet`)

  /* The card's own answers, held to the table the same way. A canvas row the
     card does not answer is left to the studio — named here, with its reason,
     never inferred: the hand is held by the studio for both surfaces. */
  const card = read('src/components/ticketdesign/DigitalTab.vue')
  const cstart = card.indexOf('const CARD_ACTIONS = {')
  ok(cstart > 0, 'the card has a CARD_ACTIONS table')
  const cbody = card.slice(cstart, card.indexOf('\n}\n', cstart))
  const cardDoes = new Set([...cbody.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]))
  ok(cardDoes.size > 30, `found ${cardDoes.size} actions on the card`)
  const canvas = new Set(KEYS.filter((k) => k.action && k.when === 'canvas').map((k) => k.action))
  const holds = new Set(STUDIO_HOLDS)
  for (const a of canvas) {
    ok(cardDoes.has(a) !== holds.has(a), `the canvas row "${a}" is answered by exactly one of the card and the studio`)
  }
  for (const a of cardDoes) ok(canvas.has(a), `the card's "${a}" is a canvas row on the table`)
  ok(/\.act\?\.\(row\.action, e\) \?\? false/.test(shell),
    'and the studio hands canvas rows to the card on its tab, and runs nothing of its own when the card is missing')
  ok(!/r !== undefined/.test(shell), 'no longer reading "undefined" as "not the card\'s" — the sentinel a missing return produces')
  const cardAsks = [...card.matchAll(/keyOf\('([a-zA-Z]+)'\)|'(tool[A-Za-z]+)'/g)].map((m) => m[1] || m[2])
  ok(cardAsks.length >= 8, `${cardAsks.length} of the card's tooltips ask for a key`)
  const allIds = new Set(KEYS.map((k) => k.id))
  for (const id of new Set(cardAsks)) ok(allIds.has(id), `the card asks for "${id}", and the table has it`)

  const asked = [...shell.matchAll(/keyOf\('([a-zA-Z]+)'\)/g)].map((m) => m[1])
  ok(asked.length > 10, `${asked.length} tooltips ask for a key`)
  const ids = new Set(KEYS.map((k) => k.id))
  for (const id of new Set(asked)) ok(ids.has(id), `a tooltip asks for "${id}", and the table has it`)

  /* The one literal left is the ⌘-click hint, which is a gesture, not a key. */
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  const literal = (code.match(/\\u2318|⇧⌘/g) || []).length
  eq(literal, 0, 'no tooltip spells a key combination by hand any more')
}

console.log('the sheet lists the table and spells nothing itself')
{
  const sheet = read('src/components/ticketdesign/ShortcutsSheet.vue')
  ok(/from '..\/..\/lib\/studiokeys.js'/.test(sheet), 'it reads the table')
  const template = sheet.slice(sheet.indexOf('<template>'))
  ok(!/[⌘⇧⌥]/.test(template), 'and its template writes no key of its own')
  eq(keyLabel(KEYS.find((k) => k.id === 'duplicate'), true), '⌘D', 'a row reads the way a tooltip shows it')
  eq(keyLabel(KEYS.find((k) => k.id === 'hand'), true), 'Space + drag', 'and a gesture is written as one')
  ok(/answersOn\(r, props\.where\)/.test(sheet), 'its palette offers only what works on the tab it was opened on')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
