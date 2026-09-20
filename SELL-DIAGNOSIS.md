# Chapters 4 and 6, inspected before anything is changed

Piece A of the mockup rollout: cards **6a** (list + docked ticket panel), **6b**
(a sold ticket), **4c** (write down sales) and **4h** (approvals).

Written because `.claude/skills/hungom's design director` gates UI work on a
diagnosis, and it is right to: a four-screen diff assembled from card
descriptions is one nobody can review in a single pass, and every part of it
would have to be defended separately afterwards. This lists what each card
actually asks for against what the code already does, so that each change
points at a finding and everything not in the findings stays untouched.

**4h is blocked and is not diagnosed here.** It depends on `ui/Filters.vue`,
which is untracked — on disk, in no commit. Building against it would put an
import of a non-existent file into the tree: green in this worktree, red from
`git archive`, which is exactly what happened to `2276135` this morning.

---

## What is working, and must not be rebuilt

This section is not a courtesy. Three of these were written to avoid specific
bugs and say so in their own headers; rebuilding them from a card description
would quietly delete the reasoning and re-earn the bug.

- **`ui/DeskStock.vue` is card 4c, already built.** The grid of serials, the
  pager at exactly 24 a page, "to sell in N books", "another N tickets are out
  with sellers", "N books have not gone out yet" — all of it, at
  `DeskStock.vue:82-116`. Its header (lines 12-24) records two rules it exists
  to honour: what it offers is derived from `sellBlock`, *the same function the
  sale path calls*, so a number can never be offered here and refused there;
  and tickets out with sellers are **counted but never offered**, named
  separately rather than folded into one "available" figure meaning two things.
  It also does something the card does not ask for and should keep — it names
  the free book *runs*, which is the answer an organiser is actually given on
  the phone.

- **`Sell.vue:278-287` is 4c's "One ticket" panel, verbatim.** Same heading,
  same `e.g. 721` placeholder, same Open button, same "Just the last few
  numbers is enough". There is nothing to do here.

- **`SellTicket.vue:260-312` is most of 6b.** "Written down by" with a `Who`
  chip (`:290`), the fix block with "What are you fixing? *" (`:308`), the
  `e.g. phone number was wrong` placeholder (`:309`) and "This is kept in the
  record so everyone can see what changed" (`:310`). The card describes this
  panel almost word for word.

- **`Search.vue`'s three-controls-per-row architecture** (`:230`, `:247`,
  `:254`). Open, "where it has been", and "ask for the book" are separate
  controls with separate labels, because a row that does several things from
  one tap eventually does the wrong one. A dock must not collapse them back
  into one click target.

- **`modals/History.vue`'s permission-aware trail.** A step whose buyer this
  reader may not see still appears, saying a detail is withheld — because
  silent gaps read as nothing having happened. Any inlining keeps that.

---

## What the cards genuinely add

| # | Card | What is actually missing | Where | Cost |
|---|---|---|---|---|
| 1 | 4c | the three numbers are a panel subtitle, not a stated header | `DeskStock.vue:86-93` | small |
| 2 | 4c | "in N books" disappears entirely when nothing is sellable | `DeskStock.vue:87-92` | small |
| 3 | 6b | the trail is a separate modal stacked on top, not a section | `SellTicket.vue:293` | medium |
| 4 | 6a | no dock exists; one modal slot at App level serves every screen | `App.vue:479,507` | large |
| 5 | 6a | the keyboard line would be a lie as drawn | — | large |

### The weakest three, in order

1. **6a's selection ownership.** Everything else in that card — what Enter
   opens, what survives a re-query, what the dock shows after a delta — is
   downstream of one decision that has not been made. Answering it is the
   card; drawing a panel before answering it is decoration over a guess.
2. **6b's fetch.** A sold ticket currently opens with no network at all. The
   trail costs an `api('book_history')` round trip, and inlining it puts that
   in front of *every* open — in a hall, on a phone, on bad signal. Worth
   doing, but the failure and loading states are the work, not the markup.
3. **4c's header.** Genuinely small and purely presentational, and the only
   one of the three that is.

---

## 6a: the shape, which is the deliverable

Stated as facts about this code rather than as a plan, because the honest
answer to this card may be "here is what a dock costs" rather than a dock.

**Selection lives in one slot, at the top.** Every screen emits `open`;
`App.vue:479` turns that into `openModal('ticket', t)`; `App.vue:507` renders
`SellTicket` as a `Sheet`. There is one `modal` object, `{kind, payload}`, for
tickets, books and sellers alike. A dock on Find is therefore not a new
component — it is a second presentation of a state another file owns, and the
two must not disagree about what is selected.

**A held ticket reference stays live — I checked, and this is cheaper than it
looks.** `loadDelta` merges with `Object.assign(existing, t)` (`store.js:648`),
and `reindex()` remaps the *same* objects (`:741`). So a dock holding a ticket
object keeps updating across polls and does not go stale. The dock does not
need to hold a number and re-look-it-up, which was the expensive version of
this card.

**The dock cannot be the only presentation.** `.dense` is gated at
`min-width: 1024px`, and Find on a phone must stay a sheet — a seller standing
up with a book of tickets is the other user of this screen. So one selection,
two presentations, and the phone one already exists.

**The keyboard line is the real work.** "↑↓ to move · Enter to open · S to
sell" printed in a header is a promise. Shipping the string without roving
focus and a live region gives a keyboard user a screen that describes
affordances it does not have, which is worse than a screen that stays quiet.
Three specific problems the card does not answer:

- **↓ at the bottom of a page.** `Search.vue` pages at 25 (`:133`) and resets
  to page 1 whenever the query or a filter changes (`:140`). Does ↓ on row 25
  turn the page, or stop? Either is defensible; silence is not.
- **The list animates.** Results are a `TransitionGroup` keyed by ticket
  number (`:228`). Roving focus across a list that is re-ordering under the
  pointer needs the focused key tracked, not an index.
- **`S` on a ticket that cannot be sold.** `permissionui` requires a control
  you cannot use to be *disabled with the reason in its `title`*, never
  hidden. A keyboard shortcut has no title to carry a reason. So `S` on a
  blocked ticket must say why out loud — via the live region — or the rule is
  satisfied on the mouse path and broken on the keyboard one.

---

## Not building, and why

- **A second source for 4c's numbers.** They are custody's:
  `sellBlock(ticket) = bookBlock(whereIs(ticket))` (`store.js:223-225`).
  Re-deriving "still to sell" from the tickets table alone disagrees with the
  chase list the moment a book is part-sold — `money-has-two-doors`. The header
  reuses `DeskStock`'s existing computeds or it does not ship.
- **4c's header on a seller's screen.** Those three numbers describe the
  office. `DeskStock` already renders only for `isDesk` (`:40-43`), so the
  header belongs inside it, not on `Sell.vue` where a seller would read a
  count of stock that is not theirs.
- **`.dense` on chapter 4.** Sell is a field screen. `--tap: 52px` is a
  correctness constraint there, not a comfort one.

---

## What binds each change

`screenrender` and `noundef` for anything new rendered; `emits` for a changed
event contract — 6a changes one; `permissionui` for the `S` shortcut and any
dock action; `i18n` for every new `<Bi text="…">`, and note a **bound** `:text`
escapes the scan entirely, so a dock's tab labels need Burmese added by hand;
`soldlock`, `whereis` and `buyerreach` for anything touching what a sold ticket
shows and to whom; `footerfit` for the dock at phone width.

Gate from `git archive` of the commit, never from this worktree — several
sessions have uncommitted work in it.
