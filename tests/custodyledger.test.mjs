/*
 * THE CUSTODY LEDGER, SHIPPED EMPTY — and the property worth testing is that it
 * is still empty.
 *
 * ARCHITECTURE-REVIEW.md §22 step 1 asks for the ledger to land with its
 * triggers and be sat on: "No existing table changes. Deploy; nothing reads them
 * yet." That is not a description of the first commit, it is a CONSTRAINT on it
 * — and it is the one that makes the change safe to put in front of a live
 * raffle. A table nothing reads cannot return a wrong answer.
 *
 * So most of what follows asserts absence: no handler touches ticket_movements,
 * no view selects from it, no runner invokes the backfill. Those will each stop
 * being true on purpose, at a later phase, and the person who makes them false
 * should have to delete a line here saying so rather than discover afterwards
 * that Phase 1A quietly became Phase 1C.
 *
 * In-database behaviour — that the triggers actually refuse, that the partial
 * index actually permits two keyless rows — belongs in supabase/test-functions.sh
 * and is not here, because that file is held by another session today. The cases
 * are written and waiting; this file checks the shape they will be checking the
 * behaviour of.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const API = join(ROOT, 'supabase/functions/api')
const MIGRATION = 'supabase/migrations/20260918100000_the_custody_ledger_empty.sql'
const BACKFILL = 'supabase/backfill-custody.sql'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const mig = readFileSync(join(ROOT, MIGRATION), 'utf8')
const back = readFileSync(join(ROOT, BACKFILL), 'utf8')
const flat = (s) => s.replace(/\s+/g, ' ')

console.log('1. the ledger has the shape the review specified')
for (const col of ['id', 'at', 'ticket_idx', 'from_holder', 'to_holder', 'kind',
                   'batch_id', 'by_user', 'reason', 'reverses', 'client_key']) {
  ok(new RegExp(`\\b${col}\\s+\\w`).test(mig), `ticket_movements has ${col}`)
}
ok(/reverses\s+bigint references ticket_movements\(id\)/.test(flat(mig)),
   'reverses points at this same table, so a correction names what it undoes')
ok(/ticket_idx\s+integer not null references tickets\(idx\)/.test(flat(mig)),
   'a movement cannot name a ticket that does not exist')
for (const kind of ['issue', 'return', 'transfer', 'restock', 'lost', 'found', 'correction']) {
  ok(mig.includes(`'${kind}'`), `kind allows ${kind}`)
}
ok(/check \(from_holder <> to_holder or kind = 'correction'\)/.test(flat(mig)),
   'a movement that moves nothing is refused unless it is a correction')

console.log('2. append only, all three ways')
// TRUNCATE is the one people leave off. It is neither an update nor a delete and
// it empties the table without firing either of the other two triggers.
ok(/before update or delete on ticket_movements/.test(flat(mig)), 'update and delete are refused')
ok(/before truncate on ticket_movements/.test(flat(mig)), 'and truncate, which fires neither of those')
ok(/for each statement execute function ticket_movements_append_only/.test(flat(mig)),
   'the truncate trigger is per STATEMENT — a per-row truncate trigger is not a thing and is silently never created')
ok(/errcode = 'restrict_violation'/.test(flat(mig)), 'and it refuses with a code a handler can read')

console.log('3. the client_key index is partial, and that is not a detail')
// Every NULL is distinct in Postgres, so a plain unique column would be relying
// on that by accident. Two movements nobody gave a key are two movements.
ok(/create unique index if not exists ticket_movements_client_key_idx on ticket_movements \(client_key\) where client_key is not null/
   .test(flat(mig)), 'unique on client_key only where there is one')

console.log('4. server only')
ok(/alter table ticket_movements enable row level security/.test(flat(mig)), 'RLS is on')
ok(/revoke all on ticket_movements from anon, authenticated/.test(flat(mig)),
   'and the browser roles cannot reach it')

console.log('5. the projection column exists and defaults to somewhere real')
ok(/alter table tickets add column if not exists holder text not null default 'desk'/.test(flat(mig)),
   "tickets.holder defaults to 'desk'")
// A sentinel rather than a null, so no query over this column is an "everything
// except X" condition — the shape AUDIT.md §X names after three defects in a day.
ok(!/holder text(?!\s+not null)/.test(flat(mig)), 'and is not nullable, so no read has to remember a null case')

/*
 * PHASE 1B LANDED IN 018734a, so this section is narrower than it was and the
 * change is recorded rather than quietly made. It used to say nothing anywhere
 * read or wrote the ledger; move_tickets and the ticket_custody view now do,
 * which is the whole of 1B and is why that line was written to fail.
 *
 * WHAT IS STILL TRUE, AND STILL WORTH GUARDING: the API layer has not switched.
 * No TypeScript handler touches the ledger or the projection — issuing a book
 * still goes through the old custody path — so the ledger is written only by
 * SQL that takes the lock and writes the movement and the projection in one
 * transaction. The day a handler writes either of them directly is the day the
 * projection can drift from the ledger, and whoever does it should have to
 * delete a line here saying so.
 *
 * rls.sql likewise: a view the browser's roles could reach is a different
 * decision from a view the edge function reads, and 1D is where that gets made.
 */
console.log('6. the API layer has not switched, so the ledger is written only by SQL')
for (const f of readdirSync(API).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(join(API, f), 'utf8')
  ok(!src.includes('ticket_movements'), `${f} does not write the ledger directly`)
  ok(!src.includes('ticket_custody'), `${f} does not read the replay view directly`)
}
ok(!readFileSync(join(ROOT, 'supabase/rls.sql'), 'utf8').includes('ticket_movements'),
   'rls.sql exposes no view over it — whether a browser role may reach it is 1D\'s decision')
// And the writer that DOES exist writes both halves. A function that inserted a
// movement without updating tickets.holder would leave the cache wrong from the
// first call, which is the failure the projection exists to avoid.
{
  const fns = readFileSync(join(ROOT, 'supabase/functions.sql'), 'utf8')
  const mv = fns.slice(fns.indexOf('function move_tickets'))
  // Both halves, named exactly. A looser regex passed a mutation that renamed
  // the column, because `holder_x` contains `holder` — an assertion that cannot
  // fail is the thing it was written to prevent.
  ok(/insert into ticket_movements/.test(mv), 'move_tickets writes the movement')
  ok(/update tickets set holder = p_to_holder/.test(mv),
     'and sets tickets.holder in the same transaction — a movement without the projection leaves the cache wrong from the first call')
}
/*
 * tickets.holder likewise: the column is added and left alone. A handler writing
 * it without also writing the movement is the projection drifting from the
 * ledger on day one, which is the failure this whole design exists to end.
 *
 * MATCHED ON THE WRITE, not on the word. `holder` is already a local name all
 * over these files — `{ idx, number, holder }` carrying held_by_agent — so a
 * bare /holder:/ reports six handlers that touch nothing. Split on
 * ctx.supabaseAdmin, the way softdelete.test.mjs does, and look only at
 * statements that update or insert the tickets table.
 */
for (const f of readdirSync(API).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(join(API, f), 'utf8').replace(/\s+/g, ' ')
  for (const chunk of src.split('ctx.supabaseAdmin')) {
    const at = chunk.indexOf(`from('tickets')`)
    if (at < 0 || at > 5) continue
    const stmt = chunk.slice(at, at + 400)
    if (!/\.(update|insert|upsert)\(/.test(stmt)) continue
    ok(!/[{,]\s*holder:/.test(stmt), `${f} writes tickets.holder before anything writes a movement`)
  }
}

console.log('7. the backfill is written and nothing runs it')
ok(existsSync(join(ROOT, BACKFILL)), 'the script is there')
ok(!readdirSync(join(ROOT, 'supabase/migrations')).some((f) => f.includes('backfill')),
   'and it is NOT a migration, so db push can never pick it up')
for (const f of ['SETUP.md', 'supabase/RESET-RUNBOOK.md', 'supabase/test-functions.sh',
                 'tests/run.sh', 'supabase/connect.sh']) {
  const p = join(ROOT, f)
  if (!existsSync(p)) continue
  ok(!readFileSync(p, 'utf8').includes('backfill-custody'), `${f} does not invoke it`)
}

console.log('8. and when somebody does run it, it can stop')
ok(/raise exception/.test(back) && /rolled back/i.test(back),
   'a disagreement between the replay and held_by_agent aborts the transaction')
ok(/already holds backfilled rows/.test(back),
   'running it twice is refused rather than merged — a doubled ledger replays correctly, which is the worst kind of wrong')
ok(/backfilled\s*\)?\s*$|backfilled/m.test(mig), 'and the rows it writes are marked as its own')

// THE ONE THAT WOULD ACTUALLY GO WRONG. `settle` is in book_history and moves no
// paper. Treating it as a return puts every settled book at the desk, and the
// replay then disagrees with held_by_agent for exactly the books that matter
// most — which would read as a data problem rather than as this script's bug.
ok(!/'settle'/.test(back), 'settle is not treated as a movement, because settling moves money and no paper')
ok(/action in \('issue','return','restock','transfer','lost','void','unassigned'\)/.test(flat(back)),
   'the actions it replays are named explicitly rather than excluded')

console.log('9. it can be walked back to where each row came from')
ok(/'book_history:' \|\| h\.id/.test(back), "every movement's reason names the book_history row it came from")
ok(/gen_random_uuid\(\) as batch/.test(back),
   'one batch per source row, so a whole book is one action and not ten')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
