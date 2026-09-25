/*
 * MULTI-TENANCY STAGE 2 (MT-2d): bulk_record_sales, the first of the money
 * three.
 *
 * Every lookup here keys on tickets.number, the GLOBAL unique until Stage 4,
 * so a batch naming another organisation's ticket numbers reached their rows
 * and judged them against their books. Both settings it reads are per project
 * too: the in-play ceiling and TICKET_PRICE. A batch priced at another
 * organisation's price writes the wrong amount onto every row it touches.
 *
 * WHAT ACTUALLY STOPS THE SALE TODAY is worth stating precisely, because the
 * obvious claim is wrong. It is not the scoping — it is the active-tickets
 * ceiling. With the predicate removed the refusal changes from
 * TICKET_NOT_FOUND to TICKET_NOT_RELEASED: the row IS found, then rejected
 * because its idx is past this raffle's range. Two raffles' idx ranges cannot
 * overlap while idx is the global primary key, so the reach is bounded today.
 *
 * It stops being bounded at Stage 4, which is why the predicate goes in now:
 * once the key is composite both raffles number from 1, every idx is inside
 * every ceiling, and this line is all that is left between a batch and another
 * organisation's tickets.
 *
 * THE ORIGINAL SIGNATURE IS REVOKED TOO, which it never was. It is an invoker
 * function so the table grants stopped an anonymous caller reaching the rows,
 * but this is the batch sale entry point and the api's service key is its only
 * caller — tickets.ts:824, and nothing in src/. Grepped before revoking.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function bulk_record_sales(
  p_sales jsonb,
  p_user text,
  p_role text,
  p_agent_id text,
  p_project uuid,
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
  -- BOTH OF THESE ARE THIS RAFFLE'S. The in-play ceiling and the ticket price
  -- are settings, and settings belong to a project: a batch priced at another
  -- organisation's TICKET_PRICE writes the wrong amount onto every row, and a
  -- ceiling read from elsewhere admits or refuses the wrong tickets.
  live := active_tickets(p_project);
  select coalesce(nullif(value, '')::numeric, 10) into price
    from config where key = 'TICKET_PRICE' and project_id = p_project;


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
     and project_id = p_project
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
      -- number is the GLOBAL unique until Stage 4, so without the project a
      -- batch naming another organisation's ticket numbers finds their rows,
      -- judges them against their books, and sells their tickets.
      from tickets tk join books b on b.idx = tk.book_idx
                                  and b.project_id = tk.project_id
     where tk.number = num and tk.project_id = p_project;

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
          join tickets t2 on t2.book_idx = b2.idx and t2.project_id = b2.project_id
         where t2.number = trim(sale->>'ticketNumber')
           and t2.project_id = p_project),
      amount = case when coalesce((sale->>'donated')::boolean, false) then 0 else price end,
      payment_status = coalesce(sale->>'paymentStatus', 'Paid'),
      sold_at = now(),
      source = 'bulk',
      recorded_by = p_user
    where number = trim(sale->>'ticketNumber')
      and project_id = p_project
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

create or replace function bulk_record_sales(
  p_sales jsonb,
  p_user text,
  p_role text,
  p_agent_id text,
  p_force boolean default false
) returns jsonb as $$
  select bulk_record_sales(p_sales, p_user, p_role, p_agent_id,
                           coalesce(current_project(), seed_project()), p_force)
$$ language sql;

-- THE ORIGINAL IS REVOKED TOO, which it never was. bulk_record_sales is an
-- invoker function, so the table grants stopped an anonymous caller reaching
-- the rows — but it is the batch sale entry point and the api's service key is
-- its only caller (tickets.ts:824; nothing in src/ calls it). Grepped before
-- revoking, as the review asked.
revoke execute on function bulk_record_sales(jsonb, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function bulk_record_sales(jsonb, text, text, text, uuid, boolean)
  from public, anon, authenticated;


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
