-- A ticket's record cannot be edited or erased — phase 2 of the audit of
-- 2026-09-15 (supabase/AUDIT.md), and the second half of the same requirement:
-- the trail is append only, and readable by whoever may read the ticket.
--
-- Idempotent; run it twice and nothing changes. DATA LOSS RISK: NO. No column
-- is dropped, no row deleted, nothing existing is rewritten. What changes is
-- that from here on nothing CAN be: an update, a delete or a truncate of
-- ticket_history raises, whoever is asking and whichever key they hold.
--
-- The visibility half needs no SQL. It is decided in the Edge Function, which
-- reads this table with the secret key and now applies seesBuyer() from
-- gate.ts — the same rule tickets_readable applies to the live ticket — instead
-- of showing the buyer to organisers only.
--
-- GENERATED from the canonical file, so the migration and the file cannot
-- drift: the append-only half of the TICKET HISTORY block of schema.sql.

-- ---------- from schema.sql ----------
-- APPEND ONLY, AND ENFORCED RATHER THAN INTENDED.
--
-- "Append only" was true of this table the way most things are true of a table
-- nobody has written the code to change yet: no handler updates it, no handler
-- deletes from it, and that held until somebody wrote the one that did. The
-- trail is the only place an overwritten buyer, seller or amount still exists.
-- Everything else about it is defended by the database — the trigger that fills
-- it so no code path can forget, the FK that refuses to let a ticket be deleted
-- out from under its own record — and its immutability was defended by nothing
-- but the absence of a line of code.
--
-- So the same bar as the rest: a rule that does not care who is asking. The
-- Edge Function holds the secret key and bypasses row security, which makes
-- every grant and policy on this table irrelevant to the one caller that can
-- actually reach it. A trigger is not irrelevant to it.
--
-- A CORRECTION IS NOT AN EDIT. Getting a name wrong in the trail is fixed by
-- correcting the ticket, which appends the correction — the wrong name stays
-- visible with the right one after it, which is the whole point of keeping a
-- record rather than a current value.
create or replace function ticket_history_append_only() returns trigger as $$
begin
  raise exception 'ticket_history is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Correct the ticket instead: the correction is appended to its record, and what was there before stays readable.';
end $$ language plpgsql;

drop trigger if exists ticket_history_no_change on ticket_history;
create trigger ticket_history_no_change before update or delete on ticket_history
  for each row execute function ticket_history_append_only();

-- Truncate is not an update or a delete and would empty the table without
-- firing either. Statement-level, because that is the only level it has.
drop trigger if exists ticket_history_no_truncate on ticket_history;
create trigger ticket_history_no_truncate before truncate on ticket_history
  for each statement execute function ticket_history_append_only();
