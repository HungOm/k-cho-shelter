/*
 * MULTI-TENANCY STAGE 2 (MT-2d): the four remaining book movements.
 *
 * restock, offer, accept and release each matched books by
 * `idx = any(p_idxs)` alone, and idx is the global primary key until Stage 4 —
 * so naming another organisation's book index was enough to move their book.
 *
 * restock_books_tx IS THE ONE THAT MATTERS, because it is the one with money
 * in it. It reverses a book's settlement payments, writes the same cash back
 * as a hand-over, clears the book and frees its tickets. Unscoped, a restock
 * naming another raffle's book index reversed THAT raffle's payments and wrote
 * the cash back as a hand-over from a seller who handed over nothing.
 * Demonstrated by removing the predicate again: the other raffle's settled
 * book came back "Unassigned" with its thirty gone.
 *
 * Two more that a reader might not expect, both because the ids are global
 * until Stage 4: offer_books_tx checked `exists (select 1 from agents where
 * agent_id = p_agent_id)` with no project, so another organisation's seller
 * was an acceptable person to offer this raffle's books to; and
 * accept_offer_tx compared `offered_to_agent` without one, so a seller could
 * accept a book offered to their namesake id elsewhere.
 *
 * A NOTE FOR ANYONE CALLING THESE BY HAND. With the sibling overloads in
 * place, a positional call whose project argument is an untyped literal
 * resolves to the OLD signature — `release_offer_tx(array[901], 't',
 * '<uuid>')` passes the project id as p_reason and runs against the ambient
 * raffle, returning 0 and looking exactly like correct scoping. PostgREST
 * calls by name, so the Edge Function is unaffected; psql, runbooks and
 * fixtures must write ::uuid.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function restock_books_tx(
  p_idxs    integer[],
  p_user    text,
  p_project uuid,
  p_note    text default ''
) returns integer as $$
declare
  moved integer;
begin
  /*
   * Reverse each settlement payment that is not already reversed, and write the
   * same money straight back as a hand-over, in one statement so that neither
   * can happen without the other.
   *
   * The reversal is bookkeeping: the book's amount_paid is about to be cleared
   * and that row is the same cash. The hand-over is the fact: the seller gave
   * the raffle this money and still has.
   */
  with undone as (
    insert into payments (agent_id, amount, received_by, method, book_idx, source, reverses, note)
    select p.agent_id, -p.amount, p_user, coalesce(p.method, 'cash'), p.book_idx, 'settlement',
           p.id, 'Reversed: book put back on the shelf'
      from payments p
     where p.book_idx = any(p_idxs)
       and p.project_id = p_project
       and p.source = 'settlement'
       and p.reverses is null
       -- r.project_id = p.project_id, not p_project: this asks whether THIS
       -- payment already has a reversal, and a reversal lives in the same
       -- raffle as the payment it reverses by construction.
       and not exists (select 1 from payments r
                        where r.reverses = p.id and r.project_id = p.project_id)
    returning agent_id, -amount as amount, book_idx, method
  )
  insert into payments (agent_id, amount, received_by, method, book_idx, source, note, project_id)
  select u.agent_id, u.amount, p_user, u.method, u.book_idx, 'hand',
         'Cash kept from the count-in of ' ||
         coalesce((select b.number from books b
                    where b.idx = u.book_idx and b.project_id = p_project), 'a book') ||
         ', which went back on the shelf', p_project
    from undone u
   where u.amount <> 0;

  insert into book_history (book_idx, from_agent, action, by_user, note, project_id)
  select b.idx, b.held_by_agent, 'restock', p_user,
         coalesce(nullif(p_note, ''),
                  case when b.declared_sold is not null
                       then 'Settlement of ' || b.declared_sold || ' cleared.'
                       else '' end), p_project
    from books b where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx;

  update books set
    status = 'Unassigned', held_by_agent = null,
    issued_at = null, due_at = null,
    declared_sold = null, amount_due = null, amount_paid = null,
    settled_at = null, settled_by = '', settled_by_agent = null, notes = '',
    modified_by = p_user
   where idx = any(p_idxs) and project_id = p_project;
  get diagnostics moved = row_count;

  -- Through the book's own project rather than repeating the array test, so a
  -- ticket cannot be freed by naming a book idx belonging to another raffle.
  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', buyer_zone = '',
    sold_by_agent = null, amount = null, payment_status = '', sold_at = null,
    source = '', recorded_by = p_user
   where book_idx in (select idx from books
                       where idx = any(p_idxs) and project_id = p_project)
     and project_id = p_project
     and status in ('Available', 'Reserved');

  return moved;
end $$ language plpgsql;

create or replace function restock_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
  select restock_books_tx(p_idxs, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

create or replace function offer_books_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_due_at   date,
  p_user     text,
  p_project  uuid,
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
  -- agent_id is the global primary key until Stage 4, so a seller id alone
  -- names no raffle: without the project this would accept another
  -- organisation's seller as the person to offer this raffle's books to.
  if not exists (select 1 from agents
                  where agent_id = p_agent_id and project_id = p_project) then
    raise exception 'AGENT_NOT_FOUND: no seller with id %', p_agent_id;
  end if;

  -- In book order, so two overlapping batches queue rather than deadlock.
  perform 1 from books b
   where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx for update;

  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs) and b.project_id = p_project and b.status <> 'Unassigned';

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
  /*
   * EVERY TICKET IN IT, not merely none sold.
   *
   * Asking about sales alone let through a book with tickets RESERVED or VOIDED
   * — not a whole book, and not ten tickets the seller can sell. The test is
   * that every ticket in the book is Available, which fails reserved, voided,
   * and any status invented later without this having to learn their names.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
     and b.project_id = p_project
     and exists (select 1 from tickets tk
                  where tk.book_idx = b.idx
                    and tk.project_id = b.project_id
                    and tk.status <> 'Available');

  if wrong > 0 then
    raise exception 'BOOK_NOT_WHOLE: % of % are not whole books — %',
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
     where b.idx = any(p_idxs) and b.project_id = p_project
       and b.status = 'Unassigned'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into offered from written w;

  if offered is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note, project_id)
  select i, p_agent_id, 'offer', p_user,
         coalesce(nullif(p_note, ''), 'Offered, waiting for the seller to accept'), p_project
    from unnest(offered) i order by i;

  return query select b.idx, b.number from books b
   where b.idx = any(offered) and b.project_id = p_project order by b.idx;
end $$ language plpgsql;

create or replace function offer_books_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_due_at   date,
  p_user     text,
  p_note     text default ''
) returns table (idx integer, number text) as $$
  select * from offer_books_tx(
    p_idxs, p_agent_id, p_due_at, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

create or replace function accept_offer_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_user     text,
  p_project  uuid,
  p_note     text default ''
) returns table (idx integer, number text) as $$
declare
  wrong     integer;
  offenders text;
  taken     integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    raise exception 'NOTHING_TO_ACCEPT: no books were named';
  end if;

  perform 1 from books b
   where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx for update;

  /*
   * NOT OFFERED TO YOU IS NOT AN ACCEPTANCE. Checked as one question — offered,
   * and offered to this seller — because splitting them into "is it offered"
   * and "is it yours" invites a later edit that answers only the first.
   *
   * And not offered in THIS raffle either: offered_to_agent holds an agent_id,
   * still global until Stage 4, so without the project a seller could accept a
   * book offered to their namesake id in another organisation.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
     and b.project_id = p_project
     and (b.status <> 'Offered' or b.offered_to_agent is distinct from p_agent_id);

  if wrong > 0 then
    raise exception 'NOT_OFFERED_TO_YOU: % of % are not waiting for you — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  with written as (
    update books b set
      status = 'Out',
      held_by_agent = p_agent_id,
      issued_at = now(),
      offered_to_agent = null,
      offered_at = null,
      offered_by = '',
      modified_by = p_user
     where b.idx = any(p_idxs) and b.project_id = p_project
       and b.status = 'Offered'
       and b.offered_to_agent = p_agent_id
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into taken from written w;

  if taken is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note, project_id)
  select i, p_agent_id, 'issue', p_user,
         coalesce(nullif(p_note, ''), 'Accepted by the seller'), p_project
    from unnest(taken) i order by i;

  return query select b.idx, b.number from books b
   where b.idx = any(taken) and b.project_id = p_project order by b.idx;
end $$ language plpgsql;

create or replace function accept_offer_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_user     text,
  p_note     text default ''
) returns table (idx integer, number text) as $$
  select * from accept_offer_tx(
    p_idxs, p_agent_id, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

create or replace function release_offer_tx(
  p_idxs    integer[],
  p_user    text,
  p_project uuid,
  p_reason  text default ''
) returns integer as $$
declare
  freed integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    return 0;
  end if;

  perform 1 from books b
   where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx for update;

  -- Silent about books that are not Offered. Unlike offering and accepting,
  -- this is a cleanup that runs from three places including an expiry sweep,
  -- and a sweep that raises on a book somebody already dealt with is a sweep
  -- that stops halfway.
  -- RETURNING is load-bearing here rather than tidy. Re-reading for "books
  -- that are now Unassigned" collects every book that was ALREADY on the shelf
  -- and was never part of this offer, and would write a release into their
  -- history and count them in the total. The UPDATE knows; the table does not.
  with written as (
    update books b set
      status = 'Unassigned',
      offered_to_agent = null,
      offered_at = null,
      offered_by = '',
      due_at = null,
      modified_by = p_user
     where b.idx = any(p_idxs) and b.project_id = p_project
       and b.status = 'Offered'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into freed from written w;

  if freed is null then return 0; end if;

  insert into book_history (book_idx, action, by_user, note, project_id)
  select i, 'release', p_user,
         coalesce(nullif(p_reason, ''), 'Offer ended without being accepted'), p_project
    from unnest(freed) i order by i;

  return array_length(freed, 1);
end $$ language plpgsql;

create or replace function release_offer_tx(
  p_idxs   integer[],
  p_user   text,
  p_reason text default ''
) returns integer as $$
  select release_offer_tx(p_idxs, p_user, coalesce(current_project(), seed_project()), p_reason)
$$ language sql;

-- ---------------------------------------------------------------------------
-- THE REVOKES. One line per exact signature, because that is all a REVOKE can
-- name, and a sibling overload is a new function object that Postgres grants
-- to PUBLIC by default.
-- ---------------------------------------------------------------------------
revoke execute on function restock_books_tx(integer[], text, uuid, text) from public, anon, authenticated;
revoke execute on function offer_books_tx(integer[], text, date, text, uuid, text) from public, anon, authenticated;
revoke execute on function accept_offer_tx(integer[], text, text, uuid, text) from public, anon, authenticated;
revoke execute on function release_offer_tx(integer[], text, uuid, text) from public, anon, authenticated;
