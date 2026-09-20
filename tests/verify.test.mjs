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
  const w = world({ ORG_NAME: 'CEAM Malaysia', ORG_PHONE: '03-1234 5678',
                    ORG_EMAIL: 'office@example.org', ORG_WEBSITE: 'https://example.org' })
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
  for (const forbidden of ['buyer_', 'agents', 'app_users', 'sold_by', 'amount', 'notes', 'audit_log']) {
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
  const ALLOWED_PHONE = ['ORG_PHONE', 'orgPhone']
  for (const m of code.matchAll(/[A-Za-z_]*[Pp]hone[A-Za-z_]*/g)) {
    ok(ALLOWED_PHONE.includes(m[0]),
       `${m[0]} is a telephone number this page may carry — only the raffle's own office number is`)
  }
  /*
   * THE TABLES IT MAY READ, AS A LIST THAT HAS TO BE EDITED ON PURPOSE.
   *
   * ticket_receipt_items joined it when a receipt — one code standing for the
   * tickets one buyer took — became scannable. It carries a code and a ticket
   * index and nothing else: no buyer, no telephone number, no seller, which is
   * why it is admissible here at all. What it feeds into the reply is the same
   * two facts a single ticket's answer carries, N times over.
   *
   * The point of the list is that adding to it is a decision somebody writes
   * down rather than a line that slips in — so a table added here without a
   * sentence saying what it exposes is the thing to refuse in review.
   */
  const tables = [...code.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
  eq([...new Set(tables)].sort().join(), 'config,ticket_codes,ticket_receipt_items,tickets',
    'it reads the numbering, the tickets, the codes and a receipt\'s ticket list — nothing else')
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

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
