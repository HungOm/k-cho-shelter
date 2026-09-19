/*
 * The same tree deploys to a Supabase-hosted project and to a self-hosted one.
 *
 * WHAT MAKES THAT TRUE is not one clever file — it is a handful of properties
 * spread across the client, the functions and the SQL, each of which is easy to
 * break without noticing because breaking it costs nothing on the deployment
 * you happen to be testing on. A hard-coded project address works perfectly on
 * the project it names. A function that reads a new secret works perfectly on
 * the machine where somebody set it. An `auth.uid()` in a policy works
 * perfectly until the database is one that has no auth schema.
 *
 * So this file asserts the properties themselves, from the source, on every
 * run. It cannot bring a self-hosted stack up — nothing here talks to a
 * container — and it does not try to. It catches the class of change that
 * quietly makes one of the two deployments impossible, which is the failure
 * nobody is looking for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(ROOT + p, 'utf8')
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/** Source with its comments removed — a mention is not a dependency. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
}

const FUNCTIONS_DIR = ROOT + 'supabase/functions/'
const onDisk = readdirSync(FUNCTIONS_DIR)
  .filter((d) => statSync(FUNCTIONS_DIR + d).isDirectory())
  .sort()

// ============ 1. the client names no project ============
console.log('the app carries no project address of its own')
{
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(ROOT + dir)) {
      const p = dir + '/' + e
      if (statSync(ROOT + p).isDirectory()) walk(p)
      else if (/\.(js|mjs|vue|html)$/.test(e)) files.push(p)
    }
  }
  walk('src')
  files.push('index.html', 'v/index.html', 'vite.config.js')

  const named = files.filter((f) => /https?:\/\/[a-z0-9-]+\.supabase\.(co|in)\b/i.test(code(read(f))))
  eq(named.length, 0, `no file hard-codes a project host (${named.join(', ') || 'none'})`)

  const auth = read('src/lib/supabaseAuth.js')
  ok(/import\.meta\.env\?\.VITE_SUPABASE_URL/.test(auth),
    'the address comes from VITE_SUPABASE_URL at build time')
  ok(/fromStorage\(LS_SB\.url\)/.test(auth),
    'or from the device, so one link can point a phone at any project')

  const verify = read('src/verify/main.js')
  ok(/import\.meta\.env\.VITE_SUPABASE_URL/.test(verify),
    'the ticket-check page builds its URL from the same variable')
  ok(/\/functions\/v1\/verify/.test(verify),
    'on the standard function path, which both kinds of project serve')
}

// ============ 2. the front door a self-hosted stack needs ============
console.log('\nthe self-hosted router serves the functions and nothing else')
{
  const main = read('supabase/functions/main/index.ts')
  const listed = [...main.matchAll(/const FUNCTIONS = new Set\(\[([^\]]*)\]\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])).sort()

  const deployable = onDisk.filter((d) => d !== 'main' && !d.startsWith('_')).sort()
  eq(listed.join(','), deployable.join(','),
    'every function on disk is routed, and only those')

  ok(onDisk.includes('_shared'),
    'there IS a _shared directory next to them, which is why the list is a list')
  ok(!listed.includes('_shared'), 'and it is not reachable from outside')
}

console.log('\nand it refuses a name it does not know')
{
  setEnv({ SUPABASE_URL: 'http://kong:8000' })
  let handler = null
  globalThis.Deno.serve = (h) => { handler = h }
  const started = []
  globalThis.EdgeRuntime = {
    userWorkers: {
      create: async (opts) => {
        started.push(opts.servicePath)
        return { fetch: async () => Response.json({ ok: true, from: opts.servicePath }) }
      },
    },
  }

  await loadModule('../main/index.ts')
  ok(typeof handler === 'function', 'the router registered a handler')

  const get = (path) => handler(new Request('http://kong:8000' + path))

  let res = await get('/api')
  eq(res.status, 200, 'a request for /api is served')
  eq(started.at(-1), './functions/api', 'from the api function')

  res = await get('/functions/v1/verify?t=KS-1.CODE')
  eq(res.status, 200, 'and /functions/v1/verify, for a stack with no proxy stripping the prefix')
  eq(started.at(-1), './functions/verify', 'from the verify function')

  const before = started.length
  for (const path of ['/_shared', '/_shared/session.ts', '/main', '/', '/admin', '/..%2fapi']) {
    const r = await get(path)
    eq(r.status, 404, `${path} is refused`)
  }
  eq(started.length, before, 'and not one of them started a worker')

  const body = await (await get('/nope')).json()
  eq(body.error?.code, 'NOT_FOUND', 'the refusal is the same envelope everything else uses')
}

// ============ 3. one gate, not two ============
console.log('\nthe platform check is not what decides who gets in')
{
  const main = read('supabase/functions/main/index.ts')
  ok(!/jwt|verifySession|Authorization/i.test(code(main)),
    'the self-hosted router does not check tokens — the functions do, as on hosted')

  const api = read('supabase/functions/api/index.ts')
  ok(/withSupabase\(\{ auth: 'user' \}, route\)/.test(api),
    "hosted: the package verifies the session (auth: 'user')")
  ok(/withSecretSession\(/.test(api),
    'self-hosted: the function verifies it, with the shared secret')
  ok(/const SESSION_SECRET = sessionSecret\(Deno\.env\)/.test(api),
    'and which of the two is decided once, from one variable')

  const verify = read('supabase/functions/verify/index.ts')
  ok(/withSupabase\(\{ auth: 'none' \}/.test(verify),
    'the ticket check is open on both, which is its whole purpose')

  const toml = read('supabase/config.toml')
  ok(/\[functions\.main\][\s\S]*?enabled = false/.test(toml),
    'the self-hosted router is never deployed to a hosted project')
  for (const f of onDisk.filter((d) => !d.startsWith('_'))) {
    ok(new RegExp(`\\[functions\\.${f}\\]`).test(toml), `config.toml accounts for ${f}`)
  }
}

// ============ 4. the runbook lists what the code reads ============
console.log('\nevery variable the functions read is written down')
{
  const doc = read('supabase/SELF-HOST.md')
  const sources = ['supabase/functions/api/index.ts', 'supabase/functions/verify/index.ts',
    'supabase/functions/api/people.ts', 'supabase/functions/api/gate.ts',
    'supabase/functions/_shared/session.ts', 'supabase/functions/main/index.ts']
  const wanted = new Set()
  for (const f of sources) {
    for (const m of read(f).matchAll(/env\.get\('([A-Z0-9_]+)'\)/g)) wanted.add(m[1])
  }
  ok(wanted.size > 0, `something reads the environment (${[...wanted].join(', ')})`)
  for (const v of [...wanted].sort()) {
    ok(doc.includes(v), `SELF-HOST.md names ${v}`)
  }
  // Read by the package rather than by our code, and just as required.
  for (const v of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_JWKS']) {
    ok(doc.includes(v), `SELF-HOST.md names ${v}, which @supabase/server reads`)
  }
}

// ============ 5. the database is portable, and must stay so ============
console.log('\nthe schema asks for nothing only a hosted project has')
{
  const sql = ['supabase/schema.sql', 'supabase/rls.sql', 'supabase/functions.sql', 'supabase/reset.sql']
  const migDir = ROOT + 'supabase/migrations/'
  for (const f of readdirSync(migDir)) if (f.endsWith('.sql')) sql.push('supabase/migrations/' + f)

  const offenders = sql.filter((f) => /\bauth\.(uid|jwt|users|email)\b/.test(code(read(f))))
  eq(offenders.length, 0,
    `nothing reads the auth schema — identity is the JWT claim plus app_users (${offenders.join(', ') || 'none'})`)

  /*
   * pg_trgm ships with Postgres. The list is named rather than counted so that
   * adding pg_cron, pg_net or vault — none of which a plain self-hosted stack
   * enables by default — is a decision somebody makes here, in front of this
   * comment, rather than one that lands with a migration.
   */
  const PORTABLE = new Set(['pg_trgm'])
  for (const f of sql) {
    for (const m of code(read(f)).matchAll(/create extension (?:if not exists )?"?([a-z_0-9]+)"?/gi)) {
      ok(PORTABLE.has(m[1]), `${f} asks for ${m[1]}, which is on the portable list`)
    }
  }

  const rls = read('supabase/rls.sql')
  ok(/create role authenticated nologin/.test(rls),
    'rls.sql creates the roles a bare Postgres does not have')
  ok(/current_setting\('request\.jwt\.claims', true\)/.test(rls),
    'and reads the caller out of the JWT claim PostgREST sets, on either stack')

  const schema = read('supabase/schema.sql')
  ok(/to_regclass\('storage\.buckets'\) is not null/.test(schema),
    'storage is used if it is there and skipped if it is not')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
