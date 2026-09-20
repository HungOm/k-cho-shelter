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

/* The four ticket writes moved out of the sheet into lib/ticketsale.js when
   the dock beside the Find results started recording sales too — one set of
   rules, two presentations. The payloads are what this file is about and they
   went with them. */
const client = read('../src/lib/ticketsale.js')
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

console.log('the accepted field names are read from the handler, not retyped here')
const tsAllowed = [...((ts.match(/const allowed = \{([\s\S]*?)\} as const/) || [null, ''])[1])
  .matchAll(/(\w+):\s*'[a-z_]+'/g)].map(m => m[1])
ok(tsAllowed.includes('buyerName'), `the handler names its fields (${tsAllowed.length} of them)`)

console.log('a correction carries a spelling the handler recognises')
{
  /*
   * THIS USED TO BE ABOUT TWO SPELLINGS. The client sent `Buyer_Name` AND
   * `buyerName` on every correction, because the spreadsheet read the column
   * heading and the Edge Function read camelCase, and a payload carrying only
   * one of them was silently ignored by whichever backend it was not speaking
   * to. With one backend there is one spelling to get right.
   */
  const p = payloadFor('correct_ticket')
  ok(!!p, 'the correction payload was found')
  for (const k of ['buyerName', 'buyerPhone']) {
    ok(tsAllowed.includes(k), `${k} is in the handler's allowed list`)
    ok(p.includes(`${k}:`), `and the client sends it — without it, a correction returns NOTHING_TO_DO`)
  }
}

console.log('the sheet spellings are still accepted, and that is deliberate')
// They cost nothing to keep and they are the reason a correction sent by an old
// cached bundle still lands. The client no longer sends them; the handler still
// takes them.
for (const k of ['Buyer_Name', 'Buyer_Phone', 'Buyer_Zone']) {
  ok(tsAllowed.includes(k), `the handler still accepts ${k}`)
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

console.log('a sale sends one spelling and always did')
{
  const p = payloadFor('sell_ticket')
  ok(/buyerName:/.test(p), 'the sale sends buyerName')
  ok(!/Buyer_Name:/.test(p), 'and never needed the sheet spelling')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
