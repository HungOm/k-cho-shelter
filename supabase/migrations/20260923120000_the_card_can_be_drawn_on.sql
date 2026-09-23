/*
 * THE CARD CAN BE DRAWN ON.
 *
 * The digital ticket's parts could be moved (CARD_LAYOUT) but nothing could be
 * added to it: a rule under the name, a tint behind the prize, the raffle's
 * logo in a corner. The printed ticket has had drawings since its studio was
 * built; this gives the card the same records, drawn by the same renderer.
 *
 * NOT INSIDE CARD_LAYOUT. That row is a sparse overlay of FIXED parts with a
 * small cap, and its reader ignores ids it does not know. Drawings are stored
 * whole and checked whole — each one against the QR code's box, so nothing can
 * be drawn over the code a door volunteer scans.
 *
 * PER TREATMENT, because the three cards are different shapes: a rule placed
 * on the tall card lands somewhere else entirely on the wide one.
 *
 * BLANK MEANS NOTHING IS DRAWN, which is what every raffle had before.
 */
insert into config (key, value, notes) values
  ('CARD_DECORATIONS', '', 'What is DRAWN on the digital ticket, as JSON keyed by treatment: {"grand":[decoration, ...], ...}. Each decoration is the same record the printed ticket draws — rectangle, ellipse, line, words, mark, picture or path — in shares of that treatment''s card, drawn over its parts. Per treatment, because a rule drawn on a tall card means nothing on a wide one. Blank means nothing is drawn, which is what every raffle had before the Digital ticket tab could draw.')
on conflict (key) do nothing;
