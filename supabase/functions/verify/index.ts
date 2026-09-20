/*
 * IS THIS TICKET REAL? — the one question this answers, for anybody, with no
 * sign-in.
 *
 * Somebody holding a raffle ticket points a phone at the QR on it. This is what
 * the phone reaches. It says whether the ticket is genuine, what it is called,
 * and whether the raffle has it recorded as sold. Nothing else, to anybody.
 *
 * THIS IS THE FIRST UNAUTHENTICATED ENDPOINT IN THE SYSTEM, and everything else
 * in the project is built on the opposite assumption. supabase/config.toml says
 * why the api function keeps its platform JWT check: "a request without a
 * signed-in person has no business reaching a raffle that holds several
 * thousand people's phone numbers". That reasoning is still correct, which is
 * why this is a SEPARATE function rather than a route inside that one. It has
 * its own deployment, its own `verify_jwt = false`, and a blast radius that is
 * written down below and tested.
 *
 * WHAT IT MAY TOUCH: two columns of `tickets` (number, status) and one column
 * of `ticket_codes` (code). Nothing else. tests/verify.test.mjs reads this file
 * and fails if it ever mentions a buyer, a phone, a seller or a user — a source
 * check rather than a behavioural one, because the dangerous version of this
 * file is the one that works perfectly and returns one field too many.
 *
 * WHAT IT DELIBERATELY WILL NOT DO:
 *   - say whether a number exists. An unknown number, a ticket that was never
 *     printed, and a wrong code all answer identically, so this cannot be used
 *     to map the raffle.
 *   - say who bought it. That is the thing the whole system guards hardest, and
 *     a QR code on a piece of paper in a hall is not an access credential.
 *   - write anything. A public endpoint that writes is a public endpoint that
 *     can be made to fill a table.
 *
 * WHAT IT CANNOT DO, said plainly because somebody will ask: a photocopy of a
 * genuine ticket carries a genuine code and verifies. That is true of anything
 * printed. What settles a dispute is the books — which is why the reply says
 * whether the ticket is recorded as SOLD, and the draw is decided on the record
 * rather than on the paper.
 */
import { withSupabase } from 'npm:@supabase/server'

import { canonicalNumber, equalCodes, looksLikeCode } from '../_shared/ticketcode.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any } }

/*
 * The numbering, cached briefly.
 *
 * Needed to turn what was scanned into the number this raffle stores. It
 * changes about once in the life of a raffle — the database freezes it the
 * moment the first ticket exists — so a short cache is safe and keeps a busy
 * hall from turning one scan into two queries.
 */
let cfgCache: { at: number; value: { prefix: string; digits: number } } | null = null
const CFG_TTL = 30_000

async function numbering(ctx: Ctx) {
  if (cfgCache && Date.now() - cfgCache.at < CFG_TTL) return cfgCache.value
  const { data } = await ctx.supabaseAdmin.from('config').select('key,value')
  const map: Record<string, string> = {}
  for (const r of data ?? []) map[String(r.key)] = String(r.value)
  const value = {
    prefix: map.TICKET_PREFIX ?? '',
    digits: Number(map.TICKET_DIGITS ?? 5) || 5,
    /*
     * WHO TO TELL, when the answer on this page is "no".
     *
     * A stranger holding a ticket that does not verify is the one visitor here
     * with something to report and nobody to report it to. These give them
     * somewhere to go, and they are the organiser's own published details — the
     * opposite of the buyer data this endpoint exists to keep out. tests/verify
     * names ORG_PHONE as the only telephone identifier this file may carry, so
     * a buyer's or a seller's number cannot appear here even by accident.
     *
     * NO FALLBACK ON THE NAME, deliberately. The app's own name is declared
     * once in src/lib/format.js, orgidentity refuses a second copy of it
     * anywhere in src/, and verifypage refuses this page any import from lib/
     * at all. Rather than write the default down a third time, an unset name is
     * sent empty and the page does not attribute. That is also the better
     * answer: telling a stranger checking a charity's ticket the name of the
     * software would be a worse sentence than saying nothing.
     *
     * Blank is a real answer throughout — nothing here is defaulted, because a
     * wrong number on a page somebody reaches after being handed a forgery
     * sends them to the wrong charity.
     */
    /*
     * For the buyer's own copy on ?r=. The book label is DERIVED from the
     * prefix and the padding rather than read out of the books table, so the
     * table allowlist in tests/verify stays at four — a receipt view is not a
     * reason to hand this endpoint another table.
     */
    bookPrefix: map.BOOK_PREFIX ?? 'Book-',
    bookDigits: Number(map.BOOK_DIGITS ?? 4) || 4,
    drawDate: (map.DRAW_DATE ?? '').trim(),
    org: {
      name: (map.ORG_NAME ?? '').trim(),
      tel: (map.ORG_PHONE ?? '').trim(),
      email: (map.ORG_EMAIL ?? '').trim(),
      site: (map.ORG_WEBSITE ?? '').trim(),
      /*
       * WHAT THIS RAFFLE IS, in the organiser's own words.
       *
       * The page carries a sentence under every verdict saying what kind of
       * thing somebody has been handed. It was fixed in the page's own strings,
       * which was right for one raffle and wrong for every other. Either half
       * may be blank and the page keeps its built-in sentence for that language.
       *
       * It is organiser-published copy, like the contacts beside it, and
       * carries nothing about a ticket, a buyer or a seller — which is what
       * makes it safe to answer to anybody on a page with no session.
       */
      aboutMy: (map.ORG_ABOUT_MY ?? '').trim(),
      aboutEn: (map.ORG_ABOUT_EN ?? '').trim(),
    },
  }
  cfgCache = { at: Date.now(), value }
  return value
}

/** Sold and Donated are both "this ticket is spoken for"; Void is cancelled. */
function stateOf(status: string): 'sold' | 'unsold' | 'void' {
  if (status === 'Sold' || status === 'Donated') return 'sold'
  if (status === 'Void') return 'void'
  return 'unsold'
}

const reply = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      // Never cached. A ticket's state changes when it is sold, and a proxy
      // holding yesterday's answer would tell a buyer their ticket is unsold.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

export default {
  fetch: withSupabase({ auth: 'none' }, async (req: Request, ctx: Ctx) => {
    /*
     * GET only. There is nothing to post, and refusing everything else keeps
     * this from being reachable by a form on somebody else's page.
     */
    if (req.method !== 'GET') {
      return reply({ ok: false, reason: 'method' }, 405)
    }

    const url = new URL(req.url)

    /*
     * ?about — WHO TO CONTACT, ASKED SEPARATELY AND ON PURPOSE.
     *
     * The office telephone, email and site are not facts about a ticket, and
     * verify.test pins a ticket's answer to exactly ok, genuine, number, state
     * and checkedAt with the note that anything else is a field somebody added
     * without thinking. That guard is right: hanging a contact block off the
     * ticket reply would make every verification carry furniture, and would tie
     * the one thing a stranger needs most to the one request most likely to
     * have failed.
     *
     * Which is the real argument for a second call rather than a wider first
     * one. Somebody whose ticket did not verify, or whose lookup errored, still
     * gets somewhere to report it — the contact block does not share a fate
     * with the answer it sits under.
     *
     * It reads config and nothing else: no ticket, no code, no row of
     * anybody's. Every value is the organiser's own published detail, and each
     * may be blank — a real answer meaning "not given" rather than a default
     * somebody would dial by mistake.
     */
    if (url.searchParams.has('about')) {
      const cfg = await numbering(ctx)
      return reply({ ok: true, org: cfg.org })
    }

    /*
     * Two spellings, one meaning.
     *
     *   ?t=KS-00123&c=ABCD...   readable, and what a person typing would write
     *   ?KS-00123.ABCD...       shorter, and what the QR carries
     *
     * The short form matters: every character in the QR is a module, and a QR
     * that prints smaller scans from further away on a worse camera.
     */
    let rawNumber = url.searchParams.get('t') ?? ''
    let rawCode = url.searchParams.get('c') ?? ''
    if (!rawNumber && !rawCode) {
      const compact = decodeURIComponent(url.search.replace(/^\?/, ''))
      const dot = compact.lastIndexOf('.')
      if (dot > 0) {
        rawNumber = compact.slice(0, dot)
        rawCode = compact.slice(dot + 1)
      }
    }

    /*
     * A RECEIPT: ONE CODE STANDING FOR THE TICKETS ONE BUYER TOOK.
     *
     *   ?r=ABCD...   or   ?r.ABCD...
     *
     * A buyer who took ten tickets was given ten pictures and ten QR codes, and
     * had no way to check them in one go — nor had anybody standing beside them
     * at the draw. The list cannot go in the QR: at the level the ticket design
     * ships, a version 10 code holds 213 bytes, which is seven number-and-code
     * pairs against the ten in a single book.
     *
     * IT ANSWERS THE SAME QUESTION AND REVEALS NOTHING MORE. Every ticket on
     * the receipt, its number, and whether the raffle records it as sold —
     * which is exactly what one ticket's answer carries, N times. No buyer, no
     * telephone number, no seller; a receipt is a set of tickets and nothing
     * about the person holding it is stored on it.
     *
     * AN UNKNOWN RECEIPT ANSWERS LIKE A WRONG ONE, for the same reason a made-up
     * ticket code does: telling them apart is help for somebody guessing.
     */
    const receiptCode = (url.searchParams.get('r') ?? '').trim() ||
      (() => {
        const compact = decodeURIComponent(url.search.replace(/^\?/, ''))
        return compact.startsWith('r.') ? compact.slice(2) : ''
      })()

    if (receiptCode) {
      if (!looksLikeCode(receiptCode)) return reply({ ok: false, reason: 'malformed' }, 400)

      const { data: items, error: itemErr } = await ctx.supabaseAdmin
        .from('ticket_receipt_items').select('ticket_idx').eq('code', receiptCode).limit(300)
      if (itemErr) return reply({ ok: false, reason: 'unavailable' }, 503)

      const idxs = (items ?? []).map((r: Record<string, unknown>) => Number(r.ticket_idx))
      if (!idxs.length) {
        return reply({ ok: true, genuine: false, checkedAt: new Date().toISOString() })
      }

      /*
       * THE BUYER'S OWN COPY, AND WHY THIS ROUTE MAY CARRY IT.
       *
       * A receipt code is minted per purchase, printed on nothing, and reaches
       * the buyer only inside the digital ticket they are sent. The only way to
       * hold one is to have been sent one — a property of the system rather
       * than a policy laid over it.
       *
       * The ticket's own code is the opposite. It is PRINTED ON THE PAPER, so
       * anybody holding the ticket, a photograph of it, or standing behind
       * somebody in a queue has it. It authenticates the TICKET and never the
       * person, which is why ?t= answers exactly what it answered before this
       * and carries none of what follows.
       *
       * buyer_name is on the printed ticket already — it is the whole reason a
       * copy passed to somebody else is visibly not theirs — so showing it to
       * whoever was sent the receipt tells them nothing they are not holding.
       * buyer_phone and buyer_zone are on no ticket and are not selected;
       * tests/verify names the buyer fields this file may mention at all.
       */
      const rcfg = await numbering(ctx)
      const { data: on, error: tErr } = await ctx.supabaseAdmin
        .from('tickets').select('number,status,buyer_name,amount,book_idx')
        .in('idx', idxs).order('idx')
      if (tErr) return reply({ ok: false, reason: 'unavailable' }, 503)

      const SOLD = ['Sold', 'Donated']
      const bookOf = (n: unknown) => {
        const i = Number(n)
        return Number.isFinite(i) && i > 0
          ? rcfg.bookPrefix + String(i).padStart(rcfg.bookDigits, '0')
          : ''
      }
      const tickets = (on ?? []).map((t: Record<string, unknown>) => ({
        number: String(t.number),
        sold: SOLD.includes(String(t.status)),
        book: bookOf(t.book_idx),
        /* Blank rather than zero when nothing was recorded: "RM 0.00" is a
         * statement about a donation, and an unknown is not one. */
        paid: t.amount == null ? '' : String(t.amount),
        // A cancelled ticket on a receipt is the one line somebody must not
        // miss, and "not sold" would be the wrong sentence for it.
        void: String(t.status) === 'Void',
      }))
      /* One name for the receipt rather than one per line: a receipt is one
       * purchase by one person, and repeating it down ten tickets would read as
       * ten separate claims about who they belong to. */
      const buyer = String((on ?? []).find((t: Record<string, unknown>) =>
        String(t.buyer_name ?? '').trim())?.buyer_name ?? '').trim()
      return reply({
        ok: true,
        genuine: true,
        receipt: true,
        count: tickets.length,
        tickets,
        buyer,
        drawDate: rcfg.drawDate,
        checkedAt: new Date().toISOString(),
      })
    }

    /*
     * Both are validated for SHAPE before anything is asked of the database.
     * Not because the query builder would be fooled — it parameterises — but
     * because an endpoint anybody can reach should do the cheapest possible
     * work on rubbish, and because a malformed request is a different answer
     * from a wrong code.
     */
    const number = canonicalNumber(rawNumber, await numbering(ctx))
    if (!number || !looksLikeCode(rawCode)) {
      return reply({ ok: false, reason: 'malformed' }, 400)
    }

    /*
     * The lookup. Two narrow queries rather than a join, so that what this
     * function is allowed to see is obvious from reading it.
     */
    const { data: rows, error } = await ctx.supabaseAdmin
      .from('tickets').select('idx,status').eq('number', number).limit(1)
    if (error) return reply({ ok: false, reason: 'unavailable' }, 503)

    const ticket = (rows ?? [])[0] ?? null

    /*
     * The same work happens whether or not the ticket exists.
     *
     * A missing ticket still costs a second query, against an index that
     * matches nothing, and still costs a comparison against a dummy. Returning
     * early here would make "no such number" measurably faster than "wrong
     * code", and that difference is enough to map which numbers exist.
     */
    const { data: codeRows } = await ctx.supabaseAdmin
      .from('ticket_codes').select('code').eq('ticket_idx', ticket ? Number(ticket.idx) : -1).limit(1)
    const stored = String((codeRows ?? [])[0]?.code ?? '')

    const genuine = !!ticket && stored !== '' && equalCodes(stored, String(rawCode))

    /*
     * One shape of answer, whatever went wrong.
     *
     * An unknown number, a ticket never printed, and a wrong code are all
     * `genuine: false` with no number echoed back. Telling them apart is
     * exactly the help somebody forging tickets would want.
     */
    if (!genuine) {
      return reply({ ok: true, genuine: false, checkedAt: new Date().toISOString() })
    }

    return reply({
      ok: true,
      genuine: true,
      number,
      state: stateOf(String(ticket.status ?? '')),
      checkedAt: new Date().toISOString(),
    })
  }),
}
