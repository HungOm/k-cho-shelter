/*
 * The email on the row, and the person it belongs to.
 *
 * Every sold ticket carries the address of whoever wrote it down, and three
 * screens rendered it raw: "Written down by helper.someone.oct19@gmail.com".
 * That is accurate, it is unreadable at a glance, and it is not how one person
 * in this raffle refers to another. The names exist — app_users has one row per
 * person who can sign in — and they were never joined to the addresses.
 *
 * WHY THE ADDRESS STAYS UNDERNEATH rather than being replaced. It is what the
 * record actually holds. A screen showing only a resolved name hides that the
 * row is keyed on an address, and the day a name changes in app_users a history
 * that showed only names would silently re-attribute work already done. It also
 * settles two people with the same first name, which this raffle has.
 *
 * AND WHY "YOU (NAME)" is a case of its own: checking an address against your
 * own to work out whether a sale was yours is work the screen can do, and the
 * screens where it appears — a ticket's record, a book's trail — are exactly
 * where somebody is asking "did I do this, or did somebody else".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderScreen, visibleText } from './screen.mjs'

let pass = 0, fail = 0
const ok = (c, w) => { c ? pass++ : (fail++, console.log('  FAIL ' + w)) }
const eq = (g, w, what) => { String(g) === String(w) ? pass++ : (fail++, console.log(`  FAIL ${what}: got ${g}, want ${w}`)) }
const root = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(root, p), 'utf8')

console.log('1. the lookup answers the three ways a reader needs')
{
  // Evaluated from source so the rule itself is tested, not a copy of it.
  const src = read('src/lib/store.js')
  const body = src.slice(src.indexOf('export function whoIs'), src.indexOf('export function sellBlock'))
  const whoIs = new Function('state', `${body.replace('export function', 'function')}; return whoIs`)({
    user: {
      email: 'Me@Example.com',
      staff: [
        { email: 'me@example.com', name: 'Hung Om', role: 'admin' },
        { email: 'helper@example.com', name: 'Thang Ling', role: 'recorder' },
      ],
    },
  })

  const other = whoIs('helper@example.com')
  eq(other.name, 'Thang Ling', 'somebody else is named')
  eq(other.you, false, 'and is not me')

  const mine = whoIs('me@example.com')
  eq(mine.you, true, 'my own address is recognised')
  // Addresses are compared lowercased on both sides: app_users stores them
  // lowered and a signed-in address can arrive in any case at all.
  eq(whoIs('ME@EXAMPLE.COM').you, true, 'whatever case it arrives in')

  const unknown = whoIs('someone.else@example.com')
  eq(unknown.name, '', 'an address with no name on file admits it')
  eq(whoIs(''), null, 'and nothing at all is nobody, not an empty person')
}

const store = `
import { reactive, computed } from 'vue'
export const state = reactive({
  cfg: { currency: 'RM', ticketPrice: 10 }, agents: [], sellMode: 'quick',
  user: { role: 'admin', email: 'me@example.com', staff: [
    { email: 'me@example.com', name: 'Hung Om', role: 'admin' },
    { email: 'helper@example.com', name: 'Thang Ling', role: 'recorder' },
    { email: 'noname@example.com', name: '', role: 'recorder' },
  ] },
})
export const whoIs = (email) => {
  const want = String(email || '').trim().toLowerCase()
  if (!want) return null
  const row = (state.user.staff || []).find((s) => s.email === want)
  return { email: want, name: row?.name || '', role: row?.role || '', you: state.user.email === want }
}
export const api = async () => ({ book: {}, history: [], tickets: [] })
export const optimistic = async () => {}
export const toast = () => {}
export const setSellMode = () => {}
export const refresh = async () => {}
export const agentMap = computed(() => ({}))
export const whereIs = () => null
export const sellBlock = () => null
// The organiser's override asks why; these screens import the predicate that
// decides whether to ask. Default false: no stub here puts a book in somebody
// else's hands, and a stub that says yes would make every render demand a reason.
export const overrideReasonNeeded = () => false
export const sellOverrideNeeded = () => false
export const bookBlock = () => null
export const isAdmin = computed(() => true)
export const isSuper = computed(() => true)
export const canWrite = computed(() => true)
export const go = () => {}
export const isSold = (t) => t?.status === 'Sold' || t?.status === 'Donated'
`
const ticket = { number: 'KS-00831', book: 'Book-084', status: 'Sold', amount: 10,
                 name: 'A Buyer', phone: '0125550001', zone: '', version: 1 }

/*
 * RENDERED ON ITS OWN, because the screen harness stubs child components: a
 * <Who> inside SellTicket comes back as an empty fragment, and an assertion
 * aimed at it would pass or fail on the stub rather than on the component. So
 * the component is the screen here, and the screens that use it are checked
 * for passing the right thing into it.
 */
console.log('2. a sale somebody else wrote down names them, with the address under it')
{
  const said = visibleText(await renderScreen('src/components/ui/Who.vue', store,
    { props: { email: 'helper@example.com' } }))
  ok(/Thang Ling/.test(said), 'the person is named')
  ok(/helper@example\.com/.test(said), 'and the address is still there, because it is what the row holds')
  ok(!/You \(/.test(said), 'and it does not claim to be me')
}

console.log('3. my own reads "You (name)", so nobody compares addresses in their head')
{
  const said = visibleText(await renderScreen('src/components/ui/Who.vue', store,
    { props: { email: 'me@example.com' } }))
  ok(/You \(Hung Om\)/.test(said), 'a sale I wrote down says so')
  ok(/me@example\.com/.test(said), 'with my address under it, like anybody else')
}

console.log('4. an address with nobody behind it is shown once, not twice')
{
  /*
   * The rendering bug this avoids: falling back to the address as the name
   * while also printing it underneath, so the row reads
   * "stranger@example.com / stranger@example.com" and looks broken.
   */
  const said = visibleText(await renderScreen('src/components/ui/Who.vue', store,
    { props: { email: 'stranger@example.com' } }))
  ok(/stranger@example\.com/.test(said), 'the address is shown')
  eq((said.match(/stranger@example\.com/g) || []).length, 1, 'exactly once')

  const nobody = visibleText(await renderScreen('src/components/ui/Who.vue', store,
    { props: { email: '' } }))
  ok(!/@/.test(nobody), 'and no address at all draws nothing, rather than an empty person')
}

console.log('4b. the screens that show a recorder hand it the address they hold')
{
  const sell = read('src/components/SellTicket.vue')
  ok(/<Who :email="t\.by"/.test(sell), "the ticket's record passes who wrote it down")
  ok(!/\{\{ t\.by \}\}/.test(sell), 'and no longer prints the raw address itself')

  /* The trail moved out of the sheet into ui/Trail.vue so a sold ticket can
     show it inline. Same three places, same rule, one file along. */
  const hist = read('src/components/ui/Trail.vue')
  // Three: the sale, the ticket's own recorded change, and the book's movement.
  // The third was the one still printing the address raw — "by
  // organiser@example.org" — two rows under a sale that resolved the same
  // column to a name. All three read the same column and now read it the same
  // way.
  eq((hist.match(/<Who :email="(sale|s)\.by"/g) || []).length, 3,
     'all three places the trail names a person go through it')
  ok(!/Written down by \{\{/.test(hist), 'and none prints the address raw')
  ok(!/by \{\{ s\.by \}\}/.test(hist), 'including the book movement, which did')
}

console.log('4c. and so do the screens that show who took money')
{
  /*
   * A→B ON THE MONEY, which was the half these screens did not have. Every row
   * on the payments ledger and every line on a seller's statement but the sale
   * describes cash moving from a seller to somebody who took it; both columns —
   * payments.received_by and books.settled_by — were already being read by the
   * server and printed by nothing, so a treasurer querying a figure had to ask
   * an organiser who it had been handed to.
   *
   * Read rather than rendered, for the reason at the top of this file: the
   * harness stubs child components, so a <Who> inside the Money screen comes
   * back empty and an assertion aimed at the name would pass on the stub.
   */
  /*
   * THE PANEL MOVED INTO A SHEET, and these facts moved with it. It was a row
   * that grew inside the seller table; every other detail view in this app is a
   * sheet, and a statement nested in the table it belongs to pushed every other
   * seller off the screen.
   */
  const money = read('src/components/modals/SellerMoney.vue')
  ok(/<Who v-if="p\.receivedBy" :email="p\.receivedBy" \/>/.test(money),
     'the payments ledger names who took each one')
  ok(/<Who :email="e\.by" \/>/.test(money), "and the seller's statement names who took it")
  ok(/<th>Taken by<\/th>/.test(money), 'under a column that says what it is')

  const sheet = read('src/components/modals/BookDetail.vue')
  ok(/<Who :email="book\.settledBy" \/>/.test(sheet),
     'and the book sheet names who counted the money in')

  for (const f of ['src/components/modals/SellerMoney.vue', 'src/components/modals/BookDetail.vue']) {
    ok(/import Who from/.test(read(f)), `${f} imports it rather than printing an address`)
  }
}

console.log('5. the names ride along with sign-in, not with every ticket')
{
  /*
   * A dozen people against twenty thousand tickets. Attaching a name to every
   * row would be the same handful of strings repeated until they were the
   * largest thing in the snapshot — and this screen is downloaded on a phone.
   */
  const idx = read('supabase/functions/api/index.ts')
  const whoami = idx.slice(idx.indexOf('async function whoami'), idx.indexOf('async function readVersion'))
  ok(/app_users/.test(whoami) && /staff/.test(whoami), 'whoami carries the directory')
  ok(/\.eq\('active', true\)/.test(whoami), 'of people who can still sign in')
  ok(!/staff/.test(idx.slice(idx.indexOf('const WIRE_FIELDS'), idx.indexOf('const WIRE_FIELDS') + 600)),
     'and the ticket wire does not carry a name per row')
}

console.log('6. the desk line is not a person, and stops pretending to be one')
{
  const money = read('src/components/Money.vue')
  // The press opens a sheet now rather than growing the row; the guard is the
  // same one and it is the guard this line is about.
  ok(/@click="a\.agentId && \(openSeller = a\)"/.test(money),
     'a row with nobody behind it does not respond to a press')
  ok(/v-if="a\.agentId" class="chev"/.test(money),
     'and shows no chevron, which is what invited the press')
  ok(/nobody to chase/.test(money), 'it says why instead')
}

console.log('7. a name says what the person is, in one lowercase word')
{
  /*
   * WHY. "Written down by Amos Hung" answers who to go and ask. It does not
   * answer why that person and not another, which is the question somebody
   * reading a queried sale actually has — a helper writing down a desk sale and
   * a seller handing back their own book are different acts, and the two names
   * read identically without it.
   *
   * RENDERED ON ITS OWN, for the reason stated at the top of this file: the
   * harness stubs child components, so a RoleTag inside Who comes back empty
   * and an assertion aimed at the pair would pass on the stub. The word is
   * checked here; that the screens hand it the right thing is checked below.
   *
   * The first attempt at this asserted /helper/ against the whole rendered Who
   * — which matched helper@example.com, the ADDRESS, and would have passed with
   * the tag entirely absent.
   */
  const tagOf = async (props) =>
    visibleText(await renderScreen('src/components/ui/RoleTag.vue', store, { props })).trim()

  eq(await tagOf({ role: 'recorder' }), 'helper', 'a recorder is a helper')
  eq(await tagOf({ role: 'admin' }), 'organiser', 'an admin is an organiser')
  eq(await tagOf({ role: 'agent' }), 'seller', 'an agent is a seller')
  eq(await tagOf({ seller: true }), 'seller', 'and so is somebody who carries paper and never signs in')

  const word = await tagOf({ role: 'recorder' })
  eq(word, word.toLowerCase(), 'lowercase — it qualifies the name rather than joining it')
  ok(!/Seller who signs in|Can only look/.test(word),
     'and is its own word, not the label the Access screen uses for choosing a role')
}

console.log('8. a tag is never invented')
{
  /*
   * THE FAILURE THIS PREVENTS IS A DEPLOY LAG, not a bug. An older Edge
   * Function sends a staff list with no roles at all — that is exactly what was
   * live when this was asked for — and a tag guessed from nothing would put a
   * confident, wrong word after somebody's name on every ticket row.
   */
  const tagOf = async (props) =>
    visibleText(await renderScreen('src/components/ui/RoleTag.vue', store, { props })).trim()

  eq(await tagOf({ role: '' }), '', 'no role means no tag')
  eq(await tagOf({}), '', 'and neither does nothing at all')
  eq(await tagOf({ role: 'something_new' }), '', 'nor a role this build has never heard of')
}

console.log('8b. and the screens hand it the right thing')
{
  // The pair cannot be rendered together, so the wiring is read instead.
  const who = read('src/components/ui/Who.vue')
  ok(/<RoleTag :role="line\.role"/.test(who), 'Who passes the role it looked up')
  ok(/role: row\?\.role \|\| ''/.test(read('src/lib/store.js')),
     'and whoIs carries a role through for it to pass')

  for (const f of ['src/components/modals/BookDetail.vue', 'src/components/SellTicket.vue']) {
    // `seller`, not a role: somebody who carries paper has no app_users row.
    ok(/<RoleTag seller \/>/.test(read(f)), `${f} tags the seller as a seller`)
  }
}

console.log('9. the top role is not announced on a ticket row')
{
  /*
   * list_users hides the System Admin's row from everybody but its owner. A
   * directory that tagged them would undo that quietly, so the server reports
   * the row as an ordinary admin — which is also what it resolves to, the flag
   * being held outside the database.
   */
  const src = read('supabase/functions/api/index.ts')
  const block = src.slice(src.indexOf('const { data: staffRows }'), src.indexOf('return {', src.indexOf('const { data: staffRows }')))
  ok(/superadmin'\s*\?\s*'admin'/.test(block),
     'whoami reports a superadmin row as admin in the staff directory')

  const { ROLE_TAG } = await import('../src/lib/format.js')
  eq(ROLE_TAG.superadmin, 'organiser', 'and the tag for it says organiser, never the top word')
  ok(!Object.values(ROLE_TAG).some((w) => /admin/i.test(w)),
     'no tag says admin at all — the app does not call anybody that')
  ok(Object.values(ROLE_TAG).every((w) => w === w.toLowerCase()),
     'every tag is lowercase')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
