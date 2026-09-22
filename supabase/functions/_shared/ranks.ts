/*
 * WHAT TO CALL SOMEBODY WHO HAS BOUGHT A LOT OF TICKETS.
 *
 * A shout-out, and it has to be earned by something the raffle can prove. The
 * band is worked out from the tickets a buyer actually holds — nothing is typed
 * in, nothing is awarded by hand, and there is no screen anywhere that sets a
 * rank. That is the whole reason it can be printed on a card somebody is sent
 * and stated again on a page anybody can scan: both readings come from the same
 * rows, so the second one is a check rather than an echo.
 *
 * THE LADDER IS IN BOOKS, NOT TICKETS, and that is a decision rather than a
 * convenience. A book is the unit this raffle hands out, reconciles and talks
 * about; "five books" is a sentence an organiser already uses about a person.
 * Tickets per book is a setting, so the same ladder means the same thing
 * whether a book holds ten tickets or five.
 *
 * THE BOUNDARIES ARE CLOSED. The ladder first arrived described as spans —
 * "Gold 5-10 books, Diamond 10+, Silver 1-3" — which put ten books in two bands
 * and four books in none. Overlaps and holes are the same defect, a value with
 * no single answer, so the rungs are THRESHOLDS: highest first, first match
 * wins, every count above zero in exactly one band. tests/ranks walks every
 * boundary of every preset.
 */

/*
 * THE WORDS ARE THE ORGANISER'S, AND THAT IS THE POINT OF THIS FILE'S SHAPE.
 *
 * A raffle here is an instrument rather than an event. The same app runs one
 * for a community centre, one for a refugee learning centre, one for a
 * fellowship, one for a shelter housing refugee patients with chronic and
 * mental health conditions, and one for whatever small community cause comes
 * next. What a supporter should be CALLED is not the same question in those
 * five rooms, and no list written here could be right in all of them.
 *
 * So the rungs are configuration. This file holds the PRESETS an organiser can
 * start from and the shape every ladder has to have; the names and thresholds
 * a particular raffle uses live in the SUPPORTER_BANDS config row, and the
 * organiser edits them.
 *
 * WHAT DOES NOT MOVE, because it is what makes the band checkable rather than
 * a compliment: the band is still COUNTED. An organiser chooses what to call
 * five books. Nobody chooses who has five books.
 */

/*
 * FIVE SLOTS, AND THE IDS ARE POSITIONS RATHER THAN WORDS.
 *
 * Every earlier version of this ladder keyed on the word — `gold`, `bronze`,
 * `family` — which worked while the words were written here and breaks the
 * moment they are typed in by somebody running a raffle. A colour token called
 * `--band-gold` holding the colour of something called "Encourager" is the
 * defect this repository already has a memory of, one level up.
 *
 * So the id says WHERE on the ladder, and the name says what this raffle calls
 * it. The stylesheet, the stored column and the check page all key on the
 * position; only the name is anybody's to change.
 */
export const SLOTS = ['rung1', 'rung2', 'rung3', 'rung4', 'rung5'] as const

export type Rung = { id: string; name: string; minBooks: number }
export type Rank = { id: string; name: string; books: number; tickets: number }

/*
 * WHERE THE RUNGS SIT BY DEFAULT, in books, bottom to top.
 *
 * 0 is deliberate and is not "no books". It is the rung for somebody who has
 * bought tickets but not yet a whole book, and it exists because that is most
 * buyers: a ladder whose bottom rung is one book says nothing at all to the
 * person who bought three tickets, and that person is the one the raffle most
 * wants to thank.
 *
 * At the raffle's own defaults — ten tickets to a book, RM 10 a ticket — the
 * five rungs are RM 10, RM 100, RM 200, RM 300 and RM 500. An earlier ladder
 * put its top at ten books, RM 1,000 from one buyer, which is a rung nobody
 * stood on; a ladder whose upper rungs are unreachable thanks everybody at the
 * bottom.
 */
export const DEFAULT_BOOKS = [0, 1, 2, 3, 5]

/*
 * THE PRESETS, WHICH ARE THE ORGANISER'S OWN WORDS AND NOT A RECOMMENDATION.
 *
 * Supplied by the people running these raffles, one column per kind of
 * fundraising, and reproduced here as given. A later reader will notice that
 * some of them — Patron, Champion, Guardian — are words this file argued
 * against when it was choosing a single fixed ladder, on the grounds that
 * patronage and rescue both put the ticket-buyer above the people served.
 * That argument was about imposing ONE vocabulary on every raffle. These are
 * chosen per raffle by the people whose community it is, which is a different
 * thing entirely and is the reason this is configuration. Do not "correct"
 * them.
 *
 * Bottom to top, five names each, matching DEFAULT_BOOKS.
 */
export const PRESETS = [
  {
    id: 'community',
    name: 'Community centre',
    rungs: ['Well-wisher', 'Friend', 'Neighbour', 'Builder', 'Pillar'],
  },
  {
    id: 'shelter',
    name: 'Shelter',
    rungs: ['Well-wisher', 'Friend', 'Neighbour', 'Keeper', 'Guardian'],
  },
  {
    id: 'learning',
    name: 'Learning centre',
    rungs: ['Friend', 'Supporter', 'Mentor', 'Patron', 'Champion'],
  },
  {
    id: 'fellowship',
    name: 'Christian fellowship',
    rungs: ['Friend', 'Blessing', 'Encourager', 'Servant', 'Cornerstone'],
  },
]

/*
 * COMMUNITY CENTRE IS THE DEFAULT because it is the broadest room. A raffle is
 * sold across all of them — the same ticket reaches a family at the learning
 * centre and somebody at the fellowship — so the preset that ships is the one
 * whose words are true in every room, and an organiser running a raffle FOR
 * one of the others changes it in one click.
 */
export const DEFAULT_PRESET = 'community'

export function presetById(id: unknown) {
  return PRESETS.find((p) => p.id === String(id ?? '')) || PRESETS[0]
}

/** A preset, as a ladder: highest first, which is the order everything reads. */
export function ladderOf(presetId: unknown, books: number[] = DEFAULT_BOOKS): Rung[] {
  const preset = presetById(presetId)
  return preset.rungs
    .map((name, i) => ({ id: SLOTS[i], name, minBooks: Number(books[i] ?? DEFAULT_BOOKS[i]) }))
    .reverse()
}

/** What a raffle gets before anybody has chosen anything. */
export const RANKS: Rung[] = ladderOf(DEFAULT_PRESET)
export const RANK_IDS = RANKS.map((r) => r.id)

/*
 * A STORED LADDER, OR THE DEFAULT — AND IT CANNOT THROW.
 *
 * This runs inside a screen that is drawing somebody's ticket and inside the
 * function answering a stranger's scan. A raffle whose config row is somehow
 * unreadable gets the default ladder and a working page, never an exception.
 * Same rule as `parseLayout` in config.ts, and for the same reason.
 *
 * VALIDATED AS A LADDER, not merely as JSON. The one property everything else
 * depends on is that the thresholds DESCEND — `rankFor` takes the first match,
 * so a rung whose threshold is not strictly below the one above it can never
 * be returned, and it would be listed, named, and silently unreachable. A
 * stored ladder that does not descend is refused whole rather than patched,
 * because half a ladder is worse than the default one.
 */
export function ladderFrom(stored: unknown): Rung[] {
  const raw = Array.isArray(stored)
    ? stored
    : (stored && typeof stored === 'object' && Array.isArray((stored as { rungs?: unknown }).rungs)
        ? (stored as { rungs: unknown[] }).rungs
        : null)
  if (!raw || raw.length !== SLOTS.length) return RANKS

  const out: Rung[] = []
  for (let i = 0; i < SLOTS.length; i++) {
    const r = raw[i] as { name?: unknown; minBooks?: unknown } | null
    if (!r || typeof r !== 'object') return RANKS
    const name = String(r.name ?? '').trim()
    const minBooks = Number(r.minBooks)
    if (!name) return RANKS
    if (!Number.isFinite(minBooks) || minBooks < 0 || minBooks !== Math.floor(minBooks)) return RANKS
    out.push({ id: SLOTS[i], name, minBooks })
  }
  // Bottom to top as stored, so each threshold must be strictly above the last.
  for (let i = 1; i < out.length; i++) {
    if (out[i].minBooks <= out[i - 1].minBooks) return RANKS
  }
  return out.reverse()
}

/** Whole books held, which is what the rungs are measured in. */
export function booksHeld(tickets: number, perBook: number): number {
  return Math.floor(tickets / perBook)
}

/*
 * The one function. Returns null rather than a band whenever it cannot work one
 * out, and the two cases it refuses are both cases where a wrong answer would
 * be worse than none:
 *
 *   NO TICKETS. Nobody is a supporter of nothing, and a card with a rank line
 *   reading "Friend · 0 tickets" is a sentence about an absence.
 *
 *   NO BOOK SIZE. Without tickets-per-book there is no way to turn a count into
 *   books, and the tempting fallback — give them the bottom rung and move on —
 *   would put "Well-wisher" on a card belonging to somebody holding two hundred
 *   tickets. Silence is recoverable; a demotion printed on a ticket is not.
 *   This is the shape this repository has been caught by before: a default
 *   that quietly admits the case nobody thought about.
 */
export function rankFor(tickets: unknown, perBook: unknown, ladder: Rung[] = RANKS): Rank | null {
  const n = Number(tickets)
  const per = Number(perBook)
  if (!Number.isFinite(n) || n < 1) return null
  if (!Number.isFinite(per) || per < 1) return null

  const books = booksHeld(n, per)
  const rungs = Array.isArray(ladder) && ladder.length ? ladder : RANKS
  const band = rungs.find((r) => books >= r.minBooks)
  if (!band) return null
  return { id: band.id, name: band.name, books, tickets: Math.floor(n) }
}

/*
 * How the band is said out loud, under the name. "12 books" for somebody who
 * has them and "7 tickets" for somebody who does not, because a supporter with
 * no whole book reading "0 books" is told what they are short of rather than
 * what they gave.
 */
export function rankCount(rank: Rank | null): string {
  if (!rank) return ''
  if (rank.books >= 1) return `${rank.books} book${rank.books === 1 ? '' : 's'}`
  return `${rank.tickets} ticket${rank.tickets === 1 ? '' : 's'}`
}
