# Starting the raffle again from nothing

This is the runbook for `supabase/reset.sql`, which empties the live database
and generates a fresh set of tickets. **There is no undo.** Read the whole page
before you start; the steps are in this order for reasons, and the backup in step 4 is the
only thing standing between a mistake and the loss of the raffle's records.

Nobody should run this because a screen looks wrong. It is for ending one
raffle and beginning the next.

## What it destroys

Every ticket, every book, every sale, every payment, every history row, every
seller, every prize, every winner, every check-in report, every setting, and
every account except one.

## What it leaves

| | |
|---|---|
| Tickets | 10,000, all Available, `KS-00001` – `KS-10000` |
| Books | 1,000, all Unassigned, `Book-0001` – `Book-1000` |
| Accounts | one: `hungom@ceamalaysia.org`, as `superadmin` |
| History | none, of any kind |
| Money | none |
| Settings | factory defaults — **no organisation name, no logo** |

## Two things that will surprise somebody

**Book numbers gain a zero.** Books are `Book-0001` now, not `Book-001`. This
is not a preference. `lpad` truncates rather than overflows, so with three
digits book 1000 becomes `Book-100` and collides with book 100 — three digits
cannot count to a thousand. If the printed books in people's hands say
`Book-001`, those labels no longer match the system. The alternative, if the
labels matter more than the ticket count, is 9,990 tickets in 999 books, which
fits three digits; change `BOOK_DIGITS` to `3` and the total to `9990` in the
script, and its own check will confirm the numbering is wide enough.

**Three accounts are deleted**, including `hung.workspace@gmail.com`. That
address has been running the raffle on the strength of `SUPER_ADMIN_EMAIL`
alone — its row only ever said `recorder`. After the reset it has no row and is
not the super admin, so it signs in as a viewer and sees nothing. **Sign in as
`hungom@ceamalaysia.org` afterwards**, and re-invite the others from the People
screen.

## Before you run it

1. **Every session has finished, committed and pushed.** Check with
   `git status --short` — it must be empty, or the only things left are files
   nobody intends to commit. A reset while somebody is mid-change means the
   next deploy carries work that was never tested against an empty database.

2. **Count the migrations before you push them.**

   ```
   git ls-tree -r HEAD --name-only supabase/migrations/ | wc -l   # what is committed
   ls supabase/migrations/ | wc -l                                # what db push applies
   ```

   **These two numbers must match.** `supabase db push` reads the DIRECTORY, not
   git, so anything sitting uncommitted in this working tree rides along with
   whoever pushes next, whatever state it is in. On 16 September three
   migrations reached production while existing in no commit.

   `git ls-tree -r HEAD`, **not `git ls-files`.** This page said `ls-files`
   until somebody checked it: that command reads the INDEX, and where several
   people share one working tree the index is a mutable thing that drifts behind
   HEAD. It read 21 against a HEAD that had 23, inventing two uncommitted
   migrations that were committed hours earlier — and it can as easily go the
   other way and report clean while a file really is missing. `ls-tree` asks
   what is in the commit, which is the actual question.

   If they differ, `comm -13` on the two lists names the files. Find out who is
   writing them before pushing anything. The danger is not the extra migration
   — that is recoverable. It is that a clean checkout of master plus `db push`
   then builds a database MISSING objects the deployed function assumes.

3. **The deploy is current, in this order.** Each step depends on the one
   before it:

   ```
   supabase db push --linked                          # schema and migrations
   psql "$SUPABASE_DB_URL" -f supabase/functions.sql  # the functions
   psql "$SUPABASE_DB_URL" -f supabase/rls.sql        # the views and the policies
   supabase functions deploy api --project-ref ruadqxxfvbqsdhwkkejl
   git push                                           # deploys the browser app
   ```

   `rls.sql` was missing from this list until 17 September, and it is not
   optional here for the same reason it is not optional in SETUP.md: the money
   views — `agent_money`, `book_ledger_all`, `book_ledger` — live in it, not in
   `functions.sql`. Pushing the migrations and the functions and stopping there
   leaves the balances being read through whatever version of those views the
   database happened to have.

   Deploy the Edge Function **from a clean checkout of the pushed commit**, never
   from the shared working tree. Both of 17 September's production faults came
   through that door.

4. **Take a backup and check you can read it.**

   ```
   ./supabase/backup.sh
   ```

   It writes one CSV per table. Open `tickets.csv` and `payments.csv` and
   confirm they have rows in them. A backup nobody has looked at is a belief,
   not a backup. Keep it somewhere that is not this machine's temp directory.

   It saves **rows, not schema**, so it is only a way back if the tables still
   exist — which the reset leaves alone. If the schema is ever lost as well, the
   rebuild is `schema.sql`, `functions.sql`, `rls.sql`, then the CSVs.

5. **Tell the volunteers.** Anybody with the app open will see their books
   vanish. Better they hear it first.

## Running it

```
psql "$SUPABASE_DB_URL" \
  -v confirm=RESET-THE-RAFFLE \
  -v super=hungom@ceamalaysia.org \
  -f supabase/reset.sql
```

It refuses without both variables, and refuses if the token is not exact.

It prints what it is about to destroy, then two notices:

```
DESTROYING: 10000 tickets, 1000 books, ... payments, ... sellers
NOTICE:  generated 10000 tickets in 1000 books, KS-00001 .. KS-10000
NOTICE:  verified: 10000 tickets, 1000 books, no history, no money, one account
```

**If you do not see the second notice, nothing happened.** The whole thing is
one transaction with a verification at the end; if any check fails it raises and
rolls back, and the raffle is exactly as it was. That includes the append-only
guards on `payments`, `ticket_history` and `round_snapshots`, which the script
takes off deliberately and puts back before it commits.

## Afterwards

1. Sign in as `hungom@ceamalaysia.org`.
2. **Settings** — organisation name, logo, event name, ticket price. The app
   shows no branding until this is done.
3. **Deadlines** — final deadline, sales close date, check-in rhythm. All blank.
4. **People** — re-invite whoever needs access.
5. **Sellers** — add the volunteers back.
6. Give out books.

## If something goes wrong

The script is a single transaction, so a failure leaves the database untouched
and the error names what it objected to. The two worth knowing:

- *"BOOK_DIGITS is 3 but 1000 books need 4 digits"* — the numbering is too
  narrow for the ticket count. Widen it or reduce the total.
- *"an append-only trigger is still disabled"* — it refuses to commit a database
  whose ledger can be edited. Nothing was written; run it again.

If it committed and the result is wrong, the backup from step 4 is the way
back — restore the CSVs into the existing tables.
