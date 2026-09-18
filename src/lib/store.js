/**
 * The one reactive store.
 *
 * Everything the screens show derives from here, so a single change ripples
 * out to every view that depends on it without anyone re-rendering by hand.
 */

import { reactive, computed, ref } from 'vue'
import { ApiError, LS } from './errors.js'
// Through the switch, not straight at Apps Script: every screen's reads and
// writes are these calls, so this one import is what actually moves the app
// from one backend to the other.
import { api as rawApi } from './backend.js'
import { buildIndex, runSearch } from './search.js'
import { saveTickets, loadTickets, clearCache } from './cache.js'
import { my, myError } from './i18n.js'
import { ATTN } from './attentionlines.js'
// A check-in date is a plain calendar day, so it goes through the formatter
// that reads it as one. `new Date('2026-10-14')` is UTC midnight and renders as
// the 13th west of here — the day-early bug this codebase has had four times.
import { date } from './format.js'
import { applyBrand } from './brand.js'

export const TICKET_STATUS = {
  AVAILABLE: 'Available', RESERVED: 'Reserved', SOLD: 'Sold',
  DONATED: 'Donated', VOID: 'Void'
}

/**
 * Whether a ticket is spoken for and must not be sold again.
 *
 * TWO STATUSES, ONE FACT. A donated ticket is as sold as a sold one — it is in
 * the draw, somebody's name is on it, and the money question is settled a
 * different way. The server has always known this and says so in one place:
 * `const SOLD = ['Sold', 'Donated']` in tickets.ts. The browser spelled it out
 * by hand in seven, and two of them said only 'Sold'.
 *
 * What that cost: the bulk sell form marks a line "already sold" before saving,
 * so that one bad row does not take a batch of forty down with it at the
 * server. A donated ticket passed that check, went to the server, and was
 * refused — the whole batch failed and the line that caused it was the one line
 * not flagged. Its reconcile step had the same hole in the more dangerous
 * direction: after a timeout it looks at what landed, and a ticket that had
 * genuinely been written as Donated read as missing and was sent again.
 *
 * This is the shape of bug this repository has produced repeatedly — two halves
 * of one fact drifting — so the fact lives here now and nowhere else.
 */
export function isSold(ticket) {
  return ticket?.status === TICKET_STATUS.SOLD || ticket?.status === TICKET_STATUS.DONATED
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
  // Requests of yours that were turned down and not asked again since.
  refusedApprovals: 0,

  // Which reporting round is live, and the day everybody answers by. Carried on
  // the seller list rather than fetched on its own, because every screen that
  // needs it already has that list.
  checkIn: { date: '', round: 1, reportBy: '', graceDays: 3 },

  // ui
  screen: 'home',
  loading: false,
  loadProgress: null,
  lastSync: null,
  sellMode: readSellMode(),                             // 'steps' | 'quick'
  query: '',
  filterStatus: '',
  filterAgent: '',
  filterWhere: '',        // '' | 'office' | 'out'


  // what failed on the last load, and whether the spreadsheet is set up at all
  problems: [],
  needsSetup: false,

  // Books out and running late, from read_version. Scoped by the server: a
  // seller gets their own, everybody else gets all of them.
  returns: { late: 0, dueSoon: 0, by: '', scope: 'all' },

  // How many requests are waiting on a second person. Null until something has
  // said — so refresh() can tell "nobody is waiting" from "nothing has told me
  // yet", and only pay for the extra call in the second case.
  pendingApprovals: null,

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

/**
 * Which seller is holding each book, keyed by book number.
 *
 * The book is the single source of truth for custody — a ticket only records
 * who SOLD it, which is blank until it sells. Without this, an unsold ticket in
 * a book that is out with somebody looks identical to one sitting in the
 * office, and an organiser reads "not sold yet" as "free to sell".
 */
export const bookHolders = computed(() => {
  const map = {}
  for (const b of state.books) {
    map[String(b.book).toUpperCase()] = {
      status: b.status,
      agentId: b.agentId || '',
      agentName: b.agentName || '',
      out: b.status === 'Out'
    }
  }
  return map
})

/** Where a ticket physically is, as opposed to whether it has been sold. */
export function whereIs(ticket) {
  const b = bookHolders.value[String(ticket?.book || '').toUpperCase()]
  if (!b) return null
  return b
}

/**
 * Why this ticket cannot be claimed for a buyer right now, in a few words, or
 * null if it can.
 *
 * The rule is: you can only sell paper you can hand to the buyer. A book that
 * is Out is in a seller's bag — selling one of its tickets at the desk gives
 * the buyer a number and no ticket, and leaves the seller free to sell that
 * same number in person. An organiser may still record against it, because
 * that is writing down what the seller reported rather than selling.
 *
 * This is a COURTESY, not the enforcement. The backend refuses either way. It
 * exists so a helper finds out while typing rather than after keying in thirty
 * stubs, and because this screen has been wrong about the data before — a
 * stale book list must never be what decides a sale.
 */
/**
 * The one way config gets into the app.
 *
 * NOT just an assignment. The raffle's colour has to be applied the moment its
 * config arrives, and doing that at the call site meant a correct applyBrand
 * that nothing was obliged to call — I deleted the line from App.vue and the
 * whole suite stayed green. Routing every config change through here turns
 * "did somebody remember?" into "is there another way in?", and the second
 * question can be answered exhaustively by looking.
 *
 * So: no `state.cfg =` anywhere else. A test asserts that, because the rule is
 * only worth anything if it holds everywhere.
 */
export function setConfig(cfg) {
  state.cfg = cfg || null
  applyBrand(state.cfg?.brandColor)
  return state.cfg
}

/**
 * The person behind an email address, for the screens that show who did
 * something rather than who bought something.
 *
 * Every sold ticket carries the email of whoever wrote it down, and it was
 * rendered raw — an address nobody here calls anybody by, in a column people
 * read at a glance. The names arrive once at sign-in (whoami carries the dozen
 * people who can sign in), so this is a lookup and not a request.
 *
 * THREE ANSWERS, because they are read differently:
 *   somebody else   their name, with the address underneath in small
 *   the reader      "You (Their Name)", because a record of your own work
 *                   should say so — checking an address against your own to
 *                   find out whether it was you is work the screen can do
 *   nobody known    the address itself, once. An address shown twice, as both
 *                   the name and the note under it, reads as a rendering bug.
 */
export function whoIs(email) {
  const want = String(email || '').trim().toLowerCase()
  if (!want) return null
  const me = state.user || {}
  const row = (me.staff || []).find((s) => s.email === want)
  return {
    email: want,
    name: row?.name || '',
    // Blank on an older backend that sends no role, which is how the tag stays
    // absent rather than wrong while a deploy catches up.
    role: row?.role || '',
    you: String(me.email || '').trim().toLowerCase() === want,
  }
}

export function sellBlock(ticket) {
  return bookBlock(whereIs(ticket))
}

/**
 * Why this BOOK cannot be sold from right now, in a few words, or null.
 *
 * The same rule as sellBlock and deliberately the same function, because a
 * ticket's answer and its book's answer must never differ — that is the shape
 * of bug this repo has produced five times, two halves of one fact drifting.
 * sellBlock is now this with a ticket's book looked up first.
 *
 * Mirrors what the database refuses in sell_books and sell_book_whole: out with
 * a seller, and you are neither that seller nor an organiser transcribing what
 * they reported. A courtesy only — the backend refuses regardless — so that
 * somebody finds out before pressing rather than after.
 */
export function bookBlock(b) {
  /*
   * A BOOK THAT IS NOT IN YOUR LIST IS NOT YOURS, and for a seller that now
   * means something it did not used to.
   *
   * A seller's book list is the books in their hands — Out, and nothing else.
   * So a ticket whose book is missing from it belongs to a book that has been
   * brought back, counted in, lost or was never theirs, and every one of those
   * is a sale the server will refuse. Returning null here meant "not blocked",
   * which would have the screen offer the sale and the refusal arrive after the
   * press: the exact shape this function exists to prevent.
   *
   * STAFF ARE UNCHANGED. They hold the whole raffle in their list, so a miss is
   * a snapshot still loading rather than a book that is not theirs, and failing
   * closed there would block the desk for the first seconds of every session.
   */
  if (!b) return state.user?.role === 'agent' ? 'not one of your books' : null
  if (['Settled', 'Lost', 'Void'].includes(b.status)) return `book is ${b.status.toLowerCase()}`
  /*
   * OFFERED COUNTS AS WITH A SELLER. A book reserved for somebody who has not
   * accepted it yet is not stock: Book-003 sat at Offered with nothing sold and
   * "Sell it whole" live on it. It is about to be handed over, and the person it
   * is waiting on may sell from it the moment they take it.
   */
  if (b.status !== 'Out' && b.status !== 'Offered') return null

  const me = state.user || {}
  // The holder, or — while it is only an offer — the seller it is waiting on.
  const heldBy = b.agentId || b.offeredTo || ''
  if (me.agentId && heldBy === me.agentId) return null          // it is in their hands
  /*
   * NAMES BOTH SIDES, because "not your book" is unanswerable.
   *
   * A seller looking at the tickets in what they believed was their own book
   * was told the book was with somebody — whose name was their own — and then
   * refused. The two seller ids were different and nothing on any screen showed
   * either. The same sentence the server now sends, in fewer words, so the
   * screen and the refusal agree.
   */
  if (me.role === 'agent') {
    if (!me.agentId) return 'your account is not linked to a seller'
    return `with seller ${heldBy || 'nobody'}, you are ${me.agentId}`
  }
  /*
   * AND AN ORGANISER IS NOT AN EXCEPTION ANY MORE.
   *
   * This returned null for an organiser — "transcribing a report" — so the desk
   * could write a sale into a book sitting in a seller's bag. The raffle's owner
   * ruled that the stubs decide: whoever is holding the paper is the only person
   * who can sell from it, and the way to sell a book that is out with somebody
   * is to have it brought back first. The server refuses it now, so returning
   * null here would only offer a button that fails after the press.
   */
  /*
   * TWO DIFFERENT WAYS ROUND IT, and saying the wrong one sends somebody to a
   * screen that cannot help them. An OFFER has not been accepted, so nothing
   * has to come back — the organiser takes the offer back and the book is on
   * the shelf again. A book that is OUT has been accepted, and the only route
   * is a return, or waiting for the seller's report at the deadline.
   */
  return b.status === 'Offered'
    ? `being offered to ${b.agentName || heldBy || 'a seller'} — take the offer back first`
    : `with ${b.agentName || 'a seller'} — have it brought back first`
}

/**
 * Whether this write is the ORGANISER'S OVERRIDE, and so has to say why.
 *
 * bookBlock answers "may I", and for this case the answer is yes — writing down
 * what a seller telephoned in is ordinary and has to keep working. This answers
 * the question directly underneath it: am I allowed to do this only because of
 * who I am, rather than because the paper is here.
 *
 * SEPARATE FROM bookBlock ON PURPOSE. Folding it in would make one function
 * mean two things — "you cannot" and "you can, with a sentence" — and the
 * screens that render a block as a disabled button with a reason on it would
 * start disabling the case that is allowed.
 *
 * A COURTESY, like bookBlock. The Edge Function refuses a reasonless override
 * whatever this says; this is so somebody is asked before pressing rather than
 * after, and so the box appears beside the sale rather than as an error on top
 * of it. The two must agree — see whoholds.test.mjs for the server's half.
 */
export function overrideReasonNeeded(b) {
  if (!b || b.status !== 'Out' || !b.agentId) return false
  const me = state.user || {}
  return b.agentId !== me.agentId
}

/** The same question about a ticket, via the book it lives in. */
export function sellOverrideNeeded(ticket) {
  return overrideReasonNeeded(whereIs(ticket))
}

export const searchResults = computed(() => {
  if (!index.length) return { total: 0, results: [] }
  /*
   * NO CAP, BECAUSE THE SCREEN PAGES NOW.
   *
   * runSearch defaults to the first 300 hits, and Find drew every one of them
   * in a single list with "(showing first 300)" underneath — so a search that
   * matched two thousand tickets was both a wall to scroll and a list somebody
   * had to know was cut. Paging is the answer to both, and paging over a
   * truncated array pages over the truncation.
   *
   * The cost is an array of references rather than a rendered row, which is
   * what actually costs anything on a phone: twenty thousand entries is a few
   * hundred kilobytes and twenty thousand list items is a dead tab.
   */
  return runSearch(index, {
    query: state.query, status: state.filterStatus,
    agent: state.filterAgent, where: state.filterWhere,
    limit: Infinity,
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
  const items = []

  /*
   * SOMEBODY SAID NO, AND YOU HAVE NOT ANSWERED IT.
   *
   * FIRST, above overdue books, and the ordering is the point: an overdue book
   * is drifting, a refusal has already gone wrong and is sitting still. A seller
   * disputing a count-in means the figures are wrong NOW and stay wrong until
   * somebody reads their words and asks again.
   *
   * BEFORE THE TOTALS GUARD, which is not tidiness — it is the difference
   * between this working for a seller and not. Everything below needs
   * `overview`, built from report_draw_ready, an action a SELLER IS REFUSED on
   * purpose because the raffle's money is not theirs to see. So overview is null
   * for them and this list returned empty before it asked a single question. A
   * refusal has nothing to do with the totals.
   *
   * The server counts only refusals the asker has not followed up, so this
   * clears by being ACTED ON. An alert you can tick away is one everybody ticks
   * away, which is this app's rule and the reason there is no dismiss button.
   */
  if (state.refusedApprovals) items.push({
    key: 'refused', tone: 'bad', icon: 'hand',
    title: state.refusedApprovals === 1
      ? { text: ATTN.refusedOne }
      : { text: ATTN.refusedMany, vars: { n: state.refusedApprovals } },
    detail: { text: ATTN.refusedWhy }, go: 'approvals'
  })

  const o = overview.value
  if (!o) return items
  const late = state.overdue.length
  const open = (state.bookStats.Out || 0) + (state.bookStats.Returned || 0)

  if (late) items.push({
    key: 'overdue', tone: 'bad', icon: 'clock',
    title: late === 1 ? { text: ATTN.overdueOne } : { text: ATTN.overdueMany, vars: { n: late } },
    detail: { text: ATTN.overdueWhy }, go: 'agents'
  })
  /*
   * WHO HAS NOT REPORTED, which is not the same question as which book is late.
   *
   * Derived from the seller list the server already scoped and decided, so this
   * screen cannot disagree with the Sellers screen about who is outstanding.
   * There is nothing to dismiss: it goes when the reports are recorded, and a
   * roll to the next round brings it back for everybody who has not answered
   * the new one.
   */
  const silent = state.agents.filter(a => a.reportState === 'late').length
  const mine = state.agents.find(a => a.id === state.user?.agentId)
  if (mine && (mine.reportState === 'late' || mine.reportState === 'due')) {
    items.push({
      key: 'myreport', tone: mine.reportState === 'late' ? 'bad' : 'warn', icon: 'clock',
      title: { text: mine.reportState === 'late' ? ATTN.myReportLate : ATTN.myReportDue },
      detail: state.checkIn.date
        ? { text: ATTN.myReportBy, vars: { when: date(state.checkIn.date) } }
        : { text: ATTN.myReportAnyway },
      /*
       * OPENS THE REPORT, rather than sending them to a screen.
       *
       * It pointed at 'books', which is not in a seller's sidebar — the one
       * attention row written for sellers led to a page they cannot reach, so
       * the app told them it was time to report and then had nowhere to put
       * them. `act` is an emit for Home to raise; `go` stays for every other
       * row, which really is a screen.
       */
      act: 'report-back',
      go: 'books'
    })
  } else if (silent) {
    items.push({
      key: 'reports', tone: 'bad', icon: 'clock',
      title: silent === 1 ? { text: ATTN.silentOne } : { text: ATTN.silentMany, vars: { n: silent } },
      detail: { text: ATTN.silentWhy }, go: 'agents'
    })
  }
  if (o.missingContact) items.push({
    key: 'contact', tone: 'bad', icon: 'phoneOff',
    title: o.missingContact === 1
      ? { text: ATTN.contactOne }
      : { text: ATTN.contactMany, vars: { n: o.missingContact } },
    detail: { text: ATTN.contactWhy }, go: 'draw'
  })
  if (o.outstanding > 0) items.push({
    key: 'money', tone: 'warn', icon: 'money',
    title: { text: ATTN.moneyOut,
             vars: { amount: `${o.currency} ${o.outstanding.toFixed(2)}` } },
    detail: { text: ATTN.moneyWhy }, go: 'money'
  })
  if (open) items.push({
    key: 'open', tone: '', icon: 'books',
    title: open === 1 ? { text: ATTN.openOne } : { text: ATTN.openMany, vars: { n: open } },
    detail: { text: ATTN.openWhy }, go: 'books'
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
    /*
     * EVER GIVEN OUT, not out at this moment — and the card says "once".
     *
     * This asked whether any book is Out RIGHT NOW. So a raffle well past
     * setting up, with money collected and tickets sold, had the whole
     * first-run card come back the moment every book happened to be at the
     * desk: "Let's get started. Four things, once." to an organiser who had
     * plainly started. Reported from a live screen showing RM190 collected and
     * 19 tickets sold with the card above it.
     *
     * A book that has been out is in some status other than Unassigned —
     * Out, Returned, Settled, Lost — and none of those go backwards on their
     * own. Counted from the book totals the server already sends, so this asks
     * "has this raffle ever handed a book to anybody", which is the question
     * a once-only checklist is entitled to ask.
     */
    { done: Object.entries(state.bookStats || {})
        .some(([status, n]) => status !== 'Unassigned' && Number(n) > 0),
      title: 'Give out books',
      detail: state.bookStats.Out ? `${state.bookStats.Out} books out` : 'Hand books to a seller',
      action: 'issue' },
    { done: state.tickets.some(isSold),
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
  /*
   * FOLLOW THE CURSOR UNTIL THE SERVER SAYS THERE IS NO MORE.
   *
   * One call, one page, and the clock moved to the server's answer — so a
   * device that had missed more than one page of changes took the oldest of
   * them, set its clock past the rest, and never asked for them again. The
   * screen then stayed wrong without looking wrong, which a volunteer meets as
   * "the sale I just made is not on here".
   *
   * Bounded, because a loop driven by a server's own answer is how a bad deploy
   * hangs the app. Twenty pages is twenty thousand changed tickets in one gap;
   * past that a full reload is cheaper and likelier to be what somebody wants.
   */
  let since = state.lastSync
  let serverTime = ''
  let applied = 0

  for (let page = 0; page < 20; page++) {
    const d = await api('read_delta', { since })
    if (d.version) state.ticketVersion = d.version
    // The server's clock, never the phone's — a device running fast would set a
    // cursor in the future and silently skip every row written in between.
    if (d.serverTime) serverTime = d.serverTime

    for (const row of d.rows ?? []) {
      const t = toTicket(d.fields, row)
      const existing = state.byNumber[t.number]
      if (existing) Object.assign(existing, t)
      else state.tickets.push(t)
      applied++
    }

    // nextSince repeats the last row's timestamp, so rows sharing it arrive
    // again. Applying a row twice is applying it once; losing one is not.
    if (!d.hasMore || !d.nextSince) break
    since = d.nextSince
  }

  /*
   * The clock moves only once every page has been applied. Moving it per page
   * would leave a hole if a later page failed: those rows would be missed and
   * the cursor would already be past them.
   */
  if (serverTime) state.lastSync = serverTime
  if (applied) reindex()
}

/**
 * The cheap check: has anything changed, and is anybody waiting on me?
 *
 * One call. It answers both questions because read_version already had to ask
 * the database the time, and counting pending approvals with head:true costs
 * about the same again.
 *
 * Failures are swallowed deliberately. A poll that cannot reach the server is
 * not news — the next one will, or the person is already looking at a screen
 * that told them. Pushing a red banner every thirty seconds because a phone
 * went through a tunnel is how people learn to ignore banners.
 */
/**
 * The return-date counts, from whichever call carried them.
 *
 * Read in one place because read_version is fetched from two — the poll and
 * the first load — and a banner that only appears after a full refresh is a
 * banner the seller who needs it never sees.
 */
function takeReturns(v) {
  if (v.booksLate === undefined && v.booksDueSoon === undefined) return
  state.returns = {
    late: Number(v.booksLate) || 0,
    dueSoon: Number(v.booksDueSoon) || 0,
    by: v.dueSoonBy || '',
    scope: v.scope === 'mine' ? 'mine' : 'all',
  }
}

export async function poll() {
  try {
    const v = await api('read_version', {})
    if (v.approvalsWaiting !== undefined) state.pendingApprovals = v.approvalsWaiting
    takeReturns(v)
    if (v.tickets !== undefined && v.tickets !== state.ticketVersion) await loadDelta()
    else if (v.serverTime) state.lastSync = v.serverTime
  } catch { /* not news */ }
}

export function reindex() {
  state.byNumber = Object.fromEntries(state.tickets.map(t => [t.number, t]))
  index = buildIndex(state.tickets, agentMap.value, bookHolders.value)
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

  // Being refused is not the same as being broken. A seller is not supposed to
  // see the money totals, so reporting "some things could not be loaded" about
  // them describes a working system as a failing one, and sends somebody off
  // asking an organiser what is wrong with the app. The panel simply does not
  // appear, which is what "you do not have this" should look like.
  //
  // Decided here rather than by checking the role before asking, because a
  // deployment can widen or narrow any action in its Permissions tab: only the
  // server knows who may see what, and a guess in the client would drift.
  const notForYou = ['INSUFFICIENT_ROLE', 'SUPER_ADMIN_ONLY']

  /*
   * EVERY ASSIGNMENT BELOW KEEPS ITS EMPTY SHAPE.
   *
   * A handler that returns successfully and omits a field used to put undefined
   * straight into the store, and the next render dereferenced it: bookStats
   * became undefined, attention() read state.bookStats.Out, and the whole app
   * went white. A volunteer then has nothing to describe except "it stopped".
   *
   * This has now happened three times from three different fields, so the fix
   * belongs at the assignment rather than at each of the dozen places that read
   * them. A missing count should show an empty grid, a missing list an empty
   * list. Degrading is not the same as hiding: the failure still reaches
   * state.problems and is still reported — it just no longer takes the page
   * down on its way there.
   */
  const step = async (what, fn) => {
    try { await fn() } catch (err) {
      if (err.code === 'SHEET_MISSING' || err.code === 'NOT_CONFIGURED') state.needsSetup = true
      if (notForYou.includes(err.code)) return
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
      // Rides along on a call that already happens, so a waiting request is
      // known without a second round trip.
      if (v.approvalsWaiting !== undefined) state.pendingApprovals = v.approvalsWaiting
      takeReturns(v)
      if (v.tickets === state.ticketVersion) {
        state.lastSync = v.serverTime || state.lastSync
        return
      }
      await loadDelta()
    })

    await step('sellers', async () => {
      const people = await api('list_agents', {})
      state.agents = people.agents ?? []
      // Defaulted rather than assigned blindly: an older backend sends no
      // check-in block at all, and undefined here would put "undefined" into a
      // sentence about a date.
      if (people.checkIn) state.checkIn = { ...state.checkIn, ...people.checkIn }
    })

    await step('books', async () => {
      const books = await api('list_books', {})
      state.books = books.books ?? []
      state.bookStats = books.stats ?? {}
    })

    reindex()

    await step('totals', async () => {
      const draw = await api('report_draw_ready', {})
      state.totals = draw.totals ?? null
      state.bookStats = draw.booksByStatus ?? {}
    })

    // Skipped for roles that plainly cannot have it — not to avoid an error,
    // which `notForYou` now swallows, but to save every seller a round trip on
    // a phone for an answer that is nearly always no.
    if (isAdmin.value || state.user?.role === 'recorder') {
      await step('overdue books', async () => {
        state.overdue = (await api('report_overdue', {})).overdue ?? []
      })
    }

    // Quiet on purpose: an older deployment has no approvals at all, and a
    // missing action must not show up as a broken panel. Skipped entirely when
    // read_version already carried the count, which is the whole point of
    // putting it there — this is the fallback for a backend that predates it.
    if (state.pendingApprovals === null) {
      try {
        const a = await api('list_approvals', { status: 'Pending' })
        state.pendingApprovals = (a.requests || []).length
      } catch { state.pendingApprovals = 0 }
    }

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

// ---------- the draw screen's own facts ----------

/**
 * A counter the Draw screen watches, bumped by anything that changes what is on
 * its prize board or in its winners list.
 *
 * WHY IT HAS TO EXIST. Every screen sits inside a KeepAlive, so a screen is
 * mounted once and then kept. The Draw screen fetches the prize schedule, the
 * winners and the readiness report itself, in onMounted — none of which is in
 * the ticket snapshot the poller refreshes. So adding a prize closed the dialog
 * onto a board that did not have it, and the only way to see it was to reload
 * the page.
 *
 * That is the shape of bug this repository has had twice already: the action
 * worked, nothing errored, and the screen quietly disagreed with the database.
 * A volunteer reads that as the button not having worked, and presses it again.
 *
 * A counter rather than an event bus, because there is exactly one screen
 * listening and one question being asked — has anything under me changed — and
 * the answer only ever needs to be "yes, again".
 */
export const drawStamp = ref(0)
export function drawChanged() { drawStamp.value++ }

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

/**
 * The same transport, except that an unconfirmed write reloads before it throws.
 *
 * A write that times out may well have landed, so the message the caller shows
 * says we are checking what actually went through. Nothing was checking: every
 * dialog just printed the sentence and stopped, which made it a promise the
 * app did not keep. Reloading here keeps it, for every caller, without each
 * one having to remember.
 *
 * Callers doing something more precise — Sell reconciles row by row and puts
 * the ones that did not land back in the form — pass { reconcile: true } and
 * handle it themselves rather than paying for the round trip twice.
 */
async function api(action, payload = {}, opts = {}) {
  try {
    return await rawApi(action, payload, opts)
  } catch (err) {
    if (err.code === 'WRITE_UNCONFIRMED' && !opts.reconcile) {
      loadDelta().catch(() => {})
    }
    throw err
  }
}

export { api, ApiError }
