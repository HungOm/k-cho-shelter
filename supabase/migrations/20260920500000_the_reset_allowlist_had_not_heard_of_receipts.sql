-- The reset's allowlist had never heard of receipts, so the commonest reset refused.
--
-- 20260920400000 gave app_reset an allowlist built into the function, which is
-- the right shape: a caller cannot widen it, and a table nobody put on it is a
-- table the app can never empty. What it cannot do is notice a table that
-- arrives afterwards — and `ticket_receipts` and `ticket_receipt_items` did,
-- carrying the code a buyer gets when they take several tickets at once.
--
-- WHAT IT LOOKED LIKE. resetplan.ts files both tables under `tickets`, so
-- ticking "Tickets, books and codes" — the likeliest thing anybody ticks — sent
-- them to app_reset, which refused with `app_reset refuses to empty
-- ticket_receipt_items`. The reset then failed AFTER the System Admin had read
-- the counts and typed the sentence back, which is the worst moment in the
-- whole flow to discover that the feature does not work.
--
-- IT FAILED SAFELY, and that is the one good thing here. The allowlist is
-- checked over the WHOLE list before anything is touched, precisely so that a
-- part-acceptable list cannot empty the acceptable part and then raise. Nothing
-- was ever half destroyed; the reset simply did not happen.
--
-- WHY A SECOND MIGRATION RATHER THAN AN EDIT. 20260920400000 has not been
-- pushed to the hosted project — the deploy is held, and this environment has
-- no database password to check with. "Probably not applied" is not a good
-- enough reason to edit a migration in place, because the cost of being wrong
-- is a fix that never reaches production and a local history that no longer
-- describes it. `create or replace` is correct whichever is true, and it is
-- cheap. supabase/DEPLOY-PENDING.md has the standing rule; this is it applied.
--
-- AND THE CLASS, NOT THE INSTANCE. tests/resetcovers has asked since it was
-- written whether every table created is cleared by supabase/reset.sql. It
-- never asked the same question of this allowlist, which is the second route to
-- the same job and the one the app actually uses. It does now, reading the
-- effective definition out of the migrations and the table list out of
-- resetplan.ts, so the next table to arrive is caught by a test rather than by
-- somebody mid-reset.

create or replace function app_reset(p_tables text[], p_by text)
returns table (tbl text, removed bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Everything the app may ever empty. Ordered for readability only; the
  -- caller supplies the order rows come out in, and a wrong one is refused by
  -- a foreign key and rolls the whole thing back rather than half-emptying.
  allowed constant text[] := array[
    'ticket_templates',
    'tickets', 'books', 'ticket_codes', 'ticket_history', 'ticket_movements', 'book_history',
    -- A receipt is one code standing for a set of tickets, so it is worth
    -- exactly what the tickets it names are worth. It goes when they go, and a
    -- receipt still answering "genuine" for a ticket that no longer exists
    -- would be worse than one that went with them.
    'ticket_receipts', 'ticket_receipt_items',
    'agents',
    'payments', 'money_entries',
    'prize_types', 'prizes', 'winners',
    'check_in_dates', 'check_in_reports',
    'pending_approvals',
    'round_snapshots',
    'config'
  ];
  t     text;
  n     bigint;
  total bigint := 0;
begin
  if p_tables is null or array_length(p_tables, 1) is null then
    raise exception 'app_reset was given nothing to empty' using errcode = '22023';
  end if;

  -- Checked BEFORE anything is touched. A list that is half acceptable must not
  -- empty the acceptable half and then raise.
  foreach t in array p_tables loop
    if not (t = any(allowed)) then
      raise exception 'app_reset refuses to empty %', t using errcode = '42501';
    end if;
  end loop;

  -- Off for the tables in hand, and only those. Read from the catalogue rather
  -- than named, so a table that gains a guard tomorrow is covered tonight.
  foreach t in array p_tables loop
    if exists (
      select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      where c.relname = t and not g.tgisinternal
    ) then
      execute format('alter table %I disable trigger user', t);
    end if;
  end loop;

  foreach t in array p_tables loop
    execute format('delete from %I', t);
    get diagnostics n = row_count;
    total := total + n;
    tbl := t;
    removed := n;
    return next;
  end loop;

  foreach t in array p_tables loop
    if exists (
      select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      where c.relname = t and not g.tgisinternal
    ) then
      execute format('alter table %I enable trigger user', t);
    end if;
  end loop;

  -- LAST, and with the guard back on, so the row that says a reset happened is
  -- written by the same rules as every other audit row.
  insert into audit_log (action, details, email)
  values (
    'RAFFLE_RESET',
    jsonb_build_object('tables', to_jsonb(p_tables), 'removed', total),
    coalesce(nullif(p_by, ''), 'unknown')
  );
end
$$;

comment on function app_reset(text[], text) is
  'Empties the named tables in one transaction, lifting their append-only guards '
  'and restoring them before it commits. Refuses any table not on its own '
  'allowlist; never touches app_users, permissions or audit_log, and writes its '
  'own audit row last. See TICKETS-PLAN.md phase 7.';

revoke all on function app_reset(text[], text) from public, anon, authenticated;
