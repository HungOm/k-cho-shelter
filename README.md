# K'Cho Shelter — ticket & book tracker

A ticket and book inventory tracker for a community fundraising raffle. Paper tickets are printed in
books, handed to agents, sold for cash, and reconciled when the books come back.

**No money moves through this system.** It records what was handed out, what was sold, and what was
handed back — so you know who holds which books, who still owes what, and who to call when a number
is drawn.

Built to run for free: a static page on GitHub Pages, a Google Apps Script web app, and a Google
Sheet as the database. Nothing to pay for, nothing to host, and the Sheet stays readable and
editable by hand.

## How it works

```
Browser (GitHub Pages)          Apps Script web app                Google Sheet
   │                                    │                                │
   ├─ Sign in with Google ──► ID token   │                                │
   ├─ POST {action, idToken} ───────────►├─ verify token with Google      │
   │    Content-Type: text/plain        ├─ check email against Users tab ►│
   │                                    ├─ check role + book ownership    │
   │◄─────────── JSON ──────────────────┤                                │
```

There are no passwords anywhere. Access is a Google sign-in checked against an allowlist in the
Sheet — add a row to grant access, disable a row to revoke it, and it takes effect within a minute.

## Who's who

**Agents** hold books. A name and a phone number in a sheet — no Google account, nothing to set up.
Most agents never open the app at all: they take paper books and hand back money and unsold tickets.

**Users** sign in. Usually just an admin and one or two helpers who do the recording.

| Role | Can do |
|---|---|
| Admin | Everything |
| Recorder | Record sales, manage books, settle |
| Agent | Record sales only on books issued to them |
| View only | Totals and reports, no phone numbers |

## What it does

**Search** is the home screen, because every task starts by finding something. It handles partial
ticket numbers (type `721`, not the whole thing), names with inconsistent spelling (*Thang* finds
*Thuang*), phone numbers in any format, book ranges, and filters that combine. Results are
actionable — find a ticket and sell it right there.

**Books** go out by range, transfer between agents, come back, and get settled. Issuing produces a
printable handover receipt with a signature line, or a WhatsApp message.

**Settlement** asks for the tickets that *didn't* sell — the ones the agent is physically holding.
Everything else in the book is marked sold. Typing two numbers takes five seconds and is exact,
whereas "I sold eight" throws away the ticket-to-buyer link the draw depends on. There is a fallback
for when the leftovers are lost that records the book total without inventing ticket rows.

**Money** shows what each agent still owes, and the Books tab of the Sheet shows declared against
recorded with the difference already calculated — in red when they disagree, with no report to run.

**Draw** checks you are ready: unsettled books, cash outstanding, and — the one that matters — how
many sold tickets have no name or phone. A sold ticket with no contact details is a winner you
cannot find.

Plus: overdue book chase list with one-tap WhatsApp reminders, agent statements, an audit log of
every change, and a nightly backup of the whole spreadsheet to Drive.

## Setting it up

See **[SETUP.md](SETUP.md)**. About 30 minutes, mostly clicking through Google's console.

It runs on a free `github.io` address, or on your own subdomain (step 7b) — one DNS record plus the
new address added to the OAuth origins. Buyers trust `shtrtickets.ceamalaysia.org` rather more than a
`github.io` link.

Ticket numbering — prefix, padding, how many, how many per book, price, currency — is all set in a
**Config** tab in the Sheet before you print. It locks once tickets exist, because renumbering after
printing disconnects every record from the tickets in people's hands.

## Layout

```
index.html              the whole app, one file
apps_script/
  Config.gs             config reader, ticket<->book arithmetic
  Auth.gs               token verification, allowlist, role checks
  Api.gs                router, responses, rate limiting, write lock
  Tickets.gs            sell, reserve, correct, bulk entry
  Books.gs              issue, transfer, return, settle
  People.gs             agents and users
  Reports.gs            reconciliation, outstanding, draw readiness
  Setup.gs              first-time setup, backups, health check
tests/
  run.sh                runs every test on plain node
  mock.js               in-memory stand-in for the Apps Script services
  *.test.js             numbering, search, settlement
SETUP.md                step-by-step setup
```

## On security and privacy

Nothing secret is in this repository. The Google client ID in `index.html` is public by design —
this sign-in flow has no client secret, and the protection is the Authorized JavaScript origins list
on Google's side, which stops a token being issued to any other site.

Everything sensitive stays in the Sheet: the allowlist, agent details, and every buyer's name and
phone number. **Never commit a spreadsheet export** — `.gitignore` blocks `.csv` and `.xlsx` for
exactly this reason.

This ends up being a list of thousands of names and phone numbers, many belonging to refugees.
Collect only what you need, say on the ticket what it is for, keep access to a few people, and
delete it a set period after the draw.

## Integrity

- Every write takes a script lock — two people cannot half-write the same row
- Every row carries a version; a stale edit is refused with *"changed by someone else"* rather than
  silently overwriting
- Rows are addressed by ticket and book number, never by spreadsheet row, so a re-sorted sheet
  cannot cause a write to land on the wrong ticket
- Bulk status changes preview what they will touch before writing anything
- Bulk sale entry is all-or-nothing: if one row has a problem, none are saved
- Name and phone are required on every sale, enforced on the server

## Tests

```bash
./tests/run.sh
```

Plain Node, nothing to install. The Apps Script services are stood up in memory
(`tests/mock.js`) so the real handlers run against a real sheet-like store.

Covered: ticket↔book numbering across different configs (including an exhaustive
round-trip over all 6,000 tickets), search matching, settlement arithmetic and the
one-source reconciliation rule, double-sell and stale-edit refusal, book ownership,
role enforcement on every admin action, reservations released on return, unsold
tickets voided with a lost book, and all-or-nothing bulk entry.
