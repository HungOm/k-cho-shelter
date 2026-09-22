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
 * exactly one. tests/ranks walks every boundary.
 */

/*
 * THE THRESHOLDS ARE SET TO BE REACHED, which is a change made on 2026-09-22
 * and the reason the numbers here are not the ones this file was born with.
 *
 * They were Silver 1, Gold 4, Diamond 10. At the raffle's own defaults — ten
 * tickets to a book, RM 10 a ticket — Diamond meant a hundred tickets and
 * RM 1,000 from one buyer, and Gold meant RM 400. A ladder whose upper rungs
 * nobody stands on is not a ladder; it is a decoration with three-quarters of
 * itself hidden, and every buyer it thanks is thanked at the bottom.
 *
 * Silver 1, Gold 3, Diamond 6 keeps the same shape and brings the top within
 * reach: RM 100, RM 300 and RM 600 of a raffle whose books are RM 100 each.
 * A household, a shop or a church group that takes six books is a real
 * supporter of this shelter and there is now a name for them that somebody
 * will actually be called.
 *
 * WHAT WOULD MAKE THESE WRONG AGAIN, said plainly because it is checkable:
 * if most buyers end up Gold or Diamond, the rungs are too low and mean
 * nothing; if almost everyone is still on the bottom rung, they are too high.
 * The query that settles it is a count of tickets grouped by buyer — the
 * bands are a description of the raffle's buyers, so they should be re-read
 * against the buyers once a raffle has run.
 */

/*
 * Ordered from the top down, because that is how it is read: the first band
 * whose threshold is met is the answer, so no band can be shadowed by one
 * below it and adding a band cannot silently reorder the others.
 *
 * `minBooks: 0` for the bottom band is deliberate and is not "no books". It is
 * the band for somebody who has bought tickets but not yet a whole book, and it
 * exists because that is most buyers: a ladder whose bottom rung is one book
 * would say nothing at all to the person who bought three tickets, and that
 * person is the one the raffle most wants to thank.
 *
 * THE BOTTOM RUNG IS A METAL, AND THAT IS THE POINT OF THE NAME. It was
 * "Faithful supporter" until 2026-09-22, and the word was wrong for a reason
 * worth writing down rather than quietly fixing: faithfulness is continuity —
 * somebody who keeps coming back — and this band is computed from ONE
 * raffle's holding. It called a first-time buyer of a single ticket faithful,
 * which is a claim about a person that the rows underneath it cannot support.
 * That is precisely what the commit introducing these bands was titled against
 * ("A thank-you nobody can check is flattery"), and it was the one band on the
 * ladder whose word was not backed by the number printed beside it.
 *
 * "Bronze" fixes it three ways at once. It is true — bronze says where you
 * stand on a ladder, and claims nothing about you. It completes a scale that
 * was already three-quarters metal, so the bottom rung stops reading as a
 * consolation handed to somebody who missed the metals. And it drops a
 * religious register that landed on every small buyer whether or not it was
 * theirs to carry.
 */
export type Rank = { id: string; name: string; books: number; tickets: number }

export const RANKS = [
  { id: 'diamond', name: 'Diamond supporter', minBooks: 6 },
  { id: 'gold', name: 'Gold supporter', minBooks: 3 },
  { id: 'silver', name: 'Silver supporter', minBooks: 1 },
  { id: 'bronze', name: 'Bronze supporter', minBooks: 0 },
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
 *   reading "Bronze supporter · 0 tickets" is a sentence about an absence.
 *
 *   NO BOOK SIZE. Without tickets-per-book there is no way to turn a count into
 *   books, and the tempting fallback — call them Bronze and move on — would
 *   put "Bronze supporter" on a card belonging to somebody holding two
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
