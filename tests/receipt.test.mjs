/*
 * A RECEIPT: ONE CODE FOR THE TICKETS ONE BUYER TOOK.
 *
 * A buyer who takes ten tickets is given ten pictures and ten QR codes, and the
 * thing they actually hold — "these ones are mine" — is represented nowhere.
 * They cannot check them in one go, and neither can anybody standing beside
 * them at the draw.
 *
 * WHY THE LIST IS NOT IN THE QR, and the numbers are the argument rather than a
 * preference. The encoder is byte mode, versions 1 to 10. At the level the
 * ticket design ships — M — a version 10 code holds 213 bytes. The verify
 * address is about 39 of those, and each `KS-00123.ABCDEFGHJKMN` pair is 22:
 *
 *     ECC M   7 tickets      ECC L   10 tickets
 *
 * A book is ten. The commonest multiple sale in this raffle does not fit, and
 * level L would fit it only by giving up the error correction that keeps a QR
 * scanning after a month in a wallet. One code of fixed size holds any number.
 */
import { setEnv, loadModule } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const printing = await loadModule('printing.ts')

const ticket = (idx, over = {}) => ({
  idx, number: 'KS-' + String(idx).padStart(5, '0'), book_idx: 1,
  status: 'Sold', buyer_name: 'Ko Zaw', buyer_phone: '0125550100',
  sold_by_agent: 'A001', amount: 10, payment_status: 'Paid', version: 1, ...over,
})

const world = () => fakeDb({
  config: baseConfig({ TOTAL_TICKETS: '10', ACTIVE_TICKETS: '10', TICKETS_PER_BOOK: '10' }),
  tickets: Array.from({ length: 10 }, (_, i) => ticket(i + 1)),
  ticket_receipts: [],
  ticket_receipt_items: [],
})

const boss = { email: 'boss@x.com', role: 'admin', isAdmin: true, isSuperAdmin: true, agentId: null }
const codeOf = async (fn) => { try { await fn(); return 'no error' } catch (e) { return e.code } }

console.log('1. one code stands for the whole set')
{
  const w = world()
  const r = await printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00002', 'KS-00003'] }, boss, w.ctx)
  ok(r.created, 'it was minted')
  eq(r.count, 3, 'covering three tickets')
  ok(/^[0-9A-Z]{8,32}$/.test(r.code), `and the code looks like a code (${r.code})`)

  eq(w.table('ticket_receipts').length, 1, 'one header row')
  eq(w.table('ticket_receipt_items').length, 3, 'and one item per ticket')
  eq(w.table('ticket_receipts')[0].created_by, 'boss@x.com', 'naming who issued it')
}

console.log('2. the same set gives the same code, because a buyer holds one receipt')
{
  const w = world()
  const first = await printing.makeReceipt({ ticketNumbers: ['KS-00001', 'KS-00002'] }, boss, w.ctx)
  // Sent again, in a different order, with a repeat in it — all the same set.
  const again = await printing.makeReceipt(
    { ticketNumbers: ['KS-00002', 'KS-00001', 'KS-00002'] }, boss, w.ctx)
  eq(again.code, first.code, 'the same receipt comes back')
  ok(!again.created, 'rather than a second one being minted')
  eq(w.table('ticket_receipts').length, 1, 'and there is still one')

  /*
   * A DIFFERENT SET IS A DIFFERENT RECEIPT, and the subset is the case that
   * would be wrong to reuse: handing back the two-ticket receipt for a request
   * covering one of them would give the buyer a document claiming a ticket they
   * did not ask about.
   */
  const subset = await printing.makeReceipt({ ticketNumbers: ['KS-00001'] }, boss, w.ctx)
  ok(subset.code !== first.code, 'a subset gets its own')
  const superset = await printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00002', 'KS-00003'] }, boss, w.ctx)
  ok(superset.code !== first.code, 'and so does a superset')
  eq(w.table('ticket_receipts').length, 3, 'three distinct sets, three receipts')
}

console.log('3. a receipt is what a buyer gets after they have paid')
{
  const w = world()
  Object.assign(w.db.tables.tickets.find((t) => t.number === 'KS-00004'),
                { status: 'Available', buyer_name: '', payment_status: '' })
  eq(await codeOf(() => printing.makeReceipt(
    { ticketNumbers: ['KS-00003', 'KS-00004'] }, boss, w.ctx)), 'NOT_SOLD',
     'a ticket nobody has bought cannot be on one — it would be a document asserting a sale')
  eq(w.table('ticket_receipts').length, 0, 'and nothing was written')

  eq(await codeOf(() => printing.makeReceipt({ ticketNumbers: ['KS-99999'] }, boss, w.ctx)),
     'TICKET_NOT_FOUND', 'nor can a number that is not a ticket in this raffle')
  eq(await codeOf(() => printing.makeReceipt({ ticketNumbers: [] }, boss, w.ctx)),
     'MISSING_FIELD', 'and an empty receipt is not a receipt')
}

console.log('4. the public endpoint answers for every ticket on it, and says nothing else')
{
  /*
   * Read from the source rather than run, for the reason verify.test.mjs gives:
   * the dangerous version of that file is the one that works perfectly and
   * returns one field too many. What a receipt adds to the reply is the same
   * two facts a single ticket's answer carries, per line.
   */
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../supabase/functions/verify/index.ts', import.meta.url), 'utf8')
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  ok(/ticket_receipt_items/.test(body), 'it reads the receipt\'s ticket list')
  ok(/number: String\(t\.number\)/.test(body) && /sold: SOLD\.includes/.test(body),
     'and answers with the number and whether it is recorded sold')
  for (const forbidden of ['buyer_', 'phone', 'sold_by', 'agents']) {
    ok(!body.includes(forbidden), `and never mentions ${forbidden}, for a receipt or anything else`)
  }
  // An unknown receipt answers like a wrong one: telling them apart is help for
  // somebody guessing codes.
  ok(/if \(!idxs\.length\) \{[\s\S]{0,120}genuine: false/.test(body),
     'an unknown code is refused in the same shape as a wrong one')
}

console.log('5. the page can be reached both ways, and draws the list')
{
  const { readFileSync } = await import('node:fs')
  const main = readFileSync(new URL('../src/verify/main.js', import.meta.url), 'utf8')
  ok(/searchParams\.get\('r'\)/.test(main), 'a typed ?r=CODE reaches it')
  ok(/raw\.includes\('\.'\)/.test(main), 'and the compact r.CODE the QR carries')
  ok(/body\.receipt/.test(main), 'the reply is recognised as a receipt')
  ok(/anyVoid \? 'warn' : 'good'/.test(main),
     'and a cancelled ticket on it is not shown under a green tick')

  const strings = readFileSync(new URL('../src/verify/strings.js', import.meta.url), 'utf8')
  for (const key of ['receiptGenuine', 'receiptCount']) {
    const both = new RegExp(key + ": \\{ en: '[^']+', my: '[^']+' \\}")
    ok(both.test(strings), `${key} is written in both languages`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
