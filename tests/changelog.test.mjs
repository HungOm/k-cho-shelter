/*
 * The change log, and the address that must not travel with it.
 *
 * It was shut to everybody but the super admin, and the reason was real: the
 * log carries the super admin's email, and this system takes trouble to make
 * sure an ordinary admin never learns that address. It is filtered out of the
 * people list and never sent to the browser, because it is the one account
 * nobody inside the app can grant, disable or demote — the way back in when
 * everything else has gone wrong.
 *
 * Closing the whole log was the cheap way to keep that promise. The cost was
 * that the person actually running the raffle could not answer "who changed
 * this book" about their own raffle, which is the question an audit trail
 * exists for.
 *
 * SO THE ENTRIES STAY AND THE ADDRESS GOES. Hiding the super admin's actions
 * instead would make the log lie by omission — a ticket voided by the super
 * admin would read as nobody having touched it, which is worse than having no
 * log at all, because it invites somebody to conclude the record is complete.
 *
 * AND THE ADDRESS HAS TO GO FROM EVERYWHERE, not just from the email column.
 * set_permission and the approvals write emails into `details`, and a promise
 * kept in one field and broken in the next is not kept. That is what most of
 * this file is about.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
let api = (await loadModule('index.ts')).default

/*
 * Through the function's own front door rather than by reaching for the
 * handler, because half of what is being tested is the GATE: read_audit stopped
 * being super-admin-only, and "an organiser may now open this at all" is a
 * question only the registry can answer.
 *
 * The allowlist row decides who the caller is. boss@x.com is the super admin by
 * environment; admin@x.com is an ordinary organiser.
 */
async function call(w, email, payload = {}) {
  const res = await api.fetch(
    new Request('https://x/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read_audit', payload }),
    }),
    { ...w.ctx, userClaims: { id: 'u1', email } })
  return { status: res.status, body: await res.json() }
}

const entries = [
  { id: 1, at: '2026-09-16T01:00:00.000Z', action: 'VOID_TICKET',
    email: 'boss@x.com', details: { ticket: 'KS-00001', reason: 'duplicate' } },
  { id: 2, at: '2026-09-16T02:00:00.000Z', action: 'SET_PERMISSION',
    email: 'boss@x.com', details: { action: 'settle_book', role: 'recorder', by: 'boss@x.com' } },
  { id: 3, at: '2026-09-16T03:00:00.000Z', action: 'ISSUE_BOOKS',
    email: 'admin@x.com', details: { count: 2, agent: 'A001', books: ['Book-031', 'Book-032'] } },
  { id: 4, at: '2026-09-16T04:00:00.000Z', action: 'DECIDE_APPROVAL',
    email: 'admin@x.com', details: { requestedBy: 'rec@x.com', decidedBy: 'boss@x.com', nested: { who: 'boss@x.com' } } },
]

const world = () => fakeDb({
  config: baseConfig({}),
  app_users: [
    { email: 'boss@x.com', name: 'Boss', role: 'admin', status: 'active' },
    { email: 'admin@x.com', name: 'Admin', role: 'admin', status: 'active' },
    { email: 'rec@x.com', name: 'Rec', role: 'recorder', status: 'active' },
  ],
  audit_log: entries.map((e) => ({ ...e })),
})

/** By action, not by position: the log comes back newest first. */
const byAction = (got, action) => got.entries.find((e) => e.action === action)

/** Every string anywhere in a value — the only honest way to ask "is it gone". */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}

console.log('1. an organiser can read the change log at all')
{
  const w = world()
  const { status, body } = await call(w, 'admin@x.com', { limit: 100 })
  eq(status, 200, 'the request is allowed through')
  const got = body.data
  eq(got.entries.length, 4, 'every entry, not a filtered subset')
  eq(got.scrubbed, true, 'and it says the address was taken out')
  ok(got.entries.some((e) => e.action === 'VOID_TICKET'),
    'including what the super admin did — hiding it would be a lie by omission')
}

console.log('2. the super admin\'s address never reaches an organiser')
{
  const w = world()
  const got = (await call(w, 'admin@x.com')).body.data
  const all = strings(got)
  ok(!all.includes('boss@x.com'),
    'the address appears nowhere in the reply — not in email, not in details, not nested')
  eq(byAction(got, 'VOID_TICKET').email, 'the system admin', 'the actor reads as the system admin')
  eq(byAction(got, 'SET_PERMISSION').details.by, 'the system admin',
    'and so does an address written into details')
  eq(byAction(got, 'DECIDE_APPROVAL').details.nested.who, 'the system admin',
    'however deep it was nested')
}

console.log('3. everything that is not that address is left alone')
{
  const w = world()
  const got = (await call(w, 'admin@x.com')).body.data
  eq(byAction(got, 'ISSUE_BOOKS').email, 'admin@x.com', 'another organiser is named, as they always were')
  eq(byAction(got, 'DECIDE_APPROVAL').details.requestedBy, 'rec@x.com',
    'and so is a helper who asked for something')
  eq(byAction(got, 'ISSUE_BOOKS').details.books.join(','), 'Book-031,Book-032',
    'the books survive the scrub intact')
  eq(byAction(got, 'VOID_TICKET').details.reason, 'duplicate', 'and so does the reason somebody typed')
  eq(byAction(got, 'VOID_TICKET').details.ticket, 'KS-00001', 'and the ticket it was about')
}

console.log('4. the super admin still sees the addresses')
{
  const w = world()
  const got = (await call(w, 'boss@x.com')).body.data
  eq(got.scrubbed, false, 'nothing was taken out')
  eq(byAction(got, 'VOID_TICKET').email, 'boss@x.com', 'they can see their own address')
  eq(byAction(got, 'SET_PERMISSION').details.by, 'boss@x.com', 'and the ones written into details')
}

console.log('5. the scrub does not rewrite the stored rows')
{
  // Read it twice as an organiser, then once as the super admin. A scrub that
  // mutated the row in place would have destroyed the record for everybody.
  const w = world()
  await call(w, 'admin@x.com')
  await call(w, 'admin@x.com')
  const asSuper = (await call(w, 'boss@x.com')).body.data
  eq(byAction(asSuper, 'VOID_TICKET').email, 'boss@x.com', 'the stored row is untouched')
  eq(w.table('audit_log').find((r) => r.action === 'VOID_TICKET').email, 'boss@x.com',
    'in the table as well as in the reply')
}

console.log('6. reading the log writes nothing')
{
  const w = world()
  await call(w, 'admin@x.com')
  eq(w.wrote().length, 0, 'a read that logs itself is a log that grows by being looked at')
}

console.log('7. and it belongs to organisers, not to everybody')
{
  const w = world()
  const helper = await call(w, 'rec@x.com')
  eq(helper.status, 403, 'a helper is still refused — opening it to organisers is not opening it')
  eq(helper.body.error?.code, 'INSUFFICIENT_ROLE', 'and told why')
}

console.log('8. with no super admin configured, nothing is scrubbed away by accident')
{
  /*
   * An empty SUPER_ADMIN_EMAIL must not turn into a match. Scrubbing on the
   * empty string would replace every blank email in the log with "the system
   * admin" and invent an actor for entries that never had one.
   */
  cleanup()
  setEnv({ SUPER_ADMIN_EMAIL: '' })
  const fresh = (await loadModule('index.ts')).default
  const w = fakeDb({
    config: baseConfig({}),
    app_users: [{ email: 'admin@x.com', name: 'Admin', role: 'admin', status: 'active' }],
    audit_log: [{ id: 1, at: '2026-09-16T01:00:00.000Z', action: 'X', email: '', details: { a: '' } }],
  })
  api = fresh
  const got = (await call(w, 'admin@x.com')).body.data
  eq(got.entries[0].email, '', 'a blank actor stays blank')
  eq(got.entries[0].details.a, '', 'and a blank field in details stays blank')
}

cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
