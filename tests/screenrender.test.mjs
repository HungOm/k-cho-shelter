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
/** Source, for the handful of facts a stubbed child cannot render. */
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { renderScreen, visibleText } from './screen.mjs'
import { setConfig, state } from '../src/lib/store.js'

const ROOT = new URL('..', import.meta.url).pathname
let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }


/* ---------- the Money screen actually asks, per ticket ---------- */

const tickets = [
  { number: 'KS-00001', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: 'Paid',
    name: 'Buyer One', phone: '0125550001', saleDate: '2026-09-10' },
  { number: 'KS-00002', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: 'Unpaid',
    name: 'Buyer Two', phone: '0125550002', saleDate: '2026-09-10' },
]
const row = { agentId: 'A1', name: 'JOHN', phone: '0125550011', booksOut: 1, booksSettled: 0,
              overdueBooks: 0, ticketsSold: 2, expected: 20, collected: 10, outstanding: 10 }

const moneyStore = `
import { reactive, ref, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM' }, totals: {}, user: __USER__,
  tickets: __TICKETS__
})
export const asked = []
export const api = async (action) => {
  asked.push(action)
  if (action === 'agent_statement') return {
    agent: { id: 'A1', name: 'JOHN', phone: '0125550011', zone: '' },
    entries: [
      { at: '2026-09-10T00:00:00Z', kind: 'settlement', ref: 'Book-001',
        description: 'Counted in · 2 declared sold', charge: 20, credit: 0, balance: 20 },
      { at: '2026-09-11T00:00:00Z', kind: 'hand', ref: '#1',
        description: 'Handed in (cash)', charge: 0, credit: 10, balance: 10 },
    ],
    reconciles: true, ledgerBalance: 10,
    expected: 20, collected: 10, writtenOff: 0, outstanding: 10,
    sold: 2, booksOut: 1, booksSettled: 1, currency: 'RM',
  }
  return { agents: __ROWS__, scope: __SCOPE__, currency: 'RM' }
}
export const toast = () => {}
export const agentMap = computed(() => ({}))
export const isSuper = computed(() => true)
// Mirrors the real store's exports. A screen that grows an import breaks the
// bundle here with "no matching export", which reads as a broken test rather
// than as a stub one field behind.
export const canWrite = computed(() => true)
export const isAdmin = computed(() => state.user?.role === 'admin')
export const go = () => {}
// The real one is the single place the two sold statuses are spelled; this is
// a stub of its BEHAVIOUR, and soldlock.test.mjs walks src/ only, so the
// duplicate here is not the drift that rule exists to stop.
export const isSold = t => /^(Sold|Donated)$/.test(String(t?.status || ''))
`

/*
 * `scope` now travels with the report, because the screen has four of them and
 * three are only reachable by saying which. It defaults to 'all' — the shape
 * every assertion below was written against — so adding the argument changed
 * no existing render.
 */
const money = (tickets_, rows_, opts = {}) => moneyStore
  .replace('__TICKETS__', JSON.stringify(tickets_))
  .replace('__ROWS__', JSON.stringify(rows_))
  .replace('__SCOPE__', JSON.stringify(opts.scope ?? 'all'))
  .replace('__USER__', JSON.stringify(opts.user ?? { role: 'admin' }))

/*
 * THE PANEL IS A SHEET NOW, so it is rendered as one.
 *
 * It used to be a row that grew inside the seller table, and these assertions
 * drove Money.vue and read the expanded row. A statement, an audit trail and
 * three actions nested inside the row they belong to pushed every other seller
 * off the screen — on a phone, a column of numbers inside a column of numbers.
 * Every other detail view in this app is a sheet.
 *
 * Nothing here is softened. The same facts are asserted about the same markup;
 * what changed is which component is asked to draw it, and the render harness
 * stubs children, so asking Money.vue would now assert an empty stub and pass.
 */
const sheet = await renderScreen('src/components/modals/SellerMoney.vue',
  money(tickets, [row]),
  { props: { agent: row, wa: 'https://wa.me/60125550011?text=hello', tel: 'tel:0125550011' },
    drive: async b => { await b.load() } })   // what mounting would have done

console.log('opening a seller asks the server for their statement, and renders it')
/*
 * The statement below can only be on the screen if the request was made: none
 * of it is in the ticket snapshot the stub hands the component, which carries
 * no books, no charges and no balance. That the request happens on MOUNT — so
 * it cannot happen before somebody opens the sheet — is asserted in
 * moneyowed.test.mjs, against the source.
 */
ok(/Book-001/.test(visibleText(sheet)),
   'opening a line draws what the server returned for that seller')
ok(/Counted in/.test(visibleText(sheet)), 'and what the line is')
ok(/Balance due/.test(visibleText(sheet)), 'with the closing balance spelled out')
// The reconciliation the reader is invited to check: charged, less received,
// less written off, is what is left. A money screen that shows four figures
// which do not visibly relate is a screen people stop trusting.
ok(/Charged/i.test(visibleText(sheet)) && /Received/i.test(visibleText(sheet)),
   'the identity behind the balance is on the screen, not implied')
/*
 * THE NAME IS THE SHEET'S TITLE, and this harness drops the props it passes to
 * child components — Sheet renders its slots and not its title. So the
 * assertion is on the binding rather than on the pixels, which is the honest
 * version of it: aiming at a prop through a stub fails looking exactly like a
 * screen that does not show the name.
 */
ok(/:title="agent\.name \|\| agent\.agentId"/.test(read('../src/components/modals/SellerMoney.vue')),
   'under the seller who owes — named on the sheet itself')
ok(/wa\.me/.test(sheet), 'and a way to chase them')

console.log('and the table behind it opens that sheet')
{
  // The sheet is a child component, which this harness stubs — so what can be
  // asserted from the screen is that pressing a row asks for it, and that the
  // component is there to be asked. A dead control is what emits.test and
  // modalwiring.test exist for; this is the same check one layer in.
  const table = await renderScreen('src/components/Money.vue', money(tickets, [row]),
    { drive: async b => { await b.load() } })
  ok(/JOHN/.test(visibleText(table)), 'the seller is on the table')
  const src2 = read('../src/components/Money.vue')
  ok(/openSeller = a/.test(src2), 'and pressing their row opens them')
  ok(/<SellerMoney/.test(src2) && /import SellerMoney/.test(src2), 'into the sheet that shows the money')
  ok(!/class="detail"/.test(src2), 'rather than into a row that grows inside the table')
}

console.log('a number nobody can ring is not the same as no number')
{
  // The live raffle's state: a seller whose leading zero was lost. The links
  // are built by the screen, which asks isDialable before building either —
  // so an unusable number arrives here as no link at all, and the sheet says
  // which of the two it is.
  const broken = await renderScreen('src/components/modals/SellerMoney.vue',
    money(tickets, [row]),
    { props: { agent: { ...row, phone: '123367462' }, wa: '', tel: '' },
      drive: async b => { await b.load() } })
  const said = visibleText(broken)
  ok(!/wa\.me/.test(broken), 'no WhatsApp link is offered for a number we cannot place')
  ok(!/href="tel:/.test(broken), 'and nothing to ring either')
  ok(/cannot be dialled/.test(said), 'the screen says so in words')
  ok(/123367462/.test(said), 'and shows what is actually stored, so somebody can fix the record')
  // "Cannot be dialled" states the problem; this states what to do about it,
  // and it is the half a volunteer can act on.
  ok(/check it against the seller list/.test(said), 'and says where to go and fix it')
  ok(!/No phone number on file/.test(said),
     'without claiming there is no number — there is one, and that is the problem')

  const none = await renderScreen('src/components/modals/SellerMoney.vue',
    money(tickets, [row]), { props: { agent: { ...row, phone: '' }, wa: '', tel: '' },
      drive: async b => { await b.load() } })
  ok(/No phone number on file/.test(visibleText(none)), 'an absent number keeps its own sentence')
  ok(!/cannot be dialled/.test(visibleText(none)), 'and is not confused with an unusable one')
}

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
  ok(!/not paid/.test(nothingOut), 'and claims nothing about money either way')

  // Rendered as the sheet it now is; the seller's name is the sheet's title,
  // which a stubbed child drops, so it is asserted against the binding above.
  const owesRow = { ...row, ticketsSold: 0, expected: 10, collected: 0, outstanding: 10 }
  const owesButNoTickets = await renderScreen('src/components/modals/SellerMoney.vue',
    money([], [owesRow]),
    { props: { agent: owesRow, wa: '', tel: '' }, drive: async b => { await b.load() } })
  /*
   * READ AS VISIBLE TEXT, not as raw HTML.
   *
   * This matched the sentence in the markup, so it broke the moment "counted
   * in" was wrapped in a span to carry its hover explanation — the words a
   * reader sees did not change at all. A test that a person can read a sentence
   * should ask what is rendered, not how it is marked up, or every assertion
   * about copy becomes a lock on the tags around it.
   */
  /*
   * WHAT THIS ASSERTED BEFORE: a sentence explaining that a seller with no
   * ticket rows still owes money, because the debt came from a book counted in
   * rather than from individual sales. It existed to keep an empty ticket list
   * from reading as a bug.
   *
   * There is no ticket list any more, and the statement answers the same
   * question better: the debt is a dated line that says which book it came from
   * and what was declared. So the assertion follows the answer rather than the
   * sentence that used to stand in for it.
   */
  const owesText = visibleText(owesButNoTickets).replace(/\s+/g, ' ')
  ok(/Book counted in/.test(owesText),
     'a seller who owes with no tickets of their own is told the debt came from a book')
  ok(/Balance due/.test(owesText), 'and what is left after it')
  ok(/10\.00/.test(owesText), 'and the figure it comes to')

  // And the term explains itself on hover, rather than assuming the reader
  // knows that a sold-out book can still owe money.
  ok(/class="helpword"[^>]*title="Counting a book in is its last step/.test(owesButNoTickets)
     || /title="Counting a book in is its last step[^"]*"[^>]*class="helpword"/.test(owesButNoTickets),
     'and "counted in" carries its explanation where it is named')

  const loading = await renderScreen('src/components/Money.vue', money(tickets, [row]))
  ok(/skel/.test(loading), 'before the report arrives the screen shows it is working')
  ok(!/not paid/.test(loading), 'and does not report on money it has not got yet')
}

/* ---------- the same screen, for the three people who are not the organiser ---------- */

console.log('a helper is shown what THEY wrote down, and none of the raffle\'s money')
{
  /*
   * REPORTED FROM A SCREENSHOT TWICE, in opposite directions. First a Helper
   * was shown the whole raffle's cash — Should have 0, Handed in 120, Still
   * owed -120 — because the money queries read an empty scope as "no filter".
   * Then the screen was taken away from them altogether, and the reply was
   * that the sales they had spent the afternoon writing down had gone too.
   *
   * Both are the same missing distinction: a helper owes nothing and is owed
   * nothing, so there is no line for them in a table of debts — but the
   * RECORD of what they wrote down is theirs, and it is not a narrowed version
   * of that table. It is the tickets already on the device carrying their name.
   */
  const desk = [
    { number: 'KS-00001', book: 'B1', agent: 'A1', status: 'Sold', amount: 10, payment: 'Paid',
      name: 'Buyer One', phone: '0125550001', saleDate: '2026-09-10', by: 'rec@x.com' },
    { number: 'KS-00002', book: 'B1', agent: 'A1', status: 'Donated', amount: 10, payment: 'Unpaid',
      name: 'Buyer Two', phone: '0125550002', saleDate: '2026-09-10', by: 'rec@x.com' },
    { number: 'KS-00003', book: 'B2', agent: 'A2', status: 'Sold', amount: 10, payment: 'Paid',
      name: 'Somebody Else', phone: '0125550003', saleDate: '2026-09-10', by: 'other@x.com' },
  ]
  const helper = await renderScreen('src/components/Money.vue',
    money(desk, [], { scope: 'recorded', user: { role: 'recorder', email: 'rec@x.com' } }),
    { drive: b => b.load() })
  const said = visibleText(helper)

  ok(/What you wrote down/.test(said), 'the screen is about their own afternoon')
  ok(/KS-00001/.test(said), 'the sale they recorded is listed')
  // A DONATED ticket is as recorded as a sold one, and dropping it is the
  // half-of-the-fact mistake isSold exists to stop.
  ok(/KS-00002/.test(said), 'and so is the donated one')
  ok(/Buyer One/.test(said), 'with the buyer, whom a helper may see on their own rows')

  ok(!/KS-00003/.test(said), 'nothing somebody else recorded')
  ok(!/Somebody Else/.test(said), 'and not that buyer either')

  ok(!/Should have/.test(said), "none of the raffle's figures — a helper is carrying none of it")
  ok(!/Still owed/.test(said), 'nothing about what anybody owes')
  ok(!/What each seller owes/.test(said), "and no table of other people's debts")
  ok(/none of the raffle's money is owed by you/.test(said),
     'the screen says why, rather than leaving a volunteer to wonder')
}

console.log('a viewer is shown the money and none of the names')
{
  /*
   * THE OTHER HALF OF THE SAME SPLIT. A viewer and a helper shared the scope
   * 'totals', so whatever was decided for one was decided for both — and what
   * was decided was blank. A viewer exists to check that the raffle's money is
   * healthy; showing them nothing is the one thing the role cannot do its job
   * without.
   */
  const seen = await renderScreen('src/components/Money.vue',
    money(tickets, [], { scope: 'totals', user: { role: 'viewer', email: 'v@x.com' } }),
    { drive: b => b.load() })
  const said = visibleText(seen)

  ok(/Should have/.test(said), "the raffle's figures are shown")
  ok(/Still owed/.test(said), 'including what is outstanding, which is the point of looking')
  ok(!/JOHN/.test(said), 'and no seller is named')
  ok(!/What you wrote down/.test(said), 'this is not a helper: they have written nothing down')
  ok(/Who owes what is the organiser's to see/.test(said), 'with a sentence saying why')
}

console.log('a scope nobody has written yet is shown no money at all')
{
  /*
   * THE ASSERTION THAT FAILS WHEN A FIFTH SCOPE ARRIVES, which is the only
   * kind that can. Every other case here names one of the four we have, so all
   * four could pass while an unrecognised value fell into whichever branch was
   * written as a negation.
   *
   * It has happened three times in this codebase in one day. `scope !==
   * 'totals'` decided who got the debt table and handed a helper every
   * seller's line the moment a fourth scope existed; the round report repeated
   * it and printed a heading over nothing; and this screen gated the raffle's
   * own figures on `scope !== 'recorded'`. The last was not leaking, because
   * the server scopes state.totals independently — which is precisely what
   * makes it worth pinning. A guard that holds only because a different guard
   * holds fails silently the day somebody edits the other one.
   *
   * THE ROWS ARRAY IS POPULATED ON PURPOSE, and that is the whole strength of
   * this case. report_outstanding sends `agents: []` to any scope
   * showsSellerNames refuses, so a fixture that passes [] asserts nothing: it
   * passes whether the screen WITHHOLDS the table or is merely relying on the
   * server to withhold the rows. Handing it a real seller and requiring it to
   * withhold anyway is the only version that tells those two apart — and when
   * this fixture was changed from [] to [row] it failed immediately, because
   * the table's arm was the last in the chain and caught everything the named
   * arms did not. A fall-through is "everything except the ones I thought of"
   * written as a template rather than as a `!==`.
   *
   * Both guards are pinned separately: dropping the seller-table gate fails
   * "no seller is named", restoring the negated money guard fails "nor what is
   * outstanding". Neither mutant is caught by the other's assertion.
   */
  const unknown = await renderScreen('src/components/Money.vue',
    money(tickets, [row], { scope: 'added-next-year', user: { role: 'treasurer', email: 't@x.com' } }),
    { drive: b => b.load() })
  const said = visibleText(unknown)

  ok(!/Should have/.test(said), "an unrecognised scope is shown none of the raffle's figures")
  ok(!/Handed in/.test(said), 'nor what has come in')
  ok(!/Still owed/.test(said), 'nor what is outstanding')
  ok(!/JOHN/.test(said), 'and no seller is named')
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

/* ---------- the print modal offers what it exists to offer ---------- */

/*
 * WHY A COUNT OF CONTROLS. fa6c542 put an empty-state box one closing tag too
 * far out, which made it a second `v-else` on the modal's outermost chain. Vue
 * accepts that and discards the branch before it, so the whole printing screen
 * — mode picker, book inputs, generate, print — compiled and never rendered.
 * Nothing failed: no compile error, no console error, no failed request, and
 * every test in this suite stayed green while books could not be turned into
 * paper.
 *
 * branches.test.mjs asserts the mechanism: a chain may end once. This asserts
 * the CONSEQUENCE, which is the blunter and more durable half — a screen that
 * renders none of its controls is broken however it got that way, including
 * ways nobody has thought of yet.
 *
 * DELIBERATELY COUNTING, not matching one sentence. A single assertion on
 * "What to print" passes on a screen that has lost everything but its heading.
 */
const printStore = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { ticketArtwork: __ART__, currency: 'RM' },
  books: [{ book: 'Book-001' }, { book: 'Book-010' }],
  booksAllLoaded: true,
  user: { role: 'admin' },
  tickets: [],
})
export const api = async () => ({})
export const toast = () => {}
export const canWrite = computed(() => true)
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const go = () => {}
export const agentMap = computed(() => ({}))
`
const printing = (art) => printStore.replace('__ART__', JSON.stringify(art))

const PRINT = 'src/components/modals/PrintTickets.vue'
const withArt = await renderScreen(PRINT, printing('/artwork.png'),
                                   { props: { payload: { book: 'Book-001' } } })
const printText = visibleText(withArt)

// The five ways to say which tickets. A chain that drops the control column
// takes all five with it, which is the shape fa6c542 shipped.
for (const scope of ['This book', 'A run of books', 'Numbers you type',
                     'The whole raffle', 'Sample book'])
  ok(printText.includes(scope), `the print modal offers "${scope}"`)

ok((withArt.match(/type="radio"/g) || []).length === 5,
   'five scope radios, not a heading with nothing under it')
/*
 * MATCHED AS A BUTTON, not as a sentence. The empty-state box also contains the
 * words "See what is there" — so a plain text match passes on precisely the
 * broken screen this exists to catch. Checked: of these assertions run against
 * fa6c542, every one fails except that text match, which sails through.
 */
ok(/<button[^>]*>See what is there<\/button>/.test(withArt),
   'and the button that draws the batch, as a button')
ok(printText.includes('Organisers only'), 'and says who may use it')

/*
 * THE OTHER END OF THE SAME CHAIN. The bug was branch SELECTION, so asserting
 * one branch renders proves half of it: a modal wired to show the artwork
 * warning always would pass everything above by failing everything here.
 */
const noArt = await renderScreen(PRINT, printing(''),
                                 { props: { payload: { book: 'Book-001' } } })
const noArtText = visibleText(noArt)
ok(noArtText.includes('There is no ticket artwork yet'),
   'with no artwork it says so instead')
ok(!noArtText.includes('What to print'),
   'and does not also offer controls that cannot print anything')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
