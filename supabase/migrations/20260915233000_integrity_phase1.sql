-- Integrity, phase 1 — from the audit of 2026-09-15 (supabase/AUDIT.md).
--
-- Additive and idempotent; run it twice and nothing changes. DATA LOSS RISK: NO.
-- No column is dropped, no row deleted, the two ledger views come back with
-- every column they had plus two.
--
-- What it closes, each reproduced on a clean database first:
--   E1  a book marked Lost made its recorded sales worth RM 0
--   E2  settlement un-sold a ticket with a real buyer, erasing the name
--   E6  two settlements of one book could interleave
--   E7  a ticket kept only its latest state
--   and the desk: sales with no seller were expected money nobody could collect
--
-- GENERATED from the canonical files, so the migration and the files cannot
-- drift: the TICKET HISTORY block of schema.sql, the whole of functions.sql,
-- and the two ledger views from rls.sql, in that order.

-- ---------- from schema.sql ----------
-- ============ TICKET HISTORY (begin) ============
-- A ticket row keeps only its LATEST state. A correction, a settlement or a
-- restock overwrites the buyer, the seller and the status, and until now the
-- only trace was a version number going up. "Who was on KS-00413 before it was
-- corrected" and "who was credited with this sale in March" had no answer.
--
-- Written by a trigger rather than by the handlers, so no code path can forget
-- it — the same reason the contact rule is a constraint. Server-only, like
-- audit_log: it holds the names and numbers that were overwritten.
create table if not exists ticket_history (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  ticket_idx    integer not null references tickets(idx) on delete restrict,
  book_idx      integer not null,
  from_status   text not null default '',
  to_status     text not null default '',
  from_agent    text,
  to_agent      text,
  from_buyer    text not null default '',
  to_buyer      text not null default '',
  from_phone    text not null default '',
  to_phone      text not null default '',
  from_amount   numeric(12,2),
  to_amount     numeric(12,2),
  from_payment  text not null default '',
  to_payment    text not null default '',
  source        text not null default '',
  by_user       text not null default '',
  note          text not null default ''
);
create index if not exists ticket_history_ticket_idx on ticket_history (ticket_idx, at);
create index if not exists ticket_history_book_idx on ticket_history (book_idx, at);

create or replace function record_ticket_history() returns trigger as $$
begin
  -- Only the facts that matter to money or the draw. A modified_at bump or a
  -- zone edit is not a movement.
  if (old.status, old.buyer_name, old.buyer_phone, old.sold_by_agent,
      old.amount, old.payment_status, old.notes)
     is distinct from
     (new.status, new.buyer_name, new.buyer_phone, new.sold_by_agent,
      new.amount, new.payment_status, new.notes) then
    insert into ticket_history (
      ticket_idx, book_idx, from_status, to_status, from_agent, to_agent,
      from_buyer, to_buyer, from_phone, to_phone, from_amount, to_amount,
      from_payment, to_payment, source, by_user, note)
    values (
      new.idx, new.book_idx, old.status, new.status, old.sold_by_agent, new.sold_by_agent,
      old.buyer_name, new.buyer_name, old.buyer_phone, new.buyer_phone, old.amount, new.amount,
      old.payment_status, new.payment_status, new.source, new.recorded_by,
      case when new.notes is distinct from old.notes then new.notes else '' end);
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists tickets_record_history on tickets;
create trigger tickets_record_history after update on tickets
  for each row execute function record_ticket_history();
-- ============ TICKET HISTORY (end) ============

-- ---------- from functions.sql ----------
-- Raffled — the operations that must be all-or-nothing.
--
-- Apps Script took one script-wide lock for every write, which made two
-- volunteers in different books queue behind each other, and still only
-- approximated atomicity: it validated everything before writing anything, but
-- nothing stopped a failure halfway through the writes themselves.
--
-- A plpgsql function is one transaction. It commits or it does not. That is the
-- promise the docs already made — "if one line has a problem, none are saved" —
-- actually enforced rather than carefully approximated.
--
-- Run this AFTER schema.sql.

-- ============ HOW MANY TICKETS ARE IN PLAY ============
-- Generated and in-play are two different numbers. Held-back tickets keep their
-- rows and their numbers; they are simply not sellable yet. Blank or zero means
-- all of them, which is what an existing raffle has.

create or replace function active_tickets() returns integer as $$
declare
  generated integer;
  active integer;
begin
  select coalesce(nullif(value, '')::integer, 0) into generated from config where key = 'TOTAL_TICKETS';
  select coalesce(nullif(value, '')::integer, 0) into active from config where key = 'ACTIVE_TICKETS';
  generated := coalesce(generated, 0);
  active := coalesce(active, 0);
  if active <= 0 or active > generated then return generated; end if;
  return active;
end $$ language plpgsql stable security definer set search_path = public;

-- ============ BULK SALE ENTRY ============
-- For when a seller brings back a book and somebody types the stubs in.
--
-- Returns {recorded} on success, or {failures:[{ticketNumber, code, message}]}
-- having written nothing. Every reason a row can be refused is collected and
-- reported together, rather than stopping at the first — retyping 180 stubs one
-- rejection at a time is how a volunteer gives up on the system.

create or replace function bulk_record_sales(
  p_sales jsonb,
  p_user text,
  p_role text,
  p_agent_id text,
  p_force boolean default false
) returns jsonb as $$
declare
  sale jsonb;
  t record;
  failures jsonb := '[]'::jsonb;
  seen text[] := '{}';
  num text;
  phone text;
  buyer text;
  live integer;
  price numeric;
  written integer := 0;
begin
  live := active_tickets();
  select coalesce(nullif(value, '')::numeric, 10) into price from config where key = 'TICKET_PRICE';

  -- Pass one: judge every row, write nothing.
  for sale in select * from jsonb_array_elements(p_sales) loop
    num := trim(sale->>'ticketNumber');
    buyer := trim(coalesce(sale->>'buyerName', ''));
    phone := regexp_replace(coalesce(sale->>'buyerPhone', ''), '\D', '', 'g');

    if num is null or num = '' then
      failures := failures || jsonb_build_object('ticketNumber', '',
        'code', 'MISSING_FIELD', 'message', 'Ticket number is blank.');
      continue;
    end if;

    if num = any(seen) then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'DUPLICATE_IN_BATCH', 'message', 'Listed twice in this batch.');
      continue;
    end if;
    seen := seen || num;

    if buyer = '' then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'MISSING_FIELD', 'message', 'Buyer name is required.');
      continue;
    end if;

    -- The rule the whole raffle depends on: a sold ticket must resolve to
    -- somebody who can be telephoned when their number comes up.
    if length(phone) < 7 then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'BAD_PHONE', 'message', 'Phone number is too short.');
      continue;
    end if;

    select tk.idx, tk.status, tk.version, b.number as book_number,
           b.status as book_status, b.held_by_agent
      into t
      from tickets tk join books b on b.idx = tk.book_idx
     where tk.number = num;

    if not found then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'TICKET_NOT_FOUND', 'message', 'Not found.');
      continue;
    end if;

    if t.idx > live then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'TICKET_NOT_RELEASED', 'message', 'Not released yet.');
      continue;
    end if;

    if t.status in ('Sold', 'Donated') then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'ALREADY_SOLD', 'message', 'Already sold.');
      continue;
    end if;

    if t.status = 'Void' then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'TICKET_VOID', 'message', 'This ticket was voided.');
      continue;
    end if;

    if t.book_status in ('Settled', 'Void', 'Lost') and not (p_force and p_role = 'admin') then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'BOOK_CLOSED', 'message', 'That book is ' || lower(t.book_status) || '.');
      continue;
    end if;

    if p_role = 'agent' and (p_agent_id is null or t.held_by_agent is distinct from p_agent_id) then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'NOT_YOUR_BOOK', 'message', 'That book is not issued to you.');
      continue;
    end if;

    -- You can only sell paper you can hand to the buyer. A book that is Out is
    -- in a seller's bag; its stubs are not on this desk. The holder may record
    -- against it, and an organiser may — that is transcribing what the seller
    -- reported, which is most of what this screen is for. A helper cannot: ask
    -- for the book to be marked returned, and then it is paper like any other.
    -- The credit below is what keeps the organiser's path honest.
    if t.book_status = 'Out'
       and (p_agent_id is null or t.held_by_agent is distinct from p_agent_id)
       and (p_role <> 'admin' or t.held_by_agent is null) then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'BOOK_WITH_SELLER',
        'message', 'Book ' || coalesce(t.book_number, '?') ||
                   ' is out with a seller. Ask an organiser to mark it returned first.');
      continue;
    end if;
  end loop;

  if jsonb_array_length(failures) > 0 then
    return jsonb_build_object('failures', failures);
  end if;

  -- Pass two: write. Reached only when every row passed, and inside the same
  -- transaction, so a failure here takes the whole batch with it.
  for sale in select * from jsonb_array_elements(p_sales) loop
    update tickets set
      status = case when coalesce((sale->>'donated')::boolean, false) then 'Donated' else 'Sold' end,
      buyer_name = trim(sale->>'buyerName'),
      buyer_phone = regexp_replace(coalesce(sale->>'buyerPhone', ''), '[^\d+]', '', 'g'),
      buyer_zone = coalesce(sale->>'buyerZone', ''),
      -- A sale out of a book that is still with a seller is credited to that
      -- seller, whoever typed it in. They handed the ticket over; the money is
      -- on their balance and settlement checks it against their stubs.
      sold_by_agent = coalesce(
        (select b2.held_by_agent from books b2
           join tickets t2 on t2.book_idx = b2.idx
          where t2.number = trim(sale->>'ticketNumber') and b2.status = 'Out'),
        sale->>'agentId', p_agent_id),
      amount = case when coalesce((sale->>'donated')::boolean, false) then 0 else price end,
      payment_status = coalesce(sale->>'paymentStatus', 'Paid'),
      sold_at = now(),
      source = 'bulk',
      recorded_by = p_user
    where number = trim(sale->>'ticketNumber');
    written := written + 1;
  end loop;

  return jsonb_build_object('recorded', written);
end $$ language plpgsql;

-- ============ SELLING WHOLE BOOKS ============
-- Tickets already sold to somebody else are SKIPPED and reported, never
-- overwritten. That reporting is the interesting half of the answer: selling a
-- book with three already gone is "7 sold, 3 left alone", and calling that
-- "book sold" is a lie the organiser would only discover at the draw.

create or replace function sell_books(
  p_from_book text,
  p_to_book text,
  p_book_numbers jsonb,
  p_buyer_name text,
  p_buyer_phone text,
  p_buyer_zone text,
  p_donated boolean,
  p_user text,
  p_role text,
  p_agent_id text
) returns jsonb as $$
declare
  first_idx integer;
  last_idx integer;
  idxs integer[];
  b record;
  t record;
  live integer;
  price numeric;
  sold_numbers text[] := '{}';
  skipped jsonb := '[]'::jsonb;
  book_numbers text[] := '{}';
begin
  live := active_tickets();
  select coalesce(nullif(value, '')::numeric, 10) into price from config where key = 'TICKET_PRICE';

  if p_book_numbers is not null then
    select array_agg(bk.idx order by bk.idx) into idxs
      from books bk where bk.number = any(
        select jsonb_array_elements_text(p_book_numbers));
  else
    select idx into first_idx from books where number = p_from_book;
    if first_idx is null then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_NOT_FOUND', 'message', 'Book ' || coalesce(p_from_book, '?') || ' does not exist.'));
    end if;
    if p_to_book is null or p_to_book = '' then
      last_idx := first_idx;
    else
      select idx into last_idx from books where number = p_to_book;
      if last_idx is null then
        return jsonb_build_object('error', jsonb_build_object(
          'code', 'BOOK_NOT_FOUND', 'message', 'Book ' || p_to_book || ' does not exist.'));
      end if;
    end if;
    if last_idx < first_idx then
      select first_idx, last_idx into last_idx, first_idx;
    end if;
    select array_agg(g order by g) into idxs from generate_series(first_idx, last_idx) g;
  end if;

  if idxs is null or array_length(idxs, 1) is null then
    return jsonb_build_object('error', jsonb_build_object(
      'code', 'BAD_REQUEST', 'message', 'No books were named.'));
  end if;
  if array_length(idxs, 1) > 20 then
    return jsonb_build_object('error', jsonb_build_object(
      'code', 'RANGE_TOO_LARGE', 'message', 'Sell at most 20 books to one buyer at a time.'));
  end if;

  -- Every book is checked before any ticket is written, so a range that crosses
  -- into another seller's books leaves nothing half recorded.
  for b in select * from books where idx = any(idxs) order by idx loop
    book_numbers := book_numbers || b.number;

    if b.idx * (select coalesce(nullif(value, '')::integer, 10) from config where key = 'TICKETS_PER_BOOK')
       > live then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'TICKET_NOT_RELEASED',
        'message', 'Book ' || b.number || ' has not been released yet.'));
    end if;
    if b.status in ('Settled', 'Void', 'Lost') then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_CLOSED', 'message', 'Book ' || b.number || ' is ' || lower(b.status) || '.'));
    end if;
    if p_role = 'agent' and (p_agent_id is null or b.held_by_agent is distinct from p_agent_id) then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'NOT_YOUR_BOOK', 'message', 'Book ' || b.number || ' is not issued to you.'));
    end if;
    -- Same rule as a single ticket, and it matters more here: this hands a
    -- whole book to one buyer. Until today the only check was that the book
    -- existed, so a book could be sold entire while it sat in a seller's bag.
    -- The sold_by_agent below already credits the holder.
    if b.status = 'Out'
       and (p_agent_id is null or b.held_by_agent is distinct from p_agent_id)
       and (p_role <> 'admin' or b.held_by_agent is null) then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_WITH_SELLER',
        'message', 'Book ' || b.number || ' is out with a seller, so it is not here to sell. ' ||
                   'If it is back, ask an organiser to mark it returned first.'));
    end if;
  end loop;

  for t in select * from tickets where book_idx = any(idxs) order by idx loop
    if t.status in ('Sold', 'Donated') then
      skipped := skipped || jsonb_build_object('ticketNumber', t.number, 'reason', 'already sold');
      continue;
    end if;
    if t.status = 'Void' then
      skipped := skipped || jsonb_build_object('ticketNumber', t.number, 'reason', 'voided');
      continue;
    end if;

    update tickets set
      status = case when p_donated then 'Donated' else 'Sold' end,
      buyer_name = p_buyer_name,
      buyer_phone = p_buyer_phone,
      buyer_zone = coalesce(p_buyer_zone, ''),
      sold_by_agent = coalesce(
        (select held_by_agent from books where idx = t.book_idx), p_agent_id),
      amount = case when p_donated then 0 else price end,
      payment_status = 'Paid',
      sold_at = now(),
      source = 'book sale',
      recorded_by = p_user
    where idx = t.idx;

    sold_numbers := sold_numbers || t.number;
  end loop;

  return jsonb_build_object(
    'books', to_jsonb(book_numbers),
    'sold', coalesce(array_length(sold_numbers, 1), 0),
    'tickets', to_jsonb(sold_numbers),
    'skipped', skipped,
    'amount', case when p_donated then 0 else coalesce(array_length(sold_numbers, 1), 0) * price end,
    'buyerName', p_buyer_name
  );
end $$ language plpgsql;

-- ============ SETTLEMENT ============
-- What an agent owes, decided in one transaction.
--
-- It asks for the tickets that did NOT sell — the ones the agent is physically
-- holding — and marks everything else sold. Two numbers typed in five seconds
-- is exact; "I sold eight" throws away the ticket-to-buyer link the draw
-- depends on.
--
-- Tickets already sold keep their real buyer. The ones nobody wrote down are
-- marked sold with the buyer fields BLANK and source 'settlement', which is
-- honest: the money arrived, nobody recorded who from, and the missing-contact
-- report is what surfaces it. Inventing a buyer would be worse than the gap.

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

  return jsonb_build_object(
    'book', p_book_number,
    'declaredSold', declared,
    'amountDue', v_amount_due,
    'amountPaid', p_amount_paid,
    'variance', p_amount_paid - v_amount_due,
    'unidentified', p_allow_unidentified
  );
end $$ language plpgsql;

-- ============ MONEY THAT NEVER HAD A SELLER ============
-- A ticket sold at the desk, from a book nobody is holding, has no custodian:
-- sold_by_agent is null and the book's holder is null. The ledger counted its
-- price as expected and nothing could ever count it as collected, so the home
-- screen showed money owed by nobody, for ever. The cash went straight into
-- the tin, which is what payment_status 'Paid' on a desk sale means.
--
-- Books with no holder are the definition, whoever typed the sale: that is
-- exactly the set the seller lines cannot cover, so the two add up to the
-- whole raffle and nothing is counted twice.

create or replace function desk_money() returns jsonb as $$
  select jsonb_build_object(
    'sold',      count(*),
    'expected',  coalesce(sum(t.amount), 0),
    'collected', coalesce(sum(t.amount) filter (where t.payment_status = 'Paid'), 0))
  from tickets t
  join books b on b.idx = t.book_idx
  where b.held_by_agent is null
    and t.status in ('Sold','Donated')
    and t.idx <= active_tickets();
$$ language sql stable;

-- ---------- from rls.sql: the two ledger views ----------
drop view if exists book_ledger;
create view book_ledger as
select
  b.idx, b.number, b.first_ticket, b.last_ticket,
  b.status, b.held_by_agent, a.name as agent_name, b.due_at,
  b.declared_sold, b.amount_due, b.amount_paid,
  r.recorded_sold, r.recorded_amount, r.available, r.reserved, r.missing_contact,
  -- Declared figures only when a count was actually declared. A book marked
  -- Lost from the Books screen has declared_sold null, and reading that as
  -- nought made every sale recorded on it worth nothing to the money reports.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then b.declared_sold else r.recorded_sold end as counted_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then coalesce(b.amount_due,0) else r.recorded_amount end as counted_expected,
  -- Sold by the seller's count with no ticket number written down: money the
  -- raffle expects and entries the draw cannot include.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(b.declared_sold - r.recorded_sold, 0) else 0 end as unidentified_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(coalesce(b.amount_due,0) - r.recorded_amount, 0) else 0 end as unidentified_amount,
  coalesce(b.amount_paid,0) as counted_collected,
  coalesce(b.declared_sold,0) - r.recorded_sold as variance_sold,
  coalesce(b.amount_due,0) - r.recorded_amount as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final
from books b
left join agents a on a.agent_id = b.held_by_agent
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated')) as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available') as available,
    count(*) filter (where t.status = 'Reserved') as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx
) r on true
where app_role() is not null
  and b.idx <= ceil(active_tickets()::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config where key='TICKETS_PER_BOOK'),1))
  and (app_role() <> 'agent' or b.held_by_agent = app_agent_id());

grant select on book_ledger to authenticated;

-- ============ THE SAME LEDGER, FOR THE FUNCTION ============

/*
 * book_ledger carries its own WHERE clause, because it runs with owner rights
 * and a policy would not apply to it. That is right for a browser reading
 * directly — and it is why the EDGE FUNCTION saw nothing at all through it.
 *
 * The function reads as the service role. It carries no JWT, so auth_email() is
 * null, so app_role() is null, so the view returned zero rows to it. Every
 * action built on the ledger quietly reported an empty raffle: no books free to
 * give out, no money expected or collected, no agent statements — and, worst,
 * the restock guard that refuses a book with money still owed saw no rows and
 * so never refused anything.
 *
 * So there are two: book_ledger, filtered, for browsers; book_ledger_all,
 * unfiltered, for the function — which does its own scoping in code, because it
 * has to, being above the policies. Explicitly revoked from anon and
 * authenticated so the unfiltered one can never be reached from a browser.
 */
drop view if exists book_ledger_all;
create view book_ledger_all as
select
  b.idx, b.number, b.first_ticket, b.last_ticket,
  b.status, b.held_by_agent, a.name as agent_name, b.due_at,
  b.declared_sold, b.amount_due, b.amount_paid,
  r.recorded_sold, r.recorded_amount, r.available, r.reserved, r.missing_contact,
  -- Declared figures only when a count was actually declared. A book marked
  -- Lost from the Books screen has declared_sold null, and reading that as
  -- nought made every sale recorded on it worth nothing to the money reports.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then b.declared_sold else r.recorded_sold end as counted_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then coalesce(b.amount_due,0) else r.recorded_amount end as counted_expected,
  -- Sold by the seller's count with no ticket number written down: money the
  -- raffle expects and entries the draw cannot include.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(b.declared_sold - r.recorded_sold, 0) else 0 end as unidentified_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(coalesce(b.amount_due,0) - r.recorded_amount, 0) else 0 end as unidentified_amount,
  coalesce(b.amount_paid,0) as counted_collected,
  coalesce(b.declared_sold,0) - r.recorded_sold as variance_sold,
  coalesce(b.amount_due,0) - r.recorded_amount as variance_amount,
  -- Whole days, from a date. Instant arithmetic made a book due today overdue
  -- from 8am, which is not something you can defend to the person being chased.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int else 0 end as days_overdue,
  -- Past the hard deadline: not merely late for a checkpoint, late for the raffle.
  (b.status = 'Out' and (select nullif(value,'') from config where key = 'FINAL_DEADLINE') is not null
   and b.due_at is not null
   and (select nullif(value,'')::date from config where key = 'FINAL_DEADLINE') < current_date)
    as past_final
from books b
left join agents a on a.agent_id = b.held_by_agent
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated')) as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available') as available,
    count(*) filter (where t.status = 'Reserved') as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx
) r on true
where b.idx <= ceil(active_tickets()::numeric /
        greatest((select coalesce(nullif(value,'')::integer,10) from config where key='TICKETS_PER_BOOK'),1));

revoke all on book_ledger_all from anon, authenticated;

-- ---------- from rls.sql: the trail and the desk are the function's ----------
alter table ticket_history enable row level security;
revoke all on ticket_history from anon, authenticated;
revoke execute on function desk_money() from public, anon, authenticated;
