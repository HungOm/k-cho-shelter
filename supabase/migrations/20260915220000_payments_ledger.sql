-- Money can be handed in without closing a book.
--
-- Until now the ONLY way to record cash was settle_book: whole book, organiser
-- only, and it closes the book. So a seller who brings half the money, or who
-- is keeping the book to sell the rest, could not be recorded at all — and the
-- organiser's only options were to wait or to close a book that is not
-- finished. This adds the ledger that was missing.
--
-- Additive and idempotent. The backfill at the end makes every existing
-- settlement appear as the payment it always was, so no total moves.

create table if not exists payments (
  id           bigint generated always as identity primary key,
  /*
   * MONEY FOLLOWS CUSTODY, NOT WHOEVER TYPED IT IN.
   *
   * A helper at a desk records sales that are credited to the book's holder, so
   * a helper never owes anything. Keying the debt on agent_id rather than on
   * the recorder is what makes "what I owe" answerable for a seller and
   * correctly empty for a helper who carries no books.
   */
  agent_id     text not null references agents(agent_id) on delete restrict,
  -- Negative is a reversal. Never zero: a row that changes nothing is a row
  -- somebody has to interpret.
  amount       numeric(12,2) not null check (amount <> 0),
  received_at  timestamptz not null default now(),
  received_by  text not null default '',
  method       text not null default 'cash',
  note         text not null default '',
  -- Optional. Cash handed over before anybody counts a book belongs to the
  -- seller, not yet to a book, and saying so is more honest than guessing.
  book_idx     integer references books(idx) on delete set null,
  -- A reversal points at what it undoes. Corrections are new rows, never
  -- deletes, so the trail survives the mistake.
  reverses     bigint references payments(id) on delete restrict,
  -- 'hand' — somebody handed cash over. 'settlement' — written by settle_book,
  -- so the book's declared figure and the seller's ledger cannot disagree.
  source       text not null default 'hand' check (source in ('hand','settlement'))
);

create index if not exists payments_agent_idx on payments (agent_id);

-- ONE settlement row per book, so re-settling replaces rather than adds. Without
-- it a forced re-settle would count the same cash twice and the seller would
-- appear to have overpaid.
create unique index if not exists payments_settlement_book_idx
  on payments (book_idx) where source = 'settlement';

-- Server-only, like the audit log. The browser reads money through the Edge
-- Function, which applies the scoping a policy cannot express: an organiser
-- sees every seller, a seller sees their own line, a helper sees what they hold.
alter table payments enable row level security;
revoke all on payments from anon, authenticated;

-- ============ BACKFILL, SO NO NUMBER MOVES ============
-- Every settled book with money against it becomes the payment it always was.
-- Guarded by the unique index above, so running this twice changes nothing.

insert into payments (agent_id, amount, received_at, received_by, method, note, book_idx, source)
select b.held_by_agent,
       b.amount_paid,
       coalesce(b.settled_at, now()),
       coalesce(nullif(b.settled_by, ''), 'backfill'),
       'cash',
       'Recorded at settlement, before payments were kept separately',
       b.idx,
       'settlement'
from books b
where b.held_by_agent is not null
  and coalesce(b.amount_paid, 0) <> 0
on conflict do nothing;
