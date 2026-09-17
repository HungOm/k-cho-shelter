/*
 * THE MONEY JOURNAL, SHIPPED EMPTY — and as with the custody ledger, the
 * property worth testing is that it is still empty.
 *
 * ARCHITECTURE-REVIEW.md §23 Phase 1C. money_entries generalises payments:
 * the desk can hold money, an entry can say what it was for, a second person
 * can be named on the row they authorised, and `kind` answers only "what
 * happened to the money" instead of doubling as "what for".
 *
 * Nothing reads it, nothing writes it, payments is untouched and remains the
 * table the raffle runs on. Most of what follows asserts that absence, for the
 * same reason as tests/custodyledger.test.mjs: a table nothing reads cannot
 * return a wrong answer, and the person who makes that false at dual-write
 * should have to delete a line here saying so.
 *
 * THE IN-DATABASE BEHAVIOUR IS VERIFIED SEPARATELY and was run before this file
 * was written — the three append-only triggers refusing, a zero amount refused,
 * a reversal naming nothing refused, a non-reversal claiming to reverse
 * refused, a reference kind without an id refused, anon having no select, and a
 * desk receipt inserting where payments could not hold one. Those cases belong
 * in supabase/test-functions.sh; this file checks the shape they exercise.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const API = join(ROOT, 'supabase/functions/api')
const MIGRATION = 'supabase/migrations/20260918300000_the_money_journal_empty.sql'
const BACKFILL = 'supabase/backfill-money.sql'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const mig = readFileSync(join(ROOT, MIGRATION), 'utf8')
const back = readFileSync(join(ROOT, BACKFILL), 'utf8')
const flat = (s) => s.replace(/\s+/g, ' ')

console.log('1. the journal says the four things payments cannot')
// payments.agent_id is `not null references agents`, so cash across the office
// desk had nowhere to go — desk_money() exists to reconstruct it from tickets
// and books because the ledger could not hold it.
ok(/party\s+text not null/.test(flat(mig)) && !/party[^,]*references agents/.test(flat(mig)),
   "party is plain text, so 'desk' can hold money")
ok(/authorised_by text/.test(flat(mig)), 'the second person is on the row they authorised')
ok(/reference_kind text check/.test(flat(mig)) && /reference_id\s+bigint/.test(flat(mig)),
   'an entry can say what it was for')
ok(/check \(\(reference_kind is null\) = \(reference_id is null\)\)/.test(flat(mig)),
   'and cannot say half of it')
ok(/currency\s+text not null/.test(flat(mig)),
   'the currency is stored, not read from config when somebody looks at it')

console.log('2. kind answers one question')
for (const k of ['receipt', 'refund', 'write_off', 'adjustment', 'reversal']) {
  ok(mig.includes(`'${k}'`), `kind allows ${k}`)
}
// payments' own comment concedes the problem this fixes: "Every caller that adds
// up payments therefore has to say which kinds it means" — an everything-except-X
// condition, the shape AUDIT.md §X names.
ok(/check \(kind in \('receipt','refund','write_off','adjustment','reversal'\)\)/.test(flat(mig)),
   'and nothing else')
ok(/check \(amount <> 0\)/.test(flat(mig)),
   'a row that changes nothing is a row somebody has to interpret')
ok(/check \(\(kind = 'reversal'\) = \(reverses is not null\)\)/.test(flat(mig)),
   'a reversal names what it undoes, and only a reversal claims to')

console.log('3. append only, all three ways')
ok(/before update or delete on money_entries/.test(flat(mig)), 'update and delete are refused')
ok(/before truncate on money_entries/.test(flat(mig)), 'and truncate, which fires neither of those')
ok(/for each statement execute function money_entries_append_only/.test(flat(mig)),
   'the truncate trigger is per STATEMENT — per-row is silently never created')

console.log('4. the two unique indexes are partial, and both have to be')
ok(/create unique index if not exists money_entries_client_key_idx on money_entries \(client_key\) where client_key is not null/
   .test(flat(mig)), 'client_key: two entries nobody gave a key are two entries')
// This one is what makes an interrupted backfill safe to re-run.
ok(/create unique index if not exists money_entries_legacy_idx on money_entries \(legacy_id\) where legacy_id is not null/
   .test(flat(mig)), 'legacy_id: one entry per payments row, enforced rather than trusted')

console.log('5. server only')
ok(/alter table money_entries enable row level security/.test(flat(mig)), 'RLS is on')
ok(/revoke all on money_entries from anon, authenticated/.test(flat(mig)),
   'and the browser roles cannot reach it')

console.log('6. nothing reads it, nothing writes it, and payments is untouched')
for (const f of readdirSync(API).filter((x) => x.endsWith('.ts'))) {
  ok(!readFileSync(join(API, f), 'utf8').includes('money_entries'),
     `${f} does not touch money_entries yet`)
}
for (const f of ['supabase/functions.sql', 'supabase/rls.sql']) {
  ok(!readFileSync(join(ROOT, f), 'utf8').includes('money_entries'),
     `${f} has no function or view over it yet`)
}
// §22 step 3 is dual-write and it is two phases away. Until then payments is
// still the table the raffle runs on, and this migration must not have touched it.
ok(!/alter table payments/.test(mig), 'the migration does not alter payments')
ok(!/drop .*payments/.test(mig), 'and does not drop anything from it')

console.log('7. the backfill is written and nothing runs it')
ok(existsSync(join(ROOT, BACKFILL)), 'the script is there')
ok(!readdirSync(join(ROOT, 'supabase/migrations')).some((f) => f.includes('backfill')),
   'and it is NOT a migration, so db push can never pick it up')
for (const f of ['SETUP.md', 'supabase/RESET-RUNBOOK.md', 'supabase/test-functions.sh',
                 'tests/run.sh', 'supabase/connect.sh']) {
  const p = join(ROOT, f)
  if (existsSync(p)) ok(!readFileSync(p, 'utf8').includes('backfill-money'), `${f} does not invoke it`)
}

console.log('8. and it reconciles per party and per kind, not in total')
/*
 * THE ONE THAT WOULD ACTUALLY GO WRONG, and it is verified rather than asserted:
 * mapping writeoff to receipt was run against a real database and the check
 * caught it — 2 party/kind pairs disagreeing, 0 rows left behind. A SINGLE TOTAL
 * WOULD HAVE BALANCED. 100 cash plus 40 written off against 140 cash and nothing
 * written off is 140 either way. This repository has already had one
 * reconciliation that closed at zero while two figures were wrong in opposite
 * directions; comparing in total is how that looks right.
 */
ok(/case when source = 'writeoff' then 'written off' else 'cash' end/.test(flat(back)),
   'payments is grouped by party and by whether it is cash')
ok(/case when kind = 'write_off' then 'written off' else 'cash' end/.test(flat(back)),
   'and the journal the same way')
ok(/full outer join/.test(flat(back)),
   'full outer, so a party present on one side only is a disagreement rather than an absence')
ok(/rolled back/i.test(back) && /raise exception/.test(back), 'and a disagreement aborts the transaction')
ok(/where legacy_id = p\.id/.test(back), 'a row already carried across is skipped, so a failed run can be re-run')
ok(/order by id loop/.test(back),
   'in id order, so a reversal of a reversal resolves — the table is append only and there is no second pass to fill reverses in')

console.log('9. what it deliberately does not carry')
ok(/client_key is NOT carried across/.test(back),
   'client_key stays behind: it makes one request idempotent, and those requests finished months ago')
ok(/legacy_id/.test(back) && /'payments:' \|\| p\.id/.test(back),
   'every entry names the payments row it came from, twice — as an id and in its reason')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
