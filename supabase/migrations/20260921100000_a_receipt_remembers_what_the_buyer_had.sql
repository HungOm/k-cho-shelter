/*
 * A RECEIPT REMEMBERS WHAT THE BUYER HAD WHEN IT WAS MADE.
 *
 * The raffle thanks its larger supporters by name — Faithful, Silver, Gold,
 * Diamond — and the band has to be provable, not typed in. It is worked out
 * from the tickets somebody actually holds, and that count lives in `tickets`,
 * keyed by the buyer's telephone number.
 *
 * WHICH IS EXACTLY WHY IT IS COPIED HERE. The page that states the band in
 * public is the ticket-check page, and that function is forbidden from touching
 * a buyer's telephone number at all: tests/verify names `buyer_name` as the one
 * buyer field it may carry, and refuses every other by prefix. It cannot count
 * a buyer's tickets without becoming able to identify them, and it should not
 * become able to.
 *
 * So the band is computed once, on the server that is allowed to see the buyer,
 * at the moment the receipt is minted, and stored on the receipt as two plain
 * facts: the band, and the number of tickets it was worked out from. The check
 * page then reads a word and a number that say nothing about who anybody is.
 *
 * FROZEN AT MINT, AND THAT IS THE RIGHT TENSE. A receipt is a record of one
 * purchase on one day. If somebody buys four more books next month, the new
 * receipt carries the new band and this one still says what was true when it
 * was handed over — which is what a receipt is for. Nothing back-fills.
 *
 * Both columns are nullable rather than defaulted. Null means "not worked out"
 * — a receipt minted before this existed, or a buyer with no telephone number
 * recorded — and the check page shows no band at all for it. A default of
 * 'faithful' would have written the bottom rung onto every receipt in the
 * table, including the ones belonging to the raffle's largest supporters.
 */
alter table ticket_receipts add column if not exists rank text;
alter table ticket_receipts add column if not exists rank_tickets integer;

/*
 * The band is one of four words or nothing. Constrained in the database as well
 * as in the code that writes it, because the check page reads this column
 * straight out and renders it: a value that is not a band is a value that has
 * no translation and no styling, and the first place anybody would see it is on
 * a page a stranger is holding.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_receipts_rank_known'
  ) then
    alter table ticket_receipts
      add constraint ticket_receipts_rank_known
      check (rank is null or rank in ('faithful', 'silver', 'gold', 'diamond'));
  end if;
end $$;

comment on column ticket_receipts.rank is
  'Supporter band at the time this receipt was minted: faithful, silver, gold or diamond. Null means it was not worked out — no telephone number recorded, or a receipt older than this column. Never back-filled.';
comment on column ticket_receipts.rank_tickets is
  'How many tickets the band was worked out from. Stored beside it so the band can be checked rather than taken on trust.';
