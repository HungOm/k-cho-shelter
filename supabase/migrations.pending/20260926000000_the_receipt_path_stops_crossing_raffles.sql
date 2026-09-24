/*
 * MULTI-TENANCY STAGE 2: the receipt path stops crossing between raffles.
 *
 * Two functions, and both were a privacy leak rather than a wrong total, which
 * is why they come before the other twelve.
 *
 * holding_of — what a scanned digital ticket lists — matched a receipt to
 * tickets on buyer_phone and buyer_name alone. The same person buying in two
 * organisations' raffles is an ordinary thing, and for that person either code
 * returned BOTH raffles' tickets: a stranger's purchases, to whoever was
 * holding the code. The project now comes off the receipt row, `r.project_id`,
 * and not from a header — the verify function is public and sends none. Proved
 * by removing the join condition again and watching both codes answer
 * "KS-00007,OT-00901".
 *
 * ensure_holding_tx — which finds or mints that receipt — looked for an
 * existing holding by phone and name across every raffle. So the SECOND
 * organiser asking for a digital ticket for that buyer was handed the FIRST
 * organisation's code, their buyer received a link to a raffle they had never
 * bought from, and no receipt was ever created for them at all. It now looks
 * within the request's project, falling back to the raffle that was already
 * here. Not a new argument: that would change a signature every handler calls,
 * and the header is already set on every request. Proved by removing the
 * predicate and watching the second organiser receive AAAAAAAAAAAA.
 *
 * NEITHER CHANGES ANYTHING WITH ONE RAFFLE: every row shares its project_id,
 * so both predicates select what they selected before. The evidence that they
 * do the intended thing is a second raffle, which test-functions.sh now builds
 * — see the section headed "a second raffle is a second raffle", and D-033 for
 * how much of a second raffle is possible before Stage 4.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
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

create or replace function ensure_holding_tx(
  p_phone text,
  p_name  text,
  p_code  text,
  p_user  text
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
  --
  -- The project comes from the request header, which the router sets on every
  -- request, and falls back to the raffle that was already here. Not an
  -- argument, because that would change the signature every handler calls;
  -- explicit carriage arrives with the scoped client, and the two must agree.
  select r.code into found_code
    from ticket_receipts r
   where r.buyer_phone = phone
     and buyer_key(r.buyer_name) = buyer_key(name_given)
     and r.project_id = coalesce(current_project(), seed_project())
   limit 1;

  if found_code is null then
    insert into ticket_receipts (code, created_by, buyer_phone, buyer_name)
      values (p_code, coalesce(p_user, ''), phone, name_given);
    return query select p_code, true;
  else
    return query select found_code, false;
  end if;
end $$ language plpgsql;
