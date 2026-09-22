/*
 * THE CARD A BUYER IS SENT CAN BE DESIGNED, NOT ONLY CHOSEN.
 *
 * Ticket Studio has had four tabs and three of them were a designer: an
 * artboard, a list of what is on it, and an inspector for whatever is
 * selected. The fourth — "Digital ticket", the picture a buyer actually
 * receives on WhatsApp — offered a choice of three treatments and a motto.
 * Everything else about that card, every coordinate of it, was written into
 * `ticketart.js` and could not be moved by anybody running the raffle.
 *
 * It can now. The card is a list of named parts — the number, the buyer, the
 * fact row, the QR, the motto, the watermark — and each one can be moved,
 * resized, hidden, recoloured and realigned.
 *
 * ONLY THE DIFFERENCES ARE STORED, which is the whole reason this is one
 * config key and not a table. `cardelements.js` holds the standard layout of
 * each treatment; this row holds an overlay on it, keyed by treatment and then
 * by part, carrying only what somebody has actually changed. A raffle that
 * nudges the motto stores the motto's box and nothing else — so when a later
 * version improves the fact row or adds a part to the card, that raffle gets
 * the improvement instead of being frozen at the layout it happened to save
 * once. Storing the whole card is how a card stops improving the first time
 * anybody touches it.
 *
 * BLANK IS THE REAL DEFAULT AND MEANS THE STANDARD CARD. Every raffle already
 * in flight has this blank and keeps exactly the card it had: the standard
 * layout reproduces the old renderers to the character, which is what
 * `tests/cardlayout.test.mjs` exists to prove. Nothing back-fills, nothing
 * migrates, and a row that somehow becomes unreadable is read as blank rather
 * than thrown on — see `parseLayout` in config.ts, which is deliberately
 * incapable of failing inside a screen that is drawing somebody's ticket.
 */
/*
 * `notes`, NOT `description`, and this migration shipped with the wrong one.
 *
 * `db push` stopped here with `column "description" of relation "config" does
 * not exist`, having already applied the migration before it — so the database
 * was left half-way through a batch, which is the expensive kind of mistake
 * rather than an embarrassing one. Every other migration in this directory
 * says `notes` and so does the table; this was a column name written from
 * memory and never executed against anything.
 *
 * tests/migrationsql.test.mjs now reads the columns out of schema.sql and
 * fails on any insert here that names one the table has not got.
 */
insert into config (key, value, notes) values
  ('CARD_LAYOUT', '', 'Where the parts of the digital ticket sit, as JSON, for any part an organiser has MOVED in Ticket Studio. Only the differences are stored, keyed by treatment and then by part, so a raffle that has changed one line keeps every later improvement to the rest of the card. Blank means the standard layout of whichever treatment is chosen, which is what every raffle had before the tab could move anything.')
on conflict (key) do nothing;
