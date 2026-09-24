/*
 * Which raffle a request is about, decided before anything is read.
 *
 * MT-2a puts an `x-project-id` header in front of the router. Nothing acts on
 * it yet — no handler, no query, no column — so the only thing that can be
 * wrong today is the DECISION, and the decision is the part that is hard to
 * change later: once a client is shipped that omits the header, "absent means
 * the raffle that was already here" is a promise rather than a default.
 *
 * FOUR CASES, AND THE FOURTH IS THE ONE THAT MATTERS.
 *
 *   absent            → the seed project, and the answer is byte-identical to
 *                       what the same call returned before this existed
 *   the seed uuid     → the same, explicitly
 *   not a uuid        → BAD_PROJECT, 400
 *   any other uuid    → PROJECT_NOT_FOUND, 404, WITHOUT LOOKING IT UP
 *
 * The lookup is the point. `projects` does not exist in the production
 * database — Stage 0's migration sits in migrations.pending/ — and function
 * code reaches production with the next deploy of anybody's change. A refusal
 * that queried `projects` would not refuse; it would throw QUERY_FAILED on a
 * missing table, on every request that carried a header. So this file asserts
 * that a refused project touches NO table at all, by counting what the fake
 * database was asked for.
 *
 * AND THAT A REFUSAL HAPPENS BEFORE IDENTITY. A request naming an unknown
 * raffle must not reach the user row, because "who are you" is itself a
 * question about a raffle. Asserted by refusing with an email that WOULD
 * resolve: if the answer is still PROJECT_NOT_FOUND rather than anything about
 * the user, the order is right.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

const SEED = '00000000-0000-0000-0000-000000000001'

function world() {
  return fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agent_id: null },
    ],
  })
}

/**
 * One call. `project` undefined sends NO header at all, which is the case every
 * client shipped before today produces — not the same thing as sending an empty
 * one, which is why it has to be expressible here.
 */
async function call(action, { project, email = 'boss@x.com', payload = {}, w } = {}) {
  const world_ = w ?? world()
  const headers = { 'Content-Type': 'application/json' }
  if (project !== undefined) headers['x-project-id'] = project
  const req = new Request('https://x/api', {
    method: 'POST', headers, body: JSON.stringify({ action, payload }),
  })
  const ctx = { ...world_.ctx, userClaims: { id: 'u1', email } }
  const res = await api.fetch(req, ctx)
  return { status: res.status, body: await res.json(), world: world_, ctx }
}

/* ============ 1. absent means the raffle that is already here ============ */

console.log('a request with no header is the seed project, and answers as it always did')
{
  const { status, body } = await call('whoami')
  eq(status, 200, 'no header still succeeds')
  ok(body.ok, 'and reports ok')
  eq(body.data?.email, 'boss@x.com', 'and resolves the same user')
  ok(typeof body.requestId === 'string' && body.requestId.length > 0,
    'and still returns a requestId')
}

console.log('\nthe seed uuid, sent explicitly, is the same answer')
{
  const bare = await call('whoami')
  const named = await call('whoami', { project: SEED })
  eq(named.status, bare.status, 'same status as sending no header')
  ok(named.body.ok, 'succeeds')
  eq(named.body.data?.email, bare.body.data?.email, 'same user')
  eq(JSON.stringify(named.body.data), JSON.stringify(bare.body.data),
    'and a byte-identical payload — the header changes nothing for the seed')
}

console.log('\nand its case and padding do not matter')
{
  const upper = await call('whoami', { project: SEED.toUpperCase() })
  eq(upper.status, 200, 'an upper-case seed uuid is the seed')
  const padded = await call('whoami', { project: '  ' + SEED + '  ' })
  eq(padded.status, 200, 'a padded seed uuid is the seed')
}

/* ============ 2. a malformed id is refused ============ */

console.log('\nsomething that is not a uuid is BAD_PROJECT')
for (const bad of ['banana', '123', SEED.slice(0, -1), SEED + 'a', '', '   ',
                   '0000000-0000-0000-0000-000000000001',
                   "00000000-0000-0000-0000-00000000000'"]) {
  const { status, body } = await call('whoami', { project: bad })
  eq(status, 400, `${JSON.stringify(bad)} is refused with 400`)
  eq(body.error?.code, 'BAD_PROJECT', `${JSON.stringify(bad)} names the reason`)
}

console.log('\nan EMPTY header is refused, not silently treated as the seed')
{
  const { status, body } = await call('whoami', { project: '' })
  eq(status, 400, 'a blank x-project-id is a 400')
  eq(body.error?.code, 'BAD_PROJECT', 'and says BAD_PROJECT')
  // The distinction this file exists to pin: absent is a promise to old
  // clients, blank is a caller that lost its value on the way.
  const absent = await call('whoami')
  eq(absent.status, 200, 'while an ABSENT header is still the seed and succeeds')
}

/* ============ 3. an unknown project is refused without a lookup ============ */

const OTHER = '11111111-2222-3333-4444-555555555555'

console.log('\nany other uuid is PROJECT_NOT_FOUND')
{
  const { status, body } = await call('whoami', { project: OTHER })
  eq(status, 404, 'refused with 404')
  eq(body.error?.code, 'PROJECT_NOT_FOUND', 'and names the reason')
  ok(!body.ok, 'and is not an ok response')
}

console.log('\nand the refusal reads NOTHING — `projects` does not exist in production')
{
  const w = world()
  const seen = []
  const realFrom = w.ctx.supabaseAdmin.from.bind(w.ctx.supabaseAdmin)
  w.ctx.supabaseAdmin.from = (t) => { seen.push(t); return realFrom(t) }

  await call('whoami', { project: OTHER, w })
  eq(seen.length, 0,
    `a refused project touched ${seen.length} table(s) [${seen.join(', ')}] — it must touch none`)
  ok(!seen.includes('projects'),
    'and in particular it did not look up `projects`, which is absent from the live database')
  ok(!seen.includes('app_users'),
    'nor the user row: which raffle is decided before who is asking')
}

console.log('\nthe seed project, by contrast, does read')
{
  const w = world()
  const seen = []
  const realFrom = w.ctx.supabaseAdmin.from.bind(w.ctx.supabaseAdmin)
  w.ctx.supabaseAdmin.from = (t) => { seen.push(t); return realFrom(t) }

  await call('whoami', { w })
  ok(seen.length > 0,
    'a seed request reads at least one table — which proves the counter above is wired to something')
  ok(seen.includes('app_users'), 'including the user row')
}

/* ============ 4. the refusal comes before identity ============ */

console.log('\na refused project outranks every other answer')
{
  // An email that is not in app_users would normally resolve to an inactive
  // user and be refused on identity. Naming an unknown project must win.
  const nobody = await call('whoami', { project: OTHER, email: 'ghost@x.com' })
  eq(nobody.body.error?.code, 'PROJECT_NOT_FOUND',
    'an unknown project beats an unknown user')

  // An unknown ACTION is refused before the try block, so it still wins — that
  // is existing behaviour and this records it rather than changing it.
  const unknown = await call('no_such_action', { project: OTHER })
  eq(unknown.status, 404, 'an unknown action is still a 404')
  eq(unknown.body.error?.code, 'UNKNOWN_ACTION',
    'and reports UNKNOWN_ACTION, which is decided before the project')
}

/* ============ 5. the project reaches ctx ============ */

console.log('\nthe router puts the project on ctx for Stage 2 to read')
{
  const { ctx } = await call('whoami')
  eq(ctx.project, SEED, 'a headerless request leaves the seed id on ctx')
  const named = await call('whoami', { project: SEED })
  eq(named.ctx.project, SEED, 'and an explicit one leaves the same')
}

/* ============ 6. the caches are keyed by project ============ */

console.log('\nthe per-request caches are keyed by project, not globally')
{
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8'))

  ok(!/userCache\.get\(\s*email\s*,/.test(src),
    'userCache is not keyed by email alone — one address can be a recorder in one raffle and nothing in another')
  ok(/userCache\.get\(\s*project\s*\+/.test(src),
    'userCache is keyed by project and email together')
  ok(!/permsCache\.get\(\s*'all'/.test(src),
    "permsCache is not keyed 'all' — the permissions table is per raffle")
  ok(/permsCache\.get\(\s*project\s*,/.test(src), 'permsCache is keyed by project')
  ok(!/configCache\.get\(\s*'all'/.test(src),
    "configCache is not keyed 'all' — one raffle's ticket numbering handed to another is a ticket that stops being findable")
  ok(/configCache\.get\(\s*ctx\.project/.test(src), 'configCache is keyed by the request\'s project')
}

/* ============ 7. the fallback that must not be inherited ============ */

console.log('\na stamped client that cannot be built is handled by project, not unconditionally')
{
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8'))

  // The old line was `if (stamped) ctxWithId.supabaseAdmin = stamped` with no
  // else, sitting AFTER identity was resolved. Moved above those reads, an
  // unconditional fallback would run them on a client naming no project.
  ok(/else if \(project !== SEED_PROJECT\)/.test(src),
    'a failed build refuses for a non-seed project rather than falling through')
  ok(/PROJECT_UNAVAILABLE/.test(src), 'and the refusal has its own code')

  // And the seed keeps working, which is what the block above already proved
  // by running at all: the test stub returns null for createAdminClient on
  // purpose, so every passing assertion in this file ran through that branch.
  const { status } = await call('whoami')
  eq(status, 200,
    'while the seed project still answers on the platform client — which is what every assertion above already exercised')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
