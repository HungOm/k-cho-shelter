-- The check-in report: what the seller brought, and when the rounds are.
--
-- Additive and idempotent; run it twice and nothing changes. DATA LOSS RISK: NO.
-- No column is dropped and no row touched. The three new columns default to 0,
-- which is the truth about every check-in recorded before today: nobody was
-- asked how many stubs came back, so nobody said.
--
-- What it adds:
--   * stubs_returned / unsold_returned / books_out_at on check_in_reports, so a
--     checkpoint can reconcile PAPER rather than restate figures the system
--     already had
--   * check_in_dates, one optional row per round, overriding the derived date
--     for a round that lands on a holiday
--
-- The sales closing date needs no SQL: it is a config row like every other date,
-- and it is enforced in the Edge Function where every other write rule lives.
--
-- GENERATED from the canonical file, so the migration and the file cannot
-- drift: the two new blocks of schema.sql, plus the grants from rls.sql.

-- ---------- from schema.sql ----------
-- ============ WHAT THE SELLER PHYSICALLY BROUGHT (begin) ============
-- A check-in used to record three numbers: books back, tickets sold, money
-- paid. Two of those are the seller's word about things the system already
-- counts for itself, so the report they produced could only ever restate what
-- was already on the screen. What it could not say is the thing an organiser at
-- a table actually needs to know: does the PAPER add up.
--
-- A seller carrying N books is carrying N × TICKETS_PER_BOOK physical tickets.
-- At a checkpoint each one of them is in exactly one of four places: handed in
-- as a stub, handed back unsold, still in a book they are keeping, or missing.
-- The fourth is the only one that matters and it is the one nothing could see,
-- because "sold" was a number somebody typed rather than a count of counterfoils
-- against a count of tickets.
--
-- DECLARED, NOT COUNTED, and the distinction is the same one settlement makes.
-- Nothing here moves money, closes a book or marks a ticket: it is what the
-- person said while standing there. The value is in the DIFFERENCE between it
-- and what the system recorded, which is why both are printed side by side.
alter table check_in_reports add column if not exists stubs_returned  integer not null default 0 check (stubs_returned >= 0);
alter table check_in_reports add column if not exists unsold_returned integer not null default 0 check (unsold_returned >= 0);
-- How many books they were holding WHEN THEY REPORTED, which is not how many
-- they hold now and not how many the round-closing snapshot will record. The
-- paper arithmetic on a sheet printed in November has to use the number that
-- was true in September, or a reprint quietly contradicts the copy somebody
-- signed. Stored for the same reason round_snapshots stores `outstanding`
-- rather than deriving it: a recomputation years later is not a record.
alter table check_in_reports add column if not exists books_out_at    integer not null default 0 check (books_out_at >= 0);
-- ============ WHAT THE SELLER PHYSICALLY BROUGHT (end) ============

-- ============ A ROUND'S DATE, WHERE SOMEBODY MOVED IT (begin) ============
-- The rounds are WORKED OUT from the anchor, the cadence and the wall, and that
-- stays the default: nobody should have to type a calendar, and a seller can be
-- told every one of their dates the day they take their books.
--
-- What the derivation cannot do is know that round 4 lands on Chinese New Year.
-- So a row here OVERRIDES the derived date for one round and nothing else. An
-- empty table is the behaviour this system has always had.
--
-- NOT APPEND ONLY, deliberately, unlike ticket_history and round_snapshots. A
-- date somebody moved to the wrong day has to be movable again, and a table of
-- corrections to a date nobody has reported by yet records nothing anybody will
-- ever ask about. What IS kept is the audit row for each change: who moved a
-- reporting date and when is a question about people, and it is answered where
-- every other such question is answered.
create table if not exists check_in_dates (
  round    integer primary key check (round >= 1),
  due_at   date not null,
  note     text not null default '',
  set_by   text not null default '',
  set_at   timestamptz not null default now()
);
-- ============ A ROUND'S DATE, WHERE SOMEBODY MOVED IT (end) ============

-- ---------- from rls.sql: the dates are the function's, like every other table ----------
alter table check_in_dates enable row level security;
revoke all on check_in_dates from anon, authenticated;
