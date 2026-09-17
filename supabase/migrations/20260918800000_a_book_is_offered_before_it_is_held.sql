-- Handing a book over takes two people, and until now it took one.
--
-- WHAT WAS TRUE UNTIL THIS. An organiser picked books and a seller was holding
-- them. Not "was told about them" — holding them, in the only sense this system
-- has: books.held_by_agent named them, so the money for those books was on
-- their balance, they appeared on the chase list when the books went overdue,
-- and the settle screen asked them to account for stock they might never have
-- touched. A mistyped seller was liable and the only way out was an organiser
-- noticing and transferring the books away.
--
-- The other direction already had two people. A seller can ASK for books
-- (PETITIONS in approvals.ts) and an organiser grants it, and the comment there
-- is exact about why: "the organiser agrees, THE ORGANISER hands it over". That
-- is a handshake. Going the other way there was none, and giving out is the
-- direction almost every book travels.
--
-- SO: OFFERED, THEN OUT. An organiser offers; nothing moves. The seller accepts;
-- the book becomes theirs. Between the two the book is reserved — no other
-- organiser can offer it and no seller can be given it — and it is on nobody's
-- balance, which is the whole point. An offer nobody answers expires and the
-- book goes back on the shelf.
--
-- WHAT THIS DELIBERATELY DOES NOT CLAIM. The paper book may physically be in
-- the seller's hands the moment the organiser hands it across the table, while
-- this database still says 'Offered'. That gap is real and it is the price of
-- the choice: being wrong about where the paper is, for a few minutes, is
-- recoverable, and being wrong about whose money it is, for a fortnight, is
-- what sends somebody to chase a volunteer for a book they never took.
--
-- THE INVARIANT, AND IT IS THE ONLY ONE WORTH A CONSTRAINT: an offered book is
-- on nobody's balance. held_by_agent is what every money view reads —
-- book_ledger, agent_money, the chase list — so if that column is null while
-- the book is Offered, every one of them is already correct with no change.
-- That is why the reservation is a separate column and not held_by_agent with
-- a flag beside it: a flag has to be remembered by every reader, and a null
-- cannot be forgotten.
--
-- offered_to_agent is `on delete set null` to match held_by_agent. That leaves
-- a book Offered to nobody if a seller is deleted mid-offer, which is untidy
-- rather than dangerous — release_offer_tx frees such a book without caring who
-- it was for, and the check constraint deliberately does NOT require
-- offered_to_agent to be present, so deleting a seller can never be refused by
-- a row this feature created.
--
-- EVERY REFERENCE TO idx AND number IS ALIASED, and that is not house style —
-- it is required. `returns table (idx integer, number text)` declares OUT
-- parameters with those names, and they shadow the table's own columns in any
-- unqualified reference:
--
--     ERROR: column reference "idx" is ambiguous
--     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- A plpgsql body is not planned until it RUNS, so this migration applies
-- cleanly, a deploy verifies cleanly, and the first person to press the button
-- finds it. That is exactly how issue_books_tx reached the live site broken on
-- 18 September. It was caught here by calling the function rather than by
-- installing it.
--
-- DATA LOSS RISK: NO. One check constraint is widened, four columns are added,
-- three functions are created. No existing row changes: nothing is Offered yet.

-- ============ THE STATE ============

alter table books drop constraint if exists books_status_check;
alter table books add constraint books_status_check
  check (status in ('Unassigned','Offered','Out','Returned','Settled','Lost','Void'));

alter table books add column if not exists offered_to_agent text
  references agents(agent_id) on delete set null;
alter table books add column if not exists offered_at timestamptz;
alter table books add column if not exists offered_by text not null default '';

-- The money invariant, as a constraint rather than as a habit. Named so the
-- failure says what was violated rather than naming a column.
alter table books drop constraint if exists books_offered_is_on_nobodys_balance;
alter table books add constraint books_offered_is_on_nobodys_balance
  check (status <> 'Offered' or held_by_agent is null);

-- Who has to answer. Null on every row that exists today and on every
-- two-person control and petition, which are answered by an organiser or the
-- system admin as they always were. Not a foreign key: a decided row is
-- history, and history must survive the seller being deleted.
alter table pending_approvals add column if not exists decide_by_agent text;

create index if not exists books_offered_to_idx
  on books (offered_to_agent) where status = 'Offered';
create index if not exists pending_approvals_decide_by_idx
  on pending_approvals (decide_by_agent) where status = 'Pending';

-- ============ OFFER ============
--
-- ALL OR NOTHING, like every other book operation here. A batch whose premise
-- is wrong for one book is a batch somebody has misread, and offering the other
-- nine hides it. The offenders are named, because "3 books are not free" sends
-- somebody to a list and "Book-041, Book-042" sends them to the shelf.
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

-- ============ ACCEPT ============
--
-- The seller's half. Everything issue_books_tx does, from the Offered state
-- rather than from the shelf, and only for the seller the books were offered
-- to — an acceptance by anybody else is not an acceptance.
create or replace function accept_offer_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_user     text,
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

  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

  /*
   * NOT OFFERED TO YOU IS NOT AN ACCEPTANCE. Checked as one question — offered,
   * and offered to this seller — because splitting them into "is it offered"
   * and "is it yours" invites a later edit that answers only the first.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
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
     where b.idx = any(p_idxs) and b.status = 'Offered'
       and b.offered_to_agent = p_agent_id
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into taken from written w;

  if taken is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'issue', p_user,
         coalesce(nullif(p_note, ''), 'Accepted by the seller')
    from unnest(taken) i order by i;

  return query select b.idx, b.number from books b where b.idx = any(taken) order by b.idx;
end $$ language plpgsql;

-- ============ RELEASE ============
--
-- ONE FUNCTION FOR EVERY WAY AN OFFER ENDS WITHOUT BEING ACCEPTED: the seller
-- declines, the organiser withdraws, or nobody answers and it expires. Three
-- callers, one behaviour — because an offer released two ways is an offer
-- released two slightly different ways by next year, and the difference will be
-- whether the book got back on the shelf.
--
-- It does NOT care who the book was offered to. An offer whose seller has since
-- been deleted is exactly the one somebody needs to clear.
create or replace function release_offer_tx(
  p_idxs   integer[],
  p_user   text,
  p_reason text default ''
) returns integer as $$
declare
  freed integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    return 0;
  end if;

  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

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
     where b.idx = any(p_idxs) and b.status = 'Offered'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into freed from written w;

  if freed is null then return 0; end if;

  insert into book_history (book_idx, action, by_user, note)
  select i, 'release', p_user,
         coalesce(nullif(p_reason, ''), 'Offer ended without being accepted')
    from unnest(freed) i order by i;

  return array_length(freed, 1);
end $$ language plpgsql;

revoke execute on function offer_books_tx(integer[], text, date, text, text)
  from public, anon, authenticated;
revoke execute on function accept_offer_tx(integer[], text, text, text)
  from public, anon, authenticated;
revoke execute on function release_offer_tx(integer[], text, text)
  from public, anon, authenticated;
