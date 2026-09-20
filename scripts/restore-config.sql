-- Restore a config table that was emptied while the tickets survived.
--
-- WHEN THIS IS THE RIGHT SCRIPT. The app refuses to make tickets with
--
--   SCHEMA_DRIFT: The settings say 0 tickets in 0 books, but the database
--                 holds 10000 tickets and 1000 books.
--
-- which is people.ts comparing `config` against the actual row counts. The rows
-- are intact; the settings that describe them are gone.
--
-- IT DERIVES, IT DOES NOT ASSUME. Every numbering value is read back out of the
-- surviving rows, because the seed defaults in schema.sql are WRONG for a
-- raffle that was not created with them — the default BOOK_DIGITS is 4, giving
-- `Book-0001`, and a raffle numbering its books `Book-004` would have every
-- future book land on a name that does not match the ones already printed.
--
-- IT ONLY INSERTS. `config_numbering_locked` is a BEFORE UPDATE trigger, so it
-- does not fire on insert — and a key that somehow survived is left exactly as
-- it is rather than being overwritten by a guess. If a surviving key is wrong,
-- this script will not fix it and STEP 1 is how you find out.
--
-- NOTHING HERE IS DESTRUCTIVE. No delete, no update, no drop.

-- ---------------------------------------------------------------------------
-- STEP 1 — LOOK FIRST. Run this alone and read it before running anything else.
-- ---------------------------------------------------------------------------

select 'config rows still present' as what, count(*)::text as value from config
union all select 'tickets', count(*)::text from tickets
union all select 'books',   count(*)::text from books
union all select 'first ticket number', coalesce(min(number), '(none)') from tickets
union all select 'last ticket number',  coalesce(max(number), '(none)') from tickets
union all select 'first book number',   coalesce(min(number), '(none)') from books
union all select 'last book number',    coalesce(max(number), '(none)') from books
union all select 'tickets sold',
       count(*)::text from tickets where status in ('Sold', 'Donated');

-- And what, if anything, is left of the settings:
select key, value from config order by key;

-- ---------------------------------------------------------------------------
-- STEP 2 — WHAT WOULD BE WRITTEN. Still writes nothing.
--
-- The regexes split a stored number into its prefix and its digits:
--   'KS-00031'  -> prefix 'KS-',   digits 5
--   'Book-004'  -> prefix 'Book-', digits 3
-- so padding and prefix come from the paper that already exists.
-- ---------------------------------------------------------------------------

create or replace view _restore_plan as
with t as (
  select min(number) as first_no, count(*)::bigint as n from tickets
), b as (
  select min(number) as first_no, count(*)::bigint as n from books
)
select * from (values
  ('TICKET_PREFIX',    (select regexp_replace(first_no, '\d+$', '')          from t)),
  ('TICKET_DIGITS',    (select length(substring(first_no from '\d+$'))::text from t)),
  ('TICKET_START',     (select (substring(first_no from '\d+$'))::bigint::text from t)),
  ('TOTAL_TICKETS',    (select n::text from t)),
  ('BOOK_PREFIX',      (select regexp_replace(first_no, '\d+$', '')          from b)),
  ('BOOK_DIGITS',      (select length(substring(first_no from '\d+$'))::text from b)),
  ('TICKETS_PER_BOOK', (select (t.n / nullif(b.n, 0))::text from t, b))
) as v(key, value);

select * from _restore_plan;

-- SANITY, and worth reading rather than skimming. If TICKETS_PER_BOOK does not
-- divide evenly, the raffle has a partial book and expand_tickets will refuse
-- for a DIFFERENT reason; do not paper over it here.
select
  (select count(*) from tickets) as tickets,
  (select count(*) from books)   as books,
  (select count(*) from tickets) % nullif((select count(*) from books), 0) as remainder_must_be_0;

-- ---------------------------------------------------------------------------
-- STEP 3 — WRITE IT. Run inside the transaction and read the output BEFORE
-- committing. Change `rollback` to `commit` only once step 2 looked right.
-- ---------------------------------------------------------------------------

begin;

  -- (a) the settings derived from the surviving rows. The CTE is repeated here
  --     rather than reading the view, so this block runs on its own — a script
  --     whose third step depends on its second having been run in the same
  --     session fails in the most confusing possible way.
  insert into config (key, value)
  with t as (select min(number) as first_no, count(*)::bigint as n from tickets),
       b as (select min(number) as first_no, count(*)::bigint as n from books)
  select key, value from (values
    ('TICKET_PREFIX',    (select regexp_replace(first_no, '\d+$', '')            from t)),
    ('TICKET_DIGITS',    (select length(substring(first_no from '\d+$'))::text   from t)),
    ('TICKET_START',     (select (substring(first_no from '\d+$'))::bigint::text from t)),
    ('TOTAL_TICKETS',    (select n::text from t)),
    ('BOOK_PREFIX',      (select regexp_replace(first_no, '\d+$', '')            from b)),
    ('BOOK_DIGITS',      (select length(substring(first_no from '\d+$'))::text   from b)),
    ('TICKETS_PER_BOOK', (select (t.n / nullif(b.n, 0))::text from t, b))
  ) as v(key, value)
  where value is not null
  on conflict (key) do nothing;

  -- (b) every other key the app reads, at its documented default, so nothing
  --     is missing. Blank is a real value for most of these and means "unset".
  insert into config (key, value) values
    ('TICKET_PRICE', '10'),
    ('CURRENCY', 'RM'),
    ('EVENT_NAME', 'Fundraising Raffle'),
    ('CHECK_IN_EVERY_MONTHS', '1'),
    ('REPORT_GRACE_DAYS', '3'),
    ('CHECK_IN_ROUND', '1'),
    ('DEFAULT_DUE_DAYS', '30'),
    ('CHECK_IN_DATE', ''), ('CHECK_IN_EVERY', ''), ('FINAL_DEADLINE', ''),
    ('SALES_CLOSE_DATE', ''), ('DRAW_DATE', ''),
    ('ORG_NAME', ''), ('ORG_LOGO', ''), ('ORG_LOGO_SMALL', ''),
    ('ORG_PHONE', ''), ('ORG_EMAIL', ''), ('ORG_WEBSITE', ''),
    ('ORG_ABOUT_MY', ''), ('ORG_ABOUT_EN', ''),
    ('BRAND_COLOR', ''), ('PROJECT_CODE', ''),
    ('ACTIVE_TICKETS', ''),     -- blank = every made ticket is in play
    ('TICKET_CEILING', ''),     -- blank = no ceiling; set it in Setup afterwards
    ('TICKET_ARTWORK_ID', ''),  -- blank = printing refused until artwork is set
    ('TICKET_SIZES', ''), ('VERIFY_URL', '')
  on conflict (key) do nothing;

  -- (c) what the app will now believe, next to what is actually there.
  select
    (select value from config where key = 'TOTAL_TICKETS')    as cfg_tickets,
    (select count(*)::text from tickets)                      as real_tickets,
    (select value from config where key = 'TICKETS_PER_BOOK') as per_book,
    (select count(*)::text from books)                        as real_books,
    (select value from config where key = 'TICKET_PREFIX')    as t_prefix,
    (select value from config where key = 'BOOK_PREFIX')      as b_prefix;

  -- cfg_tickets must equal real_tickets, and real_tickets / per_book must equal
  -- real_books. If either is off, roll back and say so — do not commit a
  -- settings table that disagrees with the paper.

rollback;   -- <- change to `commit` when the line above reads correctly

-- ---------------------------------------------------------------------------
-- AFTERWARDS
--
-- drop view _restore_plan;   -- step 2's view; step 3 does not need it
--
-- Then in the app: Setup carries ORG_NAME, the price, the dates, the brand
-- colour and the artwork, none of which can be recovered from ticket rows
-- because no ticket row ever held them. Re-enter them there rather than here.
-- Set TICKET_CEILING in Setup too; until it has a value the "Make more"
-- button hides itself once everything planned has been made.
-- ---------------------------------------------------------------------------
