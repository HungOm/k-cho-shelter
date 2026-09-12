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


/**
 * Every error code the server can throw must have a Burmese line.
 *
 * This existed as a habit, not a check: the backend session had to remember to
 * tell the frontend session each time it added a code, and the frontend had to
 * remember to act on it. That worked until it didn't — four codes shipped
 * untranslated, and the only reason they were caught is that somebody mentioned
 * them in passing.
 *
 * An untranslated code is not a blank space. myError() falls through to the
 * server's English sentence, so a Burmese-reading volunteer hits a wall of
 * English at the exact moment something has gone wrong.
 */
{
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = new URL('../apps_script/', import.meta.url)
  const codes = new Set()
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.gs'))) {
    const src = fs.readFileSync(path.join(dir.pathname, f), 'utf8')
    for (const m of src.matchAll(/new ApiError\(\s*'([A-Z_]+)'/g)) codes.add(m[1])
    // Codes built from a variable are listed where they are defined instead.
    for (const m of src.matchAll(/ERROR_CODES?\s*=\s*\{([\s\S]*?)\}/g)) {
      for (const k of m[1].matchAll(/([A-Z_]{3,})\s*:/g)) codes.add(k[1])
    }
  }
  /**
   * Codes a volunteer should never see, where English is the better answer.
   *
   * These mean the software is wrong, not that the person did something wrong.
   * A Burmese sentence would invite them to fix it; the bare English code is
   * what somebody needs to read back down a phone when reporting it.
   */
  const INTERNAL = new Set([
    'UNKNOWN_ACTION',      // the app asked for something this backend has no name for
    'PAYLOAD_TOO_LARGE',   // a request the client should have split
    'USE_SELL_ACTION',     // routing guidance aimed at the caller, not the user
    'USE_VOID_ACTION'
  ])

  ok(codes.size > 20, `found the server's error codes (${codes.size})`)
  for (const c of INTERNAL) {
    ok(!MY_ERRORS[c], `${c} is deliberately left in English`)
  }
  const missing = [...codes].filter(c => !MY_ERRORS[c] && !INTERNAL.has(c)).sort()
  ok(missing.length === 0,
    missing.length ? `every server code is translated — missing: ${missing.join(', ')}`
                   : 'every server code is translated')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
