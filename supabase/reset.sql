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
  || (select count(*) from agents)         || ' sellers, '
  || (select count(*) from winners)        || ' winners' as about_to_go;

-- ---- 1. THE GUARDS COME OFF, IN THE OPEN ---------------------------------
alter table payments        disable trigger user;
alter table ticket_history  disable trigger user;
alter table round_snapshots disable trigger user;
alter table tickets         disable trigger user;
alter table books           disable trigger user;

-- ---- 2. EVERYTHING GOES ---------------------------------------------------
-- Ordered so foreign keys never have to be deferred: children first.
delete from winners;
delete from prizes;
delete from prize_types;
delete from payments;
delete from ticket_history;
delete from book_history;
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
  -- FOUR, AND IT HAS TO BE. The books in volunteers' hands are labelled
  -- Book-001, so three digits was the obvious choice to keep those labels
  -- true -- but three digits cannot count to a thousand. lpad TRUNCATES, so
  -- book 1000 becomes Book-100 and collides with book 100. Ten thousand
  -- tickets in books of ten is a thousand books, so the numbering has to be
  -- four wide and every book number gains a zero. See the check below, which
  -- refuses the whole reset rather than letting this be discovered by a
  -- duplicate key nine hundred rows in.
  ('BOOK_PREFIX', 'Book-', 'Text before the book number. LOCKED once tickets exist.'),
  ('BOOK_DIGITS', '4', 'Zero padding, e.g. 4 gives Book-0001. LOCKED once tickets exist.'),
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
  ('ACTIVE_TICKETS', '10000', 'How many of the existing tickets are in play.');

-- ---- 4. A FRESH SET OF TICKETS AND BOOKS ----------------------------------
-- Built from the settings above rather than from literals, so the numbering can
-- be changed in one place and this still agrees with it.
do $$
declare
  total   integer := 10000;
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

  -- THE PADDING MUST BE WIDE ENOUGH TO COUNT THAT HIGH, and this is checked
  -- rather than assumed because lpad TRUNCATES: lpad('1000', 3, '0') is '100',
  -- not '1000'. With three digits, book 1000 silently becomes Book-100 and
  -- collides with book 100. The unique index does catch it, but it catches it
  -- nine hundred rows in, with a message about a duplicate key that says
  -- nothing about the cause. Fail here, where the reason can be written down.
  if length(n_books::text) > b_dig then
    raise exception
      'BOOK_DIGITS is % but % books need % digits -- lpad would truncate and Book-% would collide with Book-%',
      b_dig, n_books, length(n_books::text), n_books, lpad(n_books::text, b_dig, '0');
  end if;
  if length((t_start + total - 1)::text) > t_dig then
    raise exception 'TICKET_DIGITS is % but the last ticket number needs %', t_dig, length((t_start + total - 1)::text);
  end if;

  -- BOOKS FIRST. tickets.book_idx is a foreign key into books, so generating
  -- the tickets first fails on the very first row.
  insert into books (idx, number, first_ticket, last_ticket, status)
  select b,
         b_pre || lpad(b::text, b_dig, '0'),
         t_pre || lpad((t_start + (b - 1) * per)::text, t_dig, '0'),
         t_pre || lpad((t_start + b * per - 1)::text, t_dig, '0'),
         'Unassigned'
    from generate_series(1, n_books) b;

  insert into tickets (idx, number, book_idx, status)
  select i,
         t_pre || lpad((t_start + i - 1)::text, t_dig, '0'),
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
alter table payments        enable trigger user;
alter table ticket_history  enable trigger user;
alter table round_snapshots enable trigger user;
alter table tickets         enable trigger user;
alter table books           enable trigger user;

-- ---- 6. IT IS ONLY DONE IF ALL OF THIS IS TRUE ---------------------------
do $$
declare bad text := '';
begin
  if (select count(*) from tickets) <> 10000 then bad := bad || ' tickets<>10000'; end if;
  if (select count(*) from books) <> 1000 then bad := bad || ' books<>1000'; end if;
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
  if (select count(*) from books where number = 'Book-0001') <> 1 then bad := bad || ' first book is not Book-0001'; end if;
  -- The guards must be back on, or the reset has left the ledger editable.
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname in ('payments','ticket_history','round_snapshots')
         and not t.tgisinternal and t.tgenabled = 'D') > 0 then
    bad := bad || ' an append-only trigger is still disabled';
  end if;
  if bad <> '' then
    raise exception 'RESET FAILED, rolling back everything:%', bad;
  end if;
  raise notice 'verified: 10000 tickets, 1000 books, no history, no money, one account';
end $$;

commit;
