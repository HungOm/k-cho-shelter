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
   * A LIFECYCLE, NOT A BOOLEAN.
   *
   * pending    added, not yet let in. Sees that, and nothing else.
   * active     approved and working.
   * suspended  temporarily stopped — a lost phone, a disputed book.
   * banned     stopped for good.
   *
   * The three that are not 'active' all deny equally. They are separate so the
   * person is told WHICH applies: "waiting to be let in" and "your access was
   * stopped" are different sentences to receive, and somebody told the wrong
   * one either waits for nothing or thinks they are in trouble.
   */
  status       text not null default 'active'
                 check (status in ('pending','active','suspended','banned')),
  -- Derived, so the two can never disagree. One source of truth for whether
  -- somebody is let in; anything still reading `active` keeps working.
  active       boolean generated always as (status = 'active') stored,
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
  active       boolean not null default true,
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
                   check (status in ('Unassigned','Out','Returned','Settled','Lost','Void')),
  held_by_agent  text references agents(agent_id) on delete set null,
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
  notes          text not null default '',
  version        integer not null default 1,
  modified_by    text not null default '',
  modified_at    timestamptz not null default now()
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
  modified_at    timestamptz not null default now()
);

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
  case when b.status in ('Settled','Lost')
       then coalesce(b.declared_sold, 0)
       else r.recorded_sold end                      as counted_sold,
  case when b.status in ('Settled','Lost')
       then coalesce(b.amount_due, 0)
       else r.recorded_amount end                    as counted_expected,
  coalesce(b.amount_paid, 0)                         as counted_collected,
  coalesce(b.declared_sold, 0) - r.recorded_sold     as variance_sold,
  coalesce(b.amount_due, 0) - r.recorded_amount      as variance_amount,
  -- Whole days between calendar days, now that due_at is a date.
  case when b.status = 'Out' and b.due_at is not null and b.due_at < current_date
       then (current_date - b.due_at)::int
       else 0 end                                    as days_overdue
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

create table if not exists book_history (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  book_idx     integer not null references books(idx) on delete cascade,
  from_agent   text,
  to_agent     text,
  action       text not null,
  by_user      text not null default '',
  note         text not null default ''
);
create index if not exists book_history_book_idx on book_history (book_idx, at desc);

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
  note         text not null default ''
);
create index if not exists pending_status_idx on pending_approvals (status, requested_at desc);

create table if not exists winners (
  ticket_idx   integer primary key references tickets(idx) on delete restrict,
  prize        text not null default '',
  drawn_at     timestamptz not null default now(),
  buyer_name   text not null default '',
  buyer_phone  text not null default '',
  notified     boolean not null default false,
  claimed      boolean not null default false,
  claimed_at   timestamptz,
  notes        text not null default '',
  recorded_by  text not null default ''
);

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
  primary key (agent_id, round)
);
-- "Who has answered this round" is the question asked on every seller list.
create index if not exists check_in_round_idx on check_in_reports (round);

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
