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
  // Named by WHICH state, not a generic refusal — the whole point of the
  // lifecycle is that the person is told what actually applies to them.
  eq(dead.body.error?.code, 'ACCOUNT_SUSPENDED', 'a suspended superadmin row cannot sign in')
  eq(dead.body.error?.details?.status, 'suspended', 'and the status travels with it')

  // The secret still wins over everything, including a row that says otherwise.
  const demoted = fakeDb({
    config: baseConfig(),
    app_users: [{ email: 'boss@x.com', name: 'Boss', role: 'viewer', active: false, agent_id: null }],
  })
  const owner = await call('whoami', {}, 'boss@x.com', demoted)
  eq(owner.body.data?.isSuperAdmin, 'true', 'SUPER_ADMIN_EMAIL outranks a row set to viewer and off')
}

console.log('an organiser may ASK to add a helper, and may not ask to add a peer')
{
  const world = () => fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agent_id: null },
      { email: 'admin@x.com', name: 'Admin', role: 'admin', active: true, agent_id: null },
    ],
    agents: [{ agent_id: 'A001', name: 'Daw Hla', active: true }],
  })

  // The three that become requestable.
  for (const [role, word] of [['recorder', 'Helper'], ['viewer', 'view-only']]) {
    const w = world()
    const r = await call('upsert_user', { email: 'new@x.com', role }, 'admin@x.com', w)
    eq(r.body.error?.code, 'APPROVAL_REQUIRED', `${role} becomes a request, not a refusal`)
    ok(String(r.body.error?.details?.summary).includes('new@x.com'),
       'the summary names the person')
    ok(String(r.body.error?.details?.summary).includes(word),
       `and names the role in words (${word})`)
    eq(w.table('app_users').length, 2, 'and nobody was added')
  }

  // The two that stay impossible. Not approvable — refused.
  for (const role of ['admin', 'superadmin']) {
    const w = world()
    const r = await call('upsert_user', { email: 'peer@x.com', role }, 'admin@x.com', w)
    eq(r.body.error?.code, 'SUPER_ADMIN_ONLY', `${role} is refused outright, never queued`)
    // An approvable request to create a peer is an escalation with a waiting
    // period rather than an escalation prevented.
    ok(!String(r.body.error?.message).includes('approv'), 'and is not offered as a request')
    eq(w.table('app_users').length, 2, 'nobody was added')
  }

  // The owner still just does it — no queue for a request they would approve.
  {
    const w = world()
    const r = await call('upsert_user', { email: 'new@x.com', role: 'recorder' }, 'boss@x.com', w)
    ok(r.body.ok, 'the owner adds a helper directly')
    eq(w.table('app_users').length, 3, 'and the row exists')
  }

  // An existing organiser cannot be edited through the requestable door.
  {
    const w = world()
    const r = await call('upsert_user', { email: 'admin@x.com', role: 'viewer' }, 'admin@x.com', w)
    eq(r.body.error?.code, 'SUPER_ADMIN_ONLY',
       'pointing a "make a viewer" request at an existing organiser is refused')
  }
}

console.log('each account state says which it is, and none of them see anything')
{
  const world = () => fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'wait@x.com', name: 'Wait', role: 'recorder', status: 'pending', active: false, agent_id: null },
      { email: 'paused@x.com', name: 'P', role: 'recorder', status: 'suspended', active: false, agent_id: null },
      { email: 'gone@x.com', name: 'G', role: 'recorder', status: 'banned', active: false, agent_id: null },
      { email: 'ok@x.com', name: 'OK', role: 'recorder', status: 'active', active: true, agent_id: null },
    ],
  })

  for (const [email, code, status] of [
    ['wait@x.com', 'ACCOUNT_PENDING', 'pending'],
    ['paused@x.com', 'ACCOUNT_SUSPENDED', 'suspended'],
    ['gone@x.com', 'ACCOUNT_BANNED', 'banned'],
  ]) {
    const r = await call('whoami', {}, email, world())
    eq(r.body.error?.code, code, `${status} is named as ${code}`)
    eq(r.body.error?.details?.status, status, 'with the status in details for the screen')
    eq(r.status, 403, 'refused')

    // AND SEES NOTHING. The distinct message is a courtesy; the denial is total.
    for (const action of ['read_snapshot', 'list_books', 'list_agents', 'search']) {
      const d = await call(action, { q: 'KS' }, email, world())
      eq(d.body.error?.code, code, `${status} cannot ${action} either`)
    }
  }

  const good = await call('whoami', {}, 'ok@x.com', world())
  ok(good.body.ok, 'and an active account works')
}

console.log('letting somebody in is the owner\'s act; stopping them is urgent')
{
  const world = () => fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'admin@x.com', name: 'Admin', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'wait@x.com', name: 'Wait', role: 'agent', status: 'pending', active: false, agent_id: 'A001' },
      { email: 'sell@x.com', name: 'Sell', role: 'agent', status: 'active', active: true, agent_id: 'A001' },
    ],
    agents: [{ agent_id: 'A001', name: 'Daw Hla', active: true }],
  })

  // An organiser may PAUSE a seller — the lost-phone case, which is urgent.
  const w1 = world()
  const stop = await call('set_user_status', { email: 'sell@x.com', status: 'suspended' }, 'admin@x.com', w1)
  ok(stop.body.ok, 'an organiser can pause a seller')
  eq(w1.row('app_users', (u) => u.email === 'sell@x.com').status, 'suspended', 'and it took')

  // ...and may NOT let one in. Admitting is the decision that matters.
  const w2 = world()
  const admit = await call('set_user_status', { email: 'wait@x.com', status: 'active' }, 'admin@x.com', w2)
  eq(admit.body.error?.code, 'SUPER_ADMIN_ONLY', 'an organiser cannot let a pending account in')
  eq(w2.row('app_users', (u) => u.email === 'wait@x.com').status, 'pending', 'it stays pending')

  const w3 = world()
  const owner = await call('set_user_status', { email: 'wait@x.com', status: 'active' }, 'boss@x.com', w3)
  ok(owner.body.ok, 'the owner can')
  eq(w3.row('app_users', (u) => u.email === 'wait@x.com').status, 'active', 'and it takes')

  // A new row starts pending: added and let in are two acts.
  const w4 = world()
  await call('upsert_user', { email: 'fresh@x.com', role: 'recorder' }, 'boss@x.com', w4)
  // The owner adding somebody IS approving them — approving twice would make
  // "waiting to be let in" a message the app shows when nothing is queued.
  eq(w4.row('app_users', (u) => u.email === 'fresh@x.com').status, 'active',
     'the owner adding somebody lets them in')

  const w4b = world()
  await call('upsert_user', { email: 'later@x.com', role: 'recorder', status: 'pending' }, 'boss@x.com', w4b)
  eq(w4b.row('app_users', (u) => u.email === 'later@x.com').status, 'pending',
     'and they can stage somebody ahead of time if they choose')

  // Editing a suspended account must not quietly readmit it.
  const w5 = world()
  await call('set_user_status', { email: 'sell@x.com', status: 'suspended' }, 'boss@x.com', w5)
  await call('upsert_user', { email: 'sell@x.com', role: 'agent', agentId: 'A001', name: 'New Name' }, 'boss@x.com', w5)
  eq(w5.row('app_users', (u) => u.email === 'sell@x.com').status, 'suspended',
     'renaming a suspended account leaves it suspended')

  // The account named in the function secret cannot be stopped at all — a
  // stronger refusal than the self-check, and it comes first.
  const w6 = world()
  const owner2 = await call('set_user_status', { email: 'boss@x.com', status: 'banned' }, 'boss@x.com', w6)
  eq(owner2.body.error?.code, 'SUPER_ADMIN_ONLY', 'the owner account cannot be stopped from the app')

  // A superadmin BY ROW is an ordinary row, so the self-check is what protects
  // them — locking yourself out is a support call you cannot make.
  const w7 = fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'two@x.com', name: 'Two', role: 'superadmin', status: 'active', active: true, agent_id: null },
    ],
  })
  const self = await call('set_user_status', { email: 'two@x.com', status: 'banned' }, 'two@x.com', w7)
  eq(self.body.error?.code, 'BAD_REQUEST', 'you cannot stop your own account')
  eq(w7.row('app_users', (u) => u.email === 'two@x.com').status, 'active', 'and it stayed active')
}

console.log('an APPROVED request actually runs — driven through decide, not around it')
{
  /*
   * THE GUARD FOR AN ENTIRE CLASS THIS SUITE COULD NOT SEE.
   *
   * decideApproval runs the approved action as the REQUESTER, so upsertUser
   * sees an organiser and depends on a flag to tell "they asked directly" from
   * "the owner said yes". The flag was set correctly and cleared in a finally —
   * which runs the moment the PROMISE is returned, not when it settles. So it
   * was already false by the time the handler awaited its way down to reading
   * it, and EVERY approved request was refused at the moment of approval, with
   * "Only the owner can let somebody in" shown to the owner.
   *
   * Nothing here caught it, because every other test calls handlers directly.
   * What was wrong was the wrapper's control flow, so the assertion has to go
   * through the wrapper: ask, approve, and check the row exists afterwards.
   */
  const world = fakeDb({
    config: baseConfig(),
    app_users: [
      { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active', active: true, agent_id: null },
      { email: 'admin@x.com', name: 'Admin', role: 'admin', status: 'active', active: true, agent_id: null },
    ],
  })

  // 1. the organiser asks
  const asked = await call('request_approval',
    { action: 'upsert_user', payload: { email: 'helper@x.com', role: 'recorder' } },
    'admin@x.com', world)
  ok(asked.body.ok, 'the organiser can lodge the request')
  const id = asked.body.data?.requestId
  ok(id, 'and gets a request id back')
  ok(String(asked.body.data?.summary).includes('helper@x.com'), 'with the sentence the owner will read')
  eq(world.table('app_users').length, 2, 'and nobody has been added yet')

  // 2. the owner approves — and the action must actually HAPPEN
  const decided = await call('decide_approval', { requestId: id, approve: true }, 'boss@x.com', world)
  ok(decided.body.ok, `approving succeeds (${decided.body.error?.code ?? ''} ${decided.body.error?.message ?? ''})`)
  eq(decided.body.data?.executed, 'true', 'and reports that it executed')

  // The whole point: the row exists. An approval that approves and does not act
  // is worse than a refusal, because the owner believes they have done it.
  const made = world.row('app_users', (u) => u.email === 'helper@x.com')
  ok(made, 'the account was actually created')
  eq(made?.role, 'recorder', 'with the role that was asked for')
  eq(made?.status, 'active', 'and let in, because approving IS letting them in')

  // 3. the flag must not survive the call — it is what lets an organiser
  // create a user, and it may exist only for the length of one approval.
  // Asserted by BEHAVIOUR rather than by reading the flag. Each request gets a
  // fresh ctx object, so inspecting the stored one would prove nothing about
  // the one the call actually used — and the flag only matters for what it
  // permits, which is this:
  const after = await call('upsert_user', { email: 'sneak@x.com', role: 'recorder' }, 'admin@x.com', world)
  eq(after.body.error?.code, 'APPROVAL_REQUIRED',
     'so a direct attempt afterwards still needs approving')
  ok(!world.row('app_users', (u) => u.email === 'sneak@x.com'), 'and created nobody')

  // 4. refusing does nothing at all
  const asked2 = await call('request_approval',
    { action: 'upsert_user', payload: { email: 'no@x.com', role: 'viewer' } },
    'admin@x.com', world)
  const no = await call('decide_approval',
    { requestId: asked2.body.data.requestId, approve: false }, 'boss@x.com', world)
  ok(no.body.ok, 'refusing succeeds')
  eq(no.body.data?.executed, 'false', 'and reports that it did not execute')
  ok(!world.row('app_users', (u) => u.email === 'no@x.com'), 'nobody was added')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
