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

  /*
   * AND THE OTHER OBJECT, WHOSE KEYS ARE NOT QUOTED.
   *
   * The check above matches `'some phrase':` at the start of a line, which is
   * the shape MY uses. MY_ERRORS keys are bare identifiers — RESET_FAILED, not
   * 'RESET_FAILED' — so it has never been checked at all, and a duplicate there
   * is the same silent loss: legal JavaScript, later value wins, and the next
   * person to correct a translation corrects the one that does nothing.
   *
   * It also does not anchor to the line start, because that was how this got
   * through: an edit joined two entries onto one line, and a rule that only
   * looks at line beginnings cannot see the second.
   */
  const errBody = src.slice(src.indexOf('export const MY_ERRORS = {'))
  const errKeys = [...errBody.slice(0, errBody.indexOf('\n}')).matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*'/g)].map(m => m[1])
  const errSeen = new Set(), errDupes = new Set()
  for (const k of errKeys) { errSeen.has(k) ? errDupes.add(k) : errSeen.add(k) }
  ok(errKeys.length > 50, `MY_ERRORS was actually read (${errKeys.length} codes)`)
  ok(errDupes.size === 0, `duplicate error codes: ${[...errDupes].join(', ')}`)

  /*
   * One key to a line, in both. Not a style rule — it is what makes every check
   * above readable by a person scanning a diff, and joining two entries is how
   * the duplicate arrived in the first place.
   */
  const crowded = errBody.slice(0, errBody.indexOf('\n}')).split('\n')
    .filter((l) => (l.match(/[A-Z][A-Z0-9_]*\s*:\s*'/g) ?? []).length > 1)
  ok(crowded.length === 0, `two error codes on one line: ${crowded.map((l) => l.trim().slice(0, 48)).join(' | ')}`)
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
  /*
   * SCRAPED FROM THE EDGE FUNCTION, not from the Apps Script sources.
   *
   * It read `apps_script/*.gs` — the backend being deleted — so the set of codes
   * a volunteer must be able to read in Burmese was the set the SPREADSHEET
   * could produce. That was never quite the right question and is about to stop
   * being a question at all.
   *
   * Re-pointing it turned out to ADD coverage rather than remove it: 81 codes
   * here against 73 there, and 18 of them had no Burmese at all. Every one was a
   * refusal a volunteer could already hit on the live backend.
   *
   * TWO PATTERNS, because the function raises codes two ways. Most are the first
   * argument to `ApiError`. The sign-in refusals are pairs in a lookup — see the
   * `said` map in gate.ts — so a code followed by a SENTENCE is taken too. The
   * sentence is what tells a code pair apart from a list of config keys:
   * `['TICKET_PRICE', 'CURRENCY', …]` is not an error, and 'CURRENCY' has no
   * space in it.
   */
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = new URL('../supabase/functions/api/', import.meta.url)
  const codes = new Set()
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir.pathname, f), 'utf8')
    for (const m of src.matchAll(/ApiError\(\s*'([A-Z_]{3,})'/g)) codes.add(m[1])
    for (const m of src.matchAll(/\[\s*'([A-Z_]{3,})',\s*\n?\s*'[^'\n]*\s[^'\n]*'/g)) {
      codes.add(m[1])
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
    'USE_VOID_ACTION',
    // The three the Edge Function adds to that list, and for the same reason:
    // each one means the system is wrong, not the person holding the phone.
    'QUERY_FAILED',        // the database refused; the sentence under it is Postgres's
    'SCHEMA_DRIFT',        // the tables disagree with the settings — nobody at a desk can fix it
    'UPLOAD_FAILED',       // storage did not accept the file; trying again is the only move
    /*
     * Which raffle a request is about (MT-2a). A project id is never typed by
     * a person — it is a header the software sets, or does not — so all three
     * of these mean the caller is wrong in a way no volunteer can act on, and
     * the bare code is what they would read back down a phone. No client sends
     * the header at all today, so none of them is reachable from the app.
     *
     * PROJECT_NOT_FOUND WILL NEED BURMESE AT STAGE 5, and this is the note that
     * says so rather than a silence somebody has to rediscover. Once a second
     * project can exist, an organiser following a stale or mistyped link is a
     * PERSON seeing it, about a thing they can act on — pick the other raffle
     * — which is exactly the line this list is drawn on. The other two stay
     * here whatever happens: a malformed id and an unreachable environment are
     * never the reader's doing. See D-017.
     */
    'BAD_PROJECT',         // a header that is not a uuid: the caller built it wrong
    'PROJECT_NOT_FOUND',   // names a raffle that does not exist — unreachable until Stage 5
    'PROJECT_UNAVAILABLE'  // the admin client could not be built; nothing a person can fix
  ])

  ok(codes.size > 60, `found the server's error codes (${codes.size})`)
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
