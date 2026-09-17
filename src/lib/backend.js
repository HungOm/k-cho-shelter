/**
 * The one way the app talks to the server.
 *
 * WHAT THIS USED TO BE. A switch between two backends — Apps Script or Supabase
 * — chosen at build time by `VITE_BACKEND` and overridable per device with
 * `?backend=`. That existed so a migration did not need both ends to change at
 * the same moment, which is the kind of migration that gets rolled back at 11pm.
 * It did its job; the migration finished; the spreadsheet is gone.
 *
 * Worth recording, because the shape of it was a hazard right up to the end:
 * with `VITE_BACKEND` unset and nothing in localStorage, the fallback was
 * `appsscript`. A build that forgot the variable pointed the whole raffle at
 * the older, weaker backend, and nothing on any screen said so.
 *
 * WHAT IT STILL DOES is the one branch that is not about a backend at all:
 * whether a row read goes straight to PostgREST or through the Edge Function.
 */
import { api as supabaseApi, configure as configureSupabase, isSignedIn } from './supabaseApi.js'
import { DIRECT_READS, directRead } from './supabaseReads.js'
import { ApiError } from './errors.js'

export { ApiError }

const DIRECT_KEY = 'kcho_direct_reads'

/**
 * Whether row reads go straight to PostgREST instead of through the function.
 *
 * On by default, because it is the entire performance difference:
 * 57-82ms direct against 340-1000ms through the function, which adds 300-700ms
 * per call however little it does. A read-heavy app cannot absorb that.
 *
 * Switchable at run time — ?directreads=off. If the views misbehave in front of
 * volunteers, somebody needs a way back to the known-good path on one phone,
 * now, without a deploy. It is
 * NOT an automatic fallback. A read that silently retried through the function
 * would hide a broken view behind a slow one, and the day rls.sql is wrong is
 * the day you most need to be told.
 */
function chooseDirect() {
  /*
   * TWO LOOKUPS, TWO try BLOCKS, and that is the fix rather than the style.
   *
   * They shared one. So anything that threw while reading the URL — no
   * `location` at all, a locked-down profile, a `history` the page may not
   * touch — skipped straight past the SAVED preference to the default. The
   * device setting was silently ignored in exactly the situations somebody had
   * set it for, and the only sign was the app being slow.
   */
  try {
    const p = new URLSearchParams(location.search).get('directreads')
    if (p === 'off' || p === 'on') {
      try { localStorage.setItem(DIRECT_KEY, p) } catch { /* not remembered, still applied */ }
      history.replaceState(null, '', location.pathname + location.hash)
      return p === 'on'
    }
  } catch { /* no readable URL; fall through to what the device remembers */ }

  try {
    const saved = localStorage.getItem(DIRECT_KEY)
    if (saved === 'off' || saved === 'on') return saved === 'on'
  } catch { /* storage blocked; the default below is the safe one */ }

  return true
}

export const directReads = chooseDirect()

export function configure(opts) {
  return configureSupabase(opts)
}

export function api(action, payload, opts) {
  // Row reads go to the database; everything else — every write, every report,
  // every approval — goes to the function, where the gate and the audit log
  // are. Both return the same envelope, so nothing above here can tell which
  // answered, and that is the only reason this line is safe.
  if (directReads && DIRECT_READS.has(action)) return directRead(action, payload)
  return supabaseApi(action, payload, opts)
}

/** Whether there is a session to make a call with. */
export function backendReady() {
  return isSignedIn()
}
