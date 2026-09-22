/**
 * THE TREATMENTS A DIGITAL CARD CAN BE DRAWN IN, named once for both sides.
 *
 * WHY THIS FILE EXISTS, and it is a defect rather than a tidy-up.
 *
 * `branding.ts` validated a saved card design against a hand-written array:
 *
 *     const ALLOWED = ['grand', 'certificate', 'stub']
 *
 * and the client held its own list in `cardelements.js`. A fourth treatment
 * was added on 2026-09-22 and only the client learned about it, so the
 * Supporter card could be chosen in the studio, previewed, and then refused by
 * the server with BAD_DESIGN — a control that works right up to the moment it
 * matters. Nothing failed: both files were internally correct, both suites were
 * green, and only the PAIR was wrong.
 *
 * That is the shape this repository has paid for more than any other, and the
 * fix it has settled on is not a test comparing two lists — it is one list. The
 * supporter ladder went the same way: `_shared/ranks.ts` holds it and
 * `src/lib/ranks.js` is a re-export and nothing else, so the two cannot drift
 * because there are not two.
 *
 * WHY _shared AND NOT src/lib. An Edge Function may not import from the client
 * tree — it is a browser bundle with a Supabase client and twenty thousand
 * tickets in it. The client may import from _shared, and does: ranks.js reaches
 * across, and tests/screen.mjs copies this directory beside src/ for exactly
 * that reason. So the shared half lives on the side with the strict rule.
 *
 * WHAT IS NOT HERE. Sizes, parts, boxes and the drawings are the client's —
 * the server never renders a card and has no use for a coordinate. This file is
 * the ids and nothing else, which is the whole of what both sides need to
 * agree on.
 *
 * AND WHY IT IS THE ONE .js IN A DIRECTORY OF .ts. Every other file here is
 * TypeScript, which Deno reads directly and Node does not. The client reaches
 * this list through `cardelements.js`, and `tests/cardlayout` imports that with
 * a plain `import` — no esbuild, no loadts — so a .ts anywhere in that chain
 * fails with ERR_UNKNOWN_FILE_EXTENSION before a single assertion runs.
 *
 * The alternatives were worse: a re-export shim has the same problem one file
 * along, teaching the golden test to transpile risks the thing it pins, and
 * two lists with a test comparing them is what this file exists to end. Deno
 * imports .js natively, so plain JavaScript is the only shape both runtimes
 * read unaided. The break in convention is the point rather than an oversight.
 */

/**
 * In the order the studio offers them, which is also the order they were added.
 * `grand` is first because it is what a raffle that has never opened the tab
 * falls back to, and moving it would change what those raffles send.
 */
export const CARD_TREATMENT_IDS = ['grand', 'shelter', 'certificate', 'stub']

/**
 * Whether a stored or posted id is one this code can draw.
 *
 * BLANK IS ALLOWED and is not a treatment: an empty `cardDesign` means the
 * raffle has never chosen, which every raffle was before the tab existed, and
 * the renderer falls back to Grand. Refusing blank here would make "I have not
 * decided" unsaveable.
 */
export function isCardTreatment(id) {
  const want = String(id ?? '').trim().toLowerCase()
  return want === '' || CARD_TREATMENT_IDS.includes(want)
}
