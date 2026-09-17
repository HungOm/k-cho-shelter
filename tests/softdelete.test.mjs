/*
 * A ROW THAT WAS UNDONE MUST NOT COME BACK IN A READ.
 *
 * 20260918050000 replaced the three hard deletes with marks — check_in_reports
 * gains undone_at, check_in_dates gains cleared_at, prizes gains removed_at —
 * and every read of those tables now has to carry the matching `is null`.
 *
 * WHICH IS AN "EVERYTHING EXCEPT X" CONDITION, the bug shape this repository
 * named in AUDIT.md §X after paying for it three times in a single day. The
 * failure is silent and it is the wrong way round: forget the predicate and an
 * undone check-in reads as a seller who reported, so she comes OFF the chase
 * list — which is the exact thing the undo existed to prevent. Nothing throws.
 * The screen looks right. A volunteer stops being asked for books she still has.
 *
 * A predicate every caller has to remember is a predicate somebody will forget,
 * so it is not left to memory. This reads the handler source, the way
 * soldlock.test.mjs does for ['Sold','Donated'], and fails on any select that
 * omits it. Statement by statement rather than line by line, because these
 * chains wrap and a line-based grep reports a filter on the next line as absent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeOf } from './source.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const API = join(ROOT, 'supabase/functions/api')

let pass = 0, fail = 0
const ok = (cond, what) => { if (cond) { pass++ } else { fail++; console.log(`  FAIL ${what}`) } }

const TABLES = {
  check_in_reports: 'undone_at',
  check_in_dates: 'cleared_at',
  prizes: 'removed_at',
}

/*
 * THE TWO DELIBERATE EXCEPTIONS, named rather than pattern-matched, because an
 * exception nobody had to write down is one nobody reviews. Both are write-path
 * lookups that decide update-versus-insert. A row that was undone still occupies
 * its key — (agent_id, round) — so asking only for live rows and then inserting
 * collides. They read every row on purpose and check undone_at themselves.
 */
const ALLOWED = [
  "from('check_in_reports').select('*') .eq('agent_id', agentId).eq('round', round).maybeSingle()",
  "from('check_in_reports').select('agent_id,undone_at')",
]

const FILES = ['books.ts', 'deadlines.ts', 'prizes.ts', 'reports.ts', 'index.ts', 'approvals.ts', 'tickets.ts']

console.log('every read of a soft-deleted table asks for live rows')
let checked = 0
for (const f of FILES) {
  let src
  try { src = codeOf(readFileSync(join(API, f), 'utf8')) } catch { continue }

  /*
   * ONE QUERY AT A TIME, split on `ctx.supabaseAdmin` because that is how every
   * query in this codebase begins — awaited or inside a Promise.all, both start
   * there. Splitting on semicolons does NOT work: a TypeScript object type a
   * hundred lines earlier ends in one, so the "statement" ran from a type
   * declaration through to an unrelated query and reported a filter missing
   * that was two queries away. A chain is then bounded to the 300 characters
   * after its from(), which is longer than any of these and short enough that
   * the next query's predicate cannot be mistaken for this one's.
   */
  for (const chunk of src.replace(/\s+/g, ' ').split('ctx.supabaseAdmin')) {
    for (const [table, column] of Object.entries(TABLES)) {
      const at = chunk.indexOf(`from('${table}')`)
      // Within the first few characters, so this is the chunk's OWN query and
      // not a mention further down it. After the split a chain reads as
      // `.from(…` or ` .from(…` depending on how the call was wrapped.
      if (at < 0 || at > 5) continue
      const stmt = chunk.slice(at, at + 300)
      if (!stmt.includes('.select(')) continue
      if (ALLOWED.some((a) => stmt.includes(a))) continue
      checked++
      ok(stmt.includes(`.is('${column}', null)`),
         `${f}: a select on ${table} without .is('${column}', null) — ${stmt.slice(0, 110)}`)
    }
  }
}
ok(checked >= 7, `it found the reads to check (${checked})`)

/*
 * AND NOTHING DELETES THEM. The point of the change is that the row survives,
 * so a handler calling .delete() on one of these puts it straight back — and
 * would do it quietly, since a delete of an already-soft-deleted row is not an
 * error. Checked across the whole API rather than the three files above, because
 * the next delete will be written by somebody who has not read this file.
 */
console.log('and nothing deletes them')
const { readdirSync } = await import('node:fs')
for (const f of readdirSync(API).filter((x) => x.endsWith('.ts'))) {
  const src = codeOf(readFileSync(join(API, f), 'utf8'))
  for (const table of Object.keys(TABLES)) {
    const re = new RegExp(`from\\('${table}'\\)\\s*\\.delete\\(`)
    ok(!re.test(src.replace(/\s+/g, ' ')), `${f}: hard-deletes ${table}`)
  }
}

/*
 * THE COLUMNS EXIST IN BOTH PLACES. schema.sql and the migrations are separately
 * maintained here — Phase 0 item F is the standing plan to stop that — so until
 * they are one thing, a column added to one and not the other gives a database
 * that depends on which file built it. The migration is what `db push` applies;
 * schema.sql is what a fresh build starts from. Both, or neither.
 */
console.log('and both files that define the schema know about them')
const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8')
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/20260918050000_undoing_is_not_erasing.sql'), 'utf8')
for (const [table, column] of Object.entries(TABLES)) {
  const by = column.replace(/_at$/, '_by')
  ok(schema.includes(column) && schema.includes(by), `schema.sql declares ${table}.${column} and .${by}`)
  ok(migration.includes(`alter table ${table} add column if not exists ${column}`),
     `the migration adds ${table}.${column}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
