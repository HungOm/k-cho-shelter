/*
 * Stands in for npm:@supabase/server so index.ts can be loaded in Node.
 *
 * The real package wraps a fetch handler with credential verification and
 * client creation. None of that is what these tests are about — they are about
 * the registry and the handlers behind it — so this returns the handler
 * untouched and lets the test supply its own context.
 */
export function withSupabase(_opts, handler) {
  return handler
}
export default { withSupabase }
