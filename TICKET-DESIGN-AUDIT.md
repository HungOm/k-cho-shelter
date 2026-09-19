# Ticket designer — audit

Date: 2026-09-19. Scope: the ticket/card designer and everything it feeds —
artwork upload, the design model, on-screen editing, rendering, and the path to
paper. No code was changed in producing this.

Verdict up front: **the rendering and print pipeline is in good shape; the
editing surface is not.** The measurements, the geometry and the sheet builder
are careful and well-reasoned. The screen that drives them was assembled
section-by-section as features landed and has no compositional design of its
own. Most of what looks wrong in use is in the screen, not the engine.

Disclosure: the buyer/book sections, the drag layer and several of the defects
below were written by me earlier today. Ownership is noted per finding.

---

## 1. What exists

| Layer | File | Responsibility |
|---|---|---|
| Upload, sniff, re-encode | `src/lib/templatefile.js` | Type sniffing, 4 MB cap, canvas re-encode, preview derivative |
| Size gate (server) | `supabase/functions/api/templates.ts` | Accepted sizes, aspect tolerance, `minWidthPx` |
| Design model | `src/lib/ticketdesign.js` | `DEFAULT_DESIGN`, `designFor()` (scales to artwork), `validateDesign()` |
| Geometry + draw | `src/lib/ticketart.js` | `place*()`, `numberLayerSVG()`, `qrLayer()`, `TEXT_FAMILY` |
| QR encoder | `src/lib/qrcodegen.js` | Byte mode, v1–10, RS/GF(256), 8 masks |
| Print sheet | `src/lib/ticketsheet.js` | Self-contained HTML, `@page`, mm units, cutlines |
| Editor screen | `src/components/TicketDesign.vue` | All configuration + preview + drag handles |
| Consumers | `modals/PrintTickets.vue`, `modals/ViewTicket.vue` | Bulk print, single view |

**Data model.** One `design` JSON per artwork, stored on `ticket_templates.design`,
scaled from a 1600×517 reference frame. Slots: `main`, `stub` (each a label box of
`left/right/capTop/baseline` plus `capHeight/clearRight/clearBelow/ink/weight`),
`book.{main,stub}`, `buyer.fields.{name,phone,address,seller}`, `qrMain`, `qrStub`,
`sheet`, `digital`.

---

## 2. What is already good — leave these alone

1. **A reference frame, not millimetres** (`ticketdesign.js:10`). Coordinates are
   in the artwork's own pixels against a 1600px reference and scaled on load, so
   re-exporting the artwork at print resolution doesn't invalidate every number.
2. **Height is derived from width and aspect ratio, never given** (`ticketsheet.js:16`).
   A second number is a second thing to get wrong, and getting it wrong stretches
   the artwork off its baseline.
3. **Artwork inlined once per sheet**, not per ticket. A book of 100 stays openable.
4. **Baseline placement in SVG.** CSS cannot express baseline placement; this is
   the correct tool and the reasoning is recorded.
5. **The Myanmar font chain** (`ticketart.js:97`) and the rule never to pin
   `textLength` on text drawn in a different font from the one measured.
6. **`validateDesign()` returns a list, not a throw** — all problems shown at once
   beside the fields that caused them.
7. **Aspect-ratio tolerance rather than pixel matching** on upload (`templates.ts:66`).
8. **The QR encoder is decoder-verified**, including the mask-penalty rule that
   silently produced unscannable codes.

---

## 3. Weaknesses

### 3.1 Design-system gaps (affect the whole app, surface worst here)

**W1 — There is no checkbox or radio rule. [pre-existing; exposed by my work]**
`style.css:144` styles `input, select, textarea` as text fields: `width: 100%`,
`min-height: var(--tap)` (52px), 14px padding. Checkboxes inherit it, so each is a
52px box stretched to its column, and with no `accent-color` they render in OS
blue rather than `--brand`. The label is pushed to the far edge because the input
consumed the row. Twelve controls app-wide, **nine of them on this screen** — which
is why it looks worst here. The system never needed the rule until this screen.

**W2 — No form-row primitive.** `.grid`/`.check`/`.halfblock` are local to
`TicketDesign.vue` (`:749`). `.grid label { flex-direction: column }` then fights
`.check { display:flex; align-items:center }`, which is the second half of W1's
layout break.

**W3 — `--line` was used as a token and never defined.** Fixed earlier today
across 8 files; noted because it is the same class of gap as W1: a value used in
several places that the system never declared.

### 3.2 The editing surface

**W4 — Raw data keys as UI labels. [mine]** `TicketDesign.vue:658` renders
`{{ key }}` from `Object.entries(design.buyer.fields)`, so the screen shows
lowercase `name`, `phone`, `address`, `seller`. The model leaks into the interface.

**W5 — Field names are vague. [mine]** "Starts at", "Sits on", "Stops before" for
x / baseline / maxRight. They avoid jargon but do not say what they mean, and
there are no units. A number with no unit and no reference point is unusable
without the source.

**W6 — Uniform repetition.** Ten `.card` blocks; each buyer field is an identical
5-column row. Upload-once and tune-often carry identical weight, and the page is
~2000px of scrolling with no way to jump to a section.

**W7 — The QR is never really drawn at design time. [mine]** The preview passes
`qrBoxes: true` but no `encode`, so it shows a placeholder rectangle. You cannot
see whether the actual code fits, contrasts, or sits clear of the artwork until a
ticket is printed or viewed. `qrModuleMM()` already computes the number that
decides scannability — it is shown, but not the code itself.

**W8 — Colour fields are raw hex text inputs.** `#0F490E` typed by hand, no swatch,
no eyedropper, no contrast check against the artwork behind it.

**W9 — Undo is single-level and mislabelled.** `undoDesign()` (`:336`) restores the
last *saved* state, not the last action. After ten drags, "Undo" discards all ten.
There is no redo and no history stack.

**W10 — No autosave and no dirty indicator.** Work is lost on navigation with no
warning. Acceptable if deliberate, but nothing tells the user which state they're in.

**W11 — Touch drag will not work. [mine]** The handles use pointer events but no
`touch-action: none`, so on a touchscreen the gesture scrolls the page instead of
moving the handle. Untested on a real device.

**W12 — Zero media queries on this screen** and a 150px minimum grid column. Not a
seller-facing screen, so low priority, but it is untested below tablet width.

### 3.3 Print and production

**W13 — No PDF output.** The only path is `window.print()` and the browser's
"Save as PDF". That yields RGB, no embedded font guarantees, no PDF/X, no
colour profile. Commercial print shops normally require a PDF.

**W14 — No bleed.** Zero occurrences of bleed/trim/crop anywhere in the codebase.
The artwork is placed exactly at trim size, so any drift when cutting shows a
white edge. Standard is 3mm bleed.

**W15 — Cutlines are an outline on the ticket, not crop marks.**
`ticketsheet.js:78` draws `outline: 0.2mm dashed` around the trim box. If cutting
is not exact, the dashed line prints on the delivered ticket. Crop marks belong
outside the trim area.

**W16 — Effective DPI is never computed.** `minWidthPx: 1600` at 190mm is **214 DPI**,
below the 300 DPI print standard. The screen recommends ~2244px in help text
(`:420`) but never tells the organiser what their *current* artwork actually is.
This is the single highest-value missing number on the screen.

**W17 — No greyscale or low-quality print preview**, despite §8 of the design skill
requiring the design to survive exactly those conditions.

---

## 4. Proposed design-system rules

Additions to `src/style.css` (system-wide, not screen-local):

1. **R1 — Checkbox and radio rule.** Reset `width`, set an explicit box (~20px),
   `accent-color: var(--brand)`, and a `:focus-visible` ring. Exempt them from the
   `--tap` text-field sizing; give the *label row* the 52px target instead, so the
   touch requirement is met by the hit area rather than the glyph.
2. **R2 — A `.formrow` primitive** (label, control, unit, hint, error) so a screen
   never invents `.grid`/`.check` locally.
3. **R3 — Every numeric input carries a unit** as a suffix inside the field.
4. **R4 — A colour control**, never a bare hex input: swatch + text + contrast note.

Additions to the design-director skill:

5. **R5 — Numbers on screen must state their unit and their origin.** "Starts at
   1270" is not usable; "1270 px from the left edge of the artwork" is.
6. **R6 — Never render a model key as a label.** If a label can be an object key,
   it is a label nobody chose.
7. **R7 — A preview must show the real artifact, not a stand-in for it.** A
   placeholder box where the QR goes is the one part of the design you cannot check.
8. **R8 — Print work states effective DPI, bleed and trim explicitly.** A design
   tool that cannot answer "will this print sharply" is a layout toy.
9. **R9 — Undo means the last action.** If it restores the last save, call it
   "Revert to saved".

---

## 5. Suggested order

| Priority | Items | Why |
|---|---|---|
| 1 | W1, W2 (+R1, R2) | Root cause of the reported appearance; system-wide fix |
| 2 | W16, W4, W5 (+R3, R5, R6) | Makes the screen comprehensible and answers the print question |
| 3 | W6, W7, W8 | Composition and real feedback |
| 4 | W9, W10, W11 | Editing robustness |
| 5 | W13, W14, W15 | Production-grade output; largest effort, needs a press requirement first |

**Open question for the owner:** is the target a home/office printer or a
commercial press? W13–W15 are mandatory for the second and near-irrelevant for the
first. The answer changes the size of this work more than anything else here.
