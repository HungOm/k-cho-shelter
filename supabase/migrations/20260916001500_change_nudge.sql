-- A nudge, not the row.
--
-- The app polls read_version every thirty seconds to ask "has anything changed".
-- That is twelve questions a minute, all day, on a volunteer's mobile data, and
-- almost every one of them is answered "no".
--
-- THE OBVIOUS ALTERNATIVE IS THE DANGEROUS ONE. Realtime's postgres_changes
-- publishes from BASE TABLES; you cannot subscribe to a view. All of this app's
-- column masking lives in tickets_readable, and rls.sql revokes tickets, books,
-- agents and config from authenticated precisely so a browser cannot reach the
-- raw rows. Subscribing to ticket changes would mean granting select on tickets
-- — and the policy behind that grant already exists and already permits every
-- signed-in person to read raw buyer_name, buyer_phone, buyer_zone and notes.
-- One line, and the viewer mask, the helper narrowing and the notes blanking
-- all come off, through PostgREST as well as the socket.
--
-- So nothing about a row crosses the wire. The server says "something changed";
-- the client re-reads through the masked view it already uses. Every masking
-- rule holds without being restated anywhere, which is the property that makes
-- this safe rather than merely careful.

-- ============ PROVE REALTIME IS THERE, NOW ============
--
-- The trigger below swallows every error, because a broadcast failure must never
-- fail a sale. That is right at write time and wrong at install time: if
-- realtime.send does not exist, every nudge is silently a no-op and the only
-- symptom is an app that quietly keeps polling. Nobody investigates a feature
-- that was never noticed to be missing.
--
-- So it is called once here with no handler. If Realtime is unavailable this
-- migration fails loudly, in front of one person who can act on it, instead of
-- installing a mechanism that does nothing.

do $$
begin
  perform realtime.send(jsonb_build_object('at', 0), 'install-check', 'raffle', true);
end $$;

-- ============ THE BROADCAST ============

create or replace function notify_raffle_change() returns trigger as $$
begin
  /*
   * NOTHING FROM THE ROW. Not the id, not the ticket number, not who bought it.
   * A payload is a place for somebody later to add "just the ticket number, it
   * is not sensitive" — and a ticket number plus a timestamp is already a
   * record of when a particular ticket sold, readable by anyone on the channel.
   * An empty nudge cannot be widened by accident.
   */
  perform realtime.send(
    jsonb_build_object('at', extract(epoch from clock_timestamp())),
    'changed',
    'raffle',
    true            -- private: a signed-in session, not the open internet
  );
  return null;
exception when others then
  /*
   * A FAILED BROADCAST MUST NEVER FAIL THE WRITE.
   *
   * This trigger hangs off selling a ticket and counting a book in. If Realtime
   * is unavailable, mid-upgrade, or the extension is missing, the correct
   * outcome is a sale that is recorded and an app that falls back to its poll —
   * not a volunteer who cannot take money because a socket is down. The poll is
   * still there and still correct; this only makes it unnecessary.
   */
  return null;
end $$ language plpgsql security definer set search_path = public, realtime;

/*
 * STATEMENT LEVEL, and that is the whole difference between this and a flood.
 *
 * A row-level trigger on a 500-row bulk_record_sales sends five hundred
 * messages, each one telling every connected phone to re-read the same delta.
 * The nudge says "something changed" — it does not say what, so once per
 * statement carries exactly as much information as once per row.
 */
drop trigger if exists tickets_changed on tickets;
create trigger tickets_changed
  after insert or update or delete on tickets
  for each statement execute function notify_raffle_change();

drop trigger if exists books_changed on books;
create trigger books_changed
  after insert or update or delete on books
  for each statement execute function notify_raffle_change();
