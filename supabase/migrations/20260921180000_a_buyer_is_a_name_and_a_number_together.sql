/*
 * A BUYER IS A NAME AND A NUMBER TOGETHER.
 *
 * The migrations before this keyed a digital ticket on the telephone number
 * alone, on the strength of the rule this app has held since ranks.ts: two
 * buyers called "Ma Hla" are two people, so never identify anybody by name.
 * That rule is about name ALONE and it is still right. Read as "therefore use
 * the number alone" it produces the opposite mistake, and a common one here:
 * a household, a shop or a stall shares one telephone number, and everyone who
 * bought through it gets ONE digital ticket listing each other's tickets.
 *
 * That is a disclosure, not an inconvenience. Somebody scanning their own card
 * would be shown what their mother, their neighbour or the person behind the
 * counter had bought.
 *
 * So the key is both. Neither half identifies a buyer on its own; together
 * they are as close as a hand-written raffle gets.
 *
 * AND THE NAME IS COMPARED, NOT MATCHED. This is the part that decides whether
 * the change helps or hurts. Names here are written on a phone, at a table, by
 * different sellers, in two scripts — "Ko Zaw", "ko  zaw", "Ko Zaw " are one
 * person every time, and keying on the literal text would split them into
 * three holdings and three QR codes, which is precisely the failure the whole
 * model exists to remove. `buyer_key` folds case, collapses runs of
 * whitespace and trims, so the ordinary variations land together.
 *
 * WHAT IT STILL CANNOT DO, said plainly because somebody will meet it: a name
 * genuinely spelled differently on two tickets — "Ko Zaw" and "Ko Zaw Oo" — is
 * two buyers to this, and they will get two digital tickets. The fix is to
 * correct the ticket, which is the right place for it, rather than to make the
 * comparison loose enough to merge two people who really are different.
 */

/*
 * IMMUTABLE, because it is indexed. A function in an index expression has to
 * promise the same answer for the same input forever — Postgres will not build
 * the index otherwise, and an index built on a lie is a unique constraint that
 * stops catching duplicates.
 */
create or replace function buyer_key(p_name text) returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')))
$$;

alter table ticket_receipts
  add column if not exists buyer_name text not null default '';

/*
 * ONE HOLDING PER BUYER, and a buyer is now two columns. The old index keyed
 * the number alone; dropped rather than left beside this one, because two
 * unique constraints on overlapping columns is a row that can be refused for a
 * reason nobody reading the newer one would expect.
 */
drop index if exists ticket_receipts_one_per_buyer;

create unique index if not exists ticket_receipts_one_per_buyer
  on ticket_receipts (buyer_phone, buyer_key(buyer_name))
  where buyer_phone <> '';

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
          on t.buyer_phone = r.buyer_phone
         and buyer_key(t.buyer_name) = buyer_key(r.buyer_name)
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
 * The token, against both halves. The old three-argument form is dropped
 * rather than overloaded: two functions of the same name differing by one
 * argument is a call that resolves to whichever Postgres prefers, and the one
 * it prefers would be the one that keys on the number alone.
 */
drop function if exists ensure_holding_tx(text, text, text);

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

  select r.code into found_code
    from ticket_receipts r
   where r.buyer_phone = phone
     and buyer_key(r.buyer_name) = buyer_key(name_given)
   limit 1;

  if found_code is null then
    insert into ticket_receipts (code, created_by, buyer_phone, buyer_name)
      values (p_code, coalesce(p_user, ''), phone, name_given);
    return query select p_code, true;
  else
    return query select found_code, false;
  end if;
end $$ language plpgsql;
