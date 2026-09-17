/**
 * Who may do what — ported from Auth.gs, with the same rules in the same order.
 *
 * The ordering is not stylistic. Super admin first, then the super-admin-only
 * bar, then the permissions table, then the registry default. Any other order
 * lets an admin grant themselves something the bar exists to withhold — most
 * dangerously `read_audit`, which would let them erase the record of doing it.
 *
 * WHERE OWNER AUTHORITY COMES FROM, which changed on 2026-09-14 and the rest of
 * this file has to be read with that in mind.
 *
 * It began as: the function secret and nothing else. Nothing inside the system
 * could grant it — not an admin, not somebody with write access to the
 * database. That is still true of the SECRET, which remains the one authority
 * no row can create, remove or switch off.
 *
 * The user then asked for it to be assignable as well, and the reason is a good
 * one: decide_approval is owner-only, so a single unreachable person blocked
 * every two-person approval in the raffle — a single point of failure guarding
 * the control that exists to remove single points of failure.
 *
 * So a row may now say 'superadmin', and the cost is stated plainly rather than
 * hidden: a signed-in owner can create another owner from inside the app, which
 * the original design made impossible. What has NOT changed is that only an
 * owner can do it, that the secret always wins, and that a row can be suspended
 * where the secret cannot.
 *
 * Every such change is recorded. upsertUser and setUserStatus write to
 * audit_log, so who granted what and when is answerable — which the original
 * design did not need, because nothing could grant it at all.
 */

export type Role = 'admin' | 'recorder' | 'agent' | 'viewer'
export const ROLES: Role[] = ['admin', 'recorder', 'agent', 'viewer']

export interface AppUser {
  email: string
  name: string
  role: Role
  active: boolean
  agentId: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
}

export interface ActionSpec {
  /** Roles permitted. null = any signed-in user. [] = admins and nobody else. */
  roles: Role[] | null
  /** Reserved to the super admin, and ungrantable. */
  sup?: boolean
  kind: 'read' | 'write' | 'bulk' | 'report'
}

/**
 * Actions an admin keeps whatever the permissions table says. Without this a
 * single toggle leaves nobody able to undo the toggle.
 */
export const LOCKED_FOR_ADMIN = ['list_users', 'upsert_user', 'set_user_status']

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly status = 400,
  ) {
    super(message)
  }
}

export function superAdminEmail(env: { get(k: string): string | undefined }): string {
  const raw = env.get('SUPER_ADMIN_EMAIL') ?? env.get('ADMIN_BOOTSTRAP_EMAIL') ?? ''
  return raw.trim().toLowerCase()
}

export function isSuperAdminEmail(
  email: string | null | undefined,
  env: { get(k: string): string | undefined },
): boolean {
  const su = superAdminEmail(env)
  return !!su && String(email ?? '').trim().toLowerCase() === su
}

/**
 * The whole decision. `overrides` is the permissions table as
 * {action: {role: boolean}}; a missing entry means no opinion and falls through
 * to the registry default, so an un-migrated database behaves exactly as the
 * code alone would.
 */
export function isActionAllowed(
  action: string,
  spec: ActionSpec,
  user: AppUser,
  overrides: Record<string, Partial<Record<Role, boolean>>>,
): boolean {
  if (user.isSuperAdmin) return true
  if (spec.sup) return false
  if (user.isAdmin && LOCKED_FOR_ADMIN.includes(action)) return true

  const override = overrides[action]?.[user.role]

  /*
   * AN OVERRIDE MAY NARROW. IT MAY NOT WIDEN A WRITE ONTO A ROLE THE REGISTRY
   * NEVER GAVE IT.
   *
   * `allowed = true` used to be final: one row in the permissions table could
   * hand `settle_book`, `restock_books` or `record_payment` to `viewer` — the
   * role whose entire definition is that it cannot change anything and sees
   * masked telephone numbers. The registry, every roles: [...] list in it, and
   * the reasoning written beside each one, could all be undone by a row.
   *
   * That is not a hypothetical escalation path: set_permission is superadmin
   * only, so it takes the one account that can already do everything. What it
   * bought was doing it QUIETLY — after the row, an ordinary viewer account
   * settles books, and nothing on the screen or in the registry says why.
   *
   * So a `true` override is honoured only where the registry already allows the
   * role, which leaves it useful for exactly what it was built for: switching a
   * capability OFF for a role that has it, and back on again. Widening now
   * means changing the registry, in a commit, with the reason written down.
   *
   * Reads are left alone. `kind: 'read'` and 'report' grant sight of something,
   * the masking views decide what is visible whatever the role, and a raffle
   * genuinely does want to show a viewer a report the registry did not think of.
   */
  if (override === false) return false
  if (override === true) {
    if (!spec.roles) return true
    if (spec.kind === 'read' || spec.kind === 'report') return true
    // An admin passes the registry defaults with or without a row, so a row
    // must not be the thing that takes it away from them.
    if (user.isAdmin) return true
    if (spec.roles.includes(user.role)) return true
    return false
  }

  if (!spec.roles) return true      // any signed-in user
  if (user.isAdmin) return true     // admins pass the registry defaults
  return spec.roles.includes(user.role)
}

/**
 * Turns a verified identity into an app user, or refuses.
 *
 * The super admin is resolved BEFORE the active check, and overrides the role
 * read from the table. That is deliberate: a row set to FALSE, a role typed
 * down to 'viewer', or no row at all must not lock the owner out of their own
 * raffle. It is the one account the database cannot switch off.
 */
export function resolveUser(
  email: string,
  row: {
    name?: string | null
    role?: string | null
    active?: boolean | null
    status?: string | null
    agent_id?: string | null
  } | null,
  env: { get(k: string): string | undefined },
): AppUser {
  /*
   * A RESOLUTION, NOT A FIFTH TIER.
 *
 * 'superadmin' is what a user ROW may say. It resolves to role 'admin' plus the
 * super-admin flag, and the four permission tiers are untouched. That
 * distinction is the whole design: if it became a Role the registry compared
 * against, every action declaring roles: ['admin', 'recorder'] would stop
 * matching a superadmin, and they would lose the ordinary admin actions while
 * keeping the exotic ones — able to void a ticket and not list the books.
 *
 * SUPER_ADMIN_EMAIL still always wins, and is still the only authority that
 * cannot be switched off from inside the app. A superadmin BY ROW can be
 * disabled like any other account, deliberately: making the row as
 * unremovable as the secret would leave two things nobody can turn off
 * instead of one.
   */
  const isSuper = isSuperAdminEmail(email, env) || row?.role === 'superadmin'

  if (!row && !isSuper) {
    throw new ApiError(
      'NOT_AUTHORIZED',
      `${email} is not on the access list. Ask the organiser to add you.`,
      null,
      403,
    )
  }

  /*
   * A ROLE THIS CODE DOES NOT RECOGNISE IS THE LEAST OF THEM, NOT THE MOST.
   *
   * This was a bare cast: whatever the row said became a Role, unvalidated. It
   * is not reachable today — app_users.role carries a CHECK naming the five
   * values — so the guard is a constraint in schema.sql rather than anything
   * here, and that file's canonical text is not currently in any commit.
   *
   * What made it worth closing anyway is WHERE an unrecognised value lands.
   * mask() asks `role === 'viewer'`, then agent, then recorder, and returns the
   * row untouched if none match — so a sixth role would have received every
   * buyer's name and full telephone number, which is the one direction this
   * system must never fall in. Every other "everything except" bug found today
   * fell the same way: the value nobody had thought of landed on the permissive
   * side. A viewer is the floor, so an unknown role gets the floor.
   */
  const claimed = isSuper ? 'admin' : (row?.role ?? 'viewer')
  const role: Role = ROLES.includes(claimed as Role) ? (claimed as Role) : 'viewer'

  /*
   * ONLY 'active' IS LET IN, AND EACH OTHER STATE SAYS WHICH IT IS.
   *
   * All three refuse identically — nothing is read, nothing is written, and the
   * database agrees independently because app_role() gates on status too. What
   * differs is only the sentence, and that difference is the point: somebody
   * waiting to be let in and somebody whose access was stopped need to do
   * different things next, and telling one they are the other leaves them
   * either waiting for nothing or believing they are in trouble.
   *
   * The status travels in details so the app can show the right screen rather
   * than parsing the message.
   */
  const status = String(row?.status ?? (row?.active === false ? 'suspended' : 'active'))
  // Only the one named in the function secret is immune. A superadmin by row is
  // an ordinary row and can be suspended like any other.
  const immune = isSuperAdminEmail(email, env)

  if (!immune && status !== 'active') {
    const said: Record<string, [string, string]> = {
      pending: ['ACCOUNT_PENDING',
        'This account is waiting to be let in. The organiser has to approve it.'],
      suspended: ['ACCOUNT_SUSPENDED',
        'This account has been paused. Ask the organiser to turn it back on.'],
      banned: ['ACCOUNT_BANNED', 'This account has been stopped.'],
    }
    const [code, message] = said[status] ?? ['ACCOUNT_DISABLED', 'This account has been disabled.']
    throw new ApiError(code, message, { status }, 403)
  }

  const active = immune ? true : status === 'active'

  return {
    email,
    name: row?.name || email,
    role,
    active,
    agentId: row?.agent_id ?? null,
    isAdmin: isSuper || role === 'admin',
    isSuperAdmin: isSuper,
  }
}

export function requireSuperAdmin(user: AppUser, what: string): void {
  if (!user.isSuperAdmin) {
    throw new ApiError(
      'SUPER_ADMIN_ONLY',
      `${what} can only be done by the system admin.`,
      null,
      403,
    )
  }
}

/*
 * WHOSE BUYER DETAILS A CALLER MAY READ — one implementation, here.
 *
 * It lived in index.ts and was applied by the three read paths there. Three was
 * not all of them: list_winners returned a winner's full telephone number to a
 * VIEWER, whose entire defining property is that phone numbers are masked, and
 * to a helper regardless of who recorded the sale. The guard was right
 * everywhere it was called, and being right is what stopped anyone looking for
 * the place it was not.
 *
 * Moved to gate.ts because reports.ts cannot import index.ts — index imports
 * reports — and a second copy in reports.ts is how two maskers come to disagree
 * about what a viewer sees.
 */
export type BookSet = Set<number> | null

/**
 * The books one seller is physically carrying, as a set of book indexes.
 *
 * Cached for the life of the request: an agent reading twenty thousand tickets
 * must not cause twenty thousand lookups.
 */
export async function agentBooks(
  user: AppUser,
  ctx: { supabaseAdmin: { from: (t: string) => any } },
): Promise<BookSet> {
  if (user.role !== 'agent') return null
  if (!user.agentId) return new Set()
  const { data } = await ctx.supabaseAdmin
    .from('books').select('idx').eq('held_by_agent', user.agentId)
  return new Set((data ?? []).map((b: { idx: number }) => b.idx))
}


/**
 * The last three digits and nothing else — a viewer's whole defining property.
 *
 * Its own function because the trail masks the same numbers as the ticket does,
 * and a phone shortened two ways is the bug this file's own comment warns
 * about: three code paths hiding a number three ways read as three
 * applications.
 */
export function shortPhone(phone: unknown): string {
  const p = String(phone ?? '')
  if (!p) return ''
  return p.length < 4 ? '\u2022\u2022\u2022\u2022' : '\u2022\u2022\u2022\u2022' + p.slice(-3)
}

/**
 * MAY THIS PERSON READ THE BUYER ON THIS TICKET — the rule itself, alone.
 *
 * It was the body of mask() and is now named, because a second reader needs the
 * same answer: a ticket's history is shown to whoever may see the ticket, and
 * deciding that a second time in books.ts is how the trail came to be
 * organisers-only while the ticket beside it was not. The row it is asked about
 * needs only `book_idx` and `recorded_by`, which is what both the ticket and
 * its trail can supply.
 *
 * A viewer passes: they see names, with the telephone number shortened by
 * mask() and by the trail. That is the same answer tickets_readable gives —
 * `mine` is true for every role but agent and recorder.
 */
export function seesBuyer(
  row: { book_idx?: unknown; recorded_by?: unknown },
  user: AppUser,
  holds?: BookSet,
): boolean {
  if (holds && user.role === 'agent' && !holds.has(Number(row.book_idx))) return false
  if (user.role === 'recorder' && String(row.recorded_by ?? '') !== user.email) return false
  return true
}

export function mask(
  row: Record<string, unknown>,
  user: AppUser,
  holds?: BookSet,
): Record<string, unknown> {
  if (user.role === 'viewer') {
    return { ...row, buyer_phone: shortPhone(row.buyer_phone) }
  }

  if (!seesBuyer(row, user, holds)) {
    return { ...row, buyer_name: '', buyer_phone: '', buyer_zone: '', notes: '' }
  }

  return row
}
