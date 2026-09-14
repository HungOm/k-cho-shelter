/*
 * The Setup screen offers only the changes the person looking at it may make.
 *
 * setUserStatus has four rules, and three of them are invisible from the client
 * unless it goes and reads them:
 *   - the super admin's own row cannot be changed from the app at all
 *   - you cannot stop your own account
 *   - anybody who is not a seller is the owner's business only
 *   - letting somebody IN is the owner's alone; PAUSING them is not
 *
 * A client that ignores those still "works": every refused press comes back
 * SUPER_ADMIN_ONLY with a clear sentence. That is precisely the failure this
 * app keeps repeating — a control that looks available, refuses, and leaves
 * somebody pressing it again, which is how three identical error toasts ended
 * up stacked on one dialog. A button that cannot work should not be drawn.
 *
 * The asymmetry is deliberate and worth preserving: an organiser may PAUSE a
 * seller, because a lost phone on a Sunday should not wait for the owner to
 * wake up, and may not LET anybody IN, because that is the decision that
 * actually grants access.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/components/Admin.vue', import.meta.url), 'utf8')
const gate = readFileSync(new URL('../supabase/functions/api/people.ts', import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// Pull the client's rule out and run it, rather than reading it. A regex over
// source proves the words are present; calling it proves the decision.
const body = src.slice(src.indexOf('function actionsFor'), src.indexOf('const SAID'))
const actionsFor = new Function('isSuper', `
  const statusOf = u => u.status || (u.active ? 'active' : 'suspended')
  ${body}
  return actionsFor`)({ value: false })
const actionsForOwner = new Function('isSuper', `
  const statusOf = u => u.status || (u.active ? 'active' : 'suspended')
  ${body}
  return actionsFor`)({ value: true })

const has = (list, s) => list.some(a => a.status === s)

console.log('the four states the gate knows are the four the client shows')
const states = (gate.match(/const STATUSES = \[([^\]]*)\]/) || [null, ''])[1]
  .match(/'([a-z]+)'/g)?.map(x => x.replace(/'/g, '')) ?? []
ok(states.length === 4, `the gate defines four states (${states.join(',')})`)
for (const st of states) {
  ok(new RegExp(`\\b${st}:`).test(src), `${st} has a word on the Setup screen`)
}

console.log('an organiser may pause a seller, urgently and alone')
{
  const seller = { role: 'agent', status: 'active' }
  ok(has(actionsFor(seller), 'suspended'), 'Pause is offered for an active seller')
  ok(has(actionsFor(seller), 'banned'), 'so is Stop')
}

console.log('and may never let anybody in')
for (const st of ['pending', 'suspended', 'banned']) {
  ok(!has(actionsFor({ role: 'agent', status: st }), 'active'),
     `no "Let in" for a ${st} seller — the gate would refuse it`)
}

console.log('nor touch anybody who is not a seller')
for (const role of ['admin', 'recorder', 'viewer', 'superadmin']) {
  ok(actionsFor({ role, status: 'active' }).length === 0,
     `an organiser is offered nothing for a ${role}`)
}

console.log('the owner may do all of it')
{
  const paused = { role: 'recorder', status: 'suspended' }
  ok(has(actionsForOwner(paused), 'active'), 'the owner can let somebody back in')
  ok(has(actionsForOwner({ role: 'agent', status: 'active' }), 'suspended'),
     'and pause a seller')
  ok(has(actionsForOwner({ role: 'admin', status: 'active' }), 'banned'),
     'and stop an organiser')
}

console.log('two rows are untouchable whoever is looking')
ok(actionsFor({ role: 'admin', isSuperAdmin: true, status: 'active' }).length === 0 &&
   actionsForOwner({ role: 'admin', isSuperAdmin: true, status: 'active' }).length === 0,
   'the super admin row offers nothing — it is changed in the function secrets')
ok(!has(actionsForOwner({ role: 'admin', isYou: true, status: 'active' }), 'suspended') &&
   !has(actionsForOwner({ role: 'admin', isYou: true, status: 'active' }), 'banned'),
   'and you cannot stop your own account')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
