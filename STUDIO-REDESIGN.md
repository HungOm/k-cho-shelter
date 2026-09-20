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
