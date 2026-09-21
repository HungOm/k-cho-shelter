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
/** A stored card layout, or nothing at all. Never throws — see the caller. */
function parseLayout(raw: unknown): Record<string, unknown> {
  const text = String(raw ?? '').trim()
  if (!text) return {}
  try {
    const out = JSON.parse(text)
    return out && typeof out === 'object' && !Array.isArray(out) ? out : {}
  } catch {
    return {}
  }
}

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
    /*
     * HOW TO REACH THE ORGANISERS — and the only reason these exist.
     *
     * The public check page offers a stranger who has scanned a ticket that
     * does not verify three things to do: call the office, contact us, report
     * it. None of them had anywhere to point: there was no phone, email or
     * address for the organisation anywhere in config or schema. A dial button
     * that dials nothing is worse than no button on that page, because it
     * spends the one moment somebody was willing to act in.
     *
     * Blank is a real answer and means "we have not given one" — the page shows
     * text instead of a dead control. Never a default, never a placeholder:
     * a wrong number on a fraud-report page reaches a stranger.
     */
    orgPhone: cfg.ORG_PHONE ?? '',
    orgEmail: cfg.ORG_EMAIL ?? '',
    orgWebsite: cfg.ORG_WEBSITE ?? '',
    /*
     * What the public ticket-check page says this raffle IS. Blank means the
     * page uses its own built-in sentence, so an empty value here is a real
     * answer rather than a missing one — see setOrgAbout.
     */
    orgAboutMy: cfg.ORG_ABOUT_MY ?? '',
    orgAboutEn: cfg.ORG_ABOUT_EN ?? '',
    // One colour; the stylesheet derives the rest. Blank is a real no-op —
    // applyBrand removes the tokens and the stylesheet's own colour stands,
    // rather than half a theme being applied over it.
    brandColor: cfg.BRAND_COLOR ?? '',
    /* Card 8c. ViewTicket has read `cardDesign` since the treatments became
       reachable and nothing ever filled it, so every raffle fell back to Grand;
       `motto` is drawn by all three cards and could be set nowhere at all. */
    cardDesign: cfg.CARD_DESIGN ?? '',
    motto: cfg.MOTTO ?? '',
    /*
     * WHERE THE PARTS OF THE DIGITAL CARD SIT, parsed here rather than on the
     * client, so a row that got corrupted is one blank card layout instead of
     * a JSON.parse throwing inside whichever screen happened to draw a ticket
     * first. Blank and unparseable both mean the same thing and mean it
     * safely: the standard layout, which is what every raffle had before the
     * studio could move anything.
     *
     * It travels with the rest of config because ViewTicket, the studio and
     * the WhatsApp picture all draw the same card and must not disagree about
     * where its motto is. It is small — only the parts somebody has moved.
     */
    cardLayout: parseLayout(cfg.CARD_LAYOUT),
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
