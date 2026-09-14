/**
 * Who may do what — ported from Auth.gs, with the same rules in the same order.
 *
 * The ordering is not stylistic. Super admin first, then the super-admin-only
 * bar, then the permissions table, then the registry default. Any other order
 * lets an admin grant themselves something the bar exists to withhold — most
 * dangerously `read_audit`, which would let them erase the record of doing it.
 *
 * ONE THING THAT MUST NOT MOVE IN THE PORT: the super admin is an environment
 * variable, never a row. Nothing inside the system can grant it — not an admin,
 * not somebody with write access to the database. In Apps Script that was a
 * Script Property; here it is a function secret. A `super_admin` column would
 * be a smaller change and a worse one.
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
    agent_id?: string | null
  } | null,
  env: { get(k: string): string | undefined },
): AppUser {
  const isSuper = isSuperAdminEmail(email, env)

  if (!row && !isSuper) {
    throw new ApiError(
      'NOT_AUTHORIZED',
      `${email} is not on the access list. Ask an admin to add you.`,
      null,
      403,
    )
  }

  const role = (isSuper ? 'admin' : (row?.role ?? 'viewer')) as Role
  const active = isSuper ? true : row?.active !== false

  if (!active) {
    throw new ApiError('ACCOUNT_DISABLED', 'This account has been disabled.', null, 403)
  }

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
      `${what} can only be done by the super admin.`,
      null,
      403,
    )
  }
}
