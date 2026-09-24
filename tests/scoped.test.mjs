/*
 * THE SCOPED CLIENT, AGAINST A FAKE HOLDING TWO RAFFLES.
 *
 * MULTI-TENANCY-PLAN.md, MT-K. Two projects hold the SAME ticket numbers, the
 * same book numbers, the same seller id and the same config keys, because that
 * is exactly what two organisations running a first raffle will have — and it
 * is the case where a missing filter returns a plausible wrong answer rather
 * than an empty one. Every check below asks as one project and asserts on the
 * OTHER project's rows as well: that nothing came back is not enough, the rows
 * that did come back have to be the right ones (tests memory: assert an
 * identity, not an absence).
 *
 * The seed project's fixture rows carry NO project_id, as every fixture written
 * before projects does. The fake reads absent as the seed project; this file is
 * where that rule is checked on purpose rather than by accident.
 */
import { readFileSync } from 'node:fs'
import { fakeDb, SEED_PROJECT } from './fakedb.mjs'
import { setEnv, loadModule, cleanup } from './loadts.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => ok(JSON.stringify(g) === JSON.stringify(w), `${what}: got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`)
const throwsScope = async (fn, what) => {
  try { await fn(); ok(false, `${what} was refused`) }
  catch (e) { ok(e?.code === 'PROJECT_SCOPE', `${what} was refused as a scope error (${e?.code ?? e})`) }
}

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const { scoped, CONTROL_PLANE } = await loadModule('scoped.ts')

const A = SEED_PROJECT
const B = '11111111-2222-4333-8444-555555555555'

/* The same raffle twice over: A unstamped (a legacy fixture), B stamped. */
function twoRaffles() {
  const conf = (over) => Object.entries({ TOTAL_TICKETS: '20', ACTIVE_TICKETS: '20', TICKET_PRICE: '10', ...over })
    .map(([key, value]) => ({ key, value }))
  const stamp = (rows) => rows.map((r) => ({ ...r, project_id: B }))
  const books = [{ idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001' },
                 { idx: 2, number: 'Book-002', status: 'Unassigned', held_by_agent: null }]
  const tickets = (buyer, amount) => [
    { idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', buyer_name: buyer, buyer_phone: '0911',
      sold_by_agent: 'A001', amount },
    { idx: 2, number: 'KS-00002', book_idx: 1, status: 'Available' },
    { idx: 11, number: 'KS-00011', book_idx: 2, status: 'Available' },
  ]
  return fakeDb({
    config: [...conf({ ACTIVE_TICKETS: '20' }), ...stamp(conf({ ACTIVE_TICKETS: '5' }))],
    agents: [{ agent_id: 'A001', name: 'Seller in A' }, ...stamp([{ agent_id: 'A001', name: 'Seller in B' }])],
    books: [...books, ...stamp(books)],
    tickets: [...tickets('Buyer in A', 10), ...stamp(tickets('Buyer in B', 25))],
    payments: [{ id: 1, agent_id: 'A001', amount: 4, source: 'hand' },
               ...stamp([{ id: 2, agent_id: 'A001', amount: 7, source: 'hand' }])],
  })
}

console.log('1. the wrapper exists and knows the control plane')
{
  ok(typeof scoped === 'function', 'scoped() is exported')
  eq([...CONTROL_PLANE].sort(), ['org_defaults', 'org_features', 'organisations', 'platform_admins',
    'project_members', 'projects'], 'the six Stage 0 tables are the control plane')
  /* The list must match the tables schema.sql actually creates in Stage 0.
     BETWEEN BOTH MARKERS, not from the first one to the end of the file. That
     read the six tables correctly only while the block happened to be last;
     Stage 1 moved it above the tables — every raffle table's project_id default
     calls the two functions in it — and the same slice then returned all
     twenty-nine. The block has always carried an end marker, and
     tenancy.test.mjs has always used it. */
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  const BEGIN = 'ORGANISATIONS AND PROJECTS (MULTI-TENANCY-PLAN.md'
  const END = '-- ============ ORGANISATIONS AND PROJECTS (end) ============'
  const from = schema.indexOf(BEGIN), to = schema.indexOf(END)
  ok(from >= 0 && to > from, 'schema.sql carries the Stage 0 block between its two markers')
  const block = schema.slice(from, to)
  const created = [...block.matchAll(/create table if not exists ([a-z_]+)/g)].map((m) => m[1]).sort()
  ok(created.length === 6, `found the Stage 0 tables in schema.sql (${created.length})`)
  eq([...CONTROL_PLANE].sort(), created, 'CONTROL_PLANE is exactly what Stage 0 creates')
}

console.log('2. a read sees its own project, and the right rows in it')
{
  const f = twoRaffles()
  const a = scoped(f.ctx.supabaseAdmin, A), b = scoped(f.ctx.supabaseAdmin, B)
  const ta = (await a.from('tickets').select('*').eq('number', 'KS-00001').maybeSingle()).data
  const tb = (await b.from('tickets').select('*').eq('number', 'KS-00001').maybeSingle()).data
  eq(ta?.buyer_name, 'Buyer in A', 'KS-00001 in A is A\'s buyer')
  eq(tb?.buyer_name, 'Buyer in B', 'KS-00001 in B is B\'s buyer')
  eq((await a.from('tickets').select('*')).data.length, 3, 'A reads its three tickets and not B\'s')
  eq((await b.from('agents').select('name')).data.map((r) => r.name), ['Seller in B'], 'B reads its own seller')
  const counted = await b.from('tickets').select('idx', { count: 'exact', head: true })
  eq(counted.count, 3, 'a head count is scoped too')
}

console.log('3. a write lands in its own project and nowhere else')
{
  const f = twoRaffles()
  const b = scoped(f.ctx.supabaseAdmin, B)
  await b.from('tickets').update({ status: 'Void' }).eq('number', 'KS-00002')
  const status = (p) => f.table('tickets').find((t) => (t.project_id ?? A) === p && t.number === 'KS-00002').status
  eq(status(B), 'Void', 'B\'s KS-00002 was voided')
  eq(status(A), 'Available', 'A\'s KS-00002 was not')

  await b.from('books').delete().eq('number', 'Book-002')
  eq(f.table('books').filter((r) => r.number === 'Book-002').map((r) => r.project_id ?? A), [A],
     'deleting B\'s Book-002 leaves A\'s')

  await b.from('audit_log').insert({ action: 'x', email: 'e@x.com' })
  eq(f.table('audit_log').map((r) => r.project_id), [B], 'an insert is stamped with the project')

  const one = await b.from('audit_log').insert({ action: 'y', email: 'e@x.com' }).select().single()
  ok(one.data && !Array.isArray(one.data), 'an object stays an object, so .single() still reads one row')
}

console.log('4. an upsert on the composite key keeps two projects\' config apart')
{
  const f = twoRaffles()
  const a = scoped(f.ctx.supabaseAdmin, A), b = scoped(f.ctx.supabaseAdmin, B)
  await b.from('config').upsert([{ key: 'TICKET_PRICE', value: '99' }], { onConflict: 'project_id,key' })
  await a.from('config').upsert([{ key: 'CARD_NOTE', value: 'only A' }], { onConflict: 'project_id,key' })
  const price = (p) => f.table('config').filter((c) => (c.project_id ?? A) === p && c.key === 'TICKET_PRICE')
  eq(price(B).map((c) => c.value), ['99'], 'B\'s price changed, once')
  eq(price(A).map((c) => c.value), ['10'], 'A\'s price did not')
  eq(f.table('config').filter((c) => c.key === 'CARD_NOTE').map((c) => c.project_id ?? A), [A],
     'a new key in A is A\'s alone')
}

console.log('5. the SQL functions and the money view answer for the calling project')
{
  const f = twoRaffles()
  const a = scoped(f.ctx.supabaseAdmin, A), b = scoped(f.ctx.supabaseAdmin, B)
  eq((await a.rpc('active_tickets')).data, 20, 'A has twenty tickets in play')
  eq((await b.rpc('active_tickets')).data, 5, 'B has five, from its own config')

  const ma = (await a.from('agent_money').select('*')).data
  const mb = (await b.from('agent_money').select('*')).data
  eq(ma.map((r) => [r.name, r.expected, r.collected]), [['Seller in A', 10, 4]], 'A\'s seller owes on A\'s sale and A\'s payment')
  eq(mb.map((r) => [r.name, r.expected, r.collected]), [['Seller in B', 25, 7]], 'B\'s seller on B\'s')

  /* A stub that WRITES: the same buyer gets a code per project, not one shared. */
  const buyer = { p_phone: '0911', p_name: 'Same Person', p_user: 'x@x.com' }
  const ca = (await a.rpc('ensure_holding_tx', { ...buyer, p_code: 'CODEA' })).data[0]
  const cb = (await b.rpc('ensure_holding_tx', { ...buyer, p_code: 'CODEB' })).data[0]
  eq([ca.holding_code, ca.was_created, cb.holding_code, cb.was_created], ['CODEA', true, 'CODEB', true],
     'each project mints its own code for the same buyer')
  eq(f.table('ticket_receipts').map((r) => [r.code, r.project_id ?? A]), [['CODEA', A], ['CODEB', B]],
     'and each receipt row is filed under its project')
  eq((await b.rpc('ensure_holding_tx', { ...buyer, p_code: 'CODEC' })).data[0].holding_code, 'CODEB',
     'asking again in B finds B\'s code')
}

console.log('6. every way out of the project is refused')
{
  const f = twoRaffles()
  const b = scoped(f.ctx.supabaseAdmin, B)
  await throwsScope(() => scoped(f.ctx.supabaseAdmin, 'not-a-uuid'), 'a project id that is not a uuid')
  await throwsScope(() => scoped(f.ctx.supabaseAdmin, ''), 'an empty project id')
  for (const t of CONTROL_PLANE) await throwsScope(() => b.from(t), `the control-plane table ${t}`)
  await throwsScope(() => b.from('tickets').insert({ idx: 99, project_id: A }), 'a row naming another project')
  await throwsScope(() => b.from('config').upsert([{ key: 'K', value: 'v', project_id: A }]), 'an upserted row naming another project')
  await throwsScope(() => b.from('tickets').update({ project_id: A }), 'a patch that moves a row')
  await throwsScope(() => b.rpc('active_tickets', { p_project: A }), 'an rpc asked about another project')
  eq(f.table('tickets').length, 6, 'and none of the refusals wrote anything')
}

console.log('7. storage is carried through, not rebuilt')
{
  const f = twoRaffles()
  ok(scoped(f.ctx.supabaseAdmin, B).storage === f.ctx.supabaseAdmin.storage, 'the same storage object')
}

console.log('8. a fake with one project behaves as it always did')
{
  /* The seed project, unstamped rows, no p_project: the legacy path, exactly. */
  const f = fakeDb({ tickets: [{ idx: 1, number: 'KS-00001', book_idx: 1, status: 'Available' }] })
  const r = (await f.ctx.supabaseAdmin.from('tickets').select('*')).data
  eq(Object.keys(r[0]).includes('project_id'), false, 'no row grows a project_id it was not given')
  await f.ctx.supabaseAdmin.from('audit_log').insert({ action: 'x' })
  eq('project_id' in f.table('audit_log')[0], false, 'nor does an unscoped insert')
}

console.log('9. the fake\'s scoping still holds its own precondition: no stub awaits')
{
  /*
   * onlyProject swaps the tables for the length of a call. That is only safe
   * while every rpc stub computes synchronously; one that awaited would let
   * another call run against the wrong project's slice.
   */
  const src = readFileSync(new URL('./fakedb.mjs', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function rawRpc('), src.indexOf('\n  return {\n    db,'))
  ok(body.length > 2000, `found the rpc stubs (${body.length} chars)`)
  ok(!/\bawait\b/.test(body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no stub awaits')
}

cleanup?.()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
