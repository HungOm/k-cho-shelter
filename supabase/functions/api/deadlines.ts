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
  let q = ctx.supabaseAdmin.from('books').select('due_at').eq('status', 'Out')
  if (mine) q = q.eq('held_by_agent', user.agentId ?? ' ')
  const { data: out } = await q

  const booksOut = (out ?? []).length
  const lateNow = (out ?? []).filter((b: { due_at: string | null }) =>
    b.due_at && b.due_at < now).length

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
  }
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
      'count down to. The super admin sets that first.',
    )
  }

  const target = String(p.date ?? '').trim()
    ? dayStart(p.date)
    : addMonths(current || now, 1)

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

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'ROLL_CHECK_IN',
    details: { from: current, to: landed, booksMoved: moving.length, lateNow, isLastRound },
    email: user.email,
  })

  return {
    from: current, to: landed, finalDeadline: final, isLastRound,
    booksOut, booksMoving: moving.length, lateNow,
    daysGiven: daysBetween(now, landed),
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
