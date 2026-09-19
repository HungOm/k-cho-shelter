-- A buyer who took ten tickets got ten pictures and ten QR codes
--
-- The thing they actually hold — "these ones are mine" — was represented
-- nowhere. They could not check them in one go, and neither could anybody
-- standing next to them at the draw with a phone.
--
-- WHY A CODE AND NOT A LIST INSIDE THE QR, measured rather than assumed. The
-- encoder is byte mode, versions 1 to 10. At the error-correction level the
-- ticket design ships — M — a version 10 code holds 213 bytes. The verify
-- address is about 39 of those and every `KS-00123.ABCDEFGHJKMN` pair is 22, so
-- a QR carrying the pairs outright holds SEVEN tickets. A book is ten. The
-- commonest multiple sale in this raffle would not fit in it.
--
-- Level L would hold ten, and that is the wrong trade: these are printed
-- tickets folded into wallets, handled in a hall, photographed under bad light
-- and sometimes photocopied, and L is the level with the least recovery. One
-- code of fixed size holds any number of tickets and keeps the correction.
--
-- WHAT A RECEIPT IS: a set of tickets somebody CHOSE to issue together — what
-- was sold in one act, or what an organiser picked by hand. It is deliberately
-- not inferred from a buyer's name and telephone number, because the same
-- person buying twice in a fortnight is two purchases and joining them would be
-- the system asserting something nobody said.
--
-- DATA LOSS RISK: NO. Two tables are added. Nothing existing is read or written
-- by this migration.

create table if not exists ticket_receipts (
  code       text primary key,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);

-- The tickets survive the receipt and never the other way about: cascade from
-- the header, restrict from the ticket.
create table if not exists ticket_receipt_items (
  code       text not null references ticket_receipts(code) on delete cascade,
  ticket_idx integer not null references tickets(idx) on delete restrict,
  primary key (code, ticket_idx)
);

alter table ticket_receipts enable row level security;
alter table ticket_receipt_items enable row level security;

-- Read by the api function and by the public verify function, both as the
-- service role, exactly as ticket_codes is. No browser reaches them directly,
-- signed in or not — and with RLS on and no policy, none can.
revoke all on ticket_receipts from anon, authenticated;
revoke all on ticket_receipt_items from anon, authenticated;

-- "Which receipts is this ticket on", asked when one is re-sent.
create index if not exists ticket_receipt_items_ticket on ticket_receipt_items (ticket_idx);
