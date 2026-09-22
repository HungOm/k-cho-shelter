/*
 * WHAT TO CALL A SUPPORTER IS THE ORGANISER'S TO CHOOSE.
 *
 * The supporter ladder has been rewritten three times in two days — metals,
 * then a single fixed ladder of relationship words — and each time the argument
 * was about which vocabulary is right. It was the wrong argument. A raffle here
 * is an instrument rather than an event: the same app runs one for a community
 * centre, one for a refugee learning centre, one for a fellowship, one for a
 * shelter housing refugee patients with chronic and mental health conditions,
 * and one for whatever small community cause comes next. "Mentor" is right in
 * one of those rooms and meaningless in another, and no list written into the
 * code could be right in all five.
 *
 * So the rungs are configuration now. The code holds PRESETS to start from —
 * one per kind of fundraising — and this row holds what a particular raffle
 * settled on.
 *
 * WHAT IS STILL NOT CONFIGURABLE, because it is the whole reason the band can
 * be printed on a card and stated again on a public page: the band is COUNTED.
 * An organiser chooses what to call five books. Nobody chooses who has five
 * books, and there is no screen anywhere that awards a rank.
 *
 * BLANK IS THE REAL DEFAULT AND MEANS THE COMMUNITY CENTRE PRESET. Every
 * raffle already in flight has this blank and gets that ladder, and — the same
 * reasoning as CARD_LAYOUT — a raffle that has never touched this keeps
 * receiving later improvements to the defaults instead of being frozen at
 * whatever shipped the day it was set up. Community centre is the default
 * because it is the broadest room: one ticket reaches a family at the learning
 * centre and somebody at the fellowship, so the words that ship are the ones
 * true in every room.
 */
insert into config (key, value, notes) values
  ('SUPPORTER_BANDS', '', 'What this raffle calls its supporters, as JSON: {"preset":"<id>","rungs":[{"name":"...","minBooks":0}, ... x5]}, bottom rung first. Five rungs, thresholds in whole BOOKS and strictly ascending. Blank means the Community centre preset at 0/1/2/3/5 books, which is what every raffle had before this could be changed. The NAMES are the organiser''s; the count that earns one is not — the band is always worked out from the tickets a buyer holds.')
on conflict (key) do nothing;

/*
 * AND THE FROZEN COLUMN LEARNS THE SLOT IDS.
 *
 * `ticket_receipts.rank` holds bands frozen on receipts minted before the band
 * was worked out live. Nothing reads or writes it today — `holding_of` returns
 * six columns and rank is not among them, and every reply's band is computed at
 * scan time — so this is a loaded trap rather than a live fault, exactly as the
 * two migrations before it said.
 *
 * What changes here is the SHAPE of an id rather than another word. The rungs
 * used to be keyed on what they were called (`gold`, `bronze`, `family`), which
 * cannot survive names an organiser types in. They are keyed on POSITION now —
 * rung1 at the bottom to rung5 at the top — so a raffle calling rung4 "Keeper"
 * and another calling it "Patron" store the same thing.
 *
 * Every previous word stays legal. A CHECK is validated against the rows
 * already in the table, so a value that has ever been written has to stay in
 * the set or this statement fails on precisely the raffles whose history is
 * worth keeping. The set is every band that has ever been, not every band there
 * is.
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
      'rung1', 'rung2', 'rung3', 'rung4', 'rung5',
      'friend', 'neighbour', 'companion', 'family',
      'bronze', 'faithful', 'silver', 'gold', 'diamond'
    ));
end $$;

comment on column ticket_receipts.rank is
  'Supporter band frozen on a receipt minted before the band was worked out live. Today''s ids are positions on the ladder, rung1 (lowest) to rung5, because the NAMES are configurable per raffle; rows may also carry any of the retired word-ids. Null means it was not worked out. Nothing reads or writes this column now — the check page counts the buyer''s current tickets through holding_of — and it is kept because the answers already in it are real. Never back-filled.';
