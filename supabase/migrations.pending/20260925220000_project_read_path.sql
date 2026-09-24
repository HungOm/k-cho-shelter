/*
 * MULTI-TENANCY STAGE 2, THE READ PATH: every policy and every view is about
 * one project.
 *
 * Stage 1 gave the twenty-three tables a `project_id` and nothing read it.
 * This makes the read path use it: in the six policies, which decide what the
 * browser may select, and in the six views, which run with owner rights so
 * their own WHERE is the only wall they have.
 *
 * COALESCED, NOT STRICT, exactly like the column default Stage 1 installed, so
 * a request with no `x-project-id` header reads the raffle that was already
 * here. Stage 4 removes the coalesce from both at once. With one project this
 * therefore changes no answer — checked rather than asserted: the T9 report
 * dump before and after this migration is byte-identical at 39,768 bytes.
 *
 * `active_tickets` GAINS A SECOND SIGNATURE rather than changing the one it
 * has. `active_tickets(p_project uuid)` reads that project's TOTAL_TICKETS and
 * ACTIVE_TICKETS; `active_tickets()` stays, now one line delegating with the
 * coalesce, because six policies and six views call it. A default argument
 * would not do: beside the existing zero-argument function it makes the bare
 * call ambiguous, Postgres answers `function active_tickets() is not unique`,
 * and every one of those callers breaks. Checked in a scratch database. D-021.
 *
 * WHAT THE VIEWS GAINED BESIDES A PREDICATE. Five of the six expose
 * `project_id` as their last column, because handlers reach two of them
 * through the scoped client, which filters by that column and cannot filter by
 * one the view has not got (D-028). Appended at the end, which is what
 * `create or replace view` accepts — and replace rather than drop and create,
 * because a drop takes the grants with it.
 *
 * config_readable IS THE EXCEPTION, measured rather than chosen. It is the one
 * `security_invoker` view, so its policy DOES fire and has already scoped the
 * rows by the time its body runs; and the browser's column grant on config is
 * `(key, value)` on purpose, because `notes` is the third column. A WHERE
 * needs select on the column it names, so repeating the predicate there fails
 * with `permission denied for table config`. Three cases in test-rls.sh said
 * so before this paragraph did.
 *
 * NOT APPLIED ANYWHERE. It waits in migrations.pending/ until the owner says
 * so (D-003). Rollback: re-apply the previous supabase/rls.sql and
 * supabase/functions.sql, which is what the plan's stage table already says
 * for every Stage 2 card.
 */

-- ---------------------------------------------------------------------------
-- 1. how many tickets are in play, per project
-- ---------------------------------------------------------------------------
create or replace function active_tickets(p_project uuid) returns integer as $$
declare
  generated integer;
  active integer;
begin
  select coalesce(nullif(value, '')::integer, 0) into generated
    from config where key = 'TOTAL_TICKETS' and project_id = p_project;
  select coalesce(nullif(value, '')::integer, 0) into active
    from config where key = 'ACTIVE_TICKETS' and project_id = p_project;
  generated := coalesce(generated, 0);
  active := coalesce(active, 0);
  if active <= 0 or active > generated then return generated; end if;
  return active;
end $$ language plpgsql stable security definer set search_path = public;

create or replace function active_tickets() returns integer as $$
  select active_tickets(coalesce(current_project(), seed_project()))
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. the six policies. Dropped and recreated because a policy has no
--    `create or replace`; the name and the table are unchanged.
-- ---------------------------------------------------------------------------
drop policy if exists tickets_read on tickets;
create policy tickets_read on tickets for select using (
  app_role() is not null
  -- THE RAFFLE THIS REQUEST IS ABOUT, and the first thing checked rather than
  -- the last. A member of one organisation sending another's header must read
  -- nothing, and app_role() being scoped is not enough on its own: it answers
  -- "may this person be here", not "is this row theirs". Coalesced through
  -- Stage 3, so a request with no header reads the raffle that was already
  -- here; Stage 4 makes it strict.
  and project_id = coalesce(current_project(), seed_project())
  -- Held back: generated but not in play. Not merely hidden in the interface —
  -- not readable at all, so a held-back buyer cannot leak through a crafted
  -- query either. Counted within this row's own project: a second raffle's
  -- ACTIVE_TICKETS must not decide what is readable in this one.
  and idx <= active_tickets(project_id)
  -- An agent sees only the books they are carrying. Everybody else on the
  -- allowlist sees the whole raffle, which is what recording sales requires.
  and (
    app_role() <> 'agent'
    or book_idx in (select idx from books
                     where held_by_agent = app_agent_id()
                       and books.project_id = tickets.project_id)
    -- Held directly, or held at some point according to the ledger. Kept in
    -- step with tickets_readable so the two cannot drift.
    --
    -- BOTH CLAUSES ARE DORMANT, AND FOR THREE SEPARATE REASONS. Whoever wakes
    -- the custody ledger will need all three, because fixing one leaves the
    -- clause looking live and behaving dead:
    --   1. `tickets` is revoked from `authenticated`, so no browser role
    --      reaches this policy at all today.
    --   2. Nothing writes tickets.holder except move_tickets, and no screen
    --      calls it — every seller is carried by the book they hold.
    --   3. ticket_movements has row security ENABLED AND NO POLICY, so this
    --      subquery returns nothing to any non-superuser even once the other
    --      two are fixed. It fails closed, which is the safe direction: a
    --      seller would be denied a ticket they hold rather than shown one
    --      they do not. Granting the read means giving that table a policy,
    --      not just granting select on `tickets`.
    or holder = app_agent_id()
    or exists (
      select 1 from ticket_movements m
       where m.ticket_idx = tickets.idx
         and m.project_id = tickets.project_id
         and app_agent_id() in (m.from_holder, m.to_holder)
    )
  )
);

drop policy if exists books_read on books;
create policy books_read on books for select using (
  app_role() is not null
  -- The raffle this request is about, checked before anything derived from it.
  and project_id = coalesce(current_project(), seed_project())
  -- Both halves of this sum are per project: how many tickets are in play, and
  -- how many go in a book. A second raffle with twenty to a book must not
  -- decide how many of this one's books are readable.
  and idx <= ceil(
    active_tickets(project_id)::numeric /
    greatest((select coalesce(nullif(value,'')::integer, 10) from config
               where key = 'TICKETS_PER_BOOK' and config.project_id = books.project_id), 1))
  -- A seller sees the books in their hands, AND the books being offered to
  -- them. An offer they cannot read is an offer they cannot answer, and an
  -- Offered book has held_by_agent null by design — so under the first clause
  -- alone the one person who has to decide is the one who cannot see it.
  -- Nothing about money travels with it: that null is exactly why.
  and (
    app_role() <> 'agent'
    or held_by_agent = app_agent_id()
    or (status = 'Offered' and offered_to_agent = app_agent_id())
  )
);

drop policy if exists agents_read on agents;
create policy agents_read on agents for select using (app_role() is not null and project_id = coalesce(current_project(), seed_project()));

drop policy if exists config_read on config;
create policy config_read on config for select using (app_role() is not null and project_id = coalesce(current_project(), seed_project()));

drop policy if exists prizes_read on prizes;
create policy prizes_read on prizes for select using (app_role() is not null and project_id = coalesce(current_project(), seed_project()));

drop policy if exists prize_types_read on prize_types;
create policy prize_types_read on prize_types for select using (app_role() is not null and project_id = coalesce(current_project(), seed_project()));

-- ---------------------------------------------------------------------------
-- 3. the six views, in dependency order: agent_money reads book_ledger_all.
-- ---------------------------------------------------------------------------
create or replace view tickets_readable with (security_invoker = false) as
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
  /*
   * ANOTHER SELLER'S MONEY, WHICH IS WHAT "THEIR RECORDS" MEANS.
   *
   * The row stays. Sellers ask each other whether a number is still going, and
   * hiding the row makes an available ticket indistinguishable from one that
   * was never printed — the reason this view shows every ticket is written out
   * below and it is a good one.
   *
   * What does NOT belong to a seller is the rest of another seller's page: who
   * sold it, for how much, whether that money came in, and who wrote it down.
   * Those four went out to every signed-in agent for the whole raffle, which is
   * the gap the review names — not the row's existence, which is fine.
   *
   * Through the same `mine` gate the buyer's details already use, so there is
   * one rule about whose ticket this is rather than two that can drift. An
   * organiser, a viewer and a helper are unchanged: the draw has to be runnable
   * and the totals checkable by somebody holding no books.
   *
   * Status and sold_at stay visible to everyone: "is this one gone, and when"
   * is the availability question, and answering it reveals nothing about who
   * holds the money.
   */
  case when mine or app_role() <> 'agent' then sold_by_agent else null end as sold_by_agent,
  case when mine or app_role() <> 'agent' then amount else null end as amount,
  case when mine or app_role() <> 'agent' then payment_status else '' end as payment_status,
  sold_at,
  case when mine then notes else '' end as notes,
  source, version,
  case when mine or app_role() <> 'agent' then recorded_by else '' end as recorded_by,
  modified_at,
  -- WHICH RAFFLE, appended at the end because that is what `create or replace
  -- view` accepts. The browser reads this view directly, and the scoped client
  -- filters on the column, so it has to be here and not only in the where. D-028.
  project_id
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
              t.book_idx in (select idx from books
                              where held_by_agent = app_agent_id()
                                and books.project_id = t.project_id)
            when 'recorder' then
              t.recorded_by = auth_email()
            else true
          end) as mine
  from tickets t
  -- Left, not inner: a ticket whose book row is missing must still be readable.
  -- Dropping it would hide a sold ticket from the draw over a bookkeeping fault.
  left join books b on b.idx = t.book_idx and b.project_id = t.project_id
  where app_role() is not null
    -- The raffle this request is about. This view runs with owner rights, so
    -- tickets_read never fires for it and this is the only thing standing
    -- between one organisation's buyers and another's on the direct-read path.
    and t.project_id = coalesce(current_project(), seed_project())
    and t.idx <= active_tickets(t.project_id)
) v;

create or replace view book_ledger as
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
  -- NOUGHT UNTIL SOMEBODY HAS COUNTED THE BOOK IN. A null declared_sold means
  -- "not counted yet", and coalescing it to nought read that as "the seller
  -- says nothing was sold" — so every unsettled book with sales in it carried
  -- a variance of minus its own takings. Seven books in production did, and the
  -- book sheet drew each one as a red discrepancy. Same guard as counted_sold
  -- three lines up, for the same reason.
  case when b.declared_sold is not null
       then b.declared_sold - r.recorded_sold else 0::bigint end as variance_sold,
  case when b.declared_sold is not null
       then coalesce(b.amount_due,0) - r.recorded_amount else 0::numeric end as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out'
   and (select nullif(value,'') from config
         where key = 'FINAL_DEADLINE' and config.project_id = b.project_id) is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config
         where key = 'FINAL_DEADLINE' and config.project_id = b.project_id) < current_date)
    as past_final,
  -- WHO TOOK THE MONEY. settle_book has written settled_by since it existed and
  -- nothing read it back, so "Handed in RM100" named an amount and no
  -- counterparty — on the one screen where somebody is checking a figure
  -- against the person who wrote it. Appended at the END of the column list,
  -- which is what create or replace view will accept.
  b.settled_by, b.settled_at,
  -- WHO IT IS WAITING ON, which the view did not carry and a filter needed.
  -- listBooks scopes a seller's list to "held by me, or offered to me", and
  -- filters through PostgREST against this view — so a column that exists on
  -- `books` and not here is a column the filter cannot name:
  --     column book_ledger_all.offered_to_agent does not exist
  -- A seller's whole books list failed to load on that, which is every screen
  -- they have. Appended at the END, which is what create or replace accepts.
  b.offered_to_agent,
  -- WHICH RAFFLE THIS ROW IS, appended at the END because that is what
  -- `create or replace view` accepts. Exposed and not merely filtered on: the
  -- handlers reach this view through the scoped client, which says
  -- `.eq('project_id', …)` on every read and cannot say it about a column the
  -- view does not have. D-028.
  b.project_id
from books b
left join agents a on a.agent_id = b.held_by_agent and a.project_id = b.project_id
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated')) as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available') as available,
    count(*) filter (where t.status = 'Reserved') as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx and t.project_id = b.project_id
) r on true
where app_role() is not null
  and b.project_id = coalesce(current_project(), seed_project())
  and b.idx <= ceil(active_tickets(b.project_id)::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config
                   where key='TICKETS_PER_BOOK' and config.project_id = b.project_id),1))
  -- The same three-way rule as books_read, written out because this view runs
  -- with owner rights and the policy never fires for it. Held by them, or
  -- offered to them — an offer a seller cannot see is one they cannot answer.
  and (
    app_role() <> 'agent'
    or b.held_by_agent = app_agent_id()
    or (b.status = 'Offered' and b.offered_to_agent = app_agent_id())
  );

create or replace view book_ledger_all as
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
  -- NOUGHT UNTIL SOMEBODY HAS COUNTED THE BOOK IN. A null declared_sold means
  -- "not counted yet", and coalescing it to nought read that as "the seller
  -- says nothing was sold" — so every unsettled book with sales in it carried
  -- a variance of minus its own takings. Seven books in production did, and the
  -- book sheet drew each one as a red discrepancy. Same guard as counted_sold
  -- three lines up, for the same reason.
  case when b.declared_sold is not null
       then b.declared_sold - r.recorded_sold else 0::bigint end as variance_sold,
  case when b.declared_sold is not null
       then coalesce(b.amount_due,0) - r.recorded_amount else 0::numeric end as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out'
   and (select nullif(value,'') from config
         where key = 'FINAL_DEADLINE' and config.project_id = b.project_id) is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config
         where key = 'FINAL_DEADLINE' and config.project_id = b.project_id) < current_date)
    as past_final,
  -- WHO TOOK THE MONEY. settle_book has written settled_by since it existed and
  -- nothing read it back, so "Handed in RM100" named an amount and no
  -- counterparty — on the one screen where somebody is checking a figure
  -- against the person who wrote it. Appended at the END of the column list,
  -- which is what create or replace view will accept.
  b.settled_by, b.settled_at,
  -- WHO IT IS WAITING ON, which the view did not carry and a filter needed.
  -- listBooks scopes a seller's list to "held by me, or offered to me", and
  -- filters through PostgREST against this view — so a column that exists on
  -- `books` and not here is a column the filter cannot name:
  --     column book_ledger_all.offered_to_agent does not exist
  -- A seller's whole books list failed to load on that, which is every screen
  -- they have. Appended at the END, which is what create or replace accepts.
  b.offered_to_agent,
  -- WHICH RAFFLE THIS ROW IS, appended at the END because that is what
  -- `create or replace view` accepts. Exposed and not merely filtered on: the
  -- handlers reach this view through the scoped client, which says
  -- `.eq('project_id', …)` on every read and cannot say it about a column the
  -- view does not have. D-028.
  b.project_id
from books b
left join agents a on a.agent_id = b.held_by_agent and a.project_id = b.project_id
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated')) as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available') as available,
    count(*) filter (where t.status = 'Reserved') as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx and t.project_id = b.project_id
) r on true
where b.project_id = coalesce(current_project(), seed_project())
  and b.idx <= ceil(active_tickets(b.project_id)::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config
                   where key='TICKETS_PER_BOOK' and config.project_id = b.project_id),1));

create or replace view agent_money as
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
    - coalesce(p.written_off, 0)    as outstanding,
  -- Appended at the end; see D-028. Every lateral above joins back to it, so
  -- a seller's money is added up from their own raffle's books, tickets and
  -- payments and from nobody else's — which is the one view in this file where
  -- getting that wrong would be a figure somebody is asked to hand over.
  a.project_id
from agents a
-- paper: where the books are, and which are late
left join lateral (
  select
    count(*) filter (where bl.status = 'Out')   as books_out,
    count(*) filter (where bl.days_overdue > 0) as overdue_books
  from book_ledger_all bl where bl.held_by_agent = a.agent_id
   and bl.project_id = a.project_id
) cust on true
-- an OPEN book's truth is its ticket rows, and each one names its seller
left join lateral (
  select
    count(*)::integer                                  as tickets_sold,
    coalesce(sum(t.amount), 0)::numeric(12,2)          as expected
  from tickets t
  join books b on b.idx = t.book_idx and b.project_id = t.project_id
  where t.sold_by_agent = a.agent_id
    and t.project_id = a.project_id
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
    and b.project_id = a.project_id
    and b.status in ('Settled','Lost')
    and b.declared_sold is not null
) cl on true
left join lateral (
  select
    coalesce(sum(amount) filter (where source = 'hand'), 0)::numeric(12,2)     as handed_in,
    coalesce(sum(amount) filter (where source = 'writeoff'), 0)::numeric(12,2) as written_off
  from payments where agent_id = a.agent_id
    and payments.project_id = a.project_id
) p on true
where a.project_id = coalesce(current_project(), seed_project());

create or replace view agents_readable as
select agent_id, name,
       case when app_role() = 'viewer' then '' else phone end as phone,
       zone, active, notes,
       -- Appended at the end; see D-028.
       project_id
from agents
-- NO security_invoker on this one, so agents_read never fires for it and this
-- predicate is the whole of the wall. The policy beside it is not a substitute.
where app_role() is not null
  and project_id = coalesce(current_project(), seed_project());

create or replace view config_readable with (security_invoker = true) as
select key, value from config where app_role() is not null;

