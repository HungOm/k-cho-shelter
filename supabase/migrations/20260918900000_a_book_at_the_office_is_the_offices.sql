-- A book at the office is the office's, and the seller who brought it back is
-- not holding it any more.
--
-- WHAT HAPPENED. Book-004 was given to a seller at 01:02 and brought back to
-- the office at 01:04. At 01:27 an organiser sold the whole book at the desk —
-- and both tickets were credited to the seller who had returned it twenty-three
-- minutes earlier. Money landed on the balance of somebody who had already
-- settled up, and the chase list would have gone after them for it.
--
-- HOW. sell_books took a p_sold_by argument naming "who was actually at the
-- desk", on the reasoning that the helper taking the money is often not the
-- seller who handed the book in. The sell screen offered every seller in a
-- "Who sold it?" list and this function accepted whatever came back, for any
-- book that was not Out. bulk_record_sales did the same thing with the agentId
-- in its payload.
--
-- THE RULE NOW, which is the raffle owner's and was given after looking at that
-- history: a seller is credited only when a book GIVEN OUT TO THEM is sold.
-- Anything sold while the book is at the office belongs to no seller's balance.
--
--   Out with a seller     -> theirs. They are carrying it and they handed the
--                            ticket over; settlement checks the money against
--                            the stubs they bring back.
--   Anywhere else         -> the desk's. sold_by_agent is null.
--
-- WHAT THIS GIVES UP, stated plainly because it was deliberate when it was
-- built: there is no longer any way to credit a seller who genuinely sold a
-- returned book while standing at the desk. That money now reads as the
-- office's. The owner was shown the trade and chose this side of it.
--
-- THE ORGANISER IS NOT LOST. recorded_by carries their address, and the book's
-- history already says "Written down by" them under the sale. A null
-- sold_by_agent does not mean "nobody knows" — it means "no seller's balance",
-- which is exactly what is true.
--
-- NOT THE COUNT-IN. settle_book still credits the returning seller from
-- held_by_agent, and must: that path records what the seller sold BEFORE they
-- handed the book back. It is a different question from who is making a sale
-- now, and conflating them is what put RM400 on the wrong volunteer once
-- already.
--
-- p_sold_by stays in the signature and is ignored. `create or replace` cannot
-- drop a parameter, and the sell screen no longer sends one.
--
-- DATA LOSS RISK: NO. Two functions are replaced. No row is read or written.
-- Tickets already sold keep whatever credit they were given; this changes who
-- the NEXT sale is credited to.

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
  p_agent_id text,
  /*
   * WHO TO CREDIT when the book is not out with anybody — chosen at the desk,
   * defaulting to whoever is signed in. Null means "use the caller", which is
   * what every existing call passes by not passing it at all.
   */
  p_sold_by text default null
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
  touched integer;
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

  /*
   * `for update` on the loop's OWN select, so the row that is judged is the row
   * that is held. Already ordered by idx, so the deadlock-free lock order comes
   * free here. Without it two sessions selling the same book both read every
   * stub as available and the second overwrote the first buyer.
   */
  for t in select * from tickets where book_idx = any(idxs) order by idx for update loop
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
      /*
       * WHOEVER ACTUALLY SOLD IT, WHICH DEPENDS ON WHERE THE BOOK WAS.
       *
       * OUT WITH A SELLER: theirs. They are carrying the paper; they handed the
       * ticket over, whoever typed it in afterwards. The money lands on their
       * balance, where settlement checks it against the stubs they bring back.
       *
       * ANYWHERE ELSE — in the office, or brought back and not given out again —
       * it is being sold ACROSS A DESK by whoever is standing at it. So it is
       * credited to the person recording it, or to whoever they name instead.
       *
       * This was `coalesce(held_by_agent, p_agent_id)`, and returning a book
       * does not clear held_by_agent — keeping it is how "brought back by" has
       * a name on it. So a book handed in and then sold whole at the desk
       * credited all ten tickets to the seller who had brought it back and put
       * the price of them on her balance. She had already given the paper back;
       * somebody else took the cash.
       *
       * The single-ticket path has always asked `status = 'Out'` first, which
       * is why nobody looked here: selling one ticket out of a returned book
       * and selling the whole book credited two different people.
       */
      /*
       * CREDIT FOLLOWS CUSTODY AT THE MOMENT OF SALE, and nothing else.
       *
       * Out with a seller: theirs. They are carrying the book, they handed the
       * ticket over, and settlement checks the money against their stubs.
       *
       * ANYWHERE ELSE: THE DESK'S, and p_sold_by is deliberately ignored.
       * A book that has been brought back is at the office, and a sale made
       * from it afterwards is a sale the organiser made — the seller is not
       * holding it, did not hand this ticket over, and has already accounted
       * for what they sold. Crediting them puts money on the balance of
       * somebody who has settled up and sends the chase list after them.
       *
       * THIS IS WHAT WENT WRONG. Book-004 was given to a seller at 01:02,
       * brought back to the office at 01:04, and the whole book was sold at the
       * desk at 01:27 — and both tickets were credited to the seller who had
       * returned it two minutes after taking it. The screen offered their name
       * in a "Who sold it?" list and this line accepted it.
       *
       * The organiser is not lost: recorded_by carries their address, and the
       * book's history says "Written down by" them. What a null means here is
       * "no seller's balance", which is the truth.
       *
       * NOT the count-in. settle_book credits the returning seller from
       * held_by_agent on purpose: that path is recording what the seller sold
       * before they handed the book back, not making a new sale.
       */
      sold_by_agent = (
        select case when bk.status = 'Out' then bk.held_by_agent else null end
          from books bk where bk.idx = t.book_idx),
      amount = case when p_donated then 0 else price end,
      payment_status = 'Paid',
      sold_at = now(),
      source = 'book sale',
      recorded_by = p_user
    where idx = t.idx
      and status not in ('Sold', 'Donated', 'Void');

    get diagnostics touched = row_count;
    if touched = 0 then
      raise exception 'LOST_RACE: % was sold by somebody else while this book was being sold',
        t.number using errcode = 'serialization_failure';
    end if;

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
  touched integer;
begin
  live := active_tickets();
  select coalesce(nullif(value, '')::numeric, 10) into price from config where key = 'TICKET_PRICE';


  /*
   * PASS ZERO: TAKE THE LOCKS, IN INDEX ORDER, IN ONE STATEMENT.
   *
   * Everything below reads these rows and then writes them, and between those
   * two moments another session must not be able to sell one. Before this, two
   * batches naming the same ticket both read 'Available', both passed, and both
   * wrote — the second overwriting the first buyer's name and telephone number.
   *
   * Ordered by idx so that every caller locks the same rows in the same order
   * whatever order their batch arrived in: overlapping batches queue instead of
   * deadlocking. Rows that do not exist simply do not lock, and pass one still
   * reports them as TICKET_NOT_FOUND.
   */
  perform 1 from tickets
   where number in (select trim(s->>'ticketNumber') from jsonb_array_elements(p_sales) s)
   order by idx
     for update;

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
      -- The same rule as sell_books, and it has to be: one ticket sold out of a
      -- returned book and the whole book sold out of it credited two different
      -- people. The agentId the caller sends is ignored for a book that is not
      -- out with somebody — a sale at the desk belongs to no seller's balance.
      sold_by_agent = (
        select case when b2.status = 'Out' then b2.held_by_agent else null end
          from books b2
          join tickets t2 on t2.book_idx = b2.idx
         where t2.number = trim(sale->>'ticketNumber')),
      amount = case when coalesce((sale->>'donated')::boolean, false) then 0 else price end,
      payment_status = coalesce(sale->>'paymentStatus', 'Paid'),
      sold_at = now(),
      source = 'bulk',
      recorded_by = p_user
    where number = trim(sale->>'ticketNumber')
      -- Belt to the lock's braces. This cannot be false while the row is held,
      -- and it is what refuses to overwrite a sale if a later edit ever loses
      -- the lock: the write finds nothing, and the check below turns a silent
      -- no-op into an error.
      and status not in ('Sold', 'Donated', 'Void');

    get diagnostics touched = row_count;
    if touched = 0 then
      raise exception 'LOST_RACE: % was sold by somebody else while this batch was being checked',
        trim(sale->>'ticketNumber') using errcode = 'serialization_failure';
    end if;
    written := written + 1;
  end loop;

  return jsonb_build_object('recorded', written);
end $$ language plpgsql;
