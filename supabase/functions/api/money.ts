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

  /*
   * AN EMPTY LIST MEANS NOTHING, NOT EVERYTHING.
   *
   * visibleAgents returns null for an organiser — no narrowing — and [] for a
   * helper who holds no books: they are not carrying anybody's money, so the
   * true answer is none. Both were reaching the queries below as
   * `agentIds && agentIds.length`, which is FALSE for [] and therefore applied
   * no filter at all. The same [] was read as "nothing" by the book filter in
   * report_draw_ready and as "everything" here, in the same function call.
   *
   * What a helper actually saw: Should have RM 0, because the books were
   * correctly scoped to none — and Handed in RM 120, the whole raffle's cash,
   * because this was not. Still owed came out at RM -120, which is how it was
   * noticed. The nonsense arithmetic and the leak were one bug.
   *
   * The fix is ONE character of guard: `if (agentIds)` rather than
   * `if (agentIds && agentIds.length)`. An empty list then reaches .in() and
   * matches nothing, which is what it means.
   *
   * I first added an early return for [] as well, and mutation testing showed
   * it was dead: with `if (agentIds)` in place, removing the early return
   * changed no behaviour, because .in([]) already returns nothing. It was a
   * guard in shape only — and worse, it MASKED the mutants that restore the
   * real bug, so the test passed with the defect back in. One load-bearing
   * guard beats two where only one carries.
   */
  let lq = ctx.supabaseAdmin.from('book_ledger_all')
    .select('held_by_agent,counted_collected').not('held_by_agent', 'is', null)
  if (agentIds) lq = lq.in('held_by_agent', agentIds)
  const { data: ledger } = await lq
  for (const b of (ledger ?? []) as Array<Record<string, unknown>>) {
    const id = String(b.held_by_agent ?? '')
    by.set(id, round2((by.get(id) ?? 0) + Number(b.counted_collected ?? 0)))
  }

  /*
   * NAMED, NOT "EVERYTHING EXCEPT SETTLEMENT".
   *
   * This said `.neq('source','settlement')`, which meant "every kind of row we
   * have not thought of yet is cash". The moment a write-off existed — a debt
   * the raffle has decided will not be collected — that row would have been
   * added to what a seller HANDED IN, and the total would have said the money
   * arrived. Asking for the one kind that is cash cannot fail that way when a
   * fourth kind is added.
   *
   * Settlement rows are excluded for a different reason and it is not a
   * kinship: the book's own amount_paid is already in the ledger figure above,
   * so counting them here would charge the same cash twice.
   */
  let pq = ctx.supabaseAdmin.from('payments')
    .select('agent_id,amount,source').eq('source', 'hand')
  if (agentIds) pq = pq.in('agent_id', agentIds)
  const { data: paid, error } = await pq
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  for (const r of (paid ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.agent_id ?? '')
    by.set(id, round2((by.get(id) ?? 0) + Number(r.amount ?? 0)))
  }

  return by
}

/**
 * What has been written off per seller — debt the raffle has decided will not
 * be collected.
 *
 * SEPARATE FROM COLLECTED ON PURPOSE, and it is the whole reason this is its
 * own function rather than a flag on the last one. "Handed in" and "forgiven"
 * both reduce what somebody owes and they are not the same fact: one is cash
 * in a tin and the other is a decision somebody signed. A screen that added
 * them together would tell an organiser money had come in, and the seller
 * whose debt was forgiven would appear to have paid it.
 */
export async function writtenOffByAgent(ctx: Ctx, agentIds?: string[] | null) {
  const by = new Map<string, number>()
  let q = ctx.supabaseAdmin.from('payments').select('agent_id,amount').eq('source', 'writeoff')
  if (agentIds) q = q.in('agent_id', agentIds)
  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.agent_id ?? '')
    by.set(id, round2((by.get(id) ?? 0) + Number(r.amount ?? 0)))
  }
  return by
}

/** Money is read aloud to the person who owes it; floating point is not. */
export const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Sales that never had a seller: tickets sold out of books nobody is holding.
 *
 * The ledger counted their price as expected and nothing could count it as
 * collected — a desk sale's cash goes straight into the tin, which is what
 * payment_status 'Paid' means on one — so the overview showed money owed by
 * nobody, for ever. Summed in the database (desk_money) rather than here.
 */
export async function deskMoney(ctx: Ctx): Promise<{ sold: number; expected: number; collected: number }> {
  const { data, error } = await ctx.supabaseAdmin.rpc('desk_money', {})
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  const d = (data ?? {}) as Record<string, unknown>
  return {
    sold: Number(d.sold ?? 0),
    expected: round2(Number(d.expected ?? 0)),
    collected: round2(Number(d.collected ?? 0)),
  }
}

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
/**
 * A debt the raffle has decided will not be collected.
 *
 * WHY THIS HAD TO EXIST. Readiness rule L6 says the draw is ready when
 * outstanding money is zero, OR every non-zero line has been explicitly
 * written off with a reason. Only the first half was buildable. A raffle with
 * one seller who genuinely never pays — who moved, who is unreachable, who
 * lost the book — could never read as ready, and the only way to clear the
 * blocker was to record a payment that never happened. A rule that can only
 * be satisfied by lying is worse than no rule, because it teaches people to
 * put false figures in the one place the raffle keeps its accounts.
 *
 * IT IS NOT A PAYMENT AND MUST NEVER BE SUMMED AS ONE. It lives in the same
 * table because it belongs to the same running total and because every
 * correction to money here is a row with a reason rather than an edit — but
 * `source` says which kind it is, and collectedByAgent asks for cash by name.
 *
 * THE REASON IS THE POINT. This is the one entry in the ledger that says money
 * is gone and nobody is chasing it. In a year somebody will ask why RM120 was
 * forgiven, and "written off" is not an answer. Short reasons are refused for
 * the same cause: "lost" is a word, not an explanation.
 *
 * IT CANNOT FORGIVE MORE THAN IS OWED. Writing off more than the debt would
 * turn a seller's balance negative and read, on every screen, as the raffle
 * owing them money.
 */
export async function writeOff(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Whose debt?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const reason = String(p.reason ?? '').trim()
  if (reason.length < 10) {
    throw new ApiError(
      'MISSING_FIELD',
      'Say why this money is not coming back, in a sentence somebody can read in a ' +
      'year. This is the one entry that says money is gone and nobody is chasing it.',
    )
  }

  const owed = await owedBy(ctx, agentId)
  if (owed <= 0) {
    throw new ApiError(
      'NOTHING_TO_DO',
      `${agent.name} does not owe anything, so there is nothing to write off.`,
      { owed },
    )
  }

  // Unstated means all of it, which is the common case: somebody has gone and
  // whatever they owed is not coming.
  const asked = p.amount === undefined || p.amount === null || p.amount === ''
    ? owed : Number(p.amount)
  if (!Number.isFinite(asked) || asked <= 0) {
    throw new ApiError('BAD_REQUEST', 'How much is being written off?')
  }
  const amount = round2(asked)
  if (amount > owed) {
    throw new ApiError(
      'TOO_MUCH',
      `${agent.name} owes ${owed}. Writing off ${amount} would leave the raffle owing ` +
      'them money, which is not what happened.',
      { owed, asked: amount },
    )
  }

  const { data: row, error } = await ctx.supabaseAdmin.from('payments').insert({
    agent_id: agentId,
    amount,
    received_by: user.email,
    method: 'writeoff',
    source: 'writeoff',
    note: reason,
  }).select('id').maybeSingle()
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'WRITE_OFF',
    details: { agent: agentId, name: agent.name, amount, owedBefore: owed, reason },
    email: user.email,
  })

  const left = round2(owed - amount)
  return {
    agent: { id: agentId, name: agent.name },
    amount,
    reason,
    writeOffId: (row as { id?: number } | null)?.id ?? null,
    owedBefore: owed,
    stillOwed: left,
    by: user.email,
    message: left > 0
      ? `${amount} written off. ${agent.name} still owes ${left}.`
      : `${amount} written off. ${agent.name}'s account is closed.`,
  }
}

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
  // Forgiven is not owed. A debt written off with a reason has been decided
  // about; leaving it in this number would keep a seller on the chase list for
  // money somebody already agreed would never come.
  const forgiven = (await writtenOffByAgent(ctx, [agentId])).get(agentId) ?? 0
  return round2(expected - paid - forgiven)
}

/*
 * noteSettlementPayment USED TO LIVE HERE, and deleting it is the point.
 *
 * It wrote the settlement's payment row AFTER settle_book returned, in a call
 * that swallowed its own failures so that a bookkeeping row could never stop a
 * book being closed. The price was that the book and the ledger could
 * disagree — a book saying RM120 came in over a ledger with no row for it —
 * and it updated in place on a re-settle and deleted the row outright at zero,
 * both of which destroy the evidence that the first figure was ever claimed.
 *
 * settle_book writes the row itself now, in the transaction that counted the
 * money, and a re-settle reverses rather than replaces. Leaving this function
 * here unused would leave a loaded gun on the table: it still compiles, it
 * still writes outside any transaction, and the next person to want "record
 * the settlement payment" would find it and call it.
 */
