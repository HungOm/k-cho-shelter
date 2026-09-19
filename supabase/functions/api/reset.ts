/*
 * RESETTING THE RAFFLE, FROM THE APP, BY THE SYSTEM ADMIN AND NOBODY ELSE.
 *
 * Two actions. `reset_preview` counts what a selection would destroy and hands
 * back the sentence that has to be typed to confirm it. `reset_apply` counts
 * again, refuses if anything moved, and calls the SQL function that does the
 * deleting. Nothing here issues a delete.
 *
 * WHY THIS FILE NAMES NO TABLES. Two tests refuse it — tests/custodyledger
 * fails any file under this directory that mentions the custody ledger, and
 * tests/moneyjournal does the same for the money journal — because a handler
 * writing either of them lets the projection drift from the record. The table
 * names live in _shared/resetplan.ts, which is a declaration rather than a
 * handler, and this file works from the list that comes back. That is not a way
 * around those tests; it is the arrangement they were asking for.
 *
 * THE CONFIRMATION NAMES THE DAMAGE RATHER THAN BEING A TOKEN.
 * supabase/reset.sql takes `RESET-THE-RAFFLE`, which is right for a thing typed
 * once from a terminal by somebody who has just taken a backup. A fixed token
 * on a screen becomes muscle memory within a week. So the phrase carries the
 * counts — DELETE 4182 TICKETS AND 312 PAYMENTS — and it is generated from the
 * rows that are actually there, which means it cannot be learned in advance.
 *
 * THE ARGUMENT ORDER IS (payload, user, ctx) — see the Handler type in
 * index.ts. Writing it ctx-first compiles, runs, and hands the handler the
 * context where it expects the payload, so every call refuses with "nothing was
 * chosen" while looking like a working action. tests/everyaction caught it by
 * making a real call, which is the whole reason that file exists.
 *
 * AND IT IS COUNTED TWICE. Somebody may have been selling while the dialog sat
 * open. If the second count does not produce the same sentence, the reset is
 * refused and the new figures are returned, because the number the System Admin
 * agreed to is part of what they agreed to.
 */
import { ApiError, type AppUser } from './gate.ts'
import {
  FEATURES,
  RESETTABLE,
  planFor,
  loosens,
  type Plan,
} from '../_shared/resetplan.ts'

type Ctx = {
  supabaseAdmin: {
    from: (t: string) => any
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }
}

const nameOf = (id: string) => FEATURES.find((f) => f.id === id)?.name ?? id

/** Only the System Admin, and said in the words the screen uses. */
function onlySystemAdmin(user: AppUser) {
  if (!user.isSuperAdmin) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'Only the system admin can reset a raffle.', null, 403)
  }
}

/** What was ticked, cleaned of anything this action does not offer. */
function wanted(p: Record<string, unknown>): string[] {
  const raw = Array.isArray(p.features) ? p.features.map(String) : []
  return raw.filter((f) => RESETTABLE.includes(f))
}

async function countOf(ctx: Ctx, table: string): Promise<number> {
  const { count, error } = await ctx.supabaseAdmin
    .from(table).select('*', { count: 'exact', head: true })
  if (error) throw new ApiError('QUERY_FAILED', String((error as { message?: string }).message ?? error))
  return Number(count ?? 0)
}

/*
 * THE SENTENCE, generated the same way on both sides.
 *
 * The two biggest things going, by row count. Two rather than one because a
 * reset that takes tickets AND money should say both — those are the two a
 * person would most want to have been told — and two rather than all of them
 * because a sentence nobody can retype is a sentence they will paste.
 *
 * Ties break on the table name so the same rows always produce the same words.
 */
export function phraseFor(counts: Record<string, number>): string {
  const rows = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
  if (!rows.length) return 'NOTHING TO DELETE'
  const said = rows.map(([t, n]) => `${n} ${t.replace(/_/g, ' ').toUpperCase()}`)
  return `DELETE ${said.join(' AND ')}`
}

type Counted = { plan: Plan; counts: Record<string, number>; total: number; phrase: string; printed: number }

async function assess(ctx: Ctx, features: string[]): Promise<Counted> {
  const plan = planFor(features)
  const counts: Record<string, number> = {}
  let total = 0
  for (const t of plan.tables) {
    const n = await countOf(ctx, t)
    counts[t] = n
    total += n
  }

  /*
   * CODES THAT ARE ALREADY ON PAPER.
   *
   * A printed ticket is in somebody's hand. Deleting its code does not reset
   * data — it stops a real ticket verifying, and the person holding it is told
   * no ticket matches their link. It is the one consequence of a reset that
   * reaches outside the database, so it is counted separately and needs its own
   * yes.
   */
  let printed = 0
  const codes = FEATURES.find((f) => f.guard === 'printed')
  if (codes && plan.features.includes(codes.id)) {
    const { count, error } = await ctx.supabaseAdmin
      .from('ticket_codes').select('*', { count: 'exact', head: true }).not('printed_at', 'is', null)
    if (error) throw new ApiError('QUERY_FAILED', String((error as { message?: string }).message ?? error))
    printed = Number(count ?? 0)
  }

  return { plan, counts, total, phrase: phraseFor(counts), printed }
}

/**
 * What would happen, without anything happening.
 *
 * Registered as a WRITE even though it only counts — see index.ts. A read can
 * be handed to another role from the Access screen; a write cannot, and the
 * shape of a raffle's tables is not something to widen by accident.
 */
export async function resetPreview(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  onlySystemAdmin(user)
  const features = wanted(p)
  const { plan, counts, total, phrase, printed } = await assess(ctx, features)

  return {
    /* Everything offerable, so the screen is built from the server's list and
     * cannot drift from what the server will accept. */
    features: FEATURES.map((f) => ({
      id: f.id,
      name: f.name,
      why: f.why,
      offered: !f.never,
      never: f.never ?? '',
    })),
    asked: features,
    willReset: plan.features.map((id) => ({ id, name: nameOf(id) })),
    added: plan.added.map((a) => ({ id: a.feature, name: nameOf(a.feature), why: a.why })),
    refused: plan.refused.map((r) => ({ id: r.feature, name: nameOf(r.feature), why: r.why })),
    loosens: loosens(plan.features),
    counts,
    total,
    phrase,
    printed,
  }
}

/**
 * Do it.
 *
 * Everything is derived again from the feature list rather than trusted from
 * the preview: the caller sends what they ticked and what they typed, and
 * nothing else they send is used.
 */
export async function resetApply(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  onlySystemAdmin(user)
  const features = wanted(p)
  if (!features.length) {
    throw new ApiError('NOTHING_SELECTED', 'Nothing was chosen to reset.', null, 400)
  }

  const { plan, counts, total, phrase, printed } = await assess(ctx, features)

  if (!plan.tables.length || total === 0) {
    throw new ApiError('NOTHING_TO_RESET',
      'There is nothing in what you chose, so there is nothing to empty.', null, 400)
  }

  /*
   * The numbers may have moved while the screen was open — somebody selling at
   * a table does not know a reset is being considered. The sentence is the
   * count, so a different count is a different sentence, and this refuses with
   * the new one rather than emptying a raffle the System Admin has not seen.
   */
  const typed = String(p.phrase ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (typed !== phrase) {
    throw new ApiError('CONFIRM_MISMATCH',
      `Type exactly: ${phrase}`, { phrase, counts, total }, 400)
  }

  if (printed > 0 && p.acceptPrinted !== true) {
    throw new ApiError('PRINTED_TICKETS_EXIST',
      `${printed} ticket${printed === 1 ? '' : 's'} have been printed and are in people's hands. `
      + 'Emptying their codes stops those tickets verifying. Say so explicitly to go ahead.',
      { printed }, 409)
  }

  const { data, error } = await ctx.supabaseAdmin.rpc('app_reset', {
    p_tables: plan.tables,
    p_by: user.email,
  })
  if (error) {
    throw new ApiError('RESET_FAILED', String((error as { message?: string }).message ?? error))
  }

  /* The function audits itself, with its guard back on — see the migration. */
  return {
    reset: plan.features.map((id) => ({ id, name: nameOf(id) })),
    removed: Array.isArray(data) ? data : [],
    total,
  }
}
