/**
 * The one reactive store.
 *
 * Everything the screens show derives from here, so a single change ripples
 * out to every view that depends on it without anyone re-rendering by hand.
 */

import { reactive, computed, ref } from 'vue'
import { api, ApiError, LS } from './api.js'
import { buildIndex, runSearch } from './search.js'

export const TICKET_STATUS = {
  AVAILABLE: 'Available', RESERVED: 'Reserved', SOLD: 'Sold',
  DONATED: 'Donated', VOID: 'Void'
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
  sellMode: localStorage.getItem(LS.mode) || 'steps',   // 'steps' | 'quick'
  query: '',
  filterStatus: '',
  filterAgent: ''
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

export async function loadSnapshot() {
  const tickets = []
  let offset = 0
  for (let guard = 0; guard < 40; guard++) {
    const page = await api('read_snapshot', { offset, limit: 2000 })
    page.rows.forEach(r => tickets.push(toTicket(page.fields, r)))
    state.loadProgress = page.total ? { done: tickets.length, total: page.total } : null
    if (!page.hasMore) break
    offset += page.returned
  }
  state.tickets = tickets
  state.loadProgress = null
  reindex()
}

export async function loadDelta() {
  if (!state.lastSync) return loadSnapshot()
  const d = await api('read_delta', { since: state.lastSync })
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

export async function refresh({ quiet = true } = {}) {
  state.loading = true
  try {
    if (!state.tickets.length) await loadSnapshot()
    else await loadDelta()

    const [agents, books] = await Promise.all([
      api('list_agents', {}),
      api('list_books', {})
    ])
    state.agents = agents.agents
    state.books = books.books
    state.bookStats = books.stats
    reindex()

    const draw = await api('report_draw_ready', {})
    state.totals = draw.totals
    state.bookStats = draw.booksByStatus

    if (isAdmin.value || state.user?.role === 'recorder') {
      const od = await api('report_overdue', {})
      state.overdue = od.overdue
    }

    state.lastSync = new Date().toISOString()
    return true
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

export function toast(message, tone = '') {
  const id = ++toastId
  toasts.value.push({ id, message, tone })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, tone === 'bad' ? 6000 : 3000)
}

export { api, ApiError }
