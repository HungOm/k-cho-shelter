/*
 * ONE LADDER, READ FROM BOTH SIDES OF THE WALL.
 *
 * The bands are defined once, in supabase/functions/_shared/ranks.ts, because
 * both sides have to agree about them and neither can be the one that is right.
 *
 *   THE SERVER works the band out when a receipt is minted, since it is the
 *   only place allowed to see which tickets belong to which buyer.
 *   THE CLIENT draws the band on the card and shows it beside a ticket, from
 *   the ticket list it already holds.
 *
 * Two copies of four thresholds would agree on the day they were written and
 * drift the first time somebody moved one. A buyer would then be Gold on the
 * card they were sent and Silver on the page that is supposed to confirm it —
 * and the page exists to be believed over the picture.
 *
 * Vite compiles the .ts, so this file is a re-export and nothing else. Anything
 * that belongs to the ladder itself goes in the shared module; anything that is
 * about how the client PRESENTS it can live here.
 */
export {
  RANKS,
  RANK_IDS,
  booksHeld,
  rankFor,
  rankCount,
} from '../../supabase/functions/_shared/ranks.ts'
