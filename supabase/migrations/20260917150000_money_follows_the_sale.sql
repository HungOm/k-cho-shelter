-- Money follows the sale, not the paper.
--
-- THE BUG THIS ENDS, which has now appeared four times in three shapes. Every
-- balance in this system was keyed on `books.held_by_agent` — who is holding
-- the paper — while the sale itself is recorded on the ticket, with its own
-- `sold_by_agent`. Nothing read that column. restockBooks says so in its own
-- comment: "The tickets keep sold_by_agent, but no report reads it."
--
-- That is fine exactly while custody and selling are the same person. It fails
-- the moment they are not:
--
--   Book-001/002/003  returned, then sold at the office   RM300 on Thang ling
--   Book-116          returned, then sold at the office   RM100 on JOHN
--   Book-510          sold at the desk, issued afterwards RM100 on Kee Thang
--   Book-022          returned, then sold at the office    RM10 on Thang ling
--
-- The first four were repaired by hand. The last two are repaired by this
-- migration without touching a row, because the figure is re-derived rather
-- than stored — which is the difference between a fix and a model.
--
-- THE MODEL, in one sentence per regime:
--
--   an OPEN book    the ticket rows are the truth, so expected follows
--                   tickets.sold_by_agent, and a ticket nobody is credited
--                   with is the desk's
--   a CLOSED book   the declared figure is the truth — it has no per-ticket
--                   breakdown, which is what unidentified_sold exists for — so
--                   it follows books.settled_by_agent, frozen at settle time
--
-- FROZEN, not re-read from custody. That is the whole point of the new column:
-- once a book is counted in, clearing or changing who holds it must not move
-- money that was already accounted for. held_by_agent goes back to meaning one
-- thing — where the paper is.
--
-- DATA LOSS RISK: NO. One nullable column is added and backfilled; two views
-- and one function are replaced. No row is deleted and no existing column is
-- written except the new one.

-- ============ WHO SETTLED IT, REMEMBERED (begin) ============
-- books.settled_by is the settler's EMAIL, which is who typed it. This is the
-- SELLER the declared money belongs to, which is a different question — the
-- organiser settles most books, and none of that money is theirs.
alter table books add column if not exists settled_by_agent text;
create index if not exists books_settled_by_agent_idx
  on books (settled_by_agent) where settled_by_agent is not null;

-- Backfill from custody, which is where the money sat until now, so no balance
-- moves for a book that was settled by the person who was holding it.
--
-- The four books repaired by hand are the deliberate exception and they need no
-- special case here: their held_by_agent was already cleared, so they backfill
-- to null and their declared money lands on the desk, which is where it belongs.
update books
   set settled_by_agent = held_by_agent
 where status in ('Settled','Lost')
   and declared_sold is not null
   and settled_by_agent is null;
-- ============ WHO SETTLED IT, REMEMBERED (end) ============


-- ============ THE DESK IS WHOEVER NOBODY IS (begin) ============
-- Sales with no seller: an open book's tickets that nobody is credited with,
-- plus closed books nobody settled. It used to ask which books had no HOLDER,
-- which is how a book sold across a desk and issued to somebody later ended up
-- on that person's balance.
create or replace function desk_money() returns jsonb as $$
  with open_desk as (
    select count(*) as sold,
           coalesce(sum(t.amount), 0) as expected,
           coalesce(sum(t.amount) filter (where t.payment_status = 'Paid'), 0) as collected
    from tickets t
    join books b on b.idx = t.book_idx
    where t.sold_by_agent is null
      and t.status in ('Sold','Donated')
      and t.idx <= active_tickets()
      and not (b.status in ('Settled','Lost') and b.declared_sold is not null)
  ),
  closed_desk as (
    select coalesce(sum(b.declared_sold), 0) as sold,
           coalesce(sum(b.amount_due), 0) as expected,
           coalesce(sum(b.amount_paid), 0) as collected
    from books b
    where b.settled_by_agent is null
      and b.status in ('Settled','Lost')
      and b.declared_sold is not null
  )
  select jsonb_build_object(
    'sold',      (select sold from open_desk) + (select sold from closed_desk),
    'expected',  (select expected from open_desk) + (select expected from closed_desk),
    'collected', (select collected from open_desk) + (select collected from closed_desk));
$$ language sql stable;
-- ============ THE DESK IS WHOEVER NOBODY IS (end) ============


-- ============ WHAT EACH SELLER OWES (begin) ============
-- Rebuilt on the model above. The three quantities are still kept apart —
-- expected, collected, written_off — for the reason the old view gave: a debt
-- somebody decided will not be collected must not read as having been paid.
--
-- THE COUNTS STAY ON CUSTODY. "How many books are with you" and "how many are
-- late" are questions about paper, and the chase list needs them keyed that
-- way. Only the MONEY moves to the sale. books_settled moves with the money,
-- because it answers "how many did you close", not "how many are on your desk".
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
-- ============ WHAT EACH SELLER OWES (end) ============
