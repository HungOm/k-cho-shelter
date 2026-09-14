/**
 * Reports — ported from Reports.gs.
 *
 * Most of these were loops over every ticket in the spreadsheet. Here they are
 * queries, and several are one line, because the work they were doing by hand
 * is what a database does.
 *
 * THE ONE-SOURCE RULE, carried over exactly. A Settled or Lost book reports its
 * DECLARED figures; every other book reports what the ticket rows say. The two
 * are never added together. Once a book is closed the money that actually
 * arrived is the truth, and mixing a declared total with recorded rows produces
 * a number that reconciles against nothing. book_ledger encodes this, so every
 * report below inherits it rather than re-deciding it.
 */
import { ApiError, type AppUser } from './gate.ts'
import { configDate, today } from './deadlines.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

async function currency(ctx: Ctx): Promise<string> {
  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'CURRENCY').maybeSingle()
  return data?.value ?? 'RM'
}

/** What each seller still owes: what their books are worth, less what came in. */
export async function reportOutstanding(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('held_by_agent,agent_name,number,status,counted_sold,counted_expected,counted_collected')
    .not('held_by_agent', 'is', null)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const byAgent = new Map<string, {
    agentId: string; agentName: string; books: string[]
    sold: number; expected: number; collected: number
  }>()

  for (const r of data ?? []) {
    const key = String(r.held_by_agent)
    const a = byAgent.get(key) ?? {
      agentId: key, agentName: r.agent_name ?? key, books: [],
      sold: 0, expected: 0, collected: 0,
    }
    a.books.push(r.number)
    a.sold += Number(r.counted_sold ?? 0)
    a.expected += Number(r.counted_expected ?? 0)
    a.collected += Number(r.counted_collected ?? 0)
    byAgent.set(key, a)
  }

  const rows = [...byAgent.values()]
    .map((a) => ({ ...a, outstanding: a.expected - a.collected }))
    // Biggest debt first: this list exists to decide who to telephone, and
    // alphabetical order would answer a question nobody asked.
    .sort((x, y) => y.outstanding - x.outstanding)

  return {
    agents: rows,
    totalOutstanding: rows.reduce((s, a) => s + a.outstanding, 0),
    currency: await currency(ctx),
  }
}

/** Books past the date they were due back, oldest first. */
export async function reportOverdue(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('number,agent_name,held_by_agent,due_at,days_overdue,counted_sold')
    .eq('status', 'Out').gt('days_overdue', 0)
    .order('days_overdue', { ascending: false })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // The phone number is what makes this list actionable — it is a chase list,
  // not a report — so it is fetched alongside rather than left to a second call.
  const ids = [...new Set((data ?? []).map((r: { held_by_agent: string }) => r.held_by_agent))]
  const { data: agents } = ids.length
    ? await ctx.supabaseAdmin.from('agents').select('agent_id,phone').in('agent_id', ids)
    : { data: [] }
  const phones = new Map((agents ?? []).map((a: { agent_id: string; phone: string }) => [a.agent_id, a.phone]))

  // Both dates travel with the list. An overdue book means something different
  // before and after the wall: before it, late for a checkpoint and worth a
  // telephone call; after it, late for the raffle itself.
  const checkInDate = await configDate(ctx, 'CHECK_IN_DATE')
  const finalDeadline = await configDate(ctx, 'FINAL_DEADLINE')

  const books = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r, phone: phones.get(String(r.held_by_agent)) ?? '',
  }))

  return {
    books,
    count: books.length,
    checkInDate,
    finalDeadline,
    // Raffle-wide, not per book: the wall is one date for everybody, so within
    // any one report this is all of them or none.
    pastFinal: !!finalDeadline && finalDeadline < today(),
    pastFinalCount: books.filter((b: Record<string, unknown>) => b.past_final).length,
  }
}

/**
 * Sold tickets with nobody to ring.
 *
 * The most important report in the system on the day of the draw: a sold ticket
 * with no contact details is a winner you cannot find.
 */
export async function reportMissingContact(p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const active = Number((await ctx.supabaseAdmin.rpc('active_tickets', {})).data ?? 0)
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .select('number,book_idx,buyer_name,buyer_phone,sold_by_agent,sold_at')
    .in('status', ['Sold', 'Donated'])
    .lte('idx', active)
    .or('buyer_phone.eq.,buyer_name.eq.')
    .order('idx')
    .limit(Math.min(Number(p.limit ?? 500), 1000))
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  return { tickets: data ?? [], count: data?.length ?? 0 }
}

/**
 * Is the draw ready?
 *
 * Deliberately blunt: it reports what is wrong rather than a score, because the
 * only useful version of this answers "what do I still have to chase".
 */
export async function reportDrawReady(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const active = Number((await ctx.supabaseAdmin.rpc('active_tickets', {})).data ?? 0)

  const count = async (build: (q: any) => any) => {
    const { count: n } = await build(
      ctx.supabaseAdmin.from('tickets').select('idx', { count: 'exact', head: true }),
    )
    return n ?? 0
  }

  const sold = await count((q: any) => q.in('status', ['Sold', 'Donated']).lte('idx', active))
  const missingContact = await count((q: any) =>
    q.in('status', ['Sold', 'Donated']).lte('idx', active).or('buyer_phone.eq.,buyer_name.eq.'))
  const reserved = await count((q: any) => q.eq('status', 'Reserved').lte('idx', active))

  const { data: books } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('status,counted_expected,counted_collected')
  const unsettled = (books ?? []).filter((b: { status: string }) =>
    b.status === 'Out' || b.status === 'Returned').length
  const outstanding = (books ?? []).reduce(
    (s: number, b: { counted_expected: number; counted_collected: number }) =>
      s + (Number(b.counted_expected ?? 0) - Number(b.counted_collected ?? 0)), 0)

  const problems = []
  if (missingContact) {
    problems.push({
      what: 'tickets sold with no way to contact the buyer',
      count: missingContact,
      // Said plainly because this is the one that cannot be fixed afterwards.
      why: 'If one of these wins, there is no way to tell them.',
    })
  }
  if (unsettled) {
    problems.push({ what: 'books not yet settled', count: unsettled,
      why: 'Their tickets may not be recorded correctly yet.' })
  }
  if (outstanding > 0) {
    problems.push({ what: 'money not handed in', count: outstanding,
      why: 'Sold, but the cash has not come back.' })
  }
  if (reserved) {
    problems.push({ what: 'tickets still being held', count: reserved,
      why: 'Neither sold nor available — decide before the draw.' })
  }

  // Drawing before the wall means drawing from books that are still legitimately
  // out. Those sellers have not done anything wrong — they have until the final
  // deadline — so the raffle is not ready, however tidy the rest of it looks.
  const finalDeadline = await configDate(ctx, 'FINAL_DEADLINE')
  const now = today()
  if (finalDeadline && finalDeadline >= now) {
    problems.push({
      what: 'the final deadline has not passed',
      count: 0,
      why: `Books are due back by ${finalDeadline}. Sellers still holding paper are not ` +
           'late, so drawing now would draw from books nobody has counted.',
    })
  }

  // Books by status, which the home screen colours its grid from.
  const booksByStatus: Record<string, number> = {}
  for (const b of books ?? []) {
    const k = String((b as { status?: string }).status ?? '')
    booksByStatus[k] = (booksByStatus[k] ?? 0) + 1
  }

  const voided = await count((q: any) => q.eq('status', 'Void').lte('idx', active))
  const availableCount = await count((q: any) => q.eq('status', 'Available').lte('idx', active))
  const expected = (books ?? []).reduce(
    (s: number, b: { counted_expected: number }) => s + Number(b.counted_expected ?? 0), 0)
  const collected = (books ?? []).reduce(
    (s: number, b: { counted_collected: number }) => s + Number(b.counted_collected ?? 0), 0)

  /*
   * SHAPED LIKE handleReportDrawReady IN Reports.gs, field for field.
   *
   * This is what the home screen builds its whole overview from — the progress
   * bar, the money raised, the book grid. It previously returned a `problems`
   * list of objects and no `totals` at all, so state.totals was undefined, the
   * overview computed to null, and the page sat on "Getting your raffle… One
   * moment…" forever. On every account, however well everything else worked.
   *
   * The tickets had in fact loaded. Nothing was broken except the shape of one
   * reply, which is the third time today that a payload the server was happy
   * with was one the browser could not use.
   */
  const blockers = problems.map((x) => `${x.what}${x.count ? ` (${x.count})` : ''}`)

  return {
    currency: await currency(ctx),
    drawDate: await configDate(ctx, 'DRAW_DATE'),
    checkInDate: await configDate(ctx, 'CHECK_IN_DATE'),
    finalDeadline,
    finalPassed: !!finalDeadline && finalDeadline < now,
    ready: problems.length === 0,
    blockers,
    totals: {
      ticketsSold: sold,
      ticketsAvailable: availableCount,
      ticketsReserved: reserved,
      ticketsVoid: voided,
      eligibleEntries: Math.max(0, sold),
      expected: Math.round(expected * 100) / 100,
      collected: Math.round(collected * 100) / 100,
      outstanding: Math.round((expected - collected) * 100) / 100,
      missingContact,
    },
    booksByStatus,
    // Kept alongside: the richer form carries the reason, which the blunt
    // blocker strings cannot, and a later screen may want it.
    problems,
    active,
    today: now,
  }
}

/** One seller's books and what they owe — the sheet you hand them. */
export async function agentStatement(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  // An agent may only ever pull their own. Asking for somebody else's is not an
  // error worth explaining — it is quietly turned back into their own.
  const agentId = user.role === 'agent'
    ? (user.agentId ?? '')
    : String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('*').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const { data: books } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('*').eq('held_by_agent', agentId).order('idx')

  const expected = (books ?? []).reduce((s: number, b: { counted_expected: number }) => s + Number(b.counted_expected ?? 0), 0)
  const collected = (books ?? []).reduce((s: number, b: { counted_collected: number }) => s + Number(b.counted_collected ?? 0), 0)

  return {
    agent: { id: agent.agent_id, name: agent.name, phone: agent.phone, zone: agent.zone },
    books: books ?? [],
    sold: (books ?? []).reduce((s: number, b: { counted_sold: number }) => s + Number(b.counted_sold ?? 0), 0),
    expected, collected, outstanding: expected - collected,
    currency: await currency(ctx),
  }
}

/**
 * Every entry in the draw. Super-admin only, because it is every buyer's name
 * and phone number in one file — the single biggest privacy exposure here.
 */
export async function exportEntries(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const active = Number((await ctx.supabaseAdmin.rpc('active_tickets', {})).data ?? 0)
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .select('number,buyer_name,buyer_phone,buyer_zone,sold_by_agent,amount,sold_at,status')
    .in('status', ['Sold', 'Donated'])
    .lte('idx', active)
    .order('idx')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  return { entries: data ?? [], count: data?.length ?? 0 }
}

// ============ WINNERS ============

export async function listWinners(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('winners').select('*, tickets(number,buyer_name,buyer_phone)').order('drawn_at')
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return { winners: data ?? [] }
}

export async function recordWinner(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = String(p.ticketNumber ?? '').trim()
  if (!number) throw new ApiError('MISSING_FIELD', 'Which ticket won?')

  const { data: t } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number,status,buyer_name,buyer_phone').eq('number', number).maybeSingle()
  if (!t) throw new ApiError('TICKET_NOT_FOUND', `Ticket ${number} does not exist.`, null, 404)

  // A ticket nobody bought cannot win. Drawing one would mean either a prize
  // going nowhere or, worse, somebody deciding afterwards who had it.
  if (t.status !== 'Sold' && t.status !== 'Donated') {
    throw new ApiError(
      'NOT_ELIGIBLE',
      `Ticket ${number} is ${String(t.status).toLowerCase()}, so it was never sold.`,
    )
  }

  const { error } = await ctx.supabaseAdmin.from('winners').insert({
    ticket_idx: t.idx,
    prize: String(p.prize ?? ''),
    // The buyer is copied in rather than joined, so the record of who won says
    // what it said on the day even if the ticket row is corrected later.
    buyer_name: t.buyer_name, buyer_phone: t.buyer_phone,
    recorded_by: user.email,
  })
  if (error) {
    if (String(error.message).includes('duplicate')) {
      throw new ApiError('BAD_REQUEST', `Ticket ${number} has already been drawn.`)
    }
    throw new ApiError('QUERY_FAILED', error.message)
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'RECORD_WINNER', details: { ticket: number, prize: p.prize }, email: user.email,
  })
  return { ticketNumber: number, buyerName: t.buyer_name, buyerPhone: t.buyer_phone }
}
