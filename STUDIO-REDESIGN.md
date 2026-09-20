# The mockup, inspected — and what applying it actually costs

Source: `~/Downloads/Ticket Designer.html`, a 7.6 MB self-unpacking canvas
document. Unpacked: **26 screen mockups in 9 chapters**, each a 1280×800
inline-styled frame. Rendered and looked at, not only parsed.

Inspected 2026-09-20 15:38. HEAD `246c9bd`.

---

## 1. What the document contains

| Chapter | Cards |
|---|---|
| 1 · Set the raffle up | Setup (brand colour on real chrome), Access (System Admin only, shows diffs) |
| 2 · The studio | Start a design, studio light, studio dark, artwork & paper, collapsed rail, print sheet, digital ticket (future tab) |
| 3 · Get the books ready | Books (selection raises an action bar), Print tickets step 1 and step 2 |
| 4 · Sell tickets | Home, list + docked ticket panel, a sold ticket, write down sales |
| 5 · Count the money | Money — running-balance statement |
| 6 · Keep control | Approvals |
| 7 · What the buyer gets | Keepsake ticket, three treatments, public ticket check |
| 8 · Draw the winners | Readiness checklist + prize form |
| 9 · Earlier explorations | Four superseded cards — **out of scope, by the document's own label** |

The nav in every frame is this app's nav, screen for screen: Home, Find, Sell,
Books, Sellers, Money, Draw, Setup, Ticket design, Approvals. This is a
redesign of what exists, not a different product.

---

## 2. The good news: it extends the system rather than replacing it

Colour frequency across the 22 in-scope cards:

```
226  #0d7a6f   the app's --brand, unchanged
 29  #e8f4f1   ≈ --brand-soft (#e3f4f1)
 29  #b3261e   exactly --bad
300  #f4f6f5   ≈ --bg (#f4f6f8), a shade greener
 58  #0f1a17   ≈ --text (#12161c), a shade greener
  8  #7fd3c4   dark-mode brand, ≈ the existing dark --brand (#2bd4c0)
```

So the brand survives, dark mode survives, and the semantic colours survive.
What changes is the **neutral ramp**: the app's neutrals are blue-grey
(`#dce1e8`, `#5d6775`), the mockup's are green-grey (`#e4e9e7`, `#5b6b66`,
`#8a9793`). That is a real improvement — a neutral that carries a trace of the
brand is why the mockup reads as one designed thing rather than teal dropped on
Bootstrap grey.

One addition that is genuinely new: **`#ffe9a3`**, a warm yellow, used only on
the ticket artwork — the perforation, the serial, the stub. It is the ticket's
own colour, not a UI colour, and it should be added as such.

---

## 3. The difficult news: the mockup is a desktop document

Every frame is 1280×800. The type and spacing follow:

| | This app today | The mockup | 
|---|---|---|
| base type | **17px** (chosen: "readable at arm's length by someone not confident with phones") | 11.5–12.5px dominant, 10.5px lower bound |
| radius | `--r 16px`, `--r-sm 11px` | 5px dominant, then 9px, 8px |
| tap target | `--tap 52px`, nothing interactive smaller | table rows ~34px, chips ~26px |
| icons | hand-drawn stroke set, 43 glyphs, no network | **Phosphor webfont**, 330 uses, ~40 glyphs, CDN |
| type family | system stack + Padauk/Noto Sans Myanmar for Burmese | Inter |

**This is the single decision the whole job turns on.** `--tap: 52px` is not a
comfort default here; it is why a seller standing outdoors with cash in one
hand can press the right thing. `17px` is why an organiser who is not confident
with phones can read it. The mockup was drawn at desk width and is right for
desk width — it says nothing about the phone, because no frame in it is a phone
except the public ticket-check page, which is drawn phone-first and is the best
work in the document.

Applying the mockup's density everywhere would be applying a desk design to a
field tool. Refusing it everywhere would throw away the part that makes the
organiser screens good.

---

## 4. Patterns worth taking, named individually

These are the mockup's actual contributions, and each can be adopted or
declined on its own:

1. **The running-balance statement** (4d). Four stat columns — charged,
   received, balance, last movement — over a ledger with `WHEN / WHAT /
   REFERENCE / CHARGED / RECEIVED`, tabular figures, `—` for nil, a "Where it
   stands" totals row, and a sentence at the foot explaining that reversed rows
   stay on the record. This is the best screen in the document and it is what
   §7 of the design guidance ("numbers are UI") has been asking for.
2. **The docked panel** (6a). Search results keep focus; the selected ticket
   opens in a right-hand dock with tabs, not a modal. Keyboard affordances
   stated inline: `↑↓ to move · Enter to open · S to sell`.
3. **Verdict-first public page** (4i). Status disc, then the ticket's facts,
   then the charity's identity at the foot, and "buyer details never appear"
   said out loud. Three states drawn, including the failure.
4. **Selection raises an action bar** (5a) instead of a toolbar that is always
   present and mostly disabled.
5. **Home as one progress banner + "needs looking at" + "what do you want to
   do?"** (4a) — the alert cards carry a left colour bar rather than being
   another card in a stack of equals.
6. **The studio proper** (9b): a layers list, artboard rulers in mm, bleed and
   safe area as toggles, snap/grid controls on a status bar, and the inspector
   on the right. Plus a collapsed rail (7a) so the artboard gets the screen.

---

## 5. What the suite already pins, which the redesign must not break

A redesign that ignores these fails `./tests/run.sh`, which gates the deploy:

- **`i18n`** — "every label asked for in the interface exists in the map".
  The nav renders `<Bi :text="s.label">`, so **renaming Ticket design → Ticket
  Studio requires a Burmese line for the new string** or the suite goes red.
  There is no map entry for the current label to rename; it must be added.
- **`permissionui`** — a control you cannot use is shown **disabled with the
  reason in its `title`**, never hidden. The mockup hides nothing, so this is
  compatible, but any "cleaner" rewrite must keep it.
- **`rolewords` / `wording`** — "seller", never "agent"; "System Admin" for the
  top role. The mockup's copy agrees.
- **`footerfit`** — modal footers must wrap inside a hard sheet width.
- **`screenrender` / `noundef` / `emits`** — every screen must still render,
  name nothing that does not exist, and have a listener for every event.
- **`artworkpalette` / `branding` / `templates`** — the ticket's colours are
  read off the artwork and the logo rules are enforced; studio work touches
  these.

---

## 6. The rename: Ticket design → Ticket Studio

Bounded and cheap. User-visible strings, all of them:

```
src/components/AppShell.vue:50      nav label                    ← + Burmese map line
src/components/TicketDesign.vue:980 print title                  ← 8d's file
src/components/TicketDesign.vue:1007 h3                          ← 8d's file
src/components/TicketDesign.vue:1019 h2                          ← 8d's file
src/components/Admin.vue:721        "Ticket design →" button
src/components/modals/BookDetail.vue:21  "…see the Ticket design screen."
src/components/modals/PrintTickets.vue:475, 555
```

The internal identifiers (`ticketdesign` screen id, `src/lib/ticketdesign.js`,
`src/components/ticketdesign/`) should **not** be renamed. They are wired into
the router, the store, `everyaction`, `clientcoverage` and five test files, and
renaming them buys the user nothing.

---

## 7. The collision, stated plainly

Measured 15:38 today:

```
246c9bd  "Shift while dragging, which was the only part of phase 3 not already built"
 M src/components/TicketDesign.vue      modified 15:38 — being written this minute
   src/components/ticketdesign/*.vue    five files, all touched 13:05–14:55
```

`kcho-shelter-8d` is mid-extraction in exactly the files chapter 2 of the
mockup redesigns, and `ticket-printing-qr-integration` has preview mode (the
print-sheet and preview cards) pending its user's approval. Two writers in one
file is the mistake this tree keeps making.

So the studio chapter is the one part of this job that cannot simply be started.
Everything else is unclaimed.

---

## 8. The plan

Each phase is shippable on its own, gated on `./tests/run.sh`, and ends by
rendering the screen and looking at it rather than reasoning about the CSS.

**Phase 0 — the token layer** (`src/style.css`, no screen changes)
Re-ground the neutral ramp on the mockup's green-greys; add the ticket yellow
as a ticket token, not a UI one; add a density scale. Keep `--tap`, keep the
Myanmar font chain. One commit, visible everywhere, reversible.

**Phase 1 — the primitives** (`src/components/ui/*`)
Where the mockup's language actually lives: status pills, the stat row, the
ledger table, the action bar, form rows, empty states, the sheet chrome. Doing
these first is what makes the screen phases small.

**Phase 2 — the screens, in the mockup's own chapter order**
Home → Find (+ docked panel) → Sell → Books → Sellers → Money (+ statement) →
Approvals → Draw → Setup → Access. One screen per cycle: read its card, write
the diagnosis for that screen, implement, run the suite, render it, look at it,
next.

**Phase 3 — the public ticket check** (`src/verify/`)
Separate bundle, phone-first, three states including the failure. The strongest
card in the document and the only page a stranger ever sees.

**Phase 4 — the Studio**, when 8d's extraction lands and not before.
Rename, layers, artboard rulers, bleed/safe toggles, the collapsed rail, the
print sheet.

The rename's non-studio strings can go in Phase 0; the three inside
`TicketDesign.vue` are handed to 8d rather than edited around them.

---

## 9. The design system, derived — for the screens the mockup never drew

The document covers 22 screens. This app has 14 screens, 23 modals and a public
page, and several of them — a seller's own money, a helper's record, sign-in,
permissions, the draw — appear nowhere in it. Those get refactored from the
same system rather than left alone, so the system has to be written down.

### Colour

| Token | Light | Use |
|---|---|---|
| `--brand` | `#0d7a6f` | the one accent; unchanged |
| `--brand-press` | `#0a5f57` | a brand surface under the pointer or finger |
| `--brand-line` | `#bfe0d9` | a brand-coloured **rule**: selected row, resting chip edge |
| `--brand-soft` | `#e8f4f1` | a brand-tinted fill behind text |
| `--border` | `#e4e9e7` | the ordinary edge |
| `--border-strong` | `#d6dedb` | a table's header rule; any edge holding columns apart |
| `--muted` | `#5b6b66` | supporting text — 5.3:1, safe at any size |
| `--muted-2` | `#8a9793` | **3.03:1 — large text, icons and rules only.** Never a caption |
| `--ticket-gold` | `#ffe9a3` | the printed ticket's own colour. Never chrome |

The neutrals lean green so they belong to the brand. Semantic `--ok / --warn /
--bad / --info` and their `-soft` companions are unchanged and still carry
meaning; a status is never conveyed by colour alone.

### Who opens a modal — the map, not the heuristic

`.dense` asks "is this an organiser reading many rows at a desk", and for
SCREENS that is answerable by looking. For MODALS it is not: `App.vue` hangs
the whole handler block off `<component :is="current">`, so any screen can
raise any modal, and a rule of thumb produces guesses.

kcho-shelter-72 traced each one from the events screens actually emit. The
answer, which is the artefact rather than the method:

- **Organiser only** — `checkin`, `deadlines`, `inplay`, `make`, `prize`,
  `user`, `winner`. Seven of twenty-three.
- **Reachable by a seller** — `reportback` and `ticket` from Sell;
  `agent`, `book`, `bookaction`, `issue`, `payment`, `printtickets`,
  `sellbook` from Home or Money, where a seller sees their own.

And the conclusion, which surprised the brief: **no modal takes `.dense`.** The
organiser-only ones are almost all FORMS, where shrinking an input buys no
reading; the two that look like tables — `CheckInSheet`, `RoundReport` — are
printed documents, where density changes what comes out of the printer.

The general rule that falls out: **a density decision needs the opener, not the
content.** A table in a modal tells you nothing about who is holding the phone.

### Density — two, gated twice

`.dense` on a screen root **and** a `min-width: 1024px` media query. Inside it:
`--fs-ui` 12.6px, `--row-h` 34px, `--r-ui` 5px, `--pad-x/y` 12/7px. Outside it,
or on any phone: 17px, 52px targets, 16px radii.

Opt in when the screen is **an organiser reading many rows at a desk**: Money,
Books, Sellers, Find, Approvals, Access, the Studio. Do not opt in for anything
a seller presses in the field — Sell, the ticket sheet, sign-in. `--tap` is
never overridden anywhere; compact rows are a reading decision, the touch
minimum is a correctness one.

### Numbers

Tabular figures everywhere money or a serial appears. Money right-aligned. A
nil is `—`, not `0.00` and not blank. A running balance reads oldest-first and
opens on its **last** page. Totals sum the filter, never the page — a total
that changes when you turn the page is a total nobody can use.

### Patterns, and the rule each one answers

- **Identity band** — `charged − received − written off = balance`, one row,
  bordered, a rule before each operator, each figure carrying a small line
  saying what it was counted from. Use wherever a figure is derived from
  others. It is an equation, not a row of statistics.
- **Filter chips** — every row belongs to exactly one chip and the counts sum
  to All. If a kind has no chip it is invisible under every named view, which
  is the "everything except X" trap this repo has paid for three times. Show
  chips only past ~8 rows; three controls over four rows is furniture.
- **A control you cannot use** is shown disabled with the reason in its
  `title`. Never hidden. Pinned by `permissionui`.
- **Selection raises an action bar**; a toolbar that is always there and mostly
  disabled is furniture.
- **Alerts carry a left colour bar** rather than being another card in a stack
  of equals.
- **The verdict first**, then the facts, then identity — public pages and any
  screen answering a yes/no question.
- **A correction goes beside the thing it corrects; a toast is for something
  that has finished and gone.** Every validation refusal is a correction to
  something still on the screen — the box is right there, and a toast slides
  away while the reader is still looking at it. The wider form: a message about
  live state belongs next to that state, and a message about a completed act
  belongs in the transient layer. (72's rule, from the contact card.)
- **Do not let a control imply an effect it has not got.** The rule in §11 is
  not to ship a control over absent machinery; the honest form when the storage
  is real and the consumer is not yet wired is to keep the control and correct
  the CLAIM — "saved and audited from now, so the page has them the moment it
  reads them, but saving one today does not change what a stranger sees."
  Hiding the field would be worse: an organiser setting a raffle up should be
  able to record its contact details whether or not a page reads them yet.

### Words

"seller", never "agent". "System Admin" for the top role. Every `<Bi text="…">`
needs a line in the Burmese map — and note that a **bound** `:text` escapes
that check, which is how the whole sidebar went unchecked.


---

## 10. Chapter 2, card by card — the spec the Studio is built against

Read out of the document rather than remembered. Every item below is something
a card actually draws; where the app already has it, that is noted.

### 9a · Start a design
Two routes, stated as an honest choice rather than a wizard:
- **Use artwork as the background** — "A finished design from a printer or
  designer. You place the boxes on top; the artboard takes the artwork's own
  size and shape." Drop a PNG/JPEG/WebP, or pick one already uploaded.
- **Draw it from scratch** — "A blank artboard in the raffle's colours."

Then **the artboard**, set before anything is drawn: presets `190 × 61.5 mm ·
210 × 74 mm · A6 · Custom`; fields Width, Height, Bleed, Stub begins, Print at;
Landscape/Portrait; a live computed line `2244 × 726 px at 300 dpi · stub at
130.6 mm`; a "Start with the raffle's colours" switch. Footer: *"Either way the
placements are held as shares, so the design survives a redraw at any size."*
Cancel · **Open the artboard**.

### 9b / 7a · The studio itself
- **Top bar**: `Exit studio` at top left (`⌘\` to bring the nav back when the
  rail is collapsed) · the design's name · a `From scratch` chip · the
  dimensions line `190.0 × 61.5 mm · 2244 × 726 px · 300 dpi` · tabs
  **Place / Artwork / Print sheet** · a save state — `all changes saved` or
  `Unsaved · 3 changes` · `Test print` · `Save design`.
- **Left rail**: the layer list under a count (`Layers 9`, `On the ticket 10`),
  **grouped by half** — `MAIN HALF · 3` and `STUB · 7` — each layer with its own
  icon and a lock/visibility control. Then `Where the stub begins` — `68.8 %`
  *"or drag the line"*. Then **Artboard**: `Grid & guides`, `Bleed & safe area`,
  `Artwork underlay`.
- **Canvas**: rulers along the top in the artboard's own units —
  `0 · 25% · 50% · 75% · 190.0 mm`; the selected element labelled with its size
  as a share (`Ticket number · 34.9 × 4.1%`); the stub divider marked
  `stub 68.8%` and draggable.
- **Status bar**: zoom `42%` · `Fit` · `x y w h` as editable fields · `Snap` ·
  `Grid 2 mm` · `Longest entry`.

### 2a · Artwork & paper
Templates rail with a count and a `PRINTING` badge on the one in use;
per-template `Replace` / `Remove`; `Upload artwork — PNG, JPEG, WebP · ≤ 4 MB`;
the artwork shown with `stub begins 2750 px · 130.6 mm`; and the **verdict as
the page**: `Ready to print — three checks, all clear`, each check giving its
measured value against the wanted one (`Shape 3.091 · wanted 3.095 ±0.02 —
within tolerance`). The app has `ArtworkVerdict.vue` for this.

### 2b · Print sheet
`Paper` — A4 / A3 / A5 / Letter / Legal with the chosen size shown
(`210 × 297 mm`) and Portrait/Landscape. `How they sit` — `Ticket width 190 mm`,
`Gap between 4 mm`, `Page margin 10 mm`, each with a slider. `Dashed line to cut
along`. The app has `SheetTab.vue`.

### Not building: Bleed & safe area as live toggles
Drawn in 9b under ARTBOARD, and nothing in `ticketsheet.js` or
`ticketdesign.js` has ever heard of either. A toggle over absent machinery is
the `sheet.perPage` bug again — a control that said four while the sheet did
something else. Bleed is a print-pipeline task (extra artwork past the trim,
which moves the sheet geometry, the ticket box and what `pageFit` returns) with
a UI at the end of it. `202efa3` declined it for the same reason.

### What the whole chapter is set in
The dimensions line, the rulers, the percentages, the tolerances, the pixel
counts, the paper sizes — all of it is **data**, and the document sets every bit
of it in `ui-monospace`. This is the screen where `--font-data` matters most.

---

## 11. How this gets finished — the distribution model

Set by the user 2026-09-20: **the rollout runs as a loop, not as a queue the
user waits on.** Each turn of the loop must do three things.

1. **Divide** the remaining document into at least **three substantial pieces**
   — substantial meaning a whole chapter or a coherent half of one, something
   that can be built, tested and looked at without waiting on another piece.
2. **Distribute** to at least **three other sessions**, each with the cards it
   owns, the constraints that bind it, and the design-system section below.
3. **Integrate** what comes back, run the gate from a frozen snapshot, and
   divide the next round.

Each session may fan out to multiple subagents of its own. That is their call,
not mine to specify.

### What a handout must carry, every time

A peer cannot see the mockup — it is a 7.6 MB bundle on one machine — so a
handout that names a chapter and stops is a handout that will be built from
imagination. Every assignment carries:

- the **card ids** and what each one actually draws, read out of the document
  rather than remembered;
- the **tokens and rules** from §9 — the two densities, `--font-data` for
  anything read character by character, the custody colours, the filter rule;
- the **tests that bind it**, named, because the deploy gate is the same for
  everyone;
- the **files it owns**, and the files it must not open;
- what is **absent machinery** rather than missing UI, so nobody ships a
  control over a pipeline that does not exist.

### The division

| Piece | Chapters | Cards |
|---|---|---|
| **A** | 4 · Sell tickets, 6 · Keep control | 6a docked panel, 6b sold ticket, 4c write down sales, 4h approvals |
| **B** | 3 · Books ready, 7 · What the buyer gets | 5b/5c print tickets, 8a keepsake, 8b treatments, 4i public check |
| **C** | 1 · Set the raffle up, 8 · Draw the winners | 4f setup, 4g access, 4e draw + prize form |
| **D** | 2 · The studio | 9a, 9b, 9c, 2a, 7a, 2b, 8c — held here |

### The rule that outranks the schedule

A peer's user outranks this plan. A handout is a request, not an instruction:
any session may decline, and a session that is mid-flight on its own user's
work is not blocked by anything written here.

---

## 12. Chapter 2, measured — 2026-09-20 16:45

Measured against the source rather than read off the cards, after two sessions
independently found that the document describes work already done.

| Card | State |
|---|---|
| 9b layers, grouped by half | **built** (this round) |
| 9b artboard toggles, ruler, status bar | **built** |
| 9b dimensions line with dpi | **built** (this round) |
| 2a artwork verdict | **built** — `ArtworkVerdict.vue` |
| 2b print sheet | **built in full** — all five papers, orientation, three controls, cut lines, and the chosen size in mono |
| 8c digital ticket | **built** |
| 9a artboard presets | **built** — `ShapesPanel.vue` is that, under another name |
| **9a "Draw it from scratch"** | **absent machinery — a product decision, not a UI task** |
| **7a Exit studio / collapsed rail** | **absent — a real interaction, unbuilt** |

### The one that matters: "Draw it from scratch"

The card offers two routes into a design and describes the second as "a blank
artboard in the raffle's colours. Add panels, rules, text and fields."

The studio cannot do that. It places **fields, codes and text onto artwork** —
the palette is exactly "A field · A code · Own words" — and every position is
held as a share of an uploaded image. There are no panels, no rules, no
drawing. Offering that route would promise an editor the product does not have,
and the first organiser to choose it would find an empty screen.

This is the third time the document has drawn a control over absent machinery:
bleed and safe area (chapter 2), selection on Books (chapter 3), and this. The
pattern is worth naming — **a mockup cannot tell you whether the thing behind
the control exists**, and the document is good enough that its drawings are
persuasive. Measure, then build.

Either the studio grows a drawing mode — a real piece of work, and a different
product from a placement tool — or 9a offers one honest route and says what the
other would require. That is the user's call.

---

## 13. The card ledger — every card, live or superseded, and what is built

Written 2026-09-20 after a briefing error that cost a session a whole card of
work. I sent kcho-shelter-72 to build **1b**, quoting its title from notes I had
taken days earlier. 1b is in the document's last section:

> **Earlier explorations — Kept for reference — superseded by the chapters above.**

So the studio was rebuilt to a retired card, and a user who uses that screen
said within the hour that it was wrong. They were right and the document agreed
with them. **Nobody briefs from memory again — brief from this table, and if a
card is not in it, extract it before quoting it.**

Extraction: the card ids are `<div class="dv-opt" id="…">`, chapter titles are
`<span class="dv-tname">`, card titles are `<div class="dv-olabel">`. The file
stores its body as escaped JSON, so `/` → `/` and `\"` → `"` first.

### Live cards

| Card | Chapter | What it draws | Built? |
|---|---|---|---|
| 4f | 1 Set up | Setup · brand colour previewed on real chrome | yes |
| 4g | 1 Set up | Access — System Admin only, page says so, shows diffs | yes |
| 9a | 2 Studio | Start a design — two routes, artboard set before you draw | yes (d5d82a6) |
| **9b** | 2 Studio | **Studio from scratch, light — layers LEFT, artboard MIDDLE with rulers, inspector RIGHT** | **regressed by 6d4feb1; 72 rebuilding** |
| 9c | 2 Studio | The same studio in dark mode — chrome flips, ticket keeps its own colours | looked at; artboard fixed (5ba9bae), 3 gaps open |
| 2a | 2 Studio | Artwork & paper — the verdict is the page | yes (72 confirmed) |
| 7a | 2 Studio | Collapsed rail — Exit studio top left, hover or ⌘\ | yes (33dce6f, 008d630) |
| 2b | 2 Studio | Print sheet — paper, how they sit, cut line | yes |
| 8c | 2 Studio | Studio · Digital ticket **(future tab)** | yes (bdc639b) — less the watermark, the three toggles and "Send a test" |
| 5a | 3 Books | Books — selection raises the bar that owns Print tickets | open with ceam-raffle-15's user |
| 5b | 3 Books | Print tickets step 1 — batch, honest empty preview | yes (6678c2e) |
| 5c | 3 Books | Print tickets step 2 — codes then paper as two steps | yes |
| 4a | 4 Sell | Home — one banner, what needs looking at, then doing | yes |
| 6a | 4 Sell | List + docked ticket panel | yes (89ac4f5) |
| 6b | 4 Sell | A sold ticket — record, movement, correction in one modal | **diverges by ruling — trail stays a sheet** |
| 4c | 4 Sell | Write down sales — one ticket or a pile of stubs | yes (493388c) |
| 4d | 5 Money | Money — who owes what, running-balance statement | yes (a71a080) — Export added; "account since" unbacked |
| 4h | 6 Control | Approvals — the waiting request first | yes |
| 8a | 7 Buyer | Books → book → a ticket — the keepsake in the raffle's colour | yes (9d78cef) — Motto chip added at bdc639b |
| 8b | 7 Buyer | Three treatments of the same ticket, one brand colour | ticket-printing (Certificate) |
| 4i | 7 Buyer | Ticket check — the public page | ticket-printing — **ruled, see below** |
| 4e | 8 Draw | The draw — readiness as a checklist, prize form beside it | no owner — **fully backed, see below** |

### 4e is fully backed — do not half-build it

Established by `kcho-shelter-ff`, who was in the prize and reporting code all
day. I had written a caution into the handout saying to check whether prizes
existed and, if not, to build only the readiness panel. That was wrong and
would have produced a deliberately half-built screen:

* **Three tables** — `prize_types`, `prizes`, `winners` (schema.sql 736 / 787 / 846).
* **Four built-in types** shipped on every install: cash, donated goods,
  voucher, share of takings.
* **Eight handlers** — `list_prizes`, `upsert_prize`, `remove_prize`,
  `upsert_prize_type`, `record_winner`, `list_winners`, `set_winner_status`,
  `report_draw_ready`. `upsertPrize` already enforces the card's own footnote:
  quantity is a count on one row, and it refuses being cut below what has been
  awarded.
* **`export_entries` exists** — `{ roles: ADMIN_ONLY, sup: true, kind: 'report' }`,
  labelled "Download the entry list".

**The blockers come from the server, not the template.** `reportDrawReady`
returns `problems[]` with `what`, `count`, `where`, `why` — and `where` IS the
destination (`'books'`, `'approvals'`, `'here'`). Render that shape. A second
hand-written list of blockers in the template is a copy that disagrees with the
server the first time a blocker is added.

**The permission trap, which `permissionui` cannot catch.** The card's sentence
"Only the System Admin can download the entry list or add winners" is true of
exactly two handlers — `record_winner` and `export_entries`, both `sup: true`.
It is NOT true of the panel:

| `upsert_prize` | `ADMIN_ONLY` | any admin may add a prize |
| `list_winners` | viewer, recorder | a volunteer may SEE the winners |
| `set_winner_status` | recorder | a recorder may mark one told or collected |

Implement it as "disable this panel for non-admins" and you wrongly disable Add
a prize for organisers who may use it, and wrongly hide a winners list viewers
are entitled to. `permissionui` catches the hidden-instead-of-disabled half; it
cannot catch sup-versus-admin, because both sides are "an admin". The words on
screen must match the refusal the server sends — that is what `rolewords` is for.

### 4i — RULED 2026-09-20: which token is presented decides what is shown

The mockup draws Price, Book, Draw date and Recorded on the public check page.
**They move to the buyer's receipt view.** The public page keeps answering only
genuine-or-not and the state. Ruled by the user after `ticket-printing`'s
argument, which is better than the question I was going to ask:

> The QR is PRINTED ON THE PAPER. Anyone holding the ticket, or a photograph of
> it, or standing behind somebody in a queue, has `?NUMBER.CODE`. It
> authenticates the TICKET, not the person — `verify/index.ts` says so at the
> head of the file — so it cannot be the thing that unlocks a buyer's name.

The buyer-only token already exists and is `ticket_receipts.code`: minted per
purchase at `printing.ts:542`, **never printed** (verified independently —
`receipt` appears in the whole drawing layer exactly twice, both prose comments
in `ticketart.js`; `ticket_receipts` is read only in `verify/index.ts`,
`_shared/resetplan.ts` and `api/printing.ts`, never in `src/`), and already
routed: `verify/index.ts` answers `?r=CODE`. So "the only way to hold a receipt
code is to have been sent one" is a property of the system, not a policy laid
on top of one.

The framing is the reusable part. "How much may the public page show" is a
policy question with no good answer; **"which token is being presented"** has
two routes and two answers and needs no policy.

**Consequence for the guard at `verify.test:200`**, which currently forbids
`buyer_` and `amount` anywhere in that function's source: it becomes a named
allowlist of which fields may travel on which route. Not "everything except" —
that is the shape that admitted `seller_phone`. See
[[everything-except-x]] and [[negative-defaults-admit-the-unknown-case]].

### 9c — looked at 2026-09-20; one defect fixed, three gaps left with 72

**Fixed (5ba9bae).** `.frame` — the artboard, the sheet the ticket prints on —
was painted `--surface`, so it followed the theme and went near-black in dark
mode. 9c's own info line legislates against exactly that: *"Dark mode only
changes the studio chrome — the ticket keeps its own colours."* Now `--paper`,
theme-free beside `--ticket-gold`, named in `tokens.test.mjs`'s `THEME_FREE`
and proved red by removing it. `.stage` deliberately still flips — it is the
surround, and that IS the chrome.

Where it showed: artwork with an alpha channel (`templates.ts` accepts PNG and
WebP and never inspects transparency), plus the image's loading and failed-load
windows. **NOT** the from-scratch route — `blankticket.js` paints white before
drawing precisely so the upload has no alpha, so that artwork is opaque and
covers the frame. I had that backwards and 72 caught it.

**Open, and 72's to place when their user scopes the studio rebuild:**

1. No sun/moon control in the studio header; 9c draws one.
2. The info line itself is not on screen anywhere.
3. ~~The stage bar is captioned checkboxes~~ — **done 2026-09-21, `e40123b`.**
   Three icon tools now, which is 9b's drawing: `[magnet] Snap`,
   `[grid] Grid 2 mm`, `[Aa] Longest entry`, lit when on and muted when off.
   9c drops the third only because its dark card is narrower — read 9b for this
   one, not 9c, and read the extract rather than this line.

   The grid did not exist at all and does now, independent of the snap toggle
   as both cards draw them. It is in MILLIMETRES on both axes, which is not one
   share: this ticket is 190 mm across and 61.39 down, so a single share value
   would make the vertical grid a little over 6 mm and nothing on screen would
   say so. `ticketscreen` asserts both steps and their ratio.

   Each checkbox's sentence moved into its button's `title` — the same place
   this app puts the reason a control cannot be used — which is the organiser's
   own instruction: icons with hover explanation, not sentences.

**Was "not a defect"; is now fixed — 2026-09-21, `bdc639b`.** The header's
"sa…" was `.statetxt`, the save status, truncating by design — `min-width: 0;
overflow: hidden; text-overflow: ellipsis`, with a comment reading "The status
may truncate; the action may not move." That reading was right and the
conclusion was wrong, which only became visible with a FOURTH tab in the bar:
at 900px the status truncated to the single letter **"s"** and the H2 wrapped
to "Ticket / Studio" and rendered straight across the template picker.

Neither is what the rule intended. The bar was measured at seven container
widths with wrapping forced off, and its contents first sit inside the box at
about **1200** — so `@media (min-width: 1024px) { .bar { flex-wrap: nowrap } }`
had been squeezing it since it was written, roughly 1120 even with three tabs.
The breakpoint moved to 1200; the H2 and the status are `flex: none`; the
picker and the `.grow` spacer are the slack. Below 1200 the bar wraps, which is
the honest failure and what it already did on a phone.

**8d's `title` suggestion is therefore moot at desk width** and still right
below it, where the bar wraps rather than truncates. Not taken here: still
nobody's user has scoped it.

**What IS arguably true there, and is 8d's region by the split they and 72
agreed:** at desk width the status renders as `"sa…"`, which has stopped
reporting while still holding the row. The trade the comment describes is the
right one — the status should yield before the action moves — but this repo's
idiom is that information you cannot read should stay *reachable*, the same
rule that makes a disabled control carry its reason. A `title` with the full
text is one attribute. Not taken: nobody's user has scoped it, and it is not
mine to put in their file.

### 6b — the trail stays a second surface, by the organiser's ruling

**Do not rebuild this from the card.** 6b is titled "record, movement and
correction in one modal, **no second dialog**", and the trail on a sold ticket
is a second surface. That is deliberate.

The history, because it has now gone round twice:

| | |
|---|---|
| `d2398c2` 17:03 | trail made an inline SECTION, cost named honestly in the message |
| `58a2348` 17:18 | moved back behind a click, in a sheet — "set by the organiser" |
| `437b15e` (2026-09-21) | inline again, lazy fetch preserved — **my change** |
| reverted | organiser chose the sheet when asked directly |

The reason first given was the network cost: opening a sold ticket otherwise
touches no network, and a volunteer on a phone in a hall was paying for a panel
most of them never open. **My change preserved that entirely** — `v-if` is what
makes the fetch lazy, not the sheet — so the choice was put to the organiser as
container-only, with the inline version built and working. They still chose the
sheet.

So the card is not being overlooked, and the inline version is not untried. **A
mockup describes a screen; the organiser's ruling is about their own screen, and
it outranks the drawing.** §14 already says a user disagreeing with the drawing
is their call; this is the first time it has been exercised against a card.

`ui/Trail.vue`'s `heading` prop remains documented for a caller that does not
exist. Left deliberately — a prop describing an absent caller reads as
intentional design rather than as a leftover, so this row is where that is
written down.

### 4d — verified; the statement already beat the card in five places

Checked against 4d on 2026-09-21. The only element with nothing behind it was
**Export**, now built (`a71a080`). Everything else was there, and `SellerMoney.vue`
is ahead of the drawing:

* **Three balance states in words** — "still to come in" / "handed in beyond
  what is charged" / "nothing outstanding". The card glosses only the negative.
* **A phone with three states** — dialable, on file but not dialable, absent.
  The card prints a bare number. So 4d's subtitle phone was NOT added: it would
  replace careful handling with a flat string.
* **`reconciles === false`** — the server checks its own arithmetic against the
  figure the table reads and the screen refuses to be trusted when they differ.
  The card has nothing like it.
* **Filters exhaustive by construction** — every row belongs to exactly one, so
  the chips cannot hide a row the way an "everything except" set does. See
  [[everything-except-x]].
* **Lands on the closing balance** — `linePage` is set to the last page on load,
  so the most recent movement is on screen at open. This is why 4d's "Last
  movement" summary line was not added: it answers a question the table already
  answers on arrival.

**Deliberately not built:** `account since <date>`. There is no source — the
agent select in `reports.ts` is `agent_id,name,phone,zone`, with no created or
joined column. Adding it means a migration, not a label.

**Still open:** the card's "All dates" filter. Not built; the existing filters
are by kind, and a date range is a real feature rather than a refactor.

### Superseded — do not build

`1a` canvas-first · `1b` one panel two tabs · `1c` drop-to-place · `4b` find a ticket.

### 8a, in full, because it is the largest outstanding gap

The modal is **two columns**. Header: `Book-004 · the buyer's ticket`, then
`KS-00031 — KS-00040 · 10 sold`, and a pager `‹ 1 of 10 ›` — you step through
the book's tickets without closing.

Left, the keepsake on a pale stage: org mark, `Fundraising Raffle`,
`CEAM Shelter · Kajang, Selangor`, a gold **SOLD** chip; `TICKET NUMBER` and
the serial **in gold, large, serif**; `ISSUED TO` and the buyer; a three-column
fact row `PRICE RM 10.00 · BOOK Book-004 · SOLD 14 Sep 2026`; the QR with
`Scan to check this ticket`; a perforation with notches; the motto in gold
italic; `Thank you — this keeps the shelter open.`; the verify URL in mono.

Right rail: `This ticket` as a facts table — Buyer, Phone, Seller, Code; the
privacy note; `Look` as three chips — Raffle colour, Logo watermark, Motto on;
`Set in Setup → how this raffle looks. Design it in the studio →`; then
`Send on WhatsApp`, `Save the picture`, `Print`.

**Built at `9d78cef`** (`ViewTicket.vue`): the pager, the two columns, the gold
serial, the SOLD chip, the perforation with mask-cut notches, the three-column
`PRICE · BOOK · SOLD` fact row, the QR, the motto slot, the verify URL, the
right rail with the `This ticket` facts table, the privacy note and the `Look`
block. Rendered and read in both themes.

**Deliberately not built — one chip.** 8a's third Look chip is `Motto on`.
`digitalCardSVG` renders `values.motto` and `cardValues` passes
`state.cfg.motto`, but **nothing anywhere sets it**: no Setup field, no field
on the branding API, no column. A chip reading "Motto off" beside a link to a
page with no motto field is a dead end wearing the costume of state, so the
block ships with the two chips that are true — `Raffle colour` and `Logo`. The
mockup's word for the second is "Logo watermark"; on the digital card the logo
is the masthead mark and the watermark is a different thing on the printed
sheet, so it is named for the role it plays here (see `name-tokens-for-the-role`).

**Still open on this card:** the motto configuration field, handed out as its
own piece; and 8a's rail puts `Print` beside `Save the picture`, where the
modal footer already has a `Print` that prints the whole book. Two controls a
click apart with the same word and different scopes is worse than one, so the
footer's was left alone rather than a second Print invented.

---

## 14. The standing rule for every round

**Before building anything, read the card. Before briefing anyone, read the
index.** The document is `~/Downloads/Ticket Designer.html`. It is the source;
this file is notes about it, and notes go stale in exactly the way §13 records.

Every handout, every loop iteration and every piece of work states:

1. **Which card it is building**, by id, checked against §13 — live or
   superseded. `1a`, `1b`, `1c` and `4b` are retired and must not be built.
2. **The card's contents verbatim**, extracted, not summarised. Extraction:
   `/` → `/` and `\"` → `"`, then `<div class="dv-opt" id="…">` for cards,
   `<span class="dv-tname">` for chapters, `<div class="dv-olabel">` for titles.
3. **Which design-system rules apply** — §9 here: the colour table, `--tap`
   never overridden, density gated twice, tabular figures on every serial and
   every sum, filter chips that partition, a disabled control carrying its
   reason, alerts with a left bar, the verdict first on any page answering a
   yes/no question.
4. **What the screen is that the mockup never drew**, if so — those are
   refactored from the same system rather than left alone. §9's list: a
   seller's own money, a helper's record, sign-in, permissions, the draw.

The mockup is English-only and this product is bilingual with **Burmese first**.
Where the two conflict — a two-line header that becomes four, a footer that
becomes taller than drawn — the language wins and the proportion gives way.
Never drop a language to match a picture.

And the mockup is a *drawing*. Where a user of the screen disagrees with it,
that is a decision for their user, not a defect to be fixed back — see the
studio's panel arrangement, where the retired card, the live card and the user
all had to be reconciled before anybody was right.
