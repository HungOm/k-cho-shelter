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
