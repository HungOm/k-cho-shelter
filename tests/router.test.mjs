/*
 * The router, driven end to end: a request in, a JSON body out.
 *
 * Everything else tests a handler in isolation or a registry as text. This
 * takes the path a real call takes — identity resolved from the JWT claims,
 * the gate consulted, the handler run, the body serialised — because that is
 * where the last two bugs lived and neither was visible from either side of it.
 *
 * list_permissions is the worked example. It returned { roles, overrides } when
 * the screen reads { roles, actions }, so the Access page did .length on
 * undefined and rendered a blank panel with a console error. Nothing caught it:
 * the handler returned successfully, the gate allowed it, the registry listed
 * it. A payload that is merely the WRONG SHAPE rather than an error is the
 * hardest kind to see from the server, because every check of it passes.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const api = (await loadModule('index.ts')).default

/** One call, as the browser makes it. */
async function call(action, payload, email, world) {
  const w = world ?? fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'admin@x.com', name: 'Admin', role: 'admin', active: true, agent_id: null },
      { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agent_id: null },
    ],
  })
  const req = new Request('https://x/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload ?? {} }),
  })
  const ctx = { ...w.ctx, userClaims: { id: 'u1', email } }
  const res = await api.fetch(req, ctx)
  return { status: res.status, body: await res.json(), world: w }
}

// ============ 1. the shape the Access screen reads ============
console.log('list_permissions returns what the Access screen renders')
{
  const { body } = await call('list_permissions', {}, 'boss@x.com')
  ok(body.ok, 'the call succeeds')

  const d = body.data
  ok(Array.isArray(d.actions), 'actions is an ARRAY — the screen does actions.length on it')
  ok(d.actions.length > 30, `and it is populated (${d.actions?.length})`)
  ok(Array.isArray(d.roles), 'roles is an array')
  eq(d.roles.join(','), 'admin,recorder,agent,viewer', 'with the four roles in order')

  // Every field the component reads off a row.
  const a = d.actions[0]
  for (const k of ['action', 'group', 'label', 'danger', 'sup', 'lockedFor', 'defaults', 'current']) {
    ok(k in a, `each action carries ${k}`)
  }
  // defaults and current must cover every role, or the grid renders holes.
  for (const role of d.roles) {
    ok(role in a.defaults, `defaults has ${role}`)
    ok(role in a.current, `current has ${role}`)
  }

  // Labels, not bare action names — the screen is read by organisers.
  const sell = d.actions.find((x) => x.action === 'sell_ticket')
  eq(sell.label, 'Record a sale', 'actions are labelled in words')
  eq(sell.group, 'Tickets', 'and grouped')
  ok(d.actions.find((x) => x.action === 'settle_book').danger, 'settling is marked dangerous')
}

// ============ 2. the gate still decides, not the screen ============
console.log('a super-admin-only action is never offered to a role')
{
  const { body } = await call('list_permissions', {}, 'boss@x.com')
  const voidT = body.data.actions.find((x) => x.action === 'void_ticket')
  ok(voidT.sup, 'void_ticket is flagged super-admin-only')
  for (const role of body.data.roles) {
    eq(voidT.current[role], 'false', `and is off for ${role}`)
  }
  // Otherwise the screen would show a switch that grants what the gate refuses,
  // and the gate is the one that decides.
}

console.log('an override is reflected, but cannot reach a super-only action')
{
  const world = fakeDb({
    config: baseConfig(),
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null }],
    permissions: [
      { action: 'report_overdue', role: 'agent', allowed: true },
      { action: 'void_ticket', role: 'agent', allowed: true },
    ],
  })
  const { body } = await call('list_permissions', {}, 'boss@x.com', world)
  const overdue = body.data.actions.find((x) => x.action === 'report_overdue')
  eq(overdue.current.agent, 'true', 'an override turns an action on')
  eq(overdue.defaults.agent, 'false', 'while the default stays visible beside it')

  const voidT = body.data.actions.find((x) => x.action === 'void_ticket')
  eq(voidT.current.agent, 'false', 'but an override cannot grant a super-only action')
}

// ============ 3. who may ask ============
console.log('the gate runs before the handler')
{
  const r = await call('list_permissions', {}, 'admin@x.com')
  eq(r.body.error?.code, 'SUPER_ADMIN_ONLY', 'an organiser cannot read the permissions table')
  eq(r.status, 403, 'with the right status')

  const r2 = await call('list_permissions', {}, 'rec@x.com')
  eq(r2.body.error?.code, 'SUPER_ADMIN_ONLY', 'nor can a recorder')

  const r3 = await call('whoami', {}, 'nobody@x.com')
  eq(r3.body.error?.code, 'NOT_AUTHORIZED', 'somebody not on the list is refused')

  const r4 = await api.fetch(
    new Request('https://x/api', { method: 'POST', body: JSON.stringify({ action: 'whoami' }) }),
    { ...fakeDb({ config: baseConfig() }).ctx, userClaims: null })
  eq((await r4.json()).error?.code, 'AUTH_REQUIRED', 'and nobody signed in at all')
}

// ============ 4. the envelope ============
console.log('every reply has the shape the client unwraps')
{
  const { body, status } = await call('whoami', {}, 'boss@x.com')
  eq(status, 200, 'a good call is 200')
  ok(body.ok === true, 'ok:true')
  ok('data' in body, 'with the payload under data')
  ok(body.serverTime, 'and a server clock')

  const bad = await call('no_such_action', {}, 'boss@x.com')
  eq(bad.body.ok, 'false', 'a bad call is ok:false')
  ok(bad.body.error?.code, 'with a code')
  ok(bad.body.error?.message, 'and something a person can read')
  // Left deliberately blunt: a friendly message for a missing handler is how a
  // missing handler stops getting fixed.
  eq(bad.body.error.code, 'UNKNOWN_ACTION', 'named plainly')
}

// ============ 5. whoami is what the whole app boots on ============
console.log('whoami carries what the interface needs to draw itself')
{
  const { body } = await call('whoami', {}, 'boss@x.com')
  const d = body.data
  eq(d.email, 'boss@x.com', 'the email')
  eq(d.role, 'admin', 'the role')
  eq(d.isSuperAdmin, 'true', 'and super-admin status as its own field')
  // Separate fields on purpose: the footer prints "Super admin" off the flag,
  // not off the role, because the row role is only ever ordinary.
  ok(d.config, 'plus the raffle settings')
  for (const k of ['ticketPrefix', 'ticketsPerBook', 'totalTickets', 'ticketPrice', 'currency']) {
    ok(k in d.config, `config carries ${k}`)
  }
}

console.log('a superadmin row is a super admin on this backend too')
{
  const world = fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'two@x.com', name: 'Two', role: 'superadmin', active: true, agent_id: null },
      { email: 'off@x.com', name: 'Off', role: 'superadmin', active: false, agent_id: null },
    ],
  })

  const me = await call('whoami', {}, 'two@x.com', world)
  eq(me.body.data.isSuperAdmin, 'true', 'the flag is set from the row')
  eq(me.body.data.role, 'admin', 'and the role RESOLVES to admin')

  // Both halves of the resolution, through the real gate.
  const sup = await call('list_permissions', {}, 'two@x.com', world)
  ok(sup.body.ok, 'they can reach a super-admin-only action')
  const ord = await call('list_books', {}, 'two@x.com', world)
  ok(ord.body.ok, 'and an ordinary admin one, which a fifth tier would have broken')

  // A row is a row: it can be switched off.
  const dead = await call('whoami', {}, 'off@x.com', world)
  eq(dead.body.error?.code, 'ACCOUNT_DISABLED', 'a disabled superadmin row cannot sign in')

  // The secret still wins over everything, including a row that says otherwise.
  const demoted = fakeDb({
    config: baseConfig(),
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'viewer', active: false, agent_id: null }],
  })
  const owner = await call('whoami', {}, 'boss@x.com', demoted)
  eq(owner.body.data?.isSuperAdmin, 'true', 'SUPER_ADMIN_EMAIL outranks a row set to viewer and off')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
