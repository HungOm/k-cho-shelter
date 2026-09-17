-- ===========================================================================
-- FULL PRODUCTION RESET. This destroys every record of the current raffle.
--
-- It empties every table, re-seeds the settings from the canonical defaults in
-- schema.sql, and generates a fresh set of tickets and books with no history
-- of any kind. Afterwards the only account is the super admin.
--
-- THERE IS NO UNDO. The backup taken in step 1 of the runbook is the only way
-- back, and it restores ROWS, not objects -- so it is only a way back if the
-- schema is left alone, which this script does.
--
-- It refuses to run unless :confirm is passed, exactly:
--   psql "$SUPABASE_DB_URL" -v confirm=RESET-THE-RAFFLE -v super=<email> -f reset.sql
--
-- WHY THE TRIGGERS COME OFF. payments, ticket_history and round_snapshots
-- refuse DELETE and TRUNCATE by trigger, on purpose -- they are the record that
-- money cannot be quietly rewritten. A reset is the one legitimate reason to
-- take them off, and it is done here in the open, inside the transaction, and
-- put back before it commits. If this script fails anywhere, the rollback
-- restores them with everything else.
-- ===========================================================================
\set ON_ERROR_STOP on

\if :{?confirm}
\else
  \echo 'REFUSED: pass -v confirm=RESET-THE-RAFFLE'
  \quit
\endif
\if :{?super}
\else
  \echo 'REFUSED: pass -v super=<the SUPER_ADMIN_EMAIL address>'
  \quit
\endif

-- Checked HERE, before `begin`, and not inside a do-block: psql does not
-- substitute :variables inside dollar quoting, so a guard written there is not
-- a guard at all -- it is a syntax error at best and silently absent at worst.
select :'confirm' = 'RESET-THE-RAFFLE'  as ok_token,
       position('@' in :'super') > 0    as ok_super \gset

\if :ok_token
\else
  \echo 'REFUSED: confirm must be exactly RESET-THE-RAFFLE'
  \quit
\endif
\if :ok_super
\else
  \echo 'REFUSED: super must be an email address'
  \quit
\endif

begin;

-- What is about to be destroyed, printed so it is in the terminal scrollback
-- next to the decision rather than only in a backup file.
select 'DESTROYING: '
  || (select count(*) from tickets)        || ' tickets, '
  || (select count(*) from books)          || ' books, '
  || (select count(*) from ticket_history) || ' ticket history rows, '
  || (select count(*) from book_history)   || ' book history rows, '
  || (select count(*) from payments)       || ' payments, '
  -- Empty today and not for much longer. Somebody confirming a reset should be
  -- told what the money journal holds, not only what payments holds.
  || (select count(*) from money_entries)   || ' journal entries, '
  || (select count(*) from ticket_movements)|| ' custody movements, '
  || (select count(*) from agents)         || ' sellers, '
  || (select count(*) from winners)        || ' winners' as about_to_go;

-- ---- 1. THE GUARDS COME OFF, IN THE OPEN ---------------------------------
-- audit_log joined this list on 17 September, when it was given the same
-- append-only triggers the other four already had. It is deleted below like
-- everything else, and a BEFORE DELETE trigger refuses that outright — so
-- without this line the whole reset raises and rolls back at the audit_log
-- delete, having destroyed nothing but having got nowhere either.
alter table audit_log       disable trigger user;
-- THE TWO LEDGERS ADDED ON 18 SEPTEMBER, here for two different reasons.
-- ticket_movements references tickets(idx) with no on-delete clause, so once it
-- holds a row `delete from tickets` below is REFUSED and the reset stops —
-- verified: "Key (idx)=(1) is still referenced from table ticket_movements".
-- money_entries has no foreign key and would simply survive, carrying the last
-- raffle's money into the new one, which is worse: nothing fails and the
-- figures are just wrong.
--
-- Both are empty today because nothing writes either of them yet. That is
-- exactly why the line is easy to forget, and why it is written now rather than
-- the morning after the backfill runs.
alter table ticket_movements disable trigger user;
alter table money_entries    disable trigger user;
alter table payments        disable trigger user;
alter table ticket_history  disable trigger user;
alter table book_history    disable trigger user;
alter table round_snapshots disable trigger user;
alter table tickets         disable trigger user;
alter table books           disable trigger user;

-- ---- 2. EVERYTHING GOES ---------------------------------------------------
-- Ordered so foreign keys never have to be deferred: children first.
delete from winners;
delete from prizes;
delete from prize_types;
delete from payments;
delete from money_entries;
delete from ticket_history;
delete from book_history;
-- Before tickets, which it references.
delete from ticket_movements;
delete from round_snapshots;
delete from check_in_reports;
delete from check_in_dates;
delete from pending_approvals;
delete from audit_log;
delete from tickets;
delete from books;
delete from agents;
delete from permissions;
delete from config;

-- Every account except the one that can still get in. The super admin is an
-- Edge Function environment variable (gate.ts), so that address would be an
-- admin even with this table empty -- the row is kept so the People screen has
-- somebody to show rather than looking broken on the first sign-in.
delete from app_users where lower(email) <> lower(:'super');

-- PROMOTED, NOT JUST KEPT. The surviving row is whatever it already was, and on
-- this raffle that address is a 'recorder' -- it has been running the place on
-- the strength of the environment variable alone, which outranks the row. Leave
-- it and the reset produces a raffle whose only account cannot manage people or
-- settings the moment SUPER_ADMIN_EMAIL is ever changed or cleared. The row is
-- made to say what is actually true.
update app_users
   set role = 'superadmin', status = 'active'
 where lower(email) = lower(:'super');

insert into app_users (email, name, role, status)
  select lower(:'super'), 'System Admin', 'superadmin', 'active'
   where not exists (select 1 from app_users where lower(email) = lower(:'super'));

-- Counters start at one, so the first payment of the new raffle is payment 1
-- rather than 15. Cosmetic, but a fresh start that numbers from the old
-- raffle's high-water mark is not a fresh start to anybody reading it.
--
-- Asking the catalogue which columns have a counter beats listing them: the
-- hand-written list was wrong twice while writing this -- book_history.id is a
-- bigserial where payments.id is `generated always as identity`, and the two
-- take different statements, and round_snapshots has no id at all. A list
-- maintained by hand is a list that is wrong again the next time a table is
-- added. pg_get_serial_sequence answers for both kinds.
do $$
declare s text;
begin
  for s in
    select pg_get_serial_sequence(quote_ident(c.table_name), c.column_name)
      from information_schema.columns c
     where c.table_schema = 'public'
       and pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) is not null
  loop
    execute format('alter sequence %s restart with 1', s);
  end loop;
end $$;

-- ---- 3. SETTINGS BACK TO FACTORY -----------------------------------------
-- Verbatim from the canonical block in schema.sql, notes included: they are the
-- only documentation of what each key means, and the organiser reading this
-- table in the dashboard is who they were written for.
insert into config (key, value, notes) values
  ('TICKET_PREFIX', 'KS-', 'Text before the number. May be empty. LOCKED once tickets exist.'),
  ('TICKET_START', '1', 'First ticket number. LOCKED once tickets exist.'),
  ('TICKET_DIGITS', '5', 'Zero padding, e.g. 5 gives KS-00001. LOCKED once tickets exist.'),
  ('TOTAL_TICKETS', '0', 'How many ticket rows EXIST. Raised only by the System Admin, and only upwards.'),
  ('TICKETS_PER_BOOK', '10', 'Tickets in one physical book. LOCKED once tickets exist.'),
  -- THREE, WHICH IS WHAT THE RAFFLE ALREADY USES AND WHAT THE PRINTED BOOKS
  -- SAY. An earlier version of this file set four and explained at length that
  -- three "cannot count to a thousand". That was a fact about SQL's lpad, which
  -- this script was wrongly using, and not about the raffle: padStart pads to a
  -- minimum and truncates nothing, so production runs two thousand books on
  -- three digits -- Book-001 to Book-999, then Book-1000 to Book-2000. Keeping
  -- three means every physical label in a volunteer's hands still matches.
  ('BOOK_PREFIX', 'Book-', 'Text before the book number. LOCKED once tickets exist.'),
  ('BOOK_DIGITS', '3', 'Zero padding, e.g. 3 gives Book-001. LOCKED once tickets exist.'),
  ('TICKET_PRICE', '10', 'Price of one ticket. Can be changed later.'),
  ('CURRENCY', 'RM', 'Shown on reports and receipts.'),
  ('CHECK_IN_DATE', '', 'The one date every seller reports by this round. The SAME date for everybody.'),
  ('FINAL_DEADLINE', '', 'The last day books and money can come back. Only the System Admin can change it.'),
  ('CHECK_IN_EVERY_MONTHS', '1', 'How far apart the reporting rounds are, in months.'),
  ('CHECK_IN_EVERY', '', 'The same rhythm in whatever unit this raffle keeps: 1m, 2w, 10d. Blank falls back to months.'),
  ('SALES_CLOSE_DATE', '', 'The last day a ticket may be sold. Blank means no cutoff.'),
  ('REPORT_GRACE_DAYS', '3', 'Days after the check-in date before a seller who has not reported is shown as late.'),
  ('CHECK_IN_ROUND', '1', 'Which reporting round is live. Do NOT edit by hand.'),
  ('DEFAULT_DUE_DAYS', '30', 'Fallback return period.'),
  ('EVENT_NAME', 'Fundraising Raffle', 'The name of THIS raffle, shown on receipts. Change it.'),
  ('ORG_NAME', '', 'Who is running the raffle. Shown on receipts. Set this before selling.'),
  ('ORG_LOGO', '', 'URL of your logo. Blank shows no logo.'),
  ('ORG_LOGO_SMALL', '', 'Optional smaller version of the same logo.'),
  -- MIRRORING PRODUCTION, where these three are not the same number and the
  -- difference is the point: 20000 ticket ROWS exist, 10000 of them are in play,
  -- and the ceiling is how far this raffle is ever planned to grow. Generating
  -- 10000 rows because 10000 are active would quietly halve the raffle.
  ('ACTIVE_TICKETS', '10000', 'How many of the existing tickets are in play. Raised as the raffle sells.'),
  ('TICKET_CEILING', '20000', 'How far this raffle is planned to grow. expand_tickets refuses to pass it.');

-- PADSTART, NOT LPAD. The one function every number in this raffle goes
-- through, and the difference is not cosmetic: lpad TRUNCATES anything longer
-- than the width, padStart does not. Reproduced here so a reset numbers books
-- and tickets exactly as the app would, rather than nearly.
create or replace function pg_temp.pad(v bigint, w integer) returns text as $f$
  select case when length(v::text) >= w then v::text
              else lpad(v::text, w, '0') end;
$f$ language sql immutable;

-- ---- 4. A FRESH SET OF TICKETS AND BOOKS ----------------------------------
-- Built from the settings above rather than from literals, so the numbering can
-- be changed in one place and this still agrees with it.
do $$
declare
  total   integer := 20000;   -- ROWS to create; ACTIVE_TICKETS decides how many are in play
  per     integer := (select value::integer from config where key = 'TICKETS_PER_BOOK');
  t_pre   text    := (select value from config where key = 'TICKET_PREFIX');
  t_dig   integer := (select value::integer from config where key = 'TICKET_DIGITS');
  t_start integer := (select value::integer from config where key = 'TICKET_START');
  b_pre   text    := (select value from config where key = 'BOOK_PREFIX');
  b_dig   integer := (select value::integer from config where key = 'BOOK_DIGITS');
  n_books integer;
begin
  if total % per <> 0 then
    raise exception '% tickets does not divide into books of % -- the last book would be short', total, per;
  end if;
  n_books := total / per;

  -- NO WIDTH CHECK, BECAUSE THE APP DOES NOT TRUNCATE AND NEITHER DOES THIS.
  -- This script used SQL's lpad and refused to run when the count outgrew the
  -- padding, on the reasoning that lpad('1000',3,'0') is '100' and book 1000
  -- would collide with book 100. That was true of lpad and false of the raffle:
  -- every number in this system is built by JavaScript's padStart (see
  -- src/lib/books.js:17 and functions/api/people.ts:779), which pads to a
  -- MINIMUM width and lets anything longer through untouched. Production proves
  -- it -- Book-001 through Book-999, then Book-1000 through Book-2000, two
  -- thousand books on three digits with no duplicate. So `pad` below is
  -- padStart, not lpad, and a collision is not reachable: distinct integers
  -- cannot produce the same string when nothing is cut off.
  if length((t_start + total - 1)::text) > t_dig then
    raise exception 'TICKET_DIGITS is % but the last ticket number needs %', t_dig, length((t_start + total - 1)::text);
  end if;

  -- BOOKS FIRST. tickets.book_idx is a foreign key into books, so generating
  -- the tickets first fails on the very first row.
  insert into books (idx, number, first_ticket, last_ticket, status)
  select b,
         b_pre || pg_temp.pad(b, b_dig),
         t_pre || pg_temp.pad(t_start + (b - 1) * per, t_dig),
         t_pre || pg_temp.pad(t_start + b * per - 1, t_dig),
         'Unassigned'
    from generate_series(1, n_books) b;

  insert into tickets (idx, number, book_idx, status)
  select i,
         t_pre || pg_temp.pad(t_start + i - 1, t_dig),
         ((i - 1) / per) + 1,
         'Available'
    from generate_series(1, total) i;

  update config set value = total::text where key = 'TOTAL_TICKETS';
  raise notice 'generated % tickets in % books, % .. %',
    total, n_books,
    (select number from tickets order by idx limit 1),
    (select number from tickets order by idx desc limit 1);
end $$;

-- ---- 5. THE GUARDS GO BACK ON --------------------------------------------
alter table audit_log       enable trigger user;
alter table ticket_movements enable trigger user;
alter table money_entries    enable trigger user;
alter table payments        enable trigger user;
alter table ticket_history  enable trigger user;
alter table book_history    enable trigger user;
alter table round_snapshots enable trigger user;
alter table tickets         enable trigger user;
alter table books           enable trigger user;

-- ---- 6. IT IS ONLY DONE IF ALL OF THIS IS TRUE ---------------------------
do $$
declare bad text := '';
begin
  if (select count(*) from tickets) <> 20000 then bad := bad || ' tickets<>20000'; end if;
  if (select count(*) from books) <> 2000 then bad := bad || ' books<>2000'; end if;
  if (select count(*) from tickets where status <> 'Available') > 0 then bad := bad || ' a ticket is not Available'; end if;
  if (select count(*) from books where status <> 'Unassigned') > 0 then bad := bad || ' a book is not Unassigned'; end if;
  if (select count(*) from ticket_history) > 0 then bad := bad || ' ticket_history not empty'; end if;
  if (select count(*) from book_history) > 0 then bad := bad || ' book_history not empty'; end if;
  if (select count(*) from payments) > 0 then bad := bad || ' payments not empty'; end if;
  if (select count(*) from agents) > 0 then bad := bad || ' agents not empty'; end if;
  if (select count(*) from winners) > 0 then bad := bad || ' winners not empty'; end if;
  if (select count(*) from app_users) <> 1 then bad := bad || ' app_users is not exactly the super admin'; end if;
  if (select count(*) from app_users where role = 'superadmin' and status = 'active') <> 1 then bad := bad || ' the surviving account is not an active superadmin'; end if;
  if (select count(*) from tickets where number = 'KS-00001') <> 1 then bad := bad || ' first ticket is not KS-00001'; end if;
  if (select count(*) from books where number = 'Book-001') <> 1 then bad := bad || ' first book is not Book-001'; end if;
  if (select count(*) from books where number = 'Book-2000') <> 1 then bad := bad || ' last book is not Book-2000 -- padding truncated'; end if;
  -- THE GUARDS MUST ALL BE BACK ON, and this asks about every table rather
  -- than the three it used to name. Another session added book_history to the
  -- disable/enable pair above -- correctly, because it gains the append-only
  -- trigger pair in a migration still waiting to be committed -- and a check
  -- that lists tables by hand would have gone on inspecting the old three,
  -- leaving the newly-liftable table the one thing it could not see. The
  -- invariant is not "those three are enabled", it is "this reset left nothing
  -- switched off", and that is true of a table added next year as well.
  if (select count(*) from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D') > 0 then
    bad := bad || ' a trigger is still disabled: ' || (
      select string_agg(c.relname || '.' || t.tgname, ', ')
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D');
  end if;
  if bad <> '' then
    raise exception 'RESET FAILED, rolling back everything:%', bad;
  end if;
  raise notice 'verified: 20000 tickets, 2000 books, no history, no money, one account';
end $$;

commit;
