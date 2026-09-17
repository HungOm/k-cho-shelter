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
 * Which sellers this person may be told about BY NAME.
 *
 * Returns null for "everybody" and a list otherwise, so a caller can put the
 * decision in one place instead of re-deriving it per report.
 */
export function visibleAgents(user: AppUser): string[] | null {
  if (user.isAdmin) return null
  // An agent, or a helper who also carries books, sees their own line. A helper
  // with no agent record sees none, which is the true answer rather than a
  // refusal — they are not holding anybody's money. A viewer sees none either:
  // oversight is about the shape of the raffle, not about who is behind.
  const own = String(user.agentId ?? '').trim()
  return own ? [own] : []
}

/**
 * Whose money counts toward the TOTALS this person is shown.
 *
 * TWO DIFFERENT QUESTIONS WERE BEING ANSWERED BY ONE VALUE, which is the same
 * mistake as the empty-list guard below, one level up. "Whose name may I see"
 * and "whose money is in my total" are not the same question, and a VIEWER is
 * exactly the person for whom the answers differ: no names at all, and the
 * whole raffle's money — oversight is the entire point of the role.
 *
 * visibleAgents said [] for them, so the totals summed nothing and a viewer's
 * Money screen read Should have 0, Handed in 0, Still owed 0. Before the empty
 * list was fixed it read 0, everything, minus-everything. Neither was the
 * number somebody checking on the raffle is there to see, and the comment on
 * visibleAgents claimed the opposite of what its return value did.
 *
 * A helper holding no books still gets [], and that is not an oversight: they
 * are not carrying anybody's money and nothing about the raffle's balance is
 * answerable from what they did at a desk for an afternoon.
 */
export function totalsAgents(user: AppUser): string[] | null {
  if (user.isAdmin || user.role === 'viewer') return null
  const own = String(user.agentId ?? '').trim()
  return own ? [own] : []
}

/**
 * Which money screen this person gets.
 *
 *   all       an organiser: every seller, by name
 *   mine      a seller, or a helper who also carries books: their own line
 *   totals    a viewer: the raffle's figures, nobody's name
 *   recorded  a helper carrying nothing: the sales THEY wrote down
 *
 * 'totals' used to mean the last three at once, so the screen could not tell an
 * auditor from a volunteer at a desk and said the same unhelpful thing to both.
 *
 * THE FOURTH IS NOT 'none', AND THE DIFFERENCE IS THE WHOLE POINT. A helper
 * holding no books owes nothing and is owed nothing, so every figure on the
 * old screen was somebody else's — but they did spend an afternoon writing
 * sales down, and that is theirs. Hiding the screen answered the privacy
 * question by taking away the one record they have of their own work.
 *
 * What 'recorded' scopes to is NOT a share of the raffle's money. It is the
 * tickets carrying their email in recorded_by: how many they wrote down, what
 * those came to, how many buyers had paid at the desk. Nothing about what
 * anybody owes, because a helper never does.
 */
export function moneyScope(user: AppUser): 'all' | 'mine' | 'totals' | 'recorded' {
  if (user.isAdmin) return 'all'
  if (String(user.agentId ?? '').trim()) return 'mine'
  return user.role === 'viewer' ? 'totals' : 'recorded'
}

/**
 * Whether a scope carries the WHO-OWES-WHAT table. Spelled once.
 *
 * Deliberately not `scope !== 'totals'`, which is what the two screens each
 * wrote for themselves and what broke the moment a fourth scope existed: a
 * helper would have fallen through to the table branch and been handed the
 * rows the split was made to keep from them. A list of debts is released to
 * exactly two people — the organiser, and the seller whose debt it is.
 */
export function showsSellerNames(scope: string): boolean {
  return scope === 'all' || scope === 'mine'
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
  /*
   * SUMMED BY POSTGRES, NOT BY THIS LOOP.
   *
   * This read the book ledger and the payments table and added them up here,
   * which meant `numeric(12,2)` — a type that exists so money is not a binary
   * float — became a Number the moment it left the database, and the guarantee
   * was given up for nothing. The same arithmetic was also written out in
   * owedBy and in the outstanding report, and three copies of one sum is how
   * two of them come to disagree.
   *
   * agent_money does it once, in the database, in the type the column has. The
   * conversion to a Number happens at the very end, on a single value per
   * seller, which is what has to cross into JavaScript anyway.
   */
  const by = new Map<string, number>()
  let q = ctx.supabaseAdmin.from('agent_money').select('agent_id,collected')
  if (agentIds) q = q.in('agent_id', agentIds)
  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    by.set(String(r.agent_id ?? ''), round2(Number(r.collected ?? 0)))
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
  let q = ctx.supabaseAdmin.from('agent_money').select('agent_id,written_off')
  if (agentIds) q = q.in('agent_id', agentIds)
  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    by.set(String(r.agent_id ?? ''), round2(Number(r.written_off ?? 0)))
  }
  return by
}

/** Money is read aloud to the person who owes it; floating point is not. */
export const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * RECORDING THE SAME MONEY TWICE IS THE RETRY, NOT A SECOND PAYMENT.
 *
 * A ticket sale is idempotent by nature: the ticket number is the key, the
 * version check makes a second attempt fail loudly, and the sell screen reads
 * the rows back one by one to see what landed. A PAYMENT has no natural key.
 * RM60 for one seller twice is indistinguishable from two genuine RM60
 * payments — and after a write times out the app tells the person, in as many
 * words, "Checking what went through". That sentence is on the screen at the
 * precise moment somebody on bad signal in a car park presses the button again.
 *
 * So the CALLER names the attempt and reuses that name on every retry of it.
 * A second insert with the same name is not an error: it returns the row the
 * first one wrote. Refusing would be the same problem in a different coat —
 * the volunteer cannot tell "already recorded" from "record it again", and one
 * of those two answers loses money.
 *
 * NO KEY IS STILL ALLOWED, and means "I am not claiming this is a retry".
 * Everything written before today, and every path that has no client to ask,
 * carries none. The unique index is partial for exactly that reason.
 */
const DUPLICATE = '23505'

export async function insertPayment(
  ctx: Ctx,
  row: Record<string, unknown>,
  clientKey: unknown,
): Promise<{ id: number | null; replayed: boolean }> {
  const key = String(clientKey ?? '').trim().slice(0, 100)
  const { data, error } = await ctx.supabaseAdmin
    .from('payments').insert({ ...row, client_key: key || null })
    .select('id').maybeSingle()

  if (!error) return { id: (data as { id?: number })?.id ?? null, replayed: false }

  // Only THIS key colliding is a replay. Any other unique violation is a real
  // fault and has to travel as one rather than being reported as a success.
  const code = (error as { code?: string }).code
  const message = String((error as { message?: string }).message ?? '')
  if (!key || code !== DUPLICATE || !message.includes('client_key')) {
    throw new ApiError('QUERY_FAILED', message)
  }

  const { data: existing } = await ctx.supabaseAdmin
    .from('payments').select('id').eq('client_key', key).maybeSingle()
  return { id: (existing as { id?: number })?.id ?? null, replayed: true }
}

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

  const { id, replayed } = await insertPayment(ctx, {
    agent_id: agentId,
    amount,
    received_by: user.email,
    method: String(p.method ?? 'cash').trim() || 'cash',
    note: String(p.note ?? '').trim(),
    book_idx: bookIdx,
    source: 'hand',
  }, p.clientKey)

  // A replay wrote nothing, so it logs nothing. An audit trail that grows a row
  // every time a phone retries would report one payment as four.
  if (!replayed) {
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'RECORD_PAYMENT',
      details: { agent: agentId, amount, book: bookNumber || null },
      email: user.email,
    })
  }

  const owed = await owedBy(ctx, agentId)
  return {
    paymentId: id,
    // So the screen can say "already recorded" rather than "recorded", which is
    // the difference between a volunteer trusting the number and counting the
    // cash again.
    replayed,
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

  const { id: writeOffRow, replayed } = await insertPayment(ctx, {
    agent_id: agentId,
    amount,
    received_by: user.email,
    method: 'writeoff',
    source: 'writeoff',
    note: reason,
  }, p.clientKey)

  if (!replayed) {
    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'WRITE_OFF',
      details: { agent: agentId, name: agent.name, amount, owedBefore: owed, reason },
      email: user.email,
    })
  }

  const left = round2(owed - amount)
  return {
    agent: { id: agentId, name: agent.name },
    amount,
    reason,
    writeOffId: writeOffRow,
    // Said back, so a screen can tell "already written off" from "written off"
    // rather than showing the same decision twice to somebody who tapped twice.
    replayed,
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

  /*
   * A REVERSAL NEEDS NO KEY: it already has one.
   *
   * `reverses` names the row being undone, and only one row may undo it, so a
   * retried reversal finds this guard and stops. That is the natural key a
   * plain payment does not have — which is why only the plain ones carry a
   * client key.
   */
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
  // One row, one number, already worked out. This used to read every book the
  // seller holds, sum the expected column here, read the payments, sum those
  // here, and subtract — the whole of agent_money, rebuilt on each call in a
  // type that cannot hold money exactly.
  const { data, error } = await ctx.supabaseAdmin
    .from('agent_money').select('outstanding').eq('agent_id', agentId).maybeSingle()
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return round2(Number((data as { outstanding?: number } | null)?.outstanding ?? 0))
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
