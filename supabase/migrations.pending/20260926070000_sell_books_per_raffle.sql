/*
 * MULTI-TENANCY STAGE 2 (MT-2d): sell_books, second of the money three.
 *
 * A whole-book sale resolves books by NUMBER, the global unique until Stage 4,
 * so naming another organisation's book number reached their row. Unscoped,
 * this raffle selling OB-0902 — which belongs to the other one — does not
 * refuse: it answers `{"sold": 0, "books": [], …}`, a success shape reporting
 * nothing sold. The caller is told the sale went through.
 *
 * Both settings are per raffle too. TICKET_PRICE decides the amount written
 * onto as many as two hundred tickets and onto the buyer's receipt;
 * TICKETS_PER_BOOK decides which books count as released.
 *
 * AN EXISTING GUARD HAD TO BE RE-AIMED, and it is worth reading why rather
 * than taking the diff at face value. test-functions.sh asserted there is
 * exactly ONE sell_books, "so a sale is not ambiguous between two signatures".
 * The invariant is the ambiguity, not the count — and this adds a second
 * signature deliberately. The pair is unambiguous because p_project has NO
 * default: a call that does not name it cannot match the raffle-aware
 * signature, and a call that does cannot match the wrapper. That property is
 * now what is asserted. Proved by giving p_project a default in a scratch
 * copy: fourteen cases go red with `function sell_books(…) is not unique`,
 * which is precisely what the original guard was written to prevent.
 *
 * Both signatures are revoked. The original never was: an invoker function, so
 * the table grants stopped an anonymous caller reaching the rows, but this
 * sells a whole book to a named buyer and the api's service key is its only
 * caller — tickets.ts:912, nothing in src/. Grepped before revoking.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

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
  p_project uuid,
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
  -- This raffle's ceiling and this raffle's price. A whole-book sale priced at
  -- another organisation's TICKET_PRICE puts the wrong amount on every one of
  -- up to two hundred tickets, and on the buyer's receipt.
  live := active_tickets(p_project);
  select coalesce(nullif(value, '')::numeric, 10) into price
    from config where key = 'TICKET_PRICE' and project_id = p_project;

  if p_book_numbers is not null then
    select array_agg(bk.idx order by bk.idx) into idxs
      -- books.number is the GLOBAL unique until Stage 4, so a list of book
      -- numbers names rows in any raffle unless this says which.
      from books bk where bk.number = any(
        select jsonb_array_elements_text(p_book_numbers))
        and bk.project_id = p_project;
  else
    select idx into first_idx from books
      where number = p_from_book and project_id = p_project;
    if first_idx is null then
      return jsonb_build_object('error', jsonb_build_object(
        'code', 'BOOK_NOT_FOUND', 'message', 'Book ' || coalesce(p_from_book, '?') || ' does not exist.'));
    end if;
    if p_to_book is null or p_to_book = '' then
      last_idx := first_idx;
    else
      select idx into last_idx from books
        where number = p_to_book and project_id = p_project;
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
  for b in select * from books
            where idx = any(idxs) and project_id = p_project order by idx loop
    book_numbers := book_numbers || b.number;

    if b.idx * (select coalesce(nullif(value, '')::integer, 10) from config
                 where key = 'TICKETS_PER_BOOK' and project_id = p_project)
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
     where tk.book_idx = b.idx and tk.project_id = b.project_id
       and tk.status in ('Sold', 'Donated');
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
  for t in select * from tickets
            where book_idx = any(idxs) and project_id = p_project
            order by idx for update loop
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
          from books bk where bk.idx = t.book_idx and bk.project_id = p_project),
      amount = case when p_donated then 0 else price end,
      payment_status = 'Paid',
      sold_at = now(),
      source = 'book sale',
      recorded_by = p_user
    where idx = t.idx
      and project_id = p_project
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
  p_sold_by text default null
) returns jsonb as $$
  select sell_books(p_from_book, p_to_book, p_book_numbers, p_buyer_name, p_buyer_phone,
                    p_buyer_zone, p_donated, p_user, p_role, p_agent_id,
                    coalesce(current_project(), seed_project()), p_sold_by)
$$ language sql;

-- Both signatures revoked. The original never was: an invoker function, so the
-- table grants stopped an anonymous caller reaching the rows, but this sells a
-- whole book to a named buyer and the api's service key is its only caller
-- (tickets.ts:912; nothing in src/). Grepped before revoking.
revoke execute on function sell_books(text, text, jsonb, text, text, text, boolean, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function sell_books(text, text, jsonb, text, text, text, boolean, text, text, text, uuid, text)
  from public, anon, authenticated;
