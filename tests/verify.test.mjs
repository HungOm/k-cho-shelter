/*
 * THE ONE ENDPOINT ANYBODY CAN REACH.
 *
 * Everything else in this system is behind a signed-in session, twice over —
 * the platform checks a JWT and then gate.ts checks the person. This function
 * is behind neither, on purpose, because the people it serves are strangers in
 * a hall pointing a phone at a piece of paper.
 *
 * So the question this file asks is not mainly "does it work". It is "what can
 * it be made to tell somebody", and the answers have to hold for a caller who
 * is hostile, patient and scripted.
 *
 * FOUR PROPERTIES, and each has a way of quietly stopping being true:
 *
 *   1. It reveals no buyer. The dangerous version of this function is the one
 *      that works perfectly and returns one field too many, so the reply is
 *      checked AND the source is read.
 *   2. It cannot be used to map the raffle. An unknown number, a ticket never
 *      printed and a wrong code must be indistinguishable — not merely all
 *      false, but the same bytes, or the differences are a search tool.
 *   3. It writes nothing. A public endpoint that writes is a public endpoint
 *      that can be made to fill a table.
 *   4. It answers about the ticket in front of the person: genuine or not, and
 *      whether the raffle has it recorded as sold.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

const ROOT = fileURLToPath(new URL('../', import.meta.url))

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const verify = (await loadModule('../verify/index.ts')).default

const GOOD = 'ABCDEFGH01234567'

/*
 * A raffle with four tickets in known states, and buyer details on them — which
 * are there precisely so that a leak has something to leak.
 */
function world(cfg = {}) {
  return fakeDb({
    config: baseConfig({ TICKET_PREFIX: 'KS-', TICKET_DIGITS: '5', ...cfg }),
    tickets: [
      { idx: 1, number: 'KS-00001', book_idx: 1, status: 'Sold', version: 1,
        buyer_name: 'Daw Hla', buyer_phone: '0125550001', buyer_zone: 'Klang', notes: 'paid cash' },
      { idx: 2, number: 'KS-00002', book_idx: 1, status: 'Available', version: 1,
        buyer_name: '', buyer_phone: '', buyer_zone: '', notes: '' },
      { idx: 3, number: 'KS-00003', book_idx: 1, status: 'Void', version: 1,
        buyer_name: '', buyer_phone: '', buyer_zone: '', notes: '' },
      // Generated for nothing: exists, never printed, so it has no code.
      { idx: 4, number: 'KS-00004', book_idx: 1, status: 'Sold', version: 1,
        buyer_name: 'U Kyaw', buyer_phone: '0125550004', buyer_zone: 'Ipoh', notes: '' },
      /* A large supporter, for the holding below. Forty-one tickets at ten to
         a book is four books, which is Gold. */
      ...Array.from({ length: 41 }, (_, i) => ({
        idx: 100 + i, number: 'KS-' + String(100 + i).padStart(5, '0'),
        book_idx: 11 + Math.floor(i / 10), status: 'Sold', version: 1,
        buyer_name: 'Ma Nu', buyer_phone: '0125550041', buyer_zone: 'Kajang', notes: '',
      })),
    ],
    /* One receipt, standing for KS-00001 — the sold ticket above. Seeded at
     * construction rather than pushed later, because fakeDb builds its query
     * surface from the tables it is given and a table appended to afterwards is
     * not the one the handler reads. */
    /*
     * TWO CODES ON PURPOSE, AND THEY ARE NOW TWO DIFFERENT KINDS OF THING.
     *
     * RRRR... is a LEGACY receipt: minted per purchase, before a digital ticket
     * became one-per-buyer, so it has no buyer on it and a fixed list of items.
     * Every link of that shape already in somebody's chat has to go on
     * answering, and this is what proves it does.
     *
     * GGGG... is a HOLDING: a code against a telephone number AND a name,
     * covering whatever that buyer holds at the moment somebody scans. Nothing lists
     * what it covers. Its buyer holds forty-one tickets below, which is four
     * books, which is Gold — a band with a threshold on each side of it, so a
     * count taken from the wrong place cannot land there by accident.
     */
    ticket_receipts: [
      { code: 'RRRRRRRRRRRR', created_by: 'a@x.com', buyer_phone: '' },
      /* Both halves of the identity, because a buyer is both: one telephone
         number may belong to a household, and one name to two people. */
      { code: 'GGGGGGGGGGGG', created_by: 'a@x.com',
        buyer_phone: '0125550041', buyer_name: 'Ma Nu' },
    ],
    ticket_receipt_items: [
      { code: 'RRRRRRRRRRRR', ticket_idx: 1 },
    ],
    ticket_codes: [
      { ticket_idx: 1, code: GOOD, template_id: 'tpl-1', batch_id: 'b1' },
      { ticket_idx: 2, code: 'ZZZZZZZZ99999999', template_id: 'tpl-1', batch_id: 'b1' },
      { ticket_idx: 3, code: 'QQQQQQQQ11111111', template_id: 'tpl-1', batch_id: 'b1' },
    ],
  })
}

const call = async (w, query, init) => {
  const res = await verify.fetch(new Request('https://x.functions.supabase.co/verify' + query, init), w.ctx)
  return { res, body: await res.json() }
}

/*
 * ?about — SOMEWHERE TO REPORT A FORGERY, ASKED FOR SEPARATELY.
 *
 * A stranger whose ticket does not verify is the one visitor to this endpoint
 * with something to report and nobody to report it to. The organiser's own
 * published contacts answer that, and they are asked for on their own rather
 * than hung off a ticket's reply — which is what keeps the assertion above,
 * that a ticket carries exactly four facts plus ok, true.
 *
 * The separation earns its keep in the failure case: somebody whose lookup
 * errored still gets the contact block, because it does not share a fate with
 * the answer it sits under.
 *
 * THIS BLOCK RUNS FIRST ON PURPOSE. numbering() caches config in a module-level
 * variable for thirty seconds, so whichever call reaches it first decides what
 * every later call in this process sees. Placed lower down, this read the blank
 * config the ticket cases had already warmed and failed on four assertions that
 * were describing the cache rather than the code.
 */
console.log('the office contacts are asked for on their own')
{
  /*
   * These also feed the receipt view further down. numbering() caches config for
   * the process, so whatever the FIRST call sets is what every later call sees —
   * which makes this the only place the book numbering and the draw date can be
   * given to a test in this file.
   */
  const w = world({ ORG_NAME: 'CEAM Malaysia', ORG_PHONE: '03-1234 5678',
                    ORG_EMAIL: 'office@example.org', ORG_WEBSITE: 'https://example.org',
                    BOOK_PREFIX: 'Book-', BOOK_DIGITS: '4', DRAW_DATE: '2026-12-20' })
  const r = await call(w, '?about')
  eq(r.res.status, 200, 'it answers')
  eq(r.body.ok, true, 'and says so')
  eq(r.body.org?.name, 'CEAM Malaysia', 'the raffle names itself')
  eq(r.body.org?.tel, '03-1234 5678', 'the office number')
  eq(r.body.org?.email, 'office@example.org', 'the office email')
  eq(r.body.org?.site, 'https://example.org', 'and the site')

  /*
   * THE POINT OF A SEPARATE CALL. This reply must carry nothing about any
   * ticket — not a number, not a verdict, not a state. If it ever did, the
   * contact block would become a second route to the thing the rest of this
   * file exists to keep narrow.
   */
  eq(Object.keys(r.body).sort().join(), 'ok,org',
     'and nothing else at all — no ticket, no verdict, no state')
  for (const secret of ['KS-00001', 'genuine', 'state', 'Daw Hla', '0125550001']) {
    ok(!JSON.stringify(r.body).includes(secret), `no ${secret} on the about reply`)
  }
}

console.log('a genuine ticket verifies, and says what the raffle knows about it')
{
  const w = world()
  const sold = await call(w, `?t=KS-00001&c=${GOOD}`)
  eq(sold.res.status, 200, 'it answers')
  eq(sold.body.genuine, true, 'the ticket is genuine')
  eq(sold.body.number, 'KS-00001', 'and is named')
  eq(sold.body.state, 'sold', 'and the raffle has it as sold')
  ok(!!sold.body.checkedAt, 'with the time it was checked, so a screenshot cannot pass for a live check')

  const unsold = await call(w, '?t=KS-00002&c=ZZZZZZZZ99999999')
  eq(unsold.body.genuine, true, 'an unsold ticket is still a real ticket')
  eq(unsold.body.state, 'unsold', 'and says so — which is what tells a buyer their sale was never recorded')

  const voided = await call(w, '?t=KS-00003&c=QQQQQQQQ11111111')
  eq(voided.body.genuine, true, 'a cancelled ticket is genuine')
  eq(voided.body.state, 'void', 'and is reported as cancelled rather than as a forgery')
}

console.log('the short form the QR carries works the same way')
{
  const w = world()
  // Every character in a QR is a module, and a shorter payload prints coarser
  // and scans from further away on a worse camera.
  const compact = await call(w, `?KS-00001.${GOOD}`)
  eq(compact.body.genuine, true, 'the compact form verifies')
  eq(compact.body.number, 'KS-00001', 'and resolves the same ticket')

  // What somebody types off a torn stub has to reach the same ticket.
  const typed = await call(w, `?t=1&c=${GOOD}`)
  eq(typed.body.genuine, true, 'bare digits verify')
  eq(typed.body.number, 'KS-00001', 'and are turned into the stored number')
}

console.log('a forgery, an unknown ticket and an unprinted one are the SAME answer')
{
  const w = world()
  const wrongCode = await call(w, '?t=KS-00001&c=AAAAAAAA00000000')
  const unknown = await call(w, '?t=KS-09999&c=AAAAAAAA00000000')
  const neverPrinted = await call(w, '?t=KS-00004&c=AAAAAAAA00000000')

  eq(wrongCode.body.genuine, false, 'a real number with an invented code is not genuine')
  eq(unknown.body.genuine, false, 'a number that does not exist is not genuine')
  eq(neverPrinted.body.genuine, false, 'a ticket that was never printed is not genuine')

  /*
   * Byte for byte, less the timestamp. If these differed, a script could ask
   * about every number in sequence and learn which exist and which have been
   * printed — which is the map somebody forging tickets would start from.
   */
  const shape = (b) => JSON.stringify({ ...b, checkedAt: null })
  eq(shape(wrongCode.body), shape(unknown.body), 'a wrong code and an unknown number are indistinguishable')
  eq(shape(unknown.body), shape(neverPrinted.body), 'and so is a ticket that was never printed')
  eq(wrongCode.res.status, unknown.res.status, 'including the status code')

  // And the refusal must not echo the number back — that alone would confirm
  // the number was read, and with it the prefix and padding of the raffle.
  ok(!('number' in wrongCode.body), 'a refusal names no ticket')
  ok(!('state' in wrongCode.body), 'and says nothing about one')
}

console.log('nothing about a buyer can come out of it')
{
  const w = world()
  const sold = await call(w, `?t=KS-00001&c=${GOOD}`)
  const raw = JSON.stringify(sold.body)
  for (const secret of ['Daw Hla', '0125550001', 'Klang', 'paid cash']) {
    ok(!raw.includes(secret), `the reply does not contain ${JSON.stringify(secret)}`)
  }
  eq(Object.keys(sold.body).sort().join(), 'checkedAt,genuine,number,ok,state',
    'and carries exactly four facts plus ok — anything else is a field somebody added without thinking')
}

console.log('and the function is not even written to be able to')
{
  /*
   * A source check, not a behavioural one, and it is the more important of the
   * two. The dangerous version of this file is the one that passes every test
   * above and selects one column too many next month — a reply assertion only
   * catches what a fixture happens to contain.
   */
  const src = readFileSync(ROOT + 'supabase/functions/verify/index.ts', 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of ['agents', 'app_users', 'sold_by', 'notes', 'audit_log']) {
    ok(!code.includes(forbidden), `the verify function never mentions ${forbidden}`)
  }

  /*
   * TELEPHONE NUMBERS: THE ORGANISATION'S, AND NOBODY ELSE'S.
   *
   * This list used to contain the bare word 'phone', which forbade every
   * telephone number in the file including the raffle's own office number. That
   * bluntness was most of its value and it is not given up lightly — but it
   * also blocked the one number this page most needs. A stranger holding a
   * ticket that does not verify is offered "call the office", and until now
   * there was nothing for it to ring.
   *
   * Decided by the organiser on 2026-09-20, in those words: official contacts
   * only. So the rule is NARROWED, not loosened. 'buyer_' above already refuses
   * buyer_phone and buyer_name by prefix; what follows names the only phone-ish
   * identifiers this file may carry, and refuses every other one.
   *
   * NAMED RATHER THAN NEGATED, which is the whole point. "Everything except
   * buyer_phone" would admit `seller_phone`, `agent_phone`, `contact_phone` and
   * whatever the next column is called — this repository has paid for that
   * shape three times. A list of what MAY pass cannot admit a thing nobody
   * thought of.
   */
  /*
   * WHICH BUYER FIELDS MAY TRAVEL, AND THE REASON THEY MAY.
   *
   * `buyer_` was a flat ban, and it was right while every route here answered a
   * stranger. It stopped being right when the buyer's own copy arrived, because
   * the two routes present different tokens and deserve different answers:
   *
   *   ?t=NUMBER.CODE   the code is PRINTED ON THE TICKET. Anybody holding the
   *                    paper, a photograph of it, or standing behind somebody in
   *                    a queue has it. It authenticates the TICKET, never the
   *                    person, and its answer is unchanged: genuine, or not.
   *   ?r=RECEIPT       minted per purchase, printed on nothing, and delivered
   *                    only in the digital ticket the buyer is sent. The only
   *                    way to hold one is to have been sent one.
   *
   * So this is not "the public page may now show more". It is that a second
   * token exists which only the buyer has.
   *
   * NAMED, NOT NEGATED, for the reason ALLOWED_PHONE gives one screen down: a
   * ban on `buyer_phone` admits `seller_phone`, and this repository has paid for
   * that shape. `buyer_name` is on a printed ticket already — it is the whole
   * anti-copy argument — so showing it to somebody who was sent the receipt
   * tells them nothing they are not holding. `buyer_phone` and `buyer_zone` are
   * on no ticket and stay out.
   */
  const ALLOWED_BUYER = ['buyer_name']
  for (const m of code.matchAll(/buyer_[a-z_]+/g)) {
    ok(ALLOWED_BUYER.includes(m[0]),
       `${m[0]} is a buyer field this endpoint may carry — only buyer_name is`)
  }

  /*
   * What somebody paid, on the receipt route only. It is the sum on their own
   * receipt; ticketart.js already calls the digital ticket "the only receipt
   * they get" and prints it there.
   */
  const ALLOWED_MONEY = ['amount']
  for (const m of code.matchAll(/[a-z_]*amount[a-z_]*/gi)) {
    ok(ALLOWED_MONEY.includes(m[0]),
       `${m[0]} is a money field this endpoint may carry — only amount is`)
  }

  const ALLOWED_PHONE = ['ORG_PHONE', 'orgPhone']
  for (const m of code.matchAll(/[A-Za-z_]*[Pp]hone[A-Za-z_]*/g)) {
    ok(ALLOWED_PHONE.includes(m[0]),
       `${m[0]} is a telephone number this page may carry — only the raffle's own office number is`)
  }
  /*
   * THE TABLES IT MAY READ, AS A LIST THAT HAS TO BE EDITED ON PURPOSE.
   *
   * Three, and it used to be five. `ticket_receipts` and
   * `ticket_receipt_items` left the list when a digital ticket became one per
   * BUYER: answering one means asking whose code it is, which is a join on
   * `buyer_phone`, which this file may not write and the rule above refuses
   * it. That join moved into `holding_of`, a SECURITY DEFINER function, so the
   * telephone number never leaves the database and this file receives ticket
   * rows.
   *
   * The point of the list is that adding to it is a decision somebody writes
   * down rather than a line that slips in — so a table added here without a
   * sentence saying what it exposes is the thing to refuse in review.
   */
  const tables = [...code.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
  eq([...new Set(tables)].sort().join(),
    'config,ticket_codes,tickets',
    'it reads the numbering, the tickets and the codes — nothing else')

  /*
   * AND THE FUNCTIONS IT MAY CALL, FOR THE SAME REASON AND MORE SHARPLY.
   *
   * A SECURITY DEFINER function runs as its owner, so row-level security does
   * not answer for it: whatever it returns, this file gets. The list of tables
   * above is therefore only half the disclosure surface now, and an unlisted
   * rpc would be a hole the other half of this guard cannot see.
   */
  const rpcs = [...code.matchAll(/\.rpc\('([a-z_]+)'/g)].map((m) => m[1])
  eq([...new Set(rpcs)].sort().join(), 'holding_of',
    'and calls one function, which resolves a code to the tickets behind it')

  /*
   * WHAT THAT FUNCTION IS ALLOWED TO HAND BACK, read off its own declaration.
   *
   * This is where the disclosure now happens, so this is where it is pinned.
   * `ticket_receipts` holds `created_by` — an organiser's email, the only
   * identifying value in the table — and `tickets` holds a telephone number
   * and a zone. The function's `returns table (...)` is the list of what can
   * cross, and `buyer_name` is on it for the reason stated everywhere else:
   * it is printed on the paper the reader is holding.
   */
  const sql = readFileSync(new URL(
    '../supabase/migrations/20260921160000_a_live_holding_needs_nothing_to_keep_it_up_to_date.sql',
    import.meta.url), 'utf8')
  const returns = (sql.match(/create or replace function holding_of[\s\S]*?returns table \(([\s\S]*?)\)/) || [])[1] ?? ''
  const columns = [...returns.matchAll(/^\s*([a-z_]+)\s+/gm)].map((m) => m[1])
  eq(columns.sort().join(), 'amount,book_idx,buyer_name,idx,number,status',
    'and that function returns six columns, none of them a telephone number')
  ok(/security definer/.test(sql), 'it is the definer that makes the join possible')
  ok(/set search_path = public, pg_temp/.test(sql), 'with its search path pinned')
  ok(/revoke all on function holding_of\(text, integer\) from public/.test(sql),
    'and execute revoked from public, or the anon key could call it directly')
  // And it may not write.
  for (const write of ['.insert(', '.update(', '.upsert(', '.delete(']) {
    ok(!code.includes(write), `it never calls ${write} — a public endpoint that writes can be made to fill a table`)
  }
}

console.log('it writes nothing, whatever it is asked')
{
  const w = world()
  await call(w, `?t=KS-00001&c=${GOOD}`)
  await call(w, '?t=KS-09999&c=AAAAAAAA00000000')
  eq(w.db.writes.length, 0, 'not one row, on a hit or a miss')
}

console.log('rubbish is refused before the database is troubled')
{
  const w = world()
  for (const [q, what] of [
    ['', 'nothing at all'],
    ['?t=KS-00001', 'a number with no code'],
    [`?c=${GOOD}`, 'a code with no number'],
    ['?t=KS-00001&c=short', 'a code too short to be one'],
    ['?t=KS-00001&c=AAAAAAAA0000000!', 'a code with a character outside the alphabet'],
    ["?t=KS-1'%20or%201=1--&c=AAAAAAAA00000000", 'a number with punctuation in it'],
    [`?t=${'9'.repeat(60)}&c=${GOOD}`, 'an absurdly long number'],
  ]) {
    const r = await call(w, q)
    eq(r.res.status, 400, `${what} is refused`)
    eq(r.body.reason, 'malformed', 'as malformed rather than as a wrong code')
  }
  eq(w.db.writes.length, 0, 'and none of it touched the database')
}

console.log('only GET, and never cached')
{
  const w = world()
  const posted = await call(w, `?t=KS-00001&c=${GOOD}`, { method: 'POST' })
  eq(posted.res.status, 405, 'a POST is refused')

  const got = await call(w, `?t=KS-00001&c=${GOOD}`)
  /*
   * A ticket's state changes the moment it is sold. A proxy holding yesterday's
   * answer would tell a buyer their ticket is unsold, which is the one thing
   * they would act on.
   */
  eq(got.res.headers.get('Cache-Control'), 'no-store', 'the answer is never cached')
  eq(got.res.headers.get('X-Content-Type-Options'), 'nosniff', 'and is not sniffable')
}

console.log('it is deployed as the one function with the platform check off')
{
  const toml = readFileSync(ROOT + 'supabase/config.toml', 'utf8')
  ok(/\[functions\.verify\][\s\S]*verify_jwt = false/.test(toml),
    'supabase/config.toml turns verify_jwt off for this function')
  ok(/\[functions\.api\][\s\S]*?verify_jwt = true/.test(toml),
    'and leaves it ON for the api function, which is the one holding the phone numbers')
}

/*
 * BLANK CONTACTS ARE NOT TESTED HERE, and the reason is worth writing down so
 * nobody adds the case and watches it pass for the wrong reason. numbering()
 * caches config for CFG_TTL, 30 seconds, in a module-level variable — so a
 * second world() with a different config inside one test run is answered from
 * the first one's cache. A "blank" assertion placed after the filled one above
 * would read the filled values and fail; placed before it, it would pass and
 * then poison the filled case.
 *
 * The blank case belongs to the page anyway. `?? ''` here is trivially right;
 * what actually matters is whether a page given nothing renders a heading with
 * empty space under it, which reads as a page that failed to load rather than a
 * raffle that has not filled its details in. tests/verifypage owns that.
 */

/*
 * THE BUYER'S OWN COPY — AND THE TICKET ROUTE STILL CARRYING NONE OF IT.
 *
 * Two tokens, two answers. The ticket's code is printed on the paper, so anybody
 * holding it has it; it authenticates the ticket, never the person. A receipt
 * code is minted per purchase, printed on nothing, and delivered only inside the
 * digital ticket the buyer is sent.
 *
 * The second assertion here matters more than the first. If a buyer's name ever
 * appears on a ?t= answer, every ticket in a hall becomes a name somebody can
 * read off a stranger's paper — which is the disclosure this split exists to
 * prevent, and it would not be visible from the receipt view looking right.
 */
console.log("a receipt shows the buyer their own copy")
{
  const r = await call(world(), '?r=RRRRRRRRRRRR')
  eq(r.body.receipt, true, 'it is a receipt')
  eq(r.body.genuine, true, 'and it is genuine')
  eq(r.body.buyer, 'Daw Hla', 'issued to, from the ticket the receipt names')
  eq(r.body.tickets?.[0]?.book, 'Book-0001', 'the book, derived from the numbering')
  eq(r.body.drawDate, '2026-12-20', 'and the draw date')
  ok(r.body.tickets?.[0]?.paid !== undefined, 'with what was paid')
  /*
   * A LEGACY RECEIPT NAMES ONE TICKET, so the band worked out from it is the
   * bottom rung — which is the honest answer for the set that code covers. It
   * used to read a band FROZEN at mint; nothing has one now, because nothing
   * stores one. The field is present or absent, never empty: a `rank: ''`
   * would draw a medal with no name beside it.
   */
  eq(r.body.rank, 'friend', 'a legacy receipt is banded by the tickets it names')
  eq(r.body.rankTickets, 1, 'and by how many of them there are')
}

console.log('a holding is banded by what its buyer holds today')
{
  const r = await call(world(), '?r=GGGGGGGGGGGG')
  eq(r.body.rank, 'companion', 'the band, worked out from the tickets behind the code')
  eq(r.body.rankTickets, 41, 'and the count it was worked out from, so it can be checked')
  /*
   * THE COUNT AND THE BAND AGREE, AND THAT IS NEW.
   *
   * They could not before: the band was frozen at mint on the api side, and
   * `count` was whatever the receipt named — so a receipt for one ticket
   * legitimately said Gold. `holding_of` resolves the code to its buyer, so
   * both numbers now come from the same live answer. Forty-one is four books,
   * which is Gold, which has a threshold on each side of it: a count taken
   * from the wrong place would land on Silver or nothing, not here.
   */
  eq(r.body.count, 41, 'and the list is every ticket that buyer holds')
  eq(r.body.tickets?.length, 41, 'all of them, not a stored subset')
  eq(r.body.buyer, 'Ma Nu', 'issued to the buyer the code belongs to')
  /*
   * And the band must not have brought the rest of the row with it. created_by
   * is an organiser's email address and is the only identifying value in
   * ticket_receipts.
   */
  ok(!JSON.stringify(r.body).includes('a@x.com'), 'and no organiser email came with it')
}

console.log("and the printed code still shows a stranger none of it")
{
  const w = world()
  const sold = await call(w, `?t=KS-00001&c=${GOOD}`)
  eq(sold.body.genuine, true, 'the ticket verifies, as before')
  eq(Object.keys(sold.body).sort().join(), 'checkedAt,genuine,number,ok,state',
     'and carries exactly what it carried before the buyer view existed')
  /*
   * BOTH ASSERTIONS ARE LOAD-BEARING AND NEITHER IS ENOUGH ALONE. Checked by
   * running them against three bodies rather than by reasoning about them:
   *
   *   real     {ok,genuine,number,state,checkedAt}   keys pass, no leak
   *   leaking  the same plus buyer:'Daw Hla'         keys FAIL, leak seen
   *   empty    {}                                    keys FAIL, NO LEAK
   *
   * The empty row is the reason the line above this one exists. An absence
   * check passes just as happily against a handler that returns nothing at all,
   * so on its own it would call a completely broken endpoint private. The key
   * list is what proves the answer is still there; the names below are what
   * prove nothing joined it. Deleting either leaves a test that cannot fail for
   * the reason it was written.
   *
   * Named individually rather than by key count, because a field added under a
   * different name would pass a count and fail a person.
   */
  for (const secret of ['Daw Hla', '0125550001', 'Klang', 'paid cash', 'Book-0001', '2026-12-20']) {
    ok(!JSON.stringify(sold.body).includes(secret),
       `a stranger scanning a printed ticket does not learn ${JSON.stringify(secret)}`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
