-- A debt the raffle has decided will not be collected — Phase 3 of the audit of
-- 2026-09-15 (supabase/AUDIT.md §I, §L rule 6).
--
-- Readiness rule L6 says the draw is ready when outstanding money is zero, OR
-- every non-zero line has been explicitly written off with a reason. Only the
-- first half was buildable: there was no way to record the second, so a raffle
-- with one seller who genuinely never pays could never read as ready, and the
-- only way to clear the blocker was to type a payment that never happened.
-- A rule that can only be satisfied by lying is worse than no rule.
--
-- DATA LOSS RISK: NO. One CHECK constraint is widened to admit a third value.
-- Nothing is dropped, no row is rewritten, and every existing row still
-- satisfies it.
--
-- A write-off is NOT money. It sits in `payments` because it belongs to the
-- same running total and because every correction to money here is a row with
-- a reason rather than an edit — but anything summing cash has to exclude it,
-- or the total would say the money arrived.
--
-- GENERATED from the canonical file: the `source` column of schema.sql.

alter table payments drop constraint if exists payments_source_check;
alter table payments add constraint payments_source_check
  check (source in ('hand','settlement','writeoff'));
