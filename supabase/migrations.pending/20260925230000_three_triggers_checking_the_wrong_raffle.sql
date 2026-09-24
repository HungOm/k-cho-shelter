/*
 * MULTI-TENANCY STAGE 2: three triggers that were checking the wrong raffle.
 *
 * Found by asking the catalog rather than by grepping — every trigger function
 * whose source reads a partitioned table, and whether that read names
 * project_id. Three did not, and the first is the one the plan calls out by
 * name:
 *
 *   config_numbering_locked       reads tickets
 *   prize_quantity_covers_awards  reads winners
 *   winner_seat_exists            reads prizes
 *
 * WHY THE FIRST ONE MATTERS MOST. It refuses a change to TICKET_PREFIX,
 * TICKET_START, TICKET_DIGITS, TICKETS_PER_BOOK, BOOK_PREFIX or BOOK_DIGITS
 * "once tickets exist" — and it asked whether ANY tickets exist. The moment
 * one raffle generates its tickets, every raffle created afterwards would be
 * told it cannot set its own numbering, for good, with a message about tickets
 * that are not its own. A new project would arrive permanently locked.
 *
 * THE OTHER TWO ARE SAFE TODAY AND NOT SAFE TO LEAVE. prize_id is globally
 * unique through Stage 4, so both reads can currently only match the right
 * row. The plan's rule for the text-id tables is "project_id column, composite
 * FKs, every read filters", and a read that is correct only because of a
 * property two stages away is one nobody can check by reading it.
 *
 * NO BEHAVIOUR CHANGES with one project: every row shares its project_id, so
 * each added predicate selects exactly what it selected before. Checked, not
 * assumed — the T9 report dump before and after is byte-identical, and the
 * whole of test-functions.sh, which exercises these three triggers directly,
 * is unchanged at 322 passed.
 *
 * NOT APPLIED ANYWHERE. migrations.pending/ until the owner says so (D-003).
 * Rollback: re-apply the previous supabase/schema.sql, or the three bodies
 * without their predicates.
 */

create or replace function config_numbering_locked() returns trigger
language plpgsql as $$
declare
  have_tickets boolean;
begin
  if new.value is not distinct from old.value then return new; end if;

  -- THIS PROJECT'S TICKETS, not every project's. Unscoped, the first raffle to
  -- generate tickets would lock the numbering of every raffle created
  -- afterwards, for good: a brand-new project with no tickets at all would be
  -- told its prefix cannot change because somebody else's tickets exist. The
  -- plan names this one specifically.
  select exists (select 1 from tickets where project_id = new.project_id)
    into have_tickets;

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

create or replace function prize_quantity_covers_awards() returns trigger
language plpgsql as $$
declare given integer;
begin
  select count(*) into given from winners
    where prize_id = new.prize_id and forfeited_at is null
      and project_id = new.project_id;
  if new.quantity < given then
    raise exception 'The % has been given % times already, so it cannot be cut to %.',
      new.tier, given, new.quantity;
  end if;
  -- A seat number cannot be left stranded above the new ceiling either.
  if exists (select 1 from winners
             where prize_id = new.prize_id and seq > new.quantity
               and forfeited_at is null
               and project_id = new.project_id) then
    raise exception 'Somebody holds a % above number %.', new.tier, new.quantity;
  end if;
  return new;
end $$;

create or replace function winner_seat_exists() returns trigger
language plpgsql as $$
declare q integer;
begin
  if new.prize_id is null then return new; end if;
  -- The prize in THIS project. prize_id stays globally unique through Stage 4,
  -- so today this could only match the right row; filtering anyway because the
  -- plan's rule for the text-id tables is "project_id column, composite FKs,
  -- every read filters", and a read that is correct only because of a property
  -- two stages away is one nobody can check.
  select quantity into q from prizes
   where prize_id = new.prize_id and project_id = new.project_id;
  if q is null then
    raise exception 'No prize called % is set up.', new.prize_id;
  end if;
  if new.seq is null or new.seq < 1 or new.seq > q then
    raise exception 'There are % of the % to give, so there is no number %.',
      q, new.prize_id, coalesce(new.seq::text, 'none');
  end if;
  return new;
end $$;
