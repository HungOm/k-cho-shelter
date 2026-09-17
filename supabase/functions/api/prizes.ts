/**
 * The prize schedule — what is on offer, and the awarding of it.
 *
 * WHAT THIS REPLACED. `record_winner` took a free-text prize and wrote it on a
 * winner row. Three things followed from that, all of them bad on the night:
 * "First prize", "1st Prize" and "Grand prize" were three different prizes to
 * everything downstream; nobody could be told how many of the ten consolation
 * prizes were still to come; and the Grand Prize could be awarded twice, which
 * is a thing you discover in front of the room.
 *
 * WHERE THE RULES LIVE. Two of them are in the database because they have to
 * survive being wrong here: a seat that does not exist cannot be filled, and a
 * quantity cannot be cut below what has already been given (schema.sql, THE
 * PRIZE SCHEDULE). This file owns the rules that are about PEOPLE — who may
 * change a schedule, and when a change stops being setup and starts being a
 * decision about a draw that is already under way.
 *
 * THE LINE BETWEEN AN ORGANISER AND THE OWNER, stated once: configuring the
 * prizes is ordinary organising and any admin does it. Changing a prize that
 * has ALREADY BEEN AWARDED is not configuration — somebody has been told they
 * won that, possibly out loud — so it needs the System Admin, the same place
 * `record_winner` already sat.
 */
import { ApiError, type AppUser } from './gate.ts'

type Ctx = {
  supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any }
  _viaApproval?: boolean
}

const str = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

/**
 * An id from a name: "Grand Prize" -> "grand-prize".
 *
 * Generated rather than typed, because the id is a key the organiser never
 * sees and a key somebody types is a key somebody typos. Collisions get a
 * numeric tail rather than silently overwriting the prize already there —
 * two prizes really can be called "Hamper".
 */
async function newId(base: string, table: string, col: string, ctx: Ctx) {
  const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prize'
  const { data } = await ctx.supabaseAdmin.from(table).select(col)
  const taken = new Set((data ?? []).map((r: Record<string, unknown>) => String(r[col])))
  if (!taken.has(root)) return root
  for (let n = 2; ; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`
}

// ============ READING THE SCHEDULE ============

/**
 * The schedule, with how much of it is gone.
 *
 * ANYONE SIGNED IN, including a viewer and a seller. "What can I win?" is the
 * question a seller is asked by every single person they sell a ticket to, and
 * an answer that only an organiser can open is an answer given from memory at
 * the table. There is nothing here to mask: no name, no telephone number, no
 * seller's position — only what the raffle has publicly offered.
 */
export async function listPrizes(_p: Record<string, unknown>, _user: AppUser, ctx: Ctx) {
  const [{ data: prizes, error: pe }, { data: types, error: te }, { data: given, error: ge }] =
    await Promise.all([
      ctx.supabaseAdmin.from('prizes').select('*').is('removed_at', null).order('rank'),
      ctx.supabaseAdmin.from('prize_types').select('*').order('sort'),
      ctx.supabaseAdmin.from('winners').select('prize_id,seq,forfeited_at'),
    ])
  if (pe || te || ge) throw new ApiError('QUERY_FAILED', (pe || te || ge)!.message)

  /*
   * A FORFEITED PRIZE IS NOT AWARDED. It was, and then the winner could not be
   * found or did not come, and the seat goes back into the schedule to be
   * redrawn. Counting it as given would leave a prize sitting in a cupboard
   * with the board saying it had gone — which is the exact shape of the
   * complaint a raffle cannot answer afterwards.
   */
  const live = (given ?? []).filter((w: Record<string, unknown>) => !w.forfeited_at)
  const awarded: Record<string, number> = {}
  const seats: Record<string, number[]> = {}
  for (const w of live) {
    const id = String(w.prize_id ?? '')
    if (!id) continue
    awarded[id] = (awarded[id] ?? 0) + 1
    ;(seats[id] ??= []).push(Number(w.seq))
  }

  const typeById = Object.fromEntries((types ?? []).map((t: Record<string, unknown>) =>
    [String(t.type_id), t]))

  /*
   * The pot, for a split-the-pot prize, is what has actually been handed in —
   * not what the tickets are worth. A prize announced as half of money we hope
   * to collect is a promise made on somebody else's behalf.
   */
  const { data: paid } = await ctx.supabaseAdmin.from('payments').select('amount')
  const collected = (paid ?? []).reduce(
    (s: number, r: Record<string, unknown>) => s + num(r.amount), 0)

  return {
    collected,
    types: types ?? [],
    prizes: (prizes ?? []).map((p: Record<string, unknown>) => {
      const id = String(p.prize_id)
      const t = typeById[String(p.type_id)] as Record<string, unknown> | undefined
      return {
        ...p,
        typeLabel: str(t?.label) || String(p.type_id),
        valuing: str(t?.valuing) || 'fixed',
        // What one of them is worth, worked out the same way prize_value() does
        // in SQL. `null` means unstated, and it is not zero — see schema.sql.
        unitValue: valueOf(p, t, collected),
        awarded: awarded[id] ?? 0,
        remaining: Math.max(0, num(p.quantity) - (awarded[id] ?? 0)),
        takenSeats: (seats[id] ?? []).sort((a, b) => a - b),
      }
    }),
  }
}

function valueOf(
  prize: Record<string, unknown>,
  type: Record<string, unknown> | undefined,
  collected: number,
): number | null {
  switch (str(type?.valuing) || 'fixed') {
    case 'percent': return Math.round(collected * num(prize.value_amount)) / 100
    case 'none': return null
    default: return num(prize.value_amount)
  }
}

// ============ CHANGING THE SCHEDULE ============

/** Has this prize already been given to somebody? */
async function awardedCount(prizeId: string, ctx: Ctx) {
  const { count } = await ctx.supabaseAdmin
    .from('winners').select('ticket_idx', { count: 'exact', head: true })
    .eq('prize_id', prizeId).is('forfeited_at', null)
  return count ?? 0
}

export async function upsertPrize(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const tier = str(p.tier)
  const name = str(p.name)
  if (!tier) throw new ApiError('MISSING_FIELD', 'What is this prize called? (Grand Prize, Second Prize, Consolation…)')
  if (!name) throw new ApiError('MISSING_FIELD', 'What is the prize itself?')

  const typeId = str(p.typeId) || 'goods'
  const { data: type } = await ctx.supabaseAdmin
    .from('prize_types').select('type_id,active').eq('type_id', typeId).maybeSingle()
  if (!type) throw new ApiError('BAD_REQUEST', `There is no prize type called "${typeId}".`)

  const quantity = Math.floor(num(p.quantity, 1))
  if (quantity < 1) throw new ApiError('BAD_REQUEST', 'A prize has to be given at least once.')
  const value = num(p.value, 0)
  if (value < 0) throw new ApiError('BAD_REQUEST', 'A prize cannot be worth less than nothing.')

  const existing = str(p.prizeId)
  if (existing) {
    const { data: was } = await ctx.supabaseAdmin
      .from('prizes').select('*').eq('prize_id', existing).is('removed_at', null).maybeSingle()
    if (!was) throw new ApiError('NOT_FOUND', `There is no prize called "${existing}".`, null, 404)

    /*
     * THE LINE. Editing a prize nobody has won yet is setup. Editing one that
     * has already been AWARDED is changing what somebody was told they had
     * won, and this repository puts that class of decision with the owner —
     * the same place record_winner sits. Going through an approval counts:
     * that is two people agreeing, which is what the rule is actually for.
     */
    const given = await awardedCount(existing, ctx)
    if (!user.isSuperAdmin && !ctx._viaApproval && given > 0) {
      throw new ApiError('SUPER_ADMIN_ONLY',
        `The ${was.tier} has already been given to somebody. Only the System Admin can change it now.`)
    }

    /*
     * THE QUANTITY CANNOT BE CUT BELOW WHAT HAS GONE OUT — checked here as well
     * as by the trigger, and the difference is who the sentence is for.
     *
     * The trigger is the guard: it holds when this code is wrong, when somebody
     * writes the table by hand, and against a second organiser editing in the
     * same second. But a refusal that only ever comes back from Postgres is a
     * refusal shaped like a database error, and the Apps Script twin has said
     * this in plain words since it was written. Two backends refusing the same
     * edit with different wording is a port divergence — smaller than the ones
     * this repository has had, and the same kind.
     */
    if (quantity < given) {
      throw new ApiError('BAD_REQUEST',
        `The ${was.tier} has been given ${given} times already, so it cannot be cut to ${quantity}.`)
    }
    const { data: high } = await ctx.supabaseAdmin
      .from('winners').select('seq').eq('prize_id', existing).is('forfeited_at', null)
      .order('seq', { ascending: false }).limit(1).maybeSingle()
    if (high && Number(high.seq) > quantity) {
      throw new ApiError('BAD_REQUEST',
        `Somebody holds a ${was.tier} above number ${quantity}.`)
    }

    const { error } = await ctx.supabaseAdmin.from('prizes').update({
      tier, name, description: str(p.description), type_id: typeId,
      value_amount: value, quantity,
      rank: Math.max(1, Math.floor(num(p.rank, was.rank))),
      draw_order: p.drawOrder === undefined || p.drawOrder === null || p.drawOrder === ''
        ? null : Math.floor(num(p.drawOrder)),
      donor: str(p.donor),
      active: p.active === undefined ? was.active : !!p.active,
    }).eq('prize_id', existing)
    // The quantity trigger speaks in sentences meant for a person; passing its
    // message through beats "query failed", which tells an organiser nothing
    // about the eight hampers already promised.
    if (error) throw refused(error)

    await log('UPDATE_PRIZE', { prize: existing, tier, name, quantity }, user, ctx)
    return { prizeId: existing, tier, name, quantity }
  }

  const prizeId = await newId(`${tier} ${name}`, 'prizes', 'prize_id', ctx)
  const { error } = await ctx.supabaseAdmin.from('prizes').insert({
    prize_id: prizeId, tier, name, description: str(p.description), type_id: typeId,
    value_amount: value, quantity,
    rank: Math.max(1, Math.floor(num(p.rank, 1))),
    draw_order: p.drawOrder === undefined || p.drawOrder === null || p.drawOrder === ''
      ? null : Math.floor(num(p.drawOrder)),
    donor: str(p.donor), created_by: user.email,
  })
  if (error) throw refused(error)

  await log('ADD_PRIZE', { prize: prizeId, tier, name, quantity }, user, ctx)
  return { prizeId, tier, name, quantity }
}

/**
 * Taking a prize off the schedule.
 *
 * REFUSED once anybody has won it, and deliberately not soft-deleted instead.
 * `active: false` already exists for "we are not offering this after all"; a
 * prize somebody HOLDS is a different thing again, and the honest move is to
 * say what is in the way rather than to hide the row and leave a winner
 * pointing at nothing.
 */
export async function removePrize(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const prizeId = str(p.prizeId)
  if (!prizeId) throw new ApiError('MISSING_FIELD', 'Which prize?')

  const { data: prize } = await ctx.supabaseAdmin
    .from('prizes').select('tier,name').eq('prize_id', prizeId).is('removed_at', null).maybeSingle()
  if (!prize) throw new ApiError('NOT_FOUND', `There is no prize called "${prizeId}".`, null, 404)

  // Forfeited ones count HERE, unlike everywhere else: the row still names this
  // prize, and `on delete restrict` would refuse the delete anyway. Saying so
  // in a sentence beats a foreign-key error arriving from the database.
  const { count } = await ctx.supabaseAdmin
    .from('winners').select('ticket_idx', { count: 'exact', head: true }).eq('prize_id', prizeId)
  if ((count ?? 0) > 0) {
    throw new ApiError('BAD_REQUEST',
      `The ${prize.tier} has been drawn ${count} time${count === 1 ? '' : 's'}, so it cannot be removed. ` +
      'Turn it off instead and it stays on the record.')
  }

  /*
  * TAKEN OFF THE SCHEDULE, not erased — and `removed_at` is a stronger thing
  * than the `active` flag beside it. active false is "not on offer this
  * raffle" and the organiser flips it back from the screen; this is the
  * schedule losing the prize. The refusal above already tells an organiser
  * "Turn it off instead and it stays on the record", which was advice the
  * alternative did not honour: the row went, and with it any record that this
  * raffle had once promised a Toyota Hilux.
  *
  * Nothing is re-used by accident. Prize ids come from newId(), so creating a
  * prize never lands on a removed one's key, and every read here carries
  * `removed_at is null`. winners.prize_id stays pointed at a row that still
  * exists, which is what `on delete restrict` was protecting and what a
  * forfeited winner's audit trail needs a year from now.
  */
  const { error } = await ctx.supabaseAdmin.from('prizes')
    .update({ removed_at: new Date().toISOString(), removed_by: user.email })
    .eq('prize_id', prizeId)
  if (error) throw refused(error)
  await log('REMOVE_PRIZE', { prize: prizeId, tier: prize.tier }, user, ctx)
  return { prizeId, removed: true }
}

/**
 * A new KIND of prize.
 *
 * Organisers, not just the owner. The alternative was a closed list in the
 * code, and the day somebody has an experience day or a goat to give away, a
 * closed list means a migration — which nobody running a raffle on a Saturday
 * morning can write. See prize_types in schema.sql for why the TYPES are open
 * and `valuing` is not.
 */
export async function upsertPrizeType(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const label = str(p.label)
  if (!label) throw new ApiError('MISSING_FIELD', 'What is this kind of prize called?')

  const valuing = str(p.valuing) || 'fixed'
  // Named rather than excluded. "Anything that is not X" is the shape that put
  // three defects in this repository in one day — supabase/AUDIT.md §X.
  if (!['fixed', 'percent', 'none'].includes(valuing)) {
    throw new ApiError('BAD_REQUEST',
      'A prize is worth a fixed amount, a share of what is collected, or nothing stated.')
  }

  const existing = str(p.typeId)
  if (existing) {
    const { data: was } = await ctx.supabaseAdmin
      .from('prize_types').select('*').eq('type_id', existing).maybeSingle()
    if (!was) throw new ApiError('NOT_FOUND', `There is no prize type called "${existing}".`, null, 404)
    const { error } = await ctx.supabaseAdmin.from('prize_types').update({
      label, valuing, sort: Math.floor(num(p.sort, was.sort)),
      active: p.active === undefined ? was.active : !!p.active,
    }).eq('type_id', existing)
    if (error) throw refused(error)
    await log('UPDATE_PRIZE_TYPE', { type: existing, label }, user, ctx)
    return { typeId: existing, label }
  }

  const typeId = await newId(label, 'prize_types', 'type_id', ctx)
  const { data: all } = await ctx.supabaseAdmin.from('prize_types').select('sort')
  const last = (all ?? []).reduce((m: number, r: Record<string, unknown>) =>
    Math.max(m, num(r.sort)), 0)
  const { error } = await ctx.supabaseAdmin.from('prize_types').insert({
    type_id: typeId, label, valuing, sort: last + 10, added_by: user.email,
  })
  if (error) throw refused(error)
  await log('ADD_PRIZE_TYPE', { type: typeId, label, valuing }, user, ctx)
  return { typeId, label }
}

/**
 * Where a winner has got to: told, collected, or out of time.
 *
 * THE COLUMNS EXISTED AND NOTHING COULD WRITE THEM. The draw screen has been
 * rendering "new / told / collected" pills since the beginning, off
 * `winners.notified` and `winners.claimed`, and no action on this backend ever
 * set either one. Every winner read "new" for ever, including the ones standing
 * there holding the hamper.
 */
export async function setWinnerStatus(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const number = str(p.ticketNumber)
  if (!number) throw new ApiError('MISSING_FIELD', 'Which winner?')

  const { data: t } = await ctx.supabaseAdmin
    .from('tickets').select('idx').eq('number', number).maybeSingle()
  if (!t) throw new ApiError('TICKET_NOT_FOUND', `Ticket ${number} does not exist.`, null, 404)

  const { data: w } = await ctx.supabaseAdmin
    .from('winners').select('*').eq('ticket_idx', t.idx).maybeSingle()
  if (!w) throw new ApiError('NOT_FOUND', `Ticket ${number} has not won anything.`, null, 404)

  const patch: Record<string, unknown> = {}
  if (p.notified !== undefined) patch.notified = !!p.notified
  if (p.claimed !== undefined) {
    patch.claimed = !!p.claimed
    // The DATE follows the flag rather than being sent alongside it, so the two
    // cannot disagree. Un-claiming clears it: a date left behind on a prize
    // nobody has collected is a date somebody will later read as proof.
    patch.claimed_at = p.claimed ? new Date().toISOString() : null
    // Collecting a prize is the opposite of forfeiting it. Leaving the older
    // mark in place would have the row saying both at once, and every count of
    // what is still to give would then depend on which column it happened to
    // read.
    if (p.claimed) patch.forfeited_at = null
  }
  if (p.forfeited !== undefined) {
    if (p.forfeited && w.claimed && p.claimed === undefined) {
      throw new ApiError('BAD_REQUEST',
        `${number} has already collected. Mark it as not collected first if that was wrong.`)
    }
    patch.forfeited_at = p.forfeited ? new Date().toISOString() : null
    if (p.forfeited) { patch.claimed = false; patch.claimed_at = null }
  }
  if (p.notes !== undefined) patch.notes = str(p.notes)
  if (!Object.keys(patch).length) {
    throw new ApiError('MISSING_FIELD', 'Nothing was changed.')
  }

  const { error } = await ctx.supabaseAdmin
    .from('winners').update(patch).eq('ticket_idx', t.idx)
  if (error) throw refused(error)

  await log('SET_WINNER_STATUS', { ticket: number, ...patch }, user, ctx)
  return { ticketNumber: number, ...patch }
}

// ============ SHARED ============

/*
 * A refusal from the database, passed through as itself.
 *
 * The two triggers on this schedule raise sentences written for the person
 * reading them — "There are 10 of the consolation to give, so there is no
 * number 11". Wrapping that in QUERY_FAILED throws away the only part anybody
 * can act on, and the screen then says the app is broken when what happened is
 * that the app worked.
 */
function refused(error: { message: string }) {
  const m = String(error.message)
  if (/duplicate key/i.test(m)) {
    return new ApiError('BAD_REQUEST', 'Somebody has just taken that one. Try again.')
  }
  if (/violates foreign key/i.test(m)) {
    return new ApiError('BAD_REQUEST', 'Something else still points at that, so it cannot be removed.')
  }
  // A trigger's own words, with the Postgres framing taken off the front.
  if (/^[A-Z]/.test(m) && !/relation|column|syntax/i.test(m)) {
    return new ApiError('BAD_REQUEST', m)
  }
  return new ApiError('QUERY_FAILED', m)
}

async function log(action: string, details: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  await ctx.supabaseAdmin.from('audit_log').insert({ action, details, email: user.email })
}

/**
 * The next free seat for a prize, and the reason `record_winner` does not
 * simply count.
 *
 * Two organisers recording winners in the same few seconds both read "7 given"
 * and both write the 8th. The unique index on (prize_id, seq) refuses the
 * second, this hands back the next number, and the caller tries again — so the
 * race ends in a correct 9th rather than a lost award or a silent overwrite.
 * The seats are read fresh each attempt for the same reason.
 */
export async function nextSeat(prizeId: string, ctx: Ctx) {
  const { data: prize } = await ctx.supabaseAdmin
    .from('prizes').select('quantity,tier,name,active,type_id,value_amount')
    .is('removed_at', null)
    .eq('prize_id', prizeId).maybeSingle()
  if (!prize) throw new ApiError('NOT_FOUND', `There is no prize called "${prizeId}".`, null, 404)
  if (!prize.active) {
    throw new ApiError('BAD_REQUEST', `The ${prize.tier} is not being offered.`)
  }

  const { data: held } = await ctx.supabaseAdmin
    .from('winners').select('seq,forfeited_at').eq('prize_id', prizeId)
  const taken = new Set((held ?? [])
    .filter((w: Record<string, unknown>) => !w.forfeited_at)
    .map((w: Record<string, unknown>) => Number(w.seq)))

  for (let s = 1; s <= prize.quantity; s++) if (!taken.has(s)) return { seat: s, prize }
  throw new ApiError('BAD_REQUEST',
    `All ${prize.quantity} of the ${prize.tier} have been given out.`)
}
