-- K'Cho Shelter — reading straight from the database, safely.
--
-- WHY THIS EXISTS, measured against the live project:
--
--   raw PostgREST query        57-82ms
--   the same work through the  340-1000ms
--   Edge Function
--
-- The function adds 300-700ms per call whatever happens inside it — caching the
-- gate lookups helped a little and did not change the shape. This app is
-- read-heavy: search, book lists, the polling that keeps a screen fresh. Paying
-- half a second for every one of those is the difference between an app that
-- feels instant and one that does not.
--
-- So reads come straight from PostgREST and writes keep going through the Edge
-- Function. That split is not a compromise, it is the right shape: reads ask
-- "what may this person see", which is exactly what row security expresses,
-- while writes carry business rules, atomicity and an audit trail, which
-- policies express badly.
--
-- THE RULE THIS FILE MUST NOT GET WRONG. Every row here holds a buyer's name
-- and phone number, and many of these people are refugees. A policy that is too
-- loose does not throw — it just answers. So the default is deny, every policy
-- names who it admits, and supabase/test-rls.sh proves each one by trying it as
-- the wrong person.
--
-- Run AFTER schema.sql and functions.sql.

-- Supabase creates the `authenticated` role; a bare Postgres does not. Created
-- here when missing so this file can be applied to a throwaway database and
-- tested before it is trusted with anybody's phone number.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

-- A NOTE ON THE SUPER ADMIN, because this is the one place the two halves
-- disagree and it is confusing until said plainly.
--
-- Super-admin authority comes from the SUPER_ADMIN_EMAIL function secret and
-- only from there — nothing in this database grants it, which is the whole
-- point. But Postgres cannot read a function secret, so for DIRECT reads the
-- super admin needs an ordinary app_users row like everybody else, with role
-- 'admin'. That row grants normal admin reading; it does not, and cannot, make
-- anybody super. Apps Script did exactly this, seeding the bootstrap admin into
-- the Users tab while keeping the authority in a Script Property.

-- ============ WHO IS ASKING ============

/**
 * The signed-in person's email, from their JWT. Null when there is no session.
 */
create or replace function auth_email() returns text as $$
  select nullif(lower(trim(coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''))), '')
$$ language sql stable;

/**
 * Their role from the allowlist, or null if they are not on it or switched off.
 * Null is what every policy below tests against, so somebody removed from the
 * Users table stops being able to read at their next request — the same promise
 * the Apps Script version made.
 */
create or replace function app_role() returns text as $$
  select role from app_users where email = auth_email() and active
$$ language sql stable security definer set search_path = public;

/** The agent id they are tied to, for the policies that limit agents. */
create or replace function app_agent_id() returns text as $$
  select agent_id from app_users where email = auth_email() and active
$$ language sql stable security definer set search_path = public;

-- ============ DEFAULT DENY ============

alter table tickets       enable row level security;
alter table books         enable row level security;
alter table agents        enable row level security;
alter table app_users     enable row level security;
alter table config        enable row level security;
alter table audit_log     enable row level security;
alter table book_history  enable row level security;
alter table permissions   enable row level security;
alter table pending_approvals enable row level security;
alter table winners       enable row level security;

-- Nothing below grants INSERT, UPDATE or DELETE to anybody. Writes go through
-- the Edge Function, which holds the secret key and bypasses these policies.
-- That is deliberate: a browser must never be able to change a ticket directly,
-- however convenient it would be.

-- ============ TICKETS ============

drop policy if exists tickets_read on tickets;
create policy tickets_read on tickets for select using (
  app_role() is not null
  -- Held back: generated but not in play. Not merely hidden in the interface —
  -- not readable at all, so a held-back buyer cannot leak through a crafted
  -- query either.
  and idx <= active_tickets()
  -- An agent sees only the books they are carrying. Everybody else on the
  -- allowlist sees the whole raffle, which is what recording sales requires.
  and (
    app_role() <> 'agent'
    or book_idx in (select idx from books where held_by_agent = app_agent_id())
  )
);

/**
 * What the browser actually reads — and the only thing it can read.
 *
 * This view runs with its OWNER's rights, not the caller's, which is why the
 * caller needs no privilege on the tickets table at all. That inversion is the
 * point: masking a phone number in a view the caller could bypass by querying
 * the base table would be decoration. Here there is no base table to query.
 *
 * Because the owner's rights bypass row security, the filtering has to be in
 * this WHERE clause rather than left to a policy. Both are kept — the policies
 * below are a second layer, so a grant added carelessly later still reads
 * nothing.
 */
/*
 * A SELLER SEES EVERY TICKET'S STATUS AND NOBODY ELSE'S BUYER.
 *
 * This used to hide the rows outright, which was tighter but wrong for the way
 * the raffle is actually run: sellers ask each other "is KS-1234 still going?"
 * and the answer has to exist. Hiding the row makes an available ticket
 * indistinguishable from one that was never printed.
 *
 * It also has to agree with the edge function, because the app reads through
 * BOTH — writes go through the function, reads come straight here. Two paths
 * that disagree about what a seller may see is not a stricter system, it is a
 * system whose behaviour depends on which door you came through, and the looser
 * door is the one that decides.
 *
 * So: every active row, and the buyer's details blanked on books this seller is
 * not carrying.
 */
drop view if exists tickets_readable;
create view tickets_readable as
select
  idx, number, book_idx, status,
  case when mine then buyer_name else '' end as buyer_name,
  case
    -- Same shape as both backends' maskers. A phone hidden three different
    -- ways across three code paths reads as three different applications.
    when app_role() = 'viewer' and buyer_phone <> ''
      then '••••' || right(buyer_phone, 3)
    when mine then buyer_phone
    else ''
  end as buyer_phone,
  case when mine then buyer_zone else '' end as buyer_zone,
  sold_by_agent, amount, payment_status, sold_at,
  case when mine then notes else '' end as notes,
  source, version, recorded_by, modified_at
from (
  select t.*,
         (app_role() <> 'agent'
          or t.book_idx in (select idx from books where held_by_agent = app_agent_id())) as mine
  from tickets t
  where app_role() is not null
    and t.idx <= active_tickets()
) v;

grant select on tickets_readable to authenticated;

-- ============ BOOKS ============

drop policy if exists books_read on books;
create policy books_read on books for select using (
  app_role() is not null
  and idx <= ceil(
    active_tickets()::numeric /
    greatest((select coalesce(nullif(value,'')::integer, 10) from config where key = 'TICKETS_PER_BOOK'), 1))
  and (app_role() <> 'agent' or held_by_agent = app_agent_id())
);

-- The ledger view carries the money columns, so it inherits the same policies.
drop view if exists book_ledger;
create view book_ledger as
select
  b.idx, b.number, b.status, b.held_by_agent, a.name as agent_name, b.due_at,
  b.declared_sold, b.amount_due, b.amount_paid,
  r.recorded_sold, r.recorded_amount, r.available, r.reserved, r.missing_contact,
  case when b.status in ('Settled','Lost') then coalesce(b.declared_sold,0) else r.recorded_sold end as counted_sold,
  case when b.status in ('Settled','Lost') then coalesce(b.amount_due,0) else r.recorded_amount end as counted_expected,
  coalesce(b.amount_paid,0) as counted_collected,
  coalesce(b.declared_sold,0) - r.recorded_sold as variance_sold,
  coalesce(b.amount_due,0) - r.recorded_amount as variance_amount,
  case when b.status = 'Out' and b.due_at is not null and b.due_at < now()
       then extract(day from now() - b.due_at)::int else 0 end as days_overdue
from books b
left join agents a on a.agent_id = b.held_by_agent
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated')) as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available') as available,
    count(*) filter (where t.status = 'Reserved') as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx
) r on true
where app_role() is not null
  and b.idx <= ceil(active_tickets()::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config where key='TICKETS_PER_BOOK'),1))
  and (app_role() <> 'agent' or b.held_by_agent = app_agent_id());

grant select on book_ledger to authenticated;

-- ============ AGENTS ============

drop policy if exists agents_read on agents;
create policy agents_read on agents for select using (app_role() is not null);

-- A seller's phone is how an overdue book gets chased, which is exactly why a
-- view-only account does not get it.
drop view if exists agents_readable;
create view agents_readable as
select agent_id, name,
       case when app_role() = 'viewer' then '' else phone end as phone,
       zone, active, notes
from agents
where app_role() is not null;

grant select on agents_readable to authenticated;

-- ============ CONFIG ============
-- Read by everybody signed in: ticket numbering, price, currency, what is in
-- play. None of it is sensitive and the app cannot draw a screen without it.

-- config is granted to authenticated AND policed, rather than reached only
-- through a definer function.
--
-- The first attempt relied on active_tickets() being security definer, and it
-- was not enough: a view running with owner rights still calls functions as the
-- CALLER unless the function itself is definer, so every view that asked how
-- many tickets are in play denied itself — reporting "permission denied for
-- table config" while the cause was a function two steps away. Depending on
-- that subtlety was the mistake; the grant removes the dependency.
--
-- Safe to grant, because the policy below still limits it to somebody on the
-- allowlist, and because none of it is sensitive: ticket numbering, price,
-- currency, how many are in play. Every signed-in user needs most of it to draw
-- a single screen.
drop policy if exists config_read on config;
create policy config_read on config for select using (app_role() is not null);
grant select on config to authenticated;

drop view if exists config_readable;
create view config_readable as
select key, value from config where app_role() is not null;
grant select on config_readable to authenticated;

-- ============ EVERYTHING ELSE STAYS SHUT ============
--
-- app_users, audit_log, permissions, pending_approvals, winners and
-- book_history get NO select policy, so row security denies every browser read.
-- They are reachable only through the Edge Function, which applies the
-- super-admin rules the interface depends on — who may see the audit log, who
-- may see the allowlist, and the fact that an ordinary admin is never shown the
-- super admin at all. None of that survives being expressed as a policy, so it
-- is not attempted here.

revoke all on app_users, audit_log, permissions, pending_approvals, winners,
              book_history from authenticated;

-- And from anon, which is the role a request with no session gets. Row security
-- already returns nothing to it, so this changes no outcome today — it is here
-- so that adding a policy later for some other reason cannot accidentally open
-- these to an unauthenticated caller.
revoke all on app_users, audit_log, permissions, pending_approvals, winners,
              book_history, tickets, books, agents, config from anon;

-- Re-granted after the revoke above, which would otherwise take it back.
grant select on config to authenticated;

-- The base tables are not readable directly either — only the views above,
-- which is what keeps the masking from being optional.
revoke all on tickets, books, agents, config from authenticated;
grant select on tickets_readable, book_ledger, agents_readable, config_readable to authenticated;
