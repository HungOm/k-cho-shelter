-- A book changed hands in four statements and any of them could be the last.
--
-- Issuing a book was: update the book, then insert the history row. Returning
-- one was: update the book, release its held tickets, insert the history row.
-- Restocking was five statements including the payment reversals. Every one of
-- those sequences ran from TypeScript over PostgREST, which means every one was
-- four separate transactions, and the gap between them is where the record and
-- the paper stop agreeing:
--
--   issue    the book says it is with Josh and nothing says when it went or
--            who sent it — the trail simply has no row
--   return   the book says Returned and its reserved tickets are still held
--            for buyers who never came back
--   restock  the settlement money is reversed on the ledger and the book still
--            carries the figures that money was for, or the other way about
--
-- Nothing here is hypothetical about the failure mode: an Edge Function is
-- killed at the end of its wall-clock budget, and a batch of two hundred books
-- is exactly the request that reaches it.
--
-- THE STATEMENTS ARE MOVED, NOT REWRITTEN. Each function below is the same
-- statements in the same order with the same values, inside one transaction.
-- The validation stays in TypeScript where it is tested — what changes is that
-- the writes either all happen or none do.
--
-- WHY NOT ONE `move_books` WITH A MODE FLAG. Four operations that set different
-- columns, release different rows and write different history actions are not
-- one operation with a parameter; the flag would be a switch statement with the
-- same four bodies inside it and one more thing to get wrong at the call site.
--
-- WHAT IS DELIBERATELY NOT HERE: the reads that decide whether a move is
-- allowed. Those are in books.ts, they are covered by tests, and moving them
-- would be the rewrite this migration is written to avoid. The functions take
-- an already-judged list of book indexes.
--
-- DATA LOSS RISK: NO. Four functions are added. No table, column or row is
-- touched by this migration itself.

-- ============ ISSUE ============
-- The predicate is the point and it is carried over exactly. issueBooks does
-- not update the books it was given: it updates the ones that are STILL free,
-- and reads back which rows that matched, so two organisers issuing the same
-- run a second apart cannot both succeed. Three cases, because a forced issue
-- takes anything, an ordinary one takes Unassigned, and a book brought back
-- with nothing sold out of it is free again although its status says Returned.
--
-- Returns the books actually written, so the caller can report the rest as
-- taken meanwhile, exactly as it does today.
create or replace function issue_books_tx(
  p_idxs           integer[],
  p_empty_returned integer[],
  p_agent_id       text,
  p_due_at         date,
  p_user           text,
  p_note           text default '',
  p_force          boolean default false
) returns table (idx integer, number text) as $$
declare
  issued integer[];
begin
  with written as (
    update books b set
      status = 'Out',
      held_by_agent = p_agent_id,
      issued_at = now(),
      due_at = p_due_at,
      modified_by = p_user
     where b.idx = any(p_idxs)
       and (
         p_force
         or (b.status = 'Unassigned' and not (b.idx = any(coalesce(p_empty_returned, '{}'))))
         or (b.status = 'Returned'   and b.idx = any(coalesce(p_empty_returned, '{}')))
       )
    returning b.idx, b.number
  )
  select array_agg(w.idx order by w.idx) into issued from written;

  if issued is null then
    return;                       -- nothing matched; the caller says so
  end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'issue', p_user, coalesce(p_note, '')
    from unnest(issued) i order by i;

  return query
    select b.idx, b.number from books b where b.idx = any(issued) order by b.idx;
end $$ language plpgsql;

-- ============ BRING BACK ============
create or replace function return_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- The history row names who it came FROM, so it is read before the update
  -- clears nothing — held_by_agent deliberately survives a return, which is how
  -- "brought back by" keeps a name on it.
  insert into book_history (book_idx, from_agent, action, by_user, note)
  select b.idx, b.held_by_agent, 'return', p_user, coalesce(p_note, '')
    from books b where b.idx = any(p_idxs) order by b.idx;

  update books set status = 'Returned', modified_by = p_user
   where idx = any(p_idxs);
  get diagnostics moved = row_count;

  -- A ticket held for a buyer who never came is stock again the moment the
  -- book is on the desk. Sold ones are untouched.
  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', recorded_by = p_user
   where book_idx = any(p_idxs) and status = 'Reserved';

  return moved;
end $$ language plpgsql;

-- ============ PASS TO SOMEBODY ELSE ============
create or replace function transfer_books_tx(
  p_idxs     integer[],
  p_to_agent text,
  p_user     text,
  p_note     text default ''
) returns integer as $$
declare
  moved integer;
begin
  insert into book_history (book_idx, from_agent, to_agent, action, by_user, note)
  select b.idx, b.held_by_agent, p_to_agent, 'transfer', p_user, coalesce(p_note, '')
    from books b where b.idx = any(p_idxs) order by b.idx;

  update books set held_by_agent = p_to_agent, modified_by = p_user
   where idx = any(p_idxs);
  get diagnostics moved = row_count;

  return moved;
end $$ language plpgsql;

-- ============ BACK ON THE SHELF ============
-- The one with money in it. Clearing amount_paid takes the settlement figure
-- off the book, and the payments that made up that figure stay in the ledger —
-- so they are reversed in the same breath, or the book and the ledger disagree
-- from the moment this returns. That reversal used to be one statement and the
-- clearing another.
create or replace function restock_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- Reverse each settlement payment that is not already reversed. Written as
  -- one insert-select so the "is it already undone" check and the write cannot
  -- be separated by another session's reversal.
  insert into payments (agent_id, amount, received_by, method, book_idx, source, reverses, note)
  select p.agent_id, -p.amount, p_user, coalesce(p.method, 'cash'), p.book_idx, 'settlement',
         p.id, 'Reversed: book put back on the shelf'
    from payments p
   where p.book_idx = any(p_idxs)
     and p.source = 'settlement'
     and p.reverses is null
     and not exists (select 1 from payments r where r.reverses = p.id);

  insert into book_history (book_idx, from_agent, action, by_user, note)
  select b.idx, b.held_by_agent, 'restock', p_user,
         coalesce(nullif(p_note, ''),
                  case when b.declared_sold is not null
                       then 'Settlement of ' || b.declared_sold || ' cleared.'
                       else '' end)
    from books b where b.idx = any(p_idxs) order by b.idx;

  update books set
    status = 'Unassigned', held_by_agent = null,
    issued_at = null, due_at = null,
    declared_sold = null, amount_due = null, amount_paid = null,
    settled_at = null, settled_by = '', settled_by_agent = null, notes = '',
    modified_by = p_user
   where idx = any(p_idxs);
  get diagnostics moved = row_count;

  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', buyer_zone = '',
    sold_by_agent = null, amount = null, payment_status = '', sold_at = null,
    source = '', recorded_by = p_user
   where book_idx = any(p_idxs) and status in ('Available', 'Reserved');

  return moved;
end $$ language plpgsql;

-- Called by the Edge Function under the service role, and by nobody else: these
-- take an already-judged list of books and do not re-check who may move them.
revoke execute on function issue_books_tx(integer[], integer[], text, date, text, text, boolean) from public, anon, authenticated;
revoke execute on function return_books_tx(integer[], text, text) from public, anon, authenticated;
revoke execute on function transfer_books_tx(integer[], text, text, text) from public, anon, authenticated;
revoke execute on function restock_books_tx(integer[], text, text) from public, anon, authenticated;
