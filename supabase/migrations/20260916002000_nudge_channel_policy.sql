-- Who may hear the nudge.
--
-- realtime.send(..., private => true) puts the message behind RLS on
-- realtime.messages. Without a policy the channel is silent — every subscriber
-- connects successfully and receives nothing, which is the hardest failure to
-- diagnose because nothing errors.
--
-- Gated on app_role() rather than merely on being signed in. A Google account
-- that has not been added to the allowlist can authenticate; it must not learn
-- that the raffle is active, who is working, or how often money moves. Timing is
-- information even when the payload is empty — the nudge carries no row data,
-- but a stream of them at 9pm on a Sunday says the raffle is being worked.

drop policy if exists raffle_nudge_read on realtime.messages;
create policy raffle_nudge_read on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'raffle'
    and app_role() is not null
  );
