/**
 * Supabase sign-in.
 *
 * The Edge Function is declared `auth: 'user'`, which means it verifies a
 * Supabase session JWT against the project's own keys. A Google ID token from
 * GIS is not that — it is signed by Google, for a Google client id, and the
 * function has no reason to trust it. So on the Supabase backend the sign-in
 * has to go *through* Supabase Auth's Google provider rather than talking to
 * Google directly. Same Google account, same person, same allowlist row in
 * app_users; only the thing that proves it changes.
 *
 * WHAT THIS REMOVES. api.js carries a small machine for surviving the fact that
 * a Google ID token dies after an hour: an expiry parse, a renewal timer, a
 * wake-on-visibility check, a deduplicated silent renew, and a ReAuth overlay
 * for when the silent renew fails. None of that is needed here. Supabase
 * refreshes its own session in the background and reports the new token through
 * onAuthStateChange, so the whole hourly dance collapses into one subscription.
 * The Apps Script machinery stays where it is — it is still correct for that
 * backend, and it deletes itself the day Apps Script goes away, not before.
 *
 * WHERE THE PROJECT ADDRESS COMES FROM. Build-time env first, so a normal
 * deployment needs nothing pasted; then localStorage, so a single link can set
 * a phone up mid-cutover the same way the spreadsheet link already does. The
 * publishable key is not a secret — it identifies the project and grants
 * nothing on its own. Everything it can reach is decided by RLS, in the
 * database, for the signed-in person.
 */

export const LS_SB = {
  url: 'kcho_sb_url',
  key: 'kcho_sb_key'
}

function fromStorage(k) {
  try { return (localStorage.getItem(k) || '').trim() } catch { return '' }
}

export function projectUrl() {
  return (import.meta.env?.VITE_SUPABASE_URL || fromStorage(LS_SB.url) || '').replace(/\/+$/, '')
}

export function publishableKey() {
  return import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || fromStorage(LS_SB.key) || ''
}

export function isConfigured() {
  return !!projectUrl() && !!publishableKey()
}

/**
 * One client for the process, built on first use.
 *
 * Deliberately not built at import time: this module is imported by backend.js
 * on every load, including the Apps Script path where no Supabase project is
 * configured at all, and createClient with an empty URL throws. An import that
 * can throw takes the whole app blank before it renders anything — which has
 * happened here once already, reading localStorage at module scope.
 */
let client = null

export async function getClient() {
  if (client) return client
  if (!isConfigured()) return null
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(projectUrl(), publishableKey(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The OAuth redirect comes back with the session in the URL fragment.
      // Letting the library take it out of the address bar means a reload does
      // not replay a used code, and the token never reaches a server log.
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  })
  return client
}

/**
 * Send them to Google.
 *
 * This navigates away and comes back, which is why nothing here returns a
 * session: the answer arrives on the next page load, through getSession().
 * redirectTo is pinned to the page they left so the app returns to the same
 * deployment — a raffle volunteer may be on a github.io path, not a domain
 * root, and Supabase will only honour a URL that is on the project's allow
 * list anyway.
 */
export async function signIn() {
  const sb = await getClient()
  if (!sb) throw new Error('The Supabase project address is not set on this device.')
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname }
  })
  if (error) throw error
}

export async function currentSession() {
  const sb = await getClient()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data?.session || null
}

/**
 * Every later token, including the ones the library fetches on its own.
 *
 * Returns an unsubscribe so a hot reload does not stack listeners and configure
 * the transport five times per refresh.
 */
export async function onSession(cb) {
  const sb = await getClient()
  if (!sb) return () => {}
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session || null))
  return () => { try { data?.subscription?.unsubscribe() } catch { /* already gone */ } }
}

/**
 * Force a refresh and say whether one arrived.
 *
 * Handed to the transport as onAuthExpired. It should almost never fire —
 * autoRefreshToken gets there first — but "almost never" on a phone that was
 * asleep is not never, and the alternative is a failed write in front of
 * somebody holding a stub.
 */
export async function refreshSession() {
  const sb = await getClient()
  if (!sb) return false
  const { data, error } = await sb.auth.refreshSession()
  return !error && !!data?.session?.access_token
}

export async function signOut() {
  const sb = await getClient()
  if (!sb) return
  try { await sb.auth.signOut() } catch { /* leaving anyway */ }
}
