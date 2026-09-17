/**
 * Transport to the Supabase Edge Function.
 *
 * Deliberately the same shape as api.js — same signature, same ApiError, same
 * timeout behaviour including WRITE_UNCONFIRMED — so backend.js can choose
 * between them and nothing above notices. Where this differs from api.js, it is
 * because the two backends genuinely differ, and each of those places says so.
 *
 * THE DIFFERENCE THAT MATTERS: Apps Script carried a Google ID token in the
 * request body, and verified it by calling Google on every request. Here the
 * caller carries a Supabase session in the Authorization header and the JWT is
 * verified locally by the platform. Same person, same allowlist, no outbound
 * call.
 */
import { ApiError, LS } from './errors.js'

export { ApiError }

// Same numbers as api.js. Supabase is far quicker, but a timeout is not a
// performance setting — it is how long we wait before deciding something is
// wrong, and being wrong about that costs a volunteer a duplicated entry.
const READ_TIMEOUT_MS = 20_000
const WRITE_TIMEOUT_MS = 45_000

const WRITES = new Set([
  'sell_ticket', 'reserve_ticket', 'release_ticket', 'correct_ticket', 'void_ticket',
  'bulk_record_sales', 'sell_book', 'issue_books', 'transfer_books', 'return_books',
  'move_tickets',
  'settle_book', 'set_book_status', 'restock_books', 'upsert_agent', 'upsert_user',
  'set_user_status', 'set_permission', 'request_approval', 'cancel_approval',
  'decide_approval', 'decide_book_request',
  'record_winner', 'expand_tickets', 'set_active_tickets',
  'set_ticket_ceiling', 'roll_check_in', 'set_final_deadline', 'record_check_in',
  'set_check_in_date', 'set_sales_close',
  'upload_logo', 'set_brand_color',
  'record_payment', 'reverse_payment',
  'upsert_prize', 'remove_prize', 'upsert_prize_type', 'set_winner_status',
  'acknowledge_books',
  'report_back',
  'write_off',
])

let functionUrl = ''
let accessToken = ''
let onAuthExpired = null

export function configure(opts = {}) {
  if (opts.apiUrl !== undefined) {
    // Accept either the project URL or the full function URL, because both get
    // pasted and the difference is not obvious from looking at them.
    const base = String(opts.apiUrl).replace(/\/+$/, '')
    functionUrl = base.includes('/functions/v1/') ? base : base + '/functions/v1/api'
  }
  if (opts.idToken !== undefined) accessToken = opts.idToken
  if (opts.onAuthExpired) onAuthExpired = opts.onAuthExpired
}

export function isSignedIn() {
  return !!functionUrl && !!accessToken
}

export function hasConnection() {
  return !!functionUrl
}

export async function api(action, payload = {}, opts = {}) {
  if (!functionUrl) {
    throw new ApiError('NO_CONNECTION', 'The Supabase project address is not set.')
  }
  if (!accessToken) {
    // Said plainly rather than as a 401, because during the migration the
    // likeliest cause is not an expired session but this backend being selected
    // before Supabase sign-in exists on this device.
    throw new ApiError('AUTH_REQUIRED',
      'Not signed in to Supabase. Sign in again, or switch back to the Apps Script backend.')
  }

  const write = WRITES.has(action)
  const stop = new AbortController()
  // `opts.timeoutMs` overrides, which is how the timeout behaviour can be
  // tested at all — waiting 45 real seconds to assert that a write gives up is
  // not a test anybody runs twice. It was in the transport this replaced and
  // was not carried across, so nothing here could be driven to the boundary.
  const limit = opts.timeoutMs || (write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS)
  const timer = setTimeout(() => stop.abort(), limit)

  let res
  try {
    res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken,
      },
      body: JSON.stringify({ action, payload }),
      signal: stop.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err?.name === 'AbortError') {
      // A write that timed out may well have succeeded — the row written while
      // the reply was still in flight. Telling somebody it failed is how a
      // stack of stubs gets entered twice.
      throw new ApiError(
        write ? 'WRITE_UNCONFIRMED' : 'TIMEOUT',
        write
          ? 'That is taking longer than expected. Checking what went through…'
          : 'The server did not answer in time. Try again.',
        // Named, so the toast and the log can say WHICH call is being checked.
        // A "checking what went through" with no action in it is untraceable
        // the moment two things are in flight.
        { action, waitedMs: limit },
      )
    }
    throw new ApiError('NETWORK', 'Could not reach the server. Check your internet connection.')
  }
  clearTimeout(timer)

  let json
  try {
    json = await res.json()
  } catch {
    throw new ApiError('NOT_JSON',
      'The server did not answer properly. The Edge Function may not be deployed yet.')
  }

  if (json.ok) return json.data

  const code = json.error?.code || 'ERROR'
  const message = json.error?.message || 'Something went wrong.'

  if ((code === 'AUTH_EXPIRED' || code === 'AUTH_REQUIRED') && !opts.noRetry && onAuthExpired) {
    const renewed = await onAuthExpired()
    if (renewed) return api(action, payload, { ...opts, noRetry: true })
  }

  throw new ApiError(code, message, json.error?.details)
}

export { LS }
