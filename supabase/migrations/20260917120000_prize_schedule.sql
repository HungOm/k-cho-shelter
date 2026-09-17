-- The prize schedule — what is on offer, how many of each, and what it is worth.
--
-- WHY. `winners.prize` was free text. "First prize", "1st Prize" and "Grand
-- prize" were three different prizes as far as anything downstream could tell;
-- nothing counted how many of a prize had been given out; and nothing at all
-- stopped the Grand Prize being awarded twice. A raffle that awards one car to
-- two people has no good next move, and it finds out in front of the room.
--
-- Idempotent; run it twice and nothing changes. DATA LOSS RISK: NO. Two new
-- tables, four new columns on `winners`, three functions and three triggers.
-- No existing column is dropped, no row deleted, no function replaced that
-- anything else calls. Winners recorded before this migration keep their free
-- text in `prize` and get a null `prize_id`, which every read here tolerates on
-- purpose — a partial unique index rather than a plain one, and a seat trigger
-- that returns early. Backfilling them would mean guessing which prize a phrase
-- meant, and a guess written into the record of a draw is worse than a blank.
--
-- GENERATED from the canonical files, so the migration and they cannot drift:
-- the THE PRIZE SCHEDULE block of schema.sql, then the policies and grants
-- rls.sql makes for it.

-- ---------- from schema.sql ----------
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
  created_at   timestamptz not null default now()
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

-- ---------- from rls.sql ----------
alter table prizes        enable row level security;
alter table prize_types   enable row level security;

drop policy if exists prizes_read on prizes;
create policy prizes_read on prizes for select using (app_role() is not null);

drop policy if exists prize_types_read on prize_types;
create policy prize_types_read on prize_types for select using (app_role() is not null);

grant select on prizes, prize_types to authenticated;
revoke all on prizes, prize_types from anon;
