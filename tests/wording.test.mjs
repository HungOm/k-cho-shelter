/*
 * One word for the person at the top, and it is not "super admin".
 *
 * The user was shown "This needs the organiser. Ask the organiser to approve
 * it" while signed in AS an organiser. The word was doing two jobs: the role
 * directly below the top, and the person at the top. Somebody reading it could
 * only conclude the app had not noticed who they were.
 *
 * They also asked not to see "Super Admin" at all. It is a database
 * administrator's word for a thing volunteers experience as ownership, and this
 * app is read by people counting raffle books on a Sunday.
 *
 * So: OWNER everywhere a person can read, on both sides of the wire. The old
 * words survive only where a machine reads them — identifiers, the isSuperAdmin
 * flag, SUPER_ADMIN_EMAIL, which is a secret's name rather than a sentence.
 *
 * This is a test rather than a careful afternoon because the failure is silent:
 * nothing breaks when a screen says the wrong word, it just quietly stops
 * matching what the server says, and the person in front of it is the only one
 * who finds out.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const here = new URL('.', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(e)) out.push(p)
  }
  return out
}

/** Strip comments — JS and HTML — so only what a person could read is judged. */
function visible(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
}

/*
 * i18n.js is exempt, and only i18n.js.
 *
 * It keeps the OLD English strings as lookup keys on purpose: a phone running a
 * cached build still renders "Super admin", and dropping the key would leave
 * that person with an untranslated word rather than a wrong one. The keys are
 * what a previous bundle asks for, not what this one displays — and the test
 * below still requires the new keys to exist.
 */
const EXEMPT = ['/src/lib/i18n.js']

const files = walk(join(here, '../src'))
ok(files.length > 30, `read the source (${files.length} files)`)

console.log('no screen says "super admin" to a volunteer')
for (const f of files) {
  const rel = f.slice(f.indexOf('/src/'))
  if (EXEMPT.includes(rel)) { pass++; continue }
  const v = visible(readFileSync(f, 'utf8'))
  const hit = v.match(/[Ss]uper [Aa]dmin/)
  ok(!hit, `${rel} — says "${hit?.[0]}"`)
}

/*
 * Naming a spreadsheet is only correct on one of two backends.
 *
 * Supabase is the deployed default now. Telling somebody to change a setting in
 * the Config tab sends them to a sheet nothing reads — and worse than useless,
 * because the change STICKS in the sheet and never reaches the app, so they
 * have every reason to think they did it right.
 *
 * Some mentions are correct: the Apps Script transport's own errors, and the
 * setup form that asks for a script.google.com link, are only ever shown on
 * that backend. Those are listed with the reason. Everything else must be
 * backend-aware — the file has to import isSupabase and choose.
 */
const SHEET_OK = new Map([
    ['/src/components/SignIn.vue',
   'the setup form asks for a script.google.com link and is unreachable on Supabase'],
  ['/src/lib/i18n.js',
   'translation keys for those Apps Script labels; a key is not a screen'],
])

console.log('a spreadsheet is named only where a spreadsheet exists')
for (const f of files) {
  const rel = f.slice(f.indexOf('/src/'))
  const raw = readFileSync(f, 'utf8')
  const v = visible(raw)
  if (!/Config tab|the spreadsheet\b/.test(v)) { pass++; continue }
  const why = SHEET_OK.get(rel)
  if (why) {
    ok(why.length > 30, `${rel} is listed with an actual reason`)
    continue
  }
  // Not listed, so it has to choose at run time rather than assume.
  // Any relative depth. The two files that had needed this lived one level from
  // lib/, and the pattern had quietly hardcoded that — so the first screen in
  // modals/ to ask which backend it was on imported the flag, read the flag, and
  // failed for being two directories away from it.
  ok(/from '(?:\.\.?\/)+lib\/backend\.js'/.test(raw) &&
     /isSupabase/.test(v),
     `${rel} names a spreadsheet without asking which backend is running`)
}

console.log('and the listed ones have not quietly become backend-aware')
for (const [rel] of SHEET_OK) {
  ok(files.some(f => f.endsWith(rel.slice(1))), `${rel} still exists`)
}

console.log('and no screen still says the words it replaced')
for (const f of files) {
  const rel = f.slice(f.indexOf('/src/'))
  if (EXEMPT.includes(rel)) { pass++; continue }
  const v = visible(readFileSync(f, 'utf8'))
  // "Owner" was the previous answer and "organiser" the one before that. Both
  // read as correct to somebody who was not here for the two reversals, so the
  // suite has to hold the current word rather than the last person's memory.
  const hit = v.match(/\b[Oo]wner\b/)
  ok(!hit, `${rel} still says "${hit?.[0]}"`)
}

console.log('and the word for the top is System Admin')
const fmt = readFileSync(join(here, '../src/lib/format.js'), 'utf8')
ok(/superadmin: 'System Admin'/.test(fmt), 'the role word is System Admin')
const shell = readFileSync(join(here, '../src/components/AppShell.vue'), 'utf8')
ok(/isSuperAdmin\) return 'System Admin'/.test(shell),
   'and so is the footer under their name')

console.log('an approval asks the System Admin, not the organiser')
const ask = readFileSync(join(here, '../src/components/modals/AskApproval.vue'), 'utf8')
ok(/This needs the System Admin/.test(ask), 'the sheet names who it needs')
ok(!/the organiser to approve|Ask the organiser/.test(visible(ask)),
   'and nothing in it asks the organiser — the reader may BE one')

console.log('Burmese has the new words too')
const i18n = readFileSync(join(here, '../src/lib/i18n.js'), 'utf8')
for (const key of ["'System Admin'", "'Ask the System Admin'"]) {
  ok(i18n.includes(key), `${key} is translated`)
}

console.log('and the deadline notice names who can really change it')
// set_final_deadline is sup:true, so an organiser could not change it and was
// being told they could — wording that was also wrong.
const dl = readFileSync(join(here, '../src/components/modals/Deadlines.vue'), 'utf8')
ok(/Only the System Admin can change the final deadline/.test(dl),
   'the final deadline is not an organiser\'s to move, and says so')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
