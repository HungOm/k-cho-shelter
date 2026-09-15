# Raffled

**Raffle ticket books, sellers and money.** Who holds which book, what sold, and what is still to come in.

A ticket and book inventory tracker for a community fundraising raffle. Paper tickets are printed in
books, handed to agents, sold for cash, and reconciled when the books come back.

**No money moves through this system.** It records what was handed out, what was sold, and what was
handed back — so you know who holds which books, who still owes what, and who to call when a number
is drawn.

Built to run for free: a static page on GitHub Pages in front of a Supabase project. Nothing to
pay for and nothing to host.

## How it works

The raffle runs on **Supabase** — Postgres, with one Edge Function in front of it. An older
**Apps Script and Google Sheet** backend is still in the repository and still works; the app can
talk to either, and which one it uses is a setting rather than a deploy.

**If you are setting this up today, use Supabase.** Everything the system does to keep its own
figures honest lives there and only there: row-level security, the append-only ticket record and
round snapshots, the payments ledger, the settlement lock, and the two-person approval on
destructive changes. A spreadsheet cannot enforce any of it — every one of those guarantees is a
constraint, a trigger or a policy in Postgres. See [supabase/AUDIT.md](supabase/AUDIT.md) for what
each one is and why it is there.

```
Browser (GitHub Pages)                    Edge Function `api` (Deno)            Postgres
   │                                              │                                │
   ├─ Sign in with Google ──► Supabase session      │                                │
   ├─ POST {action, payload} ────────────────────►├─ resolve email → role          │
   │                                              ├─ check the action's roles ────►│
   │◄──────────── {ok, data} ─────────────────────┤     (service role; RLS in code)│
   │                                              │                                │
   └─ reads go straight to PostgREST ───────────────────────────────────────────►│
        through four filtered, masked views          (row-level security, as the signed-in person)
```

Reads bypass the function and go directly to PostgREST through four views that row-level security
filters and masks. That is the whole performance difference — 57–82ms direct against 340–1000ms
through the function — and it is safe because the database, not the function, decides what a given
person may see. Writes always go through the function, where the roles live.

<details>
<summary>The Apps Script backend, which is still here</summary>

```
Browser (GitHub Pages)          Apps Script web app                Google Sheet
   │                                    │                                │
   ├─ Sign in with Google ──► ID token   │                                │
   ├─ POST {action, idToken} ───────────►├─ verify token with Google      │
   │    Content-Type: text/plain        ├─ check email against Users tab ►│
   │                                    ├─ check role + book ownership    │
   │◄─────────── JSON ──────────────────┤                                │
```

It answers the same `{action, payload}` calls and returns the same envelope, which is what makes
the choice a setting instead of a rewrite. What it does not have is the integrity work above: the
Sheet stays readable and editable by hand, and that is exactly why a constraint cannot be enforced
in it. `tests/portparity.test.mjs` compares the two gates over every action and role, so the pair
cannot quietly drift apart.

</details>

**Choosing one.** `VITE_BACKEND=supabase | appsscript` at build time sets the default for
everybody. `?backend=supabase` in the URL overrides it for one device and is remembered — which is
how you try a backend on your own phone while every volunteer stays on the other one, with no
deploy either way. With neither set the app falls back to `appsscript`, so a build that forgets the
variable is pointed at the older system: set it.

There are no passwords anywhere. Access is a Google sign-in checked against an allowlist — a row in
`app_users` on Supabase, or the Users tab in the Sheet — and revoking a row takes effect within a
minute.

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

There is exactly **one super admin**, and it is not a row in the database. It is an email address
in `SUPER_ADMIN_EMAIL` — a function secret on Supabase, a Script Property on Apps Script — so it
lives outside the store the app can write to. No admin can promote themselves, and neither can
anyone editing rows by hand. Six things are reserved to it:

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

**Search** is where every task starts. Partial ticket numbers (type `721`, not the
whole thing), names with inconsistent spelling (*Thang* finds *Thuang*), phone numbers
in any format, book ranges, and filters that combine. Results are actionable — find a
ticket and sell it there.

**Recording a sale** works two ways, remembered per device: one question per screen for
someone doing it the first time, or everything on one card for whoever is keying in a
stack of counterfoils. Both require a name and a phone number, enforced on the server.

**Selling a whole book** to one buyer — common when a church or a family takes a book
outright. Every ticket gets the same name and phone, so a winner can still be
telephoned. Tickets already sold to somebody else are never overwritten, and the result
says so: "7 tickets sold, 3 were already sold" rather than "book sold".

**Books** go out by range, transfer between sellers, come back, and get settled. Typing
a range tells you immediately what is already out and who has it — "Books 1–8 are
already out with JOHN and MARY. 4 of 12 are free." — and offers the next free run as a
button. Issuing produces a printable handover receipt, or a WhatsApp message.

**Settlement** asks for the tickets that *didn't* sell — the ones the seller is
physically holding. Everything else in the book counts as sold. Typing two numbers takes
five seconds and is exact, whereas "I sold eight" throws away the ticket-to-buyer link
the draw depends on. There is a fallback for lost leftovers that records the book total
without inventing ticket rows.

**Money** shows what each seller still owes, and the book list shows declared
against recorded with the difference already calculated — red when they
disagree, no report to run.

**The draw** checks you are ready: unsettled books, cash outstanding, and the one that
matters — how many sold tickets have no name or phone. A sold ticket with no contact
details is a winner you cannot find.

Plus: overdue chase list with one-tap WhatsApp reminders, seller statements, an audit
log of every change, and a weekly backup — encrypted, on Supabase
([`.github/workflows/backup.yml`](.github/workflows/backup.yml)); to Drive on Apps Script.

## Who can do what

Permissions are **set from the interface**, not hardcoded. The super admin opens
*Access* and turns any feature on or off for any role — one role at a time on a phone,
the whole matrix on a desktop. The roles in the code are only defaults.

Two kinds of toggle are shown but cannot be moved, and the server refuses them too:
super-admin-only features, which cannot be given away at all, and user management, which
always stays with organisers because turning it off would lock everybody out.

**Destructive changes need two people.** Small fixes go through directly. Three things do
not: marking a run of books lost or void, putting books back on the shelf, and settling a
book that is already settled. Each is refused, and the person is offered "Ask the
organiser". The sentence the approver reads is written by the server — by the same code
that executes it — so what is approved is what happens, and approving carries it out
immediately in the requester's name. Requests lapse after a day.

## Burmese

Every interface label carries a Burmese line beneath it, small and italic: navigation,
buttons, questions, form labels, status words and error messages. Ticket numbers, buyer
names, phone numbers, money and dates are data and are never glossed.

> ⚠️ **The translations have not been checked by a native speaker.** They are
> machine-authored Unicode Burmese, in `src/lib/i18n.js`. Get them read before the raffle
> runs — the destructive buttons above all, because a wrong word on "Report books lost"
> or "Count a book in" turns into a mistake in the money. Approval sentences are
> deliberately English-only until that review happens.

Padauk and Noto Sans Myanmar are loaded explicitly; without a real Burmese font many
Android phones draw empty boxes. Phones still running Zawgyi will show correct Unicode
as nonsense — nothing fixable in code.

## What is kept on the phone

The ticket skeleton — number, status, book, seller — is cached in IndexedDB so the app
opens instantly instead of downloading six thousand rows first.

**Buyer names, phone numbers, areas and notes are stripped before anything is written**,
in one place, `saveTickets()`. This app records refugees' contact details; a phone that
is lost, sold or lent would otherwise carry that list indefinitely. Those columns arrive
over the network into memory only, so search by name works during the session and
nothing survives a closed tab. The cache is dropped on sign-out, on changing the
connection, and on any authentication failure.

## Setting it up

See **[SETUP.md](SETUP.md)**, which starts by asking which backend you are setting up. About 30
minutes either way, mostly clicking through Google's console for the sign-in.

It runs on a free `github.io` address, or on your own subdomain (step 7b) — one DNS record plus the
new address added to the OAuth origins. Buyers trust `shtrtickets.ceamalaysia.org` rather more than a
`github.io` link.

Ticket numbering — prefix, padding, how many, how many per book, price, currency — is all set
before you print: in the `config` table on Supabase, or the **Config** tab in the Sheet. It locks once tickets exist, because renumbering after
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

Everything sensitive stays in the database: the allowlist, agent details, and every buyer's name
and phone number. **Never commit an export** — `.gitignore` blocks `.csv`, `.xlsx` and `backup/`
for exactly this reason, and the scheduled backup is encrypted before it leaves the runner.

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
| `numbering` | ticket↔book arithmetic across configs, plus an exhaustive round-trip over all 6,000 tickets |
| `settlement` | settlement maths, the one-source reconciliation rule, double-sell and stale-edit refusal, book ownership, reservations released on return, all-or-nothing bulk entry |
| `superadmin` | the root account: cannot be disabled or demoted from inside the app, only it can create or change an organiser, hidden from ordinary admins |
| `permissions` | the access table overrides defaults, super-admin-only features stay ungrantable, and the admin lock holds even if somebody edits the sheet by hand |
| `approvals` | requests execute on approval under the requester's identity, re-checked; lapse after a day; cannot be self-approved |
| `sellbook` | selling a whole book, and never overwriting a ticket already sold to somebody else |
| `cache` | the server-side ticket table cache and its version keying |
| `search` | folding, spelling tolerance, phone formats, book ranges, match ordering |
| `bookrange` | resolving a typed range locally — what is taken, by whom, what does not exist, where the next free run is |
| `loadorder` | no `.gs` file reads another file's constants at load time (see below) |
| `emits` | every button actually does something (see below) |

### Two suites that exist because of specific bugs

**`loadorder`** — Apps Script concatenates `.gs` files in whatever order the project
holds them, and nothing in the repo controls it. A top-level array built from another
file's constants can silently become `[undefined, undefined]`: nothing throws, the
lookup just stops matching, and settled books start counting toward the money total on
the wrong figures. A wrong cash total with no error message. The rule is now enforced —
a top-level initialiser may only use names declared above it in its own file.

The same shape bit the browser code too: `store.js` read `localStorage` at module scope,
so a browser with storage blocked would have failed the import and shown a blank page
rather than a slow one.

**`emits`**

Three buttons once shipped doing nothing at all. They emitted events the parent never
listened for, so the click was swallowed in silence — and that is invisible to every
other test here, because the server never hears from a button that does nothing. Vue
does not warn either; an unhandled emit is legal.

reads what each component declares it sends, reads what its parents listen for, and
fails when they disagree. It found a fourth dead button the first time it ran.

Both were written carefully enough not to cry wolf. A test that flags working code gets
switched off within a week, so each one was checked against the original bug (it fails)
and against correct code that superficially resembles it (it passes).

**743 assertions across eleven suites.**

## Two things worth knowing

**On design.** The interface is built for someone who is not confident with phones:
17px base text, nothing interactive under 44px, four tabs plus a More sheet rather
than eight tabs that overflow, and plain words throughout — "With a seller", not
"Assigned". Recording a sale asks one question per screen by default, with a quick
mode for whoever is keying in a stack of stubs.

**On the super admin.** One email, held outside the database the app writes to —
a function secret on Supabase, a Script Property on Apps Script. Nothing in the
app can grant it, and no admin can disable or demote it; that takes the Supabase
dashboard or the Apps Script project, which only their owners can open. It is
also the way back in before the allowlist has any rows.
