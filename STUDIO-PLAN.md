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

### 4 — A toolbar, and progressive disclosure
Undo/redo, zoom, fit, actual size, align, preview. Advanced print settings
(bleed, crop marks, safe area, printer offset) collapse behind **Advanced** —
they do not exist yet and should be built here or not at all.

### 5 — Preview mode
A clean print preview: no editor controls, paper and orientation stated, zoom,
fit-to-page, actual size. `pageFit` already returns everything it needs.

### 6 — Layers
Only if the element list grows past what a flat list reads well. Reorder,
show/hide, lock. The model supports it; the interface does not need it yet.

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
