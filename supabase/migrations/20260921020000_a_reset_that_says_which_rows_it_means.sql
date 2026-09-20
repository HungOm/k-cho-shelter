-- Emptying a raffle stopped working: "DELETE requires a WHERE clause"
--
-- app_reset issued `delete from <table>` with nothing after it, which is
-- exactly what it means to do — it empties the tables it has already checked
-- against its own allowlist, inside one transaction, with the append-only
-- guards lifted and put back. An organiser pressing "Reset it" got
--
--     DELETE requires a WHERE clause
--
-- and nothing was deleted.
--
-- THE MECHANISM IS UNCONFIRMED, AND ON THE HOSTED PROJECT IT IS RULED OUT.
--
-- This header first blamed the `safeupdate` extension. That was inferred from
-- the message and is false. ticket-printing-qr-integration has network and
-- measured the hosted database:
--
--   pg_extension                     no safeupdate
--   plan_filter.statement_cost_limit 0 (off)
--   a security-definer plpgsql function, owned by postgres, doing
--     `execute format('delete from %I', t)` on a real table in public
--                                    -> DELETE succeeded, no error
--
-- That last probe was built to differ from a naive test on all three axes the
-- live function differs on — real relation rather than pg_temp, dynamic SQL in
-- plpgsql rather than a plain statement, and SECURITY DEFINER rather than SET
-- LOCAL ROLE. It still passed.
--
-- And two facts that close it: 20260921020000 IS NOT APPLIED to that project,
-- and the app_reset running there still issues the unqualified delete. So the
-- hosted deployment runs exactly the statement under suspicion against a
-- database that demonstrably permits it. Whatever failed, it did not fail
-- there for this reason.
--
-- WHAT IS ESTABLISHED: the error reached the screen through the APP, not the
-- Supabase SQL editor. resetApply passes the rpc's error verbatim into
-- RESET_FAILED, and the organiser saw it in this app's own toast beneath its
-- own confirmation box. The string appears in no source file of ours and in no
-- dependency — the whole tree including node_modules was searched — and there
-- is no unfiltered delete anywhere in src/. And the organiser has confirmed
-- they were on the HOSTED project, so the self-hosted-stack theory that stood
-- here briefly is closed as well.
--
-- SO THE CAUSE IS UNKNOWN AND THREE THEORIES HAVE DIED: safeupdate (not
-- installed), plan_filter (off), a self-hosted image (wrong deployment). The
-- remaining gap is that the probe which cleared the database was a REPLICA of
-- app_reset, not app_reset. It omitted `alter table ... disable trigger user`,
-- the loop over several tables, the `returns table` / `return next` shape, and
-- the audit_log insert. A copy that passes says nothing about an original that
-- does more. Calling the live function inside a rolled-back transaction is the
-- test nobody has run; whether the DEPLOYED edge function even matches this
-- repo is the other.
--
-- SO THIS MIGRATION IS NOT A FIX FOR AN OUTAGE ANYBODY HAS REPRODUCED. It is
-- harmless and portable: a statement that says which rows it means survives a
-- stack that refuses one that does not. Apply it on that basis, not as a cure.
--
-- WHY `ctid is not null` AND NOT `where true`. The extension looks for a
-- qualifier in the PLAN, and `where true` is constant-folded away before the
-- plan is built, so it reads identically to no clause at all and is refused
-- the same way. `ctid` is a system column every ordinary table has, it is
-- never null for a live row, and the comparison survives planning as a real
-- qual. So the statement still deletes every row and now says so in a form the
-- guard can see.
--
-- Deliberately NOT turning the extension off for this function. It could be
-- done with a `set safeupdate.enabled = off` attribute, and it would work, and
-- it would also mean this function is the one place in the schema where that
-- protection is silently absent — including for any statement added to it
-- later by somebody who does not know that. Satisfying the guard honestly is
-- cheaper to read and cannot decay.
--
-- Nothing else about the function changes: same allowlist, same ordering, same
-- trigger handling, same audit row written last.

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
    -- `where ctid is not null` IS THE POINT, not noise. See the header.
    execute format('delete from %I where ctid is not null', t);
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
