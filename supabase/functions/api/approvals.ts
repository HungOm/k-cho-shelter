/**
 * Two-person control — ported from Approvals.gs.
 *
 * An admin asks, the super admin approves, and the action runs. Three things
 * need it: marking a run of books lost or void, putting books back on the
 * shelf, and settling a book that is already settled.
 *
 * APPROVING EXECUTES, in the same call. An approval that merely unlocked the
 * action for later leaves a gap between what was read and what runs — approve a
 * three-book restock and a two-hundred-book one fires. The exact payload is
 * stored when the request is made and executed when it is approved, so what was
 * approved is what happens.
 *
 * It executes as the REQUESTER, re-checked at that moment. If they were
 * disabled or demoted while the request sat in the queue it fails, rather than
 * running on permissions they no longer have. Both names go in the audit line:
 * the person who asked owns it, the person who approved signed for it.
 */
import { ApiError, isActionAllowed, resolveUser, type ActionSpec, type AppUser, type Role } from './gate.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

const TTL_HOURS = 24

/**
 * Decides whether an action needs two people, and if so writes the sentence the
 * approver will read — here, at request time, so the words come from the same
 * code that made the decision. Deriving them again in the browser would let the
 * two drift, and the drift would only show on the day it mattered.
 *
 * Returns null when the action can just be done.
 */
export async function approvalNeeded(
  action: string,
  payload: Record<string, unknown>,
  ctx: Ctx,
): Promise<{ text: string; kind: string; [k: string]: unknown } | null> {
  const countBooks = async () => {
    if (Array.isArray(payload.bookNumbers)) return payload.bookNumbers.length
    const from = String(payload.fromBook ?? '')
    const to = String(payload.toBook ?? '') || from
    if (!from) return 0
    const { data } = await ctx.supabaseAdmin.from('books').select('idx,number').in('number', [from, to])
    const idxs = (data ?? []).map((b: { idx: number }) => b.idx)
    if (idxs.length === 0) return 0
    return Math.abs(Math.max(...idxs) - Math.min(...idxs)) + 1
  }

  if (action === 'set_book_status') {
    // A preview writes nothing, so it needs nobody's permission.
    if (payload.dryRun === undefined || payload.dryRun) return null
    const n = await countBooks()
    if (n <= 1) return null
    const status = String(payload.status ?? '')
    const voids = status === 'Lost' || status === 'Void'
    const { data: per } = await ctx.supabaseAdmin
      .from('config').select('value').eq('key', 'TICKETS_PER_BOOK').maybeSingle()
    return {
      kind: 'set_book_status', books: n, status, voidsTickets: voids,
      tickets: n * (parseInt(String(per?.value ?? '10'), 10) || 10),
      firstBook: String(payload.fromBook ?? ''), lastBook: String(payload.toBook ?? ''),
      text: `Mark ${n} books as ${status} — ${payload.fromBook} to ${payload.toBook}.` +
        (voids ? ' Unsold tickets in them are voided and leave the draw.' : ''),
    }
  }

  if (action === 'restock_books') {
    const n = await countBooks()
    if (!n) return null
    return {
      kind: 'restock_books', books: n,
      firstBook: String(payload.fromBook ?? ''), lastBook: String(payload.toBook ?? ''),
      text: `Put ${n} book${n === 1 ? '' : 's'} back on the shelf. The settlement figures ` +
        `already recorded against ${n === 1 ? 'it' : 'them'} are cleared.`,
    }
  }

  if (action === 'settle_book' && payload.force) {
    const bn = String(payload.bookNumber ?? '')
    return {
      kind: 'resettle_book', books: 1, firstBook: bn, lastBook: bn,
      text: `Settle ${bn || 'a book'} again, over a settlement that is already recorded.`,
    }
  }

  return null
}

const newId = () =>
  'R' + Date.now().toString(36).toUpperCase() + '-' +
  Math.floor(Math.random() * 1679616).toString(36).toUpperCase()

export async function requestApproval(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const action = String(p.action ?? '')
  const inner = (p.payload ?? {}) as Record<string, unknown>

  // The super admin would only be approving themselves. Theatre, and it would
  // make the queue look like a control when it is not one.
  if (user.isSuperAdmin) {
    throw new ApiError('BAD_REQUEST',
      'You can do this yourself — an approval request would only come back to you.')
  }

  const need = await approvalNeeded(action, inner, ctx)
  if (!need) {
    throw new ApiError('NOTHING_TO_DO', 'That action does not need anybody else to approve it.')
  }

  const requestId = newId()
  const { error } = await ctx.supabaseAdmin.from('pending_approvals').insert({
    request_id: requestId, action, payload: inner, summary: need.text, detail: need,
    requested_by: user.email,
    expires_at: new Date(Date.now() + TTL_HOURS * 3600_000).toISOString(),
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_REQUESTED', details: { requestId, action, summary: need.text }, email: user.email,
  })
  return { requestId, action, summary: need.text, detail: need,
           expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000).toISOString() }
}

export async function listApprovals(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  let q = ctx.supabaseAdmin.from('pending_approvals').select('*').order('requested_at', { ascending: false })
  // Anybody but the super admin sees only what they asked for themselves.
  if (!user.isSuperAdmin) q = q.eq('requested_by', user.email)
  if (p.status) q = q.eq('status', String(p.status))

  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Expiry is applied on read as well as on decide, so a request that lapsed
  // while nobody was looking shows as expired rather than as still waiting.
  const now = Date.now()
  const stale = (data ?? []).filter((r: { status: string; expires_at: string }) =>
    r.status === 'Pending' && Date.parse(r.expires_at) <= now)
  if (stale.length) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Expired', note: `Nobody decided within ${TTL_HOURS} hours.` })
      .in('request_id', stale.map((r: { request_id: string }) => r.request_id))
  }

  return {
    requests: (data ?? []).map((r: Record<string, unknown>) => ({
      requestId: r.request_id, action: r.action, summary: r.summary, detail: r.detail,
      requestedBy: r.requested_by, requestedAt: r.requested_at, expiresAt: r.expires_at,
      status: stale.some((s: { request_id: string }) => s.request_id === r.request_id)
        ? 'Expired' : r.status,
      decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note,
    })),
    youDecide: !!user.isSuperAdmin,
  }
}

export async function cancelApproval(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const requestId = String(p.requestId ?? '')
  const { data: r } = await ctx.supabaseAdmin
    .from('pending_approvals').select('*').eq('request_id', requestId).maybeSingle()
  if (!r) throw new ApiError('NOT_FOUND', 'No request with that id.', null, 404)
  if (r.status !== 'Pending') throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.')
  if (!user.isSuperAdmin && r.requested_by !== user.email) {
    throw new ApiError('NOT_AUTHORIZED', 'That is not your request.', null, 403)
  }

  await ctx.supabaseAdmin.from('pending_approvals')
    .update({ status: 'Cancelled', decided_by: user.email, decided_at: new Date().toISOString(),
              note: String(p.note ?? '') })
    .eq('request_id', requestId)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_CANCELLED', details: { requestId }, email: user.email,
  })
  return { requestId, status: 'Cancelled' }
}

/**
 * Approve and run, or refuse. Super-admin only through the registry.
 *
 * `run` is the router's own dispatcher, passed in so this file does not import
 * the registry and create a cycle — and so the approved action goes through
 * exactly the same path a direct call would, rather than a second copy of it.
 */
export async function decideApproval(
  p: Record<string, unknown>,
  user: AppUser,
  ctx: Ctx,
  run: (action: string, payload: Record<string, unknown>, asUser: AppUser) => Promise<unknown>,
  specOf: (action: string) => ActionSpec | undefined,
  overrides: Record<string, Partial<Record<Role, boolean>>>,
) {
  const requestId = String(p.requestId ?? '')
  if (p.approve === undefined) {
    throw new ApiError('MISSING_FIELD', 'approve is required (true or false).')
  }

  const { data: r } = await ctx.supabaseAdmin
    .from('pending_approvals').select('*').eq('request_id', requestId).maybeSingle()
  if (!r) throw new ApiError('NOT_FOUND', 'No request with that id.', null, 404)
  if (r.status !== 'Pending') throw new ApiError('NOTHING_TO_DO', 'That request has already been decided.')

  // Checked here as well as on read: a row that went stale while nobody was
  // looking must not execute because somebody finally opened the screen.
  if (Date.parse(r.expires_at) <= Date.now()) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Expired', note: `Nobody decided within ${TTL_HOURS} hours.` })
      .eq('request_id', requestId)
    throw new ApiError('APPROVAL_EXPIRED',
      `That request is more than ${TTL_HOURS} hours old. Ask for it again.`)
  }

  if (!p.approve) {
    await ctx.supabaseAdmin.from('pending_approvals')
      .update({ status: 'Rejected', decided_by: user.email, decided_at: new Date().toISOString(),
                note: String(p.note ?? '') })
      .eq('request_id', requestId)
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'APPROVAL_REJECTED',
      details: { requestId, action: r.action, requestedBy: r.requested_by, note: p.note },
      email: user.email,
    })
    return { requestId, status: 'Rejected', executed: false }
  }

  // --- approve: re-establish who asked, as they are NOW ---
  const { data: row } = await ctx.supabaseAdmin
    .from('app_users').select('name,role,active,agent_id').eq('email', r.requested_by).maybeSingle()

  let requester: AppUser
  try {
    requester = resolveUser(r.requested_by, row, Deno.env)
  } catch {
    throw new ApiError('REQUESTER_UNAVAILABLE',
      `${r.requested_by} is no longer an active user, so their request cannot run.`)
  }

  const spec = specOf(r.action)
  if (!spec) throw new ApiError('UNKNOWN_ACTION', 'That request names an action that no longer exists.')
  if (!isActionAllowed(r.action, spec, requester, overrides)) {
    throw new ApiError('REQUESTER_NOT_ALLOWED',
      `${r.requested_by} can no longer do that, so their request cannot run.`)
  }

  const result = await run(r.action, r.payload as Record<string, unknown>, requester)

  await ctx.supabaseAdmin.from('pending_approvals')
    .update({ status: 'Approved', decided_by: user.email, decided_at: new Date().toISOString(),
              note: String(p.note ?? '') })
    .eq('request_id', requestId)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'APPROVAL_APPROVED',
    details: { requestId, action: r.action, summary: r.summary,
               requestedBy: r.requested_by, approvedBy: user.email },
    email: user.email,
  })

  return {
    requestId, status: 'Approved', executed: true,
    action: r.action, summary: r.summary, requestedBy: r.requested_by, result,
  }
}
