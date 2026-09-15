/*
 * The client end of "something changed".
 *
 * WHAT TRAVELS IS NOTHING. A broadcast carrying { at } and no rows. That is the
 * security design rather than minimalism: every masking rule lives in
 * tickets_readable, a VIEW, and a view cannot be subscribed to. Subscribing to
 * the table would need select on tickets, which hands every subscriber raw
 * buyer names and phone numbers. So the socket is told nothing worth leaking
 * and the client fetches through the masked view it already uses.
 *
 * THE FAILURE THIS FILE EXISTS FOR IS SILENCE. Miss setAuth and the channel
 * connects and hears nothing. Sign in with an account that is not on the
 * allowlist and the policy correctly gives it nothing. Both are
 * indistinguishable from a quiet raffle, and a quiet raffle is the normal state
 * — so nothing would ever reveal it. Hence a status, and a poll that speeds
 * back up when the status is anything but live.
 */
import { readFileSync } from 'node:fs'
import { attach, coalesce, pollInterval, POLL_LIVE, POLL_ALONE } from '../src/lib/nudge.js'
import { cut } from './source.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const wait = ms => new Promise(r => setTimeout(r, ms))

/** A stand-in for the Realtime client, recording what it was asked to do. */
function fakeSb(subscribeWith = 'SUBSCRIBED') {
  const log = { auth: [], channels: [], handlers: [], removed: 0 }
  return {
    log,
    realtime: { setAuth: t => log.auth.push(t) },
    channel(name, opts) {
      log.channels.push({ name, opts })
      const ch = {
        on(kind, filter, fn) { log.handlers.push({ kind, filter }); ch._fire = fn; return ch },
        subscribe(cb) { setTimeout(() => cb(subscribeWith), 0); return ch },
      }
      log.ch = ch
      return ch
    },
    removeChannel() { log.removed++ },
  }
}

console.log('it subscribes to a broadcast, privately, and authorises the socket')
{
  const sb = fakeSb()
  const seen = []
  const stop = attach(sb, 'tok-1', () => seen.push('changed'), s => seen.push(s))
  await wait(10)
  ok(sb.log.auth[0] === 'tok-1', 'the socket is authorised before anything else')
  ok(sb.log.channels[0].name === 'raffle', 'on the raffle channel')
  ok(sb.log.channels[0].opts?.config?.private === true,
     'as a PRIVATE channel — a public one would be readable by anyone with the key')
  ok(sb.log.handlers[0].kind === 'broadcast', 'listening for a broadcast')
  ok(sb.log.handlers[0].filter.event === 'changed', 'for the changed event')
  ok(!sb.log.handlers.some(h => h.kind === 'postgres_changes'),
     'and NEVER to a table — that is the subscription that would need select on tickets')
  ok(seen.includes('connecting') && seen.includes('live'),
     'it says connecting, then live — silence is never assumed to be success')
  stop()
  ok(sb.log.removed === 1, 'and the channel is removed on teardown')
}

console.log('a burst of messages is one fetch')
{
  const sb = fakeSb()
  let fetches = 0
  attach(sb, 'tok', () => { fetches++ })
  await wait(10)
  // Settling a book writes tickets and books in one transaction, so two
  // messages arrive for one action. Two deltas for one action is a wasted round
  // trip on somebody's mobile data.
  sb.log.ch._fire({ payload: { at: 1 } })
  sb.log.ch._fire({ payload: { at: 1 } })
  await wait(300)
  ok(fetches === 1, 'two messages for one transaction cause one delta, not two')
}

console.log('and the coalescing is trailing, not leading')
{
  const hits = []
  const c = coalesce(() => hits.push(Date.now()), 50)
  c(); c(); c()
  ok(hits.length === 0, 'nothing fires on the first call — the transaction is still being written')
  await wait(80)
  ok(hits.length === 1, 'one fires after the burst settles')
  c(); c.cancel(); await wait(80)
  ok(hits.length === 1, 'and a cancelled burst never fires, so teardown leaves nothing pending')
}

console.log('the poll is re-timed by what the socket is doing, never removed')
{
  ok(pollInterval('live') === POLL_LIVE, 'a live channel makes the timer a safety net')
  ok(pollInterval('failed') === POLL_ALONE, 'a failed one makes it the only way anything is learnt')
  ok(pollInterval('off') === POLL_ALONE, 'so does no channel at all — Apps Script has none')
  ok(pollInterval('closed') === POLL_ALONE, 'and a closed one')
  ok(POLL_LIVE > POLL_ALONE, 'live is the longer interval')
  ok(POLL_ALONE <= 30_000, 'and alone is short enough to be the only mechanism')
}

console.log('a channel that will never speak says so')
{
  for (const bad of ['CHANNEL_ERROR', 'TIMED_OUT']) {
    const sb = fakeSb(bad)
    const seen = []
    attach(sb, 'tok', () => {}, s => seen.push(s))
    await wait(10)
    ok(seen.includes('failed'), `${bad} reports failed rather than staying on connecting`)
  }
  // Missing the token is the silent case 18 warned about: the channel connects
  // and hears nothing, which looks exactly like a raffle where nothing happened.
  const seen = []
  const stop = attach(fakeSb(), '', () => {}, s => seen.push(s))
  ok(seen[0] === 'failed', 'no token fails immediately rather than subscribing to silence')
  ok(typeof stop === 'function', 'and still returns a teardown, so callers need no special case')
}

console.log('the app re-times the poll when the status moves, and re-authorises on every token')
{
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const fn = cut(app, 'async function listenForChanges', 'async function supabaseSignIn', 'the subscriber')
  ok(/stopNudge\(\)/.test(fn), 'an existing channel is torn down before a new one is made')
  ok(/startPolling\(\)/.test(fn), 'and the interval is recomputed when the status changes')
  const onSession = cut(app, 'stopSession = await sbAuth.onSession', 'const session = await sbAuth.currentSession',
                        'the session subscription')
  ok(/listenForChanges\(session\.access_token\)/.test(onSession),
     'every token re-authorises the socket, including the refreshed ones nobody asked for')
  ok(/pollInterval\(nudgeStatus\)/.test(app), 'the timer reads the status rather than a constant')
  ok(!/POLL_MS/.test(app), 'and the fixed 30s constant is gone')
  ok(/if \(stopNudge\) \{ stopNudge\(\); stopNudge = null \}/.test(cut(app, 'async function signOut', 'await forgetCache', 'sign out')),
     'signing out drops the channel — a socket outliving the session is a leak with a heartbeat')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
