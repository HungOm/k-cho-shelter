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
 * So the bound is one constant, imported by both.
 *
 * A THOUSAND, WHICH IS A HUNDRED BOOKS. It was three hundred while the set was
 * stored and an organiser was refused at the moment of minting — a refusal
 * somebody could act on. The set is resolved live now, so there is no moment
 * to refuse at: a buyer who quietly passes the bound would have their list cut
 * short by a page that gave no sign of it. The bound is therefore set where no
 * community raffle reaches it rather than where somebody has to be told about
 * it, and the count beside the list is the true one either way.
 */
export const HOLDING_MAX_TICKETS = 1000
