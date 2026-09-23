/*
 * ONE DECORATION MODEL, READ FROM BOTH SIDES OF THE WALL.
 *
 * Defined once, in supabase/functions/_shared/designelements.ts, because both
 * sides have to agree about it and neither can be the one that is right:
 *
 *   THE CLIENT normalises a stored design so a screen can draw it, and draws
 *   the decorations into the ticket and the card.
 *   THE SERVER refuses a design it will not store — the size, the shapes, and
 *   the one rule that matters, which is that nothing may sit on the QR.
 *
 * Two copies of that would agree on the day they were written. The first time
 * one moved, a studio would let somebody draw a thing the server then refused,
 * or worse, accept one it should not have. This repository has watched exactly
 * that happen twice this week in smaller places: a hardcoded list of card
 * treatments in branding.ts that a fifth treatment was missing from, and an
 * icon table a test matched against the wrong half of its own file.
 *
 * AND IT IS .js RATHER THAN .ts, WHICH THE REST OF _shared IS NOT.
 *
 * Deliberate, and the reason is a constraint nobody wrote down until it bit.
 * `ticketart.js` draws the decorations, and `tests/ticketart.test.mjs` imports
 * ticketart DIRECTLY in plain Node — so nothing ticketart reaches, however
 * indirectly, may be TypeScript. Node cannot load a .ts and the whole suite
 * stops with ERR_UNKNOWN_FILE_EXTENSION.
 *
 * src/lib/ranks.js gets away with .ts because no plain-Node test ever imports
 * it: tests/ranks loads the shared module through tests/loadts.mjs and checks
 * the client file by reading its import line rather than executing it. This
 * module cannot do that, because the thing that needs it is a renderer.
 *
 * The file is plain JavaScript either way — it has no types in it — so .js
 * costs nothing and Deno, Vite and Node all load it unchanged.
 */
export {
  KINDS,
  TEXTUAL,
  FILLS,
  DASHES,
  WEIGHTS,
  FAMILIES,
  ALIGNS,
  BLENDS,
  MAX_DECORATIONS,
  nextDecoId,
  nextGroupId,
  normalDecoration,
  normalDecorations,
  faultsIn,
  decorationSVG,
  decorationLayerSVG,
  printWarnings,
} from '../../supabase/functions/_shared/designelements.js'
