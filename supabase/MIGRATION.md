# Moving off Google Sheets

**This happened.** The raffle runs on Supabase now; what follows is the case that
was made for it, kept because the measurements are still the reason and because
anybody asking "why not just keep the Sheet" deserves the numbers rather than an
opinion. Read it as a record, not a proposal — the sentence that used to stand
here said nothing in this directory was live, and it stopped being true the day
the function was deployed.

For what the migrated system does to keep its own figures honest, and what was
still wrong with it afterwards, see [AUDIT.md](AUDIT.md). For setting a project
up from nothing, see [SETUP.md](../SETUP.md).

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

## The measurement, run

Against a local Postgres 16 with PostgREST in front of it — the same two pieces
Supabase runs — seeded with a raffle the size of the real one: 20,000 tickets,
2,000 books, 1,505 sold.

| What the app asks for | Postgres | Rows |
|---|---|---|
| Boot: totals only, no rows | 5ms | — |
| One ticket by number | 4ms | 1 |
| Buyer by misspelled name (*Thuang*) | 3ms | 50 |
| Buyer by phone | 3ms | 5 |
| One book, every ticket in it | 1ms | 10 |
| What changed in the last hour | 4ms | 500 |
| Book ledger, all 2,000 books | 20ms | 2,000 |
| Money owed, by seller | 2ms | 200 |
| Draw readiness: sold with no phone | 1ms | 0 |
| Record one sale (write) | 4ms | — |

Median across every query: **4ms**, against an Apps Script floor of **1,100ms**
for a call that reads nothing.

### Then run again on the real thing

The numbers above are local, with no network in them. Repeated against the
actual project — Supabase, `ap-southeast-1` (Singapore), same 20,000 tickets:

| What the app asks for | Hosted | Worst of 5 |
|---|---|---|
| Boot: totals only, no rows | 45ms | 149ms |
| One ticket by number | 40ms | 130ms |
| Buyer by misspelled name (*Thuang*) | 40ms | 56ms |
| Buyer by phone | 47ms | 122ms |
| One book, every ticket in it | 34ms | 83ms |
| What changed in the last hour | 57ms | 143ms |
| Book ledger, 2,000 books | 85ms | 110ms |
| Money owed, by seller | 40ms | 74ms |
| Draw readiness: sold with no phone | 47ms | 131ms |
| Record one sale (write) | 40ms | 102ms |

**Median 45ms, worst case 149ms, against an Apps Script floor of 1,100ms.**
About 24x on the cheapest possible comparison, and far more than that on
anything that actually touches the spreadsheet.

The gap between 4ms local and 45ms hosted is the network — roughly 40ms of
Singapore round trip, exactly as predicted. It is the price of the data living
somewhere else, and it is paid once per request rather than per row.

**One thing still to correct for:** a serverless function in front of this adds
its own cold start, typically 100–300ms on a first hit and warm afterwards.
Even so, a request lands well under half a second against 1.1 seconds warm and
9 seconds cold.

And the margin is not the point. **The browser stops downloading 2.2 MB on
every boot** — search becomes a question with an answer instead of fetching
everything and sifting it locally. That is the change a volunteer on a phone
would actually feel, and no amount of backend tuning reaches it while the data
lives in a Sheet.

**Noted while measuring:** PostgREST caps a response at 1,000 rows by default,
so the book ledger came back paginated. Fine for the app, which never needs all
2,000 at once, but the port must page rather than assume one response holds
everything.

To reproduce, or to measure against a real Supabase project:

```bash
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...        # Settings -> API -> service_role
node supabase/bench.mjs --seed
node supabase/bench.mjs
```

For a local container instead, set `SUPABASE_REST_PREFIX=/` — bare PostgREST
serves at the root, Supabase serves under `/rest/v1/`.

## The decision that is not about speed

The tickets table holds every buyer's name and phone number, and the README is
explicit that many of these people are refugees. Today that data sits in a
Google Sheet the organisation already controls, under an account it already
administers. Moving it to Supabase moves it to a third party, in a region that
has to be chosen, under a processing agreement somebody should read.

That is a data-protection decision, and it should be made deliberately rather
than arrive as a side effect of wanting the app to feel faster. It may well be
fine — Supabase is a normal commercial processor and the data is modest — but
"we did it for the latency" is not the reasoning anybody wants to give
afterwards if it is questioned.

Points worth settling before the data moves: which region, who holds the
service-role key, how long the data is kept after the draw, and whether the
organisation needs a written processing agreement.

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
