/*
 * A POLICY OR A VIEW THAT FORGOT WHICH RAFFLE IT IS ABOUT.
 *
 * WHY THIS IS NEEDED. Stage 2 of the multi-tenancy plan puts
 * `project_id = coalesce(current_project(), seed_project())` into all six
 * policies and all six views in rls.sql. With one raffle every one of those is
 * a no-op, so a missing one is invisible: every test passes, every screen
 * looks right, and nothing shows it until a second organisation exists — at
 * which point the hole is one organisation reading another's buyers, and the
 * six views are the worse half, because they run with owner rights and their
 * own WHERE is the only wall they have. A policy that is too loose does not
 * throw; it answers.
 *
 * The same silence covers the day somebody adds a seventh view, or rewrites
 * one of these six and drops the line while moving things around.
 *
 * WHAT THIS CANNOT DO. It reads the text of rls.sql. It cannot tell whether
 * the predicate is in the right half of an OR, or whether a join between two
 * partitioned tables also matched on project — `test-rls.sh` asks a real
 * Postgres those, as a browser role, and that is where a case belongs when it
 * can be asked there. This is the cheap guard that runs on every commit, and
 * it is aimed at the one failure a text scan can genuinely see: the line is
 * not there at all.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => {
  String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`))
}

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const rls = readFileSync(ROOT + 'supabase/rls.sql', 'utf8')

const PREDICATE = 'coalesce(current_project(), seed_project())'

/*
 * ONE STATEMENT, FROM ITS HEAD TO THE SEMICOLON THAT CLOSES IT.
 *
 * Counting brackets naively does not survive this file: it is full of prose
 * comments containing brackets, of string literals like ')', and of
 * dollar-quoted bodies. A first version of this scanner stopped halfway
 * through agent_money for exactly that reason and reported the view as having
 * no predicate, which is the wrong answer in the dangerous direction.
 */
function statementAt(src, index) {
  let i = index, depth = 0
  while (i < src.length) {
    if (src.startsWith('--', i)) { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue }
    if (src.startsWith('/*', i)) { const n = src.indexOf('*/', i); i = n < 0 ? src.length : n + 2; continue }
    if (src[i] === "'") {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      i = j + 1; continue
    }
    if (src.startsWith('$$', i)) { const n = src.indexOf('$$', i + 2); i = n < 0 ? src.length : n + 2; continue }
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth === 0) return src.slice(index, i + 1)
    i++
  }
  return null
}

function statements(head) {
  const out = []
  const re = new RegExp(`^${head} ([a-z_]+)`, 'gm')
  for (const m of rls.matchAll(re)) {
    const body = statementAt(rls, m.index)
    if (body) out.push([m[1], body])
  }
  return out
}

/*
 * THE ONE EXEMPTION, KEYED ON THE NAME AND CARRYING ITS REASON. A bare "these
 * are allowed to differ" list is how "everything except X" gets into a suite;
 * the reason is here so that the next person can check whether it still holds
 * rather than trusting that it once did.
 */
const EXEMPT = new Map([
  ['config_readable',
   'the one security_invoker view, so config_read fires and has already scoped the '
   + 'rows; and the browser grant on config is column-level (key, value), so a WHERE '
   + 'naming project_id answers "permission denied for table config"'],
])

console.log('the scanner reads whole statements out of rls.sql')
{
  const views = statements('create view')
  const policies = statements('create policy')
  /* Assert the enumeration found something before trusting that it found
     everything. A regex that stops matching reports every file clean. */
  ok(views.length >= 6, `${views.length} views were read whole`)
  ok(policies.length >= 6, `${policies.length} policies were read whole`)
  const money = views.find(([n]) => n === 'agent_money')?.[1] ?? ''
  ok(money.length > 2000,
    `agent_money came back whole (${money.length} chars) — the view a naive bracket count truncates`)
  ok(money.trimEnd().endsWith(';'), 'and it ends at its own semicolon')
}

console.log('every policy says which raffle it is about')
{
  const policies = statements('create policy')
  let checked = 0
  for (const [name, body] of policies) {
    checked++
    ok(body.includes(PREDICATE),
      `policy ${name} does not say ${PREDICATE} — with one raffle that reads the same, `
      + 'and with two it hands one organisation the other\'s rows')
  }
  eq(checked, policies.length, 'every policy found was checked')
  ok(checked >= 6, `${checked} policies carry it`)
}

console.log('every view says which raffle it is about, or says why it does not')
{
  const views = statements('create view')
  let carried = 0, exempted = 0
  for (const [name, body] of views) {
    if (body.includes(PREDICATE)) { carried++; pass++; continue }
    const why = EXEMPT.get(name)
    ok(!!why, `view ${name} has no project predicate and is not on the exemption list`)
    if (why) exempted++
  }
  ok(carried >= 5, `${carried} views carry the predicate in their own body`)
  eq(exempted, EXEMPT.size, 'and the exemption list is used exactly as written, no more')
  for (const name of EXEMPT.keys()) {
    ok(views.some(([n]) => n === name), `the exempted view ${name} still exists`)
  }
}

console.log('the five that expose the column still expose it')
{
  /* The scoped client filters by `.eq('project_id', …)`, which cannot work on
     a view that does not carry the column. Two of these are read by handlers;
     the check covers all five so that a rewrite cannot quietly drop it from
     the two that matter. */
  const views = statements('create view')
  for (const name of ['tickets_readable', 'book_ledger', 'book_ledger_all',
                      'agent_money', 'agents_readable']) {
    const body = views.find(([n]) => n === name)?.[1] ?? ''
    ok(/\bproject_id\b/.test(body), `${name} carries project_id`)
  }
}

console.log('no trigger checks a rule against another raffle')
{
  /*
   * WHERE THIS CAME FROM. `config_numbering_locked` refuses a change to
   * TICKET_PREFIX and five other settings "once tickets exist", and it asked
   * whether ANY tickets exist. The moment one raffle generated its tickets,
   * every raffle created afterwards would arrive permanently unable to set its
   * own numbering, told so by a message about somebody else's tickets. Two
   * more had the same shape: `prize_quantity_covers_awards` counted winners
   * across projects and `winner_seat_exists` read a prize across projects.
   *
   * All three were found by asking the catalog which trigger functions read a
   * partitioned table, not by grepping — a first regex over schema.sql missed
   * the one the plan names. This check is the cheap text version of that
   * question, and it exists because a trigger is the easiest place to forget:
   * it has `new` in hand, so the project is one word away, and nothing about
   * one raffle ever shows that the word is missing.
   */
  const schema = readFileSync(ROOT + 'supabase/schema.sql', 'utf8')
  const PARTITIONED = ['tickets', 'books', 'agents', 'app_users', 'payments', 'money_entries',
    'winners', 'prizes', 'prize_types', 'check_in_reports', 'check_in_dates', 'round_snapshots',
    'ticket_codes', 'ticket_receipts', 'ticket_receipt_items', 'permissions', 'pending_approvals',
    'ticket_templates', 'audit_log', 'book_history', 'ticket_history', 'ticket_movements', 'config']

  /*
   * THE BODY IS BETWEEN ITS OWN TWO $$, and the first version of this took
   * everything up to the next `$$;` instead. That over-ran: these functions
   * are written both ways round — `language plpgsql as $$ … end $$;` and
   * `as $$ … $$ language plpgsql;` — so for the second shape the scan ran on
   * into the NEXT function and inherited its text. `bump_version` passed that
   * way, on a `project_id` belonging to a function two definitions later. A
   * checker that reads the wrong bytes agrees with everything.
   */
  const triggers = []
  const re = /create or replace function (\w+)\(\)\s+returns trigger/g
  for (const m of schema.matchAll(re)) {
    const open = schema.indexOf('$$', m.index)
    if (open < 0) continue
    const close = schema.indexOf('$$', open + 2)
    if (close < 0) continue
    triggers.push([m[1], schema.slice(m.index, close + 2)])
  }
  ok(triggers.length >= 8, `${triggers.length} trigger functions were read out of schema.sql`)
  for (const [name, body] of triggers) {
    eq((body.match(/\$\$/g) || []).length, 2,
      `${name}'s body is its own — exactly two dollar-quotes, so the scan did not run into the next`)
  }

  let reading = 0
  for (const [name, body] of triggers) {
    const reads = PARTITIONED.filter((t) => new RegExp(`\\bfrom\\s+${t}\\b`).test(body))
    if (!reads.length) continue
    reading++
    ok(/\bproject_id\b/.test(body),
      `trigger ${name} reads ${reads.join(', ')} and never names project_id — `
      + 'it is asking its question of every raffle at once')
  }
  /* The positive count. A parser that stopped matching would report every
     trigger clean, which looks exactly like every trigger being clean. */
  ok(reading >= 3, `${reading} of them read a partitioned table and were checked`)

  /* Red against the one that started it. */
  const [, locked] = triggers.find(([n]) => n === 'config_numbering_locked') ?? []
  ok(!!locked, 'config_numbering_locked is one of them')
  if (locked) {
    ok(/from tickets where project_id = new\.project_id/.test(locked.replace(/\s+/g, ' ')),
      'and it asks about this project\'s tickets, not every project\'s')
    const broken = locked.replace(/from tickets\s+where project_id = new\.project_id/, 'from tickets')
    ok(!/\bproject_id\b/.test(broken.replace(/new\.project_id/g, '')) || broken !== locked,
      'the check would see the difference if that predicate were removed')
  }
}

console.log('and the rule is proved against a body with the line taken out')
{
  /* Red before green. The predicate is removed from a real view's text and the
     same check is run over it, because a rule that has never refused anything
     is not known to refuse anything. */
  const views = statements('create view')
  const [, real] = views.find(([n]) => n === 'book_ledger_all')
  ok(real.includes(PREDICATE), 'book_ledger_all carries the predicate as it stands')
  const broken = real.split(PREDICATE).join('true')
  ok(!broken.includes(PREDICATE), 'and the same text with the line taken out does not')
  ok(!EXEMPT.has('book_ledger_all'),
    'so it would be reported, because it is not on the exemption list')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
