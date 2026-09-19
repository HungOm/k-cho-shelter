/*
 * The config the client reads.
 *
 * Its own module because index.ts and branding.ts both need it and index.ts
 * imports branding.ts, so branding.ts cannot import back. The same shape as
 * mask() and agentBooks in gate.ts, and for the same reason: the alternative is
 * a second builder that drifts, and six field-shape divergences in this
 * repository were a key built one way and read another.
 *
 * whoami returns it; upload_logo and set_brand_color return it; a screen does
 * state.cfg = res.config after any of the three and never has to know which.
 */

import { dayStart } from './deadlines.ts'

const num = (v: unknown, d: number) => {
  const n = parseInt(String(v ?? ''), 10)
  return isNaN(n) ? d : n
}

/**
 * The config the client reads, built in one place.
 *
 * Pulled out of whoami so upload_logo and set_brand_color can answer with the
 * SAME object rather than a second one shaped like it. Both write config and
 * both return it, and a screen that assigns state.cfg from one and then the
 * other would be reading two contracts — which is how six field-shape
 * divergences happened here, every one of them a key built one way and read
 * another.
 */
export function configPayload(cfg: Record<string, string>) {
  const generated = num(cfg.TOTAL_TICKETS, 0)
  const activeRaw = num(cfg.ACTIVE_TICKETS, 0)
  const active = activeRaw <= 0 || activeRaw > generated ? generated : activeRaw
  return {
    ticketPrefix: cfg.TICKET_PREFIX ?? '',
    ticketDigits: num(cfg.TICKET_DIGITS, 5),
    // Without this the setup screen printed "KS-undefined onwards", which is
    // the ticket numbering the whole raffle is built on.
    ticketStart: num(cfg.TICKET_START, 1),
    ticketsPerBook: num(cfg.TICKETS_PER_BOOK, 10),
    bookPrefix: cfg.BOOK_PREFIX ?? 'Book-',
    bookDigits: num(cfg.BOOK_DIGITS, 3),
    // And without this, "10 — that makes books" with the number missing.
    totalBooks: Math.ceil(generated / Math.max(1, num(cfg.TICKETS_PER_BOOK, 10))),
    defaultDueDays: num(cfg.DEFAULT_DUE_DAYS, 30),
    totalTickets: active,            // what is in play — the number the app works in
    generatedTickets: generated,
    heldBackTickets: Math.max(0, generated - active),
    ticketCeiling: num(cfg.TICKET_CEILING, 0),
    ticketPrice: Number(cfg.TICKET_PRICE ?? 10),
    currency: cfg.CURRENCY ?? 'RM',
    eventName: cfg.EVENT_NAME ?? '',
    orgName: cfg.ORG_NAME ?? '',
    // The organiser's mark, by URL. Blank means no mark rather than somebody
    // else's — see Logo.vue. Small is optional and only ever a size choice.
    orgLogo: cfg.ORG_LOGO ?? '',
    orgLogoSmall: cfg.ORG_LOGO_SMALL ?? '',
    // One colour; the stylesheet derives the rest. Blank is a real no-op —
    // applyBrand removes the tokens and the stylesheet's own colour stands,
    // rather than half a theme being applied over it.
    brandColor: cfg.BRAND_COLOR ?? '',
    projectCode: cfg.PROJECT_CODE ?? '',
    /*
     * Whether this raffle has artwork to print tickets from — a yes or no, not
     * the artwork itself. The design and the picture travel with the actions
     * that need them; putting them here would send a few kilobytes of
     * coordinates to every screen on every sign-in to answer a question that
     * only two buttons ask.
     *
     * It is here at all so that "Print this book" can be shown DISABLED with
     * the reason, rather than enabled and then refused — which is the rule the
     * rest of this app is held to, and the reason is the useful half.
     */
    ticketArtwork: String(cfg.TICKET_ARTWORK_ID ?? '') !== '',
    // Through dayStart, never raw. A value that arrived from a date-shaped
    // spreadsheet cell is a full timestamp string, and the client compares
    // these against today as plain text — where that string sorts ABOVE a
    // real day, so a date months past reads as still ahead.
    checkInDate: dayStart(cfg.CHECK_IN_DATE ?? ''),
    finalDeadline: dayStart(cfg.FINAL_DEADLINE ?? ''),
    // The last day a ticket may be sold, which is none of the other three. It
    // travels with them because the screens that offer a sale are the ones that
    // have to say when selling stops — a cutoff nobody is told about first is a
    // refusal at the till.
    salesCloseDate: dayStart(cfg.SALES_CLOSE_DATE ?? ''),
    drawDate: dayStart(cfg.DRAW_DATE ?? ''),
  }
}
