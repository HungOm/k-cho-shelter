<script setup>
/**
 * The root. Owns sign-in, which screen is showing, and which dialog is open.
 *
 * Screens are kept as separate components and swapped with <KeepAlive>, so
 * moving between them keeps their scroll position and loaded data instead of
 * starting over each time.
 */
import { ref, computed, onMounted, shallowRef } from 'vue'
import { state, refresh, go, toast, isAdmin } from './lib/store.js'
import { api, configure, LS } from './lib/api.js'

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

import SellTicket from './components/SellTicket.vue'
import AgentForm from './components/modals/AgentForm.vue'
import UserForm from './components/modals/UserForm.vue'
import IssueBooks from './components/modals/IssueBooks.vue'
import SettleBook from './components/modals/SettleBook.vue'
import BookDetail from './components/modals/BookDetail.vue'
import Receipt from './components/modals/Receipt.vue'
import Toasts from './components/ui/Toasts.vue'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '981045980686-ah7579259e9j24l2pgnsbb2v4bn0biud.apps.googleusercontent.com'

const phase = ref('loading')       // loading | setup | signin | error | ready
const errorMsg = ref('')
const clientId = ref('')
const savedUrl = ref('')

// which dialog is open
const modal = ref(null)            // {kind, payload}
const openModal = (kind, payload) => { modal.value = { kind, payload } }
const closeModal = () => { modal.value = null }

const SCREENS = {
  home: Home, search: Search, sell: Sell, books: Books,
  agents: Agents, money: Money, draw: Draw, admin: Admin
}
const current = computed(() => SCREENS[state.screen] || Home)

// ---------- connection ----------

function readFragment() {
  // One link sets a helper up: …/#s=<exec url>&cid=<client id>
  // A fragment never reaches any server, so it stays out of logs and history.
  if (!location.hash || location.hash.length < 2) return
  const p = new URLSearchParams(location.hash.slice(1))
  const s = p.get('s'), c = p.get('cid')
  try {
    if (s) localStorage.setItem(LS.url, s.trim())
    if (c) localStorage.setItem(LS.cid, c.trim())
  } catch { /* private window */ }
  if (s || c) history.replaceState(null, '', location.pathname + location.search)
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

function reset() {
  try { localStorage.removeItem(LS.url); localStorage.removeItem(LS.cid) } catch {}
  location.reload()
}

function signOut() {
  try { window.google?.accounts?.id?.disableAutoSelect() } catch {}
  location.reload()
}

// ---------- Google sign-in ----------

let tokenWaiter = null

function onCredential(res) {
  configure({ idToken: res.credential })
  if (tokenWaiter) { const w = tokenWaiter; tokenWaiter = null; w(true); return }
  start()
}

/** Renews the hour-long token quietly, rather than interrupting a sale. */
function renew() {
  return new Promise(resolve => {
    const g = window.google?.accounts?.id
    if (!g) return resolve(false)
    let settled = false
    tokenWaiter = ok => { if (!settled) { settled = true; resolve(ok) } }
    try {
      g.prompt(n => {
        if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) tokenWaiter?.(false)
      })
    } catch { tokenWaiter?.(false) }
    setTimeout(() => tokenWaiter?.(false), 8000)
  }).then(ok => {
    if (!ok) { phase.value = 'error'; errorMsg.value = 'Your sign-in ran out. Please sign in again.' }
    return ok
  })
}

function initGoogle() {
  const g = window.google?.accounts?.id
  if (!g) return setTimeout(initGoogle, 150)
  g.initialize({
    client_id: clientId.value,
    callback: onCredential,
    auto_select: true,
    cancel_on_tap_outside: false
  })
  // SignIn.vue calls this once its target element is in the DOM.
  window.__renderGoogleButton = el => {
    if (!el) return
    g.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', width: 280 })
    g.prompt()
  }
}

// ---------- boot ----------

onMounted(async () => {
  readFragment()
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
  phase.value = 'signin'
  initGoogle()
})

async function start() {
  phase.value = 'loading'
  try {
    const me = await api('whoami', {}, { noRetry: true })
    state.user = me
    state.cfg = me.config
    phase.value = 'ready'
    // Deliberately not awaited into the catch below: once whoami has answered,
    // the sign-in worked. A report that fails afterwards is a missing panel,
    // not a failed login, and must not throw the user back to this screen.
    refresh().finally(() => { state.ready = true })
  } catch (err) {
    phase.value = 'error'
    errorMsg.value = err.code === 'NOT_AUTHORIZED'
      ? 'This Google account is not on the list yet. Ask the organiser to add it.'
      : err.code === 'ACCOUNT_DISABLED'
        ? 'This account has been turned off.'
        : err.message
  }
}

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
          :needs-client-id="!CLIENT_ID" :saved-url="savedUrl"
          @connect="connect" @reset="reset" @retry="() => location.reload()" />

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
                   @record-winner="openModal('winner')" />
      </KeepAlive>
    </Transition>
  </AppShell>

  <Teleport to="body">
    <SellTicket v-if="modal?.kind === 'ticket'" :ticket="modal.payload"
                @close="closeModal" @saved="closeModal" />
    <AgentForm v-else-if="modal?.kind === 'agent'" :agent="modal.payload"
               @close="closeModal" @saved="closeModal" />
    <UserForm v-else-if="modal?.kind === 'user'" @close="closeModal" @saved="closeModal" />
    <IssueBooks v-else-if="modal?.kind === 'issue'"
                @close="closeModal" @issued="id => openModal('receipt', id)" />
    <Receipt v-else-if="modal?.kind === 'receipt'" :agent-id="modal.payload" @close="closeModal" />
    <BookDetail v-else-if="modal?.kind === 'book'" :book="modal.payload"
                @close="closeModal"
                @settle="b => openModal('settle', b)"
                @receipt="id => openModal('receipt', id)"
                @see-tickets="seeTickets" />
    <SettleBook v-else-if="modal?.kind === 'settle'" :book="modal.payload"
                @close="closeModal" @settled="afterBookChange" />
  </Teleport>

  <Toasts />
</template>
