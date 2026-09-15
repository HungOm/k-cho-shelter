/*
 * "Who owes, and which tickets" — answered on the screen that asks it.
 *
 * THE REPORT. The Money screen's table showed amounts owed by NOBODY: seller,
 * books and sold were all blank, because the two backends describe this report
 * differently and the client reads Apps Script's names.
 *
 *   client reads   Apps Script   Supabase
 *   name           name          agentName
 *   booksOut       booksOut      books (an array)
 *   ticketsSold    ticketsSold   sold
 *   overdueBooks   overdueBooks  absent
 *
 * The money columns matched, so the table looked populated and authoritative
 * while failing at the one thing it exists for. Sixth field-shape divergence in
 * this repository, and the user has now set the rule that ends the class:
 * Supabase must carry every feature Apps Script has.
 *
 * normalise() here is a STOPGAP and the test says so, because two spellings of
 * one fact living in the client is the disease rather than the cure. It goes
 * when the port returns the shape it promised.
 *
 * AND THE FEATURE. A total tells you how much; chasing it needs which tickets,
 * sold to whom, and what has already come in — otherwise the conversation with
 * a seller begins with both sides reconstructing the same list from memory.
 * That is read from tickets already on the device, so it costs no round trip.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/components/Money.vue', import.meta.url), 'utf8')

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

// Run the real function rather than reading it.
const body = src.slice(src.indexOf('function normalise'), src.indexOf('/** Which tickets'))
const normalise = new Function('agentMap', `${body}; return normalise`)({ value: { A1: { name: 'From the agent list' } } })

console.log('a row from either backend comes out the same')
{
  const gs = normalise({ agentId: 'A1', name: 'JOHN', booksOut: 3, ticketsSold: 11, expected: 110, collected: 90, outstanding: 20, overdueBooks: 1 })
  const sb = normalise({ agentId: 'A1', agentName: 'JOHN', books: ['B1', 'B2', 'B3'], sold: 11, expected: 110, collected: 90, outstanding: 20 })
  for (const k of ['name', 'booksOut', 'ticketsSold']) {
    ok(gs[k] === sb[k], `${k} agrees across backends (${gs[k]} vs ${sb[k]})`)
  }
  ok(sb.name === 'JOHN', 'the Supabase row has a seller name at all')
  ok(sb.booksOut === 3, 'an array of books becomes a count')
  ok(sb.ticketsSold === 11, 'and sold becomes ticketsSold')
  ok(gs.overdueBooks === 1 && sb.overdueBooks === undefined,
     'the overdue count is Apps Script only — absent, not invented')
}

console.log('and a row with no name at all still names somebody')
{
  const bare = normalise({ agentId: 'A1', expected: 10, collected: 0, outstanding: 10 })
  ok(bare.name === 'From the agent list',
     'falls back to the seller list the client already holds, not to blank')
  const unknown = new Function('agentMap', `${body}; return normalise`)({ value: {} })({ agentId: 'A9' })
  ok(unknown.name === 'A9', 'and to the id rather than nothing, so a row is never anonymous')
  ok(unknown.booksOut === 0 && unknown.ticketsSold === 0, 'counts default to zero, not undefined')
}

console.log('the stopgap is labelled as one')
ok(/Temporary\./.test(src), 'normalise says it is temporary')
ok(/shape it promised/.test(src), 'and what has to change for it to go')

console.log('which tickets, and how to reach the seller')
ok(/t\.agent === agentId/.test(src), 'the breakdown is the seller\'s own tickets')
ok(/\['Sold', 'Donated'\]\.includes\(t\.status\)/.test(src), 'sold and donated only')
ok(/isPaid/.test(src) && /t\.payment/.test(src),
   'each ticket says whether ITS money came in, from the ticket rather than the total')
ok(/wa\.me/.test(src) && /tel:/.test(src), 'and the seller can be messaged or telephoned')
ok(/No phone number on file/.test(src), 'with an honest line when there is no number')
ok(/state\.tickets/.test(src), 'read from tickets already on the device — no extra round trip')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
