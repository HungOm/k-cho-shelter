-- What each seller owes, added up by the database — Phase 2 of the audit of
-- 2026-09-15 (supabase/AUDIT.md §I).
--
-- Every money total in this system was summed in JavaScript: read the rows,
-- loop, add, round at the end. Safe at this magnitude and the wrong place for
-- it — numeric(12,2) exists so money is not a binary float, and the guarantee
-- was being given up the moment the values became Numbers. It was also the
-- same arithmetic written out three times, and three copies of one sum is how
-- two of them come to disagree.
--
-- Idempotent; run it twice and nothing changes. DATA LOSS RISK: NO. One new
-- view over tables that already exist. No column dropped, no row touched,
-- nothing else recreated.
--
-- Depends on payments.source admitting 'writeoff'
-- (20260916190000_write_off_adjustments.sql) and on book_ledger_all.
--
-- GENERATED from the canonical file: the AGENT MONEY block of rls.sql.

-- ---------- from rls.sql ----------
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
  coalesce(l.books_out, 0)      as books_out,
  coalesce(l.books_settled, 0)  as books_settled,
  coalesce(l.overdue_books, 0)  as overdue_books,
  coalesce(l.tickets_sold, 0)   as tickets_sold,
  coalesce(l.expected, 0)       as expected,
  coalesce(l.book_collected, 0) + coalesce(p.handed_in, 0) as collected,
  coalesce(p.written_off, 0)    as written_off,
  coalesce(l.expected, 0)
    - coalesce(l.book_collected, 0) - coalesce(p.handed_in, 0)
    - coalesce(p.written_off, 0) as outstanding
from agents a
left join lateral (
  select
    count(*) filter (where bl.status = 'Out')          as books_out,
    count(*) filter (where bl.status = 'Settled')      as books_settled,
    count(*) filter (where bl.days_overdue > 0)        as overdue_books,
    coalesce(sum(bl.counted_sold), 0)::integer         as tickets_sold,
    coalesce(sum(bl.counted_expected), 0)::numeric(12,2)  as expected,
    coalesce(sum(bl.counted_collected), 0)::numeric(12,2) as book_collected
  from book_ledger_all bl where bl.held_by_agent = a.agent_id
) l on true
left join lateral (
  select
    coalesce(sum(amount) filter (where source = 'hand'), 0)::numeric(12,2)     as handed_in,
    coalesce(sum(amount) filter (where source = 'writeoff'), 0)::numeric(12,2) as written_off
  from payments where agent_id = a.agent_id
) p on true;

-- Server-only, like book_ledger_all: the browser reaches this through the
-- Edge Function or not at all.
revoke all on agent_money from anon, authenticated;
