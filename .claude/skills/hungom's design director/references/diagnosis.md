# The tells, and how to detect them

Read during Step 2 of the diagnosis (§3 of the skill). Run from the repo root.

These are detection recipes, not bans. A hit is a *question to answer*, not a
verdict — every pattern here is correct somewhere. What makes an interface read
as machine-made is not the pattern itself but the pattern applied uniformly,
because uniformity is what you get when no decision was made. Your job is to
find where a decision is missing and say so with a file and a line.

**Static counts describe the file, not the screen.** A template is not what
renders: `v-if` chains, role guards and elements that merely *depict* a control
all inflate a grep. Every number here is a place to look, never a finding on its
own — open the file and confirm what a user actually sees before writing it
down. A finding that dissolves when someone opens the file costs more trust than
the twenty minutes it saved.

Work through these, then write the findings table.

---

## 1. One container rhythm everywhere

The strongest tell, and the hardest to see one screen at a time. Generated UI
converges on HEADING → blurb → row of cards → table, repeated down every page
and across every page.

```bash
# cards per screen — a high count on one screen means no hierarchy within it
for f in src/components/*.vue; do
  n=$(grep -c 'class="card' "$f"); [ "$n" -gt 0 ] && echo "$n  ${f##*/}"
done | sort -rn

# the rhythm itself: screens where a card follows a heading within 5 lines
for f in src/components/*.vue src/components/modals/*.vue; do
  awk '/<h[23]/{h=NR} /class="card/{if(h&&NR-h<6){print FILENAME; exit}}' "$f"
done
```

(Written with `awk` rather than a multiline `grep` on purpose — multiline
matching needs flags that are not portable across the greps you may be handed.)

Ask: does this information actually form a contained unit, or is the card just
the default wrapper? A ledger, a timeline, a status strip, a plain table or a
split view often carries the same content with more meaning. When four screens
share a rhythm, at least two of them are being forced into it.

## 2. Values that duplicate a token

A hard-coded colour will not follow dark mode — `style.css` redefines every
token under the dark block, and a literal hex simply stays put. This is a
correctness bug wearing an aesthetic disguise.

```bash
grep -rn -E '#[0-9a-fA-F]{3,8}\b' src/components/ | grep -v 'style.css'
grep -rn -E 'border-radius:\s*[0-9]' src/components/
grep -rn -E 'box-shadow:\s*[0-9]' src/components/
grep -rn -E '(min-height|height):\s*(4[0-9]|5[0-9])px' src/components/   # vs --tap
```

Every hit is either a missing token or a one-off that should use an existing
one. If the value is genuinely new, add a named token; if it duplicates
`--brand`, `--border`, `--r`, `--tap`, replace it.

## 3. Every action is a primary button

When all actions look equally important, none is. Real screens have one action
somebody came to do, a few they might, and some they rarely need.

**Learn the vocabulary before you count.** Every codebase names its filled
button differently, and guessing produces a confident wrong number. Here, bare
`.btn` is *outlined* and `.btn.primary` is the filled one — so counting "`.btn`
that isn't ghost" overstates the problem by nearly three times.

```bash
grep -n -E '^\.btn' src/style.css        # what the variants actually are
grep -rhoE 'class="btn[^"]*"' src/components/ | sort | uniq -c | sort -rn
```

**Then count per rendering state, not per file.** This is where a naive count
goes wrong, and it goes wrong in the direction of inventing work:

```bash
# files with 2+ filled buttons — a QUESTION, not a finding
for f in src/components/*.vue src/components/modals/*.vue; do
  n=$(grep -c 'class="btn[^"]*primary' "$f"); [ "$n" -ge 2 ] && echo "$n  $f"
done | sort -rn
```

Before any of those becomes a finding, open it and check three things:

1. **Are they mutually exclusive?** A `v-if` / `v-else-if` chain renders exactly
   one. A screen with five filled buttons across five states has *one* per
   state, which is correct — and is what good state-dependent design looks
   like, not a defect.
2. **Is it a control at all?** A `<span class="btn primary">` may be a preview
   swatch, a legend key, or a sample. It is styled like a button because it is
   *depicting* one.
3. **Are they in the same view?** Separate cards on a settings page each get
   their own primary. Two primaries competing inside one card is the finding;
   two on a page in different sections usually is not.

The real signal is **two filled buttons a user can see and press at the same
moment**, with nothing saying which one the screen is for. That is what you
must be able to assert before writing it down.

## 4. Copy that restates itself

Generated interfaces explain every label, because writing a sentence is cheaper
than deciding whether the label was clear. The result is a page nobody reads and
a screen that scrolls.

Look for: a description under a heading that repeats the heading; helper text
under a field that restates its label; an empty state that says only "No data
yet"; a tooltip identical to the visible text.

```bash
grep -rn -E 'class="(muted|hint|help|small|tiny)"' src/components/ | wc -l
```

Ask of each: would somebody be lost without this sentence? If not, cut it. If
yes, the label is probably wrong — fix that instead. (An empty state is the one
place worth *more* words: say what would put something here and how.)

## 5. Uniform spacing

Human layouts have rhythm — related things closer, sections further apart.
Generated layouts use one margin everywhere, which reads as flat and makes
grouping invisible.

```bash
grep -rhoE '(margin|padding|gap)[^:]*:\s*[0-9]+px' src/components/ \
  | grep -oE '[0-9]+px' | sort | uniq -c | sort -rn
```

One value dominating the distribution means spacing is not expressing
relationships. Proximity is the cheapest grouping tool there is, and it is free.

## 6. Emoji standing in for icons

Emoji render differently per platform, break alignment, carry tone the product
may not want, and read as a placeholder nobody replaced. The repo has
`ui/Icon.vue`.

```bash
perl -CSD -ne 'print "$ARGV:$.: $_" if /[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}]/;
  close ARGV if eof' src/components/*.vue src/components/*/*.vue
```

(`close ARGV if eof` resets the line counter per file — without it every line
number after the first file is wrong, which makes the finding unciteable.)

Decorative emoji in an `Empty` state is a smaller problem than an emoji doing
the work of a control: `art="👥"` is a placeholder, but an emoji *as* a button
label is an unlabelled control that reads differently on every platform.

## 7. Generic names

"Overview", "Management", "Details", "Dashboard", "Settings" are the names you
choose when you have not decided what a screen is for. This product has real
words — books, custody, settle, return, reconcile, draw.

```bash
grep -rniE '>(Overview|Management|Details|Dashboard|Information|Actions)<' src/components/
```

Navigation should mirror the workflow, not a SaaS template. A section named for
a real operation tells the user what happens there.

## 8. Badges on everything

When every value gets a coloured pill, colour stops carrying meaning and the
page turns into confetti. Status colour should be reserved for genuine state —
and for a state somebody must act on.

```bash
grep -rn 'StatusPill\|class="pill\|class="badge\|class="tag' src/components/ | wc -l
grep -rn 'StatusPill\|class="pill\|class="badge' src/components/ \
  | sed 's|:.*||' | sort | uniq -c | sort -rn | head
```

Ask: does this state change what the person does next? If not, plain text.

## 9. Numbers set as prose

See §7 of the skill. Money that does not align on the digit reads as an
estimate, and this product asks people to trust it with collected cash.

```bash
grep -rn 'tabular-nums\|font-variant-numeric' src/ | wc -l   # expect > 0
grep -rn -E 'text-align:\s*right' src/ | wc -l
```

Zero hits for tabular figures on a product full of money columns is a finding on
its own.

## 10. The mobile layout is the desktop one, stacked

Sellers work on phones, standing up, one-handed, outdoors. A layout that only
reflows is not a designed layout — the priorities change on a phone, not just
the widths.

```bash
grep -rn '@media' src/style.css src/components/ | wc -l
```

Then actually look: use the `browser-automation` skill at phone width and read
what rendered. Check that the action a seller needs is reachable with a thumb
and still `--tap` sized.

---

## Turning hits into findings

A finding names the pattern, points at the evidence, says why it reads as
machine-made, and implies a fix:

> **Every config group on `TicketDesign.vue` is a `.card`** (10 of them,
> `src/components/TicketDesign.vue`). The page is a stack of visual equals, so
> nothing signals that artwork upload is the thing you do once and number
> placement is the thing you return to. Group them, or let the rarely-used
> sections collapse.

Compare with "the ticket design page feels generic", which cannot be acted on,
cannot be verified afterwards, and does not survive being disagreed with.
