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

-- TWO SIGNATURES, AND THE OLD ONE IS NOT DEPRECATED — it is how everything
-- that does not know about projects keeps working, which through Stage 3 is
-- everything: six policies, six views, and any hand-typed query.
--
-- A DEFAULT WOULD NOT DO. `active_tickets(p_project uuid default null)` beside
-- the existing `active_tickets()` makes the bare call ambiguous — Postgres
-- answers `function active_tickets() is not unique` — and every policy that
-- calls it stops working at once. A sibling overload with NO default resolves
-- cleanly in both directions: no argument picks the wrapper, one argument
-- picks the scoped body. Checked in a scratch database, not assumed. D-021.
--
-- Stage 4 deletes the wrapper and the coalesce inside it together, which is
-- where the plan puts strictness; until then a caller with no project is
-- answered about the raffle that was already here.
create or replace function active_tickets(p_project uuid) returns integer as $$
declare
  generated integer;
  active integer;
begin
  select coalesce(nullif(value, '')::integer, 0) into generated
    from config where key = 'TOTAL_TICKETS' and project_id = p_project;
  select coalesce(nullif(value, '')::integer, 0) into active
    from config where key = 'ACTIVE_TICKETS' and project_id = p_project;
  generated := coalesce(generated, 0);
  active := coalesce(active, 0);
  if active <= 0 or active > generated then return generated; end if;
  return active;
end $$ language plpgsql stable security definer set search_path = public;

create or replace function active_tickets() returns integer as $$
  select active_tickets(coalesce(current_project(), seed_project()))
$$ language sql stable security definer set search_path = public;

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
           -- offered_to_agent comes along because the custody check below reads
           -- it: an Offered book belongs to the seller it is waiting on, and
           -- without this the check compares against a column that is not here.
           b.status as book_status, b.held_by_agent, b.offered_to_agent
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

    /*
     * YOU CAN ONLY SELL PAPER YOU CAN HAND TO THE BUYER, and that is now the
     * whole of the rule rather than most of it.
     *
     * TWO THINGS CHANGED HERE, both asked for by the raffle's owner.
     *
     * OFFERED COUNTS. The condition asked about 'Out' alone, so a book reserved
     * for a seller who had not even accepted it yet could be sold from the desk.
     * Book-003 sat at Offered with nothing sold and "Sell it whole" live on it.
     * An offer is a book somebody is about to be handed; it is not stock.
     *
     * AND THE ORGANISER'S EXEMPTION IS GONE. `p_role <> 'admin'` let an
     * organiser write a sale into a book sitting in a seller's bag, on the
     * reasoning that they were transcribing what the seller had telephoned in.
     * The owner's rule is that the stubs decide: whoever is holding the paper is
     * the only person who can sell from it, and the way to sell a book that is
     * out with somebody is to get it back first. One sentence, no roles in it,
     * nothing to argue about at a desk.
     *
     * The holder is the seller it is Out with, or — for an Offered book — the
     * seller it is waiting on, who may sell from it the moment they accept.
     */
    if t.book_status in ('Out', 'Offered')
       and (p_agent_id is null
            or coalesce(t.held_by_agent, t.offered_to_agent) is distinct from p_agent_id) then
      failures := failures || jsonb_build_object('ticketNumber', num,
        'code', 'BOOK_WITH_SELLER',
        'message', 'Book ' || coalesce(t.book_number, '?') ||
                   case when t.book_status = 'Offered'
                        then ' is being offered to a seller. Take the offer back first if you need it.'
                        else ' is out with a seller. Have it brought back first.' end);
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

-- ============ SELLING WHOLE BOOKS ============
-- Tickets already sold to somebody else are SKIPPED and reported, never
-- overwritten. That reporting is the interesting half of the answer: selling a
-- book with three already gone is "7 sold, 3 left alone", and calling that
-- "book sold" is a lie the organiser would only discover at the draw.

/*
 * DROPPED FIRST, because p_sold_by is a new parameter and `create or replace`
 * cannot change a signature — it would leave the old ten-argument function in
 * place beside this one, and a call naming the arguments would then be
 * ambiguous between them. Postgres reports that as "function is not unique",
 * at the moment somebody sells a book, which is the worst place to find out.
 */
drop function if exists sell_books(text, text, jsonb, text, text, text, boolean, text, text, text);

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
  part_sold integer;
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
    -- The same rule as a single ticket, word for word in intent: Offered counts,
    -- and there is no organiser exemption. It matters more here, because this
    -- hands a whole book to one buyer.
    if b.status in ('Out', 'Offered')
       and (p_agent_id is null
            or coalesce(b.held_by_agent, b.offered_to_agent) is distinct from p_agent_id) then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_WITH_SELLER',
        'message', 'Book ' || b.number ||
                   case when b.status = 'Offered'
                        then ' is being offered to a seller. Take the offer back first if you need it.'
                        else ' is out with a seller. Have it brought back first.' end));
    end if;

    /*
     * A WHOLE BOOK MEANS A WHOLE BOOK.
     *
     * The loop below skips tickets that are already sold and sells the rest, so
     * a book with 8 of its 10 gone was sold "whole" to a buyer who got two
     * stubs. Nothing said so: the sale reported 2 sold and 8 skipped, and the
     * screen offered the button as though the book were untouched.
     *
     * A whole-book sale is one act with one buyer, one price and one receipt.
     * If somebody wants the two that are left they are selling two tickets,
     * which the Sell screen does properly — it names them and prices them.
     *
     * Refused here rather than filtered, because the caller asked for a book
     * and there is no book to give them. Selling them the remainder is
     * answering a different question from the one they asked.
     */
    -- `tk`, not `t`: this function already declares a RECORD variable called t
    -- for the loop below, and `from tickets t` binds to that variable instead
    -- of aliasing the table. It is not assigned yet here, so every call raised
    -- "record t is not assigned yet" — a body that compiled and could not run,
    -- which is the same shape as the idx shadowing in the offer functions.
    select count(*) into part_sold from tickets tk
     where tk.book_idx = b.idx and tk.status in ('Sold', 'Donated');
    if part_sold > 0 then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_NOT_WHOLE',
        'message', 'Book ' || b.number || ' is not whole — ' || part_sold ||
                   ' of its tickets are already sold. A whole-book sale is for a book ' ||
                   'nobody has sold from. Sell the remaining tickets one at a time instead.'));
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

-- MULTI-TENANCY, D-021's shape: a sibling overload carries the body, the old
-- zero-argument form delegates with the coalesce. One caller,
-- api/money.ts:236, unchanged — `rpc('desk_money', {})` still resolves to the
-- wrapper, which reads this raffle. p_project is not optional here either: a
-- default beside the existing zero-arg function makes the bare call
-- ambiguous, as it did for active_tickets (D-021).
create or replace function desk_money(p_project uuid) returns jsonb as $$
  with open_desk as (
    select count(*) as sold,
           coalesce(sum(t.amount), 0) as expected,
           coalesce(sum(t.amount) filter (where t.payment_status = 'Paid'), 0) as collected
    from tickets t
    join books b on b.idx = t.book_idx and b.project_id = t.project_id
    where t.project_id = p_project
      and t.sold_by_agent is null
      and t.status in ('Sold','Donated')
      and t.idx <= active_tickets(p_project)
      and not (b.status in ('Settled','Lost') and b.declared_sold is not null)
  ),
  closed_desk as (
    select coalesce(sum(b.declared_sold), 0) as sold,
           coalesce(sum(b.amount_due), 0) as expected,
           coalesce(sum(b.amount_paid), 0) as collected
    from books b
    where b.project_id = p_project
      and b.settled_by_agent is null
      and b.status in ('Settled','Lost')
      and b.declared_sold is not null
  )
  select jsonb_build_object(
    'sold',      (select sold from open_desk) + (select sold from closed_desk),
    'expected',  (select expected from open_desk) + (select expected from closed_desk),
    'collected', (select collected from open_desk) + (select collected from closed_desk));
$$ language sql stable;

create or replace function desk_money() returns jsonb as $$
  select desk_money(coalesce(current_project(), seed_project()))
$$ language sql stable;


-- ============ MOVING BOOKS, ATOMICALLY ============
-- ============ ISSUE ============
-- The predicate is the point and it is carried over exactly. issueBooks does
-- not update the books it was given: it updates the ones that are STILL free,
-- and reads back which rows that matched, so two organisers issuing the same
-- run a second apart cannot both succeed. Three cases, because a forced issue
-- takes anything, an ordinary one takes Unassigned, and a book brought back
-- with nothing sold out of it is free again although its status says Returned.
--
-- Returns the books actually written, so the caller can report the rest as
-- taken meanwhile, exactly as it does today.
-- MULTI-TENANCY, D-021's shape: p_project is REQUIRED (no default) so that a
-- call naming it and a call not naming it resolve to different, unambiguous
-- overloads — proved in a scratch database before writing any of the twelve
-- this way. Placed before the two arguments that already had defaults (p_note,
-- p_force), because Postgres requires every parameter after the first default
-- to have one too; PostgREST calls by name, so the position changes nothing
-- about how a caller invokes it.
create or replace function issue_books_tx(
  p_idxs           integer[],
  p_empty_returned integer[],
  p_agent_id       text,
  p_due_at         date,
  p_user           text,
  p_project        uuid,
  p_note           text default '',
  p_force          boolean default false
) returns table (idx integer, number text) as $$
declare
  issued integer[];
begin
  with written as (
    -- b.idx = any(p_idxs) IS NOT ENOUGH. idx is still the global PK through
    -- Stage 4, so without project_id an issue naming another organisation's
    -- book idx would take that book out from under its own seller — an
    -- ordinary-looking issue call reaching across the wall entirely.
    update books b set
      status = 'Out',
      held_by_agent = p_agent_id,
      issued_at = now(),
      due_at = p_due_at,
      modified_by = p_user
     where b.idx = any(p_idxs)
       and b.project_id = p_project
       and (
         p_force
         or (b.status = 'Unassigned' and not (b.idx = any(coalesce(p_empty_returned, '{}'))))
         or (b.status = 'Returned'   and b.idx = any(coalesce(p_empty_returned, '{}')))
       )
    returning b.idx, b.number
  )
  -- ALIASED, and the alias is the whole of it: this read `from written` while
  -- selecting w.idx, so Postgres refused the statement with "missing
  -- FROM-clause entry for table "w" — at RUN time, because a plpgsql body is
  -- not planned until it executes. It created cleanly, deployed cleanly, and
  -- broke giving books out, which is the most common act in the raffle.
  select array_agg(w.idx order by w.idx) into issued from written w;

  if issued is null then
    return;                       -- nothing matched; the caller says so
  end if;

  -- Stamped explicitly, matching the books it just wrote rather than left to
  -- the column default: the two must agree, and an explicit p_project is what
  -- the write above was already asked for.
  insert into book_history (book_idx, to_agent, action, by_user, note, project_id)
  select i, p_agent_id, 'issue', p_user, coalesce(p_note, ''), p_project
    from unnest(issued) i order by i;

  return query
    select b.idx, b.number from books b where b.idx = any(issued) order by b.idx;
end $$ language plpgsql;

-- Old six-argument form: kept for the reason every wrapper in this file is,
-- and driven directly by test-functions.sh via `set local app.project_id`.
create or replace function issue_books_tx(
  p_idxs           integer[],
  p_empty_returned integer[],
  p_agent_id       text,
  p_due_at         date,
  p_user           text,
  p_note           text default '',
  p_force          boolean default false
) returns table (idx integer, number text) as $$
  select * from issue_books_tx(
    p_idxs, p_empty_returned, p_agent_id, p_due_at, p_user,
    coalesce(current_project(), seed_project()), p_note, p_force)
$$ language sql;

-- ============ BRING BACK ============
create or replace function return_books_tx(
  p_idxs   integer[],
  p_user   text,
  p_project uuid,
  p_note   text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- The history row names who it came FROM, so it is read before the update
  -- clears nothing — held_by_agent deliberately survives a return, which is how
  -- "brought back by" keeps a name on it.
  insert into book_history (book_idx, from_agent, action, by_user, note, project_id)
  select b.idx, b.held_by_agent, 'return', p_user, coalesce(p_note, ''), p_project
    from books b where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx;

  -- WITHOUT project_id, this would return a book by idx alone: another
  -- organisation's book number colliding with one of these idxs would be
  -- marked Returned in a raffle its own seller never touched.
  update books set status = 'Returned', modified_by = p_user
   where idx = any(p_idxs) and project_id = p_project;
  get diagnostics moved = row_count;

  -- A ticket held for a buyer who never came is stock again the moment the
  -- book is on the desk. Sold ones are untouched. Scoped through the book's
  -- own project rather than repeating the array test, so a ticket cannot be
  -- freed by naming a book idx that belongs to a different raffle.
  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', recorded_by = p_user
   where book_idx in (select idx from books where idx = any(p_idxs) and project_id = p_project)
     and status = 'Reserved';

  return moved;
end $$ language plpgsql;

create or replace function return_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
  select return_books_tx(p_idxs, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

-- ============ PASS TO SOMEBODY ELSE ============
create or replace function transfer_books_tx(
  p_idxs     integer[],
  p_to_agent text,
  p_user     text,
  p_project  uuid,
  p_note     text default ''
) returns integer as $$
declare
  moved integer;
begin
  -- p_to_agent is an agent_id, still a global PK through Stage 4, so it names
  -- no project by itself. Scoping the read and the write both to p_project is
  -- what stops a transfer naming another raffle's book idx from moving it to
  -- an agent in THIS raffle — a book leaving its own organisation entirely.
  insert into book_history (book_idx, from_agent, to_agent, action, by_user, note, project_id)
  select b.idx, b.held_by_agent, p_to_agent, 'transfer', p_user, coalesce(p_note, ''), p_project
    from books b where b.idx = any(p_idxs) and b.project_id = p_project order by b.idx;

  update books set held_by_agent = p_to_agent, modified_by = p_user
   where idx = any(p_idxs) and project_id = p_project;
  get diagnostics moved = row_count;

  return moved;
end $$ language plpgsql;

create or replace function transfer_books_tx(
  p_idxs     integer[],
  p_to_agent text,
  p_user     text,
  p_note     text default ''
) returns integer as $$
  select transfer_books_tx(p_idxs, p_to_agent, p_user, coalesce(current_project(), seed_project()), p_note)
$$ language sql;

-- ============ BACK ON THE SHELF ============
-- The one with money in it. Clearing amount_paid takes the settlement figure
-- off the book, and the payments that made up that figure stay in the ledger —
-- so they are reversed in the same breath, or the book and the ledger disagree
-- from the moment this returns. That reversal used to be one statement and the
-- clearing another.
create or replace function restock_books_tx(
  p_idxs integer[],
  p_user text,
  p_note text default ''
) returns integer as $$
declare
  moved integer;
begin
  /*
   * Reverse each settlement payment that is not already reversed, and write the
   * same money straight back as a hand-over, in one statement so that neither
   * can happen without the other.
   *
   * The reversal is bookkeeping: the book's amount_paid is about to be cleared
   * and that row is the same cash. The hand-over is the fact: the seller gave
   * the raffle this money and still has.
   */
  with undone as (
    insert into payments (agent_id, amount, received_by, method, book_idx, source, reverses, note)
    select p.agent_id, -p.amount, p_user, coalesce(p.method, 'cash'), p.book_idx, 'settlement',
           p.id, 'Reversed: book put back on the shelf'
      from payments p
     where p.book_idx = any(p_idxs)
       and p.source = 'settlement'
       and p.reverses is null
       and not exists (select 1 from payments r where r.reverses = p.id)
    returning agent_id, -amount as amount, book_idx, method
  )
  insert into payments (agent_id, amount, received_by, method, book_idx, source, note)
  select u.agent_id, u.amount, p_user, u.method, u.book_idx, 'hand',
         'Cash kept from the count-in of ' ||
         coalesce((select b.number from books b where b.idx = u.book_idx), 'a book') ||
         ', which went back on the shelf'
    from undone u
   where u.amount <> 0;

  insert into book_history (book_idx, from_agent, action, by_user, note)
  select b.idx, b.held_by_agent, 'restock', p_user,
         coalesce(nullif(p_note, ''),
                  case when b.declared_sold is not null
                       then 'Settlement of ' || b.declared_sold || ' cleared.'
                       else '' end)
    from books b where b.idx = any(p_idxs) order by b.idx;

  update books set
    status = 'Unassigned', held_by_agent = null,
    issued_at = null, due_at = null,
    declared_sold = null, amount_due = null, amount_paid = null,
    settled_at = null, settled_by = '', settled_by_agent = null, notes = '',
    modified_by = p_user
   where idx = any(p_idxs);
  get diagnostics moved = row_count;

  update tickets set
    status = 'Available', buyer_name = '', buyer_phone = '', buyer_zone = '',
    sold_by_agent = null, amount = null, payment_status = '', sold_at = null,
    source = '', recorded_by = p_user
   where book_idx = any(p_idxs) and status in ('Available', 'Reserved');

  return moved;
end $$ language plpgsql;

-- ============================================================================
-- OFFERING A BOOK, WHICH TAKES TWO PEOPLE
--
-- Verbatim from 20260918800000. Kept here because this file is what a deploy
-- re-applies and what a fresh install gets; a function that lives only in its
-- migration is a function a re-run of this file silently reverts.
-- ============================================================================
-- ============ OFFER ============
--
-- ALL OR NOTHING, like every other book operation here. A batch whose premise
-- is wrong for one book is a batch somebody has misread, and offering the other
-- nine hides it. The offenders are named, because "3 books are not free" sends
-- somebody to a list and "Book-041, Book-042" sends them to the shelf.
create or replace function offer_books_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_due_at   date,
  p_user     text,
  p_note     text default ''
) returns table (idx integer, number text) as $$
declare
  wrong     integer;
  offenders text;
  offered   integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    raise exception 'NOTHING_TO_OFFER: no books were named';
  end if;
  if coalesce(trim(p_agent_id), '') = '' then
    raise exception 'MISSING_HOLDER: an offer needs somebody to offer it to';
  end if;
  if not exists (select 1 from agents where agent_id = p_agent_id) then
    raise exception 'AGENT_NOT_FOUND: no seller with id %', p_agent_id;
  end if;

  -- In book order, so two overlapping batches queue rather than deadlock.
  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs) and b.status <> 'Unassigned';

  if wrong > 0 then
    raise exception 'BOOKS_NOT_FREE: % of % are not on the shelf — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  /*
   * ON THE SHELF IS NOT THE SAME AS WHOLE.
   *
   * Restocking returns the unsold tickets to the pool and leaves every SOLD
   * ticket with its buyer — deliberately, because that money is real and
   * belongs to whoever sold it. So an Unassigned book can have eight of its ten
   * already gone, and the status check above waves it through: the offer screen
   * counted it among "1,000 books free" and would have handed a seller a book
   * with two sellable tickets in it.
   *
   * A book given to a seller is a book they can work. The two that are left are
   * sold at the desk, one at a time, which is what the Sell screen is for.
   */
  /*
   * EVERY TICKET IN IT, not merely none sold.
   *
   * Asking about sales alone let through a book with tickets RESERVED or VOIDED
   * — not a whole book, and not ten tickets the seller can sell. The test is
   * that every ticket in the book is Available, which fails reserved, voided,
   * and any status invented later without this having to learn their names.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
     and exists (select 1 from tickets tk
                  where tk.book_idx = b.idx and tk.status <> 'Available');

  if wrong > 0 then
    raise exception 'BOOK_NOT_WHOLE: % of % are not whole books — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  -- RETURNING, not a re-read. What this wrote is the only honest answer to
  -- "what did this write"; asking the table afterwards which books are Offered
  -- also collects books somebody else offered a moment ago.
  with written as (
    update books b set
      status = 'Offered',
      offered_to_agent = p_agent_id,
      offered_at = now(),
      offered_by = p_user,
      due_at = p_due_at,
      modified_by = p_user
     where b.idx = any(p_idxs) and b.status = 'Unassigned'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into offered from written w;

  if offered is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'offer', p_user,
         coalesce(nullif(p_note, ''), 'Offered, waiting for the seller to accept')
    from unnest(offered) i order by i;

  return query select b.idx, b.number from books b where b.idx = any(offered) order by b.idx;
end $$ language plpgsql;

-- ============ ACCEPT ============
--
-- The seller's half. Everything issue_books_tx does, from the Offered state
-- rather than from the shelf, and only for the seller the books were offered
-- to — an acceptance by anybody else is not an acceptance.
create or replace function accept_offer_tx(
  p_idxs     integer[],
  p_agent_id text,
  p_user     text,
  p_note     text default ''
) returns table (idx integer, number text) as $$
declare
  wrong     integer;
  offenders text;
  taken     integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    raise exception 'NOTHING_TO_ACCEPT: no books were named';
  end if;

  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

  /*
   * NOT OFFERED TO YOU IS NOT AN ACCEPTANCE. Checked as one question — offered,
   * and offered to this seller — because splitting them into "is it offered"
   * and "is it yours" invites a later edit that answers only the first.
   */
  select count(*), string_agg(b.number, ', ' order by b.idx)
    into wrong, offenders
    from books b
   where b.idx = any(p_idxs)
     and (b.status <> 'Offered' or b.offered_to_agent is distinct from p_agent_id);

  if wrong > 0 then
    raise exception 'NOT_OFFERED_TO_YOU: % of % are not waiting for you — %',
      wrong, array_length(p_idxs, 1), left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  with written as (
    update books b set
      status = 'Out',
      held_by_agent = p_agent_id,
      issued_at = now(),
      offered_to_agent = null,
      offered_at = null,
      offered_by = '',
      modified_by = p_user
     where b.idx = any(p_idxs) and b.status = 'Offered'
       and b.offered_to_agent = p_agent_id
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into taken from written w;

  if taken is null then return; end if;

  insert into book_history (book_idx, to_agent, action, by_user, note)
  select i, p_agent_id, 'issue', p_user,
         coalesce(nullif(p_note, ''), 'Accepted by the seller')
    from unnest(taken) i order by i;

  return query select b.idx, b.number from books b where b.idx = any(taken) order by b.idx;
end $$ language plpgsql;

-- ============ RELEASE ============
--
-- ONE FUNCTION FOR EVERY WAY AN OFFER ENDS WITHOUT BEING ACCEPTED: the seller
-- declines, the organiser withdraws, or nobody answers and it expires. Three
-- callers, one behaviour — because an offer released two ways is an offer
-- released two slightly different ways by next year, and the difference will be
-- whether the book got back on the shelf.
--
-- It does NOT care who the book was offered to. An offer whose seller has since
-- been deleted is exactly the one somebody needs to clear.
create or replace function release_offer_tx(
  p_idxs   integer[],
  p_user   text,
  p_reason text default ''
) returns integer as $$
declare
  freed integer[];
begin
  if p_idxs is null or array_length(p_idxs, 1) is null then
    return 0;
  end if;

  perform 1 from books b where b.idx = any(p_idxs) order by b.idx for update;

  -- Silent about books that are not Offered. Unlike offering and accepting,
  -- this is a cleanup that runs from three places including an expiry sweep,
  -- and a sweep that raises on a book somebody already dealt with is a sweep
  -- that stops halfway.
  -- RETURNING is load-bearing here rather than tidy. Re-reading for "books
  -- that are now Unassigned" collects every book that was ALREADY on the shelf
  -- and was never part of this offer, and would write a release into their
  -- history and count them in the total. The UPDATE knows; the table does not.
  with written as (
    update books b set
      status = 'Unassigned',
      offered_to_agent = null,
      offered_at = null,
      offered_by = '',
      due_at = null,
      modified_by = p_user
     where b.idx = any(p_idxs) and b.status = 'Offered'
    returning b.idx
  )
  select array_agg(w.idx order by w.idx) into freed from written w;

  if freed is null then return 0; end if;

  insert into book_history (book_idx, action, by_user, note)
  select i, 'release', p_user,
         coalesce(nullif(p_reason, ''), 'Offer ended without being accepted')
    from unnest(freed) i order by i;

  return array_length(freed, 1);
end $$ language plpgsql;

revoke execute on function offer_books_tx(integer[], text, date, text, text)
  from public, anon, authenticated;
revoke execute on function accept_offer_tx(integer[], text, text, text)
  from public, anon, authenticated;
revoke execute on function release_offer_tx(integer[], text, text)
  from public, anon, authenticated;


-- Called by the Edge Function under the service role, and by nobody else: these
-- take an already-judged list of books and do not re-check who may move them.
--
-- EVERY OVERLOAD NEEDS ITS OWN LINE, and this is the trap the multi-tenancy
-- work walked into. A REVOKE names an exact signature, and `create or replace`
-- preserves privileges only when it replaces the SAME signature — so a sibling
-- overload taking p_project is a brand new function object, and Postgres grants
-- EXECUTE on a new function to PUBLIC by default. Every p_project sibling added
-- for Stage 2 arrived publicly callable, including these three. Measured with
-- has_function_privilege, not read: anon could call all of them.
--
-- service_role is deliberately not named. Revoking PUBLIC does not touch the
-- separate grant Supabase's own bootstrap gives service_role on functions in
-- this schema, which is why the lines above have always been enough for the
-- Edge Function to keep working.
revoke execute on function issue_books_tx(integer[], integer[], text, date, text, text, boolean) from public, anon, authenticated;
revoke execute on function issue_books_tx(integer[], integer[], text, date, text, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function return_books_tx(integer[], text, text) from public, anon, authenticated;
revoke execute on function return_books_tx(integer[], text, uuid, text) from public, anon, authenticated;
revoke execute on function transfer_books_tx(integer[], text, text, text) from public, anon, authenticated;
revoke execute on function transfer_books_tx(integer[], text, text, uuid, text) from public, anon, authenticated;
revoke execute on function restock_books_tx(integer[], text, text) from public, anon, authenticated;


-- desk_money() is revoked in rls.sql:835; its p_project sibling is revoked here
-- beside the rest of Stage 2's, so the pair is not split across two files.
revoke execute on function desk_money(uuid) from public, anon, authenticated;

-- active_tickets(uuid) IS THE ONE THAT KEEPS authenticated, and that is
-- measured rather than assumed. Revoking it from authenticated breaks
-- tickets_readable and book_ledger with `permission denied for function
-- active_tickets` — a definer view runs its TABLE access as the view owner but
-- still checks function EXECUTE against the calling role, which is not what
-- "security_invoker = false" reads like it would do.
--
-- anon losing it is the point: with the project as an argument, anyone holding
-- another organisation's project id could read that raffle's in-play count.
-- Stage 3 should make it answer nothing for a project the caller is not a
-- member of, once member_role() exists — recorded as D-035.
revoke execute on function active_tickets(uuid) from public, anon;


-- ============ MOVING TICKETS, AS A LEDGER ============
create or replace function move_tickets(
  p_ticket_idxs integer[],
  p_from_holder text,
  p_to_holder   text,
  p_kind        text,
  p_user        text,
  p_reason      text default '',
  p_client_key  text default null
) returns jsonb as $$
declare
  batch     uuid := gen_random_uuid();
  moved     integer := 0;
  wrong     integer;
  offenders text;
  existing  uuid;
begin
  if p_ticket_idxs is null or array_length(p_ticket_idxs, 1) is null then
    raise exception 'NOTHING_TO_MOVE: no tickets were named';
  end if;
  if coalesce(trim(p_to_holder), '') = '' or coalesce(trim(p_from_holder), '') = '' then
    -- The desk is 'desk', never blank and never null. A blank holder is how
    -- "everything except X" gets into a query that looked exhaustive.
    raise exception 'MISSING_HOLDER: a movement needs both ends named';
  end if;

  /*
   * A REPLAY RETURNS WHAT THE FIRST ATTEMPT DID, rather than a duplicate-key
   * error or a second set of movements. Checked before the locks: a replay
   * should not queue behind the batch it is a replay of.
   */
  if p_client_key is not null and p_client_key <> '' then
    select batch_id into existing from ticket_movements
     where client_key = p_client_key limit 1;
    if existing is not null then
      return jsonb_build_object(
        'batch', existing, 'moved', (select count(*) from ticket_movements where batch_id = existing),
        'replayed', true);
    end if;
  end if;

  -- In ticket order, so overlapping batches queue rather than deadlock.
  perform 1 from tickets where idx = any(p_ticket_idxs) order by idx for update;

  /*
   * EVERY TICKET MUST BE WHERE THE CALLER SAYS IT IS.
   *
   * Not "most of them" and not "skip the ones that are not": a movement batch
   * whose premise is wrong for one ticket is a batch somebody has misread, and
   * moving the other nine hides it. The offenders are named, up to a handful,
   * because "3 tickets are not where you think" sends somebody to a list and
   * "KS-00041, KS-00042" sends them to the paper.
   */
  select count(*), string_agg(t.number, ', ' order by t.idx)
    into wrong, offenders
    from tickets t
   where t.idx = any(p_ticket_idxs)
     and t.holder is distinct from p_from_holder;

  if wrong > 0 then
    raise exception 'NOT_THERE: % of % tickets are not with % — %',
      wrong, array_length(p_ticket_idxs, 1), p_from_holder,
      left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  insert into ticket_movements
    (ticket_idx, from_holder, to_holder, kind, batch_id, by_user, reason, client_key)
  select t.idx, p_from_holder, p_to_holder, p_kind, batch, p_user, coalesce(p_reason, ''),
         -- One key per batch, on its first row: the index is unique, so hanging
         -- it on every row would refuse the batch's own second ticket.
         case when t.idx = (select min(x) from unnest(p_ticket_idxs) x)
              then nullif(p_client_key, '') end
    from tickets t
   where t.idx = any(p_ticket_idxs)
   order by t.idx;
  get diagnostics moved = row_count;

  -- The projection, in the same statement's transaction. A screen reads this
  -- column; the ledger above is what it must always be derivable from.
  update tickets set holder = p_to_holder
   where idx = any(p_ticket_idxs);

  return jsonb_build_object('batch', batch, 'moved', moved, 'replayed', false);
end $$ language plpgsql;

revoke execute on function move_tickets(integer[], text, text, text, text, text, text)
  from public, anon, authenticated;

-- ============ WHAT THE LEDGER SAYS, INDEPENDENTLY OF THE COLUMN ============
-- The replay: where each ticket is according to its movements alone. This is
-- what §22's check compares against tickets.holder, and it is a view rather
-- than a script so that the comparison can be run any day, not only on the day
-- of the backfill. A projection nobody re-derives is a cache nobody has checked.
create or replace view ticket_custody as
select t.idx,
       t.number,
       t.holder                              as projected,
       coalesce(m.to_holder, 'desk')         as replayed,
       t.holder is distinct from coalesce(m.to_holder, 'desk') as disagrees
  from tickets t
  left join lateral (
    select mv.to_holder
      from ticket_movements mv
     where mv.ticket_idx = t.idx
       and mv.reverses is null
       and not exists (select 1 from ticket_movements r where r.reverses = mv.id)
     order by mv.at desc, mv.id desc
     limit 1
  ) m on true;

revoke all on ticket_custody from anon, authenticated;

-- ============ THE BUYER'S OWN DIGITAL TICKET ============
--
-- One per buyer, and a buyer is a NAME AND A NUMBER TOGETHER: a household or a
-- shop shares one telephone number, and keying on the number alone would show
-- one person what everybody else who used that phone had bought. What it
-- covers is never stored — `holding_of` resolves a code to its buyer and
-- answers with the tickets they hold AT THE MOMENT somebody scans, so nothing
-- refreshes it and no sale path has to remember a second table. The check page
-- may not touch a telephone number, so the join lives in here behind SECURITY
-- DEFINER. See the migrations of 2026-09-21.

/*
 * The live holding, now resolved by both halves of the identity.
 *
 * `t.buyer_phone = r.buyer_phone and buyer_key(t.buyer_name) = buyer_key(r.buyer_name)`
 * is the whole change. Everything else — the legacy branch, the ordering, the
 * limit, SECURITY DEFINER and why it exists — is as it was; see the migration
 * of 2026-09-21 that introduced it.
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
      -- A LIVE HOLDING: every ticket this buyer holds now. Both halves of the
      -- identity, so a shared telephone number does not pool two people.
      select t.idx, t.number, t.status, t.buyer_name, t.amount, t.book_idx
        from ticket_receipts r
        join tickets t
          -- THE RAFFLE COMES FROM THE RECEIPT, and there is no header to read:
          -- the verify function is public and sends none. Without this join
          -- condition a receipt minted in one organisation, whose buyer shares
          -- a telephone number and name with a buyer in another, returns the
          -- OTHER organisation's tickets — a stranger's purchases, to whoever
          -- scanned the code.
          on t.project_id = r.project_id
         and t.buyer_phone = r.buyer_phone
         and buyer_key(t.buyer_name) = buyer_key(r.buyer_name)
       where r.code = p_code
         and r.buyer_phone <> ''
         and t.status in ('Sold', 'Donated', 'Void')

      union all

      -- A RECEIPT MINTED BEFORE THE MODEL CHANGED: a fixed set, still answered.
      select t.idx, t.number, t.status, t.buyer_name, t.amount, t.book_idx
        from ticket_receipts r
        join ticket_receipt_items ri on ri.code = r.code
                                    and ri.project_id = r.project_id
        join tickets t on t.idx = ri.ticket_idx
                      and t.project_id = ri.project_id
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
 * The token, against both halves. The old three-argument form is dropped
 * rather than overloaded: two functions of the same name differing by one
 * argument is a call that resolves to whichever Postgres prefers, and the one
 * it prefers would be the one that keys on the number alone.
 */
-- MULTI-TENANCY, D-021's shape, and a correction to the comment this replaces.
-- That comment said an argument would change a signature every handler calls
-- and explicit carriage would arrive WITH the scoped client — which is now:
-- the wrapper replaces ctx.supabaseAdmin for every handler (index.ts, the
-- tenancy-stage-2 branch), so printing.ts:680's call arrives with p_project
-- ADDED, not with the same four names. Keeping the four-argument form as the
-- only signature would make that call fail with no matching function, the
-- same trap active_tickets and desk_money were written to avoid.
create or replace function ensure_holding_tx(
  p_phone   text,
  p_name    text,
  p_code    text,
  p_user    text,
  p_project uuid
) returns table (holding_code text, was_created boolean) as $$
declare
  found_code text;
  phone      text := btrim(coalesce(p_phone, ''));
  name_given text := btrim(coalesce(p_name, ''));
begin
  -- Refused rather than defaulted: '' is the absence of an identity, and
  -- accepting it would pool every buyer with no number recorded into one
  -- shared digital ticket listing each other's tickets.
  if phone = '' then
    raise exception 'a digital ticket needs a buyer';
  end if;

  -- WITHIN THIS RAFFLE. The same person may buy in two organisations' raffles,
  -- and they are two holdings: one code each, listing that raffle's tickets.
  -- Unscoped, the second organiser asking for a digital ticket would be handed
  -- the FIRST organisation's code — so their buyer would receive a link to
  -- somebody else's raffle showing tickets they did not buy, and no new
  -- receipt would ever be created for them.
  select r.code into found_code
    from ticket_receipts r
   where r.buyer_phone = phone
     and buyer_key(r.buyer_name) = buyer_key(name_given)
     and r.project_id = p_project
   limit 1;

  if found_code is null then
    -- STAMPED EXPLICITLY, not left to the column default. p_project is what
    -- the caller named; the default reads the header, and a caller that
    -- passed an explicit project through a path with no matching header
    -- (a runbook, a future control-plane action) must not have its receipt
    -- land somewhere it did not ask for.
    insert into ticket_receipts (code, created_by, buyer_phone, buyer_name, project_id)
      values (p_code, coalesce(p_user, ''), phone, name_given, p_project);
    return query select p_code, true;
  else
    return query select found_code, false;
  end if;
end $$ language plpgsql;

-- The old four-argument form, kept for the same reason active_tickets and
-- desk_money keep theirs: test-functions.sh drives this directly with
-- `set local app.project_id = …`, and a caller with no p_project to give
-- still needs an answer about the raffle that was already here.
create or replace function ensure_holding_tx(
  p_phone text,
  p_name  text,
  p_code  text,
  p_user  text
) returns table (holding_code text, was_created boolean) as $$
  select * from ensure_holding_tx(
    p_phone, p_name, p_code, p_user, coalesce(current_project(), seed_project()))
$$ language sql;

-- THE DIGITAL TICKET PAIR, revoked here rather than beside the book functions
-- because a REVOKE needs the function to exist already and ensure_holding_tx is
-- defined at the bottom of this file. The four-argument form's exposure
-- predates the multi-tenancy work — it has never had a revoke at all. It finds
-- or mints a receipt from a telephone number and a name, so whoever may run it
-- can ask whether a given person holds tickets, and can mint codes.
revoke execute on function ensure_holding_tx(text, text, text, text) from public, anon, authenticated;
revoke execute on function ensure_holding_tx(text, text, text, text, uuid) from public, anon, authenticated;
