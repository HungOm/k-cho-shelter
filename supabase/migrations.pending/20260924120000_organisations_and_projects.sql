-- MULTI-TENANCY-PLAN.md, Stage 0: the control plane.
--
-- PENDING. This file lives in supabase/migrations.pending/ and is applied
-- nowhere until the owner says "apply Stage 0" (MULTI-TENANCY-DECISIONS.md
-- D-003). Moving it into supabase/migrations/ is the act of approving it.
--
-- WHAT IT DOES: creates six tables and three functions that nothing reads yet,
-- and seeds one organisation with today's raffle as its project. No existing
-- table, view, policy or function is touched. Safe to run twice.
--
-- The block below is copied verbatim from supabase/schema.sql, and
-- tests/tenancy.test.mjs fails if the two ever differ.
-- ============ ORGANISATIONS AND PROJECTS (MULTI-TENANCY-PLAN.md, Stage 0) ============
--
-- THE CONTROL PLANE, AND NOTHING READS IT YET. Six tables and three functions,
-- added so that every later stage has somewhere to hang: an organisation owns
-- projects, a project is one raffle, and today's raffle becomes the seed
-- project with a NAMED id, so it reads in every audit line as the raffle that
-- predates projects.
--
-- NO EXISTING TABLE, VIEW, POLICY OR HANDLER CHANGES HERE. That is the whole
-- promise of Stage 0: the live raffle cannot tell these exist. Stage 1 adds the
-- project_id column; Stage 3 starts reading membership from here.
--
-- DEFAULT DENY, like everything else in this file. None of these is readable
-- from a browser; the api function reads them with the service key, and later
-- stages expose what they need through functions, not grants.

-- Who may run the platform: create organisations, appoint an organiser.
-- The SUPER_ADMIN_EMAIL secret is always one of them and is not a row.
create table if not exists platform_admins (
  email        text primary key check (email = lower(btrim(email)) and email <> ''),
  added_by     text not null default '',
  added_at     timestamptz not null default now()
);

create table if not exists organisations (
  org_id       uuid primary key default gen_random_uuid(),
  slug         text not null unique
                 check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name         text not null,
  /*
   * EXACTLY ONE ORGANISER, AS A COLUMN, so "one" is a fact of the table rather
   * than a count somebody has to keep. Changed only by a system admin.
   *
   * '' IS "NOBODY YET", and it grants nothing: auth_email() is never '', so no
   * comparison against it can match. A migration cannot read the function
   * secret, so the seed organisation starts this way (MULTI-TENANCY-DECISIONS.md
   * D-001).
   */
  organiser_email text not null default ''
                 check (organiser_email = lower(btrim(organiser_email))),
  status       text not null default 'active' check (status in ('active','suspended')),
  created_at   timestamptz not null default now(),
  created_by   text not null default ''
);

-- The outer wall: which features an organisation may use at all. The list of
-- feature ids is supabase/functions/_shared/features.ts. A missing row is OFF.
create table if not exists org_features (
  org_id       uuid not null references organisations(org_id) on delete restrict,
  feature      text not null,
  enabled      boolean not null,
  set_by       text not null default '',
  set_at       timestamptz not null default now(),
  primary key (org_id, feature)
);

-- What a new project of the organisation starts from, keyed like config.
create table if not exists org_defaults (
  org_id       uuid not null references organisations(org_id) on delete restrict,
  key          text not null,
  value        text not null default '',
  primary key (org_id, key)
);

create table if not exists projects (
  project_id   uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(org_id) on delete restrict,
  slug         text not null,
  name         text not null,
  status       text not null default 'active'
                 check (status in ('draft','active','closing','archived')),
  created_at   timestamptz not null default now(),
  created_by   text not null default '',
  archived_at  timestamptz,
  archived_by  text,
  -- Null is "never", and never is the default: nothing is purged unless an
  -- organiser has written down a period.
  purge_personal_after interval,
  purged_at    timestamptz,
  unique (org_id, slug)
);

-- app_users, per project. Same lifecycle and the same generated `active`.
-- Stage 4 adds the foreign key from (project_id, agent_id) to agents.
create table if not exists project_members (
  project_id   uuid not null references projects(project_id) on delete restrict,
  email        text not null check (email = lower(btrim(email)) and email <> ''),
  name         text not null default '',
  role         text not null check (role in ('admin','recorder','agent','viewer')),
  status       text not null default 'active'
                 check (status in ('pending','active','suspended','banned')),
  active       boolean generated always as (status = 'active') stored,
  agent_id     text,
  added_by     text not null default '',
  added_at     timestamptz not null default now(),
  primary key (project_id, email)
);

alter table platform_admins enable row level security;
alter table organisations   enable row level security;
alter table org_features    enable row level security;
alter table org_defaults    enable row level security;
alter table projects        enable row level security;
alter table project_members enable row level security;
revoke all on platform_admins, organisations, org_features, org_defaults,
              projects, project_members from anon, authenticated;

/*
 * THE RAFFLE THAT PREDATES PROJECTS, by a name rather than a lookup. Every row
 * that exists before Stage 1 belongs to it, and a constant is something a
 * reader of an audit line can recognise.
 */
create or replace function seed_project() returns uuid as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$ language sql immutable;

/*
 * WHICH PROJECT THIS REQUEST IS ABOUT, read the way request_id() reads its id:
 * from the header PostgREST exposes, or from a session setting a runbook sets.
 *
 * NULL WHEN NEITHER IS PRESENT. What to do about that is each caller's
 * decision, and through Stage 3 every caller says coalesce(…, seed_project()).
 * A malformed value is not null: the cast fails and the statement with it,
 * which is a refusal rather than a guess.
 */
create or replace function current_project() returns uuid as $$
  select coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-project-id', ''),
    nullif(current_setting('app.project_id', true), ''))::uuid
$$ language sql stable set search_path = public;

/*
 * THE SEED ORGANISATION AND PROJECT, made once and safe to call again.
 *
 * Called by the Stage 0 migration with no organiser and by supabase/reset.sql
 * with the super admin's address. A second call never makes a second
 * organisation; it only fills an organiser that is still blank, and it never
 * replaces one that is set — that is a system admin's act, not a side effect.
 *
 * EVERY FEATURE IS ON for this organisation, because it is the raffle that
 * already uses all of them. `core` is not listed: it is always on and a row
 * for it would be a switch that does nothing.
 */
create or replace function seed_tenancy(p_organiser text default '') returns uuid as $$
declare
  v_org   uuid;
  v_name  text;
  v_event text;
  v_slug  text;
  v_email text := lower(btrim(coalesce(p_organiser, '')));
begin
  select org_id into v_org from projects where project_id = seed_project();

  if v_org is null then
    select nullif(btrim(value), '') into v_name  from config where key = 'ORG_NAME';
    select nullif(btrim(value), '') into v_event from config where key = 'EVENT_NAME';
    v_name := coalesce(v_name, 'Organisation');
    v_slug := btrim(left(btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-');
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then v_slug := 'default'; end if;

    insert into organisations (slug, name, organiser_email, created_by)
      values (v_slug, v_name, v_email, 'seed_tenancy')
      returning org_id into v_org;
    insert into projects (project_id, org_id, slug, name, created_by)
      values (seed_project(), v_org, 'raffle', coalesce(v_event, v_name), 'seed_tenancy');
  elsif v_email <> '' then
    update organisations set organiser_email = v_email
     where org_id = v_org and organiser_email = '';
  end if;

  insert into org_features (org_id, feature, enabled, set_by)
    select v_org, f, true, 'seed_tenancy'
      from unnest(array['tickets','books','money','checkins','approvals','prizes',
                        'reports','printing','cards','studio','seed','reset']) f
  on conflict (org_id, feature) do nothing;

  return seed_project();
end $$ language plpgsql security definer set search_path = public;

revoke all on function seed_tenancy(text) from public, anon, authenticated;
-- ============ ORGANISATIONS AND PROJECTS (end) ============

-- The seed organisation and the raffle as its first project. No organiser yet:
-- a migration cannot read SUPER_ADMIN_EMAIL (D-001).
select seed_tenancy('');
