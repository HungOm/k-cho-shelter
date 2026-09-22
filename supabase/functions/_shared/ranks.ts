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
 * WHO IS BUYING, WHICH IS WHAT THE WORDS HAD TO BE CHOSEN AGAINST.
 *
 * A raffle here funds a community centre, a refugee learning centre, refugee
 * Christian fellowships, a shelter for refugee patients with chronic and
 * mental health conditions, and whatever small community fundraising comes
 * next. The tickets are sold largely INSIDE that community: the person holding
 * a book is usually a neighbour of the people it pays for, not a donor at a
 * distance from them.
 *
 * AND THE RAFFLE IS AN INSTRUMENT, NOT AN EVENT — it is run again for the next
 * cause. That is worth knowing here for two reasons. It is why no rung can be
 * named after one arm of the organisation: the same ladder prints on a ticket
 * sold for the learning centre and on one sold for something that does not
 * exist yet. And it is the strongest form of the argument against the rung
 * this ladder started with, "Faithful": somebody may buy in raffle after
 * raffle, which is what faithfulness would actually mean, and the band can
 * still only ever see the one holding in front of it.
 *
 * That single fact rules out most of the vocabulary this kind of ladder
 * normally reaches for, and it is worth writing down because every one of them
 * will be suggested again:
 *
 *   PATRON, BENEFACTOR, AMBASSADOR — patronage. Someone from outside
 *   conferring help on people beneath them. It is the wrong relationship and
 *   it is not even accurate here.
 *
 *   CHAMPION, GUARDIAN, HERO, LIFESAVER — rescue. It puts the ticket-buyer
 *   above the patients, who are frequently from the same families. "Lifesaver"
 *   is also a claim nobody can check, which is the failure this whole file
 *   exists to prevent.
 *
 *   CARER — it means something specific in a shelter with patients. It belongs
 *   to the staff and the families doing that work, not to somebody who bought
 *   a book of tickets.
 *
 *   ANYTHING NAMING THE SHELTER — a ticket sold at the learning centre reaches
 *   a family that has nothing to do with the shelter, and a rung named after
 *   one arm of the organisation is wrong on three quarters of the tickets.
 *
 *   ANYTHING RELIGIOUS — for the opposite reason to the one you would guess.
 *   The fellowships make the register genuinely theirs, but the learning
 *   centre and the community centre reach families outside them, and the band
 *   prints on every card.
 *
 * WHAT IS LEFT IS CLOSENESS, which is a real ladder, orders itself the way
 * people already order relationships, and says belonging rather than charity:
 * Friend, Neighbour, Companion, Family. They are also the four plainest words
 * on the list — all ordinary in Burmese, none of them abstract — which matters
 * more than it looks, because half the audience reads the Burmese half first
 * and it is composed here rather than translated by a reader of it.
 *
 * AND IT TOPS OUT AT FOUR ON PURPOSE. Nothing sits above "family". A fifth
 * rung was on the table and this is the argument against it: if the top wants
 * to be further away, move the threshold, do not invent a word that outranks
 * being one of the family.
 *
 * THE METALS ARE GONE, AND THEY WERE NOT WRONG, they were generic. Bronze,
 * Silver, Gold and Diamond could belong to any charity on earth, and "Diamond
 * supporter" is a luxury register on a card carried by people who fled. The
 * bottom rung before them was "Faithful supporter", dropped on 2026-09-22
 * because faithfulness is continuity and the band is computed from ONE
 * raffle's holding, so it called a first-time buyer of a single ticket
 * faithful — the one band whose word was not backed by the number beside it.
 * That argument is about the CLAIM and survives every rename since.
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
 * 1, 3 and 6 books keeps the same shape and brings the top within reach:
 * RM 100, RM 300 and RM 600 of a raffle whose books are RM 100 each. A
 * household, a shop or a fellowship that takes six books is as close to this
 * organisation as a ticket can make somebody, and there is now a name for them
 * that people will actually be called.
 *
 * WHAT WOULD MAKE THESE WRONG AGAIN, said plainly because it is checkable:
 * if most buyers end up Companion or Family, the rungs are too low and mean
 * nothing; if almost everyone is still a Friend, they are too high.
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
 * person is the one the raffle most wants to thank. "Friend" is the right word
 * for them precisely because it claims nothing — it is what somebody is after
 * one ticket, and it is still true after nine.
 *
 * NONE OF THESE FOUR MAKES A CLAIM THE ROWS CANNOT CARRY, which is the test
 * every candidate had to pass. Friend, Neighbour, Companion and Family all
 * describe a relationship TO THE ORGANISATION, and the number printed beside
 * them is what earned it. Contrast the rung this replaced: "Faithful" described
 * the PERSON, over time, from a single raffle's holding.
 */
export type Rank = { id: string; name: string; books: number; tickets: number }

export const RANKS = [
  { id: 'family', name: 'Family', minBooks: 6 },
  { id: 'companion', name: 'Companion', minBooks: 3 },
  { id: 'neighbour', name: 'Neighbour', minBooks: 1 },
  { id: 'friend', name: 'Friend', minBooks: 0 },
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
 *   reading "Friend · 0 tickets" is a sentence about an absence.
 *
 *   NO BOOK SIZE. Without tickets-per-book there is no way to turn a count into
 *   books, and the tempting fallback — call them Friend and move on — would
 *   put the bottom rung on a card belonging to somebody holding two hundred
 *   tickets. Silence is recoverable; a demotion printed on a ticket is not.
 *   This is the shape this repository has been caught by before: a default
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
