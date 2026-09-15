/*
 * The correction payload reaches both backends.
 *
 * THE BUG. correct_ticket sent Buyer_Name and Buyer_Phone, the sheet's column
 * names, which Apps Script reads. The Supabase port read buyerName and
 * buyerPhone. Neither spelling was wrong; they simply differed. On Supabase the
 * correction supplied nothing the server recognised, the patch came out empty,
 * and it returned "No changed fields were supplied" — true, unhelpful, and it
 * blames the person typing. Supabase is the deployed default, so correcting a
 * ticket had been dead for every user since the cutover.
 *
 * Fifth field-shape failure in this repo in a day, and the first on the WRITE
 * side. A bad read shows as an empty screen; an ignored write looks exactly
 * like a write refused for a good reason, which is why this one survived.
 * Both backends agree on buyerName for a SALE, so selling worked and only
 * correcting broke — which is why nobody noticed.
 *
 * WHY THIS IS NARROW, deliberately. I tried the general version: every key the
 * client sends, checked against both handlers, following delegation one level
 * because issueBooks hands its payload to resolveBooks. It passed — and then
 * failed to catch a single one of three mutants, including the exact bug it was
 * written for. Widening the search widened what counts as a match until any key
 * appeared somewhere in the reachable source. kcho-shelter-18 hit the same wall
 * with a whole-file sweep that would have passed BEFORE the fix, because
 * 'Buyer_Name' occurs in WIRE_FIELDS.
 *
 * So this asserts one thing sharply instead of everything loosely. A test with
 * no teeth is worse than no test: it makes the gap look covered. The general
 * check is a real gap and it is still open — it wants the handlers' actual
 * parameter reads, which means parsing, not grep.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

const client = read('../src/components/SellTicket.vue')
const gs = read('../apps_script/Tickets.gs')
const ts = read('../supabase/functions/api/tickets.ts')

/** The payload object the client passes for a given action. */
function payloadFor(action) {
  const at = client.indexOf(`'${action}'`)
  if (at < 0) return null
  const open = client.indexOf('{', at)
  let depth = 0, i = open
  for (; i < client.length; i++) {
    if (client[i] === '{') depth++
    else if (client[i] === '}' && --depth === 0) break
  }
  return client.slice(open, i + 1)
}

console.log('both spellings are read from the backends, not retyped here')
const gsAllowed = (gs.match(/var allowed = \[([^\]]*)\]/) || [null, ''])[1]
  .match(/'([A-Za-z_]+)'/g)?.map(x => x.replace(/'/g, '')) ?? []
const tsAllowed = [...((ts.match(/const allowed = \{([\s\S]*?)\} as const/) || [null, ''])[1])
  .matchAll(/(\w+):\s*'[a-z_]+'/g)].map(m => m[1])
ok(gsAllowed.includes('Buyer_Name'), `Apps Script reads the sheet spelling (${gsAllowed.length} fields)`)
ok(tsAllowed.includes('buyerName'), `Supabase reads camelCase (${tsAllowed.length} fields)`)

console.log('a correction carries a spelling each backend recognises')
{
  const p = payloadFor('correct_ticket')
  ok(!!p, 'the correction payload was found')
  for (const k of ['Buyer_Name', 'Buyer_Phone']) {
    ok(gsAllowed.includes(k), `${k} is in Apps Script's allowed list`)
    ok(p.includes(`${k}:`), `and the client sends it — without it, Apps Script ignores the fix`)
  }
  for (const k of ['buyerName', 'buyerPhone']) {
    ok(tsAllowed.includes(k), `${k} is in Supabase's allowed list`)
    ok(p.includes(`${k}:`), `and the client sends it — without it, Supabase returns NOTHING_TO_DO`)
  }
}

console.log('the port accepts the sheet spelling too, so the duplication can end')
// When this passes, the Buyer_* keys can come out of the client — but only once
// the port is DEPLOYED, not merely written. Removing them early puts corrections
// back to silently doing nothing.
for (const k of ['Buyer_Name', 'Buyer_Phone', 'Buyer_Zone']) {
  ok(tsAllowed.includes(k), `Supabase also accepts ${k}`)
}

console.log('and widening the input did not widen a hole')
{
  // An ordinary admin could once void a ticket through a correction, logged as
  // CORRECT rather than VOID, so the audit trail did not show a ticket leaving
  // the draw. The guard that stops it must read BOTH spellings, or adding
  // Status as an alias walks a helper straight past it.
  ok(/p\.status !== undefined/.test(ts) && /p\.Status !== undefined/.test(ts),
     'the status guard reads both spellings, not just the one it was written for')
}

console.log('a sale needs one spelling, because both backends agree there')
{
  const p = payloadFor('sell_ticket')
  ok(/buyerName:/.test(p), 'the sale sends buyerName')
  ok(/requireField_\(payload, 'buyerName'\)/.test(gs), 'which is what Apps Script asks for')
  ok(!/Buyer_Name:/.test(p), 'and does not need the sheet spelling')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
