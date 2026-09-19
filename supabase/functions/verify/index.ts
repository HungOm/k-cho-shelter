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
