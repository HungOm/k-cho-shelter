/**
 * The Burmese map.
 *
 * Two things worth pinning: a duplicate key silently discards one of the
 * translations, and a <Bi text="..."> whose text is not in the map renders as
 * English with no warning — which is how a label quietly stays untranslated.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'src/lib/i18n.js'), 'utf8')
const { MY, MY_ERRORS, my, myError } = await import('../src/lib/i18n.js')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

console.log('no duplicate keys')
{
  // A repeated key is legal JavaScript and silently drops the earlier value.
  const keys = [...src.matchAll(/^\s*'((?:[^'\\]|\\.)*)':/gm)].map(m => m[1])
  const seen = new Set(), dupes = new Set()
  for (const k of keys) { seen.has(k) ? dupes.add(k) : seen.add(k) }
  ok(dupes.size === 0, `duplicate keys: ${[...dupes].join(', ')}`)
  ok(keys.length > 100, `map has ${keys.length} entries`)
}

console.log('every value is Burmese, and present')
for (const [k, v] of Object.entries(MY)) {
  ok(typeof v === 'string' && v.trim().length > 0, `"${k}" has no translation`)
  // Myanmar block is U+1000–U+109F. A Latin value means a line was missed.
  ok(/[က-႟]/.test(v), `"${k}" does not look like Burmese: ${v}`)
}
for (const [k, v] of Object.entries(MY_ERRORS)) {
  ok(/[က-႟]/.test(v), `error ${k} does not look like Burmese`)
}

console.log('lookups behave')
ok(my('Home').length > 0, 'known string translates')
ok(my('not a real label') === '', 'unknown string returns empty, so English shows alone')
ok(my('  Home  ') === my('Home'), 'whitespace is trimmed')
ok(my(null) === '' && my(undefined) === '', 'null is safe')
ok(myError('RATE_LIMIT').length > 0, 'known code translates')
ok(myError('MADE_UP') === '', 'unknown code returns empty')

console.log('every label asked for in the interface exists in the map')
{
  const files = []
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.vue')) files.push(p)
  })
  walk(path.join(ROOT, 'src/components'))

  const missing = new Set()
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8')
    // <Bi text="Something" /> — the literal form. Bound :text is dynamic and
    // resolved at runtime, so it cannot be checked here.
    for (const m of code.matchAll(/<Bi[^>]*?\stext="([^"]+)"/g)) {
      if (!MY[m[1]]) missing.add(`${path.basename(f)}: "${m[1]}"`)
    }
  }
  ok(missing.size === 0,
    `labels used but never translated:\n    ${[...missing].join('\n    ')}`)
}

console.log('the untranslated-by-design list is honoured')
{
  // Data must never be glossed — a Burmese line under a buyer's name is nonsense.
  const banned = ['Ticket_Number', 'Buyer_Name', 'Buyer_Phone']
  for (const b of banned) ok(!(b in MY), `${b} must not be translated — it is data`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
