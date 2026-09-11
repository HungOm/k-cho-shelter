# Setting up K'Cho Shelter

One-time setup, about 30 minutes. Do the steps in order — later ones depend on earlier ones.

You need: a Google account, and the ability to create a GitHub repository.

---

## Step 1 — Create the spreadsheet

1. Go to [sheets.new](https://sheets.new) to make a new blank spreadsheet.
2. Name it **K'Cho Shelter Tickets**.
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

4. Click the **save** icon. Name the project **K'Cho Shelter API**.

> Prefer the command line? `npm i -g @google/clasp`, then `clasp login`, `clasp clone <script id>`,
> copy the files in, and `clasp push`. Much faster when you need to update the code later.

---

## Step 3 — Create the Google sign-in ID

This is what lets people prove who they are. It is the fiddliest step; take it slowly.

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Top left, click the project dropdown → **New Project**. Name it **K'Cho Shelter**. Create it, then select it.
3. In the search bar type **OAuth consent screen** and open it.
   - User type: **External** → Create
   - App name: `K'Cho Shelter`, user support email: your email, developer contact: your email
   - Save and continue through the remaining steps. You do **not** need to add scopes.
   - On *Audience* / *Test users*, either add the Google accounts of your helpers as test users,
     or click **Publish app** so anyone can sign in. (Access is controlled by the Users tab either
     way — publishing does not give anyone access to your data.)
4. Search for **Credentials** → **+ Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**
   - Name: `K'Cho Shelter web`
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

**Google also hands you a "client secret" and offers a JSON download. This app never uses it.**
This sign-in flow has no secret — do not put that file in the repository, and do not paste its
contents anywhere. Note the client ID and delete the download.

**This client ID is not a secret.** It is meant to be public and it is safe in the repo. What
protects it is the *Authorized JavaScript origins* list you just filled in: a sign-in token carrying
your client ID can only be issued to a page served from your own domain. A copy on somebody else's
site is useless.

---

## Step 4 — Tell the script who you are

Back in the Apps Script editor:

1. Click the **gear icon** (Project Settings) in the left sidebar.
2. Scroll to **Script Properties** → **Add script property**. Add these two:

   | Property | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | `981045980686-ah7579259e9j24l2pgnsbb2v4bn0biud.apps.googleusercontent.com` |
   | `ADMIN_BOOTSTRAP_EMAIL` | your own Google email address |

3. Click **Save script properties**.

`ADMIN_BOOTSTRAP_EMAIL` is your way back in: that address is always treated as an admin, even before
the Users tab exists. Without it you can lock yourself out of your own spreadsheet.

---

## Step 5 — Choose your ticket numbers, then build the sheet

**Do this before you print any tickets.** Numbering locks once tickets exist.

1. In the Apps Script editor, pick `setup` from the function dropdown at the top and press **Run**.
2. The first time, Google asks for permission: **Review permissions** → choose your account →
   **Advanced** → **Go to K'Cho Shelter API (unsafe)** → **Allow**.
   (The "unsafe" warning appears for every script that hasn't been through Google's paid review.
   It is your own code, running in your own account.)
3. Go back to the spreadsheet. You now have tabs: **Tickets, Books, Agents, Users, Winners,
   Book_History, Config, _AuditLog**.
4. Open the **Config** tab and set your numbers:

   | Key | Default | Change it to |
   |---|---|---|
   | `TICKET_PREFIX` | `KS-` | whatever goes before the number, or blank |
   | `TICKET_START` | `1` | the first ticket number |
   | `TICKET_DIGITS` | `4` | padding — `4` gives `KS-0001` |
   | `TOTAL_TICKETS` | `6000` | how many tickets you are printing |
   | `TICKETS_PER_BOOK` | `10` | how many in one physical book |
   | `BOOK_PREFIX` / `BOOK_DIGITS` | `Book-` / `3` | `Book-001` |
   | `TICKET_PRICE` | `10` | price of one ticket |
   | `CURRENCY` | `RM` | |
   | `DEFAULT_DUE_DAYS` | `30` | how long agents keep books |
   | `EVENT_NAME`, `ORG_NAME`, `DRAW_DATE` | | shown on receipts |

5. If you changed any of the numbering rows, run **`regenerate`** to rebuild the tickets and books.
   Run **`showConfig`** to print what you have; check the first and last ticket numbers look right.

> `regenerate` refuses to run once any ticket has been sold. At that point the printed tickets in
> people's hands are the real record, and renumbering would disconnect every one of them.

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
`{"ok":true,"message":"K'Cho Shelter API is running..."}`.

---

## Step 7 — Put the app online

1. Create a new **GitHub repository**, e.g. `kcho-shelter`. Public or private both work.
2. The client ID is already set near the top of the `<script>` block in `index.html` — check it
   matches the one in your Google Cloud credentials:
   ```js
   const GOOGLE_CLIENT_ID = "981045980686-….apps.googleusercontent.com";
   ```
3. Push the project:
   ```bash
   git add .
   git commit -m "K'Cho Shelter ticket tracker"
   git remote add origin https://github.com/hungom/kcho-shelter.git
   git push -u origin main
   ```
4. On GitHub: **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)`
   → **Save**. After a minute your site is at `https://hungom.github.io/kcho-shelter/`.
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

## Step 9 — Turn on backups

In the Apps Script editor, run **`installBackupTrigger`** once.

A copy of the whole spreadsheet is saved to a Drive folder called *K'Cho Shelter Backups* every
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
https://hungom.github.io/kcho-shelter/#s=https://script.google.com/macros/s/.../exec
```

They tap it once and the app remembers. The `#` part is never sent to any web server, so it stays
out of logs and browser history.

---

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
