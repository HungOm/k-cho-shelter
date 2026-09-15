/*
 * "Who owes, and which tickets" — answered on the screen that asks it.
 *
 * WHAT WENT WRONG. The Money table showed amounts owed by NOBODY: seller, books
 * and sold were blank, because the two backends described this report
 * differently and the client reads Apps Script's names. The money columns
 * happened to match, so the table looked populated and authoritative while
 * failing at the one thing it exists for.
 *
 * I patched it in the client with a normalise() that read both spellings, and
 * labelled it a stopgap. It is now deleted: the port returns the shape it
 * promised. Past the names there were three more holes — booksOut counted every
 * book the seller had ever touched rather than the ones still out, phone and
 * booksSettled were absent, and the per-seller scoping was dropped so any
 * seller calling this got every other seller's debts. normalise() had carried
 * the wrong book count across faithfully, which is what a stopgap does: it
 * makes the screen look answered and stops anybody asking.
 *
 * SO THIS TEST IS THE CLIENT END OF THE CONTRACT. Every key this screen reads
 * off a report row, checked against the keys BOTH handlers actually construct —
 * parsed from their sources, not from a list kept here that would rot. A list
 * written down twice is the bug this file exists to catch, so it is not written
 * down twice.
 *
 * The row identifier in this component is `a`, which is why ticketsFor's sort
 * params are x and y: `a.number` on a ticket would have made the scan report
 * keys the wire never promised — the "matches too much" instrument, which is
 * worse than no instrument because it trains you to ignore it.
 */
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const src = read('../src/components/Money.vue')
const gs = read('../apps_script/Reports.gs')
const ts = read('../supabase/functions/api/reports.ts')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/** The keys an object literal builds, taken from the source that builds it. */
function literalKeys(text, open, close) {
  const i = text.indexOf(open)
  if (i < 0) return new Set()
  const body = text.slice(i + open.length, text.indexOf(close, i + open.length))
  return new Set([...body.matchAll(/(\w+)\s*:/g)].map(m => m[1]))
}

const built = {
  'Apps Script': literalKeys(gs, 'byAgent[r.agentId] = {', '};'),
  Supabase: literalKeys(ts, 'byAgent.get(key) ?? {', '\n    }')
}
// A parse that found nothing would pass every check below by vacuity.
for (const [who, keys] of Object.entries(built)) {
  ok(keys.size >= 8, `${who}'s row literal parsed (${keys.size} keys)`)
  ok(keys.has('outstanding'), `${who} builds the number the screen is named after`)
}

console.log('every key the screen reads is a key both backends build')
{
  const readKeys = [...new Set([...src.matchAll(/(?<![\w.])a\.(\w+)/g)].map(m => m[1]))]
  ok(readKeys.length >= 8, `the scan found the row reads (${readKeys.length})`)
  for (const k of readKeys) {
    for (const [who, keys] of Object.entries(built)) {
      ok(keys.has(k), `${who} builds ${k}, which the screen reads`)
    }
  }
  // Named individually as well: a rename that hid a key from the scan AND from
  // the handler would otherwise agree with itself and pass.
  for (const k of ['name', 'phone', 'booksOut', 'ticketsSold', 'overdueBooks', 'outstanding']) {
    ok(readKeys.includes(k), `the screen still reads ${k}`)
  }
}

console.log('the per-seller scoping the port dropped')
ok(/role === ROLES\.AGENT && r\.agentId !== user\.agentId/.test(gs),
   'Apps Script shows a seller their own line only')
ok(/role === 'agent' && key !== user\.agentId/.test(ts),
   'and so does Supabase — what one seller owes is not another seller\'s business')

console.log('the stopgap is gone, not merely unused')
ok(!/normalise/.test(src), 'no second spelling of the wire shape in the client')
ok(!/agentMap/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
   'and no seller-list fallback papering over a field the report should carry')

console.log('the chase button uses the number the report carries')
{
  const body = src.slice(src.indexOf('function waLink'), src.indexOf('</script>'))
  const { waNumber, isDialable } = await import('../src/lib/search.js')
  const waLink = new Function('money', 'currency', 'waNumber', 'isDialable',
    `${body}; return waLink`)(
    (n, c) => `${c}${n.toFixed(2)}`, { value: 'RM' }, waNumber, isDialable)

  const link = waLink({ name: 'JOHN', phone: '+60 12-345 6789', outstanding: 20, ticketsSold: 11 })
  ok(link.startsWith('https://wa.me/60123456789?text='), 'the report\'s own phone, dialling-cleaned')
  const msg = decodeURIComponent(link.split('text=')[1])
  ok(msg.includes('JOHN') && msg.includes('RM20.00') && msg.includes('11 tickets'),
     'and the message already says who, how much and from how many tickets')
  const telBody = src.slice(src.indexOf('function telHref'), src.indexOf('function waLink'))
  const telHref = new Function(`${telBody}; return telHref`)()
  ok(telHref('+60 12-555 0011') === 'tel:+60125550011',
     'the dialled number loses the spaces and dashes but keeps the country code')

  ok(waLink({ name: 'JOHN', phone: '', outstanding: 20, ticketsSold: 1 }) === '',
     'no number on file produces no link, so the screen says so instead of offering a dead one')
  // The live raffle's actual state: four sellers whose leading zero was lost.
  // wa.me reads 123367462 as country code 1, so the link worked and reached
  // North America — and looked exactly like a link that works.
  ok(waLink({ name: 'JOHN', phone: '123367462', outstanding: 20, ticketsSold: 1 }) === '',
     'and neither does a number whose country we would be guessing at')
  const one = decodeURIComponent(
    waLink({ name: 'J', phone: '0123456789', outstanding: 20, ticketsSold: 1 }).split('text=')[1])
  ok(one.includes('1 ticket.') && !one.includes('1 tickets'), 'one ticket is not "1 tickets"')
}

console.log('which tickets, read from what the device already has')
{
  const body = src.slice(src.indexOf('const isPaid'), src.indexOf('/*\n * The number comes'))
  const isPaid = new Function(`${body}; return isPaid`)()
  ok(isPaid({ payment: 'Paid' }) && isPaid({ payment: 'received' }), 'money in reads as in')
  ok(!isPaid({ payment: '' }) && !isPaid({}), 'and blank reads as not in, never as paid')
}
ok(/t\.agent === agentId/.test(src), 'the breakdown is the seller\'s own tickets')
ok(/\['Sold', 'Donated'\]\.includes\(t\.status\)/.test(src), 'sold and donated only')
ok(/isPaid\(t\)/.test(src), 'each ticket says whether ITS money came in, not the seller\'s total')
ok(/state\.tickets/.test(src), 'read from tickets already on the device — no extra round trip')

console.log('and the case the Books column reads as innocent')
ok(/a\.outstanding > 0 && !a\.booksOut/.test(src),
   'every book back and money still owed is called out — only true now booksOut counts books that are out')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
