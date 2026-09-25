/*
 * EVERY HANDLER IS SCOPED, BECAUSE THE ONE CLIENT THEY ALL USE IS
 * (MULTI-TENANCY-PLAN.md Stage 2, card MT-2b, decision D-027).
 *
 * The router builds the admin client in one place and wraps it in scoped()
 * there. This file checks both halves of that claim:
 *
 *   1. by reading the source: nothing else builds an admin client, and nothing
 *      outside the router reaches for the unscoped ctx.supabasePlatform
 *   2. by driving the real router against a fake holding TWO raffles, where the
 *      other raffle's rows come FIRST, so any read that forgot the project
 *      returns the wrong raffle's answer rather than an empty one
 *
 * With one raffle every scoping bug is invisible. The second raffle here is the
 * whole test: the same email as a viewer, and three sellers that are not ours.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { setEnv, loadModule } from './loadts.mjs'
import { fakeDb, baseConfig, SEED_PROJECT } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => ok(JSON.stringify(g) === JSON.stringify(w), `${what}: got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`)

const API = new URL('../supabase/functions/api/', import.meta.url)
const files = readdirSync(API).filter((f) => f.endsWith('.ts'))
const src = (f) => readFileSync(new URL(f, API), 'utf8')
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('1. one place builds the client, and it scopes it')
{
  ok(files.length >= 15, `read the api directory (${files.length} files)`)
  const builders = files.filter((f) => /createAdminClient\s*\(/.test(code(f)))
  eq(builders, ['index.ts'], 'only index.ts builds an admin client')
  const platform = files.filter((f) => /supabasePlatform/.test(code(f)))
  eq(platform, ['index.ts'], 'only index.ts touches the unscoped supabasePlatform')

  const idx = code('index.ts')
  const route = idx.slice(idx.indexOf('const route = async'))
  const wrap = route.indexOf('scoped(ctxWithId.supabaseAdmin')
  const firstRead = route.search(/\.from\('app_users'\)/)
  ok(wrap > 0, 'the router wraps the admin client in scoped()')
  ok(firstRead > 0 && wrap < firstRead, 'and does it before the first read of who is asking')

  /* Every upsert names the project in its conflict key, to match the
     composite unique indexes Stage 1 added and Stage 4 makes the only ones. */
  const conflicts = files.flatMap((f) => [...code(f).matchAll(/onConflict: '([^']+)'/g)].map((m) => `${f}:${m[1]}`))
  ok(conflicts.length >= 11, `found the upserts (${conflicts.length})`)
  for (const c of conflicts) ok(/:project_id,/.test(c), `${c} leads with project_id`)
}

console.log('1b. every database function the server calls can be told the raffle')
{
  /*
   * The wrapper adds p_project to EVERY rpc. PostgREST resolves an overload by
   * its argument NAMES, so a function without a p_project version is refused
   * the moment this branch reaches production: "could not find the function".
   * So the functions called here are read from the handlers, and the SQL that
   * will exist once the pending migrations are applied is read for a version
   * of each that takes `p_project uuid`.
   *
   * THE ONE EXCEPTION IS NAMED, AND IT BLOCKS THE MERGE. app_reset is held for
   * its own card (MULTI-TENANCY-DECISIONS.md D-034). It is listed rather than
   * skipped, this checks it is STILL missing so the list cannot go stale, and
   * this branch must not merge while the list is non-empty.
   */
  const BLOCKED = { app_reset: 'D-034' }

  const called = [...new Set(files.flatMap((f) => [...code(f).matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((m) => m[1])))].sort()
  ok(called.length >= 14, `found the functions the server calls (${called.length})`)

  const ROOT = new URL('../', import.meta.url)
  const sqlFiles = ['supabase/functions.sql',
    ...readdirSync(new URL('supabase/migrations.pending/', ROOT)).filter((f) => f.endsWith('.sql')).map((f) => 'supabase/migrations.pending/' + f)]
  const sql = sqlFiles.map((f) => readFileSync(new URL(f, ROOT), 'utf8')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
  const takesProject = new Set([...sql.matchAll(/create or replace function (\w+)\s*\(([^)]*)\)/gi)]
    .filter((m) => /\bp_project\s+uuid\b/i.test(m[2])).map((m) => m[1].toLowerCase()))
  ok(takesProject.size >= 14, `found the p_project versions (${takesProject.size})`)

  for (const fn of called) {
    if (BLOCKED[fn]) {
      ok(!takesProject.has(fn), `${fn} is still waiting on ${BLOCKED[fn]} — take it off BLOCKED now that it has a p_project version`)
    } else {
      ok(takesProject.has(fn), `${fn} has a version taking p_project uuid — without one, every call to it fails once this branch is live`)
    }
  }
  console.log(`  merge blocked by: ${Object.entries(BLOCKED).map(([f, d]) => `${f} (${d})`).join(', ') || 'nothing'}`)
}

console.log('2. through the real router, a second raffle stays out of sight')
setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default
const OTHER = '11111111-2222-4333-8444-555555555555'
const other = (rows) => rows.map((r) => ({ ...r, project_id: OTHER }))

function twoRaffles() {
  return fakeDb({
    config: baseConfig(),
    // The other raffle's rows FIRST: an unscoped maybeSingle() would take them.
    app_users: [
      ...other([{ email: 'rec@x.com', name: 'Rec elsewhere', role: 'viewer', status: 'active', active: true, agent_id: null }]),
      { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', status: 'active', active: true, agent_id: null },
    ],
    agents: [
      ...other([{ agent_id: 'A001', name: 'Not ours 1', phone: '0900', active: true },
                { agent_id: 'A002', name: 'Not ours 2', phone: '0901', active: true },
                { agent_id: 'A003', name: 'Not ours 3', phone: '0902', active: true }]),
      { agent_id: 'A001', name: 'Ours', phone: '0911', active: true },
    ],
  })
}

async function call(action, { email = 'boss@x.com', payload = {}, w } = {}) {
  const req = new Request('https://x/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }),
  })
  const res = await api.fetch(req, { ...w.ctx, userClaims: { id: 'u1', email } })
  return { status: res.status, body: await res.json() }
}

{
  const w = twoRaffles()
  const me = await call('whoami', { email: 'rec@x.com', w })
  eq(me.body.data?.role, 'recorder', 'the same email is a recorder here, not the other raffle\'s viewer')
  eq(me.body.data?.name, 'Rec', 'and carries this raffle\'s name for them')
  ok(!(me.body.data?.staff ?? []).some((s) => s.name === 'Rec elsewhere'),
     'the staff directory lists nobody from the other raffle')
}
{
  const w = twoRaffles()
  const r = await call('list_agents', { w })
  ok(r.body.ok, `list_agents answered (${r.body.error?.code ?? 'ok'})`)
  eq((r.body.data?.agents ?? []).map((a) => a.name), ['Ours'], 'the seller list is this raffle\'s one seller')
}
{
  const w = twoRaffles()
  const r = await call('upsert_agent', { w, payload: { name: 'New seller', phone: '0999' } })
  ok(r.body.ok, `upsert_agent answered (${r.body.error?.code ?? 'ok'})`)
  const made = w.table('agents').filter((a) => a.name === 'New seller')
  eq(made.map((a) => a.project_id ?? SEED_PROJECT), [SEED_PROJECT], 'a new seller is filed under this raffle')
  eq(w.table('agents').filter((a) => a.project_id === OTHER).length, 3, 'and the other raffle still has exactly its three')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
