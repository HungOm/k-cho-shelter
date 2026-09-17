-- Every movement of money, in one place, with a reason on each row.
--
-- ARCHITECTURE-REVIEW.md §23 Phase 1C and §15: money_entries as the
-- generalisation of payments. Added EMPTY with its triggers, exactly as the
-- custody ledger was in 20260918100000. Nothing reads it, nothing writes it, no
-- handler is touched, and the backfill from payments is written but NOT RUN —
-- it is supabase/backfill-money.sql, which nothing calls.
--
-- WHAT payments CANNOT SAY, which is the whole reason for a second table rather
-- than three more columns on the first:
--
--   THE DESK CANNOT HOLD MONEY. payments.agent_id is `not null references
--   agents(agent_id)`, so cash taken across the office desk has nowhere to go.
--   desk_money() exists to reconstruct that figure from tickets and books
--   because the ledger could not hold it. `party` is plain text here, 'desk' or
--   an agent_id, the same sentinel the custody ledger uses.
--
--   NOBODY AUTHORISED ANYTHING. Two-person control lives in the approvals
--   table, beside the money rather than on it, so "who was the second person
--   who agreed to this write-off" is a join on time and intent. authorised_by
--   puts it on the row it authorised.
--
--   A RECEIPT CANNOT SAY WHAT IT WAS FOR. book_idx is the only reference
--   payments has, so a payment against a settlement, a sale, or a batch all
--   look alike. reference_kind and reference_id say which.
--
--   AND `source` CONFLATES TWO QUESTIONS. 'hand' and 'settlement' are both cash
--   arriving and differ only in what they were for; 'writeoff' is not cash at
--   all. That is why every caller has to remember which sources are money —
--   payments' own comment says so: "Every caller that adds up payments
--   therefore has to say which kinds it means". An "everything except X"
--   condition, the shape AUDIT.md §X names. Here `kind` answers only "what
--   happened to the money" and the reference answers "what for", so summing
--   receipts is a predicate rather than a memory test.
--
-- WHAT IS DELIBERATELY NOT HERE. payments is untouched and remains the table
-- the raffle runs on. §22 step 3 is dual-write and it is two phases away; this
-- is step 1 for the financial journal, and the only thing being asked of it
-- today is to exist and to refuse the things it should refuse.
--
-- DATA LOSS RISK: NO. One table created. No existing column is dropped, added
-- or written, and no row is deleted or read.

-- ============ THE JOURNAL (begin) ============
create table if not exists money_entries (
  id          bigint generated always as identity primary key,
  -- Settable, not just defaulted: the backfill carries payments.received_at
  -- across, and a journal whose `at` is all one afternoon cannot be reconciled
  -- against a bank statement or a week's takings.
  at          timestamptz not null default now(),

  /*
   * WHOSE MONEY IT IS — an agent_id, or 'desk' for the office. Plain text and
   * not a reference to agents, for the same two reasons the custody ledger
   * gives: the desk is not an agent and never will be, and an entry that
   * happened must stay readable after the seller who made it is deleted.
   *
   * payments has `on delete restrict` here, which means a seller who has ever
   * handed over a ringgit can never be removed. That is a defensible rule and
   * it is not this table's to enforce: a journal's job is to still be true
   * later, not to hold other tables hostage.
   */
  party       text not null,

  /*
   * WHAT HAPPENED TO THE MONEY, and only that.
   *
   *   receipt     cash arrived
   *   refund      cash went back out
   *   write_off   a debt the raffle has decided will not be collected —
   *               NOT cash, and never summed with it
   *   adjustment  a correction that is neither, carrying its reason
   *   reversal    undoes an earlier entry; `reverses` says which
   *
   * What the money was FOR is reference_kind/reference_id, which is the
   * separation payments does not make.
   */
  kind        text not null check (kind in
                ('receipt','refund','write_off','adjustment','reversal')),

  -- Never zero: a row that changes nothing is a row somebody has to interpret.
  -- Negative is how a reversal or a refund is expressed, so the sum of the
  -- journal is the answer without a case statement.
  amount      numeric(12,2) not null check (amount <> 0),

  /*
   * STORED, not read from config at display time. config.CURRENCY is today's
   * answer; an entry from a raffle that ran in a different currency must not
   * silently become RM because somebody changed a setting. Every money figure
   * this repository has had to correct was one that meant something different
   * from what it said.
   */
  currency    text not null,
  method      text not null default 'cash',

  -- WHAT IT WAS FOR. Deliberately not a foreign key: it points at different
  -- tables by kind, and a soft reference that survives is worth more here than
  -- one the database can check and that blocks a delete somewhere else.
  reference_kind text check (reference_kind is null or reference_kind in
                   ('book','settlement','sale','batch','ticket')),
  reference_id   bigint,
  check ((reference_kind is null) = (reference_id is null)),

  by_user     text not null,
  reason      text not null default '',

  /*
   * THE SECOND PERSON, on the row they agreed to rather than in a table beside
   * it. Two-person control already exists as approvals; what it cannot do is
   * answer "who authorised THIS entry" without a join on time and intent.
   * Nullable because most entries need nobody — the rule is enforced by the
   * handler that writes them, which does not exist yet.
   */
  authorised_by text,

  -- A correction is a new row pointing at what it undoes, never an edit. The
  -- triggers below make that the only option rather than the polite one.
  reverses    bigint references money_entries(id),
  client_key  text,

  -- Provenance, as on ticket_movements: which payments row this came from, so
  -- the two ledgers can be reconciled against each other during dual-write
  -- without matching on amount and time.
  backfilled  boolean not null default false,
  legacy_id   bigint,

  -- A reversal that names nothing is not a reversal, and an entry that is not a
  -- reversal must not claim to undo something.
  check ((kind = 'reversal') = (reverses is not null))
);

-- Partial, and it has to be: every NULL is distinct in Postgres, so a plain
-- unique column would be relying on that by accident. Two entries nobody gave a
-- key are two entries. Same shape as payments_client_key_idx.
create unique index if not exists money_entries_client_key_idx
  on money_entries (client_key) where client_key is not null;

-- One row per payments row, enforced rather than trusted: the backfill can then
-- be re-run after a failure without doubling anybody's balance.
create unique index if not exists money_entries_legacy_idx
  on money_entries (legacy_id) where legacy_id is not null;

create index if not exists money_entries_party_idx on money_entries (party, at desc);
create index if not exists money_entries_reference_idx
  on money_entries (reference_kind, reference_id) where reference_kind is not null;
-- ============ THE JOURNAL (end) ============


-- ============ APPEND ONLY, ENFORCED (begin) ============
-- The same three payments has. TRUNCATE is the third and the one people leave
-- off: it is neither an update nor a delete, and it would empty the journal
-- without firing either of the other two.
create or replace function money_entries_append_only() returns trigger as $$
begin
  raise exception 'money_entries is append only — % is not allowed on it', tg_op
    using errcode = 'restrict_violation',
          hint = 'Write the opposite entry instead, as a reversal pointing at the row it undoes. The pair is what makes the correction auditable; an edit leaves the trail saying the mistake never happened.';
end $$ language plpgsql;

drop trigger if exists money_entries_no_change on money_entries;
create trigger money_entries_no_change before update or delete on money_entries
  for each row execute function money_entries_append_only();

drop trigger if exists money_entries_no_truncate on money_entries;
create trigger money_entries_no_truncate before truncate on money_entries
  for each statement execute function money_entries_append_only();
-- ============ APPEND ONLY, ENFORCED (end) ============


-- ============ SERVER ONLY (begin) ============
-- Like payments, audit_log and ticket_movements: the edge function reads it
-- with the service key and does its own scoping in code. RLS is enabled as well
-- as revoked, so a future grant cannot quietly open a table with no policies.
alter table money_entries enable row level security;
revoke all on money_entries from anon, authenticated;
-- ============ SERVER ONLY (end) ============
