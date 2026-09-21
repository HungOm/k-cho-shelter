/*
 * A LIVE HOLDING NEEDS NOTHING TO KEEP IT UP TO DATE.
 *
 * The migration before this one made a digital ticket one per buyer and kept
 * the tickets it covers in `ticket_receipt_items`, rewritten whenever anybody
 * sent it. That is better than a receipt per purchase and it is still wrong in
 * the way that matters: a STORED set goes stale. A buyer takes another book,
 * nobody opens their card, and the link in their chat goes on listing what
 * they held last week. "Updated as they buy more" turned out to mean "updated
 * when an organiser happens to press something".
 *
 * So the set is not stored at all. `holding_of` resolves a code to the buyer
 * behind it and returns the tickets they hold AT THE MOMENT SOMEBODY SCANS.
 * There is nothing to refresh, nothing to go stale, and no sale path that has
 * to remember to write to a second table.
 *
 * WHY THIS IS A FUNCTION AND NOT A QUERY THE CHECK PAGE COULD WRITE ITSELF.
 *
 * The public verify function may not touch a buyer's telephone number — the
 * whole endpoint is built so that pointing a phone at a QR cannot reveal who
 * bought a ticket, and `tests/verify.test.mjs` refuses any `buyer_`-prefixed
 * column in that file except `buyer_name`, which is printed on the paper
 * anyway. Resolving a code to a buyer means joining on `buyer_phone`, which
 * that file may not write.
 *
 * SECURITY DEFINER puts the join in here instead. The check page passes a code
 * and receives ticket numbers; the telephone number never leaves this
 * function, never appears in that file, and the rule that was protecting it
 * goes on being enforced by the same test. The privacy property is not
 * weakened — it is moved to where it can be stated once and read.
 *
 * AND THE SUPPORTER BAND STOPS BEING STORED, which is the other thing this
 * unlocks. `ticket_receipts.rank` exists because the check page could not
 * count a buyer's tickets without being able to identify them, so the count
 * was frozen at mint on the other side. It can count now — from rows this
 * function returns, which name nobody — so the band is worked out live from
 * what somebody holds today. A buyer who reaches Diamond is Diamond the next
 * time anybody looks, instead of being told Gold by a page claiming to be
 * current. `rank` and `rank_tickets` are left in place and simply stop being
 * written; nothing drops a column holding real answers.
 *
 * WHAT A LEGACY RECEIPT DOES. A code minted before the model changed has no
 * buyer on it and a fixed list of items. Those are a record of one purchase
 * and they still resolve — through the second half of the union below — so
 * every link already in somebody's chat goes on answering exactly as it did.
 */

/*
 * EXECUTE IS REVOKED FROM EVERYBODY AND GRANTED TO ONE ROLE, and on a SECURITY
 * DEFINER function that is not a precaution, it is the whole of its safety.
 *
 * Postgres grants EXECUTE to PUBLIC on a new function. Every other routine in
 * this database is SECURITY INVOKER, so row-level security answers for them
 * even if a browser calls one directly — `sell_books` reached from the
 * `authenticated` role simply writes nothing. This one runs as its owner and
 * RLS does not apply to it, so a PUBLIC grant would let anybody with the
 * anon key read a buyer's name and what they paid by guessing a code, going
 * round the endpoint that exists to rate the guessing.
 *
 * `search_path` is pinned for the same family of reason: a definer function
 * that resolves `tickets` through a caller-controlled path is resolving
 * somebody else's table.
 */
create or replace function holding_of(p_code text, p_limit integer default 1000)
returns table (
  idx        integer,
  number     text,
  status     text,
  buyer_name text,
  amount     numeric,
  book_idx   integer
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select q.idx, q.number, q.status, q.buyer_name, q.amount, q.book_idx
    from (
      -- A LIVE HOLDING: every ticket the buyer behind this code holds now.
      -- Void is included deliberately: a cancelled ticket was theirs, and the
      -- check page has a line for it that a buyer must not miss.
      select t.idx, t.number, t.status, t.buyer_name, t.amount, t.book_idx
        from ticket_receipts r
        join tickets t on t.buyer_phone = r.buyer_phone
       where r.code = p_code
         and r.buyer_phone <> ''
         and t.status in ('Sold', 'Donated', 'Void')

      union all

      -- A RECEIPT MINTED BEFORE THE MODEL CHANGED: a fixed set, still answered.
      select t.idx, t.number, t.status, t.buyer_name, t.amount, t.book_idx
        from ticket_receipts r
        join ticket_receipt_items ri on ri.code = r.code
        join tickets t on t.idx = ri.ticket_idx
       where r.code = p_code
         and r.buyer_phone = ''
    ) q
   order by q.idx
   limit greatest(1, coalesce(p_limit, 1000));
$$;

revoke all on function holding_of(text, integer) from public;
revoke all on function holding_of(text, integer) from anon, authenticated;
grant execute on function holding_of(text, integer) to service_role;

/*
 * THE TOKEN, AND ONLY THE TOKEN.
 *
 * All a buyer's digital ticket needs written down is an unguessable code
 * against their telephone number. What it covers is worked out above; what
 * band they are is worked out from that. So this creates a row if there is not
 * one and otherwise hands back the code they already have — which is the
 * property the whole model rests on, because the link in somebody's chat has
 * to go on being the right link after they buy more.
 */
create or replace function ensure_holding_tx(
  p_phone text,
  p_code  text,
  p_user  text
) returns table (holding_code text, was_created boolean) as $$
declare
  found_code text;
  phone      text := btrim(coalesce(p_phone, ''));
begin
  -- Refused rather than defaulted: '' is the absence of an identity, and
  -- accepting it would pool every buyer with no number recorded into one
  -- shared digital ticket listing each other's tickets.
  if phone = '' then
    raise exception 'a digital ticket needs a buyer';
  end if;

  select r.code into found_code
    from ticket_receipts r
   where r.buyer_phone = phone
   limit 1;

  if found_code is null then
    insert into ticket_receipts (code, created_by, buyer_phone)
      values (p_code, coalesce(p_user, ''), phone);
    return query select p_code, true;
  else
    return query select found_code, false;
  end if;
end $$ language plpgsql;

/*
 * `upsert_holding_tx` WROTE THE ITEM LIST and nothing needs an item list any
 * more. Dropped rather than left: a function nobody calls is one somebody
 * calls again later, and this one would quietly start a second, stored answer
 * to a question `holding_of` answers live.
 */
drop function if exists upsert_holding_tx(text, integer[], text, text, text, integer);
