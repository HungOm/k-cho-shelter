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
  if (override === true || override === false) return override

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

  const role = (isSuper ? 'admin' : (row?.role ?? 'viewer')) as Role

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
