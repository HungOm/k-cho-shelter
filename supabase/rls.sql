-- Raffled — reading straight from the database, safely.
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
/*
 * Their tier from the allowlist, or null if they are not on it or switched off.
 *
 * 'superadmin' is an ASSIGNMENT and resolves to 'admin' HERE, so every policy
 * below keeps comparing against the same four tiers it always did. A policy
 * that had to learn about a fifth value is a policy somebody can forget to
 * update — and the one they forget will be the one that decides whether a
 * phone number is masked.
 */
create or replace function app_role() returns text as $$
  select case when role = 'superadmin' then 'admin' else role end
  from app_users where email = auth_email() and active
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
alter table check_in_reports enable row level security;
alter table payments      enable row level security;
alter table ticket_history enable row level security;
alter table round_snapshots enable row level security;
alter table check_in_dates enable row level security;
alter table winners       enable row level security;
alter table prizes        enable row level security;
alter table prize_types   enable row level security;

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
/*
 * security_invoker = false is DECLARED, not inherited, and it is deliberate.
 *
 * Supabase's linter reports this view as SECURITY DEFINER. It is right, and the
 * finding must not be actioned. RLS filters ROWS; it cannot mask COLUMNS, and
 * everything below is column-level — the buyer's name, area and notes blanked
 * on books this seller is not carrying, the telephone number reduced to its
 * last three digits for a viewer. No policy can express any of that.
 *
 * Converting it to an invoker view means granting select on tickets, and
 * tickets_read masks nothing: it restricts an AGENT to their own books and lets
 * every recorder and viewer read every row. A viewer would then read real
 * telephone numbers for the whole raffle straight off the base table. That is
 * the hole 0974416 closed, and most of those numbers belong to refugees.
 *
 * So it is written down rather than left to the default, so that the next
 * person to meet the lint finds a decision instead of an accident, and so that
 * a change to the Postgres default cannot convert it silently. config_readable
 * below is the contrasting case: it masks nothing, so it IS an invoker view.
 */
drop view if exists tickets_readable;
create view tickets_readable with (security_invoker = false) as
select
  idx, number, book_idx,
  -- The book's NUMBER, not just its index. The app keys everything by book
  -- number — the grid, search, "where is this ticket" — and deriving it in the
  -- client would mean reimplementing the numbering here and there, with
  -- TICKETS_PER_BOOK able to change under both. A book number computed two ways
  -- is the same class of bug as a phone number masked two ways.
  book_number,
  status,
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
         b.number as book_number,
         /*
          * WHOSE BUYER DETAILS THIS PERSON MAY READ.
          *
          * Everyone sees every ticket's NUMBER and STATUS — "is 03291 still
          * going?" must have an answer for anybody, or the raffle cannot be
          * worked. What `mine` gates is the buyer: their name, telephone
          * number, area and the note about them. Most of those people are
          * refugees, and the list is several thousand long.
          *
          * An agent: the books physically in their hands.
          * A helper: the sales THEY wrote down. They are usually a volunteer at
          *   a desk for an afternoon, and a desk shift is not a reason to hold
          *   every buyer in the raffle. Where they need to reach a buyer they
          *   did not record, the route is the seller — sold_by_agent stays
          *   visible and agents_readable gives them that person's number.
          * An organiser: everyone. Somebody has to be able to run the draw.
          */
         (case app_role()
            when 'agent' then
              t.book_idx in (select idx from books where held_by_agent = app_agent_id())
            when 'recorder' then
              t.recorded_by = auth_email()
            else true
          end) as mine
  from tickets t
  -- Left, not inner: a ticket whose book row is missing must still be readable.
  -- Dropping it would hide a sold ticket from the draw over a bookkeeping fault.
  left join books b on b.idx = t.book_idx
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
  b.idx, b.number, b.first_ticket, b.last_ticket,
  b.status, b.held_by_agent, a.name as agent_name, b.due_at,
  b.declared_sold, b.amount_due, b.amount_paid,
  r.recorded_sold, r.recorded_amount, r.available, r.reserved, r.missing_contact,
  -- Declared figures only when a count was actually declared. A book marked
  -- Lost from the Books screen has declared_sold null, and reading that as
  -- nought made every sale recorded on it worth nothing to the money reports.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then b.declared_sold else r.recorded_sold end as counted_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then coalesce(b.amount_due,0) else r.recorded_amount end as counted_expected,
  -- Sold by the seller's count with no ticket number written down: money the
  -- raffle expects and entries the draw cannot include.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(b.declared_sold - r.recorded_sold, 0) else 0 end as unidentified_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(coalesce(b.amount_due,0) - r.recorded_amount, 0) else 0 end as unidentified_amount,
  coalesce(b.amount_paid,0) as counted_collected,
  coalesce(b.declared_sold,0) - r.recorded_sold as variance_sold,
  coalesce(b.amount_due,0) - r.recorded_amount as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final
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

-- ============ THE SAME LEDGER, FOR THE FUNCTION ============

/*
 * book_ledger carries its own WHERE clause, because it runs with owner rights
 * and a policy would not apply to it. That is right for a browser reading
 * directly — and it is why the EDGE FUNCTION saw nothing at all through it.
 *
 * The function reads as the service role. It carries no JWT, so auth_email() is
 * null, so app_role() is null, so the view returned zero rows to it. Every
 * action built on the ledger quietly reported an empty raffle: no books free to
 * give out, no money expected or collected, no agent statements — and, worst,
 * the restock guard that refuses a book with money still owed saw no rows and
 * so never refused anything.
 *
 * So there are two: book_ledger, filtered, for browsers; book_ledger_all,
 * unfiltered, for the function — which does its own scoping in code, because it
 * has to, being above the policies. Explicitly revoked from anon and
 * authenticated so the unfiltered one can never be reached from a browser.
 */
drop view if exists book_ledger_all;
create view book_ledger_all as
select
  b.idx, b.number, b.first_ticket, b.last_ticket,
  b.status, b.held_by_agent, a.name as agent_name, b.due_at,
  b.declared_sold, b.amount_due, b.amount_paid,
  r.recorded_sold, r.recorded_amount, r.available, r.reserved, r.missing_contact,
  -- Declared figures only when a count was actually declared. A book marked
  -- Lost from the Books screen has declared_sold null, and reading that as
  -- nought made every sale recorded on it worth nothing to the money reports.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then b.declared_sold else r.recorded_sold end as counted_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then coalesce(b.amount_due,0) else r.recorded_amount end as counted_expected,
  -- Sold by the seller's count with no ticket number written down: money the
  -- raffle expects and entries the draw cannot include.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(b.declared_sold - r.recorded_sold, 0) else 0 end as unidentified_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(coalesce(b.amount_due,0) - r.recorded_amount, 0) else 0 end as unidentified_amount,
  coalesce(b.amount_paid,0) as counted_collected,
  coalesce(b.declared_sold,0) - r.recorded_sold as variance_sold,
  coalesce(b.amount_due,0) - r.recorded_amount as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final
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
where b.idx <= ceil(active_tickets()::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config where key='TICKETS_PER_BOOK'),1));

revoke all on book_ledger_all from anon, authenticated;

/*
 * WHAT EACH SELLER OWES, ADDED UP BY THE DATABASE.
 *
 * Every money total in this system was summed in JavaScript: read the rows,
 * loop, add, and round to two places at the end. That is safe at this
 * magnitude and it is the wrong place for it. `numeric(12,2)` exists precisely
 * so money is not a binary float, and the moment those values leave Postgres
 * for a Number they stop being exact — 0.1 + 0.2 is the standard example, and
 * a raffle adding RM10 notes will not hit it, but the guarantee was being
 * given up for no reason at all.
 *
 * It is also the same arithmetic written out three times — collectedByAgent,
 * owedBy and the outstanding report each rebuilt it — and three copies of one
 * sum is how two of them come to disagree.
 *
 * THE THREE QUANTITIES ARE KEPT APART ON PURPOSE.
 *
 *   expected     what their books say should have been collected
 *   collected    cash: the books' own figure plus every hand-to-hand payment
 *   written_off  debt somebody accountable decided will not be collected
 *
 * Collapsing the last two would say the money arrived. It did not; somebody
 * signed a decision instead, and a seller whose debt was forgiven must not
 * read as having paid it.
 *
 * WHY 'hand' BY NAME rather than "not settlement": settlement rows are already
 * in the books' own amount_paid, so counting them here charges the same cash
 * twice — but asking for "everything except settlement" means every kind of
 * row nobody has thought of yet is cash, which is how the write-off would have
 * been counted as money.
 */
drop view if exists agent_money;
create view agent_money as
select
  a.agent_id,
  a.name,
  a.phone,
  a.zone,
  coalesce(cust.books_out, 0)       as books_out,
  coalesce(cl.books_settled, 0)     as books_settled,
  coalesce(cust.overdue_books, 0)   as overdue_books,
  coalesce(op.tickets_sold, 0) + coalesce(cl.declared_sold, 0) as tickets_sold,
  coalesce(op.expected, 0) + coalesce(cl.expected, 0)          as expected,
  coalesce(cl.book_collected, 0) + coalesce(p.handed_in, 0)    as collected,
  coalesce(p.written_off, 0)        as written_off,
  coalesce(op.expected, 0) + coalesce(cl.expected, 0)
    - coalesce(cl.book_collected, 0) - coalesce(p.handed_in, 0)
    - coalesce(p.written_off, 0)    as outstanding
from agents a
-- paper: where the books are, and which are late
left join lateral (
  select
    count(*) filter (where bl.status = 'Out')   as books_out,
    count(*) filter (where bl.days_overdue > 0) as overdue_books
  from book_ledger_all bl where bl.held_by_agent = a.agent_id
) cust on true
-- an OPEN book's truth is its ticket rows, and each one names its seller
left join lateral (
  select
    count(*)::integer                                  as tickets_sold,
    coalesce(sum(t.amount), 0)::numeric(12,2)          as expected
  from tickets t
  join books b on b.idx = t.book_idx
  where t.sold_by_agent = a.agent_id
    and t.status in ('Sold','Donated')
    and t.idx <= active_tickets()
    and not (b.status in ('Settled','Lost') and b.declared_sold is not null)
) op on true
-- a CLOSED book's truth is what was declared when it was counted in
left join lateral (
  select
    count(*)                                           as books_settled,
    coalesce(sum(b.declared_sold), 0)::integer         as declared_sold,
    coalesce(sum(b.amount_due), 0)::numeric(12,2)      as expected,
    coalesce(sum(b.amount_paid), 0)::numeric(12,2)     as book_collected
  from books b
  where b.settled_by_agent = a.agent_id
    and b.status in ('Settled','Lost')
    and b.declared_sold is not null
) cl on true
left join lateral (
  select
    coalesce(sum(amount) filter (where source = 'hand'), 0)::numeric(12,2)     as handed_in,
    coalesce(sum(amount) filter (where source = 'writeoff'), 0)::numeric(12,2) as written_off
  from payments where agent_id = a.agent_id
) p on true;

revoke all on agent_money from anon, authenticated;


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

-- config is policed by config_read, and read through config_readable.
--
-- THE GRANT THAT USED TO SIT HERE WAS DEAD, and its comment argued for
-- something that had not been true for a while. It said the grant removed the
-- schema's dependency on active_tickets() being security definer — a real
-- hazard, since a view running with owner rights still calls functions as the
-- CALLER unless the function itself is definer, and every view asking how many
-- tickets are in play once denied itself over exactly that. But the grant was
-- revoked again by the blanket `revoke all on ... config from authenticated`
-- further down this file, so the dependency was live regardless. It works
-- because functions.sql DOES declare active_tickets() security definer.
--
-- Two dead grants are removed rather than moved: one here and one below whose
-- comment claimed to be re-granting after a revoke that was `from anon`. The
-- single live grant is at the bottom of this file, AFTER the revoke, where it
-- cannot be taken back four lines later. Order is load-bearing in this file and
-- the dead grants were the proof.
drop policy if exists config_read on config;
create policy config_read on config for select using (app_role() is not null);

/*
 * AN INVOKER VIEW, unlike tickets_readable above, and the difference is the
 * whole reason both are worth reading.
 *
 * Supabase's linter flags a view that runs with its owner's rights — which is
 * every plain `create view`, since security_invoker is opt-in. On
 * tickets_readable that property is load-bearing and cannot be removed; see the
 * note there. Here it is not, because this view masks NOTHING. It is the config
 * rows with the same condition the config_read policy already carries, so
 * running as the caller and letting the policy decide gives the identical
 * result — and the lint goes away honestly rather than being suppressed.
 *
 * It still drops the `notes` column, so the grant at the bottom of this file is
 * column-level. A table-wide grant would hand every signed-in user a column
 * this view exists to leave out.
 */
drop view if exists config_readable;
create view config_readable with (security_invoker = true) as
select key, value from config where app_role() is not null;
grant select on config_readable to authenticated;

-- ============ THE PRIZE SCHEDULE ============
--
-- READABLE BY ANYONE SIGNED IN, and directly rather than through a view.
--
-- Every other readable table here is behind one because it carries something
-- that has to be masked from somebody — a buyer's telephone number, a seller's
-- position, the super admin's address. The prize schedule carries none of it.
-- It is the answer to "what can I win", which a seller is asked at the table
-- by every person they sell to, and a view over it would exist only to hide
-- nothing from nobody.
--
-- WRITES ARE STILL SHUT, like everything else here: adding a prize goes through
-- the Edge Function, which knows that changing the schedule after a prize has
-- been awarded is the owner's decision and not an organiser's.

drop policy if exists prizes_read on prizes;
create policy prizes_read on prizes for select using (app_role() is not null);

drop policy if exists prize_types_read on prize_types;
create policy prize_types_read on prize_types for select using (app_role() is not null);

grant select on prizes, prize_types to authenticated;
revoke all on prizes, prize_types from anon;

-- ============ EVERYTHING ELSE STAYS SHUT ============
--
-- app_users, audit_log, permissions, pending_approvals, winners, book_history,
-- check_in_reports, payments, ticket_history, round_snapshots and check_in_dates
-- get NO select policy, so row security denies every browser read.
--
-- check_in_dates is on that list although the dates in it belong to everybody:
-- a seller cannot report by a day nobody told them about. They reach the
-- browser through deadline_status, folded into the schedule with the derived
-- dates, which is the only form in which they mean anything. A second door onto
-- the raw table would hand out rounds nobody has been told about yet, with no
-- way to say which of them the derivation would have produced anyway.
-- They are reachable only through the Edge Function, which applies the
-- super-admin rules the interface depends on — who may see the audit log, who
-- may see the allowlist, and the fact that an ordinary admin is never shown the
-- super admin at all. None of that survives being expressed as a policy, so it
-- is not attempted here.

revoke all on app_users, audit_log, permissions, pending_approvals, winners,
              book_history, check_in_reports, payments, ticket_history,
              round_snapshots, check_in_dates from authenticated;

-- And from anon, which is the role a request with no session gets. Row security
-- already returns nothing to it, so this changes no outcome today — it is here
-- so that adding a policy later for some other reason cannot accidentally open
-- these to an unauthenticated caller.
revoke all on app_users, audit_log, permissions, pending_approvals, winners,
              book_history, check_in_reports, payments, ticket_history,
              round_snapshots, check_in_dates, tickets, books, agents, config from anon;

-- The base tables are not readable directly either — only the views above,
-- which is what keeps the masking from being optional.
revoke all on tickets, books, agents, config from authenticated;
grant select on tickets_readable, book_ledger, agents_readable, config_readable to authenticated;

/*
 * AFTER the revoke, and column-level. Both halves matter.
 *
 * AFTER, because a `grant select on config to authenticated` used to sit twenty
 * lines above this and was silently undone by the revoke on the line before —
 * the second of the two dead grants this file carried. A grant that runs before
 * a blanket revoke of the same table is not a grant, and the comment beside it
 * spent a paragraph reasoning from a privilege nobody had.
 *
 * COLUMN-LEVEL, because config_readable is an invoker view: the caller now
 * needs select on what it reads, and what it reads is key and value. `notes` is
 * the third column and the view drops it, so granting the table would widen
 * what a browser can read while looking like plumbing. Row security is
 * unaffected by a column grant — config_read still decides WHICH rows, this
 * only decides which columns.
 */
grant select (key, value) on config to authenticated;


-- ============ THE SERVER'S CLOCK ============

/*
 * For a client reading rows directly rather than through the edge function.
 *
 * PostgREST hands back no clock of its own, which leaves a direct reader taking
 * max(modified_at) as its next delta cursor — sound, except when nothing has
 * changed yet and there is no max to take. This gives it one authoritative
 * instant, so "nothing since" is answerable on an empty result and two clients
 * never disagree about what time it is.
 */
create or replace function server_now() returns timestamptz
  language sql stable as $$ select now() $$;

grant execute on function server_now() to authenticated;

-- The desk's money is an organiser's figure. The function reads it as the
-- service role; a browser has no business calling it.
revoke execute on function desk_money() from public, anon, authenticated;
