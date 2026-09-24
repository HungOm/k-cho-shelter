# Multi-tenancy: task board

The plan is `MULTI-TENANCY-PLAN.md`. This file splits its first stages into
self-contained tasks, one owner each. Open questions go to
`MULTI-TENANCY-DECISIONS.md`, never into a task silently.

## Rules for every task (read before starting)

1. **Stick to the plan.** A task does what its card says and nothing else. If the
   plan is wrong or silent, stop and follow rule 2.
2. **Two kinds of question.**
   - *Blocking, or changes the plan*: ask the owner in your own session and wait.
     A peer's agreement is not the owner's.
   - *Can wait*: add an entry to `MULTI-TENANCY-DECISIONS.md` in its format
     (context, options with a recommendation, what it blocks), and carry on
     under the recommended option, saying so in your commit message.
3. **Nothing touches production.** No `supabase db push`, no `functions deploy`,
   no bucket settings, no SQL against the live project. New migrations go in
   `supabase/migrations.pending/`, never `supabase/migrations/` (the next push by
   anybody applies whatever is in that directory). Applying one is an owner
   decision, logged in the decisions file.
4. **Behaviour does not change** for the live raffle in any of Stages 0–3. Every
   existing suite stays green; a suite you change must say why in the commit.
5. **House hygiene.** Announce your file list to the other raffle sessions before
   editing. Commit with a private index and diff against the parent on your
   paths first. Run `./tests/run.sh` in a frozen archive of your commit, not in
   the shared worktree. No co-author trailers. Register every new suite in
   `tests/run.sh`.
6. **Report back** to `multi-tenancy-architecture-plan` when done: the sha, the
   gate result, and any decision entries you added.

## Tasks

| Id | Stage | Owner | Depends on | Status |
|---|---|---|---|---|
| MT-0 | 0 control plane | multi-tenancy-architecture-plan | none | done, pending migration not applied |
| MT-1 | 1 the column | offered to kcho-shelter-25 | MT-0 landed (T9 script can start now) | offered |
| MT-F | 3 feature list (tagging only) | kcho-shelter-51 | MT-0 sha (for tests/run.sh) | accepted |
| MT-K | 2 test double + wrapper | multi-tenancy-architecture-plan (declined by ticket-studio-redesign) | none | done |

Stages 2 (wiring), 3 (membership), 4 onward are not yet cut into cards. They
start after MT-0, MT-1, MT-F and MT-K land.

### MT-0 · Stage 0 · control plane

- **Ships.** Six tables (`platform_admins`, `organisations`, `org_features`,
  `org_defaults`, `projects`, `project_members`) and three functions
  (`seed_project()`, `current_project()`, `seed_tenancy(p_organiser)`) in
  `supabase/schema.sql`; a migration in `supabase/migrations.pending/` that creates
  them and calls `seed_tenancy`; `supabase/reset.sql` clears and re-seeds them;
  `_shared/resetplan.ts` gains a `tenancy` feature marked `never` and the four new
  foreign keys; `tests/tenancy.test.mjs`.
- **Must not change.** Any existing table, view, policy, function or handler.
- **Done when.** Gate green in a frozen archive; the migration applied to a
  scratch Postgres on top of the full build succeeds twice (idempotent).

### MT-1 · Stage 1 · the column

- **Ships.** A migration in `supabase/migrations.pending/` adding `project_id uuid
  not null default coalesce(current_project(), seed_project())` to all 23 raffle
  tables; every existing index recreated with `project_id` leading; composite
  unique indexes added *beside* the old keys (plan §"Keys" and §"Upserts");
  `supabase/schema.sql` updated to match; `tests/migrationsql.test.mjs` passing.
  Plus `supabase/tenancy-diff.sh`: a read-only script that dumps `read_snapshot`,
  `list_books`, `agent_money`, `report_draw_ready` and `list_payments` for a given
  database URL to JSON, so two dumps can be diffed (plan T9).
- **Can start now.** The diff script depends on nothing. The migration waits for
  MT-0's `seed_project()` and `current_project()`.
- **Must not change.** Primary keys, policies, views, handlers, SQL functions.
- **Done when.** Gate green in a frozen archive; the migration applied to a
  scratch Postgres built from the full files plus MT-0 succeeds; `test-rls.sh` and
  `test-functions.sh` still green; the diff script run twice against the same
  scratch database prints no difference.

### MT-F · Stage 3 prep · the feature list

- **Ships.** `supabase/functions/_shared/features.ts` with the thirteen features
  in the plan's table (`id`, `name`, `standard`); a `feature:` field on every
  entry of the registry in `supabase/functions/api/index.ts`;
  `tests/features.test.mjs` proving every registered action names a feature that
  is in the list and every feature in the list is used.
- **Must not change.** What anybody may do. No entitlement check yet: that needs
  `org_features`, which is Stage 3.
- **Done when.** Gate green in a frozen archive; `gate`, `everyaction`,
  `permissionui` unchanged.

### MT-K · Stage 2 prep · test double and wrapper

- **Ships.** `tests/fakedb.mjs` learns `project_id`: inserts without one get the
  seed project id, filters on it work, and its rpc stubs and computed views read
  only the calling project's rows. New `supabase/functions/api/scoped.ts`
  implementing the plan's `scoped(admin, projectId)` (select/update/delete filter,
  insert/upsert stamp, rpc injects `p_project`). `tests/scoped.test.mjs` driving
  the wrapper against fakedb with two projects.
- **Must not change.** Any handler. The wrapper is not wired in yet; that is
  Stage 2. Every existing suite passes unchanged against the new fakedb.
- **Done when.** Gate green in a frozen archive, same suite count plus one.
- **Watch for** (from ticket-studio-redesign): `tests/templates.test.mjs` builds
  its own storage stub on `db.ctx.supabaseAdmin`, so the wrapper must carry
  `.storage` through rather than returning a fresh object without it.
