/*
 * TWO THINGS THE BOOK LEDGER WAS GETTING WRONG, AND ONE IT NEVER CARRIED.
 *
 * 1. A VARIANCE OF MINUS THE WHOLE BOOK. variance_amount is amount_due minus
 *    recorded_amount: what the seller declared they sold, against the ticket
 *    numbers actually written down. It was computed as
 *    coalesce(amount_due, 0) - recorded_amount, and amount_due is null on every
 *    book nobody has counted in yet — so a book simply still out, with ten
 *    sales properly recorded on it, came back reporting -100.00, as though the
 *    seller had declared nothing sold. The book sheet drew that in red under
 *    "Difference". Seven books in this fundraiser were doing it: 004, 022, 054,
 *    084, 116, 293 and 510. Not one had a real discrepancy; none had been
 *    counted in.
 *
 *    counted_sold and counted_expected three lines above already guard on
 *    "declared_sold is not null" for exactly this reason, with the reason
 *    written in a comment beside them. variance_sold and variance_amount were
 *    left out of it.
 *
 * 2. THE SAME NULL, ONE COLUMN ALONG: variance_sold, for the same reason.
 *
 * 3. WHO TOOK THE MONEY. settle_book has written books.settled_by since it
 *    existed and nothing has ever read it back, so "Handed in RM100" on the
 *    book sheet named an amount and no counterparty. settled_by and settled_at
 *    are appended here so the sheet can say who counted it in.
 *
 * NOT A DATA REPAIR. Nothing stored is wrong — amount_due is correctly null on
 * a book nobody has counted. Only the derived columns were lying.
 *
 * create or replace, not drop: agent_money selects from book_ledger_all and a
 * drop would need a cascade that takes it too. The new columns are appended at
 * the END of each list, which is the form create or replace accepts, and the
 * two changed columns are pinned with ::bigint and ::numeric so their types are
 * unchanged — recorded_sold is a count(*), which makes variance_sold bigint.
 */

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
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final,
  -- WHO TOOK THE MONEY. settle_book has written settled_by since it existed and
  -- nothing read it back, so "Handed in RM100" named an amount and no
  -- counterparty — on the one screen where somebody is checking a figure
  -- against the person who wrote it. Appended at the END of the column list,
  -- which is what create or replace view will accept.
  b.settled_by, b.settled_at
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
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final,
  -- WHO TOOK THE MONEY. settle_book has written settled_by since it existed and
  -- nothing read it back, so "Handed in RM100" named an amount and no
  -- counterparty — on the one screen where somebody is checking a figure
  -- against the person who wrote it. Appended at the END of the column list,
  -- which is what create or replace view will accept.
  b.settled_by, b.settled_at
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
