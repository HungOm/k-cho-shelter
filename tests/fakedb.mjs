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
 *
 * AND IT SAYS NOTHING WHATEVER ABOUT THE SQL FUNCTIONS. `rpc` below reimplements
 * issue_books_tx, settle_book, restock_books and the rest in JavaScript. They
 * are a model of what those functions are meant to do, written from the same
 * understanding, and a green suite is not evidence that the plpgsql in
 * supabase/functions.sql runs at all.
 *
 * IT HAS ALREADY COST A LIVE OUTAGE. issue_books_tx read `from written` while
 * selecting `w.idx` — an alias nothing bound, invalid since the day it was
 * written. A plpgsql body is not planned until it executes, so `create or
 * replace function` accepted it, the migration applied cleanly, the deploy was
 * clean, this suite was green, and giving books out — the commonest act in the
 * raffle — failed for every volunteer with `missing FROM-clause entry for table
 * "w"`. Nothing between the keyboard and the fundraiser looked at the body.
 *
 * So: the only evidence that a SQL function works is CALLING it against real
 * Postgres. Do that after any deploy that touches one — issue a book, return
 * it, count it in, inside a transaction you roll back.
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
  round_snapshots: { taken_by: '', books_out: 0, books_settled: 0, recorded_sold: 0,
                     expected: 0, collected: 0, outstanding: 0, reported: false,
                     missed_before: 0, taken_at: () => new Date().toISOString() },
  // `id` is a bigint identity in Postgres. Generated here too, because
  // reverse_payment addresses a row by the id the insert handed back — a fake
  // that left it undefined would make every reversal look like a missing row.
  payments: { id: () => ++paymentId, method: 'cash', note: '', received_by: '',
              source: 'hand', book_idx: null, reverses: null,
              received_at: () => new Date().toISOString() },
  audit_log: { at: () => new Date().toISOString() },
  /*
   * `active` is the one that matters, and it matters because nothing sets it.
   * upsertPrize inserts a new prize WITHOUT it and leans on the column default,
   * and both listPrizes and the draw-readiness blocker filter on active = true.
   * A fake that left it undefined would hide every prize the moment it was
   * created — a fake disagreeing with Postgres, failing on correct code.
   */
  prizes: { active: true, description: '', donor: '', draw_order: null, rank: 1,
            quantity: 1, value_amount: 0, created_by: '',
            created_at: () => new Date().toISOString() },
  prize_types: { active: true, built_in: false, sort: 0, valuing: 'fixed', added_by: '',
                 added_at: () => new Date().toISOString() },
  winners: { prize: '', prize_id: null, seq: null, prize_value: null,
             notified: false, claimed: false, claimed_at: null, forfeited_at: null,
             notes: '', buyer_name: '', buyer_phone: '', recorded_by: '',
             drawn_at: () => new Date().toISOString() },
  book_history: { at: () => new Date().toISOString(), note: '' },
}

/*
 * The defaults a SEEDED row gets, which is a much shorter list than the ones an
 * INSERT gets, and the difference is deliberate.
 *
 * WHY ANY AT ALL. `prizes.active` is `not null default true` and nothing sets
 * it — upsertPrize leans on the column default, and both listPrizes and the
 * draw-readiness blocker filter on it. A fixture that seeded a prize without
 * spelling out `active: true` got a prize the real database calls live and this
 * fake called switched off: "The Consolation is not being offered", to a test
 * whose entire point was that it was.
 *
 * WHY NOT ALL OF THEM. Applying the whole DEFAULTS table to seeded rows breaks
 * fixtures that mean something by leaving a column out. `app_users.status` is
 * the case in hand: gate.ts falls back to `active === false ? 'suspended'` for
 * rows that predate the lifecycle column, router.test.mjs seeds exactly such a
 * row to exercise that fallback, and filling the status in turns a suspended
 * super admin into a signed-in one. An absent column is not always a column
 * waiting for a default — sometimes it is the fixture.
 *
 * So this names what gets filled rather than what does not. Adding to it is a
 * decision about one column, made once, in writing.
 */
const SEED_DEFAULTS = {
  prizes: ['active'],
  prize_types: ['active'],
  winners: ['notified', 'claimed', 'forfeited_at'],
}

function seeded(tables) {
  const out = {}
  for (const [name, rows] of Object.entries(tables)) {
    const cols = SEED_DEFAULTS[name]
    if (!cols || !Array.isArray(rows)) { out[name] = rows; continue }
    out[name] = rows.map((r) => {
      const filled = { ...r }
      for (const c of cols) {
        if (filled[c] === undefined) {
          const d = DEFAULTS[name]?.[c]
          filled[c] = typeof d === 'function' ? d() : d
        }
      }
      return filled
    })
  }
  return out
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

/*
 * agent_money, COMPUTED — because a view is not a table and must not be one here.
 *
 * The obvious shortcut is to let tests seed `agent_money` like any other table.
 * That would be the fake at its most dangerous: every money assertion would be
 * checking a total somebody typed into the fixture rather than one that follows
 * from the books and the payments, and a handler that stopped agreeing with its
 * own ledger would go on passing.
 *
 * So it is derived here the way the SQL derives it, from the same three
 * sources, and a test cannot set it directly any more than it could in
 * Postgres. What is deliberately NOT modelled is the released-books window the
 * real view inherits from book_ledger_all: fixtures seed that view directly, so
 * the filter has already been applied by whoever wrote the rows.
 */
function agentMoneyRows(db) {
  const ledger = db.tables.book_ledger_all ?? []
  const books = db.tables.books ?? []
  const tickets = db.tables.tickets ?? []
  const payments = db.tables.payments ?? []
  const round2 = (n) => Math.round(n * 100) / 100

  /*
   * MONEY FOLLOWS THE SALE, as of the migration of 2026-09-17, and this had not
   * followed it. The fake still keyed every figure on who was HOLDING the paper
   * — which is what the view did until that day and is exactly the bug the
   * migration ended. Left alone it would have been the most expensive kind of
   * fake: money tests passing against a model the database had stopped using,
   * agreeing with each other and with nothing in production.
   *
   * The two regimes, kept apart here the same way the SQL keeps them:
   *
   *   an OPEN book    the ticket rows are the truth, so what is expected
   *                   follows tickets.sold_by_agent
   *   a CLOSED book   the declared figure is the truth, frozen at settle time
   *                   against books.settled_by_agent
   *
   * The counts stay on custody: how many books are with you, and how many are
   * late, are questions about paper.
   */
  const conf = (k, d) => {
    const row = (db.tables.config ?? []).find((c) => c.key === k)
    return parseInt(row?.value ?? '', 10) || d
  }
  const total = conf('TOTAL_TICKETS', 0)
  const chosen = conf('ACTIVE_TICKETS', 0)
  const active = chosen <= 0 || chosen > total ? total : chosen
  const bookOf = (idx) => books.find((b) => b.idx === idx)
  const isClosed = (b) =>
    !!b && (b.status === 'Settled' || b.status === 'Lost') && notNull(b.declared_sold)

  /*
   * THREE FALLBACKS, EACH ONE COPYING WHAT THE REAL SYSTEM DOES, so that
   * fixtures written before the model changed keep describing the same raffle
   * instead of quietly describing an empty one.
   *
   *   a ticket with no sold_by_agent   -> the book's holder. Production sets
   *                                       that column on every sale and credits
   *                                       a sale out of an issued book to
   *                                       whoever is carrying it, so an
   *                                       under-specified fixture means the
   *                                       holder and nothing else.
   *   a book with no settled_by_agent  -> the book's holder. This is precisely
   *                                       the backfill the migration itself ran.
   *   a fixture with no sale-level
   *   evidence at all                  -> the ledger view's own figures. Those
   *                                       fixtures seed book_ledger_all with
   *                                       counted_expected and say nothing about
   *                                       which tickets or which settlement it
   *                                       came from; deriving from rows that do
   *                                       not exist would make every one of them
   *                                       a raffle where nobody owes anything,
   *                                       which is not a stricter test, it is a
   *                                       blank one. Seeding a book stub without
   *                                       tickets is still no evidence — what
   *                                       counts is a sale or a settlement.
   *
   * The fallbacks are not the model. Any fixture that names a seller on a sale
   * or a settlement gets the real rule, and the four books that moved when the
   * migration landed are exactly the fixtures that do.
   */
  const ledgerOnly = ledger.length > 0 && tickets.length === 0 && !books.some(isClosed)
  const soldBy = (t) => String(t.sold_by_agent ?? bookOf(t.book_idx)?.held_by_agent ?? '')
  const settledBy = (b) => String(b.settled_by_agent ?? b.held_by_agent ?? '')

  return (db.tables.agents ?? []).map((a) => {
    const id = String(a.agent_id ?? '')
    const held = ledger.filter((b) => String(b.held_by_agent ?? '') === id)
    const sum = (rows, f) => round2(rows.reduce((t, r) => t + Number(f(r) ?? 0), 0))

    // An open book's sales, named ticket by ticket.
    const open = tickets.filter((t) =>
      soldBy(t) === id &&
      (t.status === 'Sold' || t.status === 'Donated') &&
      Number(t.idx ?? 0) <= active &&
      !isClosed(bookOf(t.book_idx)))

    // A closed book's declared figures, frozen against whoever it was closed for.
    const closed = books.filter((b) =>
      settledBy(b) === id &&
      (b.status === 'Settled' || b.status === 'Lost') &&
      notNull(b.declared_sold))

    const expected = ledgerOnly
      ? sum(held, (b) => b.counted_expected)
      : round2(sum(open, (t) => t.amount) + sum(closed, (b) => b.amount_due))
    const bookCollected = ledgerOnly
      ? sum(held, (b) => b.counted_collected)
      : sum(closed, (b) => b.amount_paid)

    const mineP = payments.filter((r) => String(r.agent_id ?? '') === id)
    // 'hand' BY NAME, as the SQL asks: settlement is already inside the book's
    // own figure, and a write-off is not cash at all.
    const handedIn = sum(mineP.filter((r) => r.source === 'hand'), (r) => r.amount)
    const writtenOff = sum(mineP.filter((r) => r.source === 'writeoff'), (r) => r.amount)

    return {
      agent_id: id,
      name: a.name ?? '',
      phone: a.phone ?? '',
      zone: a.zone ?? '',
      books_out: held.filter((b) => b.status === 'Out').length,
      books_settled: ledgerOnly ? held.filter((b) => b.status === 'Settled').length : closed.length,
      overdue_books: held.filter((b) => Number(b.days_overdue ?? 0) > 0).length,
      tickets_sold: ledgerOnly
        ? held.reduce((t, b) => t + Number(b.counted_sold ?? 0), 0)
        : open.length + closed.reduce((t, b) => t + Number(b.declared_sold ?? 0), 0),
      expected,
      collected: round2(bookCollected + handedIn),
      written_off: writtenOff,
      outstanding: round2(expected - bookCollected - handedIn - writtenOff),
    }
  })
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
  /**
   * `or('a.eq.x,b.in.(p,q)')` — only the forms these handlers actually use.
   *
   * SPLIT ON TOP-LEVEL COMMAS ONLY. PostgREST separates or-clauses with commas
   * AND writes an `in` list as (a,b,c), so a plain split tore
   * `action.in.(x,y)` into two clauses and the second was nonsense. The bracket
   * depth is the whole of the difference.
   */
  or(expr) {
    const parts = []
    let depth = 0, cur = ''
    for (const ch of String(expr)) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
      cur += ch
    }
    if (cur) parts.push(cur)

    /*
     * PostgREST lets an or() hold and(…) GROUPS, and this did not.
     *
     * `and(held_by_agent.eq.A001,status.eq.Out)` split on '.' gives a column
     * called "and(held_by_agent" and an operator of "eq", so it took the eq
     * branch, compared a field no row has, and was false for every row —
     * silently. A seller's book list came back EMPTY and the only symptom was a
     * later test reading `undefined.status`. An unsupported shape must fail
     * loudly or it is worse than no fake at all.
     */
    const clause = (c) => {
      const group = c.match(/^(and|or)\((.*)\)$/s)
      if (group) {
        const inner = []
        let d = 0, buf = ''
        for (const ch of group[2]) {
          if (ch === '(') d++
          if (ch === ')') d--
          if (ch === ',' && d === 0) { inner.push(buf); buf = ''; continue }
          buf += ch
        }
        if (buf) inner.push(buf)
        const fns = inner.map(clause)
        return group[1] === 'and'
          ? (r) => fns.every((f) => f(r))
          : (r) => fns.some((f) => f(r))
      }
      const [col, operator, ...rest] = c.split('.')
      const raw = rest.join('.')
      // A column nobody has is a filter that quietly matches nothing. Caught
      // here rather than as an empty list three tests later.
      if (/[()]/.test(col)) {
        throw new Error(`fakedb: could not parse or() clause "${c}"`)
      }
      if (operator === 'eq') return (r) => String(r[col] ?? '') === raw
      if (operator === 'in') {
        const wanted = new Set(raw.replace(/^\(|\)$/g, '').split(',')
          .map((v) => v.trim().replace(/^"|"$/g, '')))
        return (r) => wanted.has(String(r[col] ?? ''))
      }
      if (operator === 'ilike') {
        const rx = new RegExp('^' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
        return (r) => rx.test(String(r[col] ?? ''))
      }
      throw new Error(`fakedb: unsupported or() operator "${operator}" in "${c}"`)
    }
    const clauses = parts.map(clause)
    this.filters.push((r) => clauses.some((f) => f(r)))
    return this
  }

  // ---- writes ----
  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  update(patch) { this.op = 'update'; this.payload = patch; return this }
  upsert(rows, opts = {}) {
    this.op = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    // A COMMA-SEPARATED KEY IS A COMPOSITE ONE, and it used to be taken
    // literally: `onConflict: 'round,agent_id'` looked up a column of that
    // name, found undefined on both sides, and undefined === undefined matched
    // the first row in the table. Every row after the first was silently
    // written over the first one, and a test asserting "one row per seller"
    // would have passed while the handler did something else entirely.
    this.onConflict = String(opts.onConflict ?? 'id').split(',').map((c) => c.trim())
    // ON CONFLICT DO NOTHING is not ON CONFLICT DO UPDATE. The fake merged
    // either way, which models the one thing an append-only table raises on.
    this.ignoreDuplicates = !!opts.ignoreDuplicates
    return this
  }
  delete() { this.op = 'delete'; return this }

  maybeSingle() { this.wantSingle = 'maybe'; return this }
  single() { this.wantSingle = 'one'; return this }

  // ---- running ----
  rows() {
    const all = this.table === 'agent_money' ? agentMoneyRows(this.db) : this.db.tables[this.table]
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
    // A derived view has no entry in `tables` and is never written to, so it is
    // resolved before the existence check rather than being given a fake table
    // that a test could then seed.
    if (this.table === 'agent_money') {
      if (this.op !== 'select') return { data: null, error: { message: 'cannot change a view' } }
      return this.shaped(this.rows())
    }
    const t = this.db.tables[this.table]
    if (!t) return { data: null, error: { message: `relation "${this.table}" does not exist` } }

    if (this.op === 'insert' || this.op === 'upsert') {
      const out = []
      for (const row of this.payload) {
        if (this.op === 'upsert') {
          const at = t.findIndex((r) => this.onConflict.every((k) => r[k] === row[k]))
          if (at !== -1) {
            if (this.ignoreDuplicates) continue   // DO NOTHING: the row that is there stays
            Object.assign(t[at], copy(row)); out.push(t[at]); continue
          }
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
      payments: [], ticket_history: [], round_snapshots: [],
      prizes: [], prize_types: [], ticket_templates: [], ticket_codes: [],
      ...seeded(copy(seed)),
    },
    writes: [],
  }

  /*
   * A stand-in for the branding bucket, with the same three methods the handler
   * uses and no others — upload, remove, getPublicUrl.
   *
   * Every call is recorded, so a test can ask what was PUT rather than only
   * whether the action returned. It deliberately does NOT enforce the size or
   * type caps: those live in the bucket policy and in the handler's own byte
   * sniff, and a fake that re-implements them would be a third copy of a rule
   * that already exists twice on purpose.
   */
  db.storage = { objects: new Map(), calls: [] }
  const bucketApi = (bucket) => ({
    async upload(name, bytes, opts = {}) {
      db.storage.calls.push({ op: 'upload', bucket, name, size: bytes?.length ?? 0, opts })
      db.storage.objects.set(`${bucket}/${name}`, bytes)
      return { data: { path: name }, error: null }
    },
    async remove(paths) {
      db.storage.calls.push({ op: 'remove', bucket, paths })
      for (const n of paths) db.storage.objects.delete(`${bucket}/${n}`)
      return { data: paths.map((n) => ({ name: n })), error: null }
    },
    getPublicUrl(name) {
      return { data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/${bucket}/${name}` } }
    },
  })

  const client = {
    storage: { from: (b) => bucketApi(b) },
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
       * desk_money, computed from the rows the way the SQL does: sold tickets
       * in books nobody holds, and how many of those were marked paid. A stub
       * that returned zeros would let a handler drop the desk line and pass.
       */
      if (fn === 'desk_money') {
        const holderOf = new Map(db.tables.books.map((b) => [b.idx, b.held_by_agent ?? null]))
        const get = (k, d) => {
          const row = db.tables.config.find((c) => c.key === k)
          return parseInt(row?.value ?? '', 10) || d
        }
        const total = get('TOTAL_TICKETS', 0)
        const activeRaw = get('ACTIVE_TICKETS', 0)
        const active = activeRaw <= 0 || activeRaw > total ? total : activeRaw
        const desk = db.tables.tickets.filter((t) =>
          ['Sold', 'Donated'].includes(t.status) && (active === 0 || t.idx <= active) &&
          holderOf.has(t.book_idx) && holderOf.get(t.book_idx) === null)
        const sum = (rows) => Math.round(rows.reduce((s, t) => s + Number(t.amount ?? 0), 0) * 100) / 100
        return Promise.resolve({
          data: { sold: desk.length, expected: sum(desk),
                  collected: sum(desk.filter((t) => t.payment_status === 'Paid')) },
          error: null,
        })
      }

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
        /*
         * THE LEDGER ROW IS PART OF THE FUNCTION NOW, so the stub writes one.
         *
         * It used to be written by the handler after the call, where a stub
         * that ignored it was harmless. Moving it inside settle_book made this
         * stub wrong in the direction that matters: every handler test would
         * see a settlement leave no trace in `payments` and would agree, which
         * is the fake quietly disproving the thing that was just fixed.
         *
         * Still not a reimplementation of settlement — nothing here touches
         * tickets or amount_paid, and the real arithmetic is proven against
         * Postgres in supabase/test-functions.sh. What is modelled is only the
         * part a handler can observe: a re-settle reverses what it replaces,
         * and zero leaves the reversal with nothing after it.
         */
        const book = db.tables.books.find((x) => x.number === args?.p_book_number)
        const paid = Number(args?.p_amount_paid ?? 0)
        // One transaction: if the ledger cannot be written, the settlement does
        // not happen either. The old path swallowed this and settled anyway,
        // which is the disagreement being removed.
        if (!db.tables.payments) {
          return Promise.resolve({ data: null, error: { message: 'relation "payments" does not exist' } })
        }
        if (book?.held_by_agent) {
          const reversed = new Set(db.tables.payments.filter((r) => r.reverses).map((r) => r.reverses))
          for (const live of db.tables.payments.filter((r) =>
            r.book_idx === book.idx && r.source === 'settlement' && !r.reverses && !reversed.has(r.id))) {
            db.tables.payments.push(withDefaults('payments', {
              agent_id: live.agent_id, amount: -Number(live.amount), book_idx: book.idx,
              source: 'settlement', reverses: live.id, received_by: args?.p_user ?? '',
              note: `Reversed: ${args?.p_book_number} counted in again`,
            }))
          }
          // payments refuses amount = 0: a row that changes nothing is a row
          // somebody has to interpret.
          if (paid !== 0) {
            db.tables.payments.push(withDefaults('payments', {
              agent_id: book.held_by_agent, amount: paid, book_idx: book.idx,
              source: 'settlement', received_by: args?.p_user ?? '',
              note: `Counted in with ${args?.p_book_number}`,
            }))
          }
        }
        return Promise.resolve({
          data: { book: args?.p_book_number, declaredSold: 0, amountDue: 0,
                  amountPaid: paid, variance: 0, unidentified: false },
          error: null,
        })
      }
      if (fn === 'sell_books') {
        return Promise.resolve({ data: { sold: 0, amount: 0, skipped: [], books: [] }, error: null })
      }
      if (fn === 'bulk_record_sales') {
        return Promise.resolve({ data: { recorded: 0, failed: [], amount: 0 }, error: null })
      }
      /*
       * MOVING BOOKS, which is now four SQL functions rather than four
       * sequences of PostgREST calls.
       *
       * These ARE modelled rather than stubbed, because what the handlers are
       * tested for is exactly what they write: a book changes hands, its trail
       * gains a row, its held tickets go back on the shelf. A stub returning a
       * count would let every one of those assertions pass against a database
       * where nothing moved — the fake disproving the thing it is meant to
       * check. The arithmetic and the transaction itself are proven against
       * Postgres in supabase/test-functions.sh; what is mirrored here is which
       * rows change and in which order.
       */
      if (fn === 'issue_books_tx') {
        const idxs = args.p_idxs ?? []
        const empty = new Set((args.p_empty_returned ?? []).map(Number))
        const written = []
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx)) continue
          const free = args.p_force
            || (b.status === 'Unassigned' && !empty.has(Number(b.idx)))
            || (b.status === 'Returned' && empty.has(Number(b.idx)))
          if (!free) continue
          Object.assign(b, {
            status: 'Out', held_by_agent: args.p_agent_id,
            issued_at: new Date().toISOString(), due_at: args.p_due_at,
            modified_by: args.p_user,
          })
          written.push({ idx: b.idx, number: b.number })
        }
        for (const w of written) {
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: w.idx, from_agent: null, to_agent: args.p_agent_id,
            action: 'issue', by_user: args.p_user, note: args.p_note ?? '',
          })
        }
        return Promise.resolve({ data: written, error: null })
      }
      /*
       * OFFERING, ACCEPTING AND RELEASING — modelled here, proven in Postgres.
       *
       * The same warning at the top of this file applies with force: all three
       * of these were written in SQL, installed cleanly, and failed on their
       * FIRST CALL with "column reference idx is ambiguous", because
       * `returns table (idx integer, number text)` declares OUT parameters that
       * shadow the table's columns. Nothing in this file could ever have caught
       * that, and nothing in it can now. What is mirrored is which rows change.
       */
      if (fn === 'offer_books_tx') {
        const idxs = args.p_idxs ?? []
        const taken = (db.tables.books ?? []).filter(
          (b) => idxs.includes(b.idx) && b.status !== 'Unassigned')
        if (taken.length) {
          return Promise.resolve({ data: null, error: { message:
            `BOOKS_NOT_FREE: ${taken.length} of ${idxs.length} are not on the shelf — ` +
            taken.map((b) => b.number).join(', ') } })
        }
        const written = []
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx) || b.status !== 'Unassigned') continue
          Object.assign(b, {
            status: 'Offered', offered_to_agent: args.p_agent_id,
            offered_at: new Date().toISOString(), offered_by: args.p_user,
            due_at: args.p_due_at, modified_by: args.p_user,
          })
          written.push({ idx: b.idx, number: b.number })
        }
        for (const w of written) {
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: w.idx, from_agent: null, to_agent: args.p_agent_id,
            action: 'offer', by_user: args.p_user, note: args.p_note ?? '',
          })
        }
        return Promise.resolve({ data: written, error: null })
      }
      if (fn === 'accept_offer_tx') {
        const idxs = args.p_idxs ?? []
        const wrong = (db.tables.books ?? []).filter(
          (b) => idxs.includes(b.idx) &&
                 (b.status !== 'Offered' || b.offered_to_agent !== args.p_agent_id))
        if (wrong.length) {
          return Promise.resolve({ data: null, error: { message:
            `NOT_OFFERED_TO_YOU: ${wrong.length} of ${idxs.length} are not waiting for you — ` +
            wrong.map((b) => b.number).join(', ') } })
        }
        const written = []
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx) || b.status !== 'Offered') continue
          Object.assign(b, {
            status: 'Out', held_by_agent: args.p_agent_id,
            issued_at: new Date().toISOString(),
            offered_to_agent: null, offered_at: null, offered_by: '',
            modified_by: args.p_user,
          })
          written.push({ idx: b.idx, number: b.number })
        }
        for (const w of written) {
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: w.idx, from_agent: null, to_agent: args.p_agent_id,
            action: 'issue', by_user: args.p_user, note: args.p_note ?? '',
          })
        }
        return Promise.resolve({ data: written, error: null })
      }
      if (fn === 'release_offer_tx') {
        const idxs = args.p_idxs ?? []
        let freed = 0
        for (const b of db.tables.books ?? []) {
          // Silent about books that are not Offered, exactly as the SQL is: a
          // sweep that raises on one somebody already dealt with stops halfway.
          if (!idxs.includes(b.idx) || b.status !== 'Offered') continue
          Object.assign(b, {
            status: 'Unassigned', offered_to_agent: null, offered_at: null,
            offered_by: '', due_at: null, modified_by: args.p_user,
          })
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: b.idx, from_agent: null, to_agent: null,
            action: 'release', by_user: args.p_user, note: args.p_reason ?? '',
          })
          freed++
        }
        return Promise.resolve({ data: freed, error: null })
      }
      if (fn === 'return_books_tx') {
        const idxs = args.p_idxs ?? []
        let moved = 0
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx)) continue
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: b.idx, from_agent: b.held_by_agent ?? null, to_agent: null,
            action: 'return', by_user: args.p_user, note: args.p_note ?? '',
          })
          b.status = 'Returned'
          b.modified_by = args.p_user
          moved++
        }
        for (const t of db.tables.tickets ?? []) {
          if (idxs.includes(t.book_idx) && t.status === 'Reserved') {
            Object.assign(t, { status: 'Available', buyer_name: '', buyer_phone: '', recorded_by: args.p_user })
          }
        }
        return Promise.resolve({ data: moved, error: null })
      }
      if (fn === 'transfer_books_tx') {
        const idxs = args.p_idxs ?? []
        let moved = 0
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx)) continue
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: b.idx, from_agent: b.held_by_agent ?? null, to_agent: args.p_to_agent,
            action: 'transfer', by_user: args.p_user, note: args.p_note ?? '',
          })
          b.held_by_agent = args.p_to_agent
          b.modified_by = args.p_user
          moved++
        }
        return Promise.resolve({ data: moved, error: null })
      }
      if (fn === 'restock_books_tx') {
        const idxs = args.p_idxs ?? []
        const pays = db.tables.payments ?? []
        const reversed = new Set(pays.filter((r) => r.reverses).map((r) => Number(r.reverses)))
        for (const r of pays.filter((r) =>
          idxs.includes(r.book_idx) && r.source === 'settlement' && !r.reverses && !reversed.has(Number(r.id)))) {
          pays.push({
            id: pays.length + 1, agent_id: r.agent_id, amount: -Number(r.amount),
            received_by: args.p_user, method: r.method ?? 'cash', book_idx: r.book_idx,
            source: 'settlement', reverses: r.id, received_at: new Date().toISOString(),
            note: 'Reversed: book put back on the shelf',
          })
          /*
           * AND THE SAME MONEY BACK AS A HAND-OVER, which is the half a seller
           * notices. The reversal is bookkeeping — the book's amount_paid is
           * being cleared and that row is the same cash. The sales survive the
           * restock and still name their seller, so without this the charge
           * stays and the credit goes, and somebody who paid ninety on the 14th
           * is shown owing ninety. Modelled here because the money screen tests
           * read these rows.
           */
          if (Number(r.amount) !== 0) {
            pays.push({
              id: pays.length + 1, agent_id: r.agent_id, amount: Number(r.amount),
              received_by: args.p_user, method: r.method ?? 'cash', book_idx: r.book_idx,
              source: 'hand', reverses: null, received_at: new Date().toISOString(),
              note: 'Cash kept from the count-in of a book, which went back on the shelf',
            })
          }
        }
        let moved = 0
        for (const b of db.tables.books ?? []) {
          if (!idxs.includes(b.idx)) continue
          db.tables.book_history.push({
            id: (db.tables.book_history.length + 1), at: new Date().toISOString(),
            book_idx: b.idx, from_agent: b.held_by_agent ?? null, to_agent: null,
            action: 'restock', by_user: args.p_user,
            note: args.p_note || (b.declared_sold != null ? `Settlement of ${b.declared_sold} cleared.` : ''),
          })
          Object.assign(b, {
            status: 'Unassigned', held_by_agent: null, issued_at: null, due_at: null,
            declared_sold: null, amount_due: null, amount_paid: null,
            settled_at: null, settled_by: '', settled_by_agent: null, notes: '',
            modified_by: args.p_user,
          })
          moved++
        }
        for (const t of db.tables.tickets ?? []) {
          if (idxs.includes(t.book_idx) && (t.status === 'Available' || t.status === 'Reserved')) {
            Object.assign(t, {
              status: 'Available', buyer_name: '', buyer_phone: '', buyer_zone: '',
              sold_by_agent: null, amount: null, payment_status: '', sold_at: null,
              source: '', recorded_by: args.p_user,
            })
          }
        }
        return Promise.resolve({ data: moved, error: null })
      }
      if (fn === 'move_tickets') {
        /*
         * Modelled, not stubbed: what the handler is tested for is which rows
         * move. A stub returning a count would let "the ticket changed hands"
         * pass against a database where nothing did.
         */
        const idxs = args.p_ticket_idxs ?? []
        const moves = db.tables.ticket_movements ??= []
        const key = args.p_client_key
        if (key) {
          const seen = moves.find((m) => m.client_key === key)
          if (seen) {
            return Promise.resolve({
              data: { batch: seen.batch_id, replayed: true,
                      moved: moves.filter((m) => m.batch_id === seen.batch_id).length },
              error: null,
            })
          }
        }
        const wrong = (db.tables.tickets ?? [])
          .filter((t) => idxs.includes(t.idx) && (t.holder ?? 'desk') !== args.p_from_holder)
        if (wrong.length) {
          return Promise.resolve({ data: null, error: {
            message: `NOT_THERE: ${wrong.length} of ${idxs.length} tickets are not with ` +
                     `${args.p_from_holder} — ${wrong.map((t) => t.number).join(', ')}` } })
        }
        const batch = 'batch-' + (moves.length + 1)
        let first = true
        for (const t of (db.tables.tickets ?? []).filter((t) => idxs.includes(t.idx))) {
          moves.push({
            id: moves.length + 1, at: new Date().toISOString(), ticket_idx: t.idx,
            from_holder: args.p_from_holder, to_holder: args.p_to_holder, kind: args.p_kind,
            batch_id: batch, by_user: args.p_user, reason: args.p_reason ?? '',
            reverses: null, client_key: first ? (key ?? null) : null, backfilled: false,
          })
          t.holder = args.p_to_holder
          first = false
        }
        return Promise.resolve({ data: { batch, moved: idxs.length, replayed: false }, error: null })
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
