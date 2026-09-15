<script setup>
/**
 * The root. Owns sign-in, which screen is showing, and which dialog is open.
 *
 * Screens are kept as separate components and swapped with <KeepAlive>, so
 * moving between them keeps their scroll position and loaded data instead of
 * starting over each time.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { state, setConfig, refresh, go, toast, isAdmin, bootFromCache, forgetCache, poll } from './lib/store.js'
import { tokenIsStale, LS } from './lib/api.js'
import { api, configure, isSupabase } from './lib/backend.js'
import * as sbAuth from './lib/supabaseAuth.js'

import AppShell from './components/AppShell.vue'
import SignIn from './components/SignIn.vue'
import ReAuth from './components/ReAuth.vue'
import Home from './components/Home.vue'
import Search from './components/Search.vue'
import Sell from './components/Sell.vue'
import Books from './components/Books.vue'
import Agents from './components/Agents.vue'
import Money from './components/Money.vue'
import Draw from './components/Draw.vue'
import Admin from './components/Admin.vue'
import Permissions from './components/Permissions.vue'
import Approvals from './components/Approvals.vue'

import SellTicket from './components/SellTicket.vue'
import AgentForm from './components/modals/AgentForm.vue'
import UserForm from './components/modals/UserForm.vue'
import IssueBooks from './components/modals/IssueBooks.vue'
import SettleBook from './components/modals/SettleBook.vue'
import BookDetail from './components/modals/BookDetail.vue'
import Receipt from './components/modals/Receipt.vue'
import SellBook from './components/modals/SellBook.vue'
import BookAction from './components/modals/BookAction.vue'
import MakeTickets from './components/modals/MakeTickets.vue'
import TicketsInPlay from './components/modals/TicketsInPlay.vue'
import Deadlines from './components/modals/Deadlines.vue'
import CheckIn from './components/modals/CheckIn.vue'
import WinnerForm from './components/modals/WinnerForm.vue'
import AskApproval from './components/modals/AskApproval.vue'
import Toasts from './components/ui/Toasts.vue'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '981045980686-ah7579259e9j24l2pgnsbb2v4bn0biud.apps.googleusercontent.com'

const phase = ref('loading')       // loading | waiting | setup | signin | error | ready
let silentTimer = null
const errorMsg = ref('')
// Kept apart from errorMsg on purpose: one line is for whoever is looking at
// the phone, the other for whoever can actually change the thing.
const errorDetail = ref('')
const errorNotYou = ref(false)
// Refused is not the same as broken. A refusal needs a way to a DIFFERENT
// account; a breakage needs another go at the same one. Offering both for both
// is how somebody ends up pressing "Try again" at a wall.
const refused = ref(false)
const signedInAs = ref('')
const clientId = ref('')
const savedUrl = ref('')

// which dialog is open
const modal = ref(null)            // {kind, payload}
const openModal = (kind, payload) => { modal.value = { kind, payload } }
const closeModal = () => { modal.value = null }

const SCREENS = {
  home: Home, search: Search, sell: Sell, books: Books,
  agents: Agents, money: Money, draw: Draw, admin: Admin,
  permissions: Permissions, approvals: Approvals
}
const current = computed(() => SCREENS[state.screen] || Home)

// ---------- connection ----------

function readFragment() {
  // One link sets a helper up: …/#s=<exec url>&cid=<client id>
  // …or, on the Supabase backend: …/#sb=<project url>&k=<publishable key>
  // A fragment never reaches any server, so it stays out of logs and history.
  if (!location.hash || location.hash.length < 2) return
  const p = new URLSearchParams(location.hash.slice(1))
  // Supabase's own OAuth reply also comes back in the fragment. Leave it alone:
  // the client reads it once, and clearing the hash here would eat the session
  // before it was ever exchanged.
  if (p.has('access_token') || p.has('error_description')) return
  const s = p.get('s'), c = p.get('cid')
  const sb = p.get('sb'), k = p.get('k')
  try {
    if (s) localStorage.setItem(LS.url, s.trim())
    if (c) localStorage.setItem(LS.cid, c.trim())
    if (sb) localStorage.setItem(sbAuth.LS_SB.url, sb.trim())
    if (k) localStorage.setItem(sbAuth.LS_SB.key, k.trim())
  } catch { /* private window */ }
  if (s || c || sb || k) history.replaceState(null, '', location.pathname + location.search)
}

function connect({ url, cid }) {
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    return toast('That should be a script.google.com link ending in /exec', 'bad')
  }
  if (!CLIENT_ID && !cid) return toast('The Google app ID is needed too', 'bad')
  try {
    localStorage.setItem(LS.url, url)
    if (cid) localStorage.setItem(LS.cid, cid)
  } catch { /* private window */ }
  location.reload()
}

async function reset() {
  try { localStorage.removeItem(LS.url); localStorage.removeItem(LS.cid) } catch {}
  await forgetCache()
  dropToken()
  // Without this the Supabase session survives, so somebody refused for being
  // off the list reloads straight back into the same refusal with no way out.
  // A door that returns you to the room you were locked in is not a door.
  if (isSupabase) await sbAuth.signOut()
  location.reload()
}

async function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect() } catch {}
  // Supabase keeps its own refresh token in storage. Dropping the cache without
  // dropping that would sign them straight back in on the next load, which is
  // the opposite of what the button says.
  if (isSupabase) await sbAuth.signOut()
  // Somebody who has signed out must not still have the ticket table on their
  // phone, even with the names already stripped out of it — nor the sign-in
  // that would put them straight back in on the next load.
  await forgetCache()
  dropToken()
  location.reload()
}

// ---------- Google sign-in ----------

let tokenWaiter = null
let renewing = null          // one shared renewal, however many calls fail at once
let renewTimer = null
const reauth = ref(false)    // the "sign in again" overlay

function onCredential(res) {
  // On Supabase a Google token is not a session — it is the thing you trade for
  // one. The Edge Function verifies Supabase's own JWT and has no reason to
  // trust a token signed by Google for a Google client id.
  if (isSupabase) return exchangeForSupabaseSession(res)
  clearTimeout(silentTimer)
  lastToken = res.credential
  configure({ idToken: res.credential })
  keepToken(res.credential)
  scheduleRenewal(res.credential)
  reauth.value = false
  if (tokenWaiter) { const w = tokenWaiter; tokenWaiter = null; w(true); return }
  start()
}

/**
 * Keeps the sign-in across a page refresh.
 *
 * Storing it does NOT make it last any longer: a Google ID token is valid for
 * its own hour whether or not we write it down, so this widens no window. What
 * it removes is being asked to sign in again every time somebody reloads the
 * page or reopens the tab, which is most of a volunteer's day.
 *
 * It is dropped on sign-out, on changing the connection, and on any
 * authentication failure — the same lifecycle as the ticket cache.
 */
function keepToken(jwt) {
  try {
    const exp = tokenExpiry(jwt)
    if (exp) localStorage.setItem(LS.tok, JSON.stringify({ jwt, exp }))
  } catch { /* storage blocked; the app just asks again next time */ }
}

function storedToken() {
  try {
    const raw = localStorage.getItem(LS.tok)
    if (!raw) return ''
    const { jwt, exp } = JSON.parse(raw)
    // A minute of headroom, so a token about to die is not used for a request
    // that would fail halfway through.
    return exp && exp > Date.now() + 60_000 ? jwt : ''
  } catch { return '' }
}

function dropToken() {
  try { localStorage.removeItem(LS.tok) } catch { /* nothing to drop */ }
}

/** The token's own expiry, read from the JWT. Not trusted — only used for timing. */
function tokenExpiry(jwt) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const exp = JSON.parse(atob(part)).exp
    return exp ? exp * 1000 : 0
  } catch { return 0 }
}

/**
 * Renew a few minutes early, while nobody is mid-sale.
 *
 * Waiting for a request to fail means the interruption lands exactly when
 * somebody is saving something.
 */
function scheduleRenewal(jwt) {
  clearTimeout(renewTimer)
  const exp = tokenExpiry(jwt)
  if (!exp) return
  const wait = exp - Date.now() - 5 * 60 * 1000
  renewTimer = setTimeout(() => { renew() }, Math.max(30_000, wait))
}

/**
 * Try quietly first; ask the person only if that fails.
 *
 * Deduplicated on purpose: a refresh fires five requests, and without this
 * every one of them would raise its own sign-in prompt.
 */
function renew() {
  if (renewing) return renewing

  renewing = new Promise(resolve => {
    const g = window.google?.accounts?.id
    if (!g) return resolve(false)

    let settled = false
    const finish = ok => { if (!settled) { settled = true; resolve(ok) } }
    tokenWaiter = finish

    // One Tap may be suppressed, and under FedCM the old "was it shown?"
    // signals are unreliable, so treat silence as failure and move on.
    try { g.prompt() } catch { /* fall through to asking */ }
    setTimeout(() => { if (!settled) askToSignInAgain(finish) }, 3500)
  }).finally(() => { renewing = null })

  return renewing
}

/** Silent renewal did not work — put the button in front of them and wait. */
function askToSignInAgain(finish) {
  reauth.value = true
  // No timeout here: they may be away from the phone. The overlay keeps every
  // loaded ticket and every open form intact until they come back.
  tokenWaiter = ok => { reauth.value = false; finish(ok) }
}

/**
 * Phones suspend timers while the screen is off, so the scheduled renewal may
 * simply never have run. Check the moment the app comes back into view.
 */
let lastToken = ''

function wake() {
  if (document.visibilityState !== 'visible') return
  if (!lastToken) return
  // The old timer may have been killed, or be about to fire at the wrong time.
  scheduleRenewal(lastToken)
  if (tokenIsStale(5 * 60 * 1000)) renew()
}

function initGoogle() {
  const g = window.google?.accounts?.id
  if (!g) return setTimeout(initGoogle, 150)
  g.initialize({
    client_id: clientId.value,
    callback: onCredential,
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    // Apps Script verifies the token itself and never asked for a nonce, so it
    // does not get one: adding a claim to the token on a path nobody checks it
    // on is change without purpose.
    ...(gsiNonce ? { nonce: gsiNonce.hashed } : {})
  })
  // SignIn.vue and ReAuth.vue call this once their target element exists.
  window.__renderGoogleButton = el => {
    if (!el) return
    g.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', width: 280 })
    try { g.prompt() } catch { /* the button is enough */ }
  }
}

// ---------- Supabase sign-in ----------

/**
 * The same door, with Supabase holding the key.
 *
 * Shorter than the Google path above and that is the point: there is no expiry
 * timer, no silent-renew race and no ReAuth overlay, because the library
 * refreshes the session itself and tells us through onSession. What is left is
 * "configure the transport with whatever token is current", which is one line
 * that happens to run again whenever the token changes.
 */
let stopSession = null

async function bootSupabase() {
  if (!sbAuth.isConfigured()) {
    phase.value = 'error'
    errorMsg.value = 'This device does not have the Supabase project address yet. ' +
      'Ask the organiser for the setup link, or switch back with ?backend=appsscript.'
    return
  }

  configure({ apiUrl: sbAuth.projectUrl(), onAuthExpired: sbAuth.refreshSession })

  // Every token from here on, including the refreshed ones nobody asked for.
  stopSession = await sbAuth.onSession(session => {
    configure({ idToken: session?.access_token || '' })
  })

  // Deliberately no 'ping' first, unlike the Apps Script path: the function
  // refuses unauthenticated calls outright, so a pre-flight check before
  // sign-in would only ever report a working backend as a broken one.
  const session = await sbAuth.currentSession()
  if (!session?.access_token) {
    try { clientId.value = CLIENT_ID || (localStorage.getItem(LS.cid) || '').trim() } catch { /* private window */ }
    const forceRedirect = new URLSearchParams(location.search).get('signin') === 'redirect'
    useGsi.value = !!clientId.value && !forceRedirect
    if (useGsi.value) {
      gsiNonce = await sbAuth.makeNonce()
      initGoogle()
    }
    phase.value = 'signin'
    return
  }

  configure({ idToken: session.access_token })
  signedInAs.value = session.user?.email || ''
  return start()
}

/**
 * Which door the Supabase sign-in uses.
 *
 * The Google button on our own page, normally: Google's consent screen then
 * names the address the volunteer typed in rather than a forty-character
 * project reference on supabase.co, and nobody leaves the page. The redirect is
 * still there for a build with no Google client id compiled in, and on
 * ?signin=redirect for when somebody needs it deliberately.
 */
let gsiNonce = null
const useGsi = ref(false)

async function exchangeForSupabaseSession(res) {
  try {
    phase.value = 'waiting'
    const session = await sbAuth.signInWithGoogleToken(res.credential, gsiNonce?.raw)
    configure({ idToken: session.access_token })
    signedInAs.value = session.user?.email || ''
    await start()
  } catch (err) {
    // A refusal here is a project setting, not a wrong password, so it must not
    // read as "try again" — the person at the phone cannot fix it by retrying.
    phase.value = 'error'
    errorMsg.value = err?.message || 'Could not complete the Google sign-in.'
    errorDetail.value = err?.detail || ''
    errorNotYou.value = !!err?.notYou
  }
}

async function supabaseSignIn() {
  try {
    phase.value = 'waiting'
    await sbAuth.signIn()          // navigates away; the answer is the next load
  } catch (err) {
    phase.value = 'error'
    errorMsg.value = err?.message || 'Could not start the Google sign-in.'
  }
}

// ---------- keeping up ----------

/**
 * Ask every half minute whether anything moved.
 *
 * An owner sitting on the Approvals screen had no way to learn that a request
 * had arrived: the page loads once and then knows nothing. A request nobody is
 * told about is the same as no request, and the person who asked is left
 * wondering whether the button worked.
 *
 * ONLY WHILE THE TAB IS VISIBLE, and stopped the moment it is not. This runs on
 * volunteers' own phones, on their own mobile data, for a whole day. A timer
 * that keeps asking from a pocket costs them battery and money to answer a
 * question nobody is currently looking at. Coming back into view polls at once,
 * so the wait is never the interval — it is however long it takes to look.
 *
 * Thirty seconds rather than five: this is a raffle, not a trading floor. The
 * cost of hearing about an approval half a minute late is nothing; the cost of
 * a hundred devices asking twelve times a minute all day is somebody's data.
 */
const POLL_MS = 30_000
let pollTimer = null

function startPolling() {
  stopPolling()
  if (document.visibilityState !== 'visible') return
  poll()
  pollTimer = setInterval(poll, POLL_MS)
}

function stopPolling() {
  clearInterval(pollTimer)
  pollTimer = null
}

function onVisibility() {
  if (phase.value !== 'ready') return
  document.visibilityState === 'visible' ? startPolling() : stopPolling()
}

// ---------- boot ----------

onMounted(async () => {
  document.addEventListener('visibilitychange', wake)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', wake)

  readFragment()

  if (isSupabase) return bootSupabase()

  let url = ''
  try {
    url = (localStorage.getItem(LS.url) || '').trim()
    clientId.value = CLIENT_ID || (localStorage.getItem(LS.cid) || '').trim()
  } catch { /* private window */ }
  savedUrl.value = url

  if (!url || !clientId.value) { phase.value = 'setup'; return }

  configure({ apiUrl: url, onAuthExpired: renew })

  try {
    await api('ping', {}, { noRetry: true })
  } catch (err) {
    phase.value = 'error'
    errorMsg.value = err.message
    return
  }
  initGoogle()

  // Still signed in from last time: carry straight on, no Google round trip.
  const saved = storedToken()
  if (saved) {
    lastToken = saved
    configure({ idToken: saved })
    scheduleRenewal(saved)
    return start()
  }

  // Otherwise give Google a moment to sign them back in before showing a
  // button. Leading with "please sign in" when it was about to happen anyway
  // is the difference between an app that remembers you and one that does not.
  phase.value = 'waiting'
  silentTimer = setTimeout(() => {
    if (phase.value === 'waiting') phase.value = 'signin'
  }, 2500)
})

async function start() {
  phase.value = 'loading'
  try {
    const me = await api('whoami', {}, { noRetry: true })
    state.user = me
    // setConfig, not an assignment: it applies the raffle's colour too, and
    // before the first paint of the signed-in app rather than after — applying
    // it later means every volunteer watches the interface change colour on
    // load, which reads as a glitch rather than as branding.
    setConfig(me.config)
    phase.value = 'ready'
    // Paint from the local copy first — ticket numbers and statuses are on the
    // device, so the app is usable before the network answers. Buyer names are
    // deliberately not stored, so they land with the refresh below.
    await bootFromCache()
    // Deliberately not awaited into the catch below: once whoami has answered,
    // the sign-in worked. A report that fails afterwards is a missing panel,
    // not a failed login, and must not throw the user back to this screen.
    refresh().finally(() => { state.ready = true; startPolling() })
  } catch (err) {
    // Access refused or withdrawn: drop the local copy before showing the door.
    if (String(err.code || '').startsWith('AUTH') ||
        err.code === 'NOT_AUTHORIZED' || err.code === 'ACCOUNT_DISABLED') {
      forgetCache()
      dropToken()
    }
    // A stored token the server would not take is worse than none: it would be
    // retried on every reload. Throw it away and let them sign in properly.
    if (String(err.code || '').startsWith('AUTH')) {
      phase.value = 'signin'
      return
    }
    phase.value = 'error'
    // Any ACCOUNT_* code, not a list of them. The gate grew ACCOUNT_PENDING,
    // ACCOUNT_SUSPENDED and ACCOUNT_BANNED while this screen knew only about
    // ACCOUNT_DISABLED, and a code this did not recognise fell through to the
    // generic error — which offers "Try again" and no way to a different
    // account. Matching the family means the next one added is handled the day
    // it ships rather than the day somebody is stuck behind it.
    refused.value = err.code === 'NOT_AUTHORIZED' || String(err.code || '').startsWith('ACCOUNT_')
    // Name the account. Somebody with three Google accounts in one browser is
    // told which one was refused, rather than being left to guess which of them
    // Chrome picked — and that is most people who run a raffle from a phone.
    const who = signedInAs.value ? `${signedInAs.value} ` : 'This Google account '
    // The gate writes a plain sentence for each ACCOUNT_ state — waiting to be
    // let in, paused, stopped — and it knows which one applies. Naming the
    // account and then deferring to the server beats a copy of its wording that
    // drifts, and beats a code the person cannot act on.
    errorMsg.value = err.code === 'NOT_AUTHORIZED'
      ? `${who}is not on the list yet. Ask the organiser to add it, then sign in again.`
      : refused.value
        ? `${who}— ${err.message}`
        : err.message
  }
}

onUnmounted(() => {
  document.removeEventListener('visibilitychange', wake)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', wake)
  clearTimeout(renewTimer)
  stopPolling()
  stopSession?.()
})

// ---------- modal plumbing ----------

function openTicketByNumber(num) {
  const t = state.byNumber[num]
  if (t) openModal('ticket', t)
}

function afterBookChange() {
  closeModal()
}

function seeTickets(book) {
  closeModal()
  state.query = book.book
  go('search')
}
</script>

<template>
  <SignIn v-if="phase !== 'ready'" :phase="phase" :message="errorMsg"
          :needs-client-id="!CLIENT_ID" :saved-url="savedUrl" :supabase="isSupabase" :gsi="useGsi"
          :detail="errorDetail" :not-you="errorNotYou"
          :refused="refused"
          @connect="connect" @reset="reset" @retry="() => location.reload()"
          @signin="supabaseSignIn" />

  <AppShell v-else @signout="signOut">
    <Transition name="slide" mode="out-in">
      <KeepAlive>
        <component :is="current" :key="state.screen"
                   @open="t => openModal('ticket', t)"
                   @open-ticket="openTicketByNumber"
                   @open-book="b => openModal('book', b)"
                   @open-agent="a => openModal('agent', a)"
                   @add-agent="openModal('agent', null)"
                   @add-user="openModal('user')"
                   @issue="openModal('issue')"
                   @sell-book="b => openModal('sellbook', b)"
                   @transfer="openModal('bookaction', 'transfer')"
                   @return-books="openModal('bookaction', 'return')"
                   @mark="openModal('bookaction', 'mark')"
                   @record-winner="openModal('winner')"
                   @make-tickets="openModal('make')"
                   @tickets-in-play="openModal('inplay')"
                   @deadlines="openModal('deadlines')"
                   @record-check-in="a => openModal('checkin', a)" />
      </KeepAlive>
    </Transition>
  </AppShell>

  <Teleport to="body">
    <SellTicket v-if="modal?.kind === 'ticket'" :ticket="modal.payload"
                @close="closeModal" @saved="closeModal" />
    <AgentForm v-else-if="modal?.kind === 'agent'" :agent="modal.payload"
               @close="closeModal" @saved="closeModal"
               @receipt="id => openModal('receipt', id)"
               @check-in="a => openModal('checkin', a)" />
    <UserForm v-else-if="modal?.kind === 'user'" @close="closeModal" @saved="closeModal"
              @needs-approval="r => openModal('askapproval', r)" />
    <IssueBooks v-else-if="modal?.kind === 'issue'"
                @close="closeModal" @issued="id => openModal('receipt', id)" />
    <Receipt v-else-if="modal?.kind === 'receipt'" :agent-id="modal.payload" @close="closeModal" />
    <BookDetail v-else-if="modal?.kind === 'book'" :book="modal.payload"
                @close="closeModal"
                @settle="b => openModal('settle', b)"
                @receipt="id => openModal('receipt', id)"
                @sell-book="b => openModal('sellbook', b)"
                @see-tickets="seeTickets" />
    <SettleBook v-else-if="modal?.kind === 'settle'" :book="modal.payload"
                @close="closeModal" @settled="afterBookChange" />
    <SellBook v-else-if="modal?.kind === 'sellbook'" :book="modal.payload"
              @close="closeModal" @sold="closeModal" />
    <BookAction v-else-if="modal?.kind === 'bookaction'" :kind="modal.payload"
                @close="closeModal" @done="closeModal"
                @needs-approval="r => openModal('askapproval', r)" />
    <AskApproval v-else-if="modal?.kind === 'askapproval'" :request="modal.payload"
                 @close="closeModal" @sent="closeModal" />
    <MakeTickets v-else-if="modal?.kind === 'make'"
                    @close="closeModal" @released="closeModal" />
    <TicketsInPlay v-else-if="modal?.kind === 'inplay'"
                   @close="closeModal" @done="closeModal"
                   @make-more="openModal('make')" />
    <Deadlines v-else-if="modal?.kind === 'deadlines'" @close="closeModal" />
    <CheckIn v-else-if="modal?.kind === 'checkin'" :agent="modal.payload"
             @close="closeModal" @saved="closeModal" />
    <WinnerForm v-else-if="modal?.kind === 'winner'" @close="closeModal" @saved="closeModal" />
  </Teleport>

  <Teleport to="body">
    <Transition name="fade">
      <ReAuth v-if="reauth" />
    </Transition>
  </Teleport>

  <Toasts />
</template>
