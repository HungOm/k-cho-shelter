/**
 * Agents and users — ported from People.gs.
 *
 * An AGENT is somebody who carries books: a name and a phone number, no account,
 * nothing to set up, so you can hand books to someone the day you meet them.
 * A USER is somebody who signs in. Most agents never become users.
 *
 * THE RULES THAT MUST NOT SOFTEN IN THE PORT
 *
 * Only the super admin may mint an admin, alter an existing admin, or touch the
 * super admin's own row. Without that the tree has no top: any admin could
 * promote a second admin, and the first toggle that goes wrong leaves nobody
 * able to undo it.
 *
 * And the super admin is never listed to anybody else. Not the row, not the
 * address. An ordinary admin can do nothing with it here, and the account above
 * you is the one worth attacking.
 */
import { ApiError, isSuperAdminEmail, requireSuperAdmin, type AppUser, type Role } from './gate.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any } }

const VALID_ROLES: Role[] = ['admin', 'recorder', 'agent', 'viewer']

async function audit(ctx: Ctx, action: string, details: unknown, email: string) {
  await ctx.supabaseAdmin.from('audit_log').insert({ action, details, email })
}

// ============ AGENTS ============

export async function listAgents(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('agents').select('*').order('agent_id')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // A view-only account never sees a contact number, the same rule the tickets
  // follow. An agent's phone is how you chase a book that has not come back,
  // which is exactly why it is worth withholding from somebody who only reads.
  const rows = (data ?? []).map((a: Record<string, unknown>) =>
    user.role === 'viewer' ? { ...a, phone: '' } : a)
  return { agents: rows }
}

export async function upsertAgent(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const name = String(p.name ?? '').trim()
  if (!name) throw new ApiError('MISSING_FIELD', 'A name is required.')

  const agentId = String(p.agentId ?? '').trim().toUpperCase()
  const phone = String(p.phone ?? '').replace(/[^\d+]/g, '')

  if (agentId) {
    const { data, error } = await ctx.supabaseAdmin
      .from('agents')
      .update({ name, phone, zone: String(p.zone ?? ''), active: p.active !== false })
      .eq('agent_id', agentId).select().maybeSingle()
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    if (!data) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)
    await audit(ctx, 'UPDATE_AGENT', { agentId, name }, user.email)
    return { agentId, updated: true }
  }

  // A new id, allocated from the highest existing one rather than a count —
  // counting breaks the moment anybody is ever deleted, and reusing a retired
  // id would attach an old book history to a new person.
  const { data: last } = await ctx.supabaseAdmin
    .from('agents').select('agent_id').order('agent_id', { ascending: false }).limit(1).maybeSingle()
  const nextNum = last ? parseInt(String(last.agent_id).replace(/\D/g, ''), 10) + 1 : 1
  const newId = 'A' + String(nextNum).padStart(3, '0')

  const { error } = await ctx.supabaseAdmin
    .from('agents').insert({
      agent_id: newId, name, phone, zone: String(p.zone ?? ''), active: true,
    })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, 'CREATE_AGENT', { agentId: newId, name }, user.email)
  return { agentId: newId, created: true }
}

// ============ USERS ============

export async function listUsers(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('app_users').select('email,name,role,active,agent_id,added_by,added_at').order('email')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const superEmail = Deno.env.get('SUPER_ADMIN_EMAIL')?.trim().toLowerCase() ?? ''
  const out = []
  for (const r of data ?? []) {
    const email = String(r.email).trim().toLowerCase()
    const rowIsSuper = !!superEmail && email === superEmail
    if (rowIsSuper && !user.isSuperAdmin) continue      // not shown at all
    out.push({
      email, name: r.name, role: r.role, active: r.active,
      agentId: r.agent_id ?? '', addedBy: r.added_by, addedDate: r.added_at,
      isYou: email === user.email,
      isSuperAdmin: rowIsSuper,
    })
  }

  return {
    users: out,
    youAreSuperAdmin: !!user.isSuperAdmin,
    superAdmin: user.isSuperAdmin ? superEmail : '',
  }
}

export async function upsertUser(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  // Checked before anything is validated: an organiser who may not do this at
  // all should be told that, not told which field they forgot.
  requireSuperAdmin(user, 'Adding or changing who can sign in')

  const email = String(p.email ?? '').trim().toLowerCase()
  const role = String(p.role ?? 'viewer').toLowerCase() as Role

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError('BAD_REQUEST', 'That does not look like an email address.')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + VALID_ROLES.join(', '))
  }
  if (role === 'agent' && !p.agentId) {
    throw new ApiError('MISSING_FIELD', 'An agent user must be linked to an Agent_ID.')
  }

  const { data: existing } = await ctx.supabaseAdmin
    .from('app_users').select('email,role').eq('email', email).maybeSingle()

  // The three that keep the top of the tree where it is.
  // WHO MAY SIGN IN, AND AS WHAT, IS THE SUPER ADMIN'S ALONE.
  //
  // An organiser who can hand out roles can hand one to themselves, or to a
  // friendly account they then sign in as — which makes "only the super admin
  // decides who is an organiser" a rule that lasts exactly as long as nobody
  // tries. Organisers run the raffle; they do not decide who else runs it.
  //
  // Managing SELLERS is a different thing and stays with organisers: adding,
  // banning and deactivating an agent is the daily work of running the raffle,
  // and an agent record grants nobody any access to this system.
  if (isSuperAdminEmail(email, Deno.env)) requireSuperAdmin(user, 'Changing the super admin account')

  if (p.agentId) {
    const { data: agent } = await ctx.supabaseAdmin
      .from('agents').select('agent_id').eq('agent_id', String(p.agentId)).maybeSingle()
    if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${p.agentId}".`, null, 404)
  }

  const row = {
    email, name: String(p.name ?? email), role,
    active: p.active === undefined ? true : !!p.active,
    agent_id: p.agentId ? String(p.agentId) : null,
    added_by: user.email,
  }

  const { error } = await ctx.supabaseAdmin
    .from('app_users').upsert(row, { onConflict: 'email' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, existing ? 'UPDATE_USER' : 'CREATE_USER', { email, role }, user.email)
  return existing ? { email, updated: true } : { email, created: true }
}

export async function setUserStatus(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const email = String(p.email ?? '').trim().toLowerCase()
  if (p.active === undefined) throw new ApiError('MISSING_FIELD', 'active is required.')

  // Checked first, and before the row lookup, because the super admin need not
  // have a row at all — and the refusal should read the same whoever asks,
  // including the super admin themselves.
  if (isSuperAdminEmail(email, Deno.env)) {
    throw new ApiError(
      'SUPER_ADMIN_ONLY',
      'The super admin account cannot be enabled or disabled from the app. ' +
        'Change SUPER_ADMIN_EMAIL in the function secrets instead.',
    )
  }

  // Locking yourself out of your own system is a support call you cannot make.
  if (email === user.email && !p.active) {
    throw new ApiError('BAD_REQUEST', 'You cannot disable your own account.')
  }

  const { data: existing } = await ctx.supabaseAdmin
    .from('app_users').select('email,role').eq('email', email).maybeSingle()
  if (!existing) {
    throw new ApiError('USER_NOT_FOUND', `${email} is not on the access list.`, null, 404)
  }
  // An organiser may switch a SELLER's sign-in off — a lost phone at a Sunday
  // service should not wait for the super admin to wake up. Anything above a
  // seller is a privilege decision and goes to the super admin.
  if (existing.role !== 'agent') {
    requireSuperAdmin(user, 'Enabling or disabling anybody but a seller')
  }

  const { error } = await ctx.supabaseAdmin
    .from('app_users').update({ active: !!p.active }).eq('email', email)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, p.active ? 'ENABLE_USER' : 'DISABLE_USER', { email }, user.email)
  return { email, active: !!p.active }
}

// ============ ACCESS CONTROL ============

export async function listPermissions(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data } = await ctx.supabaseAdmin.from('permissions').select('action,role,allowed')
  const current: Record<string, Record<string, boolean>> = {}
  for (const r of data ?? []) (current[r.action] ??= {})[r.role] = r.allowed
  return { roles: VALID_ROLES, overrides: current }
}

export async function setPermission(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const action = String(p.action ?? '').trim()
  const role = String(p.role ?? '').trim().toLowerCase() as Role
  if (p.allowed === undefined) {
    throw new ApiError('MISSING_FIELD', 'allowed is required (true or false).')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + VALID_ROLES.join(', '))
  }

  const { error } = await ctx.supabaseAdmin
    .from('permissions')
    .upsert({ action, role, allowed: !!p.allowed }, { onConflict: 'action,role' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, 'SET_PERMISSION', { action, role, allowed: !!p.allowed }, user.email)
  return { action, role, allowed: !!p.allowed }
}
