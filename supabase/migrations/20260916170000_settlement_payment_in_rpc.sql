-- The cash counted in at settlement goes into the ledger inside the same
-- transaction that counted it — Phase 2 of the audit of 2026-09-15
-- (supabase/AUDIT.md §I).
--
-- Until now the payment row was written afterwards by the Edge Function, in a
-- call that deliberately could not fail the settlement. The cost was that the
-- two could disagree: the book said RM120 came in, the ledger had no row for
-- it, and the only sign was a seller's running total quietly short.
--
-- DATA LOSS RISK: NO ROWS. No column is dropped and no row is deleted or
-- rewritten. One index changes shape, and that is the part to read:
--
--   payments_settlement_book_idx was UNIQUE on (book_idx) where
--   source='settlement'. It is recreated NOT unique. The uniqueness said "one
--   settlement row per book", which was right while a re-settle replaced the
--   row in place — and replacing it destroys the only evidence the first figure
--   was ever claimed. A re-settle is now a reversal and a new row, like every
--   other correction to money here, so a book legitimately carries +120, -120,
--   +90 and uniqueness would refuse the third.
--
--   The race it guarded is now impossible for a better reason: the rows are
--   written inside settle_book, in the transaction that already holds
--   `select … for update` on the book.
--
-- Idempotent; run it twice and nothing changes.
--
-- GENERATED from the canonical files: the payments index block of schema.sql
-- and settle_book from functions.sql.

-- ---------- from schema.sql ----------
-- Dropped BY NAME first. `create index if not exists` would see the existing
-- unique index under this name and silently leave it in place, so a fresh
-- database would accept reversals and this one would refuse them.
drop index if exists payments_settlement_book_idx;
create index if not exists payments_settlement_book_idx
  on payments (book_idx) where source = 'settlement';

-- ---------- from functions.sql ----------
create or replace function settle_book(
  p_book_number text,
  p_unsold jsonb,
  p_amount_paid numeric,
  p_allow_unidentified boolean,
  p_sold_count integer,
  p_force boolean,
  p_user text,
  p_note text
) returns jsonb as $$
declare
  b record;
  price numeric;
  unsold_numbers text[];
  seller_name text;
  seller_phone text;
  declared integer;
  v_amount_due numeric;
  bad text;
begin
  -- LOCKED for the rest of the transaction. Two organisers settling the same
  -- book within a second both passed the "already settled" check below and
  -- both wrote; the second silently replaced the first. Now the second waits,
  -- re-reads, and is refused like any other re-settle.
  select * into b from books where number = p_book_number for update;
  if not found then
    return jsonb_build_object('error', jsonb_build_object(
      'code','BOOK_NOT_FOUND','message','Book ' || p_book_number || ' does not exist.'));
  end if;

  if b.status = 'Settled' and not p_force then
    return jsonb_build_object('error', jsonb_build_object(
      'code','ALREADY_SETTLED','message','Book ' || p_book_number || ' is already settled.'));
  end if;

  select coalesce(nullif(value,'')::numeric, 10) into price from config where key = 'TICKET_PRICE';

  if p_allow_unidentified then
    -- The fallback for when the leftovers are lost: record the book total and
    -- do NOT invent ticket rows. A fabricated "Sold" against the wrong number
    -- is a lie the system would then defend.
    if p_sold_count is null or p_sold_count < 0 then
      return jsonb_build_object('error', jsonb_build_object(
        'code','MISSING_FIELD','message','How many tickets were sold? (soldCount)'));
    end if;
    if p_sold_count > (select count(*) from tickets where book_idx = b.idx) then
      return jsonb_build_object('error', jsonb_build_object(
        'code','BAD_REQUEST','message','That is more tickets than the book contains.'));
    end if;
    declared := p_sold_count;
  else
    select array_agg(upper(trim(x))) into unsold_numbers
      from jsonb_array_elements_text(coalesce(p_unsold,'[]'::jsonb)) x;
    unsold_numbers := coalesce(unsold_numbers, '{}');

    -- Every named ticket must be in this book. A number from the next book is
    -- a typo, and accepting it would mark the wrong ticket unsold.
    select t into bad from (
      select x from unnest(unsold_numbers) x
      where not exists (select 1 from tickets where upper(number) = x and book_idx = b.idx)
    ) s(t) limit 1;
    if bad is not null then
      return jsonb_build_object('error', jsonb_build_object(
        'code','NOT_IN_BOOK','message','Ticket ' || bad || ' is not in book ' || p_book_number || '.'));
    end if;

    /*
     * A TICKET WITH A BUYER ON IT IS NOT "CAME BACK".
     *
     * Typing a sold ticket's number into the unsold list used to reset it to
     * Available and blank the buyer — a name and a telephone number somebody
     * wrote down, gone with nothing but a version bump to show for it. Whether
     * the paper really came back or the number was mistyped, the answer is the
     * same: the sale on record has to be corrected or voided by somebody
     * giving a reason, not erased as a side effect of counting.
     *
     * Placeholders written by an earlier settlement (source 'settlement') are
     * not buyers anybody wrote down, so a forced re-settle may still name them.
     */
    select string_agg(t.number || ' (' || t.buyer_name || ')', ', ' order by t.idx) into bad
      from tickets t
     where t.book_idx = b.idx
       and upper(t.number) = any(unsold_numbers)
       and t.status in ('Sold','Donated')
       and t.source <> 'settlement';
    if bad is not null then
      return jsonb_build_object('error', jsonb_build_object(
        'code','SOLD_TICKET_NAMED_UNSOLD',
        'message','These tickets are recorded as sold: ' || bad || '. If that sale was ' ||
                  'wrong, correct or void it first so the record says why. Counting a ' ||
                  'book in does not erase a buyer.'));
    end if;

    -- Handed back: onto the shelf, buyer details cleared.
    update tickets set
      status = 'Available', buyer_name = '', buyer_phone = '', buyer_zone = '',
      sold_by_agent = null, amount = null, payment_status = '', sold_at = null,
      source = '', recorded_by = p_user
    where book_idx = b.idx and upper(number) = any(unsold_numbers) and status <> 'Void';

    /*
     * Everything else in the book sold, and THE SELLER IS THE CONTACT.
     *
     * A seller selling from their own book keeps their own buyers. They hand
     * back the money; whether they pass the names on is their business. So the
     * contact recorded against these tickets is the seller, because that is who
     * can actually be telephoned about them.
     *
     * MARKED, not copied. buyer_name carries "(seller)" so the record says
     * which it is. Writing the seller's bare name would be writing something
     * false — if one of these wins, the winners list would say the seller
     * bought it, and the difference between "the seller knows the buyer" and
     * "the seller bought it themselves" is exactly what somebody would need on
     * the day. One honest field beats two that disagree.
     *
     * Anything already Sold or Donated keeps the buyer somebody took the
     * trouble to write down. A real buyer is never overwritten by this.
     */
    select name, phone into seller_name, seller_phone
      from agents where agent_id = b.held_by_agent;

    /*
     * DO NOT WRITE A CONTACT NOBODY CAN RING.
     *
     * This copy is how four sellers' broken telephone numbers became NINE
     * tickets whose contact of record was undialable — tickets that can win, in
     * a raffle whose whole promise is that a winning number resolves to somebody
     * you can telephone. The numbers had lost their leading zero, almost
     * certainly to a spreadsheet storing a phone as a number, and nothing
     * downstream looked: the field was not empty, so every check passed.
     *
     * The rule is CONFIDENCE, not validity, and it is the same one the client
     * uses to decide whether to offer a WhatsApp link: a number written with a
     * leading 0, or already carrying a country code, can be acted on. Anything
     * else is a number whose country we would be guessing at.
     *
     * A seller phone that fails it is treated as ABSENT rather than copied. The
     * ticket then has a name and no number and lands in the missing-contact
     * report, which is a thing somebody chases — instead of a number that looks
     * fine and reaches a stranger, which is a thing nobody ever notices.
     */
    if seller_phone is not null
       and regexp_replace(seller_phone, '\D', '', 'g') !~ '^(0|60)'
    then
      seller_phone := '';
    end if;

    update tickets set
      status = 'Sold', sold_by_agent = b.held_by_agent, amount = price,
      payment_status = 'Paid', sold_at = now(), source = 'settlement', recorded_by = p_user,
      buyer_name = case
        when coalesce(buyer_name, '') <> '' then buyer_name
        when coalesce(seller_name, '') <> '' then seller_name || ' (seller)'
        else '' end,
      buyer_phone = case
        when coalesce(buyer_name, '') <> '' then buyer_phone
        else coalesce(seller_phone, '') end
    where book_idx = b.idx
      and upper(number) <> all(unsold_numbers)
      and status not in ('Sold','Donated','Void');

    select count(*) into declared from tickets
      where book_idx = b.idx and status in ('Sold','Donated');
  end if;

  v_amount_due := declared * price;

  update books set
    status = 'Settled', declared_sold = declared, amount_due = v_amount_due,
    amount_paid = p_amount_paid, settled_at = now(), settled_by = p_user,
    notes = coalesce(nullif(p_note,''), notes), modified_by = p_user
  where idx = b.idx;

  insert into book_history(book_idx, from_agent, action, by_user, note)
  values (b.idx, b.held_by_agent, 'settle', p_user,
          'sold ' || declared || ', due ' || v_amount_due || ', paid ' || p_amount_paid);

  /*
   * THE CASH GOES IN THE LEDGER HERE, INSIDE THE TRANSACTION THAT COUNTED IT.
   *
   * It used to be written afterwards by the Edge Function, in a separate call
   * that could not fail the settlement — deliberately, because a raffle must
   * not be left unable to close a book over a bookkeeping row. The cost was
   * that the two could disagree: the book said RM120 came in and the ledger
   * had no row for it, and the only sign was a seller's running total quietly
   * short. Written here it cannot happen. Either the book is settled and the
   * money is in the ledger, or neither is true.
   *
   * A RE-SETTLE IS A REVERSAL AND A NEW ROW, NEVER AN EDIT.
   *
   * The old path updated the row in place, and deleted it outright when a book
   * was re-settled at zero. Both destroy the only record that the first figure
   * was ever claimed — and a correction whose evidence is gone is
   * indistinguishable from the figure having always been right. Every other
   * correction in this system is an opposing row with a reason on it; this one
   * now is too. What the ledger holds afterwards is the whole argument: RM120
   * counted in, RM120 reversed, RM90 counted in, and the sum is what the book
   * says.
   *
   * ZERO IS NOT A ROW. `payments` refuses amount = 0 — a row that changes
   * nothing is a row somebody has to interpret — so settling for nothing
   * leaves the reversal and no replacement, which reads correctly: the money
   * was claimed and then taken back.
   */
  if b.held_by_agent is not null then
    insert into payments(agent_id, amount, received_by, method, note, book_idx, source, reverses)
    select p.agent_id, -p.amount, p_user, p.method,
           'Reversed: ' || p_book_number || ' counted in again', p.book_idx, 'settlement', p.id
      from payments p
     where p.book_idx = b.idx and p.source = 'settlement' and p.reverses is null
       and not exists (select 1 from payments r where r.reverses = p.id);

    if p_amount_paid <> 0 then
      insert into payments(agent_id, amount, received_by, method, note, book_idx, source)
      values (b.held_by_agent, p_amount_paid, p_user, 'cash',
              'Counted in with ' || p_book_number, b.idx, 'settlement');
    end if;
  end if;

  return jsonb_build_object(
    'book', p_book_number,
    'declaredSold', declared,
    'amountDue', v_amount_due,
    'amountPaid', p_amount_paid,
    'variance', p_amount_paid - v_amount_due,
    'unidentified', p_allow_unidentified
  );
end $$ language plpgsql;
