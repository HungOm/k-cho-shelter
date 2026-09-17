-- A book on the shelf is not the same as a book that is whole.
--
-- The offer screen counted 1,000 books free and let an organiser offer Book-001
-- to a seller. Eight of its ten tickets were already sold: it had been counted
-- in and then put back on the shelf, and restocking returns the UNSOLD tickets
-- to the pool while every sold one keeps its buyer — deliberately, because that
-- money is real and belongs to whoever sold it.
--
-- So an Unassigned book can have sales in it, and offer_books_tx only asked
-- about the status. A seller would have been handed a book of ten with two
-- sellable tickets in it, and been on the hook for a book.
--
-- A book given to a seller is a book they can work. What is left of a part-sold
-- book is sold at the desk, one ticket at a time, which is what the Sell screen
-- is for.
--
-- THE SAME HOLE WAS IN THE ISSUE PATH AND IN THE CLIENT, and both are closed in
-- the same commit. isFreeToIssue asked "with sales on it, no" of a RETURNED
-- book only — correct when it was written, because nothing could put a book
-- back without wiping it. Restocking is what changed, months later, and the
-- rule beside it did not move.
--
-- DATA LOSS RISK: NO. One function is replaced. No row is read or written.

create or replace function offer_books_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_due_at   date,
  p_user     text,
  p_note     text default ''
) returns table (idx integer, number text) as $$
declare
  wrong     integer;
  offenders text;
  offered   integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    raise exception 'NOTHING_TO_OFFER: no books were named';
  end if;
  if coalesce(trim(p_agent_id), '') = '' then
    raise exception 'MISSING_HOLDER: an offer needs somebody to offer it to';
  end if;
  if not exists (select 1 from agents where agent_id = p_agent_id) then
    raise exception 'AGENT_NOT_FOUND: no seller with id %', p_agent_id;
  end if;

  -- In book order, so two overlapping batches queue rather than deadlock.
  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs) and b.status <> 'Unassigned';

  if wrong > 0 then
    raise exception 'BOOKS_NOT_FREE: % of % are not on the shelf — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  /*
   * ON THE SHELF IS NOT THE SAME AS WHOLE.
   *
   * Restocking returns the unsold tickets to the pool and leaves every SOLD
   * ticket with its buyer — deliberately, because that money is real and
   * belongs to whoever sold it. So an Unassigned book can have eight of its ten
   * already gone, and the status check above waves it through: the offer screen
   * counted it among "1,000 books free" and would have handed a seller a book
   * with two sellable tickets in it.
   *
   * A book given to a seller is a book they can work. The two that are left are
   * sold at the desk, one at a time, which is what the Sell screen is for.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
     and exists (select 1 from tickets tk
                  where tk.book_idx = b.idx and tk.status in ('Sold', 'Donated'));

  if wrong > 0 then
    raise exception 'BOOK_NOT_WHOLE: % of % already have tickets sold from them — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  -- RETURNING, not a re-read. What this wrote is the only honest answer to
  -- "what did this write"; asking the table afterwards which books are Offered
  -- also collects books somebody else offered a moment ago.
  with written as (
    update books b set
      status = 'Offered',
      offered_to_agent = p_agent_id,
      offered_at = now(),
      offered_by = p_user,
      due_at = p_due_at,
      modified_by = p_user
     where b.idx = any(p_idxs) and b.status = 'Unassigned'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into offered from written w;

  if offered is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'offer', p_user,
         coalesce(nullif(p_note, ''), 'Offered, waiting for the seller to accept')
    from unnest(offered) i order by i;

  return query select b.idx, b.number from books b where b.idx = any(offered) order by b.idx;
end $$ language plpgsql;
