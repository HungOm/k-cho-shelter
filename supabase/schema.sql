-- Raffled — Postgres schema
--
-- A candidate replacement for the Google Sheet, not a change to it. Nothing
-- here is live until the migration in this directory is run deliberately.
--
-- WHY THIS EXISTS, in one measurement: on the live Apps Script deployment,
-- read_version takes 1.1s warm and 9.1s cold — and it touches no spreadsheet
-- at all, just two Script Properties. That is the floor per request. Both
-- sessions have already taken the easy wins (cold boot from three full-table
-- reads to one, book writes from twenty-one calls to one), and the floor did
-- not move, because it is not our code.
--
-- THREE THINGS THIS BUYS, in order of how much they matter:
--
-- 1. The browser stops downloading the whole table. Today it must, because a
--    spreadsheet cannot be queried — so every boot pulls 20,000 rows to run a
--    search locally. Here, search is a query. That download disappears, and
--    with it most of what makes the app feel slow on a phone.
--
-- 2. The variance columns stop being spreadsheet formulas. They are a view,
--    so they cannot be typed over, cannot go stale, and cannot be dragged out
--    of alignment by somebody sorting a column.
--
-- 3. read_delta becomes an indexed range scan instead of walking every row.
--
-- WHAT IT COSTS: the Sheet stops being the live record. That is a real loss —
-- the README makes a point of a volunteer being able to open it and look. The
-- mitigation is in MIGRATION.md: keep exporting to a Sheet for reading, on a
-- schedule, so the human-readable copy survives without being the thing the
-- app depends on.

-- ============ IDENTITY ============
-- Ticket and book numbers are arithmetic: ticket N sits at index N, and its
-- printed number is derived from prefix/start/padding. That property is what
-- makes the whole system fast and what makes renumbering catastrophic, so the
-- index is the primary key and the printed number is a unique column beside
-- it. Both are stored: the index for arithmetic and ordering, the number
-- because it is what is on the paper in somebody's hand.

create table if not exists config (
  key          text primary key,
  value        text not null default '',
  notes        text not null default ''
);

create table if not exists agents (
  agent_id     text primary key,
  name         text not null,
  phone        text not null default '',
  zone         text not null default '',
  /*
   * A PLAIN BOOLEAN, AND IT BELONGS ON THIS TABLE RATHER THAN A LIFECYCLE.
   *
   * The four-state lifecycle lives on app_users below, where it decides who may
   * SIGN IN. An agent is not an account: they carry paper books, they have no
   * login, and most never open the app. "Waiting to be let in" and "banned"
   * describe access to a system this person does not use. What an organiser
   * actually needs is whether to offer them in the seller picker.
   *
   * IT WAS DECLARED THE OTHER WAY HERE AND THAT BROKE BOTH WRITE PATHS. The
   * lifecycle block, with `active` generated from `status`, sat on this table
   * while app_users had the plain boolean — the exact mirror of production, and
   * of what the handlers do. upsert_agent writes `active` literally on both the
   * insert and the update, and Postgres refuses any write to a generated
   * column, so against this file adding a seller failed with "cannot insert a
   * non-DEFAULT value into column active" and editing one with "column active
   * can only be updated to DEFAULT".
   *
   * It never showed, because this file has never been applied to the live
   * project — which is the only reason the raffle can add a seller at all. The
   * comment that stood here said "anything still reading `active` keeps
   * working", which was true, and silent about writing, which is what broke.
   */
  active       boolean not null default true,
  notes        text not null default ''
);

create table if not exists app_users (
  email        text primary key,
  name         text not null default '',
  -- 'superadmin' is assignable here and RESOLVES to admin plus the flag in the
  -- gate. It is not a permission tier: the permissions table below stays at
  -- four, because per-action overrides are granted to tiers, and offering a
  -- toggle against a resolution would imply a switch that does nothing.
  role         text not null default 'viewer'
                 check (role in ('admin','recorder','agent','viewer','superadmin')),
  /*
   * A LIFECYCLE, NOT A BOOLEAN — and this is the table it is really on.
   *
   * pending    added, not yet let in. Sees that, and nothing else.
   * active     approved and working.
   * suspended  temporarily stopped — a lost phone, a disputed account.
   * banned     stopped for good.
   *
   * The three that are not 'active' all deny equally. They are separate so the
   * person is told WHICH applies: "waiting to be let in" and "your access was
   * stopped" are different sentences to receive, and somebody told the wrong
   * one either waits for nothing or thinks they are in trouble. resolveUser in
   * gate.ts turns each into its own refusal.
   *
   * Every write path agrees: upsert_user and set_user_status both write
   * `status`, never `active`, which is what makes the generated column below
   * safe here and unsafe on agents.
   */
  status       text not null default 'active'
                 check (status in ('pending','active','suspended','banned')),
  -- Derived, so the two can never disagree. One source of truth for whether
  -- somebody is let in; app_role() in rls.sql reads `active` and keeps working.
  active       boolean generated always as (status = 'active') stored,
  agent_id     text references agents(agent_id) on delete set null,
  google_sub   text not null default '',
  added_by     text not null default '',
  added_at     timestamptz not null default now()
);

create table if not exists books (
  idx            integer primary key,
  number         text not null unique,
  first_ticket   text not null,
  last_ticket    text not null,
  status         text not null default 'Unassigned'
                   check (status in ('Unassigned','Offered','Out','Returned','Settled','Lost','Void')),
  held_by_agent  text references agents(agent_id) on delete set null,
  /*
   * OFFERED IS NOT HELD, AND THE DIFFERENCE IS WHOSE MONEY IT IS.
   *
   * An organiser offering books to a seller reserves them and moves nothing.
   * held_by_agent stays null, so book_ledger, agent_money and the chase list
   * are all already correct without knowing this feature exists — which is why
   * the reservation is its own column rather than held_by_agent with a flag
   * beside it. A flag has to be remembered by every reader; a null cannot be
   * forgotten.
   *
   * The seller accepts and the book becomes theirs. Nobody answers and it
   * expires back onto the shelf. Either way nobody is charged for stock they
   * never agreed to take.
   */
  offered_to_agent text references agents(agent_id) on delete set null,
  offered_at     timestamptz,
  offered_by     text not null default '',
  issued_at      timestamptz,
  -- A DATE, not an instant. A due date is a whole local day: stored as a
  -- timestamp it comes back as the previous calendar day anywhere west of here,
  -- and days_overdue computed from now() made a book due today overdue from
  -- 8am. Neither is defensible to a seller being chased for a book that is not
  -- late. issued_at and settled_at stay timestamptz — those really are instants.
  due_at         date,
  declared_sold  integer,
  amount_due     numeric(12,2),
  amount_paid    numeric(12,2),
  settled_at     timestamptz,
  settled_by     text not null default '',
  -- settled_by is the EMAIL of whoever typed the settlement. This is the
  -- SELLER the declared money belongs to, which is a different question: the
  -- organiser settles most books and none of that money is theirs. Frozen at
  -- settle time so that changing who holds the paper afterwards cannot move
  -- money that has already been accounted for.
  settled_by_agent text,
  notes          text not null default '',
  version        integer not null default 1,
  modified_by    text not null default '',
  modified_at    timestamptz not null default now(),
  -- The money invariant as a constraint rather than as a habit: an offered book
  -- is on nobody's balance. Named so the failure says what was violated.
  constraint books_offered_is_on_nobodys_balance
    check (status <> 'Offered' or held_by_agent is null)
);

create table if not exists tickets (
  idx            integer primary key,
  number         text not null unique,
  book_idx       integer not null references books(idx) on delete restrict,
  status         text not null default 'Available'
                   check (status in ('Available','Reserved','Sold','Donated','Void')),
  buyer_name     text not null default '',
  buyer_phone    text not null default '',
  buyer_zone     text not null default '',
  sold_by_agent  text references agents(agent_id) on delete set null,
  amount         numeric(12,2),
  payment_status text not null default '',
  sold_at        timestamptz,
  notes          text not null default '',
  source         text not null default '',
  version        integer not null default 1,
  recorded_by    text not null default '',
  modified_at    timestamptz not null default now(),
  /*
   * WHERE THE TICKET IS, projected from ticket_movements and maintained in the
   * same transaction as the movement that moves it. 'desk' is a real place
   * rather than a null, so no query over this column is an "everything except
   * X" condition — the shape AUDIT.md §X names after three defects in one day.
   *
   * Nothing reads or writes it yet: 20260918100000 adds the ledger empty, and
   * supabase/backfill-custody.sql, which nothing runs, is what makes this column
   * true of a raffle that has already issued books.
   */
  holder         text not null default 'desk'
);
create index if not exists tickets_holder_idx on tickets (holder) where holder <> 'desk';

-- ============ INDEXES ============
-- Chosen from the queries the app actually makes, not by guesswork.

-- read_delta: "what changed since T". Today this walks every row; here it is a
-- range scan.
create index if not exists tickets_modified_at_idx on tickets (modified_at desc);

-- Every book summary groups by book.
create index if not exists tickets_book_idx on tickets (book_idx);

-- Draw readiness asks for sold tickets with no phone number — the report that
-- decides whether a winner can be telephoned.
create index if not exists tickets_missing_contact_idx on tickets (status)
  where status in ('Sold','Donated') and buyer_phone = '';

-- A seller's statement, and "who still owes money".
create index if not exists books_settled_by_agent_idx
  on books (settled_by_agent) where settled_by_agent is not null;
create index if not exists tickets_agent_idx on tickets (sold_by_agent)
  where sold_by_agent is not null;

-- Search by buyer. trigram, because the names in this raffle are transliterated
-- and inconsistently spelled — Thang and Thuang are the same person — so exact
-- and prefix matching both miss. This is the index that lets search move off
-- the client.
create extension if not exists pg_trgm;
create index if not exists tickets_buyer_name_trgm on tickets using gin (buyer_name gin_trgm_ops);
create index if not exists tickets_buyer_phone_idx on tickets (buyer_phone)
  where buyer_phone <> '';

create index if not exists books_status_idx on books (status);
create index if not exists books_agent_idx on books (held_by_agent)
  where held_by_agent is not null;
create index if not exists books_overdue_idx on books (due_at)
  where status = 'Out';

-- ============ THE COMPUTED COLUMNS, AS A VIEW ============
-- In the Sheet these four are ARRAYFORMULA columns the server is forbidden to
-- write, and a note in the docs asks people not to type over them. Here they
-- cannot be typed over at all.
--
-- The one-source rule is preserved exactly as Reports.gs states it: a Settled
-- or Lost book reports the DECLARED figures, because the money that actually
-- arrived is the truth once a book is closed. Every other book reports what the
-- ticket rows say. The two are never mixed.

create or replace view book_ledger as
select
  b.idx,
  b.number,
  b.status,
  b.held_by_agent,
  a.name  as agent_name,
  b.due_at,
  b.declared_sold,
  b.amount_due,
  b.amount_paid,
  r.recorded_sold,
  r.recorded_amount,
  r.available,
  r.reserved,
  r.missing_contact,
  -- DECLARED FIGURES ONLY WHEN SOMEBODY DECLARED THEM. A book marked Lost
  -- from the Books screen never had a settlement, so declared_sold is null;
  -- reading that as "declared nought" made every sale recorded on it worth
  -- nothing in the money reports, and the seller's debt left the chase list.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then b.declared_sold
       else r.recorded_sold end                      as counted_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then coalesce(b.amount_due, 0)
       else r.recorded_amount end                    as counted_expected,
  -- Sold by the seller's count, but with no ticket number written down. Money
  -- the raffle expects and entries the draw cannot include — so it is a
  -- number the readiness check has to see.
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(b.declared_sold - r.recorded_sold, 0) else 0 end as unidentified_sold,
  case when b.status in ('Settled','Lost') and b.declared_sold is not null
       then greatest(coalesce(b.amount_due, 0) - r.recorded_amount, 0) else 0 end as unidentified_amount,
  coalesce(b.amount_paid, 0)                         as counted_collected,
  -- NOUGHT UNTIL SOMEBODY HAS COUNTED THE BOOK IN. A null declared_sold means
  -- "not counted yet", and coalescing it to nought read that as "the seller
  -- says nothing was sold" — so every unsettled book with sales in it carried
  -- a variance of minus its own takings. Seven books in production did, and the
  -- book sheet drew each one as a red discrepancy. Same guard as counted_sold
  -- three lines up, for the same reason.
  case when b.declared_sold is not null
       then b.declared_sold - r.recorded_sold
       else 0::bigint end                            as variance_sold,
  case when b.declared_sold is not null
       then coalesce(b.amount_due, 0) - r.recorded_amount
       else 0::numeric end                           as variance_amount,
  -- Whole days between calendar days, now that due_at is a date.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int
       else 0 end                                    as days_overdue,
  -- WHO TOOK THE MONEY. settle_book has written settled_by since it existed and
  -- nothing read it back, so "Handed in RM100" named an amount and no
  -- counterparty — on the one screen where somebody is checking a figure
  -- against the person who wrote it. Appended at the END of the column list,
  -- which is what create or replace view will accept.
  b.settled_by, b.settled_at
from books b
left join agents a on a.agent_id = b.held_by_agent
left join lateral (
  select
    count(*) filter (where t.status in ('Sold','Donated'))                   as recorded_sold,
    coalesce(sum(t.amount) filter (where t.status in ('Sold','Donated')), 0) as recorded_amount,
    count(*) filter (where t.status = 'Available')                           as available,
    count(*) filter (where t.status = 'Reserved')                            as reserved,
    count(*) filter (where t.status in ('Sold','Donated') and t.buyer_phone = '') as missing_contact
  from tickets t where t.book_idx = b.idx
) r on true;

-- ============ AUDIT AND HISTORY ============

create table if not exists audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  action       text not null,
  details      jsonb,
  email        text not null default ''
);
create index if not exists audit_log_at_idx on audit_log (at desc);

/*
 * APPEND ONLY, like the other four. This is where every override, forced
 * settlement, permission change and write-off is recorded — the one record an
 * administrator would reach for if they wanted something they did to stop
 * having happened, and the only one of the five that had no trigger.
 */
create or replace function audit_log_append_only() returns trigger as $$
begin
  raise exception 'audit_log is append only — % is not allowed on it', tg_op
    using hint = 'A correction is another row saying what was corrected, not an edit to this one.';
end $$ language plpgsql;

drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_append_only();

drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate before truncate on audit_log
  execute function audit_log_append_only();

create table if not exists book_history (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  -- RESTRICT, not cascade. A cascade lets a book take the record of its own
  -- movements with it, which is the one moment that record matters most. The
  -- reset script deletes book_history before books, in that order and on
  -- purpose, so the only deletion this raffle actually performs still works.
  book_idx     integer not null references books(idx) on delete restrict,
  from_agent   text,
  to_agent     text,
  action       text not null,
  by_user      text not null default '',
  note         text not null default ''
);
create index if not exists book_history_book_idx on book_history (book_idx, at desc);

-- APPEND ONLY, like the other three. payments, ticket_history and
-- round_snapshots each refuse an update, a delete and a truncate at the
-- database; book_history was the one history table defended by nothing but the
-- absence of a handler that changes it.
--
-- It is the table that answers "who had this book, and who did they give it
-- to" — the custody trail. A trail that can be quietly rewritten answers that
-- question no better than having no trail, and the Edge Function holds the
-- secret key, so every grant and policy here is irrelevant to the one caller
-- that can reach it. A trigger is not.
--
-- A MOVEMENT IS UNDONE BY MOVING IT BACK, which appends. Handing a book to the
-- wrong seller is corrected by taking it back and issuing it again: both acts
-- stay in the trail, and that is the record anybody arguing about a book needs.
create or replace function book_history_append_only() returns trigger as $$
begin
  raise exception 'book_history is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Move the book instead: the correcting move is appended, and what happened before stays readable.';
end $$ language plpgsql;

drop trigger if exists book_history_no_change on book_history;
create trigger book_history_no_change before update or delete on book_history
  for each row execute function book_history_append_only();

-- Truncate is neither an update nor a delete and would empty the table without
-- firing either. Statement-level, because that is the only level it has.
drop trigger if exists book_history_no_truncate on book_history;
create trigger book_history_no_truncate before truncate on book_history
  for each statement execute function book_history_append_only();

-- ============ TICKET HISTORY (begin) ============
-- A ticket row keeps only its LATEST state. A correction, a settlement or a
-- restock overwrites the buyer, the seller and the status, and until now the
-- only trace was a version number going up. "Who was on KS-00413 before it was
-- corrected" and "who was credited with this sale in March" had no answer.
--
-- Written by a trigger rather than by the handlers, so no code path can forget
-- it — the same reason the contact rule is a constraint. Server-only, like
-- audit_log: it holds the names and numbers that were overwritten.
create table if not exists ticket_history (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  ticket_idx    integer not null references tickets(idx) on delete restrict,
  book_idx      integer not null,
  from_status   text not null default '',
  to_status     text not null default '',
  from_agent    text,
  to_agent      text,
  from_buyer    text not null default '',
  to_buyer      text not null default '',
  from_phone    text not null default '',
  to_phone      text not null default '',
  from_amount   numeric(12,2),
  to_amount     numeric(12,2),
  from_payment  text not null default '',
  to_payment    text not null default '',
  source        text not null default '',
  by_user       text not null default '',
  note          text not null default ''
);
create index if not exists ticket_history_ticket_idx on ticket_history (ticket_idx, at);


/*
 * WHERE EVERY TICKET HAS BEEN — the custody ledger, as rows rather than as a
 * column. ARCHITECTURE-REVIEW.md §15, added empty by 20260918100000.
 *
 * Custody today is books.held_by_agent: one column, overwritten. Where a ticket
 * has been is recorded nowhere, because a book has always moved whole — which
 * is true, is why the backfill is exact, and stops being true the moment
 * somebody hands back six of ten. This repository has paid four times for a
 * figure stored against custody rather than derived from what happened.
 *
 * NOTHING READS OR WRITES IT YET. That is the point of shipping it first.
 */
create table if not exists ticket_movements (
  id          bigint generated always as identity primary key,
  -- Settable, not just defaulted: the backfill writes historic rows and a
  -- ledger whose `at` is all one afternoon cannot be replayed in order.
  at          timestamptz not null default now(),
  ticket_idx  integer not null references tickets(idx),
  -- 'desk' rather than null, for the reason given on tickets.holder above. It
  -- is plain text rather than a reference to agents because the desk is not an
  -- agent, and because a movement that happened must stay readable after the
  -- seller who made it is deleted.
  from_holder text not null,
  to_holder   text not null,
  kind        text not null check (kind in
                ('issue','return','transfer','restock','lost','found','correction')),
  -- One batch per user action: a whole book of ten is ten rows and one
  -- batch_id, so "what did that person do at 14:12" is a query and not a join
  -- on time.
  batch_id    uuid not null,
  by_user     text not null,
  reason      text not null default '',
  reverses    bigint references ticket_movements(id),
  client_key  text,
  -- Provenance, not a kind. §22 describes backfilled rows as kind='backfill',
  -- which cannot be right: the replay check in the same paragraph needs to know
  -- whether the row was an issue or a return, and 'backfill' has thrown that
  -- away. kind stays semantic; `reason` names the source row.
  backfilled  boolean not null default false,
  check (from_holder <> to_holder or kind = 'correction')
);
-- Partial, and it has to be: every NULL is distinct in Postgres, so a plain
-- unique column would be relying on that by accident. Two movements nobody gave
-- a key are two movements.
create unique index if not exists ticket_movements_client_key_idx
  on ticket_movements (client_key) where client_key is not null;
-- `id` rather than `at`: two rows in one batch share a timestamp and replay
-- order has to be total.
create index if not exists ticket_movements_ticket_idx
  on ticket_movements (ticket_idx, id);
create index if not exists ticket_movements_batch_idx on ticket_movements (batch_id);
create index if not exists ticket_movements_holder_idx on ticket_movements (to_holder, id desc);

-- Append only, all three ways. Truncate is the one people leave off: it is
-- neither an update nor a delete and would empty the ledger without firing
-- either of the other two.
create or replace function ticket_movements_append_only() returns trigger as $$
begin
  raise exception 'ticket_movements is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Write the opposite movement instead, with reverses pointing at the row it undoes.';
end $$ language plpgsql;

drop trigger if exists ticket_movements_no_change on ticket_movements;
create trigger ticket_movements_no_change before update or delete on ticket_movements
  for each row execute function ticket_movements_append_only();

drop trigger if exists ticket_movements_no_truncate on ticket_movements;
create trigger ticket_movements_no_truncate before truncate on ticket_movements
  for each statement execute function ticket_movements_append_only();

alter table ticket_movements enable row level security;
revoke all on ticket_movements from anon, authenticated;
create index if not exists ticket_history_book_idx on ticket_history (book_idx, at);

create or replace function record_ticket_history() returns trigger as $$
begin
  -- Only the facts that matter to money or the draw. A modified_at bump or a
  -- zone edit is not a movement.
  if (old.status, old.buyer_name, old.buyer_phone, old.sold_by_agent,
      old.amount, old.payment_status, old.notes)
     is distinct from
     (new.status, new.buyer_name, new.buyer_phone, new.sold_by_agent,
      new.amount, new.payment_status, new.notes) then
    insert into ticket_history (
      ticket_idx, book_idx, from_status, to_status, from_agent, to_agent,
      from_buyer, to_buyer, from_phone, to_phone, from_amount, to_amount,
      from_payment, to_payment, source, by_user, note)
    values (
      new.idx, new.book_idx, old.status, new.status, old.sold_by_agent, new.sold_by_agent,
      old.buyer_name, new.buyer_name, old.buyer_phone, new.buyer_phone, old.amount, new.amount,
      old.payment_status, new.payment_status, new.source, new.recorded_by,
      case when new.notes is distinct from old.notes then new.notes else '' end);
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists tickets_record_history on tickets;
create trigger tickets_record_history after update on tickets
  for each row execute function record_ticket_history();

-- APPEND ONLY, AND ENFORCED RATHER THAN INTENDED.
--
-- "Append only" was true of this table the way most things are true of a table
-- nobody has written the code to change yet: no handler updates it, no handler
-- deletes from it, and that held until somebody wrote the one that did. The
-- trail is the only place an overwritten buyer, seller or amount still exists.
-- Everything else about it is defended by the database — the trigger that fills
-- it so no code path can forget, the FK that refuses to let a ticket be deleted
-- out from under its own record — and its immutability was defended by nothing
-- but the absence of a line of code.
--
-- So the same bar as the rest: a rule that does not care who is asking. The
-- Edge Function holds the secret key and bypasses row security, which makes
-- every grant and policy on this table irrelevant to the one caller that can
-- actually reach it. A trigger is not irrelevant to it.
--
-- A CORRECTION IS NOT AN EDIT. Getting a name wrong in the trail is fixed by
-- correcting the ticket, which appends the correction — the wrong name stays
-- visible with the right one after it, which is the whole point of keeping a
-- record rather than a current value.
create or replace function ticket_history_append_only() returns trigger as $$
begin
  raise exception 'ticket_history is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Correct the ticket instead: the correction is appended to its record, and what was there before stays readable.';
end $$ language plpgsql;

drop trigger if exists ticket_history_no_change on ticket_history;
create trigger ticket_history_no_change before update or delete on ticket_history
  for each row execute function ticket_history_append_only();

-- Truncate is not an update or a delete and would empty the table without
-- firing either. Statement-level, because that is the only level it has.
drop trigger if exists ticket_history_no_truncate on ticket_history;
create trigger ticket_history_no_truncate before truncate on ticket_history
  for each statement execute function ticket_history_append_only();
-- ============ TICKET HISTORY (end) ============

-- ============ ACCESS CONTROL ============
-- The same shape as the Permissions tab: the registry default stands unless a
-- row here overrides it, and a null means "no opinion" rather than "no".

create table if not exists permissions (
  action       text not null,
  role         text not null check (role in ('admin','recorder','agent','viewer')),
  allowed      boolean not null,
  primary key (action, role)
);

create table if not exists pending_approvals (
  request_id   text primary key,
  action       text not null,
  payload      jsonb not null,
  summary      text not null,
  detail       jsonb,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'Pending'
                 check (status in ('Pending','Approved','Rejected','Expired','Cancelled')),
  decided_by   text,
  decided_at   timestamptz,
  note         text not null default '',
  -- WHO HAS TO ANSWER, when it is not an organiser. Null on every two-person
  -- control and every petition, which are answered by an organiser or the
  -- system admin as they always were. Set only on an offer of books, where the
  -- person who must decide is the SELLER the books are being offered to.
  -- Not a foreign key: a decided row is history, and history has to survive
  -- the seller being deleted.
  decide_by_agent text
);
create index if not exists pending_status_idx on pending_approvals (status, requested_at desc);

create index if not exists books_offered_to_idx
  on books (offered_to_agent) where status = 'Offered';
create index if not exists pending_approvals_decide_by_idx
  on pending_approvals (decide_by_agent) where status = 'Pending';

-- ============ THE PRIZE SCHEDULE ============
--
-- What is on offer, how many of each, and what it is worth. Three tables where
-- there was one text column, and the reason is that `winners.prize` was free
-- text: "First prize", "1st Prize" and "Grand prize" were three different
-- prizes as far as anything downstream could tell, nothing counted how many of
-- a prize had been given, and nothing stopped the Grand Prize being awarded
-- twice. A raffle that awards one car to two people has no good next move.

create table if not exists prize_types (
  /*
   * WHAT KIND OF THING A PRIZE IS — and an OPEN set, deliberately.
   *
   * The obvious shape is `check (kind in ('cash','goods','voucher'))`. This
   * repository has been bitten three times in one day by conditions written as
   * "everything except X" (supabase/AUDIT.md §X), and a closed enum is the same
   * mistake wearing a constraint: the day an organiser has an experience day or
   * a livestock prize to put up, the fix is a migration. Nobody running a
   * raffle on a Saturday morning can write a migration. So the TYPES are rows,
   * an organiser adds one, and the set that may pass is named by what is in the
   * table rather than by what somebody thought of in advance.
   *
   * WHAT IS CLOSED IS `valuing`, and that is not the same thing. It says how
   * the system READS value_amount, and the system can only read it the ways it
   * has code for. A fourth rule needs a fourth branch in the code either way,
   * so pretending it is configurable would be a lie told in a table.
   *
   *   fixed    value_amount is an amount of money — a car, a hamper, a voucher
   *   percent  value_amount is a percentage of money collected. This is the
   *            split-the-pot draw, where the prize is not known until the
   *            selling stops, and a fixed figure printed on a ticket would be
   *            a promise the raffle cannot keep.
   *   none     nothing to declare. A donated service with no agreed value is
   *            not worth zero — it is worth unstated, and zero would quietly
   *            join the totals as though somebody had valued it.
   */
  type_id      text primary key,
  label        text not null,
  valuing      text not null default 'fixed'
                 check (valuing in ('fixed','percent','none')),
  sort         integer not null default 0,
  active       boolean not null default true,
  /*
   * The four seeded below cannot be deleted, only deactivated. Not to protect
   * them — because a prize awarded last month names its type, and a type that
   * can vanish turns a settled record into a dangling reference. `on delete
   * restrict` on prizes.type_id says the same thing for the ones organisers add.
   */
  built_in     boolean not null default false,
  added_by     text not null default '',
  added_at     timestamptz not null default now()
);

insert into prize_types (type_id, label, valuing, sort, built_in) values
  ('cash',      'Cash',            'fixed',   10, true),
  ('goods',     'Donated goods',   'fixed',   20, true),
  ('voucher',   'Voucher',         'fixed',   30, true),
  ('pot_share', 'Share of takings','percent', 40, true)
on conflict (type_id) do nothing;

create table if not exists prizes (
  /*
   * ONE ROW PER PRIZE IN THE SCHEDULE, however many of it there are.
   *
   * Ten consolation prizes are one row with quantity 10, not ten rows. The
   * organiser configuring the draw is describing an offer — "ten hampers" —
   * and ten near-identical rows is that offer transcribed badly: renaming it
   * means ten edits, nine of which can be forgotten.
   *
   * TIER AND NAME ARE BOTH HERE and are different things. The tier is the
   * raffle term that gets read out — Grand Prize, Second Prize, Consolation —
   * and the name is the thing itself. "Grand Prize — Toyota Hilux" is the tier
   * and the name; either alone leaves the announcer guessing.
   */
  prize_id     text primary key,
  tier         text not null,
  name         text not null,
  description  text not null default '',
  type_id      text not null references prize_types(type_id) on delete restrict,
  /*
   * Read according to the type's `valuing`. A prize typed `none` carries 0 here
   * and no screen may add it to a total — the handlers return null for it, and
   * null is not zero: zero would join a total as though somebody had valued the
   * thing at nothing, which is a different claim from having no figure.
   *
   * THE ARITHMETIC IS NOT ALSO IN SQL, deliberately. It was, as a `prize_value()`
   * function nothing called — a second definition of a rule, kept alive by
   * nobody, waiting to disagree with the two backends the day one of them
   * changed. Two ports already have to agree here; a third that no caller
   * exercises is not defence in depth, it is drift with a schema around it.
   */
  value_amount numeric(12,2) not null default 0 check (value_amount >= 0),
  quantity     integer not null default 1 check (quantity > 0),
  /*
   * ANNOUNCEMENT ORDER, 1 = the Grand Prize. This is the order the prize board
   * is read in, which is not the order the draw happens in: the convention is
   * to draw the consolation prizes first and the grand prize last, so the room
   * is still there for it. draw_order carries that when it differs; null means
   * "the reverse of rank", which is the convention rather than a guess.
   */
  rank         integer not null default 1 check (rank > 0),
  draw_order   integer,
  donor        text not null default '',
  active       boolean not null default true,
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  /*
   * STRONGER THAN `active`, and they are not the same thing. active false is
   * "not on offer this raffle" and is reversible from the screen; removed_at is
   * taking it off the schedule. remove_prize's own refusal says so — "Turn it
   * off instead and it stays on the record" — and until this column existed
   * that sentence was advice the alternative did not honour. Re-creating the
   * same prize_id revives the row, so an id is never used up by a removal.
   */
  removed_at   timestamptz,
  removed_by   text
);
create index if not exists prizes_rank_idx on prizes (rank);

create table if not exists winners (
  /*
   * ONE ROW PER PRIZE ACTUALLY AWARDED.
   *
   * ONE TICKET, ONE PRIZE — which is what the primary key on ticket_idx has
   * always said and is the commonest rule in the room: the counterfoil comes
   * out of the drum and is set aside. It is stated here because it is now a
   * RULE rather than an accident of the table having had one row per ticket.
   *
   * THE PRIZE IS NAMED TWICE AND THAT IS THE POINT. prize_id is the live link
   * to the schedule; `prize` is the label FROZEN at the moment it was awarded,
   * beside the buyer's name and telephone number which were already frozen for
   * exactly this reason. An organiser who corrects "Toyata" to "Toyota" next
   * week has not changed what was read out on the night, and the record of the
   * night should not change either.
   */
  ticket_idx   integer primary key references tickets(idx) on delete restrict,
  prize        text not null default '',
  prize_id     text references prizes(prize_id) on delete restrict,
  /*
   * WHICH ONE OF THEM — "the 3rd of the 10 consolation prizes".
   *
   * THIS IS WHAT MAKES OVER-AWARDING IMPOSSIBLE, and it is structural rather
   * than a count the handler checks. Two organisers recording winners at the
   * same moment both read "7 given so far" and both write the 8th; a unique
   * index cannot be read at the wrong moment. One insert succeeds, the other
   * comes back a duplicate and the handler tries the next seat. The trigger
   * below refuses a seat that does not exist.
   */
  seq          integer,
  /* Frozen like the label: what the prize was worth on the night. */
  prize_value  numeric(12,2),
  drawn_at     timestamptz not null default now(),
  buyer_name   text not null default '',
  buyer_phone  text not null default '',
  notified     boolean not null default false,
  claimed      boolean not null default false,
  claimed_at   timestamptz,
  /*
   * UNCLAIMED AND OUT OF TIME. Not a third boolean bolted beside the other two
   * — a forfeited prize goes back in the schedule to be redrawn, and the row
   * has to say that happened rather than being deleted, or the audit of a draw
   * has a hole exactly where somebody would want to look.
   */
  forfeited_at timestamptz,
  notes        text not null default '',
  recorded_by  text not null default ''
);
alter table winners add column if not exists prize_id text references prizes(prize_id) on delete restrict;
alter table winners add column if not exists seq integer;
alter table winners add column if not exists prize_value numeric(12,2);
alter table winners add column if not exists forfeited_at timestamptz;

/*
 * The seat is taken once. Partial, because rows from before the schedule
 * existed have no prize_id and must not all collide on null.
 */
create unique index if not exists winners_one_per_seat
  on winners (prize_id, seq) where prize_id is not null;

/*
 * A seat that does not exist cannot be filled, and the quantity cannot be cut
 * out from under one that is.
 */
create or replace function winner_seat_exists() returns trigger
language plpgsql as $$
declare q integer;
begin
  if new.prize_id is null then return new; end if;
  select quantity into q from prizes where prize_id = new.prize_id;
  if q is null then
    raise exception 'No prize called % is set up.', new.prize_id;
  end if;
  if new.seq is null or new.seq < 1 or new.seq > q then
    raise exception 'There are % of the % to give, so there is no number %.',
      q, new.prize_id, coalesce(new.seq::text, 'none');
  end if;
  return new;
end $$;

drop trigger if exists winners_seat_exists on winners;
create trigger winners_seat_exists before insert or update on winners
  for each row execute function winner_seat_exists();

create or replace function prize_quantity_covers_awards() returns trigger
language plpgsql as $$
declare given integer;
begin
  select count(*) into given from winners
    where prize_id = new.prize_id and forfeited_at is null;
  if new.quantity < given then
    raise exception 'The % has been given % times already, so it cannot be cut to %.',
      new.tier, given, new.quantity;
  end if;
  -- A seat number cannot be left stranded above the new ceiling either.
  if exists (select 1 from winners
             where prize_id = new.prize_id and seq > new.quantity
               and forfeited_at is null) then
    raise exception 'Somebody holds a % above number %.', new.tier, new.quantity;
  end if;
  return new;
end $$;

drop trigger if exists prizes_quantity_covers_awards on prizes;
create trigger prizes_quantity_covers_awards before update of quantity on prizes
  for each row execute function prize_quantity_covers_awards();

create table if not exists check_in_reports (
  /*
   * ONE ROW PER SELLER PER ROUND: the recorded fact that somebody turned up and
   * said where they were.
   *
   * WHY A TABLE AND NOT A FLAG ON THE AGENT. A flag has one value, so the next
   * round has to clear it, and a reset that runs over every seller is a reset
   * that can go wrong halfway or be run twice. Rows cannot: the round number
   * moves, every seller is un-reported the same instant, and nothing was
   * written to make it happen.
   *
   * AND IT IS WHAT THE ROLL CANNOT LAUNDER. Moving the check-in date forward
   * forgives a late book on purpose — that is what a checkpoint is for. The
   * absent row for a round nobody answered stays absent for the rest of the
   * raffle, so "has missed three check-ins" survives a roll that makes every
   * book look current.
   *
   * ROUND, NOT DATE, as the key. The date moves; the round a report answered
   * does not. due_at keeps the date it was at the time, so the history still
   * reads as dates to a person looking at it later.
   */
  agent_id     text not null references agents(agent_id) on delete cascade,
  round        integer not null check (round >= 1),
  due_at       date not null,
  reported_at  timestamptz not null default now(),
  -- What actually came back. Nullable would mean "we do not know"; zero means
  -- they reported and brought nothing, which is a different and useful thing
  -- to be able to see.
  books_back   integer not null default 0 check (books_back >= 0),
  tickets_sold integer not null default 0 check (tickets_sold >= 0),
  amount_paid  numeric(12,2) not null default 0 check (amount_paid >= 0),
  note         text not null default '',
  recorded_by  text not null default '',
  /*
   * TAKEN BACK, not erased. Recording a check-in against the wrong seller
   * happens on a phone in a car park, and the undo has to put that person back
   * on the chase list — but "somebody said she reported, and somebody took it
   * back" is a fact about what people did, and the acknowledgement rule exists
   * because whose word a confirmation is matters. Every read carries
   * `undone_at is null`; re-recording the round revives the row rather than
   * colliding with the (agent_id, round) key.
   */
  undone_at    timestamptz,
  undone_by    text,
  primary key (agent_id, round)
);
-- "Who has answered this round" is the question asked on every seller list.
create index if not exists check_in_round_idx on check_in_reports (round);

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
  set_at   timestamptz not null default now(),
  -- Clearing a round's date withdraws what a dozen people were told to do.
  -- Who withdrew it is the part worth keeping. Reads carry `cleared_at is null`.
  cleared_at timestamptz,
  cleared_by text
);
-- ============ A ROUND'S DATE, WHERE SOMEBODY MOVED IT (end) ============

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

-- Who may read it is decided in rls.sql with every other table's grants, the
-- same place ticket_history's are: server-only, no select policy, revoked from
-- both browser roles.

create table if not exists payments (
  /*
   * EVERY CASH HANDOVER, whether or not a book is being closed.
   *
   * settle_book was the only way to record money, so a seller bringing half of
   * it — or keeping the book to sell the rest — could not be recorded at all.
   * This is the ledger that makes partial payment expressible.
   *
   * MONEY FOLLOWS CUSTODY. The debt is keyed on agent_id, not on whoever typed
   * the sale in: a helper at a desk records sales credited to the book's
   * holder, so a helper never owes anything, and "what I owe" stays answerable
   * for a seller and correctly empty for a helper carrying no books.
   */
  id           bigint generated always as identity primary key,
  agent_id     text not null references agents(agent_id) on delete restrict,
  -- Negative is a reversal. Never zero: a row that changes nothing is a row
  -- somebody has to interpret.
  amount       numeric(12,2) not null check (amount <> 0),
  received_at  timestamptz not null default now(),
  received_by  text not null default '',
  method       text not null default 'cash',
  note         text not null default '',
  -- Optional: cash handed over before anybody counts a book belongs to the
  -- seller, not yet to a book, and saying so is more honest than guessing.
  book_idx     integer references books(idx) on delete set null,
  -- A reversal points at what it undoes. Corrections are new rows, never
  -- deletes, so the trail survives the mistake.
  reverses     bigint references payments(id) on delete restrict,
  /*
   * WHAT KIND OF ROW THIS IS, and the third one is not money.
   *
   *   'hand'       cash somebody handed over
   *   'settlement' cash counted in when a book was closed
   *   'writeoff'   a debt the raffle has decided will not be collected
   *
   * A WRITE-OFF MUST NEVER READ AS COLLECTED. It is in this table because it
   * belongs to the same running total — what a seller still owes is expected,
   * less what came in, less what has been forgiven — and because every
   * correction to money here is a row with a reason rather than an edit. But
   * summing it with the cash would say the money arrived, which is the one
   * thing it did not do. Every caller that adds up payments therefore has to
   * say which kinds it means; collectedByAgent names the two that are cash.
   */
  source       text not null default 'hand' check (source in ('hand','settlement','writeoff'))
);
create index if not exists payments_agent_idx on payments (agent_id);
-- Settlement rows are read per book on every re-settle, to find what to reverse.
create index if not exists payments_settlement_book_idx
  on payments (book_idx) where source = 'settlement';

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


/*
 * EVERY MOVEMENT OF MONEY, IN ONE PLACE — the financial journal, generalising
 * payments. ARCHITECTURE-REVIEW.md §15, added empty by 20260918300000.
 *
 * FOUR THINGS payments CANNOT SAY, each of which has cost something:
 *   the DESK cannot hold money — payments.agent_id is `not null references
 *     agents`, which is why desk_money() reconstructs the office's takings from
 *     tickets and books instead of reading them;
 *   NOBODY AUTHORISED ANYTHING — two-person control sits in approvals, beside
 *     the money rather than on it;
 *   A RECEIPT CANNOT SAY WHAT IT WAS FOR — book_idx is the only reference, so a
 *     settlement, a sale and a batch all look alike;
 *   AND `source` ANSWERS TWO QUESTIONS AT ONCE. 'hand' and 'settlement' are both
 *     cash and differ in what they were for; 'writeoff' is not cash at all.
 *     payments' own comment above concedes the cost: every caller has to
 *     remember which kinds are money.
 *
 * NOTHING READS OR WRITES IT YET, and payments remains the table the raffle runs
 * on. Dual-write is §22 step 3, two phases away.
 */
create table if not exists money_entries (
  id          bigint generated always as identity primary key,
  -- Settable, not just defaulted: the backfill carries payments.received_at
  -- across, and a journal whose `at` is all one afternoon cannot be reconciled
  -- against a week's takings.
  at          timestamptz not null default now(),
  -- An agent_id, or 'desk'. Plain text and not a reference: the desk is not an
  -- agent, and an entry that happened must stay readable after the seller who
  -- made it is deleted.
  party       text not null,
  -- What happened to the money, and only that. What it was FOR is the
  -- reference below.
  kind        text not null check (kind in
                ('receipt','refund','write_off','adjustment','reversal')),
  -- Never zero. Negative is how a refund or a reversal is expressed, so the sum
  -- of the journal is the answer without a case statement.
  amount      numeric(12,2) not null check (amount <> 0),
  -- Stored, not read from config at display time: an entry from a raffle that
  -- ran in another currency must not silently become RM because a setting moved.
  currency    text not null,
  method      text not null default 'cash',
  -- Deliberately not a foreign key: it points at different tables by kind, and a
  -- soft reference that survives is worth more than one that blocks a delete
  -- elsewhere.
  reference_kind text check (reference_kind is null or reference_kind in
                   ('book','settlement','sale','batch','ticket')),
  reference_id   bigint,
  check ((reference_kind is null) = (reference_id is null)),
  by_user     text not null,
  reason      text not null default '',
  -- The second person, on the row they agreed to rather than in a table beside
  -- it. Nullable: most entries need nobody, and the rule belongs to the handler.
  authorised_by text,
  reverses    bigint references money_entries(id),
  client_key  text,
  -- Which payments row this came from, so the two can be reconciled against
  -- each other during dual-write without matching on amount and time.
  backfilled  boolean not null default false,
  legacy_id   bigint,
  -- A reversal names what it undoes, and only a reversal claims to.
  check ((kind = 'reversal') = (reverses is not null))
);
-- Partial, both of them. Every NULL is distinct in Postgres, so a plain unique
-- column would be relying on that by accident.
create unique index if not exists money_entries_client_key_idx
  on money_entries (client_key) where client_key is not null;
-- This one is what makes an interrupted backfill safe to re-run.
create unique index if not exists money_entries_legacy_idx
  on money_entries (legacy_id) where legacy_id is not null;
create index if not exists money_entries_party_idx on money_entries (party, at desc);
create index if not exists money_entries_reference_idx
  on money_entries (reference_kind, reference_id) where reference_kind is not null;

-- Append only, all three ways. Truncate is the one people leave off.
create or replace function money_entries_append_only() returns trigger as $$
begin
  raise exception 'money_entries is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Write the opposite entry instead, as a reversal pointing at the row it undoes.';
end $$ language plpgsql;

drop trigger if exists money_entries_no_change on money_entries;
create trigger money_entries_no_change before update or delete on money_entries
  for each row execute function money_entries_append_only();

drop trigger if exists money_entries_no_truncate on money_entries;
create trigger money_entries_no_truncate before truncate on money_entries
  for each statement execute function money_entries_append_only();

alter table money_entries enable row level security;
revoke all on money_entries from anon, authenticated;

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

/*
 * THAT INDEX USED TO BE UNIQUE, and it cannot be any more.
 *
 * It said one settlement row per book, which was exactly right while a forced
 * re-settle REPLACED the row: update it in place, or delete it when the second
 * count came to nothing. Both of those destroy the only evidence that the first
 * figure was ever claimed, and a correction whose evidence is gone cannot be
 * told apart from a figure that was always right. So a re-settle is now a
 * reversal and a new row, like every other correction to money here — which
 * means a book legitimately carries +120, -120, +90, and uniqueness would
 * refuse the third.
 *
 * WHAT REPLACES IT IS NOT NOTHING. The race it guarded — two organisers
 * settling one book, both writing a row — is now impossible for a better
 * reason: the rows are written inside settle_book, in the same transaction
 * that already holds `select … for update` on the book. The second organiser
 * waits for the first to commit and is then refused as a re-settle. The index
 * was protecting a write that happened outside any transaction, and that write
 * no longer exists.
 *
 * The invariant that remains is arithmetic rather than structural: the
 * settlement rows for a book sum to what the book says was paid. It is
 * asserted in supabase/test-functions.sh over settle, re-settle, settle-at-zero
 * and restock, because a sum is not something an index can hold.
 *
 * ON AN EXISTING DATABASE THE NAME IS THE TRAP. The unique index is already
 * there under exactly the name above, so `create index if not exists` sees the
 * name, does nothing, and leaves the unique one in place — a fresh database
 * would take reversals and production would refuse them. The migration drops
 * it by name before creating this one; this file is only ever applied to an
 * empty database, where there is nothing to drop.
 */

-- ============ THE ONE THING THE SHEET COULD NOT ENFORCE ============
-- A ticket cannot be sold without a name and a usable phone number. In the
-- Sheet this is checked in three handlers and could be bypassed by editing a
-- cell. Here it is a constraint: no code path, and no person with the
-- spreadsheet open, can record a sale that the draw cannot resolve to a
-- findable person.

alter table tickets drop constraint if exists tickets_sold_needs_contact;
alter table tickets add constraint tickets_sold_needs_contact check (
  status not in ('Sold','Donated')
  or source = 'settlement'          -- settlement records a sale nobody wrote down; blank is honest there
  or (buyer_name <> '' and length(regexp_replace(buyer_phone, '\D', '', 'g')) >= 7)
);

-- Optimistic concurrency, as the Sheet does with its Version column: a stale
-- edit is refused rather than silently overwriting somebody else's.
create or replace function bump_version() returns trigger as $$
begin
  new.version := old.version + 1;
  new.modified_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists tickets_bump_version on tickets;
create trigger tickets_bump_version before update on tickets
  for each row execute function bump_version();

drop trigger if exists books_bump_version on books;
create trigger books_bump_version before update on books
  for each row execute function bump_version();

-- ============ WHAT A RAFFLE IS SET UP AS ============
--
-- THE DEFAULTS, AND WHY THEY ARE HERE RATHER THAN IN A SCRIPT.
--
-- These 26 rows used to be seeded by `seedConfig_()` in the Apps Script
-- Setup.gs, and every config row in production arrived through the one-off
-- migration out of the Sheet. So a Supabase project built from nothing had an
-- EMPTY config table: no ticket prefix, no price, no currency, no event name.
-- `expand_tickets` would happily generate ten thousand tickets numbered `1`
-- through `10000` with no prefix and no padding, because that is what an absent
-- TICKET_PREFIX and an absent TICKET_DIGITS mean to the code that reads them.
--
-- The raffle could therefore only be installed by first building a spreadsheet
-- and migrating out of it, which is not a setup path — it is an accident of
-- history that happened to be true once.
--
-- The NOTES are carried across verbatim. They are the only documentation of
-- what each key means, and an organiser reading the table in the Supabase
-- dashboard is exactly who they were written for.
--
-- `on conflict do nothing`, so this is safe against the live raffle: a project
-- that already has these keys keeps every value it has.

insert into config (key, value, notes) values
  ('TICKET_PREFIX', 'KS-', 'Text before the number. May be empty. LOCKED once tickets exist.'),
  ('TICKET_START', '1', 'First ticket number. LOCKED once tickets exist.'),
  ('TICKET_DIGITS', '5', 'Zero padding, e.g. 5 gives KS-00001. LOCKED once tickets exist.'),
  ('TOTAL_TICKETS', '0', 'How many ticket rows EXIST. Not the same as how many are in play — see ACTIVE_TICKETS. Raised only by the System Admin on the "Make more tickets" screen, and only upwards. Starts at 0: a new project has no tickets until somebody generates them.'),
  ('TICKETS_PER_BOOK', '10', 'Tickets in one physical book. LOCKED once tickets exist.'),
  ('BOOK_PREFIX', 'Book-', 'Text before the book number. LOCKED once tickets exist.'),
  ('BOOK_DIGITS', '4', 'Zero padding, e.g. 4 gives Book-0001. LOCKED once tickets exist.'),
  ('TICKET_PRICE', '10', 'Price of one ticket. Can be changed later.'),
  ('CURRENCY', 'RM', 'Shown on reports and receipts.'),
  ('CHECK_IN_DATE', '', 'The one date every seller reports by this round, e.g. 2026-10-14. The SAME date for everybody — not a month from whenever each person happened to collect their books — so one reminder fits the whole team and one list says who is late. It is a checkpoint, not the end: after each check move it on the "Deadlines" screen, which steps it on and stops at FINAL_DEADLINE.'),
  ('FINAL_DEADLINE', '', 'The last day books and money can come back, e.g. 2026-12-06. This one does not move on its own and only the System Admin can change it. The check-in date can never pass it, and the draw is not ready until it has passed.'),
  ('CHECK_IN_EVERY_MONTHS', '1', 'How far apart the reporting rounds are, in months. The dates in between are WORKED OUT from this and FINAL_DEADLINE — nobody types them, so a seller can be told every one of their dates the day they take their books. 0 is not "never": it asks the check-in to stand still, which is refused, as is a negative number and anything over a year.'),
  ('CHECK_IN_EVERY', '', 'The same rhythm as CHECK_IN_EVERY_MONTHS, in whatever unit this raffle keeps: 1m for monthly, 2w for a fortnight, 10d for ten days. Months could not say "twice a month", so a team reporting every fortnight was told by every screen that they report monthly. Blank falls back to CHECK_IN_EVERY_MONTHS.'),
  ('SALES_CLOSE_DATE', '', 'The last day a ticket may be sold, e.g. 2026-12-01. NOT the day the books come back (FINAL_DEADLINE) and not the draw (DRAW_DATE) — it is when selling stops, which is usually earlier than both. After it, recording a sale is refused; an organiser can still force one for a ticket genuinely sold in time, and that is written to the log. Blank means no cutoff.'),
  ('REPORT_GRACE_DAYS', '3', 'Days after the check-in date before a seller who has not reported is shown as late. Somebody who says they will come on Saturday should not be marked red on Friday: a badge that fires on people doing the right thing is one the organiser learns to scroll past.'),
  ('CHECK_IN_ROUND', '1', 'Which reporting round is live. Moved on by the "Deadlines" screen when the check-in date rolls. Do NOT edit by hand — every report already recorded is filed against a round number, and changing this by hand re-opens or hides them.'),
  ('DEFAULT_DUE_DAYS', '30', 'Fallback return period, used only for a raffle with no CHECK_IN_DATE and no FINAL_DEADLINE still ahead.'),
  ('EVENT_NAME', 'Fundraising Raffle', 'The name of THIS raffle, shown on receipts. Change it.'),
  ('ORG_NAME', '', 'Who is running the raffle. Shown on receipts. Set this before selling.'),
  ('ORG_LOGO', '', 'URL of your logo, shown on screen and on receipts. Blank shows no logo — it will NEVER show somebody else''s.'),
  ('ORG_LOGO_SMALL', '', 'Optional smaller version of the same logo, for phones on mobile data. Blank uses ORG_LOGO.'),
  ('BRAND_COLOR', '', 'Your main colour, as a hex code like #0B7285. Buttons, tabs and the default mark follow it. Blank keeps the standard colour. The text colour on top is worked out for readability and is not set here.'),
  ('PROJECT_CODE', '', 'Short code for this raffle, e.g. CS-2026. Shown on receipts and reports. NOT part of ticket numbers, so it is safe to change at any time.'),
  ('ACTIVE_TICKETS', '', 'How many of the generated tickets are IN PLAY, counting from the first. Blank means all of them. Lower than TOTAL_TICKETS holds the rest back: they are not loaded, not sellable, and their books cannot be given out until released. Must be a whole number of books. Change it on the "Tickets in play" screen, not by hand.'),
  ('TICKET_CEILING', '', 'How many tickets this raffle plans to reach in the end, e.g. 20000. A guard, not a promise: releasing more than this is refused, so a slipped digit cannot generate ten times the tickets you meant. Blank means no ceiling.'),
  ('DRAW_DATE', '', 'Draw date, e.g. 2026-12-20.')
on conflict (key) do nothing;

/*
 * THE NUMBERING LOCK — ported from `assertNumberingUnchanged_` in Config.gs,
 * and deliberately stronger than the original.
 *
 * WHAT IT PROTECTS. Every ticket number in the `tickets` table is a STORED
 * string; every lookup recomputes the number from these settings. Change the
 * prefix after tickets are printed and the two stop agreeing: searching for a
 * ticket finds nothing, selling one says it does not exist, and the paper in
 * somebody's hand no longer refers to anything. Nothing throws. It simply stops
 * matching, quietly, for everybody.
 *
 * WHY IT IS A TRIGGER AND NOT A CHECK IN THE EDGE FUNCTION. The Apps Script
 * version compared a fingerprint held in Script Properties on every write, which
 * caught the change one action LATE — after somebody had already edited the
 * Config tab, and by refusing every sale until they put it back. Here there is
 * no `set_config` action at all: config is edited in the Supabase dashboard,
 * straight into the table. A guard in the Edge Function would not be on the path
 * that needs guarding. This one refuses the edit itself, at the moment it is
 * made, wherever it comes from.
 *
 * TOTAL_TICKETS IS TREATED DIFFERENTLY, because raising it is the normal way a
 * raffle grows — `expand_tickets` does exactly that, and it is the one action
 * the Apps Script lock also let through. It may go UP and never down. Lowering
 * it does not delete rows; it makes every ticket above the new number stop being
 * loaded, including ones already sold, with nothing reporting an error.
 */
create or replace function config_numbering_locked() returns trigger
language plpgsql as $$
declare
  have_tickets boolean;
begin
  if new.value is not distinct from old.value then return new; end if;

  select exists (select 1 from tickets) into have_tickets;

  if new.key = 'TOTAL_TICKETS' then
    -- Blank or non-numeric on either side is left to the handlers; this guard
    -- is only about the direction of a number that is genuinely a number.
    if coalesce(nullif(new.value, '') ~ '^\d+$', false)
       and coalesce(nullif(old.value, '') ~ '^\d+$', false)
       and new.value::bigint < old.value::bigint then
      raise exception using
        errcode = 'check_violation',
        message = format(
          'The raffle has %s tickets and cannot be reduced to %s.', old.value, new.value),
        hint = 'Every ticket above the new number would stop existing, including ones '
               'already sold, and nothing would report an error. Tickets can only be added.';
    end if;
    return new;
  end if;

  if have_tickets and new.key in ('TICKET_PREFIX', 'TICKET_START', 'TICKET_DIGITS',
                                  'TICKETS_PER_BOOK', 'BOOK_PREFIX', 'BOOK_DIGITS') then
    raise exception using
      errcode = 'check_violation',
      message = format('%s cannot change once tickets exist.', new.key),
      hint = 'Every ticket number already written down was built from this setting. '
             'Changing it does not renumber them — it stops them matching, so searching '
             'for a ticket finds nothing and selling one says it does not exist.';
  end if;

  return new;
end $$;

drop trigger if exists config_numbering_locked on config;
create trigger config_numbering_locked before update on config
  for each row execute function config_numbering_locked();
