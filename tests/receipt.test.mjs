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
import { readFileSync } from 'node:fs'
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
/*
 * WHAT A CODE ANSWERS WITH, asked the way the public check page asks it —
 * through `holding_of`, which resolves the code to its buyer inside the
 * database. Every assertion about what a digital ticket covers goes through
 * here rather than through a table, because a table is not where the answer
 * lives any more.
 */
const resolve = async (w, code) => {
  const { data } = await w.ctx.supabaseAdmin.rpc('holding_of', { p_code: code, p_limit: 1000 })
  return data ?? []
}

/*
 * A SECOND WORLD, because the model turns on WHOSE tickets these are and the
 * one above belongs entirely to one buyer. Six tickets to Ko Zaw, three to Ma
 * Nu, and one sold with no telephone number recorded — which is not a buyer
 * this can key on and has its own path.
 */
const crowd = () => fakeDb({
  config: baseConfig({ TOTAL_TICKETS: '10', ACTIVE_TICKETS: '10', TICKETS_PER_BOOK: '10' }),
  tickets: [
    ...Array.from({ length: 6 }, (_, i) => ticket(i + 1)),
    ...Array.from({ length: 3 }, (_, i) => ticket(i + 7, { buyer_name: 'Ma Nu', buyer_phone: '0125550200' })),
    ticket(10, { buyer_name: 'Walk-in', buyer_phone: '' }),
  ],
  ticket_receipts: [],
  ticket_receipt_items: [],
})

console.log('1. one code stands for everything that buyer holds')
{
  const w = world()
  /* Three named, ten written. The caller names SOME of a buyer's tickets; what
     gets published is the buyer's holding, which is what makes the link keep
     up with them rather than freezing at whatever the screen had loaded. */
  const r = await printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00002', 'KS-00003'] }, boss, w.ctx)
  ok(r.created, 'it was minted')
  eq(r.count, 10, 'covering every ticket the buyer holds, not the three named')
  ok(/^[0-9A-Z]{8,32}$/.test(r.code), `and the code looks like a code (${r.code})`)

  eq(w.table('ticket_receipts').length, 1, 'one header row')
  eq(w.table('ticket_receipts')[0].created_by, 'boss@x.com', 'naming who issued it')
  eq(w.table('ticket_receipts')[0].buyer_phone, '0125550100', 'and whose it is')
  /*
   * AND NOTHING ELSE IS WRITTEN. What the code covers is not stored: it is
   * resolved to the buyer and answered from `tickets` at the moment somebody
   * scans. An item list would be a second answer to that question, and it
   * would be the one that went stale.
   */
  eq(w.table('ticket_receipt_items').length, 0, 'and no list of what it covers')
  eq((await resolve(w, r.code)).length, 10, 'because the code answers with the buyer\'s ten')
}

/*
 * THE RULE THIS SECTION USED TO PIN WAS THE OPPOSITE ONE, and it is worth
 * saying why rather than quietly swapping the assertions.
 *
 * It read "the same SET gives the same code": an existing receipt covering
 * exactly these tickets came back, and a subset or a superset got its own.
 * That is correct for a receipt — a record of one purchase on one day — and it
 * is wrong for a digital ticket, which is one per BUYER and updated as they
 * buy more. Under the old rule a buyer who took a second book got a second
 * code, and their first link went on showing a subset of what they held: two
 * artefacts where the buyer believes there is one, which is the failure the
 * old rule was written to prevent, reached from the other side.
 *
 * So the subset and superset cases below now assert the reverse, deliberately.
 */
console.log('2. one code per buyer, and it survives the holding changing')
{
  const w = crowd()
  const first = await printing.makeReceipt({ ticketNumbers: ['KS-00001'] }, boss, w.ctx)
  eq(first.count, 6, 'one ticket named, six written')

  const again = await printing.makeReceipt(
    { ticketNumbers: ['KS-00002', 'KS-00001', 'KS-00002'] }, boss, w.ctx)
  eq(again.code, first.code, 'the same code comes back')
  ok(!again.created, 'rather than a second one being minted')
  eq(w.table('ticket_receipts').length, 1, 'and there is still one')

  /* A SUBSET AND A SUPERSET ARE THE SAME BUYER, so both are the same holding.
     This is the assertion that inverted; see the note above. */
  const subset = await printing.makeReceipt({ ticketNumbers: ['KS-00003'] }, boss, w.ctx)
  eq(subset.code, first.code, 'a subset of their tickets is still their digital ticket')
  const superset = await printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00002', 'KS-00003'] }, boss, w.ctx)
  eq(superset.code, first.code, 'and so is a superset')
  eq(w.table('ticket_receipts').length, 1, 'one buyer, one code, however it is asked for')

  /*
   * AND IT KEEPS UP. The buyer takes a seventh ticket and the SAME link now
   * covers seven — the items replaced, not appended to, which is the half a
   * stub would have let through.
   */
  Object.assign(w.db.tables.tickets.find((t) => t.number === 'KS-00010'),
                { buyer_name: 'Ko Zaw', buyer_phone: '0125550100' })
  /*
   * NOBODY HAD TO PRESS ANYTHING. The code is not asked for again here — the
   * link already in the buyer's chat is resolved exactly as a scan would
   * resolve it, and it answers with seven. That is the whole difference
   * between a stored set and a live one, and it is the assertion that would
   * have failed on every version of this before today.
   */
  eq((await resolve(w, first.code)).length, 7, 'the link already sent now answers with seven')

  /* And it shrinks the same way, which is the case a stored list would have
     got wrong while looking perfectly correct on the way up. */
  Object.assign(w.db.tables.tickets.find((t) => t.number === 'KS-00010'),
                { buyer_name: '', buyer_phone: '', status: 'Available' })
  eq((await resolve(w, first.code)).length, 6, 'a ticket that is no longer theirs comes off it')
  const asked = await printing.makeReceipt({ ticketNumbers: ['KS-00001'] }, boss, w.ctx)
  eq(asked.code, first.code, 'and the code is still the same code')
  eq(asked.count, 6, 'reporting what they hold now')
  eq(w.table('ticket_receipt_items').length, 0, 'with nothing written down about it')
}

console.log('2b. a digital ticket belongs to one buyer')
{
  const w = crowd()
  const mine = await printing.makeReceipt({ ticketNumbers: ['KS-00001'] }, boss, w.ctx)
  const theirs = await printing.makeReceipt({ ticketNumbers: ['KS-00007'] }, boss, w.ctx)
  ok(mine.code !== theirs.code, 'two buyers are two codes')
  eq(w.table('ticket_receipts').length, 2, 'and two rows')
  eq(theirs.count, 3, 'each covering only its own buyer')

  /*
   * REFUSED, NOT SPLIT AND NOT MERGED. A set spanning two buyers has no one
   * owner, and either way of resolving it silently is wrong: merged, each
   * buyer gets a link listing the other's tickets; split, the caller is told
   * one code was made when two were.
   */
  eq(await codeOf(() => printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00007'] }, boss, w.ctx)), 'MIXED_BUYERS',
     'tickets belonging to two buyers are refused')
  eq(w.table('ticket_receipts').length, 2, 'and nothing was written by the attempt')
}

console.log('2d. a buyer is a name AND a number, because a phone is shared')
{
  /*
   * A HOUSEHOLD OR A SHOP SHARES ONE TELEPHONE NUMBER. Keyed on the number
   * alone — which is what the first version of this did — everybody who bought
   * through that phone gets ONE digital ticket listing each other's tickets.
   * That is a disclosure: somebody scanning their own card would be shown what
   * their mother or the person behind the counter had bought.
   */
  const w = fakeDb({
    config: baseConfig({ TOTAL_TICKETS: '6', ACTIVE_TICKETS: '6', TICKETS_PER_BOOK: '10' }),
    tickets: [
      ticket(1), ticket(2),                                        // Ko Zaw
      ticket(3, { buyer_name: 'Ma Nu' }),                          // same phone
      ticket(4, { buyer_name: 'ko  zaw' }),                        // Ko Zaw, typed again
      ticket(5, { buyer_name: 'Ko Zaw ' }),                        // and again
      ticket(6, { buyer_name: 'Ma Nu' }),
    ],
    ticket_receipts: [],
    ticket_receipt_items: [],
  })
  const zaw = await printing.makeReceipt({ ticketNumbers: ['KS-00001'] }, boss, w.ctx)
  const nu = await printing.makeReceipt({ ticketNumbers: ['KS-00003'] }, boss, w.ctx)
  ok(zaw.code !== nu.code, 'two people on one telephone are two digital tickets')
  eq(w.table('ticket_receipts').length, 2, 'and two rows')

  /*
   * AND THE NAME IS COMPARED, NOT MATCHED. "Ko Zaw", "ko  zaw" and "Ko Zaw "
   * are one person every time — a name written on a phone, at a table, by
   * different sellers. Keyed on the literal text they would be three
   * holdings and three QR codes, which is the failure the whole model exists
   * to remove.
   */
  eq(zaw.count, 4, 'case and spacing do not split one buyer — all four are his')
  eq(nu.count, 2, 'and the other buyer keeps their own two')
  const again = await printing.makeReceipt({ ticketNumbers: ['KS-00004'] }, boss, w.ctx)
  eq(again.code, zaw.code, 'a ticket carrying the other spelling is the same holding')

  /* What the link answers with, which is the half a buyer actually sees. */
  const seen = (await resolve(w, zaw.code)).map((t) => t.number)
  eq(seen.join(), 'KS-00001,KS-00002,KS-00004,KS-00005', 'the link lists that buyer\'s four')
  ok(!seen.includes('KS-00003'), 'and never the other person on the same telephone')

  /* Named against each other rather than assumed: a set spanning both is one
     telephone number and two buyers, and must be refused like any other. */
  eq(await codeOf(() => printing.makeReceipt(
    { ticketNumbers: ['KS-00001', 'KS-00003'] }, boss, w.ctx)), 'MIXED_BUYERS',
     'and a set covering both is refused, one phone or not')
}

console.log('2e. the three folds of a name agree')
{
  /*
   * `buyer_key` in SQL, `buyerKey` in the api, `bkey` in the fake. Three
   * copies of one rule, and they decide whether a row already exists — so
   * disagreeing they would let two rows exist for one buyer, or refuse a row
   * for two. Checked against the inputs that actually occur rather than
   * asserted to be identical, because they are three languages.
   */
  const sql = readFileSync(new URL(
    '../supabase/migrations/20260921180000_a_buyer_is_a_name_and_a_number_together.sql',
    import.meta.url), 'utf8')
  ok(/lower\(btrim\(regexp_replace\(coalesce\(p_name, ''\), '\\s\+', ' ', 'g'\)\)\)/.test(sql),
    'the SQL folds case, collapses whitespace and trims')
  const shared = readFileSync(new URL(
    '../supabase/functions/_shared/holding.ts', import.meta.url), 'utf8')
  ok(/replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.toLowerCase\(\)/.test(shared),
    'and the api does the same three things in the same order')
  const client = readFileSync(new URL(
    '../src/components/modals/ViewTicket.vue', import.meta.url), 'utf8')
  ok(/replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.toLowerCase\(\)/.test(client),
    'and so does the screen that decides what to send')
}

console.log('2c. no telephone number is not an identity')
{
  const w = crowd()
  /*
   * There is nothing to key a holding on, so this keeps the old behaviour: a
   * one-off code for exactly the tickets named, with no buyer on the row.
   * Pooling every phone-less sale under one shared code would hand strangers
   * each other's ticket numbers — the same argument bandFor makes for refusing
   * to band them.
   */
  const one = await printing.makeReceipt({ ticketNumbers: ['KS-00010'] }, boss, w.ctx)
  eq(one.count, 1, 'exactly what was named, never widened')
  eq(w.table('ticket_receipts')[0].buyer_phone ?? '', '', 'and no buyer on the row')
  const two = await printing.makeReceipt({ ticketNumbers: ['KS-00010'] }, boss, w.ctx)
  ok(two.code !== one.code, 'there is nothing to recognise it by, so it is not reused')
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

  /*
   * IT ASKS A FUNCTION, AND THAT IS THE POINT OF THE FUNCTION.
   *
   * Answering a digital ticket means asking whose code it is — a join on
   * `buyer_phone`, which this file may not write and the guard below refuses
   * it. `holding_of` does that join behind SECURITY DEFINER and hands back
   * ticket rows, so the set is resolved LIVE and the telephone number never
   * leaves the database. A version of this file that went back to reading a
   * stored item list would be reading something that had gone stale.
   */
  ok(/holding_of/.test(body), 'it resolves the code through holding_of')
  ok(!/ticket_receipt_items/.test(body), 'and never from a stored list of what it covered')
  ok(/number: String\(t\.number\)/.test(body) && /sold: SOLD\.includes/.test(body),
     'and answers with the number and whether it is recorded sold')
  /*
   * NAMED, NOT NEGATED — and this guard caught its own author, which is the best
   * argument for the conversion there is.
   *
   * A flat ban on `buyer_` was right while every route here answered a stranger.
   * It stopped being right when the buyer's own copy arrived on the receipt
   * route, and then it failed for a reason that had nothing to do with what it
   * exists to prevent: `?t=` had not changed at all.
   *
   * The deeper problem is that a source scan cannot see routes. It reads one
   * file answering two questions, so "this string is absent" cannot mean
   * "absent from the ticket reply". What it CAN do is name the fields the file
   * may mention at all, and leave which-reply-carries-which to the response
   * assertions in tests/verify, which check the ?t= body key by key and would
   * fail the day buyer_name joined it.
   *
   * Do not add `buyer_` to an exceptions list here. The guard reads text, so an
   * exception on the prefix re-admits every buyer field on every route, which is
   * the hole the named form exists to close.
   */
  const ALLOWED_BUYER = ['buyer_name']
  for (const m of body.matchAll(/buyer_[a-z_]+/g)) {
    ok(ALLOWED_BUYER.includes(m[0]),
       `${m[0]} is a buyer field this function may mention — only buyer_name is`)
  }
  for (const forbidden of ['sold_by', 'agents']) {
    ok(!body.includes(forbidden), `and never mentions ${forbidden}, for a receipt or anything else`)
  }
  /* Lower-case only, deliberately: ORG_PHONE is the raffle's own published
   * office number and travels on ?about. A buyer's or a seller's does not. */
  for (const m of body.matchAll(/[a-z_]*phone[a-z_]*/g)) {
    ok(false, `${m[0]} is a telephone number this function may not carry`)
  }
  // An unknown receipt answers like a wrong one: telling them apart is help for
  // somebody guessing codes.
  ok(/if \(!rows\.length\) \{[\s\S]{0,120}genuine: false/.test(body),
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
