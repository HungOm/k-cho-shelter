/**
 * Raffled — the API, as a Supabase Edge Function.
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
  LOCKED_FOR_ADMIN,
  resolveUser,
  ROLES,
  type ActionSpec,
  type AppUser,
  type Role,
} from './gate.ts'
import * as tickets from './tickets.ts'
import * as books from './books.ts'
import * as deadlines from './deadlines.ts'
import { dayStart, today } from './deadlines.ts'
import * as people from './people.ts'
import * as reports from './reports.ts'
import * as approvals from './approvals.ts'

// ============ ACTION REGISTRY ============
// Same shape as Api.gs. `roles: null` is any signed-in user, `[]` is admins and
// nobody else, and `sup` marks the four that cannot be handed to a role at all.

const ADMIN_ONLY: Role[] = []

/**
 * What each action is CALLED on the Access screen.
 *
 * Lifted from actionMeta() in Api.gs rather than reworded, so the same screen
 * reads identically whichever backend answered. Two vocabularies for one action
 * is how an organiser ends up unsure whether they just changed the same thing
 * twice or two different things once.
 */
/**
 * Who can do what, as the Access screen reads it.
 *
 * Returns { roles, actions } — the same shape as handleListPermissions in
 * Auth.gs, because the same Vue component renders both. This previously
 * returned { roles, overrides }: the raw override rows and no actions list at
 * all, so the screen did data.actions.length on undefined and rendered nothing
 * but a blank panel with a console error. A payload that is merely DIFFERENT
 * rather than wrong is the hardest kind to spot from the server side, because
 * every test of it passes.
 */
function listPermissions(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  return buildPermissions(ctx)
}

async function buildPermissions(ctx: Ctx) {
  const { data } = await ctx.supabaseAdmin.from('permissions').select('action,role,allowed')
  const table: Record<string, Record<string, boolean>> = {}
  for (const r of data ?? []) (table[String(r.action)] ??= {})[String(r.role)] = !!r.allowed

  // The same rule as defaultAllows_ in Auth.gs: a super-admin-only action is
  // never available to a role, an unrestricted one always is, and an admin
  // passes every registry default.
  const defaultAllows = (spec: ActionSpec, role: Role) => {
    if (spec.sup) return false
    if (!spec.roles) return true
    if (role === 'admin') return true
    return spec.roles.includes(role)
  }

  const actions = Object.entries(REGISTRY).map(([action, spec]) => {
    const m = ACTION_META[action] ?? {}
    const defaults: Record<string, boolean> = {}
    const current: Record<string, boolean> = {}
    for (const role of ROLES) {
      const def = defaultAllows(spec, role)
      defaults[role] = def
      const override = table[action]?.[role]
      // A super-admin-only action cannot be handed to a role by an override —
      // otherwise the screen would offer a switch that grants what the gate
      // refuses, and the gate is the one that decides.
      current[role] = spec.sup ? false : (override === undefined ? def : override)
    }
    return {
      action,
      group: m.group ?? 'Other',
      label: m.label ?? action,
      danger: !!m.danger,
      sup: !!spec.sup,
      lockedFor: LOCKED_FOR_ADMIN.includes(action) ? ['admin'] : [],
      defaults,
      current,
    }
  })

  actions.sort((a, b) =>
    a.group === b.group ? (a.label < b.label ? -1 : 1) : (a.group < b.group ? -1 : 1))

  return { roles: ROLES, actions }
}

const ACTION_META: Record<string, { group: string; label: string; danger?: boolean }> = {
  whoami: { group: 'Basics', label: 'Sign in' },
  read_snapshot: { group: 'Basics', label: 'Load the tickets' },
  read_delta: { group: 'Basics', label: 'Load what changed' },
  read_version: { group: 'Basics', label: 'Check for changes' },
  sell_ticket: { group: 'Tickets', label: 'Record a sale' },
  reserve_ticket: { group: 'Tickets', label: 'Hold a ticket' },
  release_ticket: { group: 'Tickets', label: 'Let a held ticket go' },
  correct_ticket: { group: 'Tickets', label: 'Correct a sale', danger: true },
  void_ticket: { group: 'Tickets', label: 'Void a ticket', danger: true },
  bulk_record_sales: { group: 'Tickets', label: 'Record many sales at once' },
  sell_book: { group: 'Tickets', label: 'Sell a whole book to one buyer' },
  list_books: { group: 'Books', label: 'See the books' },
  issue_books: { group: 'Books', label: 'Give books to a seller' },
  transfer_books: { group: 'Books', label: 'Move books between sellers' },
  return_books: { group: 'Books', label: 'Take books back' },
  set_book_status: { group: 'Books', label: 'Mark a book lost, or reopen it', danger: true },
  restock_books: { group: 'Books', label: 'Put unsold tickets back', danger: true },
  book_history: { group: 'Books', label: 'See where a book has been' },
  handover_receipt: { group: 'Books', label: 'Print a handover receipt' },
  expand_tickets: { group: 'Books', label: 'Make more tickets', danger: true },
  set_active_tickets: { group: 'Books', label: 'Change how many tickets are in play', danger: true },
  set_ticket_ceiling: { group: 'Books', label: 'Change the planned size of the raffle' },
  deadline_status: { group: 'Books', label: 'See the check-in and final dates' },
  roll_check_in: { group: 'Books', label: 'Move the check-in date on a month', danger: true },
  record_check_in: { group: 'Books', label: 'Record that a seller has reported' },
  set_final_deadline: { group: 'Books', label: 'Change the final deadline', danger: true },
  settle_book: { group: 'Money', label: 'Settle a book', danger: true },
  report_outstanding: { group: 'Money', label: 'Who still owes money' },
  list_agents: { group: 'People', label: 'See the sellers' },
  upsert_agent: { group: 'People', label: 'Add or change a seller' },
  list_users: { group: 'People', label: 'See who can sign in' },
  upsert_user: { group: 'People', label: 'Add or change a user' },
  set_user_status: { group: 'People', label: 'Turn an account on or off', danger: true },
  report_overdue: { group: 'Reports', label: 'Books that are late' },
  report_missing_contact: { group: 'Reports', label: 'Tickets with no phone number' },
  report_draw_ready: { group: 'Reports', label: 'Is the draw ready' },
  export_entries: { group: 'Reports', label: 'Download the entry list', danger: true },
  read_audit: { group: 'Reports', label: 'The activity log' },
  record_winner: { group: 'Reports', label: 'Record a winner', danger: true },
  list_winners: { group: 'Reports', label: 'See the winners' },
  list_permissions: { group: 'Access', label: 'See who can do what' },
  request_approval: { group: 'Access', label: 'Ask the organiser to approve something' },
  list_approvals: { group: 'Access', label: 'See what is waiting for approval' },
  cancel_approval: { group: 'Access', label: 'Withdraw your own request' },
  decide_approval: { group: 'Access', label: 'Approve or refuse a request', danger: true },
  set_permission: { group: 'Access', label: 'Change who can do what', danger: true },
}

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
  list_permissions: { roles: ADMIN_ONLY, sup: true, kind: 'read', fn: listPermissions },
  set_permission: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setPermission },

  // --- how much of the raffle is live ---
  set_active_tickets: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setActiveTickets },
  handover_receipt: { roles: ADMIN_ONLY, kind: 'report', fn: people.handoverReceipt },
  expand_tickets: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.expandTickets },
  set_ticket_ceiling: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: people.setTicketCeiling },

  // --- the two deadlines ---
  deadline_status: { roles: null, kind: 'read', fn: deadlines.deadlineStatus },
  roll_check_in: { roles: ADMIN_ONLY, kind: 'bulk', fn: deadlines.rollCheckIn },
  // A recorder too: this is the person standing at the table when the seller
  // walks up with a bag of counterfoils, and a report that has to wait for an
  // organiser to be free is a report that gets written on the back of an
  // envelope instead.
  record_check_in: { roles: ['recorder'], kind: 'write', fn: deadlines.recordCheckIn },
  set_final_deadline: { roles: ADMIN_ONLY, sup: true, kind: 'write', fn: deadlines.setFinalDeadline },

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
    async (action, payload, asUser) => {
      const spec = REGISTRY[action]
      if (!spec) throw new ApiError('UNKNOWN_ACTION', `Unknown action: ${action}`, null, 404)
      // Marked as an APPROVED execution. A handler that refuses an organiser
      // outright needs to know the difference between them asking directly and
      // the owner having said yes — otherwise an approved request fails at the
      // moment of approval, which is the worst possible time to discover it.
      ;(ctx as unknown as { _viaApproval?: boolean })._viaApproval = true
      try {
        // AWAIT, not a bare return. `try { return fn() } finally { … }` runs
        // the finally the moment the PROMISE is returned, not when it settles —
        // so the flag was cleared before the handler had awaited its way down to
        // reading it, and every approved request was refused at the moment of
        // approval. It read as "Only the owner can let somebody in" to the owner.
        return await spec.fn(payload, asUser, ctx)
      } finally {
        ;(ctx as unknown as { _viaApproval?: boolean })._viaApproval = false
      }
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
      // Without this the setup screen printed "KS-undefined onwards", which is
      // the ticket numbering the whole raffle is built on.
      ticketStart: num(cfg.TICKET_START, 1),
      ticketsPerBook: num(cfg.TICKETS_PER_BOOK, 10),
      bookPrefix: cfg.BOOK_PREFIX ?? 'Book-',
      bookDigits: num(cfg.BOOK_DIGITS, 3),
      // And without this, "10 — that makes books" with the number missing.
      totalBooks: Math.ceil(generated / Math.max(1, num(cfg.TICKETS_PER_BOOK, 10))),
      defaultDueDays: num(cfg.DEFAULT_DUE_DAYS, 30),
      totalTickets: active,            // what is in play — the number the app works in
      generatedTickets: generated,
      heldBackTickets: Math.max(0, generated - active),
      ticketCeiling: num(cfg.TICKET_CEILING, 0),
      ticketPrice: Number(cfg.TICKET_PRICE ?? 10),
      currency: cfg.CURRENCY ?? 'RM',
      eventName: cfg.EVENT_NAME ?? '',
      orgName: cfg.ORG_NAME ?? '',
      // The organiser's mark, by URL. Blank means no mark rather than somebody
      // else's — see Logo.vue. Small is optional and only ever a size choice.
      orgLogo: cfg.ORG_LOGO ?? '',
      orgLogoSmall: cfg.ORG_LOGO_SMALL ?? '',
      // One colour; the stylesheet derives the rest. Blank is a real no-op —
      // applyBrand removes the tokens and the stylesheet's own colour stands,
      // rather than half a theme being applied over it.
      brandColor: cfg.BRAND_COLOR ?? '',
      projectCode: cfg.PROJECT_CODE ?? '',
      // Through dayStart, never raw. A value that arrived from a date-shaped
      // spreadsheet cell is a full timestamp string, and the client compares
      // these against today as plain text — where that string sorts ABOVE a
      // real day, so a date months past reads as still ahead.
      checkInDate: dayStart(cfg.CHECK_IN_DATE ?? ''),
      finalDeadline: dayStart(cfg.FINAL_DEADLINE ?? ''),
      drawDate: dayStart(cfg.DRAW_DATE ?? ''),
    },
  }
}

/**
 * The cheapest call in the system, and the one the client polls. In Apps Script
 * this read two Script Properties and still took 1.1 seconds. Here it is the
 * newest modified_at, which is an index lookup.
 */
async function readVersion(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data } = await ctx.supabaseAdmin
    .from('tickets')
    .select('modified_at')
    .order('modified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  /*
   * The waiting-approvals count rides along on the poll that already happens.
   *
   * An owner sitting on the Approvals screen had no way to learn that a request
   * had arrived — the page fetches once and then knows nothing. A request that
   * nobody is told about is the same as no request, and the person who asked is
   * left wondering whether the button worked.
   *
   * Carried here rather than given its own poll or a live subscription:
   * head:true costs about the same as asking the time, and the client is
   * already making this call. A subscription would mean opening
   * pending_approvals to direct browser reads, and the owner cannot be
   * identified in the database at all — that is the invariant the whole
   * permission model rests on, and it is not worth trading for a few seconds.
   */
  let waiting = 0
  if (user.isSuperAdmin) {
    const { count } = await ctx.supabaseAdmin
      .from('pending_approvals')
      .select('request_id', { count: 'exact', head: true })
      .eq('status', 'Pending')
      .gt('expires_at', new Date().toISOString())
    waiting = count ?? 0
  } else {
    // Anybody else is told only about their own, which is what they are
    // waiting on — "has mine been decided yet".
    const { count } = await ctx.supabaseAdmin
      .from('pending_approvals')
      .select('request_id', { count: 'exact', head: true })
      .eq('requested_by', user.email)
      .eq('status', 'Pending')
    waiting = count ?? 0
  }

  /*
   * BOOKS COMING DUE, so the banner clears itself.
   *
   * The counts come from the books, never from a dismissal. An alert somebody
   * can tick away is an alert everybody ticks away, and the one time it
   * mattered it had already been trained into furniture. This one goes when the
   * books are actually back and the tickets in them are accounted for — which
   * is the only thing that should make it go.
   *
   * Scoped like every other read: a seller is told about the books in their own
   * hands, an organiser about all of them. A seller shown the whole raffle's
   * overdue count cannot act on it and learns to ignore the banner, which is
   * the same failure by a different route.
   *
   * On the poll rather than a screen of its own, so it follows somebody from
   * page to page — the seller who needs it is not going to open a reports page
   * to find it.
   */
  const soon = new Date(Date.parse(today() + 'T00:00:00Z') + 7 * 864e5).toISOString().slice(0, 10)
  const mine = user.role === 'agent'

  const countBooks = async (build: (q: any) => any) => {
    let q = ctx.supabaseAdmin.from('books').select('idx', { count: 'exact', head: true })
      .eq('status', 'Out')
    if (mine) q = q.eq('held_by_agent', user.agentId ?? '\u0000')
    const { count } = await build(q)
    return count ?? 0
  }

  const booksLate = await countBooks((q: any) => q.lt('due_at', today()))
  const booksDueSoon = await countBooks((q: any) => q.gte('due_at', today()).lte('due_at', soon))

  return {
    tickets: data?.modified_at ?? null,
    approvalsWaiting: waiting,
    // What the banner is made of. Both are counts of BOOKS still out, because a
    // book is the thing somebody physically brings back.
    booksLate,
    booksDueSoon,
    dueSoonBy: soon,
    scope: mine ? 'mine' : 'all',
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
  // book_ledger_all, not book_ledger. The filtered one carries its own WHERE
  // clause on app_role(), and this function reads as the service role with no
  // JWT — so app_role() is null and the filtered view returns NOTHING to it.
  // Every action built on it reported an empty raffle. The scoping this path
  // needs is done in code below, because it has to be: the service role is
  // above the policies, so nothing else can do it.
  let query = ctx.supabaseAdmin.from('book_ledger_all').select('*').order('idx').limit(1000)
  if (p.status) query = query.eq('status', String(p.status))
  if (p.agentId) query = query.eq('held_by_agent', String(p.agentId))

  // A seller's book list is the books in their hands. Anything else is a wall
  // of two thousand squares that tells them nothing and costs them a download.
  if (user.role === 'agent') query = query.eq('held_by_agent', user.agentId ?? '\u0000')

  const { data, error } = await query
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  /*
   * MAPPED FIELD BY FIELD, not echoed.
   *
   * These are the view's snake_case columns and the client reads the Apps
   * Script shape. Returning the rows raw made every book tile in the grid
   * render "0": BookGrid calls bookShort(b.book), the view has no `book`
   * column — it is `number` — so it fell through to its '0' fallback, a
   * thousand times. The colours and the totals were right, which made it look
   * half-working rather than broken.
   *
   * Everything else went the same way silently: agentName, due, daysOverdue,
   * sold, expected, paid. Nothing threw. The screen just quietly said nothing.
   *
   * handleListBooks in Books.gs builds this shape explicitly, which is why the
   * same screen was correct on Apps Script throughout.
   */
  const books = (data ?? []).map((r: Record<string, unknown>) => ({
    book: r.number,
    firstTicket: r.first_ticket,
    lastTicket: r.last_ticket,
    status: r.status,
    agentId: r.held_by_agent ?? '',
    agentName: r.agent_name ?? '',
    due: r.due_at,
    daysOverdue: r.days_overdue ?? 0,
    sold: r.counted_sold ?? 0,
    available: r.available ?? 0,
    expected: r.counted_expected ?? 0,
    paid: r.counted_collected ?? 0,
    variance: r.variance_amount ?? 0,
    missingContact: r.missing_contact ?? 0,
    pastFinal: !!r.past_final,
  }))

  // The counts the home screen reads. Apps Script has always returned these and
  // this did not, which store.js papered over by overwriting bookStats from
  // report_draw_ready a moment later — so the gap only showed if that report
  // failed, and then the grid lost its counts for a reason nobody would connect
  // back to list_books.
  //
  // Counted over exactly the rows this caller may see, so the number above a
  // list always describes the list underneath it. For a seller that is their
  // own books; for everybody else, the whole raffle.
  const stats: Record<string, number> = {}
  for (const b of books) {
    const k = String((b as { status?: string }).status ?? '')
    stats[k] = (stats[k] ?? 0) + 1
  }

  const cfg = await readConfig(ctx)
  const per = num(cfg.TICKETS_PER_BOOK, 10)
  const generatedBooks = Math.ceil(num(cfg.TOTAL_TICKETS, 0) / per)
  const liveBooks = Math.ceil((await activeTickets(ctx)) / per)

  return {
    books,
    stats,
    total: books.length,
    currency: cfg.CURRENCY ?? 'RM',
    generatedBooks,
    heldBackBooks: Math.max(0, generatedBooks - liveBooks),
  }
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
  if (user.role !== 'agent') return null

  // A seller linked to no seller record sees NOTHING, not everything. Returning
  // null here is the masker's signal that no narrowing applies, so an
  // agent-role account with no agent_id was getting every buyer's name and
  // phone number — the exact thing the narrowing exists to prevent, reached by
  // leaving a field blank. Failing to an empty set is the only safe direction.
  if (!user.agentId) return new Set()
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

  /*
   * A helper reads the buyers they wrote down, and no others.
   *
   * This has to be here as well as in tickets_readable, not instead of it.
   * Direct reads are the default on Supabase and go straight to the view — but
   * ?directreads=off is a documented switch, offered precisely for the day the
   * views misbehave, and it routes the same read through this function. If the
   * narrowing lived only in the view, that switch would hand a helper every
   * buyer's telephone number, and it would look like a performance setting.
   *
   * Masked in one path and not the other is this project's most repeated bug:
   * it is how every seller came to be sent every buyer's phone number, because
   * the row was masked for viewers only.
   */
  if (user.role === 'recorder' && String(row.recorded_by ?? '') !== user.email) {
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
        // Two different refusals, because they need two different actions from
        // the person reading them. "Not switched on" sends an organiser to the
        // Access screen to turn it on — right for an ordinary permission, and
        // actively misleading for a super-admin-only one where no such switch
        // exists or ever can.
        if (spec.sup && !user.isSuperAdmin) {
          throw new ApiError('SUPER_ADMIN_ONLY',
            'Only the system admin can do this. It cannot be switched on for anybody else.',
            null, 403)
        }
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
