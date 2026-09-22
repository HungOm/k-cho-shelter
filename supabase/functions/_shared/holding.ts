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

/**
 * TWO WRITINGS OF ONE NAME, FOLDED TO ONE — the same fold the database indexes
 * on, in `buyer_key`.
 *
 * A digital ticket is keyed on a buyer, and a buyer is a telephone number AND
 * a name: the number alone pools a household or a shop, the name alone pools
 * two people called Ma Hla. The name half is written on a phone, at a table,
 * by different sellers, so it is compared rather than matched — case folded,
 * runs of whitespace collapsed, trimmed.
 *
 * IT HAS TO AGREE WITH THE SQL, character for character, because the unique
 * index is built on that one and the api decides which buyer a set belongs to
 * with this one. Disagreeing, they would let two rows exist for one buyer or
 * refuse a row for two — so if either changes, both change, and
 * tests/receipt checks them against the same inputs.
 */
export function buyerKey(name: string): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}
