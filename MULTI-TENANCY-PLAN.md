# Multi-tenancy: organisations, projects, and the wall between them

Status: proposal 2026-09-24, HEAD `0a2520d`, rulings taken, reviewed once against the
code by a Plan agent (its findings are folded in and marked "review" below). A draft was
written to `MULTI-TENANCY-PLAN.md` at the repo root before plan mode started; it is stale
in several places. **On approval the first execution step overwrites that file with this
one** (house rule: approved plans live at the repo root).

## Context

The owner asked for an analysis of the current architecture and a plan for multi-tenancy:
secure, safe partition of data between organisations; each organisation able to create
several projects (a project is one raffle) and archive them; without affecting the current
system; scalable; detailed.

Three facts shape everything:

- The system is single-raffle by construction. `tickets.idx` (dense from 1) is the primary
  key; so is `books.idx`; `config` is one key/value table; `active_tickets()` takes no
  argument; every view, policy, SQL function and handler asks about *the* raffle. That
  assumption underpins the best parts of the design (arithmetic numbering, keyset paging,
  append-only ledgers, the reset plan), so the partition is added under those guarantees.
- Today's answer to "another organisation" is a fork: one Supabase project per organisation
  (SETUP.md, supabase/SELF-HOST.md). Today's answer to "another raffle" is `app_reset`,
  which destroys the previous one.
- ARCHITECTURE-REVIEW.md §14 reserved the seam: "Event — one raffle. `config` becomes an
  `events` row when multi-event is wanted". A project is that event; archived is its
  finalized state.

## What exists, measured (2026-09-24)

```
Browser (Pages, one build)          Edge Function `api` (service role)        Postgres `public`
  Google via Supabase Auth            email -> app_users row -> role             23 tables, 7 views, 16 SQL fns,
  POST {action,payload} ------------> 95 actions, gate + approvals + audit ----> 13 trigger fns, 11 policies
  reads via 4 masked views ---------------------------------------------------> RLS as the signed-in person
  Realtime 'raffle' (nudge only)                                                 realtime.send(..., 'raffle')
  /v/?NUMBER.CODE ------------------> `verify` (public, no JWT) ---------------> config + tickets + ticket_codes
```

Where the one-raffle assumption lives:

| Surface | Where | Assumes one raffle |
|---|---|---|
| Keys | `supabase/schema.sql` | `tickets(idx)`, `books(idx)` PKs; `tickets.number`, `books.number` UNIQUE; `agents(agent_id)`, `config(key)`, `app_users(email)`, `check_in_dates(round)`, `check_in_reports(agent_id,round)`, `permissions(action,role)`, `winners(ticket_idx)`, `ticket_codes(ticket_idx)`; `ticket_receipts_one_per_buyer` (phone+name, global) |
| Foreign keys | 18 edges in `_shared/resetplan.ts` `LINKS`, checked against schema.sql by `tests/resetplan.test.mjs` | all on per-raffle natural keys |
| Identity | `supabase/rls.sql:57-84` `auth_email()`, `app_role()`, `app_agent_id()` | role from global `app_users` |
| Read path | `rls.sql` views `tickets_readable`, `book_ledger`, `book_ledger_all`, `agent_money`, `agents_readable`, `config_readable`, `ticket_custody`; 11 policies; scalar `(select value from config where key = …)` at `rls.sql:296,346-348,377,467-469,496-497` | `app_role() is not null and idx <= active_tickets()`; a second config row makes those scalars raise "more than one row" (review) |
| Config | `supabase/functions.sql:19` `active_tickets()`; `select … into` from config at `functions.sql:24-25,61,290,331,539` (first row wins, silently); 33 handler sites | no argument |
| Write path | `supabase/functions/api/*.ts`: 319 `.from('t')` sites over 23 tables/views; 16 `.rpc()` sites; 11 `upsert(…, {onConflict})` sites (`branding.ts:345`, `deadlines.ts:358,993,1380`, `printing.ts:103`, `people.ts:400,494,940,980`, `index.ts:1562`, `templates.ts:237`) | service role bypasses RLS; `onConflict` needs a matching unique index |
| Request setup | `api/index.ts` `route()`: membership read (:1677), permissions read (:1685), `approvalNeeded` (:1709) run on the platform client; the per-request admin client with `x-request-id` is built afterwards (:1749-1752) and the request continues if it cannot be built | anything before :1749 would run without a project header (review) |
| SQL functions | 16 business functions, 13 trigger functions; `config_numbering_locked` (`schema.sql:1658`) tests `exists(select 1 from tickets)` unscoped; `app_reset` (`migrations/20260921020000…:126-146`) does `alter table … disable trigger user` (an ACCESS EXCLUSIVE lock on every table) and deletes by `ctid` | unqualified `where number = …`; a per-project reset cannot use table DDL (review) |
| Correlation | `schema.sql:1464` `request_id()` reads header `x-request-id`; column defaults pick it up inside `settle_book` | exactly the mechanism a project stamp needs; proven to reach statement triggers and definer functions |
| Caches | `api/index.ts:1509-1524` `configCache.get('all')` (last key wins), `permsCache.get('all')`, `userCache.get(email)` | no project in the key |
| Realtime | `migrations/20260916001500_change_nudge.sql` topic `'raffle'` (statement-level, no `new`); `…002000_nudge_channel_policy.sql` on `app_role()`; `tests/nudge.test.mjs:50-114`, `tests/nudgeclient.test.mjs` pin the names | one topic; the socket carries no headers |
| Storage | `api/branding.ts:366-401`, `api/templates.ts:362-368,568`: two public buckets, flat names, public URLs stored in `ticket_templates.url` and `ORG_LOGO*` | no per-raffle path |
| Public verify | `functions/verify/index.ts:69-144` one global numbering cache used *before* the lookup (`canonicalNumber` :367); `:197-200` `?about`; `:282` `holding_of`; `:377,391` tickets by number, code by ticket | numbering from global config; `holding_of`'s live branch (`functions.sql:1350-1357`) joins by phone+name only |
| Client | `src/lib/cache.js` IndexedDB `kcho-shelter`/`app`; `src/lib/nudge.js:71` channel `'raffle'`; `src/lib/supabaseAuth.js:65` headers fixed at `createClient`; `src/lib/store.js` one `state` | one raffle per device |
| Owner-only | 11 `sup: true` actions (void_ticket, list_permissions, set_permission, set_active_tickets, expand_tickets, set_ticket_ceiling, set_numbering, set_final_deadline, export_entries, record_winner, decide_approval); README lists six | one secret per deployment |
| Tests | 147 suites in `tests/run.sh`; `tests/fakedb.mjs:297-450` query builder (all five chain shapes the wrapper needs), `rpc` stubs `:632-669` and computed views `:270-283` read `db.tables.*` unscoped; every fixture lacks `project_id`; `test-rls.sh:127,306` and `test-functions.sh` set only `request.jwt.claims` | fixtures have no project |

Must survive unchanged: default-deny + masked views + one write door; the append-only
ledgers; structural uniqueness (`winners_one_per_seat`, `FOR UPDATE` in `settle_book`);
the wire shape and keyset paging on `idx`; `verify`'s blast radius and its source scan;
the `request_id()` header pattern (reused, not replaced).

## The shape chosen

| | A. Silo (today) | B. Pooled, `project_id` on every row | C. Schema per project |
|---|---|---|---|
| Isolation | separate database | row-level, three enforced layers | namespace |
| Code change | none | keys, views, policies, SQL fns, handlers, caches, channel, paths, client | small in code, large in tooling |
| Projects per org | no | yes | yes |
| Scale | linear cost/setup per org | ordinary Postgres | PostgREST introspects every schema; migrations fan out; `search_path = public` hard-coded in ~30 functions |
| "Without affecting" | trivially | yes if staged | unverified on hosted Supabase |

**Decision: B, staged so the live raffle never notices; A stays a supported mode (one
organisation) and is the escape hatch for an organisation that needs its own database.**
C is not a plan until a spike is green (two schemas on the hosted project, both exposed,
`test-rls.sh` against each, PostgREST schema-cache reload measured).

Invariants every stage must hold:

1. Every existing row is in the seed project and every action/view/report answers as before.
   Proof: frozen-archive gate + before/after diff of `read_snapshot`, `list_books`,
   `agent_money`, `report_draw_ready`, `list_payments` on a restored backup
   (`supabase/RESET-RUNBOOK.md` has the restore drill).
2. A client built before the stage keeps working until Stage 4: through Stage 3 every
   predicate and default reads `coalesce(current_project(), seed_project())` (review: a bare
   `= current_project()` would empty every view for a header-less client).
3. Every migration is applied to a restored backup before production, by `supabase db push`,
   with `schema.sql`/`functions.sql`/`rls.sql` updated in the same commit
   (`tests/migrationsql`, `tests/resetplan` parse the full-state files).
4. Nothing changes what a printed ticket, QR or receipt link means (codes stay globally unique).
5. Every stage has a written rollback; only Stage 4's is "restore the backup".
6. **No second project exists before Stage 5** (`create_project` is the only door, and it
   ships in Stage 5). Every "first row wins" and "more than one row" hazard the review found
   is inert until then and is closed in Stages 2 and 4.
7. Deploy order within a stage is migration, then function, then client. Pages deploys the
   client on every push to master (`.github/workflows/deploy.yml`), so every client change
   must tolerate the function one deploy behind it, and every function change must tolerate
   the schema one migration behind it where the stage says so.

## Target architecture

### The hierarchy (owner's ruling, 2026-09-24)

```
System admin (platform)  — SUPER_ADMIN_EMAIL secret, plus rows in platform_admins the secret may add
   └─ creates organisations and appoints EXACTLY ONE organiser per organisation
   └─ decides WHICH FEATURES each organisation has (org_features): the outer wall
Organiser (one per organisation)  — organisations.organiser_email, a column, so "one" is structural
   └─ creates projects; holds the 11 owner powers in every project of the organisation
   └─ decides WHO in the organisation may use each feature (permissions, per project): the inner wall
   └─ sets organisation defaults every new project starts from (org_defaults)
   └─ adds project members: sellers who sign in (agent), helpers (recorder), viewers, extra admins
Project member  — project_members.role, the four roles as today, per project
Seller without a login  — agents row, per project, no account
```

Three layers of access, checked in this order and each able only to narrow the one
before it (the same "an override may narrow, never widen" rule `gate.ts` already enforces):

1. **Organisation entitlement** (system admin): is this feature switched on for the
   organisation at all? Off → `FEATURE_NOT_ENABLED`, for the organiser too.
2. **Organiser's permissions** (per project, the existing `permissions` table and Access
   screen): which roles may use it. The screen shows a feature the organisation lacks as a
   locked row saying "not included for this organisation", not as a switch.
3. **Registry defaults** and the 11 organiser-only actions, unchanged.

Every registered action names its feature (`feature: 'money'` beside `roles` and `kind`);
an action that names none is `core`, and `tests/features.test.mjs` fails an action whose
feature is not in the named list (the lesson recorded beside `ACTION_META`: optional in
code is absent in practice). The list lives in `_shared/features.ts`, one row per feature
with `standard: boolean`:

| Feature | Actions (by group) | Standard |
|---|---|---|
| `core` | whoami, read_*, search, list_books, list_agents, book_history, deadline_status | always on |
| `tickets` | sell_*, reserve/release, correct, bulk_record_sales, sell_book | yes |
| `books` | issue/offer/transfer/return/restock/move, acknowledge, count-in | yes |
| `money` | record/reverse payment, write_off, list_payments, statements | yes |
| `checkins` | roll_check_in, record_check_in, check_in_sheet, round_snapshot, set_check_in_date | yes |
| `approvals` | request/cancel/decide approval, book requests, offers | yes |
| `prizes` | upsert/remove prize and prize type, record_winner, set_winner_status | yes |
| `reports` | report_*, export_entries | yes |
| `printing` | generate_tickets, render_tickets, templates, ticket sizes | no |
| `cards` | make_receipt, set_card_design, supporter bands (the digital ticket) | no |
| `studio` | set_design_library and the design screens | no |
| `seed` | seed_preview, seed_apply | no |
| `reset` | reset_preview, reset_apply | no |

The seed organisation is granted every feature by the migration, so nothing changes for
the live raffle. A new organisation starts with the standard set; the system admin
switches the rest on or off per organisation (`set_org_features`, audited).

Organisation defaults (`org_defaults`, key/value like `config`): brand colour, logo,
contact, supporter band names, design library. `seed_project_config` reads them when
creating a project, so a project starts as its organisation rather than as the factory
defaults; a project may still change its own copy.

### Control plane (new tables, not partitioned)

```sql
create table platform_admins (          -- the assignable-superadmin idea, kept at platform level
  email text primary key, added_by text not null default '', added_at timestamptz not null default now());
create table organisations (
  org_id uuid primary key default gen_random_uuid(),     -- core since PG13; no extension (tests/selfhost allows only pg_trgm)
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null,
  organiser_email text not null,                          -- exactly one; changed only by a system admin, audited
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(), created_by text not null default '');
create table org_features (             -- the outer wall: what an organisation may use at all
  org_id uuid not null references organisations(org_id) on delete restrict,
  feature text not null,                -- one of _shared/features.ts; a test keeps the two lists equal
  enabled boolean not null,
  set_by text not null default '', set_at timestamptz not null default now(),
  primary key (org_id, feature));
create table org_defaults (             -- what every new project of the organisation starts from
  org_id uuid not null references organisations(org_id) on delete restrict,
  key text not null, value text not null default '',
  primary key (org_id, key));
create table projects (
  project_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(org_id) on delete restrict,
  slug text not null, name text not null,
  status text not null default 'active' check (status in ('draft','active','closing','archived')),
  created_at timestamptz not null default now(), created_by text not null default '',
  archived_at timestamptz, archived_by text,
  purge_personal_after interval,   -- null = never; README already asks organisers to delete contact details after the draw
  purged_at timestamptz,
  unique (org_id, slug));
create table project_members (      -- app_users, per project; same lifecycle, same generated `active`
  project_id uuid not null references projects(project_id) on delete restrict,
  email text not null, name text not null default '',
  role text not null check (role in ('admin','recorder','agent','viewer')),
  status text not null default 'active' check (status in ('pending','active','suspended','banned')),
  active boolean generated always as (status = 'active') stored,
  agent_id text, added_by text not null default '', added_at timestamptz not null default now(),
  primary key (project_id, email));
  -- Stage 4: foreign key (project_id, agent_id) references agents(project_id, agent_id) on delete set null
create or replace function seed_project() returns uuid as $$
  select '00000000-0000-0000-0000-000000000001'::uuid $$ language sql immutable;
```

Seed rows: one organisation (slug from `ORG_NAME` or `default`) whose organiser is the
address in `SUPER_ADMIN_EMAIL` (the migration takes it as a psql variable, as `reset.sql`
does), every feature enabled for it, one project with the named id. `resetplan.ts`
classifies the six control-plane tables under a `tenancy` feature marked `never`
(`tests/resetplan.test.mjs` requires a home for every table).

### The partition key, stamped the way `request_id` is

```sql
create or replace function current_project() returns uuid as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-project-id',
    nullif(current_setting('app.project_id', true), ''))::uuid   -- malformed = cast error = refused
$$ language sql stable set search_path = public;
-- every table, Stages 1–3:  project_id uuid not null default coalesce(current_project(), seed_project())
-- Stage 4:                  set default current_project()   -- a write with no project is refused loudly
```

Stamping rules (both tested): trigger functions that write history copy `new.project_id`,
never the header; only INSERT defaults and the statement-level nudge read the request.

**Two carriers, which must agree.** The header stamps defaults and scopes the direct-read
path. Handlers and SQL functions carry the project *explicitly* as well: the scoped wrapper
adds `.eq('project_id', id)` and injects `p_project` into every `rpc`; every SQL function
takes `p_project uuid`, filters on it, and raises if `current_project()` is present and
differs (review: in the test harness the stamped client is never built, and at runtime the
request used to continue without it; explicit carriage means neither case can leak).

In `route()` the project is resolved **first**: read `x-project-id`, check membership,
build the stamped admin client, and only then read permissions and run `approvalNeeded`
(review: today those run on the platform client at `:1677-1709`). If the stamped client
cannot be built the request is refused, not continued. The project never comes from the
payload. No header → `PROJECT_REQUIRED`, except control-plane actions.

### Keys: nothing can point across the wall

| Table | Target |
|---|---|
| `tickets`, `books` | PK `(project_id, idx)`; unique `(project_id, number)` |
| `agents` | PK `(project_id, agent_id)` |
| `config` | PK `(project_id, key)` |
| `app_users` | migrated into `project_members`; compatibility view one release, then dropped |
| `permissions` | PK `(project_id, action, role)` |
| `check_in_dates`, `check_in_reports` | `(project_id, round)`, `(project_id, agent_id, round)` |
| `prize_types`, `prizes`, `pending_approvals`, `ticket_templates` | text-id PKs unchanged; `project_id` column; composite FKs; every read filters. `pending_approvals.project_id` is asserted equal to the header at decide time (review: re-execution runs under the decider's context, `index.ts:576-600`). Printing checks `template.project_id` (review: `ticket_templates.id` is global and `config.value` has no FK to it) |
| `winners` | PK `(project_id, ticket_idx)`; `winners_one_per_seat` gains `project_id` |
| `ticket_codes` | PK `(project_id, ticket_idx)`; **`code` stays globally unique** |
| `ticket_receipts` | PK `code` unchanged (global); `one_per_buyer` gains `project_id`; `ensure_holding_tx` matches within the project (review: today B's organiser would receive A's code for the same buyer) |
| `ticket_receipt_items` | `(code, project_id, ticket_idx)` |
| identity-key ledgers | id unchanged; `project_id`; composite FKs; `client_key` indexes gain `project_id` |
| 18 FKs | `foreign key (project_id, x) references t(project_id, x)` |
| every index | `project_id` leading (`tickets_modified_at_idx` included, for `read_version`/`read_delta`); partial predicates unchanged |

**Upserts (review).** PostgREST `onConflict` needs a matching unique index. So Stage 1 adds
the composite unique indexes *beside* the old keys (satisfiable with one project), Stage 2's
function deploy switches the 11 `onConflict` strings to the composite columns (valid against
both), and Stage 4 drops the old keys. Migration-before-function holds at every step.

After Stage 4 a naked `where number = 'Book-001'` returns two rows. That is why every SQL
function is scoped in Stage 2 (inert then) and re-proved by the two-project suites in Stage 4.

### Read path

```sql
create or replace function member_role(p_project uuid) returns text as $$
  select coalesce(
    (select 'admin' from projects p join organisations o on o.org_id = p.org_id
      where p.project_id = p_project and o.organiser_email = auth_email() and o.status = 'active'),
    (select role from project_members where project_id = p_project and email = auth_email() and active))
$$ language sql stable security definer set search_path = public;
-- The organiser wins: a project_members row cannot demote the organiser of the organisation.
create or replace function app_role() returns text as $$
  select member_role(coalesce(current_project(), seed_project()))   -- Stage 4 drops the coalesce
$$ language sql stable security definer set search_path = public;
```

`app_role()` keeps its name so no policy or view learns a new function. Every policy and
view adds `and t.project_id = coalesce(current_project(), seed_project())` (Stage 4 makes
it strict); required even though `app_role()` is scoped, because a member of A sending
header A must not read B's rows. Every join between two partitioned tables adds
`and b.project_id = t.project_id`. Every scalar `(select value from config where key = …)`
in the views and every `select … into` from config in `functions.sql` is scoped in
Stage 2, because the first second-project config row would otherwise raise in the views and
pick the wrong row in the functions (review). `active_tickets(p_project)` takes the project;
the view calls it with the row's `project_id`. Wrap helpers as `(select app_role())` so
they evaluate once per statement.

### Write path: a client that cannot forget

New `supabase/functions/api/scoped.ts`: `scoped(admin, projectId)` returns `{from, rpc,
storage}` where `select/update/delete` chain `.eq('project_id', id)`, `insert/upsert` stamp
rows, and `rpc(name, args)` injects `p_project`. `tests/fakedb.mjs` supports the chain
shapes, but (review) its `rpc` stubs and computed views read the tables unscoped and no
fixture carries `project_id`, so the fake gains a default project stamp on insert and
project-aware stubs in Stage 2, before the wrapper lands.

Guarantees, not conventions:
- `tests/scopedclient.test.mjs` fails any file under `supabase/functions/api/` naming
  `supabaseAdmin.from(` / `.rpc(` except `index.ts` `route()` and the control-plane module
  (same shape as `tests/custodyledger.test.mjs`).
- `tests/sqlscope.test.mjs` scans `functions.sql` + migrations for `from|update|join <table>`
  without `project_id` in the statement, and asserts its scan found something.

The service role bypasses RLS; the write path's isolation is the wrapper + explicit
`p_project` + their tests until Stage 8 (non-bypass role, `force row level security`).

Per-project reset (review): `app_reset` is rewritten as `delete … where project_id =
p_project` under a transaction-local `app.maintenance` setting that the append-only
trigger functions honour, instead of `alter table … disable trigger` (which takes an
ACCESS EXCLUSIVE lock on every table and would stall project A's sales while B resets).
`tests/sqlscope` also asserts a browser role cannot set that GUC through any exposed
function. `reset_preview`'s counts and `seed.ts`'s `RAFFLE_IN_USE` counts come through the
wrapper and so are per project.

### The other doors

- Realtime: topic `'project:' || project_id` sent from `current_project()` (the trigger is
  statement-level and has no row); policy derives the project from the topic
  (`member_role(substring(realtime.topic() from 9)::uuid) is not null`) because the socket
  carries no headers. Ships in **Stage 4's** migration alongside the strict `app_role()`
  (review: a strict `app_role()` with the old policy would silence every nudge). Payload
  stays empty. `tests/nudge.test.mjs` and `nudgeclient.test.mjs` are updated in that commit.
- Storage (owner's ruling: **private buckets, signed URLs**): object names
  `<project_id>/<random>`; `ticket_templates.url` and `ORG_LOGO`/`ORG_LOGO_SMALL` change
  from stored public URLs to stored object PATHS, and every reader receives a signed URL
  minted server-side (`createSignedUrls`, 12-hour expiry, longer than the 30-second config
  cache): `configPayload` (`api/config.ts`), `list_templates` (`api/templates.ts`), and the
  public `verify` function for the logo it shows. The browser never signs. A migration
  derives the path from each stored URL; the buckets are flipped to private as the LAST
  step of Stage 5, after every reader is on signed URLs, and flipping back is the rollback.
  Canvas drawing keeps `crossOrigin="anonymous"`; storage sends CORS headers on signed GETs.
- Verify: QR unchanged. Lookup flips to **code-first before `canonicalNumber`** (review:
  today the global numbering cache runs first): code → project → that project's numbering,
  cached per project → the ticket in that project must carry the code. `holding_of` scopes
  by `r.project_id` from the receipt row, never the header (verify sends none). `?about=1`
  takes `p=<org-slug>/<project-slug>`, resolved through `projects` and `organisations`
  selecting only `org_id, slug, name` (never `organiser_email`); `tests/verify.test.mjs`'s
  table and rpc allowlists (`:329-343`) are extended by exactly those two tables.

### Who is who

| Today | Tomorrow |
|---|---|
| `SUPER_ADMIN_EMAIL` secret | **system admin**: creates organisations, appoints and replaces the one organiser, suspends an organisation, adds other system admins (`platform_admins`). Inside a project it is break-glass only: every such use audited with `platform_override: true`, never listed |
| `app_users.role = 'superadmin'` (assignable) | the organisation's **organiser** (`organisations.organiser_email`); exactly one; only a system admin changes it |
| four project roles | `project_members.role`, unchanged, per project; added by the organiser or a project admin (`LOCKED_FOR_ADMIN` as today, minus organiser changes) |
| `permissions` | per project, set by the organiser; cannot widen past the organisation's features |
| new control-plane actions | `create_organisation`, `set_organiser`, `set_org_status`, `set_org_features`, `add_platform_admin` (system admin only); `create_project`, `clone_project`, `archive_project`, `unarchive_project`, `purge_personal`, `list_projects`, `set_org_defaults` (organiser) |

`isActionAllowed` gains the entitlement check at the top: the organisation's enabled
features are read with the same 60-second cache as permissions (`orgFeaturesCache.get
(orgId)`), and `buildPermissions` marks each action `entitled: boolean` so the Access
screen can lock the row. `list_permissions` stays organiser-only.

The 11 `sup: true` actions move from "the secret" to "the organiser of this project's
organisation". `gate.ts` `resolveUser` keeps its shape; its row comes from
`resolve_member(p_project, p_email)` returning `{role, status, agent_id, is_organiser,
is_platform_admin}` so the function and the database share one rule. Approvals: the row
stores `project_id` at request time; `decide_approval` asserts it equals the header before
`decideWith` re-executes, and `decide_by_agent` is compared against the decider's
per-project `agent_id`.

Membership across organisations: nothing in the model forbids one Google account holding
memberships in several projects or organisations (the organiser's helpers work on this
year's and next year's raffle). The picker appears only when there is more than one.
Restricting an account to one organisation would be one unique index and is not planned.

### A project's life

```
draft → active → closing → archived —(organiser, audited)→ active
                              └—(purge_personal_after elapsed)→ purged_at
project delete: by the organiser, soft, undone inside the retention period (D-006, D-013)
organisation: active → deactivated (organiser, soft; data kept for the retention period;
              members told "deactivated"; organiser offered reactivation at next sign-in)
              → deleted for good (system admin only, or the weekly job when the period ends)
```

- Create (`create_project`): row; `seed_project_config(p_project)` (body of
  `migrations/20260917180000_config_defaults.sql` as a function); creator as project admin;
  optional `clone_from` (config except numbering/counts, artwork rows, sellers, prize
  types, permission overrides, supporter bands, brand). `config_numbering_locked` tests
  `exists(select 1 from tickets where project_id = new.project_id)` (review: unscoped, it
  would lock every new project's numbering forever). `adoptLoneArtwork` counts within the
  project. "Make more tickets" then runs unchanged.
- Archive (`archive_project`, organiser, two-person): gate refuses every `write|bulk`
  action with `PROJECT_ARCHIVED`; a `before insert or update or delete` trigger on every
  partitioned table refuses unless `app.maintenance = 'on'`, set `local` only by
  `purge_personal` and `app_reset`.
- Purge (`purge_personal`, organiser, two-person, or by the weekly workflow once
  `purge_personal_after` elapses): blanks buyer name/phone/zone/notes on `tickets`, the
  `from_*`/`to_*` buyer and phone columns on `ticket_history`, frozen name/phone on
  `winners`, `ticket_receipts` identity, `agents.phone`, personal keys in
  `audit_log.details`. Runs under `app.maintenance` inside one transaction. A test asserts
  every column named `*phone*`, `*buyer*`, `*name*` on a partitioned table is on the purge
  list or a written exemption list.
- Empty (`app_reset`): per project, as above.
- Deactivate and delete (owner's ruling D-006): an organiser deletes a project or
  deactivates the whole organisation; both are soft (`deleted_at`/`deactivated_at`
  columns), both are refused by the gate like an archive, and both come back if
  undone inside the 90-day retention period (D-013). Sign-in to a deactivated
  organisation shows "deactivated" to members and offers reactivation to the
  organiser. Deleting an organisation for good is the system admin's alone.

### Client

`whoami` returns memberships `[{org, project, role, status}]`; one selects itself, several
show a picker; choice in `localStorage` `kcho_project`; switching saves and reloads, which
rebuilds the supabase-js client (its headers are fixed at `createClient`,
`supabaseAuth.js:65`). Both clients send `x-project-id`. A client that receives a `whoami`
without memberships (older function) behaves exactly as today. IndexedDB keys prefixed
`<project_id>:`; channel `project:<id>`. Organiser screens (projects: list, create, clone,
archive; members) and the system-admin screen (organisations: create, appoint organiser,
suspend) go through the design director skill and carry Burmese lines like every screen.

Function caches: `configCache.get(projectId)`, `permsCache.get(projectId)`,
`userCache.get(projectId + ':' + email)`, keyed from **Stage 2** (review: `readConfig` is
last-key-wins the instant a second config row exists); LRU of 2,000.

Scale: indexes lead with `project_id`; keyset paging stays a PK range scan; hash-partition
`ticket_history`/`audit_log` past ~1M rows (not now); a large organisation can move to its
own Supabase project (mode A) by dump/restore of its rows.

## The isolation guarantee as tests

| Id | Layer | Test |
|---|---|---|
| T1 | structure | projects A and B both hold `Book-001`/`KS-00001`; inserts into `winners`, `payments`, `ticket_receipt_items`, `ticket_codes` naming A's number with B's project are refused by the composite FK (`test-functions.sh`) |
| T2 | read | member of A only, header B: every view empty; header A: same rows as before the migration; member of both: exactly the header's project; **no header before Stage 4: the seed project, identical to today** (`test-rls.sh` two-project fixture, which sets `request.headers` as well as `request.jwt.claims`) |
| T3 | write, handler | `tests/scopedclient` source scan; `tests/twoprojects.test.mjs`: every registered action against fakedb seeded with A and B identical, B byte-equal afterwards (the `everyaction` harness run twice) |
| T4 | write, SQL | `tests/sqlscope` source scan; `test-functions.sh` calls all 16 functions on A (with `p_project`, with and without the header) while B is present and diffs B; a mismatched header and `p_project` raises |
| T5 | realtime | member of A subscribed to `project:B` hears nothing; to `project:A` is nudged |
| T6 | verify | a code minted in B scanned under A's numbering resolves to B's ticket; a receipt for the same phone+name in A and B resolves to its own project; a code from an archived or purged project still verifies |
| T7 | archive | every write action refused with `PROJECT_ARCHIVED`; direct SQL write refused by trigger; `purge_personal` succeeds; a browser role cannot set `app.maintenance` |
| T8 | powers | the 11 owner actions refused to a project admin who is not the organiser; the platform secret's use writes `platform_override`; a decide for a request in another project is refused |
| T10 | features | with `money` off for organisation B: every `money` action is refused `FEATURE_NOT_ENABLED` for B's organiser and members, a `permissions` row cannot switch it on, the Access screen renders it locked; organisation A is unaffected; the seed organisation has every feature; `tests/features.test.mjs` proves every registered action names a listed feature (`gate.test`, `everyaction`, `permissionui`) |
| T9 | migration | before/after diff of the five reports on a restored backup is empty at every stage; recorded in `supabase/DEPLOY-PENDING.md` |

## Migration, staged

Sizes are engineering days for one person who knows the repo (planning figures). Order
within every stage: migration, function deploy, client push.

| Stage | Ships | Must not change | Proof | Rollback | Days |
|---|---|---|---|---|---|
| 0 control plane | `platform_admins`, `organisations`, `org_features`, `org_defaults`, `projects`, `project_members`; `seed_project()`, `current_project()`; seed rows with every feature on; `resetplan.ts` `tenancy` feature | any existing object | gate; `resetplan.test` | drop six tables, two functions | 3 |
| 1 the column | `project_id` on 23 tables, default `coalesce(current_project(), seed_project())`, NOT NULL; every index recreated with `project_id` leading; **composite unique indexes added beside the old keys**; `schema.sql` updated | keys, policies, views, handlers; T9 empty | `migrationsql.test`; T9 | `supabase/rollback-project-column.sql` (not in `migrations.pending/`; re-apply `rls.sql` after) | 3–4 |
| 2 the function learns the project | `route()` resolves the project first and refuses without a stamped client; caches per project; `scoped.ts` wrapper on every handler, `tests/scopedclient`; `onConflict` strings composite; fakedb default stamp + project-aware stubs; every policy and view gains the coalesced predicate; every config scalar in views and `select into` in SQL functions scoped; all 16 SQL functions take `p_project` and filter (inert with one project); `config_numbering_locked` and `adoptLoneArtwork` scoped; `rls.sql`/`functions.sql` updated | what any role can see; T9 empty; header-less clients | `test-rls.sh` (header absent → seed → identical), T2 first form, `everyaction`, `twoprojects` (A and B in fakedb only) | re-apply previous `rls.sql`/`functions.sql`; redeploy previous function | 8–10 |
| 3 membership and features | `app_users` → `project_members` (seed); the one `superadmin` row becomes the seed organiser and the migration refuses unless there is exactly one (D-001); `superadmin` rows become admins of the seed project (D-002); `member_role`, `resolve_member`; `app_role()` re-pointed (coalesced); `resolveUser` fed by `resolve_member`; `people.ts` writes new tables; `app_users` becomes a view; `_shared/features.ts`, `feature:` on every registry entry, entitlement check first in `isActionAllowed`, `entitled` in `buildPermissions`; the 13 suites that build `userClaims`/`resolveUser` fixtures updated | who may do what (seed organisation has every feature); nudges still heard | `gate`, `roles`, `userstatus`, `nudge`, `features`, T8, T10 | re-point `app_role()`; the view keeps old readers alive | 7–9 |
| 4 the keys (quiet window, announced a week ahead) | drop old PKs/uniques; composite PK/FK swap in one transaction; strict default and strict predicates; `app_role()` strict; realtime topic + policy per project; `pending_approvals.project_id` asserted; `ensure_holding_tx`/`one_per_buyer` per project; `holding_of` by `r.project_id`; `app_reset` rewritten under `app.maintenance`; runbooks/backfills gain `set app.project_id`; `resetplan.test` FK regex handles composite; `tests/sqlscope`, T1/T4 live. Function deployed in the same window. **A second project can exist after this.** | T9 empty; old clients now refused `PROJECT_REQUIRED` | T1, T4, T5, T9; rehearsed twice on restored backups | restore the backup | 7–10 |
| 5 the second project | control-plane actions (system admin and organiser); storage paths + signed URLs, buckets flipped private last; verify code-first with per-project cache and `?about` by slug; `clone_project`; second-project walk-through live | any answer for the seed project | T3, T6, `verify`, every artwork and logo still renders after the flip | revert the function deploy; flip buckets back to public | 6–8 |
| 6 client | memberships in `whoami`, picker, headers, cache prefix, channel; organiser screens (projects, members, organisation defaults); system-admin screen (organisations, organiser, status, feature switches); Access screen locks unentitled features; tabs and buttons of an unentitled feature hidden the way unpermitted ones already are; tolerant of an older function | the one-project experience (one membership selects itself; nothing new shown) | `screencalls`, `emits`, `modalwiring`, `i18n`, `permissionui`, `nudgeclient`, UI review per screen | Pages deploy of previous build | 10–14 |
| 7 archive, purge, ops | archive trigger + gate refusal; `purge_personal`; `backup.sh --project`; SETUP.md/README organisation model; DEPLOY-PENDING order; SELF-HOST as "one organisation" | nothing existing enters archived | T7, `docs`, `backup` | disable trigger; purge never rolled back (two-person, rehearsed) | 5–7 |
| 8 defence in depth (optional) | non-bypass role + `force row level security`; `(select app_role())`; hash partitioning | nothing visible | T2–T4 with the service role removed | keep service role | 3–5 + spike |

Total 0–7: roughly **48–65 days** for one person; less on the calendar with two peers split
at stage boundaries (0–1 and 3 are database-led; 5's storage work and 6's screens are
independent once 4 has landed, but 6 cannot merge before 5's function is deployed because
Pages ships the client on push).

## Where every change lands

| Area | Files |
|---|---|
| Migrations | `supabase/migrations/…_{control_plane, project_column, project_scoping, memberships, composite_keys, archive_guard, purge_personal}.sql`; `schema.sql`, `functions.sql`, `rls.sql` updated in the same commits |
| Function | `api/index.ts` (route order, caches, `feature:` on every registry entry, `adoptLoneArtwork`), new `api/scoped.ts`, new `api/orgs.ts`, new `_shared/features.ts`, `api/gate.ts` (entitlement first), `api/people.ts`, `api/approvals.ts`, `api/reset.ts`, `api/seed.ts`, `api/printing.ts`, `api/branding.ts`, `api/templates.ts`, `api/config.ts`, `_shared/resetplan.ts`, `functions/verify/index.ts` |
| Client | `src/lib/supabaseAuth.js`, `src/lib/supabaseApi.js`, `src/lib/cache.js`, `src/lib/nudge.js`, `src/lib/store.js`, `src/App.vue`, new `src/components/Organisation.vue`, `src/components/Platform.vue`, `modals/ProjectForm.vue`, `modals/OrgMemberForm.vue`, `src/lib/i18n.js` |
| Tests | new `scopedclient`, `sqlscope`, `twoprojects`, `features`, `archive`, `purge`; extended `fakedb.mjs`, `resetplan`, `migrationsql`, `gate`, `everyaction` and the 13 fixture suites, `directreads`, `verify`, `nudge`, `nudgeclient`, `docs`; `test-rls.sh`, `test-functions.sh` two-project fixtures with `request.headers`; `tests/run.sh` registrations (`everytestruns` requires them) |
| Docs | `SETUP.md`, `README.md`, `supabase/RESET-RUNBOOK.md` (`set app.project_id`), `supabase/DEPLOY-PENDING.md`, `supabase/SELF-HOST.md`, `MULTI-TENANCY-PLAN.md` (this plan) |

## Rulings from the owner, 2026-09-24

The twelve follow-up decisions (D-001 to D-012) were answered the same day and
are recorded, with what each changes, in `MULTI-TENANCY-DECISIONS.md` under
"Decided". The ones that change this plan are folded in above: D-001 and D-002
in Stage 3, D-006 in "A project's life".

- **R1 decided: organisers hold the 11 owner powers.** The `SUPER_ADMIN_EMAIL` secret is
  the system admin for organisations and break-glass inside projects, audited with
  `platform_override: true`, never listed.
- **R2 decided: sellers are per project**, with "copy sellers from…" at project creation.
- **R3 decided: archive is read-only and reversible by the organiser with audit; organisers
  may set a per-project purge period for personal data; never purged by default.**
- **R4 decided: advanced management.** Organisers are added only by system admins; one
  organiser per organisation; organisers add sellers, sellers who sign in, helpers and
  viewers. Modelled as `organisations.organiser_email` plus `platform_admins`.
- **R4b decided (owner, mid-review): access is layered by organisation and by organiser.**
  The system admin sets which features each organisation has (`org_features`); the
  organiser sets who inside it may use them (`permissions`, per project) and the
  organisation's defaults (`org_defaults`). Each layer only narrows the one outside it.
- **R5 decided: Stages 0–3 go in as each is green, rehearsed on a restored backup; Stage 4
  waits for a quiet window the owner agrees, announced a week ahead.**
- **R6 decided: buckets become private; artwork and logos are served through signed URLs**
  minted by the functions.
- **R7 decided: after Stage 4 a headerless request is refused** with `PROJECT_REQUIRED` and
  a reload sentence, announced in the app a week ahead.
- Follow-up noted from a peer (not in scope): `Admin.vue` carries two near-identical
  "this raffle's server has not been updated yet" blocks (around :1657 and :1779); once
  reset and seed are per project, they should become one shared component.

## Risks, and what is out

- Stage 4 is the risk: a composite key swap over 23 tables and 18 FKs, one transaction,
  live database. Rehearsed twice; property suites in the same commit; T9 empty; rollback
  timed during rehearsal; function deployed in the same window.
- A missed SQL filter is silent after Stage 4; explicit `p_project`, `tests/sqlscope` and
  T4 exist for that, and the composite FK refuses the write that would follow.
- The service role bypasses RLS: write-path isolation is wrapper + explicit project + tests
  until Stage 8. Stated, not hidden.
- Personal data lives in append-only tables; the purge and the per-project reset run under
  a transaction-local setting the trigger functions honour, replacing table DDL.
- Platform behaviour is verified, not assumed; Stages 0–7 depend on nothing the deployment
  does not already use (`gen_random_uuid()` is core; signed URLs are the storage API the
  functions already call).

Out: billing/plans; a public directory of organisations; cross-organisation reporting;
moving an organisation between cells; schema-per-tenant unless the spike is green; the
review's finalization ledger (can sit on top of archive later).

## Verification (end to end, at execution time)

1. Per stage: failing test first; `./tests/run.sh` green in a frozen archive of the sha
   (memory: green in the worktree is not green); `supabase/test-rls.sh` and
   `supabase/test-functions.sh` green on Docker Postgres with the two-project fixture.
2. Per migration: restore the latest encrypted backup into a scratch project; `db push`;
   run the T9 diff script; record the result in `supabase/DEPLOY-PENDING.md`.
3. After Stage 5: a second project seeded with `seed_apply`, identical numbering to the
   seed project; walk issue → sell → settle → payment → winner in project B and assert
   project A's five reports are unchanged (the live version of T3/T4); scan a B ticket's
   QR and a receipt link on the verify page.
4. After Stage 6: browser check (browser-automation skill) that one membership shows no
   picker, two memberships show one, switching reloads with the other project's data, and
   the IndexedDB store holds keys for both prefixes with personal columns blank.
5. After Stage 7: archive project B, confirm every write button's refusal sentence, run the
   purge on a restored copy, and diff the personal columns.
