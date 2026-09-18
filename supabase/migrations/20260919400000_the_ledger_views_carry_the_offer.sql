-- A seller could not load anything, because a filter named a column the view
-- did not have.
--
--     books — column book_ledger_all.offered_to_agent does not exist
--
-- listBooks scopes a seller's list to "held by me, or offered to me" and applies
-- that through PostgREST against book_ledger_all. offered_to_agent is on
-- `books`; it was never added to the view's select list. So the filter named a
-- column that was not there, the request failed, and the seller's entire books
-- list — every screen they have — came up empty behind "Some things could not
-- be loaded".
--
-- Both ledger views carry it now. book_ledger already USED the column in its own
-- WHERE clause, which worked because that is inside the view over `books`;
-- SELECTING it is a different thing, and is what a caller filtering the view
-- needs. Nothing exercised the views' COLUMNS — only their rows — so a filter
-- added in the Edge Function could name anything and no suite would notice.
-- test-rls.sh now asserts both views expose it.
--
-- Appended at the END of each column list, which is what create or replace view
-- accepts.
--
-- DATA LOSS RISK: NO. Two views gain a column. No row is touched.

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
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
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
  b.offered_to_agent
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
  -- The same three-way rule as books_read, written out because this view runs
  -- with owner rights and the policy never fires for it. Held by them, or
  -- offered to them — an offer a seller cannot see is one they cannot answer.
  and (
    app_role() <> 'agent'
    or b.held_by_agent = app_agent_id()
    or (b.status = 'Offered' and b.offered_to_agent = app_agent_id())
  );

grant select on book_ledger to authenticated;

-- agent_money FIRST, because it reads book_ledger_all and `drop view` without
-- cascade is refused while anything depends on it. rls.sql learned this and
-- this migration was copied from it without the line, so it died at statement 3
-- with exactly the error rls.sql exists to avoid:
--     cannot drop view book_ledger_all because other objects depend on it
-- Dropped by name rather than with cascade, for the reason rls.sql gives:
-- cascade destroys whatever happens to depend on the view, including something
-- added later that nothing here recreates. agent_money is recreated by rls.sql,
-- which a deploy applies straight after this.
drop view if exists agent_money;
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
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
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
  b.offered_to_agent
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


-- ============ AND agent_money GOES BACK ============
--
-- This migration DROPS agent_money above, to clear the dependency that stops
-- book_ledger_all being replaced. Dropping a money view and not putting it back
-- is how a migration leaves a raffle unable to say what anybody owes.
--
-- It happened to be harmless on the day: the deploy applies rls.sql straight
-- after, and rls.sql recreates it. But a migration is not entitled to assume
-- what runs next — `supabase db push` on its own is a thing people do, and the
-- clean-build check applies rls.sql BEFORE the migrations, which is where this
-- was caught: three money views expected, two found.
--
-- Verbatim from rls.sql, so the two cannot drift.
drop view if exists agent_money;
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
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
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
  b.offered_to_agent
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
