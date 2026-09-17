-- Undoing something is not the same as it never having happened.
--
-- ARCHITECTURE-REVIEW.md §23 Phase 0: "Remove the three hard deletes (soft-delete
-- rows or reverse them)." They are:
--
--   check_in_reports   undoing a check-in recorded against the wrong seller
--   check_in_dates     clearing a round's date
--   prizes             taking a prize off the schedule before it is drawn
--
-- WHY THEY ARE WRONG, which is not obvious, because each one was written
-- deliberately and the reason given was sound. deadlines.ts says it in its own
-- comment: "UNDOING IS DELETING THE RECORD, not hiding it. Recorded against the
-- wrong seller is a thing that happens on a phone in a car park, and the fix has
-- to put that person back on the chase list rather than leave them quietly
-- marked as having answered."
--
-- Every word of that is right about the CHASE LIST and wrong about the RECORD.
-- The seller must go back on the list — that is the whole point of the undo, and
-- it still happens here. But "somebody recorded Naw Paw as having reported on
-- 14 September, and somebody took it back forty minutes later" is a fact about
-- what people did, and the raffle's acknowledgement rule exists precisely
-- because whose word a confirmation is matters. A delete answers "is she on the
-- list" correctly and destroys the only evidence that anyone ever said
-- otherwise. That is the same argument the ledger already won: a correction is a
-- new row, never an edit, because a correction whose evidence is gone cannot be
-- told from a figure that was always right.
--
-- THE SHAPE, the same for all three, so there is one thing to remember:
--
--   <verb>_at   timestamptz  null while the row is live
--   <verb>_by   text         who did it
--
-- and every read carries `<verb>_at is null`. Re-recording revives the row
-- rather than colliding with it — check_in_reports is keyed (agent_id, round)
-- and prizes on prize_id, so without the revive an undo would make that seller's
-- round, or that prize's name, unusable for the rest of the raffle.
--
-- THE FILTER IS AN "EVERYTHING EXCEPT X" CONDITION, which this repository has
-- already named as a bug shape in AUDIT.md §X and paid for three times in one
-- day. A predicate every caller has to remember is a predicate somebody will
-- forget, and the row that comes back will look like an ordinary row. So it is
-- not left to memory: tests/softdelete.test.mjs reads the handler source and
-- fails when any select on these three tables omits it. Partial indexes below
-- make the live-row reads cheap, and they also document which predicate is
-- meant to be there.
--
-- DATA LOSS RISK: NO. Six nullable columns added, three partial indexes created.
-- No column is dropped, no row is deleted, nothing existing is written — every
-- row already in these tables is live, which is what a null default says.

-- ============ A CHECK-IN THAT WAS TAKEN BACK (begin) ============
alter table check_in_reports add column if not exists undone_at timestamptz;
alter table check_in_reports add column if not exists undone_by text;

-- Every read asks for live rows for a round or a seller, so the index carries
-- the predicate rather than leaving it to a filter after the fetch.
create index if not exists check_in_reports_live_idx
  on check_in_reports (round, agent_id) where undone_at is null;
-- ============ A CHECK-IN THAT WAS TAKEN BACK (end) ============


-- ============ A ROUND WHOSE DATE WAS CLEARED (begin) ============
-- Clearing a round's date is rarer and more consequential than it looks: it is
-- what a dozen people were told to do, withdrawn. Who withdrew it is the part
-- worth keeping.
alter table check_in_dates add column if not exists cleared_at timestamptz;
alter table check_in_dates add column if not exists cleared_by text;

create index if not exists check_in_dates_live_idx
  on check_in_dates (round) where cleared_at is null;
-- ============ A ROUND WHOSE DATE WAS CLEARED (end) ============


-- ============ A PRIZE TAKEN OFF THE SCHEDULE (begin) ============
-- DISTINCT FROM `active`, which already exists and means something else. active
-- false is "not on offer" — the prize is still in the schedule and the organiser
-- may turn it back on, and remove_prize's own refusal message says so: "Turn it
-- off instead and it stays on the record." removed_at is the stronger act, and
-- until now it was the one that left nothing behind.
--
-- The drawn-prize guard above it stays exactly as it is. A prize some ticket has
-- won cannot be removed at all, softly or otherwise, and `on delete restrict`
-- on winners.prize_id would have refused it anyway.
alter table prizes add column if not exists removed_at timestamptz;
alter table prizes add column if not exists removed_by text;

create index if not exists prizes_live_idx
  on prizes (rank) where removed_at is null;
-- ============ A PRIZE TAKEN OFF THE SCHEDULE (end) ============
