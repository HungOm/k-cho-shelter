# Printing tickets, digital tickets, and a QR that can be checked

**Status: phases 1, 2 and 3 built, 2026-09-19. Nothing is deployed.**

Artwork upload and the Ticket design screen; codes, the public verify function
and the verify page; and printing — by book, by a run of books, by typed
numbers, or the whole raffle — plus viewing a ticket as it will print.

Tested: 109 node suites and 322 SQL assertions against a real Postgres, all
green. The QR encoder was checked by decoding its output with a real scanner
across fifty cases, and one printed ticket was rendered by a browser and scanned
back to its verify address end to end.

Still true and worth repeating: **nothing is committed to production or
deployed.** Phases 4 (the digital ticket a buyer is sent) and 5 (checking at the
draw, rate limiting, the scan log) remain.

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
| **When a digital ticket may be sent** | only after the sale is recorded, and it carries the buyer's name so a forwarded copy is visibly someone else's. |
| **The QR already on the artwork** | a general CEAM link — it is replaced by the per-ticket QR. The verify page carries a CEAM link instead. |
| **Accepted sizes** | ships with one — this artwork, 190 × 61.4 mm. The design page lets an organiser add others. |
| **The code** | minted once and **kept**. A reprint of a ticket prints the same code it had before. |

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
| The design (where the number and QR sit, print settings) | `ticket_templates.design` | ~2 KB |
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

`digital_ticket` refuses anything not sold, and **never generates a code** — if the
book was never printed it says so, rather than becoming a side door into minting.
The picture is drawn on the phone and shared; there is always a WhatsApp text
fallback carrying the verify link, because canvas export fails on some browsers.
The button appears for organisers only.

## Phase 5 — The draw, and hardening

A *Check a ticket* card on the draw screen — typed number, or camera where the
browser has `BarcodeDetector`. Rate limiting on the public endpoint. Optionally a
scan log, which is a public write and so needs its own care. Then the documents:
`ARCHITECTURE-REVIEW.md`, `RESET-RUNBOOK.md`, `README.md`, `SETUP.md`, and
`ticket-lab/README.md` rewritten as a pointer to where it all went.

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
