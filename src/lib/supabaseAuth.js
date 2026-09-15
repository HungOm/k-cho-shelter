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
 * A nonce, in the two forms the two ends need.
 *
 * Google is given the HASH and puts it in the token it signs; Supabase is given
 * the original and checks that it hashes to what the token carries. So a token
 * captured from one page load cannot be replayed into another, and neither end
 * ever sees the other's half. Hex rather than base64url because that is what
 * Supabase compares against.
 */
export async function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = btoa(String.fromCharCode(...bytes))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

/**
 * Trade the Google token for a Supabase session, without leaving the page.
 *
 * WHY NOT THE REDIRECT. signInWithOAuth below sends the browser to the project
 * at <ref>.supabase.co, so Google's consent screen names that host — a forty
 * character random string, which is exactly what a phishing page looks like to
 * somebody being careful. Here the sign-in happens on our own origin, so Google
 * names the site the volunteer typed in, and there is no navigation away and
 * back on a phone with one bar of signal.
 *
 * The same Google account, the same allowlist row; only the route changes.
 *
 * THIS NEEDS A SETTING ON THE PROJECT. Supabase will only accept a token minted
 * for a client id it has been told to trust, so the id has to be listed under
 * Authentication -> Providers -> Google -> Authorized Client IDs. Without it
 * every sign-in is refused, so the refusal says so rather than reporting a
 * rejected credential.
 */
export async function signInWithGoogleToken(credential, nonce) {
  const sb = await getClient()
  if (!sb) throw new Error('The Supabase project address is not set on this device.')
  const { data, error } = await sb.auth.signInWithIdToken({
    provider: 'google', token: credential, nonce
  })
  if (error) {
    if (!/client|audience|provider|nonce/i.test(error.message || '')) throw new Error(error.message)
    // Two audiences, one failure. The volunteer holding the phone needs to know
    // it is not them and that trying again will not help; the organiser needs
    // the checkbox. Putting the dashboard path in front of the volunteer tells
    // somebody in Klang to open a console they have no login for, and reads as
    // the app being broken — which is how a one-checkbox problem becomes a day
    // of people giving up quietly.
    const err = new Error('Sign-in is not set up on this raffle yet.')
    err.notYou = true
    err.detail = 'For the organiser: the app\'s Google client ID has to be listed under ' +
      'Authentication → Providers → Google → Authorized Client IDs on the Supabase project. ' +
      'Until it is, every sign-in is refused.'
    throw err
  }
  if (!data?.session?.access_token) throw new Error('Google signed in but no session came back.')
  return data.session
}

/**
 * The old route, kept for when there is no Google client id on this build.
 *
 * Not a fallback for the one above: if the token exchange is refused, that is a
 * setting somebody has to change, and quietly redirecting instead would hide it
 * behind the ugly consent screen it exists to avoid. Reachable deliberately
 * with ?signin=redirect.
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
