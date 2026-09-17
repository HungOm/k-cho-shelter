# Setting up Raffled

One-time setup, about 30 minutes. Do the steps in order — later ones depend on earlier ones.

You need: a Google account, and the ability to create a GitHub repository.

---

## First: which backend?

There are two, and the app talks to either. **Set up Supabase** unless you have a reason not to.

| | Supabase | Apps Script + Sheet |
|---|---|---|
| Where the data lives | Postgres | a Google Sheet |
| Readable and editable by hand | through the dashboard | yes, it is a spreadsheet |
| Row-level security | yes | no — the Sheet is the permission boundary |
| Ticket record that cannot be edited or erased | yes, append-only | no |
| What a closed check-in round said | frozen per round | not kept |
| Payments ledger, reversals | yes | book totals only |
| Settlement takes a row lock | yes | no |
| Two people for destructive changes | yes | yes |
| Scheduled backup | weekly, encrypted, in GitHub Actions | nightly, to Drive |
| Speed of a cold start | 57–82ms for reads | 1.1s floor, 9s cold |

The second column is not a worse version of the first — it is a spreadsheet, and the guarantees in
the rows above are constraints, triggers and policies that a spreadsheet has nowhere to put. What
each one is and why it exists is in [supabase/AUDIT.md](supabase/AUDIT.md).

**Setting up Supabase.** Steps 3 and 7 below are shared — the Google sign-in and putting the app
online are the same either way — and the rest of the Supabase side is:

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough) and
   `supabase link --project-ref <ref>`.
2. `cp supabase/.env.local.example supabase/.env.local` and fill in the URL and the **secret** key
   from Settings → API. `./supabase/connect.sh` checks it and refuses the publishable key, which
   otherwise appears to work for reads and fails on every write.
3. Apply the database: `./supabase/connect.sh --schema`, then `supabase db push` for the
   migrations, then `supabase/functions.sql` and `supabase/rls.sql`. **`rls.sql` is not optional** —
   it is what makes the database default-deny, and without it the browser's key can read every
   table directly.
4. `supabase functions deploy api`, and set its secrets — including `SUPER_ADMIN_EMAIL`, which is
   the one thing that must live outside the database.
5. Enable Google under Authentication → Providers and paste in the client ID from step 3 below.
6. Set the repository variables `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY`, then push. **If `VITE_BACKEND` is unset the build falls back to
   Apps Script**, which is the one way to end up quietly running the other backend.
7. Turn on the weekly backup — **[Backups](#backups-supabase)** below. The free plan takes none,
   and the job deliberately fails every week until it is set up.
8. Check it: `./tests/run.sh`, and `./supabase/test-rls.sh` against a throwaway database.

Everything from Step 1 to Step 9 below is the **Apps Script** path, and Step 3 (Google sign-in) and
Step 7 (putting the app online) are needed for both.

---

## Reaching the database

Three things about connecting cost an afternoon each, and every one of them presents as a
different problem than it is. They are written down here so they cost nobody a second one.

### The connection string the dashboard shows may not work

**Use the session pooler, not the direct host.** Project Settings → Database → *Connection string*
→ **Session pooler**:

```
postgresql://postgres.<project-ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two details that are easy to miss and both fatal:

- the username carries the project ref — `postgres.abcdefgh`, not `postgres`
- the port is **5432**. There is a transaction pooler on 6543; it does not support what `pg_dump`
  and migrations need.

The direct host, `db.<project-ref>.supabase.co`, is what the dashboard offers first. It is
IPv6-only and on this project it **refuses connections on 5432 outright** — which reads as a
firewall problem or a wrong password, and is neither.

### The database password is a third credential

Not your Supabase account login, and not the API keys. It is the Postgres password for the
`postgres` role, shown once when the project was created and **not retrievable afterwards** —
only resettable, at Project Settings → Database → *Reset database password*.

Resetting it is safe. Nothing that serves the raffle uses it:

| What | Uses |
|---|---|
| The Vue app | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| The `api` Edge Function | `SUPABASE_SECRET_KEY` |
| `connect.sh` | the REST API and the secret key |
| `backup.sh`, the weekly workflow, `supabase db push` | **the database password** |

So a reset interrupts backups and migrations, and nothing a volunteer touches.

Put it in `supabase/.env.local`, which is gitignored:

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
```

**Percent-encode `@ : / # ^ +` if the password contains them**, or the URL parses as a different
host and the error will talk about DNS.

### `supabase db push --db-url` does not work here

It fails to authenticate against a string that `psql` accepts unchanged. Use the CLI's own
variable instead:

```
SUPABASE_DB_PASSWORD='...' supabase db push --linked
```

`--dry-run` connects happily either way, so **a green dry run does not prove the real push will
connect**. Take a backup before pushing, and verify afterwards rather than trusting the exit code.

---

## Backups *(Supabase)*
<a id="backups-supabase"></a>

**The free plan takes no automatic backups.** Everything about this raffle that cannot be
reconstructed lives in one database: who bought which ticket, and how to telephone them. Lose it
and the draw cannot be run — not "is awkward to run", cannot be run, because there is no way left
to tell a winner they have won.

[`.github/workflows/backup.yml`](.github/workflows/backup.yml) runs every Sunday night and can be
triggered by hand. **Until it is set up it fails every week on purpose**, because a backup nobody
has finished configuring should be loud rather than quiet.

### Why it is encrypted, and why it refuses rather than falling back

A dump of this database is every buyer's name and telephone number, most of them refugees. A
GitHub artifact is readable by anybody with read access to the repository — and this repository
publishes a Pages site, which on a free account means it is public, which means everybody.
"Retained privately" is not a property an artifact has here; it is one the file has to carry.

So the dump is sealed with gpg **before** it is handed to the artifact store, and the plaintext is
deleted in the same step. The runner holds only the PUBLIC key: it can seal a backup and cannot
open one, so whoever gets hold of the artifact, the runner, or this repository still cannot read a
telephone number.

If the key is not configured the job **fails instead of uploading plaintext**, and that check runs
*before* the dump — checking afterwards would mean the plaintext already exists on the runner when
you discover you cannot seal it.

### One-time setup

**1. Make the key pair.** On a machine that is not the CI runner:

```
bash supabase/backup-key.sh
```

It writes `backup-key.pub` (gitignored) and prints the fingerprint. The private half stays in your
gpg keyring on that machine and nowhere else.

**2. Keep the private half somewhere you will still have in a year.**

```
gpg --armor --export-secret-keys "K'Cho raffle backups" > kcho-backup-key.asc
```

Move it off the machine — password manager, a USB stick in a drawer, anywhere you keep things that
matter. **Without it no sealed backup can ever be opened, by anybody, including you.** This is the
step people skip, and it is the one that makes every backup after it worthless.

**3. Add four repository secrets.** Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `BACKUP_GPG_PUBLIC_KEY` | the whole of `backup-key.pub`, `BEGIN` and `END` lines included |
| `SUPABASE_DB_URL` | the session pooler connection string, as above |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | the `sb_secret_` key from Settings → API — **not** the publishable one |

Or with the `gh` CLI: `gh secret set BACKUP_GPG_PUBLIC_KEY < backup-key.pub`, and the same for the
other three.

**4. Run it once by hand.** Actions → *Weekly backup* → Run workflow. Do not wait for Sunday: a
mistake should surface on the day you made it.

### What is in a backup, and what is not

`pg_dump` refuses to run against a server newer than itself, and Supabase upgrades the hosted
server while nobody upgrades their laptop. When that happens — or when Docker is not available,
since `supabase db dump` fetches a matching `pg_dump` in a container — `backup.sh` falls back to
copying **every table out with `psql`**, which has no such rule. The table list is asked of the
database rather than written down here, so a table added next month is in the backup without
anybody remembering to add it.

That fallback captures the **data and not the schema**, and says so in a note inside the folder.
It is the honest trade: the schema can be rebuilt from this repository and the migrations; the
names and telephone numbers cannot be rebuilt from anything.

### Restoring

```
gpg --decrypt raffle-backup-<date>.tar.gz.gpg > raffle-backup.tar.gz
tar -xzf raffle-backup.tar.gz
```

A full dump restores with `psql "$DB_URL" -f schema.sql` then `-f data.sql`.

A fallback backup has CSVs and **its own restore script**, written at the time the backup was
taken. Build the schema first — `supabase/schema.sql`, `functions.sql`, `rls.sql`, then
`supabase/migrations/` — and run it for the data:

```
DB_URL='postgresql://...' bash restore.sh
```

Do not hand-write the `\copy` loop. Three things break it, and all three were found by trying:

- **Positional copy fails the moment the schema gains a column.** Which is the situation every
  restore is in — you are loading an old backup into a newer database. It fails with *missing data
  for column*, at the worst possible moment. The script names the columns from each CSV's header.
- **Generated columns cannot be written by COPY.** `app_users.active` is computed from `status`,
  and a backup taken with `select *` carries it. The script drops any column the target derives
  for itself.
- **Alphabetical order violates the foreign keys** — `book_history` loads before `books`. The
  script copies what it can and retries the rest until a pass makes no progress, then says which
  tables are left and why.

It also advances the sequences afterwards. Ids come across with their rows and the sequences stay
at 1, so without that step the restore looks perfect and the next insert collides with a row that
is already there.

The CSV path has been round-tripped into an empty database and checked — 20,000 tickets, 2,000
books, and every other table equal going out and coming back, with the next insert landing on a
fresh id rather than a collision. The full-dump path has not been exercised here, because no `pg_dump` matching the
hosted server was available; if you ever take one, restore it into a throwaway project once before
you need it. A backup nobody has restored is a backup nobody has.

---

## Step 1 — Create the spreadsheet *(Apps Script path)*

1. Go to [sheets.new](https://sheets.new) to make a new blank spreadsheet.
2. Name it after your raffle — **Raffled Tickets** will do.
3. Leave it open — you need it in the next step.

This spreadsheet is your database. Everything lives here. Nothing sensitive ever goes into GitHub.

---

## Step 2 — Add the code

1. In the spreadsheet: **Extensions → Apps Script**.
2. Delete whatever is in `Code.gs`.
3. For each file in the `apps_script/` folder of this project, create a matching file in the editor
   (click **+** next to *Files* → *Script*) and paste the contents in:

   | Create a file named | Paste in the contents of |
   |---|---|
   | `Config` | `apps_script/Config.gs` |
   | `Auth` | `apps_script/Auth.gs` |
   | `Api` | `apps_script/Api.gs` |
   | `Tickets` | `apps_script/Tickets.gs` |
   | `Books` | `apps_script/Books.gs` |
   | `People` | `apps_script/People.gs` |
   | `Reports` | `apps_script/Reports.gs` |
   | `Setup` | `apps_script/Setup.gs` |

   (The editor adds the `.gs` itself. You can delete the empty `Code.gs`.)

4. Click the **save** icon. Name the project **Raffled API**.

> Prefer the command line? `npm i -g @google/clasp`, then `clasp login`, `clasp clone <script id>`,
> copy the files in, and `clasp push`. Much faster when you need to update the code later.

---

## Step 3 — Create the Google sign-in ID

This is what lets people prove who they are. It is the fiddliest step; take it slowly.

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Top left, click the project dropdown → **New Project**. Name it **Raffled**. Create it, then select it.
3. In the search bar type **OAuth consent screen** and open it.
   - User type: **External** → Create
   - App name: your organisation's name — this is what Google shows the person signing in —
     user support email: your email, developer contact: your email
   - Save and continue through the remaining steps. You do **not** need to add scopes.
   - On *Audience* / *Test users*, either add the Google accounts of your helpers as test users,
     or click **Publish app** so anyone can sign in. (Access is controlled by the Users tab either
     way — publishing does not give anyone access to your data.)
4. Search for **Credentials** → **+ Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Raffled web`
   - Under **Authorized JavaScript origins**, click *Add URI* and add:
     - `https://hungom.github.io`
     - `https://shtrtickets.ceamalaysia.org`
     - `http://localhost:8000` — only if you want to test on your own computer

     Add the **origin only** — no path, no repository name, no trailing slash. Listing several is
     normal and safe; sign-in works from any of them.
   - Click **Create**.
5. Copy the **Client ID**.

> **Already done for this project.** The client is created (project `kcho-shelter`, type *Web
> application*), both origins are registered, and the client ID is already filled into
> `index.html`. Nothing to do here unless you are setting up a second copy.

**Google also hands you a "client secret" and offers a JSON download. Nothing in this repository
uses it.** The browser sign-in has no secret — do not put that file in the repository, and do not
paste its contents anywhere.

One place does need it, and it is not this one: the Supabase project's Google provider, where it is
stored server-side in the dashboard and never reaches a browser. That is only for the
`?signin=redirect` route; the ordinary sign-in is the token exchange, which has no secret at all.
If you are setting up a second copy, paste the secret into the dashboard, then delete the download.

**This client ID is not a secret.** It is meant to be public and it is safe in the repo. What
protects it is the *Authorized JavaScript origins* list you just filled in: a sign-in token carrying
your client ID can only be issued to a page served from your own domain. A copy on somebody else's
site is useless.

### On Supabase, the same client ID has to be listed there too

Skip this if you are running on Apps Script.

The app signs in with the Google button on its own page and trades the token Google returns for a
Supabase session, rather than handing off to `<project>.supabase.co` and coming back. That is why
Google's screen says **Sign in to shtrtickets.ceamalaysia.org** and not a forty-character project
reference — which is worth keeping, because a random string is exactly what a phishing page looks
like to somebody being careful.

Supabase will only accept a token minted for a client ID it has been told to trust:

> Supabase dashboard → **Authentication** → **Providers** → **Google** → enable it, and paste the
> client ID from step 3 into **Authorized Client IDs**.

Until that is done every sign-in is refused. The app says so in those words rather than reporting a
rejected credential, because it is a setting somebody has to change and no amount of trying again at
the phone will fix it.

If you need the old behaviour — a build with no client ID compiled in, say — add `?signin=redirect`
to the address and the handoff comes back.

---

## Step 4 — Tell the script who you are

Back in the Apps Script editor:

1. Click the **gear icon** (Project Settings) in the left sidebar.
2. Scroll to **Script Properties** → **Add script property**. Add these two:

   | Property | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | the client ID you copied in step 3 |
   | `SUPER_ADMIN_EMAIL` | your own Google email address |

3. Click **Save script properties**.

`SUPER_ADMIN_EMAIL` is the **System Admin** — one account, above every other, and the most important
setting in this list.

It is your way back in: that address is treated as an admin even before the Users tab exists, so a
fresh deploy cannot lock you out. It is also the only account that can hand out or take away the
admin role, disable another admin, export the entry list, void a sold ticket, record a winner, or
read the audit log. Ordinary admins never see it — not the row, not the address.

It is deliberately kept here, in Script Properties, rather than in the spreadsheet. Nothing inside
the app can change it, and neither can anybody editing the Sheet by hand. Moving it to another
person means coming back to this screen, which only the Google account that owns the script can open. Put your own
address in it, not a shared mailbox.

> Set up before this change? `ADMIN_BOOTSTRAP_EMAIL` is still read as the old name, so your
> deployment keeps working. Rename it to `SUPER_ADMIN_EMAIL` when convenient.

---

## Step 5 — Choose your ticket numbers, then build the sheet

**Do this before you print any tickets.** Numbering locks once tickets exist.

1. In the Apps Script editor, pick `setup` from the function dropdown at the top and press **Run**.
2. The first time, Google asks for permission: **Review permissions** → choose your account →
   **Advanced** → **Go to <the name you gave the project> (unsafe)** → **Allow**.
   On this deployment that reads *K'Cho Shelter API*, because it was set up before the rename.
   (The "unsafe" warning appears for every script that hasn't been through Google's paid review.
   It is your own code, running in your own account.)
3. Go back to the spreadsheet. You now have tabs: **Tickets, Books, Agents, Users, Winners,
   Book_History, Config, _AuditLog**.
4. Open the **Config** tab and set your numbers:

   | Key | Default | Change it to |
   |---|---|---|
   | `TICKET_PREFIX` | `KS-` | whatever goes before the number, or blank |
   | `TICKET_START` | `1` | the first ticket number |
   | `TICKET_DIGITS` | `5` | padding — `5` gives `KS-00001` |
   | `TOTAL_TICKETS` | `10000` | how many tickets you are printing |
   | `TICKETS_PER_BOOK` | `10` | how many in one physical book |
   | `BOOK_PREFIX` / `BOOK_DIGITS` | `Book-` / `4` | `Book-0001` |
   | `TICKET_PRICE` | `10` | price of one ticket |
   | `CURRENCY` | `RM` | |
   | `CHECK_IN_DATE` | one month out | the day every seller reports by, this round |
   | `FINAL_DEADLINE` | blank | the day everything has to be back — set this |
   | `CHECK_IN_EVERY_MONTHS` | `1` | how far apart the rounds are — `3` for quarterly |
   | `REPORT_GRACE_DAYS` | `3` | days after the check-in before somebody is shown as late |
   | `DEFAULT_DUE_DAYS` | `30` | fallback only, if neither date above is set |
   | `EVENT_NAME`, `ORG_NAME`, `DRAW_DATE` | | shown on receipts |

5. If you changed any of the numbering rows, run **`regenerate`** to rebuild the tickets and books.
   Run **`showConfig`** to print what you have; check the first and last ticket numbers look right.

> `regenerate` refuses to run once any ticket has been sold. At that point the printed tickets in
> people's hands are the real record, and renumbering would disconnect every one of them.

**Pick the padding for the raffle you might end up with, not the one you are printing.**
`TICKET_DIGITS` and `BOOK_DIGITS` are the two settings that can never be changed afterwards — widening
them renumbers every ticket already printed. The defaults above leave room to grow to 10,000 tickets
in 1,000 books. If there is any chance of going further, set them higher now; it costs nothing.

### The two deadlines

A raffle runs on two dates, and confusing them is how money goes missing.

**The check-in date is soft.** It is one shared day on which *everybody* reports: what has sold, what
is left, what has been collected. The same day for the person who took books in March and the person
who took them last week — which is what makes one reminder and one late list possible at all. Nobody
is finished on that day. The point is to find out where things stand while there is still time to do
something about it.

**The final deadline is hard.** Every book and every ringgit has to be back by then, because the draw
happens after it. It does not move on its own.

The check-in date walks towards the final deadline a month at a time and stops there. Two rules hold
always: `CHECK_IN_DATE` can never pass `FINAL_DEADLINE`, and `FINAL_DEADLINE` can never pass
`DRAW_DATE`.

**The monthly round, in order:**

1. The check-in date arrives. The app says so, and the *Deadlines* screen shows how many books are
   out and how many are late.
2. Go through them — settle what has come back, chase what has not.
3. Press **Next round** on the Deadlines screen. It shows you what the move would do *before* it does
   it, including how many late books would stop counting as late.
4. Confirm. The date steps on a month, and every book still out gets the new date.

That third step is the one that matters. Moving the check-in date forward makes late books stop being
late — that is exactly what a checkpoint is for, and it is also how "we will collect it next month"
becomes a year of nobody chasing anybody. So the number is put in front of you in words, and when
there is anything to absolve the date has to be typed back before it will go through.

**What it refuses, and why:**

| It says | Because |
|---|---|
| `NO_FINAL_DEADLINE` | A checkpoint with no wall behind it is an extension that can be granted for ever. Set the final deadline first. |
| `CANNOT_MOVE_BACK` | Pulling the date backwards would make books late for a day that had already passed when they were handed over. |
| `FINAL_PASSED` | The raffle's own deadline is behind you. There is no next round; what is still out is overdue outright. |
| `TOO_FAR` | More than twelve months in one step. A mistyped year cannot quietly suspend the chasing for a decade. |
| `DUE_AFTER_FINAL` | A handover was given a date past the final deadline. The paper in somebody's hand would promise them time the raffle does not have. |

The last check-in lands *on* the final deadline rather than being refused for overshooting it, and
says so: that is the last round.

**All of the dates, worked out in advance.** Nobody types the middle ones. Given the check-in date,
the cadence and the final deadline, the *Deadlines* screen lists every round — so a seller can be
told all of their reporting dates on the day they collect their books, which is the only moment
anybody has their attention. It is a plan only: the roll still steps the one stored date and stops at
the wall, so nothing about whether a seller is late depends on it.

A step landing a few days before the final deadline is **kept**, not tidied into it. Two reports in
one week is redundant; skipping that round leaves a gap longer than the monthly rhythm, and it is the
last moment anybody finds out forty books are still out while there are days left to ring people.

### Who has reported

A book coming back and a seller reporting are not the same event, and only one of them can be seen in
the data. Somebody can honestly say "sold six, here is the money, I am keeping the book for the rest"
and still be holding it — so nothing derived from the books can answer *who has not been in touch*.

So a report is written down. On the **Sellers** screen, each person carries where they stand this
round, and the ones still to report are listed at the top with a **Remind** button and a **Reported**
button beside each name.

| What it shows | What it means |
|---|---|
| *Reported* | They answered this round. Nothing more is needed from them until the next one. |
| *To report* | The check-in is within a week, today, or inside the grace days. |
| *n days late* | The grace ran out and they have not been in touch. Counted from the **end** of the grace, not from the check-in date. |
| nothing at all | They are holding no books, so there is nothing to report on. |
| *missed n check-ins* | Rounds that came and went with no word. This survives the roll. |

**Recording a report is the only thing that clears the mark.** There is no dismiss button anywhere in
this app on purpose — an alert somebody can tick away is one everybody ticks away, and by the time it
matters it has been trained into furniture. Clearing the mark and writing down what the seller said
are the same action, and what is written is what the next round is measured against.

**Settling a book counts as a report automatically.** If you have just counted somebody's book and
taken their money, you should not also have to tick them off a list. It records only the fact — the
money stays in the settlement, where it is reconciled — and it never overwrites a report somebody
typed.

**The roll forgives a late book, never the silence.** Moving the check-in date forward makes every
outstanding book current again; that is what a checkpoint is for. The rounds a seller never answered
stay missing from the record for the rest of the raffle, so somebody who has not been in touch since
August cannot be laundered into somebody up to date.

If a report is recorded against the wrong person, open them and press **Undo**. It deletes the record
rather than hiding it, which puts them straight back on the list.

**Who may do what.** Moving the check-in date on is an organiser's job — it happens every month, and
a checkpoint that needs the System Admin every time is a checkpoint that stops happening. Changing the
final deadline is the System Admin's alone: it is the promise the raffle made to everybody who bought
a ticket. Shortening it, or removing it, asks for the date to be typed back. Shortening it also pulls
the check-in date in with it, because nothing may sit later than the wall.

**The draw is not ready until the final deadline has passed.** *Is the draw ready* says so as a
blocker, alongside unsettled books and uncollected money. Drawing a winner early pulls from a pool
sellers are still adding to, and it cannot be undone once a name has been read out.

### Growing a raffle that is already running

If the project expands after tickets are out, the System Admin can add more — `expand_tickets`. It only
ever adds. A total can never be reduced, because every ticket above a lowered line would quietly stop
existing, including ones already paid for.

It previews first. Send the new total and read back what it would do; nothing is written until you send
it again with `dryRun: false` and the new total typed into `confirm`.

Tickets already printed keep the numbers they were printed with — a ticket number is worked out from
the prefix, the start and the padding, and none of those move. Only new rows are added on the end.

It refuses, with an explanation, when:

| | |
|---|---|
| the new total is lower than, or the same as, the current one | tickets would stop existing |
| the padding cannot express the new highest ticket or book number | widening it would renumber everything |
| the last book is not full (e.g. 6,005 tickets in books of 10) | that book would have to be rewritten, not added to |
| the sheet no longer matches the Config tab | new rows would land on the wrong lines |
| the new total is above 50,000 | the ceiling for one spreadsheet |

---

## Step 6 — Publish the API

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to *Select type* → **Web app**.
3. Fill in:
   - Description: `v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
4. **Deploy**, then copy the **Web app URL**. It ends in `/exec`.

**"Anyone" sounds alarming — here is why it is correct.** It only means the address is reachable
without a Google login *at the network level*. Every request still has to carry a valid Google
sign-in token that the script checks against your Users tab; anything else is refused. This setting
is also the only one that lets the web page talk to the script at all — with "Anyone with a Google
account", the browser blocks the request before it ever arrives.

Test it: paste the `/exec` URL into a browser tab. You should see
`{"ok":true,"message":"Raffled API is running..."}` — or the name the deployed copy was
written with, which on this deployment is still *K'Cho Shelter API*.

---

## Step 7 — Put the app online

1. Create a new **GitHub repository** — `raffled`, or whatever you like. Public or private both work.
2. The client ID sits near the top of the `<script>` block in `index.html`. Check it matches the
   one in your Google Cloud credentials:
   ```js
   const GOOGLE_CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";
   ```
3. Push the project:
   ```bash
   git add .
   git commit -m "Raffled ticket tracker"
   git remote add origin git@github.com:<you>/<your-repo>.git
   git push -u origin master
   ```
4. On GitHub: **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)`
   → **Save**. After a minute your site is at `https://<you>.github.io/<your-repo>/`.

> **On this deployment** the repository is `HungOm/k-cho-shelter` and the site is
> `https://shtrtickets.ceamalaysia.org`. Both predate the rename and are deliberately unchanged:
> renaming a repository moves every clone's remote, and renaming the domain takes the app off the
> air until DNS catches up. Neither is part of naming the product.
5. Check that this address matches what you put in **Authorized JavaScript origins** in step 3.
   The origin is just the `https://hungom.github.io` part — no repository name.

---

## Step 7b — Use your own address (optional but recommended)

`shtrtickets.ceamalaysia.org` looks far more trustworthy to a ticket buyer than a `github.io` address,
and it costs nothing. Skip this if you are happy with the GitHub address.

Pick the name carefully — once it is in DNS and in Google's settings, changing it means redoing
both. Short is better when people type it on a phone.

**1. Point the name at GitHub.** With whoever manages DNS for `ceamalaysia.org`, add one record:

| Type | Name | Value |
|---|---|---|
| CNAME | `tickets` | `hungom.github.io.` |

A subdomain uses a **CNAME** record. (A records are only for an apex domain like `ceamalaysia.org`
itself.) On Cloudflare, set the record to **DNS only** — the grey cloud, not the orange one — until
GitHub has issued the certificate. Proxying during setup is the usual reason HTTPS gets stuck.

**2. Tell GitHub.** A `CNAME` file naming `shtrtickets.ceamalaysia.org` is already committed, so
Pages should pick the domain up on its own. Check under **Settings → Pages → Custom domain**, and
type it in there if the box is empty. Wait for the DNS check to go green, then
tick **Enforce HTTPS**. Usually minutes; occasionally a few hours.

**3. Tell Google.** In Google Cloud → **Credentials** → your OAuth client → **Authorized JavaScript
origins**, add `https://shtrtickets.ceamalaysia.org`. **Sign-in will not work until you do this.** Leave
the `github.io` origin in the list as well, so nothing breaks while DNS spreads.

Nothing changes in the Apps Script. The `/exec` address does not care which site calls it, and
access is decided by the sign-in token, not the domain. No redeploy needed.

**Two things that catch people out:**

- **The address gets shorter.** On GitHub it was `…github.io/kcho-shelter/`; on your own subdomain
  the app sits at the root, so it is just `https://shtrtickets.ceamalaysia.org/`.
- **Everyone reconnects once.** The saved Apps Script link lives in the browser and is tied to the
  old address, so it does not follow you across. Send everyone a fresh link (see *Sharing the app*
  below) and they are set again in one tap.

> If you later publish the OAuth consent screen with a homepage on `ceamalaysia.org`, Google will
> ask you to prove you own the domain via Search Console. Adding a JavaScript origin, as above,
> needs no verification.

---

## Step 8 — First sign-in

1. Open your Pages URL.
2. It asks for the Apps Script link — paste the `/exec` URL from step 6.
3. Sign in with the Google account you put in `ADMIN_BOOTSTRAP_EMAIL`.

You are in, as admin.

---

## Step 9 — Turn on backups *(Apps Script path)*

On Supabase this is **[Backups](#backups-supabase)** near the top instead — the weekly workflow,
the key it seals with, and how to restore one.

In the Apps Script editor, run **`installBackupTrigger`** once.

A copy of the whole spreadsheet is saved to a Drive folder called *K'Cho Shelter Backups* — named
before the rename and deliberately left alone, because the string names a folder that already has
backups in it — every
night, keeping the last 30. This spreadsheet becomes the only record of every ringgit collected.
Do not skip this.

---

## Adding your team

**Someone who holds books** → the *Agents* screen. Name and phone. They need no Google account and
never sign in. Most people are only this.

**Someone who records sales in the app** → the *Admin* screen → *Add person*. They sign in with the
exact Google address you enter.

| Role | Can do |
|---|---|
| **Admin** | Everything |
| **Recorder** | Record sales, manage books, settle — but not manage people |
| **Agent** | Record sales only on books currently issued to them |
| **View only** | See totals and reports; phone numbers are hidden |

To remove someone, set them to *Disable*. Their access stops within a minute — no redeploy needed.

### Sharing the app with helpers

Send them one link with the API address in the `#` part:

```
https://shtrtickets.ceamalaysia.org/#s=https://script.google.com/macros/s/.../exec
```

or, if you stayed on the GitHub address:

```
https://hungom.github.io/k-cho-shelter/#s=https://script.google.com/macros/s/.../exec
```

They tap it once and the app remembers. The `#` part is never sent to any web server, so it stays
out of logs and browser history.

---

## Two people for the big changes

Small corrections go through straight away. Anything that cancels tickets across a range
of books is refused and offered to the organiser instead: the person sees what it would
do, presses **Ask the organiser**, and nothing changes until the System Admin approves it
on the **Approvals** screen. Approving carries it out immediately, in the name of the
person who asked. Requests lapse after a day.

The sentence the approver reads is written by the server, by the same code that executes
the change — so what is approved is exactly what happens.

## Turning features on and off

The System Admin has an **Access** screen: every feature, every role, on or off. What is
written in the code is only the starting point.

Two things cannot be changed there, and the server refuses them too even if somebody
edits the Permissions tab by hand:

- Features marked super-admin-only cannot be given to anyone. Otherwise an organiser
  could grant themselves the activity log and then erase the record of doing it.
- Managing people always stays with organisers, because turning it off would lock
  everybody out with no way back in.

## Before you print tickets

**Get the Burmese read by somebody who speaks it.** Every label in the app carries a
Burmese line, and it was machine-written — nobody has checked it. The words to check
first are the ones on buttons that destroy something: *Report books lost*, *Cancel a
ticket*, *Count a book in*. A wrong verb there means a volunteer agrees to something
they did not intend, and the mistake lands in the money.

The strings live in one file, `src/lib/i18n.js` — about ninety short phrases, grouped.
The approval sentences are deliberately left in English until that review is done.

Note also that phones still running **Zawgyi** rather than Unicode will show the Burmese
as nonsense. There is nothing to fix in code; it is worth knowing before you are asked.

## When something goes wrong

**"Not on the access list"** — the signed-in Google address is not in the Users tab, or is disabled.
Check the exact spelling. Personal Gmail and work Google accounts are different addresses.

**Nothing loads / network errors** — almost always the deployment settings. Re-check step 6:
*Execute as: **Me***, *Who has access: **Anyone***. If you changed them, you must deploy a **new
version** (Deploy → Manage deployments → pencil icon → Version: New version) — editing code alone
does not update the live URL.

**"Sign-in token was not issued for this app"** — the client ID in `index.html` does not match
`GOOGLE_CLIENT_ID` in Script Properties, or your Pages address is missing from Authorized JavaScript
origins. Both must match exactly.

**Sign-in button does nothing** — the address you are visiting is not in Authorized JavaScript
origins. Add it exactly: `https://hungom.github.io` or `https://shtrtickets.ceamalaysia.org` —
no repository name, no path, no trailing slash. Wait a few minutes; Google takes a little while to
apply changes.

**Sign-in stopped working right after moving to the custom domain** — that is the same thing. The
new origin has to be added in Google Cloud; the old one being there does not cover it.

**It asks for the Apps Script link again after moving domains** — expected. That setting is stored
per web address, so it does not carry across. Paste the `/exec` URL once, or open a `#s=` link.

**Custom domain stuck on "certificate not yet available"** — usually Cloudflare proxying. Set the
DNS record to **DNS only** (grey cloud), wait for GitHub to issue the certificate, then turn
proxying back on if you want it. Also check the CNAME points at `hungom.github.io`, not at
the repository.

**It works for a while, then stops** — Google signs everyone out after an hour.
The app now notices, keeps everything on screen, and shows "Your sign-in has expired"
with a button. Tap it and carry on — nothing in progress is lost. If no button
appears, reload the page.

**Two people saved at once** — the second gets *"changed by someone else while you were working
on it"*. That is the system doing its job. Refresh and redo that one entry.

**Something looks wrong in the data** — run **`verifyIntegrity`** in the Apps Script editor. It
writes a `_Health` tab listing anything inconsistent: missing tickets, rows out of order, books held
by an agent who is not on the list.

---

## Rules worth remembering

1. **Do not sort or reorder the Tickets or Books tabs by hand.** Use Google Sheets *filter views*
   instead (Data → Create filter view) — they show you a sorted view without moving the underlying
   rows. If rows do get shuffled, everything still works, just more slowly; `verifyIntegrity` will
   tell you.
2. **Never put a spreadsheet export in the repository.** It contains every buyer's phone number.
   `.gitignore` blocks `.csv` and `.xlsx`, but do not work around it.
3. **Numbering is locked after setup** on purpose. Get it right before printing.
4. The four green columns on the right of the *Books* tab (`Recorded_Sold` … `Variance_Amount`) are
   formulas. Do not type over them — they are what shows you, live, whether the cash matches the
   tickets.
