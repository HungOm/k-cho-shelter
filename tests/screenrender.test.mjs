/*
 * The screens, rendered — not scanned, and not merely set up.
 *
 * WHY THIS EXISTS. 18 deleted a call to sellBlock from Sell.vue and its whole
 * suite stayed green; the guard was correct, thoroughly tested, and nothing
 * checked that a screen asked for it. I assumed my own work was clear of that
 * and it was not. Two mutants, both silent:
 *
 *   App.vue stops calling applyBrand      35 branding assertions still passed
 *   Money.vue hardcodes the pill to 'in'  every moneyowed assertion passed
 *
 * The second is the worse one by a distance. It does not break a screen — it
 * tells an organiser that a seller's money has come in when it has not, on the
 * report whose entire job is knowing the difference, and it looks right.
 *
 * screencalls.test.mjs runs a component's SETUP against a stubbed store. That
 * catches a script-block call. It cannot catch this one, because `isPaid` is
 * reached from the TEMPLATE — so here the template is compiled too and the
 * component is rendered to HTML. What the volunteer would read is the thing
 * asserted.
 *
 * DELIBERATELY NOT TESTING THE RULES. The store is a stub, so a neutered
 * isPaid would pass this file and should: moneyowed.test.mjs owns whether the
 * rule is right, this one owns whether the screen asks. 18's point, and it is
 * correct — they fail for different reasons, and one file covering both would
 * not tell you which.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { renderScreen } from './screen.mjs'
import { setConfig, state } from '../src/lib/store.js'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }

/**
 * What a person reads, with the markup and every attribute taken out.
 *
 * Asserting on raw HTML matches things nobody can see. The seller's name is in
 * the WhatsApp link as well as in the table, so `/JOHN/` on the HTML stayed
 * green after the name was deleted from the row — satisfied by a URL. Third
 * over-match of this kind in two days, and the first one where the pattern was
 * matching something genuinely invisible.
 */
const textOf = h => h.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ')

/* ---------- the Money screen actually asks, per ticket ---------- */

const tickets = [
  { number: 'KS-00001', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: 'Paid',
    name: 'Buyer One', phone: '0125550001', saleDate: '2026-09-10' },
  { number: 'KS-00002', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: '',
    name: 'Buyer Two', phone: '0125550002', saleDate: '2026-09-10' },
]
const row = { agentId: 'A1', name: 'JOHN', phone: '0125550011', booksOut: 1, booksSettled: 0,
              overdueBooks: 0, ticketsSold: 2, expected: 20, collected: 10, outstanding: 10 }

const moneyStore = `
import { reactive, ref, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM' }, totals: {}, user: { role: 'admin' },
  tickets: __TICKETS__
})
export const api = async () => ({ agents: __ROWS__, currency: 'RM' })
export const toast = () => {}
export const agentMap = computed(() => ({}))
export const isSuper = computed(() => true)
export const go = () => {}
`

const money = (tickets_, rows_) => moneyStore
  .replace('__TICKETS__', JSON.stringify(tickets_))
  .replace('__ROWS__', JSON.stringify(rows_))

const html = await renderScreen('src/components/Money.vue', money(tickets, [row]), {
  drive: async b => {
    await b.load()          // what onMounted would have done
    b.toggle('A1')          // what a finger would have done
  }
})

console.log('one ticket paid, one not — and the screen says so')
ok(/not in/.test(textOf(html)), 'a ticket with no payment recorded reads "not in"')
ok((html.match(/>\s*in\s*</g) || []).length >= 1, 'and the paid one reads "in"')
// The mutant that survived everything else: hardcoding the pill to 'in'. It
// does not break the screen, it just tells somebody the money arrived.
ok((textOf(html).match(/not in/g) || []).length === 1,
   'exactly one ticket of the two is unpaid — not all of them, and not none')
ok(/KS-00001/.test(html) && /KS-00002/.test(html), 'both tickets are listed')
ok(/Buyer One/.test(textOf(html)) && /0125550002/.test(textOf(html)),
   'with who bought them and how to ring them')
ok(/JOHN/.test(textOf(html)), 'under the seller who owes — read from the table, not from a link')
ok(/wa\.me/.test(html), 'and a way to chase them')

console.log('the branches one render cannot reach — each is a sentence somebody reads')
{
  // A render shows ONE branch per pass. 18 measured the cost of that on a
  // screen with three: replacing a counted check with a render turned a caught
  // mutant into an uncaught one. Here the answer is more renders rather than
  // fewer assertions, because each of these is a different thing to be told.
  const nothingOut = await renderScreen('src/components/Money.vue', money([], []), {
    drive: b => b.load()
  })
  // The child stub passes SLOTS through and drops props, so the assertion is on
  // the slot sentence rather than on Empty's title attribute. Worth stating:
  // a stub decides what survives, and an assertion aimed at what it drops fails
  // in a way that looks like the screen is broken.
  ok(/what they owe shows up here/.test(nothingOut),
     'a raffle with no books out explains itself, rather than showing an empty table')
  ok(!/not in/.test(nothingOut), 'and claims nothing about money either way')

  const owesButNoTickets = await renderScreen('src/components/Money.vue',
    money([], [{ ...row, ticketsSold: 0, expected: 10, collected: 0, outstanding: 10 }]),
    { drive: async b => { await b.load(); b.toggle('A1') } })
  ok(/money\s+owed comes from a book counted in/.test(owesButNoTickets.replace(/\s+/g, ' ')),
     'a seller who owes with no tickets recorded gets the explanation, not a blank panel')
  ok(/JOHN/.test(textOf(owesButNoTickets)), 'and is still named on the row itself')

  const loading = await renderScreen('src/components/Money.vue', money(tickets, [row]))
  ok(/skel/.test(loading), 'before the report arrives the screen shows it is working')
  ok(!/not in/.test(loading), 'and does not report on money it has not got yet')
}

/* ---------- config is one door, and it applies the colour ---------- */

console.log('setConfig is the only way in, and it does both jobs')
{
  const set = {}
  globalThis.document = { documentElement: { style: {
    setProperty: (k, v) => { set[k] = v }, removeProperty: k => { delete set[k] }
  } } }
  setConfig({ orgName: 'Somebody', brandColor: '#ffff00' })
  ok(state.cfg?.orgName === 'Somebody', 'the config lands')
  ok(set['--brand'] === '#ffff00', 'and the raffle\'s colour is applied, not merely stored')
  ok(set['--brand-ink'] === '#11181c', 'with ink computed for it')
  setConfig({ orgName: 'Somebody' })
  ok(!('--brand' in set), 'a raffle with no colour set clears back to the shipped one')
  ok(setConfig(null) === null, 'and signing out clears it altogether')
}

// Exhaustive rather than a sample: the rule is worth nothing unless there is
// no other way in. This is the assertion that makes routing through setConfig
// mean something, and it is why the indirection is worth having at all.
const srcFiles = execFileSync('grep', ['-rl', 'state.cfg', join(ROOT, 'src')], { encoding: 'utf8' })
  .trim().split('\n')
const assigners = srcFiles.filter(f => !f.endsWith('lib/store.js'))
  .filter(f => /state\.cfg\s*=[^=]/.test(readFileSync(f, 'utf8')))
ok(assigners.length === 0, `nothing outside store.js assigns state.cfg (${assigners.join(', ')})`)
ok(/setConfig\(me\.config\)/.test(readFileSync(join(ROOT, 'src/App.vue'), 'utf8')),
   'and the one place config arrives goes through it')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
