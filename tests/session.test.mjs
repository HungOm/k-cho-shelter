/*
 * The second way this API verifies a caller, attacked rather than demonstrated.
 *
 * WHY THERE IS A SECOND WAY AT ALL. @supabase/server verifies a session by
 * looking its signing key up in a JWKS and refuses any token whose header
 * carries no `kid`. A Supabase-hosted project signs with such keys; a
 * self-hosted stack from the official docker-compose signs HS256 with one
 * shared secret and no `kid`, so on that stack the package refuses everybody.
 * _shared/session.ts is the path for that stack, reached only when the operator
 * sets SUPABASE_JWT_SECRET.
 *
 * WHY THIS FILE IS LONG AND UNFRIENDLY. A shared secret makes the anon key —
 * which is printed in the page source of the app, on purpose — a validly signed
 * JWT. It is not a session and must never be accepted as one, but it carries a
 * real signature and an expiry years out, so signature checking alone lets it
 * through and hands whoever pasted it a resolved user. Every refusal below is a
 * way in that would otherwise be open, and the anon-key case is the one that
 * would actually be tried.
 *
 * The tokens here are minted with node's crypto, the same way auth mints them,
 * so what is verified is the real thing rather than a fixture that happens to
 * match the parser.
 */
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({})
const S = await loadModule('../_shared/session.ts')

const SECRET = 'a-self-hosted-jwt-secret-at-least-32-characters'
const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A token, signed the way auth signs one. */
function sign(payload, { secret = SECRET, header = { alg: 'HS256', typ: 'JWT' } } = {}) {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest()
  return `${h}.${p}.${b64url(sig)}`
}

const inAnHour = () => Math.floor(Date.now() / 1000) + 3600

/** What auth actually puts in a session for a signed-in volunteer. */
const session = (over = {}) => ({
  sub: '3f1c0a6e-0000-4000-8000-000000000001',
  role: 'authenticated',
  email: 'helper@example.org',
  aud: 'authenticated',
  exp: inAnHour(),
  iat: Math.floor(Date.now() / 1000),
  app_metadata: { provider: 'google' },
  user_metadata: { name: 'Helper' },
  ...over,
})

// ============ 1. a real session is accepted, and normalised ============
console.log('a session signed with the project secret is accepted')
{
  const r = await S.verifySessionToken(sign(session()), SECRET)
  ok(r.ok, 'the token verifies')
  eq(r.claims?.email, 'helper@example.org', 'the email comes back')
  eq(r.claims?.sub, '3f1c0a6e-0000-4000-8000-000000000001', 'and the subject')

  const mixed = await S.verifySessionToken(sign(session({ email: '  Helper@Example.ORG ' })), SECRET)
  ok(mixed.ok, 'a capitalised, padded email still verifies')
  eq(mixed.claims?.email, 'helper@example.org',
    'and is lowercased and trimmed — app_users is keyed by the lowercase form')
}

// ============ 2. the anon key is not a session ============
console.log('\nthe keys that are published on purpose are refused')
{
  /*
   * THE ONE THAT MATTERS. On a self-hosted stack this is a real, unexpired,
   * correctly signed JWT that anybody can read out of the app's page source.
   * It differs from a session in one field.
   */
  const anon = sign({ iss: 'supabase', ref: 'local', role: 'anon', iat: 1, exp: 2147483647 })
  const a = await S.verifySessionToken(anon, SECRET)
  ok(!a.ok, 'the anon key is refused even though its signature is valid')
  eq(a.reason, 'not_a_session', 'and named as what it is rather than as a bad signature')

  const svc = sign({ iss: 'supabase', ref: 'local', role: 'service_role', iat: 1, exp: 2147483647 })
  const s = await S.verifySessionToken(svc, SECRET)
  ok(!s.ok, 'the service key is refused')
  eq(s.reason, 'not_a_session', 'for the same reason')

  const noRole = await S.verifySessionToken(sign(session({ role: undefined })), SECRET)
  ok(!noRole.ok, 'a token with no role at all is refused')

  const invented = await S.verifySessionToken(sign(session({ role: 'supabase_admin' })), SECRET)
  ok(!invented.ok,
    'and so is a role nobody has thought of yet — the check names what passes, not what does not')
}

// ============ 3. the signature is actually checked ============
console.log('\na signature that is not ours is refused')
{
  const wrong = await S.verifySessionToken(sign(session(), { secret: 'not-the-secret' }), SECRET)
  ok(!wrong.ok, 'a token signed with another secret is refused')
  eq(wrong.reason, 'signature', 'as a signature failure')

  // Signed properly, then the payload swapped for an admin's.
  const [h, , sig] = sign(session()).split('.')
  const forgedPayload = b64url(JSON.stringify(session({ email: 'boss@example.org' })))
  const t = await S.verifySessionToken(`${h}.${forgedPayload}.${sig}`, SECRET)
  ok(!t.ok, 'a payload edited after signing is refused')
  eq(t.reason, 'signature', 'the signature no longer covers it')
}

// ============ 4. the header does not get to choose ============
console.log('\nthe algorithm is ours to pick, not the caller\'s')
{
  const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const p = b64url(JSON.stringify(session()))
  const none = await S.verifySessionToken(`${h}.${p}.`, SECRET)
  ok(!none.ok, 'alg: none is refused')
  eq(none.reason, 'algorithm', 'before anything is done with the token')

  const rs = await S.verifySessionToken(
    sign(session(), { header: { alg: 'RS256', typ: 'JWT' } }), SECRET)
  ok(!rs.ok, 'an asymmetric algorithm name is refused')
  eq(rs.reason, 'algorithm', 'rather than verified with a symmetric key')

  const lower = await S.verifySessionToken(
    sign(session(), { header: { alg: 'hs256', typ: 'JWT' } }), SECRET)
  ok(!lower.ok, 'and the comparison is exact — "hs256" is not "HS256"')
}

// ============ 5. expiry ============
console.log('\nan expired session is refused, and said to be expired')
{
  const past = Math.floor(Date.now() / 1000) - 60
  const e = await S.verifySessionToken(sign(session({ exp: past })), SECRET)
  ok(!e.ok, 'an expired token is refused')
  eq(e.reason, 'expired',
    'and named separately — it is the only refusal worth signing in again for')

  const at = Math.floor(Date.now() / 1000)
  const boundary = await S.verifySessionToken(sign(session({ exp: at })), SECRET, at * 1000)
  ok(!boundary.ok, 'exp exactly now is already expired')

  const none = await S.verifySessionToken(sign(session({ exp: undefined })), SECRET)
  ok(!none.ok, 'a token with NO expiry is refused')
  eq(none.reason, 'not_a_session',
    'because on a stack whose secret never rotates it would be valid forever')

  const nbf = await S.verifySessionToken(sign(session({ nbf: inAnHour() })), SECRET)
  ok(!nbf.ok, 'a token that is not valid yet is refused')
}

// ============ 6. what is not a session at all ============
console.log('\nanything that is not a token is refused without throwing')
{
  for (const junk of ['', 'x', 'a.b', 'a.b.c.d', 'not.a.token', '....', 'Bearer x.y.z']) {
    const r = await S.verifySessionToken(junk, SECRET)
    ok(!r.ok, `refused: ${JSON.stringify(junk)}`)
  }

  const noEmail = await S.verifySessionToken(sign(session({ email: undefined })), SECRET)
  ok(!noEmail.ok, 'a session with no email is refused — the allowlist is keyed by it')

  const noSub = await S.verifySessionToken(sign(session({ sub: undefined })), SECRET)
  ok(!noSub.ok, 'and one with no subject')

  const nosecret = await S.verifySessionToken(sign(session()), '')
  ok(!nosecret.ok, 'with no secret configured, nothing verifies')
  eq(nosecret.reason, 'not_configured', 'and it says so rather than reporting a bad token')
}

// ============ 7. which way this deployment verifies ============
console.log('\nthe choice is made by one variable, and defaults to the platform')
{
  eq(S.sessionMode({ get: () => undefined }), 'platform',
    'no SUPABASE_JWT_SECRET — a hosted project takes the platform path')
  eq(S.sessionMode({ get: () => '   ' }), 'platform',
    'a blank one is not a configuration')
  eq(S.sessionMode({ get: (k) => (k === 'SUPABASE_JWT_SECRET' ? SECRET : undefined) }), 'secret',
    'set, and only then, the self-hosted path')
  eq(S.sessionSecret({ get: () => '  s3cret  ' }), 's3cret', 'the secret is trimmed')
}

// ============ 8. the wrapper, as the function uses it ============
console.log('\nthe wrapper refuses in the envelope the client understands')
{
  const refusals = []
  const refuse = (code, message) => {
    refusals.push(code)
    return Response.json({ ok: false, error: { code, message } }, { status: 401 })
  }

  let seen = null
  const handler = async (_req, ctx) => {
    seen = ctx
    return Response.json({ ok: true })
  }
  const guarded = S.withSecretSession(SECRET, refuse, handler)

  const call = (headers) => guarded(new Request('https://x/api', { method: 'POST', headers }), {
    supabaseAdmin: 'THE REAL CLIENT',
  })

  seen = null
  let res = await call({})
  eq(res.status, 401, 'no Authorization header is a 401')
  eq(refusals.at(-1), 'AUTH_REQUIRED', 'reported as AUTH_REQUIRED')
  ok(seen === null, 'and the handler never ran')

  seen = null
  res = await call({ Authorization: 'Bearer ' + sign(session({ exp: 1 })) })
  eq(refusals.at(-1), 'AUTH_EXPIRED',
    'an expired session is AUTH_EXPIRED — the client renews and retries on that one')
  ok(seen === null, 'the handler still never ran')

  seen = null
  res = await call({ Authorization: 'Bearer ' + sign(session(), { secret: 'wrong' }) })
  eq(refusals.at(-1), 'AUTH_REQUIRED', 'a bad signature is AUTH_REQUIRED, not AUTH_EXPIRED')
  ok(seen === null, 'no handler')

  seen = null
  res = await call({ Authorization: 'Bearer ' + sign({ role: 'anon', exp: 2147483647 }) })
  ok(seen === null, 'the anon key does not reach the handler either')

  seen = null
  const ctxIn = { supabaseAdmin: 'THE REAL CLIENT' }
  res = await guarded(
    new Request('https://x/api', {
      method: 'POST',
      headers: { authorization: 'bearer ' + sign(session()) },
    }),
    ctxIn,
  )
  eq(res.status, 200, 'a valid session reaches the handler')
  ok(seen !== null, 'the handler ran')
  eq(seen?.userClaims?.email, 'helper@example.org', 'with the email on ctx.userClaims')
  eq(seen?.userClaims?.id, '3f1c0a6e-0000-4000-8000-000000000001',
    'and `id`, the same field name the platform path fills')
  ok(seen === ctxIn,
    'the SAME context object — a copy would leave the live admin client behind')
  eq(seen?.supabaseAdmin, 'THE REAL CLIENT', 'which is still there')
}

// ============ 9. the hosted path is untouched ============
console.log('\nnothing above changes what a hosted project does')
{
  const src = readFileSync(ROOT + 'supabase/functions/api/index.ts', 'utf8')
  ok(/withSupabase\(\{ auth: 'user' \}, route\)/.test(src),
    "with no secret set, index.ts still serves withSupabase({ auth: 'user' })")
  ok(/const SESSION_SECRET = sessionSecret\(Deno\.env\)/.test(src),
    'and the choice is read once at boot, not per request')
  ok(src.indexOf('const SESSION_SECRET') > src.indexOf('const route ='),
    'the choice sits after the handler it guards, where the export is')
}

// ============ 10. the whole function, on a self-hosted project ============
console.log('\nthe API answers a real token and refuses the anon key, end to end')
{
  /*
   * The router loaded the way a self-hosted container loads it — with the
   * secret set — and driven through the wrapper rather than around it. The
   * sections above prove the verifier; this proves it is WIRED, which is a
   * different failure and the one that survives a refactor: every assertion
   * about a token is still true when the export forgets to use it.
   */
  setEnv({ SUPER_ADMIN_EMAIL: 'boss@example.org', SUPABASE_JWT_SECRET: SECRET })
  const { fakeDb, baseConfig } = await import('./fakedb.mjs')
  const api = (await loadModule('index.ts')).default

  const world = () => fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'helper@example.org', name: 'Helper', role: 'recorder', active: true, agent_id: null },
    ],
  })

  const call = (authorization) => {
    const w = world()
    const headers = { 'Content-Type': 'application/json' }
    if (authorization) headers.Authorization = authorization
    return api.fetch(
      new Request('https://kong/api', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'whoami', payload: {} }),
      }),
      { ...w.ctx },
    )
  }

  let res = await call('Bearer ' + sign(session()))
  eq(res.status, 200, 'a signed-in volunteer is answered')
  const body = await res.json()
  ok(body.ok, 'the call succeeds')
  eq(body.data?.email, 'helper@example.org', 'as the person the token names')
  eq(body.data?.role, 'recorder', 'with the role the allowlist gives them, not one from the token')

  res = await call('Bearer ' + sign({ role: 'anon', iss: 'supabase', exp: 2147483647 }))
  eq(res.status, 401, 'the anon key out of the page source is refused')
  eq((await res.json()).error?.code, 'AUTH_REQUIRED', 'in the envelope the client reads')

  res = await call(null)
  eq(res.status, 401, 'and so is no token at all')

  res = await call('Bearer ' + sign(session({ email: 'stranger@example.org' })))
  eq(res.status, 403, 'a perfectly valid session for somebody not on the allowlist is refused')
  ok(!(await res.json()).ok, 'the gate is unchanged — verification is not permission')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
