-- The ledger, made a rule: append only, idempotent, and threaded.
--
-- Additive and idempotent; run it twice and nothing changes. DATA LOSS RISK: NO.
-- No column is dropped and no row is touched. Every existing row gets a blank
-- request id and no client key, which is the truth about them: they were
-- written before either existed.
--
-- Three things, in the order they matter:
--
--   1. payments refuses UPDATE, DELETE and TRUNCATE. It was append only by
--      habit — no handler edits it, no handler deletes from it — and that held
--      exactly as long as nobody wrote the one that did. The edge function
--      bypasses row security, so grants do not bind it; a trigger does.
--
--   2. payments.client_key, unique where present. A ticket sale is idempotent
--      by nature; a payment is not, and after a write times out the app tells
--      the person "Checking what went through" at the precise moment they
--      press the button again. The caller now names the attempt.
--
--   3. request_id on payments, audit_log, book_history and ticket_history,
--      defaulted from the request's own headers. Counting a book in writes to
--      four tables and nothing joined them; the alternative was threading a
--      column through fifty inserts, three of which are inside SQL functions.
--
-- GENERATED from the canonical file, so the migration and the file cannot
-- drift: two blocks of schema.sql, in order.

-- ---------- from schema.sql ----------
-- ============ THE LEDGER IS APPEND ONLY, AND ENFORCED (begin) ============
-- Every ringgit that moves is a row here: cash handed in, a settlement, a
-- write-off. Nothing corrects a row — reverse_payment, a forced re-settle and a
-- restock all write a NEW row with `reverses` pointing at the one it undoes, so
-- a balance is a fold over the rows and the arithmetic that produced it is
-- still on the table afterwards.
--
-- ALL OF THAT WAS A HABIT. No handler updates this table and no handler deletes
-- from it, which held exactly as long as nobody wrote the one that did. The
-- Edge Function holds the secret key and bypasses row security, so every grant
-- and policy here is irrelevant to the only caller that can reach it; a trigger
-- is not. The same bar as ticket_history and round_snapshots, and for a table
-- whose whole value is that yesterday's figure cannot quietly become today's.
--
-- A CORRECTION IS NOT AN EDIT. Money taken by mistake is reversed, which leaves
-- both the claim and the correction readable. An edit leaves a number that has
-- always been right, which is indistinguishable from a number that is wrong.
create or replace function payments_append_only() returns trigger as $$
begin
  raise exception 'payments is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Reverse the row instead: reverse_payment writes the opposite entry, and the pair is what makes the correction auditable.';
end $$ language plpgsql;

drop trigger if exists payments_no_change on payments;
create trigger payments_no_change before update or delete on payments
  for each row execute function payments_append_only();

-- Truncate is neither, and would empty the ledger without firing either.
drop trigger if exists payments_no_truncate on payments;
create trigger payments_no_truncate before truncate on payments
  for each statement execute function payments_append_only();

-- ============ THE SAME MONEY, RECORDED TWICE, IS THE RETRY (begin) ============
-- A ticket sale is idempotent by nature: the ticket number is the key, the
-- version check makes a second attempt fail loudly, and the sell screen reads
-- the rows back one by one. A PAYMENT has no natural key. RM60 for one seller
-- twice is indistinguishable from two genuine RM60 payments — and the app tells
-- the person exactly that, after a write times out: "Checking what went
-- through". That sentence is shown at the precise moment somebody on bad signal
-- in a car park taps the button again.
--
-- So the CALLER names the attempt. One key per attempt, reused on every retry
-- of that same attempt, and a second insert with the same key is not an error —
-- it returns the row the first one wrote. Refusing would be the same problem
-- wearing a different hat: the volunteer cannot tell "already recorded" from
-- "record it again", and one of those answers loses money.
--
-- NULL IS ALLOWED AND NOT UNIQUE, so nothing that already exists needs a key
-- and no handler is forced to invent one. A partial index rather than a unique
-- constraint, because in Postgres every NULL is distinct and a plain unique
-- column would work here by accident rather than by design.
alter table payments add column if not exists client_key text;
create unique index if not exists payments_client_key_idx
  on payments (client_key) where client_key is not null;
-- ============ THE SAME MONEY, RECORDED TWICE (end) ============

-- ============ ONE REQUEST, ONE THREAD THROUGH THE TABLES (begin) ============
-- Counting a book in writes to four tables: the tickets it marks sold (through
-- the history trigger), the payments row for the cash, the book's custody line,
-- and the audit log. Nothing joined them. "Show me everything that happened when
-- Book-0031 was counted in" was a join on TIME — the one key that is
-- approximately right, always available, and wrong in exactly the cases worth
-- investigating, where two people were working the same minute.
--
-- WHY IT IS READ FROM THE REQUEST AND NOT PASSED IN. The obvious version is a
-- column threaded through every insert. There are about fifty of them, three are
-- inside SQL functions this cannot reach without changing their signatures, and
-- every one is a place a future handler can forget. PostgREST already puts the
-- request's headers where SQL can see them, so the id arrives with the request
-- and the DEFAULT picks it up — including inside settle_book, which is the one
-- case that motivated the whole thing.
--
-- IT IS NOT A TRANSACTION ID. One API call makes several REST calls and each of
-- those is its own transaction. This is the thread that lets somebody pull on
-- any one row and find the rest of what happened with it.
--
-- BLANK IS A REAL ANSWER and the system works without it: a row written by hand
-- in the SQL editor, by a migration, or by anything that is not an HTTP request
-- gets ''. That is the truth about those rows rather than a failure.
create or replace function request_id() returns text as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id',
    '')
$$ language sql stable set search_path = public;

alter table payments     add column if not exists request_id text not null default request_id();
alter table audit_log    add column if not exists request_id text not null default request_id();
alter table book_history add column if not exists request_id text not null default request_id();
-- On ticket_history the default does the work the trigger would otherwise have
-- to be taught, which also means it covers the rows written from inside
-- bulk_record_sales, sell_books and settle_book without those functions
-- growing a parameter apiece.
alter table ticket_history add column if not exists request_id text not null default request_id();

-- "Everything that happened in that one action" is the only way this is read.
create index if not exists audit_log_request_idx on audit_log (request_id) where request_id <> '';
create index if not exists payments_request_idx on payments (request_id) where request_id <> '';
-- ============ ONE REQUEST, ONE THREAD (end) ============
