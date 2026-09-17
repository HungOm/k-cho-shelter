/**
 * The error every layer throws, and the handful of localStorage keys the app
 * keeps for itself.
 *
 * WHY THIS FILE EXISTS. Both lived in `api.js`, the Apps Script transport —
 * which meant the Supabase path imported its error class, and the client's
 * sell-mode preference, out of the backend it does not use. Deleting that file
 * would have taken `ApiError` with it, and `ApiError` is what `store.js`,
 * `supabaseApi.js` and `supabaseReads.js` all throw and catch.
 *
 * So the two things that were never about a transport live here, where nothing
 * has to be deleted around them next time.
 */

/**
 * What the app remembers on the device.
 *
 * ONE KEY, and it is a UI preference rather than anything about the server. The
 * three that used to sit beside it — the Apps Script `/exec` URL, the Google
 * client id, and a cached Google ID token — went with that backend. The
 * Supabase session is kept by the Supabase client itself under its own keys,
 * and the project it belongs to is built into the bundle, so there is nothing
 * for a volunteer to paste and nothing here to hold.
 */
export const LS = {
  mode: 'kcho_sell_mode',
}

/**
 * A refusal with a code on it.
 *
 * The code is what the app branches on and what the Burmese lookup is keyed by;
 * the message is the English sentence underneath. `details` carries whatever
 * the screen needs to say something more specific — which book, how much was
 * owed — without parsing the message.
 */
export class ApiError extends Error {
  constructor(code, message, details) {
    super(message)
    this.code = code
    this.details = details || null
  }
}
