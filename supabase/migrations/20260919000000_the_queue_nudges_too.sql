-- A request waiting on somebody was the one change nobody was told about.
--
-- 20260916001500 made the app say "something changed" over a socket instead of
-- asking twelve times a minute, and hung that on tickets and books — the two
-- tables a sale touches. pending_approvals was not on the list, because when
-- that was written every row in the queue was answered by the person watching
-- the screen it appeared on, or by an organiser who was about to look anyway.
--
-- OFFERING BOOKS BROKE THAT ASSUMPTION. An offer is written by an organiser and
-- answered by a SELLER, who is not watching the Approvals screen and has no
-- reason to open it — the whole point is that the books are waiting on them.
-- Under the socket alone they learn about it on their next poll, and the poll
-- interval is deliberately long precisely because the socket is supposed to
-- carry the urgent things.
--
-- It is not only offers. A seller who asks for books sits watching for an
-- answer; a report sent for counting-in is the same. Each of those already
-- changes a row in this table the moment it is decided, and each of them left
-- the person who cared most to find out by refreshing.
--
-- THE SAME NUDGE, and deliberately not a different one. It carries nothing from
-- the row — not the id, not who asked, not what for — so a seller's phone being
-- told "something changed" reveals nothing about anybody else's request. The
-- client then re-reads through list_approvals, which is already scoped to who
-- is asking: an organiser's queue, a seller's own rows and the offers addressed
-- to them, and nothing else. The scoping is not restated here and cannot drift.
--
-- STATEMENT LEVEL, for the reason the first two are: a decision that touches
-- several rows is still one thing that happened, and the nudge says only that
-- something did.
--
-- notify_raffle_change() swallows its own errors, so a broadcast failure cannot
-- fail the write that triggered it. An organiser must be able to grant a book
-- with the socket down.
--
-- DATA LOSS RISK: NO. One trigger is added to an existing table.

drop trigger if exists pending_approvals_changed on pending_approvals;
create trigger pending_approvals_changed
  after insert or update or delete on pending_approvals
  for each statement execute function notify_raffle_change();
