/*
 * DRAWING TICKETS FOR A PRINTER.
 *
 * The failure this is aimed at is a ticket that goes to a press and cannot be
 * proved. A ticket with no code is not printable — the verify page would call
 * it a forgery — so this refuses to hand one out and names it instead. Naming
 * rather than counting matters: the screen offers to generate exactly those,
 * and a count would make that offer a guess.
 *
 * AND ONE THING ABOUT PRIVACY. A printed blank ticket has nobody's name on it,
 * and the organiser running off a book does not need one. The reply carries the
 * number, the status and the code, and no buyer — asserted below, because this
 * is the one action that hands ticket codes to a browser and the temptation to
 * add "and who bought it, while we are here" will come.
 */
import { setEnv, loadModule, cleanup } from './loadts.mjs'
import { fakeDb, baseConfig, users, codeOf, errOf } from './fakedb.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }

setEnv({ SUPER_ADMIN_EMAIL: 'boss@x.com' })
const printing = await loadModule('printing.ts')

const TEMPLATE = {
  id: 'tpl-1', name: 'Front', content_type: 'image/png',
  width_px: 1600, height_px: 517, url: 'https://x/art.png',
  design: { main: { capHeight: 21 } },
}

function world(opts = {}) {
  const tickets = []
  const books = []
  for (let b = 1; b <= 2; b++) {
    books.push({ idx: b, number: `Book-${String(b).padStart(4, '0')}`, status: 'Unassigned' })
    for (let t = 1; t <= 10; t++) {
      const idx = (b - 1) * 10 + t
      tickets.push({
        idx, number: `KS-${String(idx).padStart(5, '0')}`, book_idx: b,
        status: idx === 1 ? 'Sold' : 'Available', version: 1,
        buyer_name: idx === 1 ? 'Daw Hla' : '', buyer_phone: idx === 1 ? '0125550001' : '',
        buyer_zone: idx === 1 ? 'Klang' : '', notes: idx === 1 ? 'paid cash' : '',
        sold_by_agent: idx === 1 ? 'A001' : null, amount: idx === 1 ? 10 : null,
      })
    }
  }
  return fakeDb({
    config: baseConfig({ TICKET_ARTWORK_ID: opts.noArtwork ? '' : 'tpl-1', TOTAL_TICKETS: '20', ...(opts.cfg ?? {}) }),
    tickets, books, audit_log: [],
    agents: [{ agent_id: 'A001', name: 'Daw Hla Seller', phone: '0125559999', active: true }],
    ticket_templates: opts.noTemplateRow ? [] : (opts.templates ?? [TEMPLATE]),
    ticket_codes: opts.codes ?? [],
  })
}
const render = (w, p) => printing.renderTickets(p, users.admin, w.ctx)
const generate = (w, p) => printing.generateTickets(p, users.admin, w.ctx)

/*
 * THREE STATES, NOT TWO, and the middle one is what a reset leaves behind.
 *
 * TICKET_ARTWORK_ID is in config and the picture is in ticket_templates, so
 * emptying config leaves a raffle holding artwork it can no longer name. That
 * used to report "There is no ticket artwork yet", which is false and sends
 * somebody to upload a second copy of what they already have.
 *
 * This block previously asserted the refusal for a world with an EMPTY id and
 * ONE template — which is not "no artwork", it is artwork that is not named.
 * The assertion was written from the code rather than from the situation.
 */
console.log('artwork the raffle holds is told apart from artwork it does not have')
{
  // Nothing at all: the only case where "there is none" is true.
  const none = world({ noArtwork: true, noTemplateRow: true })
  const e = await errOf(() => render(none, { book: 'Book-0001' }))
  eq(e.code, 'NO_TEMPLATE', 'with no templates at all it refuses')
  ok(/Ticket Studio/.test(e.message), 'and says where to fix it')

  // The setting names an artwork that has been removed — still nothing to draw
  // onto, and it says so rather than crashing on a null.
  const gone = world({ noTemplateRow: true })
  eq(await codeOf(() => render(gone, { book: 'Book-0001' })), 'NO_TEMPLATE',
    'an artwork that has been removed is the same refusal, not a crash')

  // ONE template and no id: adopted rather than refused, and written back so
  // the next read does not have to work it out again.
  const lone = world({ noArtwork: true })
  const drawn = await render(lone, { book: 'Book-0001' })
  ok(Array.isArray(drawn.notGenerated), 'one unnamed artwork is adopted, not refused')
  eq(lone.config('TICKET_ARTWORK_ID'), 'tpl-1',
     'and the setting is repaired, so it is named from then on')

  // SEVERAL and no id: choosing would be guessing which paper this prints on.
  const many = world({ noArtwork: true, templates: [TEMPLATE, { ...TEMPLATE, id: 'tpl-2' }] })
  const pick = await errOf(() => render(many, { book: 'Book-0001' }))
  eq(pick.code, 'NO_TEMPLATE_CHOSEN', 'several unnamed artworks are refused by name')
  ok(/none of them is the chosen one/.test(pick.message), 'and the refusal says why')
}

console.log('only tickets that have been generated can be drawn')
{
  const w = world()
  const empty = await render(w, { book: 'Book-0001' })
  eq(empty.tickets.length, 0, 'nothing generated, nothing to draw')
  eq(empty.notGenerated.length, 10, 'and all ten are named as needing it')
  ok(empty.notGenerated.includes('KS-00001'), 'by number, so the screen can offer exactly those')

  await generate(w, { book: 'Book-0001' })
  const full = await render(w, { book: 'Book-0001' })
  eq(full.tickets.length, 10, 'once generated, all ten draw')
  eq(full.notGenerated.length, 0, 'and none is missing')
  ok(full.tickets.every((t) => /^[0-9A-HJKMNP-TV-Z]{8,32}$/.test(t.code)), 'each carries its code')
  /*
   * AND WHICH BOOK IT CAME OUT OF, printed on the ticket. The number identifies
   * the ticket; the book is what a person is holding — stubs come back as a
   * book and a seller is handed books, so a ticket that does not say which one
   * has to be looked up before it can be filed.
   */
  ok(full.tickets.every((t) => t.book === 'Book-0001'), 'and the book it belongs to')
  eq(full.tickets[0].number, 'KS-00001', 'in ticket order, which is print order')
  eq(full.tickets[9].number, 'KS-00010', 'to the end of the book')
}

console.log('half a book generated is half a book drawn, and the rest named')
{
  const w = world()
  await generate(w, { numbers: ['KS-00001', 'KS-00002', 'KS-00003'] })
  const r = await render(w, { book: 'Book-0001' })
  eq(r.tickets.length, 3, 'the three that have codes')
  eq(r.notGenerated.length, 7, 'and the seven that do not')
  /*
   * The important half: it does NOT quietly generate the rest. Printing a book
   * has to be a decision somebody took, because a code minted by accident is a
   * code on a ticket nobody meant to print.
   */
  eq(w.table('ticket_codes').length, 3, 'and drawing generated nothing')
}

console.log('by default the reply carries no buyer at all')
{
  const w = world()
  await generate(w, { book: 'Book-0001' })
  const r = await render(w, { book: 'Book-0001' })
  const raw = JSON.stringify(r)
  for (const secret of ['Daw Hla', '0125550001', 'Klang', 'paid cash', 'A001']) {
    ok(!raw.includes(secret), `nothing about the buyer: ${JSON.stringify(secret)} is absent`)
  }
  eq(Object.keys(r.tickets[0]).sort().join(),
    'book,code,generatedAt,number,printedAt,status',
    'a ticket carries six facts and none of them is a person')

  /*
   * A blank book going out to a seller must print blank lines, and whoever is
   * running off a hundred of them has no reason to be handed a hundred phone
   * numbers. So the buyer is opt-in, and this is the assertion that keeps it so.
   */
  ok(r.tickets.every((t) => t.buyer === undefined), 'and no buyer object at all')
}

console.log('and carries it when asked, for sold tickets only')
{
  /*
   * The stub is printed with four ruled lines and a Burmese caption beside
   * each — name, phone, address, who sold it — meant to be filled in by hand.
   * For a ticket already recorded as sold the raffle knows all four, and
   * printing them saves somebody copying them out of the app onto paper they
   * will then have to read back off it.
   */
  const w = world()
  await generate(w, { book: 'Book-0001' })
  const r = await render(w, { book: 'Book-0001', withBuyer: true })

  const sold = r.tickets.find((t) => t.number === 'KS-00001')
  eq(sold.status, 'Sold', 'KS-00001 is the sold one in the fixture')
  eq(sold.buyer?.name, 'Daw Hla', 'the buyer\'s name comes through')
  eq(sold.buyer?.phone, '0125550001', 'and their phone')
  eq(sold.buyer?.address, 'Klang', 'and their area, which the stub calls an address')
  eq(sold.buyer?.seller, 'Daw Hla Seller', 'and who sold it, by name rather than by id')

  /*
   * THE HALF THAT MATTERS MORE. An unsold ticket has no buyer to print, and a
   * stub that carried the previous occupant of that row would be worse than a
   * blank one. Nine of the ten in this book are unsold.
   */
  const unsold = r.tickets.filter((t) => t.status !== 'Sold')
  eq(unsold.length, 9, 'nine of the ten are unsold')
  ok(unsold.every((t) => t.buyer === undefined), 'and not one of them carries a buyer')

  // The seller id never travels — the name is what a stub is filled in with.
  ok(!JSON.stringify(r).includes('"A001"'), 'the seller id stays on the server')
}

console.log('it hands over the artwork and where a scan should point')
{
  const w = world({ cfg: { VERIFY_URL: 'https://tickets.example.org/v' } })
  await generate(w, { book: 'Book-0001' })
  const r = await render(w, { book: 'Book-0001' })
  eq(r.template.id, 'tpl-1', 'the artwork in use')
  eq(r.template.url, 'https://x/art.png', 'by URL, so the browser can draw onto it')
  eq(r.template.width, 1600, 'with its size, which the design is scaled to')
  eq(r.template.design?.main?.capHeight, 21, 'and the design saved against it')
  eq(r.verifyBase, 'https://tickets.example.org/v', 'and the address a scan should reach')

  /*
   * Blank means "this site", decided by the browser. The server does not guess
   * at its own public address — it is behind a CDN and a custom domain, and a
   * guess baked into a printed QR is not correctable.
   */
  const unset = world()
  await generate(unset, { book: 'Book-0001' })
  eq((await render(unset, { book: 'Book-0001' })).verifyBase, '', 'blank when nobody has set one')
}

console.log('printing is recorded; looking is not')
{
  const w = world()
  await generate(w, { book: 'Book-0001' })

  await render(w, { book: 'Book-0001' })
  ok(w.table('ticket_codes').every((c) => !c.printed_at), 'opening a ticket does not mark it printed')
  eq(w.table('audit_log').filter((a) => a.action === 'TICKETS_PRINTED').length, 0, 'and writes no audit row')

  await render(w, { book: 'Book-0001', print: true })
  ok(w.table('ticket_codes').every((c) => !!c.printed_at), 'printing marks every one')
  ok(w.table('ticket_codes').every((c) => c.printed_by === users.admin.email), 'with who printed it')
  const rows = w.table('audit_log').filter((a) => a.action === 'TICKETS_PRINTED')
  eq(rows.length, 1, 'and one audit row')
  eq(rows[0].details.count, 10, 'saying how many')
  eq(rows[0].details.first, 'KS-00001', 'and which')

  // Reprinting is allowed and is not a new ticket — the code is the one it had.
  const before = w.table('ticket_codes').map((c) => c.code).sort().join()
  await render(w, { book: 'Book-0001', print: true })
  eq(w.table('ticket_codes').map((c) => c.code).sort().join(), before,
    'a reprint carries the code the ticket already had')
}

console.log('one print run at a time')
{
  const w = world()
  ok(printing.MAX_PER_PRINT < printing.MAX_PER_CALL,
    'fewer can be drawn at once than generated — drawing lays out a page each')
  const many = Array.from({ length: printing.MAX_PER_PRINT + 1 }, (_, i) => `KS-${String(i + 1).padStart(5, '0')}`)
  // Only 20 tickets exist in the fixture, so the unknown ones refuse first —
  // which is the right order: a typo should not be reported as "too many".
  eq(await codeOf(() => render(w, { numbers: many })), 'TICKET_NOT_FOUND',
    'unknown numbers are refused before the size is complained about')
}

console.log('the scope rules are the generator\'s own')
{
  const w = world()
  await generate(w, { all: true })
  eq((await render(w, { all: true })).tickets.length, 20, 'all of them')
  eq((await render(w, { fromBook: 'Book-0001', toBook: 'Book-0002' })).tickets.length, 20, 'a run of books')
  eq((await render(w, { numbers: ['KS-00005'] })).tickets.length, 1, 'named tickets')
  eq(await codeOf(() => render(w, {})), 'MISSING_FIELD', 'and no scope at all is refused')
  eq(await codeOf(() => render(w, { book: 'Book-9999' })), 'BOOK_NOT_FOUND', 'as is an unknown book')
}

console.log(`\n${pass} passed, ${fail} failed`)
cleanup()
process.exit(fail ? 1 : 0)
