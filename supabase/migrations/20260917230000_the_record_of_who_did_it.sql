-- The log of who did what could be edited by whoever did it.
--
-- `audit_log` is where every override, every forced settlement, every
-- permission change and every write-off is recorded, and it was the one record
-- in this system with no protection at all. book_history, ticket_history,
-- payments and round_snapshots each have three triggers refusing update, delete
-- and truncate — added one at a time as each was found. This table was never
-- one of them, and it is the table an administrator would reach for if they
-- wanted a thing they did to stop having happened.
--
-- Nothing suggests anybody has. The service role is the only writer and the
-- only reader, and read_audit is admin-only. But "nobody has" is not a control,
-- and the argument for the other four applies here word for word: a record that
-- can be quietly changed is not evidence, and an auditor cannot tell a log that
-- was never altered from one that was.
--
-- WHY NOT A CHECKSUM CHAIN. Hashing each row over its predecessor would also
-- detect an edit made directly in psql by somebody with the database password,
-- which a trigger cannot — a superuser can disable triggers. That is a real
-- threat here: the password exists and one person holds it. It is also a
-- different project: a chain needs verification, somewhere to publish the head,
-- and a story for what to do when it breaks. The trigger stops the application
-- and the service role, which is every path the software offers. The rest is
-- named in ARCHITECTURE-REVIEW.md rather than half-built here.
--
-- DATA LOSS RISK: NO. Three triggers are added to one table. No row is touched.

create or replace function audit_log_append_only() returns trigger as $$
begin
  raise exception 'audit_log is append only — % is not allowed on it', tg_op
    using hint = 'A correction is another row saying what was corrected, not an edit to this one.';
end $$ language plpgsql;

drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_append_only();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate before truncate on audit_log
  execute function audit_log_append_only();
