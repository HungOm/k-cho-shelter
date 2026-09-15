/*
 * Does the ported gate answer exactly what the Apps Script gate answers?
 *
 * This is the test the migration turns on. Everything else in the port can be
 * checked by reading it; who may do what cannot, because the failure is silent
 * — a rule that drifts does not throw, it just quietly lets somebody do
 * something, and the first sign is a ticket voided by a person who should not
 * have been able to.
 *
 * So rather than testing the new gate against its own idea of correct, it runs
 * both implementations over the same grid — every action, every role, with and
 * without permission overrides — and asserts they never disagree. While both
 * exist, they have to agree; when Apps Script goes, this file is what proved
 * the replacement before the original was deleted.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const gsFiles = createRequire(import.meta.url)('./loadgs.cjs')

const ROOT = new URL('..', import.meta.url).pathname

// --- the ported gate, transpiled out of TypeScript ---
const out = mkdtempSync(join(tmpdir(), 'gate-'))
const js = join(out, 'gate.mjs')
execFileSync(join(ROOT, 'node_modules/esbuild/bin/esbuild'),
  [join(ROOT, 'supabase/functions/api/gate.ts'), '--format=esm', '--outfile=' + js])
const ported = await import(js)

// --- the Apps Script gate, in its own sandbox ---
const gs = gsFiles()
const shim = `
  globalThis.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k === 'SUPER_ADMIN_EMAIL' ? 'boss@x.com' : null), setProperty: () => {} }) };
  globalThis.CacheService = { getScriptCache: () => ({
    get: () => null, put: () => {}, remove: () => {}, getAll: () => ({}), putAll: () => {} }) };
  globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) };
  globalThis.Utilities = { computeDigest: (_a, t) => Array.from(String(t)).map(c => c.charCodeAt(0)),
    base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), DigestAlgorithm: { SHA_256: 1 } };
  globalThis.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  globalThis.UrlFetchApp = { fetch: () => { throw new Error('no network'); } };
  globalThis.Logger = { log: () => {} };
`
const gsSrc = shim + gs.map(f => readFileSync(join(ROOT, 'apps_script', f), 'utf8')).join('\n') +
  '\nexport { isActionAllowed_, actionRegistry, PERMISSION_ROLES, LOCKED_FOR_ADMIN_EXPORT };' +
  '\nconst LOCKED_FOR_ADMIN_EXPORT = PERMISSION_LOCKED_FOR_ADMIN;'
const gsFile = join(out, 'gs.mjs')
writeFileSync(gsFile, gsSrc)
const sheets = await import(gsFile)

let pass = 0, fail = 0
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w) } }

const REGISTRY = sheets.actionRegistry()
const ACTIONS = Object.keys(REGISTRY).filter(a => !REGISTRY[a].pub)
const ROLES = ['admin', 'recorder', 'agent', 'viewer']

/** The same person, expressed the way each implementation expects. */
function pair(role, isSuper) {
  const isAdmin = isSuper || role === 'admin'
  return [
    { role, isAdmin, isSuperAdmin: isSuper },                                   // Apps Script
    { email: 'x@x.com', name: 'X', role, active: true, agentId: null, isAdmin, isSuperAdmin: isSuper },
  ]
}

/*
 * THE TWO REGISTRIES, COMPARED AGAINST EACH OTHER.
 *
 * Everything below this feeds ONE spec — the Apps Script one — to both gates,
 * which compares the two ALGORITHMS and never the two tables of values. So a
 * `roles` or `sup` typed differently in index.ts from Api.gs passed silently,
 * while the comment above that registry said this file was what kept them
 * honest: "a value mistyped here shows up as a disagreement rather than as a
 * quiet permission change nobody notices". It did not. The algorithms agreed
 * about a spec neither file necessarily held.
 *
 * Read out of the source rather than imported, because index.ts is Deno and
 * TypeScript and the registry is a literal — the same way portparity.test.mjs
 * reads it. A regex over a literal is coarse; what it has to catch is a value
 * that differs, and for that it is enough.
 *
 * DIVERGENCES ARE ALLOWED AND MUST BE WRITTEN DOWN. The two backends are not
 * required to be identical any more — one has a database underneath it — but
 * every difference in who may do what is a permission decision, and a
 * permission decision nobody recorded is indistinguishable from a typo.
 */
const DIVERGENT = new Map([
  ['read_audit',
   'Supabase opens the change log to organisers because it can take the super ' +
   "admin's address out of every entry per request, including inside details. " +
   'Apps Script returns sheet rows as they are and has nowhere to do that, so ' +
   'there it stays super-admin-only.'],
])

console.log('the two registries agree about who may do what')
{
  const ts = readFileSync(join(ROOT, 'supabase/functions/api/index.ts'), 'utf8')
  const body = ts.slice(ts.indexOf('const REGISTRY'))
  const tsSpec = new Map()
  for (const m of body.matchAll(/^ {2}([a-z_]+):\s*\{([^}]*)\}/gm)) {
    const [, action, inner] = m
    if (!inner.includes('fn:')) continue
    const roles = /roles:\s*null/.test(inner) ? null
      : /roles:\s*ADMIN_ONLY/.test(inner) ? []
      : (inner.match(/roles:\s*\[([^\]]*)\]/) || [, ''])[1]
          .split(',').map(x => x.trim().replace(/['"]/g, '')).filter(Boolean)
    tsSpec.set(action, { roles, sup: /sup:\s*true/.test(inner) })
  }
  ok(tsSpec.size > 25, `Supabase registry parsed (${tsSpec.size} actions)`)

  let compared = 0
  for (const action of ACTIONS) {
    const a = REGISTRY[action]
    const b = tsSpec.get(action)
    if (!b) continue                       // portparity owns "missing entirely"
    compared++
    const why = DIVERGENT.get(action)
    const sameSup = !!a.sup === b.sup
    const sameRoles = JSON.stringify(a.roles ?? null) === JSON.stringify(b.roles)
    if (why) {
      ok(!(sameSup && sameRoles),
        `${action} is listed as divergent but the two registries now agree — delete the entry`)
      ok(why.length > 40, `${action}'s divergence gives an actual reason`)
      continue
    }
    ok(sameSup,
      `${action}: Apps Script sup=${!!a.sup}, Supabase sup=${b.sup} — and no reason recorded`)
    ok(sameRoles,
      `${action}: Apps Script roles=${JSON.stringify(a.roles ?? null)}, ` +
      `Supabase roles=${JSON.stringify(b.roles)} — and no reason recorded`)
  }
  ok(compared > 25, `compared ${compared} actions present in both`)
}

console.log('every action, every role, no overrides')
{
  for (const action of ACTIONS) {
    const spec = REGISTRY[action]
    for (const role of ROLES) {
      for (const isSuper of [false, true]) {
        const [gsUser, tsUser] = pair(role, isSuper)
        const a = sheets.isActionAllowed_(action, spec, gsUser)
        const b = ported.isActionAllowed(action,
          { roles: spec.roles ?? null, sup: !!spec.sup, kind: spec.kind }, tsUser, {})
        ok(a === b,
          `${action} / ${role}${isSuper ? ' (super)' : ''}: Apps Script says ${a}, port says ${b}`)
      }
    }
  }
  console.log(`  compared ${ACTIONS.length} actions x ${ROLES.length} roles x 2`)
}

console.log('with the permissions table overriding')
{
  // Granting and revoking each action for each role, one at a time — including
  // the grants that must be refused (the sup bar, and admin user-management).
  for (const action of ACTIONS) {
    const spec = REGISTRY[action]
    for (const role of ROLES) {
      for (const allowed of [true, false]) {
        const [gsUser, tsUser] = pair(role, false)
        globalThis.__perm = { [action]: { [role]: allowed } }
        sheets.__setOverrides?.(globalThis.__perm)

        const b = ported.isActionAllowed(action,
          { roles: spec.roles ?? null, sup: !!spec.sup, kind: spec.kind }, tsUser,
          { [action]: { [role]: allowed } })

        // The invariants that must survive an override, asserted directly:
        // they are the reason the table exists in this shape.
        if (spec.sup) {
          ok(b === false, `${action} is super-only and must stay ungrantable (${role}, set ${allowed})`)
        } else if (role === 'admin' && ported.LOCKED_FOR_ADMIN.includes(action)) {
          ok(b === true, `${action} must stay with admins whatever the table says`)
        } else {
          ok(b === allowed, `${action} / ${role}: table said ${allowed}, port said ${b}`)
        }
      }
    }
  }
}

console.log('the super admin comes from the environment, never a row')
{
  const env = { get: k => (k === 'SUPER_ADMIN_EMAIL' ? 'Boss@X.com  ' : undefined) }
  ok(ported.isSuperAdminEmail('boss@x.com', env), 'matched case- and space-insensitively')
  ok(!ported.isSuperAdminEmail('admin@x.com', env), 'an ordinary admin is not super')
  ok(!ported.isSuperAdminEmail('', { get: () => undefined }), 'unset means nobody, not everybody')
  ok(!ported.isSuperAdminEmail(null, { get: () => undefined }), 'and null is not a match either')

  // A row claiming admin does not make a super admin, and a row switched off
  // does not unmake one. Both directions matter.
  const asRow = ported.resolveUser('admin@x.com',
    { role: 'admin', active: true, name: 'A', agent_id: null }, env)
  ok(!asRow.isSuperAdmin, 'a row cannot grant super admin')

  const disabled = ported.resolveUser('boss@x.com',
    { role: 'viewer', active: false, name: 'B', agent_id: null }, env)
  ok(disabled.isSuperAdmin && disabled.isAdmin && disabled.active,
    'a disabled, demoted row cannot lock the super admin out')

  const noRow = ported.resolveUser('boss@x.com', null, env)
  ok(noRow.isSuperAdmin, 'and no row at all still works')

  let threw = null
  try { ported.resolveUser('stranger@x.com', null, env) } catch (e) { threw = e.code }
  ok(threw === 'NOT_AUTHORIZED', 'a stranger with no row is refused')

  // Each account state refuses under its own name. A row with only the old
  // boolean still refuses — as suspended, which is what active:false meant.
  let off = null
  try {
    ported.resolveUser('rec@x.com', { role: 'recorder', active: false, name: 'R', agent_id: null }, env)
  } catch (e) { off = e.code }
  ok(off === 'ACCOUNT_SUSPENDED', `an old-style disabled row is refused (${off})`)

  for (const [status, code] of [
    ['pending', 'ACCOUNT_PENDING'],
    ['suspended', 'ACCOUNT_SUSPENDED'],
    ['banned', 'ACCOUNT_BANNED'],
  ]) {
    let got = null, details = null
    try {
      ported.resolveUser('rec@x.com', { role: 'recorder', status, name: 'R', agent_id: null }, env)
    } catch (e) { got = e.code; details = e.details }
    ok(got === code, `${status} refuses as ${code} (${got})`)
    ok(details?.status === status, `and carries the status for the screen`)
  }

  // The one named in the secret is immune to all of it.
  const banned = ported.resolveUser('boss@x.com', { role: 'viewer', status: 'banned', name: 'B', agent_id: null }, env)
  ok(banned.isSuperAdmin, 'the secret outranks even a banned row')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
