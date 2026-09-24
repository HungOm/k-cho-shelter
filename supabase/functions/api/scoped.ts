/*
 * A DATABASE CLIENT THAT CANNOT FORGET WHICH PROJECT IT IS IN.
 *
 * MULTI-TENANCY-PLAN.md, "Write path". Every handler reads and writes through
 * ctx.supabaseAdmin, which is the service key and outranks every policy in the
 * database. So once two raffles share a table, the only thing standing between
 * one organisation's buyers and another's is whether each of 319 query sites
 * remembered to say `.eq('project_id', …)`. This makes the answer "it could not
 * have forgotten": the handler asks this client, and the client says it.
 *
 *   select / update / delete   filtered to the project
 *   insert / upsert            every row stamped with the project
 *   rpc                        `p_project` injected, for the SQL functions
 *   storage                    passed through unchanged (paths are Stage 5)
 *
 * NOT WIRED TO ANY HANDLER YET. That is Stage 2, together with the SQL
 * functions learning `p_project`; injecting it into a function that does not
 * take it would make PostgREST refuse the call. Until then this file is used
 * only by tests/scoped.test.mjs.
 *
 * WHAT IT REFUSES, loudly, because each is a way of leaving the project:
 *   - a project id that is not a uuid
 *   - the control-plane tables, which have no project_id to filter on and are
 *     reached through the control-plane module instead
 *   - a row, a patch or an rpc argument naming a DIFFERENT project
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Tables that describe projects rather than belong to one. */
export const CONTROL_PLANE = new Set([
  'platform_admins', 'organisations', 'org_features', 'org_defaults',
  'projects', 'project_members',
])

// deno-lint-ignore no-explicit-any
type Builder = any
export type AdminClient = {
  from: (table: string) => Builder
  rpc: (fn: string, args?: Record<string, unknown>) => Builder
  storage?: unknown
}

export class ScopeError extends Error {
  readonly code = 'PROJECT_SCOPE'
}

export function scoped(admin: AdminClient, projectId: string) {
  const project = String(projectId ?? '').toLowerCase()
  if (!UUID.test(project)) throw new ScopeError(`Not a project id: ${JSON.stringify(projectId)}`)

  const ownRow = (row: Record<string, unknown>) => {
    const named = row?.project_id
    if (named !== undefined && named !== null && String(named).toLowerCase() !== project) {
      throw new ScopeError('A row names a different project from the one this request is in.')
    }
    return { ...row, project_id: project }
  }
  // An object stays an object and a list stays a list, so `.single()` after an
  // insert reads the same with or without this client in the way.
  const stamp = (rows: unknown) =>
    Array.isArray(rows)
      ? rows.map((r) => ownRow(r as Record<string, unknown>))
      : ownRow(rows as Record<string, unknown>)

  return {
    projectId: project,

    from(table: string) {
      if (CONTROL_PLANE.has(table)) {
        throw new ScopeError(`${table} is not inside a project; use the control-plane module.`)
      }
      const raw = admin.from(table)
      return {
        select: (...args: unknown[]) => raw.select(...args).eq('project_id', project),
        update: (patch: Record<string, unknown>) => {
          if (patch && 'project_id' in patch) {
            throw new ScopeError('A row cannot be moved to another project.')
          }
          return raw.update(patch).eq('project_id', project)
        },
        delete: () => raw.delete().eq('project_id', project),
        insert: (rows: unknown, opts?: unknown) => raw.insert(stamp(rows), opts),
        upsert: (rows: unknown, opts?: unknown) => raw.upsert(stamp(rows), opts),
      }
    },

    rpc(fn: string, args: Record<string, unknown> = {}) {
      const named = args?.p_project
      if (named !== undefined && named !== null && String(named).toLowerCase() !== project) {
        throw new ScopeError(`${fn} was asked about a different project from the one this request is in.`)
      }
      return admin.rpc(fn, { ...args, p_project: project })
    },

    // Carried through, not rebuilt: tests/templates.test.mjs stubs storage on
    // the admin client, and a fresh object without it would fail as an upload
    // test rather than as a tenancy one.
    storage: admin.storage,
  }
}
