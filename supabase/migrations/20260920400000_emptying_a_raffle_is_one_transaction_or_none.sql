-- Emptying a raffle is one transaction or none of it.
--
-- TICKETS-PLAN.md phase 7. The System Admin is to be able to reset the raffle
-- from the app, feature by feature. This is the only thing in the system that
-- deletes rows wholesale, and it lives here rather than in a handler for three
-- reasons, each of which is already written down somewhere else in this repo.
--
--   1. THE HANDLERS ARE BARRED FROM THESE TABLES, and tests say so.
--      tests/custodyledger fails any file under functions/api that names
--      ticket_movements; tests/moneyjournal does the same for money_entries.
--      The reasoning is that a handler writing the ledger lets the projection
--      drift from it. A reset is not an exception to that — it is the case
--      that proves why the rule points at SQL.
--
--   2. THE TRIGGERS HAVE TO COME OFF, AND GO BACK ON.
--      payments, ticket_history, book_history, round_snapshots, money_entries,
--      ticket_movements and audit_log all refuse DELETE by trigger, on purpose:
--      they are the record that money cannot be quietly rewritten. A reset is
--      the one legitimate reason to lift that, and lifting it has to be inside
--      the same transaction as the deleting, so a failure anywhere puts them
--      back. A function in the database can promise that. Two round trips from
--      a browser cannot.
--
--   3. ONE IMPLEMENTATION, NOT TWO. supabase/reset.sql already empties a whole
--      raffle from a terminal. A second copy in TypeScript would drift from it,
--      and tests/resetcovers exists because the last time two lists of tables
--      disagreed, money_entries survived a reset in silence and the next
--      raffle started with the previous one's journal inside it. reset.sql is
--      rewritten in the same commit to call this.
--
-- WHAT IT WILL NOT DO, and these are refusals rather than omissions:
--
--   * It takes a LIST OF TABLES and checks every one against an allowlist built
--     into the function. A name that is not on the list raises. The list is not
--     a parameter and cannot be widened by a caller.
--
--   * app_users and permissions are not on it. They are how the person running
--     the reset gets back in, and a page that can delete its own way in is a
--     page that locks somebody out of their own raffle. reset.sql does them,
--     from a terminal, re-seeding the System Admin in the same transaction.
--
--   * audit_log is not on it either, and that one is subtle: a reset that wipes
--     the log of its own use leaves nothing behind to look at. The function
--     WRITES to audit_log instead, after the triggers are back on, so the
--     record of the reset is made by the thing being recorded.
--
-- WHY THE TRIGGER NAMES ARE NOT LISTED. They are read out of pg_trigger for
-- exactly the tables being emptied. A hand-kept list of triggers is the first
-- failure in tests/resetcovers: audit_log gained one, the list did not, and the
-- whole reset raised at the moment somebody was running it — after the backup,
-- with everybody told to stop touching the system.

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

-- The browser's roles must not reach it. The edge function calls it with the
-- service role, and the check that the caller is the System Admin happens in
-- gate.ts before it ever gets here.
revoke all on function app_reset(text[], text) from public, anon, authenticated;
