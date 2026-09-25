/*
 * MULTI-TENANCY STAGE 2 (MT-2d, second of the twelve): ensure_holding_tx.
 *
 * D-021's shape again, and the reason it is needed here is a correction to
 * this function's OWN earlier comment. That comment said explicit carriage
 * would arrive "with the scoped client" — which is now true in a way that
 * makes the four-argument form insufficient rather than merely optional: the
 * scoped client (tenancy-stage-2 branch) REPLACES ctx.supabaseAdmin for every
 * handler, so printing.ts:680's rpc call arrives with p_project ADDED, not
 * with the same four names. A five-argument sibling is required, not a
 * convenience.
 *
 * THE INSERT IS STAMPED EXPLICITLY WITH p_project, not left to the column
 * default. Proved by removing the stamp: a new holding created through the
 * five-argument form landed in the seed project regardless of which project
 * was asked for, because the session driving the test carries no header for
 * the column default to read. The read predicate (`r.project_id = p_project`)
 * is proved the same way, by removing it and watching the wrong raffle's code
 * come back.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 *
 * app_reset IS DELIBERATELY NOT IN THIS COMMIT. It needs the same treatment —
 * reset.ts's rpc call will arrive with p_project once the wrapper lands — but
 * it is the subject of an open, unresolved production incident and has been
 * rewritten three times already. Recorded as D-034 rather than rushed.
 */

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

create or replace function ensure_holding_tx(
  p_phone text,
  p_name  text,
  p_code  text,
  p_user  text
) returns table (holding_code text, was_created boolean) as $$
  select * from ensure_holding_tx(
    p_phone, p_name, p_code, p_user, coalesce(current_project(), seed_project()))
$$ language sql;
