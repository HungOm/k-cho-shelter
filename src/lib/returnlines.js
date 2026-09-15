/*
 * Every sentence this banner can produce, as a fixed key.
 *
 * Templates rather than assembled strings, so each is one translatable unit and
 * the number lands where the language puts it. Listed here so the test can
 * assert that every sentence reachable from here has Burmese — a dynamic key
 * escapes the i18n suite's scan of static labels, and a banner that silently
 * falls back to English is one a Burmese-speaking seller cannot read.
 */
export const LINES = {
  lateMineOne: 'Your book is past its return date',
  lateMineMany: '{n} of your books are past their return date',
  lateAllOne: 'A book is past its return date',
  lateAllMany: '{n} books are past their return date',
  soonMineOne: 'Your book is due back soon',
  soonMineMany: '{n} of your books are due back soon',
  soonAllOne: 'A book is due back soon',
  soonAllMany: '{n} books are due back soon',
  alsoDue: 'Another {n} due by {when}.',
  bringBack: 'Bring them back, or write down which tickets sold.',
  chase: 'Chase the sellers holding them.',
  dueBy: 'Due by {when}.',
  dueByMine: 'Due by {when}. Bring them back, or write down which tickets sold.',
}
