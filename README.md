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
| Super admin | Everything, plus the things below that nobody else can do |
| Admin | Books, agents, settlement, and adding helpers — but not other admins |
| Recorder | Record sales, manage books, settle |
| Agent | Record sales only on books issued to them |
| View only | Totals and reports, no phone numbers |

There is exactly **one super admin**, and it is not a row in the sheet. It is an email address in a
Script Property (`SUPER_ADMIN_EMAIL`), which only the owner of the Apps Script project can change —
so no admin can promote themselves, and neither can anyone editing the spreadsheet by hand. Six
things are reserved to it:

- granting or removing the **admin** role
- disabling or re-enabling an **admin**
- **exporting the entry list** — every buyer's name and phone number in one file
- **voiding** a sold ticket
- **recording a winner**
- reading the **audit log**

Admins are not shown the super admin at all: the row is filtered out of the people list and the
address is never sent to the browser. An admin who tries any of the six anyway is refused by the
server, not merely by a hidden button.

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

A Vue 3 app built with Vite. GitHub Actions builds and publishes it on every push,
so you never run a build yourself.

```
src/
  App.vue               sign-in, which screen shows, which dialog is open
  style.css             the design system — 17px base, 52px targets, dark mode
  lib/
    api.js              transport (POST as text/plain, silent token renewal)
    store.js            one reactive store; screens derive from it
    search.js           the search index and matching rules
    format.js           money, dates, plain-word labels
  components/
    AppShell.vue        bottom tabs on a phone, sidebar on a desktop
    Home.vue  Search.vue  Sell.vue  Books.vue
    Agents.vue  Money.vue  Draw.vue  Admin.vue
    SellTicket.vue      the two-mode sale flow
    ui/                 Sheet, Empty, Toasts, BookGrid, StatusPill, Progress
    modals/             IssueBooks, SettleBook, BookDetail, Receipt, forms
apps_script/            the backend — see SETUP.md
  Config.gs  Auth.gs  Api.gs  Tickets.gs  Books.gs  People.gs  Reports.gs  Setup.gs
tests/                  ./tests/run.sh
.github/workflows/      builds and deploys on push to master
```

### Working on it

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
npm run build      # production build into dist/
./tests/run.sh     # all tests
```

Pushing to `master` builds and publishes automatically. **GitHub Pages must be set
to "GitHub Actions" as its source**, not "Deploy from a branch".

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
(`tests/mock.cjs`) so the real handlers run against a sheet-like store.

| Suite | Covers |
|---|---|
| `numbering` | ticket↔book arithmetic across different configs, plus an exhaustive round-trip over all 6,000 tickets |
| `settlement` | settlement maths, the one-source reconciliation rule, double-sell and stale-edit refusal, book ownership, reservations released on return, all-or-nothing bulk entry |
| `superadmin` | the root account: cannot be disabled or demoted from inside the app, only it can create or change an organiser, and it is hidden from ordinary admins |
| `search` | folding, spelling tolerance, phone formats, book ranges, and match ordering |

## Two things worth knowing

**On design.** The interface is built for someone who is not confident with phones:
17px base text, nothing interactive under 44px, four tabs plus a More sheet rather
than eight tabs that overflow, and plain words throughout — "With a seller", not
"Assigned". Recording a sale asks one question per screen by default, with a quick
mode for whoever is keying in a stack of stubs.

**On the super admin.** One email, held in a Script Property outside the
spreadsheet. Nothing in the app can grant it, and no admin can disable or demote
it — that takes opening the Apps Script project, which only its owner can do. It
is also the way back in before the Users tab has any rows.
