-- Where every ticket has been, as rows rather than as a column.
--
-- ARCHITECTURE-REVIEW.md §23 Phase 1A, and §22 step 1: add the ledger EMPTY,
-- with its triggers, changing no existing behaviour. Nothing reads this table
-- and nothing writes it. That is the whole point of shipping it first — the
-- schema lands, is deployed, and is sat on while the writers are built, so the
-- day custody moves to the ledger is not also the day the table is new.
--
-- THE PROBLEM IT EXISTS FOR. Custody today is `books.held_by_agent`: one column,
-- overwritten. Where a book has been is recoverable only from book_history,
-- which is a narrative beside the fact rather than the fact itself — and where a
-- TICKET has been is not recorded anywhere at all, because a book has always
-- moved whole. That was true and is the reason the backfill is exact; it stops
-- being true the moment somebody hands back six of ten.
--
-- This repository has now paid four times for a figure stored against custody
-- rather than derived from what happened: the RM400 across Book-001/002/003/116,
-- Book-510, Book-022, and Book-084's restock un-paying without un-selling. Each
-- was a different door into the same room.
--
-- WHAT IS DELIBERATELY NOT HERE. No function writes a movement, no view reads
-- one, no handler is touched, and the backfill is written but NOT RUN — it is
-- supabase/backfill-custody.sql, which nothing calls, and §22 step 2 says why:
-- any ticket whose replayed holder disagrees with its book's holder is a
-- FINDING, not something to fix in the backfill. It stops rather than
-- reconciles.
--
-- DATA LOSS RISK: NO. One table created, one nullable-with-default column added
-- to tickets. No existing column is dropped or written, no row is deleted. The
-- new column is NOT NULL with a default, which Postgres 11 and later store in
-- the catalogue rather than rewriting the table, so this is not a long lock on
-- twenty thousand rows.

-- ============ THE LEDGER (begin) ============
create table if not exists ticket_movements (
  id          bigint generated always as identity primary key,
  -- SETTABLE, not just defaulted, because the backfill writes historic rows and
  -- a ledger whose `at` is all one afternoon cannot be replayed in order.
  at          timestamptz not null default now(),
  ticket_idx  integer not null references tickets(idx),

  /*
   * 'desk' IS A REAL PLACE, not a null.
   *
   * The alternative — null meaning "nobody" — makes every query over this table
   * an "everything except X" condition, the bug shape AUDIT.md §X names after
   * three defects in one day. `from_holder <> to_holder` would be silently
   * unknown for every movement in or out of the office, and `where holder =
   * 'A001'` would quietly agree that the desk is not a holder. A sentinel is
   * one value somebody has to know; a null is a rule every query has to
   * remember.
   *
   * It is a plain text column rather than a reference to agents, because 'desk'
   * is not an agent and never will be, and because a movement that happened
   * must stay readable after the seller who made it is deleted.
   */
  from_holder text not null,
  to_holder   text not null,

  kind        text not null check (kind in
                ('issue','return','transfer','restock','lost','found','correction')),

  /*
   * ONE BATCH PER USER ACTION. Handing over a whole book of ten is ten rows and
   * one batch_id — so "what did that person do at 14:12" is a query rather than
   * a join on time, which is the mistake request_id was added to stop making
   * elsewhere in this schema.
   */
  batch_id    uuid not null,
  by_user     text not null,
  reason      text not null default '',

  -- A correction is a new row pointing at the one it undoes, never an edit. The
  -- triggers below make that the only option rather than the polite one.
  reverses    bigint references ticket_movements(id),

  -- The same retry, recorded twice, is one movement. Partial index below.
  client_key  text,

  /*
   * WHERE THIS ROW CAME FROM, and it is a column rather than a kind.
   *
   * §22 step 2 describes backfilled rows as `kind='backfill'`, which cannot be
   * right: the replay check in the same paragraph compares the projected holder
   * against today's, and a row whose kind is 'backfill' has thrown away whether
   * it was an issue or a return — which is the only thing the replay can be
   * computed from. So kind stays semantic and provenance goes here. `reason`
   * still names the source row, as that step asks.
   */
  backfilled  boolean not null default false,

  -- A movement that moves nothing is a typo, except when it is a correction —
  -- which may legitimately restate a holder to attach a reason to it.
  check (from_holder <> to_holder or kind = 'correction')
);

-- PARTIAL, and it has to be: every NULL is distinct in Postgres, so a plain
-- unique column would be relying on that by accident. Two movements nobody gave
-- a key are two movements, which is the ordinary case. Copied in shape from
-- payments_client_key_idx, where the same sentence is already written.
create unique index if not exists ticket_movements_client_key_idx
  on ticket_movements (client_key) where client_key is not null;

-- Replay reads a ticket's movements in the order they were written. `id` rather
-- than `at`, because two rows in one batch share a timestamp and replay order
-- must be total.
create index if not exists ticket_movements_ticket_idx
  on ticket_movements (ticket_idx, id);
create index if not exists ticket_movements_batch_idx
  on ticket_movements (batch_id);
create index if not exists ticket_movements_holder_idx
  on ticket_movements (to_holder, id desc);
-- ============ THE LEDGER (end) ============


-- ============ APPEND ONLY, ENFORCED (begin) ============
-- The same three the four existing ledgers have. TRUNCATE is the third and it
-- is the one people leave off: it is neither an update nor a delete, and it
-- would empty the table without firing either of the other two.
create or replace function ticket_movements_append_only() returns trigger as $$
begin
  raise exception 'ticket_movements is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Write the opposite movement instead, with reverses pointing at the row it undoes. The pair is what makes a correction auditable; an edit leaves the trail saying the mistake never happened.';
end $$ language plpgsql;

drop trigger if exists ticket_movements_no_change on ticket_movements;
create trigger ticket_movements_no_change before update or delete on ticket_movements
  for each row execute function ticket_movements_append_only();

drop trigger if exists ticket_movements_no_truncate on ticket_movements;
create trigger ticket_movements_no_truncate before truncate on ticket_movements
  for each statement execute function ticket_movements_append_only();
-- ============ APPEND ONLY, ENFORCED (end) ============


-- ============ SERVER ONLY (begin) ============
-- Like audit_log and payments: the edge function reads it with the service key
-- and does its own scoping in code, because it has to, being above the
-- policies. RLS is enabled as well as revoked so that a future grant cannot
-- quietly open a table with no policies on it.
alter table ticket_movements enable row level security;
revoke all on ticket_movements from anon, authenticated;
-- ============ SERVER ONLY (end) ============


-- ============ THE PROJECTION COLUMN (begin) ============
-- Where the ticket is NOW, maintained in the same transaction as the movement
-- that moves it — once there is a function that writes movements, which there
-- is not yet. Until then every ticket reads 'desk', which is true of an
-- unissued raffle and wrong for the rest; the backfill is what makes it true,
-- and it has not been run.
--
-- NOT DERIVED ON READ. The alternative is a view folding the whole ledger on
-- every query, which is correct and gets slower for the life of the raffle. The
-- ledger stays the truth and this stays a cache of it, with the replay check as
-- the thing that proves the cache has not drifted.
alter table tickets add column if not exists holder text not null default 'desk';
create index if not exists tickets_holder_idx on tickets (holder) where holder <> 'desk';
-- ============ THE PROJECTION COLUMN (end) ============
