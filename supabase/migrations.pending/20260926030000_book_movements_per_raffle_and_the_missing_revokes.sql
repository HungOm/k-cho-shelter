/*
 * MULTI-TENANCY STAGE 2 (MT-2d): the three book movements, and the revokes
 * that every p_project sibling needed and none of them had.
 *
 * THE PRIVILEGE HALF IS THE IMPORTANT HALF. A REVOKE names an exact signature,
 * and `create or replace function` carries privileges across only when it
 * replaces the SAME signature. A sibling overload taking p_project is a brand
 * new function object, and Postgres grants EXECUTE on a new function to PUBLIC
 * by default — so every sibling added for Stage 2 arrived publicly callable,
 * sitting one line below an original that was correctly revoked. Measured with
 * has_function_privilege rather than read: anon could call all of them.
 *
 * `active_tickets(uuid)` KEEPS authenticated, and that is measured too.
 * Revoking it there breaks tickets_readable and book_ledger with "permission
 * denied for function active_tickets" — a definer view runs its TABLE access
 * as the view owner but still checks FUNCTION execute against the calling
 * role, which is not what `security_invoker = false` reads like it does. What
 * remains after anon is revoked is recorded as D-035 for Stage 3.
 *
 * service_role is named nowhere. Revoking PUBLIC does not touch the separate
 * grant Supabase's own template gives service_role on functions in this
 * schema, which is why the equivalent lines for the original signatures have
 * always been enough for the Edge Function to keep working.
 *
 * THE FUNCTIONS THEMSELVES: issue, return and transfer each matched books by
 * `idx = any(p_idxs)` alone. idx is still the global primary key through Stage
 * 4, so an issue naming another organisation's book idx would have taken that
 * book out from under its own seller. return_books_tx also freed reserved
 * TICKETS by book idx, which is the same reach one table further on. Each
 * write and each history row is now scoped to p_project, and the history rows
 * are stamped with it explicitly rather than left to the column default.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function issue_books_tx(
  p_idxs           integer[],
  p_empty_returned integer[],
  p_agent_id       text,
  p_due_at         date,
  p_user           text,
  p_project        uuid,
  p_note           text default '',
  p_force          boolean default false
) returns table (idx integer, number text) as $$
declare
  issued integer[];
begin
  with written as (
    -- b.idx = any(p_idxs) IS NOT ENOUGH. idx is still the global PK through
    -- Stage 4, so without project_id an issue naming another organisation's
    -- book idx would take that book out from under its own seller — an
    -- ordinary-looking issue call reaching across the wall entirely.
    update books b set
      status = 'Out',
      held_by_agent = p_agent_id,
      issued_at = now(),
      due_at = p_due_at,
      modified_by = p_user
     where b.idx = any(p_idxs)
       and b.project_id = p_project
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

  -- Stamped explicitly, matching the books it just wrote rather than left to
  -- the column default: the two must agree, and an explicit p_project is what
  -- the write above was already asked for.
  insert into book_history (book_idx, to_agent, action, by_user, note, project_id)
  select i, p_agent_id, 'issue', p_user, coalesce(p_note, ''), p_project
    from unnest(issued) i order by i;

  return query
    select b.idx, b.number from books b where b.idx = any(issued) order by b.idx;
end $$ language plpgsql;

create or replace function issue_books_tx(
  p_idxs           integer[],
  p_empty_returned integer[],
  p_agent_id       text,
  p_due_at         date,
  p_user           text,
  p_note           text default '',
  p_force          boolean default false
) returns table (idx integer, number text) as $$
  select * from issue_books_tx(
    p_idxs, p_empty_returned, p_agent_id, p_due_at, p_user,
    coalesce(current_project(), seed_project()), p_note, p_force)
$$ language sql;

create or replace function return_books_tx(
  p_idxs   integer[],
  p_user   text,
  p_project uuid,
  p_note   text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- The history row names who it came FROM, so it is read before the update
  -- clears nothing — held_by_agent deliberately survives a return, which is how
  -- "brought back by" keeps a name on it.
  insert into book_history (book_idx, from_agent, action, by_user, note, project_id)
  select b.idx, b.held_by_agent, 'return', p_user, coalesce(p_note, ''), p_project
    from books b where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx;

  -- WITHOUT project_id, this would return a book by idx alone: another
  -- organisation's book number colliding with one of these idxs would be
  -- marked Returned in a raffle its own seller never touched.
  update books set status = 'Returned', modified_by = p_user
   where idx = any(p_idxs) and project_id = p_project;
  get diagnostics moved = row_count;

  -- A ticket held for a buyer who never came is stock again the moment the
  -- book is on the desk. Sold ones are untouched. Scoped through the book's
  -- own project rather than repeating the array test, so a ticket cannot be
  -- freed by naming a book idx that belongs to a different raffle.
  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', recorded_by = p_user
   where book_idx in (select idx from books where idx = any(p_idxs) and project_id = p_project)
     and status = 'Reserved';

  return moved;
end $$ language plpgsql;

create or replace function return_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
  select return_books_tx(p_idxs, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

create or replace function transfer_books_tx(
  p_idxs     integer[],
  p_to_agent text,
  p_user     text,
  p_project  uuid,
  p_note     text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- p_to_agent is an agent_id, still a global PK through Stage 4, so it names
  -- no project by itself. Scoping the read and the write both to p_project is
  -- what stops a transfer naming another raffle's book idx from moving it to
  -- an agent in THIS raffle — a book leaving its own organisation entirely.
  insert into book_history (book_idx, from_agent, to_agent, action, by_user, note, project_id)
  select b.idx, b.held_by_agent, p_to_agent, 'transfer', p_user, coalesce(p_note, ''), p_project
    from books b where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx;

  update books set held_by_agent = p_to_agent, modified_by = p_user
   where idx = any(p_idxs) and project_id = p_project;
  get diagnostics moved = row_count;

  return moved;
end $$ language plpgsql;

create or replace function transfer_books_tx(
  p_idxs     integer[],
  p_to_agent text,
  p_user     text,
  p_note     text default ''
) returns integer as $$
  select transfer_books_tx(p_idxs, p_to_agent, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

-- ---------------------------------------------------------------------------
-- AND THE REVOKES, which are the whole reason this migration is not just three
-- functions. Every line names an exact signature, because that is the only
-- thing a REVOKE can name.
-- ---------------------------------------------------------------------------
revoke execute on function issue_books_tx(integer[], integer[], text, date, text, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function return_books_tx(integer[], text, uuid, text) from public, anon, authenticated;
revoke execute on function transfer_books_tx(integer[], text, text, uuid, text) from public, anon, authenticated;
revoke execute on function desk_money(uuid) from public, anon, authenticated;
revoke execute on function ensure_holding_tx(text, text, text, text) from public, anon, authenticated;
revoke execute on function ensure_holding_tx(text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function active_tickets(uuid) from public, anon;
