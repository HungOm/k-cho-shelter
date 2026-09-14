/**
 * K'Cho Shelter — the API, as a Supabase Edge Function.
 *
 * One function with an action router, mirroring Api.gs, so the port is a
 * translation rather than a redesign and the behaviour can be compared action
 * by action.
 *
 * THE ONE DELIBERATE CHANGE IN HOW SIGN-IN WORKS
 *
 * Apps Script verified a Google ID token by calling Google's tokeninfo endpoint
 * on every request — an outbound HTTP call, cached for five minutes, inside a
 * request that already cost a second. Here the caller presents a Supabase
 * session (Google is still the identity provider, through Supabase Auth), and
 * `auth: 'user'` verifies the JWT locally against the project's keys. No
 * outbound call, nothing to cache, nothing to go stale.
 *
 * What does NOT change is who gets in. The allowlist is still the users table,
 * still keyed by email, still checked on every request — so revoking somebody
 * still takes effect on their next action rather than at the next deploy. The
 * identity provider moved; the gate did not.
 *
 * Requires the frontend to sign in through Supabase Auth's Google provider
 * instead of Google Identity Services directly.
 */
import { withSupabase } from 'npm:@supabase/server'
import {
  ApiError,
  isActionAllowed,
  resolveUser,
  type ActionSpec,
  type AppUser,
  type Role,
} from './gate.ts'
import * as tickets from './tickets.ts'
import * as books from './books.ts'
import * as people from './people.ts'
import * as reports from './reports.ts'
import * as approvals from './approvals.ts'

// ============ ACTION REGISTRY ============
// Same shape as Api.gs. `roles: null` is any signed-in user, `[]` is admins and
// nobody else, and `sup` marks the four that cannot be handed to a role at all.

const ADMIN_ONLY: Role[] = []

const REGISTRY: Record<string, ActionSpec & { fn: Handler }> = {
  // --- reading ---
  whoami: { roles: null, kind: 'read', fn: whoami },
  read_version: { roles: null, kind: 'read', fn: readVersion },
  read_snapshot: { roles: null, kind: 'read', fn: readSnapshot },
  read_delta: { roles: null, kind: 'read', fn: readDelta },
  search: { roles: null, kind: 'read', fn: search },
  list_books: { roles: null, kind: 'read', fn: listBooks },
  read_audit: { roles: ADMIN_ONLY, sup: true, kind: 'read', fn: readAudit },

  // --- ticket writes ---
  // Roles copied from Api.gs exactly. gateparity.test.mjs is what keeps them
  // honest: it compares both gates over every action and role, so a value
  // mistyped here shows up as a disagreement rather than as a quiet
  // permission change nobody notices until somebody does something they
  // should not have been able to.
  sell_ticket: { roles: ['recorder', 'agent'], kind: 'write', fn: tickets.sellTicket },
  reserve_ticket: { roles: ['recorder', 'agent'], kind: 'write', fn: tickets.reserveTicket },
  release_ticket: { roles: ['recorder', 'agent'], kind: 'write', fn: tickets.releaseTicket },
  correct_ticket: { roles: ['recorder'], kind: 'write', fn: tickets.correctTicket },
  void_ticket: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: tickets.voidTicket },
  bulk_record_sales: { roles: ['recorder'], kind: 'bulk', fn: tickets.bulkRecordSales },
  sell_book: { roles: ['recorder', 'agent'], kind: 'bulk', fn: tickets.sellBook },

  // --- books ---
  issue_books: { roles: ADMIN_ONLY, kind: 'bulk', fn: books.issueBooks },
  transfer_books: { roles: ADMIN_ONLY, kind: 'bulk', fn: books.transferBooks },
  return_books: { roles: ADMIN_ONLY, kind: 'bulk', fn: books.returnBooks },
  settle_book: { roles: ADMIN_ONLY, kind: 'write', fn: books.settleBook },
  set_book_status: { roles: ADMIN_ONLY, kind: 'bulk', fn: books.setBookStatus },
  restock_books: { roles: ADMIN_ONLY, kind: 'bulk', fn: books.restockBooks },
  // Readable by anyone who can see the books at all. A history that only an
  // admin can open answers nobody's question — the person who needs to know
  // where a book went is usually the one holding the clipboard.
  book_history: { roles: null, kind: 'read', fn: books.bookHistory },

  // --- agents & users ---
  list_agents: { roles: null, kind: 'read', fn: people.listAgents },
  upsert_agent: { roles: ADMIN_ONLY, kind: 'write', fn: people.upsertAgent },
  list_users: { roles: ADMIN_ONLY, kind: 'read', fn: people.listUsers },
  upsert_user: { roles: ADMIN_ONLY, kind: 'write', fn: people.upsertUser },
  set_user_status: { roles: ADMIN_ONLY, kind: 'write', fn: people.setUserStatus },

  // --- who may do what ---
  list_permissions: { roles: ADMIN_ONLY, sup: true, kind: 'read', fn: people.listPermissions },
  set_permission: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setPermission },

  // --- how much of the raffle is live ---
  set_active_tickets: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setActiveTickets },
  handover_receipt: { roles: ADMIN_ONLY, kind: 'report', fn: people.handoverReceipt },
  expand_tickets: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.expandTickets },
  set_ticket_ceiling: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setTicketCeiling },

  // --- reports ---
  report_outstanding: { roles: ['viewer', 'recorder'], kind: 'report', fn: reports.reportOutstanding },
  report_overdue: { roles: ['recorder'], kind: 'report', fn: reports.reportOverdue },
  report_missing_contact: { roles: ['recorder'], kind: 'report', fn: reports.reportMissingContact },
  report_draw_ready: { roles: ['viewer', 'recorder'], kind: 'report', fn: reports.reportDrawReady },
  agent_statement: { roles: ['agent', 'recorder'], kind: 'report', fn: reports.agentStatement },
  export_entries: { roles: ADMIN_ONLY, sup: true, kind: 'report', fn: reports.exportEntries },

  // --- winners ---
  record_winner: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: reports.recordWinner },
  list_winners: { roles: ['viewer', 'recorder'], kind: 'read', fn: reports.listWinners },

  // --- two-person control ---
  request_approval: { roles: ADMIN_ONLY, kind: 'write', fn: approvals.requestApproval },
  list_approvals: { roles: ADMIN_ONLY, kind: 'read', fn: approvals.listApprovals },
  cancel_approval: { roles: ADMIN_ONLY, kind: 'write', fn: approvals.cancelApproval },
  decide_approval: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: decideApproval },
}

/**
 * Wrapped so the approved action runs through the registry rather than a second
 * copy of the dispatch. approvals.ts stays free of the registry, which would
 * otherwise be an import cycle, and an approved restock takes exactly the path
 * a direct restock takes.
 */
async function decideApproval(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  return approvals.decideApproval(
    p, user, ctx,
    (action, payload, asUser) => {
      const spec = REGISTRY[action]
      if (!spec) throw new ApiError('UNKNOWN_ACTION', `Unknown action: ${action}`, null, 404)
      return spec.fn(payload, asUser, ctx)
    },
    (action) => REGISTRY[action],
    (ctx as unknown as { _overrides?: Record<string, Partial<Record<Role, boolean>>> })._overrides ?? {},
  )
}

type Ctx = {
  supabase: { from: (t: string) => any }
  supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any }
  // The verified identity from the JWT. Named userClaims rather than user
  // because it is what the token asserts, not a row we looked up — the row is
  // the allowlist check below, and the two are deliberately separate.
  userClaims?: { id: string; email?: string; role?: string } | null
}
type Handler = (payload: Record<string, unknown>, user: AppUser, ctx: Ctx) => Promise<unknown>

// ============ HANDLERS ============
// Reads first. Each one is the Apps Script handler with its spreadsheet walk
// replaced by a query — the filtering that used to happen in JavaScript over
// every row now happens in the database over an index.

async function whoami(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const cfg = await readConfig(ctx)
  const generated = num(cfg.TOTAL_TICKETS, 0)
  const activeRaw = num(cfg.ACTIVE_TICKETS, 0)
  const active = activeRaw <= 0 || activeRaw > generated ? generated : activeRaw

  return {
    email: user.email,
    name: user.name,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    agentId: user.agentId,
    config: {
      ticketPrefix: cfg.TICKET_PREFIX ?? '',
      ticketDigits: num(cfg.TICKET_DIGITS, 5),
      ticketsPerBook: num(cfg.TICKETS_PER_BOOK, 10),
      totalTickets: active,            // what is in play — the number the app works in
      generatedTickets: generated,
      heldBackTickets: Math.max(0, generated - active),
      ticketCeiling: num(cfg.TICKET_CEILING, 0),
      ticketPrice: Number(cfg.TICKET_PRICE ?? 10),
      currency: cfg.CURRENCY ?? 'RM',
      eventName: cfg.EVENT_NAME ?? '',
      orgName: cfg.ORG_NAME ?? '',
      projectCode: cfg.PROJECT_CODE ?? '',
      drawDate: cfg.DRAW_DATE ?? '',
    },
  }
}

/**
 * The cheapest call in the system, and the one the client polls. In Apps Script
 * this read two Script Properties and still took 1.1 seconds. Here it is the
 * newest modified_at, which is an index lookup.
 */
async function readVersion(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data } = await ctx.supabaseAdmin
    .from('tickets')
    .select('modified_at')
    .order('modified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    tickets: data?.modified_at ?? null,
    serverTime: new Date().toISOString(),
  }
}

/**
 * Kept for the migration period only.
 *
 * Downloading every ticket is what the Sheet forced on us — search had to
 * happen in the browser because a spreadsheet cannot be queried. With `search`
 * below doing that work server-side this should go, and with it the 2.2 MB the
 * app currently pulls on every cold boot. It is here so the existing client
 * keeps working during the cutover, not because it is worth keeping.
 */
async function readSnapshot(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const limit = Math.min(int(p.limit, 1000), 1000)   // PostgREST caps at 1000
  const active = await activeTickets(ctx)

  // Keyset, not offset. OFFSET 19000 makes the database walk nineteen thousand
  // rows and throw them away, and it gets worse the further you page — measured
  // against this project, page one came back in ~115ms and page twenty in
  // ~280ms. Asking for "the rows after this index" is a lookup into the primary
  // key, so it stays flat: ~62ms at the same depth.
  //
  // The cursor is the last idx seen. It survives rows being inserted while
  // paging, which offset does not — with offset, a row added behind you shifts
  // everything and you silently see one twice or miss one entirely.
  // The client pages by OFFSET, and that is the contract both backends honour.
  // Here it costs nothing to honour it as a seek rather than a scan: ticket idx
  // is the ticket's position, dense from 1, and rows are generated once and
  // then only ever updated — never inserted between, never deleted. So "skip
  // the first N" and "the rows after idx N" select the same rows, and the
  // second is a primary-key lookup instead of walking N rows and discarding
  // them. Measured on this project: ~62ms at a depth where offset cost ~280ms.
  //
  // `cursor` is still accepted, because paged.js speaks it.
  const after = int(p.cursor, int(p.offset, 0))
  const holds = await agentBooks(user, ctx)

  let q = ctx.supabaseAdmin
    .from('tickets')
    .select(WIRE_SELECT)
    .lte('idx', active)
    .order('idx')
    .limit(limit)
  if (after > 0) q = q.gt('idx', after)

  const { data, error } = await q
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const rows = data ?? []
  const last = rows.length ? Number(rows[rows.length - 1].idx) : after
  const more = rows.length === limit && last < active

  return {
    fields: WIRE_FIELDS,
    rows: rows.map((r: Record<string, unknown>) => toWire(mask(r, user, holds))),
    offset: after,
    returned: rows.length,
    total: active,
    generated: await generatedTickets(ctx),
    // Null rather than absent, so a client can tell "no more pages" from
    // "the server forgot to tell me".
    nextCursor: more ? last : null,
    hasMore: more,
    version: String(last),
    serverTime: new Date().toISOString(),
  }
}

async function readDelta(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const since = String(p.since ?? '')
  if (!since || isNaN(Date.parse(since))) {
    throw new ApiError('BAD_REQUEST', 'read_delta needs a valid "since" timestamp.')
  }
  const active = await activeTickets(ctx)

  const holds = await agentBooks(user, ctx)
  const { data, error } = await ctx.supabaseAdmin
    .from('tickets')
    .select(WIRE_SELECT)
    .gt('modified_at', since)
    .lte('idx', active)
    .order('modified_at')
    .limit(1000)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Same shape as a snapshot page. A delta that spoke a different dialect would
  // work on first load and quietly break every incremental refresh after it.
  return {
    fields: WIRE_FIELDS,
    rows: (data ?? []).map((r: Record<string, unknown>) => toWire(mask(r, user, holds))),
    count: data?.length ?? 0,
    serverTime: new Date().toISOString(),
  }
}

/**
 * The action that makes the whole migration worth doing.
 *
 * The Sheet could not do this at all: the browser downloaded every ticket and
 * searched locally, which is why a cold boot costs 2.2 MB. Here it is one
 * indexed query, and a misspelled name still finds the person — the names in
 * this raffle are transliterated and inconsistently spelled, so Thang and
 * Thuang are the same person and exact matching is useless.
 */
async function search(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const q = String(p.q ?? '').trim()
  if (!q) return { rows: [], count: 0 }
  const limit = Math.min(int(p.limit, 50), 200)
  const active = await activeTickets(ctx)

  const holds = await agentBooks(user, ctx)
  const digits = q.replace(/\D/g, '')
  const cols = 'number,status,book_idx,buyer_name,buyer_phone,sold_by_agent,amount,sold_at,version,modified_at'

  let query = ctx.supabaseAdmin.from('tickets').select(cols).lte('idx', active).limit(limit)

  // A run of digits is a ticket number far more often than it is a phone
  // number, so both are tried rather than guessing which was meant.
  if (holds) {
    // Blanking the columns afterwards is not enough on its own: a match on a
    // name or a phone number would still tell the searcher that this person
    // bought a ticket, which is the very thing being protected. So a seller
    // searches by TICKET NUMBER only, over every ticket — availability stays
    // answerable, other people's buyers stay private.
    query = query.ilike('number', `%${digits || q}%`)
  } else {
    query = digits.length >= 3 && digits.length === q.replace(/[\s-]/g, '').length
      ? query.or(`number.ilike.%${digits}%,buyer_phone.ilike.%${digits}%`)
      : query.or(`buyer_name.ilike.%${q}%,number.ilike.%${q}%`)
  }

  const { data, error } = await query
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return {
    rows: (data ?? []).map((r: Record<string, unknown>) => mask(r, user, holds)),
    count: data?.length ?? 0,
  }
}

async function listBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  let query = ctx.supabaseAdmin.from('book_ledger').select('*').order('idx').limit(1000)
  if (p.status) query = query.eq('status', String(p.status))
  if (p.agentId) query = query.eq('held_by_agent', String(p.agentId))

  // A seller's book list is the books in their hands. Anything else is a wall
  // of two thousand squares that tells them nothing and costs them a download.
  if (user.role === 'agent') query = query.eq('held_by_agent', user.agentId ?? '\u0000')

  const { data, error } = await query
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return { books: data ?? [], total: data?.length ?? 0 }
}

async function readAudit(p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('audit_log').select('*').order('at', { ascending: false })
    .limit(Math.min(int(p.limit, 100), 500))
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  return { entries: data ?? [] }
}

// ============ SHARED ============

/**
 * Config, cached for the life of a warm instance.
 *
 * Worth doing because of what the first timings showed: the round trip to the
 * database is ~40ms, and a handler that reads config and then does its real
 * query pays that twice for a table of a dozen rows that changes a few times a
 * raffle. Halving the round trips is the difference between a search that feels
 * instant and one that does not.
 *
 * Thirty seconds, not longer, because ACTIVE_TICKETS is in here — releasing
 * more tickets has to take effect promptly, and the cost of being briefly stale
 * is one refused sale that succeeds on retry, not a wrong number anywhere.
 */
/**
 * Three small caches, each with a TTL chosen for what being stale would cost.
 *
 * Measured against the live project: a round trip to the database is 57-82ms,
 * and the gate was making TWO of them — the allowlist and the permissions
 * table — before the handler had done any work at all. On a read_version that
 * is the majority of the request.
 *
 * The TTLs are not arbitrary. Apps Script cached the same lookups for 60 and
 * 300 seconds with the reasoning written beside them, and those numbers were
 * chosen against the same trade-off: how long may a revoked account keep
 * working. Matching them keeps a promise the documentation already makes, and
 * inventing longer ones here would quietly break it.
 */
function ttlCache<T>(ttlMs: number) {
  const map = new Map<string, { at: number; value: T }>()
  return {
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = map.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return hit.value
      const value = await load()
      // Bounded, because an instance lives a long time and a key per email
      // would otherwise grow without limit.
      if (map.size > 200) map.clear()
      map.set(key, { at: Date.now(), value })
      return value
    },
  }
}

// 30s: ACTIVE_TICKETS lives here, and releasing tickets should take effect
// promptly. Being briefly stale costs one refused sale that succeeds on retry.
const configCache = ttlCache<Record<string, string>>(30_000)

// 60s, the same as Apps Script's USER_CACHE_TTL and for the same reason:
// disabling somebody has to take effect fast, and a minute is the promise the
// docs make.
const userCache = ttlCache<Record<string, unknown> | null>(60_000)

// 60s as well. The permissions table changes a few times in a raffle, but when
// it does it is usually because somebody is being locked out of something.
const permsCache = ttlCache<Record<string, Partial<Record<Role, boolean>>>>(60_000)

async function readConfig(ctx: Ctx): Promise<Record<string, string>> {
  return configCache.get('all', async () => {
    const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
    const out: Record<string, string> = {}
    for (const r of data ?? []) out[r.key] = r.value
    return out
  })
}

async function activeTickets(ctx: Ctx): Promise<number> {
  const cfg = await readConfig(ctx)
  const total = num(cfg.TOTAL_TICKETS, 0)
  const active = num(cfg.ACTIVE_TICKETS, 0)
  return active <= 0 || active > total ? total : active
}

/** Every ticket that exists, including any held back from the raffle. */
async function generatedTickets(ctx: Ctx): Promise<number> {
  return num((await readConfig(ctx)).TOTAL_TICKETS, 0)
}

/**
 * A view-only account never sees a full phone number. Applied on the way out,
 * per request — the same rule as Tickets.gs, and for the same reason: it
 * depends on who is asking, so it can never be computed once and shared.
 */
/**
 * The books one seller is physically carrying, as a set of book indexes.
 *
 * Cached for the life of the request: an agent reading twenty thousand tickets
 * must not cause twenty thousand lookups.
 */
async function agentBooks(user: AppUser, ctx: Ctx): Promise<Set<number> | null> {
  if (user.role !== 'agent' || !user.agentId) return null
  const { data } = await ctx.supabaseAdmin
    .from('books').select('idx').eq('held_by_agent', user.agentId)
  return new Set((data ?? []).map((b: { idx: number }) => b.idx))
}

/**
 * What each kind of user is allowed to see on a ticket row.
 *
 * A VIEWER gets the phone partly hidden, as before.
 *
 * An AGENT gets everything on the tickets in the books they are carrying —
 * they made those sales and have to be able to telephone those buyers — and
 * NOTHING PERSONAL on anybody else's. The number, the status and the book stay
 * visible so "is KS-1234 still going?" still has an answer, which is a question
 * sellers genuinely ask each other; the buyer's name, phone, area and any note
 * do not, because they are none of that seller's business.
 *
 * WHY THIS HAD TO BE WRITTEN TWICE. rls.sql already says exactly this, and says
 * it well — but RLS binds the CALLER's role, and every action in this file
 * reads through supabaseAdmin, which is the service key and outranks every
 * policy in the database. So the policies protect the client's direct PostgREST
 * reads and do nothing whatever for reads that come through this function. Any
 * narrowing the API path needs, the API path has to do itself.
 */
/**
 * THE TICKET WIRE CONTRACT, which both backends must satisfy exactly.
 *
 * A fields array plus rows as flat arrays, not objects. That is not a quirk of
 * the Sheet — it is why a snapshot is affordable: twenty thousand ticket
 * objects repeat all fifteen key names twenty thousand times, and the array
 * form does not. The client indexes rows against `fields`, so the ORDER here is
 * load-bearing and the names are the Sheet's, because the client's FIELD_MAP is
 * keyed on them.
 *
 * This function previously returned masked row OBJECTS with Postgres column
 * names, which the client could not read at all: it does fields.forEach on a
 * fields array that was not there, and threw on the first page. Every gate and
 * RLS test passed while the Supabase backend could not load a single ticket,
 * because those tests check the gate and the database and neither drives the
 * client. The lesson is the one that keeps recurring here: the thing that was
 * tested and the thing that runs were not the same thing.
 */
const WIRE_FIELDS = [
  'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
  'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
  'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date',
]

/** The columns to select so a row can be turned into the wire shape. */
const WIRE_SELECT =
  'idx,number,status,book_idx,books(number),buyer_name,buyer_phone,buyer_zone,' +
  'sold_by_agent,amount,payment_status,sold_at,notes,source,version,recorded_by,modified_at'

function toWire(r: Record<string, unknown>): unknown[] {
  // The book NUMBER, never the index: the client keys the grid, search and
  // "where is this ticket" by book number, and an integer there would render as
  // "book 41" in one place and "Book-041" in another.
  const book = (r.books ?? null) as { number?: string } | null
  return [
    r.number, r.status, book?.number ?? '', r.buyer_name, r.buyer_phone,
    r.buyer_zone, r.sold_by_agent, r.amount, r.payment_status, r.sold_at,
    r.notes, r.source, r.version, r.recorded_by, r.modified_at,
  ]
}

function mask(row: Record<string, unknown>, user: AppUser, holds?: Set<number> | null) {
  if (user.role === 'viewer') {
    // Same shape as the Apps Script masker, deliberately: two backends that
    // hide a phone number differently look like two different apps.
    const phone = String(row.buyer_phone ?? '')
    return {
      ...row,
      buyer_phone: phone ? (phone.length < 4 ? '\u2022\u2022\u2022\u2022' : '\u2022\u2022\u2022\u2022' + phone.slice(-3)) : '',
    }
  }

  if (holds && user.role === 'agent' && !holds.has(Number(row.book_idx))) {
    return { ...row, buyer_name: '', buyer_phone: '', buyer_zone: '', notes: '' }
  }

  return row
}

const num = (v: unknown, d: number) => {
  const n = parseInt(String(v ?? ''), 10)
  return isNaN(n) ? d : n
}
const int = (v: unknown, d: number) => num(v, d)

// ============ THE ROUTER ============

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx: Ctx) => {
    let body: { action?: string; payload?: Record<string, unknown> }
    try {
      body = await req.json()
    } catch {
      return fail(new ApiError('BAD_REQUEST', 'Request body could not be read.'))
    }

    const action = String(body.action ?? '')
    const spec = REGISTRY[action]
    if (!spec) return fail(new ApiError('UNKNOWN_ACTION', `Unknown action: ${action}`, null, 404))

    try {
      // The JWT is already verified by the time we get here; what it proves is
      // WHO is calling. Whether they may be here at all is the allowlist, which
      // is read fresh every request so revoking access takes effect at once.
      const email = String(ctx.userClaims?.email ?? '').trim().toLowerCase()
      if (!email) throw new ApiError('AUTH_REQUIRED', 'No signed-in user.', null, 401)

      const row = await userCache.get(email, async () => {
        const { data } = await ctx.supabaseAdmin
          .from('app_users').select('name,role,active,agent_id').eq('email', email).maybeSingle()
        return data ?? null
      })

      const user = resolveUser(email, row, Deno.env)

      const overrides = await permsCache.get('all', async () => {
        const { data } = await ctx.supabaseAdmin.from('permissions').select('action,role,allowed')
        const out: Record<string, Partial<Record<Role, boolean>>> = {}
        for (const p of data ?? []) (out[p.action] ??= {})[p.role as Role] = p.allowed
        return out
      })

      if (!isActionAllowed(action, spec, user, overrides)) {
        throw new ApiError('INSUFFICIENT_ROLE', 'This is not switched on for your account.', null, 403)
      }

      // Two-person control, checked before the action runs rather than after.
      // The super admin is exempt: they are the person who would approve it.
      if (!user.isSuperAdmin) {
        const needsTwo = await approvals.approvalNeeded(action, body.payload ?? {}, ctx)
        if (needsTwo) {
          throw new ApiError('APPROVAL_REQUIRED', needsTwo.text,
            { action, summary: needsTwo.text, detail: needsTwo }, 403)
        }
      }

      // Handed to decideApproval so an approved action is re-checked against
      // the same overrides this request was.
      ;(ctx as unknown as { _overrides?: unknown })._overrides = overrides

      const data = await spec.fn(body.payload ?? {}, user, ctx)
      return Response.json({ ok: true, data, serverTime: new Date().toISOString() })
    } catch (err) {
      return fail(err)
    }
  }),
}

function fail(err: unknown) {
  const e = err instanceof ApiError
    ? err
    : new ApiError('SERVER_ERROR', err instanceof Error ? err.message : String(err), null, 500)
  return Response.json(
    { ok: false, error: { code: e.code, message: e.message, details: e.details } },
    { status: e.status },
  )
}
