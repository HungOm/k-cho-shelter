/*
 * What a handler RETURNS, against what the screen READS.
 *
 * SIX TIMES. Every field-shape failure in this repository has the same shape:
 * a handler answers successfully, the browser destructures the answer, the key
 * is not there, and `undefined` renders as an empty cell or a silent no-op.
 * read_snapshot had no `fields`. list_permissions had no `actions`.
 * report_draw_ready had no `totals`. list_books returned `number` where the
 * grid read `book`, a thousand times over. correct_ticket read camelCase where
 * the client sent sheet names. report_outstanding returned agentName / books /
 * sold where the Money screen reads name / booksOut / ticketsSold.
 *
 * Three of the six were found by a person reporting a screen. None was found by
 * a test, because nothing compared the two ends.
 *
 * WHY THIS ONE IS TRACTABLE where payloadshape.test.mjs could not be
 * generalised: a payload is READ, so finding which keys a handler consults
 * means scanning a function body and every scan matches too much. A response is
 * CONSTRUCTED — an object literal at a return — so the keys are enumerable from
 * the source with no guessing. Constructed keys versus destructured keys is a
 * comparison that can actually be made.
 *
 * It is deliberately a SOURCE comparison, not a behavioural one. Running every
 * action and diffing the objects would be better, and everyaction.test.mjs
 * already runs them — but it cannot know which keys the SCREEN wanted. This can,
 * and it is the half that was missing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const clientSrc = walk(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n')

/**
 * The keys a screen reads off one action's response.
 *
 * SCOPED TO THE FILE AND TO A WINDOW after the call, and that scoping is the
 * whole difficulty. The first version searched the entire client for
 * `<var>.<key>`, which for a call assigned to `r` matched every `r.something`
 * in fifty files and reported a hundred keys the wire never promised. An
 * instrument that matches too much is the same failure as one that matches too
 * little: people stop reading it.
 *
 * It errs toward finding FEWER keys than are really read, deliberately. A key
 * it misses is a check that stays quiet; a key it invents is a false alarm that
 * trains somebody to ignore the file. Given a choice, be quiet.
 */
const WINDOW = 60          // lines after the call in which the answer is used

function keysClientReads(action) {
  const keys = new Set()
  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes(`api('${action}'`)) continue
    const lines = src.split('\n')

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(`api('${action}'`)) continue
      const scope = lines.slice(i, i + WINDOW).join('\n')

      // const { a, b } = await api('x')
      const de = lines[i].match(/\{([^}]*)\}\s*=\s*await\s+api\(/)
      if (de) {
        for (const part of de[1].split(',')) {
          const k = part.split(':')[0].trim()
          if (/^\w+$/.test(k)) keys.add(k)
        }
      }

      // const res = await api('x')   ->   res.foo within the window
      const as = lines[i].match(/(?:const|let)\s+(\w+)\s*=\s*await\s+api\(/)
      if (as) {
        for (const k of scope.matchAll(new RegExp(`\\b${as[1]}\\.(\\w+)`, 'g'))) keys.add(k[1])
      }
    }
  }
  return keys
}

/** Every key name appearing as `key:` inside a source file. */
const constructedKeys = (src) => new Set(
  [...src.matchAll(/(?:^|[{,\s])([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]))

const tsAll = ['index.ts', 'reports.ts', 'books.ts', 'tickets.ts', 'people.ts', 'deadlines.ts', 'approvals.ts']
  .map((f) => read('supabase/functions/api/' + f)).join('\n')
const gsAll = readdirSync(join(ROOT, 'apps_script')).filter((f) => f.endsWith('.gs'))
  .map((f) => read('apps_script/' + f)).join('\n')

/*
 * The actions whose responses a screen picks apart field by field. Listed
 * rather than derived, because this is the list somebody must look at when they
 * add a screen — and a derived list would quietly shrink when a call moved.
 */
const REPORTS = [
  'report_outstanding', 'report_overdue', 'report_missing_contact',
  'report_draw_ready', 'agent_statement', 'list_books', 'list_agents',
  'list_users', 'list_winners', 'list_approvals', 'list_permissions',
  'deadline_status', 'book_history', 'handover_receipt', 'whoami',
]

console.log('the instrument reads both ends')
{
  ok(clientSrc.length > 50000, `client source loaded (${Math.round(clientSrc.length / 1000)}k)`)
  ok(tsAll.length > 50000, `Supabase handlers loaded (${Math.round(tsAll.length / 1000)}k)`)
  ok(gsAll.length > 50000, `Apps Script handlers loaded (${Math.round(gsAll.length / 1000)}k)`)
  // A scanner that finds nothing reports nothing, and the two look identical.
  const found = REPORTS.filter((a) => keysClientReads(a).size > 0)
  ok(found.length >= 6, `it found keys for ${found.length} of ${REPORTS.length} actions`)
}

console.log('every key a screen reads is a key some handler builds')
{
  const both = new Set([...constructedKeys(tsAll), ...constructedKeys(gsAll)])
  const missing = []
  for (const action of REPORTS) {
    for (const k of keysClientReads(action)) {
      // Array and promise members are the client's own, not the wire's.
      if (['length', 'map', 'filter', 'find', 'forEach', 'then', 'catch',
           'sort', 'slice', 'push', 'value', 'includes', 'join'].includes(k)) continue
      if (!both.has(k)) missing.push(`${action}.${k}`)
    }
  }
  ok(missing.length === 0,
    missing.length ? `the client reads keys no backend builds:\n    ${missing.join('\n    ')}`
                   : 'every key is built somewhere')
}

console.log('the two backends agree about report_outstanding')
{
  /*
   * Pinned explicitly because this is the one that broke, and because the
   * general check above cannot see it: `agentName` and `name` are BOTH built
   * somewhere in the tree, so a scan for "does any handler build this key"
   * passes while the Money screen shows a table of amounts owed by nobody.
   *
   * The lesson is the one the whole day taught: a check that answers a slightly
   * different question passes while the thing is broken.
   */
  const ts = tsAll.slice(tsAll.indexOf('export async function reportOutstanding'))
  const block = ts.slice(0, ts.indexOf('export async function reportOverdue'))
  for (const k of ['name', 'booksOut', 'booksSettled', 'overdueBooks',
                   'ticketsSold', 'expected', 'collected', 'outstanding',
                   'phone', 'zone', 'agentId']) {
    ok(new RegExp(`\\b${k}\\b`).test(block), `Supabase builds ${k}`)
  }
  ok(!/agentName:/.test(block), 'and no longer builds agentName, which no screen reads')
  ok(!/\bbooks: \[\]/.test(block), 'nor a books array where the screen counts booksOut')

  // booksOut must COUNT the books that are out, not every book held. A settled
  // book keeps held_by_agent, so counting the array said a seller who had
  // handed everything back was still carrying it.
  ok(/status === 'Out'\)\s*a\.booksOut\+\+/.test(block.replace(/\s+/g, ' ').replace(/if \(r\./g, '')) ||
     /booksOut\+\+/.test(block),
     'booksOut counts books that are Out')
  /*
   * WIDENED, and the real proof moved somewhere it is RUN.
   *
   * This pinned one spelling of the scope check. The rule now covers more than
   * agents — a helper sees their own line, a viewer gets totals and no names —
   * so it is decided in one helper rather than inline, and a grep for the old
   * expression went red when the rule got STRONGER. money.test.mjs calls the
   * handler as each role and asserts what actually comes back.
   */
  ok(/visibleAgents\(user\)/.test(block),
     'and who may be told about whom is decided in one place')
  ok(/only && !only\.includes\(key\)/.test(block),
     'and the rows are actually filtered by it')
}

/*
 * AND THEN RUN IT, because the scan above cannot see arithmetic.
 *
 * Proven necessary rather than assumed: with only the source checks, two
 * deliberate breakages passed — overdueBooks never incrementing, and booksOut
 * counting every book the seller holds instead of the ones that are out. Both
 * produce a response with every key present and the wrong number in it, which
 * is the failure the Money screen exists to not have.
 *
 * A key that is present and wrong is worse than a key that is missing: missing
 * renders as a blank cell somebody reports, wrong renders as a figure somebody
 * reads out to the person who owes it.
 */
const { setEnv, loadModule, cleanup } = await import('./loadts.mjs')
const { fakeDb, baseConfig, users } = await import('./fakedb.mjs')

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const reports = await loadModule('reports.ts')

const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

/**
 * A001 holds four books: one Out and late, one Out and not late, one Returned,
 * one Settled. A002 holds one Out book. Both owe money.
 */
function world() {
  const led = [
    { idx: 1, number: 'Book-001', status: 'Out',      held_by_agent: 'A001', agent_name: 'Daw Hla', days_overdue: 5, counted_sold: 10, counted_expected: 100, counted_collected: 0 },
    { idx: 2, number: 'Book-002', status: 'Out',      held_by_agent: 'A001', agent_name: 'Daw Hla', days_overdue: 0, counted_sold: 4,  counted_expected: 40,  counted_collected: 0 },
    { idx: 3, number: 'Book-003', status: 'Returned', held_by_agent: 'A001', agent_name: 'Daw Hla', days_overdue: 0, counted_sold: 2,  counted_expected: 20,  counted_collected: 20 },
    { idx: 4, number: 'Book-004', status: 'Settled',  held_by_agent: 'A001', agent_name: 'Daw Hla', days_overdue: 0, counted_sold: 10, counted_expected: 100, counted_collected: 100 },
    { idx: 5, number: 'Book-005', status: 'Out',      held_by_agent: 'A002', agent_name: 'U Kyaw',  days_overdue: 0, counted_sold: 1,  counted_expected: 10,  counted_collected: 0 },
  ]
  return fakeDb({
    config: baseConfig({ CURRENCY: 'RM' }),
    book_ledger_all: led,
    agents: [
      { agent_id: 'A001', name: 'Daw Hla', phone: '0125551111', zone: 'KL', active: true },
      { agent_id: 'A002', name: 'U Kyaw',  phone: '0125552222', zone: 'Klang', active: true },
    ],
  })
}

console.log('the figures the Money screen prints are the right figures')
{
  const w = world()
  const out = await reports.reportOutstanding({}, users.admin, w.ctx)
  const hla = out.agents.find((a) => a.agentId === 'A001')

  eq(hla.name, 'Daw Hla', 'the seller has a name')
  eq(hla.phone, '0125551111', 'and a telephone number, for the chase button')
  eq(hla.zone, 'KL', 'and a zone')

  // The two the source scan could not see.
  eq(hla.booksOut, 2, 'booksOut counts the books that are OUT, not every book held')
  eq(hla.booksSettled, 1, 'and settled books are counted separately')
  eq(hla.overdueBooks, 1, 'and only the late one is late')

  eq(hla.ticketsSold, 26, 'tickets sold across all their books')
  eq(hla.expected, 260, 'expected')
  eq(hla.collected, 120, 'collected')
  eq(hla.outstanding, 140, 'and what they actually owe')

  eq(out.agents[0].agentId, 'A001', 'biggest debt first — this list decides who to ring')
  eq(out.totalOutstanding, 150, 'the total across everyone')
  eq(out.currency, 'RM', 'and the currency the screen prints')
}

console.log('a seller sees their own line and nobody else\'s')
{
  const w = world()
  const asAgent = await reports.reportOutstanding({}, { ...users.agent, agentId: 'A002' }, w.ctx)
  eq(asAgent.agents.length, 1, 'one row')
  eq(asAgent.agents[0].agentId, 'A002', 'their own')
  eq(asAgent.totalOutstanding, 10, 'and the total is theirs, not the raffle\'s')

  const admin = await reports.reportOutstanding({}, users.admin, w.ctx)
  eq(admin.agents.length, 2, 'while an organiser sees everybody')
}

console.log('money is rounded the way it is read aloud')
{
  const w = fakeDb({
    config: baseConfig({ CURRENCY: 'RM' }),
    book_ledger_all: [{ idx: 1, number: 'Book-001', status: 'Out', held_by_agent: 'A001',
      agent_name: 'X', days_overdue: 0, counted_sold: 3, counted_expected: 100.1,
      counted_collected: 100.0 },
      // A second seller, so the TOTAL has to survive adding two rounded figures
      // together. With one row the total is trivially already rounded, and a
      // test with one row passed while the total rounding was deleted.
      { idx: 2, number: 'Book-002', status: 'Out', held_by_agent: 'A002',
        agent_name: 'Y', days_overdue: 0, counted_sold: 1, counted_expected: 0.5,
        counted_collected: 0.3 }],
    agents: [{ agent_id: 'A001', name: 'X', phone: '01', zone: '', active: true },
             { agent_id: 'A002', name: 'Y', phone: '02', zone: '', active: true }],
  })
  const out = await reports.reportOutstanding({}, users.admin, w.ctx)
  // 100.1 - 33.37 is 66.72999999999999 in binary floating point. This figure is
  // read aloud to the person who owes it, and it appears in a WhatsApp message
  // the screen composes. Fifteen decimal places is not a rounding nicety.
  // Sorted biggest-debt-first, so the 0.5-0.3 row leads.
  eq(out.agents[0].outstanding, 0.2, '0.5 - 0.3 is 0.2, not 0.19999999999999998')
  eq(out.agents[1].outstanding, 0.1, 'and 100.1 - 100.0 is 0.1, not 0.09999999999999432')
  // 0.2 + 0.2 is fine; the pair that breaks is 0.1 + 0.2. Both ROWS are already
  // rounded here, so this asserts the TOTAL does its own rounding rather than
  // inheriting it — a one-row fixture passed while that rounding was deleted.
  eq(out.totalOutstanding, 0.3, 'and the total rounds on its own — 0.2 + 0.1 is 0.30000000000000004')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
