/**
 * Reads that skip the Edge Function and go straight to the database.
 *
 * WHY, in numbers: raw PostgREST answers in 57-82ms; the same work through the
 * Edge Function is 340-1000ms and does not warm out of it. The function adds
 * 300-700ms per call whatever is inside it, and this app is read-heavy — a cold
 * boot is twenty thousand tickets. That gap is the whole performance story, and
 * no amount of tuning inside the function closes it.
 *
 * WHY IT IS SAFE: rls.sql closes every base table and exposes four views that
 * are already filtered and masked in the database — tickets_readable,
 * book_ledger, agents_readable, config_readable. Nothing else is readable and
 * nothing at all is writable from a browser. So this file cannot ask for more
 * than the signed-in person may see; it is the same rules, one hop closer.
 *
 * WRITES ARE NOT HERE AND MUST NOT COME HERE. Every mutation keeps going
 * through the function, where the gate, the two-person approvals and the audit
 * log live. The split is: the database decides what you may READ, the function
 * decides what you may DO.
 *
 * THE ONE RULE FOR THIS FILE: it returns exactly the envelope the Edge Function
 * returns, field for field. Not a similar one. store.js, the ticket cache and
 * both load tests are written against that shape, and the last three bugs in
 * this repo were all two things that were supposed to be the same shape and
 * were not. Anything that cannot be expressed in that envelope belongs in the
 * function, not here.
 *
 * NO CLIENT-SIDE MASKING, EVER. buyer_phone arrives from the view already
 * masked for viewers, identically to both backends. If a number ever looks
 * wrong, the view is wrong — fix it there. A second opinion in the client is
 * decoration that people would trust over the real thing.
 */
import { ApiError } from './api.js'
import { getClient } from './supabaseAuth.js'

/**
 * The actions this file answers instead of the function.
 *
 * Deliberately a short list of ROW reads. Reports and approvals are
 * aggregations the database cannot express as a view, search is one indexed
 * query that has to stay server-side, and every one of them returns few enough
 * rows that 300ms of function overhead is the least of their costs.
 */
export const DIRECT_READS = new Set([
  'read_snapshot', 'read_delta',
])

/** The wire order, identical to WIRE_FIELDS in the Edge Function. */
export const WIRE_FIELDS = [
  'Ticket_Number', 'Status', 'Book_Number', 'Buyer_Name', 'Buyer_Phone',
  'Buyer_Zone', 'Sold_By_Agent', 'Amount', 'Payment_Status', 'Sale_Date',
  'Notes', 'Source', 'Version', 'Recorded_By', 'Modified_Date',
]

const TICKET_COLUMNS =
  'idx,number,status,book_number,buyer_name,buyer_phone,buyer_zone,' +
  'sold_by_agent,amount,payment_status,sold_at,notes,source,version,recorded_by,modified_at'

/** One view row in WIRE_FIELDS order — the same array toWire() builds server-side. */
function toWire(r) {
  return [
    r.number, r.status, r.book_number ?? '', r.buyer_name, r.buyer_phone,
    r.buyer_zone, r.sold_by_agent, r.amount, r.payment_status, r.sold_at,
    r.notes, r.source, r.version, r.recorded_by, r.modified_at,
  ]
}

/**
 * PostgREST's complaint, said the way the rest of the app says things.
 *
 * The codes matter as much as the words: store.js and supabaseApi.js both
 * branch on them, so a direct read that failed authentication has to look
 * exactly like a function call that did, or the session is never renewed.
 */
function fail(error) {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? 'The database did not answer.')
  if (code === 'PGRST301' || /jwt|token/i.test(msg)) {
    throw new ApiError('AUTH_EXPIRED', 'Your sign-in has expired.')
  }
  // A missing view or a denied table is a deployment fault, not the user's.
  // Said plainly, because the likeliest cause is rls.sql not having been run.
  if (code === '42P01' || code === '42501') {
    throw new ApiError('NOT_CONFIGURED',
      'The database is not set up for direct reads yet. Ask the organiser to apply rls.sql.')
  }
  throw new ApiError('QUERY_FAILED', msg)
}

async function client() {
  const sb = await getClient()
  if (!sb) throw new ApiError('NO_CONNECTION', 'The Supabase project address is not set.')
  return sb
}

/** The database's clock. Never the phone's — see readDelta. */
async function serverNow(sb) {
  const { data, error } = await sb.rpc('server_now')
  if (error) fail(error)
  return data
}

/**
 * A page of tickets, keyed off idx.
 *
 * Keyset, not offset: "the rows after this index" is a primary-key lookup and
 * stays flat as you page, where OFFSET 19000 makes the database walk nineteen
 * thousand rows and throw them away. `offset` is accepted as the cursor because
 * that is what store.js sends and, in this table, they are the same rows — idx
 * is dense from 1 and rows are generated once and then only updated.
 */
async function readSnapshot(payload = {}) {
  const sb = await client()
  const limit = Math.min(Number(payload.limit) || 1000, 1000)
  const after = Number(payload.cursor ?? payload.offset ?? 0)

  let q = sb.from('tickets_readable').select(TICKET_COLUMNS, { count: 'exact' })
    .order('idx').limit(limit)
  if (after > 0) q = q.gt('idx', after)

  const { data, error, count } = await q
  if (error) fail(error)

  const rows = data ?? []
  const last = rows.length ? Number(rows[rows.length - 1].idx) : after
  // The view already stops at active_tickets(), so its own count IS the total.
  const total = typeof count === 'number' ? count + after : last
  const more = rows.length === limit && last < total

  return {
    fields: WIRE_FIELDS,
    rows: rows.map(toWire),
    offset: after,
    returned: rows.length,
    total,
    nextCursor: more ? last : null,
    hasMore: more,
    version: String(last),
    serverTime: await serverNow(sb),
  }
}

/**
 * Everything that changed since the last sync.
 *
 * TWO DELIBERATE CHOICES, both about not losing a row:
 *
 * `gte`, not `gt`. A row written in the same millisecond as the cursor would
 * fall through a strict comparison and never be seen again. Re-reading a row
 * costs nothing — store.js merges by ticket number, so applying the same row
 * twice is the same as applying it once — while missing one means a sold ticket
 * quietly showing as available until the next full reload.
 *
 * The cursor is the DATABASE's clock, taken through server_now() before the
 * rows are read. Not the phone's: a device running two minutes fast would set a
 * cursor in the future and silently skip every row written in between. And not
 * max(modified_at) of what came back, because a quiet poll returns nothing, and
 * a cursor that cannot advance on a quiet poll is a cursor that stops.
 */
async function readDelta(payload = {}) {
  const since = String(payload.since ?? '')
  if (!since) throw new ApiError('BAD_REQUEST', 'read_delta needs a "since" timestamp.')

  const sb = await client()
  // Read the clock BEFORE the rows. Anything written during the query then
  // lands after this mark and is picked up next time rather than falling in
  // the gap between the two.
  const now = await serverNow(sb)

  const { data, error } = await sb.from('tickets_readable').select(TICKET_COLUMNS)
    .gte('modified_at', since).order('modified_at').limit(1000)
  if (error) fail(error)

  const rows = data ?? []
  return {
    fields: WIRE_FIELDS,
    rows: rows.map(toWire),
    count: rows.length,
    serverTime: now,
  }
}

/*
 * list_books IS NOT HERE, and that is the second time this file has answered
 * the same question the same way.
 *
 * book_ledger is a view and reading it directly would be quick. But list_books
 * does not return rows any more — it returns the rows PLUS counts by status,
 * the currency, and how many books are generated and held back. Those are
 * aggregates, and computing them here as well would put the same count in two
 * places. A number computed twice is a number that eventually disagrees with
 * itself, and this file already refuses to derive a book number or mask a phone
 * for exactly that reason.
 *
 * The trade is cheap: books are thousands at most and arrive in one query, so
 * the function's 300-700ms costs least precisely here. The twenty thousand
 * tickets are where the direct path earns its keep, and those still take it.
 */

/*
 * list_agents IS NOT HERE EITHER, and this one cost a live bug before I worked
 * out why.
 *
 * agents_readable gives agent_id, name, phone, zone, active, notes — the
 * DATABASE's shape. The client has always been written against Apps Script's
 * shape, which is `id` rather than `agent_id` and carries booksOut, a count of
 * the books that agent is holding. Returning the view rows raw meant every
 * <option :value="a.id"> rendered with an undefined value: the Give out books
 * dialog showed the seller's name, because that field happens to match, and
 * held nothing when you pressed the button. "Who are the books for?" with a
 * name visibly selected. It also broke agentMap, which keys on a.id, so no
 * agent name resolved anywhere in the app.
 *
 * booksOut is the reason this belongs in the function rather than being
 * remapped here: it is a count over books, and counting it here as well is the
 * same duplication that sent list_books back. Agents are a few hundred rows in
 * one query, so the function's overhead costs little.
 *
 * The lesson is the one the whole day has been about: the view is the
 * database's shape and the client has its own, and a read path that skips the
 * translator has to do the translating. Where the translation is more than a
 * rename, it belongs on one side only.
 */

const HANDLERS = {
  read_snapshot: readSnapshot,
  read_delta: readDelta,
}

export function directRead(action, payload) {
  const fn = HANDLERS[action]
  if (!fn) throw new ApiError('UNKNOWN_ACTION', `Not a direct read: ${action}`)
  return fn(payload || {})
}
