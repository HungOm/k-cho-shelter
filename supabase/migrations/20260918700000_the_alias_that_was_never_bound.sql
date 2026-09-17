-- Giving books out failed on the live site with a SQL error, and it was one letter.
--
-- Reported from production, from the "Give out books" sheet, with a run of
-- three books and a seller chosen:
--
--     missing FROM-clause entry for table "w"
--
-- issue_books_tx updates the books that are still free inside a CTE called
-- `written`, then reads back which rows matched:
--
--     select array_agg(w.idx order by w.idx) into issued from written;
--
-- `from written` binds the name `written`. Nothing binds `w`. The statement was
-- never valid and the fix is `from written w`.
--
-- WHY IT REACHED PRODUCTION, which is the part worth keeping. A plpgsql body is
-- not planned when the function is created — only the outer $$...$$ is parsed —
-- so `create or replace function` accepted it, the migration applied cleanly,
-- and the failure waited for the first person to give out a book. Every check
-- between here and there looked at something that passed: the function exists,
-- the migration applied, the Edge Function deployed, the client called it. The
-- raffle's most common act was broken between a clean deploy and a volunteer.
--
-- This migration recreates the function with the alias bound and changes
-- nothing else about it — same signature, same predicate, same three cases,
-- same history rows, same return. 20260917240000 is left as it was applied.
--
-- DATA LOSS RISK: NO. One function is replaced. No table, column or row is
-- read or written by this migration itself.

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
  -- ALIASED, and the alias is the whole of it: this read `from written` while
  -- selecting w.idx, so Postgres refused the statement with "missing
  -- FROM-clause entry for table "w" — at RUN time, because a plpgsql body is
  -- not planned until it executes. It created cleanly, deployed cleanly, and
  -- broke giving books out, which is the most common act in the raffle.
  select array_agg(w.idx order by w.idx) into issued from written w;

  if issued is null then
    return;                       -- nothing matched; the caller says so
  end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'issue', p_user, coalesce(p_note, '')
    from unnest(issued) i order by i;

  return query
    select b.idx, b.number from books b where b.idx = any(issued) order by b.idx;
end $$ language plpgsql;

-- Restated rather than assumed. `create or replace` keeps the privileges a
-- function already has, so these are unchanged on a live database — and on a
-- fresh one replayed from nothing they are what stops a browser calling it
-- directly, which is too important to leave resting on replacement semantics.
revoke execute on function issue_books_tx(integer[], integer[], text, date, text, text, boolean)
  from public, anon, authenticated;
