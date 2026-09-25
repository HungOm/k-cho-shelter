# Multi-tenancy: decisions for the owner

Questions that can wait, collected so they can be skimmed and answered in one
sitting. Blocking questions are asked directly, not parked here.

**How to answer.** Write your letter after "Your choice". Until you do, work
continues under the recommended option, marked ★.

**How to add one** (every session): copy the template, give it the next number,
keep it under ten lines.

```
### D-NNN · short title · raised by <session>, <date>
Blocks: <task or stage, or "nothing yet">
Context: one or two sentences.
- A ★ recommended option, and what it costs
- B the alternative, and what it costs
Your choice: 
```

## Open

### D-035 · active_tickets(uuid) answers about any project, to any signed-in person · raised by kcho-shelter-25, 2026-09-26
Blocks: nothing now. Stage 3 should close it, once member_role() exists.
Context: Stage 2 gives `active_tickets` a sibling taking the project as an argument, and `authenticated` must keep EXECUTE on it — measured: revoking it breaks `tickets_readable` and `book_ledger` with "permission denied for function active_tickets", because a definer view runs its TABLE access as the view owner but still checks FUNCTION execute against the calling role. anon is revoked, so the public cannot ask. What remains is that any signed-in person who holds another organisation's project id can read that raffle's in-play ticket count. It is a count, not personal data, and no screen offers the id — but it crosses the wall this plan exists to build, and the same shape will repeat for every function that takes a project and is callable by `authenticated`.
- A ★ Stage 3: once `member_role(p_project)` exists, `active_tickets(p_project)` returns null for a project the caller is not a member of, and the views pass their own row's project so they are unaffected. One predicate, in the stage that already introduces the function it needs
- B now, with a membership check written against `project_members` directly, before Stage 3 has settled what membership means — a second definition of the rule that has to be reconciled later
- C accept it: a ticket count is not worth a function call's worth of complexity, and Stage 8's non-bypass role closes it wholesale
Your choice: 


### D-034 · app_reset is not in tonight's MT-2d pass, and it needs a p_project before MT-2b can merge · raised by kcho-shelter-25, 2026-09-26
Blocks: MT-2b merging (it wires every ctx.supabaseAdmin.rpc call through the scoped client, which will inject p_project into app_reset's call and find no matching signature). Does not block MT-1b, MT-2c/d/e, or anything already shipped.
Context: reset.ts calls `rpc('app_reset', { p_tables, p_by })`. Once MT-2b lands, that arrives as three named arguments and app_reset only has two. It is the most dangerous function in the schema — it empties a raffle — and it is the subject of an OPEN, UNRESOLVED production incident (2026-09-21: a reset failed with "DELETE requires a WHERE clause" but had already emptied `config`; three theories for the cause have died and the fourth is unconfirmed, see memory `the-reset-emptied-config-and-left-the-tickets`). It is also defined only inside migrations, never rolled into `functions.sql`, and it has been rewritten three times already for reasons each recorded in its own migration's header. I am not willing to add a parameter to it at 3am inside a pass otherwise going through desk_money and issue_books_tx.
- A ★ a dedicated card, done in daylight, with its own review pass: add `p_project uuid`, scope every table it empties by project, decide whether app_reset should even run per-project before Stage 4 (today it empties the WHOLE database, which the plan's own D-006 answer says a full reset should refuse to do "while more than one organisation exists" — app_reset doing it per-project early would be new, narrower behaviour, not a mechanical scoping pass) or should stay whole-database and simply refuse when more than one project exists, matching D-006's ruling for the terminal reset it is a sibling of
- B block MT-2b on it: nothing merges until app_reset is done, which makes a plumbing question gate a security fix
- C give scoped.ts a one-line skip list so app_reset keeps its two-argument form and bypasses the wrapper's injection, reaching ctx.supabasePlatform's behaviour by name rather than by an explicit unscoped call — the plan session already said it leans against a skip list, and I agree: it is the one exception that would make "every rpc from the api carries p_project" false silently
Your choice: 


### D-014 · The type-check lands as a ratchet over 78 existing errors · raised by multi-tenancy-architecture-plan, 2026-09-25
Blocks: nothing. MT-T ships under A.
Context: your D-010 answer asked for a gate step that fails on type errors. The first run found 78 in code already in production: loose `any`s, handler signatures the registry type does not accept, and one `role === 'superadmin'` that is only a too-narrow type, not a bug. Failing on all 78 would stop every deploy.
- A ★ ratchet: the 78 are listed in `tests/typecheck-baseline.txt`; the gate fails on any error not on the list, and on any listed error that has been fixed, so the list only shrinks. A missing or misspelt `feature` tag is proved to turn it red
- B a wall: fix all 78 first, as their own card, before the step goes in
Your choice: A

### D-015 · An empty `x-project-id` header · raised by kcho-shelter-51, 2026-09-25
Blocks: nothing. Shipped under A; one line to change.
Context: invariant 2 says an ABSENT header means the seed project, so every client written before multi-tenancy keeps working. A header that is PRESENT AND BLANK is a different thing — a caller that meant to name a raffle and lost the value on the way.
- A ★ blank is `BAD_PROJECT`. Only a genuinely absent header is the seed, so a client bug that drops the id is loud rather than silently routing into this raffle
- B blank is treated as absent, which is friendlier to a proxy that adds empty headers
Your choice: A

### D-016 · A failed admin-client build refuses only for a non-seed project · raised by kcho-shelter-51, 2026-09-25
Blocks: nothing. Shipped under A. Narrows the MT-2a card's "a failed build is a hard refusal".
Context: refusing unconditionally is right once the header matters, but above the identity reads it would take the SEED raffle down whenever the environment is unreadable — and tests/stubs/supabase-server-core.js returns nothing on purpose, so every handler suite would go red. By invariant 2 "no project header" IS the seed, so for the seed an unstamped client is the correct answer rather than a degraded one.
- A ★ refuse (`PROJECT_UNAVAILABLE`, 503) only when the resolved project is not the seed. Unreachable today because projectOf() already refuses every non-seed id; correct the day Stage 5 makes a second project reachable, and proved by mutation (remove the PROJECT_NOT_FOUND refusal and a non-seed request returns 503, not 200)
- B refuse unconditionally, and change the stub to build a client instead of returning nothing
- C keep the old unconditional fallback and revisit at Stage 5
Your choice: A


### D-018 · One index keeps its shape: the buyer-name trigram · raised by kcho-shelter-25, 2026-09-25
Blocks: nothing. MT-1b shipped under A; settle it in Stage 4, where the keys move anyway.
Context: Stage 1 says every index gets `project_id` leading, and 40 of the 41 on the raffle tables did. The 41st, `tickets_buyer_name_trgm`, is a GIN index — a scalar cannot lead one without the `btree_gin` extension. It is available on this Postgres and on Supabase, but enabling an extension is a promise a `db push` can fail on.
- A ★ leave it. Correctness never depended on an index: it picks rows faster, the predicate decides which rows are allowed. With one project there is no difference at all; with several, a buyer-name search scans other projects' trigrams and the predicate discards them
- B `create extension btree_gin` in Stage 1 and index `(project_id, buyer_name gin_trgm_ops)`
Your choice: 

### D-017 · Three project refusals are left in English · raised by kcho-shelter-51, 2026-09-25
Blocks: nothing now. `PROJECT_NOT_FOUND` blocks Stage 5 if unanswered by then.
Context: i18n.test.mjs requires every server error code to have Burmese, with a named exemption for codes "a volunteer should never see, where English is the better answer". MT-2a adds `BAD_PROJECT`, `PROJECT_NOT_FOUND` and `PROJECT_UNAVAILABLE`. A project id is never typed by a person — it is a header software sets — and no client sends it at all today, so none is reachable from the app.
- A ★ all three exempt now, with a note in the test that `PROJECT_NOT_FOUND` needs Burmese at Stage 5: once a second raffle exists, an organiser following a stale link is a PERSON seeing it, about something they can act on
- B translate all three now, accepting unreviewed Burmese for two sentences nobody can currently reach
- C translate `PROJECT_NOT_FOUND` now and exempt the other two
Your choice: 

### D-019 · Stage 2's handler work cannot merge to master until the migrations are applied · raised by kcho-shelter-25, 2026-09-25
Blocks: merging MT-2b. Does NOT block deploying anything today — see the correction below, which is right and which this entry has been rewritten to match.
Context: I first wrote this as "master is ahead of the database, do not deploy". That was wrong, and I checked it myself rather than taking the correction on trust: on master, no function code outside comments queries `project_id` or the six new tables, nothing imports `scoped.ts` (the word in reports.ts is a local variable), and the reset plan's table and FK lists are never compared against the live schema. Master is deployable. What IS true is that the first commit putting handlers on the scoped client makes master undeployable until Stage 0 and Stage 1 are applied — and master is deployable by any session at any time, which is why that work is on a branch (`tenancy-stage-2`, board rule 9). Separately, `supabase/DEPLOY-PENDING.md` still says the gap closed on 2026-09-19 and is stale: the router change is undeployed.
- A ★ apply Stage 0 and Stage 1 — both inert, no behaviour added, reversible — and Stage 2's handler work can then merge as it is finished, in the plan's own order
- B leave them pending and Stage 2's handler half lives on a branch for as long as that takes, rebased against every peer's work in the meantime
- C stop Stage 2 at the SQL cards, which reach production only through a pending migration and are safe on master today
Your choice: 

### D-020 · Is a second organisation actually coming, and roughly when · raised by kcho-shelter-25, 2026-09-25
Blocks: nothing mechanically. It is the only question that changes how much of this is worth building.
Context: stages 0–3 are inert — they add columns, tags and a wrapper and change no answer. The first real capability arrives at Stage 5. The plan's own figure for stages 0–7 is 48–65 engineering days, and about ten are done. Nobody has asked you this since the plan was approved.
- A ★ yes, within months — carry on through Stage 4 and 5 in order, and answer D-022 with a date
- B not yet, but keep the ground prepared — finish Stage 2 and 3 (they are still inert and make Stage 4 a smaller step), then stop and hold
- C no — stop after Stage 2, leave the column and the wrapper in place, and spend the remaining forty days on the raffle itself
Your choice: 

### D-021 · Do the sixteen SQL functions take `p_project` with a default · raised by kcho-shelter-25, 2026-09-25
Blocks: the rest of Stage 2. **I recommended A first and then changed it to B; the reasoning is below, because the first version was wrong on the facts.**
Context: every SQL function gains `p_project uuid`. I wrote that a default would let a forgotten caller "silently write into this raffle". That is not what happens: the body is `coalesce(p_project, current_project(), seed_project())`, and the router sets the `x-project-id` header on every request, so a forgotten caller gets THE HEADER'S project — the correct one — and falls back to the seed only in a terminal session that has no header, where the seed is also correct. The real cost of no-default is different and larger: `active_tickets()` is called by the policies and the views, and the rpc sites are called by the handlers, so removing the old signature means functions.sql, rls.sql and all 364 query sites must change in ONE commit against a live database. That is the Stage 4 risk, arriving two stages early.
A third fact, found by running it rather than reasoning about it: `default null` on the new signature is not even possible. With `active_tickets()` already defined, adding `active_tickets(p_project uuid default null)` makes the bare call ambiguous — Postgres answers `function active_tickets() is not unique` — and every existing caller, including the policies, breaks. A sibling overload with NO default resolves cleanly in both directions.
- A no default and drop the old signatures: every caller explicit, one unreviewable commit across 16 functions, 6 policies, 6 views and 364 call sites, against a live database
- B ★ a sibling overload `f(…, p_project uuid)` with no default, and the old signature kept as a one-line wrapper delegating with `coalesce(current_project(), seed_project())` — which is exactly what `project_id`'s own column default does in Stages 1–3. Each piece lands and is proved on its own; Stage 4 drops the wrappers and the coalesce together, which is where the plan already puts strictness
Your choice: 

### D-022 · When Stage 4's quiet window is · raised by kcho-shelter-25, 2026-09-25
Blocks: Stage 4, and therefore 5 onward.
Context: Stage 4 swaps 23 primary keys and 18 foreign keys in one transaction on the live database, with the function deployed in the same window. It is the one step that needs a backup to fall back to, and the plan says announce it a week ahead. Everything before it is reversible without one.
- A ★ name a date outside a selling push — after a draw is the natural place — and I work backwards from it
- B the nearest low-traffic night once stages 2 and 3 are green
- C leave stages 0–3 in place and do not schedule Stage 4 until a second organisation is actually wanted; they are inert and cost nothing to hold
Your choice: 

### D-023 · Where the Stage 4 rehearsal runs · raised by kcho-shelter-25, 2026-09-25
Blocks: Stage 4. The plan says rehearse twice on a restored backup.
Context: rehearsing needs somewhere to restore a real backup to, and it must be somewhere a mistake cannot reach the live raffle.
- A ★ a throwaway Supabase project restored from `backup.sh` output and deleted afterwards — closest to production, costs a little, and proves the CSV restore path at the same time
- B a local Postgres from the same CSVs: free, and not the same platform, so a platform-specific failure would not show
- C Supabase branching, if the project's plan includes it
Your choice: 

### D-024 · Burmese for the organiser and system-admin screens · raised by kcho-shelter-25, 2026-09-25
Blocks: Stage 6.
Context: `i18n.test.mjs` requires a Burmese line for every `<Bi text>`, because a label missing from the map renders as English with no warning. Stage 6 adds two screens — projects and members, organisations — which is roughly forty to sixty new labels. No session here writes Burmese.
- A ★ English-only by rule for these two screens, with a written exemption in `i18n.test.mjs` naming them: they are used by the one or two people who run the platform, not by sellers in the field
- B I write the English and fill the Burmese map with the same English as a placeholder — which is exactly the silent-English failure that test exists to catch, so it would need its own visible marker
- C you supply the Burmese screen by screen as they are built, which paces Stage 6 to your evenings
Your choice: 

### D-025 · What "two-person" means for archive and purge · raised by kcho-shelter-25, 2026-09-25
Blocks: Stage 7 (and archive, which lands in Stage 4).
Context: the plan marks `archive_project` and `purge_personal` two-person. Today the raffle has one system admin and one organiser, so a literal second person may not exist when it is needed.
- A ★ only `purge_personal` is two-person, because it is the one that cannot be undone; `archive_project` takes the typed confirmation phrase `reset_apply` already uses, because it is reversible by the organiser
- B both two-person: two different signed-in accounts confirming within fifteen minutes
- C both by typed phrase, one person, and rely on the audit log
Your choice: 

### D-026 · Where the ninety-day retention job runs · raised by kcho-shelter-25, 2026-09-25
Blocks: Stage 7.
Context: D-013 sets ninety days. Something has to notice when a deactivated organisation or deleted project passes it, and purge or delete. A promise to members that data goes after ninety days is not kept by a button nobody presses.
- A ★ a scheduled GitHub Actions workflow calling an authenticated endpoint — the repo already deploys from there and the secrets already live there, and a failed run is visible in a place somebody looks
- B `pg_cron` inside Supabase: closer to the data, and its failures are quiet
- C no job — the organiser is shown "2 projects are past retention" and presses a button, which is honest about who decides and breaks the promise the first busy month
Your choice: 

### D-033 · A second raffle cannot have its own settings until Stage 4, so half of T4 cannot be written yet · raised by kcho-shelter-25, 2026-09-26
Blocks: nothing. It confirms the plan's own scheduling and says what the Stage 2 cards can and cannot prove.
Context: I tried to bring the two-project suite forward, so that Stage 2's predicates could be proved as they were written instead of taken on trust — with one raffle every one of them is a no-op, so the suites can only show nothing broke. It works for `tickets`, `books`, `agents` and `ticket_receipts`, where distinct numbers and codes get past the old global uniques, and the receipt-path leaks are now proved both ways. It does NOT work for `config`, `permissions` or `check_in_dates`: their primary keys are still `(key)`, `(action, role)` and `(round)`, so a second raffle cannot hold a `TOTAL_TICKETS` row at all — `duplicate key value violates config_pkey`. So anything reading config per project, `active_tickets(B)` included, is unprovable until the composite keys land.
- A ★ accept it: the twelve remaining SQL functions are scoped in Stage 2 as the plan says, with their predicates proved where a second raffle is possible and reviewed by reading where it is not, and T4 stays in Stage 4 where the plan already puts it
- B hold the twelve until Stage 4 and do them in the same window as the key swap, so every predicate is proved when written — a smaller Stage 2 and a much larger Stage 4, which is already the risky one
- C bring the composite-key swap for `config` alone forward into Stage 2, so settings are per project early; it is the smallest of the key changes and nothing reads config by its old key outside the eleven upserts
Your choice: 

### D-029 · Does a system admin have a way into another organisation's raffle data at all · raised by kcho-shelter-25, 2026-09-25
Blocks: MT-O1 (see `MULTI-TENANCY-ORGS.md`). The most consequential privacy decision in the plan.
Context: the plan gives the system admin "break-glass" entry to any project, audited with `platform_override: true` and never listed as membership. That is how you would fix somebody else's raffle at 11pm. It is also a door to every buyer's name and phone number in every organisation, and the service key means the database cannot refuse it — only the absence of a screen and an action can.
- A ★ no door. A system admin manages organisations, organisers, status and features, and has no action that returns another organisation's rows. To help inside a raffle they are appointed organiser, audited, and removed afterwards — a visible act with a name on it
- B break-glass as the plan says: a `platform_override` flag on the request, refused unless the caller is a system admin, every use audited and shown to that organisation's organiser on their own audit screen
- C break-glass, audited, and NOT shown to the organiser
Your choice: 

### D-030 · Switching a feature off for an organisation mid-raffle · raised by kcho-shelter-25, 2026-09-25
Blocks: MT-O1.
Context: `set_org_features` is the outer wall, so turning `money` off refuses every money action for everybody in that organisation including its organiser. Nothing is deleted, but a raffle in progress stops being able to record what it collects.
- A ★ allowed, with the confirmation naming what stops — "this refuses 14 actions for 3 members, including recording payments" — and an audit line. The system admin is the one person who should be able to do this, and hiding the consequence is worse than the consequence
- B refused while the organisation has an active project; only a draft or deactivated organisation's features may change
- C allowed only for the features the plan marks non-standard (printing, cards, studio, seed, reset), never for tickets/books/money/checkins
Your choice: 

### D-031 · Appointing an organiser who has never signed in · raised by kcho-shelter-25, 2026-09-25
Blocks: MT-O1.
Context: `organisations.organiser_email` is a column, so appointing is one write and needs no account to exist. The person then signs in with Google and is the organiser on first contact. There is no invitation, no token and no email sent — the repo sends no email at all today.
- A ★ appoint by address, no invitation. The screen says "they will become the organiser when they first sign in with this Google address", and the row shows "appointed, not yet signed in" until they do
- B add an invitation with a token and an expiry, which means the application starts sending email
- C appoint only an address that already has an `app_users`/`project_members` row somewhere, so a typo cannot create an organisation nobody can reach
Your choice: 

### D-032 · What a deactivated organisation's members see · raised by kcho-shelter-25, 2026-09-25
Blocks: MT-O2, and the sign-in path in Stage 3.
Context: D-006 says members are told "deactivated" and the organiser is offered reactivation. The question is what happens to somebody who is mid-task when it happens, and what a seller — who is not the organiser — can do about it.
- A ★ sign-in succeeds and lands on a single page saying the raffle is deactivated, with the organiser's address to contact; every action is refused `ORG_DEACTIVATED`; the organiser sees the same page with a Reactivate button
- B sign-in is refused outright, which is simpler and tells a volunteer nothing they can act on
- C read-only: members can still see what they had, and no writes are accepted
Your choice: 

### D-027 · The scoped client goes on in one place, not on every handler · raised by kcho-shelter-25, 2026-09-25
Blocks: the rest of Stage 2. Changes the plan's wording, which says "scoped.ts wrapper on every handler".
Context: `ctx.supabaseAdmin` is built in exactly one place, `index.ts:1793`. Wrapping it there scopes all 364 handler query sites at once. Wrapping each handler instead means 364 edits and leaves a permanent "did this one remember" surface — which is the failure scoped.ts's own header says it exists to end. The few places that must reach outside a project (control-plane actions in Stage 5) get a separate `ctx.supabasePlatform`, named so that using it is a visible choice.
- A ★ one wrapper at the chokepoint, plus `ctx.supabasePlatform` for the handful that need the unscoped client, and a test that nothing else builds an admin client
- B as the plan says, per handler: 364 edits, reviewable one at a time, and a new handler is unscoped until somebody remembers
Your choice: 

### D-028 · The six views gain project_id as a column, not only as a filter · raised by kcho-shelter-25, 2026-09-25
Blocks: the rest of Stage 2.
Context: the plan gives every view the predicate `and t.project_id = coalesce(current_project(), seed_project())`, which is right and — unlike a policy — also binds the service key, because a WHERE inside a view always applies. But the wrapper filters by `.eq('project_id', …)`, and two of the six views are read by handlers, so it would filter on a column the view does not expose. Either the views expose it, or the wrapper carries a list of which relations are views.
- A ★ the views expose project_id as well as filtering on it. The wrapper stays uniform with no list to maintain; the cost is one extra field in the payloads of `book_ledger_all` and `agent_money` (handlers, which name their columns) and of the four the browser reads directly. It is the raffle's own id, which the client already sends in a header
- B the wrapper keeps a list of view names and skips the filter for them: no payload changes anywhere, and a view added later is unscoped until the list is updated
Your choice: 


## Decided

Your answers, committed verbatim in 689566b, and what each one does to the plan.

- **D-001 → C.** Stage 3 makes the one `app_users` row whose role is `superadmin` the organiser of the existing organisation, and refuses to run if there is not exactly one.
- **D-002 → A, as you put it.** You, the system admin, stay system-wide with the final say on organisations and system permissions. Organisers are admins of their own organisation and privileged only inside it. Today's `superadmin` rows become admins of the existing project, not platform admins.
- **D-003 → A.** A stage's migration moves into `supabase/migrations/` only after you say "apply Stage N"; then it goes to a restored backup first, then live.
- **D-004 → A.** New organisations start with tickets, books, money, check-ins, approvals, prizes and reports on; printing, the digital card, the studio, seeding and reset off.
- **D-005 → A.** Signed links to artwork and logos last 12 hours.
- **D-006 → your own answer, wider than both options.** Organisers create and delete their own projects, and can deactivate and reactivate their own organisation. Deactivation is a soft delete: the data is kept for a period, people signing in are told the organisation is deactivated, and the organiser is offered reactivation at their next sign-in. Deleting an organisation is yours alone. This is new scope, now card MT-L; the period is D-013. `reset.sql` keeps refusing while more than one organisation exists.
- **D-007 → A.** The twenty-six untagged actions stay `core`.
- **D-008 → A.** `report_draft` and `report_back` are tagged `books`.
- **D-009 → A.** Done in ff67674: the three actions have labels and a test checks every action has one.
- **D-010 → A.** The gate gains a `deno check` step, which means installing Deno here and in the Pages workflow. Card MT-T.
- **D-011 → A.** The diff script compares the stored rows the reports read.
- **D-012 → A.** Done in 84fb1b2 by kcho-shelter-25. The expected count is now derived from the seed block with a floor of 29. The suite had also not started under Docker since 2026-09-21, because of a missing `service_role`; it now runs, 322 passed, 0 failed.

- **D-013 → A.** Deactivated organisations and deleted projects are kept 90 days; deleting a project is soft and the organiser can undo it inside those 90 days; the weekly workflow then deletes for good and writes it to the audit log. Card MT-L no longer waits on a question.

### The original entries

### D-013 · How long deactivated data is kept, and whether deleting a project is soft too · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: MT-L (organisation and project lifecycle). Follows from your answer to D-006.
Context: you asked for deactivating an organisation to keep its data for a period before it is deleted for good. The period is not set, and "delete a project" could be immediate or soft.
- A ★ 90 days for both; deleting a project is soft as well and can be undone by the organiser inside those 90 days; the weekly workflow does the permanent delete and writes it to the audit log
- B 30 days for both, same mechanism
- C a period each organisation chooses, 30 to 365 days
Your choice: A (the owner, 2026-09-25: "follow the recommendation")


### D-001 · Who becomes the organiser of the existing organisation · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 3. Stage 0 seeds the organisation with no organiser yet, which grants nobody anything.
Context: a migration cannot read the `SUPER_ADMIN_EMAIL` secret, so it cannot fill `organiser_email` itself.
- A ★ the api function sets it to the secret's address the first time the system admin signs in after Stage 3, and audits it
- B a runbook step: `select seed_tenancy('<email>')` typed by hand in the SQL editor
- C the one `app_users` row whose role is `superadmin`, refused if there is not exactly one
Your choice: C 

### D-002 · What today's `superadmin` rows become · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 3.
Context: the plan maps them to `platform_admins`, which gives them power over every future organisation. Today they only run this one raffle.
- A ★ admins of the existing project; platform rights are granted by hand later if wanted
- B platform admins, as the plan first said
- C decided per person on a list the migration prints and refuses to guess
Your choice: A. (system admin remain system admin because it's me and have privlege of system wide and ssystem relgated- final decisions of organizations ans system permission and superamind /organizers are admins of organizations and previliged only within organizatoin)

### D-003 · When pending migrations reach production · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: nothing until Stage 2 needs the database.
Context: Stages 0 and 1 are written to `migrations.pending/` and applied nowhere. Your earlier ruling allows Stages 0–3 as each is green.
- A ★ each stage moves into `migrations/` in its own commit only after you say "apply Stage N", then one person runs `db push` on a restored backup and then live
- B Stages 0 and 1 together, once both are green
- C hold everything until Stage 3 is green, then apply 0–3 in one window
Your choice:  A

### D-004 · The standard feature set for a new organisation · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 5 (creating organisations).
Context: the plan switches on tickets, books, money, check-ins, approvals, prizes and reports, and leaves printing, the digital card, the studio, seeding and reset off.
- A ★ as the plan says
- B everything on; you switch things off per organisation
- C only tickets and books; everything else is switched on by you
Your choice:  A

### D-005 · Signed link lifetime for artwork and logos · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: Stage 5.
Context: private buckets need signed links. Longer links survive a long print run; shorter ones limit a leaked link.
- A ★ 12 hours
- B 1 hour, re-signed on every screen load
- C 7 days
Your choice: A

### D-006 · What a full terminal reset does to organisations · raised by multi-tenancy-architecture-plan, 2026-09-24
Blocks: nothing today; matters once a second organisation exists.
Context: `reset.sql` empties the whole database. With one organisation that is the raffle; with several it is everybody's.
- A ★ keep it whole-database, re-seed the original organisation, and make it refuse while more than one organisation exists
- B scope it to one project with a `-v project=` argument
Your choice: organizers should be able to create or delete projects, activate or deactivate their accounts (which case soft delete and keep data for a certain period of time before parmently deleting - but to users show it's been deactivated and find away to reactivate them when they next login and wish to activage their orgniaations.); System Admin shoudl be able to delete organixations; 

### D-007 · Where the twenty-six unnamed actions go · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing. Tagging is in; this only decides whether the tags stay as written.
Context: the plan's `core` row names ten actions, and its rule for anything unnamed is `core`. Twenty-six end up there, including account administration (`upsert_user`, `set_permission`) and raffle setup (`set_numbering`, `expand_tickets`, `upload_logo`). `core` is unswitchable, so this is the set no system admin can ever turn off.
- A ★ as written: the plan's own default, and none of these is a thing an organisation should lack
- B a fourteenth feature, `settings`, for the sixteen setup and account actions, switchable but standard
- C split further: `branding` for logo/colour/contact/about, `accounts` for users and permissions
Your choice: A

### D-008 · `report_draft` and `report_back` are books, not reports · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing.
Context: the plan's `reports` row reads "report_*", which by name captures these two. They are not report documents — they are the seller's book return-report flow, and grouping them under `reports` would mean switching off reporting also stops sellers returning books. ACTION_META agrees: both sit in the Books group.
- A ★ tagged `books`; `reports` keeps only the six documents plus `export_entries`
- B follow the "report_*" wording literally and tag them `reports`
Your choice: A

### D-009 · `ACTION_META` covers 92 of 95 actions · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing in MT-F. Not fixed here, per rule 1.
Context: `ACTION_META` is optional, so `agent_statement`, `search` and `set_org_about` fall through `m.group ?? 'Other'` and `m.label ?? action` (index.ts:105, 119-120). Permissions.vue renders them in a card headed "Other" with their raw snake_case ids as labels. Nothing in tests/ reads ACTION_META. This is the defect the plan cites as its reason for making `feature` required, three lines from the registry.
- A ★ its own card: add the three entries and a test that ACTION_META covers REGISTRY, both directions
- B fold into whichever card next touches the Access screen
- C leave it; three raw ids on an organiser-only screen is tolerable
Your choice:  A


### D-010 · Nothing type-checks the Edge Function · raised by kcho-shelter-51, 2026-09-24
Blocks: nothing now; Stage 3 starts relying on required fields such as `feature`.
Context: `tests/run.sh` has no `deno check` or `tsc` step, so a required TypeScript field is enforced only by a test that reads the source text. Stages 2–5 add more such contracts (`ctx.project`, `p_project`).
- A ★ add a `deno check supabase/functions/api/index.ts supabase/functions/verify/index.ts` step to the gate, failing if Deno is missing, as test-rls.sh does for Docker. Deno is not installed on this machine today, so A also means installing it here and in the Pages workflow
- B keep source-text tests only, one per contract
Your choice:  A

### D-011 · T9 dumps the SQL the reports are built from, not the handlers' answers · raised by kcho-shelter-25, 2026-09-24
Blocks: nothing. T9 ships under A; read this before reviewing it against the card.
Context: the card names five "reports", but only `agent_money` is a database object (a view, rls.sql:533). `read_snapshot` (tickets), `list_books` (book_ledger_all), `report_draw_ready` (book_ledger_all, tickets, active_tickets()) and `list_payments` (agent_money, payments) are Edge Function handlers, so a script given a database URL cannot call them.
- A ★ dump the SQL each report reads — tickets, book_ledger_all, agent_money, payments, active_tickets() — each object once, with the report-to-object mapping recorded in the file. Pure SQL, cannot drift from handler code because it claims nothing about it, and a stronger proof for MT-1b: that migration cannot touch handler code, so if no underlying row moved, no answer can have
- B call the deployed function with a service key: the exact answers, and it needs production credentials, which rule 3 forbids
- C reimplement each handler's projection in SQL: exact-looking, and a second copy of five queries that drifts the first time a handler changes — the defect this repo has paid for repeatedly
Your choice: 
 A
### D-012 · The real-Postgres test suite is already red on master · raised by kcho-shelter-25 and multi-tenancy-architecture-plan, 2026-09-24
Blocks: MT-1b, which needs `supabase/test-functions.sh` to prove the column migration.
Context: two checks expect 29 settings rows and find 42, on master before any tenancy work. A suite that is already red cannot show a new failure.
- A ★ a small card before MT-1b: find which migrations added the 13 keys, then update the expected count with a line naming each key
- B waive the two checks in writing for MT-1b only, and fix them later
Your choice: A


