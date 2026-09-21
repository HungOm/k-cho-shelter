# What is on master and not yet on production

**AS OF 2026-09-19 23:55 THIS GAP IS CLOSED.** Every migration is applied and
the Edge Function carries every action the client calls — both checked against
the platform tonight, not inferred. See the table below for the values and the
command that produced each.

**THIS FILE WENT STALE AND COST TWO SESSIONS AN EVENING.** The paragraph here
said the function was from `75e84a2`, dated the 18th. It was true when written
and was four deploys out of date by the 19th — the function went 52, 53, 55,
56, 58 in a few hours, none of them recorded here. Two sessions read it,
believed it, and independently concluded that pushing the client would strand
it against a database missing `ticket_templates` and `ticket_codes`. Both
tables had existed for hours. One of the two nearly held a correct release
overnight on the strength of a sentence in a markdown file.

So: **this file is a record, never evidence.** It is worth reading for the
SHAPE of the problem and the order to do things in. Every number in it is
stale the moment somebody deploys without editing it, and nobody ever
remembers. Before acting on any value below, re-derive it with the command
beside it — the file already said to, and that is exactly the instruction that
got skipped.

The file is kept because the SHAPE of the problem recurs every time anybody
pushes, and because two of the failures below were found the expensive way.

**Nothing here is a request to deploy.** It is what to check and in what order
when somebody decides to.

## 2026-09-21 — the digital ticket's layout opens a new gap

`660e9c5` gives Ticket Studio's "Digital ticket" tab a real designer, and the
arrangement is stored in a new config key. The client half of that is already
on its way to Pages, because a push is a deploy of the client; the other two
halves are not.

| What | Where | Why it has to go first |
|---|---|---|
| migration `20260921120000_the_card_a_buyer_is_sent_can_be_designed.sql` | `supabase db push --linked` | seeds `CARD_LAYOUT`. The function's `writeConfig` upserts, so it would create the row anyway — but `configPayload` reading a key nobody has described is how a config row ends up with no explanation of itself |
| Edge Function `api` | `supabase functions deploy api` | `setCardDesign` has to ACCEPT `cardLayout`, and `configPayload` has to SEND it back |

**What the window actually looks like, which is better than usual but still
wrong.** The deployed function ignores a parameter it does not know, so a save
succeeds, writes the treatment and the motto, and returns a config with no
`cardLayout` in it. `loadCard` then resolves the standard parts again — so the
organiser watches their arrangement snap back to standard while a toast says
"Digital ticket saved". Visible rather than silent, and still a lost afternoon
for whoever is arranging a card.

**Nothing a buyer holds is affected either way.** The standard layout draws
every card exactly as it was drawn before this commit —
`tests/cardlayout.test.mjs` holds a golden fixture rendered from the old
renderers to prove it — so a raffle that never opens the tab is unchanged, and
one whose save did not stick is unchanged too.

**Re-derive before acting**, as the whole of this file says. `supabase
migration list --linked` for the first row and `supabase functions list` for
the second; and after the function goes out, download it and grep for
`BAD_CARD_LAYOUT`, which is a string literal this commit adds and which exists
nowhere else.

## What was true when this was last checked

A handover document goes wrong by going stale invisibly, so every claim below is
dated and re-derivable in a line. If these disagree with the database, trust the
database and treat the rest of this file as a starting point.

| Checked | Value | How to re-derive |
|---|---|---|
| production migration head | `20260920200000` | `supabase migration list --linked` — every row's `local` equals its `remote` |
| migrations unapplied | **0** (43 of 43 applied) | the same command; a pending one shows a `local` with no `remote` |
| Edge Function `api` | **v58**, 19 Sep 21:28 | `supabase functions list` |
| what v58 actually contains | all **62** actions the client calls | `supabase functions download api --project-ref <ref>` into a SCRATCH dir, then grep it for each `api('…')` in `src/` |
| Edge Function `verify` | **v1**, 19 Sep 17:45, live | `curl -s -o /dev/null -w '%{http_code}' https://shtrtickets.ceamalaysia.org/v/?X.Y` → 200 |
| undeployed server code | `_shared/session.ts`, `api/index.ts`, `main/index.ts` (the self-hosting rework) | `git diff --name-only <last deployed sha> HEAD -- supabase/functions/` |
| client on Pages | whatever was last pushed | grep the served bundle for a string literal only the new commit has |

**DOWNLOAD THE FUNCTION RATHER THAN DATING IT.** `functions list` gives a
version and a timestamp, and a timestamp only lets you guess which commit was
on the deployer's disk. Downloading the deployed source and grepping it for
every action the client calls answers the question that actually matters —
whether any screen calls something the server has never heard of — and it took
one command. Download into a scratch directory: it writes into
`supabase/functions/` of whatever project it is run from, and will overwrite
the working tree.

**THE ASSET PATH IS RELATIVE, SO DO NOT HARDCODE THE ENTRY NAME.**
`vite.config.js` sets `base: './'`, so each page emits its own depth: the root
page references `./assets/main-*.js` and `/v/` references `../assets/verify-*.js`.
An extractor written against `/assets/index-*.js` — which is what everybody was
using — now matches nothing, `$A` comes back empty, curl fetches the site root
and every marker reads 0. That is indistinguishable from a wiped deploy, and
one session believed it for a minute tonight. Take whatever the page actually
references and loop over every chunk:

    for a in $(curl -s https://shtrtickets.ceamalaysia.org/ \
                 | grep -oE '(\./|\.\./)?assets/[^"]+\.js' | sed 's|^\.\{1,2\}/||'); do
      curl -s "https://shtrtickets.ceamalaysia.org/$a" | grep -c 'a literal only the new commit has'
    done

The entry name will change again — it is `main-` today and was `index-`
yesterday — so the check must never name it.

Two traps in that grep, both paid for: the downloaded bundle is transpiled, so
search for the bare action name and not `'quoted'` — a quoted search reported
all 62 actions missing from a function that had every one of them. And for the
CLIENT bundle, grep a string literal rather than an identifier, because the
minifier renames symbols; prove the literal is new to the commit first, or one
that already existed reads as a successful deploy of nothing.

**THE TWO SHAS DIFFER AND THE TWO HALVES DO NOT.** (From 18 Sep, kept because
the reasoning is still right.) `64483d4` changes this file
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

## 2026-09-20 — the reset and the seed, server halves not deployed

A record, not a request, and stale the moment anybody deploys without editing
it. Re-derive every line before acting on it.

| What | Where | Needs |
|---|---|---|
| `app_reset(text[], text)` | `20260920400000` | `supabase db push` |
| the same function, allowlist corrected | `20260920500000` | the same push |
| `reset_preview`, `reset_apply` | `api/reset.ts` | `supabase functions deploy api` |
| `seed_preview`, `seed_apply` | `api/seed.ts` | the same deploy |
| `make_receipt`, and the QR it mints | `api/printing.ts` **and** `verify/index.ts` | `deploy api` **and** `deploy verify` |

Migrations before the function, as always: `reset_apply` calls `app_reset`, and
a function deployed first answers the screen with a Postgres error about a
function that does not exist.

**And there are TWO functions.** The row above is the one that catches people:
`supabase functions deploy api` does not deploy `verify`, and `ce39846` changed
both in the same commit. Deploy `api` alone and a buyer holding a ten-ticket
receipt is told no ticket matches their link, while nothing looks wrong to the
organiser who issued it. The table above said only `api` when it was written
this morning, which is the same omission `supabase/RESET-RUNBOOK.md` carried
until it was corrected the same day.

**The client half is already safe to push on its own.** Both screens catch
`UNKNOWN_ACTION` and say the server has not been updated yet, rather than
failing in a way that reads as the app being broken. So the usual ordering
worry — migration, function, push — costs a sentence on the Access screen here
instead of a dead control, which is the point of that handling.

**`20260920500000` is a `create or replace` of the function `20260920400000`
installs**, deliberately, because this environment cannot check whether
`20260920400000` was ever applied — `supabase migration list --linked` needs
`SUPABASE_DB_PASSWORD` and it is not here. Replace is correct either way. If it
turns out `20260920400000` was never applied, the two can be collapsed by
anybody who can confirm that against the database; nobody should collapse them
on the strength of assuming it.

**The seed writes no SQL of its own and needs no migration.** It calls the
app's own actions — `upsert_agent`, `expand_tickets`, `issue_books`,
`sell_book`, `record_payment`, `upsert_prize` — so `seed_apply` works the day
the function is deployed and needs nothing else. It does depend on `sell_books`
in `functions.sql` being present, which it has been since before this hold.
