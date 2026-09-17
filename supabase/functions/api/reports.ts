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
import {
  checkInRound, configDate, configNum, reportedIn, reportState, today,
} from './deadlines.ts'
import {
  collectedByAgent, deskMoney, moneyScope, round2, showsSellerNames, totalsAgents,
  visibleAgents, writtenOffByAgent,
} from './money.ts'
// For nextSeat. reports.ts imports prizes.ts and not the other way round — the
// awarding needs the schedule, the schedule needs nothing from the reports.
import * as prizes from './prizes.ts'

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
   * TWO DECISIONS, AND THEY ARE NOT THE SAME ONE.
   *
   * WHOSE MONEY IS IN THE SUM is `only`, and WHO GETS THE ROWS is `scope`. This
   * function used one value for both and a viewer is where that came apart:
   * they are trusted with the raffle's figures and not with who owes them, so
   * the right answer is every seller's money and nobody's name — which no
   * single list can express. Narrowing them to [] gave the honest half and a
   * Money screen reading Should have 0, Handed in 0, Still owed 0, to the one
   * role whose entire purpose is checking that those numbers are healthy.
   *
   * So the rows are built over everyone a person's TOTALS may include, summed,
   * and then released or withheld by name at the bottom. An organiser sees
   * every seller; a seller sees their own line and no other, because one
   * seller's debt is not another's business; a viewer sees the totals those
   * rows add up to and no table; a helper at a desk is carrying nothing and
   * gets neither.
   */
  const only = totalsAgents(user)
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
    writtenOff?: number
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
  const forgiven = await writtenOffByAgent(ctx, only)

  const lines: Row[] = [...byAgent.values()]

  /*
   * THE DESK IS A LINE TOO, for an organiser.
   *
   * Tickets sold out of books nobody holds have no seller to charge, so they
   * appeared in the raffle's expected total and on nobody's line — the top of
   * the Money screen said money was owed and the table underneath named no one.
   * Counted here as their own line, collected when the sale was marked paid,
   * so the two halves of the screen add up to the same raffle.
   */
  if (!only) {
    const desk = await deskMoney(ctx)
    if (desk.sold > 0) {
      lines.push({
        agentId: '', name: 'Sold at the office', phone: '', zone: '',
        booksOut: 0, booksSettled: 0, overdueBooks: 0,
        ticketsSold: desk.sold, expected: desk.expected, collected: desk.collected, outstanding: 0,
      })
    }
  }

  const rows = lines
    // Rounded like the Sheet: floating point turns 30 - 10.1 into a figure with
    // fifteen decimal places, and this one is read aloud to the person who owes it.
    // Forgiven is not owed. A debt written off with a reason has been decided
    // about, and leaving it here keeps a seller on the chase list for money
    // somebody accountable already said would never come. Carried as its own
    // figure rather than folded into `collected`, because a screen that added
    // them would tell an organiser the cash arrived.
    .map((a) => ({
      ...a,
      writtenOff: round2(forgiven.get(a.agentId) ?? 0),
      outstanding: round2(a.expected - a.collected - (forgiven.get(a.agentId) ?? 0)),
    }))
    // Biggest debt first: this list exists to decide who to telephone, and
    // alphabetical order would answer a question nobody asked.
    .sort((x, y) => y.outstanding - x.outstanding)

  // A viewer gets the shape without the names: enough to see the raffle is
  // healthy, nothing about who is behind on what. Summed BEFORE the rows are
  // withheld, which is the whole reason the two decisions are separate.
  const totalExpected = round2(rows.reduce((s, a) => s + a.expected, 0))
  const totalCollected = round2(rows.reduce((s, a) => s + a.collected, 0))

  return {
    agents: showsSellerNames(scope) ? rows : [],
    scope,
    totalExpected,
    totalCollected,
    totalOutstanding: round2(rows.reduce((s, a) => s + a.outstanding, 0)),
    currency: await currency(ctx),
  }
}

/**
 * Who to message today, as one list with one line per person.
 *
 * EVERYTHING NEEDED FOR THIS ALREADY EXISTED and none of it was in one place.
 * Overdue books are on the Books screen, who has not reported is on the
 * Sellers screen, what is owed is on Money, and the WhatsApp link is on each
 * of them separately. An organiser chasing people on a Sunday afternoon had to
 * visit three screens, hold the overlap in their head, and work out for
 * themselves that the person late with two books is the same person who owes
 * RM80 and never answered the check-in.
 *
 * ONE LINE PER PERSON, NOT ONE PER REASON, and that is the whole shape of it.
 * The three screens would have had somebody appear on all three, and a chase
 * list that messages a volunteer four times in an afternoon for four halves of
 * the same conversation is worse than no list: it reads as harassment, and the
 * fourth message is the one that gets a seller to stop replying.
 *
 * SORTED BY WHAT IS ACTUALLY URGENT. Holding books past the final deadline is
 * not the same kind of late as being three days past a checkpoint — one is
 * late for a raffle that is about to be drawn, the other is late for a
 * reminder. Days overdue breaks the tie, because the person who has had a book
 * for six weeks is not in the same conversation as the one who has had it
 * since Tuesday.
 *
 * SOMEBODY WITH NO USABLE NUMBER STAYS ON THE LIST. Dropping them would make
 * the list quietly incomplete, and the seller nobody can telephone is the one
 * most worth knowing about — so they are marked unreachable rather than
 * omitted, and sorted first among equals, because finding another way to reach
 * them takes longer than sending a message.
 */
export async function chaseToday(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const only = visibleAgents(user)
  const now = today()
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')
  const grace = await configNum(ctx, 'REPORT_GRACE_DAYS', 3, 0)
  const round = await checkInRound(ctx)
  const answered = await reportedIn(ctx, round)
  const past = !!final && final < now

  let mq = ctx.supabaseAdmin.from('agent_money')
    .select('agent_id,name,phone,books_out,overdue_books,outstanding')
  if (only) mq = mq.in('agent_id', only)
  const { data: money, error } = await mq
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  let bq = ctx.supabaseAdmin.from('book_ledger_all')
    .select('number,held_by_agent,due_at,days_overdue')
    .eq('status', 'Out').gt('days_overdue', 0)
  if (only) bq = bq.in('held_by_agent', only)
  const { data: late } = await bq
  const lateBy = new Map<string, Array<Record<string, unknown>>>()
  for (const b of (late ?? []) as Array<Record<string, unknown>>) {
    const id = String(b.held_by_agent ?? '')
    if (!lateBy.has(id)) lateBy.set(id, [])
    lateBy.get(id)!.push(b)
  }

  const money$ = await currency(ctx)
  const lines = []

  for (const m of (money ?? []) as Array<Record<string, unknown>>) {
    const id = String(m.agent_id ?? '')
    const booksOut = Number(m.books_out ?? 0)
    const owes = round2(Number(m.outstanding ?? 0))
    const theirs = lateBy.get(id) ?? []
    const daysOverdue = theirs.reduce((n, b) => Math.max(n, Number(b.days_overdue ?? 0)), 0)

    const state = reportState({ booksOut, reported: answered.has(id), checkIn, grace, now })

    const why = []
    if (past && booksOut > 0) {
      why.push({ code: 'past-final', what: `holding ${booksOut} ${booksOut === 1 ? 'book' : 'books'} after the final deadline` })
    } else if (daysOverdue > 0) {
      why.push({ code: 'overdue', what: `${theirs.length} ${theirs.length === 1 ? 'book' : 'books'} ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue` })
    }
    if (state === 'late') why.push({ code: 'no-report', what: 'has not reported this check-in' })
    if (owes > 0) why.push({ code: 'owes', what: `${money$}${owes} not handed in` })

    if (!why.length) continue

    // The same rule the client uses to decide whether to offer a link: a number
    // written with a leading 0, or already carrying a country code, can be
    // acted on. Anything else is a number whose country we would be guessing.
    const phone = String(m.phone ?? '')
    const reachable = /^(0|60)/.test(phone.replace(/\D/g, ''))

    lines.push({
      agentId: id,
      name: String(m.name ?? '') || id,
      phone,
      reachable,
      booksOut,
      booksLate: theirs.map((b) => String(b.number)).sort(),
      daysOverdue,
      owes,
      reasons: why,
      // Ready to send, because the point of this list is that nobody has to
      // compose the same message forty times.
      message: chaseMessage(String(m.name ?? '') || id, why),
      urgency: (past && booksOut > 0 ? 3000 : 0) + Math.min(daysOverdue, 999)
        + (state === 'late' ? 500 : 0) + (owes > 0 ? 1 : 0),
    })
  }

  lines.sort((a, b) =>
    b.urgency - a.urgency ||
    Number(a.reachable) - Number(b.reachable) ||
    (a.name < b.name ? -1 : 1))

  return {
    date: now,
    checkInDate: checkIn,
    finalDeadline: final,
    pastFinal: past,
    currency: money$,
    people: lines,
    total: lines.length,
    unreachable: lines.filter((l) => !l.reachable).length,
  }
}

/** One message covering every reason, because one person gets one message. */
function chaseMessage(name: string, why: Array<{ what: string }>): string {
  const bits = why.map((w) => w.what)
  const list = bits.length === 1 ? bits[0]
    : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`
  return `Hello ${name}, a reminder about the raffle: ${list}. ` +
    'Could you let us know when you can bring things in? Thank you.'
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
   *
   * SCOPED BY totalsAgents, NOT visibleAgents, and the difference is a viewer.
   * This is what fills state.totals, so it is the money on the HOME screen as
   * well as the Money one — and a viewer was reading "RM 0 raised" on the
   * landing page of a raffle that had taken thousands, because the list that
   * decides whose name may be printed was being asked whose money to count.
   */
  const only = totalsAgents(user)
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
    .from('book_ledger_all')
    .select('status,held_by_agent,counted_expected,counted_collected,unidentified_sold')
  const unsettled = (books ?? []).filter((b: { status: string }) =>
    b.status === 'Out' || b.status === 'Returned').length

  /*
   * SOLD BY THE SELLER'S COUNT, WITH NO TICKET NUMBER. When the leftovers were
   * lost, settlement records "six sold" and invents no rows — rightly. But the
   * draw pool is the ticket rows, so those six buyers paid and cannot win, and
   * the readiness check said READY over the top of them. It is a blocker until
   * the numbers are recorded or the organiser accepts that gap knowingly.
   */
  const unidentified = (books ?? []).reduce(
    (s: number, b: { unidentified_sold?: number }) => s + Number(b.unidentified_sold ?? 0), 0)

  // A request still waiting is a change to the books that would land AFTER the
  // draw if it were approved then. Decide them first.
  const { count: waiting } = await ctx.supabaseAdmin
    .from('pending_approvals').select('request_id', { count: 'exact', head: true })
    .eq('status', 'Pending').gt('expires_at', new Date().toISOString())
  const pendingApprovals = Number(waiting ?? 0)

  // The books whose money this person may be told about.
  const mineBooks = (books ?? []).filter((b: { held_by_agent?: string | null }) =>
    !only || only.includes(String(b.held_by_agent ?? '')))
  const paidBy = await collectedByAgent(ctx, only)
  // Plus the desk, for whoever may see the whole raffle: its sales are in
  // mineBooks (no holder) and its cash is in the tin, not on any seller.
  const deskPaid = only ? 0 : (await deskMoney(ctx)).collected
  const collectedScoped = round2([...paidBy.values()].reduce((s, n) => s + n, 0) + deskPaid)
  const expectedScoped = round2(mineBooks.reduce(
    (s: number, b: { counted_expected: number }) => s + Number(b.counted_expected ?? 0), 0))

  /*
   * RULE L6, THE HALF THAT COULD NOT BE SATISFIED HONESTLY.
   *
   * The draw is ready when outstanding money is zero, OR every non-zero line
   * has been explicitly written off with a reason. Only the first half was
   * buildable, so a raffle with one seller who genuinely never pays could
   * never read as ready — and the only way to clear this blocker was to record
   * a payment that never happened. A rule that can only be satisfied by lying
   * teaches people to put false figures in the one place the raffle keeps its
   * accounts.
   *
   * Written off is subtracted, NOT added to collected, because it is not cash
   * and nothing on any screen should say it is. What it means here is
   * narrower: somebody accountable decided this money is not coming, said why,
   * and the decision is on the record — so it is no longer a thing standing
   * between the raffle and its draw.
   */
  const writtenOffBy = await writtenOffByAgent(ctx, only)
  const writtenOff = round2([...writtenOffBy.values()].reduce((s, n) => s + n, 0))
  const outstanding = round2(expectedScoped - collectedScoped - writtenOff)

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
      why: writtenOff > 0
        ? `Sold, but the cash has not come back. ${writtenOff} has been written off ` +
          'already and is not counted here.'
        : 'Sold, but the cash has not come back. If some of it is never coming, write ' +
          'it off with a reason rather than recording a payment that did not happen.' })
  }
  if (reserved) {
    problems.push({ what: 'tickets still being held', count: reserved,
      why: 'Neither sold nor available — decide before the draw.' })
  }
  if (unidentified) {
    problems.push({
      what: 'tickets sold but not identified', count: unidentified,
      why: 'Counted as money when the book was settled, but no ticket number was written ' +
           'down, so they cannot be drawn. Record which numbers sold, or accept that those ' +
           'buyers are not in the draw.',
    })
  }
  if (pendingApprovals) {
    problems.push({
      what: 'requests waiting for approval', count: pendingApprovals,
      why: 'An approved request changes the books. Decide them before drawing, not after.',
    })
  }

  /*
   * NOTHING TO WIN. A raffle whose prize schedule is empty is not ready to be
   * drawn, and this is the one blocker that is about the draw itself rather
   * than the books behind it — everything above asks whether the pool is
   * honest, and none of it would notice that there is nothing to give out.
   *
   * It is counted over ACTIVE prizes, not every row: a prize turned off is an
   * organiser saying "not this one after all", and three switched-off prizes
   * are the same as no prizes at all on the night.
   */
  const { count: prizeCount } = await ctx.supabaseAdmin
    .from('prizes').select('prize_id', { count: 'exact', head: true })
    .eq('active', true).is('removed_at', null)
  const prizesOffered = Number(prizeCount ?? 0)
  if (!prizesOffered) {
    problems.push({
      what: 'no prizes have been set up',
      count: 0,
      why: 'There is nothing to draw for. Set the prize schedule before the draw, ' +
           'so every winner is recorded against a prize rather than a typed phrase.',
    })
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
      unidentified,
      prizesOffered,
      pendingApprovals,
    },
    booksByStatus,
    // Kept alongside: the richer form carries the reason, which the blunt
    // blocker strings cannot, and a later screen may want it.
    problems,
    active,
    today: now,
  }
}

/**
 * ONE SELLER'S STATEMENT OF ACCOUNT — what they were charged, what they paid,
 * what is left, in the order it happened.
 *
 * WHAT WAS HERE BEFORE returned four totals and a list of books, and the screen
 * that showed the money drew its detail from somewhere else entirely: every
 * payment row the seller had, raw. That produced the thing that got this
 * rewritten — a panel showing RM -100.00, RM -100.00, RM -100.00, RM 100.00,
 * RM 100.00, RM 100.00, all labelled "counted in with a book", none of which
 * moved the balance by a penny.
 *
 * They did not move it because settlement payment rows are NOT what a closed
 * book's cash is counted from. agent_money reads `books.amount_paid` for that
 * and sums only source='hand' out of payments, precisely so the same cash is
 * not counted twice. So the old panel listed six rows that are bookkeeping
 * exhaust — a re-settle reverses its predecessor and writes a fresh row — and
 * omitted the figures that actually make up the debt.
 *
 * A STATEMENT IS THE ORDINARY ANSWER to this, and it is ordinary on purpose:
 * charges on the left, credits on the right, a running balance down the side,
 * every line dated and referenced to the book or the receipt it came from.
 * Anybody who has read a bank statement or a utility bill can read it, which
 * is the whole requirement — the people using this are volunteers, not
 * accountants, and the ones they hand it to are sellers being asked for money.
 *
 * THE TOTALS ARE NOT COMPUTED HERE. They are read from agent_money, the same
 * view the table on the screen reads, and the entries are built from the rows
 * that view is defined over. A statement that adds up to a different number
 * than the line it expands is the bug this repo has produced five times in
 * other shapes; here it would be a seller shown two different debts on one
 * screen. The test asserts the entries sum to the view's figure rather than
 * trusting that they were derived from the same tables.
 *
 * WHY A WRITE-OFF IS ITS OWN KIND OF LINE. It reduces what is owed, so it must
 * move the running balance — a closing balance that disagrees with the debt is
 * not a statement. But it is not cash, so it is never added to what was
 * collected, and it carries its own label on the row. Collapsing the two tells
 * the treasurer money arrived that never did, and tells the seller they paid
 * something somebody else decided to absorb.
 */
export async function agentStatement(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  /*
   * WHOSE STATEMENT, and this had to be tightened when the document grew.
   *
   * It used to say "an agent may only pull their own", which left everybody
   * else — including a HELPER — able to name any seller and read their
   * account. That was already wrong and it was small: four totals and a list of
   * books. It is not small now. This returns every charge, every payment and a
   * running balance, which is precisely the who-owes-what that moneyScope
   * keeps away from helpers on the screen next door.
   *
   * So: an organiser may read anybody's, and everybody else reads their own,
   * whatever they asked for. A helper carrying no books has no account to read
   * and is told so plainly rather than handed an empty one — they owe nothing,
   * by design, and an empty statement reads like a bug.
   */
  const mine = String(user.agentId ?? '').trim()
  const asked = String(p.agentId ?? '').trim()
  const agentId = user.isAdmin ? (asked || mine) : mine
  if (!agentId) {
    throw new ApiError(
      user.isAdmin ? 'MISSING_FIELD' : 'NO_STATEMENT',
      user.isAdmin
        ? 'Which seller?'
        : 'A statement belongs to a seller carrying books. The sales you write '
          + 'down are credited to whoever holds the book, so none of the money is yours.',
      null, user.isAdmin ? 400 : 403,
    )
  }

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('*').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const cur = await currency(ctx)

  // The figures the screen already shows for this seller. Read, not recomputed.
  const { data: summary } = await ctx.supabaseAdmin
    .from('agent_money').select('*').eq('agent_id', agentId).maybeSingle()

  const { data: books } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('*').eq('held_by_agent', agentId).order('idx')

  /*
   * THE TWO REGIMES, kept apart exactly as agent_money keeps them.
   *
   * An OPEN book's truth is its ticket rows: the sale names its seller, so that
   * is who owes for it. A CLOSED book's truth is the figure declared when it
   * was counted in, frozen against the seller it was counted in for. Adding
   * them would double a book that is both — which is why the open side excludes
   * anything already declared.
   */
  const active = Number((await ctx.supabaseAdmin.rpc('active_tickets', {})).data ?? 0)

  const { data: openSales } = await ctx.supabaseAdmin
    .from('tickets')
    .select('number,amount,sold_at,book_idx,status,books(number,status,declared_sold)')
    .eq('sold_by_agent', agentId)
    .in('status', ['Sold', 'Donated'])
    .lte('idx', active)
    .order('idx')

  type Sale = {
    number: string; amount: number | null; sold_at: string | null; book_idx: number
    books: { number: string; status: string; declared_sold: number | null } | null
  }
  const stillOpen = ((openSales ?? []) as Sale[]).filter((t) => {
    const b = t.books
    return !(b && (b.status === 'Settled' || b.status === 'Lost') && b.declared_sold != null)
  })

  const { data: closed } = await ctx.supabaseAdmin
    .from('books')
    .select('number,declared_sold,amount_due,amount_paid,settled_at,status')
    .eq('settled_by_agent', agentId)
    .in('status', ['Settled', 'Lost'])
    .not('declared_sold', 'is', null)
    .order('idx')

  const { data: pays } = await ctx.supabaseAdmin
    .from('payments')
    .select('id,amount,method,note,source,received_at,received_by,book_idx,reverses')
    .eq('agent_id', agentId)
    .order('received_at')

  /*
   * ONE LINE PER BOOK, not one per ticket.
   *
   * A seller with sixty books has six hundred tickets, and a statement that
   * lists them is not a statement, it is a printout. The book is the unit the
   * conversation actually happens in — "Book-230, ten sold, RM100" is what both
   * sides can check against the paper in their hands. Which tickets those were
   * is a question the ticket list answers, on demand, for one book.
   */
  const byBook = new Map<string, { book: string; count: number; amount: number; at: string | null }>()
  for (const t of stillOpen) {
    const name = t.books?.number ?? `Book ${t.book_idx}`
    const e = byBook.get(name) ?? { book: name, count: 0, amount: 0, at: null }
    e.count += 1
    e.amount += Number(t.amount ?? 0)
    // The last sale in the book, because that is when the charge finished growing.
    if (t.sold_at && (!e.at || t.sold_at > e.at)) e.at = t.sold_at
    byBook.set(name, e)
  }

  type Entry = {
    at: string | null; kind: string; ref: string; description: string
    charge: number; credit: number; balance: number; reversed?: boolean
  }
  const entries: Entry[] = []

  for (const b of byBook.values()) {
    entries.push({
      at: b.at, kind: 'sale', ref: b.book,
      description: `${b.count} ticket${b.count === 1 ? '' : 's'} sold`,
      charge: round2(b.amount), credit: 0, balance: 0,
    })
  }

  type Closed = {
    number: string; declared_sold: number | null; amount_due: number | null
    amount_paid: number | null; settled_at: string | null; status: string
  }
  for (const b of ((closed ?? []) as Closed[])) {
    const due = round2(Number(b.amount_due ?? 0))
    const paid = round2(Number(b.amount_paid ?? 0))
    entries.push({
      at: b.settled_at, kind: 'settlement', ref: b.number,
      description: `Counted in · ${b.declared_sold ?? 0} declared sold`,
      charge: due, credit: 0, balance: 0,
    })
    // The cash that came with the count-in is its own line. Netting it against
    // the charge would hide a book counted in and not paid for, which is the
    // single most useful thing this screen can show.
    if (paid) {
      entries.push({
        at: b.settled_at, kind: 'settlement-cash', ref: b.number,
        description: 'Cash handed in when counted in',
        charge: 0, credit: paid, balance: 0,
      })
    }
  }

  /*
   * PAYMENTS, and only the kinds that move the balance.
   *
   * source='hand' is cash given over between settlements. source='writeoff' is
   * a debt somebody accountable decided to absorb. source='settlement' rows are
   * deliberately NOT here: the book's own amount_paid above is that same money,
   * and listing both is what produced the six meaningless lines this replaces.
   * They remain in the audit trail, which is a different question and a
   * different screen.
   */
  type Pay = {
    id: number; amount: number | null; method: string | null; note: string | null
    source: string | null; received_at: string | null; book_idx: number | null
    reverses: number | null
  }
  const reversed = new Set(((pays ?? []) as Pay[]).map((r) => r.reverses).filter(Boolean) as number[])
  for (const r of ((pays ?? []) as Pay[])) {
    if (r.source === 'settlement') continue
    const amount = round2(Number(r.amount ?? 0))
    const isWriteOff = r.source === 'writeoff'
    entries.push({
      at: r.received_at, kind: isWriteOff ? 'writeoff' : 'hand',
      ref: r.book_idx ? `#${r.id}` : `#${r.id}`,
      description: isWriteOff
        ? (r.note || 'Written off')
        : (r.note || `Handed in${r.method ? ` (${r.method})` : ''}`),
      // A negative hand-over is a correction to one, and reads as a charge —
      // the money went back out. Putting it in the credit column as a minus is
      // how a statement gets an answer nobody can follow.
      charge: amount < 0 ? Math.abs(amount) : 0,
      credit: amount > 0 ? amount : 0,
      balance: 0,
      reversed: reversed.has(r.id) || undefined,
    })
  }

  // Undated entries sort last rather than first: an entry with no date is
  // almost always the most recent thing that happened and has not been stamped.
  entries.sort((a, b) => String(a.at ?? '9999').localeCompare(String(b.at ?? '9999')))
  let running = 0
  for (const e of entries) {
    running = round2(running + e.charge - e.credit)
    e.balance = running
  }

  const expected = round2(Number(summary?.expected ?? 0))
  const collected = round2(Number(summary?.collected ?? 0))
  const writtenOff = round2(Number(summary?.written_off ?? 0))
  const outstanding = round2(Number(summary?.outstanding ?? 0))

  return {
    agent: { id: agent.agent_id, name: agent.name, phone: agent.phone, zone: agent.zone },
    books: books ?? [],
    entries,
    /*
     * THE CHECK, RETURNED RATHER THAN ASSUMED.
     *
     * The running balance is built from rows; the totals come from the view the
     * table reads. They should agree, and when they do not the screen must say
     * so rather than show two numbers and let the reader pick. A statement that
     * silently disagrees with the line it expands is worse than no statement:
     * it is an audit trail that cannot be trusted and looks like one that can.
     */
    reconciles: Math.abs(round2(running - outstanding)) < 0.005,
    ledgerBalance: running,
    sold: Number(summary?.tickets_sold ?? 0),
    booksOut: Number(summary?.books_out ?? 0),
    booksSettled: Number(summary?.books_settled ?? 0),
    expected, collected, writtenOff, outstanding,
    currency: cur,
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
    // A winner whose ticket cannot be read is a winner nobody can vouch for, so
    // the number goes rather than being passed through unexamined. The foreign
    // key makes this unreachable today; it is here so that it stays harmless if
    // that ever stops being true.
    if (!t) return { ...w, buyer_phone: '' }

    /*
     * THE WINNER ROW CARRIES ITS OWN COPY OF THE NUMBER, and that copy was
     * going out unmasked.
     *
     * The masker was applied to the joined TICKET and stopped there, which
     * looked complete because the ticket is where a telephone number normally
     * lives. But `winners.buyer_phone` is a second one — frozen at the moment
     * of the award, deliberately, so the record of the night survives a later
     * correction — and nothing had ever masked it. A viewer, whose entire
     * defining property is that numbers arrive as ••••100, was handed every
     * winner's number in full by the row beside the one that had been masked.
     *
     * Nothing displayed it, which is the only reason it went unnoticed: the
     * draw screen read a field name the Apps Script backend used and this one
     * did not, so the number was in the reply and never on the screen. A leak
     * that depends on a client not reading a field is a leak.
     *
     * WHO MAY SEE IT is decided from the TICKET, because that is the row that
     * knows which book it came from and therefore which helper is entitled to
     * it. WHAT THEY SEE is the frozen copy, because that is the point of
     * freezing it. The two questions have different sources and always did.
     */
    const scoped = mask({ ...t, buyer_phone: w.buyer_phone }, user, holds)

    // The NAME survives for everyone, and that is a deliberate departure from
    // the masker rather than an oversight. Applying it whole inverted the
    // hierarchy: a viewer kept the name and a helper lost it, so the LESS
    // trusted role saw more. And announcing who won is what a draw is for —
    // it is the telephone number that belongs only to whoever has to ring them.
    return {
      ...w,
      buyer_phone: scoped.buyer_phone,
      tickets: { ...mask(t, user, holds), buyer_name: t.buyer_name },
    }
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

  /*
   * ONE TICKET, ONE PRIZE — said here, in a sentence, rather than left to the
   * primary key. The counterfoil comes out of the drum and is set aside; that
   * is the rule this raffle runs on. The database still enforces it, but a
   * duplicate-key error reaching an organiser mid-draw reads as the app having
   * broken at the worst possible moment.
   */
  const { data: already } = await ctx.supabaseAdmin
    .from('winners').select('prize').eq('ticket_idx', t.idx).maybeSingle()
  if (already) {
    throw new ApiError('BAD_REQUEST',
      `Ticket ${number} has already won${already.prize ? ` (${already.prize})` : ''}.`)
  }

  /*
   * THE PRIZE COMES FROM THE SCHEDULE, and this is the change the whole prize
   * schedule exists for. It used to be whatever text was typed, so "First
   * prize" and "1st Prize" were two prizes, nothing could say how many of the
   * ten hampers were left, and the Grand Prize could be given away twice.
   *
   * FREE TEXT STILL WORKS when no schedule has been set up. A raffle whose
   * organiser never opened the prize screen must still be able to record that
   * somebody won something — refusing would turn a missing setup step into a
   * draw that cannot be written down while the room waits.
   */
  const prizeId = String(p.prizeId ?? '').trim()
  let label = String(p.prize ?? '').trim()
  let seat: number | null = null
  let value: number | null = null

  if (prizeId) {
    const { seat: s, prize } = await prizes.nextSeat(prizeId, ctx)
    seat = s
    // The label and the value are FROZEN here beside the buyer's name and
    // number, which have been frozen since the beginning and for the same
    // reason: correcting a typo in the schedule next week must not rewrite
    // what was read out on the night.
    label = label || (prize.name ? `${prize.tier} — ${prize.name}` : prize.tier)
    value = await unitValue(prize, ctx)
  } else if (!label) {
    throw new ApiError('MISSING_FIELD', 'What did it win?')
  }

  const { error } = await ctx.supabaseAdmin.from('winners').insert({
    ticket_idx: t.idx,
    prize: label,
    prize_id: prizeId || null,
    seq: seat,
    prize_value: value,
    // The buyer is copied in rather than joined, so the record of who won says
    // what it said on the day even if the ticket row is corrected later.
    buyer_name: t.buyer_name, buyer_phone: t.buyer_phone,
    recorded_by: user.email,
  })
  if (error) {
    const m = String(error.message)
    if (/duplicate/i.test(m)) {
      // Either the ticket won already — caught above, so this is the race — or
      // two organisers reached for the same seat in the same second. Both are
      // "try that again", and neither is the app being broken.
      throw new ApiError('BAD_REQUEST',
        `Somebody recorded a winner for that at the same moment. Check the list and try again.`)
    }
    throw new ApiError('QUERY_FAILED', m)
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'RECORD_WINNER',
    details: { ticket: number, prize: label, prizeId: prizeId || null, seq: seat },
    email: user.email,
  })
  return {
    ticketNumber: number, prize: label, prizeId: prizeId || null, seq: seat,
    buyerName: t.buyer_name, buyerPhone: t.buyer_phone,
  }
}

/**
 * What one of a prize is worth right now.
 *
 * A share-of-takings prize is not knowable until the money is in, so it is
 * worked out from the payments ledger at the moment it is awarded and frozen
 * there. `null` for a prize with nothing declared — and null is not zero: zero
 * would join the totals as though somebody had valued the thing at nothing.
 */
async function unitValue(prize: Record<string, unknown>, ctx: Ctx): Promise<number | null> {
  const { data: type } = await ctx.supabaseAdmin
    .from('prize_types').select('valuing').eq('type_id', prize.type_id).maybeSingle()
  const amount = Number(prize.value_amount ?? 0)
  switch (type?.valuing ?? 'fixed') {
    case 'none': return null
    case 'percent': {
      const { data: paid } = await ctx.supabaseAdmin.from('payments').select('amount')
      const collected = (paid ?? []).reduce(
        (s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0), 0)
      return round2(collected * amount / 100)
    }
    default: return amount
  }
}
