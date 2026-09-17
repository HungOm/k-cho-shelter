-- payments, carried into the money journal. NOT RUN BY ANYTHING.
--
-- ARCHITECTURE-REVIEW.md §22 step 2, the money half: "each `payments` row → one
-- `money_entries` row (1:1 mapping of `source` to `kind`, `reverses` preserved,
-- ids preserved as `legacy_id`)."
--
-- Like supabase/backfill-custody.sql this is deliberately NOT a migration and is
-- referenced by nothing — not SETUP.md, not the reset runbook, not
-- test-functions.sh. `supabase db push` reads supabase/migrations/ and will never
-- see it. It is run once, by a person, against a database that has just been
-- backed up, and read in full first.
--
-- THE MAPPING, which is 1:1 in row count and not in meaning:
--
--   source='hand'        -> kind 'receipt', reference book when book_idx is set
--   source='settlement'  -> kind 'receipt', reference book (always set)
--   source='writeoff'    -> kind 'write_off'
--   any row with reverses set -> kind 'reversal', whatever its source
--
-- THE LAST LINE IS THE ONE TO ARGUE WITH, so it is written down rather than
-- buried. money_entries has `check ((kind = 'reversal') = (reverses is not
-- null))`: a row that undoes another IS a reversal, and its source tells you
-- what KIND of thing it undid, not what it is. payments conflates the two
-- because it has one column for both; the row it points at still carries the
-- original source, so nothing is lost and the join says it.
--
-- WHY A ROW-AT-A-TIME LOOP AND NOT ONE INSERT. `reverses` has to point at the
-- money_entries id of the row backfilled from payments.reverses, and the table
-- is append only — there is no second pass that fills it in afterwards, because
-- UPDATE is refused by a trigger and rightly so. A set insert cannot see its own
-- rows, and two passes break on a reversal of a reversal. Ordering by
-- payments.id and inserting one at a time resolves any chain, because a row can
-- only ever reverse an earlier one. payments is in the hundreds; this is a
-- one-off script and clarity is worth more than the round trips.
--
-- WHAT IT DOES NOT PRODUCE: any entry with party = 'desk'. payments.agent_id is
-- `not null references agents`, so cash taken across the office desk was never
-- recordable there — it is reconstructed by desk_money() from tickets and books
-- instead. The journal can hold it and the history cannot, so the backfill
-- cannot invent it. That gap is expected, it is the reason money_entries.party
-- is plain text, and it is what dual-write starts closing.
--
-- BEFORE RUNNING IT
--   1. ./supabase/backup.sh, and OPEN payments.csv. A backup nobody has looked
--      at is a belief, not a backup.
--   2. Read the two totals it prints. They must be equal, and it rolls itself
--      back if they are not.
--   3. Re-running after a failure is safe: money_entries_legacy_idx is unique,
--      so a second run over rows already carried across is refused by the
--      database rather than doubling anybody's balance.

begin;

-- ============ THE CURRENCY THIS RAFFLE COUNTS IN (begin) ============
-- Read once and stored on every row, not looked up at display time: an entry
-- from a raffle that ran in a different currency must not silently become RM
-- because somebody changed a setting afterwards.
do $$
declare cur text;
begin
  select coalesce(nullif(value, ''), 'RM') into cur from config where key = 'CURRENCY';
  if cur is null then
    raise exception 'config has no CURRENCY row — apply schema.sql before backfilling money';
  end if;
  perform set_config('backfill.currency', cur, true);
end $$;
-- ============ THE CURRENCY (end) ============


-- ============ ONE ENTRY PER PAYMENT, IN ORDER (begin) ============
do $$
declare
  p       record;
  target  bigint;
  cur     text := current_setting('backfill.currency', true);
  made    integer := 0;
begin
  for p in select * from payments order by id loop

    -- Already carried across by an earlier, interrupted run. The unique index
    -- would refuse it anyway; skipping says so without an error.
    if exists (select 1 from money_entries where legacy_id = p.id) then
      continue;
    end if;

    target := null;
    if p.reverses is not null then
      select id into target from money_entries where legacy_id = p.reverses;
      if target is null then
        -- Cannot happen with `order by id`, because a row may only reverse an
        -- earlier one — so if it does happen, the assumption is wrong and this
        -- should stop rather than write an orphan.
        raise exception 'payments row % reverses % which is not in the journal yet — the ordering assumption is broken',
          p.id, p.reverses;
      end if;
    end if;

    insert into money_entries
      (at, party, kind, amount, currency, method,
       reference_kind, reference_id, by_user, reason, reverses, client_key,
       backfilled, legacy_id)
    values (
      p.received_at,
      p.agent_id,
      case
        when p.reverses is not null then 'reversal'
        when p.source = 'writeoff'  then 'write_off'
        else 'receipt'
      end,
      p.amount,
      cur,
      p.method,
      case when p.book_idx is not null then 'book' end,
      p.book_idx,
      coalesce(nullif(p.received_by, ''), 'backfill'),
      'payments:' || p.id || ' (' || p.source || ')' ||
        case when p.note <> '' then ' — ' || p.note else '' end,
      target,
      -- client_key is NOT carried across. It exists to make one request
      -- idempotent, and these requests finished months ago; carrying the values
      -- would let a retry of an old request collide with a new entry.
      null,
      true,
      p.id
    );
    made := made + 1;
  end loop;

  raise notice 'money backfill: % entries written', made;
end $$;
-- ============ ONE ENTRY PER PAYMENT (end) ============


-- ============ THE CHECK THAT IS ALLOWED TO STOP THIS (begin) ============
/*
 * The journal must say exactly what payments says, per party and per kind of
 * thing. Not one total — three, because a single sum would let a write-off
 * mis-mapped as a receipt cancel out against a receipt mis-mapped as a
 * write-off and still balance. That is the failure this repository has already
 * had once, in a reconciliation that compared against raw ticket sums and
 * closed at zero while two figures were wrong in opposite directions.
 */
do $$
declare
  bad integer;
  detail text;
begin
  select count(*), string_agg(x.party || ' ' || x.what || ': payments ' || x.was ||
                              ', journal ' || x.now, '; ' order by x.party)
    into bad, detail
  from (
    select coalesce(a.agent_id, b.party) as party,
           coalesce(a.what, b.what)      as what,
           coalesce(a.total, 0)          as was,
           coalesce(b.total, 0)          as now
    from (
      select agent_id,
             case when source = 'writeoff' then 'written off' else 'cash' end as what,
             sum(amount) as total
      from payments group by 1, 2
    ) a
    full outer join (
      select party,
             case when kind = 'write_off' then 'written off' else 'cash' end as what,
             sum(amount) as total
      from money_entries where backfilled group by 1, 2
    ) b on b.party = a.agent_id and b.what = a.what
    where coalesce(a.total, 0) is distinct from coalesce(b.total, 0)
  ) x;

  if bad > 0 then
    raise exception E'the journal does not agree with payments for % party/kind pair(s)\n%\n\nNOTHING HAS BEEN WRITTEN — this transaction is rolled back.',
      bad, coalesce(detail, '')
      using hint = 'Compare per party and per kind, not in total: two errors in opposite directions sum to zero and that is how a wrong reconciliation looks right.';
  end if;

  raise notice 'money backfill: % entries, agreeing with payments for every party and kind',
    (select count(*) from money_entries where backfilled);
end $$;
-- ============ THE CHECK (end) ============

commit;
