/**
 * "Something changed" — and nothing else.
 *
 * WHAT TRAVELS. A broadcast on one channel carrying { at: <epoch> }. No rows,
 * no table names, no ids. That is deliberate and it is the security design
 * rather than a minimalism: every masking rule this app has lives in
 * tickets_readable, and a view cannot be subscribed to. A subscription to the
 * TABLE would need select on tickets, which would hand every subscriber raw
 * buyer names and telephone numbers — so the socket is told nothing worth
 * leaking, and the client fetches through the masked view it already uses.
 *
 * WHAT HAPPENS ON A MESSAGE. Exactly the read_delta the timer already ran. The
 * reconciliation does not change at all; only the trigger moves.
 *
 * THE TIMER STAYS. Not as a fallback for a dropped socket — the library
 * reconnects — but as the thing still correct when a nudge never arrives at
 * all: Realtime unavailable, a captive portal, a phone asleep through six
 * sales. What changes is the interval. Thirty seconds was twelve questions a
 * minute all day on a volunteer's own data; five minutes is a safety net.
 */

/** How often to ask anyway, given what the socket is doing. */
export const POLL_LIVE = 5 * 60 * 1000
export const POLL_ALONE = 30 * 1000

export function pollInterval(status) {
  return status === 'live' ? POLL_LIVE : POLL_ALONE
}

/**
 * Coalesce a burst into one fetch.
 *
 * Not because of volume — the triggers are statement level, so one sale of five
 * hundred tickets sends ONE message. It is because settling a book writes
 * tickets and books in one transaction and produces two, and two deltas for one
 * action is a wasted round trip on a phone.
 *
 * Leading edge would show the first change before the second had been written.
 * Trailing is right here: the delay is a fifth of a second and what arrives is
 * the whole transaction.
 */
export function coalesce(fn, ms = 200) {
  let timer = null
  const run = () => { timer = null; fn() }
  const out = () => { clearTimeout(timer); timer = setTimeout(run, ms) }
  out.cancel = () => { clearTimeout(timer); timer = null }
  return out
}

/**
 * Subscribe, and say honestly whether it worked.
 *
 * A SILENT CHANNEL IS THE EXPECTED FAILURE. Miss setAuth and it connects and
 * hears nothing; sign in with an account that is not on the allowlist and the
 * policy correctly gives it nothing. Both are indistinguishable from "the
 * raffle is quiet", which is why this reports a status rather than leaving the
 * caller to infer one from silence that may never break.
 *
 * `onStatus` is called with: connecting, live, failed, closed.
 */
export function attach(sb, token, onChange, onStatus = () => {}) {
  if (!sb || !token) { onStatus('failed'); return () => {} }

  // Private channels are authorised from the socket's own token, not from the
  // one the REST client carries. Missing this is the silent-channel case.
  try { sb.realtime.setAuth(token) } catch { onStatus('failed'); return () => {} }

  const fire = coalesce(onChange)
  onStatus('connecting')

  const channel = sb.channel('raffle', { config: { private: true } })
    .on('broadcast', { event: 'changed' }, () => fire())
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') return onStatus('live')
      // CHANNEL_ERROR and TIMED_OUT both mean the nudge is not arriving. The
      // library keeps retrying; the caller's job is to keep asking meanwhile.
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') return onStatus('failed')
      if (s === 'CLOSED') return onStatus('closed')
    })

  return () => {
    fire.cancel()
    try { sb.removeChannel(channel) } catch { /* already gone */ }
    onStatus('closed')
  }
}
