# Moving off Google Sheets

Nothing in this directory is live. It is a proposal with a measurement attached,
so the decision can be made on numbers rather than on how things feel.

## The problem, measured

On the deployed Apps Script web app, timed against the real endpoint:

| Call | Warm | Cold |
|---|---|---|
| `ping` — touches no spreadsheet | 1.2s | 2.1s |
| `read_version` — two Script Properties, no spreadsheet | 1.1s | **9.1s** |

`read_version` is the cheapest call in the system. It reads two properties and
returns 67 bytes. **1.1 seconds is the floor**, and a cold start is nine.

Both sessions have already taken the obvious wins:

- cold boot went from three full-table reads to one
- `read_delta` went from a full-table read to zero
- issuing 21 books went from 21 spreadsheet writes to one
- the browser now caches a ticket skeleton in IndexedDB

The floor did not move, because it is not our code. Anything further is
rearranging work that costs a second before it starts.

There is a second cost that is easy to miss: **the browser downloads the whole
ticket table on every cold boot** — about 2.2 MB at 20,000 tickets. It has to,
because a spreadsheet cannot be queried, so search has to happen locally. That
is the single biggest thing making the app feel slow on a phone, and no amount
of backend tuning fixes it while the data lives in a Sheet.

## What Postgres changes

1. **Search moves to the server.** The 2.2 MB download disappears entirely. The
   app asks a question and gets an answer instead of fetching everything and
   sifting it. This matters more than the per-request latency.
2. **The variance columns stop being formulas.** They become a view: cannot be
   typed over, cannot go stale, cannot be knocked out of alignment by somebody
   sorting a column. The docs currently ask people not to touch them.
3. **A constraint the Sheet could not enforce.** A sold ticket must carry a name
   and a usable phone number. Today that is checked in three handlers and can be
   bypassed by editing a cell. In `schema.sql` it is a `CHECK` constraint — no
   code path and no person with the spreadsheet open can record a sale the draw
   cannot resolve to a findable person. For a raffle, that is the constraint
   that matters most.

## What it costs

**The Sheet stops being the live record.** The README makes a point of a
volunteer being able to open the spreadsheet and look, and that is a real
property to give up.

The mitigation is a scheduled export — a job that writes the current state into
a Sheet for reading. The human-readable copy survives; it just stops being the
thing the app depends on. Worth deciding deliberately rather than discovering
after the fact.

**Roughly a third of the code is rewritten.** The business logic ports as-is —
ticket and book arithmetic, settlement, approvals, the permission matrix, the
super-admin rules — because it is plain JavaScript with no Sheets API in it, and
it carries 1,400 assertions that keep working. What gets rewritten is the I/O
layer underneath it: `readTicketsRaw_`, `writeTicketRow_`, `cachedTicketRows_`
and their relatives.

Several things get **deleted** rather than ported, which is worth counting as a
saving:

- the whole ticket cache (`cachedTicketRows_`, the chunking around the 100 KB
  CacheService ceiling, the version-keyed invalidation) — Postgres does not need
  a cache in front of a primary-key lookup
- `scanForKey_` and the `SCHEMA_DRIFT` alarm, which exist because a spreadsheet
  row can be dragged out of position
- the script-wide write lock, replaced by row-level locking that does not make
  every writer queue behind every other writer
- `verifyIntegrity`'s row-order checks

## Sequence

1. **Create a Supabase project** (free tier is ample: 20,000 tickets is a few
   megabytes). Run `schema.sql` in the SQL editor.
2. **Measure before committing.** `node supabase/bench.mjs --seed` then
   `node supabase/bench.mjs`. It seeds a raffle the size of the real one and
   times the queries the app actually makes, printing them beside the Apps
   Script numbers above. If the result is not decisive, stop here — the work
   below is only worth it for a large margin.
3. **Port the I/O layer** behind the existing handler signatures, so the tests
   keep passing throughout.
4. **Migrate the data** once, with the Sheet kept as a read-only copy.
5. **Cut over**, keeping the Apps Script deployment reachable for a week.

## What this must not disturb

Whatever happens to the backend, these stay true, because each one exists for a
reason that was learned the hard way:

- **Ticket numbering never changes once tickets are printed.** The paper in
  somebody's hand is the real record.
- **Tickets can be created but never removed.** Lowering the count silently
  un-sells paid tickets.
- **A sold ticket needs a findable person.** Now a database constraint.
- **Destructive actions above a certain size need two people.**
- **The super admin is defined outside the database** — currently a Script
  Property. In Supabase it stays an environment variable on the server, never a
  row, so nothing inside the system can grant it.
- **Revoking access takes effect in about a minute**, not at the next deploy.

## Do not start this near the draw

The migration is a few focused days, not an afternoon. If the draw is weeks
away it will pay for itself. If it is days away, run the benchmark, keep the
result, and do the work afterwards — the current system is slow, not broken,
and a cutover mid-raffle risks the one thing that cannot be redone.
