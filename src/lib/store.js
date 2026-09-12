/**
 * The one reactive store.
 *
 * Everything the screens show derives from here, so a single change ripples
 * out to every view that depends on it without anyone re-rendering by hand.
 */

import { reactive, computed, ref } from 'vue'
import { api, ApiError, LS } from './api.js'
import { buildIndex, runSearch } from './search.js'
import { saveTickets, loadTickets, clearCache } from './cache.js'
import { my, myError } from './i18n.js'

export const TICKET_STATUS = {
  AVAILABLE: 'Available', RESERVED: 'Reserved', SOLD: 'Sold',
  DONATED: 'Donated', VOID: 'Void'
}

/**
 * Read at module load, so it cannot be allowed to throw: a browser with storage
 * blocked (a locked-down profile, some private windows) would otherwise fail
 * the import and take the entire app down before it rendered anything.
 */
function readSellMode() {
  try { return localStorage.getItem(LS.mode) || 'steps' } catch { return 'steps' }
}

export const state = reactive({
  // session
  ready: false,
  user: null,
  cfg: null,

  // data
  tickets: [],
  byNumber: {},
  books: [],
  bookStats: {},
  agents: [],
  overdue: [],
  totals: null,

  // ui
  screen: 'home',
  loading: false,
  loadProgress: null,
  lastSync: null,
  sellMode: readSellMode(),                             // 'steps' | 'quick'
  query: '',
  filterStatus: '',
  filterAgent: '',

  // what failed on the last load, and whether the spreadsheet is set up at all
  problems: [],
  needsSetup: false,

  // how many requests are waiting on a second person
  pendingApprovals: 0,

  // true while showing the local copy, before the full table has arrived
  fromCache: false,
  ticketVersion: 0
})

let index = []

// ---------- derived ----------

export const isAdmin = computed(() => state.user?.role === 'admin')
// The one root account. Set outside the app, in a Script Property, so nothing
// here can grant it. Hiding things from it is a courtesy -- the server refuses
// the super-admin-only actions whatever this page decides to draw.
export const isSuper = computed(() => !!state.user?.isSuperAdmin)
export const canWrite = computed(() => ['admin', 'recorder', 'agent'].includes(state.user?.role))
export const agentMap = computed(() => Object.fromEntries(state.agents.map(a => [a.id, a])))

export const searchResults = computed(() => {
  if (!index.length) return { total: 0, results: [] }
  return runSearch(index, {
    query: state.query, status: state.filterStatus, agent: state.filterAgent
  })
})

/** Everything the Home screen needs, recomputed whenever the data changes. */
export const overview = computed(() => {
  const t = state.totals
  const c = state.cfg
  if (!t || !c) return null
  const target = c.totalTickets * c.ticketPrice
  return {
    collected: t.collected,
    expected: t.expected,
    outstanding: t.outstanding,
    sold: t.ticketsSold,
    available: t.ticketsAvailable,
    missingContact: t.missingContact,
    target,
    percent: target ? Math.min(100, (t.expected / target) * 100) : 0,
    currency: c.currency
  }
})

/** The "needs attention" list. Each item knows where it sends you. */
export const attention = computed(() => {
  const o = overview.value
  if (!o) return []
  const items = []
  const late = state.overdue.length
  const open = (state.bookStats.Out || 0) + (state.bookStats.Returned || 0)

  if (late) items.push({
    key: 'overdue', tone: 'bad', icon: '⏰',
    title: `${late} book${late === 1 ? '' : 's'} not returned`,
    detail: 'Past the date they were due back', go: 'agents'
  })
  if (o.missingContact) items.push({
    key: 'contact', tone: 'bad', icon: '📵',
    title: `${o.missingContact} ticket${o.missingContact === 1 ? '' : 's'} with no phone number`,
    detail: 'You could not tell these people if they win', go: 'draw'
  })
  if (o.outstanding > 0) items.push({
    key: 'money', tone: 'warn', icon: '💰',
    title: `${o.currency} ${o.outstanding.toFixed(2)} not handed in yet`,
    detail: 'Sold, but the money has not come back', go: 'money'
  })
  if (open) items.push({
    key: 'open', tone: '', icon: '📚',
    title: `${open} book${open === 1 ? '' : 's'} still out`,
    detail: 'With agents, or waiting to be counted', go: 'books'
  })
  return items
})

/** First-run guide. Disappears by itself once the raffle is actually running. */
export const gettingStarted = computed(() => {
  if (!isAdmin.value) return null
  const steps = [
    { done: state.tickets.length > 0, title: 'Make the tickets',
      detail: state.tickets.length
        ? `${state.tickets.length.toLocaleString()} tickets ready`
        : 'Run setup() in the Apps Script editor' },
    { done: state.agents.length > 0, title: 'Add your sellers',
      detail: state.agents.length
        ? `${state.agents.length} ${state.agents.length === 1 ? 'person' : 'people'}`
        : 'The people who will carry books. No account needed.', action: 'add-agent' },
    { done: (state.bookStats.Out || 0) > 0, title: 'Give out books',
      detail: state.bookStats.Out ? `${state.bookStats.Out} books out` : 'Hand books to a seller',
      action: 'issue' },
    { done: state.tickets.some(t => t.status === 'Sold' || t.status === 'Donated'),
      title: 'Write down sales', detail: 'As they happen, or all at once later', action: 'sell' }
  ]
  return steps.every(s => s.done) ? null : steps
})

// ---------- loading ----------

const FIELD_MAP = {
  Ticket_Number: 'number', Status: 'status', Book_Number: 'book',
  Buyer_Name: 'name', Buyer_Phone: 'phone', Buyer_Zone: 'zone',
  Sold_By_Agent: 'agent', Amount: 'amount', Payment_Status: 'payment',
  Sale_Date: 'saleDate', Notes: 'notes', Source: 'source',
  Version: 'version', Recorded_By: 'by', Modified_Date: 'modified'
}

function toTicket(fields, row) {
  const t = {}
  fields.forEach((f, i) => {
    const key = FIELD_MAP[f]
    if (key) t[key] = row[i]
  })
  t.number = String(t.number || '')
  t.status = String(t.status || 'Available')
  t.book = String(t.book || '')
  t.name = String(t.name || '')
  t.phone = String(t.phone || '')
  t.version = parseInt(t.version, 10) || 0
  return t
}

/**
 * Paint from the local copy first.
 *
 * Ticket numbers, statuses and books come straight off the device, so the app
 * is usable in well under a second. Buyer names and phone numbers are not on
 * the device by design, so they arrive with the network load a moment later —
 * which is why search by name is briefly unavailable and then simply works.
 */
export async function bootFromCache() {
  try {
    const v = await loadTickets()
    if (!v?.rows?.length) return false
    state.tickets = v.rows.map(row => toTicket(v.fields, row))
    state.ticketVersion = v.version || 0
    state.lastSync = v.serverTime || null
    state.fromCache = true
    reindex()
    return true
  } catch {
    return false
  }
}

export async function forgetCache() {
  state.fromCache = false
  state.ticketVersion = 0
  try { await clearCache() } catch { /* nothing to forget */ }
}

export async function loadSnapshot() {
  const tickets = []
  const raw = []
  let offset = 0
  let fields = null
  let version = 0
  let serverTime = ''

  for (let guard = 0; guard < 40; guard++) {
    const page = await api('read_snapshot', { offset, limit: 2000 })
    fields = page.fields
    version = page.version || version
    serverTime = page.serverTime || serverTime
    page.rows.forEach(r => { tickets.push(toTicket(page.fields, r)); raw.push(r) })
    state.loadProgress = page.total ? { done: tickets.length, total: page.total } : null
    if (!page.hasMore) break
    offset += page.returned
  }

  state.tickets = tickets
  state.ticketVersion = version
  state.lastSync = serverTime || state.lastSync
  state.fromCache = false
  state.loadProgress = null
  reindex()

  // Personal columns are stripped inside saveTickets, not here, so there is
  // exactly one place that decides what may touch the disk.
  if (fields) saveTickets({ fields, rows: raw, version, serverTime }).catch(() => {})
}

export async function loadDelta() {
  if (!state.lastSync) return loadSnapshot()
  const d = await api('read_delta', { since: state.lastSync })
  if (d.version) state.ticketVersion = d.version
  // The server's clock, never the phone's — a device running fast would set a
  // cursor in the future and silently skip every row written in between.
  if (d.serverTime) state.lastSync = d.serverTime
  if (!d.rows.length) return
  for (const row of d.rows) {
    const t = toTicket(d.fields, row)
    const existing = state.byNumber[t.number]
    if (existing) Object.assign(existing, t)
    else state.tickets.push(t)
  }
  reindex()
}

export function reindex() {
  state.byNumber = Object.fromEntries(state.tickets.map(t => [t.number, t]))
  index = buildIndex(state.tickets, agentMap.value)
}

/**
 * Loads each part of the picture independently.
 *
 * This used to be one try block, so a single failing call threw the user back
 * to the sign-in error screen after they had already signed in successfully.
 * The commonest cause was the spreadsheet not being set up yet: the backend
 * throws SHEET_MISSING, and a working account looked like a broken login.
 *
 * Now one failure costs you one panel, and the reason is reported.
 */
export async function refresh() {
  state.loading = true
  state.problems = []
  state.needsSetup = false

  const step = async (what, fn) => {
    try { await fn() } catch (err) {
      if (err.code === 'SHEET_MISSING' || err.code === 'NOT_CONFIGURED') state.needsSetup = true
      state.problems.push({ what, code: err.code, message: err.message })
    }
  }

  try {
    await step('tickets', async () => {
      // Showing the cached skeleton still means the personal columns are
      // missing, so a full load is required however current the version is.
      if (!state.tickets.length || state.fromCache) return loadSnapshot()

      // Otherwise ask the cheapest question in the API — two script properties,
      // no spreadsheet — and only fetch rows when something has actually moved.
      const v = await api('read_version', {})
      if (v.tickets === state.ticketVersion) {
        state.lastSync = v.serverTime || state.lastSync
        return
      }
      await loadDelta()
    })

    await step('sellers', async () => {
      state.agents = (await api('list_agents', {})).agents
    })

    await step('books', async () => {
      const books = await api('list_books', {})
      state.books = books.books
      state.bookStats = books.stats
    })

    reindex()

    await step('totals', async () => {
      const draw = await api('report_draw_ready', {})
      state.totals = draw.totals
      state.bookStats = draw.booksByStatus
    })

    // Only roles the server allows — asking anyway would add a guaranteed
    // failure to the list for every agent and viewer.
    if (isAdmin.value || state.user?.role === 'recorder') {
      await step('overdue books', async () => {
        state.overdue = (await api('report_overdue', {})).overdue
      })
    }

    // Quiet on purpose: an older deployment has no approvals at all, and a
    // missing action must not show up as a broken panel.
    try {
      const a = await api('list_approvals', { status: 'Pending' })
      state.pendingApprovals = (a.requests || []).length
    } catch { state.pendingApprovals = 0 }

    // Never the device clock: a phone running fast would set a cursor in the
    // future and silently skip every row written in between.
    return state.problems.length === 0
  } finally {
    state.loading = false
  }
}

// ---------- optimistic writes ----------

/**
 * Applies the change locally first so the screen reacts instantly, then sends
 * it. If the server refuses, the local change is rolled back and the caller
 * gets the error. This is what makes the app feel immediate on a slow phone
 * connection, without ever showing a sale that did not actually save.
 */
export async function optimistic(ticketNumber, patch, action, payload) {
  const t = state.byNumber[ticketNumber]
  const before = t ? { ...t } : null
  if (t) Object.assign(t, patch)
  try {
    const res = await api(action, payload)
    if (t && res?.version) t.version = res.version
    return res
  } catch (err) {
    if (t && before) Object.assign(t, before)
    throw err
  }
}

export function setSellMode(mode) {
  state.sellMode = mode
  try { localStorage.setItem(LS.mode, mode) } catch { /* private window */ }
}

export function go(screen) {
  state.screen = screen
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ---------- toasts ----------

export const toasts = ref([])
let toastId = 0

/**
 * @param {string} message  English, always shown
 * @param {string} tone     '' | 'ok' | 'bad'
 * @param {string} code     server error code, so the Burmese line can be looked
 *                          up by code rather than by matching English text
 */
export function toast(message, tone = '', code = '') {
  const id = ++toastId
  toasts.value.push({ id, message, tone, my: myError(code) || my(message) })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, tone === 'bad' ? 6000 : 3000)
}

export { api, ApiError }
