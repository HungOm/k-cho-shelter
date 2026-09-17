# What is on master and not yet on production

Written 2026-09-17, when the repository owner held all deployment until the
production reset. It is the state of the gap at that moment, so that whoever
opens a deploy window does not have to reconstruct it at speed.

**Nothing here is a request to deploy.** It is what to check and in what order
when somebody decides to.

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

At the time of writing, twelve migrations are unapplied; production's
`schema_migrations` head is `20260917150000`. Read the count again before
deploying rather than trusting this number — it went from ten to twelve during
the hour it took to review it, which is the best argument for a deliberate
window rather than a gap between two commits.

Reviewed across all twelve:

- **Nothing destructive.** No `drop table`, no `drop column`, no `truncate`, no
  `delete`. Every grep hit for "truncate" is *creating* an anti-truncate trigger.
- **Exactly one statement writes rows**: `20260917180000_config_defaults`, and it
  is `on conflict (key) do nothing`. That one word is the whole of its safety —
  the same insert with `do update` would write `TOTAL_TICKETS = 0` over a live
  20,000-ticket raffle. Check it is still `do nothing` before applying.
- Everything else installs functions and triggers: written, not executed.
- Two create new empty tables: `ticket_movements`, `money_entries`.
- One existing table changes shape: `book_history`'s foreign key moves from
  `on delete cascade` to `on delete restrict`.

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

`20260917211000` also changes `book_history`'s foreign key from `cascade` to
`restrict`, so `books` can no longer be deleted while it has history rows.
`reset.sql` deletes children before parents and still works. A runbook that
deletes in a different order, or truncates, will be refused.
