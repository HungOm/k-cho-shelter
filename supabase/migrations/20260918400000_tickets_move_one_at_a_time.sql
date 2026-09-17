-- Moving tickets, as rows rather than as a column overwrite.
--
-- This is the function the custody ledger was built for. 20260918100000 created
-- ticket_movements and tickets.holder and deliberately left them inert; this
-- gives them a way to be written that cannot write one without the other.
--
-- WHAT IT REPLACES, eventually: `update books set held_by_agent = …`. That
-- statement is the whole of custody today. It answers "where is this book now"
-- and destroys "where has it been", and it cannot answer "where is this TICKET"
-- at all — which is why a part-sold book cannot be split between two sellers in
-- this system. Nothing is replaced in this migration. The function exists, and
-- the four book operations start writing through it in a later commit.
--
-- THE PROJECTION IS MAINTAINED HERE OR IT IS NOT MAINTAINED. tickets.holder is
-- a cache of "the to_holder of this ticket's latest live movement". If a caller
-- can write a movement without updating the column, the two disagree and the
-- column is the one every screen reads. So both happen in one statement, under
-- one lock, or neither does.
--
-- LOCKED IN TICKET ORDER, for the reason the sale paths were: two batches
-- holding overlapping tickets in opposite orders deadlock, and the order a
-- caller hands them in is arbitrary.
--
-- IDEMPOTENT BY BATCH. A whole book moving is N rows sharing a batch_id, and
-- the thing a volunteer does on a bad connection is press the button twice. The
-- client key is per BATCH, not per ticket: the unique index is on client_key, so
-- the first ticket of a replayed batch raises, and rather than let that surface
-- as a duplicate-key error the function detects it and returns the batch that
-- already exists. Pressing twice does what pressing once did.
--
-- DATA LOSS RISK: NO. One function is added. Nothing calls it yet.

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
