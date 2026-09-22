/*
 * A RAFFLE CAN KEEP WHAT IT MADE.
 *
 * Every other part of the ticket studio is about ONE design. This is the only
 * row that outlives one: a badge somebody drew for last year's raffle, the two
 * colours their printer matched, the lettering they settled on for a heading.
 *
 * Without it a second raffle starts from nothing, and so does a second ticket
 * in the same raffle — the answer to "make it look like the other one" is to
 * do it again by eye, and the two do not match.
 *
 * THREE KINDS, BECAUSE THEY ARE REUSED DIFFERENTLY. A shape is a composition
 * placed as a group. A colour is named, which is the gap this closes most
 * directly: the studio's swatches are read off the artwork every time it loads
 * and thrown away, so a raffle that matched its printer's ink has had nowhere
 * to put the answer. A text style is a face, a weight, an alignment and a
 * tracking under a name.
 *
 * A SAVED SHAPE HOLDS ITS PARTS RELATIVE TO ITSELF, not to the artboard, which
 * is the decision the whole feature rests on. Placed anywhere at any size, its
 * internal arrangement holds — a badge whose rule sits a third of the way down
 * stays a third of the way down at 40mm or at 8mm. Artboard shares would make
 * a saved shape reusable only at the size and position it was saved from,
 * which is the same as not saving it.
 *
 * BLANK IS THE REAL DEFAULT AND MEANS THE FOUR BUILT-IN SHAPES. A rule, a
 * double rule, a tint panel and a seal, which are the motifs a raffle ticket
 * actually uses. They live in code and are not written here, so improving one
 * reaches every raffle — the same reasoning as the card's sparse overlay. A
 * raffle that saves its own keeps both.
 */
insert into config (key, value, notes) values
  ('DESIGN_LIBRARY', '', 'What this raffle has made once and wants again, as JSON: {"shapes":[{"id","name","parts":[…]}],"colours":[{"id","name","value"}],"styles":[{"id","name","family","weight","align","tracking","colour"}]}. A saved shape holds its parts as shares of its OWN bounds, so it can be placed at any size. Blank means the four built-in shapes, which live in code so that improving one reaches every raffle.')
on conflict (key) do nothing;
