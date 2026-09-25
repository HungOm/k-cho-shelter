/*
 * MULTI-TENANCY STAGE 2 (MT-2d): settle_book, the last of the sixteen.
 *
 * It resolves the book from p_book_number, the global unique until Stage 4,
 * and then LOCKS it — so unscoped, `select * into b from books where number =
 * p_book_number for update` locks whichever raffle's book carries that number,
 * and everything after it lands on that raffle: the ticket rewrites, the
 * declared count, the amount due, the history row and the payments. Proved by
 * removing the predicate: this raffle counting in OB-0902 gets
 * ALREADY_SETTLED, which means it found and locked the other organisation's
 * book.
 *
 * THIRTEEN STATEMENTS carry the project now — the lock, the price, the ticket
 * count check, the unsold-numbers existence check, the sold-ticket guard, both
 * ticket rewrites, the declared recount, the seller lookup on agents, the book
 * update, the history insert, and both payment inserts.
 *
 * TWO OF THEM CANNOT BE PROVED YET, recorded in D-036 rather than left to be
 * noticed. The re-settle REVERSAL matches `p.book_idx = b.idx`, so reaching
 * another raffle's payment rows needs two raffles holding the same book INDEX
 * — impossible while idx is the global primary key. And a second raffle
 * settling its own book fails earlier than any predicate: its `select … into
 * price from config` finds no row, because config's key is still (key) alone,
 * so price is null and the amount due with it. Both open at Stage 4.
 *
 * Both signatures revoked; the original never was. An invoker function, so the
 * table grants stopped an anonymous caller reaching the rows, but this one
 * moves money — it writes payments and sets what a seller owes — and the api's
 * service key is its only caller (books.ts:954, nothing in src/).
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function settle_book(
  p_book_number text,
  p_unsold jsonb,
  p_amount_paid numeric,
  p_allow_unidentified boolean,
  p_sold_count integer,
  p_force boolean,
  p_user text,
  p_note text,
  p_project uuid
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
  -- THE LOCK IS TAKEN ON THIS RAFFLE'S BOOK. number is the global unique until
  -- Stage 4, so without the project this locks and then settles whichever
  -- raffle's book happens to carry that number.
  select * into b from books
   where number = p_book_number and project_id = p_project for update;
  if not found then
    return jsonb_build_object('error', jsonb_build_object(
      'code','BOOK_NOT_FOUND','message','Book ' || p_book_number || ' does not exist.'));
  end if;

  if b.status = 'Settled' and not p_force then
    return jsonb_build_object('error', jsonb_build_object(
      'code','ALREADY_SETTLED','message','Book ' || p_book_number || ' is already settled.'));
  end if;

  -- This raffle's price. It multiplies the declared count into amount_due,
  -- which is the figure a seller is asked to hand over.
  select coalesce(nullif(value,'')::numeric, 10) into price
    from config where key = 'TICKET_PRICE' and project_id = p_project;

  if p_allow_unidentified then
    -- The fallback for when the leftovers are lost: record the book total and
    -- do NOT invent ticket rows. A fabricated "Sold" against the wrong number
    -- is a lie the system would then defend.
    if p_sold_count is null or p_sold_count < 0 then
      return jsonb_build_object('error', jsonb_build_object(
        'code','MISSING_FIELD','message','How many tickets were sold? (soldCount)'));
    end if;
    if p_sold_count > (select count(*) from tickets
                        where book_idx = b.idx and project_id = b.project_id) then
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
      where not exists (select 1 from tickets
                         where upper(number) = x and book_idx = b.idx
                           and project_id = b.project_id)
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
       and t.project_id = b.project_id
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
    where book_idx = b.idx and project_id = b.project_id
      and upper(number) = any(unsold_numbers) and status <> 'Void';

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
    -- agent_id is global until Stage 4, so the seller whose name goes onto
    -- these tickets has to be this raffle's seller of that id.
    select name, phone into seller_name, seller_phone
      from agents where agent_id = b.held_by_agent and project_id = b.project_id;

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
      and project_id = b.project_id
      and upper(number) <> all(unsold_numbers)
      and status not in ('Sold','Donated','Void');

    select count(*) into declared from tickets
      where book_idx = b.idx and project_id = b.project_id
        and status in ('Sold','Donated');
  end if;

  v_amount_due := declared * price;

  update books set
    status = 'Settled', declared_sold = declared, amount_due = v_amount_due,
    -- settled_by is the EMAIL of whoever typed it; settled_by_agent is the
    -- SELLER the declared money belongs to. The organiser settles most books
    -- and none of that money is theirs, so the two are different questions.
    --
    -- FROZEN HERE, ON PURPOSE. Once a book is counted in its figures are the
    -- truth and must not move again because somebody later changed who holds
    -- the paper. That is the whole reason the column exists rather than the
    -- view reading held_by_agent a second time.
    amount_paid = p_amount_paid, settled_at = now(), settled_by = p_user,
    settled_by_agent = b.held_by_agent,
    notes = coalesce(nullif(p_note,''), notes), modified_by = p_user
  where idx = b.idx and project_id = b.project_id;

  insert into book_history(book_idx, from_agent, action, by_user, note, project_id)
  values (b.idx, b.held_by_agent, 'settle', p_user,
          'sold ' || declared || ', due ' || v_amount_due || ', paid ' || p_amount_paid,
          b.project_id);

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
    -- THE REVERSAL FINDS ONLY THIS RAFFLE'S PAYMENT ROWS. Without the
    -- project this is restock_books_tx's defect in a second place: a
    -- re-settle would reverse another organisation's settlement payments for
    -- a book index it shares, taking money off a seller in a raffle nobody
    -- was counting in.
    --
    -- r.project_id = p.project_id, not p_project: this asks whether THIS
    -- payment already has a reversal, and a reversal lives in the same raffle
    -- as the payment it reverses by construction.
    insert into payments(agent_id, amount, received_by, method, note, book_idx, source, reverses, project_id)
    select p.agent_id, -p.amount, p_user, p.method,
           'Reversed: ' || p_book_number || ' counted in again', p.book_idx, 'settlement', p.id,
           p.project_id
      from payments p
     where p.book_idx = b.idx and p.project_id = b.project_id
       and p.source = 'settlement' and p.reverses is null
       and not exists (select 1 from payments r
                        where r.reverses = p.id and r.project_id = p.project_id);

    if p_amount_paid <> 0 then
      insert into payments(agent_id, amount, received_by, method, note, book_idx, source, project_id)
      values (b.held_by_agent, p_amount_paid, p_user, 'cash',
              'Counted in with ' || p_book_number, b.idx, 'settlement', b.project_id);
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
  select settle_book(p_book_number, p_unsold, p_amount_paid, p_allow_unidentified,
                     p_sold_count, p_force, p_user, p_note,
                     coalesce(current_project(), seed_project()))
$$ language sql;

-- Both signatures revoked; the original never was. An invoker function, so the
-- table grants stopped an anonymous caller reaching the rows, but this one
-- moves money — it writes payments and sets what a seller owes — and the api's
-- service key is its only caller (books.ts:954; nothing in src/).
revoke execute on function settle_book(text, jsonb, numeric, boolean, integer, boolean, text, text)
  from public, anon, authenticated;
revoke execute on function settle_book(text, jsonb, numeric, boolean, integer, boolean, text, text, uuid)
  from public, anon, authenticated;
