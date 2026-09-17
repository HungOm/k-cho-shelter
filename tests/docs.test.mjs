/*
 * The documentation, checked against the thing it documents.
 *
 * README and SETUP led with the Google Sheet. That was true when it was
 * written and had stopped being true: the raffle runs on Supabase, and every
 * guarantee the integrity audit added — row-level security, the append-only
 * ticket record, round snapshots, the payments ledger, the settlement lock —
 * exists there and nowhere else. Somebody following the setup guide built the
 * weaker system and had no way to know, which is a worse failure than an
 * out-of-date sentence: the docs were confidently wrong in the one direction
 * that costs data.
 *
 * WHAT IS PINNED HERE IS THE HALF THAT ROTS SILENTLY. Prose about how a raffle
 * works does not go stale; a named repository variable, a script that is told
 * to be run, a stated default and a relative link all do, and none of them
 * fails visibly when they do. A setup guide naming a script that no longer
 * exists reads exactly like one naming a script that does, right up until
 * somebody types it at midnight.
 *
 * It deliberately does NOT assert tone, ordering or wording. A test that
 * insists on a sentence is a test somebody deletes the first time they improve
 * the sentence.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { spawnSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const root = new URL('..', import.meta.url).pathname
const read = (f) => readFileSync(join(root, f), 'utf8')
const README = read('README.md')
const SETUP = read('SETUP.md')
const MIGRATION = read('supabase/MIGRATION.md')
const backendJs = read('src/lib/backend.js')
const deployYml = read('.github/workflows/deploy.yml')
const backupYml = read('.github/workflows/backup.yml')

console.log('1. the docs name the backends the code actually has')
{
  const declared = [...backendJs.matchAll(/export const BACKENDS = \[([^\]]+)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  ok(declared.length === 2, `backend.js declares ${declared.length} backends`)
  for (const b of declared) {
    const word = b === 'appsscript' ? 'Apps Script' : 'Supabase'
    ok(README.includes(word), `README names the ${word} backend`)
    ok(SETUP.includes(word), `SETUP names the ${word} backend`)
  }
}

console.log('2. the fallback default is stated, and stated correctly')
{
  /*
   * The trap this warns about: VITE_BACKEND unset means the build silently
   * serves the OLDER backend. If somebody changes that fallback, the warning
   * in both documents becomes a lie pointing the wrong way — and nothing else
   * in the suite would notice, because the app works either way.
   */
  const m = backendJs.match(/if \(!BACKENDS\.includes\(chosen\)\) chosen = '([^']+)'/)
  ok(!!m, 'backend.js has a literal fallback')
  const fallback = m?.[1]
  ok(fallback === 'appsscript',
    `the fallback is ${fallback} — if this changed on purpose, the warning in README and SETUP has to change with it`)
  ok(/falls back to\s+\n?`?appsscript`?|falls back to\s+\n?Apps Script/.test(README),
    'README says which backend an unset VITE_BACKEND lands on')
  ok(/VITE_BACKEND` is unset the build falls back to/.test(SETUP),
    'and SETUP warns about it where somebody is setting the variable')
}

console.log('3. every build variable the setup guide names is one the workflows read')
{
  const named = new Set([...SETUP.matchAll(/`(VITE_[A-Z_]+)`/g)].map((m) => m[1]))
  ok(named.size > 0, `SETUP names ${named.size} build variables`)
  for (const v of named) {
    ok(deployYml.includes(v),
      `${v} is read by the deploy workflow — a variable nothing reads is an instruction that does nothing`)
  }
}

console.log('4. every secret the setup guide points at is one the backup workflow reads')
{
  // SETUP sends the reader to backup.yml for these rather than listing them
  // twice, so what has to hold is that the file it points at names its own.
  const secrets = [...backupYml.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])
  ok(secrets.length >= 4, `backup.yml reads ${secrets.length} secrets`)
  ok(SETUP.includes('.github/workflows/backup.yml'),
    'SETUP points at the file that names them, rather than a copy that can drift')
  ok(/SUPER_ADMIN_EMAIL/.test(SETUP),
    'and names the one secret that is not in any workflow, because it lives on the function')
}

console.log('5. every file the docs tell somebody to run is a file that exists')
{
  const claimed = new Set()
  for (const doc of [README, SETUP, MIGRATION]) {
    for (const m of doc.matchAll(/`(\.?\/?(?:supabase|tests|src|apps_script|\.github)\/[\w./-]+)`/g)) {
      claimed.add(m[1].replace(/^\.\//, ''))
    }
  }
  ok(claimed.size > 0, `the docs name ${claimed.size} paths`)
  /*
   * A PATH THE READER MAKES IS NOT A PATH THAT IS MISSING. Setup names two
   * kinds of file: ones that ship — a script, a workflow, a migration — and
   * ones the reader creates on their own machine and the repo deliberately
   * refuses to carry, like the file the database password goes in. Both are
   * real instructions. Only the first can be checked by looking for it, and
   * requiring the second to exist would make a clean clone fail the suite for
   * doing exactly what .gitignore asks.
   *
   * So the question for an absent path is whether the repo meant to keep it
   * out. git answers that, and it answers it from .gitignore rather than from
   * a list here that would drift the first time one changed.
   */
  for (const p of claimed) {
    if (existsSync(join(root, p))) { pass++; continue }
    const ignored = spawnSync('git', ['check-ignore', '-q', p], { cwd: root }).status === 0
    ok(ignored, `${p} exists, or is a file .gitignore says the reader makes themselves`)
  }
}

console.log('6. every relative link resolves')
{
  const docs = { 'README.md': README, 'SETUP.md': SETUP, 'supabase/MIGRATION.md': MIGRATION }
  let checked = 0
  for (const [file, body] of Object.entries(docs)) {
    for (const m of body.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)) {
      const target = m[1].split('#')[0]
      if (!target) continue
      checked++
      ok(existsSync(join(root, normalize(join(dirname(file), target)))),
        `${file} links to ${target}`)
    }
  }
  ok(checked > 0, `${checked} relative links checked`)
}

console.log('7. the migration note no longer says nothing here is live')
{
  ok(!/Nothing in this directory is live/.test(MIGRATION),
    'the sentence that stopped being true the day the function was deployed is gone')
  ok(/This happened/.test(MIGRATION), 'and it says which way the decision went')
}

console.log('8. the integrity work is attributed to the backend that has it')
{
  // The claim that matters to somebody choosing: these are not features one
  // backend has more of, they are constraints a spreadsheet has nowhere to put.
  ok(/row-level security/i.test(README), 'README names row-level security')
  ok(/AUDIT\.md/.test(README) && /AUDIT\.md/.test(SETUP),
    'both point at the audit for what each guarantee is')
  const table = SETUP.slice(SETUP.indexOf('## First: which backend?'), SETUP.indexOf('## Step 1'))
  ok(/\|.*Supabase.*\|.*Sheet.*\|/.test(table), 'SETUP compares them side by side')
  ok(/append-only|append only/i.test(table), 'including the ticket record that cannot be erased')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
