/*
 * MULTI-TENANCY STAGE 2 (MT-2d): move_tickets, the custody ledger.
 *
 * THE REPLAY CHECK IS THE ONE THAT CHANGES AN ANSWER. Every other predicate in
 * this pass guards a write; this one decides what the caller is told.
 * move_tickets treats a repeated client_key as a replay and returns the first
 * attempt's batch without moving anything. Stage 1 made that index
 * `(project_id, client_key)`, so the same key can now legitimately exist in two
 * raffles — which is the point, because a client key comes from a browser and
 * two organisations' browsers know nothing of each other.
 *
 * Unscoped, the SECOND raffle's first attempt is answered as a replay of the
 * FIRST raffle's batch: it moves nothing, reports somebody else's batch id and
 * their row count, and says `replayed: true`. The tickets never move and the
 * screen shows a success. Demonstrated by removing the predicate again —
 * `{"batch": "6ea14162-…", "moved": 0, "replayed": true}` returned to a raffle
 * that had never seen that batch.
 *
 * The rest is the usual: the lock, the "every ticket is where you say it is"
 * check, the movement rows and the holder projection were all matched by
 * ticket idx alone, which is the global primary key until Stage 4.
 *
 * A genuine replay within one raffle is still a replay — asserted, so that the
 * predicate cannot be read as having switched the feature off.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/functions.sql.
 */

create or replace function move_tickets(
  p_ticket_idxs integer[],
  p_from_holder text,
  p_to_holder   text,
  p_kind        text,
  p_user        text,
  p_project     uuid,
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
  --
  -- WITHIN THIS RAFFLE, and this is the one predicate here that changes an
  -- answer rather than guarding a write. Stage 1 made the client_key index
  -- `(project_id, client_key)`, so the same key CAN now exist in two raffles —
  -- which is the point, since a client key comes from a browser and two
  -- organisations' browsers know nothing of each other. Unscoped, the second
  -- raffle's first attempt would be answered as a replay of the first
  -- raffle's batch: it would move nothing, report somebody else's batch id and
  -- their row count, and say `replayed: true`.
  if p_client_key is not null and p_client_key <> '' then
    select batch_id into existing from ticket_movements
     where client_key = p_client_key and project_id = p_project limit 1;
    if existing is not null then
      return jsonb_build_object(
        'batch', existing,
        'moved', (select count(*) from ticket_movements
                   where batch_id = existing and project_id = p_project),
        'replayed', true);
    end if;
  end if;

  -- In ticket order, so overlapping batches queue rather than deadlock.
  perform 1 from tickets
   where idx = any(p_ticket_idxs) and project_id = p_project order by idx for update;

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
     and t.project_id = p_project
     and t.holder is distinct from p_from_holder;

  if wrong > 0 then
    raise exception 'NOT_THERE: % of % tickets are not with % — %',
      wrong, array_length(p_ticket_idxs, 1), p_from_holder,
      left(offenders, 200)
      using errcode = 'check_violation';
  end if;

  insert into ticket_movements
    (ticket_idx, from_holder, to_holder, kind, batch_id, by_user, reason, client_key, project_id)
  select t.idx, p_from_holder, p_to_holder, p_kind, batch, p_user, coalesce(p_reason, ''),
         -- One key per batch, on its first row: the index is unique, so hanging
         -- it on every row would refuse the batch's own second ticket.
         case when t.idx = (select min(x) from unnest(p_ticket_idxs) x)
              then nullif(p_client_key, '') end,
         p_project
    from tickets t
   where t.idx = any(p_ticket_idxs) and t.project_id = p_project
   order by t.idx;
  get diagnostics moved = row_count;

  -- The projection, in the same statement's transaction. A screen reads this
  -- column; the ledger above is what it must always be derivable from.
  update tickets set holder = p_to_holder
   where idx = any(p_ticket_idxs) and project_id = p_project;

  return jsonb_build_object('batch', batch, 'moved', moved, 'replayed', false);
end $$ language plpgsql;

create or replace function move_tickets(
  p_ticket_idxs integer[],
  p_from_holder text,
  p_to_holder   text,
  p_kind        text,
  p_user        text,
  p_reason      text default '',
  p_client_key  text default null
) returns jsonb as $$
  select move_tickets(p_ticket_idxs, p_from_holder, p_to_holder, p_kind, p_user,
                      coalesce(current_project(), seed_project()), p_reason, p_client_key)
$$ language sql;

revoke execute on function move_tickets(integer[], text, text, text, text, uuid, text, text) from public, anon, authenticated;
