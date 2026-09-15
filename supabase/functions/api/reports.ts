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
import { ApiError, mask, agentBooks, type AppUser } from './gate.ts'
import { configDate, today } from './deadlines.ts'
import { collectedByAgent, moneyScope, round2, visibleAgents } from './money.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

async function currency(ctx: Ctx): Promise<string> {
  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'CURRENCY').maybeSingle()
  return data?.value ?? 'RM'
}

/** What each seller still owes: what their books are worth, less what came in. */
/*
 * Who owes money, and how much.
 *
 * PORTED WRONG, and the screen it feeds was broken on the deployed default
 * until today. It returned agentName / books / sold where the client reads
 * name / booksOut / ticketsSold, so the seller, books and sold columns were
 * blank — a table of amounts owed by nobody, which is the one question it
 * exists to answer. The money columns matched, so it looked populated and
 * authoritative while failing entirely.
 *
 * Three things beyond the spelling were also wrong, and none of them would have
 * shown as a blank column:
 *
 *   booksOut counted every book the seller holds, not the ones that are OUT.
 *   A returned-but-unsettled book still has held_by_agent set, so a seller who
 *   had handed everything back still read as carrying them.
 *
 *   overdueBooks, booksSettled, phone and zone were absent outright. The "N
 *   late" badge has therefore never rendered on this backend — not wrong, just
 *   permanently invisible, which is harder to notice than wrong.
 *
 *   The agent scoping was dropped. Apps Script narrows this to the caller's own
 *   row when they are a seller; this returned every seller's debts to anybody
 *   who asked. A seller could read what every other seller owed.
 */
export async function reportOutstanding(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  /*
   * WHO MAY BE TOLD ABOUT WHOM, decided once, here.
   *
   * An organiser sees every seller. Anybody else sees their own line and no
   * other — a seller's debt is not another seller's business, and a helper at a
   * desk has no reason to hold the whole raffle's ledger on their phone. A
   * viewer is trusted with the totals and not with who owes them, so they get
   * no rows at all rather than a filtered list that hints at what is missing.
   */
  const only = visibleAgents(user)
  const scope = moneyScope(user)

  const { data, error } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('held_by_agent,agent_name,number,status,days_overdue,' +
            'counted_sold,counted_expected,counted_collected')
    .not('held_by_agent', 'is', null)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Sellers are read separately: the ledger view carries the name but not the
  // telephone number, and the chase button on the Money screen is the whole
  // point of the report.
  const { data: agents } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name,phone,zone')
  const byId = new Map((agents ?? []).map((a) => [String(a.agent_id), a]))

  type Row = {
    agentId: string; name: string; phone: string; zone: string
    booksOut: number; booksSettled: number; overdueBooks: number
    ticketsSold: number; expected: number; collected: number; outstanding: number
  }
  const byAgent = new Map<string, Row>()

  for (const r of data ?? []) {
    const key = String(r.held_by_agent)
    if (only && !only.includes(key)) continue

    const who = byId.get(key)
    const a = byAgent.get(key) ?? {
      agentId: key,
      name: (who?.name ?? r.agent_name ?? '') || key,
      phone: who?.phone ?? '', zone: who?.zone ?? '',
      booksOut: 0, booksSettled: 0, overdueBooks: 0,
      ticketsSold: 0, expected: 0, collected: 0, outstanding: 0,
    }
    if (r.status === 'Out') a.booksOut++
    if (r.status === 'Settled') a.booksSettled++
    if (Number(r.days_overdue ?? 0) > 0) a.overdueBooks++
    a.ticketsSold += Number(r.counted_sold ?? 0)
    a.expected += Number(r.counted_expected ?? 0)
    byAgent.set(key, a)
  }

  /*
   * HANDED IN COMES FROM THE LEDGER, not from the books.
   *
   * books.amount_paid only ever moves when a book is CLOSED, so a seller who
   * brings half the money and keeps the book to sell the rest showed as having
   * handed in nothing. Summing the payments answers what actually came back,
   * and settlement writes a payment row of its own, so a settled book counts
   * exactly once and no existing total moves.
   */
  const paid = await collectedByAgent(ctx, only)
  for (const [id, a] of byAgent) a.collected = paid.get(id) ?? 0

  const rows = [...byAgent.values()]
    // Rounded like the Sheet: floating point turns 30 - 10.1 into a figure with
    // fifteen decimal places, and this one is read aloud to the person who owes it.
    .map((a) => ({ ...a, outstanding: Math.round((a.expected - a.collected) * 100) / 100 }))
    // Biggest debt first: this list exists to decide who to telephone, and
    // alphabetical order would answer a question nobody asked.
    .sort((x, y) => y.outstanding - x.outstanding)

  // A viewer gets the shape without the names: enough to see the raffle is
  // healthy, nothing about who is behind on what.
  const totalExpected = round2(rows.reduce((s, a) => s + a.expected, 0))
  const totalCollected = round2(rows.reduce((s, a) => s + a.collected, 0))

  return {
    agents: scope === 'totals' ? [] : rows,
    scope,
    totalExpected,
    totalCollected,
    totalOutstanding: round2(rows.reduce((s, a) => s + a.outstanding, 0)),
    currency: await currency(ctx),
  }
}

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
export async function reportMissingContact(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const active = Number((await ctx.supabaseAdmin.rpc('active_tickets', {})).data ?? 0)
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .select('number,book_idx,buyer_name,buyer_phone,sold_by_agent,sold_at,recorded_by')
    .in('status', ['Sold', 'Donated'])
    .lte('idx', active)
    .or('buyer_phone.eq.,buyer_name.eq.')
    .order('idx')
    .limit(Math.min(Number(p.limit ?? 500), 1000))
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  /*
   * MASKED, like every other path that hands out a buyer.
   *
   * Every row here has a name or a phone missing — that is the filter — but the
   * OTHER half is present, and this report is callable by a helper. So it
   * handed a helper the names of buyers they never recorded, which is the
   * narrowing undone by the report whose job is to find gaps in it.
   *
   * It stays useful narrowed: a helper sees their own entries in full, and for
   * everyone else's sees the ticket number and who sold it, which is the person
   * to ask. Chasing a missing number goes through the seller anyway.
   */
  const holds = await agentBooks(user, ctx)
  const tickets = (data ?? []).map((t: Record<string, unknown>) => mask(t, user, holds))
  return { tickets, count: tickets.length }
}

/**
 * Is the draw ready?
 *
 * Deliberately blunt: it reports what is wrong rather than a score, because the
 * only useful version of this answers "what do I still have to chase".
 */
export async function reportDrawReady(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  /*
   * TICKET COUNTS ARE THE RAFFLE'S; THE MONEY IS WHOSE IT IS.
   *
   * Everyone may see how the raffle is doing — how many sold, how many books
   * are out, whether the draw is ready. Those are the shared facts a volunteer
   * needs to feel part of it. What narrows is the money: a helper holding no
   * books has no business carrying the whole raffle's outstanding balance on
   * their phone, and a seller's figure should be their own.
   */
  const only = visibleAgents(user)
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
    .from('book_ledger_all').select('status,held_by_agent,counted_expected,counted_collected')
  const unsettled = (books ?? []).filter((b: { status: string }) =>
    b.status === 'Out' || b.status === 'Returned').length

  // The books whose money this person may be told about.
  const mineBooks = (books ?? []).filter((b: { held_by_agent?: string | null }) =>
    !only || only.includes(String(b.held_by_agent ?? '')))
  const paidBy = await collectedByAgent(ctx, only)
  const collectedScoped = round2([...paidBy.values()].reduce((s, n) => s + n, 0))
  const expectedScoped = round2(mineBooks.reduce(
    (s: number, b: { counted_expected: number }) => s + Number(b.counted_expected ?? 0), 0))
  const outstanding = round2(expectedScoped - collectedScoped)

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
  const expected = expectedScoped
  const collected = collectedScoped

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

export async function listWinners(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('winners')
    .select('*, tickets(number,book_idx,buyer_name,buyer_phone,recorded_by)')
    .order('drawn_at')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  /*
   * MASKED, and it was not. The signature said `_u` — the caller deliberately
   * unused — and viewer and recorder can both call this action. So a VIEWER,
   * whose entire defining property is that telephone numbers come through as
   * ••••100, read every winner's number in full; and a helper read them
   * regardless of who recorded the sale.
   *
   * The masker was correct in the three places index.ts called it, and being
   * correct there is what stopped anyone looking here. Three was not all of
   * them.
   *
   * A winner's NAME survives — announcing who won is what a draw is for. It is
   * the telephone number that belongs to the person who has to ring them.
   */
  const holds = await agentBooks(user, ctx)
  const winners = (data ?? []).map((w: Record<string, unknown>) => {
    const t = w.tickets as Record<string, unknown> | null
    if (!t) return w
    // The NAME survives for everyone, and that is a deliberate departure from
    // the masker rather than an oversight. Applying it whole inverted the
    // hierarchy: a viewer kept the name and a helper lost it, so the LESS
    // trusted role saw more. And announcing who won is what a draw is for —
    // it is the telephone number that belongs only to whoever has to ring them.
    return { ...w, tickets: { ...mask(t, user, holds), buyer_name: t.buyer_name } }
  })
  return { winners }
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
