/*
 * Who may do what — asserted against the gate itself.
 *
 * WHAT THIS REPLACED. This was `gateparity.test.mjs`, which ran the Apps Script
 * gate and the ported one over the same grid and asserted they never disagreed.
 * Its own header said what it was for: "while both exist, they have to agree;
 * when Apps Script goes, this file is what proved the replacement before the
 * original was deleted." Apps Script has gone, so the comparison has nothing to
 * compare against — and simply deleting the file would have taken the override
 * and super-admin blocks with it, which never touched the spreadsheet and are
 * the only assertions anywhere on the two invariants that matter most.
 *
 * So the grid stays and the oracle changes. Instead of "the other backend says
 * the same", each answer is checked against what the REGISTRY DECLARES — which
 * is the thing a reader of index.ts believes, and therefore the thing that has
 * to be true.
 *
 * WHY IT IS STILL WORTH A FILE. The failure here is silent. A rule that drifts
 * does not throw; it quietly lets somebody do something, and the first sign is
 * a ticket voided by a person who should not have been able to.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

// --- the gate, transpiled out of TypeScript ---
const out = mkdtempSync(join(tmpdir(), 'gate-'))
const js = join(out, 'gate.mjs')
execFileSync(join(ROOT, 'node_modules/esbuild/bin/esbuild'),
  [join(ROOT, 'supabase/functions/api/gate.ts'), '--format=esm', '--outfile=' + js])
const gate = await import(js)

let pass = 0, fail = 0
const ok = (c, w) => { if (c) pass++; else { fail++; console.log('  FAIL ' + w) } }

/*
 * THE REGISTRY, READ OUT OF THE SOURCE — the same approach portparity.test.mjs
 * takes, and for the same reason: index.ts does not export it, and a copy typed
 * here would be a second registry that drifts from the first.
 *
 * `ADMIN_ONLY` is the file's own name for `[]`, which means "admins and nobody
 * else" rather than "nobody".
 */
const REGISTRY = (() => {
  const ts = readFileSync(join(ROOT, 'supabase/functions/api/index.ts'), 'utf8')
  const start = ts.indexOf('const REGISTRY')
  const body = ts.slice(start, ts.indexOf('\n}', start))
  const specs = {}
  for (const m of body.matchAll(/^ {2}([a-z_]+):\s*\{([^}]*)\}/gm)) {
    const b = m[2]
    const raw = (b.match(/roles:\s*(ADMIN_ONLY|null|\[[^\]]*\])/) || [])[1]
    let roles
    if (raw === 'ADMIN_ONLY') roles = []
    else if (raw === 'null') roles = null
    else if (raw) roles = [...raw.matchAll(/'([a-z]+)'/g)].map(x => x[1])
    specs[m[1]] = { roles, sup: /sup:\s*true/.test(b), kind: (b.match(/kind:\s*'([a-z]+)'/) || [])[1] }
  }
  return specs
})()

const ACTIONS = Object.keys(REGISTRY)
const ROLES = ['admin', 'recorder', 'agent', 'viewer']

/*
 * THE PARSE IS CHECKED BEFORE IT IS TRUSTED.
 *
 * Every assertion below loops over ACTIONS. If the regex stopped matching — a
 * reformatted registry, an entry wrapped across two lines — the loops would run
 * zero times and this file would pass with nothing tested at all. That is the
 * shape of dead test this repository has been bitten by before, so the parse
 * states what it expects to have found.
 */
console.log('the registry was actually read')
{
  ok(ACTIONS.length > 60, `parsed ${ACTIONS.length} actions out of index.ts`)
  ok(ACTIONS.every(a => REGISTRY[a].kind), 'every action declares a kind')
  ok(ACTIONS.every(a => REGISTRY[a].roles === null || Array.isArray(REGISTRY[a].roles)),
     'and either names its roles or is open to any signed-in user')
  // Three shapes have to be present or the grid is not exercising the branches.
  ok(ACTIONS.some(a => REGISTRY[a].roles === null), 'some actions are open to anybody signed in')
  ok(ACTIONS.some(a => Array.isArray(REGISTRY[a].roles) && !REGISTRY[a].roles.length),
     'some are admins-only')
  ok(ACTIONS.some(a => REGISTRY[a].sup), 'and some are the owner\'s alone')
}

const user = (role, isSuper = false) => ({
  email: 'x@x.com', name: 'X', role, active: true, agentId: null,
  isAdmin: isSuper || role === 'admin', isSuperAdmin: isSuper,
})

console.log('every action, every role, against what the registry declares')
{
  for (const action of ACTIONS) {
    const spec = REGISTRY[action]
    for (const role of ROLES) {
      for (const isSuper of [false, true]) {
        const got = gate.isActionAllowed(action, spec, user(role, isSuper), {})

        // What the registry says should happen, worked out here rather than
        // asked of the gate — otherwise this is the gate agreeing with itself.
        let want
        if (isSuper) want = true                      // the owner passes everything
        else if (spec.sup) want = false               // and is the only one who does
        else if (role === 'admin') want = true        // admins pass the registry defaults
        else if (!spec.roles) want = true             // open to any signed-in user
        else want = spec.roles.includes(role)

        ok(got === want,
           `${action} / ${role}${isSuper ? ' (super)' : ''}: gate said ${got}, registry implies ${want}`)
      }
    }
  }
  console.log(`  checked ${ACTIONS.length} actions x ${ROLES.length} roles x 2`)
}

console.log('with the permissions table overriding')
{
  // Granting and revoking each action for each role, one at a time — including
  // the grants that must be refused (the sup bar, and admin user-management).
  for (const action of ACTIONS) {
    const spec = REGISTRY[action]
    for (const role of ROLES) {
      for (const allowed of [true, false]) {
        const b = gate.isActionAllowed(action, spec, user(role, false),
                                       { [action]: { [role]: allowed } })

        // The invariants that must survive an override, asserted directly:
        // they are the reason the table exists in this shape.
        if (spec.sup) {
          ok(b === false, `${action} is super-only and must stay ungrantable (${role}, set ${allowed})`)
        } else if (role === 'admin' && gate.LOCKED_FOR_ADMIN.includes(action)) {
          ok(b === true, `${action} must stay with admins whatever the table says`)
        } else if (!allowed) {
          ok(b === false, `${action} / ${role}: a revoking row must always be obeyed`)
        } else {
          /*
           * A GRANTING ROW MAY NOT WIDEN A WRITE, which is the rule that
           * changed. It used to be final: one row could hand settle_book or
           * record_payment to `viewer`, the role whose whole definition is that
           * it changes nothing. set_permission is superadmin-only, so this was
           * never a path from outside — what it bought was doing it QUIETLY,
           * leaving a viewer account settling books with nothing on screen or
           * in the registry to say why.
           *
           * Reads stay grantable: they show something, the masking views decide
           * what is visible whatever the role, and a raffle does want to show a
           * viewer a report nobody thought of when the registry was written.
           */
          const writes = spec.kind !== 'read' && spec.kind !== 'report'
          const registryAllows = !spec.roles || spec.roles.includes(role) || role === 'admin'
          const want = writes ? registryAllows : true
          ok(b === want,
             `${action} / ${role}: granting row, ${writes ? 'write' : 'read'}, ` +
             `registry ${registryAllows ? 'allows' : 'does not allow'} — gate said ${b}`)
        }
      }
    }
  }
}

console.log('and the widening a granting row can no longer do')
{
  /*
   * Stated as the concrete case rather than left to the sweep above, because
   * this is the one somebody will try: the quietest way to give an account that
   * cannot change anything the ability to close books and take money.
   */
  const viewer = user('viewer', false)
  for (const action of ['settle_book', 'restock_books', 'record_payment', 'write_off']) {
    const spec = REGISTRY[action]
    if (!spec) continue
    ok(gate.isActionAllowed(action, spec, viewer, { [action]: { viewer: true } }) === false,
       `${action} cannot be granted to a viewer by a row`)
  }
  // And the other direction still works, or the table would be pointless.
  const recorder = user('recorder', false)
  ok(gate.isActionAllowed('record_payment', REGISTRY.record_payment, recorder,
       { record_payment: { recorder: false } }) === false,
     'taking a capability away from a role that has it still works')
}

console.log('the super admin comes from the environment, never a row')
{
  const env = { get: k => (k === 'SUPER_ADMIN_EMAIL' ? 'Boss@X.com  ' : undefined) }
  ok(gate.isSuperAdminEmail('boss@x.com', env), 'matched case- and space-insensitively')
  ok(!gate.isSuperAdminEmail('admin@x.com', env), 'an ordinary admin is not super')
  ok(!gate.isSuperAdminEmail('', { get: () => undefined }), 'unset means nobody, not everybody')
  ok(!gate.isSuperAdminEmail(null, { get: () => undefined }), 'and null is not a match either')

  // A row claiming admin does not make a super admin, and a row switched off
  // does not unmake one. Both directions matter.
  const asRow = gate.resolveUser('admin@x.com',
    { role: 'admin', active: true, name: 'A', agent_id: null }, env)
  ok(!asRow.isSuperAdmin, 'a row cannot grant super admin')

  const disabled = gate.resolveUser('boss@x.com',
    { role: 'viewer', active: false, name: 'B', agent_id: null }, env)
  ok(disabled.isSuperAdmin && disabled.isAdmin && disabled.active,
    'a disabled, demoted row cannot lock the super admin out')

  const noRow = gate.resolveUser('boss@x.com', null, env)
  ok(noRow.isSuperAdmin, 'and no row at all still works')

  let threw = null
  try { gate.resolveUser('stranger@x.com', null, env) } catch (e) { threw = e.code }
  ok(threw === 'NOT_AUTHORIZED', 'a stranger with no row is refused')

  // Each account state refuses under its own name. A row with only the old
  // boolean still refuses — as suspended, which is what active:false meant.
  let off = null
  try {
    gate.resolveUser('rec@x.com', { role: 'recorder', active: false, name: 'R', agent_id: null }, env)
  } catch (e) { off = e.code }
  ok(off === 'ACCOUNT_SUSPENDED', `an old-style disabled row is refused (${off})`)

  for (const [status, code] of [
    ['pending', 'ACCOUNT_PENDING'],
    ['suspended', 'ACCOUNT_SUSPENDED'],
    ['banned', 'ACCOUNT_BANNED'],
  ]) {
    let got = null, details = null
    try {
      gate.resolveUser('rec@x.com', { role: 'recorder', status, name: 'R', agent_id: null }, env)
    } catch (e) { got = e.code; details = e.details }
    ok(got === code, `${status} refuses as ${code} (${got})`)
    ok(details?.status === status, `and carries the status for the screen`)
  }

  // The one named in the secret is immune to all of it.
  const banned = gate.resolveUser('boss@x.com', { role: 'viewer', status: 'banned', name: 'B', agent_id: null }, env)
  ok(banned.isSuperAdmin, 'the secret outranks even a banned row')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
