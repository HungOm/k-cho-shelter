# The interface, measured

**Status: Phases 0–5 shipped. Phase 2's F3 held, Phase 6 ongoing. Updated
2026-09-23.**

| | | |
|---|---|---|
| **0** · the scales | `6253531` | 30 tokens, every value already in the tree |
| **1** · one font vocabulary per surface | `1343354` | *ticket-studio-redesign* |
| **2** · F2 typeface previews | reassigned | *ticket-studio-redesign*, same spec |
| **2** · F3 header thumbnail | **held** | until `TicketDesign.vue` is free |
| **3** · Setup grouped | `6913f1e` | four groups, one card moved |
| **4** · absence names its cause | `9d29899` | five of six sites were already right |
| **5** · one word per command | `9d29899` | F4 was mis-filed; see below |
| **6** · migrate literals | ongoing | ratcheted by `scales.test.mjs` |

New gates since: `scales`, `reachableclass` (*kcho-shelter-25*, to this
document's spec).

Five sources were handed to this repo — three HCI papers and two books on
interface design — with the instruction to use them to improve the Ticket Studio
and the app's interface system-wide, at the level of each element and each
component.

This document reads all five, says what each licenses, runs the books' own audit
method over this codebase, and proposes a programme ranked by *measured effect
size* rather than by taste.

Two headlines, because together they decide everything below.

> **1. The colour half of this design system is mature. The dimensional half
> does not exist.** Colour is role-named, dark-mode-aware, contrast-measured and
> pinned by a test. Size, space, radius, weight and elevation have almost no
> tokens at all — so those decisions are made again, by hand, in every file. The
> audit found **62 distinct font sizes, 9 font weights, 29 spacing values, 16
> radii and 25 shadows** across an app with one font-size token and two shadow
> tokens.
>
> **2. Where the books and the papers overlap, the composition is already
> right.** Several files here derived the papers' findings independently and
> wrote down the same reasoning. The screen-level findings are narrow and
> specific. There is no case for a redesign.

Four candidate findings were investigated and **withdrawn** after opening the
file; one was **corrected by a peer session** and the correction was verified.
Both lists are in §10 so nobody re-finds them.

---

## 1. The sources

### The papers — what things cost

**P1 · Good GUIs, Bad GUIs: Affective Evaluation of Graphical User Interfaces.**
Haddad, Latifzadeh, Duraisamy, Vanderdonckt, Daassi, Belghith & Leiva, UMAP '24.
[doi:10.1145/3627043.3659549](https://doi.org/10.1145/3627043.3659549)
32 participants viewed 20 top-rated and 20 bottom-rated GUIs for 10 s under eye
tracking, webcam and EEG.

- The verdict is formed **inside the first second** — pupil diameter separates
  good from bad within 1 s (*p* < .05) and not significantly after it.
- Fixation *count* is not discriminative. **Fixation distribution is.** Good
  designs concentrate fixations; bad designs spread them evenly. 1 s
  *t*(19) = 2.10, *p* = .04; 5 s *t*(19) = 2.98, *p* = .005; 10 s
  *t*(19) = 3.63, *p* = .001. The authors attribute the even spread to "an
  excessive number of GUI elements (visual clutter) or poorly arranged
  components."
- Bad is **flat, not ugly** — bad designs landed in the *low*-valence,
  *low*-arousal quadrant; good ones in high/high. A design can fail by being
  boring, measurably.
- **Aesthetic judgement is not private taste.** Cronbach's α = .80/.87;
  test–retest ρ = .57–.76; 2024 ratings matched a ten-year-old corpus at
  *r*(38) = 0.97, *p* < .0001. This removes "design is subjective" as an
  argument against gating on it.

**P2 · Combinatorial Optimization of Graphical User Interface Designs.**
Oulasvirta, Dayama, Shiripour, John & Karrenbauer, *Proceedings of the IEEE*
108(3):434–464, 2020.
[doi:10.1109/JPROC.2020.2969687](https://doi.org/10.1109/JPROC.2020.2969687)
We are not running a solver. We take the **objective functions**, because each
is a design rule written precisely enough to be *computed* — and this repo
already enforces design rules as tests.

- **Label consistency**, eq. (13)/(14): minimise `Σ d_kℓ y_k y_ℓ`, the pairwise
  distance between chosen labels, with more consistency demanded for more
  similar commands. Identical commands labelled differently is the maximum
  penalty case.
- **Association → proximity**, eq. (21): with `δ_ij ∈ [0,100]`, minimise
  `Σ δ_ij (h_ij + v_ij)/2`.
- **Grid quality**: minimise the number of distinct grid lines used; reward
  edges aligning to extremal lines, penalise intermediate ones that jag the
  outline. Alignment is a *count*.
- **Icon selection**: comprehensible, identifiable, **and visually distinct from
  each other** — a constraint on the set, not on any glyph.
- Frequency-weighted Fitts' law for placement: prominence and position follow
  *how often*, not *how severe*.

It also names why written rules fail — *conflict resolution* (many rules, each
touching few decisions) and *validity* (most published heuristics are practice,
not evidence). Every rule proposed in §8 carries its evidence for that reason.

**P3 · Understanding visual search in graphical user interfaces.**
Putkonen, Jiang, Zeng, Tammilehto, Jokinen & Oulasvirta, *Int. J.
Human-Computer Studies* 199:103483, 2025, CC BY.
[doi:10.1016/j.ijhcs.2025.103483](https://doi.org/10.1016/j.ijhcs.2025.103483)
84 participants, 10,282 trials, 900 real GUIs. The most directly usable of the
three.

| What | Cost in search time | Standardised |
|---|---|---|
| **Target is absent** | **+6.97 s** | **1.45** — largest effect in the data |
| Cue was text, not a picture | +1.45 s / +1.41 s | 0.30 / 0.29 |
| Contour congestion, per unit | +2.59 s present, **+4.91 s absent** | 0.06 / 0.12 |
| Visual clutter | +0.42 s / +0.48 s | 0.09 / 0.10 |
| Grid complexity | +0.25 s present, **+0.99 s absent** | 0.05 / 0.20 |
| Webpage → mobile UI | **−2.23 s** | −0.47 |
| **One more item on screen** | **+0.02 s** | 0.06 |

Plus: **Guess → Scan → Confirm** (first fixations go upper-left *regardless of
target location*; then structure guides; then late fixations return to the
target to confirm); scanning follows the long axis (mobile vertical, desktop
horizontal); and complexity explains little — marginal R² 0.053 against 0.235
for the model of what a GUI *is*.

### The books — what to do

**Refactoring UI**, Adam Wathan & Steve Schoger. Systems-first: *limit your
choices*, *systematize everything*, hierarchy before styling, spacing/type/
colour/elevation scales defined in advance, and a set of specific rules
catalogued in §3.

**Designing User Interfaces**, Michał & Diana Malewicz. Component-by-component —
objects, colour, typography, icons, buttons, cards, tables, forms, modals,
navigation — plus a **UI Audit method**, which §4 runs over this codebase
verbatim.

---

## 2. The one number that reorders the backlog

```
adding one more item to a screen      +0.02 s
the thing not being there at all      +6.97 s
```

**A sought item is worth roughly 350 of the items you would cut to make room for
it.** P3 states the trade-off outright: "if a highly simplified GUI lacks items
that users are looking for, this proves detrimental to visual search, while the
cost of additional items seems low from our data."

This matters here because it cuts against a live bias. The repo's design
guidance is — correctly — a document about restraint: cut the sentence, cut the
card, cut the badge. The measurement says restraint is nearly free *and nearly
worthless as a performance lever*, and that the expensive mistake is the other
one. This repo has already paid for it three times under the name "everything
except X". Now it has the coefficient.

It does not license clutter. Contour congestion is the second-largest
coefficient and costs real seconds. The rule that falls out is narrower and more
useful than "simplify":

> **Cut edges, borders, boxes and nesting. Do not cut items people look for.**
> Congestion is the expensive kind of complexity; set size is the cheap kind.

---

## 3. Where the books and the papers agree

This is the spine of the document. **The books say what to do; the papers say
what it is worth.** Every rule below is asserted independently by at least two
of the five sources, which is what makes it worth building a gate around.

| Rule | Refactoring UI | Designing UI | Priced by |
|---|---|---|---|
| **Use fewer borders** — prefer a shadow, two background colours, or more space | "Use fewer borders… using too many of them can make your design feel busy and cluttered" | "Vertical dividers are rarely necessary"; "avoid decoration and ornamentation without function" | **P3**: contour congestion is the largest complexity coefficient — +2.59 s, **+4.91 s when the target is absent** |
| **More space around a group than within it** | "Avoid ambiguous spacing… always make sure there's more space around the group than there is within it" | Gestalt proximity: "objects placed close to each other are automatically understood to be a group" | **P2 eq. (21)** — the identical rule, written as an objective function |
| **Hierarchy before styling** | "Hierarchy is everything… not all elements are equal" | "Try not to exceed 3–4 [font] styles per screen" | **P1**: good designs concentrate fixations, bad ones spread them evenly — *t*(19) = 3.63, *p* = .001 |
| **Empty states are a priority, not an afterthought** | "…don't settle for plain and boring"; hide tabs and filters that do nothing yet | — | **P3**: **+6.97 s**, the single largest effect measured |
| **Limit your choices; define systems in advance** | "Systematize everything"; no two scale values closer than ~25% | Audit: count every style, replace rare ones with the nearest common one | **P2 eq. (13)/(14)**: consistency as a minimisation |
| **Show the thing, don't name it** | "Labels are a last resort" | Icons and images over words where the choice is visual | **P3**: image cue beats text cue by **1.28–1.45 s** |
| **Destructive ≠ big and red** | "Being destructive… doesn't automatically mean a button should be big, red, and bold" — move the red to the confirmation step, where it *is* the primary action | — | **P2**: frequency-weighted Fitts — prominence follows frequency, not severity |
| **Right-align numbers** | "Right-align numbers" | "Numbers should nearly always be right-aligned" | — *(already done here — 49 sites)* |

The convergence on **borders** is the strongest result in this document. Three
sources say "fewer edges", and P3 prices it as the most expensive kind of visual
complexity there is. It is also the one place where the aesthetic advice and the
performance data cannot be traded off against each other.

---

## 4. This system, measured

Malewicz's audit method, run over `src/style.css`, `src/components/` and
`src/verify/`. His instruction is to count every value, tabulate usage, and
replace rare cases with the nearest common one.

### 4.1 Typography — 62 sizes, 9 weights

```
.56 .58 .6 .62 .66 .68 .7 .72 .74 .76 .78 .8 .82 .84 .85 .86 .88 .9 .92 .95
.98 1 1.02 1.04 1.05 1.06 1.08 1.1 1.12 1.15 1.25 1.3 1.4 1.5 1.6 1.65 2 2.2
2.4 2.6 3.2         rem
10 11 12 13 14 15 19 26 30                                               px
.68 .74 .78 .82 .86 .88 .92 1.04 1.05 1.5                                em
```

Refactoring UI: *"it's not uncommon to find that every pixel value from 10px to
24px has been used in the UI somewhere"* — and that no two values in a scale
should be closer than about **25%**. Here `.8rem` and `.82rem` are 2.5% apart;
`.84 / .85 / .86` are 1% apart. That is not a scale with exceptions, it is the
absence of a scale.

Three unit systems are mixed. The `em` values are the specific hazard
Refactoring UI names: *"if you give an element a font size of 1.25em, inside
that element 1em is now 20px"* — so a nested `.86em` computes to a size that is
in no scale at all. **`--fs-ui` is the app's only font-size token.**

Weights: `400, 500, 550, 600, 650, 700, 800, 850` (plus a `100 900` variable
range). Refactoring UI: *"two font weights are usually enough for UI work."*
`550`, `650` and `850` are the tell — those are values you arrive at by nudging,
not by choosing.

Per-file, counting only what each component declares in its own `<style>`
(inherited sizes are on top of these):

| Component | sizes | weights |
|---|---|---|
| `TicketDesign.vue` | **12** | 3 |
| `AppShell.vue` | **11** | 4 |
| `Approvals.vue` | **9** | 4 |
| `Home.vue` | **8** | 3 |
| `ticketdesign/DigitalTab.vue` | 6 | 1 |

Against Malewicz's 3–4 per screen. The Ticket Studio is top of the list.

### 4.2 Spacing — 29 values, no base

```
113× 10px   103× 12px   98× 8px   97× 6px   86× 14px   64× 4px   57× 2px
42× 16px    28× 3px     28× 18px  21× 20px  20× 7px    11× 9px   10× 5px
…and 5px, 11px, 13px, 22px, 24px, 26px, 28px, 30px, 32px, 36px, 40px, 46px, 48px, 96px
```

Malewicz's soft-grid method says the most popular spacing becomes the base and
every deviation goes on the list. Here there are **five co-equal candidates**
(6, 8, 10, 12, 14) and every integer between 2 and 14 is in use. `10px` and
`11px` are 10% apart; `12` and `13`, 8%.

**There is no spacing token.** `--pad-x` and `--pad-y` exist for dense table
cells and nothing else.

### 4.3 Objects — 16 radii, 6 border widths, 25 shadows

Malewicz: *"More than one border thickness and more than two radius values
should raise suspicion of inconsistency."*

- **Radii**: three tokens (`--r` 16, `--r-sm` 11, `--r-ui` 5) — good — plus
  twelve literals: `1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 14, 24px`. And **three
  spellings of "pill"**: `50%`, `99px`, `999px`.
- **Border widths**: `1px` (94×), `1.5px` (20×), `2px`, `3px`, `4px`, `.5px`.
  Six, where the book says one should raise suspicion. `.5px` renders
  inconsistently across devices.
- **Shadows**: two tokens (`--shadow`, `--shadow-lg`) and **23 one-off values**.
  Refactoring UI asks for an elevation system of about five shadows *mapped to
  z-position* — button < dropdown < modal — so that choosing a shadow means
  choosing a height, not picking a blur radius.

### 4.4 Colour — the part that is done

For contrast, this is what a finished subsystem looks like here. Colour is
role-named (`--brand-ink`, `--border-strong`, `--stage`, `--custody-*`),
redefined under a dark block, contrast-measured in comments
(`--muted-2` is *"3.03:1 — large text, icons and rules only. Never a caption"*),
and pinned by `tokens.test.mjs`, which asserts every `var()` name used actually
exists after a `var(--warn-ink, …)` fallback silently greyed out a warning about
tickets leaving a seller's hands.

Refactoring UI asks for 8–10 greys and 5–10 shades per accent. This app has nine
neutrals and four brand roles — the same count, named by **role** instead of by
number. That is the better choice for a token system and it should not be
changed. The gap is not colour. The gap is everything with a dimension.

---

## 5. What the sources say we already got right

This list protects these components from the rest of the work.

- **`TemplateRail.vue:58–80` — a template is chosen by its picture.** In the
  file's own words: *"A template is recognised by its picture, so the picture is
  the control. This was five lines of prose per template… in a list whose whole
  job is 'which of these is the ticket I mean'."* That is P3's image-cue result
  and Refactoring UI's "labels are a last resort", derived from scratch and
  worth ~1.3 s per lookup. The paperwork moved to the tooltip rather than being
  deleted — which is §2's rule, also obeyed in advance.
- **The Place rail's Draw row — shapes are icons, not words.** *"A rectangle, an
  ellipse and a line ARE their icons."* Image cue, plus P2's icon-distinctness
  constraint satisfied: three glyphs nobody can confuse.
- **`LibraryPanel.vue` — "Everything else is a click on a picture of itself."**
  Third independent derivation of the same result.
- **`Search.vue:425–436` — the only place in the app that distinguishes *why*
  something is absent.** "No tickets yet — the tickets have not been made" is a
  different screen from "Nothing matches *bakery*" with a *Clear and start
  again* button. P3 prices absence as the most expensive state in any interface;
  this is the model, and §7.4 proposes copying it.
- **`Draw.vue:108` — absence stated positively.** `Every sold ticket has a name
  and a phone number.` Not an empty list: an answer.
- **The `.note` pattern — an alert carries a left colour bar** rather than being
  another card in a stack of equals. This is Refactoring UI's "add color with
  accent borders", already the house style.
- **Upper-left is spent on orientation.** `AppShell.vue` puts logo, event name
  and project code there — exactly the Guess stage's target, and exactly the
  placement P3 cites Leiva et al. for.
- **Numbers.** 49 `tabular-nums` sites, `.data` carrying the figure face, money
  right-aligned, nil as `—`. Both books ask for this; the app has it.
- **`Cancel` (16×) vs `Close` (13×) is a real distinction, consistently
  applied** — `Cancel` in forms that write, `Close` in views that read. P2's
  label-consistency objective already satisfied on the most-used pair of words.
  Do not "unify" these.
- **On-artwork colours are deliberately literal, and correct.**
  `TicketDesign.vue:3074` and its amber sibling are hard-coded because the
  outline sits on *somebody's artwork*, which can be any colour — a theme token
  could land on its own twin. `BookGrid.vue`'s `#fff` seals are the same call,
  with the pale-tile case inverted through tokens at lines 252–254.
- **Density is gated twice** — `.dense` on the root *and* `min-width: 1024px`,
  with `--tap` never overridden. Refactoring UI: *"Dense UIs have their place…
  the important thing is to make this a deliberate decision instead of just
  being the default."* It is, and P3's finding that mobile UIs are searched
  *fastest* supports the phone-first side of it.

---

## 6. Findings

### Tier 1 — the dimensional system (system-wide, every component)

| # | Finding | Measured | Source |
|---|---|---|---|
| **S1** | **No type scale.** 62 distinct font sizes across three unit systems, one token (`--fs-ui`). Adjacent values 1–3% apart. | §4.1 | RU "Establish a type scale"; "Avoid em units"; ≥25% rule |
| **S2** | **No weight set.** 9 weights including 550, 650, 850 — nudged, not chosen. | §4.1 | RU "two font weights are usually enough" |
| **S3** | **No spacing scale.** 29 values, five co-equal bases, every integer 2–14 in use. | §4.2 | RU "Establish a spacing and sizing system"; DU soft-grid method |
| **S4** | **16 radii, three spellings of "pill".** Three tokens then twelve literals. | §4.3 | DU "more than two radius values should raise suspicion" |
| **S5** | **6 border widths, including `.5px`.** | §4.3 | DU "more than one border thickness…"; and §3's borders convergence |
| **S6** | **No elevation system.** 2 tokens, 23 one-off shadows; a shadow is chosen by blur radius rather than by height. | §4.3 | RU "Use shadows to convey elevation"; ~5 mapped to z-position |

These are one finding wearing six hats: **there is no dimensional system, so
every component re-decides.** That is precisely the condition Refactoring UI's
first chapter exists to prevent, and it is why the *same* screen can carry
twelve font sizes.

### Tier 2 — screens and components

Each verified by opening the file. Line numbers as of `d349841`.

| # | Finding | Where | Why | Cost |
|---|---|---|---|---|
| **F1** | **The printed tab carries two names for one font.** `DecorationInspector.vue:209–210` hard-codes a copy of the *digital* card's words onto the *printed* tab. The Place rail offers two ways to put words on a ticket, forty lines apart — `TicketDesign.vue:161` "Own words" → `Inspector` → **"Padauk"**, and `:201` "Words" → `DecorationInspector` → **"Everyday"**. Same tab, same panel slot (a `v-if`/`v-else` pair — *"Two components, one slot"*), same font, one click apart. | 3 files | P2 eq. (13)/(14), maximum-penalty case; P1 lists inconsistency as a defining property of its bad set | S |
| **F2** | **No typeface picker shows a typeface.** Three `<select>` lists of names, in the one tool whose entire subject is visual appearance, on a screen that shows the thing in four other places. | `Inspector.vue:178`, `CardInspector.vue:184`, `DecorationInspector.vue:233` — the last moved in `1343354` and **no longer hard-codes anything**; it is in scope because it still names rather than shows | P3 image cue, +1.28–1.45 s; RU "labels are a last resort" | S |
| **F3** | **The active template is a picture in the rail and a name in the header.** The header's own comment says *"which template am I editing" is the question a screen with three tabs and two side panels most easily loses* — then answers it with a dropdown, on every tab, while the thumbnail list that answers it properly is reachable only on Artwork. | `TicketDesign.vue:1990` | P3 image cue; P3 Guess stage (the header *is* the upper-left) | S |
| **F4** | **Seven labels for one command.** "Show them" · "Show all" · "Show all at once" · "One at a time" · "Show them all" · "Show everybody" · "Show". Each defensible alone; the set is what P2 penalises and what a volunteer has to learn. | `Draw.vue:295`, `Permissions.vue:263`, `SellTicket.vue:228/255`, `Money.vue:423/449`, `Admin.vue:1520` | P2 eq. (13)/(14) | S |
| **F5** | **Setup is twelve sibling cards at one visual weight**, every heading an `<h3>`, no grouping, no rank — and the two destructive actions (`Reset this raffle`, `Fill with sample data`) sit at the same weight as `How this raffle looks`. See the incident below, which is the strongest evidence in this document. | `Admin.vue:19, 81, 93, 136, 193, 260, 379, 422, 610, 684, 710, 828` | P1's measured signature of a bad design is fixations spread evenly with nothing to anchor them; RU "destructive ≠ big and red" and "hierarchy is everything" | M |

> **F5, evidenced.** While this document was being written, **kcho-shelter-25**
> found that *"What supporters are called"* — one of the twelve cards — had a
> watcher throwing inside a `const`'s temporal dead zone, and Vue swallows
> watcher errors because this app installs no error handler. The card's list
> never populated on **warm navigation** to Setup with config already in hand;
> on a cold load `c` changes when config arrives and the watcher re-ran
> normally, which is why it survived — the path most people take, most of the
> time, worked.
>
> The part that matters for F5 is *why nobody noticed*. It was not that a broken
> card looked broken among eleven working ones. `{ preset: '', rungs: [] }` is
> **exactly what Setup shows a raffle that has not configured its rungs yet**,
> which is a real and common state — so there was no error, no blank hole, no
> anomaly of any kind, just a card truthfully reporting a state the raffle could
> be in. Twelve flat siblings removed the last cue, because a card at the same
> weight as eleven others gets *scanned* rather than *read*.
>
> P1's finding is that bad designs spread fixations evenly. This is what that
> costs when it is not merely slow: a flat stack does not just delay a search,
> it can hide a component that is not working at all. *(Analysis
> kcho-shelter-25's, cited with permission.)*
| **F6** | **Absence is handled everywhere but explained in one place.** Every list screen has an `<Empty>` — that part is done. Most carry one empty state for two causes, and P3's result is specifically about *searched-and-not-found*. | `Permissions.vue:250`, `Agents.vue:174`, `Approvals.vue:699`, `Money.vue:539` vs `Search.vue:425`, `Books.vue:134` | P3 +6.97 s; RU "don't overlook empty states" | S |

---

## 7. The programme

Ordered so that each phase makes the next one cheaper.

### Phase 0 — Declare the scales. Additive; nothing moves. **DONE**

*Landed 2026-09-23. `src/style.css`, `tests/scales.test.mjs`,
`tests/tokens.test.mjs`, `tests/run.sh`. Gate EXIT=0 across 135 suites, run from
a frozen archive of HEAD plus only these files — the worktree at the time also
held another session's in-flight `ticketart.js`, which fails `ranks`, and that
failure is theirs and not this work's.*

Thirty tokens added, every one set to a value already in the tree. **One real
bug was caught during the work and it is the reason the phase is worth
recording:** the first draft declared the elevation ladder in `:root` only.
`--elev-2` and `--elev-5` were bit-identical to `--shadow` and `--shadow-lg` in
light mode and served the *light* shadow in dark mode, where the originals flip
out from under them. `tokens.test.mjs` caught it — a shadow is `rgba`, which
makes it a colour wearing a dimension's name. `scales.test.mjs` now checks both
pairs in both themes, because an alias that holds in one theme and drifts in the
other is the half-bug that looks fixed.

**Why it would have survived**, which is the part worth keeping: the two tokens
were *bit-identical* in light mode — a genuine coincidence of values. Every
check that could run in one theme passed, and the defect lived entirely in the
theme nobody renders while working. It is also the argument for
`tokens.test.mjs` naming its exemptions rather than writing a rule like
"anything that is not a colour": such a rule waves through precisely the token
nobody thought to classify. *(Framing kcho-shelter-25's.)*

This is **the same lesson** as F5's watcher bug — the path that gets exercised
is not the path that breaks — and **a different mechanism**, which is worth
keeping separate. Here two values coincided, so the wrong one was never
rendered. There, the *same code* took a different number of runs: the cold path
worked because the watcher re-ran correctly *after* the throw. Merging them into
one story would lose both. *(Distinction kcho-shelter-25's, who checked.)*

The test's shape was rebuilt after a correction from **kcho-shelter-25**. It was
going to assert that Phase 0 *changed nothing*, which is an **absence**: it
passes identically against a Phase 0 never written, a `:root` that failed to
parse, and a file truncated at byte 400. Every block is now a positive identity
— two strings extracted from the tree and compared, with the number of
comparisons asserted before any comparison is made. Verified by mutation in five
directions: drift an alias in light, drift it in dark only, invent a scale value
that is nowhere in the tree, delete a token, break the parse.

Add tokens to `src/style.css` **without changing a single rendered value**. Every
new token is set to a value already in use. Nothing on screen moves, no
screenshot changes, and `footerfit` / `screenrender` / `cardlayout` cannot break
because nothing they measure has changed.

- **Type scale.** Hand-crafted, not modular (RU: modular scales give fractional
  values and the wrong gaps for UI work). In `rem`, anchored on the existing
  `1rem = 17px` base so the "readable at arm's length" decision is preserved.
  Roughly eight steps with ≥25% gaps at the small end, e.g. `--fs-xs` … `--fs-3xl`.
- **Weights.** Two, plus one for figures if the data face needs it. `550`, `650`
  and `850` retire into the nearest kept weight.
- **Spacing scale.** Base 4 at the bottom, widening: `4, 6, 8, 12, 16, 24, 32,
  48`. The five co-equal bases collapse into it. Note the ≥25% rule cannot be
  met below 8px and does not need to be — that is the end of the scale where a
  couple of pixels genuinely matters.
- **Radii.** Keep `--r` / `--r-sm` / `--r-ui`; add `--r-pill` so `50%`, `99px`
  and `999px` stop being three answers to one question.
- **Border widths.** One token for the hairline, one for the emphasis rule.
  `.5px` goes.
- **Elevation.** Five shadows named for height — resting, raised, dropdown,
  sheet, modal — replacing "pick a blur radius".

This phase is the one that makes the other five stop recurring. Nothing after it
should introduce a dimension that is not a token.

### Phase 1 — Two vocabularies for two surfaces, one per surface (F1) **DONE**

*Landed `1343354` by **ticket-studio-redesign**, 2026-09-22.
`DecorationInspector.vue` imports `FAMILIES` and gains the `why` line it never
had. Verified: the printed/digital split is preserved, and the commit carries
the caveat that it holds only while decorations are printed-only.*

**Outstanding from this phase:** `CardInspector.vue:66` still reads
`Serif`. The ruling is **Everyday / Figures** — handed to the Studio session
with F2, since it is the same file and the same control.

**Corrected from the first draft of this document, by the session working on the
Studio, and verified.** The printed/digital split is *intentional* and its
reason is written at `CardInspector.vue:54–60`: the printed side names the
**fonts**, because a print shop asks which font; the digital card names them for
what they are **for**, because nobody asks that of a picture sent on WhatsApp.
Unifying the two would delete a decision.

The defect is narrower: `DecorationInspector.vue:209–210` hard-codes a copy of
the *digital* words and uses them on the *printed* tab.

- `DecorationInspector` imports `FAMILIES` from `ticketelements.js`, the same as
  `Inspector` beside it in the same slot. One import, one `v-for`.
- On the digital side, `FACES` becomes **Everyday / Figures** rather than
  Everyday / Serif. "Serif" names the shape while "Everyday" names the use;
  Figures is faithful to that panel's own stated rationale and keeps one
  register. *(Chosen by the user, 2026-09-22.)*
- **Fonts are a correctness matter here.** `TEXT_FAMILY` in `ticketart.js` leads
  with `Padauk, "Noto Sans Myanmar", "Myanmar Text"`. Renaming a *label* must not
  touch the *chain*.
- Recorded for later: `withDecorations()` is spliced into `cardSVG`, so the
  digital card *can* render decorations, but neither caller passes a
  `decorations` key today. If one ever does, the surface question returns.

### Phase 2 — Show the typeface, and the template (F2, F3)

- **F2 — typeface options render in their own face**, one `style` binding per
  `<option>`. The `why` clause under the select **stays**: the picture answers
  "which one is this", the clause answers "when do I use it", and P3's
  absent-target result is that the *text* cue is the one that helps you
  correctly give up. Both, not either.

  **Reassigned to the Studio session**, who are restructuring all three
  inspectors and moving the selects themselves — doing F2 separately would mean
  merging a control that has changed address. The specification above is
  unchanged; only the hands are different. `CardInspector`'s
  `Serif` → `Figures` rides along, same file, same control.

- **F3 — a thumbnail of the active template in the header**, beside the existing
  `<select>` rather than replacing it, so the control stays keyboard-navigable.
  The header is already the upper-left, so this puts the answer to the question
  the header exists to answer directly in the Guess stage's landing zone.

  **Held until the Studio session lands.** `TicketDesign.vue` is theirs for the
  duration; two sessions in one file is what this repo keeps paying for. The one
  constraint passed to them is that the `<select>` at `:1990` survives their
  restructure in some form, because F3 adds to it rather than replacing it.

### Phase 3 — Setup, grouped (F5) **DONE**

*Landed `6913f1e`, 2026-09-23. Four groups, one card moved, nothing inside a card
touched. The destructive pair needed no restyling — both already carry a coloured
left edge and gate their red behind a preview, which is where a destructive
action's emphasis belongs. What was missing was only a heading saying they differ
in kind.*

**The first draft was wrong in a way only rendering found.** `.section` had a
`:first-of-type` case at 16px, reasoning that the `h1` above had already done the
separating. Adjacent margins collapse, so 16 against the heading row's 16 stayed
16 rather than summing to 32 — the first label got *half* the gap of the other
three and landed exactly where a subtitle goes, reading as a description of
"Setup". The markup, the tokens and 136 suites were all green with it in. This is
the case for §10's rule that a design change is not finished until somebody has
looked at it.

### Phase 3 — the original plan, for the record

Twelve cards become **four named groups**, grouped by P2's association objective
(eq. 21) and separated by Refactoring UI's spacing rule — more space around a
group than within it:

- **Numbering and tickets** — ticket numbering, tickets in play, make more. Set
  once, early, locked by the first ticket.
- **People and access** — who can sign in, who can do what, what supporters are
  called.
- **How this raffle presents itself** — how it looks, what the check page says,
  how people can reach you.
- **Records** — what people have been doing.
- **Danger**, set apart and visibly different — fill with sample data, reset.

Two rules for the implementation:

- **Group, do not hide.** §2's number governs: a collapsed section somebody is
  looking for costs seconds; an extra visible card costs 20 ms. Headings and
  spacing, not accordions. (Refactoring UI's one exception — hide supporting UI
  that *does nothing yet* — is about empty states, not about settings that work.)
- **Destructive does not mean big and red.** Refactoring UI is explicit: give
  the destructive action a secondary or tertiary treatment *here*, and put the
  red on the confirmation step where it genuinely is the primary action. That is
  also P2's frequency-weighted placement: prominence follows how often, not how
  severe.
- **Group the cards; do not edit inside them.** The regroup moves headings and
  spacing and nothing else. The moment it starts rewriting a card's internals it
  acquires the ability to undo other people's work by accident — and there is a
  live example: `Admin.vue`'s *Supporter titles* card and the Supporter card in
  `ticketart.js` were deliberately aligned by **kcho-shelter-25** to say the
  same thing in the same order, **the earned word first, the evidence quiet
  underneath**.

  **Half of that is pinned and half is deliberately not.** The *card* side
  cannot be undone by accident: flattening it in a scratch archive fails
  `cardlayout` (3, the golden `shelter` render is byte-for-byte) and `ranks`
  (1, the count stops sharing an x with the title and name) — two independent
  reasons, which is what you want. The *Setup* side has no test and should not
  get one: the only assertable facts there are a class name and a font weight,
  and a test anchored to a class name dies on the next tidy-up while teaching
  nothing, besides asserting an invariant the card already pins. So this note
  and the two files' comments *are* the mechanism. That is an argument for
  keeping the phase boundary exactly where it is, not for adding coverage.
  *(Both halves checked by kcho-shelter-25 rather than reasoned about.)*

### Phase 4 — Absence names its cause (F6) **DONE — and it mostly dissolved**

*Landed `9d29899`, 2026-09-23.*

**Five of the six sites were already correct**, each for its own reason, and
opening them was the whole value of the phase:

- `Agents.vue` and `Approvals.vue`'s pending list have no user filter feeding
  them, so "Nobody added yet" and "Nothing waiting" are true statements rather
  than generic ones.
- `Money.vue` handles the searched-empty case separately, at the point of
  search, with the cause named — it was already doing what this phase proposed.
- `Books.vue:134` names the filter in its title (`No books ${status}`).
- `Permissions.vue:250` is the *load-failure* branch and says so; the
  filtered-to-nothing case has its own branch beside it, written for exactly
  this reason.
- `ui/Filters.vue` **hides a chip that would filter to nothing** — "a chip that
  filters to nothing is a control that looks broken when pressed" — so the
  filtered-to-zero state is unreachable by construction.

**The one real gap was the opposite of an empty state: a cap nobody declared.**
`Approvals.vue` sliced its settled list to 25 rows with nothing saying so,
directly beneath chips carrying the *full* count per group. The chips said
sixty-three and the list gave twenty-five. `Search.vue` has already paid for
this exact shape and its comment records the fix. The cap stays — 25 is the
right default — but it is now stated, in the same words `Money` uses over a
capped list, so the two screens read as one product.

### Phase 4 — the original plan, for the record

Copy `Search.vue`'s two-branch pattern to the four screens with one branch: an
empty state must distinguish **"there are none"** from **"none match what you
asked for"**, and the second carries the way back. `Books.vue:134` already does
a version of it.

### Phase 5 — One word for "reveal the rest" (F4) **DONE — and F4 was wrong**

*Landed `9d29899`, 2026-09-23.*

**F4 said "seven labels for one command". It is two commands, and collapsing
them would have been a worse defect than the one filed.** P2's objective
demands consistency *in proportion to similarity*, with explicitly less penalty
for labelling dissimilar commands differently; this document had been reading it
as "same words everywhere", which is the half that makes interfaces worse.

The line is **whether the set is already known**:

| | | |
|---|---|---|
| known, hidden by a cap or a filter | **name it** | "Show every ticket / seller / setting / request" |
| not fetched yet | **cannot name it** | "Show" |

One pattern with a slot is what a volunteer learns once. Naming a set you have
not loaded is a promise the screen cannot keep.

`Draw.vue` was making exactly that promise, and worse: *"Show them"* sat beside
a heading that flips to *"Every sold ticket has a name and a phone number"*,
offering to fetch a list the stat directly above reports as **zero**. It is now
**disabled with the reason, not hidden** — `permissionui`'s shape for
`permissionui`'s reason: a screen that changes shape between a healthy raffle
and a faulty one teaches the reader that the control does not exist.

`SellTicket.vue`'s pair was left alone; it is a mode switch, not this command.

### Phase 5 — the original plan, for the record

Seven sites, one word. `SellTicket.vue:228/255` is genuinely a different control
— a mode switch between "all at once" and "one at a time" — and keeps its pair.
The remaining five converge.

*Briefly held for a shared `ui/Explain.vue`; that component is not being built,
so F4 is independent and picks its own word. The reason it was dropped belongs
in §9 — see **visible and smaller, not hidden**.*

The verb is worth stating precisely, because it is what keeps F4 separate from
that abandoned work: these five controls **reveal data rows somebody is looking
for**, and a row that is not on screen genuinely cannot be read. That is P3's
absent-target case. An explanation that is merely quiet is already on screen and
is a different problem.

### Phase 6 — Migrate to the scales, file by file

Not a sweep. Each file that any phase above touches gets its literals replaced
with Phase 0's tokens *while it is already open*, and the nearest-scale-value
rule from Malewicz's audit decides each substitution. A `.82rem` becomes the
adjacent scale step; a `13px` gap becomes `12px`.

Two constraints, because this is the phase that can break things:

- **`footerfit`, `screenrender` and `cardlayout` measure rendered layout.** Any
  file whose sizes actually change needs the gate run from a frozen archive of
  the commit, not from the worktree.
- **The printed ticket is not chrome.** `ticketart.js` places SVG text by
  baseline against a reference artwork in the design JSON. Those are coordinates,
  not CSS, and they are out of scope — `tests/ticketart.test.mjs` owns them.

---

## 8. The gates

This repo's native form for a settled design decision is a test in
`tests/run.sh` that blocks the Pages deploy — `permissionui`, `rolewords`,
`i18n`, `tokens`, `footerfit`, `noundef`, `cardlayout` all work this way. The
lasting value of these five sources is not six fixes; it is that several of
their rules are **computable**, and so can be made permanent.

Each is proposed with the finding it would have caught, because a rule with no
demonstrated catch is the validity failure P2 names.

### `scales.test.mjs` — RU "systematize everything", DU's audit method

**Asserts:** no `font-size`, `margin`, `padding`, `gap`, `border-radius` or
`border-width` literal in `src/components/` that is not a token or an explicitly
listed exception.

This is the only gate that fixes Tier 1 permanently. It is also the one that
must ship **with** Phase 0 and an allow-list of everything currently in the tree,
shrinking as Phase 6 proceeds — a gate that fails on day one gets disabled on
day two. `tokens.test.mjs` is the precedent: it asserts every `var()` name used
exists, and this is its dimensional twin.

### `labelconsistency.test.mjs` — P2, eq. (13)/(14)

**Asserts:** where two call sites offer a choice over the same set of ids, the
label for a given id is identical.

Would have caught **F1** the moment the inline copy was written, and nothing
else would. It generalises `rolewords`, which pins one vocabulary by hand.

Start narrow — the typeface lists, `STATUS_WORDS`, `BOOK_WORDS` — and let it
grow. A broad version inferring "the same command" from button text will produce
false positives and be disabled within a week.

**It must assert its enumeration found something.** A consistency test that
discovers zero vocabulary pairs passes silently and forever.

### `imagecue.test.mjs` — P3, +1.28–1.45 s

**Asserts:** a control that chooses among *visually distinguishable* things
renders the thing, not only its name.

The set is enumerable and small: typefaces, templates, saved shapes, decoration
kinds, colours, ticket sizes. Would have caught **F2** and **F3**; would *pass*
`TemplateRail`, `LibraryPanel` and the Draw rail — which is the point. It
encodes what this repo already does well so the next panel does it too.

### `absence.test.mjs` — P3, +6.97 s

**Asserts:** every screen rendering a collection has a branch for the empty case,
and that branch names a cause.

The weaker half the app already passes. The valuable half is the second: a
branch whose only content is "Nothing to show" is what both books name as a
failure and what P3 prices at seven seconds. Would have caught **F6**. Same
enumeration guard.

### `reachableclass.test.mjs` — found the hard way, 2026-09-23

**Asserts:** every class a component's markup carries resolves to a rule that
can actually reach it.

`Money.vue`'s two tertiary buttons carried `class="linkish"`. The rule was
written `.statement .linkish`, in `Money.vue`'s own scoped block, and
`class="statement"` appears **nowhere in `Money.vue`** — it is on a table inside
`SellerMoney.vue`. The selector had never matched its own markup, so both
controls rendered as default browser buttons: bordered grey chips in a money
column, which is word for word what the comment above that rule said it existed
to prevent.

**Nothing could see it.** The markup names a class, the stylesheet defines one,
and neither is malformed — so there is no error, no warning, no failing
assertion. It is the same shape as `Admin.vue`'s note about `.mono` ("a class
that silently styled nothing"), and the same shape as the `--line` bug
`tokens.test.mjs` was written for — **which is worth stating correctly, because
the short version of it is backwards.** `--line` was *retired* when the verify
page's palette was unified, so `var(--line, rgba(0,0,0,.1))` resolved to its
fallback *every single time*: a hairline visible in light mode and invisible in
dark. The fallback there is not a safety net, **it is the bug**, because it is
what makes a dead token look alive. *(Caught by kcho-shelter-25, who opened
`verify.css:600` instead of trusting my paraphrase of it.)*

This repo has now been bitten by *a name that resolves to nothing* three times
in three languages: a CSS custom property, a CSS class, and an undefined Vue
component (`noundef`). Each was invisible for the same reason — the code reads
as though the case is handled.

The narrow, cheap version is the one to build: for each component, every class
in its template either matches a selector in its own `<style>` that its markup
can satisfy, or exists in `style.css`, or is on the known-global list. A full
CSS resolver is not needed to catch a descendant selector whose ancestor is
absent from the same file.

### Considered and not proposed: a grid-alignment gate

P2's grid-line-count objective is genuinely computable and is the one objective
among the five sources this repo has no equivalent of. It needs real layout — a
headless browser measuring element edges and counting distinct intercepts —
which is a different kind of test from everything in `tests/run.sh` today, and
P3 prices grid complexity as the *smallest* significant coefficient in its
table. Worth building the day the suite gains a layout harness; not worth
building one for this.

---

## 9. The doctrine, for components not yet written

Three rules from P3's stages, and one from P1.

**Guess — the upper-left answers "where am I, and what am I looking at".** First
fixations go there *regardless of where the target is*. That space is not free
real estate for a title; it is the only region guaranteed to be read. The
sidebar already spends it correctly; the Studio header is the next place to
check (§7.2).

**Scan — structure is what the scan prunes by, and it follows the long axis.**
Mobile is scanned vertically, desktop horizontally. This is the evidence under
`--tap` and `.dense` being two design problems rather than one with a
breakpoint. The existing split is right; this is why.

**Confirm — the confirmation belongs at the target.** Late fixations cluster
back in the target's quadrant. A result found in a list and confirmed by a panel
across the screen makes the eye pay the journey twice. `Search.vue`'s row-level
controls — history, ask-for-book, status pill, all on the row — already follow
this.

**Visible and smaller, not hidden.** A ruling from the user, 2026-09-23, given
to the Studio session and general enough to sit here: *"helper text must be
visible and smaller, not competing for attention with tools icons."* It killed a
plan to move 51 explanatory sentences behind ⓘ affordances — hiding prose behind
a click satisfies "not competing" by *deleting it from the screen*, which is not
what was asked and is the wrong side of §2's number. Prose gets **shorter and
quieter in place**. The lever for de-emphasis is weight, size and colour, never
removal; Refactoring UI's "emphasize by de-emphasizing" is the same instrument,
and it never reaches for a click.

**And the uncomfortable one.** P1's bad set sits in **low** valence and **low**
arousal — flat, not ugly — and its discriminating signal is whether fixations
*concentrate*. An interface committed to restraint can fail exactly this way,
and restraint is this product's aesthetic. The defence is not decoration; it is
that *something* on every screen is allowed to be large, singular and
unmistakable. On `Home` that is the progress banner; on `Money` the balance; on
`Search` the field. On `Admin` there is nothing, which is F5.

Refactoring UI's test still governs and is compatible: would it look intentional
with every gradient, shadow and animation stripped out? A screen that passes
that *and* has a focal point is in the high-valence quadrant.

---

## 10. Limits, corrections, and findings withdrawn

**How far the numbers transfer.** P3's participants searched for a *cued target
in a screenshot*; our users work from memory and intent, and the paper's own
limitations section flags the artificiality of pattern-matching and the young
student sample. P1's participants free-viewed screenshots for 10 s and never
clicked anything. The absolute seconds are used here as **ranking evidence** —
the ordering of the coefficients drives §7, not a claim that a missing item
costs a KCHO organiser 6.97 seconds. P2 is a survey of formalisms, not an
experiment; nothing is taken from it but the shape of its objective functions.
The books are practitioner craft, not measurement — which is exactly why §3 only
promotes a rule to a gate when a paper prices it.

**Corrected by review.** F1 originally read "two typefaces, three vocabularies —
unify to one". The session working on the Studio pointed out that the
printed/digital split is deliberate and documented, and that unifying would
delete a decision. Verified at `CardInspector.vue:54–60`; F1 rewritten. Their
stated reason — that decorations render on both surfaces, so the fix depends on
which — did **not** hold: `withDecorations` is wired into `cardSVG`, but neither
`ViewTicket.vue:568` nor `DigitalTab.vue:119` passes a `decorations` key, and
`DecorationInspector` is rendered at exactly one place, inside
`v-if="tab === 'place'"`. The fix is therefore unambiguous, which is noted in
§7.1.

**Withdrawn after opening the file** — recorded so they are not re-found:

1. *"Hard-coded hexes in `TicketDesign.vue` and `BookGrid.vue` will not follow
   dark mode."* False. Both are documented decisions — see §5.
2. *"`Empty` is imported in only 6 of ~60 components, so absence is unhandled."*
   Overstated. Every list *screen* has one; the real finding is the much
   narrower F6.
3. *"`LibraryPanel` has lists and no empty state."* False — built-ins mean the
   collection is never empty, so there is nothing to state.
4. *"`Admin`'s users table renders headers over nothing when empty."* True in
   the template, unreachable in practice: you are signed in, so there is a user.

Each would have been a plausible line in a findings table, and each dissolves on
opening the file.

**Deliberately not touching:** `--tap: 52px` and the 17px base (P3 measured
mobile as the *fastest* to search, which supports the phone-first stance); the
Studio's desktop-only gate, a settled ruling; the `.dense` split, which §9
explains rather than changes; and the printed artwork's geometry, which is
governed by `ticketart.test.mjs`.

---

## 11. What is being asked

Nothing in §7 is started. Phase 0 is new since the first draft of this document
and changes the shape of the work: it is additive, invisible, and it is what
stops Tier 1 from recurring. Phases 1–5 were approved on the earlier draft; the
question now is only where Phase 0 and the `scales` gate sit in the order.
