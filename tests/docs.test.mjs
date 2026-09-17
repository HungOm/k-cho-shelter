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

console.log('1. the docs describe the backend the code actually has')
{
  /*
   * WHAT THIS WAS. It read `BACKENDS` out of backend.js, asserted there were
   * two, and required both README and SETUP to name each. That was the right
   * check while the app could talk to either — a document that forgot to
   * mention one left somebody running a backend they had never read about.
   *
   * There is one now, and the question turns around: the docs must not still be
   * offering a choice that no longer exists. A setup guide describing a
   * spreadsheet is worse than one that is merely out of date, because every
   * step in it appears to work right up to the point where nothing does.
   */
  ok(/Supabase/.test(README) && /Supabase/.test(SETUP), 'both name Supabase')
  for (const [doc, name] of [[README, 'README'], [SETUP, 'SETUP']]) {
    // In prose. A historical aside that says the backend WAS removed is fine;
    // an instruction that says to set one up is not.
    ok(!/Apps Script/.test(doc), `${name} no longer offers the Apps Script backend`)
    ok(!/VITE_BACKEND/.test(doc), `${name} does not tell anybody to choose a backend`)
  }
  // supabase/MIGRATION.md is deliberately exempt: it is the record of the move
  // off Sheets and the measurements that justified it, and it says so in its
  // own first line.
  ok(/Google Sheets/.test(MIGRATION), 'the migration record still says what was moved away from')
}

console.log('2. the setup guide builds a raffle that can actually be drawn')
{
  /*
   * THE GAP THIS REPLACES. A Supabase project used to be installable only by
   * building a spreadsheet first and migrating out of it, because `schema.sql`
   * created empty tables and every config row in production had arrived through
   * that migration. The guide has to name the step that closed it, or the
   * reader ends up with a raffle whose tickets are numbered `1` to `10000`.
   */
  ok(/expand_tickets|Make more tickets/.test(SETUP),
     'SETUP says how tickets get generated')
  ok(/TICKET_PREFIX/.test(SETUP), 'and which settings decide what they are called')
  ok(/before you generate|before you print/i.test(SETUP),
     'and that numbering is chosen before it locks')
  ok(/rls\.sql/.test(SETUP), 'and that row-level security is applied, not optional')
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
  /*
   * AND GIT IS NOT ALWAYS THERE TO ASK. `git check-ignore` answers this
   * exactly, and it answers nothing at all in a tree unpacked from
   * `git archive` — which has no .git, exits 128, and fails this case for a
   * reason that has nothing to do with the documentation. That matters because
   * archiving HEAD and running the suite in it is how a commit in this shared
   * worktree gets checked against what was actually committed rather than
   * against what happens to be lying in the tree. A check that cannot run there
   * quietly takes that away.
   *
   * So: git where there is a repository, and .gitignore read directly where
   * there is not. Status 1 means git looked and said no; only 128 means it
   * could not look.
   */
  const ignoredByFile = (() => {
    let patterns = []
    try {
      patterns = readFileSync(join(root, '.gitignore'), 'utf8')
        .split('\n').map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    } catch { /* no .gitignore: nothing is claimed to be ignored */ }
    return (p) => patterns.some((pat) => {
      const rx = new RegExp('^' + pat.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '(/|$)')
      return p.split('/').some((_, i) => rx.test(p.split('/').slice(i).join('/')))
    })
  })()
  for (const p of claimed) {
    if (existsSync(join(root, p))) { pass++; continue }
    const git = spawnSync('git', ['check-ignore', '-q', p], { cwd: root }).status
    const ignored = git === 128 ? ignoredByFile(p) : git === 0
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

console.log('8. the integrity work is named where somebody deciding would look')
{
  // These are not features: they are constraints, and the reason the raffle is
  // on Postgres rather than in a spreadsheet at all.
  ok(/row-level security/i.test(README), 'README names row-level security')
  ok(/AUDIT\.md/.test(README) && /AUDIT\.md/.test(SETUP),
    'both point at the audit for what each guarantee is')
  ok(/append-only|append only/i.test(README),
    'including the ticket record that cannot be erased')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
