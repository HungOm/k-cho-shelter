# Ticket Studio: the essential tools, and the standard each one passes

## 1. Context

The user pasted a generic "design editor engine" specification (twelve core
systems: canvas, objects/layers, selection & transform, text, shapes/vector,
image, colour, alignment/guides/snap, mask, history, import/export, keyboard)
and asked for two things:

1. **Ensure the studio has the essential tools.** Not Photoshop; the coherent
   minimum a design editor needs.
2. **Every component follows the UI principles of two books** — *Refactoring
   UI* (Wathan & Schoger, "RU") and *Designing User Interfaces* (Malewicz &
   Malewicz, "DU").

Two facts shape the plan:

- **The studio is already most of an editor.** `TicketDesign.vue` plus nine
  sub-components and six pure libraries give it drag/resize with Shift
  constraints, snap to edges and a 2 mm grid, align/distribute/order,
  duplicate/delete, a 50-step undo/redo with gesture coalescing, a
  selection-driven inspector, a layer list grouped by ticket half, a shape
  library, a colour control with eyedropper, a real QR in the preview, DPI and
  fit reports, print-sheet layout, and a second designer for the digital
  card. The gaps are narrow and specific (§5), and eight live defects in the
  tools that exist were found while inventorying (§4.1).
- **The books are already the house standard.** `UI-STANDARD.md` distils
  both books plus three HCI papers into ten per-unit rules and a clause per
  component kind; `.claude/skills/hungom's design director` gates screen
  work on a written diagnosis; `scales`, `tokens`, `reachableclass`, `icons`,
  `permissionui`, `i18n` enforce several rules as tests. So "adherence" here
  means the standard's ten rules and clause, **plus** the book rules that
  apply specifically to a design-tool interface and that the standard does
  not yet state (§3). Those get written into `UI-STANDARD.md` §2 as a new
  clause set in Phase 0, so they outlive this plan.

Rulings from the user, 2026-09-23 (§9): **build the pen tool**; press-grade
output (bleed, crop marks, PDF) stays out; decorations on the digital card
come in as the last phase; libraries were evaluated freely, not limited to
the Vue/Node ecosystem (§10) — the editor engine stays our own.

## 2. What exists, measured against the twelve systems

Inventoried by reading the source (agent report, verified by hand on the
shell). "El" = printed elements (field / code / own words); "Deco" = drawn
decorations (rect / ellipse / line / words / mark / image).

| System | Present | Partial | Absent |
|---|---|---|---|
| 1 Canvas / print | zoom presets + Fit, snap, paper A4/A3/A5/Letter/Legal, margins, gap, cut line, per-page fit, DPI readout, `--paper` artboard | pan (scroll only), top ruler (static, shares), grid (snap-only on Place; drawn on Digital) | vertical ruler, user guides, centre guide, bleed/safe area (ruled out) |
| 2 Objects / layers | text, field, code, rect, ellipse, line, mark; x/y/w/h; visibility; layer list by half; forward/backward/front | image (model + renderer only, no tool), rotation & opacity (Deco only), lock (Deco "pin" only; `el.locked` is read at `:1065` and never set), send-to-back (in `arrange.js`, not wired) | group/ungroup, rename, barcode |
| 3 Selection / transform | click, Shift/⌘ multi-select, drag (Shift = axis lock), 8 handles (Shift = ratio), duplicate ⌘D, delete, distribute H/V | align (6 edges in `arrange.js`, 3 wired) | marquee, copy/cut/paste, flip, rotate handle, crop |
| 4 Text | 2 families shown in their own face (El), bold, colour, align, box = cap-height band on baseline, overflow shrink/wrap/cut + fit report | tracking (Deco: in model and renderer, no control); Deco font select names rather than shows the face | line-height, italic, case transform, text stroke |
| 5 Shapes / vector | rect (+corners), ellipse, line, fill none/solid/gradient, stroke width/colour/dash, 53 marks | — | paths/pen (**now in**, Phase 8), polygon/star |
| 6 Image | artwork upload with sniffing, 4 MB cap, re-encode, palette extraction | — | image objects on the artboard (no UI), clip to shape, crop/filters |
| 7 Colour | native picker + hex + eyedropper + swatches off the artwork + saved library colours | opacity & gradient (Deco only); brand colour not offered as a swatch | HSL/RGB entry (native picker covers), contrast check against the artwork |
| 8 Align / guides / snap | align, distribute, snap to element edges + stub + grid | snap ignores decorations (`edgesExcept :1051`) | centre snap, smart-guide lines, user guides |
| 9 Mask | — | — | full masks ruled out; clip-to-shape comes in (Phase 7) |
| 10 History | undo/redo (50), coalescing, dirty state, "Save · N", Back to saved, Standard design | "Save · N" ignores decorations (`:1538`) | local draft, recovery, leave-page guard |
| 11 Import / export | PNG/JPEG/WebP artwork in; test page through the print dialog; card JPEG via Send a test | — | PNG/SVG download of the printed ticket, greyscale print check, PDF (ruled out) |
| 12 Keyboard | ⌘Z ⇧⌘Z ⌘D ⌘A Esc Delete arrows (0.1 % / 1 %) ⌘\; `title` on every tool | shortcuts named only in two tooltips | copy/paste, order, zoom and tool keys; a shortcuts sheet |
| Inspector | three-tab panels per kind, unit suffixes, px + mm readouts | no multi-selection panel (shows the primary) | — |
| Library | 4 built-ins + saved shapes drawn as tiles, saved colours | text styles (model only, `MAX_STYLES 16`) | pictures/logos, recently used |
| Ticket-specific | template, dimensions, number, book, QR + density + overlap refusal, 10 sources, longest-entry preview, perforation, print layout | — | barcode (QR is the verify route; not needed) |

Digital tab (card 8c): its own canvas, layer list, inspector, undo stack, grid
and guides — **but no Draw rail, no library and no decorations**, although
the user reversed that restriction on 2026-09-22 ("essential design elements,
explicitly on both tabs": STUDIO-REDESIGN §13). `cardSVG` can splice a
decoration layer; no caller passes one.

## 3. The standard every studio component passes

Run in this order on every unit this plan touches or creates. Steps 1–3 are
the house standard and are not restated; step 4 is what this plan adds, and
Phase 0 writes it into `UI-STANDARD.md` §2.

1. **`UI-STANDARD.md` §1** — R1 focus, R2 cut edges not items, R3 space
   around > within, R4 show the thing, R5 text budget, R6 helper visible and
   smaller, R7 absence names its cause, R8 disabled with reason, R9 labels
   consistent in proportion to similarity, R10 every class reaches a rule.
2. **`UI-STANDARD.md` §2** clause for the unit's kind; §3 for any number.
3. **Tokens only** for every dimension and colour: `--fs-*`, `--fw-*`,
   `--sp-*`, `--r-*`, `--rule`, `--elev-*`, and the colour roles. The `scales`
   ratchet may fall, never rise. On-artwork ink stays literal (documented).
4. **The studio clause.** The five rules both books assert went into
   `UI-STANDARD.md` §2 ("Tool, inspector control, canvas overlay"), which
   states a rule only where two sources do. Everything below that only ONE
   book states is **studio practice**: followed here, cited to its page, and
   not promoted to the standard.

**Tool button (icon-only)**
- `label` + `hint` → `aria-label` + `title`; the tooltip carries the shortcut
  when one exists: "Duplicate · ⌘D". *(DU p168–170: an icon goes unlabelled
  only when universal; RU p220 supercharge the defaults.)*
- 32 × 32 minimum on a cursor UI; glyph 15–18 px inside it. *(DU p184, p210.)*
- State is more than colour: lit ink plus a fill when there is no word
  (`ToolButton` does this). *(DU p286–287; RU p166.)*
- Every glyph in a bar is distinct from every other glyph in it. Three
  commands under one drawing fails. *(P2 icon distinctness; R4.)*
- All glyphs from `Icon.vue` — one stroke width, one rounding. No inline SVG
  in a component. *(DU p172–174.)*
- Disabled carries the reason (`why`). *(R8.)*
- A bar holds ≤ 7 tools, grouped in threes and fours; groups by space or one
  hairline, never both. *(DU p43 Hick/Miller; R2, R3.)*

**Inspector field group**
- Label above, Title Case, ≤ 3 words; unit suffix inside the field; the
  origin stated once per group (the px / mm readout). *(DU p234, p241;
  controls.md R3, R5; R5.)*
- ≤ 5 choices → segmented control or tool row, never a `<select>`; six or
  more → a select. A visual choice (typeface, template, shape, colour,
  picture) renders the thing, not its name. *(DU p246; RU p48; P3 image cue.)*
- A control that takes effect at once is a switch or a pressed tool button,
  right of its label; a checkbox is for a value applied on submit. *(DU
  p250–251.)*
- `type="number"`, `step`, `min`/`max` where the value has a shape; tabular
  figures; `--font-data` for anything read digit by digit. *(§3; RU p130.)*
- Five states drawn: normal, focus (`--brand` ring), completed, error,
  disabled. The error sits beside the field it belongs to, not at the foot of
  the screen. *(DU p233–234; STUDIO-REDESIGN §9.)*
- Label smaller than the input's text; helper `.say` smaller still. *(DU
  p237; R6.)*

**Layer row**
- Kind glyph · name · row controls on the row (eye, pin, rename); selected by
  fill, not colour alone; hit area ≥ 30 px including the name. *(UI-STANDARD
  table clause; DU p251, p286.)*
- Names are the object's own, never a model key or "Rectangle 1 copy 2".
  *(controls.md R6; DU p352.)*

**Canvas overlay**
- Handles small, hit areas generous; `touch-action: none` on every drag
  surface. *(controls.md R10.)*
- Marquee and smart guides are one hairline in a semantic token (`--brand`
  for selection, `--info` for guides, matching the stub line); never a
  shadowed box. *(R2.)*
- Pinned and hidden objects read as such without colour: outline style and
  the row's icon change. *(RU p166.)*
- Rotation is typed, never dragged; nodes and handles are the drag surface.
  *(DU p83.)* Stroke ends and joins match. *(DU p87.)*

**Dialog (the unsaved-changes guard, the shortcuts sheet, the picture picker)**
- Opens only after a user action; X top-right with a ≥ 32 px hit area; Esc
  and click-outside close; primary and secondary visibly different; no
  double negatives ("Keep editing" / "Discard changes", never "Cancel" beside
  "Don't save"); ≤ 2 sentences; backdrop about 70 %. *(DU p262–267, p331.)*
- Keys set in `--font-data`, groups ≤ 7 rows, labels identical to the tool
  labels they describe. *(R9.)*

**Type, colour, depth**
- Two weights (`--fw-medium`, `--fw-bold`), none under 400; uppercase rubrics
  carry letter-spacing (`.rubric` already does). *(RU p40, p134.)*
- No grey text on a coloured fill; a semantic colour used as a fill takes its
  ink token; 4.5:1 for text. *(RU p42, p162; DU p98.)*
- Depth is the studio's stated model: rail recessed (`--bg`), panel raised
  (`--elev-2`), artboard at full strength; lifts use `--elev-3`; shadows from
  `--elev-*` only. *(RU p180–183; studio.css:62–99.)*

**Buttons and copy**
- One primary per bar (Save); destructive is a ghost with `danger`, set apart,
  red only on its confirmation. *(RU p60–62; DU p190.)*
- Verb-first ≤ 3 words; the same command has the same word on every tab; two
  different commands never share a word. *(R5, R9.)*

## 4. Findings on the studio as it stands

Every row was confirmed by opening the file. Fix these before building on
them (STUDIO-REDESIGN §13's lesson: a stale ledger sends people to rebuild
finished screens; an ignored defect ships twice).

### 4.1 Defects in tools that exist

| # | Defect | Where |
|---|---|---|
| D1 | Dragging a multi-selection leaves decorations behind: `group` is built from `pickedEls` only, so a placed 4-part library shape comes apart on its first drag | `TicketDesign.vue:1090` |
| D2 | Snap ignores decorations, snaps a group drag to its own members, and ⌘A skips decorations | `:1051–1062`, `:1475` |
| D3 | Arrow nudge moves the primary only, not the selection | `:1247` |
| D4 | "Save · N" counts elements, stub and sheet, never decorations — after drawing shapes it reads "Save the design" while dirty | `:1538–1549` |
| ~~D5~~ | **Withdrawn on opening the file.** `sheetHTML` spreads its options into the fallback `numberLayerSVG`, so `watermark` IS read whenever no layers are passed, and `printsheet.test.mjs:86` pins it | `ticketsheet.js` |
| D6 | `arrange.js` aligns to six edges and orders four ways; the rail wires three and three (no right / top / bottom, no send-to-back) | `:2453–2485` |
| D7 | `text.tracking` is in the model and renderer with no control | `designelements.js:204`, `DecorationInspector.vue` |
| D8 | Element `locked` is checked in `startMove` and never set anywhere — **moved to Phase 2**, where it gets the pin control; adding the field in Phase 0 would be a value nothing sets | `:1065`, `ticketelements.js` |

### 4.2 Adherence findings (the standard, applied)

| # | Finding | Where | Rule |
|---|---|---|---|
| A1 | Three alignment tools share one glyph (`icon="align"` ×3); four blend modes share `icon="layers"` ×4 | `DecorationInspector.vue:245–247`, `:303` | R4 / P2: glyphs distinct |
| A2 | Text alignment is words (`.seg` Left/Centre/Right) in `Inspector` and icons in `DecorationInspector`, one click apart, for the same command | `Inspector.vue:205–209` vs `DecorationInspector.vue:244–248` | R9 |
| A3 | The decoration typeface `<select>` names the face; the element one shows it (F2 done on one panel of two) | `DecorationInspector.vue:231–233` | R4; UI-EVIDENCE F2 |
| A4 | Two typefaces is a two-way choice presented as a `<select>` | both inspectors | DU p246 |
| A5 | View toggles that act at once are checkboxes: Every box, Real QR, Measuring guides, Grid & guides; Bold and Shadow likewise | `TicketDesign.vue:2336–2337`, `:2663`, `DigitalTab.vue:585`, `Inspector.vue:230`, `DecorationInspector.vue:277` | DU p250–251 |
| A6 | Zoom is text glyphs `−` `+` and a word "Fit" beside a rail of icons, while `zoomIn` `zoomOut` `fit` `actualSize` exist in `Icon.vue` | `:2357–2360` | R9, DU p172 |
| A7 | `Ink.vue` carries an inline SVG for the dropper (outside `Icon.vue` and the `icons` gate) and sets hex in a literal mono stack rather than `--font-data` | `Ink.vue:41–44`, `:69` | studio clause; §3 |
| A8 | Literals that duplicate a token: `ToolButton.vue:101–108`, `ToolBar.vue:52–74`, `Ink.vue:63–105`, `LibraryPanel.vue:274–337`, `DecorationInspector.vue:337–349`, `TicketDesign.vue:2901–2907` | those files | §3; UI-EVIDENCE Phase 6 (migrate while the file is open) |
| A9 | Validation problems render at the foot of the canvas, away from the field; the layer row's `!` is the only in-place cue | `TicketDesign.vue:2613–2615` | DU p233; correction beside the thing |
| A10 | The brand colour from Setup is not offered where ink is chosen | `swatches :1814`, `Ink.vue` | R7; RU p142 |
| A11 | Multi-selection has no panel: the inspector shows the primary as if alone | `:2626–2638` | R7; P3 confirm-at-target |
| A12 | *Found by rendering.* `Ink.vue`'s caption used the class `.note`, which is the app's global aside — so "off the artwork" was drawn with a stray left rule, padding and a bottom margin | `Ink.vue:71`, `style.css:899` | R10 (a global utility leaking into a scoped name) |

Not findings, checked and left alone: the header (one primary, Exit top-left,
tabs filled when on); the footer's action hierarchy (pinned by `sheettab`);
the rail/panel depth model; the `.say` / `.tiny` voices; the layer list's eye
and pin; the library tiles; the arrange rail's disabled-with-reason; the
ruler in shares with mm at the end (extended, not replaced, in Phase 3).

## 5. The gaps, ranked, and the decision on each

Ranking follows UI-STANDARD §0: the expensive mistake is the tool somebody
looks for and does not find; then losing work; then friction in the tools
used every minute.

| Rank | Gap | Decision |
|---|---|---|
| 1 | D1–D8, A1–A11 | **Fix first** — Phase 0 |
| 2 | Local draft, recovery, leave guard | **Build** — Phase 1 |
| 3 | Marquee, copy/cut/paste, group/ungroup, pin on elements, flip, N-selected panel | **Build** — Phase 2 |
| 4 | Smart guides, centre snap, drawn grid, rulers in mm, zoom keys, actual size, Space-pan | **Build** — Phase 3 |
| 5 | Shortcut registry + sheet; tool, order and zoom keys | **Build** — Phase 4 |
| 6 | Rename decorations, layer list as a component | **Build** — Phase 5 |
| 7 | PNG/SVG download, greyscale check, brand swatch, text styles in the library | **Build** — Phase 6 |
| 8 | Picture tool (logo / uploaded artwork) + clip to shape | **Build** — Phase 7; "upload any picture" is a named server phase after |
| 9 | Pen tool, paths, node editing | **Build** — Phase 8 (user's ruling) |
| 10 | Decorations + library on the digital card | **Build last** — Phase 9 (user's ruling) |
| — | Line-height, italic, case transform, text stroke | **Defer**: size derives from the box on purpose; none survives grey print better than bold + tracking |
| — | Polygon / star | **Defer**: the pen draws them; no built-in needed |
| — | User-draggable guides, drag-to-reorder layers | **Defer**: order keys + smart guides cover the need; `LayerList.vue` (Phase 5) is the precondition and emits `reorder` when the time comes |
| — | Contrast check against the artwork under a text box | **Defer**: needs pixel sampling of a served image; swatches off the artwork already ground the choice |
| — | Event / prize / terms as printed sources | **Defer**: they do not vary per ticket, so "Own words" already prints them; a per-ticket source needs `valueFor` on both sides |
| — | Boolean path ops, join/split, trace a logo (potrace) | **Next round** — the path model is shaped to receive them |
| — | Masks proper, bleed/crop marks, PDF, barcode, HSL entry, history panel, recently-used, upload any picture (server) | **Out** of this round |

## 6. Phases

Each phase ships on its own, gate green from a frozen archive, rendered and
looked at, with the §3 check run over every unit it touched. Sizes: S ≤ half
a day, M a day, L two to three days. Line numbers are as of `b07da07`.

### Phase 0 — Fix what exists; write the studio clause (M)

**Status 2026-09-23: built, gated, rendered** (kcho-shelter-0c). What it
became, where it differs from the text below:
- The three inspectors' lettering is ONE component, `ticketdesign/Lettering.vue`
  (faces passed in, so the card keeps Everyday / Figures): typeface as a
  two-way segment drawn in each face, alignment as `textLeft/Centre/Right`,
  Bold as a pressed tool, letter spacing where the model has it.
- A9 landed as the selected field's own faults above its inspector's tabs;
  the canvas foot still lists everything.
- `tests/emits.test.mjs` learnt that `@update:x="…"` is a listener (the long
  form of `v-model:x`, needed where a parent records undo first); red-checked.
- New glyphs: six object alignments, three text alignments, `toBack`,
  `distributeV`, `dropper`.
- `scales` baseline lowered by the counted migration (15 / 3 / 12 / 51 / 10).

**Shell** (`TicketDesign.vue`, one writer):
- D1 `startMove :1090`: `group` from `pickedThings` minus the primary, minus
  locked and hidden.
- D2 `edgesExcept(id)` → `edgesExcept(movingIds: Set)` over elements **and**
  decorations, skipping every id in the moving set (a group drag must not
  snap to itself); ⌘A at `:1475` includes enabled decorations.
- D3 `onKey :1247`: nudge every picked thing that is not locked; one `mark()`
  per run (the 500 ms coalescing in the design watcher already merges keys).
- D4 `changeCount :1538`: a second pass over `decorations`, same shape.
- D6 arrange rail `:2453–2485`: align right / top / bottom and send-to-back
  wired to the existing `alignPicked` / `orderPicked`.
- A5 view toggles → `ToolButton` with `aria-pressed` (Every box, Real QR),
  same for Measuring guides on the Artwork tab.
- A6 zoom stepper → `ToolButton icon="zoomOut|zoomIn|fit"`.
- A9: each validation problem also shown beside its source — the layer row's
  `!` becomes the anchor and the inspector's Box tab shows the sentence for
  the selected element (`.tiny bad`, R6 keeps its size).
- A10: `swatches` gains `state.cfg.brandColor` first, titled "the raffle's
  colour", when set.
- A8 in this file's own `<style>` (`.tabbtn`, `.zbtn` literals → tokens).

**Inspectors** (`Inspector.vue`, `DecorationInspector.vue`, one writer each):
- A1: alignment gets three glyphs `alignLeft` `alignCentre` `alignRight`
  (new in `iconpaths.js`); blend modes become a four-word `.seg` (no glyph
  can carry "multiply"; DU p246 ≤ 5 → segmented).
- A2/A4: both panels use one `Lettering` control: a two-way `.seg`, each
  option drawn in its own face (`f.stack`); alignment as the same three
  ToolButtons in both.
- A3 falls out of A2/A4.
- D7: "Tracking" numeric field with `%` suffix on decoration text, min −10 max
  50 step 1 (renderer already applies it).
- A5: Bold → pressed ToolButton (`type` glyph + "B" word); Shadow → `Toggle`.
- A8 literals in `DecorationInspector.vue:337–349` → tokens.

**Primitives** (`Ink.vue`, `ToolButton.vue`, `ToolBar.vue`, `LibraryPanel.vue`):
- A7: dropper glyph moves into `iconpaths.js` as `dropper`; hex field takes
  `--font-data`; A8 literals → tokens in all four files.

~~**Library** (`ticketsheet.js`): D5~~ — withdrawn, see §4.1.

~~**Model** (`ticketelements.js`): D8~~ — moved to Phase 2.

**Docs:** `UI-STANDARD.md` §2 gains the studio clause from §3 verbatim, with
the page references. `STUDIO-PLAN.md` gets a dated row per phase as they
land (the ledger habit).

**Tests:** `arrange.test.mjs` unchanged (edges already covered);
`ticketscreen.test.mjs` — the six align tools and four order tools present,
each disabled with the reason when nothing is selected; ⌘A and nudge driven
through the bound handler with a synthetic event (the file already drives
`sel`, `design`, `tab`, `zoom` through `setupOf`); `designelements.test.mjs`
— tracking renders `letter-spacing`; `icons.test.mjs` sees the five new
glyphs; `printsheet.test.mjs` — the `watermark` option is gone from
`sheetHTML`'s source.

### Phase 1 — Draft recovery and the leave guard (M)

**Status 2026-09-23: built, gated, rendered** (kcho-shelter-0c). Differences
from the text below, each decided on reading the code:
- **No guard on Exit.** The studio is kept alive between screens, so leaving
  loses nothing; a question there is friction that protects nothing. The guard
  sits on the two moves that take work OFF the canvas — the template picker
  and "Print from this" — and says where the work went (kept on this computer)
  or, with no storage, that it will be lost.
- Drafts are written 600 ms after the design settles and flushed on switch,
  deactivate, unmount and page close; a pending offer is never overwritten.
- Restoring is one undo step. The offer answers are "Restore them" /
  "Discard them"; the card's draft is offered on the Digital tab only.

- New `src/lib/studiodraft.js` (pure, storage injected): `draftKey(id)`,
  `writeDraft(storage, id, { design, saved, editedAt })` (design JSON minus
  `artwork`, the saved JSON it was made against, `editedAt`, `savedAt`),
  `readDraft` (null on garbage), `compareDraft(draft, savedJSON)` →
  `'none' | 'same' | 'newer' | 'stale'` (stale = somebody saved since; still
  offered, with the sentence saying so), `clearDraft`.
- Shell: the `watch(design, …)` at `:1736` schedules `writeDraft` at 600 ms
  (`typeof localStorage !== 'undefined'`, try/catch as `store.js:993`);
  `watch(activeId)` at `:1503` reads and compares after `saved` is set. The
  offer is a **bar above the artboard, not a modal**: "A draft from 14:02
  was not saved · Restore · Discard", only for `newer | stale` (R7: none /
  same / newer / stale are four states and only two show a bar). `saveDesign`
  and `revertToSaved` clear the draft. The card gets the same, second key,
  `cardState` vs `cardSavedState`, restored through `applyCard`.
- `beforeunload` registered in `onActivated`, removed in `onDeactivated` and
  `onUnmounted` (the exact pair `onFocusKey` uses at `:1410–1437`), fires when
  `dirty || cardDirty`.
- In-app guard: `exitStudio` and the template `<select>` (bind `:value` +
  `@change`, so a refused switch leaves the select on the current template)
  open `<Sheet title="Unsaved changes">` with **Keep editing** (ghost) /
  **Discard changes** (danger). Tab switches need no guard: `design` lives in
  one kept-alive component (`App.vue:477`), so nothing is lost; the guard
  prevents confusion, the draft prevents loss.
- `watchorder`: the `activeId` handler stays inline and non-immediate;
  `draftOffer` / `draftState` declared above the `loadCard` watcher at `:203`.
- Tests: `tests/studiodraft.test.mjs` with a plain-object storage (all four
  compare outcomes, garbage → null, round trip identity); `ticketscreen` with
  `globalThis.localStorage` stubbed: a newer draft shows "Restore", the same
  draft shows nothing; `footerfit` already scans screens, so the two-button
  footer is checked for free.

### Phase 2 — Selection, clipboard, group, pin, flip (L)

**Status 2026-09-23: built, gated, rendered** (kcho-shelter-0c). Where it
differs from the text below:
- **`useDrag.js` is not extracted yet — moved to Phase 8.** Nothing in this
  phase needs the seam; the pen tool and the card tab do, so it is cut there,
  with that reason (STUDIO-PLAN §1: reopen a seam with a reason). The marquee
  is the frame's own `onFrameDown`, reusing the draw state.
- Shift adds to a selection on both lists; ⌘-click takes one part of a group
  (and ⌘-drag moves it alone). ⌘-click used to mean "add".
- **Looking found the rail too tall.** Eighteen tools in one column pushed
  Save, Undo and Redo below a laptop window, so the rail is two tools wide:
  the six alignments as a matrix, every other group rows of two. Checked at
  1280 × 800 with the footer on screen.
- Copy / cut / paste keep an in-memory clip (the system clipboard asks
  permission to be read); a paste past sixty shapes toasts what it left out.

- New `src/lib/selection.js`: `bandOf(origin, point)`, `hitsIn(things, band)`
  (enabled things whose box intersects), `expandGroups(ids, decorations)`,
  `mergeSelection(current, hits, add)` → `{ sel, also }`.
- New `src/lib/clipboard.js`: `copyRecords(elements, decorations, pickedIds)`
  (deep clone, `after` stripped as `duplicatePicked :647` does),
  `pasteRecords(clip, { nextId, nextDecoId, nextGroupId, room, by })` →
  `{ elements, decorations, refused }` (fresh ids, `offsetBox`, source group →
  fresh group, cut at `MAX_DECORATIONS`, refused count for the toast).
- Model (`_shared/designelements.js`): `group` (string ≤ 40, `[a-z0-9]`),
  `flipX` / `flipY` booleans, `nextGroupId`; `decorationSVG` emits one
  transform `translate(cx cy) rotate(r) scale(sx sy) translate(-cx -cy)`;
  `faultsIn` refuses a bad `group`. `src/lib/designelements.js` re-exports
  `nextGroupId`.
- Shell: extract the pointer state machine into
  `src/components/ticketdesign/useDrag.js` — `useDrag({ frame, stage,
  thingById, edgesFor, snapX, snapY, mark, pick, picked, lockAxis, keepRatio })`
  returning `{ drag, drawn, snapLines, startMove, startResize, onFrameDown,
  onPointerMove, endPointer }`; the shell destructures at top level so
  `setupOf` still reaches `drag` / `drawn`. `onFrameDown` replaces
  `startDraw :1103`: pending → draw; Space held → pan (Phase 3); otherwise a
  press on the bare frame starts a **marquee** (`drawn` reused as the band,
  `.drawnbox.band`); release → `hitsIn` → `mergeSelection(…, shift)`; a
  zero-size band clears the selection (today a click on empty artboard does
  nothing).
- `pick(id, add, solo)`: a decoration pick expands to its group unless
  `solo` (⌘-click enters a group; Shift adds — the hint text says both).
  `placeFromLibrary :717` gives a multi-part placement one group.
- `copyPicked / cutPicked / pastePicked` (in-memory `clip`; paste toasts the
  refused count), `groupPicked / ungroupPicked` (`whyNotGroup`: needs two or
  more drawn shapes; mixed selection refused with `whyNotOrder`'s sentence),
  `flipPicked(axis)` (`whyNotFlip`: "Only drawn shapes flip — a field prints
  a value"), pin ToolButton on element rows (D8's field), handles hidden on a
  pinned element. Escape clears `pending` first, then the selection.
- Rail: Group, Ungroup, Flip across, Flip down in the Arrange rail — icons
  `group`, `ungroup`, `flipH`, `flipV` (new, distinct). Bar count stays ≤ 7
  per `tgroup`.
- A11: new `src/components/ticketdesign/SelectionInspector.vue` mounted
  `v-if="many"` ahead of the two inspectors: "5 selected · 3 fields · 2
  shapes", the bounds in shares and px, a glyph + name list (click → primary),
  and the two mixed-selection sentences the rail hints carry. No editing
  controls: bulk actions live on the rail.
- Tests: `tests/selection.test.mjs`, `tests/clipboard.test.mjs` (each asserts
  its exports were found first); `designelements.test.mjs` — a flipped rect's
  SVG contains `scale(-1 1)`, group survives `normalDecorations`, a 41-char
  group is a fault; `templates.test.mjs` — a locked element round-trips
  through `setTemplateDesign`; `ticketscreen` — the four new rail tools
  present and disabled with reasons; `emits` sees `SelectionInspector`'s
  `pick` wired.

### Phase 3 — Canvas feedback: guides, grid, rulers, zoom, pan (M)

**Status 2026-09-23: built, gated, rendered** (kcho-shelter-0c). Notes:
- A moving box snaps by whichever of its leading edge, centre or trailing edge
  is nearest a line; candidates include every other box's centre and the
  artboard's. Nearest wins between a line and the grid, so with the grid on a
  guide appears only when a line is the closer catch — rendered both ways.
- `+` / `−` step the zoom, `⌘0` fits, `⌘1` is actual size; bare keys, because
  `⌘+`/`⌘−` are the browser's own page zoom. Space + drag pans the stage.
- The fit leaves room for the 16 px side ruler; `ticketscreen`'s fit assertion
  was re-aimed at that arithmetic (0.605 → 0.595), with the reason in place.
- The registry for these keys is Phase 4; they are bound directly for now.

- New `src/lib/studiocanvas.js`: `snapEdges(things, movingIds, { stubAt,
  centres })` → `{ xs: [{ at, kind: 'edge'|'centre'|'board'|'stub' }], ys }`;
  `snapNear(value, candidates, step, threshold)` → `{ value, hit }`;
  `ticksFor(lengthMM, pxPerMM)` → `[{ mm, px, major }]` every 5 mm, labels
  every 10 mm, labels dropped when 10 mm < 24 px.
- Shell / `useDrag`: `snapX/snapY :1048` wrap `snapNear`; the drag sets
  `snapLines = { x, y }` and clears on release; two `v-if` hairlines
  `.guide.v/.h` inside `.frame` (`--info`, `var(--rule)`,
  `pointer-events: none`). Centre candidates join left/right and top/bottom.
- Drawn grid on Place: `gridVisible = gridding && gridX * frameWidth >= 6`;
  the `.guides` background copied from `DigitalTab.vue:856–860`.
- New `src/components/ticketdesign/Rulers.vue`: top and left rulers from
  `ticksFor` (`heightMM = widthMM × active.height / active.width`); replaces
  the share ruler at `:2499`; `.stage` becomes a corner/top/left/frame grid.
- Zoom: `zoomActual()`, ToolButtons `actualSize` and `fit` beside the
  stepper; `+ − ⌘0 ⌘1` via Phase 4; Space + drag pans the stage's scroll
  offsets while held.
- Tests: `tests/studiocanvas.test.mjs` (a moving set of two is excluded from
  its own candidates; decorations contribute edges; centre kind returned;
  ticks and label thinning); `ticketscreen` — a `.guides` div and the ruler
  labels "0" and "190" in visible text at the fixture's zoom.

### Phase 4 — The shortcut registry and sheet (M)

**Status 2026-09-23: built, gated, rendered** (kcho-shelter-0c). Notes:
- Found on the way: the digital card's Redo tooltip promised ⇧⌘Z and the
  handler answered nothing off the Place tab. Undo and Redo now answer on every
  tab, each against that tab's own history.
- The brackets match the PHYSICAL key (`code`): on a Mac ⌥ changes the
  character, so ⌥⌘] arrives as a quotation mark.
- No key acts while the shortcuts sheet or the switch dialog is open.
- Pen and node keys (P, A) arrive with Phase 8.

- New `src/lib/studiokeys.js`: `KEYS = [{ id, keys: ['⌘','C'], label, when:
  'place'|'any', action, group, inFields, alt? , doc? }]` covering ⌘C ⌘X ⌘V,
  ⌘D, ⌘A, ⌘Z ⇧⌘Z, ⌘G ⇧⌘G, ⌘] ⌘[, ⌥⌘] ⌥⌘[, + −, ⌘0 (alt `0`), ⌘1 (alt `1`;
  Chrome on macOS keeps ⌘1 for tab switching and cannot be prevented — the
  sheet says so), V R E L T M P A (select / rect / ellipse / line / words /
  mark / pen / nodes), Esc, Delete, ⌘\ (`when: 'any', inFields: true`), `?`
  (the sheet), and a documentation-only row for Space + drag. Helpers
  `keyMatches`, `findBinding`, `keyLabel`.
- Shell: `onFocusKey :1457` becomes a lookup — `findBinding(e, when)`, the
  `inFields` guard, `preventDefault`, `ACTIONS[b.action]()`; `ACTIONS` is a
  const object of shell functions (`copyPicked`, `orderForward`, `zoomActual`,
  `toolRect: () => beginAdd('d:rect')`, `help`, …).
- New `src/components/ticketdesign/ShortcutsSheet.vue`: wraps `Sheet.vue`,
  renders `KEYS` by group with `<kbd>` per key in `--font-data`; no literal
  keys in its template. Opened by `?` and a header `ToolButton icon="help"
  label="Shortcuts"` beside Exit.
- Tooltips: `ToolButton` gains a `keys` string prop; `tip()` appends
  ` · ⌘D`. The shell has `keyOf(id)` from the registry and call sites add
  `:keys="keyOf('duplicate')"` — one attribute, one source.
- Tests: `tests/studiokeys.test.mjs` — unique ids; no two bindings share a
  combo within a `when`; `keyMatches` on synthetic events (⌘C, ⇧⌘Z, `?`,
  `+`, Ctrl on non-Mac); **identity**: the `ACTIONS` keys extracted from the
  shell's source equal `KEYS.map(k => k.action)` both ways; the sheet imports
  `KEYS` and contains no `⌘` literal; every `keyOf('x')` in the shell names an
  id; enumeration guard > 20 bindings.

### Phase 5 — Layers: rename, one component (M)

**Status 2026-09-23: rename built, gated, rendered** (kcho-shelter-0c).
**`LayerList.vue` was not extracted**, deliberately: renaming does not need the
seam, and moving the markup would orphan the shell's `.ellist` rules and hide
the list from a dozen `ticketscreen` assertions that render it in place. It
comes out with drag-to-reorder, which does need it. Renaming is a double-click
on the row (Enter or blur keeps, Escape abandons, one undo step) and a name
field that IS the drawn shape's inspector heading, showing its kind until named.

- Model: `name` (≤ 40, no `<>`) on decorations; `decoName :812` prefers it.
- New `src/components/ticketdesign/LayerList.vue` from `:2214–2317`: props
  `{ elements, decorations, byHalf, halves, sel, picked, decoName, trouble }`;
  emits `pick`, `pin`, `toggle`, `rename`, `remove`, `mark`. Inline rename on
  double-click or an `edit` ToolButton (new glyph); Enter/blur commits, Esc
  cancels; the shell applies `mark(); d.name = value`. Element rows carry the
  pin from Phase 2. Drag-to-reorder deferred (§5) — the component emits
  `reorder(ids)` when it is built.
- Tests: `designelements.test.mjs` (name normalises, 41 chars refused);
  `ticketscreen` — a named decoration shows its name; `emits` sees every
  LayerList emit wired; `reachableclass` — the list's classes live in the
  list's own template now.

### Phase 6 — Export, the grey check, brand swatch, text styles (M)

- New `src/lib/ticketexport.js`: `exportSize(design, dpi = 300)`;
  `sampleTicketSVG(design, active, values, { encode, qrUrl })` → rooted
  `<svg viewBox="0 0 W H">` with the artwork `<image>` then the element layer;
  `inlineImages(svg, fetcher)` → data URIs with `failed: []`;
  `rasterise(svg, w, h)` following `blankArtboardFile` (`blankticket.js:85–117`);
  `downloadBlob`.
- The trap, stated so nobody rediscovers it: an SVG rasterised through
  `<img src="data:…">` cannot load external resources, so `<image
  href="https://…">` inside it is silently blank. The PNG path is white →
  `drawImage(artwork <img crossOrigin="anonymous">)` → `drawImage(layer with
  inlineImages applied)`. The artwork is a public object
  (`templates.ts:338 getPublicUrl`); **confirm at build time** that the
  bucket answers `Access-Control-Allow-Origin: *` (expected for Supabase
  public storage) or the canvas is tainted and `toBlob` throws — the helper
  line then says which picture is missing rather than refusing. The SVG path
  keeps https hrefs.
- UI: on the Place tab's readout row, ToolButtons `download` "PNG at 300 dpi"
  and "SVG" (`why` = "Upload some artwork first" without a design), and a
  `preview`/`previewOff` toggle **Preview in grey** → `.frame.grey { filter:
  grayscale(1) }` with the `.say` "Shown as a grey press would print it"
  (TICKET-DESIGN-AUDIT W17). PDF stays the print dialog's Save as PDF; the
  Print sheet tab says so in one `.say`.
- Text styles: `LibraryPanel` gains a "Lettering" row like Colours — keep the
  selected text's family/weight/align/tracking/colour (`MAX_STYLES 16`, the
  model and `libraryFaults` exist), apply to a selection; tiles render "Aa" in
  the style (image cue).
- Tests: `tests/ticketexport.test.mjs` — rooted output, artwork href present,
  190 mm at 300 dpi = 2244 px, `inlineImages` swaps only https and reports a
  throwing fetcher; `designlibrary.test.mjs` — a style round-trips;
  `ticketscreen` — Download disabled with reason without artwork.
- Deterministic raster (resvg + bundled OFL fonts) is the named upgrade, §10.

### Phase 7 — The Picture tool, and clip to shape (M)

- Sources: the organisation logo (`state.cfg.orgLogo` / `orgLogoSmall`,
  `config.ts:106`, public branding bucket) and every uploaded artwork
  (`templates[].url`). Shell computed `pictures = [{ src, name, kind }]`.
- New `src/components/ticketdesign/PicturePicker.vue`: `Sheet` with a
  thumbnail grid (the picture is the control), emits `pick(src)` / `close`.
  Rail ToolButton `image` "Picture" (`why` = "Upload a logo or artwork first"
  when empty) → picker → `pending = 'd:image'` → draw the box →
  `addDecorationAt` with `image: { src, fit: 'contain', clip: 'none' }`.
  `DecorationInspector` for `kind === 'image'`: thumbnail, "Change picture"
  (emits `pick-image`), Fit (`contain | cover` as a two-way `.seg`), **Clip**
  (`none | ellipse | rounded`, three ToolButtons — the spec's "clip image to
  shape" without a mask tool: the decoration's own box is the shape, `radius`
  governs `rounded`).
- Model: `image.fit`, `image.clip`; `decorationSVG` emits
  `preserveAspectRatio="xMidYMid meet|slice"` and a `<clipPath>` with a
  unique id like the gradients; `printWarnings` adds a line when the picture
  will land under 200 dpi (`ctx.pictureWidths` from the shell after
  `naturalWidth` is known; skipped when unknown).
- The later server phase, named so it is not confused with this one:
  `supabase/functions/api/pictures.ts` (`upload_design_picture`,
  `remove_design_picture`), a public `design-pictures` bucket, `checkImage`
  from `branding.ts` (magic bytes, PNG/JPEG/WebP, 512 KB), a per-raffle count
  cap, organiser-only writes registered for `strictactions` / `everyaction` /
  `payloadshape`; the picker gains a third source.
- Tests: `designelements.test.mjs` — fit/clip normalise and render;
  `ticketscreen` — Picture disabled with reason when no pictures exist;
  `emits` for the picker.

### Phase 8 — The pen tool: paths with nodes (L)

**What it is.** A seventh kind of decoration, `path`, drawn with a pen and
edited by its nodes, rendered on both surfaces by the same string renderer as
every other decoration. Straight and curved segments, open or closed, with
fill / stroke / dash / opacity / shadow / blend exactly as a rectangle.

**Model** (`_shared/designelements.js`):
- `KINDS` gains `'path'`; `normalDecoration` gains `path: { nodes: [{ x, y,
  hx1, hy1, hx2, hy2 }], closed }` where `x, y` are **unit coordinates of the
  decoration's own box** (0–1, four decimals) and the handles are optional
  (absent = corner). Nodes in box space means move, resize, align, distribute,
  duplicate, library save/place, group, flip and undo all work on a path with
  **no new code**, because they all act on the box; the stroke keeps its
  share-of-width thickness because the path is mapped to artboard px at draw
  time, never scaled as a transform.
- Bounded by construction so the 65536-character limit stays a formality:
  `MAX_PATH_NODES = 48` per path, `MAX_PATH_NODES_TOTAL = 360` per design
  (≈ 36 KB at four decimals), refused in `faultsIn` with the limit in the
  sentence; fewer than two nodes refused; `minSide('path')` is 0 like a line.
- `decorationSVG` case `'path'`: `<path d="M … C … [Z]">` from
  `pathData(nodes, closed, box, w, h)` with `stroke-linejoin="round"
  stroke-linecap="round"` (DU p87). Library tiles and `shapeFrom` need nothing.

**Geometry** (`_shared/pathgeometry.js`, re-exported by
`src/lib/pathgeometry.js`; pure, never throws, never mutates): `pathData`,
`addNode`, `moveNode`, `setHandle(n, which, p, symmetric)`, `toggleSmooth`,
`removeNode`, `closePath`, `boundsOfPath` (cubic extrema from the derivative,
~40 lines — the part people reach for Paper.js for), `refitPath(deco)`
(recompute the box from the node extents and re-express the nodes, so a node
dragged outside the box grows it rather than clipping), `insertOnSegment`
(de Casteljau split), `nearestOnPath` (sampled, for click-to-add).

**Tools and interaction:**
- Draw rail gains **Pen** (`P`): click adds a corner node, click-and-drag a
  smooth node with symmetric handles, clicking the first node closes, Enter
  or Esc finishes an open path; Shift constrains to 45° steps. The path so
  far renders through the real renderer while drawing.
- **Edit nodes** (`A`, and double-click on a selected path): nodes drawn as
  squares (corner) and circles (smooth) with handle lines in `--info`; drag a
  node, drag a handle (⌥ breaks symmetry), double-click a node to toggle
  corner/smooth, ⌥-click a segment to insert, Delete removes the selected
  node (never below two), Esc leaves node mode; arrows nudge the node. Every
  gesture is one undo entry (`mark()` at pointerdown).
- The Draw rail then holds rect · ellipse · line · words · mark · picture ·
  pen = **seven**, the §3 ceiling; node editing lives on the selection.
- Inspector for a path: Box · Style (corners hidden) · Effects, plus a Path
  row: "12 nodes · Closed [Toggle] · Edit nodes [ToolButton]" and a `.say`
  naming what is deferred (join/split, boolean ops, trace a picture).
- Pen and node modes are two more modes of `useDrag.js` (Phase 2), which is
  why the extraction happens there and Phase 9 can reuse both on the card.

**Icons:** `pen`, `node` in `iconpaths.js`, distinct from `design`, `type`,
`select`.

**Tests:** `tests/pathgeometry.test.mjs` — every operation on a fixture, the
`refitPath` round trip is an identity to 1e-4, `pathData` for a fixture
compared as a string, limits refused; `designelements.test.mjs` — the kind
normalises, renders `<path`, refuses node counts, refuses over the QR like
every other kind; `designlibrary.test.mjs` — a path part round-trips at a
different size; `ticketscreen` — Pen in the rail with label and title, Edit
nodes disabled with "Select a path first".

### Phase 9 — Decorations on the digital card (L, last)

- Storage: new config key `CARD_DECORATIONS` = `{ [treatment]: Decoration[] }`,
  exposed as `state.cfg.cardDecorations` from `config.ts`'s payload (the
  `cardLayout` / `designLibrary` pattern at `:177`, `:198`). Not inside
  `CARD_LAYOUT`: that is a sparse overlay of fixed parts with an 8192-char cap
  (`branding.ts:227`) and `validateCardLayout` ignores unknown ids;
  decorations are stored whole and need `faultsIn`. Per treatment, because a
  rule drawn on 1080 × 1920 means nothing on 1200 × 760.
- Server: `branding.ts setCardDesign` accepts `p.cardDecorations` (absent =
  untouched, `null` = clear); per treatment: known treatment, finite numbers,
  a 65536 cap, `faultsIn(list, { codeBoxes: [the code part's box] })`. That
  needs `resolveParts` / `PARTS` / `CARD_SIZES` on the server: move them to
  `supabase/functions/_shared/cardparts.js` (`.js`, because `ticketart.js`
  reaches it from plain-Node tests) with `src/lib/cardelements.js` re-exporting
  — the `designelements.js` shim pattern.
- Callers: `ViewTicket.vue:~568` passes
  `decorations: state.cfg?.cardDecorations?.[treatment]` in `cardValues`;
  `DigitalTab.vue:~119` passes its prop. No server-side card renderer exists
  (nothing under `supabase/functions` imports `ticketart`), so sending is
  unaffected.
- `DigitalTab`: adopts `useDrag` (its `:326–419` is a copy of the shell's),
  gets a `decorations` prop for the current treatment (the shell holds
  `cardDecos`, folds it into `cardState :163` so dirty / undo / draft cover
  it, and `saveCard` sends `cardDecorations`), the Draw rail (all seven,
  including pen and picture), `LibraryPanel`, `SelectionInspector`,
  `DecorationInspector`, and a **Drawn** group *above* the parts in its layer
  list (card decorations draw on top, `ticketart.js:~1998`). Shared: the pure
  libraries, `useDrag`, the components. Not shared: each tab's lists, undo
  entry points (`mark()` vs `emit('mark')`), `codeBoxes`.
- Fonts on the card: `DecorationInspector` gains `faces` (default `FAMILIES`);
  the card passes its FACES mapped onto the same ids (`text` → Everyday,
  `number` → Figures). The model keeps `'text' | 'number'`; only the names
  differ, which is the deliberate split (UI-EVIDENCE Phase 1). The
  "printed-only TODAY" comment at `DecorationInspector.vue:50` is updated.
- Tests: `tests/branding.test.mjs` — a decoration over the code part is
  refused, otherwise accepted, absent leaves the row; `cardlayout.test.mjs`
  guards that the parts table now lives in `_shared` and the golden render is
  unchanged; `ticketart.test.mjs` — `cardSVG` with a decoration draws it
  after the last part; `ticketscreen` / a DigitalTab render — the Draw rail
  and library present on the card tab.

### Order and distribution

Sequence, each step lowering the cost of the next:

1. **Phase 0** — shell writer, plus the two inspectors and four primitives
   (separate files; peer-able).
2. **Pure libraries** — `studiodraft.js`, `selection.js`, `clipboard.js`,
   `studiocanvas.js`, `studiokeys.js`, `ticketexport.js`, `pathgeometry.js`
   and their seven test files. No dependency on the shell; each is a file.
3. **Model** — `_shared/designelements.js` (group, flip, name, image fit/clip,
   path, `nextGroupId`, transforms, faults, warnings), `ticketelements.js`
   (locked), `_shared/cardparts.js` move; `designelements`, `templates`,
   `cardlayout` tests.
4. **Components** — `SelectionInspector`, `ShortcutsSheet`, `LayerList`,
   `Rulers`, `PicturePicker`, `ToolButton` (`keys` prop); each depends only on
   the libraries and the model.
5. **Shell integration** in phase order 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 — one
   writer in `TicketDesign.vue` + `useDrag.js`; `tests/run.sh` edited once per
   landing (re-derived from HEAD, one-line list).
6. **Phase 9** — `branding.ts` + `config.ts`, `DigitalTab.vue` +
   `ViewTicket.vue`, shell `cardDecos` wiring.

`TicketDesign.vue`, `useDrag.js` and `tests/run.sh` belong to one session for
the whole plan. Everything else is a separate file with a separate test and
may be **offered** to a peer that has asked for work (never assigned; a round
with nobody available is a legitimate round and the shell writer does the
next file in the list).

## 7. Coordination and execution rules

- **Announce before editing.** `TicketDesign.vue` and `DigitalTab.vue` were
  last held by *ticket-studio-redesign* (idle 2 d) with *kcho-shelter-25*
  adjacent. Message both with the file list per phase and wait for a reply
  before opening the shell; confirm nobody is mid-edit with
  `git diff HEAD -- <files>` empty and file mtimes older than the sessions'
  last activity.
- **Private index, blobs from HEAD, gate from a frozen archive, `commit-tree
  -p $BASE`, `update-ref` CAS, diff `$DERIVED..$PARENT` on every written path,
  `unset GIT_INDEX_FILE` before the reset.** Push own work as it lands (the
  standing authorisation), stopping if any commit in the range is a peer's.
- **Look at it.** Every phase ends by rendering the studio (Chrome headless
  through the `browser-automation` skill at 1200 px and 1440 px, both themes)
  and reading what rendered; then the `ui-reviewer` agent over each touched
  component with `UI-STANDARD.md` §7; a design change is not done until
  somebody has looked.
- **Absent machinery.** No control ships over a value nothing reads. Every
  new control above names the function that consumes its value.
- **Persisted shape.** Every new field on a decoration or element changes the
  shared normaliser and is checked in `faultsIn` / `validateElements`; the
  65536-character limit stays bounded by construction (no pictures, capped
  nodes).
- **Tests skill.** Load the `tests` skill before writing any suite; every new
  suite is registered in `tests/run.sh`; identity assertions, never absence;
  enumeration counts asserted before comparison.
- **No `<Bi>` in the studio** (none today): labels are English on an
  organiser's desk screen, so `i18n` is not triggered; a label that reaches
  the nav or a modal shared with sellers gets a Burmese line.

## 8. Verification

- `./tests/run.sh` from a frozen archive of each commit, green.
- New suites: `studiodraft`, `selection`, `clipboard`, `studiocanvas`,
  `studiokeys`, `ticketexport`, `pathgeometry`. Extended: `designelements`,
  `designlibrary`, `templates`, `ticketscreen`, `printsheet`, `icons`,
  `branding`, `cardlayout`, `ticketart`, `emits`, `reachableclass`, `scales`
  (baseline lowered by exactly what each file migrated).
- Rendered at 1200 px and 1440 px, light and dark; 390 px still shows the
  "needs a bigger screen" card unchanged.
- End-to-end by hand in the browser: draw a shape, group it with a field,
  marquee-select, copy/paste, flip, rename, pin; reload and restore the
  draft; press `?` and check every row's key works; draw a closed path with
  the pen, edit a node, save, reopen; download PNG and SVG and open both;
  print a test page; on the Digital tab draw a rule and send a test.
- `UI-STANDARD.md` §7 run over every touched unit; each change in the commit
  message names the rule it answers; `STUDIO-PLAN.md` rows dated as phases
  land.

## 9. Rulings from the user (2026-09-23)

1. **Pen tool: build it.** Paths with nodes and bezier handles, a pen tool
   and node editing, rendered on both surfaces. Masks stay limited to "clip
   a picture to a shape".
2. **Press-grade output: out of this round.** Browser print / Save-as-PDF and
   the dashed cut line remain; greyscale check and PNG/SVG download come in.
3. **Decorations on the digital card: yes, last phase.**
4. **Libraries:** a recommendation list was supplied (Fabric.js, Konva,
   Polotno, SVG.js, Paper.js, Moveable, Selecto, VueUse, hotkeys-js,
   Mousetrap, Sharp, PrimeVue) with "feel free to use your own", and the
   choice must not be limited to the Vue/Node ecosystem. Evaluated in §10.

## 10. Libraries: what was evaluated and what the studio uses

**The four facts a library has to fit.** They come from the code, not from
taste, and each has already cost the repo something when ignored.

1. **One model and one renderer run in three runtimes.** The decoration
   model and its SVG are in `supabase/functions/_shared/designelements.js`,
   plain JavaScript imported unchanged by the browser (Vite), the server
   (Deno) and the tests (plain Node, no DOM). A library the browser uses to
   *draw* would be a second renderer; the server would still draw the
   printed sheet and the digital ticket from the string renderer, and two
   renderers disagree the first time one of them moves.
2. **The artefact is SVG, placed by baseline, in shares.** A serial number
   lands on the printed label's own baseline because SVG text is placed by
   baseline against measured advance widths; a canvas engine's text layout
   is its own and would have to be reconciled with the print path.
3. **The design system is house-owned and enforced by tests.** `tokens`,
   `scales`, `reachableclass`, `icons` scan `src/components`. A component
   library brings its own radii, shadows, type and icon set, so it fails the
   standard this plan exists to apply, and it cannot be migrated to tokens.
4. **No network at runtime, small bundle, self-hosted.** The icon set is a
   hand-drawn stroke set kept off a CDN on purpose; Padauk is bundled
   (`public/fonts/padauk-myanmar.woff2`, OFL). Dependencies today: `vue`,
   `@supabase/supabase-js`, `@supabase/server`. That is the whole list.

| Candidate | Verdict | Why |
|---|---|---|
| **Fabric.js**, **Konva**, **PixiJS**, **Two.js** | No | Canvas engines with their own object model, pixel coordinates and text layout; would replace the shares/baseline model and add a second renderer the server cannot run (1, 2). The editing surface here is an `<img>` + the real SVG overlay + HTML hit boxes, which already shows exactly what prints. |
| **Polotno** | No | A complete editor SDK with its own store, panels and licence; it *is* the product it would be dropped into, and the user's stated goal is a proprietary model with ticket fields and print layout (the list's own caveat). |
| **SVG.js** | No | A DOM wrapper for building SVG in the browser; the renderer produces strings for three runtimes and never touches a DOM (1). |
| **tldraw** | No | React. |
| **Paper.js** | Not now | Excellent path mathematics, but ~300 KB, canvas-scoped, and cannot live in the shared model file. The pen tool needs about 250 lines of bezier arithmetic (bounds, split, nearest point) that must run in Deno too; own module (Phase 8). Re-evaluate only if boolean path operations are wanted. |
| **Moveable**, **Selecto** | No | Gizmos for drag/resize/rotate/marquee over DOM nodes with their own snapping and pixel model. The studio has drag, resize, Shift constraints and share-based snapping; a marquee is ~60 lines against the existing pointer code and must feed the undo coalescing (`mark()` before the gesture). |
| **VueUse** | Optional, not adopted | Well made; `useLocalStorage`, `onKeyStroke`, `useEventListener` would save a few lines. Not taken because the shell's listener lifecycle is deliberate (`onActivated`/`onDeactivated` pairs, `watchorder` gate) and a shortcut registry that both the handler and the sheet read is what makes the bindings testable (Phase 4). |
| **hotkeys-js**, **Mousetrap** | No | Hide the binding table inside the library; the identity test "keys bound = keys documented" needs the table in our hands anyway. The platform `keydown` + an 80-line registry covers V/T/R, ⌘-chords and the field guard. |
| **PrimeVue** (any component kit) | No | Fails (3) by construction. Buttons, dialogs, tabs, sliders and colour pickers exist here as tokens + `Sheet`, `ToolBar`, `ToolButton`, `Toggle`, `Ink`. |
| **Sharp** | Does not fit the platform | Native libvips for Node; the backend is Supabase Edge Functions (Deno). Raster work today is client-side (`templatefile.js` re-encode, `blankticket.js`, `sendTest`). |
| **Background removal** | Out | An optional pipeline, as the list itself says; not an editor feature. |

**Beyond the Vue/Node ecosystem — what would earn a place, and when:**

- **resvg (Rust → `@resvg/resvg-wasm`)**: renders SVG to PNG identically in
  the browser, in Deno and in Node tests, with fonts supplied as buffers.
  This is the route to a *deterministic* 300 dpi export and to server-side
  digital-ticket PNGs, and it lets a test assert pixels. Blocker: fonts must
  be bundled; Padauk is (OFL), and the number face's OFL metric-compatible
  members (Liberation Serif, Tinos) are already in `FAMILIES.stack`.
  **Phase 6 ships browser-canvas export first; resvg is the named upgrade if
  a print shop needs byte-identical output.**
- **pdf-lib** (browser + Deno): a real PDF with embedded fonts and a
  PDF-native page size, when press-grade output is scheduled. Out with §9.2.
- **potrace (C → JS/WASM)**: traces an uploaded logo bitmap into a path.
  With the pen tool in place this becomes a one-button "Trace this logo".
  Candidate for the round after this one; the path model stores node lists,
  not raw `d` strings, so it can receive the output.
- **opentype.js**: measuring text width in *any* bundled font. Today only
  the Times number face has an advance table, so shrink/wrap/cut are exact
  for numbers and browser-decided for Burmese text. A later option.

**So the editor engine stays our own.** Not reluctance to depend on code: the
engine's hard parts — the share model, baseline placement, the three-runtime
renderer, the print sheet, the QR overlap refusal — are done and tested, and
no candidate on the list replaces them without replacing the reasoning under
them. The pure modules this plan adds each stay under ~300 lines and are
driven by tests in plain Node, which is the property that keeps them cheaper
than a dependency.
