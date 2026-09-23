# The UI standard

**What this is.** A checklist you run against **one unit** — a button, a field, a
row, a card, a modal, a section — to decide whether it may be committed. It is
not a reading. Working through it on a single control takes about a minute.

**Why it exists separately.** Three documents already govern interface work here
and none of them answers this question:

| Document | Answers | Scope |
|---|---|---|
| `src/style.css` | what values exist | tokens |
| `.claude/skills/hungom's design director` | how to redesign a screen | a screen, with a written diagnosis first |
| `UI-EVIDENCE.md` | what is wrong with *this* system, and in what order | the codebase, as a programme of work |
| **this file** | **is this one unit acceptable, right now** | **one unit, before commit** |

**Adherence is per-unit and is not averaged.** Nine cards that adhere and one
that does not is a screen that does not. The tenth is where the eye stops.

---

## 0. The one number this is built on

From `UI-EVIDENCE.md` §2, measured in P3 (84 participants, 10,282 trials, 900
real GUIs):

```
adding one more item to a screen        +0.02 s
the thing not being there at all        +6.97 s      ← largest effect in the data
contour congestion, per unit            +2.59 s  (+4.91 s when absent)
```

A sought item is worth roughly **350** of the items you would cut to make room
for it. Restraint is nearly free and nearly worthless as a lever; the expensive
mistake is the other one. But congestion is the second-largest coefficient, so
the rule is narrower than "simplify":

> ### Cut edges, borders, boxes and nesting. Do not cut items people look for.

Every rule below is downstream of that sentence.

**On the seconds.** They are used as **ranking evidence** — the ordering of the
coefficients, not a claim that a missing item costs a KCHO organiser 6.97
seconds. P3's participants matched a cued target in a screenshot; ours work from
memory and intent. See `UI-EVIDENCE.md` §10.

---

## 1. The ten rules — every unit, every time

| # | Rule | Fails when |
|---|---|---|
| **R1** | Something is the focus | every child is the same weight |
| **R2** | Cut edges, not items | a bordered box inside a bordered card |
| **R3** | More space around a group than within it | one spacing value everywhere |
| **R4** | Show the thing; label last | a word restating what the control obviously is |
| **R5** | Text is budgeted | a sentence where three words would do |
| **R6** | Helper text is shorter and quieter, never hidden | prose moved behind a ⓘ |
| **R7** | Absence names its cause | empty and broken look identical |
| **R8** | Unavailable is disabled with the reason, never hidden | a control vanishes for a role |
| **R9** | Labels are consistent in proportion to similarity | one command with two names — or two commands forced into one |
| **R10** | Every class resolves to a rule that reaches it | a class that styles nothing, which looks like one that styles correctly |

### R1 · Something is the focus

Exactly one element in the unit is the largest, strongest or only coloured
thing. Hierarchy is decided before any styling.

*Priced by* P1: good designs **concentrate** fixations, bad designs spread them
evenly — *t*(19) = 3.63, *p* = .001. And bad is **flat, not ugly**: the badly
rated set sat in low valence *and* low arousal. An interface committed to
restraint can fail exactly this way.

*Check* — screenshot it and squint, or drop it to greyscale. Name the one thing
your eye lands on. If you cannot, the unit has no hierarchy.

*Seen here* — the Look block in `ViewTicket.vue`, three equal-weight rows of
prose the user called "a grave violation"; Setup's twelve sibling `.card` blocks
(`UI-EVIDENCE.md` F5).

*The corollary, and it is the trap.* **A group of equals needs one focus, not
one per group.** Four sub-groups each given their own emphasised heading is
twelve equals replaced by four equals — the same evenly-spread-fixation
signature at a coarser grain, and it feels like progress because the count went
down. Ask what the *screen's* focus is, not what each group's is. On Setup it is
the destructive pair being visibly unlike everything else.

### R2 · Cut edges, not items

Prefer a shadow, a second background, or more space to a border. Prefer one
container to three nested ones.

*Priced by* P3: contour congestion is the largest complexity coefficient —
+2.59 s present, **+4.91 s absent**. Asserted independently by Refactoring UI
("using too many of them can make your design feel busy") and Designing UI
("vertical dividers are rarely necessary"). This is the strongest convergence in
`UI-EVIDENCE.md` §3, and the one place where craft advice and measurement cannot
be traded off.

*Check* — count the borders and rules inside the unit. For each, ask whether
space or a background would do the same job. Count nesting depth of bordered
containers; more than two is a finding.

*Do not* answer R2 by removing a control somebody looks for. That is §0's
trade-off inverted, and it is the expensive direction.

*And do not answer R1 by adding one.* **A group is a heading plus more space
around it than within it (R3). It is not a box.** Wrapping four bordered cards
in a bordered container adds eight edges and removes none, which is the most
expensive complexity there is, in exchange for a grouping that space alone
would have given free.

### R3 · More space around a group than within it

*Priced by* P2 eq. (21) — association-to-proximity written as an objective
function, `minimise Σ δ_ij (h_ij + v_ij)/2`. Same rule in Refactoring UI
("avoid ambiguous spacing") and as Gestalt proximity in Designing UI.

*Check* — measure, do not eyeball: inner gap between siblings **must** be
smaller than the gap to the neighbouring group. Equal gaps mean no groups.

*Seen here* — the Supporter card's person block, measured out of the rendered
SVG rather than eyeballed: the evidence line sits **36 units** under the name
and **46** above the next group's label. Inner < outer, so it groups with the
name. That is the rule passing, and the check took one command.

### R4 · Show the thing; label last

An icon, a swatch, the object itself. A label is the last resort, not the
default.

*Priced by* P3: an image cue beats a text cue by **1.28–1.45 s** — the second
largest effect measured. Refactoring UI: "labels are a last resort."

*Check* — is there an existing glyph in `Icon.vue`? Does any label restate what
the control plainly is? An icon-only control still needs an accessible name and
a `title`.

*Constraint on the set, not the glyph* (P2): icons must be visually distinct
**from each other**. A new icon that resembles an existing one fails even if it
is the better drawing of its own concept.

### R5 · Text is budgeted

| Element | Budget |
|---|---|
| Button | **≤ 3 words**, verb-first |
| Heading | **≤ 4 words** |
| Label | **≤ 3 words**, no restatement of the input's obvious type |
| Status / pill | **1 word** where one exists |
| Helper | **1 sentence**, and see R6 |
| Inside a control group | **never a paragraph** |

*Check* — count the words. This is the one rule with no judgement in it.

*Seen here* — "Recorded as Sold" → **"Sold"**; "What supporters are called" over
three lines → **"Supporter titles"** over one; the Studio's 51 explanatory
sentences.

*The card that says it best*: `SUPPORTER / JOHN KUI / WELL-WISHER · 1 ticket`
became `WELL-WISHER / JOHN KUI / 1 ticket`. Nothing was added. The generic word
was removed and the earned one took its slot.

### R6 · Helper text is shorter and quieter, never hidden

The lever for de-emphasis is **weight, size and colour**. Never a click.

*Ruling from the user, 2026-09-23*: "helper text must be visible and smaller,
not competing for attention with tools icons." It killed a plan to move 51
sentences behind ⓘ affordances — hiding prose satisfies "not competing" by
deleting it from the screen, which is the wrong side of §0's number.

*Check* — visible without interaction? Smaller **and** lower-contrast than the
thing it explains? If it is the same size as the control's label, it competes.

### R7 · Absence names its cause

An empty unit says what would fill it, and what to do. **Empty, not-yet-loaded,
and broken must be distinguishable on screen.**

*Priced by* P3: a target being absent is **+6.97 s**, standardised 1.45 — the
single largest effect in the data, and nearly triple the next.

*Check* — render it three ways: zero rows, a null config, and a loader that
threw. If two of those look the same, that is the finding.

*Seen here, and it is the reason this rule is R7 and not a footnote.* Setup's
supporter-title editor threw `ReferenceError` on every warm mount for weeks. The
wreckage it left was `{ preset: '', rungs: [] }` — **exactly what Setup shows a
raffle that has not configured its rungs yet**. No error, no hole, no anomaly: a
card truthfully reporting a state the raffle could really be in. A defect whose
output is a legitimate state has no symptom. Twelve flat siblings (R1) removed
the last cue.

### R8 · Unavailable is disabled with the reason, never hidden

Shown disabled, with the reason in `title`. Not hidden, not enabled-then-refused.

*Already a test* — `permissionui`. It was written after a helper was shown "Sell
it whole" on a book that was out with a seller and got refused in front of the
person paying. Hiding makes the screen differ between roles with no stated
reason, and the helper concludes they have been demoted.

### R9 · Labels are consistent in proportion to similarity

The same command gets the same words everywhere. **Two different commands must
not be collapsed into one word to look tidy.**

*Priced by* P2 eq. (13)/(14): minimise `Σ d_kℓ y_k y_ℓ`, the pairwise distance
between chosen labels, **weighted by how similar the commands are**. Identical
commands labelled differently is the maximum penalty case. The weighting is the
whole rule, and it is the half that gets dropped.

*Check* — list every label in the unit that names an action. For each pair, ask
whether the two commands do the *same* thing. Same thing, different words → fix.
Different things, same words → also fix, and it is the worse one.

*The correction that produced this rule* (`UI-EVIDENCE.md` F4, corrected by its
own author): seven labels looked like one command with seven names. They were
**two** commands, and collapsing them would have been worse than the defect. The
line is whether the set is already in hand — you can name a set you hold ("Show
every seller"), you cannot name one you have not fetched ("Show"). Read as "same
words everywhere", P2 makes interfaces worse.

### R10 · Every class resolves to a rule that reaches it

A class that styles nothing looks exactly like a class that styles correctly.

*Why it belongs beside R7.* It is the same failure shape: the broken output is
indistinguishable from the working one, so nothing prompts anybody to look. Vue
scoped styles make it routine — a selector is written in the component that owns
the *inner* class and never matches, because the outer class lives in a
different file.

*Check* — for each class the unit carries, find the rule that styles it, and
confirm every ancestor selector in that rule is present **in this component's
own template**. A scoped rule cannot reach a class whose parent selector lives
elsewhere. Then render it: the fastest confirmation is that it looks unstyled.

*Worked example, found and being fixed 2026-09-23.* `Money.vue:423` and `:449`
carry `class="linkish"`. The rule was written `.statement .linkish` in
`Money.vue`'s own **scoped** block, and `class="statement"` exists at exactly
one place in the tree — `SellerMoney.vue:371`, a different component. There was
no global `.linkish`. So two tertiary controls rendered as default browser
buttons: bordered grey chips in a money column, which is word for word what the
comment above the dead rule said it existed to prevent — *"a bordered chip in a
money column reads as an input somebody is meant to type in."* The rule failed
to prevent the exact thing it named. The fix is a global primitive in
`style.css`; a tertiary action is a primitive, not a local class.

*Related, and each is the same silent shape:*

- **A retired token still referenced.** `var(--line, rgba(0,0,0,.1))` — `--line`
  was retired when the palette was unified, so every use resolved to the
  **fallback**, black at a tenth opacity: a rule you can see in light mode and
  cannot in dark. The fallback is not a safety net here, it is the bug, because
  it makes a dead token look alive. This is what `tokens` exists for.
- **A global utility leaking into a scoped container.** Naming a container
  `.req` once painted every pending approval red — `style.css` utilities are not
  scoped away, so a local name can collide with a global one and inherit its
  paint.
- **A class invented twice.** `references/controls.md` R2: a screen invents a
  class in its own `<style>`, and the next screen invents it again slightly
  differently. Two definitions is the same defect as none, discovered later.

---

## 2. Clauses by kind

Run §1 first, then the clause for what the unit is.

### Button
- Verb first, ≤ 3 words. No "Click to…", no restating the screen.
- One primary per unit. Everything else is secondary or ghost (R1).
- Destructive is **not** automatically big and red — move the red to the
  confirmation step, where it *is* the primary action. *(P2: prominence follows
  frequency, not severity.)*
- Field-facing: at least `--tap` (52px). Desk-facing tables may be denser.
- Disabled carries `title` (R8).

### Icon button
- Needs `aria-label` **and** `title` — icon-only controls have no accessible
  name and no accessible name means invisible to a screen reader *and* to
  `--snapshot`-style tooling.
- The glyph must be distinct from every other glyph in the set (R4).
- Never the only route to a destructive action.

### Input / field
- Label above, ≤ 3 words. Placeholder is an *example*, never the label.
- `inputmode` and `maxlength` set where the value has a shape.
- Numeric: `type="number"` plus tabular figures (§3).
- Its helper follows R6.
- A field whose value is a *title given to a person* is set at title weight, not
  settings weight — see `Admin.vue`'s `.rungname`.

### Card
- A card is for information that genuinely forms one unit. A page of identical
  cards is a page that has declined to express hierarchy (R1).
- Two nested bordered containers is the limit (R2).
- If a screen has more than ~6 sibling cards, group them under headings rather
  than adding more boxes.

### Table / list row
- Numbers right-aligned, money aligned on the decimal, tabular figures (§3).
- Row-level controls live **on the row**. *(P3 "Confirm": late fixations return
  to the target's quadrant — a result found in a list and confirmed by a panel
  across the screen makes the eye pay the journey twice.)*
- Status is a word, not a sentence (R5).
- The header row is not a border farm (R2).

### Modal
- Opens for a *decision or a detail*; an inline dock for a picked item is a
  modal that has not been written yet.
- Buttons stay inside — enforced by `footerfit`.
- Title ≤ 4 words. Primary action right, cancel as a ghost.
- Nothing inside a modal scrolls behind its own footer at 390px.

### Empty state
- Says what would fill it and offers the action that does.
- Distinguishable from *broken* and from *loading* (R7).
- Do not show tabs, filters or a header row over nothing.

### Status pill / badge
- One word. Colour from a semantic token, never a raw hex.
- A semantic colour used as a **fill** needs an ink token; `#fff` on `--brand`
  is 1.86:1 and fails.
- Not every noun deserves a pill. If every row has three, they have stopped
  meaning anything.

### Icon
- Must exist in `Icon.vue` — `icons` gates the set.
- Distinct from its neighbours (R4/P2).
- Never emoji.

---

## 3. Numbers are the product

Ticket numbers, serials, quantities, balances, money collected and outstanding,
reconciliation differences — these are the substance, not text that happens to
be numeric.

- **Tabular/lining figures.** Proportional figures make two numbers of equal
  magnitude look different lengths, which is exactly the comparison being made.
- **Right-align** numeric columns; align money on the decimal.
- **Serials read as identity.** Consistent formatting so the eye finds the
  varying part; real whitespace around them.
- **Magnitude before precision** for large numbers.
- **A reconciliation difference is the most important number on its screen.**
  Design it that way.

Money rendered as ordinary paragraph text reads as an estimate. This product
asks people to trust it with cash they collected by hand.

---

## 4. Mobile is not a narrower desktop

- `--tap: 52px` is a **correctness** constraint, not comfort. Sellers use this
  standing up, outdoors, holding cash and a book of tickets.
- **Scanning follows the long axis** — mobile vertical, desktop horizontal
  (P3). This is why `--tap` and `.dense` are two design problems and not one
  with a breakpoint.
- P3 measured mobile UIs as **faster** to search than web pages (−2.23 s), which
  supports the phone-first stance rather than merely tolerating it.
- **Check at 390px.** A phone layout that is a stacked desktop is not a designed
  layout.

---

## 5. When rules collide

P2 names *conflict resolution* as the reason written guidelines fail: many
rules, each touching few decisions, with no stated precedence. So this standard
states one.

1. **Correctness and safety first.** `permissionui`, `rolewords`, money custody,
   and disclosure rulings beat every aesthetic rule here.
2. **Absence (R7) beats restraint (R2, R5).** §0's coefficient says so
   explicitly: do not cut an item somebody looks for in order to reduce clutter.
3. **Focus (R1) beats uniformity.** A screen of equals is a failure mode, not a
   neutral outcome.
4. **Tap size beats density in the field; density beats tap size at a desk.**
   Say which you are designing for before compressing a row.
5. **Still tied → the simpler design wins.**

---

## 6. What is already a test — do not re-assert it

| Rule | Suite | Catches |
|---|---|---|
| R8, disabled with a reason | `permissionui` | a control hidden instead of disabled |
| One word per role, matching the server | `rolewords` | a refusal read aloud that names a word the screen does not show |
| Every `<Bi>` is translated | `i18n` | a label that silently renders English only |
| Modal buttons stay inside | `footerfit` | a footer escaping its modal |
| Every name resolves | `noundef` | `resolve is not defined` on the button that settles a seller's money |
| Screens actually render | `screenrender`, `screencalls` | a guard that is correct and never called |
| Immediate watchers ordered | `watchorder` | R7's incident — a loader throwing into a dead zone |
| Every colour exists and flips | `tokens` | a token that serves the light value in dark |
| The dimensional scales | `scales` | a scale value invented rather than derived |
| Icons exist and are distinct | `icons` | a glyph name that draws nothing |
| The card did not silently redraw | `cardlayout`, `ranks` | an accidental change to a buyer's card |

**Do not add a test per rule in §1.** Most of them are judgements about one
unit's composition, and a test anchored to a class name or a font weight dies on
the next tidy-up and teaches nothing when it does. Asserting something twice
means both fail together and neither says which broke.

A rule earns a gate when **the failure is mechanical** — detectable from the
source or a render, not from taste — **and** either a paper prices it or this
repo has already paid for it. That second clause is why `noundef` and
`watchorder` exist: nothing published prices them, and both had shipped.

By that test, most of §1 does not qualify and **R10 does**. Whether every class
a unit carries resolves to a rule that reaches it is decidable by reading the
template and the scoped block, it has no taste in it, and the repo has now paid
for it three times — `.linkish` reaching nothing, `--line` resolving to its
fallback after the token was retired, and `.req` colliding with a global
utility. It is the open gate candidate
from this file. `UI-EVIDENCE.md` §8 holds the others, with the evidence each
would need.

---

## 7. The adherence check

Before committing any UI change:

1. **Name the unit.** One sentence: what is it, and who is looking at it under
   what pressure.
2. **Run §1** — ten rules, in order.
3. **Run the §2 clause** for its kind.
4. **Look at it.** Render and screenshot; do not reason about the CSS. Both
   themes, and 390px. Use the `browser-automation` skill, or Chrome headless
   against a rendered SVG/HTML for artwork.
5. **Render its empty and broken states** and confirm they differ (R7).
6. **`./tests/run.sh`** — it gates the Pages deploy.
7. **Say which rule each change answers.** A change that answers no rule is
   scope you did not agree.

Step 4 is not optional and it is not a formality. The Supporter card's generic
word outranking its earned one was invisible in source — each of the three lines
is defensible alone — and obvious the moment it was rendered and stacked.

---

## 8. What this is not

- **Not a replacement for the design-director skill.** A whole-screen redesign
  still needs its written diagnosis first; that gate exists so a large diff can
  be argued finding by finding.
- **Not a token reference.** `src/style.css` owns values. A colour, radius or
  shadow that is not a token is a defect regardless of what this file says.
- **Not licence to widen scope.** Finding an R2 violation in a component you
  were not asked to touch is a note, not a change.
- **Not a licence to report without looking.** Open the file before you write
  a finding down. Four of `UI-EVIDENCE.md`'s first-draft findings dissolved on
  being opened — a deliberate hard-coded hex, an `Empty` count that was
  overstated, a panel whose collection can never be empty, and a table whose
  empty case is unreachable because you are signed in. A checklist generates
  this failure constantly, because every rule here has a plausible false
  positive. **A finding that dissolves costs more than the minutes it saved**:
  the author spends real time disproving it and gets their trust back slowly.
  Name the file and line, or you have a suspicion, not a finding.
- **Not measurement.** The books are practitioner craft; the papers are
  laboratory studies on screenshot search and free-viewing. A rule is stated
  here only where two sources assert it and, where a coefficient is quoted, a
  paper prices it. See `UI-EVIDENCE.md` §10 for how far the numbers transfer.

---

## Sources

`UI-EVIDENCE.md` §1 carries the full citations and the measurement detail.

- **P1** Haddad et al., *Good GUIs, Bad GUIs*, UMAP '24 — [doi:10.1145/3627043.3659549](https://doi.org/10.1145/3627043.3659549)
- **P2** Oulasvirta et al., *Combinatorial Optimization of GUI Designs*, Proc. IEEE 108(3), 2020 — [doi:10.1109/JPROC.2020.2969687](https://doi.org/10.1109/JPROC.2020.2969687)
- **P3** Putkonen et al., *Understanding visual search in GUIs*, IJHCS 199:103483, 2025 — [doi:10.1016/j.ijhcs.2025.103483](https://doi.org/10.1016/j.ijhcs.2025.103483)
- **Refactoring UI**, Wathan & Schoger
- **Designing User Interfaces**, Malewicz & Malewicz
