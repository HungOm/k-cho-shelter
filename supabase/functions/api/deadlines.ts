/**
 * Two deadlines — ported from the DEADLINES section of Books.gs.
 *
 * A raffle run on paper needs two different dates and they do different jobs.
 * The CHECK-IN DATE is a shared, rolling "everybody report by" that moves
 * forward a month at a time; it is how you find out who has stopped selling
 * without accusing anybody. The FINAL DEADLINE is the wall: every book has to
 * be back before the draw, and it does not move without a deliberate decision.
 *
 * THE INVARIANT, which every path here maintains:
 *
 *     CHECK_IN_DATE <= FINAL_DEADLINE <= DRAW_DATE
 *
 * plus: the check-in only ever moves FORWARD and stops ON the final deadline
 * rather than past it, and a book's due date never moves backwards.
 *
 * WHOLE LOCAL DAYS, NEVER INSTANTS. Every date here is 'YYYY-MM-DD' and the
 * column is a date. This is not fussiness: stored as a timestamp, a due date
 * written at local midnight comes back as the previous calendar day anywhere
 * west of here, which surfaces as one seller chased for a book that is not late
 * and nobody able to explain why.
 */
import { ApiError, requireSuperAdmin, type AppUser } from './gate.ts'
import { collectedByAgent, moneyScope, round2, visibleAgents } from './money.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

/** The raffle's own calendar, which is not the server's. */
const ZONE = 'Asia/Singapore'

const asDay = (d: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d)

/** Today where the raffle is, as 'YYYY-MM-DD'. */
export function today(): string {
  return asDay(new Date())
}

/**
 * A date string, or ''.
 *
 * ANCHORED AT BOTH ENDS, deliberately. Unanchored, this reads the leading
 * calendar date off a full timestamp — and that date is the UTC one, so a value
 * that round-tripped through toISOString comes back a day early west of here.
 * That exact bug was found and fixed on the Apps Script side; it is not
 * hypothetical.
 */
export function dayStart(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return asDay(d)
}

/**
 * Add whole months, CLAMPED to the end of the month.
 *
 * 31 January plus one month is 28 or 29 February, not 2 or 3 March. Without the
 * clamp a month-end check-in walks forward a few days a year, and the date
 * everybody was told to report by drifts away from the date the system checks.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const targetMonth = m - 1 + months
  const year = y + Math.floor(targetMonth / 12)
  const month = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Whole days between two calendar days. Date-only, so no DST hour creeps in. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  return Math.round((b - a) / 864e5)
}

// ============ THE ROUNDS, WORKED OUT RATHER THAN TYPED ============
/*
 * NOBODY TYPES THE MIDDLE DATES.
 *
 * A raffle has one date somebody chose — the wall — and a rhythm: everybody
 * reports, then reports again a month later, and again, until the wall. Asking
 * an organiser to enter each of those by hand is asking them to keep a calendar
 * in their head, and it is how a round goes missing in the month nobody was
 * watching. So the rounds are CALCULATED from the two dates that already exist.
 *
 * That is also what lets a seller be told every one of their reporting dates on
 * the day they collect their books, which is the only moment anybody has their
 * attention.
 *
 * A ROUND FOR EVERY STEP THAT FITS, and the wall on the end even when it falls
 * days after the last one. Two reports in one week is redundant; the obvious
 * tidy-up — folding a step that lands just short of the wall INTO the wall —
 * costs far more than it saves. That step is the last moment anybody finds out
 * forty books are still out while there are still five days to ring people, and
 * dropping it leaves a gap longer than the monthly rhythm this promises. The
 * redundancy is the cheaper failure by a distance.
 *
 * DISPLAY AND PLANNING ONLY. The roll does not take its target from here: it
 * steps the current date and clamps at the wall, exactly as it did before this
 * existed. Whether a seller is late must not depend on a derivation.
 */

/** A week — when "due soon" starts everywhere else in this system. */
export const REPORT_NOTICE_DAYS = 7

/** Every round from `anchor` to `final` inclusive; [] with no wall to walk to. */
export function checkInSchedule(anchor: string, final: string, everyMonths: number): string[] {
  if (!final) return []
  if (!anchor || anchor >= final) return [final]

  const step = Math.max(1, Math.floor(everyMonths) || 1)
  const out = [anchor]
  let d = anchor
  // Capped rather than trusted. A cadence and a wall that disagree — a one-month
  // step and a raffle somebody dated five years out — must not spin here.
  for (let i = 0; i < 60; i++) {
    d = addMonths(d, step)
    if (d >= final) break
    out.push(d)
  }
  out.push(final)
  return out
}

/** A whole number of days on from a date-only day. Never an instant. */
export function addDays(iso: string, n: number): string {
  if (!iso) return ''
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
}

export async function configNum(ctx: Ctx, key: string, fallback: number, min = 0): Promise<number> {
  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', key).maybeSingle()
  const n = parseInt(String(data?.value ?? ''), 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

/** How far apart the rounds sit. */
export const everyMonths = (ctx: Ctx) => configNum(ctx, 'CHECK_IN_EVERY_MONTHS', 1, 1)

/**
 * The gap between the check-in date and being called late for it.
 *
 * Three days, not none and not a fortnight. None means somebody who says "I
 * will come on Saturday" is red on Friday evening, and a badge that fires on
 * people doing the right thing is one the organiser learns to scroll past. A
 * fortnight, on a monthly rhythm, is half the round spent not chasing anybody.
 */
export const graceDays = (ctx: Ctx) => configNum(ctx, 'REPORT_GRACE_DAYS', 3, 0)

/**
 * Which round is live, counted rather than dated.
 *
 * A number rather than the date, because a report has to stay attached to the
 * round it answered after the date has moved on. It is what makes "missed two
 * check-ins" countable: the rows for those rounds are absent, permanently, and
 * rolling the date forward cannot quietly forgive them the way it forgives a
 * late book.
 */
export const checkInRound = (ctx: Ctx) => configNum(ctx, 'CHECK_IN_ROUND', 1, 1)

/**
 * Where one seller stands this round. Pure, so both backends and the tests can
 * agree on it without a database.
 *
 * `clear` is not `reported`: a seller holding nothing has nothing to report on,
 * and a red mark beside the name of somebody who brought everything back is how
 * a list stops being read.
 */
export type ReportState = 'reported' | 'clear' | 'late' | 'due' | 'waiting'

export function reportState(o: {
  booksOut: number
  reported: boolean
  checkIn: string
  grace: number
  now: string
}): ReportState {
  if (o.reported) return 'reported'
  if (o.booksOut <= 0) return 'clear'
  if (!o.checkIn) return 'waiting'
  if (daysBetween(o.checkIn, o.now) > o.grace) return 'late'
  if (daysBetween(o.now, o.checkIn) <= REPORT_NOTICE_DAYS) return 'due'
  return 'waiting'
}

/** Who has answered THIS round, and when they did. */
export async function reportedIn(ctx: Ctx, round: number): Promise<Map<string, string>> {
  const { data } = await ctx.supabaseAdmin
    .from('check_in_reports').select('agent_id,reported_at').eq('round', round)
  const m = new Map<string, string>()
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    m.set(String(r.agent_id ?? ''), String(r.reported_at ?? ''))
  }
  return m
}

/**
 * How many EARLIER rounds each seller answered.
 *
 * Subtracted from the rounds that have been and gone, this is the count of
 * check-ins somebody let pass in silence — the number that survives the roll,
 * and the reason the roll cannot launder a seller who has never once answered
 * into a seller who is up to date.
 */
export async function reportsBefore(ctx: Ctx, round: number): Promise<Map<string, number>> {
  const { data } = await ctx.supabaseAdmin
    .from('check_in_reports').select('agent_id').lt('round', round)
  const m = new Map<string, number>()
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(r.agent_id ?? '')
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
}

export async function configDate(ctx: Ctx, key: string): Promise<string> {
  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', key).maybeSingle()
  return dayStart(data?.value ?? '')
}

async function setConfig(ctx: Ctx, key: string, value: string) {
  const { error } = await ctx.supabaseAdmin
    .from('config').upsert({ key, value }, { onConflict: 'key' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
}

/**
 * When a book handed out today should come back.
 *
 * The shared check-in if it is still ahead, else the final deadline if that is,
 * else the plain due-days window. A book handed out today should come back when
 * everything else does rather than on its own private schedule — otherwise the
 * check-in stops meaning anything, because half the books are not due yet.
 */
export async function defaultDueDate(ctx: Ctx, requested?: unknown): Promise<string> {
  const asked = dayStart(requested)
  if (asked) return asked

  const now = today()
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  if (checkIn && checkIn > now) return checkIn

  const final = await configDate(ctx, 'FINAL_DEADLINE')
  if (final && final > now) return final

  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'DEFAULT_DUE_DAYS').maybeSingle()
  const days = parseInt(String(data?.value ?? ''), 10) || 30
  return new Date(Date.parse(now + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)
}

// ============ WHERE THE RAFFLE STANDS ============

export async function deadlineStatus(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const now = today()
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')
  const draw = await configDate(ctx, 'DRAW_DATE')

  // A seller is told about THEIR books, not the whole raffle. Same rule as
  // every other read: their own work, nobody else's.
  const mine = user.role === 'agent'
  let q = ctx.supabaseAdmin.from('books').select('due_at,held_by_agent').eq('status', 'Out')
  if (mine) q = q.eq('held_by_agent', user.agentId ?? ' ')
  const { data: out } = await q

  const booksOut = (out ?? []).length
  const lateNow = (out ?? []).filter((b: { due_at: string | null }) =>
    b.due_at && b.due_at < now).length

  // WHO STILL HAS TO REPORT is asked of the people holding books, not of every
  // name on the list. Somebody who carries nothing this round is not silent,
  // they are finished, and counting them as outstanding makes the number too
  // big to act on.
  const holders = new Set<string>()
  for (const b of (out ?? []) as Array<Record<string, unknown>>) {
    const id = String(b.held_by_agent ?? '').trim()
    if (id) holders.add(id)
  }

  const months = await everyMonths(ctx)
  const grace = await graceDays(ctx)
  const round = await checkInRound(ctx)
  const answered = await reportedIn(ctx, round)
  const outstanding = [...holders].filter((id) => !answered.has(id))

  const reportBy = checkIn ? addDays(checkIn, grace) : ''
  const schedule = checkInSchedule(checkIn, final, months)

  return {
    today: now,
    checkInDate: checkIn,
    finalDeadline: final,
    drawDate: draw,
    scope: mine ? 'mine' : 'all',
    daysToCheckIn: checkIn ? daysBetween(now, checkIn) : null,
    daysToFinal: final ? daysBetween(now, final) : null,
    checkInDue: !!checkIn && checkIn <= now,
    finalPassed: !!final && final < now,
    isLastRound: !!checkIn && !!final && checkIn >= final,
    booksOut,
    lateNow,
    // The rounds, as a plan rather than one date at a time. The dates belong to
    // everybody — a seller cannot report by a day nobody told them about — so
    // this is not scoped the way the counts are.
    round,
    everyMonths: months,
    graceDays: grace,
    reportBy,
    chaseFrom: reportBy,
    schedule: schedule.map((d, i) => ({
      date: d,
      round: round + i,
      last: d === final,
      done: d < now,
    })),
    roundsLeft: schedule.length,
    sellersHolding: holders.size,
    sellersReported: holders.size - outstanding.length,
    sellersNotReported: outstanding.length,
    // A seller is answered about themselves. Null for anybody else, so a screen
    // can tell "not applicable" from "no".
    youReported: mine ? answered.has(String(user.agentId ?? '')) : null,
  }
}

// ============ REPORTING IN ============
/*
 * THE THING THAT CLEARS THE BADGE, and the reason it cannot be a dismissal.
 *
 * Every other alert in this system is derived from the books, because an alert
 * somebody can tick away is an alert everybody ticks away, and by the one time
 * it matters it has been trained into furniture. This one is about a person
 * rather than a book, so it cannot be derived from the books — a seller can
 * honestly report "sold six, here is the money, I am keeping the book for the
 * rest" and still be holding it afterwards.
 *
 * So the badge clears on a RECORDED FACT: a row saying this seller answered
 * this round, who wrote it down, and what came back. There is still nothing to
 * dismiss. Clearing the mark and recording the report are the same action, and
 * the row is what the next round is measured against.
 */

export async function recordCheckIn(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller is reporting?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', agentId).maybeSingle()
  if (!agent) {
    throw new ApiError('AGENT_NOT_FOUND', `There is no seller with the ID "${agentId}".`)
  }

  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  if (!checkIn) {
    throw new ApiError(
      'NO_CHECK_IN_DATE',
      'There is no check-in date, so there is no round for this to be a report on. ' +
      'Set the dates on the "Deadlines" screen first.',
    )
  }

  const round = await checkInRound(ctx)
  const name = String((agent as { name?: string }).name ?? agentId)

  const { data: existing } = await ctx.supabaseAdmin
    .from('check_in_reports').select('*')
    .eq('agent_id', agentId).eq('round', round).maybeSingle()

  // UNDOING IS DELETING THE RECORD, not hiding it. Recorded against the wrong
  // seller is a thing that happens on a phone in a car park, and the fix has to
  // put that person back on the chase list rather than leave them quietly
  // marked as having answered.
  if (p.undo) {
    if (!existing) {
      throw new ApiError('NOTHING_TO_DO', `${name} has not been recorded as reporting this round.`)
    }
    const { error } = await ctx.supabaseAdmin
      .from('check_in_reports').delete().eq('agent_id', agentId).eq('round', round)
    if (error) throw new ApiError('QUERY_FAILED', error.message)

    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'UNDO_CHECK_IN', details: { agent: agentId, round }, email: user.email,
    })
    return { agentId, agentName: name, round, checkInDate: checkIn, undone: true }
  }

  const row = {
    agent_id: agentId,
    round,
    due_at: checkIn,
    books_back: int(p.booksBack),
    tickets_sold: int(p.ticketsSold),
    amount_paid: num(p.amountPaid),
    note: String(p.note ?? '').trim(),
    recorded_by: user.email,
    reported_at: new Date().toISOString(),
  }

  // Recorded twice is a seller who came back with more, not an error to refuse:
  // the round holds one answer per person and the later one is the true one.
  const { error } = existing
    ? await ctx.supabaseAdmin.from('check_in_reports').update(row)
        .eq('agent_id', agentId).eq('round', round)
    : await ctx.supabaseAdmin.from('check_in_reports').insert(row)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'RECORD_CHECK_IN',
    details: { agent: agentId, round, booksBack: row.books_back, amountPaid: row.amount_paid },
    email: user.email,
  })

  return {
    agentId,
    agentName: name,
    round,
    checkInDate: checkIn,
    updated: !!existing,
    booksBack: row.books_back,
    ticketsSold: row.tickets_sold,
    amountPaid: row.amount_paid,
  }
}

/**
 * A settlement IS a report, so it is recorded as one.
 *
 * WITHOUT THIS, an organiser who has just counted a seller's book and taken
 * their money is then asked to tick them off a list as having reported. Asking
 * somebody to write the same fact down twice is how the second one stops
 * happening, and then the chase list shows people who were standing in front of
 * you an hour ago — which is how a list stops being believed.
 *
 * WHAT IT DOES NOT DO is copy the figures across. The money is decided by the
 * settlement and lives in the ledger; a partial amount echoed into a report
 * would read as a second, smaller settlement. This records only the fact and
 * how it is known.
 *
 * IT NEVER OVERWRITES A TYPED REPORT, and it never throws. A settle that failed
 * because of a check-in row would be a money operation broken by a side note.
 *
 * BUT IT IS NEVER SILENT EITHER, which is the harder half. Swallowing the
 * failure gets the priority right and the discoverability catastrophically
 * wrong: if this stops working on some deployment, every settle from then on
 * records nothing, the reports never appear, and an organiser chases people who
 * did in fact report — with nothing anywhere to explain why. That is the exact
 * shape this project has been bitten by repeatedly, where something reports
 * success while doing nothing. So the failure goes to the function log AND to
 * the audit log, where somebody looking can find it.
 *
 * The returned `error` matters as much as a thrown one: a rejected insert comes
 * back in the result rather than as an exception, so ignoring it is the more
 * likely silence of the two. Both take the same path out.
 */
export async function noteReportFromSettle(
  ctx: Ctx, agentId: string, bookNumber: string, user: AppUser,
) {
  const id = String(agentId ?? '').trim()
  try {
    if (!id) return
    const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
    if (!checkIn) return
    const round = await checkInRound(ctx)

    const { data: existing, error: readFailed } = await ctx.supabaseAdmin
      .from('check_in_reports').select('agent_id')
      .eq('agent_id', id).eq('round', round).maybeSingle()
    if (readFailed) throw new Error(readFailed.message)
    if (existing) return

    const { error } = await ctx.supabaseAdmin.from('check_in_reports').insert({
      agent_id: id,
      round,
      due_at: checkIn,
      note: `Reported by settling ${bookNumber}`,
      recorded_by: user.email,
      reported_at: new Date().toISOString(),
    })
    if (error) throw new Error(error.message)
  } catch (e) {
    // Caught and not rethrown — the money is already committed and must not be
    // undone by a side note — but said out loud, twice, so a failure that
    // repeats can be found rather than merely suffered.
    const why = String((e as { message?: string })?.message ?? e)
    console.error(`CHECK_IN_NOT_RECORDED: ${id || '(no seller)'} settling ${bookNumber}: ${why}`)
    try {
      await ctx.supabaseAdmin.from('audit_log').insert({
        action: 'CHECK_IN_NOT_RECORDED',
        details: { agent: id, book: bookNumber, why },
        email: user.email,
      })
    } catch { /* if the database is what failed, the log line is the record */ }
  }
}

/** A whole number from a form field, never NaN and never negative. */
function int(v: unknown): number {
  const n = parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ============ ROLLING THE CHECK-IN FORWARD ============

export async function rollCheckIn(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const now = today()
  const current = await configDate(ctx, 'CHECK_IN_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')

  // The order of these refusals is the design. The wall has to exist before
  // anything can count down to it; a date has to be readable before it can be
  // judged; and a raffle already past its final deadline has no next round to
  // open — what is still out is not late for a checkpoint, it is late outright.
  if (!final) {
    throw new ApiError(
      'NO_FINAL_DEADLINE',
      'There is no final deadline yet, so there is nothing for the check-in date to ' +
      'count down to. The system admin sets that first.',
    )
  }

  // A step of the configured cadence, clamped at the wall further down. The
  // schedule is for showing people the plan, never for choosing this date.
  const months = await everyMonths(ctx)
  const round = await checkInRound(ctx)
  const target = String(p.date ?? '').trim()
    ? dayStart(p.date)
    : addMonths(current || now, months)

  if (!target) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-10-14.')
  }
  if (final < now) {
    throw new ApiError(
      'FINAL_PASSED',
      `The final deadline was ${final} and it has passed, so there are no more check-ins. ` +
      'Anything still out is overdue outright — chase it, or move the final deadline if ' +
      'the whole raffle is running late.',
      { finalDeadline: final },
    )
  }
  if (target < now) {
    throw new ApiError(
      'IN_THE_PAST',
      `${target} has already passed. A check-in date has to be a day people can still ` +
      'report by.',
    )
  }
  if (current && target <= current) {
    throw new ApiError(
      'CANNOT_MOVE_BACK',
      `The check-in date is ${current} and you have asked for ${target}. Pulling it ` +
      'backwards would make books late for a date that had already passed when they were ' +
      'handed over. It only moves forward.',
      { current, requested: target },
    )
  }
  const jumped = daysBetween(current || now, target)
  if (jumped > 12 * 31) {
    throw new ApiError(
      'TOO_FAR',
      `That is ${jumped} days ahead. A check-in moves at most 12 months at a time, so a ` +
      'mistyped year cannot quietly suspend the chasing for a decade.',
    )
  }

  // Clamped rather than refused for overshooting. Refusing would leave the date
  // stuck in the past for the rest of the raffle, which is the one state that
  // stops the check-in working at all.
  const landed = target > final ? final : target
  const isLastRound = landed >= final

  if (current && landed === current) {
    throw new ApiError('NO_CHANGE', `The check-in date is already ${current}.`)
  }

  const { data: out } = await ctx.supabaseAdmin
    .from('books').select('idx,number,due_at,held_by_agent').eq('status', 'Out').order('idx')

  const booksOut = (out ?? []).length
  const lateNow = (out ?? []).filter((b: { due_at: string | null }) =>
    b.due_at && b.due_at < now).length

  // Only books that were due by the OLD check-in move. A book already given a
  // later date keeps it — moving it would be pulling its due date backwards for
  // some sellers while pushing it forward for others.
  const moving = (out ?? []).filter((b: { due_at: string | null }) =>
    !b.due_at || (current ? b.due_at <= current : true))

  const dryRun = p.dryRun === undefined ? true : !!p.dryRun
  if (dryRun) {
    return {
      dryRun: true,
      from: current, to: landed, finalDeadline: final, isLastRound,
      round, nextRound: round + 1,
      roundsLeft: checkInSchedule(landed, final, months).length,
      booksOut, booksMoving: moving.length, lateNow,
      daysGiven: daysBetween(now, landed),
      effect: `${moving.length} of ${booksOut} books out would be given until ${landed}.`,
      message: isLastRound
        ? `This is the last round — ${landed} is the final deadline.`
        : 'Nothing was changed. Send the same request with dryRun:false to apply it.',
    }
  }

  // A confirmation ONLY when somebody is already late. Rolling a round where
  // nothing is overdue is routine and should not need a password; rolling one
  // that forgives existing lateness is a decision, and should be typed out.
  if (lateNow > 0 && String(p.confirm ?? '') !== landed) {
    throw new ApiError(
      'CONFIRM_REQUIRED',
      `${lateNow} book${lateNow === 1 ? ' is' : 's are'} already past due. Rolling the ` +
      `check-in to ${landed} gives them more time. Send confirm:"${landed}" to go ahead.`,
      { confirm: landed, lateNow },
    )
  }

  /*
   * THE SNAPSHOT COMES FIRST, BEFORE ANYTHING MOVES.
   *
   * Every money figure in this system is live, which is right for "what does
   * this seller owe today" and useless for "what did round 2 say" — the
   * question asked when a seller disputes a total, when an organiser wants to
   * know what has moved since the last checkpoint, and at the end when
   * somebody has to explain the raffle to whoever paid for it. Correcting
   * money afterwards is the design, not the problem; the problem is that once
   * it is corrected nothing remembers what it was corrected FROM.
   *
   * ORDER IS THE WHOLE OF IT. Taken after the books moved, the row would
   * record due dates the round never had; taken after CHECK_IN_ROUND moved, it
   * would be the opening figures of the next round wearing the closing round's
   * number. So it is taken here: past every refusal, past the confirmation,
   * and before the first write.
   *
   * AND IT CANNOT BE TAKEN LATE. A round that closes without one can never be
   * snapshotted afterwards, because the figures it would have frozen have
   * already moved. That is the whole reason this is written rather than
   * planned.
   */
  await snapshotRound(ctx, round, user.email)

  // Books first, then the config value. If this fails halfway the check-in date
  // has not moved, so the next attempt does the same work rather than a
  // different, half-applied version of it.
  if (moving.length) {
    const { error } = await ctx.supabaseAdmin
      .from('books').update({ due_at: landed, modified_by: user.email })
      .in('idx', moving.map((b: { idx: number }) => b.idx))
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  await setConfig(ctx, 'CHECK_IN_DATE', landed)

  /*
   * THE ROUND NUMBER MOVES WITH THE DATE, and this is the line that makes the
   * reporting survive the roll.
   *
   * Everyone is un-reported for the new round the moment this is written —
   * there is no reset to run and nothing to clear — and the rows for the round
   * just closed stay exactly as they are. A seller who never answered has an
   * absent row for that round for the rest of the raffle, so rolling forward
   * forgives a late BOOK, which is the point of a checkpoint, without also
   * forgiving the silence, which is not.
   */
  await setConfig(ctx, 'CHECK_IN_ROUND', String(round + 1))

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'ROLL_CHECK_IN',
    details: { from: current, to: landed, booksMoved: moving.length, lateNow, isLastRound,
               round, nextRound: round + 1 },
    email: user.email,
  })

  return {
    from: current, to: landed, finalDeadline: final, isLastRound,
    round: round + 1, closedRound: round,
    booksOut, booksMoving: moving.length, lateNow,
    daysGiven: daysBetween(now, landed),
  }
}


/**
 * Freeze what every seller's line said, for the round that is closing.
 *
 * ON CONFLICT DO NOTHING, NOT AN UPSERT, and the distinction is the point. A
 * roll that failed after the snapshot and before the config move is retried,
 * and the retry must keep the figures from the attempt that closed the round
 * rather than restate them as they are now — minutes or a day later, after
 * whatever the failure sent somebody off to fix. The table refuses UPDATE
 * outright, so an upsert would not merely be wrong here, it would raise.
 *
 * NOT ONLY THE SELLERS CARRYING BOOKS. The union is everyone the round has
 * anything to say about: whoever holds or has settled a book, whoever answered
 * this round, and whoever has handed money over. A seller who brought
 * everything back last month still has a line worth freezing — zero out, zero
 * owed — and it is the row that proves they were at zero rather than absent
 * from the reckoning.
 */
export async function snapshotRound(ctx: Ctx, round: number, takenBy: string) {
  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('held_by_agent,status,counted_sold,counted_expected')
    .not('held_by_agent', 'is', null)

  const answered = await reportedIn(ctx, round)
  const earlier = await reportsBefore(ctx, round)
  const paid = await collectedByAgent(ctx, null)

  type Line = {
    round: number; agent_id: string; taken_by: string
    books_out: number; books_settled: number; recorded_sold: number
    expected: number; collected: number; outstanding: number
    reported: boolean; missed_before: number
  }
  const byAgent = new Map<string, Line>()
  const line = (id: string) => {
    let a = byAgent.get(id)
    if (!a) {
      a = {
        round, agent_id: id, taken_by: takenBy,
        books_out: 0, books_settled: 0, recorded_sold: 0,
        expected: 0, collected: 0, outstanding: 0,
        reported: false, missed_before: 0,
      }
      byAgent.set(id, a)
    }
    return a
  }

  for (const b of (ledger ?? []) as Array<Record<string, unknown>>) {
    const a = line(String(b.held_by_agent))
    if (b.status === 'Out') a.books_out++
    if (b.status === 'Settled') a.books_settled++
    a.recorded_sold += Number(b.counted_sold ?? 0)
    a.expected = round2(a.expected + Number(b.counted_expected ?? 0))
  }
  for (const id of answered.keys()) line(id)
  // Only sellers who have actually handed something over. collectedByAgent now
  // reads agent_money, which lists EVERY seller — including the ones carrying
  // nothing, at zero — so taking its keys unfiltered would freeze a row of
  // noughts for somebody the round has nothing to say about.
  for (const [id, amount] of paid) if (amount) line(id)

  for (const [id, a] of byAgent) {
    a.collected = paid.get(id) ?? 0
    a.outstanding = round2(a.expected - a.collected)
    a.reported = answered.has(id)
    // Rounds BEFORE this one that came and went unanswered. The round being
    // closed is not among them — `reported` says what happened to that one —
    // so the two together read as "missed n before, and answered/did not
    // answer this one" without either double-counting the other.
    a.missed_before = Math.max(0, (round - 1) - (earlier.get(id) ?? 0))
  }

  if (!byAgent.size) return 0

  /*
   * A SNAPSHOT THAT FAILS MUST NOT STOP THE ROLL. The roll is what keeps the
   * chasing honest and a raffle cannot be left unable to move its own
   * check-in date because a bookkeeping row would not write. It is loud in the
   * log instead. Unlike the settlement's own ledger row, which belongs in the
   * transaction that counted the money, a snapshot is a measurement taken
   * alongside the roll rather than part of what the roll means.
   */
  const { error } = await ctx.supabaseAdmin
    .from('round_snapshots')
    .upsert([...byAgent.values()], { onConflict: 'round,agent_id', ignoreDuplicates: true })
  if (error) {
    console.error(`SNAPSHOT_NOT_TAKEN: round ${round}: ${error.message}`)
    return 0
  }
  return byAgent.size
}


/**
 * What a closed round said, and what has moved since.
 *
 * THE DIFFERENCE IS THE ANSWER, not the snapshot on its own. "Round 2 said you
 * owed RM120" is only half of a conversation with a seller who says they paid;
 * the useful half is that it says RM120 and today says RM40, so RM80 came in
 * after the round closed and here is the row for it. So both are returned side
 * by side and the client does no arithmetic to find the gap.
 *
 * WITH NO ROUND ASKED FOR, the rounds that have snapshots — which is how a
 * screen offers them without knowing in advance which rolls happened.
 *
 * SCOPED THROUGH money.ts RATHER THAN BY A RULE OF ITS OWN: an organiser sees
 * every seller by name, a seller sees their own line and nobody else's, and
 * anybody carrying no books sees neither — a closed round has nothing to say
 * about somebody who never owed anything.
 *
 * A VIEWER CURRENTLY SEES NOTHING HERE, which is the conservative half of a
 * split money.ts has not finished making. `visibleAgents` answers "whose names
 * may I see" and is being separated from "whose money is in my totals"; until
 * the second one exists, this uses the first for both, so a viewer gets no
 * lines and empty totals rather than somebody else's figures. Wrong in the
 * harmless direction, and one line to widen once the split lands.
 */
export async function readRoundSnapshot(
  p: Record<string, unknown>, user: AppUser, ctx: Ctx,
) {
  const only = visibleAgents(user)
  const scope = moneyScope(user)

  const { data: taken, error: takenErr } = await ctx.supabaseAdmin
    .from('round_snapshots').select('round').order('round')
  if (takenErr) throw new ApiError('QUERY_FAILED', takenErr.message)
  const rounds = [...new Set((taken ?? []).map((r: { round: number }) => Number(r.round)))]

  const asked = Number(p.round ?? 0)
  const round = asked > 0 ? asked : (rounds.length ? rounds[rounds.length - 1] : 0)
  if (!round) {
    return { round: 0, rounds: [], lines: [], totals: null, scope, message:
      'No round has closed yet, so there is nothing frozen to look back at. The ' +
      'first snapshot is taken when the check-in date is next moved on.' }
  }

  let q = ctx.supabaseAdmin.from('round_snapshots').select('*').eq('round', round)
  if (only) q = q.in('agent_id', only.length ? only : ['\u0000'])
  const { data: rows, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Today's figures for the same sellers, built the way the Money screen
  // builds them, so "then" and "now" are the same measurement twice.
  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('held_by_agent,counted_expected').not('held_by_agent', 'is', null)
  const nowExpected = new Map<string, number>()
  for (const b of (ledger ?? []) as Array<Record<string, unknown>>) {
    const id = String(b.held_by_agent ?? '')
    nowExpected.set(id, round2((nowExpected.get(id) ?? 0) + Number(b.counted_expected ?? 0)))
  }
  const nowPaid = await collectedByAgent(ctx, only)

  const { data: agents } = await ctx.supabaseAdmin.from('agents').select('agent_id,name,phone')
  const byId = new Map((agents ?? []).map((a: Record<string, unknown>) => [String(a.agent_id), a]))

  const lines = (rows ?? []).map((r: Record<string, unknown>) => {
    const id = String(r.agent_id)
    const who = byId.get(id) as Record<string, unknown> | undefined
    const expected = round2(nowExpected.get(id) ?? 0)
    const collected = round2(nowPaid.get(id) ?? 0)
    return {
      agentId: id,
      name: String(who?.name ?? '') || id,
      phone: String(who?.phone ?? ''),
      takenAt: r.taken_at,
      then: {
        booksOut: Number(r.books_out ?? 0), booksSettled: Number(r.books_settled ?? 0),
        ticketsSold: Number(r.recorded_sold ?? 0),
        expected: Number(r.expected ?? 0), collected: Number(r.collected ?? 0),
        outstanding: Number(r.outstanding ?? 0),
        reported: !!r.reported, missedBefore: Number(r.missed_before ?? 0),
      },
      now: { expected, collected, outstanding: round2(expected - collected) },
      changed: {
        expected: round2(expected - Number(r.expected ?? 0)),
        collected: round2(collected - Number(r.collected ?? 0)),
        outstanding: round2(round2(expected - collected) - Number(r.outstanding ?? 0)),
      },
    }
  })

  const sum = (f: (l: typeof lines[number]) => number) => round2(lines.reduce((t, l) => t + f(l), 0))
  const totals = {
    sellers: lines.length,
    then: {
      expected: sum((l) => l.then.expected), collected: sum((l) => l.then.collected),
      outstanding: sum((l) => l.then.outstanding),
      reported: lines.filter((l) => l.then.reported).length,
    },
    now: {
      expected: sum((l) => l.now.expected), collected: sum((l) => l.now.collected),
      outstanding: sum((l) => l.now.outstanding),
    },
  }

  /*
   * The names go to exactly two people, the same two the debt table goes to.
   *
   * SPELLED AS WHAT IT IS, not as `scope !== 'totals'`. The negative form is
   * what the money screens each wrote for themselves and it broke the moment a
   * fourth scope existed — a helper fell through to the table branch and was
   * handed the rows the split was made to keep from them. Naming the two that
   * may see them cannot fail that way when a fifth arrives.
   */
  const named = scope === 'all' || scope === 'mine'
  return {
    round, rounds, scope, totals,
    lines: named ? lines : [],
    takenAt: (rows ?? [])[0]?.taken_at ?? null,
  }
}

// ============ THE WALL ============

export async function setFinalDeadline(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  requireSuperAdmin(user, 'Setting the final deadline')

  const now = today()
  const current = await configDate(ctx, 'FINAL_DEADLINE')
  const draw = await configDate(ctx, 'DRAW_DATE')
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')

  const raw = String(p.date ?? '').trim()
  const clearing = raw === ''
  const target = clearing ? '' : dayStart(raw)

  if (!clearing && !target) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-12-06.')
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', current
      ? `The final deadline is already ${current}.`
      : 'There is already no final deadline.')
  }
  if (!clearing) {
    if (target < now) {
      throw new ApiError('IN_THE_PAST', `${target} has already passed.`)
    }
    if (daysBetween(now, target) > 5 * 366) {
      throw new ApiError('TOO_FAR', `${target} is more than five years away.`)
    }
    // The draw cannot happen before the books are back, so a final deadline
    // after it describes a raffle that draws winners from books nobody counted.
    if (draw && target > draw) {
      throw new ApiError(
        'AFTER_DRAW',
        `The draw is set for ${draw} and a final deadline of ${target} would fall after ` +
        'it. Everything has to be back before the draw, so move the draw date first if ' +
        'the whole raffle is running later.',
        { drawDate: draw, requested: target },
      )
    }
  }

  // A final deadline earlier than the check-in would leave the check-in past
  // the wall. It is pulled back to match — stated, never silent.
  const pullsCheckIn = !clearing && !!checkIn && checkIn > target

  const shortening = clearing || (!!current && target < current)
  const dryRun = p.dryRun === undefined ? true : !!p.dryRun
  if (dryRun) {
    return {
      dryRun: true, from: current, to: target, clearing,
      checkInDate: pullsCheckIn ? target : checkIn,
      pullsCheckInBack: pullsCheckIn,
      effect: clearing
        ? 'The final deadline would be removed, and the check-in has nothing to count to.'
        : `The final deadline would be ${target}.` +
          (pullsCheckIn ? ` The check-in moves back from ${checkIn} to match it.` : ''),
      message: 'Nothing was changed. Send the same request with dryRun:false to apply it.',
    }
  }

  if (shortening) {
    const word = clearing ? 'clear' : target
    if (String(p.confirm ?? '') !== word) {
      throw new ApiError(
        'CONFIRM_REQUIRED',
        clearing
          ? 'Clearing the final deadline stops every countdown. Send confirm:"clear".'
          : `Bringing the final deadline forward to ${target} gives everybody less time. ` +
            `Send confirm:"${target}" to go ahead.`,
        { confirm: word },
      )
    }
  }

  await setConfig(ctx, 'FINAL_DEADLINE', target)
  if (pullsCheckIn) await setConfig(ctx, 'CHECK_IN_DATE', target)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_FINAL_DEADLINE',
    details: { from: current, to: target, pulledCheckInBack: pullsCheckIn },
    email: user.email,
  })

  return {
    from: current, to: target, clearing,
    checkInDate: pullsCheckIn ? target : checkIn,
    pulledCheckInBack: pullsCheckIn,
  }
}
