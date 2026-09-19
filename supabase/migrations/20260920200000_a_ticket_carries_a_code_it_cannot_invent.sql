-- A code on every printed ticket, so a forgery can be told from the real thing.
--
-- TICKETS-PLAN.md phase 2. A ticket number is public by design: it is printed in
-- large type and runs in sequence, so anybody holding one can work out what the
-- next is called. That is fine for a label and useless against somebody who
-- prints their own ticket with a plausible number on it. The code is the part
-- that cannot be guessed, and the public verify function is what checks it.
--
-- WHY A TABLE AND NOT A COLUMN ON tickets. Two reasons, and the second is the
-- one that decided it.
--
--   1. A code is not a property of the sale. It belongs to the PRINTING: which
--      artwork, which batch, when, by whom, and whether that batch has been
--      printed yet. Those are five columns nobody wants on the tickets row.
--
--   2. Every update to `tickets` fires bump_version() and record_ticket_history().
--      Minting twenty thousand codes as an update would raise twenty thousand
--      version numbers -- a VERSION_CONFLICT for anyone mid-edit -- and write
--      twenty thousand history rows, and read_delta would then hand every
--      connected phone twenty thousand "changed" tickets to re-download. On a
--      volunteer's phone on mobile data, generating a raffle's tickets would
--      look exactly like the whole raffle changing at once.
--
-- ON DELETE RESTRICT, deliberately, matching ticket_movements. A ticket with a
-- code printed on paper somewhere must not be deletable without somebody
-- dealing with the code first. reset.sql clears this table BEFORE tickets for
-- exactly that reason, and the comment there says so.
--
-- WHY NOTHING IS DERIVED. The codes could have been computed from the ticket
-- number with a signing key and stored nowhere at all. That was the first
-- design and supabase/functions/_shared/ticketcode.ts records why it was not
-- taken: it buys "a stolen backup cannot forge" with a secret that has to be
-- set at deploy and rotated between raffles, while the same backup already
-- holds several thousand people's phone numbers. Stored codes also give a
-- record of what has been printed, which a signature cannot.
--
-- LAST RAFFLE'S TICKETS STOP VERIFYING BY CONSTRUCTION. The reset deletes this
-- table, so every code printed for the previous raffle matches nothing. No key
-- to rotate, nothing to remember.
--
-- DATA LOSS RISK: NO. One table created. Nothing is dropped, altered or
-- deleted, and nothing writes to it until the printing handlers land. Re-runnable.

create table if not exists ticket_codes (
  -- The ticket it belongs to, one code each. The primary key IS the ticket, so
  -- a second code for the same ticket is impossible rather than merely unlikely.
  ticket_idx   integer primary key references tickets(idx) on delete restrict,
  -- Unique across the raffle: two tickets sharing a code would both verify as
  -- each other, which is the one failure that would not look like a failure.
  code         text not null unique,
  -- Which artwork it was generated against. Kept because a reprint after the
  -- artwork changed is worth being able to notice.
  template_id  text,
  -- One id per generation run, so a batch can be found again whole.
  batch_id     uuid not null,
  generated_at timestamptz not null default now(),
  generated_by text not null default '',
  -- When the ticket was last actually rendered for printing, and by whom. Null
  -- means generated but never printed -- which is a real and useful state: it
  -- says the codes exist and the paper does not.
  printed_at   timestamptz,
  printed_by   text not null default ''
);

alter table ticket_codes enable row level security;

-- Nobody reads this directly, and that is the whole security model. The browser
-- never sees a code it was not handed for a ticket it may see; the Edge
-- Function holds the secret key and decides. The public verify function reads
-- it too -- also through the secret key, and it answers one question with a
-- yes or a no rather than returning a row. Same shape as ticket_movements.
revoke all on ticket_codes from anon, authenticated;

-- Verification looks a code up by ticket number, so the join column is what is
-- indexed; `code` already has an index from its unique constraint.
create index if not exists ticket_codes_batch_idx on ticket_codes (batch_id);
