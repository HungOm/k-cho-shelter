/*
 * WHAT A RESET WOULD DESTROY, WORKED OUT BEFORE ANYTHING IS DESTROYED.
 *
 * This file decides nothing about the database and touches no rows. It answers
 * one question — given a set of features somebody ticked, what actually has to
 * go, and what must be refused — so that the answer can be shown to them, typed
 * back, and checked again on the way in. The deleting lives next door in
 * reset.ts; the reasoning lives here because reasoning that runs only at the
 * moment of deletion is reasoning nobody can read first.
 *
 * TWO KINDS OF DEPENDENCY, AND THE SECOND IS THE DANGEROUS ONE.
 *
 * A foreign key is a dependency Postgres knows about. `winners.ticket_idx`
 * references `tickets` with `on delete restrict`, so deleting tickets without
 * deleting winners does not quietly go wrong — it refuses. Those edges are
 * DERIVED: they are declared below as LINKS and tests/resetplan.test.mjs reads
 * schema.sql and fails if the two disagree. A hand-kept graph that nothing
 * checks is the shape that let money_entries survive a reset for a week.
 *
 * The other kind has no foreign key and Postgres will happily let you do it.
 * `payments` has nothing pointing at it, so by the first rule it is safe to
 * reset on its own. It is not: what a seller owes is a book figure PLUS hand
 * payments, so deleting one of the two doors silently changes the answer and
 * leaves books marked settled against no record. `config` has nothing pointing
 * at it either, and resetting it renumbers every label while the rows keep the
 * numbers they were issued under.
 *
 * So SOFT edges are declared by hand, each with the sentence explaining it, and
 * a test requires every table to be classified rather than letting a new one
 * default into "safe". Deriving safety only from foreign keys would green-light
 * the three most dangerous resets in this system.
 *
 * WHY THIS LIVES IN _shared AND NOT IN api/, which is not filing.
 *
 * Three tests refuse what this file would otherwise have been. custodyledger
 * fails if any handler names `ticket_movements`, because a handler that writes
 * the ledger lets the projection drift from it. moneyjournal fails the same way
 * for `money_entries`. Both caught this file on its first run, and both are
 * right about the thing they are actually guarding: THE DELETING MUST NOT BE
 * TYPESCRIPT ISSUING DELETES. It belongs in a SQL function that takes the
 * triggers off, empties in one transaction, and puts them back before it
 * commits — which is what supabase/reset.sql already does and what the handler
 * next door must call rather than reimplement.
 *
 * So this file is a DECLARATION, not a handler: a map of features to tables and
 * the graph between them, read by the api function and by the tests. It names
 * those tables because naming them is its whole job. The handler that uses it
 * still gets scanned, and still must not contain a delete.
 *
 * AND SOME THINGS ARE NEVER RESET FROM A WEB PAGE. The audit log is the record
 * that the reset happened; wiping it from the button that did it leaves nothing
 * behind. Accounts and permissions are how the person pressing the button gets
 * back in. supabase/reset.sql does both, deliberately, from a terminal, after a
 * backup, with a token typed by hand — which is the right ceremony for them and
 * is not a button.
 */

/** A table's home. Every table in schema.sql must appear exactly once. */
export type Feature = {
  id: string
  name: string
  /** What resetting it means, in the words the screen shows. */
  why: string
  tables: string[]
  /** Declared dependencies with no foreign key behind them. */
  soft?: { feature: string; why: string }[]
  /** Never offered in the app. reset.sql is the only route. */
  never?: string
  /** An extra refusal checked against live rows — see reset.ts. */
  guard?: 'printed'
}

export const FEATURES: Feature[] = [
  {
    id: 'artwork',
    name: 'Ticket artwork and design',
    why: 'The uploaded pictures and where everything sits on them. Tickets already printed keep what they were printed with.',
    tables: ['ticket_templates'],
  },
  {
    id: 'tickets',
    name: 'Tickets, books and codes',
    why: 'Every ticket, every book, their history, their movements and the codes behind their QRs.',
    /*
     * The receipts belong HERE rather than in a feature of their own, and the
     * reason is what a reset means: a receipt is one code standing for a set of
     * tickets, so it is worth exactly as much as the tickets it names. Wiping
     * the tickets and keeping the receipts would leave codes that verify to
     * nothing — and a receipt that answers "genuine" for a ticket that no
     * longer exists is worse than one that has gone with it.
     */
    tables: ['tickets', 'books', 'ticket_codes', 'ticket_receipts', 'ticket_receipt_items',
             'ticket_history', 'ticket_movements', 'book_history'],
    /*
     * Codes that have been PRINTED exist on paper in somebody's hand. Deleting
     * them is not a data reset — it stops physical tickets verifying, and the
     * holder gets "no ticket matches this link" for a ticket they paid for.
     */
    guard: 'printed',
  },
  {
    id: 'sellers',
    name: 'Sellers',
    why: 'The people who sell tickets, and the books recorded against them.',
    tables: ['agents'],
  },
  {
    id: 'money',
    name: 'Money',
    why: 'Payments taken and the money journal.',
    tables: ['payments', 'money_entries'],
    soft: [{
      feature: 'tickets',
      why: 'What a seller owes is a book figure plus hand payments. Deleting the payments '
        + 'alone leaves books recorded as settled against no payment, and changes what every '
        + 'seller owes without saying so.',
    }],
  },
  {
    id: 'prizes',
    name: 'Prizes and winners',
    why: 'The prize list and any tickets drawn against it.',
    tables: ['prize_types', 'prizes', 'winners'],
  },
  {
    id: 'checkins',
    name: 'Check-in dates and reports',
    why: 'The dates sellers were asked to come in, and what was counted when they did.',
    tables: ['check_in_dates', 'check_in_reports'],
  },
  {
    id: 'approvals',
    name: 'Pending approvals',
    why: 'Requests waiting for an organiser to accept or refuse.',
    tables: ['pending_approvals'],
  },
  {
    id: 'rounds',
    name: 'Round snapshots',
    why: 'The figures frozen at the end of each round.',
    tables: ['round_snapshots'],
    soft: [{
      feature: 'tickets',
      why: 'A snapshot is a statement about tickets and books at a moment. Keeping snapshots '
        + 'of a raffle whose tickets have gone leaves figures nothing can be reconciled against.',
    }],
  },
  {
    id: 'settings',
    name: 'Raffle settings',
    why: 'The numbering, the price, the draw date and everything else on the settings screen.',
    tables: ['config'],
    soft: [{
      feature: 'tickets',
      why: 'Every ticket and book was issued under the numbering these settings hold. Resetting '
        + 'them while the rows remain renames labels that are already printed on paper and '
        + 'already written into the history.',
    }],
  },
  {
    id: 'access',
    name: 'Accounts and permissions',
    why: 'Who can sign in and what each role may do.',
    tables: ['app_users', 'permissions'],
    never: 'These are how you get back in. Resetting them from a page you are signed into is how '
      + 'somebody locks themselves out of their own raffle. supabase/reset.sql does it from a '
      + 'terminal and re-seeds the System Admin in the same transaction.',
  },
  {
    id: 'audit',
    name: 'Audit log',
    why: 'Every recorded action, append-only.',
    tables: ['audit_log'],
    never: 'It is the record that the reset happened. A button that wipes the log of its own '
      + 'use leaves nothing to look at afterwards, which is the opposite of what an audit is for.',
  },
]

/*
 * THE FOREIGN KEYS, DECLARED SO THE FUNCTION CAN READ THEM AND TESTED SO THEY
 * CANNOT DRIFT.
 *
 * An Edge Function cannot open schema.sql, so the graph has to be written down
 * somewhere it can reach. tests/resetplan.test.mjs parses schema.sql, derives
 * this list, and fails on any difference in either direction — a key added, a
 * key removed, or a line here that no longer matches the database.
 *
 * `[from, to]` means a row in `from` points at a row in `to`, so `to` cannot be
 * emptied while `from` still holds rows.
 */
export type Link = [from: string, to: string, onDelete: 'restrict' | 'cascade' | 'set null']

export const LINKS: Link[] = [
  ['app_users', 'agents', 'set null'],
  ['books', 'agents', 'set null'],
  ['tickets', 'books', 'restrict'],
  ['tickets', 'agents', 'set null'],
  ['book_history', 'books', 'restrict'],
  ['ticket_history', 'tickets', 'restrict'],
  ['ticket_movements', 'tickets', 'restrict'],
  // A receipt's items hang off the receipt and hold the ticket in place: the
  // set can go without the tickets, and the tickets cannot go while a receipt
  // still names them. That is the right way round — a buyer's receipt is worth
  // nothing without the tickets, and a ticket that vanishes from under one
  // would leave a code answering "genuine" for something that no longer exists.
  ['ticket_receipt_items', 'ticket_receipts', 'cascade'],
  ['ticket_receipt_items', 'tickets', 'restrict'],
  ['ticket_codes', 'tickets', 'restrict'],
  ['prizes', 'prize_types', 'restrict'],
  ['winners', 'tickets', 'restrict'],
  ['winners', 'prizes', 'restrict'],
  ['check_in_reports', 'agents', 'cascade'],
  ['round_snapshots', 'agents', 'restrict'],
  ['payments', 'agents', 'restrict'],
  ['payments', 'books', 'set null'],
]

/*
 * WHAT `on delete` ACTUALLY DOES, because treating all three the same was
 * wrong in both directions.
 *
 *   restrict  the delete REFUSES while a child row exists, so the child's
 *             feature has to be in the plan or the whole thing rolls back
 *   cascade   the child's rows are deleted too, whether or not anybody ticked
 *             them — so that feature is in the plan by consequence
 *   set null  the child's row SURVIVES and loses the reference
 *
 * The first version of this made every reference a hard dependency. Resetting
 * the sellers then dragged in accounts and permissions — through `app_users
 * .agent_id`, which is `set null` and deletes nothing — and accounts are never
 * resettable here, so the whole selection was refused. A rule that refuses
 * everything is as useless as one that allows everything; the difference is
 * that this one looked careful.
 */
const DELETES_ROWS = (a: Link[2]) => a === 'restrict' || a === 'cascade'

const byId = new Map(FEATURES.map((f) => [f.id, f]))
const home = new Map<string, string>()
for (const f of FEATURES) for (const t of f.tables) home.set(t, f.id)

/** Which feature owns a table, or '' for one nobody has classified. */
export const featureOf = (table: string): string => home.get(table) ?? ''

/**
 * Features that must be reset alongside `id`, and why.
 *
 * HARD edges point INWARDS: `winners` references `tickets`, so tickets cannot
 * be emptied unless winners go too. SOFT edges point outwards from a declared
 * meaning. Both are returned with a sentence, because "also resets prizes" is
 * not something anybody can agree to without being told what it is for.
 */
export function dragsIn(id: string): { feature: string; why: string }[] {
  const out = new Map<string, string>()
  const f = byId.get(id)
  if (!f) return []

  for (const [from, to, act] of LINKS) {
    if (!f.tables.includes(to) || !DELETES_ROWS(act)) continue
    const other = featureOf(from)
    if (!other || other === id) continue
    const fromF = byId.get(other)
    if (out.has(other)) continue
    out.set(other, act === 'cascade'
      ? `${fromF?.name ?? other} rows are deleted with ${to}, so they are part of this whether or not they were asked for.`
      : `${to} cannot be emptied while ${from} rows point at it — the database refuses and the whole reset rolls back.`)
  }
  for (const s of f.soft ?? []) if (!out.has(s.feature)) out.set(s.feature, s.why)

  return [...out].map(([feature, why]) => ({ feature, why }))
}

/** Can this be reset on its own? The question the screen asks of every row. */
export function aloneIsSafe(id: string): boolean {
  const f = byId.get(id)
  return !!f && !f.never && dragsIn(id).length === 0
}

export type Plan = {
  /** Feature ids that will actually be emptied, in an order children-first. */
  features: string[]
  /** Tables to empty, children before parents. */
  tables: string[]
  /** What was added to the selection, and why, so it can be shown before it happens. */
  added: { feature: string; why: string }[]
  /** Selections that cannot be done from here at all. */
  refused: { feature: string; why: string }[]
}

/*
 * The order rows come out in.
 *
 * Children first, so nothing is refused by its own foreign key mid-transaction.
 * A plain topological sort over LINKS: a table may only be emptied once
 * everything pointing at it has been.
 */
function childrenFirst(tables: string[]): string[] {
  const want = new Set(tables)
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (t: string) => {
    if (seen.has(t) || !want.has(t)) return
    seen.add(t)
    for (const [from, to, act] of LINKS) if (to === t && DELETES_ROWS(act)) visit(from)
    out.push(t)
  }
  for (const t of tables) visit(t)
  return out
}

/**
 * Turn a set of ticked features into what will actually happen.
 *
 * EVERYTHING IT DRAGS IN IS RETURNED SEPARATELY from what was asked for. A
 * screen that quietly expands a selection is a screen that destroys more than
 * somebody agreed to; one that refuses instead teaches nothing. So it expands,
 * and it says what it expanded and why, and the confirmation is written against
 * the expanded list.
 */
export function planFor(selected: string[]): Plan {
  const asked = new Set(selected.filter((s) => byId.has(s)))
  const refused: { feature: string; why: string }[] = []

  for (const id of [...asked]) {
    const f = byId.get(id)!
    if (f.never) { refused.push({ feature: id, why: f.never }); asked.delete(id) }
  }

  const added: { feature: string; why: string }[] = []
  /* Expand until nothing new arrives — a dragged-in feature may drag more. */
  for (let pass = 0; pass < FEATURES.length; pass++) {
    let grew = false
    for (const id of [...asked]) {
      for (const d of dragsIn(id)) {
        if (asked.has(d.feature)) continue
        const df = byId.get(d.feature)
        if (!df) continue
        if (df.never) {
          /* A never-feature reached by dependency is not silently skipped: the
           * selection that needs it cannot be honoured as asked. */
          if (!refused.some((r) => r.feature === id)) {
            refused.push({
              feature: id,
              why: `${byId.get(id)?.name} cannot be reset here: it would require ${df.name}, which ${df.never}`,
            })
          }
          asked.delete(id)
          grew = true
          continue
        }
        asked.add(d.feature)
        added.push({ feature: d.feature, why: d.why })
        grew = true
      }
    }
    if (!grew) break
  }

  const tables: string[] = []
  for (const f of FEATURES) if (asked.has(f.id)) tables.push(...f.tables)

  return {
    features: [...asked],
    tables: childrenFirst(tables),
    added,
    refused,
  }
}

/**
 * Rows that SURVIVE a plan but come out of it pointing at nothing.
 *
 * `payments.book_idx` is `set null`, so emptying the books leaves every payment
 * in place with no book against it. Nothing refuses and no row disappears,
 * which is exactly why it has to be said out loud: this is the shape of damage
 * somebody only finds when a figure stops reconciling weeks later.
 */
export function loosens(features: string[]): { table: string; by: string; why: string }[] {
  const going = new Set<string>()
  for (const f of FEATURES) if (features.includes(f.id)) for (const t of f.tables) going.add(t)

  const out: { table: string; by: string; why: string }[] = []
  for (const [from, to, act] of LINKS) {
    if (act !== 'set null' || !going.has(to) || going.has(from)) continue
    if (out.some((o) => o.table === from && o.by === to)) continue
    out.push({
      table: from,
      by: to,
      why: `${from} rows are kept, but the ${to} they point at is going, so that link becomes empty.`,
    })
  }
  return out
}

/** Every feature the app will ever offer to reset. */
export const RESETTABLE = FEATURES.filter((f) => !f.never).map((f) => f.id)
