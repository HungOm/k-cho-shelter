/**
 * Transport to the Apps Script backend.
 *
 * Writes go out as POST with Content-Type "text/plain". That keeps them CORS
 * "simple requests", so the browser never sends an OPTIONS preflight — which
 * Apps Script has no way to answer. Using application/json here is the classic
 * way to make every write fail with an opaque CORS error.
 */

export const LS = { url: 'kcho_api_url', cid: 'kcho_client_id', mode: 'kcho_sell_mode' }

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    this.details = details || null
  }
}

let apiUrl = ''
let idToken = ''
let idTokenExpiresAt = 0
let onAuthExpired = null

/** The token's own expiry, read from the JWT. Used only for timing. */
function readExpiry(jwt) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const exp = JSON.parse(atob(part)).exp
    return exp ? exp * 1000 : 0
  } catch { return 0 }
}

export function configure(opts) {
  if (opts.apiUrl !== undefined) apiUrl = opts.apiUrl
  if (opts.idToken !== undefined) {
    idToken = opts.idToken
    idTokenExpiresAt = readExpiry(idToken)
  }
  if (opts.onAuthExpired) onAuthExpired = opts.onAuthExpired
}

export function tokenExpiresAt() { return idTokenExpiresAt }

/** True when the token is gone or about to be. */
export function tokenIsStale(marginMs = 30_000) {
  return !!idToken && !!idTokenExpiresAt && Date.now() > idTokenExpiresAt - marginMs
}

/**
 * Renew before sending, not after failing.
 *
 * A phone suspends timers while it is locked, so the scheduled renewal may
 * never have run. Discovering that through a 401 means the person's first tap
 * after lunch fails and raises a sign-in prompt. Holding the request for a
 * moment instead means they see nothing at all.
 */
async function ensureFresh() {
  if (!onAuthExpired || !tokenIsStale()) return
  await onAuthExpired()
}

export function hasConnection() {
  return !!apiUrl
}

export async function api(action, payload = {}, opts = {}) {
  if (!apiUrl) throw new ApiError('NO_CONNECTION', 'Not connected to the spreadsheet yet.')

  // Skipped on the retry after a renewal, or it would renew about renewing.
  if (!opts.noRetry) await ensureFresh()

  let res
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, idToken, payload }),
      redirect: 'follow'
    })
  } catch {
    throw new ApiError('NETWORK',
      'Could not reach the server. Check your internet connection.')
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // Google serves an HTML sign-in page when the script still needs authorising.
    throw new ApiError('NOT_JSON',
      'The server did not answer properly. The Apps Script may need to be authorised, ' +
      'or re-deployed with access set to "Anyone".')
  }

  if (json.ok) return json.data

  const code = json.error?.code || 'ERROR'
  const message = json.error?.message || 'Something went wrong.'

  // Tokens last an hour and a helper keeps this page open all day. Renew
  // quietly rather than dumping them back at the sign-in screen mid-sale.
  if ((code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') && !opts.noRetry && onAuthExpired) {
    const renewed = await onAuthExpired()
    if (renewed) return api(action, payload, { ...opts, noRetry: true })
  }

  throw new ApiError(code, message, json.error?.details)
}
