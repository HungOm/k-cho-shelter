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

**Why two cards are held.** Each peer session asked its own user before taking
tenancy work, as rule 2 requires, and neither has an answer yet. The owner can
release them by telling `kcho-shelter-25` and `kcho-shelter-51`, in those
sessions, that they may work on this plan.

| Id | Stage | Owner | Depends on | Status |
|---|---|---|---|---|
| MT-0 | 0 control plane | multi-tenancy-architecture-plan | none | done (2d62e15); migration pending, not applied |
| MT-1a | 1 the diff script (T9) | kcho-shelter-25 | none | accepted |
| MT-1b | 1 the column (the migration half of MT-1) | held: kcho-shelter-25 declined pending its own user's word | MT-0 | waiting for the owner |
| MT-F | 3 feature list (tagging only) | kcho-shelter-51 | MT-0 | done (a20dfdf) |
| MT-K | 2 test double + wrapper | multi-tenancy-architecture-plan (declined by ticket-studio-redesign) | none | done (d0b52d1) |
| MT-2a | 2 the function resolves the project first | held: kcho-shelter-51 declined pending its own user's word | MT-K | waiting for the owner |

The rest of Stage 2 (handlers on the scoped client, SQL functions taking
`p_project`, the coalesced predicates) waits for MT-1, because it needs the
`project_id` column. Stages 3 onward are not yet cut into cards.

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

### MT-2a · Stage 2 · the function resolves the project first

- **Ships.** In `supabase/functions/api/index.ts` `route()`: read the
  `x-project-id` request header before anything else. Absent means the seed
  project (`00000000-0000-0000-0000-000000000001`, plan invariant 2). Not a uuid
  is refused `BAD_PROJECT`. Any other uuid is refused `PROJECT_NOT_FOUND`: no
  second project can exist before Stage 5 (plan invariant 6). Only then read the
  user row, the permissions and `approvalNeeded`, all through the per-request
  admin client, which now carries `x-project-id` beside `x-request-id` and is
  built BEFORE those reads (the review's finding at `index.ts:1677-1709`). Put
  the id on `ctx.project`. Key `configCache`, `permsCache` and `userCache` by
  project. New `tests/projectroute.test.mjs`.
- **Must not change.** Any answer to a request with no header or with the seed
  header. No handler, no client file, no SQL. Nothing is deployed.
- **Watch for.** The review found `createAdminClient` returns nothing under the
  test stub, and today the request carries on with the platform client. The plan
  says a request whose stamped client cannot be built is refused. If refusing
  there turns suites red because of the stub, make the stub build a client
  rather than weakening the refusal; if that is not possible, log a decision and
  keep today's behaviour.
- **And do not inherit `if (stamped)`** (from kcho-shelter-51). Today a failed
  build of the second admin client costs only the correlation id, because it
  happens after identity is resolved, and the comment above it says so. Moved in
  front of the user row, permissions and `approvalNeeded`, the same fallback
  would run the three reads that decide who somebody is on a client with no
  project header, silently. Once the header matters, a failed build is a hard
  refusal, and that comment is rewritten, not left behind saying the opposite.
- **Done when.** Gate green in a frozen archive (symlink `node_modules` into it);
  `router`, `everyaction`, `edgehandlers`, `gate` unchanged in count and result;
  the new suite proves all four header cases and that a refused project reads no
  user row.
