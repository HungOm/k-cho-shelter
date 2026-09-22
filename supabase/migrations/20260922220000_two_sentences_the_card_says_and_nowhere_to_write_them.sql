/*
 * TWO SENTENCES THE CARD SAYS, AND NOWHERE TO WRITE THEM.
 *
 * The Supporter card reads `TOP_PRIZE` and `IMPACT_LINE` — what somebody could
 * win, and what their money does. Both were added to `schema.sql` and to
 * `configPayload` and nowhere else, which meant:
 *
 *   - a FRESH install seeded both rows and an existing raffle got neither, so
 *     the live raffle would never have had them at all;
 *   - and nothing anywhere could write one. No setter, no control. Two config
 *     values that could be read and never set.
 *
 * Nothing was broken by that — the card draws nothing for a blank line rather
 * than a label over an empty space — so there was no symptom. The feature was
 * simply inert, which is the failure mode of a config key added to the schema
 * and to nothing else, and is worth naming because the same mistake is
 * available to every key anybody adds next.
 *
 * WHY THIS IS AN INSERT AND NOT AN UPSERT. A raffle that has already written
 * one of these keeps what it wrote. `on conflict do nothing` is the whole of
 * that guarantee, and it is the same shape the reset incident on 2026-09-21
 * turned on: the prefix lived in the row, so the rows are what a migration must
 * derive from rather than overwrite. A migration that re-ran and blanked an
 * organiser's own sentence would be the second instance of that.
 *
 * The descriptions are the ones in schema.sql, verbatim. Two copies of a
 * sentence is what config seeding is, and they are compared by
 * tests/freshinstall — which reads schema.sql and checks the count and the
 * names against what the server actually reads.
 */

insert into config (key, value, notes) values
  ('TOP_PRIZE', '', 'The headline prize as the card advertises it — "A motorbike". Deliberately not read off the prize schedule: that is the draw-night list with values on it, and a card sent weeks earlier should not recite a figure nobody meant to publish. Blank draws no prize line.'),
  ('IMPACT_LINE', '', 'One sentence on the Supporter card saying what the money does — "Your RM 200 helps a family through a month." Blank draws the ordinary thank-you instead, which is a real answer: a raffle that has not decided what to claim should not claim anything.')
on conflict (key) do nothing;
