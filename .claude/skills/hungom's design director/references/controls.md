# Form controls and numbers

Rules extracted from the ticket-designer audit (2026-09-19). They are here rather
than in that audit because none of them is about tickets — each came from a
screen, and each applies to every screen after it.

Read this before building a settings screen, a configuration panel, or anything
with more than about four inputs.

---

## The gap that produced these

`src/style.css` styles `input, select, textarea` as one rule: full width, 52px
minimum, generous padding. That is correct for a text field and wrong for every
control that is not one. A checkbox inheriting it becomes a 52px box stretched to
its container with the label pushed to the far edge, in the operating system's
blue rather than the product's colour.

The app had twelve checkboxes and the defect went unnoticed for months. One
screen then added nine more and it became the worst-looking page in the product.

**The lesson is not "style checkboxes".** It is that a selector broad enough to
catch every input will catch the ones you did not picture, and the damage stays
invisible until a screen leans on the case you missed. This is the same shape as
`--line`: a value used in eight files that the system never declared. Both are
gaps that only became visible under load.

## R1 — Type-specific controls need their own rule

A blanket `input` rule must be followed by explicit rules for `checkbox`, `radio`,
`range`, `color` and `file`. Each needs its width reset, an explicit box size,
`accent-color: var(--brand)`, and its own focus ring.

Meet the touch target with the **label row**, not the glyph. A 52px checkbox is
absurd; a 20px checkbox inside a 52px clickable label is both usable and correct.

## R2 — A form row is a primitive, not a local class

When a screen invents `.grid`, `.check` and `.field` in its own `<style>`, two
things follow: the rules fight each other (a grid rule setting
`flex-direction: column` breaks a check rule expecting a row), and the next screen
invents them again slightly differently.

One `.formrow` — label, control, unit, hint, error — lives in the stylesheet.

## R3 — Every numeric input states its unit

Inside the field, as a suffix. A number with no unit is a number the user has to
go and look up.

## R5 — Numbers state their origin as well as their unit

"Starts at 1270" is not usable. "1270 px from the left edge of the artwork" is.
A coordinate without its reference point is only meaningful to whoever wrote the
model.

## R6 — Never render a model key as a label

`v-for="(f, key) in fields"` then `{{ key }}` puts `name`, `phone`, `address` on
screen in lowercase. If a label can be an object key, it is a label nobody chose.
Keep a display map beside the model.

## R7 — A preview shows the real artifact, not a stand-in

A placeholder rectangle where the QR belongs means the one element that fails
silently on paper is the one element never checked. If the real thing is
expensive to render, render it on demand behind a control — do not substitute a
box and call it a preview.

## R8 — Print work states effective DPI, bleed and trim

A design tool that cannot answer "will this print sharply" is a layout toy.
Effective DPI is `pixels / (mm / 25.4)`, and it belongs on screen next to the
artwork, not in help text as a recommendation.

## R9 — Undo means the last action

If the control restores the last *saved* state, it is called "Revert to saved".
Anything labelled Undo that discards ten actions is a trap, because the user
learns it is safe from the times they had only done one thing.

## R10 — A drag surface declares `touch-action`

Pointer events without `touch-action: none` scroll the page on a touchscreen
instead of dragging. The code looks correct and does nothing, on exactly the
devices least likely to be tested.
