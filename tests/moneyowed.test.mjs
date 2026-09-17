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
import { cut } from './source.mjs'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const src = read('../src/components/Money.vue')
const ts = read('../supabase/functions/api/reports.ts')
// The decision is split out of the report, so "defined once" is asserted against
// the file that DEFINES it and "used" against the report that calls it.
const tsMoney = read('../supabase/functions/api/money.ts')

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
/*
 * WIDENED, and moved somewhere it is RUN.
 *
 * This used to grep for one spelling — `role === 'agent' && key !== agentId` —
 * which pinned the implementation rather than the rule, and went red when the
 * rule was made stronger rather than when it was broken. The scope is now
 * decided in one helper per backend, because it covers more than agents: a
 * helper sees their own line, a viewer gets totals and no names at all.
 *
 * So this asserts the decision is made in ONE place on each side, and
 * money.test.mjs asserts what that decision actually DOES, by calling both
 * handlers as each role. A grep cannot tell you a rule holds; it can only tell
 * you a string is present.
 */
/*
 * TWO DECISIONS NOW, NOT ONE, and that is the repair rather than a wrinkle.
 * "Whose name may I see" and "whose money is in my total" have different
 * answers for exactly one role — a viewer, who is trusted with the raffle's
 * figures and not with who is behind on them. One list cannot say both, and
 * while it tried, a viewer's Money screen read nought across the board.
 *
 * So what is asserted is that EACH question is answered in one place per
 * backend, and that the report sums by the totals one. Pointing the second at
 * the first would restore the bug and reads, in a diff, like removing a
 * duplicate.
 */
ok(/export function totalsAgents\(/.test(tsMoney) && /export function visibleAgents\(/.test(tsMoney),
   'each question is answered in one place — what one seller owes is not another seller\'s business')
ok(!/function (totalsAgents|visibleAgents)\(/.test(ts),
   'and the report does not keep a second opinion of its own')
ok(/const only = totalsAgents\(user\)/.test(ts),
   'and the outstanding report sums by whose money it is, not by whose name may be printed')
ok(/only && !only\.includes\(key\)/.test(ts),
   'and actually filters the rows by it')
// The table of debts is released by an allow-list on both sides. `!== 'totals'`
// was correct until a fourth scope existed, and then handed a helper every
// seller's line.
ok(/export function showsSellerNames\(/.test(tsMoney),
   'and who gets the ROWS is its own decision, spelled once')
ok(/showsSellerNames\(scope\) \? rows : \[\]/.test(ts),
   'and the report releases the table through it, rather than testing the scope by hand')

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

console.log('which tickets — the helper\'s own, read from what the device already has')
{
  // Code at both ends. This ended at the comment above telHref, so rewording
  // that prose would have silently changed the region — and a missing marker
  // slices to the end of the file rather than failing.
  const body = cut(src, 'const isPaid', 'function telHref', 'the paid test')
  const isPaid = new Function(`${body}; return isPaid`)()
  /*
   * TIGHTENED, because the loose version was the bug.
   *
   * This asserted that 'received' reads as paid, which it did — under
   * `/paid|received|in/i`. So did "Unpaid", because it contains "paid", and so
   * did anything containing "in". The only two values this system ever writes
   * are 'Paid' and 'Unpaid', so every sold ticket in the raffle rendered the
   * green chip and the column had no reachable state that said otherwise. A
   * screen about money that cannot say "no" is not reporting, it is decorating.
   */
  ok(isPaid({ payment: 'Paid' }) && isPaid({ payment: 'paid' }),
     'paid reads as paid, whatever the case')
  ok(!isPaid({ payment: 'Unpaid' }),
     'and UNPAID does not — it contains "paid", which is how this went wrong')
  ok(!isPaid({ payment: '' }) && !isPaid({}), 'blank reads as not paid, never as paid')
}
/*
 * THIS PINNED THE OPPOSITE RULE UNTIL THE RAFFLE OUTGREW IT.
 *
 * The seller's breakdown used to be built by filtering the ticket snapshot the
 * browser already held — deliberately, and the assertion below said so: "no
 * extra round trip". That is the right trade at fifty tickets and the wrong one
 * at ten thousand, which is the size this raffle actually runs at: every seller
 * expanded walked the whole raffle in memory, on the phone of whoever was
 * standing at the desk.
 *
 * So the detail is a request now, made when somebody opens a line and not
 * before, and what the screen holds is one row per seller. The old assertion is
 * not softened here, it is reversed — with the reason written down, because a
 * test that flips without one reads as a test somebody found inconvenient.
 */
/*
 * AND THE REQUEST MOVED WITH THE PANEL. The detail is a sheet now rather than a
 * row that grows — every other detail view in this app is one, and a statement
 * nested inside the table it belongs to pushed every other seller off the
 * screen. So the fetch lives where the panel lives, and "when somebody opens a
 * line" is now literally "when the component mounts": it cannot be built before
 * somebody opens it, which is a stronger guarantee than a call guarded by a
 * flag. The caching that went with the old guard went too, and deliberately —
 * a sheet that is closed and reopened should show the money as it is now, not
 * as it was the first time somebody looked at it this afternoon.
 */
const sheet = read('../src/components/modals/SellerMoney.vue')
ok(/api\('agent_statement'/.test(sheet),
   "a seller's detail is fetched by the sheet that shows it")
ok(/onMounted\(/.test(sheet), 'when it opens, and not before')
ok(!/api\('agent_statement'/.test(src),
   'and the screen behind it does not fetch anybody\'s')
ok(!/state\.tickets[\s\S]{0,200}t\.agent === agentId/.test(src),
   'and it is no longer assembled by walking every ticket on the device')
/*
 * MOVED TO isSold, which is where the two statuses live.
 *
 * This asserted the inline pair, so it pinned the one file allowed to spell it
 * out — soldlock.test.mjs carries Money.vue as its single exception for the
 * same reason. A donated ticket is as sold as a sold one, and the whole point
 * of the store's helper is that no screen gets to re-decide that. Asserting the
 * call keeps the rule; asserting the literal kept the exception.
 */
ok(/isSold\(t\)/.test(src), 'sold and donated only, from the one place that spells them')
ok(!/\['Sold', 'Donated'\]/.test(src), 'and not spelled out a second time here')
ok(/isPaid\(t\)/.test(src), 'each ticket says whether ITS money came in, not the seller\'s total')
ok(/state\.tickets/.test(src),
   "the helper's own record still comes from the device — it is their own rows, already here")

console.log('and the case the Books column reads as innocent')
ok(/agent\.outstanding > 0 && !agent\.booksOut/.test(sheet),
   'every book back and money still owed is called out — only true now booksOut counts books that are out')

console.log('a seller may not write money down, and is shown what happened to it instead')
{
  /*
   * TWO KINDS OF MONEY, AND ONLY ONE OF THEM IS THE SELLER'S TO WRITE.
   *
   * The cash a buyer puts in a seller's hand is recorded by the ticket: sold,
   * to whom, paid or not. That is theirs, in the books they carry.
   *
   * What they hand to an organiser is an act with two people in it, and the
   * registry used to let the seller write it: record_payment was open to
   * 'agent', and visibleAgents limits a non-admin to their own id — so the only
   * thing a seller could record was a hand-over to themselves. The balance
   * dropped, the ledger read as money in, and the only counterparty named was
   * the person who typed it.
   *
   * What replaces it is the report, which changes nothing until an organiser
   * accepts it — and then the organiser's name is on the row, which is what
   * makes it a receipt rather than a claim.
   */
  const idx = read('../supabase/functions/api/index.ts')
  const line = idx.slice(idx.indexOf('  record_payment: {'), idx.indexOf('  record_payment: {') + 200)
  ok(!/'agent'/.test(line), `a seller is not offered it at all (${line.split('\n')[0]})`)

  const mon = read('../supabase/functions/api/money.ts')
  ok(/HANDED_OVER_NOT_RECEIVED/.test(mon),
     'and recording your own hand-over is refused by name, whatever role you hold')
  ok(/!user\.isAdmin && agentId === String\(user\.agentId/.test(mon),
     'with the organiser exempt, because they are the person cash is handed to')

  // The screens stop offering what the server refuses, rather than letting the
  // refusal arrive after the press.
  for (const f of ['../src/components/Money.vue', '../src/components/modals/SellerMoney.vue']) {
    ok(/isAdmin\.value \|\| state\.user\?\.role === 'recorder'/.test(read(f)),
       `${f.split('/').pop()} offers it to whoever received the money, not to whoever handed it over`)
  }

  /*
   * AND THE RECEIPT, which is what a seller is owed in exchange for not being
   * able to write it. A line in a running balance says an amount and a date; a
   * receipt says who took it, when, how, and whether anything has happened to
   * it since — and that nobody, organiser included, can edit or delete it.
   */
  const sheet = read('../src/components/modals/SellerMoney.vue')
  ok(/function openReceipt/.test(sheet), 'a payment line opens its own receipt')
  ok(/Received by/.test(sheet) && /<Who :email="receipt\.receivedBy"/.test(sheet),
     'naming who received the money')
  ok(/undoneBy/.test(sheet), 'and saying so if it was later undone')
  ok(/Nobody can edit or delete this/.test(sheet),
     'with the immutability said outright, because that is what makes it worth relying on')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
