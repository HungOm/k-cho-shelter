# Rebuilding the Ticket Artwork Studio

A sequenced plan for turning the three-tab designer into a graphical editor, in
pieces that each ship on their own. Written to be picked up by whichever
session is free, because several work in this tree at once.

**Phase 0 shipped on 2026-09-20** (`5faab39`): the print sheet draws the page,
paper is a choice rather than an assumption, and the prose came off the screen.
Everything below is what that pass deliberately did not touch.

## What makes this tractable

The hard part is already done and it is not the part that looks hard.

`src/lib/ticketelements.js` holds a real element model — `SOURCES`,
`FAMILIES`, `normalElement`, `elementsOf`, `validateElements`, `placeElement`.
Every object on a ticket is already a record with a kind, a box in shares of
the template, an ink, a family and an alignment. `src/lib/ticketart.js` renders
that model to SVG and `tests/ticketart.test.mjs` pins the geometry against the
functions rather than the screen.

So this is a **UI architecture job, not a data-model job**. Nothing below
requires inventing a document format, and nothing below should change one.

The obstacle is the opposite: `src/components/TicketDesign.vue` is 2,000 lines
holding three tabs, their panels, their styles and their state. That single
file is why every change to the studio is risky, and splitting it is the
precondition for the rest.

## The order, and why it is this order

### 1 — Split the component before designing anything
`TicketDesign.vue` becomes a shell plus three tab components and a shared
inspector. No visual change, no behaviour change, no test change beyond
imports — a diff that is large but mechanical and reviewable in one pass.

Doing this first is what makes phases 2–5 small. Doing it last means every
phase fights the same file.

**Risk:** the render tests drive `setup()` bindings directly
(`tests/screen.mjs`), so bindings that move into children stop being reachable
that way. Check `tests/ticketscreen.test.mjs` before moving state, not after.

### 2 — One inspector, driven by selection
Today each tab carries its own permanent panel. Replace with a single
right-hand inspector whose contents are the selected object: a text element
offers font, weight, size, alignment, colour; a code offers error-correction
and size; nothing selected offers the sheet.

This is the change that most makes it feel like a tool rather than a form, and
it is mostly moving existing controls behind a selection switch.

### 3 — Direct manipulation on the canvas
Seven pointer handlers already exist for the stub line and boxes. Extend to:
drag to move, handles to resize, arrow keys to nudge, shift to constrain,
snapping to other boxes and to the stub. Positions stay shares of the template.

**Rule:** the canvas and the inspector edit the same value. Every drag must be
expressible as the number the inspector shows, or the two will disagree.

### 4 — A toolbar, and progressive disclosure — mostly already there
Zoom, fit, undo and the save state all existed; what was missing was
HIERARCHY. Three actions sat together looking identical, one of which
discards every measurement ever made on a template. That one is marked and
separated now.

**The advanced settings were not built, and that is the decision rather than
an omission.** Bleed, crop marks, safe area and printer offset appear in no
part of the pipeline — `grep` finds none of them in ticketsheet.js or
ticketdesign.js. Adding the controls would mean four sliders that nothing
reads, which is the `sheet.perPage` bug exactly: a control that said four
while the page took whatever fitted. If bleed is wanted, the work is in the
print pipeline first and the control second.

### 5 — Preview mode
A clean print preview: no editor controls, paper and orientation stated, zoom,
fit-to-page, actual size. `pageFit` already returns everything it needs.

### 6 — Layers
Only if the element list grows past what a flat list reads well. Reorder,
show/hide, lock. The model supports it; the interface does not need it yet.

## Who does what

Several sessions work in this tree at once, so the unit of distribution is a
FILE, not a feature. Two workers in one file is the failure that has cost the
most here — a duplicate `.seg` rule restyled three controls nobody was
touching, and a shared index nearly swept a half-staged feature into somebody
else's commit. Every task below names the files it owns. If two tasks want the
same file, they are the same task and one person does both.

| Phase | Task | Files it owns | Can start |
|---|---|---|---|
| 1 | Print sheet tab out | `ticketdesign/SheetTab.vue`, `studio.css` | **done** (`c6350da`) |
| 1 | Shapes panel out | `ticketdesign/ShapesPanel.vue` | **done** (`fa8a5c2`) |
| 1 | Template rail out | `ticketdesign/TemplateRail.vue` | **done** (`48ed3f8`) |
| 1 | Artwork verdict out | `ticketdesign/ArtworkVerdict.vue` | **done** (`a7fe5c9`) |
| 2 | Inspector | `ticketdesign/Inspector.vue` + the shell | **next** |
| 1 | Artwork stage out | `ticketdesign/ArtworkStage.vue` | after 3 |
| 1 | Place tab out | `ticketdesign/PlaceTab.vue` | after 2 |
| 2 | Inspector | `ticketdesign/Inspector.vue`, `PlaceTab.vue` | after 1c |
| 3 | Canvas manipulation | `PlaceTab.vue`, `lib/ticketelements.js` | after 2 |
| 4 | Action hierarchy | the shell | **done** |
| 4 | Advanced print settings | — | **not built, deliberately** |
| 5 | Preview mode | `ticketdesign/PreviewTab.vue`, `ui/SheetPreview.vue` | **offered → ticket-printing-qr-integration** |
| 6 | Layers | `Inspector.vue` | after 2 |
| — | Icon set | `ui/Icon.vue` | **built by kcho-shelter-e3**, uncommitted |
| — | Wire the icons in | the studio files | after the icon set is committed |
| — | `key` and `phoneOff` read as blobs | `ui/Icon.vue` | **unowned** — in the sidebar, nobody's |
| — | Token audit | `src/style.css`, `studio.css` | **offered → kcho-shelter-72** |

**PHASE 1 WAS WRITTEN WRONG AND THE WORK CORRECTED IT.** The plan said "three
tab components". What came out was five smaller ones, because the unit that
matters is not the tab — it is the SEAM. The sheet tab was worth cutting
whole; the shapes panel was four bindings, the rail five, the verdict one.
The Artwork tab as a whole was eighteen, and eighteen props and emits is the
same coupling written out longhand in a second file.

So the two tabs still in the shell are not waiting for someone to be brave.
The artwork STAGE shares pointer handling with the parent, and the Place tab
IS the selection state that phase 2 exists to give a home to. Extracting
either before that is relocating, not extracting. Phase 2 comes next and the
two tabs fall out of it.

**These rows are one worker's job, in order**, because each edits the shell as
it removes something from it. That is not parallelism, it is a merge.

An offer is not an assignment. Each of those sessions has its own user, and a
peer saying yes is not that user saying yes — so a row stays open until the
session itself confirms.

**The offered rows are genuinely independent** and are the ones to hand
out: preview mode is a new component fed by `pageFit`, the icon set is one
file the whole spec depends on, and the token audit is a read-then-edit of two
stylesheets nobody is in.

**Phases 2, 3 and 6 are sequential and belong together**, because an inspector
that edits a selection, a canvas that changes it, and a layer list that
reorders it are three views of one piece of state. Distributing them produces
three answers to "what is selected".

### Depending on work that is not committed yet

Wait for it. A commit that references a peer's uncommitted file is green in
this worktree and red the moment it is archived — the disk has their work on
it and the commit does not. That has happened once already: a component
importing `stubShare` from a module a peer had written but not committed
passed every local run and failed on the first archive.

So the icon wiring waits for the icon commit, and anything else that leans on
a neighbour's file waits the same way. Nothing is lost by waiting; the next
task in the list is always one that stands alone.

### Handing a task over

Say the file list before you start, in a message, and wait for an answer. Work
through a private index (`GIT_INDEX_FILE`) with explicit paths — the shared
one has carried other sessions' staged work all day. Verify from
`git archive <sha>` and not from the worktree.

## Rules for whoever picks this up

- **The design skill gates this.** `.claude/skills/hungom's design director`
  requires a written diagnosis before UI changes, and it is right: a 2,000-line
  file invites a rewrite nobody can review.
- **Do not invent controls.** Every visible control must drive a real value.
  A bleed slider that nothing reads is the `sheet.perPage` bug again — it was a
  slider from one to twelve that nothing ever read.
- **Do not change the persisted design shape** without checking
  `setTemplateDesign` in `supabase/functions/api/templates.ts`. It stores the
  design as opaque JSON with an 8,192-character limit and a finite-number
  check, so new fields persist against the deployed function — but the limit is
  real and a layers array will approach it.
- **Verify from an archive, never from this worktree.** Several sessions keep
  uncommitted work here; a green local run says these files pass, not that this
  commit passes.
- **Look at it.** Nothing in phase 0 was ever seen — there is no browser on the
  machine it was built on. Whoever has one should check before trusting it.

## Coordination

`TicketDesign.vue`, `ticketart.js` and `ticketdesign.js` have been rebuilt
recently by another session; `ViewTicket.vue` and the digital ticket are
theirs. Ask before starting, and say which files you expect to write.
