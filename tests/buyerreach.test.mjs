/*
 * Every server path that hands out a buyer's telephone number.
 *
 * THE FAILURE THIS EXISTS FOR, and it is not the usual one. The masker was
 * correct. It was tested, mutation-tested, and applied by all three read paths
 * in index.ts. It was list_winners that never called it — signature `_u`, the
 * caller deliberately unused — and viewer and recorder can both call that
 * action. So a VIEWER, whose entire defining property is that telephone numbers
 * arrive as ••••100, read every winner's number in full.
 *
 * Being right in three places is what stopped anyone looking at the fourth.
 * shelter-ticket-inventory-tracker hit the identical shape in the client an hour
 * earlier — one of four wa.me links guarded — and named it: a scope error
 * wearing a completed fix's clothes. Nothing was untested; the fix was simply
 * smaller than the problem.
 *
 * SO THIS ENUMERATES. It walks the handler sources, finds every action whose
 * query selects buyer_phone, and requires each either to mask or to be
 * organiser-only. A hand-written list would have reproduced the blind spot
 * exactly — it would have said read_snapshot, read_delta and search, and been
 * right about all three.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const API = join(ROOT, 'supabase/functions/api')
const src = Object.fromEntries(readdirSync(API).filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(API, f), 'utf8')]))
const index = src['index.ts']

console.log('the masker has one home, so two of them cannot disagree')
{
  ok(/export function mask\(/.test(src['gate.ts']), 'mask lives in gate.ts')
  const copies = Object.entries(src).filter(([f, s]) => f !== 'gate.ts' && /^function mask\(/m.test(s))
  ok(copies.length === 0, `and nowhere else (found in ${copies.map(([f]) => f).join(', ') || 'none'})`)
}

console.log('every action that reads a buyer phone either masks it or is organiser-only')
{
  // The registry line for each action says who may call it.
  const roleOf = (action) => {
    const m = index.match(new RegExp(`^\\\\s+${action}:\\\\s*\\\\{([^}]*)\\\\}`, 'm'))
    return m ? m[1] : ''
  }
  // An action's handler body, from its export to the next export.
  const bodyOf = (fn) => {
    for (const s of Object.values(src)) {
      const i = s.indexOf(`export async function ${fn}(`)
      if (i < 0) continue
      const j = s.indexOf('\nexport ', i + 10)
      return s.slice(i, j < 0 ? undefined : j)
    }
    return ''
  }

  const actions = [...index.matchAll(/^\s+([a-z_]+):\s*\{\s*roles:([^}]*)fn:\s*(?:reports\.)?(\w+)/gm)]
    .map((m) => ({ action: m[1], spec: m[0], fn: m[3] }))
  ok(actions.length > 25, `walked ${actions.length} registry entries`)

  const leaks = []
  for (const { action, spec, fn } of actions) {
    const body = bodyOf(fn)
    /*
     * SELECTED, not merely filtered on. report_draw_ready mentions buyer_phone
     * inside .or('buyer_phone.eq.,buyer_name.eq.') to COUNT the tickets with a
     * missing contact, with head:true, so no row ever leaves. Flagging it was a
     * false positive, and the fix is to sharpen the question rather than to add
     * it to a list of exceptions — an instrument with a list of things it is
     * allowed to be wrong about decays into a list.
     */
    const selects = [...body.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2])
    if (!selects.some((cols) => /buyer_phone/.test(cols))) continue
    const masks = /\bmask\(/.test(body)
    const adminOnly = /ADMIN_ONLY|sup:\s*true/.test(spec)
    if (!masks && !adminOnly) leaks.push(`${action} -> ${fn}`)
  }
  ok(leaks.length === 0,
    leaks.length ? `hands out a buyer phone without masking, to a non-organiser:\n    ${leaks.join('\n    ')}`
                 : 'every one masks or is organiser-only')
}

/* ---------- and the behaviour, run rather than read ---------- */

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const reports = await loadModule('reports.ts')

const world = () => fakeDb({
  config: baseConfig({}),
  tickets: [{ idx: 1, number: 'KS-00001', status: 'Sold', book_idx: 1, buyer_name: 'Ma Nu',
              buyer_phone: '0125550100', recorded_by: 'someone@else.com' }],
  books: [{ idx: 1, number: 'Book-001', held_by_agent: 'A002', status: 'Out' }],
  winners: [{ id: 1, ticket_idx: 1, prize: 'First', drawn_at: '2026-12-30' }],
})
const VIEWER = { email: 'v@x.com', role: 'viewer', agentId: null, isAdmin: false }

console.log('a winner\'s telephone number narrows the way every other one does')
{
  const phoneFor = async (u) =>
    (await reports.listWinners({}, u, world().ctx)).winners[0].tickets.buyer_phone

  eq(await phoneFor(VIEWER), '••••100', 'a viewer gets the same partial mask as everywhere else')
  eq(await phoneFor(users.recorder), '', 'a helper who did not record the sale gets nothing')
  eq(await phoneFor(users.agent), '', 'nor a seller whose book it is not')
  eq(await phoneFor(users.admin), '0125550100', 'and an organiser can ring the winner')
}

console.log('but the winner\'s NAME reaches everyone, because a draw is an announcement')
{
  /*
   * A deliberate departure, pinned so it stays deliberate. Applying the masker
   * whole inverted the hierarchy — a viewer kept the name and a helper lost it,
   * so the LESS trusted role saw more. Announcing who won is the point of a
   * draw; the telephone number is for whoever has to ring them.
   */
  for (const [who, u] of [['viewer', VIEWER], ['helper', users.recorder],
                          ['seller', users.agent], ['organiser', users.admin]]) {
    const w = (await reports.listWinners({}, u, world().ctx)).winners[0]
    eq(w.tickets.buyer_name, 'Ma Nu', `${who} can see who won`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
