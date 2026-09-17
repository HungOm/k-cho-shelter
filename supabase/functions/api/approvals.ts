/**
 * Two-person control — ported from Approvals.gs.
 *
 * An admin asks, the super admin approves, and the action runs. What needs it:
 * marking a run of books lost or void, putting books back on the shelf,
 * settling a book that is already settled, letting somebody sign in — and
 * UNDOING MONEY, which is reversing a recorded payment or writing off a debt.
 *
 * The money pair were added last and for a different reason from the rest.
 * Everything above changes what the raffle can still sell. Those two change
 * what a named volunteer is shown as owing, with nothing handed over and
 * nobody else in the room.
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
import { REQUESTABLE_BY_ADMIN } from './people.ts'

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

  if (action === 'upsert_user') {
    const role = String(payload.role ?? 'viewer').toLowerCase()
    const email = String(payload.email ?? '').trim().toLowerCase()

    // Organiser and owner are NOT requestable. Returning null here sends the
    // call on to the handler, which refuses it outright — an approvable request
    // to create a peer is an escalation with a waiting period, not one
    // prevented.
    if (!REQUESTABLE_BY_ADMIN.includes(role)) return null
    if (!email) return null

    // And not pointed at somebody who is ALREADY an organiser or owner. A
    // request reading "let them sign in as view-only" that in fact demotes a
    // peer is the approval screen lying about the deed, and it would fail at
    // the moment of approval anyway — which is the worst time to find out.
    const { data: existing } = await ctx.supabaseAdmin
      .from('app_users').select('role').eq('email', email).maybeSingle()
    if (existing && (existing.role === 'admin' || existing.role === 'superadmin')) return null

    const WORD: Record<string, string> = {
      recorder: 'Helper', agent: 'Seller who signs in', viewer: 'view-only',
    }
    return {
      kind: 'upsert_user',
      email,
      role,
      // The sentence the owner reads, written HERE rather than in the browser.
      // An approver shown a client-written summary is approving the client's
      // description rather than the change, and the one thing an approval
      // screen has to get right is that the words match the deed. The role is
      // named explicitly because it is the part that actually matters.
      text: `Let ${email} sign in as ${WORD[role] ?? role}.`,
    }
  }

  /*
   * UNDOING MONEY TAKES TWO PEOPLE, and it is the only kind of write here that
   * changes what a named volunteer is shown as owing without anybody handing
   * anything over.
   *
   * Both of these were already an organiser's alone, both already demanded a
   * reason, and both already wrote a new row rather than editing one — the
   * audit is not the gap. The gap is that one person could decide, at a desk,
   * that a debt on somebody else's name is gone, and the only trace is a line
   * nobody reads until there is an argument. A raffle run by volunteers for
   * their own community is exactly where that has to be two signatures.
   *
   * THE SENTENCE CARRIES THE NUMBERS, because an approver reading "write off a
   * debt" is being asked to sign for something they cannot see. The figures are
   * read here, at request time, from the same views the money screens use.
   */
  const currencyWord = async () => {
    const { data } = await ctx.supabaseAdmin
      .from('config').select('value').eq('key', 'CURRENCY').maybeSingle()
    return String(data?.value ?? 'RM')
  }
  const agentName = async (id: string) => {
    if (!id) return 'a seller'
    const { data } = await ctx.supabaseAdmin
      .from('agents').select('name').eq('agent_id', id).maybeSingle()
    return String(data?.name ?? '') || id
  }

  if (action === 'reverse_payment') {
    const id = Number(payload.paymentId)
    const { data: row } = await ctx.supabaseAdmin
      .from('payments').select('agent_id,amount,source,received_at').eq('id', id).maybeSingle()
    const r = (row ?? {}) as Record<string, unknown>
    const who = await agentName(String(r.agent_id ?? ''))
    const cur = await currencyWord()
    const amount = Number(r.amount ?? 0)
    const when = String(r.received_at ?? '').slice(0, 10)
    // A settlement row is a book's own figure as well as a payment, so undoing
    // one is a bigger act than undoing a hand-over and the sentence says which.
    const kindWord = String(r.source ?? '') === 'settlement'
      ? ' It was counted in with a book, so the book\'s figure moves too.'
      : ''
    return {
      kind: 'reverse_payment', paymentId: id, agentId: String(r.agent_id ?? ''), amount,
      text: `Undo ${cur} ${amount.toFixed(2)} recorded against ${who}` +
            (when ? ` on ${when}` : '') + `.${kindWord} Both entries stay on the record.`,
    }
  }

  if (action === 'write_off') {
    const agentId = String(payload.agentId ?? '').trim()
    const who = await agentName(agentId)
    const cur = await currencyWord()
    const { data: m } = await ctx.supabaseAdmin
      .from('agent_money').select('outstanding').eq('agent_id', agentId).maybeSingle()
    const owed = Number((m as { outstanding?: number } | null)?.outstanding ?? 0)
    const asked = payload.amount === undefined || payload.amount === null || payload.amount === ''
      ? owed : Number(payload.amount)
    const whole = Math.abs(asked - owed) < 0.005
    return {
      kind: 'write_off', agentId, amount: asked, owed,
      text: `Write off ${cur} ${asked.toFixed(2)} owed by ${who}` +
            (whole ? ', which is everything they owe' : ` of the ${cur} ${owed.toFixed(2)} they owe`) +
            '. Nobody asks them for it again, and it will not read as having been paid.',
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
