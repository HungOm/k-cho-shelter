-- What a raffle is set up as — the config defaults, and the numbering lock.
--
-- WHY. These 26 rows were seeded by `seedConfig_()` in the Apps Script Setup.gs,
-- and every config row in production arrived through the one-off migration out
-- of the Sheet. A Supabase project built from nothing therefore had an EMPTY
-- config table — no ticket prefix, no price, no currency, no event name — and
-- `expand_tickets` would generate ten thousand tickets numbered `1` to `10000`
-- with no prefix and no padding, because that is what an absent TICKET_PREFIX
-- and an absent TICKET_DIGITS mean to the code reading them.
--
-- So the raffle could only be installed by first building a spreadsheet and
-- migrating out of it. That is not a setup path; it is an accident of history
-- that happened to be true once. This is the first half of removing the Apps
-- Script backend: the half that has to exist BEFORE it goes.
--
-- Idempotent; run it twice and nothing changes. DATA LOSS RISK: NO. The insert
-- is `on conflict (key) do nothing`, so a project that already has these keys
-- keeps every value it has — the live raffle included. One new function and one
-- new trigger, on `config` alone. No existing column is dropped, no row deleted,
-- no function replaced that anything else calls.
--
-- GENERATED from the canonical file, so the migration and it cannot drift: the
-- WHAT A RAFFLE IS SET UP AS block of schema.sql.

-- ---------- from schema.sql ----------
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
