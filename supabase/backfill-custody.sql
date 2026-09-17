-- The custody ledger, filled in from what already happened. NOT RUN BY ANYTHING.
--
-- ARCHITECTURE-REVIEW.md §22 step 2. This file is deliberately not a migration
-- and is deliberately not referenced by SETUP.md, the reset runbook, or
-- test-functions.sh. `supabase db push` reads supabase/migrations/ and will
-- never see it. It is run once, by a person, against a database that has just
-- been backed up, and read in full first.
--
-- WHY IT IS NOT A MIGRATION. A migration runs unattended, and the one thing
-- this script must be able to do is STOP. §22: "Any mismatch is a finding, not
-- something to fix in the backfill — it goes into reconciliation_exceptions as
-- open and to the organiser." A migration that stops is a deploy that failed at
-- 2am; a script that stops is a person reading a number.
--
-- WHY THE BACKFILL IS EXACT RATHER THAN A GUESS, which is the only reason this
-- is worth doing at all: no partial operation has ever been possible in this
-- system. Every issue, return, transfer and restock has moved a WHOLE book, so
-- "which tickets moved" is not reconstructed — it is every ticket in the book.
-- The day somebody hands back six of ten, that stops being true, and the ledger
-- has to exist before then.
--
-- WHAT IT WRITES: one ticket_movements row per ticket per custody-moving
-- book_history row, marked backfilled, with `reason` naming the source row so
-- any figure can be walked back to the record it came from. Then tickets.holder
-- from the replay. It writes nothing else and changes no other column.
--
-- BEFORE RUNNING IT
--   1. ./supabase/backup.sh, and OPEN the csv files. A backup nobody has looked
--      at is a belief, not a backup.
--   2. Read the two counts it prints at the end. If the mismatch count is not
--      zero it has already rolled itself back and there is nothing to undo.
--   3. It is idempotent by refusal, not by merge: it stops if ticket_movements
--      already has backfilled rows, because a second run would double every
--      movement and the replay would still come out right, which is the worst
--      kind of wrong.

begin;

-- ============ REFUSE TO RUN TWICE (begin) ============
do $$
begin
  if exists (select 1 from ticket_movements where backfilled) then
    raise exception 'ticket_movements already holds backfilled rows — this script runs once'
      using hint = 'If the first run was wrong, the ledger is append only: write the correcting movements, do not run this again.';
  end if;
end $$;
-- ============ REFUSE TO RUN TWICE (end) ============


-- ============ THE MOVEMENTS (begin) ============
/*
 * THE VOCABULARY, read off the five writers rather than assumed:
 *
 *   issue       functions.sql sell/issue path   desk    -> to_agent
 *   return      returnBooks                     from    -> desk
 *   restock     restockBooks                    from    -> desk
 *   transfer    transferBooks                   from    -> to_agent
 *   lost/void   set_book_status, lowercased     from    -> lost
 *   unassigned  the RM400 correction, by hand   from    -> desk, as a correction
 *
 * `settle` is NOT here and that is the point of listing them: settling a book
 * counts money and moves no paper. A backfill that treated it as a return would
 * put every settled book at the desk and the replay would disagree with
 * held_by_agent for exactly the books that matter most.
 */
insert into ticket_movements
  (at, ticket_idx, from_holder, to_holder, kind, batch_id, by_user, reason, backfilled)
select
  h.at,
  t.idx,
  case h.action
    when 'issue' then 'desk'
    else coalesce(nullif(h.from_agent, ''), 'desk')
  end,
  case h.action
    when 'issue'      then coalesce(nullif(h.to_agent, ''), 'desk')
    when 'transfer'   then coalesce(nullif(h.to_agent, ''), 'desk')
    when 'lost'       then 'lost'
    when 'void'       then 'lost'
    else 'desk'
  end,
  case h.action
    when 'issue' then 'issue'
    when 'return' then 'return'
    when 'restock' then 'restock'
    when 'transfer' then 'transfer'
    when 'lost' then 'lost'
    when 'void' then 'lost'
    else 'correction'
  end,
  -- ONE BATCH PER SOURCE ROW, which is one batch per user action: a whole book
  -- of ten becomes ten movements sharing a batch_id, exactly as a live one will.
  h.batch,
  coalesce(nullif(h.by_user, ''), 'backfill'),
  'book_history:' || h.id || ' (' || h.action || ')' ||
    case when h.note <> '' then ' — ' || h.note else '' end,
  true
from (
  select bh.*, gen_random_uuid() as batch
  from book_history bh
  where bh.action in ('issue','return','restock','transfer','lost','void','unassigned')
) h
join tickets t on t.book_idx = h.book_idx
-- A movement that moves nothing is a no-op in the record, not a row. The table's
-- own check would refuse it anyway unless it were a correction, and calling it a
-- correction would be inventing an event nobody performed.
where case h.action when 'issue' then 'desk' else coalesce(nullif(h.from_agent,''),'desk') end
   <> case h.action
        when 'issue' then coalesce(nullif(h.to_agent,''),'desk')
        when 'transfer' then coalesce(nullif(h.to_agent,''),'desk')
        when 'lost' then 'lost'
        when 'void' then 'lost'
        else 'desk' end
order by h.at, h.id, t.idx;
-- ============ THE MOVEMENTS (end) ============


-- ============ THE PROJECTION (begin) ============
-- Where each ticket ended up, which is the last movement it has. `id desc`
-- rather than `at desc`: two rows in one batch share a timestamp, and the
-- replay order has to be total or the answer depends on the plan.
update tickets t
   set holder = m.to_holder
  from (
    select distinct on (ticket_idx) ticket_idx, to_holder
    from ticket_movements
    order by ticket_idx, id desc
  ) m
 where m.ticket_idx = t.idx
   and t.holder is distinct from m.to_holder;
-- ============ THE PROJECTION (end) ============


-- ============ THE REPLAY CHECK, WHICH IS ALLOWED TO STOP THIS (begin) ============
/*
 * §22, and it is the reason this is a script: "the projected holder/status must
 * equal today's books.held_by_agent-derived holder ... for every ticket. Any
 * mismatch is a finding, not something to fix in the backfill."
 *
 * So it does not reconcile, patch, or prefer one side. It counts, reports, and
 * rolls the whole thing back — because a half-filled ledger that nobody knows is
 * half-filled is worse than an empty one, and because the mismatch is the most
 * interesting thing this exercise can produce. It means the narrative in
 * book_history and the fact in held_by_agent disagree about where a book is,
 * and somebody needs to know which is right.
 */
do $$
declare
  wrong integer;
  sample text;
begin
  select count(*),
         string_agg(x.number || ' (ledger says ' || x.holder ||
                    ', book says ' || x.book_holder || ')', '; ' order by x.number)
    into wrong, sample
  from (
    select b.number, t.holder, coalesce(nullif(b.held_by_agent,''),'desk') as book_holder
    from tickets t
    join books b on b.idx = t.book_idx
    where t.holder is distinct from
          case when b.status = 'Out' then coalesce(nullif(b.held_by_agent,''),'desk') else 'desk' end
    limit 25
  ) x;

  if wrong > 0 then
    raise exception E'the replayed ledger disagrees with books.held_by_agent for % ticket(s)\n%\n\nNOTHING HAS BEEN WRITTEN — this transaction is rolled back.',
      wrong, coalesce(sample, '')
      using hint = 'This is a finding, not a bug in the script. Each one is a book whose history and whose current holder tell different stories. Open a reconciliation_exception per book and take them to the organiser; re-run only once they agree.';
  end if;

  raise notice 'custody backfill: % movements over % tickets, replay agrees with held_by_agent everywhere',
    (select count(*) from ticket_movements where backfilled),
    (select count(distinct ticket_idx) from ticket_movements where backfilled);
end $$;
-- ============ THE REPLAY CHECK (end) ============

commit;
