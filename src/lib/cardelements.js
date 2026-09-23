/*
 * THE CARD'S PARTS, READ FROM BOTH SIDES OF THE WALL.
 *
 * Defined in supabase/functions/_shared/cardparts.js since the server began
 * refusing a drawing over a card's QR, which needs to know where each
 * treatment's QR is. Re-exported here so every client import stays as it was
 * — the arrangement src/lib/designelements.js uses, for the same reasons.
 */
export {
  CARD,
  CARD_SHELTER,
  CARD_CERT,
  CARD_STUB,
  CARD_SIZES,
  CARD_TREATMENTS,
  standardParts,
  resolveParts,
  layoutFrom,
  partBoxes,
  validateCardLayout,
} from '../../supabase/functions/_shared/cardparts.js'
