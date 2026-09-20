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
 * about; "ten books" is a sentence an organiser already uses about a person.
 * Tickets per book is a setting, so the same ladder means 1-3 books whether a
 * book holds ten tickets or five, and the bands move with the raffle instead of
 * being pinned to a number that was right for one of them.
 *
 * THE BOUNDARIES ARE CLOSED, WHICH THEY WERE NOT WHEN THEY WERE DESCRIBED.
 * The ladder arrived as "Gold (5-10 books), Diamond (10+), Silver (1-3)": ten
 * books was both Gold and Diamond, and four books was neither. Ranges that
 * overlap and ranges that leave a hole are the same defect — a value with no
 * single answer — and the only way to be sure they are gone is to name the
 * bands as thresholds rather than as spans, so every count above zero falls in
 * exactly one. tests/ranks walks every boundary, including four books.
 */

/*
 * Ordered from the top down, because that is how it is read: the first band
 * whose threshold is met is the answer, so no band can be shadowed by one
 * below it and adding a band cannot silently reorder the others.
 *
 * `minBooks: 0` for the bottom band is deliberate and is not "no books". It is
 * the band for somebody who has bought tickets but not yet a whole book, and it
 * exists because that is most buyers: a ladder whose bottom rung is one book
 * would say nothing at all to the person who bought three tickets, which is the
 * person the word "faithful" is for.
 */
export type Rank = { id: string; name: string; books: number; tickets: number }

export const RANKS = [
  { id: 'diamond', name: 'Diamond supporter', minBooks: 10 },
  { id: 'gold', name: 'Gold supporter', minBooks: 4 },
  { id: 'silver', name: 'Silver supporter', minBooks: 1 },
  { id: 'faithful', name: 'Faithful supporter', minBooks: 0 },
]

export const RANK_IDS = RANKS.map((r) => r.id)

/** Whole books held, which is what the bands are measured in. */
export function booksHeld(tickets: number, perBook: number): number {
  return Math.floor(tickets / perBook)
}

/*
 * The one function. Returns null rather than a band whenever it cannot work one
 * out, and the two cases it refuses are both cases where a wrong answer would
 * be worse than none:
 *
 *   NO TICKETS. Nobody is a supporter of nothing, and a card with a rank line
 *   reading "Faithful supporter · 0 tickets" is a sentence about an absence.
 *
 *   NO BOOK SIZE. Without tickets-per-book there is no way to turn a count into
 *   books, and the tempting fallback — call them Faithful and move on — would
 *   put "Faithful supporter" on a card belonging to somebody holding two
 *   hundred tickets. Silence is recoverable; a demotion printed on a ticket is
 *   not. This is the shape this repository has been caught by before: a default
 *   that quietly admits the case nobody thought about.
 */
export function rankFor(tickets: unknown, perBook: unknown): Rank | null {
  const n = Number(tickets)
  const per = Number(perBook)
  if (!Number.isFinite(n) || n < 1) return null
  if (!Number.isFinite(per) || per < 1) return null

  const books = booksHeld(n, per)
  const band = RANKS.find((r) => books >= r.minBooks)
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
