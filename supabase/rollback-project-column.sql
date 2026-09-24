/*
 * ROLLBACK FOR MULTI-TENANCY STAGE 1: THE COLUMN.
 *
 * Written with the migration, as the plan's stage table requires, and run by
 * hand by somebody who has decided to take Stage 1 back out. It lives here,
 * beside backfill-custody.sql and backfill-money.sql, because that is where
 * this repository keeps SQL a person runs deliberately.
 *
 * IT IS NOT IN migrations.pending/, AND THAT IS NOT A FILING PREFERENCE. That
 * directory is a waiting room for migrations, and test-functions.sh applies
 * every .sql in it to a clean build precisely so a file cannot reach
 * migrations/ unchecked. A rollback put there is applied straight after the
 * migration it undoes, and the suite reports the undo as a broken migration —
 * which is what happened, with "cannot drop column project_id of table
 * tickets because other objects depend on it".
 *
 * RUN supabase/rls.sql AFTERWARDS. This drops tickets_readable and does not
 * put it back. The view selects `t.*` in its inner subquery, so it holds a
 * dependency on project_id even though its own column list never changed, and
 * the column cannot be dropped while it exists. rls.sql opens with
 * `drop view if exists tickets_readable; create view …`, so re-applying it is
 * the whole repair — but until it runs, the browser's read path is missing.
 * Do the two together, in one window, or do neither.
 *
 *     psql "$SUPABASE_DB_URL" -f supabase/rollback-project-column.sql
 *     psql "$SUPABASE_DB_URL" -f supabase/rls.sql
 *
 * WHAT IT UNDOES. The fourteen composite unique keys; project_id on the
 * twenty-three raffle tables, which takes every index leading with it along,
 * because Postgres drops an index when a column it uses goes; and then the
 * forty-one original index definitions, copied verbatim from pg_indexes on a
 * database built before Stage 1.
 *
 * WHAT IT CANNOT UNDO: nothing, at Stage 1. No data is deleted, no key is
 * dropped and no answer changes, so taking the column out leaves the schema it
 * found — checked by diffing information_schema before and after, 380 columns
 * and 75 indexes identical. That stops being true at Stage 4, where the old
 * keys go.
 *
 * SAFE TO RUN TWICE, and safe against a database that never had Stage 1.
 */

-- ---------------------------------------------------------------------------
-- 1. the view that holds a dependency on the column. Put back by rls.sql.
-- ---------------------------------------------------------------------------
drop view if exists tickets_readable;

-- ---------------------------------------------------------------------------
-- 2. the composite keys Stage 1 added beside the old ones
-- ---------------------------------------------------------------------------
drop index if exists config_project_key_uidx;
drop index if exists app_users_project_email_uidx;
drop index if exists permissions_project_action_role_uidx;
drop index if exists round_snapshots_project_round_agent_uidx;
drop index if exists check_in_dates_project_round_uidx;
drop index if exists check_in_reports_project_agent_round_uidx;
drop index if exists tickets_project_idx_uidx;
drop index if exists tickets_project_number_uidx;
drop index if exists books_project_idx_uidx;
drop index if exists books_project_number_uidx;
drop index if exists agents_project_agent_uidx;
drop index if exists winners_project_ticket_uidx;
drop index if exists ticket_codes_project_ticket_uidx;
drop index if exists ticket_receipt_items_code_project_ticket_uidx;

-- ---------------------------------------------------------------------------
-- 3. the column, which takes the project_id-leading indexes with it
-- ---------------------------------------------------------------------------
alter table config drop column if exists project_id;
alter table ticket_templates drop column if exists project_id;
alter table agents drop column if exists project_id;
alter table app_users drop column if exists project_id;
alter table books drop column if exists project_id;
alter table tickets drop column if exists project_id;
alter table audit_log drop column if exists project_id;
alter table book_history drop column if exists project_id;
alter table ticket_history drop column if exists project_id;
alter table ticket_movements drop column if exists project_id;
alter table ticket_codes drop column if exists project_id;
alter table ticket_receipts drop column if exists project_id;
alter table ticket_receipt_items drop column if exists project_id;
alter table permissions drop column if exists project_id;
alter table pending_approvals drop column if exists project_id;
alter table prize_types drop column if exists project_id;
alter table prizes drop column if exists project_id;
alter table winners drop column if exists project_id;
alter table check_in_reports drop column if exists project_id;
alter table check_in_dates drop column if exists project_id;
alter table round_snapshots drop column if exists project_id;
alter table payments drop column if exists project_id;
alter table money_entries drop column if exists project_id;

-- ---------------------------------------------------------------------------
-- 4. the forty-one indexes as they were.
--
-- tickets_buyer_name_trgm is in this list although Stage 1 never touched it:
-- dropping the column does not affect a GIN index that does not mention it, so
-- the `if not exists` is what makes that statement a no-op rather than a lie.
-- ---------------------------------------------------------------------------
create index if not exists audit_log_at_idx on audit_log using btree (at DESC);
create index if not exists audit_log_request_idx on audit_log using btree (request_id) WHERE (request_id <> ''::text);
create index if not exists book_history_book_idx on book_history using btree (book_idx, at DESC);
create index if not exists books_agent_idx on books using btree (held_by_agent) WHERE (held_by_agent IS NOT NULL);
create index if not exists books_offered_to_idx on books using btree (offered_to_agent) WHERE (status = 'Offered'::text);
create index if not exists books_overdue_idx on books using btree (due_at) WHERE (status = 'Out'::text);
create index if not exists books_settled_by_agent_idx on books using btree (settled_by_agent) WHERE (settled_by_agent IS NOT NULL);
create index if not exists books_status_idx on books using btree (status);
create index if not exists check_in_dates_live_idx on check_in_dates using btree (round) WHERE (cleared_at IS NULL);
create index if not exists check_in_reports_live_idx on check_in_reports using btree (round, agent_id) WHERE (undone_at IS NULL);
create index if not exists check_in_round_idx on check_in_reports using btree (round);
create unique index if not exists money_entries_client_key_idx on money_entries using btree (client_key) WHERE (client_key IS NOT NULL);
create unique index if not exists money_entries_legacy_idx on money_entries using btree (legacy_id) WHERE (legacy_id IS NOT NULL);
create index if not exists money_entries_party_idx on money_entries using btree (party, at DESC);
create index if not exists money_entries_reference_idx on money_entries using btree (reference_kind, reference_id) WHERE (reference_kind IS NOT NULL);
create index if not exists payments_agent_idx on payments using btree (agent_id);
create unique index if not exists payments_client_key_idx on payments using btree (client_key) WHERE (client_key IS NOT NULL);
create index if not exists payments_request_idx on payments using btree (request_id) WHERE (request_id <> ''::text);
create index if not exists payments_settlement_book_idx on payments using btree (book_idx) WHERE (source = 'settlement'::text);
create index if not exists pending_approvals_decide_by_idx on pending_approvals using btree (decide_by_agent) WHERE (status = 'Pending'::text);
create index if not exists pending_status_idx on pending_approvals using btree (status, requested_at DESC);
create index if not exists prizes_live_idx on prizes using btree (rank) WHERE (removed_at IS NULL);
create index if not exists prizes_rank_idx on prizes using btree (rank);
create index if not exists round_snapshots_round_idx on round_snapshots using btree (round);
create index if not exists ticket_codes_batch_idx on ticket_codes using btree (batch_id);
create index if not exists ticket_history_book_idx on ticket_history using btree (book_idx, at);
create index if not exists ticket_history_ticket_idx on ticket_history using btree (ticket_idx, at);
create index if not exists ticket_movements_batch_idx on ticket_movements using btree (batch_id);
create unique index if not exists ticket_movements_client_key_idx on ticket_movements using btree (client_key) WHERE (client_key IS NOT NULL);
create index if not exists ticket_movements_holder_idx on ticket_movements using btree (to_holder, id DESC);
create index if not exists ticket_movements_ticket_idx on ticket_movements using btree (ticket_idx, id);
create index if not exists ticket_receipt_items_ticket on ticket_receipt_items using btree (ticket_idx);
create unique index if not exists ticket_receipts_one_per_buyer on ticket_receipts using btree (buyer_phone, buyer_key(buyer_name)) WHERE (buyer_phone <> ''::text);
create index if not exists tickets_agent_idx on tickets using btree (sold_by_agent) WHERE (sold_by_agent IS NOT NULL);
create index if not exists tickets_book_idx on tickets using btree (book_idx);
create index if not exists tickets_buyer_name_trgm on tickets using gin (buyer_name gin_trgm_ops);
create index if not exists tickets_buyer_phone_idx on tickets using btree (buyer_phone) WHERE (buyer_phone <> ''::text);
create index if not exists tickets_holder_idx on tickets using btree (holder) WHERE (holder <> 'desk'::text);
create index if not exists tickets_missing_contact_idx on tickets using btree (status) WHERE ((status = ANY (ARRAY['Sold'::text, 'Donated'::text])) AND (buyer_phone = ''::text));
create index if not exists tickets_modified_at_idx on tickets using btree (modified_at DESC);
create unique index if not exists winners_one_per_seat on winners using btree (prize_id, seq) WHERE (prize_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. say the unfinished half out loud, because a rollback that looks finished
--    and has left the read path missing is worse than one that failed.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tickets_readable') is null then
    raise notice '%', 'Stage 1 is out. tickets_readable is NOT back — run: psql "$SUPABASE_DB_URL" -f supabase/rls.sql';
  end if;
end $$;
