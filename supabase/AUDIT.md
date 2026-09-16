# Raffled on Supabase — ticket and financial integrity audit

Audited 2026-09-15 against commit `44480d3` plus the uncommitted working tree.
Scope: the Supabase stack only — `schema.sql`, `rls.sql`, `functions.sql`, the
migrations, the `api` Edge Function, and the Vue client as it talks to them.
The Apps Script twin is out of scope except where a parity test keeps the two
honest.

Every claim below was either read from the code at a named path or reproduced
against a throwaway Postgres 16 with the repo's own SQL applied. Reproductions
are labelled **E1–E7**; the script is `scratchpad/evidence.sql` in the session
scratch area and its cases are being added to `supabase/test-functions.sh`.

---

## A. Executive summary

**Is the system safe enough to operate a real charity raffle? YES, WITH CONDITIONS.**

The foundations are sound and unusually well reasoned for a volunteer project:
ticket identity is arithmetic and locked; every browser write goes through one
gate with server-side roles; the database is default-deny with masked views;
sales, bulk entry and settlement are single transactions; a sold ticket cannot
exist without a findable buyer; corrections to money are reversals, not
deletes; destructive bulk changes need two people; and the super admin lives
outside the database.

The conditions are that four holes in money accountability and one in draw
readiness are closed before books start coming back in volume. Today the raffle
has 328 books out and 2 tickets sold (dump of 2026-09-14), so the exposure is
still small and the fixes are cheap. Reproduced on a clean database:

| # | What happens today | Consequence |
|---|---|---|
| E1 | Marking a book **Lost** makes its recorded sales worth RM0 in every money report | A seller's debt silently leaves the chase list |
| E2 | Settlement **un-sells** a ticket that had a real buyer if its number is typed as "came back" | The buyer's name and phone are erased with no trace but a version bump |
| E3 | **Transferring** a partly-sold book moves the value of the old seller's sales onto the new holder | Debt is reassigned with nobody deciding it |
| E4 | Sales declared at settlement without ticket rows ("leftovers lost") count as money but **are not in the draw**, and readiness says READY | Paid-for entries cannot win |
| E5–E7 | No row lock on settlement, forced re-settle overwrites figures in place, and a ticket keeps only its latest state | Concurrent and historical questions cannot be answered from the data |

Plus one live discrepancy: a ticket sold at the desk with no seller (there is
one in production, `KS-00218`) is counted as expected money that can never be
recorded as collected, so the home screen shows RM10 "still owed" by nobody.

None of these lose data that cannot be reconstructed from `book_history` and
`audit_log`, but all of them produce a reassuring total that is wrong. The
recommended Phase 1 (section P) closes every one of them with additive SQL and
small handler changes. Nothing needs paid infrastructure.

---

## B. Current architecture

```
Browser (Vue 3, GitHub Pages)
   │  reads: PostgREST directly, through four filtered views (RLS, masked)
   │  writes + reports: POST /functions/v1/api  {action, payload}
   ▼
Edge Function `api` (Deno, @supabase/server, auth:'user')
   ├─ gate.ts        allowlist row → role; registry + permissions table; super admin from env
   ├─ index.ts       REGISTRY of 55 actions; two-person approval check; TTL caches (30s/60s)
   ├─ tickets.ts     sell/reserve/release/correct/void (version CAS), bulk + whole-book via RPC
   ├─ books.ts       issue/transfer/return/settle(RPC)/restock/setStatus/history
   ├─ money.ts       payments ledger (record, reverse, list), collected-by-agent
   ├─ reports.ts     outstanding, overdue, missing-contact, draw-ready, statement, export, winners
   ├─ deadlines.ts   check-in rounds, roll, final deadline, record_check_in
   ├─ people.ts      agents, users, permissions, expand/active/ceiling, receipt
   └─ approvals.ts   request/list/cancel/decide (executes as requester, re-checked)
   ▼  service-role key (bypasses RLS; scoping done in code)
Postgres (Supabase free tier)
   tables: config, agents, app_users, books, tickets, audit_log, book_history,
           permissions, pending_approvals, winners, check_in_reports, payments
   functions: active_tickets(), bulk_record_sales(), sell_books(), settle_book(),
              app_role(), app_agent_id(), auth_email(), server_now(), bump_version()
   views: tickets_readable, book_ledger (browser), book_ledger_all (function),
          agents_readable, config_readable
```

**Identity.** `tickets.idx` is the primary key and the printed number is a
unique column derived from prefix/start/padding (`people.ts:expandTickets`).
Numbering locks once tickets exist; growth is append-only with a schema-drift
check. Books are `idx`-keyed with `first_ticket`/`last_ticket` text.

**Data volume (2026-09-14 dump).** 20,000 tickets in 2,000 books, 10,000 in
play, 4 agents, 3 users, 328 books out, 2 sold. Price RM10.

**Deployment.** GitHub Actions builds with `VITE_BACKEND`, URL and publishable
key from repository variables; tests run in CI; secret key only in
`supabase/.env.local` (gitignored) and function secrets. No secret found in
`src/`, `dist/` or `index.html`.

**Schema management is split.** `supabase/migrations/` holds five files
(2026-09-15). `schema.sql`, `functions.sql` and `rls.sql` are applied by hand.
`book_ledger_all`, the helper masking in `tickets_readable`, `agents.status`
and the `superadmin` role value exist **only** in the hand-applied files. The
production dump of 2026-09-14 15:05 predates all of them (`book_ledger_all`
entered the repo two hours after the dump), so neither the dump nor the
repository can say whether they are live now. (Read-only verification against production
was blocked by the session's permission policy; see section M for the query to
run.)

---

## C. Feature / integrity matrix

Scale: 5 excellent · 4 strong · 3 adequate · 2 weak · 1 critical weakness · 0 missing.

| Area | Existing feature | Implementation | Integrity | Risk | Recommendation |
|---|---|---|---:|---|---|
| Ticket numbering | Derived, locked, append-only growth | `people.ts:expandTickets`, `schema.sql` PK+unique | 5 | Padding cannot widen (documented) | Keep |
| Ticket uniqueness | PK on idx, unique on number | `schema.sql` | 5 | — | Keep |
| Book ↔ ticket relationship | `book_idx` FK; `first/last_ticket` text | `schema.sql`; no CHECK that tickets fall inside the book's range | 3 | Drift only via manual SQL | Good-to-have constraint |
| Released vs generated | `ACTIVE_TICKETS` line; RLS and handlers respect it | `active_tickets()`, `setActiveTickets` refuses hiding sold/out | 4 | 30s config cache | Keep |
| Ticket state transitions | Available/Reserved/Sold/Donated/Void; handlers gate each | `tickets.ts`; version CAS | 3 | Admin correction may set any status; settlement may un-sell (E2) | Improve |
| Ticket history | **None**; latest state only | `History.vue` says so explicitly | 1 | Overwritten buyers unrecoverable except via audit details | **Must add** |
| Sold-needs-contact | DB CHECK constraint | `tickets_sold_needs_contact` | 5 | Settlement exception is deliberate and marked | Keep |
| Book custody | `held_by_agent` + `book_history` rows for issue/transfer/return/settle/restock/status | `books.ts` | 4 | `issue` with `force` overwrites a holder without `from_agent` | Minor fix |
| Custody acknowledgement | Printable/WhatsApp handover receipt | `handoverReceipt` | 3 | No recorded acknowledgement by the seller | Good-to-have |
| Transfers | `transfer_books`, history from→to | `books.ts` | 2 | Moves recorded sales' value to new holder (E3) | **Must fix** |
| Returns (organiser) | `return_books` → Returned; holds released | `books.ts` | 4 | — | Keep |
| Returns (seller declaration) | `check_in_reports.books_back` | `deadlines.ts` | 3 | Declaration and physical return are never linked per book | Improve (Phase 3) |
| Settlement | One transaction; asks for unsold; never overwrites a real buyer with a placeholder | `settle_book()` | 3 | E2, no row lock (E6), re-settle in place (E5) | **Must fix** |
| Void/Lost/Damaged | `void_ticket` (super admin), `set_book_status` Lost/Void voids unsold | `tickets.ts`, `books.ts` | 3 | Lost zeroes expected money (E1) | **Must fix** |
| Expected money | `book_ledger` one-source rule | `rls.sql` view, SQL numeric | 3 | E1; office sales unaccountable | **Must fix** |
| Collected money | `books.amount_paid` + `payments` ledger | `money.ts:collectedByAgent` | 4 | Settlement payment row written outside the transaction | Should fix |
| Payments / reversals | Append-only ledger, reversal rows, reason required | `money.ts` | 4 | Zero-amount re-settle deletes a row | Should fix |
| Seller balances | `report_outstanding`, `agent_statement`, `owedBy` | `reports.ts`, `money.ts` | 3 | Keyed on book holder, so transfer moves debt | Must fix (via transfer guard) |
| Shortage / overage | Variance per book; `stillOwed` after payment | view + handlers | 4 | — | Keep |
| Money arithmetic | numeric(12,2) in DB; JS Number + `round2` in handlers | `money.ts`, `reports.ts` | 3 | Float sums; safe at this magnitude | Should move sums to SQL |
| Reporting periods | Configurable rounds from two dates + cadence; `check_in_reports` per (agent, round) | `deadlines.ts` | 4 | — | Keep |
| Report content | Seller's declaration only (books back, sold, paid, note) | `recordCheckIn` | 2 | Overwritable, deletable (undo, audited); no reconciliation snapshot | Should add snapshots |
| Report immutability | None; live figures everywhere | — | 1 | "What did report 2 say" is unanswerable | Should add |
| Pre-draw reconciliation | `report_draw_ready` blockers | `reports.ts` | 3 | Misses E4, pending approvals, office money | **Must fix** |
| Exceptions UI | Home "needs looking at", Draw blockers, Sellers chase lists | `store.js:attention`, `Draw.vue`, `Agents.vue` | 4 | — | Keep |
| Audit trail | `audit_log` insert-only via service role; every write action logs | all handlers | 3 | Coarse (counts, not books) for bulk ops; readable by super admin only | Improve |
| Authorization (server) | Registry roles + permissions table + super-admin bar + approvals | `gate.ts`, `index.ts` | 5 | Recorder without agent link cannot record payments (contradicts registry comment) | Keep; minor fix |
| Authorization (DB) | Default deny; base tables revoked; masked views; tested as wrong user | `rls.sql`, `test-rls.sh` | 5 | Depends on hand-applied file being live | Keep; put under migration |
| Concurrency | Ticket writes CAS on version; RPCs transactional | `tickets.ts`, `functions.sql` | 2 | Book ops check-then-write; settle no lock | Should fix |
| Delete policy | Only two deletes: undo check-in (audited), settlement payment at RM0 | `deadlines.ts`, `money.ts` | 4 | — | Keep; replace the RM0 delete |
| Automation | None server-side; WhatsApp links; banner counts on poll | client | 2 | Manual backup only | Good-to-have |
| Backups | `backup.sh` (manual, verified non-empty) | `supabase/backup.sh` | 3 | Free tier has no automatic backups | Should schedule |
| Tests | 84 Node suites; 76 SQL + 37 RLS cases on real Postgres | `tests/`, `supabase/test-*.sh` | 4 | Holes above have no tests; baseline red from in-flight work | Add |

---

## D. Ticket integrity analysis

**Guaranteed today (evidence):**
- Unique numbers and books: primary keys and unique indexes (`schema.sql:99-136`).
- No overlapping ranges: books and tickets are generated arithmetically in one
  pass (`expandTickets`), never inserted between; growth refuses on drift.
- Correct prefix/padding: derived once; `NUMBERING_TOO_SMALL` refuses growth
  the padding cannot express.
- Controlled transitions on the single-ticket path: `assertCanWrite` covers
  released line, closed books, agent ownership, out-with-seller
  (`tickets.ts:75-155`); `correct_ticket` refuses Void/Donated by correction.
- Concurrency on a ticket: `update … where idx = ? and version = ?` (CAS).
- A sold ticket has a findable buyer: DB CHECK, tested in `test-functions.sh`.

**Not guaranteed:**
- **History is overwritten, not preserved.** `correct_ticket` writes before/after
  into `audit_log.details` (only super admin can read it); settlement,
  restock and release overwrite buyer fields with nothing but a version bump
  (E2, E7). "Who held this ticket / who was on it in March" is not answerable
  from the ticket. Searched: `schema.sql`, all migrations, `books.ts`,
  `tickets.ts`, `History.vue` — no ticket-level history exists.
- **Settlement un-sells recorded buyers.** `settle_book` resets any ticket
  named in `p_unsold` that is not Void, including Sold/Donated with a real
  buyer (E2). The client only warns about numbers from the wrong book.
- **Admin correction can set any non-Void/Donated status**, e.g. Sold→Available
  with buyer fields left in place (`tickets.ts:277-291`). Audited, but a status
  change should be a first-class action.
- **No constraint that a ticket's `book_idx` matches its number range.** Only
  reachable by hand SQL; low risk.

---

## E. Money integrity analysis

**Model as implemented.** Expected money is derived from ticket rows for open
books and from declared figures for closed ones (`book_ledger` "one-source
rule"). Collected is `books.amount_paid` (set at settlement) plus every
`payments` row whose source is not `settlement`. Outstanding = expected −
collected, per book holder, rounded to cents in TypeScript.

```
book.counted_expected = Settled/Lost ? coalesce(amount_due,0) : Σ ticket.amount (Sold/Donated)
agent.expected        = Σ counted_expected over books where held_by_agent = agent
agent.collected       = Σ counted_collected over those books + Σ payments (source ≠ settlement)
agent.outstanding     = round2(expected − collected)
classification        = outstanding > 0 SHORT · = 0 BALANCED · < 0 OVER · books Out/Returned PENDING
```

**Holes found:**
1. **Lost books (E1).** `set_book_status → Lost` never writes `amount_due`, so
   `coalesce(amount_due,0)` is 0 and recorded sales vanish from the seller's
   expected. A single book needs no approval. Fix: use declared figures only
   when they exist, else the recorded rows.
2. **Money follows the book, not the seller (E3).** Expected is grouped by
   `held_by_agent`. A transfer moves the value of sales made by the previous
   holder (tickets still say `sold_by_agent = A`) onto the new holder. The
   designed lifecycle for a partly-sold book is return → settle → restock →
   issue; a direct transfer bypasses it. Fix: refuse transfer of books with
   recorded sales, with the path stated.
3. **Office sales have no custodian.** A recorder with no agent link sells a
   ticket from a book that is not Out: `sold_by_agent` is null. The book
   ledger counts its amount as expected; nothing ever counts it as collected;
   `report_outstanding` skips it (holder null) while `report_draw_ready` sums
   it. Production has one such ticket. Fix: treat desk sales marked Paid as
   collected at the desk, and show a "Sold at the office" line.
4. **Declared-but-unidentified sales (E4)** are money (`amount_due`) but not
   entries (no ticket rows). Correct as accounting; wrong as draw readiness
   (section L).
5. **Settlement payment row is a side effect** (`noteSettlementPayment`)
   outside the RPC transaction; on re-settle it is updated in place, on RM0 it
   is deleted. Totals do not depend on it (they use `amount_paid`), so the
   damage is a payment list that can disagree with the book. Should move into
   `settle_book`.
6. **Float arithmetic.** Per-agent sums are JS doubles rounded with `round2`.
   For 20,000 × RM10 this is exact in practice; it is still the wrong tool.
   Should move to a SQL view.

**Sound:** numeric(12,2) columns; payments cannot be zero; reversals point at
the original and both survive; reversal requires a reason; a reversed row
cannot be reversed twice; helper cannot record money against another seller.

---

## F. Custody / seller accountability

- Issue creates `book_history(issue, to_agent, by_user, note)` and a printable
  receipt naming issuer, receiver, range, count, value and due date. There is
  no recorded acknowledgement by the seller (paper signature is the mechanism).
- Transfer preserves from→to in history. Return and settle record `from_agent`.
- `issue_books` with `force` (admin, never sent by the client) can overwrite an
  `Out` book's holder; the history row carries `to_agent` only.
- Who was responsible at a point in time is answerable **per book** from
  `book_history`; **per ticket** only by inference.
- `report_outstanding` is scoped by role in code (`visibleAgents`), the
  ledger view by RLS for direct reads. Both were tested.

---

## G. Reporting integrity

Reports found: `report_outstanding`, `report_overdue`, `report_missing_contact`,
`report_draw_ready`, `agent_statement`, `export_entries`, `handover_receipt`,
`deadline_status`, `list_payments`, `book_history`, `read_audit`, and the
per-round `check_in_reports`.

| Report | Source | Method | Live/snapshot | Mutable after | Auditable | Reproducible |
|---|---|---|---|---|---|---|
| Outstanding | `book_ledger_all` + `payments` + `agents` | SQL view + TS sums | Live | yes | via underlying rows | only "as of now" |
| Overdue | `book_ledger_all` | SQL | Live | yes | — | as of now |
| Missing contact | `tickets` | SQL filter, masked | Live | yes | — | as of now |
| Draw ready | counts + ledger + payments | TS | Live | yes | — | as of now |
| Statement | `book_ledger_all` | TS sums | Live | yes | — | as of now |
| Check-in round N | `check_in_reports` | seller's declaration | Stored | **yes** (re-record replaces; undo deletes, audited) | partly | the declaration only |
| Book history | `book_history` | append-only rows | Stored | no path deletes | yes | yes |
| Audit | `audit_log` | append-only | Stored | no path deletes | super admin only | yes |

**Can a submitted Report #1 silently change because tickets were edited
later?** Yes for every live report; for the check-in row, its own figures do
not change but nothing records what the *system* said at that moment. This is
a weakness for "what changed after the report". The round mechanism itself is
good: rounds are numbered, dates derived, silence survives the roll.

---

## H. Critical weaknesses, ranked

**P0 — Critical**
1. `report_draw_ready` can say READY while declared-but-unidentified sales
   exist (E4) — paid entries not in the pool — and while approvals are pending
   that would change books after the draw. Office-sale money makes it say NOT
   READY forever for the opposite reason. (`reports.ts:reportDrawReady`)

**P1 — High**
2. Lost book zeroes recorded sales in every money figure (E1). (`rls.sql` views)
3. Settlement erases a recorded buyer without trace (E2). (`functions.sql:settle_book`)
4. Transfer reassigns debt silently (E3). (`books.ts:transferBooks`)
5. No ticket-level history (E7). (schema)
6. Schema drift risk: `rls.sql` (views, masking, `book_ledger_all`) and parts
   of `schema.sql` (`agents.status`, `superadmin`) are not under migration
   control; production state unverifiable from the repo.

**P2 — Medium**
7. `settle_book` has no `FOR UPDATE`; two settlements of one book interleave (E6).
8. Book operations are check-then-write without a status predicate; two
   organisers can issue the same run. (`books.ts:issueBooks` etc.)
9. Settlement payment row written outside the transaction; re-settle mutates,
   RM0 deletes. (`money.ts:noteSettlementPayment`)
10. No reconciliation snapshot per round; check-in rows replaceable.
11. Audit trail coarse for bulk book operations (counts, not numbers) and
    readable only by the super admin; an organiser cannot review changes.
12. Backups manual; free tier has none.
13. Tests cover none of E1–E7; baseline currently red because another session
    is mid-change (`Branding.gs` / `loadgs.cjs`).

**P3 — Low**
14. Per-agent sums in JS doubles.
15. A recorder with no agent link cannot record a payment (`visibleAgents`
    returns `[]`), contradicting the registry comment and the visible button.
16. `issue_books` with `force` records no `from_agent`.
17. Agents can read every other seller's phone through `agents_readable`.
18. No CHECK that a ticket's number lies within its book's range.
19. README/SETUP still lead with the Google Sheet; a new organiser would set
    up the wrong backend.
20. Documentation drift inside `rls.sql` (found by a peer session, confirmed):
    the `grant select on config to authenticated` is revoked four lines later,
    so `config` is not directly readable and the comment saying the grant
    removes the dependency on `active_tickets()` being SECURITY DEFINER is
    void. The views work only because `functions.sql` declares it so. Also:
    Supabase's linter flags `config_readable` and `tickets_readable` as
    security-definer views. `config_readable` can become `security_invoker`
    with a column grant on `config(key, value)`; `tickets_readable` must stay
    definer. Stated precisely, because the loose version invites the wrong
    test: the view's own CASE keeps masking even as an invoker view, so
    checking the view alone suggests the conversion is safe. The leak is that
    an invoker view *requires* a grant on `tickets`, and `tickets_read` does
    not mask `buyer_phone` — a viewer would then read all 60 of 60 real
    numbers off the base table, reopening the hole closed in `0974416`.
    Measured by a peer session, both paths. Both belong in a
    migration, not in the hand-applied file (item 6).

---

## I. Recommendations by priority

### MUST HAVE (Phase 1 — implemented in this session where marked ✔)
- ✔ Ledger: Lost books use recorded rows when nothing was declared (E1).
- ✔ Settlement: refuse to un-sell a ticket with a recorded buyer; name them;
  lock the book row (E2, E6).
- ✔ Transfer: refuse books with recorded sales; state the return→settle path (E3).
- ✔ Ticket history: append-only `ticket_history` filled by trigger; returned
  with `book_history` (E7).
- ✔ Draw readiness: block on unidentified declared sales and pending
  approvals; count desk sales marked Paid as collected; show the desk line in
  outstanding (P0).
- ✔ Issue: conditional update on `status = 'Unassigned'`, conflict reported.
- ✔ Tests for each of the above, SQL and handler level.
- Put `rls.sql` and the schema deltas under a migration and verify production
  (query in section M). Not done here: needs the live project.

### SHOULD HAVE (Phase 2)
- Round snapshots: at `roll_check_in`, store per-seller expected/collected/
  outstanding/books-out for the closing round (`round_snapshots`), so "what
  did round N say" and "what changed since" are answerable.
- Settlement payment row inside `settle_book`; re-settle as reversal + new row.
- `agent_money` SQL view so money sums are numeric in the database.
- Organiser-readable change log (a filtered `read_audit` for admins without
  emails of the super admin's actions), and book numbers in bulk audit rows.
- Scheduled backup (GitHub Actions cron calling `backup.sh` with a repository
  secret, artifact retained privately) — free.

### GOOD TO HAVE (Phase 3–4)
- Per-book return verification: `return_books` records `verified_by`; the
  seller's `books_back` declaration compared with organiser returns in the
  round view.
- Seller acknowledgement on the receipt (a tap "I received these" by a
  signed-in agent, or a recorded "signed paper" flag).
- Reminder generation list (who to message today) — the WhatsApp links exist;
  a single "chase today" list would finish it.
- Recorder payment recording for any seller when at the desk (policy decision).

### FUTURE / SCALE
- Partition or archive `ticket_history` only past ~1M rows (not this raffle).
- Server-side pagination for `report_outstanding` beyond ~2,000 sellers.

### DO NOT IMPLEMENT
- Event-sourcing the whole ledger, message queues, realtime subscriptions to
  approvals, blockchain, a separate accounting service, per-ticket barcodes
  (the numbers are already unique and printed).

---

## J. Final reconciliation design (as it should read on the Draw screen)

Ticket side (deterministic, from `tickets` where `idx ≤ active_tickets()`):
```
in play      = available + reserved + sold + donated + void          (always true; statuses are exhaustive)
draw pool    = sold + donated
unresolved   = reserved
             + available/reserved tickets in books that are Out or Returned   (paper not yet counted)
             + declared_sold − recorded_sold over Settled/Lost books          (sold, not identified)
```
Seller side (per agent): books out · books settled · tickets sold (recorded) ·
unidentified declared · expected · collected · outstanding · reports missed.

Money side: expected · collected (books + payments + desk-paid) · outstanding ·
short (outstanding > 0) · over (< 0).

Exceptions list (each with a count and a link): missing contact, unsettled
books, reserved holds, unidentified declared sales, money outstanding,
pending approvals, final deadline not passed, sellers who never reported.

---

## K. Configurable reporting design

Already present and adequate: rounds are derived from `CHECK_IN_DATE`,
`CHECK_IN_EVERY_MONTHS` and `FINAL_DEADLINE`; `CHECK_IN_ROUND` numbers them;
`check_in_reports(agent_id, round)` holds one declaration per seller per
round; the roll advances the round without touching old rows.

Add, not replace: `round_snapshots(round, agent_id, taken_at, books_out,
recorded_sold, expected, collected, outstanding, missed_before)` written by
`roll_check_in` for the round being closed, unique on (round, agent_id), never
updated. Lifecycle then reads: OPEN (current round) → CLOSED (snapshot exists).
Corrections after closing are visible as the difference between the snapshot
and the live figures.

---

## L. Pre-draw readiness rules

READY FOR DRAW if and only if all of:
1. `FINAL_DEADLINE` set and passed.
2. No book is Out or Returned.
3. No ticket is Reserved.
4. Every Sold/Donated ticket has a name and a usable phone.
5. Σ over Settled/Lost books of (declared_sold − recorded_sold) = 0.
6. Outstanding money = 0 across every seller and the desk, or every non-zero
   line has been explicitly written off (reversal/adjustment with reason).
7. No pending approval.
8. Every seller who held books answered the final round (advisory in Phase 1).

The decision is computed, never a checkbox. Rules 5–7 are added in this
session; 1–4 and 6 (without desk money) existed.

---

## M. Database changes (migration `20260915233000_integrity_phase1.sql`)

Additive and idempotent. **DATA LOSS RISK: NO** — no column dropped, no row
deleted, views recreated with the same columns plus none removed.

- `ticket_history` table (id, at, ticket_idx, book_idx, from/to status,
  from/to agent, from/to buyer name and phone, amount, payment status, source,
  by_user, note) + `tickets_record_history` AFTER UPDATE trigger firing only
  when one of those fields changes. RLS enabled, revoked from anon and
  authenticated (server-only, like `audit_log`).
- `book_ledger` and `book_ledger_all` recreated: `counted_sold` /
  `counted_expected` prefer declared figures only when `declared_sold is not
  null`; new columns `unidentified_sold`, `unidentified_amount`.
- `settle_book` replaced: `select … for update`; refuses `p_unsold` entries
  that are Sold/Donated with `source <> 'settlement'` (code
  `SOLD_TICKET_NAMED_UNSOLD`, listing them).
- Also re-applies `functions.sql` in full, as earlier migrations do.

To verify what production has today (read-only, in the SQL editor):
```sql
select to_regclass('public.book_ledger_all'), to_regclass('public.payments'),
       to_regclass('public.check_in_reports'), to_regclass('public.ticket_history');
select column_name from information_schema.columns where table_name='agents' and column_name='status';
```

---

## N. Code changes

- `supabase/functions/api/books.ts` — `transferBooks` guard `BOOK_HAS_SALES`;
  `issueBooks` conditional update + `BOOKS_CHANGED_MEANWHILE`; `bookHistory`
  returns `tickets` (ticket trail for the book).
- `supabase/functions/api/reports.ts` — `reportDrawReady` adds unidentified,
  pending approvals, desk-paid; `reportOutstanding` adds the desk line.
- `supabase/functions/api/money.ts` — `deskCollected()` helper.
- `supabase/functions.sql`, `supabase/rls.sql`, `supabase/schema.sql` —
  canonical copies updated to match the migration.
- `supabase/test-functions.sh` — cases for E1, E2, E6, E7.
- `tests/integrity.test.mjs` — handler-level cases with the fake database.

Untouched on purpose (another session is editing them): `index.ts`,
`people.ts`, `store.js`, `Search.vue`, `Sell.vue`, `SellTicket.vue`,
`BookDetail.vue`, `Receipt.vue`, `WinnerForm.vue`, `History.vue`, `Api.gs`.

---

## O. Test plan

Tickets: numbering (exists), uniqueness (exists), allocation conflict (new),
transfer with sales refused (new), sale/void/correct (exist), settlement never
un-sells a real buyer (new), history captured for correction/settlement/void
(new), invalid transitions (exist).

Money: expected per book incl. Lost (new), payment/reversal/duplicate (exist),
desk sale collected (new), shortage/overage (exist).

Reports: rounds and roll (exist), check-in record/undo (exist), snapshot
(Phase 2), reproducibility of history (new: ticket trail order).

Reconciliation: readiness blockers for unidentified/approvals (new), missing
contact/unsettled/reserved/outstanding (exist).

Authorization: registry and RLS (exist, 37 DB cases).

Concurrency: settle row lock present (new, structural), issue conditional
update (new), ticket CAS (exists).

---

## P. Roadmap

- **Phase 0 (today)** — tests green on the committed tree; take a fresh
  `backup.sh`; run the section M verification against production.
- **Phase 1 (this session)** — the MUST HAVE list above; migration applied
  with `supabase db push` after the backup.
- **Phase 2 (before the first check-in roll)** — round snapshots; settlement
  payment inside the RPC; `agent_money` view; organiser-readable change log;
  scheduled backup.
- **Phase 3 (before books come back in volume)** — per-book return
  verification linked to the seller's declaration; write-off adjustments with
  reason so rule L6 can be satisfied honestly.
- **Phase 4** — chase-today list; acknowledgement on receipt; README/SETUP
  lead with Supabase.
- **Phase 5** — nothing justified at 20,000 tickets.

---

## Q. Final risk rating (before Phase 1)

```
Ticket integrity:       7/10   identity excellent; lifecycle and history weak
Money integrity:        5/10   four reproducible holes, all silent
Auditability:           5/10   book trail good; ticket trail absent; audit super-admin-only
Reporting integrity:    4/10   good round mechanism; nothing is ever frozen
UI/UX:                  7/10   exception-first, mobile-first, bilingual
Free-tier suitability:  8/10   indexed, paged, cached; manual backups
Overall:                6/10   YES, WITH CONDITIONS — see section A
```

Scorecard by category:

| Category | Score / 10 | Explanation |
|---|---:|---|
| Ticket identity integrity | 9 | PK + unique + locked derivation + drift-checked growth |
| Ticket lifecycle | 5 | Gated transitions, but settlement and correction can un-sell |
| Ticket custody | 6 | Book-level trail complete; ticket-level absent; force-issue gap |
| Seller accountability | 5 | Keyed on holder; transfer moves debt; office sales orphaned |
| Money integrity | 5 | E1, E3, office money; otherwise derived from rows |
| Payment reconciliation | 6 | Append-only ledger with reversals; settlement row non-atomic |
| Reporting | 5 | Rounds well designed; content is declaration only |
| Report immutability | 2 | No snapshots; declarations replaceable |
| Return handling | 5 | Organiser return is verification; not linked to declaration |
| Final reconciliation | 4 | Readiness misses E4, approvals, desk money |
| Auditability | 5 | Every write logs; details coarse; super-admin-only read |
| Authorization | 9 | Server gate + DB deny + approvals + external super admin |
| Data integrity | 6 | Good constraints; missing locks and range check |
| Concurrency safety | 4 | CAS on tickets; none on books/settle |
| Test coverage | 7 | Broad, real-Postgres; blind exactly where the holes are |
| Scalability | 8 | Fine to 100k tickets on free tier |
| UI/UX usability | 7 | Action-oriented; a few dead ends (desk row, recorder payments) |
| Operational simplicity | 5 | Hand-applied SQL; two backends; docs lead with Sheets |
| Free-tier suitability | 8 | 30s poll, one function, small tables |

---

## S. The schema file described a different database (found after Phase 1)

Raised by a peer session, reproduced and widened here. **`supabase/schema.sql`
put the four-state sign-in lifecycle on the wrong table**, in exact mirror image
of production:

| table | `schema.sql` declared | production has | handlers write |
|---|---|---|---|
| `agents` | `status` + `active` generated from it | plain `active` | `active` |
| `app_users` | plain `active` | `status` + `active` generated from it | `status` |

Postgres refuses any write to a generated column, so applying that file to a
fresh environment produced an app where:

- **adding or editing a seller failed outright** — `upsert_agent` writes
  `active` literally on both paths, giving *cannot insert a non-DEFAULT value
  into column "active"* and *column "active" can only be updated to DEFAULT*;
- **the whole Setup screen failed** — `app_users` had no `status`, which
  `list_users` selects by name, `upsert_user` writes and `set_user_status`
  writes. Nobody could be listed, admitted, paused or stopped.

Sign-in itself survived, because `resolveUser` reads `row?.status ?? (row?.active
=== false ...)` and falls back. That is why the gap was invisible from the code.

**It never showed in production, and the reason is uncomfortable: this file has
never been applied there.** The live database is internally consistent and
correct; the repository's description of it was not. A staging restore, a new
deployment or a contributor running the stack locally would each have hit it,
reported as `QUERY_FAILED` with nothing pointing at a schema mismatch.

The comment that stood on the old column anticipated exactly half of it —
*"anything still reading `active` keeps working"* — true about reads, silent
about writes, and therefore read as a clearance. Same family as the `config`
grant comment that reasoned from a privilege nobody had (item 20).

**Why it survived the suite.** `test-functions.sh` applies `schema.sql` and then
exercises only the SQL functions, so nothing ever wrote to `agents` or
`app_users` the way a handler does. One test adding a seller would have caught
it the day the generated column was written.

**Fixed** by moving the lifecycle to `app_users` and restoring `agents.active`
to a plain boolean, so the file describes production. **No migration**: the live
database already has the correct shape, so this is a correction to the canonical
file alone, and the Phase 1 migration does not embed either table.

**Guarded** by a new section in `test-functions.sh` that issues the literal
statements the handlers issue, each naming the handler and line it copies, plus
assertions that the two tables have not been confused for one another again.

And one more, in `test-rls.sh`: its fixture seeded `app_users` by writing
`active`, which no handler does. Correcting the schema made that seed fail, and
the suite went from 37 passing to 22 failing — loudly, only because its
assertions happen to expect non-zero counts. A file whose every assertion is
"and they see nothing" would have gone green on an empty fixture. It now asserts
the fixture loaded before asserting anything is denied, because **a denial over
zero rows is not a denial**.

---

## R. Re-audit after Phase 1 (same day)

Everything marked ✔ in section I is in the working tree. Verification:

| Check | Result |
|---|---|
| `supabase/test-functions.sh` (real Postgres 16) | 102 passed, 0 failed (26 new: E1, E2, E6, E7, unidentified columns, desk money) |
| `supabase/test-rls.sh` | 39 passed, 0 failed (2 new: `desk_money()` refused to viewer and admin from a browser role) |
| Migration rehearsal | Applied on the committed 2026-09-14 schema, then applied again: no error, no change on the second run. Lost-book expected went RM0 → RM20; `ticket_history` present and unreadable by `anon`/`authenticated`; `desk_money()` not executable by either |
| `tests/integrity.test.mjs` | 54 passed (transfer guard, issue race, readiness blockers, desk line, ticket trail) |
| `./tests/run.sh` | every suite green |

What each hole looks like now (same reproductions as section A):

| # | Before | After |
|---|---|---|
| E1 | Lost book → expected RM0 | Expected stays the recorded RM30; `unidentified_sold` 0 |
| E2 | Real buyer erased, version bump only | `SOLD_TICKET_NAMED_UNSOLD` names the ticket and buyer; nothing written; placeholders from an earlier settlement may still be handed back |
| E3 | Transfer moved RM30 to the new holder | `BOOK_HAS_SALES` refuses and states the path (bring back → count in → give out again); clean books still transfer |
| E4 | READY with 6 paid entries outside the pool | Blocker "tickets sold but not identified (6)"; `totals.unidentified` |
| E5 | Re-settle overwrote figures | Unchanged in Phase 1 (book_history keeps both figures); Phase 2 |
| E6 | No lock | `select … for update` on the book row |
| E7 | No trail | `ticket_history` row per material change, written by trigger, returned with `book_history` as `tickets` (buyer fields for organisers only) |
| Desk | RM10 owed by nobody | "Sold at the office" line; overview and table agree |
| Race | Two issues of one run both succeeded | Update carries `status = 'Unassigned'`; the reply names books taken meanwhile |

Not changed, deliberately: `index.ts`, `people.ts`, `store.js` and the screens
another session is editing. The client needs no change for any of the above
to take effect; two things would make it nicer and are listed for Phase 2:
`History.vue` rendering the new `tickets` trail, and `IssueBooks.vue` showing
`skipped` when it is non-empty.

To deploy: take a `backup.sh`, run the section M verification, then
`supabase db push` (or paste the migration into the SQL editor) and redeploy
the `api` function.

Scores after Phase 1:

```
Ticket integrity:       8/10   (+1) lifecycle guarded at settlement; history captured
Money integrity:        7/10   (+2) E1, E3, desk money closed; settlement row still a side effect
Auditability:           7/10   (+2) ticket trail; audit still super-admin-only
Reporting integrity:    5/10   (+1) readiness complete; still no snapshots
UI/UX:                  7/10   unchanged
Free-tier suitability:  8/10   unchanged
Overall:                7/10   YES, WITH CONDITIONS → the remaining conditions are
                               Phase 2 (snapshots, settlement payment in the RPC) and
                               verifying production carries rls.sql
```

---

## V. The roadmap, finished (2026-09-16)

Sections I and P listed eleven things across Phases 2, 3 and 4. All of them
are built, each as its own commit with its own tests. What follows is what
landed, what it cost, and — the part worth reading — what is still owed.

| Item | Commit | What it closed |
|---|---|---|
| P2.1 Round snapshots | `76feaa2` | A closed round is frozen per seller, append-only. The one item that could not be built late: a round that closes without a snapshot can never be snapshotted afterwards |
| P2.2 Settlement payment in the RPC | `7853da7` | The book said money came in over a ledger with no row for it. Written inside the transaction now; a re-settle is a reversal and a new row |
| P2.3 `agent_money` | `486210b` | Per-seller sums moved into Postgres, in the type money is stored in, spelled once instead of three times |
| P2.4 Organiser change log | `d9bfb92` | `read_audit` opened to organisers with the super admin's address scrubbed everywhere, including nested in details |
| P2.5 Scheduled backup | `28c5ce2` | Weekly, gpg-sealed before it becomes an artifact, refusing rather than falling back to plaintext |
| P3.1 Return verification | `631ca96` | The seller's declaration put beside what an organiser actually counted in |
| P3.2 Write-offs | `680db60` | Rule L6 made satisfiable without recording a payment that never happened |
| P4.1 Chase-today | `177fcd0` | Three lists merged into one line per person |
| P4.2 Seller acknowledgement | `92ef2f5` | Whose word a confirmation is, recorded so an organiser cannot manufacture the seller's |
| P4.3 Docs lead with Supabase | `009a80b` | The setup guide was building the backend with none of the integrity work |
| IssueBooks defect | `2659329` | The screen threw away every name the server sent |

### What the work kept finding

Four of the eleven turned up something the audit had not: a guard that did not
guard, or a fixture describing data the database would refuse.

- **`gateparity` never compared the two registries.** The comment above the
  action table says it "compares both gates over every action and role, so a
  value mistyped here shows up as a disagreement". It reads ONE spec — the Apps
  Script one — and hands it to both implementations, so it compared the two
  algorithms against a spec neither file necessarily held. Removing `sup: true`
  from one side should have failed it instantly and did not. The registries are
  now compared directly, with divergences required to carry a reason and to
  still BE divergent.
- **The fake database disproved two fixes before they landed.** Its `upsert`
  read `'round,agent_id'` as one column name, matched `undefined` against
  `undefined`, and merged onto the first row in the table; and it stubbed
  `settle_book` without the ledger row, so every handler test would have watched
  a settlement leave no trace and agreed. `agent_money` is COMPUTED there for
  the same reason — a seedable total is one somebody typed into a fixture rather
  than one that follows from the books.
- **Two fixtures described impossible rows.** A payment with
  `source: 'handover'`, against a column checked for `('hand','settlement')`;
  and ledger rows for sellers in no `agents` table, which the foreign key
  forbids. Both passed because the sums asked for "not settlement", which an
  invalid value satisfies as happily as a valid one.
- **The change log had never worked.** It read `e.time` against a column called
  `at`, so every line showed an em dash, and `String(jsonb)` printed
  "[object Object]". Nobody had reported it, which is what a screen only one
  person can open looks like when it is broken.

### Still owed

**Nothing here has been run against production, and two things need a person.**

1. ~~`supabase/test-functions.sh` has not been run.~~ **Done.** Both SQL scripts
   exited 0 without Docker, which is what a green suite looks like, so every
   machine without it concluded the SQL had been checked. They now fall back to
   a local Postgres and report a run that cannot happen as a failure. The first
   real run found three wrong things — cases naming a book the fixture never
   creates, cases asserting on a view the script never applied, and eight
   reading `book_ledger` where load order had been quietly deciding which of
   the two definitions they got. `test-functions.sh` 157 passed,
   `test-rls.sh` 52 passed.
2. **Four migrations are unapplied, and a decision is needed first.**
   `supabase db push` would also apply two migrations belonging to another
   session that are not committed —
   `20260916140000_ticket_history_append_only` and
   `20260916160000_check_in_report`. The first sorts BEFORE the four below, so
   it goes first whatever anybody intends. Whether they should go too is not a
   question the repository can answer.

   The four:: `20260916150000_round_snapshots`,
   `20260916170000_settlement_payment_in_rpc`,
   `20260916190000_write_off_adjustments`, `20260916210000_agent_money_view`.
   Each was rehearsed twice on a database built from the committed schema. Take
   a backup first; the section M verification still applies.
3. **The backup workflow fails every week until its secrets exist.**
   `BACKUP_GPG_PUBLIC_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`,
   `SUPABASE_SECRET_KEY`. That is deliberate — a backup nobody has finished
   setting up should be loud — but it is a red cross on the repository until
   somebody does it. The two `gpg` commands are at the top of the workflow.
4. ~~The receipt's acknowledgement UI is written and not committed.~~ **Done**
   (`294fe4c`). The exemption mechanism was written here rather than waited
   for: a screen may call a Supabase-only action if it is listed with a reason
   AND reads `isSupabase`, asserted rather than promised. Expect a conflict
   with the other session's version of the same relaxation, which is more
   general; the two lists should become one.

5. **The backup needed a pg_dump it could not have.** Supabase upgrades the
   hosted server and nobody upgrades their laptop, so `pg_dump` — which refuses
   to be older than what it dumps — could not run, and `supabase db dump`
   reaches for Docker to get a matching one. `backup.sh` now falls back to
   copying every table out with psql, which has no such rule, and says plainly
   that a fallback backup has no schema in it. Proven by round-trip rather than
   by reading: out to CSV, into a fresh database, counts equal.

6. **`supabase/backup-key.sh`** makes the gpg pair for item 3 and prints the
   four `gh secret set` commands. It deliberately uploads nothing: the private
   half must never be on the machine that takes the backups.

### One deliberate divergence, recorded

`read_audit` is organiser-readable on Supabase and super-admin-only on Apps
Script, because Supabase can take the address out per request and a sheet
cannot. It is the first entry in gateparity's `DIVERGENT` map, which now
refuses both an unexplained difference and an explanation that has outlived it.

### Scores after the roadmap

```
Ticket integrity:       9/10   unchanged since §T
Money integrity:        9/10   (+2) settlement atomic, sums in SQL, write-offs recorded
Auditability:           9/10   (+1) the change log is readable by the people running the raffle
Reporting integrity:    8/10   (+3) rounds frozen, returns verified, chase list merged
UI/UX:                  7/10   unchanged; the acknowledgement screen is still waiting
Free-tier suitability:  9/10   (+1) backups happen without anybody remembering
Overall:                8/10   The conditions in section A are closed in the repository.
                               They are not closed in production until the four
                               migrations are applied and the backup secrets set.
```
