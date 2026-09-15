/*
 * An in-memory stand-in for the database, so edge-function handlers can be
 * tested the way the Apps Script ones are.
 *
 * WHY THIS EXISTS. Every write action on the Supabase side — expand_tickets,
 * set_active_tickets, settle_book, restock_books, both deadlines — had no
 * behavioural test of any kind, while its Apps Script twin had thousands of
 * assertions. The gate tests check permission, the RLS tests ask the database,
 * the parity tests compare registries. None of them runs a handler. So a ported
 * handler could agree with its contract on every surface anybody was checking
 * and still do the wrong thing to the rows.
 *
 * WHAT IT IS. The subset of PostgREST's query builder these handlers actually
 * use, measured rather than guessed: from, select (with count/head), eq, neq,
 * gt, lte, in, not, or, ilike, order, limit, maybeSingle, insert, update,
 * upsert, delete, and rpc. Queries are thenable, so `await q` gives
 * { data, error } exactly as supabase-js does.
 *
 * WHAT IT IS NOT. It is not Postgres. It does not enforce the CHECK constraints
 * or the foreign keys, and it will happily store a row the real database would
 * refuse — supabase/test-rls.sh and test-functions.sh cover that half against
 * real Postgres. This covers the half those cannot reach: what the HANDLER
 * decides, in what order, and what it refuses.
 */

/*
 * Column defaults the real schema applies on insert.
 *
 * Not decoration: handlers branch on these. requestApproval inserts a row
 * WITHOUT a status and relies on the database to write 'Pending', and
 * decideApproval then reads that value back and refuses anything that is not
 * Pending. A fake that silently leaves it undefined turns every approval into
 * "that request has already been decided" — which is a fake disagreeing with
 * Postgres, and a test that would fail on correct code.
 */
let paymentId = 0

const DEFAULTS = {
  pending_approvals: { status: 'Pending', note: '', requested_at: () => new Date().toISOString() },
  app_users: { status: 'active', role: 'viewer', name: '', added_by: '', added_at: () => new Date().toISOString() },
  tickets: { status: 'Available', version: 1, buyer_name: '', buyer_phone: '', source: '' },
  books: { status: 'Unassigned', version: 1, notes: '' },
  agents: { active: true },
  check_in_reports: { books_back: 0, tickets_sold: 0, amount_paid: 0, note: '',
                      recorded_by: '', reported_at: () => new Date().toISOString() },
  // `id` is a bigint identity in Postgres. Generated here too, because
  // reverse_payment addresses a row by the id the insert handed back — a fake
  // that left it undefined would make every reversal look like a missing row.
  payments: { id: () => ++paymentId, method: 'cash', note: '', received_by: '',
              source: 'hand', book_idx: null, reverses: null,
              received_at: () => new Date().toISOString() },
  audit_log: { at: () => new Date().toISOString() },
  book_history: { at: () => new Date().toISOString(), note: '' },
}

function withDefaults(table, row) {
  const d = DEFAULTS[table]
  if (!d) return row
  const out = { ...row }
  for (const [k, v] of Object.entries(d)) {
    if (out[k] === undefined) out[k] = typeof v === 'function' ? v() : v
  }
  return out
}

/** Deep-ish clone, so a handler mutating a returned row cannot reach the store. */
const copy = (v) => (v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v)))

const notNull = (v) => v !== null && v !== undefined

const cmp = (a, b) => {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return a < b ? -1 : 1
}

class Query {
  constructor(db, table) {
    this.db = db
    this.table = table
    this.filters = []
    this.op = 'select'
    this.cols = '*'
    this.opts = {}
    this.orderBy = null
    this.max = null
    this.payload = null
    this.onConflict = null
    this.wantSingle = false
  }

  // ---- shaping ----
  select(cols = '*', opts = {}) {
    // .select() after a write means "give the rows back"; before one it is the
    // read itself. Only the read carries count/head.
    if (this.op === 'select') { this.cols = cols; this.opts = opts }
    else this.returning = true
    return this
  }
  order(col, opts = {}) { this.orderBy = { col, asc: opts.ascending !== false }; return this }
  limit(n) { this.max = n; return this }

  // ---- filters ----
  eq(col, v) { this.filters.push((r) => r[col] === v); return this }
  neq(col, v) { this.filters.push((r) => r[col] !== v); return this }
  /*
   * NULL NEVER MATCHES A COMPARISON, as in SQL.
   *
   * `null < '2026-09-15'` is not true in Postgres — it is NULL, and a WHERE
   * clause drops the row. Sorting null as "smallest" instead, which is what the
   * ordering helper does, made a book with no due date count as overdue: the
   * fake reported a banner the real database never would.
   *
   * A fake that disagrees with Postgres fails on correct code, which teaches
   * you to distrust the test — worse than having no fake at all.
   */
  gt(col, v) { this.filters.push((r) => notNull(r[col]) && cmp(r[col], v) > 0); return this }
  gte(col, v) { this.filters.push((r) => notNull(r[col]) && cmp(r[col], v) >= 0); return this }
  lt(col, v) { this.filters.push((r) => notNull(r[col]) && cmp(r[col], v) < 0); return this }
  lte(col, v) { this.filters.push((r) => notNull(r[col]) && cmp(r[col], v) <= 0); return this }
  in(col, vs) { const s = new Set(vs); this.filters.push((r) => s.has(r[col])); return this }
  is(col, v) {
    this.filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v))
    return this
  }
  not(col, operator, v) {
    if (operator === 'is') {
      this.filters.push((r) => !(v === null ? r[col] === null || r[col] === undefined : r[col] === v))
    } else {
      this.filters.push((r) => r[col] !== v)
    }
    return this
  }
  ilike(col, pattern) {
    const rx = new RegExp('^' + String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
    this.filters.push((r) => rx.test(String(r[col] ?? '')))
    return this
  }
  /** `or('a.eq.,b.eq.')` — only the forms these handlers actually use. */
  or(expr) {
    const clauses = String(expr).split(',').map((c) => {
      const [col, operator, ...rest] = c.split('.')
      const raw = rest.join('.')
      if (operator === 'eq') return (r) => String(r[col] ?? '') === raw
      if (operator === 'ilike') {
        const rx = new RegExp('^' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
        return (r) => rx.test(String(r[col] ?? ''))
      }
      throw new Error(`fakedb: unsupported or() operator "${operator}" in "${c}"`)
    })
    this.filters.push((r) => clauses.some((f) => f(r)))
    return this
  }

  // ---- writes ----
  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  update(patch) { this.op = 'update'; this.payload = patch; return this }
  upsert(rows, opts = {}) {
    this.op = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.onConflict = opts.onConflict ?? 'id'
    return this
  }
  delete() { this.op = 'delete'; return this }

  maybeSingle() { this.wantSingle = 'maybe'; return this }
  single() { this.wantSingle = 'one'; return this }

  // ---- running ----
  rows() {
    const all = this.db.tables[this.table]
    if (!all) throw new Error(`fakedb: no table "${this.table}"`)
    return all.filter((r) => this.filters.every((f) => f(r)))
  }

  /**
   * A result the way PostgREST hands it back.
   *
   * .maybeSingle() after an UPDATE returns an object, not an array of one —
   * which is what every handler here indexes into. The fake used to return the
   * array on the write paths and the object on the read paths, so a handler
   * could read `row.status` off a write, get undefined, and no test could tell:
   * the assertion that would have caught it was reading the same undefined.
   */
  shaped(rows) {
    if (!this.wantSingle) return { data: rows.map(copy), error: null }
    if (rows.length === 0) {
      return this.wantSingle === 'maybe'
        ? { data: null, error: null }
        : { data: null, error: { message: 'no rows returned' } }
    }
    return { data: copy(rows[0]), error: null }
  }

  run() {
    const t = this.db.tables[this.table]
    if (!t) return { data: null, error: { message: `relation "${this.table}" does not exist` } }

    if (this.op === 'insert' || this.op === 'upsert') {
      const out = []
      for (const row of this.payload) {
        if (this.op === 'upsert') {
          const key = this.onConflict
          const at = t.findIndex((r) => r[key] === row[key])
          if (at !== -1) { Object.assign(t[at], copy(row)); out.push(t[at]); continue }
        }
        const fresh = withDefaults(this.table, copy(row))
        t.push(fresh)
        out.push(fresh)
      }
      this.db.writes.push({ table: this.table, op: this.op, count: out.length })
      return this.returning ? this.shaped(out) : { data: null, error: null }
    }

    if (this.op === 'update') {
      const hit = this.rows()
      for (const r of hit) Object.assign(r, copy(this.payload))
      this.db.writes.push({ table: this.table, op: 'update', count: hit.length })
      return this.returning ? this.shaped(hit) : { data: null, error: null }
    }

    if (this.op === 'delete') {
      const hit = new Set(this.rows())
      this.db.tables[this.table] = t.filter((r) => !hit.has(r))
      this.db.writes.push({ table: this.table, op: 'delete', count: hit.size })
      return { data: null, error: null }
    }

    let data = this.rows()
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      data = [...data].sort((a, b) => (asc ? cmp(a[col], b[col]) : cmp(b[col], a[col])))
    }

    // head:true sends no body, which is how every count in these handlers is
    // done — a count over twenty thousand rows must not fetch twenty thousand.
    const count = this.opts.count ? data.length : null
    if (this.opts.head) return { data: null, count, error: null }

    if (this.max !== null) data = data.slice(0, this.max)

    // Embedded reads, `books(number)`, as PostgREST returns them: a nested
    // object on each row rather than flattened columns.
    const embeds = [...String(this.cols).matchAll(/(\w+)\(([^)]*)\)/g)]
      .filter((m) => m[1] !== 'count')
    data = data.map((r) => {
      const out = copy(r)
      for (const [, rel, fields] of embeds) {
        const parent = this.db.tables[rel]
        if (!parent) continue
        // Convention these handlers rely on: tickets.book_idx -> books.idx.
        const fk = `${rel.replace(/s$/, '')}_idx`
        const found = parent.find((p) => p.idx === r[fk])
        out[rel] = found
          ? Object.fromEntries(fields.split(',').map((f) => [f.trim(), found[f.trim()]]))
          : null
      }
      return out
    })

    if (this.wantSingle) {
      if (data.length === 0) {
        return this.wantSingle === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { message: 'no rows returned' } }
      }
      return { data: data[0], error: null }
    }
    return { data, count, error: null }
  }

  then(resolve, reject) {
    try { return Promise.resolve(this.run()).then(resolve, reject) }
    catch (e) { return Promise.reject(e) }
  }
}

/**
 * A database with the tables these handlers touch.
 *
 * `seed` is merged over the defaults, so a test states only what it cares about
 * — a test that has to describe sixteen config rows to check one refusal stops
 * being read.
 */
export function fakeDb(seed = {}) {
  const db = {
    tables: {
      config: [], tickets: [], books: [], agents: [], app_users: [],
      book_history: [], audit_log: [], pending_approvals: [], winners: [],
      permissions: [], book_ledger: [], book_ledger_all: [], check_in_reports: [],
      payments: [],
      ...copy(seed),
    },
    writes: [],
  }

  const client = {
    from: (t) => new Query(db, t),
    rpc: (fn, args) => {
      if (fn === 'active_tickets') {
        const get = (k, d) => {
          const row = db.tables.config.find((c) => c.key === k)
          return parseInt(row?.value ?? '', 10) || d
        }
        const total = get('TOTAL_TICKETS', 0)
        const active = get('ACTIVE_TICKETS', 0)
        return Promise.resolve({
          data: active <= 0 || active > total ? total : active, error: null,
        })
      }
      if (fn === 'server_now') return Promise.resolve({ data: new Date().toISOString(), error: null })

      /*
       * The plpgsql functions, stubbed to a plausible success.
       *
       * Their LOGIC is tested against real Postgres in supabase/test-functions.sh,
       * which is the right place for it — a fake that reimplemented settlement
       * would be testing the fake. What a stub does test is the TypeScript
       * wrapper around them: that it passes the parameters, unwraps the result,
       * and turns an embedded { error } into a thrown ApiError. That wrapper is
       * real code on the live path and nothing else exercises it.
       */
      if (fn === 'settle_book') {
        return Promise.resolve({
          data: { book: args?.p_book_number, declaredSold: 0, amountDue: 0,
                  amountPaid: args?.p_amount_paid ?? 0, variance: 0, unidentified: false },
          error: null,
        })
      }
      if (fn === 'sell_books') {
        return Promise.resolve({ data: { sold: 0, amount: 0, skipped: [], books: [] }, error: null })
      }
      if (fn === 'bulk_record_sales') {
        return Promise.resolve({ data: { recorded: 0, failed: [], amount: 0 }, error: null })
      }
      if (fn === 'active_books') return Promise.resolve({ data: 0, error: null })

      return Promise.resolve({ data: null, error: { message: `unknown function ${fn}` } })
    },
  }

  return {
    db,
    ctx: { supabase: client, supabaseAdmin: client },
    /** Rows as they now stand, for asserting on what a handler actually wrote. */
    table: (name) => copy(db.tables[name] ?? []),
    row: (name, pred) => copy((db.tables[name] ?? []).find(pred) ?? null),
    config: (key) => (db.tables.config.find((c) => c.key === key) ?? {}).value,
    /** Did anything get written at all? The question a dry run has to answer. */
    wrote: () => db.writes.filter((w) => w.count > 0),
  }
}

/** Config as the raffle actually carries it, overridable per test. */
export function baseConfig(over = {}) {
  const base = {
    TICKET_PREFIX: 'KS-', TICKET_DIGITS: '5', TICKET_START: '1',
    TOTAL_TICKETS: '50', ACTIVE_TICKETS: '50', TICKETS_PER_BOOK: '10',
    BOOK_PREFIX: 'Book-', BOOK_DIGITS: '3', TICKET_PRICE: '10',
    CURRENCY: 'RM', DEFAULT_DUE_DAYS: '30',
    CHECK_IN_DATE: '', FINAL_DEADLINE: '', DRAW_DATE: '',
    CHECK_IN_EVERY_MONTHS: '1', REPORT_GRACE_DAYS: '3', CHECK_IN_ROUND: '1',
    ...over,
  }
  return Object.entries(base).map(([key, value]) => ({ key, value: String(value) }))
}

export const users = {
  boss: { email: 'boss@x.com', name: 'Boss', role: 'admin', active: true, agentId: null, isAdmin: true, isSuperAdmin: true },
  admin: { email: 'admin@x.com', name: 'Admin', role: 'admin', active: true, agentId: null, isAdmin: true, isSuperAdmin: false },
  recorder: { email: 'rec@x.com', name: 'Rec', role: 'recorder', active: true, agentId: null, isAdmin: false, isSuperAdmin: false },
  agent: { email: 'a@x.com', name: 'Daw Hla', role: 'agent', active: true, agentId: 'A001', isAdmin: false, isSuperAdmin: false },
}

/** The code of whatever a handler threw, or NO_THROW. */
export async function codeOf(fn) {
  try { await fn(); return 'NO_THROW' } catch (e) { return e.code || ('ERR:' + e.message) }
}

export async function errOf(fn) {
  try { await fn(); return null } catch (e) { return e }
}
