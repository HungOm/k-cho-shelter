# Setting up Raffled

One-time setup, about 30 minutes. Do the steps in order — later ones depend on earlier ones.

You need: a Google account, and the ability to create a GitHub repository.

Anything in `<angle brackets>` is yours to fill in — `<you>` is your GitHub account, `<your-repo>`
the repository you push to, `<your-domain>` the name you own if you set one up under **Using your own address**, and
`<project-ref>` the reference Supabase gives your project. This guide names no account, repository
or address of its own on purpose: a copied example that happens to work is how somebody ends up
pointing their raffle at a stranger's deployment.

---

## Setting it up

Everything below builds one Supabase project: Postgres, one Edge Function in front of it, and a
static page on GitHub Pages. Two of the steps below — **Creating the Google sign-in ID** and
**Putting the app online** — are the only ones that touch anything outside it.

**Running your own Supabase instead?** The same tree deploys to a stack you host yourself — no
fork and no build flag. Everything in this guide still applies except the four steps that assume a
hosted project: creating it, linking the CLI, deploying the functions, and the dashboard. Those
four are in [supabase/SELF-HOST.md](supabase/SELF-HOST.md), which says which parts of this file to
skip and what replaces them. Read that one alongside this, not instead of it.

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough) and
   `supabase link --project-ref <ref>`.
2. `cp supabase/.env.local.example supabase/.env.local` and fill in the URL and the **secret** key
   from Settings → API. `./supabase/connect.sh` checks it and refuses the publishable key, which
   otherwise appears to work for reads and fails on every write.
3. Apply the database **in this order**: `./supabase/connect.sh --schema`, then
   `supabase/functions.sql`, then `supabase/rls.sql`, and `supabase db push` for the migrations
   LAST. The order is not a preference — six migrations call `app_role()` or read
   `book_ledger_all` and `config_readable`, and all of those live in `rls.sql`. Pushing the
   migrations before it fails with `function app_role() does not exist`, which reads like a broken
   migration and is really a build run out of order. `supabase/test-functions.sh` builds a project
   this way on every run, so if this list is ever wrong again the suite says so.
   **`rls.sql` is not optional** — it is what makes the database default-deny, and without it the
   browser's key can read every table directly.
4. `supabase functions deploy api`, and set its secrets — including `SUPER_ADMIN_EMAIL`, which is
   the one thing that must live outside the database.

   Then `supabase functions deploy verify`. **There are two functions and they are not alike.**
   `api` is everything the app does and answers only a signed-in person. `verify` answers
   anybody: it is what a phone reaches when somebody scans the QR on a printed ticket, and it
   has no sign-in because a stranger in a hall has no account. It is safe to be public because
   of what it can reach — whether a code matches, and whether the ticket is recorded as sold.
   No buyer, no phone number, no list. `supabase/config.toml` turns the platform's JWT check off
   for that function alone, with the reasoning written beside it; do not copy that setting to
   `api`.
5. Enable Google under Authentication → Providers and paste in the client ID from **Creating the Google sign-in ID** below.
6. Set the repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then
   push. The publishable key is meant to be public — row-level security is what stands between it
   and the data, which is why `rls.sql` is not optional.
7. Turn on the weekly backup — **[Backups](#backups-supabase)** below. The free plan takes none,
   and the job deliberately fails every week until it is set up.
8. **Set the numbering, then make the tickets.** A new project starts with the 29 settings in the
   `config` table already filled in and **no tickets at all** — `TOTAL_TICKETS` is `0`. Open
   Table Editor → `config` and set `TICKET_PREFIX`, `TICKET_DIGITS`, `TICKETS_PER_BOOK`,
   `BOOK_PREFIX` and `BOOK_DIGITS` to what you are printing, along with `EVENT_NAME`, `ORG_NAME`,
   `CURRENCY` and `TICKET_PRICE`.

   Then sign in as the System Admin and use **Books → Make more tickets**, which previews the
   range before it writes anything. Generate the tickets and books in one go.

   **Set the numbering before you generate, not after.** Once a single ticket row exists the
   database refuses to change any of those five, and it refuses for a reason: every ticket number
   is a stored string while every lookup recomputes it from these settings. Change the prefix
   afterwards and the two stop agreeing — searching finds nothing, selling says the ticket does
   not exist, and the paper in somebody's hand no longer refers to anything. Nothing throws. It
   simply stops matching.

   `TOTAL_TICKETS` can always be raised later from the same screen. It can never be lowered.
9. **Upload the ticket artwork.** Sign in as an organiser and open **Ticket Studio**. Give it a
   picture of one blank ticket, stub included — PNG, JPEG or WebP, about 2244 pixels wide for a
   sharp press run at 190 mm. It is measured on the way in and refused if its shape is not one
   the raffle prints; the accepted shapes are a list on the same screen, and
   `TICKET_SIZES` in `config` holds it.

   The number is then placed for you, on the printed label's own baseline, and every measurement
   is a field on that screen if it is not right. Nothing is stored per ticket: a ticket is drawn
   when somebody opens or prints it and thrown away again, which is what lets a raffle hold twenty
   thousand of them without getting heavy.

   This screen, and everything behind it, is **organisers and the System Admin only** — and
   unlike most features it cannot be handed to another role from the Access screen.
10. Check it: `./tests/run.sh`, and `./supabase/test-rls.sh` against a throwaway database.

The numbered steps below expand on the two that need a Google account rather than a Supabase one.

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

## Creating the Google sign-in ID

This is what lets people prove who they are. It is the fiddliest step; take it slowly.

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Top left, click the project dropdown → **New Project**. Name it **Raffled**. Create it, then select it.
3. In the search bar type **OAuth consent screen** and open it.
   - User type: **External** → Create
   - App name: your organisation's name — this is what Google shows the person signing in —
     user support email: your email, developer contact: your email
   - Save and continue through the remaining steps. You do **not** need to add scopes.
   - On *Audience* / *Test users*, either add the Google accounts of your helpers as test users,
     or click **Publish app** so anyone can sign in. (Access is controlled by `app_users` either
     way — publishing does not give anyone access to your data.)
4. Search for **Credentials** → **+ Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `Raffled web`
   - Under **Authorized JavaScript origins**, click *Add URI* and add:
     - `https://<you>.github.io`
     - `https://<your-domain>` — if you have set one up
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

### The same client ID has to be listed in Supabase too

The app signs in with the Google button on its own page and trades the token Google returns for a
Supabase session, rather than handing off to `<project>.supabase.co` and coming back. That is why
Google's screen says **Sign in to** your own address and not a forty-character project
reference — which is worth keeping, because a random string is exactly what a phishing page looks
like to somebody being careful.

Supabase will only accept a token minted for a client ID it has been told to trust:

> Supabase dashboard → **Authentication** → **Providers** → **Google** → enable it, and paste the
> client ID from above into **Authorized Client IDs**.

Until that is done every sign-in is refused. The app says so in those words rather than reporting a
rejected credential, because it is a setting somebody has to change and no amount of trying again at
the phone will fix it.

If you need the old behaviour — a build with no client ID compiled in, say — add `?signin=redirect`
to the address and the handoff comes back.

---

## The two deadlines

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

## Who has reported

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

## Growing a raffle that is already running

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
| the new total is above `TICKET_CEILING` | a slipped digit would generate ten times the tickets you meant |

---

## Putting the app online

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

> **On an established deployment** the repository name and the address people type may both be
> older than the name the product goes by now, and that is fine. Renaming a repository moves every
> clone's remote, and renaming a domain takes the app off the air until DNS catches up. Neither is
> part of naming the product.
5. Check that this address matches what you put in **Authorized JavaScript origins** for the sign-in ID.
   The origin is just the `https://<you>.github.io` part — no repository name.

---

## Using your own address (optional but recommended)

An address of your own — `tickets.<your-domain>` — looks far more trustworthy to a ticket buyer
than a `github.io` address, and it costs nothing. Skip this if you are happy with the GitHub address.

Pick the name carefully — once it is in DNS and in Google's settings, changing it means redoing
both. Short is better when people type it on a phone.

**1. Point the name at GitHub.** With whoever manages DNS for `<your-domain>`, add one record:

| Type | Name | Value |
|---|---|---|
| CNAME | `tickets` | `<you>.github.io.` |

The trailing dot on the value belongs there. A subdomain uses a **CNAME** record. (A records are
only for an apex domain like `<your-domain>` itself.) On Cloudflare, set the record to **DNS only** — the grey cloud, not the orange one — until
GitHub has issued the certificate. Proxying during setup is the usual reason HTTPS gets stuck.

**2. Tell GitHub.** A `CNAME` file naming the domain is committed at the root of this repository,
so Pages picks it up on its own — change it to your own name. Check under
**Settings → Pages → Custom domain**, and type it in there if the box is empty. Wait for the DNS check to go green, then
tick **Enforce HTTPS**. Usually minutes; occasionally a few hours.

**3. Tell Google.** In Google Cloud → **Credentials** → your OAuth client → **Authorized JavaScript
origins**, add `https://tickets.<your-domain>`. **Sign-in will not work until you do this.** Leave
the `github.io` origin in the list as well, so nothing breaks while DNS spreads.

Nothing changes in Supabase. The Edge Function does not care which site calls it, and access is
decided by the signed-in session, not the domain. No redeploy needed.

**One thing that catches people out.** The address gets shorter: on GitHub it was
`…github.io/<your-repo>/`; on your own subdomain the app sits at the root, so it is just
`https://tickets.<your-domain>/`. Everyone signs in again once, because a session is tied to the
address it was created on.

> If you later publish the OAuth consent screen with a homepage on `<your-domain>`, Google will
> ask you to prove you own the domain via Search Console. Adding a JavaScript origin, as above,
> needs no verification.

---

## First sign-in

1. Open your Pages URL.
2. Sign in with the Google account you put in `SUPER_ADMIN_EMAIL`.

You are in, as the System Admin. That account is the way back in before the allowlist has any rows,
which is why it lives in a function secret rather than in the table it lets you edit.

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

Send them the address. There is nothing to paste and nothing to configure — the app knows which
project it belongs to because that was built into it.

```
https://tickets.<your-domain>/
```

They sign in with Google, and see whatever their row in `app_users` allows. Somebody with no row
is told they are not on the list rather than shown an empty raffle.

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

**"Not on the access list"** — the signed-in Google address has no row in `app_users`, or its
status is not `active`. Check the exact spelling. Personal Gmail and work Google accounts are
different addresses.

**Nothing loads / network errors** — check the Edge Function is deployed and its secrets are set
(`supabase functions list` shows the live version). A function deployed without `SUPER_ADMIN_EMAIL`
refuses everybody, including you.

**"Sign-in token was not issued for this app"** — the client ID the build was given does not match
the one in Google Cloud, or your Pages address is missing from Authorized JavaScript
origins. Both must match exactly.

**Sign-in button does nothing** — the address you are visiting is not in Authorized JavaScript
origins. Add it exactly: `https://<you>.github.io` or `https://tickets.<your-domain>` —
no repository name, no path, no trailing slash. Wait a few minutes; Google takes a little while to
apply changes.

**Sign-in stopped working right after moving to the custom domain** — that is the same thing. The
new origin has to be added in Google Cloud; the old one being there does not cover it.

**Custom domain stuck on "certificate not yet available"** — usually Cloudflare proxying. Set the
DNS record to **DNS only** (grey cloud), wait for GitHub to issue the certificate, then turn
proxying back on if you want it. Also check the CNAME points at `<you>.github.io`, not at
the repository.

**It works for a while, then stops** — a Supabase session is refreshed in the background, so this
is usually the browser having been asleep. Reload the page and sign in again; nothing recorded is
lost, because nothing is held only in the page.

**Two people saved at once** — the second gets *"changed by someone else while you were working
on it"*. That is the system doing its job. Refresh and redo that one entry.

**Something looks wrong in the data** — the database enforces most of it and will have refused
rather than stored it; `supabase/AUDIT.md` lists what is guaranteed and what is not. For the rest,
the audit log (Setup → What people have been doing) records every write with who made it.

---

## Rules worth remembering

1. **Numbering is locked once tickets exist**, on purpose, and the database enforces it rather than
   asking you to remember. Get it right before printing.
2. **Never put an export of the data in the repository.** It contains every buyer's phone number.
   `.gitignore` blocks `.csv` and `.xlsx`, but do not work around it.
3. **`rls.sql` is not optional.** It is what makes the database default-deny. Without it the key
   that ships in the browser can read every table directly.
4. **Apply the SQL before deploying a function that needs it.** A function deployed ahead of its
   migration answers every call with a database error, and the order is the only thing standing
   between you and that.
