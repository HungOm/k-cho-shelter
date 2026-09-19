# Printing tickets, digital tickets, and a QR that can be checked

**Status: phases 1, 2, 3 and 4 built, 2026-09-19. Nothing is deployed.**

Artwork upload and the Ticket design screen; codes, the public verify function
and the verify page; and printing — by book, by a run of books, by typed
numbers, or the whole raffle — plus viewing a ticket as it will print.

Tested: 109 node suites and 322 SQL assertions against a real Postgres, all
green. The QR encoder was checked by decoding its output with a real scanner
across fifty cases, and one printed ticket was rendered by a browser and scanned
back to its verify address end to end.

Still true and worth repeating: **nothing is committed to production or
deployed.** Phase 5 (checking at the draw, rate limiting, the scan log) remains, and
phase 6 is housekeeping the designer rebuild left behind — a revision on the design
document so two writers cannot silently lose each other's work, and the removal of
the second copy of the design that exists only to keep older browsers correct.

---

## What this is for

The raffle prints thousands of paper tickets. Today the numbers are typed into the
artwork by hand at a print shop, the app never sees the artwork, and there is no way
to tell a real ticket from a convincing photocopy with a plausible number written on
it. This adds four things:

1. **A place to put the artwork** — upload it once, the app measures it and refuses
   anything that is not one of the accepted sizes.
2. **Tickets generated from it** — for one ticket, one book, a range of books, or the
   whole raffle, ready for the press.
3. **A digital ticket** — a picture a buyer can be sent after they have paid.
4. **A code on every ticket, in a QR** — scanned with any phone, it opens a page
   that says whether the ticket is genuine and whether it is recorded as sold.

The pilot that proved the hard part — putting a number on the artwork *exactly*, on
the printed label's own baseline — is `ticket-lab/`, built 2026-09-19. It folds into
the app in phase 1 and stops being a separate thing.

## What the owner decided

| | |
|---|---|
| **Who may do any of this** | **Organisers and the System Admin only** — uploading artwork, changing the design, generating codes, printing, and sending a digital ticket. Not sellers, not desk helpers, and **it cannot be granted to them from the Access screen.** |
| **What a stranger sees when they scan** | genuine or not, the ticket number, and whether it is sold. **Never the buyer's name or phone.** |
| **When a digital ticket may be sent** | only after the sale is recorded. **The picture is the buyer's half, cut at the perforation** — see below; the rule about carrying their name was written against a picture of the whole ticket and no longer describes what is sent. |
| **The QR already on the artwork** | a general CEAM link — it is replaced by the per-ticket QR. The verify page carries a CEAM link instead. |
| **Accepted sizes** | ships with one — this artwork, 190 × 61.4 mm. The design page lets an organiser add others. |
| **The code** | minted once and **kept**. A reprint of a ticket prints the same code it had before. |

#### What the digital ticket carries, and an open decision

The rule above said the picture carries the buyer's name, so a forwarded copy is
visibly somebody else's. That was written against a picture of the WHOLE ticket,
and it is no longer true, for a reason worth keeping: on this artwork the name,
phone, area and seller are all printed on the STUB. A picture of the whole ticket
is therefore a forwardable image of somebody's own contact details, and the stub
is the organiser's counterfoil — the half that comes back for the draw — so a
buyer holding a picture of it has an artefact that looks like something it is
not. The picture is now cut at `design.stubAt` and is the buyer's half only:
ticket number, book, and the QR. No contact details leave the building.

**That trades an anti-transfer marker for a privacy protection, and the two are
not the same thing.** In practice the marker was deterrence rather than a
control — the verify page already says the raffle is settled on the records and
not on the paper, so a forwarded picture never let anybody claim anything.

**The mockup specifies a third option that is better than either, and it is not
built.** Panel 3 of the design PDF does not show the whole ticket or the buyer's
half — it shows a purpose-drawn card carrying the ticket number, the book, the
buyer's NAME and the QR together, which on the real artwork come from opposite
sides of the perforation. That keeps the anti-transfer marker AND leaks no phone,
area or seller, because only the name is on it. Building it means a digital
layout rather than a crop of the printed one. Until somebody decides, the crop
ships: it is the option that removes a live leak, and it is reversible.

### How "organisers only" is actually enforced

This is worth being precise about, because the obvious implementation is wrong.

`gate.ts` lets a row in the `permissions` table hand any action whose `kind` is
`read` or `report` to another role — that is the point of the Access screen. It
refuses to widen a `write`. So every action in this feature is registered
`ADMIN_ONLY` **and `kind: 'write'`**, including the ones that only read, because a
`report` could be switched on for sellers by a single toggle.

`render_tickets` and `digital_ticket` are writes for an honest reason as well as a
defensive one: they hand out ticket codes and stamp `printed_at`. That is not a read.

`tests/strictactions.test.mjs` pins the registry line of all eight actions, so a
later edit to `kind: 'report'` fails the suite instead of quietly opening the door.

## The life of a ticket

```
expand_tickets    →  a row in  tickets        (this exists today)
generate_tickets  →  a row in  ticket_codes   ("generated ✓", about 60 bytes of text)
view / print / send  →  drawn in the browser, shown, and thrown away
```

**Nothing is ever stored as a picture.** A generated ticket is a short line of text.
The artwork is drawn onto it only at the moment somebody opens *View ticket*, prints
a book, or sends a digital ticket — and then discarded. Lists stay lists: the books
screen shows "generated ✓ / not yet" and a count, and never renders anything. That is
what lets the system hold twenty thousand tickets without getting heavy.

Printing is two steps on purpose — generate what is missing, then render — so that
"generated" is a visible state and a reprint can never re-mint a code.

## The code, and what it does and does not prove

A code is **12 random characters** (Crockford base32, 60 bits) minted once and stored
in `ticket_codes`. Verification is a lookup and a constant-time compare.

- A made-up code against a real number **fails**.
- An unknown number, a ticket never generated, and a wrong code all answer
  **identically**, so the endpoint cannot be used to work out which numbers exist or
  which have been printed.
- A reset deletes the table, so last raffle's tickets stop verifying by construction —
  there is no key to rotate and nothing to remember.

**A photocopy of a genuine ticket will verify.** That is true of anything printed, and
saying so here is better than implying otherwise. What defeats a photocopy is the
book: the draw is settled by the number recorded and the buyer recorded against it,
and the verify page says whether the ticket is recorded as sold. Phase 5 adds an
optional scan log so the same number scanned in two places on one day can be flagged.

Considered and not chosen: deriving the code from a signing key (HMAC), which stores
nothing and cannot be forged even from a stolen backup. It costs a secret to set at
deploy and an epoch to rotate, and the database already holds the thing worth more —
every buyer's phone number — behind the same protections. If it is ever wanted, only
two files change; the table stays as the record of what was generated and printed.

### Why a side table and not a column on `tickets`

Every `UPDATE` to `tickets` fires `bump_version()` and `record_ticket_history()`.
Minting twenty thousand codes as an update would bump twenty thousand versions
(a `VERSION_CONFLICT` for anyone mid-edit) and look like twenty thousand changes to
every connected phone. `ticket_codes` keeps all of it off the ticket row.

`delete from ticket_codes;` goes **before** `delete from tickets;` in `reset.sql` —
its foreign key would otherwise refuse the reset, which is exactly the trap
`reset.sql:76-88` already documents for `ticket_movements`.

### The QR on the page

The address is `https://shtrtickets.ceamalaysia.org/v/?KS-00123.<code>` — 60 bytes,
which is **QR version 4 at error correction M** (33 × 33 modules). In the box the
artwork already leaves (108 px on a 1600 px ticket) that is 0.39 mm per module at
190 mm print width: the same density as the placeholder QR printed there now. A white
backing with a quiet zone is drawn over the old one.

`VERIFY_URL` is a setting, blank meaning "this site". Printed QR codes outlive the
raffle, so an organiser has to be able to point them somewhere they control.

## What gets stored

| | Where | How much |
|---|---|---|
| The artwork | bucket `ticket-artwork`, created **in a migration** | once, up to 4 MB |
| A smaller copy for the screen | same bucket, made in the browser on upload | once, ~300 KB |
| Per ticket | a `ticket_codes` row | ~60 bytes |
| The design (what is printed, where it sits, print settings) | `ticket_templates.design` | ~4 KB |
| Printed sheets, digital tickets | nowhere — drawn and discarded | 0 |

A whole raffle is under 10 MB. Twenty thousand generated tickets add about 1.2 MB of
text. The same migration finally creates the `branding` bucket, which has been assumed
to exist since the logo feature shipped and was never written down
(`ARCHITECTURE-REVIEW.md:250`).

## The pieces

```
supabase/functions/api/templates.ts     upload_template · list_templates · set_template_design
                                        set_active_template · remove_template · set_ticket_sizes
supabase/functions/api/printing.ts      generate_tickets · render_tickets · digital_ticket
                                        (all ADMIN_ONLY writes — see "organisers only" above)
supabase/functions/_shared/ticketcode.ts   canonicalNumber · newCode · equalCodes
supabase/functions/verify/index.ts      the public one: auth 'none', reads two columns
src/lib/ticketdesign.js                 the default design (the pilot's measurements)
src/lib/ticketart.js                    where the number and QR go
src/lib/ticketsheet.js                  the printable sheet
src/lib/qrcodegen.js                    the QR encoder (vendored, MIT, one file)
src/lib/templatefile.js                 checking and shrinking an upload in the browser
src/components/TicketDesign.vue         the configuration screen
src/components/modals/{PrintTickets,ViewTicket,DigitalTicket}.vue
v/index.html + src/verify/              the public page: no sign-in, no store, ~3 KB
```

Drawing stays in the browser. The repo's stated position on printing is "no library,
no server" (`AUDIT.md:764`) and this keeps it; the one vendored file is the QR
encoder, which has no dependencies.

---

## Phase 1 — Upload the artwork, measure it, design the ticket

**Database** — `supabase/migrations/20260920100000_the_ticket_artwork_is_a_setting.sql`,
mirrored into `schema.sql`, `rls.sql` and `reset.sql`:

- `ticket_templates(id, name, content_type, width_px, height_px, bytes, url, design jsonb,
  active, uploaded_by, uploaded_at)`, RLS on, revoked from `anon` and `authenticated`,
  a partial unique index so only one can be active.
- The two buckets, guarded with `if to_regclass('storage.buckets') is not null` because
  `test-functions.sh` builds a plain Postgres with no storage schema.
- Settings `TICKET_SIZES` and `VERIFY_URL` (both blank = use the built-in default).
- `reset.sql`: `delete from ticket_templates;` and the two settings re-seeded blank —
  templates do not survive a reset, matching the logo.

**Server** — `supabase/functions/api/templates.ts`, modelled closely on `branding.ts`
and importing its `sniff`/`decode` rather than copying them:

- Size is read from the file's own header — PNG IHDR, JPEG SOF, WebP VP8X. No image library.
- An upload is refused unless the shape matches an accepted size within tolerance and
  is wide enough; the refusal says what was uploaded and what is accepted.
- SVG stays refused (`SVG_REFUSED`), a renamed file is caught by the byte sniff, 4 MB cap.
- Six actions, all `ADMIN_ONLY` writes.
- `configPayload` gains `ticketArtwork: boolean`, so buttons elsewhere can be disabled
  **with the reason** rather than refused after the click.

**Browser** — `src/lib/ticketdesign.js` (the pilot's measurements as the default
design), `ticketart.js`, `ticketsheet.js`, `qrcodegen.js`, `templatefile.js`, and
`TicketDesign.vue`: upload · accepted sizes · where the number goes (drag the boxes,
or type the numbers) · QR · printing · digital · a live preview and a test page.
Reached from its own tab and from the "How this raffle looks" card.

**Tests** — `templates.test.mjs`, `ticketart.test.mjs` (the pilot's 62 placement
assertions, now driven by the stored design), `seedagree.test.mjs`. `ticket-lab/`'s
isolation test is deleted in this commit, which is what its README asks for.

*Ships on its own:* an organiser can upload artwork, see it measured, and print a
numbered test page. No codes yet.

## Phase 2 — Codes, the public check, the page it opens

- `ticket_codes` and its migration.
- `_shared/ticketcode.ts` — pure, no dependencies, used by both functions.
- `generate_tickets` — by book, book range, named tickets, or everything; batched;
  idempotent, so running it twice generates nothing and says so; audited per batch.
- `supabase/functions/verify/index.ts` — `auth: 'none'`, its own
  `[functions.verify] verify_jwt = false`, one `select`, strict validation of both
  parameters, a dummy compare when the row is absent so timing gives nothing away.
  **`api` keeps `verify_jwt = true` untouched.**
- `v/index.html` + `src/verify/` — plain DOM, bilingual, no Supabase client, no
  sign-in script. A second Vite entry; `base: './'` handles the paths.
- `AUDIT.md` is edited: its "no per-ticket barcodes" line was about *identification*,
  and this is *forgery detection*. Reversing it in writing is part of this phase.

*Ships on its own:* generate a book, scan it, the page answers.

## Phase 3 — View and print

`render_tickets` returns only tickets that have been generated, and lists any that
have not rather than inventing them. `PrintTickets.vue` offers this book, a range of
books, everything, or typed numbers; prints through the existing print stylesheet, or
downloads self-contained files for the press — one per 50 books, artwork embedded once.
`ViewTicket.vue` draws one on demand. `BookDetail` gets *Print this book* and *View book*.

## Phase 4 — The digital ticket

**Built 2026-09-19, and it needed no new server action.** The plan called for a
`digital_ticket` handler. It turned out there was nothing for it to do:
`render_tickets` already returns the template, the code, the buyer and the status to
an organiser, and that request is already ADMIN_ONLY and registered as a write. So
the picture is drawn in `ViewTicket.vue` from what is already on screen — a canvas,
the artwork fetched a second time with `crossOrigin` set, and the SVG overlay drawn
on top. Adding a handler would have been a second door to data the caller could
already see.

The rules the plan set are kept, in the place they can be kept honestly:

- **Never a side door into minting.** Nothing in this path generates a code.
  `render_tickets` lists what has not been generated and refuses to invent it.
- **Nothing that is not sold.** The buttons are shown DISABLED WITH THE REASON —
  "the sale is not recorded yet, so there is nothing to send a buyer" — rather than
  hidden, per the `permissionui` rule. Note this is a UI gate on data the organiser
  can already see, not a permission boundary; the boundary is `render_tickets`.
- **A text fallback, always.** Canvas export fails when Storage does not answer with
  a CORS header, and on browsers without file sharing. Both fall through to a
  WhatsApp message carrying the verify link — which is the part that actually
  matters, because it is what lets the buyer prove the ticket later.

One thing the plan did not anticipate: a webfont does not load inside an SVG drawn
into a canvas, so a Burmese name renders in whatever Myanmar font the phone itself
has. That is the same bet the printed ticket makes, and the reason `TEXT_FAMILY`
ends in a system fallback rather than at Padauk.

## Phase 5 — The draw, and hardening

A *Check a ticket* card on the draw screen — typed number, or camera where the
browser has `BarcodeDetector`. Rate limiting on the public endpoint. Optionally a
scan log, which is a public write and so needs its own care. Then the documents:
`ARCHITECTURE-REVIEW.md`, `RESET-RUNBOOK.md`, `README.md`, `SETUP.md`, and
`ticket-lab/README.md` rewritten as a pointer to where it all went.

## Phase 6 — One design, one writer, one representation

Two pieces of housekeeping that the ticket-designer rebuild left behind. Neither is
urgent; both get worse the longer they wait, and the second cannot start until the
first has been deployed long enough for browsers to turn over.

### 6a — The design document gets a revision

**The defect, stated plainly: `ticket_templates.design` is a single JSON document,
overwritten wholesale, with no concurrency control.** Last write wins, silently.
Two organisers editing the design on two phones lose one of the two edits with no
error on either screen. That is true today, it has nothing to do with any deploy,
and nothing in the suite would catch it.

The same defect shows up a second way during a staged deploy. A push deploys the
browser app while the function and the migrations stay held, so the two halves of
the system are routinely different ages. A browser still running a bundle from
before the element rebuild echoes back an `elements` array it does not understand
alongside its own edited slots, and the newer bundle then reads the list and
silently discards the older bundle's edit. A revision closes that as a special case
of the general one, which is why it is the right fix rather than a third patch on
the symptom.

- **Migration:** `alter table ticket_templates add column design_rev integer not null
  default 0`. There is no `updated_at` on this table to reuse, and an integer is
  better than a timestamp here — monotonic, and no clock to disagree about. Also
  `schema.sql` and `fakedb.mjs`.
- **`list_templates`** returns `designRev` alongside the design.
- **`set_template_design`** takes the rev the client loaded and writes
  `... where id = $1 and design_rev = $2`, setting `design_rev = design_rev + 1`.
  Zero rows updated means somebody else got there first → `ApiError('STALE_DESIGN')`,
  which by the table below also needs a Burmese line in `MY_ERRORS`.
- **`TicketDesign.vue`** holds the rev it loaded and, on a refusal, says that
  somebody else saved while this was being edited and offers to reload — rather than
  overwriting them or silently keeping both.

**One decision to make when this is built.** An older client sends no rev at all.
Refusing those writes locks out any browser that has not reloaded; accepting them
keeps the hole open for exactly as long as such browsers exist. Take the second
until 6b lands, then flip to refusing, and say which is in force in the handler's
own header so the next reader does not have to infer it.

### 6b — Delete the second representation

The design is currently stored **twice**: as `elements`, and as the named slots
(`main`, `stub`, `book`, `buyer`, `qrMain`, `qrStub`) the list was derived from.
Nothing here reads the slots once a list exists — `elementsOf` takes the list
outright — but a browser running a pre-rebuild bundle does, so
`legacyFromElements` writes them back in step on every save. Without that, an old
tab prints a whole run from where an element used to be, with no error on either
machine; `tests/ticketart.test.mjs` pins it.

**That bridge is transitional, and its fragility is specific: any future code that
writes `elements` without calling `legacyFromElements` reintroduces the divergence,
and nothing would report it.** So it gets a removal date rather than an indefinite
life.

- **When:** once no browser predating the element rebuild can still be running — one
  full client deploy, plus enough time for organiser tabs to turn over. Check the
  stored rows first: no design should be without an `elements` array.
- **What goes:** the legacy slots from the stored design on next save;
  `legacyFromElements` and `elementsFromLegacy` from `ticketelements.js`; the two
  tests that pin them (*the old slots are kept in step* and *a design migrated to
  elements draws what it drew before*); and whatever `DEFAULT_DESIGN` carries that
  only the old shape needed.
- **What is left:** one representation, so there is nothing to diverge.

### Worth doing alongside, and client-only

`__APP_VERSION__` already exists in `vite.config.js` and is shown on the Admin
screen and nowhere else — nothing compares it to anything. Having the app notice it
is older than the build being served and offer a reload would shrink the stale-tab
window for **every** screen, not only this one, and needs no migration and no
function deploy. It does not fix two organisers editing at once; only 6a does.

## Phase 7 — Resetting a raffle, and seeding one

Asked for on 2026-09-20: a reset the System Admin can drive from the app, per
feature, with the confirmation typed by hand — and a seed that covers every
feature. **Part of it is built; the destructive half deliberately is not.**

### What is built

`supabase/functions/_shared/resetplan.ts` and `tests/resetplan.test.mjs` — the
model that decides what a reset would destroy, with no ability to destroy
anything. It answers, for any set of ticked features: what must go with them,
what cannot be done from here at all, in what order rows come out, and what
survives pointing at nothing.

**The finding that shaped it: a foreign key is not the same question as "is this
safe to reset alone".** Sixteen of twenty-one tables have nothing referencing
them, and three of those are the most dangerous single resets in the system —
`payments` (what a seller owes is a book figure plus hand payments, so deleting
one door changes the answer), `config` (every ticket was issued under the
numbering it holds), and `ticket_codes` (codes for printed books exist on paper;
deleting them stops real tickets verifying). So the model carries two kinds of
edge: foreign keys, DERIVED and checked against schema.sql in both directions,
and logical dependencies, declared by hand with the sentence explaining each.

A table nobody has classified is a test failure, not a default. That is the
`money_entries` shape from `resetcovers`: absent from the list, it survives the
reset silently and the next raffle starts with the last one's rows in it.

`on delete` matters and the first version got it wrong: `restrict` refuses,
`cascade` deletes the child too, `set null` keeps the row and empties the link.
Treating all three as forcing made "reset the sellers" drag in accounts through
a `set null` that deletes nobody, and refuse the lot.

### What is deliberately not built

**The deleting.** Three existing tests refuse it in TypeScript — `custodyledger`
and `moneyjournal` fail any handler naming `ticket_movements` or
`money_entries`, and they are right: a handler that writes the ledger lets the
projection drift from it. The destruction belongs in a **SQL function** that
takes the triggers off, empties in one transaction and puts them back before it
commits, called by both `supabase/reset.sql` and the new action. One
implementation, not two, for the reason `resetcovers` exists.

### What it still needs, in order

1. **The SQL function**, plus a migration. `reset.sql` refactored to call it so
   the two cannot drift.
2. **`reset_preview` and `reset_apply`**, SUPER_ADMIN_ONLY and registered as
   writes so no permissions row can hand them out — the `templates.ts`
   precedent. Both need the registry entries and the Burmese error lines the
   table below requires.
3. **The confirmation names the damage, not a token.** `RESET-THE-RAFFLE`
   becomes muscle memory; `DELETE 4182 TICKETS AND 312 PAYMENTS` has to be read.
   Generated server-side and **re-checked against live counts at execution** —
   somebody may have been selling while the dialog sat open.
4. **A backup first, and a refusal without one.**
5. **The printed-paper guard**: refuse a codes reset for any book with
   `printed_at` set, unless the whole raffle is going, and name the books.
6. **The screen**, in Admin — the feature list, what each selection grew into
   and why, the counts, and the phrase to type.
7. **The seed**, separately: idempotent, refusing on a non-empty system unless
   paired with a reset. `seedagree` already pins that three seed routes must
   agree on numbering; a fourth joins that test.

### Still to decide

Whether this is for **starting the next raffle round** on a live system or for
**demo and evaluation installs**. Reset and seed are separable and both are
worth having, but they want opposite defaults — maximum friction against one
button — and that decides the shape of 6 and 7.

---

## Rules every phase follows

These are enforced by the existing suite, not by good intentions:

| Adding | Also needs |
|---|---|
| an action | `REGISTRY` + `ACTION_META` + `WRITES` + a call in `everyaction` + `readshape`/`payloads` if a screen reads the reply |
| an error code | a Burmese line in `MY_ERRORS` |
| a `<Bi text>` label | a Burmese line in `MY` |
| a table | `schema.sql` + a migration + `fakedb.mjs` + a `delete from` in `reset.sql` (children first) + an RLS revoke |
| a setting | the schema seed block + a migration + `reset.sql` + the count in `freshinstall` + `SETUP.md` |
| a test file | the one line in `tests/run.sh` — and it must keep mode 100755, or every deploy dies |
| a screen or modal | the import, the `openModal`, and the branch in `App.vue`; emits with listeners |

**Order, every time: migrations → function → push.** A push to master deploys only the
browser app; the function and the database are deployed by hand. Deploying the
function before its SQL is how book issuing stopped working for a day.

**Work on a branch from a clean checkout.** Several sessions share this working tree,
and `supabase functions deploy` bundles what is on disk rather than what is committed.

## How it gets checked

1. `./tests/run.sh` — the deploy gate.
2. Handlers through `tests/loadts.mjs` against the in-memory database, including the
   new public function. One fix needed there first: `loadts.mjs` names its bundle after
   the file's basename, so `api/index.ts` and `verify/index.ts` would collide.
3. The pilot's placement assertions, carried over intact, plus a QR test pinning the
   address to version 4.
4. A proof render with no browser involved, and `proof.py` to look at the QR box zoomed in.
5. `npm run build && npm run preview`, then open `/v/?KS-00001.<code>`.
6. End to end: upload → design → print Book-001 → scan → genuine, unsold → sell it →
   scan → genuine, sold → change one character → not genuine.
7. After each deploy, grep the served bundle for a **string literal** the phase adds.
   Never a symbol — the minifier renames those, and a zero result would look like a
   failed deploy when nothing was wrong.

## Known risks

- **How big an upload the function will take** is not knowable from this repo; phase 1
  settles it with one real 3.9 MB upload. The fallback is a signed upload URL, which is
  worse because the bytes reach the bucket before they are checked.
- **Printed QR codes are permanent.** `VERIFY_URL` is the escape hatch, but the address
  in the first press run is the one that matters.
- **A photocopy verifies.** Stated above; the book decides, not the paper.
- **`BOOK_DIGITS` disagrees with itself** — 4 in the schema seed, 3 in `reset.sql` and in
  both code paths. Every book label must come from the live setting, never a seed.
- **The design is stored twice until phase 6b.** `elements` is the truth; the old named
  slots are written back in step by `legacyFromElements` purely so a browser running a
  pre-rebuild bundle stays correct. Anything that writes `elements` without calling it
  puts the two out of step, and nothing reports that — an older tab then prints from
  where an element used to be. Treat the bridge as load-bearing until it is deleted.
- **Two organisers can overwrite each other's design, today.** The document has no
  revision and the last write wins in silence. Phase 6a is the fix; until then it is
  a real hazard on a screen two people can both reach.
