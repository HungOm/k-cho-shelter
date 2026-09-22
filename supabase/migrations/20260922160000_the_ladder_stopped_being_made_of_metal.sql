/*
 * THE LADDER STOPPED BEING MADE OF METAL.
 *
 * Bronze, Silver, Gold and Diamond are now Friend, Neighbour, Companion and
 * Family. This migration is the database catching up with words that changed in
 * the code, and it is the second time today — the first renamed one rung, this
 * renames all four.
 *
 * WHY, because a rename with no reason attached gets reverted by whoever
 * prefers the old one. The raffle funds a community centre, a refugee learning
 * centre, Christian fellowships, and a shelter for refugee patients with
 * chronic and mental health conditions, and the tickets are sold INSIDE that
 * community, and a raffle is run again for whatever small community cause
 * comes next. The person holding a book is usually a neighbour of the people
 * it pays for. Metals are not wrong so much as empty — they could belong to any
 * charity on earth — and "Diamond supporter" is a luxury register on a card
 * carried by people who fled. Closeness is a real ladder, orders itself the
 * way people already order relationships, and says belonging rather than
 * charity. The full argument, including the vocabulary that was rejected and
 * why, is in supabase/functions/_shared/ranks.ts.
 *
 * Thresholds are untouched: 0, 1, 3 and 6 books. They live in that same file
 * and nothing about them is stored, so there is nothing here for them to do.
 */

/*
 * THE ALLOWED SET ONLY EVER GROWS, and by now it is carrying two retirements.
 *
 * `ticket_receipts.rank` holds bands frozen on receipts minted before the band
 * was worked out live. Nothing reads or writes it today — see the migration of
 * 2026-09-22 that added 'bronze', which explains at length why that is true and
 * why it still deserved the edit. A CHECK is validated against the rows already
 * in the table, so a word that has ever been written has to stay legal or this
 * statement fails on precisely the raffles with history worth keeping.
 *
 * So the list is EVERY BAND THAT HAS EVER BEEN: the four new ones, plus
 * 'bronze' (today, lasted hours) and 'faithful' (2026-09-21).
 *
 * AND NO, THAT DOES NOT STRAND A ROW THE CHECK PAGE CANNOT DRAW. The page maps
 * a band id to a string through a fixed table and draws nothing on a miss, so a
 * retired id reaching it would vanish silently — the inference anybody makes
 * here, and it does not follow, because nothing reads this column. `holding_of`
 * returns six columns and rank is not among them; every reply's band is worked
 * out at scan time by `rankFor`. `body.rank` is therefore always an id from
 * today's ladder. That property is what made renaming four rungs a change to
 * three files rather than a permanent compatibility map, and it is pinned in
 * tests/ranks as "a retired band id cannot reach the page".
 */
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'ticket_receipts_rank_known'
  ) then
    alter table ticket_receipts drop constraint ticket_receipts_rank_known;
  end if;

  alter table ticket_receipts
    add constraint ticket_receipts_rank_known
    check (rank is null or rank in (
      'friend', 'neighbour', 'companion', 'family',
      'bronze', 'faithful', 'silver', 'gold', 'diamond'
    ));
end $$;

comment on column ticket_receipts.rank is
  'Supporter band frozen on a receipt minted before the band was worked out live. Today''s ladder is friend, neighbour, companion, family; rows may also carry the retired bronze, faithful, silver, gold or diamond. Null means it was not worked out. Nothing reads or writes this column now — the check page counts the buyer''s current tickets through holding_of — and it is kept because the answers already in it are real. Never back-filled.';
