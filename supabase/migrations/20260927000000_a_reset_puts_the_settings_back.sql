-- A reset that empties the settings left the raffle unable to start.
--
-- WHAT HAPPENED. On 2026-10-03 the System Admin reset the raffle from the app.
-- `config` is on app_reset's allowlist, so its rows went with everything else
-- (RAFFLE_RESET removed 23,185 rows across 18 tables). Nothing put the
-- defaults back — they are inserted by schema.sql and by 20260917180000, never
-- by the reset — so the next thing done was making 20,000 tickets against a
-- config table holding one row. Three things followed, none of them an error:
--
--   * expand_tickets saved TOTAL_TICKETS with an UPDATE, which matches nothing
--     when the row is absent. active_tickets() read 0, and book_ledger_all
--     (WHERE idx <= ceil(active_tickets() / TICKETS_PER_BOOK)) returned no rows:
--     2,000 books existed and the app listed none.
--   * With TICKET_PREFIX / TICKET_DIGITS / BOOK_DIGITS absent the generator used
--     its own fallbacks, so tickets were numbered 00001 and books Book-001
--     rather than KS-00001 and Book-0001.
--   * Numbering locks the moment a ticket exists, so it could not simply be
--     corrected through Settings afterwards.
--
-- THE FIX HERE. The defaults become a function, and app_reset calls it when it
-- has emptied `config`. `on conflict do nothing`, so it can never overwrite a
-- value that is there; a reset that does NOT touch config is unchanged.
--
-- Values the organiser had typed (event name, organisation, deadlines, price)
-- are still lost by a reset that includes config — that is what choosing to
-- reset the settings means. What is no longer lost is the ability to start
-- again with the right numbering.
--
-- The list below is copied from 20260917180000_config_defaults.sql and must
-- agree with it; tests/seedagree.test.mjs reads this file as a fourth source.
--
-- DATA LOSS RISK: NO. One function added, one function replaced (app_reset,
-- unchanged except for the call marked below). No table, column or row touched
-- when this is applied.

create or replace function config_restore_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
end
$$;

comment on function config_restore_defaults() is
  'Inserts the default raffle settings that are missing. Never overwrites a '
  'value that exists. Called by app_reset after it empties config.';

revoke all on function config_restore_defaults() from public, anon, authenticated;

create or replace function app_reset(p_tables text[], p_by text)
returns table (tbl text, removed bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Everything the app may ever empty. Ordered for readability only; the
  -- caller supplies the order rows come out in, and a wrong one is refused by
  -- a foreign key and rolls the whole thing back rather than half-emptying.
  allowed constant text[] := array[
    'ticket_templates',
    'tickets', 'books', 'ticket_codes', 'ticket_history', 'ticket_movements', 'book_history',
    -- A receipt is one code standing for a set of tickets, so it is worth
    -- exactly what the tickets it names are worth. It goes when they go, and a
    -- receipt still answering "genuine" for a ticket that no longer exists
    -- would be worse than one that went with them.
    'ticket_receipts', 'ticket_receipt_items',
    'agents',
    'payments', 'money_entries',
    'prize_types', 'prizes', 'winners',
    'check_in_dates', 'check_in_reports',
    'pending_approvals',
    'round_snapshots',
    'config'
  ];
  t     text;
  n     bigint;
  total bigint := 0;
begin
  if p_tables is null or array_length(p_tables, 1) is null then
    raise exception 'app_reset was given nothing to empty' using errcode = '22023';
  end if;

  -- Checked BEFORE anything is touched. A list that is half acceptable must not
  -- empty the acceptable half and then raise.
  foreach t in array p_tables loop
    if not (t = any(allowed)) then
      raise exception 'app_reset refuses to empty %', t using errcode = '42501';
    end if;
  end loop;

  -- Off for the tables in hand, and only those. Read from the catalogue rather
  -- than named, so a table that gains a guard tomorrow is covered tonight.
  foreach t in array p_tables loop
    if exists (
      select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      where c.relname = t and not g.tgisinternal
    ) then
      execute format('alter table %I disable trigger user', t);
    end if;
  end loop;

  foreach t in array p_tables loop
    -- `where ctid is not null` IS THE POINT, not noise. See the header.
    execute format('delete from %I where ctid is not null', t);
    get diagnostics n = row_count;
    total := total + n;
    tbl := t;
    removed := n;
    return next;
  end loop;

  foreach t in array p_tables loop
    if exists (
      select 1 from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
      where c.relname = t and not g.tgisinternal
    ) then
      execute format('alter table %I enable trigger user', t);
    end if;
  end loop;

  -- THE SETTINGS COME BACK WITH THE EMPTINESS. See config_restore_defaults()
  -- above for why. Done after the triggers are back on and before the audit
  -- row, so it is part of the same transaction: a reset that fails here rolls
  -- the whole thing back instead of leaving a raffle with no settings.
  if 'config' = any(p_tables) then
    perform config_restore_defaults();
  end if;

  -- LAST, and with the guard back on, so the row that says a reset happened is
  -- written by the same rules as every other audit row.
  insert into audit_log (action, details, email)
  values (
    'RAFFLE_RESET',
    jsonb_build_object('tables', to_jsonb(p_tables), 'removed', total),
    coalesce(nullif(p_by, ''), 'unknown')
  );
end
$$;
