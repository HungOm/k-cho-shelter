/*
 * A DIGITAL TICKET BELONGS TO A BUYER, NOT TO A PURCHASE.
 *
 * `ticket_receipts` was built as a receipt: minted per set, frozen at mint,
 * deduplicated on the exact tickets it covered. Every comment in printing.ts
 * and in schema.sql argues for that, and the argument is a good one — a
 * receipt is a record of one purchase on one day.
 *
 * It is not what the product needs, and the difference is the whole of this
 * migration. A TICKET is the artefact for one number: printed, or a digital
 * copy of the same thing, carrying its own QR, proving itself. A DIGITAL
 * TICKET is a different object — never printed, ONE PER BUYER, covering
 * everything they hold, behind one QR, and updated as they buy more.
 *
 * Under the old rule a buyer who bought a second book got a SECOND code and a
 * second link, and the first one went on showing a subset of what they held.
 * Two artefacts where the buyer believes there is one is the exact failure the
 * old dedupe comment set out to avoid, arrived at from the other direction.
 *
 * WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
 *
 *   buyer_phone      the key. Not the name: two buyers called "Ma Hla" are two
 *                    people, and this app has refused to identify anybody by
 *                    name since ranks.ts was written. Blank is not an identity
 *                    either — it is the absence of one — so the unique index
 *                    is PARTIAL and every phone-less row stays out of it.
 *
 *   the band         stops being frozen and starts being recomputed. It still
 *                    has to be STORED: the public check page is where it is
 *                    said out loud, and that function may never touch a
 *                    telephone number, so it cannot count. What changes is
 *                    that the number is refreshed with the holding rather than
 *                    written once — otherwise a buyer who reaches Diamond goes
 *                    on being shown Gold by a page that claims to be current.
 *
 *   old rows         are left exactly as they are. Nothing is rewritten and
 *                    nothing is backfilled: a receipt already minted keeps its
 *                    code, its items and the band it was minted with, and its
 *                    link goes on answering. It simply has no buyer on it, so
 *                    it is never reused, and the buyer's next digital ticket is
 *                    a new code that supersedes it. Backfilling would mean
 *                    choosing one of a buyer's old receipts to promote, on no
 *                    evidence, and the wrong choice is a link showing a subset.
 *
 * WHY THE WRITE IS A FUNCTION AND NOT THREE STATEMENTS.
 *
 * Refreshing a holding is: write the head, drop the items that are no longer
 * in it, add the ones that are. Done from the Edge Function that is three
 * round trips, and the window between the first and the last is a holding with
 * the wrong items in it. The bad half is not the extra work — it is that a
 * failure after the DELETE leaves a code with NO items, and the check page
 * answers a code with no items by saying the ticket is not verified. A real
 * buyer, holding a real link, told their tickets are not real. A plpgsql body
 * is one transaction, so there is no such moment.
 */

alter table ticket_receipts
  add column if not exists buyer_phone text not null default '';

/*
 * ONE HOLDING PER BUYER, enforced where it cannot be forgotten. Partial,
 * because '' is "we do not know who this is" and every legacy row carries it —
 * a plain unique index would have made the second such row an error.
 */
create unique index if not exists ticket_receipts_one_per_buyer
  on ticket_receipts (buyer_phone)
  where buyer_phone <> '';

/*
 * The holding, written whole.
 *
 * `p_code` is a freshly generated code the caller has ready; it is used ONLY
 * when this buyer has no holding yet. A buyer who already has one keeps the
 * code they were sent, which is the whole point — the link in their chat has
 * to go on being the right link after they buy more.
 */
create or replace function upsert_holding_tx(
  p_phone        text,
  p_idxs         integer[],
  p_code         text,
  p_user         text,
  p_rank         text,
  p_rank_tickets integer
) returns table (holding_code text, was_created boolean) as $$
declare
  found_code text;
  made       boolean := false;
  phone      text := btrim(coalesce(p_phone, ''));
begin
  -- Refused rather than defaulted. A holding with no buyer is a receipt, and
  -- the caller has a separate path for that; silently accepting '' here would
  -- pool every buyer with no number recorded into one shared digital ticket.
  if phone = '' then
    raise exception 'a digital ticket needs a buyer';
  end if;
  if p_idxs is null or array_length(p_idxs, 1) is null then
    raise exception 'a digital ticket needs at least one ticket';
  end if;

  select r.code into found_code
    from ticket_receipts r
   where r.buyer_phone = phone
   limit 1;

  if found_code is null then
    insert into ticket_receipts (code, created_by, buyer_phone, rank, rank_tickets)
      values (p_code, coalesce(p_user, ''), phone, p_rank, p_rank_tickets);
    found_code := p_code;
    made := true;
  else
    -- The band travels with the holding, so it is rewritten every time the
    -- holding is. See the note at the top about why it is stored at all.
    update ticket_receipts r
       set rank = p_rank, rank_tickets = p_rank_tickets
     where r.code = found_code;
  end if;

  /*
   * ADD BEFORE REMOVE would be the other order and is the wrong one here only
   * because both are inside one transaction anyway — so the order is chosen
   * for clarity instead: what is no longer held goes, then what is held
   * arrives. `on conflict do nothing` makes the second half idempotent, which
   * matters because the common case is a holding that grew by one book and
   * whose other forty rows are already exactly right.
   */
  delete from ticket_receipt_items ri
   where ri.code = found_code
     and not (ri.ticket_idx = any(p_idxs));

  insert into ticket_receipt_items (code, ticket_idx)
  select found_code, i from unnest(p_idxs) i
  on conflict (code, ticket_idx) do nothing;

  return query select found_code, made;
end $$ language plpgsql;
