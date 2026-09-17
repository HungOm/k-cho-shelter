/*
 * THE RESET IS THE ONLY THING IN THIS REPOSITORY THAT DELETES ROWS WHOLESALE,
 * AND NO SUITE RUNS IT.
 *
 * supabase/reset.sql empties every table and generates a fresh raffle. It is
 * guarded by a confirmation token, it needs a real Postgres, and it destroys
 * everything — so it is not, and should not be, something a test suite executes.
 * The consequence is that it is the one file here whose correctness has always
 * been checked by a person remembering to.
 *
 * TWO KINDS OF CHANGE PUT IT OUT OF DATE, and nothing links the files:
 *
 *   A TABLE GAINS AN APPEND-ONLY TRIGGER. reset.sql disables user triggers
 *   before deleting; a table not on that list makes the whole run raise. It
 *   rolls back cleanly, so nothing is half destroyed — the cost is that the
 *   reset does not happen, found by whoever is running it, after the backup,
 *   with everyone told to stop touching the system. audit_log was exactly this
 *   between 20260917230000 and 66d6549.
 *
 *   A TABLE IS CREATED. A table simply absent from the delete list SURVIVES the
 *   reset. No error, nothing rolls back, and the last raffle's rows are sitting
 *   in the new one. money_entries was exactly this until 66d6549: no foreign key
 *   to anything, so nothing would have refused, and the money journal would have
 *   carried over with the figures quietly wrong.
 *
 * The second is the quieter and the worse. The first fails loudly; the second
 * succeeds.
 *
 * WHY THIS READS THE TRIGGERS AND THE CREATES, not the delete list. Asking "does
 * every table the reset deletes have a guard" names ten tables that have no
 * append-only trigger and need none — and a check that cries wolf is one nobody
 * runs twice. The question is the other way round: of the tables that ARE
 * guarded, does the reset un-guard the ones it deletes.
 *
 * Both checks were written by hand in supabase/DEPLOY-PENDING.md, to be run
 * before a reset. This is them, run on every commit instead.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const reset = readFileSync(join(ROOT, 'supabase/reset.sql'), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// schema.sql and every migration: the two places a table or a trigger is born.
const sql = [readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8')]
  .concat(readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8')))
  .join('\n')

const uniq = (re) => [...new Set([...sql.matchAll(re)].map((m) => m[1]))].sort()

const guarded = uniq(/create trigger [a-z_]+ before (?:update or delete|truncate) on ([a-z_]+)/g)
const created = uniq(/create table if not exists ([a-z_]+)/g)

console.log('1. the files this reads still look the way it thinks they do')
// A parser that quietly matches nothing passes every assertion below it. These
// two numbers are the difference between a check and a decoration.
ok(guarded.length >= 5, `append-only tables found (${guarded.length}): ${guarded.join(', ')}`)
ok(created.length >= 15, `tables found (${created.length})`)
ok(/^\s*delete from tickets;/m.test(reset), 'reset.sql still deletes by name, one table per line')

console.log('2. every guarded table the reset deletes is un-guarded first')
for (const t of guarded) {
  // Only tables the reset actually clears. A guarded table it leaves alone is
  // not its problem.
  if (!new RegExp(`^\\s*delete from ${t}\\b`, 'm').test(reset)) continue
  ok(new RegExp(`alter table ${t}\\s+disable trigger user`).test(reset),
     `reset.sql deletes ${t}, which refuses DELETE, without disabling its triggers — add "alter table ${t} disable trigger user;"`)
  // AND PUTS THEM BACK. A reset that commits with the guards off leaves an
  // append-only ledger silently unprotected, which is worse than the failure
  // above because it succeeds. Found by reading the book_history pair.
  ok(new RegExp(`alter table ${t}\\s+enable trigger user`).test(reset),
     `reset.sql disables ${t}'s triggers and never re-enables them — the ledger comes back unprotected`)
}

console.log('3. no table survives the reset by not being mentioned')
for (const t of created) {
  // `\b` and not `;`: app_users is cleared conditionally, keeping one account,
  // and demanding the semicolon would report the file's one deliberate
  // exemption on every run.
  ok(new RegExp(`^\\s*delete from ${t}\\b`, 'm').test(reset),
     `${t} is created but never cleared — it SURVIVES the reset, carrying the last raffle's rows into the new one`)
}

console.log('4. children before parents')
/*
 * ticket_movements references tickets(idx) with no on-delete clause, so once it
 * holds a row `delete from tickets` is refused and the whole reset rolls back.
 * And 20260917211000 moved book_history's foreign key from cascade to restrict,
 * so books can no longer be deleted while it has history. Both are matters of
 * ORDER inside the file, which neither check above can see.
 */
const lineOf = (t) => reset.split('\n').findIndex((l) => new RegExp(`^\\s*delete from ${t}\\b`).test(l))
for (const [child, parent] of [['ticket_movements', 'tickets'], ['book_history', 'books'],
                               ['ticket_history', 'tickets'], ['tickets', 'books']]) {
  const c = lineOf(child), p = lineOf(parent)
  ok(c >= 0 && p >= 0 && c < p, `${child} is cleared before ${parent}, which it references`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
