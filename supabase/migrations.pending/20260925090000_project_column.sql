/*
 * MULTI-TENANCY STAGE 1: THE COLUMN.
 *
 * Adds `project_id` to the twenty-three raffle tables, puts it in front of
 * every index on them, and creates the composite unique keys that Stage 4 will
 * swap in — beside the existing keys, dropping nothing.
 *
 * THIS CHANGES NO ANSWER. Every row already here belongs to the raffle that
 * predates projects, so every row gets seed_project(), and with one project a
 * predicate on project_id selects everything. The default reads the request
 * header through current_project() and falls back to the seed, so a write that
 * names no project still lands where it always did. Stage 4 removes that
 * fallback, and only then does a write with no project become a refusal.
 *
 * WHAT IT DOES CHANGE is the shape of a row: twenty-six `select('*')` calls in
 * the Edge Function will start returning one more field. Nothing reads it and
 * nothing is deployed by this file — Stage 1 is a migration only — but the
 * report diff (`supabase/tenancy-diff.sh`) masks `project_id` for exactly this
 * reason, so "no row moved" stays a statement about the data and not about the
 * column list.
 *
 * NOT APPLIED ANYWHERE. This sits in migrations.pending/ until the owner says
 * "apply Stage 1" (decision D-003, answered A). Its rollback is
 * supabase/rollback-project-column.sql — beside the backfills, not in this
 * directory, because everything in here is applied to a clean build by
 * test-functions.sh and a rollback applied straight after its own migration
 * reports as a broken migration.
 *
 * ONE INDEX IS DELIBERATELY LEFT ALONE: tickets_buyer_name_trgm, the GIN
 * trigram index behind buyer-name search. A scalar cannot lead a GIN index
 * without the btree_gin extension, and adding an extension to reach a
 * performance property that only matters once a second project exists is a
 * bigger promise than this stage should make. Correctness never depended on
 * it: an index picks rows faster, the predicate decides which rows are
 * allowed. Recorded as D-014, to settle in Stage 4 where the keys move anyway.
 *
 * ONE COSMETIC DIFFERENCE, stated so nobody spends an afternoon on it. A
 * database migrated by this file gets project_id as the LAST column; a fresh
 * install from schema.sql gets it straight after the create table, so in
 * audit_log, book_history, check_in_reports, payments and ticket_history it
 * sits a few positions earlier. Measured: the two builds agree on all 403
 * columns, 89 indexes and 103 constraints, and differ only in that ordinal.
 * Nothing here can see it — there is not one positional `insert ... values` in
 * the repository, and backup.sh names its columns on both sides precisely
 * because a restore always puts an older backup into a newer database.
 *
 * WHICH IS ALSO THE ANSWER for a backup taken before this migration: restored
 * into a database that has it, every row omits project_id and takes the
 * default, so the whole backup lands in the seed project. Checked, not assumed.
 */

-- ---------------------------------------------------------------------------
-- Refuse to run before Stage 0, with a sentence rather than a missing-function
-- error forty statements in. db push applies a batch and stops at the first
-- refusal, so where it stops is where somebody has to work out what landed.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.seed_project()') is null
     or to_regprocedure('public.current_project()') is null then
    raise exception 'Stage 1 needs Stage 0 first: seed_project() and current_project() do not exist yet.';
  end if;
  if not exists (select 1 from projects where project_id = seed_project()) then
    raise exception 'Stage 1 needs the seed project row. The Stage 0 migration calls seed_tenancy(); this database has not.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. THE COLUMN, on all twenty-three raffle tables.
--
-- ONE STATEMENT EACH, AND NOT AN UPDATE. This was written as four statements
-- with a visible `update ... set project_id = seed_project()` backfill, on the
-- reasoning that a reader should not have to know how Postgres fills a new
-- column. Running it said otherwise, twice:
--
--   1. ticket_history refuses UPDATE outright — it is append-only and a
--      trigger says so. The migration stopped there, at statement 115.
--   2. On tickets it did not stop. It fired the row trigger, bumped `version`
--      on every row and set `modified_at` to the migration's clock — so
--      read_delta would have handed every client every ticket again, and
--      every version number a client was holding would have been stale. The
--      T9 dump caught it: fifty rows moving in a migration whose entire
--      promise is that nothing moves.
--
-- `add column ... not null default <non-volatile>` does neither. Postgres
-- evaluates the expression ONCE, stores it as the column's missing value and
-- rewrites no row, so no trigger fires and no version moves; the rows already
-- here read back seed_project(), because that is what the expression gives
-- when no request header is present. Future inserts evaluate it per row, which
-- is how a write that names a project lands in that project.
-- ---------------------------------------------------------------------------
alter table config add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_templates add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table agents add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table app_users add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table books add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table tickets add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table audit_log add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table book_history add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_history add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_movements add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_codes add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_receipts add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table ticket_receipt_items add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table permissions add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table pending_approvals add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table prize_types add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table prizes add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table winners add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table check_in_reports add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table check_in_dates add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table round_snapshots add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table payments add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());

alter table money_entries add column if not exists project_id uuid not null default coalesce(current_project(), seed_project());
-- ---------------------------------------------------------------------------
-- 2. EVERY INDEX ON THOSE TABLES, RECREATED WITH project_id LEADING.
--
-- Same names, same partial predicates, same expressions — only the leading
-- column is new, so nothing else has to learn a new name. The unique ones
-- among these become unique PER PROJECT, which with one project is the same
-- set of rows they refused before: uniqueness of (p, k) over rows that all
-- share one p is uniqueness of (k). That includes the three client_key
-- indexes idempotency rests on, one_per_buyer, and winners_one_per_seat.
--
-- The primary keys and the three unique CONSTRAINTS (books.number,
-- tickets.number, ticket_codes.code) are not touched here. Stage 4 swaps
-- those, and ticket_codes.code stays globally unique forever — a printed code
-- outlives the project it was printed for.
-- ---------------------------------------------------------------------------
drop index if exists audit_log_at_idx;
create index if not exists audit_log_at_idx on audit_log using btree (project_id, at DESC);
drop index if exists audit_log_request_idx;
create index if not exists audit_log_request_idx on audit_log using btree (project_id, request_id) WHERE (request_id <> ''::text);
drop index if exists book_history_book_idx;
create index if not exists book_history_book_idx on book_history using btree (project_id, book_idx, at DESC);
drop index if exists books_agent_idx;
create index if not exists books_agent_idx on books using btree (project_id, held_by_agent) WHERE (held_by_agent IS NOT NULL);
drop index if exists books_offered_to_idx;
create index if not exists books_offered_to_idx on books using btree (project_id, offered_to_agent) WHERE (status = 'Offered'::text);
drop index if exists books_overdue_idx;
create index if not exists books_overdue_idx on books using btree (project_id, due_at) WHERE (status = 'Out'::text);
drop index if exists books_settled_by_agent_idx;
create index if not exists books_settled_by_agent_idx on books using btree (project_id, settled_by_agent) WHERE (settled_by_agent IS NOT NULL);
drop index if exists books_status_idx;
create index if not exists books_status_idx on books using btree (project_id, status);
drop index if exists check_in_dates_live_idx;
create index if not exists check_in_dates_live_idx on check_in_dates using btree (project_id, round) WHERE (cleared_at IS NULL);
drop index if exists check_in_reports_live_idx;
create index if not exists check_in_reports_live_idx on check_in_reports using btree (project_id, round, agent_id) WHERE (undone_at IS NULL);
drop index if exists check_in_round_idx;
create index if not exists check_in_round_idx on check_in_reports using btree (project_id, round);
drop index if exists money_entries_client_key_idx;
create unique index if not exists money_entries_client_key_idx on money_entries using btree (project_id, client_key) WHERE (client_key IS NOT NULL);
drop index if exists money_entries_legacy_idx;
create unique index if not exists money_entries_legacy_idx on money_entries using btree (project_id, legacy_id) WHERE (legacy_id IS NOT NULL);
drop index if exists money_entries_party_idx;
create index if not exists money_entries_party_idx on money_entries using btree (project_id, party, at DESC);
drop index if exists money_entries_reference_idx;
create index if not exists money_entries_reference_idx on money_entries using btree (project_id, reference_kind, reference_id) WHERE (reference_kind IS NOT NULL);
drop index if exists payments_agent_idx;
create index if not exists payments_agent_idx on payments using btree (project_id, agent_id);
drop index if exists payments_client_key_idx;
create unique index if not exists payments_client_key_idx on payments using btree (project_id, client_key) WHERE (client_key IS NOT NULL);
drop index if exists payments_request_idx;
create index if not exists payments_request_idx on payments using btree (project_id, request_id) WHERE (request_id <> ''::text);
drop index if exists payments_settlement_book_idx;
create index if not exists payments_settlement_book_idx on payments using btree (project_id, book_idx) WHERE (source = 'settlement'::text);
drop index if exists pending_approvals_decide_by_idx;
create index if not exists pending_approvals_decide_by_idx on pending_approvals using btree (project_id, decide_by_agent) WHERE (status = 'Pending'::text);
drop index if exists pending_status_idx;
create index if not exists pending_status_idx on pending_approvals using btree (project_id, status, requested_at DESC);
drop index if exists prizes_live_idx;
create index if not exists prizes_live_idx on prizes using btree (project_id, rank) WHERE (removed_at IS NULL);
drop index if exists prizes_rank_idx;
create index if not exists prizes_rank_idx on prizes using btree (project_id, rank);
drop index if exists round_snapshots_round_idx;
create index if not exists round_snapshots_round_idx on round_snapshots using btree (project_id, round);
drop index if exists ticket_codes_batch_idx;
create index if not exists ticket_codes_batch_idx on ticket_codes using btree (project_id, batch_id);
drop index if exists ticket_history_book_idx;
create index if not exists ticket_history_book_idx on ticket_history using btree (project_id, book_idx, at);
drop index if exists ticket_history_ticket_idx;
create index if not exists ticket_history_ticket_idx on ticket_history using btree (project_id, ticket_idx, at);
drop index if exists ticket_movements_batch_idx;
create index if not exists ticket_movements_batch_idx on ticket_movements using btree (project_id, batch_id);
drop index if exists ticket_movements_client_key_idx;
create unique index if not exists ticket_movements_client_key_idx on ticket_movements using btree (project_id, client_key) WHERE (client_key IS NOT NULL);
drop index if exists ticket_movements_holder_idx;
create index if not exists ticket_movements_holder_idx on ticket_movements using btree (project_id, to_holder, id DESC);
drop index if exists ticket_movements_ticket_idx;
create index if not exists ticket_movements_ticket_idx on ticket_movements using btree (project_id, ticket_idx, id);
drop index if exists ticket_receipt_items_ticket;
create index if not exists ticket_receipt_items_ticket on ticket_receipt_items using btree (project_id, ticket_idx);
drop index if exists ticket_receipts_one_per_buyer;
create unique index if not exists ticket_receipts_one_per_buyer on ticket_receipts using btree (project_id, buyer_phone, buyer_key(buyer_name)) WHERE (buyer_phone <> ''::text);
drop index if exists tickets_agent_idx;
create index if not exists tickets_agent_idx on tickets using btree (project_id, sold_by_agent) WHERE (sold_by_agent IS NOT NULL);
drop index if exists tickets_book_idx;
create index if not exists tickets_book_idx on tickets using btree (project_id, book_idx);
drop index if exists tickets_buyer_phone_idx;
create index if not exists tickets_buyer_phone_idx on tickets using btree (project_id, buyer_phone) WHERE (buyer_phone <> ''::text);
drop index if exists tickets_holder_idx;
create index if not exists tickets_holder_idx on tickets using btree (project_id, holder) WHERE (holder <> 'desk'::text);
drop index if exists tickets_missing_contact_idx;
create index if not exists tickets_missing_contact_idx on tickets using btree (project_id, status) WHERE ((status = ANY (ARRAY['Sold'::text, 'Donated'::text])) AND (buyer_phone = ''::text));
drop index if exists tickets_modified_at_idx;
create index if not exists tickets_modified_at_idx on tickets using btree (project_id, modified_at DESC);
drop index if exists winners_one_per_seat;
create unique index if not exists winners_one_per_seat on winners using btree (project_id, prize_id, seq) WHERE (prize_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. THE COMPOSITE UNIQUE KEYS, BESIDE THE OLD ONES.
--
-- Nothing uses these today. They exist so that Stage 2's function deploy can
-- point its eleven `onConflict` strings at (project_id, <old key>) while the
-- old keys are still there — PostgREST needs a unique index matching the
-- conflict target, and a deploy cannot land between two migrations. Stage 4
-- then drops the old keys and these become the real ones.
--
-- project_id leads every one of them, because that is the column order the
-- onConflict strings will name. ticket_receipt_items is the exception the plan
-- writes deliberately: `code` first, because a receipt code is global.
-- ---------------------------------------------------------------------------
-- config: onConflict key → project_id,key (7 call sites)
create unique index if not exists config_project_key_uidx on config (project_id, key);

-- app_users: onConflict email → project_id,email
create unique index if not exists app_users_project_email_uidx on app_users (project_id, email);

-- permissions: onConflict action,role → project_id,action,role
create unique index if not exists permissions_project_action_role_uidx on permissions (project_id, action, role);

-- round_snapshots: onConflict round,agent_id
create unique index if not exists round_snapshots_project_round_agent_uidx on round_snapshots (project_id, round, agent_id);

-- check_in_dates: onConflict round
create unique index if not exists check_in_dates_project_round_uidx on check_in_dates (project_id, round);

-- check_in_reports: PK at Stage 4
create unique index if not exists check_in_reports_project_agent_round_uidx on check_in_reports (project_id, agent_id, round);

-- tickets: PK at Stage 4
create unique index if not exists tickets_project_idx_uidx on tickets (project_id, idx);

-- tickets: replaces the global unique at Stage 4
create unique index if not exists tickets_project_number_uidx on tickets (project_id, number);

-- books: PK at Stage 4
create unique index if not exists books_project_idx_uidx on books (project_id, idx);

-- books: replaces the global unique at Stage 4
create unique index if not exists books_project_number_uidx on books (project_id, number);

-- agents: PK at Stage 4
create unique index if not exists agents_project_agent_uidx on agents (project_id, agent_id);

-- winners: PK at Stage 4
create unique index if not exists winners_project_ticket_uidx on winners (project_id, ticket_idx);

-- ticket_codes: PK at Stage 4; code stays globally unique
create unique index if not exists ticket_codes_project_ticket_uidx on ticket_codes (project_id, ticket_idx);

-- ticket_receipt_items: PK at Stage 4, code first as the plan writes it
create unique index if not exists ticket_receipt_items_code_project_ticket_uidx on ticket_receipt_items (code, project_id, ticket_idx);
