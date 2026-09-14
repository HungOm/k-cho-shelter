/**
 * Which backend the app talks to — Apps Script or Supabase.
 *
 * A migration where both ends have to change at the same moment is a migration
 * that gets rolled back at 11pm. This makes the choice a setting instead: the
 * same `api(action, payload)` either way, so nothing above this file knows or
 * cares which one answered.
 *
 * TWO WAYS TO CHOOSE, and the second is the one that matters during cutover:
 *
 *   1. Build time — VITE_BACKEND=appsscript | supabase in .env.local.
 *      Sets the default for everybody.
 *
 *   2. Run time — ?backend=supabase in the URL, remembered per device.
 *      This is how you try the new one on your own phone while every volunteer
 *      stays on the old one, which is the only safe way to test a raffle
 *      backend mid-raffle. ?backend=appsscript switches back; the flip takes
 *      effect on the next reload, with no deploy either way.
 *
 * Both transports return the same envelope — {ok, data} or
 * {ok:false, error:{code, message, details}} — because the Edge Function was
 * deliberately written to match what Apps Script already returned. That is what
 * keeps this file thin: it chooses a transport, it does not translate between
 * two different shapes.
 */
import { api as appsScriptApi, configure as configureAppsScript, ApiError } from './api.js'
import { api as supabaseApi, configure as configureSupabase, isSignedIn } from './supabaseApi.js'

export { ApiError }

const KEY = 'kcho_backend'
export const BACKENDS = ['appsscript', 'supabase']

/** URL wins and is remembered; then the device's choice; then the build default. */
function choose() {
  let chosen = null

  try {
    const fromUrl = new URLSearchParams(location.search).get('backend')
    if (BACKENDS.includes(fromUrl)) {
      localStorage.setItem(KEY, fromUrl)
      chosen = fromUrl
      // Drop it from the address bar so the choice is not re-applied by a
      // shared link — somebody pasting a URL to a colleague should not move
      // that colleague onto a half-migrated backend without knowing.
      history.replaceState(null, '', location.pathname + location.hash)
    } else {
      chosen = localStorage.getItem(KEY)
    }
  } catch {
    // Storage blocked (private window, locked-down profile). Fall through to
    // the build default rather than taking the whole module down — reading
    // localStorage at import time is exactly how this app went blank once.
  }

  if (!BACKENDS.includes(chosen)) chosen = import.meta.env?.VITE_BACKEND
  if (!BACKENDS.includes(chosen)) chosen = 'appsscript'
  return chosen
}

export const backend = choose()
export const isSupabase = backend === 'supabase'

/** For the settings screen: say which one is answering, and how it was picked. */
export function backendLabel() {
  return isSupabase ? 'Supabase' : 'Apps Script'
}

export function switchBackend(to) {
  if (!BACKENDS.includes(to)) throw new Error('Unknown backend: ' + to)
  try { localStorage.setItem(KEY, to) } catch { /* nothing we can do */ }
  location.reload()
}

export function configure(opts) {
  return isSupabase ? configureSupabase(opts) : configureAppsScript(opts)
}

export function api(action, payload, opts) {
  return isSupabase ? supabaseApi(action, payload, opts) : appsScriptApi(action, payload, opts)
}

/**
 * Whether the chosen backend has what it needs to make a call. The two want
 * different things — Apps Script a Google ID token, Supabase a session — so
 * asking "are we ready" has to go through here rather than being assumed.
 */
export function backendReady() {
  return isSupabase ? isSignedIn() : true
}
