/**
 * ONE NUMBER THAT TWO FUNCTIONS HAVE TO AGREE ABOUT.
 *
 * A digital ticket is one per buyer and carries everything they hold, so the
 * set behind a single code is as large as the largest supporter in the raffle.
 * Two functions bound it, and they did it separately: `make_receipt` refused a
 * set over 200, and the public check page read `.limit(300)`. The pair happened
 * to be safe — the smaller number was the one that refused — but nothing said
 * so, and the day somebody raised the cap to help a large buyer, the check page
 * would have started silently listing the first three hundred of four hundred
 * tickets and calling that the buyer's holding.
 *
 * A truncated list on that page is the worst failure this feature has. It is
 * not an error and it does not look like one: the page answers, the verdict is
 * green, and the tickets that fell off the end are simply not mentioned to the
 * person checking whether they own them.
 *
 * So the bound is one constant, imported by both. `make_receipt` refuses above
 * it — while the organiser is standing there and can do something — and the
 * page reads exactly that many, so a list it returns is always whole.
 */
export const HOLDING_MAX_TICKETS = 300
