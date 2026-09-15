/*
 * The two views the Supabase linter calls SECURITY DEFINER — and why only one
 * of them can stop being one.
 *
 * WHAT THE LINT MEANS. Neither view ever said SECURITY DEFINER. A plain
 * `create view` in Postgres runs with its OWNER's rights unless you opt into
 * `security_invoker = true` (PG15+), so the property was inherited from the
 * default rather than written down. The linter is naming the default.
 *
 * WHY IT MATTERS HERE. rls.sql revokes select on tickets, books, agents and
 * config from `authenticated` and grants only these views. The definer
 * behaviour is what lets a caller with no privilege on the base table read the
 * masked view at all — it is load-bearing, not an oversight, and rls.sql:127
 * has said so all along. Flipping both views to invoker does not tighten
 * anything; it makes every direct read fail with "permission denied".
 *
 * So the two are treated differently, because they are different.
 */

-- ============ config_readable: RESOLVED ============
--
-- This one masks nothing. It is `select key, value from config where
-- app_role() is not null`, and the config_read policy on the base table already
-- carries that identical condition. So invoker semantics plus the policy give
-- exactly the rows the definer view gave, and the lint goes away honestly.
--
-- The grant is COLUMN-LEVEL on purpose. config has a third column, `notes`,
-- which the view drops; a table-wide `grant select on config` would hand it to
-- every signed-in user and quietly widen what the browser can read. Naming the
-- two columns keeps the view's column reduction real rather than decorative.
--
-- Row security still applies to a column grant, so config_read remains the
-- thing that decides WHICH rows — the grant only decides which columns.
grant select (key, value) on config to authenticated;
alter view public.config_readable set (security_invoker = true);

-- ============ tickets_readable: DELIBERATELY NOT RESOLVED ============
--
-- This one cannot move, and the reason is worth stating where somebody will
-- find it when the linter complains again.
--
-- RLS filters ROWS. It cannot mask COLUMNS. What this view does is column-level
-- — buyer_name, buyer_zone and notes blanked on books a seller is not carrying,
-- and buyer_phone reduced to '••••' || right(phone, 3) for a viewer. No policy
-- can express that.
--
-- Making it an invoker view would mean granting select on tickets, and the
-- tickets_read policy does NOT mask anything: it restricts an AGENT to their
-- own books, and lets every recorder and viewer read every row. A viewer could
-- then select buyer_phone straight off the base table and get real telephone
-- numbers for the whole raffle. That is exactly the hole closed by 0974416
-- ("A viewer could read every winner's telephone number"), and most of those
-- numbers belong to refugees.
--
-- So it stays a definer view. Declared rather than inherited, so the next
-- reader sees a decision instead of a default, and so a future change to the
-- Postgres default cannot silently convert it.
--
-- NOTE: this does not silence the linter for tickets_readable, and is not meant
-- to. The honest outcome is a documented exception, not a fix.
alter view public.tickets_readable set (security_invoker = false);

-- ============ A DEAD GRANT, AND A COMMENT THAT OUTLIVED ITS FACT ============
--
-- While reading this: rls.sql grants select on config to authenticated at
-- line 413 and revokes it at 417, four lines later, so the grant has no effect.
-- Its comment says it is re-granting after "the revoke above", but that revoke
-- (line 408) is FROM ANON and would never have taken it.
--
-- That matters beyond tidiness, because the comment at rls.sql:370-381 argues
-- the grant exists so the schema need not depend on active_tickets() being
-- security definer — "the grant removes the dependency". The grant is revoked,
-- so the dependency is live. It works only because functions.sql:30 does
-- declare active_tickets() security definer. Nothing is broken; the reasoning
-- written beside it is simply no longer true, and the column grant above now
-- supersedes both.
