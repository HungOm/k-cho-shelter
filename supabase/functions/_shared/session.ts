/**
 * Who is calling, on a project this code does not own.
 *
 * WHY THERE ARE TWO WAYS. `auth: 'user'` in @supabase/server verifies a session
 * by looking the signing key up in a JWKS, and it requires the token to name
 * which key signed it:
 *
 *     const { alg, kid } = decodeProtectedHeader(token)
 *     if (!alg || !kid) return INVALID
 *
 * Supabase-hosted projects sign with keys that have a `kid` and publish a JWKS,
 * so that path is exact and needs nothing from us. A self-hosted stack brought
 * up from the official docker-compose does not: it signs HS256 with one shared
 * `JWT_SECRET`, the header carries no `kid`, and there is no JWKS to look one
 * up in. Every request — every volunteer, every sale — is rejected, with a 401
 * that says nothing about why.
 *
 * So this file is the second way, and it exists ONLY for that stack. It is not
 * a fallback and nothing chooses it automatically: it is reached when, and only
 * when, the operator sets SUPABASE_JWT_SECRET on the function. On a hosted
 * project that variable is absent and none of this code runs — index.ts takes
 * the same `auth: 'user'` path it took before this file existed, which is the
 * point. A deployment that works today must not start depending on new code
 * to keep working.
 *
 * WHAT IT DOES NOT DO is decide who may do anything. Verification answers one
 * question — is this token really from this project's auth server, and is it
 * still valid — and hands the email to the gate, which reads app_users exactly
 * as it always has. Both paths arrive at the same line in index.ts with the
 * same claims. There is one allowlist, one permission table, one audit trail.
 */

/** The shape of Deno.env, and the reason these functions are testable. */
export type Env = { get(k: string): string | undefined }

export type SessionMode = 'platform' | 'secret'

/**
 * The claims of a verified session. `email` is the only one the gate reads;
 * the rest are carried so a handler that wants them is not tempted to parse
 * the token a second time.
 */
export type SessionClaims = {
  sub: string
  email: string
  role: string
  exp: number
  [k: string]: unknown
}

/**
 * Why a token was refused. Kept apart from the message shown to the person,
 * because only ONE of these is worth a retry: an expired token means sign in
 * again and carry on, and everything else means stop.
 */
export type Refusal =
  | 'not_configured'
  | 'malformed'
  | 'algorithm'
  | 'signature'
  | 'expired'
  | 'not_a_session'

export type SessionResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: Refusal }

/** The shared signing secret, or '' on a project that has none — the normal case. */
export function sessionSecret(env: Env): string {
  return (env.get('SUPABASE_JWT_SECRET') ?? '').trim()
}

/**
 * Which of the two ways this deployment verifies a caller.
 *
 * Read once, at boot, in index.ts. Deciding per request would mean a function
 * that changes how it authenticates depending on when you ask it.
 */
export function sessionMode(env: Env): SessionMode {
  return sessionSecret(env) ? 'secret' : 'platform'
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** base64url -> bytes, null rather than a throw on anything that is not. */
function fromBase64Url(part: string): Uint8Array | null {
  try {
    const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4))
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** One JWT segment as an object, or null if it is not one. */
function segment(part: string): Record<string, unknown> | null {
  const bytes = fromBase64Url(part)
  if (!bytes) return null
  try {
    const parsed = JSON.parse(decoder.decode(bytes))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Verify a session token against the project's shared secret.
 *
 * `nowMs` is a parameter so expiry can be tested at the boundary rather than by
 * waiting an hour.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SessionResult> {
  if (!secret) return { ok: false, reason: 'not_configured' }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [rawHeader, rawPayload, rawSignature] = parts

  const header = segment(rawHeader)
  if (!header) return { ok: false, reason: 'malformed' }

  /*
   * ONE ALGORITHM, NAMED, and compared before anything else is done with the
   * token. The header is written by whoever sent it, so a verifier that lets
   * the header choose the algorithm lets the attacker choose it too — `none`
   * verifies everything, and an asymmetric name turns a public key into a
   * signing key. The defence is not to detect those; it is to accept one value.
   */
  if (header.alg !== 'HS256') return { ok: false, reason: 'algorithm' }

  const signature = fromBase64Url(rawSignature)
  if (!signature) return { ok: false, reason: 'malformed' }

  let verified = false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    verified = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(`${rawHeader}.${rawPayload}`),
    )
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!verified) return { ok: false, reason: 'signature' }

  const payload = segment(rawPayload)
  if (!payload) return { ok: false, reason: 'malformed' }

  /*
   * AN EXPIRY IS REQUIRED, not merely honoured when present. A token with no
   * `exp` is valid until the secret changes, which on a self-hosted stack is
   * never. Auth issues none such; anything that turns up without one was minted
   * by something else.
   */
  const exp = payload.exp
  if (typeof exp !== 'number' || !isFinite(exp)) return { ok: false, reason: 'not_a_session' }
  if (exp * 1000 <= nowMs) return { ok: false, reason: 'expired' }

  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf * 1000 > nowMs) return { ok: false, reason: 'not_a_session' }

  /*
   * THE ROLE MUST BE `authenticated`, SAID AS A SET OF ONE.
   *
   * This is the sharp edge of a shared secret, and it is not obvious: on a
   * self-hosted stack the ANON KEY AND THE SERVICE KEY ARE THEMSELVES JWTs
   * SIGNED WITH THIS SAME SECRET. The anon key is printed in the page source of
   * the app. Presented as a Bearer token it carries a real signature and a real
   * expiry — years out — and differs from a session in one field: `role` reads
   * 'anon' or 'service_role' instead of 'authenticated'.
   *
   * So the test names what is allowed through rather than what is kept out. The
   * project has already paid for the other spelling: three defects in one day
   * from conditions phrased as "everything except", each one admitting a value
   * nobody had thought of yet. "Not the anon key" would have been such a
   * condition, and the value nobody thought of is whatever role a future
   * version of auth invents.
   */
  if (payload.role !== 'authenticated') return { ok: false, reason: 'not_a_session' }

  const sub = payload.sub
  if (typeof sub !== 'string' || !sub.trim()) return { ok: false, reason: 'not_a_session' }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!email) return { ok: false, reason: 'not_a_session' }

  return { ok: true, claims: { ...payload, sub, email, role: 'authenticated', exp } }
}

/**
 * The same `userClaims` the platform path puts on the context.
 *
 * Copied from jwtClaimsToUserClaims in @supabase/server rather than invented,
 * because index.ts reads this object and must not be able to tell which path
 * filled it. A handler that behaves differently on one of two backends is a
 * handler that is only tested on one of them.
 */
function userClaims(claims: SessionClaims) {
  return {
    id: claims.sub,
    role: claims.role,
    email: claims.email,
    appMetadata: claims.app_metadata,
    userMetadata: claims.user_metadata,
  }
}

/** The bearer token on a request, or '' — case-insensitive, as the header is. */
export function bearerToken(req: Request): string {
  const raw = (req.headers.get('authorization') ?? '').trim()
  const match = /^bearer\s+(.+)$/i.exec(raw)
  return match ? match[1].trim() : ''
}

/**
 * Wrap a handler so it only runs for a verified caller.
 *
 * `refuse` is supplied by the caller rather than built here, so the refusal
 * leaves the function in the SAME envelope every other error does. The client
 * reads `error.code` and renews its session on AUTH_EXPIRED; a 401 in a
 * different shape reaches that code as an unrecognised failure and the person
 * is told the server is broken rather than being signed back in.
 */
export function withSecretSession<C>(
  secret: string,
  refuse: (code: 'AUTH_REQUIRED' | 'AUTH_EXPIRED', message: string) => Response,
  handler: (req: Request, ctx: C) => Promise<Response>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req: Request, ctx: C) => {
    const token = bearerToken(req)
    if (!token) return refuse('AUTH_REQUIRED', 'No signed-in user.')

    const result = await verifySessionToken(token, secret)
    if (!result.ok) {
      /*
       * EXPIRED IS THE ONLY ONE WORTH RETRYING, and it is the common one: a
       * session lasts an hour and a volunteer works an afternoon. Saying so
       * lets the client refresh and repeat the call, which is what the hosted
       * path gets for free from the platform.
       */
      if (result.reason === 'expired') {
        return refuse('AUTH_EXPIRED', 'Your sign-in has expired. Signing in again…')
      }
      return refuse('AUTH_REQUIRED', 'That sign-in could not be verified.')
    }

    /*
     * Set on the context rather than spread into a copy. index.ts already
     * mutates ctx to stamp the request id, and the context carries a live
     * admin client — a shallow copy of it is a second object that handlers
     * further down may or may not be holding.
     */
    const target = ctx as unknown as Record<string, unknown>
    target.userClaims = userClaims(result.claims)
    target.jwtClaims = result.claims
    return handler(req, ctx)
  }
}
