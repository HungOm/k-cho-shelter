# What is on master and not yet on production

**AS OF 2026-09-18 EVENING THIS GAP IS CLOSED.** The migrations were applied
(head `20260919500000`), and the Edge Function was deployed from a clean
checkout of `75e84a2`, which is master. The client on Pages carries the same
commit — verified by fetching the served bundle and grepping it for a string
only that commit contains, rather than by trusting a workflow's status.

The file is kept because the SHAPE of the problem recurs every time anybody
pushes, and because two of the failures below were found the expensive way.

**Nothing here is a request to deploy.** It is what to check and in what order
when somebody decides to.

## What was true when this was last checked

A handover document goes wrong by going stale invisibly, so every claim below is
dated and re-derivable in a line. If these disagree with the database, trust the
database and treat the rest of this file as a starting point.

| Checked | Value | How to re-derive |
|---|---|---|
| production migration head | `20260919500000` | `select max(version) from supabase_migrations.schema_migrations` |
| migrations unapplied | **0** | `git ls-tree -r --name-only HEAD supabase/migrations/` against the above |
| Edge Function | deployed from `75e84a2` | `supabase functions list` — compare `updated_at` against the commit time |
| client on Pages | built from `64483d4` | grep the served bundle for a string literal only that commit has |

**THE TWO SHAS DIFFER AND THE TWO HALVES DO NOT.** `64483d4` changes this file
and nothing else — `git diff --stat 75e84a2 64483d4 -- src/` is empty, so the
rebuilt bundle is the same application. A sha comparison would call that a
mismatch and send somebody looking for a drift that does not exist.

So when the two halves disagree on paper, ask what actually differs:

    git diff --name-only <function sha> <client sha> -- src/ supabase/functions/

Empty means they are in step however far apart the shas are. Not empty is the
only case worth acting on, and then it matters WHICH side moved: a client ahead
of its function sends fields the server ignores and expects fields it does not
send; a function ahead of its client enforces rules no screen can answer. The
second is the one that was live for eighteen hours.
| Postgres | **17.6** | `show server_version` |

Last revised 2026-09-18, with the hold lifted for this deploy by the change's
author and the repository owner's stop still in force for new work.

## THE TWO HALVES DEPLOY SEPARATELY, AND THAT IS THE WHOLE TRAP

Pushing to `master` publishes the CLIENT. The Edge Function and the database are
deployed by hand. So a push ships the browser half on its own, and the two halves
drift by however long nobody notices.

Both failures found on 2026-09-18 were this, in opposite directions:

- **New client, old function.** The client stopped asking a seller with no
  account for a reason; the deployed function still demanded one. The sale would
  have been refused with no box on screen to answer it. Caught before it could
  be reached, because the only live seller had an account.
- **Old client, new function** — the expensive one, live for eighteen hours.
  `bulk_record_sales` began refusing batches that reach into a seller's book
  without a reason at `2330e3d` (17th, 20:48). The function carrying that rule
  was deployed on the 18th at 14:18. The transcription screen had no box at all,
  so typing up a seller's counterfoils was simply impossible, on the live
  raffle's only out-book, in the workflow that screen exists for.

**The check that catches both**, before pushing anything that changes what the
client sends or what the server requires: name the string literal the new code
adds, and after the deploy grep the SERVED bundle for it —

    A=$(curl -s https://shtrtickets.ceamalaysia.org/ | grep -o 'assets/index-[^"]*\.js' | head -1)
    curl -s "https://shtrtickets.ceamalaysia.org/$A" | grep -c 'a string only the new code has'

A STRING LITERAL, never a symbol: the minifier renames identifiers, so a function
name reads 0 on a perfectly deployed site and teaches you nothing.

## The live site is ahead of the live backend

`.github/workflows/deploy.yml` publishes the CLIENT to Pages on every push to
`master`. The Edge Function and the database are deployed separately and by
hand. So pushing a commit ships the browser half on its own, and the two halves
are currently several days apart.

That is not a fault in the workflow — it is worth knowing before a push, not
after. It was not noticed until after `eb99381` went out.

## What that breaks right now, checked rather than guessed

| Screen | What a volunteer sees | Why |
|---|---|---|
| Book sheet | Every book, settled ones included, reads **"Handed in: not counted in yet"** | The deployed function does not send `countedIn`; the client added it in `2330e3d` |
| Find | The **Request** button appears for sellers and is refused | `request_approval` is still `ADMIN_ONLY` in the deployed function |
| Give out books | An empty brought-back book is offered and refused | The deployed `issue_books` takes `Unassigned` only |
| Selling into a seller's book | An organiser is made to type a reason, and it is not recorded | The deployed function ignores the field |

No money moves wrongly and nothing is corrupted. It is one screen that misreports
and two controls that refuse.

One accident in our favour: the bogus `Difference` row is **hidden** rather than
wrong, because the new template only draws the count gap when `countedIn` is
true, and against the deployed function it never is.

## The order, which is the thing most likely to go wrong under time pressure

**Migrations first. Function second.**

`master` has code calling `issue_books_tx`, `return_books_tx`,
`transfer_books_tx` and `restock_books_tx`. Production has none of them. Deploy
the function against today's database and **issuing a book stops working
altogether** — which is worse than a screen that misreports, because it refuses
the thing organisers do most.

## What is in the set

**FOURTEEN** migrations are unapplied as of the last revision of this file;
production's `schema_migrations` head is `20260917150000`, and has not moved
since the hold began.

**Do not trust that number — derive it.** It has been ten, twelve, thirteen and
fourteen on four successive readings of this document, because the set grows while it is
being reviewed. That is the single best argument for a deploy window somebody
chooses rather than a gap between two commits:

    psql "$SUPABASE_DB_URL" -At -c "select max(version) from supabase_migrations.schema_migrations;"
    git ls-tree -r --name-only HEAD supabase/migrations/ | sed 's|.*/||' \
      | awk -F_ -v a="<that version>" '$1>a'

Re-verified across all thirteen, not carried over from the twelve. The
fourteenth, `20260918600000`, arrived after that pass and is covered on its own
below — it replaces one view and one policy, writes no row, and is the one whose
absence is a data-exposure rather than a missing feature:

- **Nothing destructive.** No `drop table`, no `drop column`, no `truncate`, no
  top-level `delete`. Every grep hit for "truncate" is *creating* an
  anti-truncate trigger.
- **Exactly one statement writes rows**: `20260917180000_config_defaults`, and it
  is `on conflict (key) do nothing`. That one word is the whole of its safety —
  the same insert with `do update` would write `TOTAL_TICKETS = 0` over a live
  raffle currently holding 20,000 tickets and 2,000 books. Check it is still
  `do nothing` before applying.
- Everything else installs functions and triggers: written, not executed.
- **Two create new empty tables**: `ticket_movements`, `money_entries`.
- **Five existing tables change shape**, and all but the first are additive:

  | Table | Change | In |
  |---|---|---|
  | `book_history` | FK `on delete cascade` → `on delete restrict` | `20260917211000` |
  | `check_in_reports` | `+ undone_at`, `+ undone_by` | `20260918050000` |
  | `check_in_dates` | `+ cleared_at`, `+ cleared_by` | `20260918050000` |
  | `prizes` | `+ removed_at`, `+ removed_by` | `20260918050000` |
  | `tickets` | `+ holder text not null default 'desk'` | `20260918100000` |

**`20260918600000` is the one worth applying earliest, and it CANNOT go alone.**

Until it runs, every signed-in seller's browser holds every other seller's
takings for the whole raffle — who sold each ticket, for how much, whether that
money came in, and who wrote it down. It replaces `tickets_readable` and the
`tickets_read` policy. No row is touched and no column changes shape, and the
client needs no matching deploy: every masked field is already behind a `v-if`,
so an agent looking at another seller's ticket sees "Sold" and nothing else.

**It depends on `20260918100000`**, which adds `tickets.holder` and creates
`ticket_movements` — the new policy names both. On a database without them it
fails at `create policy` with

    ERROR: column "holder" does not exist

which is a clean refusal, nothing half-applied, but it is a refusal. It must
also come after `20260915131319`, which recreates the same view. Filename order
already satisfies both, so the whole set applied in order is the ordinary path
and needs no special handling.

If somebody wants the masking in before the rest of the set, the minimal step is
those two in order — `20260918100000` then `20260918600000` — and that pair was
applied to a scratch database and the masking checked on it afterwards.

One caveat on that scratch test, because it is the sort of thing that reads as
stronger than it is: the database was built from **today's** `schema.sql`, which
is kept in step with the migrations and therefore already carries `holder` and
`ticket_movements`. Production's schema was not built that way — it was built by
migrations applied over time. The two objects were dropped to imitate it. That
is good evidence and it is not the same as having run it against production.

  The last is the only one worth a second look: a `not null default` on the
  20,000-row tickets table. On Postgres 11 and later that is metadata only — no
  rewrite, no long lock — and this project runs **17.6**, checked. On an older
  server it would rewrite the table.

**`move_tickets` is SQL only.** `20260918400000` installs the function and its
custody helper, and there is no handler, no `REGISTRY` entry and no client entry
for it anywhere. So applying these migrations and deploying the function does
**not** make it reachable from a browser, and nothing in the app calls it. That
is deliberate — it is inert until the screen half is built — but somebody
deploying and then looking for a behaviour change should know not to expect one
from that migration.

## Before any `db push`, from whichever tree

    diff <(ls supabase/migrations/*.sql | sed 's|.*/||' | sort) \
         <(git ls-tree -r --name-only HEAD supabase/migrations/ | sed 's|.*/||' | sort)

`db push` reads the **directory**, not git. Anything on disk and not in `HEAD`
is a migration somebody has not committed, and it will be applied by whoever
pushes next. Use `git ls-tree -r HEAD`, never `git ls-files` — that reads the
index, which drifts behind `HEAD` in a shared worktree and has already sent one
session chasing a hazard a third the size they thought.

## And the reset, which has to come last and nearly did not run at all

**Sequence: migrations, then function, then reset.** The reset clears
`ticket_movements` and `money_entries`, and those tables do not exist in
production — the pending migrations are what create them. Run the reset against
today's database and it fails on a missing table.

**A near miss worth recording, because it is the shape of the next one.**
`20260917230000` gave `audit_log` the same append-only triggers the other
ledgers have. `reset.sql` disables user triggers before deleting, and `audit_log`
was not on that list — because when the list was written, it did not need to be.
A scratch database built from schema + functions + rls + every pending migration
raised:

    ERROR: audit_log is append only — DELETE is not allowed on it

at line 85. It rolls back cleanly, since the whole reset is inside one
transaction, so nothing would have been half destroyed. The cost is that the
reset simply would not have happened, discovered by whoever was running it.

Fixed in `66d6549`: the disable and enable lists now carry `audit_log`,
`ticket_movements` and `money_entries` alongside the six that were there.

**THE RULE THAT FALLS OUT OF IT.** Every migration that makes a table
append-only, and every migration that creates a table, puts `reset.sql` one step
out of date — and nothing links the two files. The reset is the only thing in
this repository that deletes rows wholesale, so it is the only thing those
triggers refuse, and it is not exercised by any suite. Adding an append-only
trigger means adding two lines to `reset.sql` in the same commit. Until
something enforces that, it is a thing to check by hand before the reset runs:

    guarded=$(grep -rhoE "create trigger [a-z_]+ before (update or delete|truncate) on [a-z_]+" \
                supabase/schema.sql supabase/migrations/*.sql | awk '{print $NF}' | sort -u)
    for t in $guarded; do
      grep -qE "^\s*delete from $t;" supabase/reset.sql || continue
      grep -qE "alter table $t\s+disable trigger user" supabase/reset.sql \
        || echo "RESET WILL FAIL ON: $t"
    done

It reads the tables OUT OF THE TRIGGERS rather than out of the delete list, which
is the difference between a check and a nuisance. The first version of it asked
which deleted tables lack a guard, and named ten that have no append-only trigger
and need none — a check that cries wolf is one nobody runs twice.

It prints nothing today, and it prints `RESET WILL FAIL ON: audit_log` when the
fix in `66d6549` is removed, which is the only way to know it works.

**THE SECOND CLASS IS QUIETER AND WORSE.** The check above catches a table the
reset tries to clear and cannot. It does not catch a table the reset never
mentions — and a new table simply absent from the delete list SURVIVES. No
error, nothing rolls back, and the last raffle's rows are sitting in the new
one. `money_entries` was exactly that until `66d6549`: no foreign key to
anything, so nothing would have refused, and the money journal would have
carried over with the figures quietly wrong.

`ticket_movements` had the loud version of the same gap — it references
`tickets(idx)` with no on-delete clause, so once it holds a row
`delete from tickets` is refused and the whole reset rolls back. Nothing is
destroyed, which is the safe failure, but the reset does not happen and it is
found at the moment somebody has taken a backup and told everyone to stop.

Both are fixed: `reset.sql` now clears `money_entries` (line 102) and
`ticket_movements` (106) before `tickets` (112). The check for the class:

    made=$(grep -rhoE "create table if not exists [a-z_]+" \
             supabase/schema.sql supabase/migrations/*.sql | awk '{print $NF}' | sort -u)
    for t in $made; do
      grep -qE "^\s*delete from $t\b" supabase/reset.sql || echo "SURVIVES THE RESET: $t"
    done

`delete from $t\b` rather than `delete from $t;` on purpose: `app_users` is
cleared conditionally, keeping one account, and a check that demanded the
semicolon would report the one deliberate exemption in the file every time it
ran. It prints nothing today and prints `money_entries` when that line is
removed.

Run BOTH checks after any migration that creates a table or adds a trigger, and
run them against a COPY of `reset.sql` in a scratch directory — not against the
file in the worktree. Several sessions share this tree, and breaking the real
file to prove a check fails will overwrite whatever somebody else has in flight
there. That has already cost one session twenty minutes of rewriting.

`20260917211000` also changes `book_history`'s foreign key from `cascade` to
`restrict`, so `books` can no longer be deleted while it has history rows.
`reset.sql` deletes children before parents and still works. A runbook that
deletes in a different order, or truncates, will be refused.
