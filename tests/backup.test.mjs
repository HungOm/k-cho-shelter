/*
 * The backup, and the one way it could do more harm than having none.
 *
 * A dump of this database is every buyer's name and telephone number, most of
 * them refugees. The scheduled job hands a file to GitHub's artifact store,
 * which is readable by anybody with read access to the repository — and this
 * repository publishes a Pages site, which on a free account means public,
 * which means everybody. So the file has to carry its own privacy: sealed to a
 * key the runner holds only the public half of, before it is ever uploaded.
 *
 * WHAT IS BEING PINNED IS AN ORDER AND A REFUSAL, not a feature. The check
 * that decides whether a backup may be taken runs BEFORE the dump, because
 * checking afterwards means the plaintext already exists on the runner when we
 * find out we cannot seal it. And a missing key must fail the job rather than
 * fall back to a plain upload, which is the exact accident the encryption is
 * there to prevent. Both are one edit away from being reversed by somebody
 * making the workflow "simpler", and neither would fail visibly when it was:
 * the backup would keep working, and would quietly be public.
 *
 * backup.sh itself is exercised rather than read, against a stub `supabase`
 * on PATH, because its most important line is a refusal — and a refusal that
 * has never been run is a comment.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const root = new URL('..', import.meta.url).pathname
const wf = readFileSync(join(root, '.github/workflows/backup.yml'), 'utf8')
const sh = readFileSync(join(root, 'supabase/backup.sh'), 'utf8')

console.log('1. it runs on its own, and can be run by hand')
{
  ok(/^\s+- cron: '[^']+'/m.test(wf), 'there is a schedule — a backup nobody remembers is the problem being solved')
  ok(/workflow_dispatch:/.test(wf), 'and it can be triggered by hand when somebody is about to deploy')
  ok(/permissions:\s*\n\s*contents: read/.test(wf), 'with no more permission than reading the repository')
}

console.log('2. the refusal comes before the dump, not after')
{
  const refuseAt = wf.indexOf('Refuse to take a backup that cannot be sealed')
  const dumpAt = wf.indexOf('bash supabase/backup.sh')
  const sealAt = wf.indexOf('name: Seal it')
  ok(refuseAt > 0, 'the refusal step exists')
  ok(dumpAt > 0, 'the dump step exists')
  ok(refuseAt < dumpAt,
    'the refusal runs BEFORE the dump — checking after means the plaintext already exists')
  ok(dumpAt < sealAt, 'and the seal runs after the dump it seals')
}

console.log('3. a missing key fails the job rather than falling back to a plain upload')
{
  ok(/BACKUP_GPG_PUBLIC_KEY/.test(wf), 'the public key is named as a secret')
  const refuseBlock = wf.slice(wf.indexOf('Refuse to take a backup'), wf.indexOf('supabase/setup-cli'))
  ok(/exit 1/.test(refuseBlock), 'and its absence exits non-zero')
  ok(!/if:\s*\$\{\{\s*secrets\.BACKUP_GPG_PUBLIC_KEY/.test(wf),
    'the seal is never made conditional on the key being there — that is the fallback this prevents')
}

console.log('4. only the sealed file is ever uploaded')
{
  const upload = wf.slice(wf.indexOf('upload-artifact'))
  ok(/path:\s*\$\{\{\s*steps\.seal\.outputs\.file\s*\}\}/.test(upload),
    'the uploaded path is the output of the sealing step')
  ok(!/path:\s*backup/.test(wf), 'never the backup directory itself')
  ok(!/path:\s*\S*\*/.test(upload), 'and never a glob, which can match more than whoever wrote it meant')
  ok(/if-no-files-found: error/.test(upload),
    'an upload that finds nothing fails, rather than reporting a backup that is not there')
  ok(/\.gpg/.test(wf.slice(wf.indexOf('name: Seal it'), wf.indexOf('upload-artifact'))),
    'what is sealed is written to a .gpg file')
}

console.log('5. the plaintext does not survive the step that sealed it')
{
  const seal = wf.slice(wf.indexOf('name: Seal it'), wf.indexOf('upload-artifact'))
  ok(/rm -rf "\$DIR"/.test(seal), 'the dump directory is removed inside the sealing step')
  ok(seal.indexOf('--encrypt') < seal.indexOf('rm -rf'), 'after it has been encrypted, not before')
  ok(/--recipient/.test(seal), 'to a named recipient — asymmetric, so the runner cannot decrypt it')
}

console.log('6. the backup folder stays out of the repository')
{
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8')
  ok(/^backup\/$/m.test(ignore), 'backup/ is ignored, so a local run cannot be committed by accident')
}

console.log('7. backup.sh still refuses to call a near-empty dump a backup')
{
  /*
   * Run for real against a stub `supabase` that produces the empty dump a
   * broken connection produces. The refusal is the whole value of the script —
   * a backup nobody checked is a backup nobody has — and it is the line most
   * likely to be true only in the comment above it.
   */
  const box = join(tmpdir(), 'kcho-backup-test-' + process.pid)
  rmSync(box, { recursive: true, force: true })
  mkdirSync(join(box, 'bin'), { recursive: true })
  mkdirSync(join(box, 'repo/supabase'), { recursive: true })

  // A stub that writes almost nothing, the way a dump of an unreachable
  // database does.
  const stub = join(box, 'bin/supabase')
  writeFileSync(stub, '#!/usr/bin/env bash\nfor a in "$@"; do if [ "$prev" = "-f" ]; then echo "-- empty" > "$a"; fi; prev="$a"; done\nexit 0\n')
  chmodSync(stub, 0o755)

  // curl is stubbed too: the CSV must not be a real request from a test.
  const curl = join(box, 'bin/curl')
  writeFileSync(curl, '#!/usr/bin/env bash\nprev=""\nfor a in "$@"; do if [ "$prev" = "-o" ]; then echo "number,status" > "$a"; fi; prev="$a"; done\nexit 0\n')
  chmodSync(curl, 0o755)

  writeFileSync(join(box, 'repo/supabase/backup.sh'), sh)

  let code = 0, out = ''
  try {
    out = execFileSync('bash', [join(box, 'repo/supabase/backup.sh')], {
      env: {
        ...process.env,
        PATH: join(box, 'bin') + ':' + process.env.PATH,
        SUPABASE_DB_URL: 'postgres://stub',
        SUPABASE_URL: 'https://stub.invalid',
        SUPABASE_SECRET_KEY: 'sb_secret_stub',
        GITHUB_OUTPUT: '',
      },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: join(box, 'repo'),
    })
  } catch (e) {
    code = e.status
    out = String(e.stdout ?? '') + String(e.stderr ?? '')
  }
  ok(code !== 0, 'a near-empty dump exits non-zero')
  ok(/REFUSING TO CALL THIS A BACKUP/.test(out), 'and says so in the words somebody will recognise')

  rmSync(box, { recursive: true, force: true })
}

console.log('8. backup.sh runs unattended, without the laptop it was written for')
{
  ok(/if \[ -f supabase\/\.env\.local \]/.test(sh),
    'a missing .env.local is the normal case on a runner, not an error')
  ok(/SUPABASE_DB_URL/.test(sh), 'the database can be named outright rather than linked')
  ok(/No SUPABASE_URL \/ SUPABASE_SECRET_KEY/.test(sh),
    'but missing credentials are still refused rather than producing a CSV of nothing')
  ok(!/^set -a; \. supabase\/\.env\.local/m.test(sh),
    'and nothing sources a file it has not checked for')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
