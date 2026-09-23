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
 * WHAT THIS CANNOT DO. It does not press keys in a browser. Two platform facts
 * it cannot see are recorded in the table itself: ⌥ changes the character a Mac
 * key types (so the brackets match by `code`), and Chrome on a Mac never hands
 * ⌘1 to the page (so actual size also answers a bare 1).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KEYS, keyMatches, findBinding, keyLabel, comboLabel, combosOf } from '../src/lib/studiokeys.js'

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
      for (const where of row.when === 'any' ? ['place', 'artwork', 'digital'] : [row.when]) {
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
  eq(findBinding(ev('ArrowRight'), 'place'), null, 'a row that only documents a key is never run from here')
  ok(keyMatches({ key: '+', shift: null }, ev('+', { shiftKey: true })), '+ matches with or without shift')
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
  eq(keyLabel(KEYS.find((k) => k.id === 'duplicate')), '⌘D', 'a row reads the way a tooltip shows it')
  eq(keyLabel(KEYS.find((k) => k.id === 'ungroup')), '⇧⌘G', 'modifiers in the order a Mac writes them')
  eq(keyLabel(KEYS.find((k) => k.id === 'hand')), 'Space + drag', 'and a gesture is written as one')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
