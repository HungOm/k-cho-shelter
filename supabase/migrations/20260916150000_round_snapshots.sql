-- What a round said when it closed — Phase 2 of the audit of 2026-09-15
-- (supabase/AUDIT.md §I, §K), and the one item on that backlog that could not
-- wait: a round that closes without a snapshot can never be snapshotted
-- afterwards, because the figures it would have frozen have already moved.
--
-- Idempotent; run it twice and nothing changes. DATA LOSS RISK: NO. One new
-- table, one new function, two new triggers on that table alone. No existing
-- column is dropped, no row deleted, no view or function replaced.
--
-- The write side needs no SQL. `rollCheckIn` in the Edge Function takes the
-- snapshot for the round it is closing, before it moves the books or the round
-- number, and inserts ON CONFLICT DO NOTHING so a retried half-failed roll
-- keeps the figures from the attempt that closed the round rather than
-- restating them as they are now.
--
-- GENERATED from the canonical files, so the migration and they cannot drift:
-- the ROUND SNAPSHOTS block of schema.sql, then the grants rls.sql makes for
-- it alongside every other server-only table.

-- ---------- from schema.sql ----------
-- ============ WHAT THE ROUND SAID WHEN IT CLOSED ============

create table if not exists round_snapshots (
  /*
   * ONE ROW PER SELLER PER CLOSED ROUND: the figures as they stood the moment
   * the check-in rolled past them.
   *
   * WHY ANY OF THIS EXISTS. Every money figure in this system is live. That is
   * right for "what does this seller owe today" and useless for "what did
   * round 2 say", which is the question asked when a seller disputes a total,
   * when an organiser wants to know what moved since the last checkpoint, and
   * at the end when somebody has to explain the raffle to whoever paid for it.
   * A live figure recomputed after a correction answers the first question in
   * place of the second and gives no sign it has done so. The correction is
   * not the problem — correcting money is the whole design, reversals rather
   * than deletes — the problem is that afterwards nothing remembers what was
   * corrected FROM.
   *
   * WHY AT THE ROLL AND NOWHERE ELSE. The round number changes in exactly one
   * place, `rollCheckIn`, and it changes once. A snapshot taken on a schedule
   * would need a scheduler this system does not have; a snapshot taken when
   * somebody opens a screen would record when they looked rather than when the
   * round ended. The roll already knows which round it is closing and already
   * refuses to run twice for the same one.
   *
   * AND IT CANNOT BE TAKEN LATE. This is the reason the table could not wait:
   * a round that closed without a snapshot can never be snapshotted
   * afterwards, because the figures it would have frozen have already moved.
   * Every other item in the audit's backlog could be built the week after and
   * lose nothing. This one loses a round per week it is not built.
   *
   * APPEND ONLY, for the same reason `ticket_history` is: a record that can be
   * rewritten is a live figure with extra steps and a misleading name. The
   * trigger is below, and it does not care that the Edge Function holds the
   * secret key.
   *
   * THE SELLER CANNOT BE ERASED OUT FROM UNDER IT — `on delete restrict`,
   * not the cascade `check_in_reports` uses. A declaration is a thing a person
   * did and goes when they do; a snapshot is a measurement the raffle took of
   * its own books, and it has to survive the person it measured. Nothing
   * deletes agents today, which is what makes this cheap to state now.
   */
  round         integer not null check (round >= 1),
  agent_id      text not null references agents(agent_id) on delete restrict,
  taken_at      timestamptz not null default now(),
  taken_by      text not null default '',

  -- Custody, as at the close.
  books_out     integer not null default 0 check (books_out >= 0),
  books_settled integer not null default 0 check (books_settled >= 0),

  -- What the raffle believed about this seller's money. `outstanding` is
  -- expected − collected and is stored rather than derived on purpose: the
  -- point of the row is what was SAID, and a figure recomputed from two others
  -- years later is a recomputation, not a record.
  recorded_sold integer not null default 0 check (recorded_sold >= 0),
  expected      numeric(12,2) not null default 0,
  collected     numeric(12,2) not null default 0,
  outstanding   numeric(12,2) not null default 0,

  -- Whether they answered the round being closed, and how many earlier ones
  -- they had let pass in silence. Both are countable from `check_in_reports`
  -- forever; both are copied here so one row answers the whole question
  -- without a join to a table whose rows a later correction may add to.
  reported      boolean not null default false,
  missed_before integer not null default 0 check (missed_before >= 0),

  primary key (round, agent_id)
);
-- "Show me round 2" is the only way this table is ever read.
create index if not exists round_snapshots_round_idx on round_snapshots (round);

-- APPEND ONLY, ENFORCED RATHER THAN INTENDED — the same bar, and the same
-- reasoning, as the TICKET HISTORY block: the one caller that can reach this
-- table bypasses row security, so grants and policies are irrelevant to it and
-- a trigger is not. TRUNCATE is named separately because it is neither an
-- update nor a delete and would empty the table without firing either.
create or replace function round_snapshots_append_only() returns trigger as $$
begin
  raise exception 'round_snapshots is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'A closed round said what it said. Correct the live figures instead: the difference between them and the snapshot is the correction, and being able to see it is why the row is kept.';
end $$ language plpgsql;

drop trigger if exists round_snapshots_no_change on round_snapshots;
create trigger round_snapshots_no_change before update or delete on round_snapshots
  for each row execute function round_snapshots_append_only();

drop trigger if exists round_snapshots_no_truncate on round_snapshots;
create trigger round_snapshots_no_truncate before truncate on round_snapshots
  for each statement execute function round_snapshots_append_only();

-- ---------- from rls.sql ----------
-- Server-only, like audit_log, check_in_reports, payments and ticket_history:
-- no select policy, so row security denies every browser read, and revoked
-- from both browser roles so a policy added later for some other reason
-- cannot accidentally open it.
alter table round_snapshots enable row level security;
revoke all on round_snapshots from anon, authenticated;
