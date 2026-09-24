/*
 * STAGE 0 OF MULTI-TENANCY-PLAN.md: THE CONTROL PLANE, CHECKED AS TEXT.
 *
 * Six tables and three functions that nothing reads yet. What can go wrong at
 * this stage is not behaviour, because there is none; it is DRIFT. The same
 * block is written twice — once in schema.sql, which every test that parses the
 * schema reads, and once in the pending migration, which is what production
 * will actually run — and a block written twice is a block that stops agreeing.
 * So the first check here compares the two as strings: identity, not a list of
 * things each happens to contain.
 *
 * The real-Postgres half (applies twice, seeds one organisation, fills a blank
 * organiser and never replaces a set one, reset.sql re-seeds and refuses a
 * second organisation) is proved by hand against a scratch database and by
 * supabase/test-functions.sh, which applies migrations.pending on its full
 * build. Nothing here runs Postgres.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => ok(String(g) === String(w), `${what}: got ${g}, want ${w}`)

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const schema = read('supabase/schema.sql')
const reset = read('supabase/reset.sql')
const plan = read('supabase/functions/_shared/resetplan.ts')

const BEGIN = '-- ============ ORGANISATIONS AND PROJECTS (MULTI-TENANCY-PLAN.md, Stage 0) ============'
const END = '-- ============ ORGANISATIONS AND PROJECTS (end) ============'
const blockOf = (sql) => {
  const a = sql.indexOf(BEGIN), b = sql.indexOf(END)
  return a >= 0 && b > a ? sql.slice(a, b + END.length) : ''
}

const TABLES = ['platform_admins', 'organisations', 'org_features', 'org_defaults',
                'projects', 'project_members']
const FEATURES = ['tickets', 'books', 'money', 'checkins', 'approvals', 'prizes',
                  'reports', 'printing', 'cards', 'studio', 'seed', 'reset']
const SEED = '00000000-0000-0000-0000-000000000001'

/* Which file defines the control plane, in either migrations directory. */
const migDirs = ['supabase/migrations', 'supabase/migrations.pending']
const defining = []
for (const d of migDirs) {
  for (const f of readdirSync(join(ROOT, d)).filter((x) => x.endsWith('.sql'))) {
    if (read(`${d}/${f}`).includes('create table if not exists organisations')) defining.push(`${d}/${f}`)
  }
}

console.log('1. the files this reads still look the way it thinks they do')
const block = blockOf(schema)
ok(block.length > 2000, `schema.sql carries the Stage 0 block (${block.length} chars)`)
eq(defining.length, 1, 'exactly one migration defines the control plane')

console.log('2. the migration runs what schema.sql says, character for character')
{
  const mig = defining[0] ? read(defining[0]) : ''
  ok(blockOf(mig) === block, `${defining[0]} carries the same block as schema.sql`)
  /* Outside the block, the migration seeds and does nothing else. */
  const outside = mig.replace(blockOf(mig), '').replace(/^\s*--.*$/gm, '').trim()
  eq(outside, "select seed_tenancy('');", 'the only statement outside the block')
}

console.log('3. six tables, each closed to the browser')
{
  for (const t of TABLES) {
    ok(new RegExp(`create table if not exists ${t} \\(`).test(block), `${t} is created`)
    ok(new RegExp(`alter table ${t}\\s+enable row level security`).test(block), `${t} has row security on`)
    ok(new RegExp(`revoke all on [^;]*\\b${t}\\b[^;]*from anon, authenticated`).test(block),
       `${t} is revoked from anon and authenticated`)
  }
  /* Stage 0 changes nothing that exists: every table it alters is its own. */
  const altered = [...block.matchAll(/alter table ([a-z_]+)/g)].map((m) => m[1])
  ok(altered.length >= TABLES.length, `found the alters (${altered.length})`)
  for (const t of altered) ok(TABLES.includes(t), `Stage 0 alters only its own tables, not ${t}`)
  ok(!/\bdrop\s+(table|view|function|policy|trigger)\b/i.test(block.replace(/^\s*--.*$/gm, '')),
     'and drops nothing')
}

console.log('4. one organiser, as a column')
{
  const org = block.match(/create table if not exists organisations \(([\s\S]*?)\n\);/)?.[1] ?? ''
  ok(/organiser_email\s+text not null/.test(org), 'organisations.organiser_email is a single not-null column')
  ok(!/create table if not exists org_members/.test(schema), 'there is no many-organisers table')
}

console.log('5. the three functions say what the plan says')
{
  ok(block.includes(`select '${SEED}'::uuid`), 'seed_project() is the named id')
  ok(/'x-project-id'/.test(block) && /'app\.project_id'/.test(block),
     'current_project() reads the header, then the session setting')
  const arr = block.match(/unnest\(array\[([\s\S]*?)\]\)/)?.[1] ?? ''
  const seeded = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  eq(seeded.join(','), FEATURES.join(','), 'the seed organisation gets every feature but core')
  ok(!seeded.includes('core'), 'core has no row: it is always on and a switch for it would do nothing')
  ok(/revoke all on function seed_tenancy\(text\) from public, anon, authenticated/.test(block),
     'seed_tenancy cannot be called from a browser')
}

console.log('6. the terminal reset keeps the control plane and never empties a second organisation')
{
  ok(/perform seed_tenancy\(current_setting\('reset\.super'\)\)/.test(reset), 'reset.sql re-seeds with the super admin as organiser')
  ok(/count\(\*\) from organisations\) > 1 then\s+raise exception 'REFUSED/.test(reset),
     'and refuses while more than one organisation exists')
  ok(/to_regclass\('public\.organisations'\) is null then return/.test(reset),
     'and still runs on a database Stage 0 has not reached')
}

console.log('7. no page can reset it')
{
  const f = plan.match(/id: 'tenancy',[\s\S]*?\n  \},/)?.[0] ?? ''
  ok(f.length > 0, 'resetplan has a tenancy feature')
  ok(/never:/.test(f), 'marked never')
  for (const t of TABLES) ok(f.includes(`'${t}'`), `and it owns ${t}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
