/*
 * FILLING A RAFFLE UP, FROM THE APP, BY THE SYSTEM ADMIN AND NOBODY ELSE.
 *
 * The other half of phase 7, and the mirror of reset.ts. Two actions:
 * `seed_preview` works out what would be made and hands back the sentence to
 * type; `seed_apply` checks everything again and then makes it.
 *
 * WHY THIS WRITES NO ROWS ITSELF. It calls the app's own actions — the same
 * upsertAgent an organiser uses to add a seller, the same expandTickets that
 * numbers a raffle, the same sellBook, the same recordPayment. Not one row here
 * is built by hand, and that is the whole design:
 *
 *   IT CANNOT INVENT AN IMPOSSIBLE RAFFLE. Every rule those handlers enforce —
 *   a book cannot go to two people, money is recorded by whoever received it,
 *   a book with sales on it cannot be handed on — applies to the seed as well.
 *   A fixture written straight into the tables would be free of all of them,
 *   and the first thing a demonstration would show is a state the app refuses
 *   to produce and cannot then act on.
 *
 *   IT STAYS TRUE. When the sale path gains a column, the seed gains it too. A
 *   second implementation of "what a sold book looks like" is a copy that goes
 *   quietly out of date, and this repository already has the scar: two lists of
 *   tables disagreed and the money journal survived a reset (tests/resetcovers).
 *
 *   AND IT IS WHY THIS FILE NAMES NO LEDGER. tests/custodyledger and
 *   tests/moneyjournal fail any handler that touches the custody ledger or the
 *   money journal. The seed never gets near them: it asks for a sale and a
 *   payment, and whoever owns those tables writes them.
 *
 * THE COST, SAID OUT LOUD: THIS IS NOT ONE TRANSACTION. The reset is — it has
 * to be, because a half-emptied raffle is a broken one. A half-filled raffle is
 * only a smaller one, and every row in it is a row the app itself made, so it
 * is consistent whatever step it stopped at. When a step fails, the seed stops,
 * reports what was made, and says that the reset takes it back out. Buying
 * atomicity here would cost the paragraph above, which is the more valuable of
 * the two.
 *
 * WHAT STOPS IT LANDING IN A LIVE RAFFLE — three counts, all stated positively,
 * because "everything except X" is the shape that put three defects in this
 * repository in one day (supabase/AUDIT.md §X):
 *
 *   1. NOTHING HAS BEEN PRINTED. A printed code is on paper in somebody's hand.
 *   2. EVERY SOLD TICKET WAS RECORDED BY THE SEED.
 *   3. EVERY PAYMENT WAS RECORDED BY THE SEED.
 *
 * Each names the set that is allowed to pass rather than the set to keep out,
 * and each is a count that must be zero of the rows OUTSIDE it. That is what
 * makes the seed re-runnable — fill the sellers today, the tickets tomorrow —
 * without the second run mistaking the first run's work for a person's.
 *
 * ARGUMENT ORDER IS (payload, user, ctx), see the Handler type in index.ts.
 * Writing it ctx-first compiles and runs and hands every handler the wrong
 * object; reset.ts has the full story.
 */
import { ApiError, type AppUser } from './gate.ts'
import {
  SEEDS,
  SEEDABLE,
  SEED_EMAIL,
  SIZES,
  SAMPLE_SELLERS,
  SAMPLE_BUYERS,
  SAMPLE_PRIZES,
  sellerPhone,
  seedPlanFor,
  sizeOf,
  tablesFor,
  type Size,
} from '../_shared/seedplan.ts'
import { FEATURES } from '../_shared/resetplan.ts'
import * as people from './people.ts'
import * as books from './books.ts'
import * as tickets from './tickets.ts'
import * as money from './money.ts'
import * as prizes from './prizes.ts'

// deno-lint-ignore no-explicit-any
type Ctx = { supabaseAdmin: any }

const nameOf = (id: string) => FEATURES.find((f) => f.id === id)?.name ?? id
const seedOf = (id: string) => SEEDS.find((s) => s.id === id)

/** Only the System Admin, and said in the words the screen uses. */
function onlySystemAdmin(user: AppUser) {
  if (!user.isSuperAdmin) {
    throw new ApiError('SUPER_ADMIN_ONLY',
      'Only the system admin can fill a raffle with sample data.', null, 403)
  }
}

/** What was ticked, cleaned of anything this action does not offer. */
function wanted(p: Record<string, unknown>): string[] {
  const raw = Array.isArray(p.features) ? p.features.map(String) : []
  return raw.filter((f) => SEEDABLE.includes(f))
}

async function countOf(ctx: Ctx, table: string): Promise<number> {
  const { count, error } = await ctx.supabaseAdmin
    .from(table).select('*', { count: 'exact', head: true })
  if (error) throw new ApiError('QUERY_FAILED', String(error.message ?? error))
  return Number(count ?? 0)
}

/*
 * HAS A PERSON USED THIS RAFFLE?
 *
 * Three questions, and each one is a count of the rows that fall OUTSIDE the
 * set allowed to be here. Zero means the claim holds.
 *
 * The seed's own rows carry SEED_EMAIL in `recorded_by` / `received_by`,
 * because every one of them was made by a handler called with that identity.
 * So a raffle the seed filled yesterday still answers yes to "may I seed", and
 * a raffle where one real sale was recorded answers no — which is the exact
 * line that matters, and it needs no column and no migration to draw.
 */
async function inUse(ctx: Ctx) {
  const outside = async (table: string, column: string, narrow?: (q: unknown) => unknown) => {
    let q = ctx.supabaseAdmin.from(table).select('*', { count: 'exact', head: true })
      .neq(column, SEED_EMAIL)
    if (narrow) q = narrow(q)
    const { count, error } = await q
    if (error) throw new ApiError('QUERY_FAILED', String(error.message ?? error))
    return Number(count ?? 0)
  }

  const { count: printedCount, error: printedError } = await ctx.supabaseAdmin
    .from('ticket_codes').select('*', { count: 'exact', head: true }).not('printed_at', 'is', null)
  if (printedError) throw new ApiError('QUERY_FAILED', String(printedError.message ?? printedError))

  const printed = Number(printedCount ?? 0)
  // deno-lint-ignore no-explicit-any
  const sold = await outside('tickets', 'recorded_by', (q: any) => q.eq('status', 'Sold'))
  const paid = await outside('payments', 'received_by')

  const why: string[] = []
  if (printed) {
    why.push(`${printed} ticket${printed === 1 ? ' has' : 's have'} been printed, so there is `
      + 'paper in circulation carrying this raffle\'s numbers.')
  }
  if (sold) {
    why.push(`${sold} ticket${sold === 1 ? ' was' : 's were'} sold by somebody, not by the seed.`)
  }
  if (paid) {
    why.push(`${paid} payment${paid === 1 ? ' was' : 's were'} recorded by somebody, not by the seed.`)
  }
  return { printed, sold, paid, inUse: why.length > 0, why }
}

/*
 * THE SENTENCE, and it is honestly a smaller ceremony than the reset's.
 *
 * The reset's phrase carries counts read off the rows that are actually there,
 * so it cannot be learned in advance and cannot be typed without having looked
 * at what is about to go. The seed's counts come from the size somebody picked,
 * which is printed on the screen beside the box — so this one CAN be learned,
 * and pretending otherwise would be theatre.
 *
 * It is here anyway, for the thing it can still do: it is a deliberate act.
 * Sample sellers and sample money landing in a raffle by a misplaced click is
 * the failure to prevent, and a line that has to be typed prevents exactly
 * that. The guard that does the real work is `inUse` above.
 */
export function seedPhrase(makes: Record<string, number>): string {
  const rows = Object.entries(makes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
  if (!rows.length) return 'NOTHING TO FILL'
  const said = rows.map(([t, n]) => `${n} ${t.replace(/_/g, ' ').toUpperCase()}`)
  return `FILL ${said.join(' AND ')}`
}

/*
 * HOW MANY OF EACH, given a size and what this raffle's settings say.
 *
 * The declared figures are ceilings. TICKETS_PER_BOOK belongs to the raffle,
 * not to us, so "20 books out" against books of 25 tickets means something
 * different from books of 10 — and a raffle whose settings make the sizes
 * impossible gets fewer rather than an error.
 */
function makesFor(size: Size, features: string[], per: number) {
  const bookCount = Math.max(1, Math.ceil(size.tickets / Math.max(1, per)))
  const issued = features.includes('tickets') ? Math.min(size.issued, bookCount) : 0
  const sold = features.includes('tickets') ? Math.min(size.sold, issued) : 0

  const makes: Record<string, number> = {}
  if (features.includes('sellers')) {
    makes.agents = Math.min(size.sellers, SAMPLE_SELLERS.length)
  }
  if (features.includes('tickets')) {
    makes.tickets = size.tickets
    makes.books = bookCount
  }
  if (features.includes('money')) {
    makes.payments = Math.min(size.payments, Math.min(size.sellers, SAMPLE_SELLERS.length))
  }
  if (features.includes('prizes')) makes.prizes = SAMPLE_PRIZES.length
  return { makes, bookCount, issued, sold }
}

type Assessed = Awaited<ReturnType<typeof assess>>

async function assess(ctx: Ctx, asked: string[], sizeId: string) {
  const plan = seedPlanFor(asked)
  const size = sizeOf(sizeId)
  const used = await inUse(ctx)

  /*
   * A FEATURE THAT ALREADY HAS ROWS IS NOT FILLED, AND STILL COUNTS AS THERE.
   *
   * These are two different answers and collapsing them was the first thing
   * that went wrong here. Somebody who generated their tickets by hand and then
   * wants sample sellers and sample money should get them: the tickets are
   * already present, which is what `money` needed — it needed them to EXIST,
   * not to be made by us. So a non-empty feature is dropped from the filling
   * and kept as a satisfied requirement, and only a requirement that is neither
   * is a refusal.
   */
  const has: Record<string, number> = {}
  for (const t of tablesFor(plan.features)) has[t] = await countOf(ctx, t)

  const already: { id: string; name: string; rows: number }[] = []
  const fill: string[] = []
  for (const id of plan.features) {
    const rows = (seedOf(id)?.writes ?? []).reduce((n, t) => n + (has[t] ?? 0), 0)
    if (rows > 0) already.push({ id, name: nameOf(id), rows })
    else fill.push(id)
  }

  /* Numbering belongs to the raffle. Read, never assumed. */
  const { data: cfgRows } = await ctx.supabaseAdmin.from('config').select('key,value')
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[String(r.key)] = String(r.value ?? '')
  const per = parseInt(cfg.TICKETS_PER_BOOK ?? '', 10) || 10
  const price = Number(cfg.TICKET_PRICE ?? 0) || 0

  const { makes, bookCount, issued, sold } = makesFor(size, fill, per)
  const total = Object.values(makes).reduce((a, b) => a + b, 0)

  return {
    plan, size, used, has, already, fill,
    per, price, bookCount, issued, sold,
    makes, total, phrase: seedPhrase(makes),
  }
}

/**
 * What would be made, without anything being made.
 *
 * Registered as a WRITE although it only counts — the reason templates.ts gives
 * and reset.ts repeats: registering a read as a write is the only way to say
 * this one cannot be handed to another role from the Access screen.
 */
export async function seedPreview(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  onlySystemAdmin(user)
  const a = await assess(ctx, wanted(p), String(p.size ?? ''))

  return {
    /* Everything offerable, so the screen is built from the server's list and
     * cannot drift from what the server will accept. */
    features: SEEDS.map((s) => ({
      id: s.id,
      name: nameOf(s.id),
      makes: s.makes,
      offered: !s.never,
      never: s.never ?? '',
    })),
    sizes: SIZES.map((s) => ({ id: s.id, name: s.name, tickets: s.tickets, sellers: s.sellers })),
    size: a.size.id,
    asked: a.plan.features,
    willFill: a.fill.map((id) => ({ id, name: nameOf(id), makes: seedOf(id)?.makes ?? '' })),
    already: a.already,
    added: a.plan.added.map((x) => ({ id: x.feature, name: nameOf(x.feature), why: x.why })),
    refused: a.plan.refused.map((r) => ({ id: r.feature, name: nameOf(r.feature), why: r.why })),
    inUse: a.used.inUse,
    inUseWhy: a.used.why,
    makes: a.makes,
    total: a.total,
    phrase: a.phrase,
  }
}

/*
 * The identity every seeded row is attributed to.
 *
 * IT IS A LABEL AND NOT A PRIVILEGE. The authorisation happened once, at the
 * top of seedApply, against the real signed-in caller; this copies that
 * caller's decided rights and changes only the name written into the rows. It
 * cannot grant anything the caller did not already have — `isSuperAdmin` and
 * `role` come across untouched — and the audit row for the seed itself names
 * the real person, so "who ran this" and "what made this row" are both
 * answerable and are different questions.
 */
const asSeed = (user: AppUser): AppUser => ({ ...user, email: SEED_EMAIL })

/**
 * Make it.
 *
 * Everything is derived again rather than trusted from the preview: the caller
 * sends what they ticked, the size and what they typed, and nothing else they
 * send is used.
 */
export async function seedApply(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  onlySystemAdmin(user)
  const asked = wanted(p)
  if (!asked.length) {
    throw new ApiError('NOTHING_SELECTED', 'Nothing was chosen to fill.', null, 400)
  }

  const a = await assess(ctx, asked, String(p.size ?? ''))

  if (a.used.inUse) {
    throw new ApiError('RAFFLE_IN_USE',
      'This raffle is in use, so sample data cannot be added to it. ' + a.used.why.join(' '),
      { why: a.used.why, printed: a.used.printed, sold: a.used.sold, paid: a.used.paid }, 409)
  }
  if (!a.fill.length) {
    throw new ApiError('NOTHING_TO_FILL',
      'Everything you chose already has something in it, so there is nothing to fill.',
      { already: a.already }, 400)
  }

  const typed = String(p.phrase ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (typed !== a.phrase) {
    throw new ApiError('CONFIRM_MISMATCH',
      `Type exactly: ${a.phrase}`, { phrase: a.phrase, makes: a.makes }, 400)
  }

  const seed = asSeed(user)
  const done: { what: string; count: number }[] = []
  const note = (what: string, count: number) => { if (count) done.push({ what, count }) }

  try {
    return await run(ctx, a, seed, user, done, note)
  } catch (e) {
    /*
     * STOPPED PART WAY, AND THAT IS A SENTENCE RATHER THAN A SILENCE.
     *
     * Nothing is rolled back, because nothing can be: every row was made by a
     * separate action that has already committed. Each of those rows is a row
     * the app itself made, so what is there is consistent — it is simply less
     * than was asked for. Saying what got in, and that the reset removes it, is
     * the whole remedy and it is an adequate one.
     */
    const why = e instanceof ApiError ? e.message : String((e as Error)?.message ?? e)
    throw new ApiError('SEED_FAILED',
      `Filled ${done.map((d) => `${d.count} ${d.what}`).join(', ') || 'nothing'}, then stopped: `
      + `${why} Nothing is undone — what was made is in the raffle, and "Reset this raffle" `
      + 'takes it back out.',
      { done, cause: e instanceof ApiError ? e.code : 'QUERY_FAILED' }, 409)
  }
}

/*
 * THE SCRIPT ITSELF, in the order a raffle actually happens: people, then
 * paper, then paper going out, then paper being sold, then money coming back.
 *
 * It reads as a sequence of days because that is what it is making. Anything
 * that reads the database mid-run reads it fresh rather than assuming what the
 * step before produced — `issueBooks` may have been given fewer books than
 * asked for, and a count carried forward in a variable is a count that stops
 * being true the first time a handler exercises its own judgement.
 */
async function run(
  ctx: Ctx, a: Assessed, seed: AppUser, real: AppUser,
  done: { what: string; count: number }[],
  note: (what: string, count: number) => void,
) {
  /* ---- the sellers ---- */
  let sellerIds: string[] = []
  if (a.fill.includes('sellers')) {
    const n = Math.min(a.size.sellers, SAMPLE_SELLERS.length)
    for (let i = 0; i < n; i++) {
      const s = SAMPLE_SELLERS[i]
      const r = await people.upsertAgent(
        { name: s.name, zone: s.zone, phone: sellerPhone(i) }, seed, ctx,
      ) as { agentId: string }
      sellerIds.push(r.agentId)
    }
    note('sellers', sellerIds.length)
  }
  if (!sellerIds.length) {
    /* Either they were already there or they were not asked for. Either way the
     * steps below need to know who is carrying books. */
    const { data } = await ctx.supabaseAdmin
      .from('agents').select('agent_id').eq('active', true).order('agent_id')
    sellerIds = (data ?? []).map((r: { agent_id: string }) => String(r.agent_id))
  }

  /* ---- the tickets, numbered the way this raffle says ---- */
  if (a.fill.includes('tickets')) {
    await people.expandTickets({ totalTickets: a.size.tickets, dryRun: false }, seed, ctx)
    note('tickets', a.size.tickets)

    const { data: made } = await ctx.supabaseAdmin
      .from('books').select('number').order('idx').limit(a.issued)
    const numbers = (made ?? []).map((b: { number: string }) => String(b.number))

    /*
     * OUT WITH SELLERS. Round robin rather than in blocks: a raffle where the
     * first seller holds books 1-5 and the second holds 6-10 makes every
     * ordered list look sorted by person, and hides the thing the custody
     * column is for.
     */
    if (sellerIds.length && numbers.length) {
      const toEach = new Map<string, string[]>()
      numbers.forEach((num, i) => {
        const who = sellerIds[i % sellerIds.length]
        toEach.set(who, [...(toEach.get(who) ?? []), num])
      })
      let out = 0
      for (const [agentId, bookNumbers] of toEach) {
        await books.issueBooks({ agentId, bookNumbers }, seed, ctx)
        out += bookNumbers.length
      }
      note('books out with sellers', out)

      /*
       * AND SOME OF THEM SOLD THROUGH. Whole books, because that is what
       * sellBook is for and because a raffle in flight has books at every
       * stage — this leaves some untouched, which is the state the chase list
       * and the reconciliation table are both about.
       */
      let sold = 0
      const holders = [...toEach.entries()]
      for (let i = 0; i < a.sold && i < numbers.length; i++) {
        const [agentId, theirs] = holders[i % holders.length]
        const book = theirs[Math.floor(i / holders.length)]
        if (!book) continue
        const buyer = SAMPLE_BUYERS[i % SAMPLE_BUYERS.length]
        /* A buyer needs a phone, and sellBook says why: without one you cannot
         * tell them if they win. The seed found that out by being refused,
         * which is the behaviour working. */
        await tickets.sellBook(
          { bookNumbers: [book], buyerName: buyer.name, buyerPhone: buyer.phone, soldBy: agentId },
          seed, ctx,
        )
        sold++
      }
      note('books sold through', sold)
    }
  }

  /* ---- money handed back in ---- */
  if (a.fill.includes('money')) {
    /*
     * PAID AGAINST WHAT THEY ACTUALLY SOLD, read from the ledger rather than
     * worked out from what this function just did. The two would agree today
     * and stop agreeing the first time a handler declines something.
     *
     * Some pay in full and some pay half, on purpose: a demonstration where
     * every seller is square shows an outstanding column of zeroes, and the
     * outstanding column is the most important number on that screen.
     */
    const { data: rows } = await ctx.supabaseAdmin
      .from('tickets').select('sold_by_agent,amount').eq('status', 'Sold')
    const owed = new Map<string, number>()
    for (const r of rows ?? []) {
      const who = String((r as { sold_by_agent: string | null }).sold_by_agent ?? '')
      if (!who) continue
      const amt = Number((r as { amount: number | null }).amount ?? 0) || a.price
      owed.set(who, (owed.get(who) ?? 0) + amt)
    }

    let paid = 0
    const payers = [...owed.entries()].sort((x, y) => x[0].localeCompare(y[0]))
    for (let i = 0; i < payers.length && paid < a.size.payments; i++) {
      const [agentId, total] = payers[i]
      const amount = i % 3 === 2 ? Math.round(total / 2) : total
      if (amount <= 0) continue
      await money.recordPayment(
        { agentId, amount, method: 'cash', note: 'Sample data' }, seed, ctx,
      )
      paid++
    }
    note('payments', paid)
  }

  /* ---- the prize list ---- */
  if (a.fill.includes('prizes')) {
    let n = 0
    for (let i = 0; i < SAMPLE_PRIZES.length; i++) {
      const z = SAMPLE_PRIZES[i]
      await prizes.upsertPrize({
        tier: z.tier, name: z.name, typeId: z.typeId,
        quantity: z.quantity, value: z.value, rank: i + 1,
      }, seed, ctx)
      n++
    }
    note('prizes', n)
  }

  /*
   * THE AUDIT ROW NAMES THE PERSON, not the seed. The rows carry SEED_EMAIL so
   * the guard above can tell them from a person's; this row answers the other
   * question, which is who decided.
   */
  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'RAFFLE_SEEDED',
    details: { size: a.size.id, features: a.fill, made: done },
    email: real.email,
  })

  return {
    filled: a.fill.map((id) => ({ id, name: nameOf(id) })),
    made: done,
    size: a.size.id,
    skipped: a.already,
  }
}
