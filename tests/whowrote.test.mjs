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
        { email: 'me@example.com', name: 'Hung Om' },
        { email: 'helper@example.com', name: 'Thang Ling' },
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
    { email: 'me@example.com', name: 'Hung Om' },
    { email: 'helper@example.com', name: 'Thang Ling' },
  ] },
})
export const whoIs = (email) => {
  const want = String(email || '').trim().toLowerCase()
  if (!want) return null
  const name = (state.user.staff || []).find((s) => s.email === want)?.name || ''
  return { email: want, name, you: state.user.email === want }
}
export const api = async () => ({ book: {}, history: [], tickets: [] })
export const optimistic = async () => {}
export const toast = () => {}
export const setSellMode = () => {}
export const refresh = async () => {}
export const agentMap = computed(() => ({}))
export const whereIs = () => null
export const sellBlock = () => null
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

  const hist = read('src/components/modals/History.vue')
  eq((hist.match(/<Who :email="(sale|s)\.by"/g) || []).length, 2,
     'both places the trail names a recorder go through it')
  ok(!/Written down by \{\{/.test(hist), 'and neither prints the address raw')
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
  ok(/@click="a\.agentId && toggle\(a\.agentId\)"/.test(money),
     'a row with nobody behind it does not respond to a press')
  ok(/v-if="a\.agentId" class="chev"/.test(money),
     'and shows no chevron, which is what invited the press')
  ok(/nobody to chase/.test(money), 'it says why instead')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
