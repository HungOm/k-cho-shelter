/**
 * The front door on a self-hosted stack — and nowhere else.
 *
 * WHAT SUPPLIES THIS ON A HOSTED PROJECT. Supabase routes
 * /functions/v1/<name> to the right function itself; there is nothing to write
 * and this file is never loaded. A self-hosted stack runs one edge-runtime
 * container over the whole functions directory:
 *
 *     edge-runtime start --main-service /home/deno/functions/main
 *
 * and every request — for any function — arrives HERE. If this file does not
 * exist, nothing is served at all. So it is the one piece of the deployment
 * that hosted gets for free and self-hosted has to be given.
 *
 * It is excluded from `supabase functions deploy` by `enabled = false` in
 * config.toml, because deployed to a hosted project it would be a third
 * function that does nothing but confuse whoever finds it.
 *
 * ---
 *
 * WHY IT DOES NOT CHECK A JWT, which is the thing to understand before
 * changing it.
 *
 * On a hosted project the platform checks one before the function runs —
 * `verify_jwt` in config.toml, true for `api` and false for `verify`. That
 * check is a second lock in front of our own, and config.toml says so at
 * length. A self-hosted edge-runtime has one global setting for the container
 * and cannot express "true for this one, false for that one", so the split has
 * to live somewhere.
 *
 * It lives in the functions, where it already lived. `api` verifies its own
 * caller — on this stack through withSecretSession, which is stricter than the
 * platform check because it also requires the token to be a SESSION rather than
 * any token this project's secret ever signed. `verify` is public on purpose
 * and reaches two columns, for a stranger in the hall with a phone. Repeating
 * the check here would mean two places that decide who gets in, and the day
 * they disagree is the day the answer depends on which one you read.
 *
 * So: run the container with JWT verification OFF and let the functions do it.
 * Turning it on instead does not harden `api` — it already refuses — it breaks
 * the ticket check, silently, for everyone who scans a QR.
 */

/**
 * WHAT MAY BE ASKED FOR, as a list of names rather than a rule.
 *
 * The obvious shape is to take the first path segment and serve
 * `./functions/<it>`. That serves anything in the mounted directory to anybody
 * who can spell it — including `_shared`, which is not a function, and
 * including whatever the next person adds to this folder for a reason that had
 * nothing to do with the open internet.
 *
 * tests/selfhost.test.mjs compares this list against the functions on disk and
 * against config.toml, so adding a third function and forgetting this line
 * fails the run rather than 404-ing on one kind of deployment only.
 */
const FUNCTIONS = new Set(['api', 'verify'])

/** Provided by edge-runtime; not part of the Deno namespace. */
declare const EdgeRuntime: {
  userWorkers: {
    create(opts: {
      servicePath: string
      memoryLimitMb: number
      workerTimeoutMs: number
      noModuleCache: boolean
      importMapPath: string | null
      envVars: [string, string][]
    }): Promise<{ fetch(req: Request): Promise<Response> }>
  }
}

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * The function being asked for.
 *
 * Kong strips `/functions/v1/` before forwarding, so in the normal case the
 * path is already `/api`. It is stripped here as well because a stack without
 * Kong in front of it — a bare container, somebody testing on port 9000 —
 * passes the whole path through, and a router that only works behind a proxy
 * is one nobody can test directly.
 */
function functionName(pathname: string): string {
  const parts = pathname.replace(/^\/+/, '').split('/')
  if (parts[0] === 'functions' && parts[1] === 'v1') parts.splice(0, 2)
  return parts[0] ?? ''
}

Deno.serve(async (req: Request) => {
  const name = functionName(new URL(req.url).pathname)

  if (!FUNCTIONS.has(name)) {
    /*
     * The same answer for "no such function" and "not one you may reach", so
     * the directory cannot be mapped from outside. There are two functions and
     * both are named in the app; there is nothing to discover here.
     */
    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such function.' } }, 404)
  }

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `./functions/${name}`,
      memoryLimitMb: 256,
      // Generous, and deliberately so: a print run builds artwork for a
      // thousand tickets in one call. The hosted platform allows minutes.
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      importMapPath: null,
      /*
       * EVERY VARIABLE THE CONTAINER HAS, passed through. The functions read
       * SUPABASE_URL, the keys, SUPER_ADMIN_EMAIL and — on this stack —
       * SUPABASE_JWT_SECRET. A worker that starts without them does not fail
       * at boot; it fails on the first request, as a 500 with no session,
       * which reads as the raffle being broken rather than as a missing line
       * in an env file.
       */
      envVars: Object.entries(Deno.env.toObject()) as [string, string][],
    })
    return await worker.fetch(req)
  } catch (err) {
    /*
     * The worker could not be started — a syntax error in the function, a
     * memory limit, a missing file. Said as a 500 with the reason, because the
     * only person who sees this is whoever is bringing the stack up.
     */
    return json(
      {
        ok: false,
        error: {
          code: 'FUNCTION_UNAVAILABLE',
          message: `The ${name} function could not be started.`,
          details: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    )
  }
})
