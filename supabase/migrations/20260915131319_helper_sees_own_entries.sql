-- A helper reads the buyers they wrote down, and no others.
--
-- A helper (recorder) is usually a volunteer at a desk for one afternoon. Until
-- now they read every buyer in the raffle — name, telephone number, area and the
-- note about them, several thousand rows of it, most of them refugees. A desk
-- shift is not a reason to hold that list.
--
-- Everyone still sees every ticket's NUMBER and STATUS: "is 03291 still going?"
-- must have an answer for anybody or the raffle cannot be worked. And
-- sold_by_agent stays visible, with agents_readable still giving a helper the
-- seller's telephone number — so the route to a buyer they did not record is to
-- ring the seller, which is how this organisation actually escalates.
--
-- THE OTHER HALF IS ALREADY LIVE. mask() in the api Edge Function was deployed
-- with version 30 and narrows the same way for callers on ?directreads=off.
-- Until this migration runs, the two disagree: direct reads (the default) are
-- unnarrowed and the function path is narrowed. This closes that gap.
--
-- Only the view. rls.sql also carries check_in_reports RLS belonging to the
-- check-in work; applying that file whole is how the wrong thing ships.

drop view if exists tickets_readable;
create view tickets_readable as
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
  sold_by_agent, amount, payment_status, sold_at,
  case when mine then notes else '' end as notes,
  source, version, recorded_by, modified_at
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
