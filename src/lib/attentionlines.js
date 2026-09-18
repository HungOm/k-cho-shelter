/*
 * Every sentence the Home "needs looking at" list can produce, as a fixed key.
 *
 * These reach a SELLER. Home is the one screen every role opens, and until now
 * the whole list was assembled English — "3 books not returned", "2 tickets
 * with no phone number" — rendered as plain text with no gloss. The Burmese in
 * this app exists for exactly the person reading that list on a phone between
 * services, and it was the one list they could not read.
 *
 * Templates rather than assembled strings, because these count things. A number
 * glued to the front of a translated fragment lands where English puts it, not
 * where Burmese does; one key with {n} lets each language place it. my() and Bi
 * fill the placeholder in both.
 *
 * Enumerated here so a test can assert every reachable sentence has Burmese.
 * The i18n suite scans STATIC labels only, so a key built at run time is
 * invisible to it — which is how this list stayed English while the rest of the
 * app was translated around it.
 */
export const ATTN = {
  // A REFUSAL YOU HAVE NOT ANSWERED. Worded as the thing that happened rather
  // than as a status: "turned down" is what a person would say about it, and
  // the reason is one tap away on the screen this sends them to.
  refusedOne: 'Something you asked for was turned down',
  refusedMany: '{n} things you asked for were turned down',
  refusedWhy: 'Read why, and ask again if it still needs doing',

  overdueOne: 'A book has not come back',
  overdueMany: '{n} books have not come back',
  overdueWhy: 'Past the date they were due back',

  myReportLate: 'You have not reported yet',
  myReportDue: 'Time to report',
  // The DATE stays bare data — a Burmese line under a date is nonsense — but
  // the sentence around it is not data, and a translated headline over an
  // English sentence is a half-translated screen. {when} carries the date in.
  myReportBy: 'Everybody reports by {when} — what has sold, what is left',
  myReportAnyway: 'Say what has sold and what is left, even if the books stay with you',

  silentOne: 'A seller has not reported',
  silentMany: '{n} sellers have not reported',
  silentWhy: 'Past the check-in date, books still with them',

  contactOne: 'A ticket has no phone number',
  contactMany: '{n} tickets have no phone number',
  contactWhy: 'You could not tell these people if they win',

  moneyOut: '{amount} not handed in yet',
  moneyWhy: 'Sold, but the money has not come back',

  openOne: 'A book is still out',
  openMany: '{n} books are still out',
  openWhy: 'With sellers, or waiting to be counted',
}
