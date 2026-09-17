# Architecture review — inventory, custody, money, audit

*Forensic review of the application as it exists on 2026-09-17 (master `e35a8ed`),
followed by the target architecture, decision records, migration strategy and roadmap.*

Everything in Part I is a **fact about the current code**, cited to the file and line it
was read from. Everything in Parts II–V is a **recommendation**. Where a claim could not be
verified from the repository it is marked *unverified*.

---

## Part I — Current state

### 1. Architecture map

```
Browser (Vue 3 + Vite, static, GitHub Pages)
   │  reads:  PostgREST → views only (tickets_readable, book_ledger, agents_readable, config_readable)
   │  writes: HTTPS → Edge Function `api` (Deno), one POST per action
   ▼
Edge Function `api`  (supabase/functions/api/index.ts, 67 registered actions)
   │  authenticates the JWT (npm:@supabase/server, auth:'user')             index.ts:25, :983
   │  resolves role from app_users by e-mail                                gate.ts resolveUser
   │  registry: roles / sup / kind per action                               index.ts:200–320
   │  permission overrides from `permissions` table                         gate.ts:92–105
   │  two-person control for six actions                                    approvals.ts approvalNeeded
   │  executes as SERVICE ROLE: mostly PostgREST update/insert sequences,
   │  four SQL RPCs (bulk_record_sales, sell_books, settle_book, desk_money)
   ▼
Postgres (Supabase)
   tables: config, agents, app_users, books, tickets, audit_log, book_history,
           ticket_history, permissions, pending_approvals, prize_types, prizes, winners,
           check_in_reports, check_in_dates, round_snapshots, payments      schema.sql
   append-only by trigger: book_history, ticket_history, payments, round_snapshots
   RLS: enabled on every table; base tables REVOKED from `authenticated`; reads only
        through views                                                        rls.sql:89–105, :593
```

Deployment: frontend built by `.github/workflows/deploy.yml` with three repository
*variables* (URL, publishable key, Google client id) and no secrets; weekly encrypted
backup by `backup.yml`; the function deployed with `supabase functions deploy`. No
service-role credential exists anywhere under `src/` (grep, verified).

### 2. Domain model as implemented

| Concept | Where it lives | Mutable? |
|---|---|---|
| Book | `books` row: `status`, `held_by_agent`, `declared_sold`, `amount_due`, `amount_paid`, `settled_at`, `settled_by_agent` (schema.sql:116–140) | **Yes — overwritten** |
| Ticket | `tickets` row: `status`, buyer fields, `sold_by_agent`, `amount`, `payment_status`, `sold_at`, `version` (schema.sql:148–167) | **Yes — overwritten** |
| Custody | `books.held_by_agent` only. **Tickets carry no holder column.** | Yes |
| Book movement history | `book_history` (from_agent, to_agent, action, by, note) — written by **application code** in 7 places, not by trigger | Append-only (trigger, schema.sql:317–331) |
| Ticket change history | `ticket_history` — written by an **AFTER UPDATE trigger** on `tickets` capturing status/buyer/seller/amount/payment/notes (schema.sql:367–390) | Append-only (:413–427) |
| Money handed in | `payments` (agent, amount ≠ 0, source hand/settlement/writeoff, `reverses`, `client_key`) | Append-only (:929–942) |
| Settlement figures | columns on `books` | **Mutable; cleared by restock** (books.ts:580–585) |
| Per-round frozen figures | `round_snapshots` | Append-only |
| Audit log | `audit_log` (action, details jsonb, email) — 22 write sites | **No append-only trigger** |
| Permissions | `permissions` (action, role, allowed) | Mutable, sup-only to change |

**Custody is book-level.** The inventory unit that moves is the book. A ticket's holder is
*inferred* as "the holder of its book". There is no individual-ticket movement anywhere in
the code (grep for redistribute/transfer-ticket: none).

### 3. Lifecycles as implemented

**Book status** (`check` constraint, schema.sql:122): `Unassigned → Out → Returned → Settled`,
plus `Lost`, `Void`.

| Transition | Code | FROM-state guard |
|---|---|---|
| Unassigned → Out (issue) | books.ts:141 | `status !== 'Unassigned'` refused unless `force` (:94) |
| Out → Returned | books.ts:409 | filters to `Out` (:396) |
| Out → Out (transfer holder) | books.ts:67 | filters to `Out` (:201) |
| Returned/Settled → Settled (settle) | functions.sql:543 | `FOR UPDATE` on the book (:399); re-settle needs `p_force` (:405) |
| Returned/Settled → Unassigned (restock) | books.ts:580 | refuses if money still owed (:520–545); reverses settlement payments |
| any → Lost / Void / Out / Returned / Unassigned | `set_book_status`, books.ts:614–657 | **none** — any state to any of five, with a reason string; Lost/Void voids unsold tickets |

There is **no state machine**. Transitions are enforced per-handler, and one handler
(`set_book_status`) can produce any transition, including `Settled → Out`, which reopens a
book while its settlement columns remain populated.

**Ticket status** (schema.sql:153): `Available | Reserved | Sold | Donated | Void`. A ticket
has no "returned", "with seller", or "at desk" state — location is the book's.

### 4. How the key operations actually work

**Single sale** (tickets.ts `sellTicket`): a compare-and-set —
`update … where idx = ? and version = expected` (tickets.ts:238–269). Correct and atomic
for one ticket. Two findings:
- `amount: Number(p.amount ?? cfg.TICKET_PRICE)` — **the client may supply the amount and
  nothing bounds it** (tickets.ts:40). A negative or arbitrary amount is accepted.
- `payment_status` defaults to `'Paid'` on every sale (tickets.ts:41), and
  `desk_money()` counts `payment_status = 'Paid'` as collected cash (functions.sql:628).
  At the desk, "sold" **is** "paid" unless the caller says otherwise.

**Bulk sale** (`bulk_record_sales`, `sell_books`, functions.sql): each ticket's status is
read into a variable and checked (functions.sql ~113–125, ~300–312), then updated by
number/idx with **no `FOR UPDATE` and no status predicate on the UPDATE** (:180, :368).
Two concurrent batches for the same ticket both pass the check and both write; the second
overwrites the first buyer. `ticket_history` records both writes, so it is *detectable*
after the fact but not *prevented*. The single-sale path is safe; the bulk paths are not.

**Issue / return / transfer / restock** (books.ts): sequences of separate PostgREST
statements under the service role — e.g. issue: `update books` (:66) then
`insert book_history` (:90); return: `update books` (:409), `update tickets` (:415),
`insert book_history` (:29 of that function). **No transaction wraps them.** A failure
after the first statement leaves custody changed with no history row, or a returned book
whose reservations were never released. Inventory generation is the same shape:
`books` inserted in batches of 500, then `tickets` (people.ts:786, :799).

**Settlement** (`settle_book`, functions.sql:375–620): the one operation that is a real
transaction with a row lock. It (a) marks every unreturned ticket `Sold` with
`source='settlement'`, (b) writes `declared_sold/amount_due/amount_paid` **onto the book**,
(c) inserts a `payments` row (`source='settlement'`) and reverses the previous one on
re-settle, (d) writes `book_history`. The declared figures are the financial fact and they
live in mutable columns; `restock` nulls them (books.ts:580–585). The ledger row survives
and is reversed, so money is recoverable; the *count* declared is not, except via the
`book_history` note text.

**Payments** (money.ts `recordPayment`, `insertPayment`): amount must be > 0 and finite;
scoped by `visibleAgents`; **idempotent** via `client_key` + partial unique index
(schema.sql:970–972) with replay detection (money.ts insertPayment); reversal creates a
negative row with `reverses = id`, one reversal per row enforced in code
(money.ts reversePayment). This is the best-designed write path in the system.

**Balances** (`agent_money` view, migration `20260917150000`): expected follows
`tickets.sold_by_agent` for open books and `books.settled_by_agent`/`amount_due` for
closed ones; collected = `books.amount_paid` (settled) + `payments where source='hand'`;
written off = `payments where source='writeoff'`; outstanding = the difference. The view
is `revoke all … from authenticated` (rls.sql:472) and only the function reads it.

**Returns / redistribution**: a book is returned whole (`return_books`), counted in whole
(`settle_book`), put back whole (`restock_books`), issued whole. **Partial return of a
book's unsold tickets to a different seller is not representable.** The only workaround is
restock → issue, which destroys the settlement columns and moves *every* unsold ticket.

### 5. History and mutability — what an auditor gets today

| Question | Answerable? | From |
|---|---|---|
| Who held book B, when | Yes | `book_history` (app-written; complete only if every handler wrote it and the write did not fail) |
| Who held **ticket** T at time X | Only by inference from its book's history | no ticket-level record |
| Every change to ticket T's status/buyer/amount | Yes, trigger-written | `ticket_history` |
| Every cash movement, reversals included | Yes | `payments` |
| What was declared at count-in | Current value only; prior values in `book_history.note` text | mutable `books` columns |
| Who made an admin change | Yes, but the log can be edited | `audit_log` has no append-only trigger |
| Physical inventory per holder at time X | **No** — reconstructable only by replaying book moves and assuming books were whole | |

**Update/delete inventory** (grep, verified): three hard deletes exist —
`check_in_reports` rows (deadlines.ts:528), `check_in_dates` (:1340), `prizes`
(prizes.ts:265). All other writes are updates to `books`, `tickets`, `agents`,
`app_users`, `config`, `permissions`, `pending_approvals`, `winners`, `prizes` and inserts
to the ledgers. The four append-only tables are protected; **`audit_log`, `books` and
`tickets` are not.**

### 6. Authorization as implemented

- Identity is the JWT e-mail claim matched to `app_users.email` (rls.sql:57–81). Google is
  the only sign-in (supabaseAuth.js:117 `signInWithIdToken({provider:'google'})`).
- Base tables are unreadable by `authenticated` (rls.sql:593). All browser reads go through
  views; all writes go through the function. Tested: "nobody can write through the browser
  path", "the base tables are not reachable at all" (test-rls.sh).
- `tickets_readable` is **SECURITY DEFINER** (rls.sql:180) with **no row restriction for
  agents**: an agent's browser downloads every active ticket's number, status, seller,
  amount, payment status and recorder, with buyer name/phone/zone blanked for books they do
  not currently hold (rls.sql:185–201). This is a **documented decision** (rls.sql:160–179:
  column masking cannot be expressed in RLS; an invoker view would expose phone numbers to
  viewers) and is **tested** ("an agent sees every ticket's status and nobody else's
  buyer"). The RLS policy that *would* scope agents to their books (`tickets_read`,
  rls.sql:115–122) is unreachable from the browser because the table is revoked.
- Consequence for the stated requirement: an agent **can** see other agents' inventory
  positions and sale amounts, not their buyers. Whether that is acceptable is a policy
  question; it contradicts "access only to their own tickets" as written.
- `book_history` action: `roles: null` (index.ts:245) — any signed-in user, any book; buyer
  details masked by `seesBuyer` (books.ts:66–71). Custody trail is world-readable inside
  the app.
- `agent_statement` allowed a helper to read any seller's account until 2026-09-17
  (fixed, reports.ts). Same shape of bug may exist elsewhere: every `roles: […]` list is a
  *role* check; **object-level** checks are per-handler and ad hoc (`visibleAgents`,
  `agentBooks`, `seesBuyer`).
- Permission overrides (gate.ts:92–105): a **superadmin** (sup-only `set_permission`) can
  set `allowed = true` for any non-`sup` action for any role, including granting `agent`
  or `viewer` the right to `settle_book`, `record_payment` for anyone, or `restock_books`.
  `sup` actions cannot be granted (:98). No guard prevents widening writes to read roles.
- Two-person control: `approvalNeeded` covers multi-book `set_book_status`,
  `restock_books`, `reverse_payment`, `settle_book` (conditional), `upsert_user`,
  `write_off`. **Only the superadmin can decide** (`decide_approval` is `sup`,
  index.ts:337) and **the superadmin bypasses the check for their own actions**
  (index.ts:1044). One person can therefore perform every destructive operation alone;
  what protects history is the append-only triggers, not the workflow.
- `read_audit` is admin-only (index.ts:208); the log has no integrity protection.
- Unknown e-mails are refused (`NOT_AUTHORIZED`), pending/suspended accounts refused with
  a status (gate.ts:71–80). No self-registration path exists.

### 7. Money as implemented

- All money columns are `numeric(12,2)` (schema.sql; grep for float types: none).
- Rounding happens in TypeScript (`round2`) for computed values and in SQL for stored ones.
- **Currency is a single global config value** (`CURRENCY`, schema.sql:1114); no row
  carries a currency. Acceptable for one raffle; not for a multi-tenant deployment.
- Negative values: `payments.amount <> 0` (schema.sql:834) — negatives are reversals by
  convention, not by type. `tickets.amount` has **no check** and accepts client input.
- Duplicate payments: prevented by `client_key` when the client sends one
  (RecordPayment.vue:84 does). Duplicate *sales* through the single path are prevented by
  version CAS; through bulk paths they are not.
- Expected vs received are separate concepts in the ledger (`expected` from tickets/books,
  `collected` from payments) — **good** — but `payment_status` on the ticket row reintroduces
  the conflation at the desk (§4).
- Write-off requires a ≥10-character reason, a positive balance, and a second person
  (money.ts writeOff; approvals.ts). Good.

### 8. Reconciliation and exceptions as implemented

- Book-level variance is **computed** in `book_ledger` (`variance_sold`, `variance_amount`,
  `unidentified_sold`, schema.sql:244–259). Declared-vs-verified returns are computed by
  `return_check` (books.ts) against `check_in_reports`. Per-agent expected/collected/
  outstanding is computed by `agent_money`. Per-round figures are frozen in
  `round_snapshots`.
- There is **no exception record**: nothing has a state of open / under review / resolved /
  waived, nothing references the offending ticket/book/payment, and nothing stops a
  discrepancy from being silently absorbed by the next settlement or restock.
- The `return_check` handler and `write_off` are the closest things to an exception
  workflow, and `return_check` has no screen.

### 9. Finalization

`SALES_CLOSE_DATE` refuses new sales after a date, with an admin `force` override
(schema.sql:1119; deadlines.ts:270; tickets.ts assertStillSelling). There is **no event
close**: after the draw, books can still be restocked, settled, and statuses rewritten.

### 10. Concurrency and idempotency summary

| Path | Atomic? | Locked? | Idempotent? |
|---|---|---|---|
| `sell_ticket` / reserve / release / correct | single UPDATE with version CAS | via CAS | version conflict returned; no client key |
| `bulk_record_sales`, `sell_books` (SQL) | one transaction | **no** | no |
| `settle_book` (SQL) | one transaction | `FOR UPDATE` on book | re-settle requires `force`; settlement payment reversed |
| `issue/return/transfer/restock/set_book_status` (TS) | **no** — 2–4 statements | no | no |
| `record_payment` | single INSERT | n/a | **yes** (`client_key`) |
| inventory generation | batches of 500 | no | guarded by count checks |

Delta sync (`read_delta`) returns at most 1000 rows with **no continuation** (index.ts:625);
a client that missed more than 1000 changes silently keeps stale rows until a full reload.

### 11. Portability as implemented

- The function depends on `npm:@supabase/server`'s `withSupabase({auth:'user'})`
  (index.ts:25). Whether that package runs identically on self-hosted edge-runtime is
  *unverified*; the test stub (tests/stubs/supabase-server.js) shows the contract is small
  (JWT verification + a service-role client on `ctx`).
- Google is the only auth provider. Storage bucket `branding` is assumed to exist and be
  public (branding.ts:28, :165); **its creation and policy are not in any migration**.
- DDL is maintained **twice**: `schema.sql` / `functions.sql` / `rls.sql` as full-state files
  *and* `supabase/migrations/*` as deltas; the documented build applies the three files
  then `db push` (SETUP.md:27–33). Every migration re-declares what schema.sql already
  states, relying on `if not exists`. Three migrations sit uncommitted in
  `supabase/migrations.pending/`.
- No seed data for a development database; fixtures live in tests.
- Docker is used only by `test-functions.sh`. Self-host deployment is undocumented.

### 12. What is good and should be kept

- Default-deny database: base tables revoked, reads through views, writes through one
  authenticated function. Tested.
- Append-only ledgers with trigger enforcement for `payments`, `ticket_history`,
  `book_history`, `round_snapshots`.
- Payments: idempotency key, typed `source`, reversal by reference, write-off with reason
  and second person.
- Single-ticket writes by version compare-and-set.
- `settle_book` as a locked transaction that writes its own ledger row.
- Expected/collected/written-off kept as three quantities.
- Trigger-written ticket change history (cannot be skipped by a handler).
- 86 JS suites + SQL suites for functions and RLS; a culture of tests that fail on the
  bug that was reported.
- Cost profile: static hosting + one function + Postgres.

### 13. Requirements gap analysis

| Requirement | Status | Evidence |
|---|---|---|
| Ticket has unique traceable identity | **Met** | `tickets.number` unique; dense `idx` |
| Complete history of every ticket **and** book | **Partially met** — changes yes, custody no | §5 |
| Movement recorded as append-only custody transactions, not overwrites | **Not met** — `held_by_agent` overwritten; history is a separate app write | §2, §4 |
| Partial books: return / redistribute individual tickets | **Not met** — book is the indivisible unit | §4 |
| Organizer-retained tickets, office sales | Met by convention (`Unassigned` book at desk) | tickets.ts, functions.sql:339 |
| Ticket-sale ≠ money-received | **Partially met** — ledger separates them; ticket `payment_status='Paid'` default and `desk_money` collapse them at the desk | §7 |
| Financial movements with source, destination, actor, reference | Partially — `payments` has agent, by, book, source; no destination concept; refunds not modelled | schema.sql:817–970 |
| Reconciliation as first-class | **Not met** — computed views, no records, no states | §8 |
| Append-only business history | **Partially** — 4 tables protected; `books`/`tickets`/`audit_log` mutable; 3 hard deletes | §5 |
| Agents cannot reach others' records | **Not met as written** — statuses/amounts of all tickets are readable; buyer PII is not | §6 |
| Sysadmin cannot silently rewrite | Partially — ledgers protected; the superadmin bypasses approvals and can rewrite `books`/`tickets` state through `set_book_status` | §6 |
| No double-sale under concurrency | **Met on single path, not on bulk paths** | §10 |
| Idempotent writes | Payments yes; everything else no | §10 |
| Money in fixed precision, explicit currency | Numeric yes; currency global | §7 |
| Coherent state machine | **Not met** | §3 |
| Exception management | **Not met** | §8 |
| Finalization | **Not met** | §9 |
| Auditor can reconstruct a ticket's custody | **Not met** | §5 |
| No secrets in the static bundle | **Met** | grep |
| Portable to another organisation | Partially — bucket, auth provider, runtime wrapper, double DDL | §11 |

---

## Part II — Target architecture

The recommendation is a **relational, append-only ledger** design inside the existing
Postgres/Edge-Function monolith. Not event sourcing (ADR-1). The shape:

```
SOURCE OF TRUTH (append-only, trigger-protected, every row: at, by, client_key, reverses)
  ticket_movements     who held each ticket, and every hand-over            (custody ledger)
  sales                each sale of a ticket, at a price, by a holder       (sales journal)
  money_entries        every unit of money: receipt, refund, write-off,     (financial journal)
                       reversal, adjustment — agent or desk, with reference
  settlements          each count-in: declared figures, variance, batch     (reconciliation record)
  reconciliation_exceptions  open → review → resolved | waived, with refs   (exception ledger)
  audit_log            append-only (add the trigger it lacks)

PROJECTIONS (mutable, rebuildable, maintained inside the same transaction)
  tickets.holder, tickets.status, tickets.sale_id
  books.status (derived: all tickets' holder/status), books.holder (only if uniform)
  agent_balances (view)  expected − received − written_off, drillable to rows
```

### 14. Domain model

- **Event** — one raffle. `config` becomes an `events` row when multi-event is wanted;
  until then, a single implicit event with an explicit `state` (`open | closing | finalized`).
- **Book** — a *grouping* of tickets with a printed number. Not an inventory unit.
- **Ticket** — the inventory unit. Has exactly one **holder** at any time.
- **Holder** — `desk` (the organiser/office) or an `agent`. Modelled as a text key
  (`'desk'` or `agent_id`) so the ledger never has a null holder.
- **Movement** — a ticket passing from one holder to another. Whole-book operations are
  batches of N movements sharing a `batch_id`.
- **Sale** — a ticket sold by its holder at a price to a buyer. Establishes a receivable
  against the holder unless the holder is the desk (cash is the desk's).
- **Money entry** — cash or a non-cash adjustment moving between a party and the desk.
- **Settlement** — a declared count against a batch of returned tickets, producing a
  variance and, if needed, exceptions.
- **Exception** — a discrepancy with a lifecycle and references.

### 15. Database model (proposed)

```sql
-- CUSTODY LEDGER
create table ticket_movements (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ticket_idx  integer not null references tickets(idx),
  from_holder text not null,              -- 'desk' | agent_id
  to_holder   text not null,
  kind        text not null check (kind in ('issue','return','transfer','restock','lost','found','correction')),
  batch_id    uuid not null,               -- one per user action (whole book = N rows, one batch)
  by_user     text not null,
  reason      text not null default '',
  reverses    bigint references ticket_movements(id),
  client_key  text,
  check (from_holder <> to_holder or kind = 'correction')
);
create unique index on ticket_movements (client_key) where client_key is not null;
-- projection kept in the same transaction by the movement function:
alter table tickets add column holder text not null default 'desk';

-- SALES JOURNAL
create table sales (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  ticket_idx  integer not null references tickets(idx),
  holder      text not null,              -- who sold it (custody at the time, asserted in-transaction)
  price       numeric(12,2) not null check (price >= 0),
  currency    text not null,
  buyer_name  text not null default '', buyer_phone text not null default '', buyer_zone text not null default '',
  kind        text not null check (kind in ('sale','donation','settlement_declared')),
  by_user     text not null,
  reverses    bigint references sales(id),
  client_key  text,
  batch_id    uuid
);
create unique index on sales (ticket_idx) where reverses is null and not exists_reversal(id);  -- see ADR-4
-- projection: tickets.status, tickets.sale_id

-- FINANCIAL JOURNAL (payments, generalised)
create table money_entries (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  party       text not null,              -- agent_id or 'desk'
  kind        text not null check (kind in ('receipt','refund','write_off','adjustment','reversal')),
  amount      numeric(12,2) not null check (amount <> 0),
  currency    text not null,
  method      text not null default 'cash',
  reference_kind text, reference_id bigint,   -- settlement / sale / batch it settles
  by_user     text not null,
  reason      text not null default '',
  reverses    bigint references money_entries(id),
  client_key  text,
  authorised_by text                      -- second person, when required
);
-- `payments` migrates into this 1:1 (hand→receipt, settlement→receipt with reference, writeoff→write_off)

-- RECONCILIATION
create table settlements (
  id bigint generated always as identity primary key, at timestamptz default now(),
  book_idx integer not null, holder text not null, batch_id uuid not null,
  declared_sold integer not null, counted_sold integer not null, stubs_returned integer not null,
  amount_due numeric(12,2) not null, amount_received numeric(12,2) not null,
  variance_sold integer not null, variance_amount numeric(12,2) not null,
  by_user text not null, reverses bigint references settlements(id)
);
create table reconciliation_exceptions (
  id bigint generated always as identity primary key, at timestamptz default now(),
  kind text not null,          -- missing_ticket | duplicate_sale | invalid_transfer | payment_mismatch | unmatched_payment | count_mismatch | unexplained_balance | post_finalization
  state text not null default 'open' check (state in ('open','review','resolved','waived')),
  ticket_idx integer, book_idx integer, agent_id text, sale_id bigint, money_entry_id bigint, settlement_id bigint,
  detail jsonb not null, opened_by text not null,
  resolved_at timestamptz, resolved_by text, resolution text, resolving_entry bigint
);
-- state changes are INSERTED as new rows referencing the prior (append-only), or a
-- companion exception_events table; either way no UPDATE.

-- FINALIZATION
create table event_state (
  id int primary key default 1 check (id = 1),
  state text not null check (state in ('open','closing','finalized')),
  finalized_at timestamptz, finalized_by text, authorised_by text
);
create table adjustments (          -- the only door after finalization
  id bigint generated always as identity primary key, at timestamptz default now(),
  requested_by text not null, authorised_by text not null, reason text not null,
  affected jsonb not null            -- the ledger rows written under this adjustment
);
```

Every business ledger gets the same three triggers the four existing ones have
(no update, no delete, no truncate), plus a **finalization guard** trigger that refuses
inserts when `event_state.state = 'finalized'` unless the row carries an `adjustment_id`.

`books.held_by_agent`, `declared_sold`, `amount_due`, `amount_paid`, `settled_*` and
`tickets.payment_status` become **derived or deprecated** (ADR-3).

### 16. State machines

**Ticket custody** (from `ticket_movements`): `desk ⇄ agent`, `agent → agent` (transfer),
plus `lost` (to holder `'lost'`) and `found` (back). A ticket has exactly one holder because
its holder is the `to_holder` of its latest non-reversed movement; the projection column is
asserted equal inside every movement function.

**Ticket status** (from `sales`): `available → sold | donated` by a sale; `sold → available`
only by a reversing sale row; `void` by a movement of kind `lost` or an explicit void sale
row; `reserved` stays a projection-only soft state with an expiry (it is a UI hold, not a
business fact).

**Book status** becomes **derived**: `unassigned` (all tickets at desk, none sold),
`out` (any ticket with an agent), `returned` (all at desk, some sold, no settlement),
`settled` (settlement row exists and no later movement), `lost` (any ticket lost),
`mixed` (tickets with different holders — the partial case the current model cannot say).
It is a view, so it cannot be wrong and cannot be rewritten.

**Event**: `open → closing → finalized`; `closing` refuses sales and issues, allows returns,
settlements, payments; `finalized` refuses everything except `adjustments`.

### 17. Transactions (server-side, one SQL function each)

| Function | Rows written (one transaction) | Guards |
|---|---|---|
| `move_tickets(batch, from, to, kind, tickets[], reason, client_key)` | N `ticket_movements` + N `tickets.holder` | `SELECT … FOR UPDATE` on each ticket; assert `holder = from`; assert no unsold-but-sold conflict; event open |
| `issue_book / return_book / transfer_book` | thin wrappers over `move_tickets` with the book's unsold tickets | |
| `record_sale(ticket, holder, price, buyer, kind, client_key)` | 1 `sales` + `tickets.status/sale_id` | `FOR UPDATE`; assert `holder = tickets.holder` and status available; price from config unless admin override, never from an agent; event open |
| `record_sales(batch)` | N of the above in one transaction, all-or-nothing | same, per row |
| `reverse_sale(sale_id, reason, client_key)` | reversing `sales` row + projection | one reversal per row (unique partial index) |
| `record_money(party, kind, amount, reference, client_key, authorised_by?)` | 1 `money_entries` | kind rules: refund/write_off/adjustment need `authorised_by`; write_off ≤ outstanding |
| `settle(book, holder, declared, received, client_key)` | movements (returns) + declared sales for unidentified stubs + settlement + money receipt + exceptions for variance | `FOR UPDATE` on the book's tickets; declared ≤ tickets not returned |
| `open_exception / resolve_exception / waive_exception` | exception rows | resolve must reference the ledger row that resolves it |
| `finalize_event(authorised_by)` | `event_state` | refused while open exceptions exist or any agent balance ≠ 0 without a write-off |

The Edge Function keeps authentication, role resolution, permission overrides and the
two-person workflow, and becomes a **dispatcher to these functions**. Its own PostgREST
`update`/`insert` sequences on business tables are removed.

### 18. Financial ledger model (ADR-2)

Single-entry typed journal, not double-entry. Every `money_entries` row has one party and
a signed amount relative to the desk; the desk is the implicit contra-account. Balances:

- `expected(agent)` = Σ `sales.price` where `holder = agent` and not reversed
- `received(agent)` = Σ `money_entries.amount` where `party = agent`, kind ∈ {receipt, refund(−)}, not reversed
- `written_off(agent)` = Σ kind = write_off
- `outstanding(agent)` = expected − received − written_off
- `desk_cash` = Σ receipts from all agents + Σ desk sales − refunds
- Event: expected = Σ all sales; received = Σ all receipts; unresolved = Σ outstanding + open exceptions

Every figure is a `SUM` over rows the reader can list. The `agent_money` view survives as
the projection; its definition changes from "two regimes" to one, because a settled book's
declared money is now `sales` rows of kind `settlement_declared` and its cash is a receipt
row — the same tables as everything else.

### 19. Reconciliation model

Three independent reconciliations, then a cross-check, each a SQL function returning rows
and writing exceptions:

1. **Ticket reconciliation** per holder: issued − returned − transferred-out + transferred-in
   − sold = in custody; must equal count of `tickets.holder = holder and status available`.
2. **Financial reconciliation** per agent: as §18; a nonzero outstanding after finalization
   without a write-off is an exception.
3. **Book reconciliation**: tickets in book = sold + available + void + lost, each ticket in
   exactly one; settlement variance = declared − counted.
4. **Cross-check**: Σ `sales.price` by holder = expected by agent; every receipt references a
   settlement or an agent; every settlement's `amount_received` equals its receipt row.

Aggregates on the Money and Books screens are sums over these functions' rows; each cell
opens the rows.

### 20. Authorization model

- Reads: an agent's view of tickets is filtered by **`tickets.holder = their id`** *or*
  **a movement row names them** (they may see the history of tickets they have held, with
  buyer details only for sales they made). This is expressible in RLS once custody is a
  column on the ticket; the definer view keeps column masking for viewers.
- Object-level checks move from ad-hoc handler code into the SQL functions
  (`assert holder = current_agent()` for agent-initiated sales; `visibleAgents` becomes a
  DB function used by both the function and the views), so the function cannot forget one.
- Permission overrides may **narrow** but not **widen**: an override can set `allowed=false`
  for any role; `allowed=true` is honoured only for roles the registry already lists.
- Superadmin: cannot bypass `approvalNeeded`; destructive actions need a second admin.
  If the organisation has one admin, the approval can be a delayed self-approval (24h) —
  still logged, still reversible — rather than a silent bypass.
- `book_history` / movement trail: readable for books/tickets the caller holds or has held,
  and for organisers.
- `audit_log`: append-only trigger; `read_audit` stays admin-only.

### 21. Audit model

Two layers, both append-only: the **business ledgers** (movements, sales, money, settlements,
exceptions) which answer *what happened to the inventory and money*, and `audit_log` which
answers *who pressed what* (including reads of sensitive reports and permission changes).
Every ledger row carries `by_user`; every second-person action carries `authorised_by`;
every correction carries `reverses` or `adjustment_id`. `ticket_history` is retained as a
belt-and-braces change log of the projection, and a nightly job asserts the projection
equals the replay of the ledgers (a test that runs in production).

---

## Part III — Architecture decision records

### ADR-1 — Relational append-only ledger, not event sourcing, not the status quo

*Problem.* Custody is an overwritten column; history is a separate write that can be
skipped or fail; partial books cannot be represented.

*Alternatives.*
- **Conventional relational (status quo, hardened)**: keep `held_by_agent`, wrap handlers in
  transactions, add a trigger that writes `book_history`. Cheapest. Still cannot express a
  ticket held by someone other than its book's holder, so partial return/redistribution
  stays impossible without restocking a whole book.
- **Immutable relational ledger (recommended)**: `ticket_movements` / `sales` /
  `money_entries` as the truth; `tickets.holder`, `tickets.status`, `books.status` as
  projections maintained in the same transaction. Queries stay SQL; RLS can filter on the
  projection column; reconciliation is `SUM` and `GROUP BY`; replay is `ORDER BY id`.
- **Full event sourcing**: one `events` stream, projections rebuilt by consumers. Provides
  nothing further here — the ledgers *are* the events, typed per domain — and costs a
  projection framework, eventual consistency in the UI, and a rebuild story a volunteer
  team cannot operate.

*Decision.* The ledger design. It gives the same guarantees as event sourcing (every state
reconstructable from immutable rows) with plain tables, constraints and triggers.

*Trade-offs.* Whole-book operations write N rows instead of one (N = 10; at 2,000 books
the movement table is tens of thousands of rows — trivial). Two places hold the holder
(ledger and projection); the same transaction and a replay check keep them equal.

*Effect on code.* books.ts issue/return/transfer/restock and functions.sql sell_books/
bulk_record_sales/settle_book are replaced by the functions in §17; the Edge Function
handlers become validation + one RPC call each.

### ADR-2 — Typed single-entry journal rather than double-entry

*Problem.* Money has one ledger (`payments`) with good properties but no refunds, no
adjustments, no destination, and settlement figures duplicated onto `books`.

*Alternatives.* Double-entry (accounts, debits/credits, journals) — correct and general, and
also a second vocabulary for volunteers, a chart of accounts to maintain, and no question
this raffle asks that a typed journal cannot answer. A typed single-entry journal with the
desk as the implicit contra-party gives receipts, refunds, write-offs, adjustments and
reversals, each referenced, each summable.

*Decision.* Generalise `payments` into `money_entries` (kinds, party, reference,
`authorised_by`). Keep `client_key` and `reverses` exactly as they are. Derive
receivables from `sales`, never store them.

*Trade-offs.* Cannot express money between two agents directly (it goes via the desk),
which matches how a raffle works.

### ADR-3 — Books become groupings; book status becomes a view

*Problem.* `books.status` and settlement columns are mutable facts; `set_book_status` can
make any transition; partial books are unrepresentable.

*Decision.* Custody and sales are per ticket; `books` keeps its printed identity and a
derived `status` view (including `mixed`). Settlement figures move to `settlements`.
`set_book_status` is replaced by `move_tickets(kind='lost')` and `reverse_*`. `restock`
becomes "move all unsold tickets desk→desk with kind=restock" — i.e. nothing — because a
settled book's unsold tickets are already at the desk; issuing them again is just a
movement. The whole restock/clear-settlement operation disappears.

*Trade-offs.* Screens that group by book keep working (grouping is a `GROUP BY book_idx`);
the "Books" grid gets a new colour for `mixed`.

### ADR-4 — One live sale per ticket, enforced by the database

*Decision.* A partial unique index on `sales(ticket_idx)` for rows that are not reversed and
have no reversal; implemented as a boolean `live` column maintained by the reversal
function (Postgres cannot index a `NOT EXISTS`), or equivalently by keeping `reverses` on the
*reversing* row and a `reversed_by` back-pointer set in the same transaction. Either way a
second live sale is a constraint violation, not a code path.

### ADR-5 — All business writes are SQL functions; the Edge Function dispatches

*Problem.* Multi-statement writes from TypeScript are not transactions; object-level checks
are ad hoc.

*Decision.* Every write is one SQL function (`security definer`, `revoke execute from
authenticated`, called only by the service role) taking a `client_key`. The function:
`FOR UPDATE`, asserts preconditions, writes ledger + projection, raises on violation.

*Trade-offs.* More PL/pgSQL, tested by the existing SQL suite pattern (`test-functions.sh`)
which already runs each case against a real database. Less TypeScript.

### ADR-6 — Portability: no proprietary runtime helper, migrations as the single DDL source

*Decision.* Replace `withSupabase` with `Deno.serve` + JWT verification through
`supabase-js` `auth.getUser(token)` (works on Cloud and self-hosted edge-runtime); make the
auth provider configurable (Google; e-mail OTP as the no-Google fallback); create the
`branding` bucket and its policy in a migration; generate `schema.sql` from `supabase db
dump` for reading and stop hand-maintaining it; add `supabase/seed.sql`; document
`supabase start` (Docker) as the self-host path and list what differs (*unverified* until
run: edge-runtime version, storage API surface).

---

## Part IV — Testing strategy

**Invariants** (each a SQL-suite case against a real database, plus a JS suite where a
screen is involved):

1. A ticket has exactly one holder: `count(distinct holder)` per ticket over live movements
   = 1; two concurrent `move_tickets` on the same ticket — one succeeds, one fails.
2. A ticket cannot be sold twice without a reversal: second `record_sale` raises; after
   `reverse_sale`, a new sale succeeds; both rows remain.
3. A sale by a non-holder is refused (agent A sells a ticket held by B; desk sells a ticket
   that is out).
4. Nothing disappears: `UPDATE`/`DELETE`/`TRUNCATE` on every ledger raises; `audit_log`
   included.
5. No contradictory states: a ticket that is sold has no later movement without a
   reversal; a lost ticket has no live sale.
6. Every movement has source ≠ destination; every sale references an existing ticket;
   every receipt references an agent or a settlement.
7. Projection equals replay: `tickets.holder` and `tickets.status` rebuilt from the ledgers
   equal the columns, on every fixture and nightly in production.
8. Duplicate submissions: the same `client_key` twice → one row, second call returns
   `replayed`; two different keys for the same ticket sale → constraint violation.
9. Concurrency: two sessions (two `psql` connections with `pg_sleep` between read and write,
   or `SELECT … FOR UPDATE NOWAIT`) on bulk sale, movement and settlement.
10. Money: negative price refused; agent-supplied price ignored; overpayment produces a
    negative outstanding and an exception; partial payment leaves the remainder; write-off
    needs authorisation and cannot exceed outstanding; refund needs authorisation.
11. Finalization: `finalize_event` refused with open exceptions; after finalization every
    business write raises; an `adjustments` row with two people permits one write and
    records the affected rows.
12. Authorization (RLS suite): an agent reads only tickets they hold or have held; cannot
    read another agent's balance, statement, or buyers by any id; a helper cannot read any
    balance; permission override cannot widen a write to `viewer`.

**The end-to-end scenario** (one SQL suite case, asserted at every step):

> One book of ten. Issue all ten to A (10 movements, one batch). A sells four (4 sales,
> expected(A)=40). A returns six (6 movements to desk; A holds 0 unsold, 4 sold).
> Redistribute three to B (3 movements). B sells two (expected(B)=20). Desk sells one
> (expected(desk)=10, received(desk)=10 as a desk receipt). A hands in 30 (receipt;
> outstanding(A)=10 → exception `unexplained_balance` opened by reconciliation). B hands in
> 25 (outstanding(B)=−5 → exception `payment_mismatch: overpayment`). Organiser refunds B 5
> with authorisation. A's 10 written off with reason and authorisation. Finalize.
>
> Assert: every ticket has a complete movement chain from creation; no ticket has two
> holders at any instant; inventory: desk holds 2 available, B holds 1 available, 7 sold;
> expected 70, received 65 + 10 desk, refunded 5, written off 10, outstanding 0; every
> exception resolved or waived; every aggregate equals the sum of listed rows.

Then the same with mistakes: a duplicate sale submission, a sale of a ticket A no longer
holds, a settlement declaring 5 when 4 stubs are back (variance exception), a payment
recorded twice with the same key, a reversal of the wrong sale and its correction, a
movement after finalization (refused), an adjustment after finalization (recorded).

---

## Part V — Migration strategy and roadmap

### 22. Migration strategy — incremental, parallel ledger, no big bang

The live raffle has ~20,000 tickets, ~2,000 books, real sellers and real money. The
history it holds is **book-level and whole-book** (no partial operation has ever been
possible), which makes the backfill exact rather than a guess:

1. **Add the ledgers empty** (`ticket_movements`, `sales`, `money_entries`, `settlements`,
   `reconciliation_exceptions`, `event_state`, `adjustments`) with their triggers. No
   existing table changes. Deploy; nothing reads them yet.
2. **Backfill from what exists**, in one reviewed transaction, as rows marked
   `kind='backfill'` with `reason` naming the source row:
   - each `book_history` issue/transfer/return/restock → N movements for the book's tickets
     at that time (every one was whole-book, so N = the book's tickets);
   - each ticket currently `Sold`/`Donated` → one `sales` row from `ticket_history`'s first
     transition to Sold (its `by_user`, `to_amount`, `at`), holder = the book's holder at
     that time from the movement chain; `source='settlement'` rows become
     `kind='settlement_declared'`;
   - each `payments` row → one `money_entries` row (1:1 mapping of `source` to `kind`,
     `reverses` preserved, ids preserved as `legacy_id`);
   - each settled book → one `settlements` row from its current columns and the
     `book_history` settle note.
   Then run the replay check (§Testing #7): the projected holder/status must equal today's
   `books.held_by_agent`-derived holder and `tickets.status` for every ticket. **Any mismatch
   is a finding, not something to fix in the backfill** — it goes into
   `reconciliation_exceptions` as `open` and to the organiser.
3. **Dual-write** — the existing handlers call the new SQL functions in the same request
   *and* keep their old writes, behind a flag; the nightly replay check compares. Two weeks
   of agreement in production.
4. **Switch reads**: `agent_money`, `book_ledger`, Money and Books screens read the ledgers
   and projections. Old columns still written.
5. **Switch writes**: handlers become dispatchers (ADR-5). `held_by_agent`, `declared_*`,
   `amount_*`, `payment_status` become read-only mirrors maintained by trigger from the
   projection, then dropped a release later.
6. **Deprecate**: `set_book_status`, `restock_books`, the TS multi-statement paths,
   `bulk_record_sales`/`sell_books` bodies (kept as thin wrappers over `record_sales`).

What cannot be migrated automatically: nothing structural. What *needs a human*: any
ticket whose replayed holder disagrees with its book's holder (there should be none; if
the count is not zero, the migration stops at step 2).

### 23. Roadmap (priority order)

**Phase 0 — close the holes that exist today** (days; no schema redesign)
- `bulk_record_sales` / `sell_books`: `SELECT … FOR UPDATE` per ticket and
  `AND status = 'Available'` on the UPDATE with a rowcount check.
- `sell_ticket`: server-side price from config; admin-only override; reject ≤ 0.
- `audit_log`: append-only triggers.
- Wrap issue/return/transfer/restock in SQL functions (transactions) — the bodies can be
  the existing statements moved verbatim.
- `read_delta`: return `hasMore` and a cursor; client loops.
- Remove the three hard deletes (soft-delete rows or reverse them).
- Permission overrides: refuse `allowed=true` for a write action on `viewer`/`agent`
  unless the registry lists that role.
- Commit or drop the three pending migrations; stop double-maintaining `schema.sql`.
- Tests for each of the above (the SQL suite already has the harness).

**Phase 1 — custody ledger** (ADR-1, ADR-3): tables, triggers, `move_tickets`, backfill,
projection, replay check, RLS filtered by `tickets.holder`, partial return and
redistribution in the UI (pick tickets, not only books).

**Phase 2 — sales and money journals** (ADR-2, ADR-4): `sales`, `money_entries`,
`settlements`; `record_sale(s)`, `reverse_sale`, `record_money`, `settle`; migrate
`payments`; retire `payment_status`, `declared_*`; Money screen reads the journal
(the per-seller statement built on 2026-09-17 becomes a `SELECT` over `money_entries`
and `sales`).

**Phase 3 — reconciliation and exceptions**: the four reconciliation functions,
`reconciliation_exceptions` with state rows, screens: exceptions list, drill-down from
every aggregate, `return_check` and `chase_today` given screens.

**Phase 4 — finalization**: `event_state`, `adjustments`, guard triggers, `finalize_event`,
the post-finalization workflow; approvals no longer bypassable by the superadmin.

**Phase 5 — portability and operations**: drop `npm:@supabase/server`, configurable auth
provider, bucket in a migration, `seed.sql`, generated `schema.sql`, self-host runbook
verified by actually running `supabase start`, backup restore drill in CI.

**Phase 6 — UI**: agent view of "my tickets" instead of the whole snapshot (the client
snapshot becomes holder-scoped for agents, which also removes the definer view's
over-exposure); reconciliation dashboard; book grid `mixed` state.

Each phase ships behind the same discipline the repository already has: a failing test
first, a scratch-checkout run of the full suite, a replay check against production data
before the switch.

---

*What this review did not do:* run the self-host path, benchmark the ledger tables at
scale, or read the three uncommitted pending migrations in detail. Those are noted as
unverified above rather than asserted.
