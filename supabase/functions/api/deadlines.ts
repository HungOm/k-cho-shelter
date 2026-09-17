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
import { collectedByAgent, moneyScope, round2, showsSellerNames, totalsAgents } from './money.ts'

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

/*
 * HOW FAR APART THE ROUNDS SIT, in the unit the raffle actually keeps.
 *
 * Months were the only unit there was, and half the rhythms people run on
 * cannot be said in months. "Twice a month" is the common one and it was
 * unsayable: CHECK_IN_EVERY_MONTHS is a whole number of months, so the nearest
 * expressible thing was monthly, and a team reporting every fortnight was being
 * told by every screen in the app that they report monthly.
 *
 * So the cadence is a number and a unit — `1m`, `2w`, `14d` — and months stay
 * the default so nothing that was set before today changes meaning. A bare
 * number is months, which is exactly what the old key held, which is what lets
 * the old key remain the fallback rather than a migration everybody has to run.
 *
 * TWICE A MONTH IS A FORTNIGHT HERE, not the 15th and the last day. A true
 * semi-monthly rhythm has two different gaps and lands on dates no arithmetic
 * agrees about in February; a raffle that genuinely wants the 15th and the 30th
 * sets a fortnight and moves the one round that lands wrong, which is what the
 * per-round override is for. One mechanism that handles every calendar beats
 * two that each handle most of one.
 */
export type Cadence = { n: number; unit: 'm' | 'd' }

/** A year. Longer than the longest raffle, so a mistyped cadence cannot suspend it. */
const MAX_CADENCE_DAYS = 366

export function parseCadence(raw: unknown, fallbackMonths = 1): Cadence {
  const fallback: Cadence = { n: Math.min(12, Math.max(1, Math.floor(fallbackMonths) || 1)), unit: 'm' }
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return fallback

  const m = /^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)?$/.exec(text)
  if (!m) return fallback

  // 0 is not "never": it asks the check-in to stand still, which is the one
  // setting that stops the whole mechanism working. Read as 1, as it always was.
  const n = Math.max(1, parseInt(m[1], 10) || 1)
  const unit = (m[2] ?? 'm')[0]
  if (unit === 'w') return { n: Math.min(n * 7, MAX_CADENCE_DAYS), unit: 'd' }
  if (unit === 'd') return { n: Math.min(n, MAX_CADENCE_DAYS), unit: 'd' }
  return { n: Math.min(n, 12), unit: 'm' }
}

/** One step of the cadence. Month steps clamp to the end of the month; days do not need to. */
export function addCadence(iso: string, c: Cadence): string {
  return c.unit === 'd' ? addDays(iso, c.n) : addMonths(iso, c.n)
}

/**
 * The cadence as somebody would say it, because the screens print it in
 * sentences: "then it moves on a month".
 */
export function cadenceWords(c: Cadence): string {
  if (c.unit === 'm') return c.n === 1 ? 'a month' : `${c.n} months`
  if (c.n === 7) return 'a week'
  if (c.n === 14) return 'a fortnight'
  if (c.n % 7 === 0) return `${c.n / 7} weeks`
  return `${c.n} days`
}

/**
 * Every round from `anchor` to `final` inclusive; [] with no wall to walk to.
 *
 * `every` takes a plain number of months as it always did, or a cadence with a
 * unit. Both, rather than one: this function is called with a bare number from
 * the Apps Script twin's tests and from four cases in checkin.test.mjs, and a
 * signature that silently reinterprets those as days would move every date in
 * the plan while every one of those tests went on passing.
 */
export function checkInSchedule(
  anchor: string, final: string, every: number | Cadence,
): string[] {
  if (!final) return []
  if (!anchor || anchor >= final) return [final]

  const step: Cadence = typeof every === 'number'
    ? { n: Math.max(1, Math.floor(every) || 1), unit: 'm' }
    : every
  const out = [anchor]
  let d = anchor
  // Capped rather than trusted. A cadence and a wall that disagree — a one-day
  // step and a raffle somebody dated five years out — must not spin here. The
  // cap is on ROUNDS rather than on the arithmetic, so a weekly raffle gets its
  // weeks and a mistyped one stops at a plan nobody can read instead of hanging.
  for (let i = 0; i < 200; i++) {
    d = addCadence(d, step)
    if (d >= final) break
    out.push(d)
  }
  out.push(final)
  return out
}

/**
 * THE PLAN, WITH THE DATES SOMEBODY MOVED.
 *
 * The derivation does not know that round 4 lands on Chinese New Year, and it
 * never will. A row in check_in_dates replaces the date for one round and
 * touches no other: the rhythm is anchored, so moving one date does not walk
 * the rest of the plan sideways.
 *
 * Kept OUT of checkInSchedule rather than folded into it, because that function
 * is a pure derivation from three values and is tested as one. Overrides are
 * stored data and arrive with round numbers attached, which the derivation has
 * no way to know — it produces a list, not a numbering.
 */
export function withOverrides(
  schedule: string[], firstRound: number, overrides: Map<number, string>,
): Array<{ date: string; round: number; moved: boolean }> {
  return schedule.map((date, i) => {
    const round = firstRound + i
    const moved = overrides.get(round)
    return { date: moved || date, round, moved: !!moved && moved !== date }
  })
}

/** Dates an organiser has moved, by round. Empty is the behaviour this always had. */
export async function checkInOverrides(ctx: Ctx): Promise<Map<number, string>> {
  const { data } = await ctx.supabaseAdmin
    .from('check_in_dates').select('round,due_at,note').is('cleared_at', null).order('round')
  const m = new Map<number, string>()
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const d = dayStart(r.due_at)
    if (d) m.set(Number(r.round), d)
  }
  return m
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

/** How far apart the rounds sit, in months. Kept for the callers that think in months. */
export const everyMonths = (ctx: Ctx) => configNum(ctx, 'CHECK_IN_EVERY_MONTHS', 1, 1)

/**
 * The cadence this raffle keeps.
 *
 * CHECK_IN_EVERY wins when it is set; CHECK_IN_EVERY_MONTHS is the fallback, so
 * a raffle configured before the unit existed keeps the rhythm it has been
 * running on and nobody has to migrate a row to stay where they were.
 */
export async function cadence(ctx: Ctx): Promise<Cadence> {
  const { data } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'CHECK_IN_EVERY').maybeSingle()
  return parseCadence(data?.value ?? '', await everyMonths(ctx))
}

/** The last day a ticket may be sold. Blank is how every raffle ran until today. */
export const salesCloseDate = (ctx: Ctx) => configDate(ctx, 'SALES_CLOSE_DATE')

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
    .is('undone_at', null)
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
    .is('undone_at', null)
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

  const step = await cadence(ctx)
  const grace = await graceDays(ctx)
  const round = await checkInRound(ctx)
  const answered = await reportedIn(ctx, round)
  const outstanding = [...holders].filter((id) => !answered.has(id))
  const close = await salesCloseDate(ctx)

  const reportBy = checkIn ? addDays(checkIn, grace) : ''
  const schedule = withOverrides(checkInSchedule(checkIn, final, step), round, await checkInOverrides(ctx))

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
    // Both, and they cannot disagree: everyMonths is the month count when the
    // raffle keeps a monthly rhythm and 0 when it does not, so a reader that
    // only knows about months can tell "three months" from "not months at all"
    // instead of quietly rendering a fortnight as a month.
    everyMonths: step.unit === 'm' ? step.n : 0,
    cadence: `${step.n}${step.unit}`,
    cadenceWords: cadenceWords(step),
    graceDays: grace,
    reportBy,
    chaseFrom: reportBy,
    // THE LAST DAY A TICKET MAY BE SOLD, which is not the day the books come
    // back and not the draw. Blank is every raffle that ran before it existed.
    salesCloseDate: close,
    salesClosed: !!close && close < now,
    daysToSalesClose: close ? daysBetween(now, close) : null,
    schedule: schedule.map((r) => ({
      date: r.date,
      round: r.round,
      // Whether somebody moved this one off the rhythm. Shown, because a date
      // that is not where the cadence would have put it is a date people have
      // to be told about twice.
      moved: r.moved,
      last: r.date === final,
      done: r.date < now,
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
    // Already undone reads the same as never recorded, to the person asking.
    if (!existing || existing.undone_at) {
      throw new ApiError('NOTHING_TO_DO', `${name} has not been recorded as reporting this round.`)
    }
    /*
     * MARKED, NOT DELETED. Everything the comment above says about the chase
     * list still happens — every read of this table carries `undone_at is null`,
     * so she is back on it the instant this returns. What changes is that "a
     * check-in was recorded against her and taken back" survives, which is the
     * same reason the ledger reverses instead of editing: a correction whose
     * evidence is gone cannot be told from a figure that was always right.
     */
    const { error } = await ctx.supabaseAdmin
      .from('check_in_reports')
      .update({ undone_at: new Date().toISOString(), undone_by: user.email })
      .eq('agent_id', agentId).eq('round', round)
    if (error) throw new ApiError('QUERY_FAILED', error.message)

    await ctx.supabaseAdmin.from('audit_log').insert({
      action: 'UNDO_CHECK_IN', details: { agent: agentId, round }, email: user.email,
    })
    return { agentId, agentName: name, round, checkInDate: checkIn, undone: true }
  }

  /*
   * HOW MANY BOOKS THEY WERE HOLDING WHEN THEY SAID THIS.
   *
   * Read now and stored, rather than looked up whenever the sheet is printed.
   * A seller reports in September holding four books and hands two back in
   * October; a sheet printed in November that recomputes "books × ten tickets"
   * gets forty where the copy they signed says eighty, and the two sheets
   * disagree about a number neither of them got wrong. The figure belongs to
   * the moment, so it is written down at the moment — the same reason
   * round_snapshots stores `outstanding` instead of deriving it later.
   */
  const { data: held } = await ctx.supabaseAdmin
    .from('books').select('idx').eq('held_by_agent', agentId).eq('status', 'Out')

  const row = {
    agent_id: agentId,
    round,
    due_at: checkIn,
    books_back: int(p.booksBack),
    tickets_sold: int(p.ticketsSold),
    amount_paid: num(p.amountPaid),
    /*
     * THE PAPER, WHICH IS THE HALF NOTHING COULD SEE.
     *
     * books_back and tickets_sold are the seller's word about things the system
     * counts for itself, so a report built from them could only restate the
     * screen. These two are what the system cannot know: how many counterfoils
     * are in the envelope, and how many unsold tickets came back loose out of a
     * part-used book. With them, every ticket a seller was carrying is in one of
     * four places — stub, returned unsold, still in a book they kept, or
     * unaccounted for — and the fourth is the number an organiser is actually
     * looking for.
     */
    stubs_returned: int(p.stubsReturned),
    unsold_returned: int(p.unsoldReturned),
    books_out_at: (held ?? []).length,
    note: String(p.note ?? '').trim(),
    recorded_by: user.email,
    reported_at: new Date().toISOString(),
    // Recording revives a row that was undone. Without this the update below
    // would leave undone_at set and the new report would be invisible, and the
    // insert branch would collide with the (agent_id, round) key.
    undone_at: null,
    undone_by: null,
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
    details: { agent: agentId, round, booksBack: row.books_back, amountPaid: row.amount_paid,
               stubs: row.stubs_returned, unsold: row.unsold_returned },
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
    stubsReturned: row.stubs_returned,
    unsoldReturned: row.unsold_returned,
    booksOutAt: row.books_out_at,
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

    // UNFILTERED ON PURPOSE. A row that was undone still occupies the
    // (agent_id, round) key, so asking only for live rows and then inserting
    // would collide. What is wanted is: live already, do nothing; undone,
    // revive it, because settling a book IS reporting; absent, write it.
    const { data: existing, error: readFailed } = await ctx.supabaseAdmin
      .from('check_in_reports').select('agent_id,undone_at')
      .eq('agent_id', id).eq('round', round).maybeSingle()
    if (readFailed) throw new Error(readFailed.message)
    if (existing && !existing.undone_at) return

    const row = {
      agent_id: id,
      round,
      due_at: checkIn,
      note: `Reported by settling ${bookNumber}`,
      recorded_by: user.email,
      reported_at: new Date().toISOString(),
      undone_at: null,
      undone_by: null,
    }
    const { error } = existing
      ? await ctx.supabaseAdmin.from('check_in_reports').update(row)
          .eq('agent_id', id).eq('round', round)
      : await ctx.supabaseAdmin.from('check_in_reports').insert(row)
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

  /*
   * WHERE THE NEXT DATE COMES FROM, in order: what the caller typed, then the
   * date somebody set for that round, then a plain step of the cadence.
   *
   * The middle one is new and it is not the derivation creeping in. A row in
   * check_in_dates is a date a person typed and stored, the same kind of thing
   * as p.date arriving in the request — the rule this preserves is that the
   * target is never READ OFF THE PLAN, because the plan is arithmetic and
   * whether a seller is late must not depend on arithmetic that can change
   * under them. A stored override cannot change under anybody.
   */
  const step = await cadence(ctx)
  const round = await checkInRound(ctx)
  const overrides = await checkInOverrides(ctx)
  const target = String(p.date ?? '').trim()
    ? dayStart(p.date)
    : (overrides.get(round + 1) || addCadence(current || now, step))

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
      roundsLeft: checkInSchedule(landed, final, step).length,
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
 * A VIEWER SEES THE ROUND'S FIGURES AND NOBODY'S NAME, which is the split
 * money.ts has since finished making. This used `visibleAgents` for both
 * halves while there was only one function — deliberately, and wrong in the
 * harmless direction: a viewer got no lines and empty totals rather than
 * somebody else's figures.
 *
 * `totalsAgents` answers the other half, so the rows are now built and summed
 * over everyone this person's TOTALS may include, and the NAMES are withheld
 * at the bottom instead. A viewer is the only role for whom those two answers
 * differ, and a closed round is exactly the kind of thing oversight is for:
 * what was owed then, what is owed now, and whether the gap is closing.
 *
 * A helper carrying no books still gets nothing, and that is not the same
 * conservatism — a closed round has nothing to say about somebody who never
 * owed anything.
 */
export async function readRoundSnapshot(
  p: Record<string, unknown>, user: AppUser, ctx: Ctx,
) {
  const only = totalsAgents(user)
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
   * The names go to exactly two people, the same two the debt table goes to —
   * and that is money.ts's sentence to say, not this file's.
   *
   * IT WAS SPELLED OUT HERE, correctly, as `scope === 'all' || scope === 'mine'`.
   * Correct and still a second copy: the rule already exists as
   * showsSellerNames precisely because the negative form each money screen
   * wrote for itself broke the moment a fourth scope existed — a helper fell
   * through to the table branch and was handed the rows the split was made to
   * keep from them. Two right copies are how the third one goes wrong.
   */
  const named = showsSellerNames(scope)
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


// ============ MOVING ONE ROUND'S DATE ============

/**
 * Put a FUTURE reporting round on a different day, without touching the rhythm.
 *
 * WHY THIS AND NOT A TYPED CALENDAR. The rounds are worked out from the anchor,
 * the cadence and the wall precisely so nobody has to keep a calendar in their
 * head, and so a seller can be told every one of their dates on the day they
 * collect their books. That stays. What the derivation cannot know is that round
 * 4 lands on a public holiday, or that the hall is booked that week, and until
 * now the only answers were to change the cadence for everybody or to roll early
 * and lose a round.
 *
 * ONE ROUND, AND THE RHYTHM SURVIVES IT. The plan is derived from the ANCHOR
 * rather than from each previous date, so moving round 4 does not walk rounds 5
 * and 6 sideways with it. That property is what makes this safe to offer: the
 * worst a mistake can do is put one date somewhere odd, and the same screen puts
 * it back.
 *
 * FUTURE ONLY, AND THE LIVE ROUND IS THE ROLL'S. CHECK_IN_DATE is the one stored
 * date that decides who is late — defaultDueDate hands it to every book going
 * out, every overdue calculation compares against it, the chase list is built
 * from it — and it already has an owner: rollCheckIn, with a dry run, a typed
 * confirmation when somebody is already overdue, and a flat refusal to move
 * backwards. A second door onto the same value with none of those guards is how
 * a raffle ends up with two current check-in dates and discovers that the one
 * nobody could see was the one deciding who was chased. So this moves rounds
 * that have not arrived yet and says where to move the live one.
 *
 * THE WINDOW IS THE GUARD. A date is refused unless it falls strictly between
 * the round before it and the round after it, and never past the wall. Two
 * rounds on one day is a date that cannot be reported by twice; rounds out of
 * order is a plan that reads as nonsense to the person keeping it. Both are
 * refused with the window named, because "not allowed" and "it has to fall
 * between 15 October and 14 December" are different amounts of help.
 */
export async function setCheckInDate(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const round = Math.floor(Number(p.round ?? 0))
  if (!Number.isFinite(round) || round < 1) {
    throw new ApiError('MISSING_FIELD', 'Which round is being moved?')
  }

  const now = today()
  const current = await checkInRound(ctx)
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')

  if (!final) {
    throw new ApiError(
      'NO_FINAL_DEADLINE',
      'There is no final deadline yet, so there are no rounds to move. The system admin ' +
      'sets that first.',
    )
  }
  if (round < current) {
    throw new ApiError(
      'ROUND_CLOSED',
      `Round ${round} has already closed — round ${current} is the live one. Reports are ` +
      'filed against the round they answered, so moving its date now would change what ' +
      'people were asked to do after they had done it.',
      { round, currentRound: current },
    )
  }
  if (round === current) {
    throw new ApiError(
      'ROUND_IS_LIVE',
      `Round ${current} is the one everybody is reporting to now, and its date is the one ` +
      'the whole raffle measures lateness against. Move it with "Move the check-in on" on ' +
      'the Deadlines screen, which says first how many books it would give more time to.',
      { round, currentRound: current, checkInDate: checkIn },
    )
  }

  const step = await cadence(ctx)
  const overrides = await checkInOverrides(ctx)
  const derived = checkInSchedule(checkIn, final, step)
  const plan = withOverrides(derived, current, overrides)

  const at = plan.find((r) => r.round === round)
  if (!at) {
    const last = plan[plan.length - 1]
    throw new ApiError(
      'NO_SUCH_ROUND',
      `This raffle has rounds ${current} to ${last ? last.round : current} — there is no ` +
      `round ${round} between now and the final deadline on ${final}.`,
      { rounds: plan.map((r) => r.round) },
    )
  }

  // CLEARING puts a round back on the rhythm, which is the first thing somebody
  // wants the moment they move one by mistake.
  const clearing = !String(p.date ?? '').trim()
  const asked = clearing ? '' : dayStart(p.date)
  if (!clearing && !asked) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-10-14.')
  }
  if (clearing && !overrides.has(round)) {
    throw new ApiError('NO_CHANGE', `Round ${round} has not been moved — it is on ${at.date}.`)
  }

  const was = at.date
  // Where it lands: the typed date, or the date the rhythm would have given it.
  const target = clearing ? derived[round - current] : asked
  if (!clearing && target === was) {
    throw new ApiError('NO_CHANGE', `Round ${round} is already on ${target}.`)
  }

  const before = plan.filter((r) => r.round < round).pop()
  const after = plan.find((r) => r.round > round)

  if (target < now) {
    throw new ApiError(
      'IN_THE_PAST',
      `${target} has already passed. A reporting date has to be a day people can still ` +
      'report by.',
    )
  }
  if (target > final) {
    throw new ApiError(
      'PAST_THE_WALL',
      `The final deadline is ${final}. A reporting round cannot fall after it — by then ` +
      'everything is due outright, which is not something to report on, it is the end.',
      { finalDeadline: final },
    )
  }
  if (before && target <= before.date) {
    throw new ApiError(
      'OUT_OF_ORDER',
      `Round ${before.round} is on ${before.date}, so round ${round} has to fall after it. ` +
      `${target} does not.`,
      { window: { after: before.date, before: after ? after.date : final } },
    )
  }
  if (after && target >= after.date) {
    throw new ApiError(
      'OUT_OF_ORDER',
      `Round ${after.round} is on ${after.date}, so round ${round} has to fall before it. ` +
      'Move the later round first if the whole run is shifting.',
      { window: { after: before ? before.date : checkIn, before: after.date } },
    )
  }

  if (clearing) {
    // Withdrawing what a dozen people were told to do. The row stays and every
    // read carries `cleared_at is null`, so the schedule reads the same as it
    // would have after a delete — and setting the round again below revives it.
    const { error } = await ctx.supabaseAdmin.from('check_in_dates')
      .update({ cleared_at: new Date().toISOString(), cleared_by: user.email })
      .eq('round', round)
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  } else {
    const { error } = await ctx.supabaseAdmin.from('check_in_dates').upsert({
      round, due_at: target, note: String(p.note ?? '').trim(), set_by: user.email,
      set_at: new Date().toISOString(),
      cleared_at: null, cleared_by: null,
    }, { onConflict: 'round' })
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_CHECK_IN_DATE',
    details: { round, from: was, to: target, cleared: clearing,
               note: String(p.note ?? '').trim() },
    email: user.email,
  })

  return {
    round, from: was, to: target, cleared: clearing,
    schedule: withOverrides(derived, current, await checkInOverrides(ctx)),
  }
}


// ============ THE CHECK-IN SHEET ============

/**
 * One seller, one round, on one page — the thing that is printed, read out and
 * signed at the table.
 *
 * WHY IT IS ONE CALL. Everything on it is already answerable somewhere:
 * agent_statement has the books and the money, deadline_status has the dates,
 * round_snapshot has what a closed round said. Assembling a document out of four
 * calls means four moments, and a sheet whose money was read at 10:04 and whose
 * books were read at 10:06 can disagree with itself about a book settled at
 * 10:05. A document somebody signs has to be one measurement.
 *
 * THE PAPER ARITHMETIC IS THE POINT, and it is the half nothing could do before.
 * A seller carrying N books is carrying N × TICKETS_PER_BOOK physical tickets.
 * The system counts SALES — what somebody typed into a screen — and cannot count
 * paper, so until the stubs and the unsold returns were written down, "does it
 * add up" was a question with no data behind it.
 *
 * DECLARED AND RECORDED ARE PRINTED SIDE BY SIDE, never merged. The declaration
 * is what the seller said while standing there; the record is what the system
 * was told by whoever typed the sales in. Where they disagree, the disagreement
 * IS the finding — a book sold out of somebody's own pocket, a sale recorded
 * against the wrong seller, an envelope of stubs left in a car. Merged into one
 * "sold" figure, the same gap goes unseen until the draw.
 *
 * AND BOTH SIDES ARE CUMULATIVE, which is the only way they can be compared.
 * Stubs handed in at one visit are a per-visit quantity; sales recorded on a
 * seller's books are a running total for the raffle. Comparing those two
 * directly reads as a discrepancy every round after the first, which would
 * train an organiser to ignore the one number on the sheet worth reading. So
 * the declarations are summed to this round and compared with the running
 * total. The round's own figures are printed too — they are what the seller
 * actually handed over today — but the gap is cumulative against cumulative.
 *
 * FROZEN ONCE THE ROUND HAS CLOSED. For a round that has rolled, the snapshot
 * taken at the roll comes back beside today's figures, so a sheet reprinted in
 * December still says what the October copy said and shows what has moved. For
 * the live round nothing is frozen and the figures are live, which is correct:
 * it is the working document, and the round has not finished happening.
 */
export async function checkInSheet(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  // An agent may only ever pull their own — the same silent redirection
  // agent_statement makes. Asking for somebody else's is not an error worth
  // explaining, it is a question they are not entitled to ask.
  const agentId = user.role === 'agent'
    ? (user.agentId ?? '')
    : String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name,phone,zone').eq('agent_id', agentId).maybeSingle()
  if (!agent) {
    throw new ApiError('AGENT_NOT_FOUND', `There is no seller with the ID "${agentId}".`, null, 404)
  }

  const now = today()
  const current = await checkInRound(ctx)
  const asked = Math.floor(Number(p.round ?? 0))
  const round = asked >= 1 ? asked : current

  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')
  const close = await salesCloseDate(ctx)
  const grace = await graceDays(ctx)
  const step = await cadence(ctx)
  const perBook = await configNum(ctx, 'TICKETS_PER_BOOK', 10, 1)
  const { data: cur } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'CURRENCY').maybeSingle()

  // Every declaration this seller has made up to and including this round. The
  // one for this round is the sheet's subject; the rest are what makes the
  // comparison with a running total a fair one.
  const { data: saidRows } = await ctx.supabaseAdmin
    .from('check_in_reports').select('*')
    .eq('agent_id', agentId).lte('round', round).is('undone_at', null).order('round')
  const history = (saidRows ?? []) as Array<Record<string, unknown>>
  const said = history.find((r) => Number(r.round) === round) ?? null

  // What the round said when it closed. Absent for the live round, which has not
  // closed, and for rounds that closed before snapshots existed.
  const { data: frozen } = await ctx.supabaseAdmin
    .from('round_snapshots').select('*')
    .eq('agent_id', agentId).eq('round', round).maybeSingle()

  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('*').eq('held_by_agent', agentId).order('idx')
  const rows = (ledger ?? []) as Array<Record<string, unknown>>

  const n = (v: unknown) => Number(v ?? 0)
  const books = rows.map((b) => ({
    number: String(b.number ?? ''),
    firstTicket: String(b.first_ticket ?? ''),
    lastTicket: String(b.last_ticket ?? ''),
    status: String(b.status ?? ''),
    due: b.due_at ?? null,
    daysOverdue: n(b.days_overdue),
    ticketsInBook: perBook,
    sold: n(b.counted_sold),
    // What is still sellable in it, and what is being held for somebody. These
    // two are the "remains of the book" a seller is carrying.
    available: n(b.available),
    reserved: n(b.reserved),
    // Sold, and nobody wrote down who bought it. The one fault on this sheet
    // that cannot be repaired after the draw.
    missingContact: n(b.missing_contact),
    expected: round2(n(b.counted_expected)),
    collected: round2(n(b.counted_collected)),
  }))

  const out = rows.filter((b) => String(b.status) === 'Out')
  const expected = round2(rows.reduce((t, b) => t + n(b.counted_expected), 0))
  const collected = round2((await collectedByAgent(ctx, [agentId])).get(agentId) ?? 0)
  const recordedSold = rows.reduce((t, b) => t + n(b.counted_sold), 0)
  const missingContact = rows.reduce((t, b) => t + n(b.missing_contact), 0)

  /*
   * THE PAPER, AND WHERE EVERY TICKET OF IT IS.
   *
   * booksOutAt is what they were holding when they reported, stored at that
   * moment — not what they hold now, which is what makes a reprint agree with
   * the copy somebody signed. With no declaration yet the live count stands in,
   * because this sheet is also what an organiser prints BEFORE the seller
   * arrives, to carry to the table with the numbers already on it.
   *
   * `unaccounted` is the number the sheet exists for: the paper that was in the
   * books handed back, less the paper actually counted in. Positive means
   * tickets are missing out of a returned book. NEGATIVE IS ORDINARY and says
   * so on the page — it means they also handed in stubs from books they are
   * keeping, which is what a seller mid-book does every time.
   */
  const booksAtHand = said ? n(said.books_out_at) : out.length
  const ticketsInHand = booksAtHand * perBook
  const stubs = n(said?.stubs_returned)
  const unsoldBack = n(said?.unsold_returned)
  const booksBack = n(said?.books_back)
  const handedBack = booksBack * perBook
  const handedIn = stubs + unsoldBack

  const stubsToDate = history.reduce((t, r) => t + n(r.stubs_returned), 0)
  const paidToDate = round2(history.reduce((t, r) => t + n(r.amount_paid), 0))

  const answered = await reportedIn(ctx, round)
  const earlier = await reportsBefore(ctx, round)

  return {
    round,
    isCurrentRound: round === current,
    roundClosed: round < current,
    // The date this round was to be reported by: what the declaration was filed
    // against for a round that has one, the live date otherwise. Never
    // re-derived — a round's date is what it was, whatever the plan says now.
    dueAt: said?.due_at ?? (round === current ? checkIn : null),
    checkInDate: checkIn,
    finalDeadline: final,
    salesCloseDate: close,
    cadence: cadenceWords(step),
    graceDays: grace,
    ticketsPerBook: perBook,
    currency: cur?.value ?? 'RM',
    takenAt: new Date().toISOString(),
    printedBy: user.email,

    agent: {
      id: String(agent.agent_id), name: String(agent.name ?? ''),
      phone: String(agent.phone ?? ''), zone: String(agent.zone ?? ''),
    },

    // What the seller said, and who wrote it down. Null until they report.
    declared: said
      ? {
        reportedAt: said.reported_at, recordedBy: String(said.recorded_by ?? ''),
        booksOutAt: booksAtHand, booksBack,
        stubsReturned: stubs, unsoldReturned: unsoldBack,
        ticketsSold: n(said.tickets_sold), amountPaid: round2(n(said.amount_paid)),
        note: String(said.note ?? ''),
      }
      : null,

    // What the system has been told by whoever typed the sales in.
    recorded: {
      books: rows.length, booksOut: out.length,
      booksOverdue: out.filter((b) => n(b.days_overdue) > 0).length,
      ticketsSold: recordedSold,
      expected, collected, outstanding: round2(expected - collected),
      missingContact,
    },

    // Every ticket they were carrying, and where it went.
    paper: {
      booksAtHand, ticketsInHand,
      booksBack, inBooksHandedBack: handedBack,
      stubsReturned: stubs, unsoldReturned: unsoldBack, handedIn,
      stillWithThem: Math.max(0, ticketsInHand - handedIn),
      unaccounted: said ? handedBack - handedIn : 0,
    },

    // The two numbers this sheet exists to put beside each other, both running
    // totals so that they are the same measurement twice.
    gap: said
      ? {
        stubsToDate, ticketsRecorded: recordedSold, tickets: stubsToDate - recordedSold,
        paidToDate, moneyRecorded: collected, money: round2(paidToDate - collected),
      }
      : null,

    standing: {
      state: reportState({
        booksOut: out.length, reported: answered.has(agentId), checkIn, grace, now,
      }),
      reported: answered.has(agentId),
      daysLate: checkIn && checkIn < now ? daysBetween(checkIn, now) : 0,
      missedBefore: Math.max(0, (round - 1) - (earlier.get(agentId) ?? 0)),
    },

    // What this round said when it closed, for a sheet reprinted afterwards.
    frozen: frozen
      ? {
        takenAt: frozen.taken_at, takenBy: String(frozen.taken_by ?? ''),
        booksOut: n(frozen.books_out), booksSettled: n(frozen.books_settled),
        ticketsSold: n(frozen.recorded_sold),
        expected: round2(n(frozen.expected)), collected: round2(n(frozen.collected)),
        outstanding: round2(n(frozen.outstanding)),
      }
      : null,

    books,
  }
}


// ============ THE DAY SELLING STOPS ============

/**
 * The last day a ticket may be sold.
 *
 * THE THIRD DATE, and it is none of the other two. The check-in is a
 * checkpoint, the final deadline is when the paper and the money are due back,
 * and this is when the raffle stops taking money. They are usually different
 * days and the ordinary order is: selling stops, then everything comes back,
 * then the draw.
 *
 * It was enforced before it could be set, which is a real gap and not a
 * theoretical one: the rule lived in the database as a config row that only
 * somebody with SQL access could write. An organiser could be refused a sale by
 * a date they had no way to choose or to move.
 *
 * WHY AN ORGANISER AND NOT THE OWNER. The final deadline is the owner's because
 * moving it moves the draw and every countdown to it. Closing sales is the
 * ordinary running of the raffle — the committee decides at a meeting that the
 * books shut on the first — and a single unreachable person should not be
 * between the organisers and a decision they have already taken. It is audited
 * like everything else, and it can be undone.
 *
 * CLOSING IS THE DANGEROUS DIRECTION. Opening selling back up costs nothing;
 * shutting it stops money the raffle is counting on, immediately and for
 * everybody. So a date that closes sales sooner than they close today — or that
 * has already passed, which closes them the moment it is written — has to be
 * typed back before it is applied. The same shape as bringing the final
 * deadline forward, for the same reason.
 */
export async function setSalesClose(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const now = today()
  const current = await salesCloseDate(ctx)
  const draw = await configDate(ctx, 'DRAW_DATE')
  const final = await configDate(ctx, 'FINAL_DEADLINE')

  const clearing = !String(p.date ?? '').trim()
  const target = clearing ? '' : dayStart(p.date)
  if (!clearing && !target) {
    throw new ApiError('BAD_DATE', 'That is not a date this system can read. Use 2026-12-01.')
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', current
      ? `Ticket sales already close on ${current}.`
      : 'There is already no closing date — sales stay open.')
  }

  if (!clearing) {
    if (draw && target > draw) {
      throw new ApiError(
        'AFTER_THE_DRAW',
        `The draw is on ${draw}. Selling cannot close after the tickets have been drawn — ` +
        'a ticket sold that day could never have won anything.',
        { drawDate: draw },
      )
    }
    if (daysBetween(now, target) > 366) {
      throw new ApiError(
        'TOO_FAR',
        `${target} is more than a year away. A closing date that far out is almost always ` +
        'a mistyped year, and one nobody would notice until the raffle refused to close.',
      )
    }
  }

  /*
   * TYPED BACK WHEN IT SHUTS SOMETHING, and not otherwise.
   *
   * Pushing the date out, or removing it, leaves every seller able to do what
   * they could do a minute ago. Bringing it in stops sales that are open right
   * now, which is a decision somebody should have to make twice.
   */
  // SOONER THAN IT WOULD HAVE, which is not the same as "a restriction where
  // there was none". Setting a closing date for the first time, months out, takes
  // nothing away from anybody today — everybody goes on selling until the day
  // they are now told about. Treating that as dangerous would put a typed
  // confirmation in front of the ordinary act of planning a raffle, and a
  // confirmation asked for routinely is one people learn to type without reading.
  const closesSooner = !clearing && !!current && target < current
  const alreadyPast = !clearing && target < now
  if ((closesSooner || alreadyPast) && String(p.confirm ?? '') !== target) {
    throw new ApiError(
      'CONFIRM_REQUIRED',
      alreadyPast
        ? `${target} has already passed, so selling would stop the moment this is saved. ` +
          `Send confirm:"${target}" to go ahead.`
        : `Sales close on ${current} today. Moving that to ${target} stops selling ` +
          `sooner for everybody. Send confirm:"${target}" to go ahead.`,
      { confirm: target, from: current, to: target, alreadyPast },
    )
  }

  await setConfig(ctx, 'SALES_CLOSE_DATE', target)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_SALES_CLOSE',
    details: { from: current || null, to: target || null, cleared: clearing },
    email: user.email,
  })

  return {
    from: current, to: target, cleared: clearing,
    closed: !!target && target < now,
    // Said back so the screen can put the three dates in order without asking
    // again, and so an organiser can see at once if they have just put the
    // closing date after the day everything is due back.
    finalDeadline: final, drawDate: draw,
    afterFinal: !!target && !!final && target > final,
  }
}
