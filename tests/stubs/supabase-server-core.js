/*
 * Stands in for npm:@supabase/server/core.
 *
 * The router builds a fresh admin client per request so that every call it
 * makes carries an x-request-id header — which is how a row written inside
 * settle_book gets stamped without that function growing a parameter. None of
 * that is reachable from Node: there is no PostgREST here to read the header
 * and no project to talk to.
 *
 * So this returns NOTHING, and the router keeps the client the test supplied.
 * Returning a hollow client instead would replace the fake database mid-request
 * and every handler test would go quiet — writes landing nowhere, reads coming
 * back empty, and the failure looking like the handler rather than the stub.
 */
export function createAdminClient() {
  return null
}
export default { createAdminClient }
