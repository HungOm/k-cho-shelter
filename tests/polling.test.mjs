/*
 * The owner finds out that a request arrived.
 *
 * Their Approvals tab was open when one came in and said "Nothing waiting". The
 * row was in the database the whole time; the page loads once and then knows
 * nothing. A request nobody is told about is the same as no request, and the
 * person who asked is left wondering whether the button worked.
 *
 * WHAT IS BEING PROTECTED, and both halves matter:
 *
 * That it asks. poll() reads the count off read_version — a call the app
 * already makes — so hearing about an approval costs no extra round trip.
 *
 * That it STOPS asking. This runs on volunteers' own phones, on their own
 * mobile data, all day. A timer that keeps polling from inside a pocket spends
 * their battery and their money answering a question nobody is looking at. The
 * tab going out of view has to stop it, and coming back has to ask at once so
 * the wait is never the interval — it is however long it takes to look.
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] }
}
globalThis.indexedDB = undefined

import { readFileSync } from 'node:fs'
import { pollInterval, POLL_LIVE, POLL_ALONE } from '../src/lib/nudge.js'
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

let waiting = 0, version = 1, asked = 0
globalThis.fetch = async (url, o) => {
  const { action } = JSON.parse(o.body)
  const reply = d => ({ text: async () => JSON.stringify({ ok: true, data: d }),
                        json: async () => ({ ok: true, data: d }) })
  if (action === 'read_version') {
    asked++
    return reply({ tickets: version, serverTime: '2026-01-01T00:00:00Z',
                   approvalsWaiting: waiting })
  }
  return reply({})
}

const store = await import('../src/lib/store.js')
const { configure } = await import('../src/lib/supabaseApi.js')
configure({ apiUrl: 'https://example.test/exec', idToken: 'x.y.z' })
const { state, poll } = store

console.log('nothing has said yet, which is not the same as nobody waiting')
ok(state.pendingApprovals === null,
   `starts null so refresh can tell the two apart, got ${state.pendingApprovals}`)

console.log('one call answers both questions')
state.ticketVersion = 1
waiting = 3
await poll()
ok(asked === 1, `read_version was called once, got ${asked}`)
ok(state.pendingApprovals === 3, `the count arrived (${state.pendingApprovals})`)

console.log('and it keeps up as things change')
waiting = 0
await poll()
ok(state.pendingApprovals === 0, 'a cleared queue goes back to none')

console.log('a poll that fails is not news')
{
  const boom = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  let threw = null
  try { await poll() } catch (e) { threw = e }
  ok(threw === null, 'a dead network does not throw out of poll()')
  ok(state.pendingApprovals === 0, 'and does not invent a count')
  globalThis.fetch = boom
}

console.log('the loop stops when nobody is looking')
const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
ok(/visibilityState !== 'visible'\) return/.test(app),
   'starting while hidden is refused')
ok(/visibilityState === 'visible' \? startPolling\(\) : stopPolling\(\)/.test(app),
   'visibility drives it both ways')
ok(/function startPolling[\s\S]{0,200}poll\(\)\n\s+pollTimer = setInterval/.test(app),
   'coming back polls at once, not after a full interval')
ok(/removeEventListener\('visibilitychange', onVisibility\)/.test(app) &&
   /stopPolling\(\)/.test(app.slice(app.indexOf('onUnmounted(() =>'))),
   'and it is torn down on unmount')
/*
 * The interval is no longer a constant, and the reason strengthens the original
 * point rather than replacing it.
 *
 * Thirty seconds was chosen because this is a raffle, not a trading floor, and
 * a hundred phones asking twelve times a minute all day is somebody's mobile
 * data. A live nudge makes the timer a safety net for what a socket cannot
 * cover — Realtime unavailable, a captive portal, a phone asleep through six
 * sales — so five minutes is right. With no channel it is the only way anything
 * is learnt, so thirty stands.
 *
 * Asserted through the module rather than by grepping for a number, so the rule
 * is tested where it is decided.
 */
ok(/pollInterval\(nudgeStatus\)/.test(app), 'the interval follows what the socket is doing')
ok(pollInterval('live') === POLL_LIVE && POLL_LIVE === 5 * 60 * 1000,
   'five minutes with a live channel — a raffle, not a trading floor')
ok(pollInterval('failed') === POLL_ALONE && POLL_ALONE === 30_000,
   'and thirty seconds when the timer is the only mechanism there is')

console.log('and the list under the badge reloads with it')
{
  const ap = readFileSync(new URL('../src/components/Approvals.vue', import.meta.url), 'utf8')
  // Screens live inside <KeepAlive>, so onMounted fires ONCE for the session.
  // Navigating away and back does not remount. Without these two the badge said
  // 1 while the page under it said "No one has asked for anything" — two
  // numbers from the same app disagreeing in front of the person deciding.
  ok(/onActivated\(load\)/.test(ap), 'coming back to the tab reloads it')
  ok(/watch\(\(\) => state\.pendingApprovals/.test(ap),
     'and sitting on it when the count moves reloads it too')
  ok(/onMounted\(load\)/.test(ap), 'first paint still loads')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
