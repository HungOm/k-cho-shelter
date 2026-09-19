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
import { api, configure } from './lib/backend.js'
import * as sbAuth from './lib/supabaseAuth.js'
import { attach as attachNudge, pollInterval } from './lib/nudge.js'

import AppShell from './components/AppShell.vue'
import SignIn from './components/SignIn.vue'
import Home from './components/Home.vue'
import Search from './components/Search.vue'
import Sell from './components/Sell.vue'
import Books from './components/Books.vue'
import Agents from './components/Agents.vue'
import Money from './components/Money.vue'
import Draw from './components/Draw.vue'
import Admin from './components/Admin.vue'
import TicketDesign from './components/TicketDesign.vue'
import Permissions from './components/Permissions.vue'
import Approvals from './components/Approvals.vue'

import SellTicket from './components/SellTicket.vue'
import PrintTickets from './components/modals/PrintTickets.vue'
import ViewTicket from './components/modals/ViewTicket.vue'
import AgentForm from './components/modals/AgentForm.vue'
import UserForm from './components/modals/UserForm.vue'
import IssueBooks from './components/modals/IssueBooks.vue'
import SettleBook from './components/modals/SettleBook.vue'
import BookDetail from './components/modals/BookDetail.vue'
import Receipt from './components/modals/Receipt.vue'
import SellBook from './components/modals/SellBook.vue'
import BookAction from './components/modals/BookAction.vue'
import ReportBack from './components/modals/ReportBack.vue'
import MakeTickets from './components/modals/MakeTickets.vue'
import TicketsInPlay from './components/modals/TicketsInPlay.vue'
import Deadlines from './components/modals/Deadlines.vue'
import CheckIn from './components/modals/CheckIn.vue'
import CheckInSheet from './components/modals/CheckInSheet.vue'
import RoundReport from './components/modals/RoundReport.vue'
import RecordPayment from './components/modals/RecordPayment.vue'
import WinnerForm from './components/modals/WinnerForm.vue'
import PrizeForm from './components/modals/PrizeForm.vue'
import AskApproval from './components/modals/AskApproval.vue'
import Toasts from './components/ui/Toasts.vue'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '981045980686-ah7579259e9j24l2pgnsbb2v4bn0biud.apps.googleusercontent.com'

const phase = ref('loading')       // loading | waiting | signin | error | ready
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

// which dialog is open
const modal = ref(null)            // {kind, payload}
const openModal = (kind, payload) => { modal.value = { kind, payload } }
const closeModal = () => { modal.value = null }

const SCREENS = {
  home: Home, search: Search, sell: Sell, books: Books,
  agents: Agents, money: Money, draw: Draw, admin: Admin,
  ticketdesign: TicketDesign,
  permissions: Permissions, approvals: Approvals
}
const current = computed(() => SCREENS[state.screen] || Home)

// ---------- connection ----------

function readFragment() {
  // One link points a device at a project: …/#sb=<project url>&k=<publishable key>
  // A fragment never reaches any server, so it stays out of logs and history.
  if (!location.hash || location.hash.length < 2) return
  const p = new URLSearchParams(location.hash.slice(1))
  // Supabase's own OAuth reply ALSO comes back in the fragment. Leave it alone:
  // the client reads it once, and clearing the hash here would eat the session
  // before it was ever exchanged. This line is the only reason signing in works.
  if (p.has('access_token') || p.has('error_description')) return
  const sb = p.get('sb'), k = p.get('k')
  try {
    if (sb) localStorage.setItem(sbAuth.LS_SB.url, sb.trim())
    if (k) localStorage.setItem(sbAuth.LS_SB.key, k.trim())
  } catch { /* private window */ }
  if (sb || k) history.replaceState(null, '', location.pathname + location.search)
}

async function reset() {
  await forgetCache()
  // Without this the session survives, so somebody refused for being off the
  // list reloads straight back into the same refusal with no way out. A door
  // that returns you to the room you were locked in is not a door.
  await sbAuth.signOut()
  location.reload()
}

async function signOut() {
  if (stopNudge) { stopNudge(); stopNudge = null }
  try { window.google?.accounts?.id?.disableAutoSelect() } catch {}
  // Supabase keeps its own refresh token in storage. Dropping the cache without
  // dropping that would sign them straight back in on the next load, which is
  // the opposite of what the button says.
  await sbAuth.signOut()
  // Somebody who has signed out must not still have the ticket table on their
  // phone, even with the names already stripped out of it.
  await forgetCache()
  location.reload()
}

// ---------- Google sign-in ----------

/*
 * WHAT IS NOT HERE ANY MORE. Roughly a hundred lines that kept a Google ID
 * token alive: storing it, reading its expiry, scheduling a silent renewal
 * before the hour ran out, retrying the renewal on wake, and putting a "sign in
 * again" overlay on screen when it failed. All of it existed because the Apps
 * Script backend verified a Google token on every request, so the token WAS the
 * session and it expired in an hour.
 *
 * A Supabase session refreshes itself. The Google credential below is traded
 * for one, once, and then nothing here holds it.
 */

function onCredential(res) {
  // A Google token is not a session — it is the thing you trade for one. The
  // Edge Function verifies Supabase's own JWT and has no reason to trust a
  // token signed by Google for a Google client id.
  return exchangeForSupabaseSession(res)
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
  // SignIn.vue calls this once its target element exists.
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
    // It used to end "or switch back with ?backend=appsscript", which is now a
    // volunteer being told to do something that cannot work.
    errorMsg.value = 'This device does not know which raffle it belongs to yet. ' +
      'Ask the organiser for the setup link — it sets this up in one tap.'
    return
  }

  configure({ apiUrl: sbAuth.projectUrl(), onAuthExpired: sbAuth.refreshSession })

  // Every token from here on, including the refreshed ones nobody asked for.
  stopSession = await sbAuth.onSession(session => {
    configure({ idToken: session?.access_token || '' })
    // Re-authorise the socket on every token, including the refreshed ones
    // nobody asked for: a private channel is authorised from the socket's own
    // token, and a stale one goes quiet rather than erroring.
    if (session?.access_token) listenForChanges(session.access_token)
  })

  // Deliberately no 'ping' first, unlike the Apps Script path: the function
  // refuses unauthenticated calls outright, so a pre-flight check before
  // sign-in would only ever report a working backend as a broken one.
  const session = await sbAuth.currentSession()
  if (!session?.access_token) {
    // Built into the bundle. It used to fall back to a value pasted into the
    // device alongside the Apps Script link; there is nothing to paste now, so
    // an unset VITE_GOOGLE_CLIENT_ID means the redirect flow rather than the
    // Google button, which is the honest outcome rather than a broken button.
    clientId.value = CLIENT_ID
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

/**
 * Subscribe to "something changed", and re-time the poll around it.
 *
 * Torn down and rebuilt on each token rather than patched, because a channel
 * authorised with a token that has since expired is the silent case — it stays
 * connected and hears nothing, which looks exactly like a quiet raffle.
 */
async function listenForChanges(token) {
  if (stopNudge) { stopNudge(); stopNudge = null }
  const sb = await sbAuth.getClient()
  if (!sb) return
  stopNudge = attachNudge(sb, token, () => { poll() }, s => {
    if (s === nudgeStatus) return
    nudgeStatus = s
    // The interval depends on the status, so it has to be re-timed when the
    // status moves — otherwise a failed channel keeps the five-minute gap.
    if (phase.value === 'ready') startPolling()
  })
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
/*
 * The interval is what the nudge changes, not the polling itself.
 *
 * A live channel makes this a safety net for the cases a socket cannot cover —
 * Realtime unavailable, a captive portal, a phone asleep through six sales — so
 * five minutes is right. Without one it is the only way the app learns anything,
 * so it stays at thirty seconds. Removing it either way would mean a dropped
 * socket is indistinguishable from a quiet raffle.
 */
let nudgeStatus = 'off'
let stopNudge = null
let pollTimer = null

function startPolling() {
  stopPolling()
  if (document.visibilityState !== 'visible') return
  poll()
  pollTimer = setInterval(poll, pollInterval(nudgeStatus))
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
  // `onVisibility` alone now. There used to be a second listener on the same
  // event — `wake` — whose whole job was to notice that a Google ID token had
  // gone stale while the phone was asleep and renew it before the next call
  // failed. A Supabase session refreshes itself, so waking up is just polling.
  document.addEventListener('visibilitychange', onVisibility)

  readFragment()

  return bootSupabase()
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
    }
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
  document.removeEventListener('visibilitychange', onVisibility)
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

/*
 * The book-action sheet takes a KIND, and sometimes a book to fill in for it.
 *
 * Opened from the Books screen it is a bare kind string — "put some books back
 * on the shelf", and you say which. Opened from one book's own sheet the book
 * is already known, and asking somebody to type the number of the book they are
 * looking at is how a way out goes unused. Normalised here so the screens that
 * open it the old way are left exactly as they were.
 */
const bookAction = computed(() => {
  const p = modal.value?.payload
  return typeof p === 'string'
    ? { kind: p, book: '' }
    : { kind: p?.kind ?? '', book: p?.book ?? '' }
})

/**
 * Taking an offer back, from the book sheet.
 *
 * DIRECT RATHER THAN THROUGH A CONFIRMATION SHEET, and deliberately: nothing
 * has been accepted, nothing is on anybody's balance, and the books go straight
 * back to the shelf where they can be offered again. It is the one book action
 * with no consequence to weigh — the opposite of putting a settled book back,
 * which clears figures and asks first.
 *
 * The whole offer comes back, not the one book, because the offer was one act
 * and one sentence the seller read. The reply names what moved, so the toast
 * can say it rather than "done".
 */
async function withdrawOffer(book) {
  try {
    const r = await api('withdraw_offer', { fromBook: book.book })
    const n = r.released || 0
    toast(`${n} ${n === 1 ? 'book is' : 'books are'} back on the shelf`, 'ok')
    closeModal()
    await refresh()
  } catch (err) {
    toast(err.message, 'bad', err.code)
  }
}

function seeTickets(book) {
  closeModal()
  state.query = book.book
  go('search')
}
</script>

<template>
  <SignIn v-if="phase !== 'ready'" :phase="phase" :message="errorMsg"
          :gsi="useGsi"
          :detail="errorDetail" :not-you="errorNotYou"
          :refused="refused"
          @reset="reset" @retry="() => location.reload()"
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
                   @edit-user="u => openModal('user', u)"
                   @issue="openModal('issue')"
                   @sell-book="b => openModal('sellbook', b)"
                   @print-range="() => openModal('printtickets', {})"
                   @transfer="openModal('bookaction', 'transfer')"
                   @return-books="openModal('bookaction', 'return')"
                   @restock="openModal('bookaction', 'restock')"
                   @mark="openModal('bookaction', 'mark')"
                   @record-winner="openModal('winner')"
                   @edit-prize="p => openModal('prize', p)"
                   @make-tickets="openModal('make')"
                   @tickets-in-play="openModal('inplay')"
                   @deadlines="openModal('deadlines')"
                   @record-check-in="a => openModal('checkin', a)"
                   @record-payment="a => openModal('payment', a)"
                   @report-back="openModal('reportback')" />
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
    <UserForm v-else-if="modal?.kind === 'user'" :user="modal.payload"
              @close="closeModal" @saved="closeModal"
              @needs-approval="r => openModal('askapproval', r)" />
    <IssueBooks v-else-if="modal?.kind === 'issue'"
                @close="closeModal" @issued="id => openModal('receipt', id)" />
    <Receipt v-else-if="modal?.kind === 'receipt'" :agent-id="modal.payload" @close="closeModal" />
    <PrintTickets v-else-if="modal?.kind === 'printtickets'" :payload="modal.payload"
                  @close="closeModal" />
    <ViewTicket v-else-if="modal?.kind === 'viewticket'" :payload="modal.payload"
                @close="closeModal"
                @print="p => openModal('printtickets', p)" />
    <BookDetail v-else-if="modal?.kind === 'book'" :book="modal.payload"
                @close="closeModal"
                @settle="b => openModal('settle', b)"
                @receipt="id => openModal('receipt', id)"
                @sell-book="b => openModal('sellbook', b)"
                @restock="b => openModal('bookaction', { kind: 'restock', book: b.book })"
                @withdraw-offer="withdrawOffer"
                @see-tickets="seeTickets"
                @view-book="b => openModal('viewticket', { book: b.book })"
                @print-book="b => openModal('printtickets', { book: b.book })" />
    <SettleBook v-else-if="modal?.kind === 'settle'" :book="modal.payload"
                @close="closeModal" @settled="afterBookChange"
                @put-back="afterBookChange" />
    <SellBook v-else-if="modal?.kind === 'sellbook'" :book="modal.payload"
              @close="closeModal" @sold="closeModal" />
    <!-- The seller's own report. Sending it changes nothing until an
         organiser accepts it, so closing on 'sent' returns them to a screen
         that still shows their books exactly as they were. -->
    <ReportBack v-else-if="modal?.kind === 'reportback'"
                @close="closeModal" @sent="closeModal" />
    <BookAction v-else-if="modal?.kind === 'bookaction'"
                :kind="bookAction.kind" :book="bookAction.book"
                @close="closeModal" @done="closeModal"
                @needs-approval="r => openModal('askapproval', r)" />
    <AskApproval v-else-if="modal?.kind === 'askapproval'" :request="modal.payload"
                 @close="closeModal" @sent="closeModal" />
    <MakeTickets v-else-if="modal?.kind === 'make'"
                    @close="closeModal" @released="closeModal" />
    <TicketsInPlay v-else-if="modal?.kind === 'inplay'"
                   @close="closeModal" @done="closeModal"
                   @make-more="openModal('make')" />
    <Deadlines v-else-if="modal?.kind === 'deadlines'" @close="closeModal"
               @round-report="r => openModal('roundreport', r)" />
    <CheckIn v-else-if="modal?.kind === 'checkin'" :agent="modal.payload"
             @close="closeModal" @saved="closeModal"
             @sheet="a => openModal('checkinsheet', a)" />
    <!-- The printed half of a check-in. Opened from the form and from a
         seller's own screen, because the two people who need it are the
         organiser at the table and the seller holding the books. -->
    <CheckInSheet v-else-if="modal?.kind === 'checkinsheet'"
                  :agent-id="modal.payload?.id || modal.payload || ''"
                  @close="closeModal" />
    <RoundReport v-else-if="modal?.kind === 'roundreport'" :round="modal.payload || 0"
                 @close="closeModal" />
    <RecordPayment v-else-if="modal?.kind === 'payment'" :seller="modal.payload"
                   @close="closeModal" @saved="closeModal" />
    <WinnerForm v-else-if="modal?.kind === 'winner'" @close="closeModal" @saved="closeModal" />
    <!-- payload is the prize being changed, or null to add one. -->
    <PrizeForm v-else-if="modal?.kind === 'prize'" :prize="modal.payload"
               @close="closeModal" @saved="closeModal" />
  </Teleport>

  <Teleport to="body">
    <Transition name="fade">
    </Transition>
  </Teleport>

  <Toasts />
</template>
