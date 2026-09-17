-- A seller could read every other seller's takings.
--
-- WHAT WAS TRUE UNTIL THIS. Any signed-in agent's browser held every active
-- ticket in the raffle with four columns filled in that were none of their
-- business: which seller sold it, for how much, whether that money had come in,
-- and who wrote it down. The BUYER's details were already masked. Nobody
-- noticed because no screen draws another seller's takings — but the data was
-- in the browser, and "no screen shows it" is not a permission.
--
-- WHAT IS DELIBERATELY NOT CHANGED: the row stays visible. Hiding another
-- seller's tickets was the obvious fix and it is the wrong one — sellers ask
-- each other whether a number is still going, and a hidden row makes an
-- available ticket indistinguishable from one that was never printed. The
-- comment explaining that has been in rls.sql since the view was written, and
-- test-rls.sh has asserted it since. The gap the review names is the takings,
-- not the row's existence.
--
-- So: status and sold_at stay readable by everyone, because "is this one gone,
-- and when" is the availability question and it reveals nothing about money.
-- sold_by_agent, amount, payment_status and recorded_by go behind the same
-- `mine` gate the buyer's name and telephone number already use — one rule
-- about whose ticket this is, rather than two that can drift apart.
--
-- An organiser, a viewer and a helper are untouched. The draw has to be
-- runnable and the totals checkable by somebody holding no books.
--
-- THE BASE-TABLE POLICY gains the two custody clauses at the same time. It is
-- unreachable from a browser — `tickets` is revoked from `authenticated` — and
-- it is kept correct so that it stays a second lock rather than a stale one.
-- Both clauses are DORMANT today, for three reasons rather than one, and the
-- policy itself lists them. The one worth knowing here: ticket_movements has
-- row security enabled and no policy, so the ledger clause answers nothing to a
-- browser role even after the issue path is wired to it. What carries every
-- seller now is the book they are holding.
--
-- WHY A MIGRATION AND NOT JUST rls.sql: 20260915131319 recreates
-- tickets_readable and runs after rls.sql in the documented deploy order.
-- Changing only rls.sql gives a fresh install the new masking and every
-- existing database the old one — and the existing database is the one with
-- sellers on it.
--
-- DATA LOSS RISK: NO. One view and one policy are replaced. No row is touched.

drop view if exists tickets_readable;
create view tickets_readable with (security_invoker = false) as
select
  idx, number, book_idx,
  -- The book's NUMBER, not just its index. The app keys everything by book
  -- number — the grid, search, "where is this ticket" — and deriving it in the
  -- client would mean reimplementing the numbering here and there, with
  -- TICKETS_PER_BOOK able to change under both. A book number computed two ways
  -- is the same class of bug as a phone number masked two ways.
  book_number,
  status,
  case when mine then buyer_name else '' end as buyer_name,
  case
    -- Same shape as both backends' maskers. A phone hidden three different
    -- ways across three code paths reads as three different applications.
    when app_role() = 'viewer' and buyer_phone <> ''
      then '••••' || right(buyer_phone, 3)
    when mine then buyer_phone
    else ''
  end as buyer_phone,
  case when mine then buyer_zone else '' end as buyer_zone,
  /*
   * ANOTHER SELLER'S MONEY, WHICH IS WHAT "THEIR RECORDS" MEANS.
   *
   * The row stays. Sellers ask each other whether a number is still going, and
   * hiding the row makes an available ticket indistinguishable from one that
   * was never printed — the reason this view shows every ticket is written out
   * below and it is a good one.
   *
   * What does NOT belong to a seller is the rest of another seller's page: who
   * sold it, for how much, whether that money came in, and who wrote it down.
   * Those four went out to every signed-in agent for the whole raffle, which is
   * the gap the review names — not the row's existence, which is fine.
   *
   * Through the same `mine` gate the buyer's details already use, so there is
   * one rule about whose ticket this is rather than two that can drift. An
   * organiser, a viewer and a helper are unchanged: the draw has to be runnable
   * and the totals checkable by somebody holding no books.
   *
   * Status and sold_at stay visible to everyone: "is this one gone, and when"
   * is the availability question, and answering it reveals nothing about who
   * holds the money.
   */
  case when mine or app_role() <> 'agent' then sold_by_agent else null end as sold_by_agent,
  case when mine or app_role() <> 'agent' then amount else null end as amount,
  case when mine or app_role() <> 'agent' then payment_status else '' end as payment_status,
  sold_at,
  case when mine then notes else '' end as notes,
  source, version,
  case when mine or app_role() <> 'agent' then recorded_by else '' end as recorded_by,
  modified_at
from (
  select t.*,
         b.number as book_number,
         /*
          * WHOSE BUYER DETAILS THIS PERSON MAY READ.
          *
          * Everyone sees every ticket's NUMBER and STATUS — "is 03291 still
          * going?" must have an answer for anybody, or the raffle cannot be
          * worked. What `mine` gates is the buyer: their name, telephone
          * number, area and the note about them. Most of those people are
          * refugees, and the list is several thousand long.
          *
          * An agent: the books physically in their hands.
          * A helper: the sales THEY wrote down. They are usually a volunteer at
          *   a desk for an afternoon, and a desk shift is not a reason to hold
          *   every buyer in the raffle. Where they need to reach a buyer they
          *   did not record, the route is the seller — sold_by_agent stays
          *   visible and agents_readable gives them that person's number.
          * An organiser: everyone. Somebody has to be able to run the draw.
          */
         (case app_role()
            when 'agent' then
              t.book_idx in (select idx from books where held_by_agent = app_agent_id())
            when 'recorder' then
              t.recorded_by = auth_email()
            else true
          end) as mine
  from tickets t
  -- Left, not inner: a ticket whose book row is missing must still be readable.
  -- Dropping it would hide a sold ticket from the draw over a bookkeeping fault.
  left join books b on b.idx = t.book_idx
  where app_role() is not null
    and t.idx <= active_tickets()
) v;

grant select on tickets_readable to authenticated;

drop policy if exists tickets_read on tickets;
create policy tickets_read on tickets for select using (
  app_role() is not null
  -- Held back: generated but not in play. Not merely hidden in the interface —
  -- not readable at all, so a held-back buyer cannot leak through a crafted
  -- query either.
  and idx <= active_tickets()
  -- An agent sees only the books they are carrying. Everybody else on the
  -- allowlist sees the whole raffle, which is what recording sales requires.
  and (
    app_role() <> 'agent'
    or book_idx in (select idx from books where held_by_agent = app_agent_id())
    -- Held directly, or held at some point according to the ledger. Kept in
    -- step with tickets_readable so the two cannot drift.
    --
    -- BOTH CLAUSES ARE DORMANT, AND FOR THREE SEPARATE REASONS. Whoever wakes
    -- the custody ledger will need all three, because fixing one leaves the
    -- clause looking live and behaving dead:
    --   1. `tickets` is revoked from `authenticated`, so no browser role
    --      reaches this policy at all today.
    --   2. Nothing writes tickets.holder except move_tickets, and no screen
    --      calls it — every seller is carried by the book they hold.
    --   3. ticket_movements has row security ENABLED AND NO POLICY, so this
    --      subquery returns nothing to any non-superuser even once the other
    --      two are fixed. It fails closed, which is the safe direction: a
    --      seller would be denied a ticket they hold rather than shown one
    --      they do not. Granting the read means giving that table a policy,
    --      not just granting select on `tickets`.
    or holder = app_agent_id()
    or exists (
      select 1 from ticket_movements m
       where m.ticket_idx = tickets.idx
         and app_agent_id() in (m.from_holder, m.to_holder)
    )
  )
);
