/*
 * THE BOTTOM RUNG IS A METAL LIKE THE OTHERS.
 *
 * The supporter bands were Faithful, Silver, Gold and Diamond. The bottom one
 * is now Bronze, and this migration is the database catching up with a word
 * that changed in the code.
 *
 * WHY IT CHANGED, since a rename with no reason attached gets reverted by the
 * next person who prefers the old one. Faithfulness is continuity — somebody
 * who keeps coming back — and the band is computed from ONE raffle's holding.
 * It called a first-time buyer of a single ticket faithful, which is a claim
 * about a person that the rows underneath it cannot support, on a page whose
 * entire job is that every claim it makes can be checked. "Bronze" says where
 * somebody stands on a ladder and claims nothing about them, completes a scale
 * that was already three-quarters metal, and drops a religious reading that
 * landed on every small buyer whether or not it was theirs to carry.
 *
 * The thresholds moved in the same change — Silver 1, Gold 3, Diamond 6 books,
 * down from 1, 4 and 10 — but thresholds live in
 * supabase/functions/_shared/ranks.ts and nothing about them is stored, so
 * there is nothing here for them to do.
 */

/*
 * NOTHING READS OR WRITES THIS COLUMN TODAY, and it is still worth an edit.
 *
 * The band stopped being frozen at mint when `holding_of` arrived: the check
 * page resolves a code to its buyer's current tickets and works the band out
 * live, so `rank` holds only what was written before that, and the column is
 * kept rather than dropped because a raffle that minted receipts in between
 * has real answers in it.
 *
 * So this constraint fires on no write that exists. It is a loaded trap rather
 * than a live fault: the day somebody revives the stored band — and the column
 * is sitting there inviting exactly that — an insert of 'bronze' would be
 * refused by a rule naming four bands, one of which no longer exists. The
 * failure would land on a live raffle, at a sale, with a constraint error
 * naming a word nobody had seen in months.
 *
 * 'faithful' STAYS IN THE ALLOWED SET. Rows minted before today carry it, and
 * a check constraint is validated against the table it is added to: dropping
 * the old word would make this migration fail on precisely the raffles that
 * have the history worth keeping. The set is "every band that has ever been",
 * not "every band there is".
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
    check (rank is null or rank in ('bronze', 'faithful', 'silver', 'gold', 'diamond'));
end $$;

comment on column ticket_receipts.rank is
  'Supporter band frozen on a receipt minted before the band was worked out live: bronze, silver, gold or diamond, or the retired faithful, which bronze replaced on 2026-09-22. Null means it was not worked out. Nothing reads or writes this column now — the check page counts the buyer''s current tickets through holding_of — and it is kept because the answers already in it are real. Never back-filled.';
