/**
 * Cash handed in, and who is allowed to see whose.
 *
 * TWO DIFFERENT MONEY EVENTS were being shown as one, which is why the Money
 * screen could say "handed in 90" above a list of ten tickets all marked as
 * paid. They are not the same fact and never were:
 *
 *   the BUYER paid the SELLER      tickets.payment_status, out in the field
 *   the SELLER handed cash to us   a payment row, at a table, in person
 *
 * This file owns the second one. The first stays on the ticket, where it
 * belongs, and the screen now says which it means.
 *
 * MONEY FOLLOWS CUSTODY, NOT WHOEVER TYPED IT IN. A helper records sales that
 * are credited to the book's holder, so a helper never owes anything. Keying
 * the debt on agent_id is what makes "what I owe" answerable for a seller and
 * correctly empty for a helper who carries no books — rather than a rule about
 * roles, which would have to be maintained in two places and would disagree
 * with itself the first time somebody was both.
 */
import { ApiError, type AppUser } from './gate.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

/**
 * Which sellers this person may be told about.
 *
 * Returns null for "everybody" and a list otherwise, so a caller can put the
 * decision in one place instead of re-deriving it per report. A viewer gets an
 * empty list: they are trusted with the totals and not with who owes them.
 */
export function visibleAgents(user: AppUser): string[] | null {
  if (user.isAdmin) return null
  // An agent, or a helper who also carries books, sees their own line. A helper
  // with no agent record sees none, which is the true answer rather than a
  // refusal — they are not holding anybody's money.
  const own = String(user.agentId ?? '').trim()
  return own ? [own] : []
}

/** 'all' for an organiser, 'mine' for somebody with books, 'totals' otherwise. */
export function moneyScope(user: AppUser): 'all' | 'mine' | 'totals' {
  if (user.isAdmin) return 'all'
  return String(user.agentId ?? '').trim() ? 'mine' : 'totals'
}

/**
 * What each seller has handed in: the books' own figure, plus every handover
 * the books do not know about.
 *
 * WHY IT IS A SUM OF TWO THINGS rather than one ledger. books.amount_paid has
 * held every settlement since before payments existed and is still written when
 * a book is closed, so it stays the authority for money counted in WITH a book.
 * What it could never express is cash arriving on its own — a seller bringing
 * half of it, or keeping the book to sell the rest — and that is what the
 * ledger adds.
 *
 * Settlement rows are therefore EXCLUDED here: settle_book writes both, and
 * counting each would charge the raffle twice for the same cash. They are kept
 * in the ledger so a seller's history reads as one list, which is what somebody
 * asking "when did I pay that" actually wants.
 *
 * The consequence worth stating: this is exactly the old number plus the
 * payments that had nowhere to go before. No existing total moves, with or
 * without the backfill, and running the backfill twice changes nothing.
 */
export async function collectedByAgent(ctx: Ctx, agentIds?: string[] | null) {
  const by = new Map<string, number>()

  let lq = ctx.supabaseAdmin.from('book_ledger_all')
    .select('held_by_agent,counted_collected').not('held_by_agent', 'is', null)
  if (agentIds && agentIds.length) lq = lq.in('held_by_agent', agentIds)
  const { data: ledger } = await lq
  for (const b of (ledger ?? []) as Array<Record<string, unknown>>) {
    const id = String(b.held_by_agent ?? '')
    by.set(id, round2((by.get(id) ?? 0) + Number(b.counted_collected ?? 0)))
  }

  let pq = ctx.supabaseAdmin.from('payments')
    .select('agent_id,amount,source').neq('source', 'settlement')
  if (agentIds && agentIds.length) pq = pq.in('agent_id', agentIds)
  const { data: paid, error } = await pq
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  for (const r of (paid ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.agent_id ?? '')
    by.set(id, round2((by.get(id) ?? 0) + Number(r.amount ?? 0)))
  }

  return by
}

/** Money is read aloud to the person who owes it; floating point is not. */
export const round2 = (n: number) => Math.round(n * 100) / 100

// ============ RECORDING A HANDOVER ============

export async function recordPayment(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Who handed the money in?')

  const amount = round2(Number(p.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError('MISSING_FIELD', 'How much was handed in?')
  }

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `There is no seller with the ID "${agentId}".`)

  // A helper may record what they were handed, but only for a seller — never
  // reassign it. The scoping below is the same one the reports use.
  const allowed = visibleAgents(user)
  if (allowed && !allowed.includes(agentId)) {
    throw new ApiError(
      'NOT_AUTHORIZED',
      'You can record money for yourself. Recording it for another seller is the ' +
      "organiser's to do, because it changes what that person is shown as owing.",
    )
  }

  let bookIdx: number | null = null
  const bookNumber = String(p.bookNumber ?? '').trim()
  if (bookNumber) {
    const { data: book } = await ctx.supabaseAdmin
      .from('books').select('idx,held_by_agent').eq('number', bookNumber).maybeSingle()
    if (!book) throw new ApiError('BOOK_NOT_FOUND', `Book ${bookNumber} does not exist.`)
    bookIdx = Number((book as { idx: number }).idx)
  }

  const { data, error } = await ctx.supabaseAdmin.from('payments').insert({
    agent_id: agentId,
    amount,
    received_by: user.email,
    method: String(p.method ?? 'cash').trim() || 'cash',
    note: String(p.note ?? '').trim(),
    book_idx: bookIdx,
    source: 'hand',
  }).select('id,amount,received_at').maybeSingle()
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'RECORD_PAYMENT',
    details: { agent: agentId, amount, book: bookNumber || null },
    email: user.email,
  })

  const owed = await owedBy(ctx, agentId)
  return {
    paymentId: (data as { id?: number })?.id ?? null,
    agentId,
    agentName: String((agent as { name?: string }).name ?? agentId),
    amount,
    bookNumber: bookNumber || '',
    stillOwed: owed,
  }
}

/**
 * Undoing is a NEW ROW, never a delete.
 *
 * Cash recorded against the wrong seller happens at a table with a queue in
 * front of it. Deleting the row would leave the trail saying the mistake never
 * occurred, which is exactly what somebody checking the books later needs to
 * see. So the reversal is its own entry, and both survive.
 */
export async function reversePayment(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const id = Number(p.paymentId)
  if (!Number.isFinite(id) || id <= 0) throw new ApiError('MISSING_FIELD', 'Which payment?')

  const { data: row } = await ctx.supabaseAdmin
    .from('payments').select('*').eq('id', id).maybeSingle()
  if (!row) throw new ApiError('NOT_FOUND', 'There is no payment with that number.')

  const orig = row as Record<string, unknown>
  if (orig.reverses) {
    throw new ApiError('NOTHING_TO_DO', 'That entry is itself a reversal.')
  }

  const { data: already } = await ctx.supabaseAdmin
    .from('payments').select('id').eq('reverses', id).maybeSingle()
  if (already) throw new ApiError('NOTHING_TO_DO', 'That payment has already been reversed.')

  const reason = String(p.reason ?? '').trim()
  if (!reason) {
    throw new ApiError(
      'MISSING_FIELD',
      'Say why it is being reversed. The entry stays on the record either way, and ' +
      'a reversal nobody can explain is worse than the mistake.',
    )
  }

  const { error } = await ctx.supabaseAdmin.from('payments').insert({
    agent_id: orig.agent_id,
    amount: -Number(orig.amount ?? 0),
    received_by: user.email,
    method: String(orig.method ?? 'cash'),
    note: reason,
    book_idx: orig.book_idx ?? null,
    reverses: id,
    source: 'hand',
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'REVERSE_PAYMENT',
    details: { payment: id, agent: orig.agent_id, amount: orig.amount, reason },
    email: user.email,
  })

  return {
    reversed: id,
    agentId: String(orig.agent_id ?? ''),
    amount: Number(orig.amount ?? 0),
    stillOwed: await owedBy(ctx, String(orig.agent_id ?? '')),
  }
}

// ============ READING IT BACK ============

export async function listPayments(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const asked = String(p.agentId ?? '').trim()
  const allowed = visibleAgents(user)

  // Asking for somebody else's is turned back into your own rather than
  // refused: the same rule agent_statement already follows, and a refusal here
  // would only tell the caller that the other seller exists.
  const agentId = allowed ? (allowed[0] ?? '') : asked
  if (!agentId) return { payments: [], agentId: '', scope: moneyScope(user) }

  const { data, error } = await ctx.supabaseAdmin
    .from('payments').select('*').eq('agent_id', agentId)
    .order('received_at', { ascending: false }).limit(200)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  return {
    agentId,
    scope: moneyScope(user),
    // Mapped to the client's shape, never echoed raw: this project's most
    // repeated bug is a handler returning database columns and a screen
    // quietly rendering nothing.
    payments: (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      amount: Number(r.amount ?? 0),
      receivedAt: r.received_at,
      receivedBy: r.received_by ?? '',
      method: r.method ?? 'cash',
      note: r.note ?? '',
      bookIdx: r.book_idx ?? null,
      reverses: r.reverses ?? null,
      source: r.source ?? 'hand',
    })),
  }
}

/** What one seller still owes, expected minus everything handed in. */
export async function owedBy(ctx: Ctx, agentId: string): Promise<number> {
  const { data: books } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('counted_expected').eq('held_by_agent', agentId)
  const expected = (books ?? []).reduce(
    (s: number, b: { counted_expected: number }) => s + Number(b.counted_expected ?? 0), 0)
  const paid = (await collectedByAgent(ctx, [agentId])).get(agentId) ?? 0
  return round2(expected - paid)
}

/**
 * A settlement is also a handover, so it writes one too.
 *
 * Without this the book's declared figure and the seller's ledger would be two
 * separate truths, which is the disagreement this whole file exists to end. The
 * unique index on (book_idx) where source='settlement' means a forced re-settle
 * replaces its row rather than counting the same cash twice.
 *
 * Never throws: a settlement that failed because of its own bookkeeping echo
 * would be a money operation broken by a side note. But never silent either —
 * the same rule as the check-in hook.
 */
export async function noteSettlementPayment(
  ctx: Ctx, agentId: string, bookIdx: number, amount: number, bookNumber: string, user: AppUser,
) {
  const id = String(agentId ?? '').trim()
  try {
    if (!id || !Number.isFinite(amount)) return
    const { data: existing } = await ctx.supabaseAdmin
      .from('payments').select('id').eq('book_idx', bookIdx).eq('source', 'settlement').maybeSingle()

    if (amount === 0) {
      // Settled for nothing: remove any earlier settlement row rather than
      // leaving a figure the book no longer claims.
      if (existing) {
        await ctx.supabaseAdmin.from('payments').delete()
          .eq('book_idx', bookIdx).eq('source', 'settlement')
      }
      return
    }

    const row = {
      agent_id: id, amount: round2(amount), received_by: user.email, method: 'cash',
      note: `Counted in with ${bookNumber}`, book_idx: bookIdx, source: 'settlement',
    }
    const { error } = existing
      ? await ctx.supabaseAdmin.from('payments').update(row)
          .eq('book_idx', bookIdx).eq('source', 'settlement')
      : await ctx.supabaseAdmin.from('payments').insert(row)
    if (error) throw new Error(error.message)
  } catch (e) {
    const why = String((e as { message?: string })?.message ?? e)
    console.error(`PAYMENT_NOT_RECORDED: ${id || '(no seller)'} settling ${bookNumber}: ${why}`)
    try {
      await ctx.supabaseAdmin.from('audit_log').insert({
        action: 'PAYMENT_NOT_RECORDED',
        details: { agent: id, book: bookNumber, amount, why },
        email: user.email,
      })
    } catch { /* if the database is what failed, the log line is the record */ }
  }
}
