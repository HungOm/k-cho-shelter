<script setup>
/**
 * Who can sign in, and what the raffle is set to.
 *
 * The super admin is a rung above admin: it lives in a Script Property, outside
 * the spreadsheet, so nothing in this screen can grant it or take it away.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast, isSuper, go } from '../lib/store.js'
import { money, date, dateTime, ROLE_WORDS } from '../lib/format.js'

const emit = defineEmits(['add-user', 'make-tickets', 'tickets-in-play', 'deadlines'])

/**
 * Three numbers, and keeping them apart is the whole point of this card.
 *
 *   made    — ticket rows that exist. Only ever goes up, and not easily.
 *   live    — how many of those are sellable right now. Moves freely.
 *   waiting — the difference: printed, paid for, and deliberately not yet out.
 *
 * `totalTickets` means LIVE, which is right for the progress bar and the money
 * target — a raffle holding half its tickets back should read "1,248 of 10,000",
 * not "of 20,000". It is the wrong number for anything about creating rows.
 */
const made = computed(() => c.value?.generatedTickets ?? c.value?.totalTickets ?? 0)
const live = computed(() => c.value?.totalTickets || 0)
const waiting = computed(() => c.value?.heldBackTickets ?? Math.max(0, made.value - live.value))

/**
 * Whether any more rows could ever be created. A ceiling of 0 means none was
 * set, so headroom is unknown rather than zero — offering the button is right
 * in that case, refusing to is not.
 */
const allMade = computed(() =>
  !!c.value?.ticketCeiling && made.value >= c.value.ticketCeiling)

const users = ref(null)
const audit = ref(null)
const superAdmin = ref('')
const c = computed(() => state.cfg)


onMounted(loadUsers)

async function loadUsers() {
  try {
    const r = await api('list_users', {})
    users.value = r.users
    superAdmin.value = r.superAdmin || ''
  } catch (err) { toast(err.message, 'bad', err.code); users.value = [] }
}

/**
 * What an account is, in one word.
 *
 * The column said on/off while the gate had four states. "off" covered three
 * of them — waiting to be let in, paused, and stopped for good — which are not
 * the same thing to the person refused, and not the same decision to the person
 * looking at the list.
 */
const STATUS_WORDS = {
  active: 'on', pending: 'waiting', suspended: 'paused', banned: 'stopped',
}
const statusOf = u => u.status || (u.active ? 'active' : 'suspended')

/**
 * Only the changes THIS person may actually make to THIS row.
 *
 * Built from the gate's own rules rather than guessed, because offering a
 * button that comes back SUPER_ADMIN_ONLY is the failure this app keeps
 * repeating: a control that looks available, refuses, and leaves somebody
 * pressing it again. The rules, from setUserStatus:
 *   - the super admin's own row cannot be changed from the app at all
 *   - you cannot stop your own account
 *   - anybody who is not a seller is the owner's business only
 *   - letting somebody IN is the owner's alone; pausing them is not
 * Pausing is the urgent one — a lost phone on a Sunday should not wait for the
 * owner to wake up — and it is the only one safe to delegate.
 */
function actionsFor(u) {
  if (u.isSuperAdmin) return []
  const now = statusOf(u)
  const mine = []
  if (isSuper.value) {
    if (now !== 'active') mine.push({ status: 'active', label: 'Let in', tone: 'primary' })
    if (now !== 'suspended' && !u.isYou) mine.push({ status: 'suspended', label: 'Pause' })
    if (now !== 'banned' && !u.isYou) mine.push({ status: 'banned', label: 'Stop' })
    return mine
  }
  // An organiser: sellers only, and never the decision to let somebody in.
  if (u.role !== 'agent' || u.isYou) return []
  if (now !== 'suspended') mine.push({ status: 'suspended', label: 'Pause' })
  if (now !== 'banned') mine.push({ status: 'banned', label: 'Stop' })
  return mine
}

const SAID = {
  active: 'Let in — they can sign in now',
  suspended: 'Paused — they lose access within a minute',
  banned: 'Stopped — they lose access within a minute',
  pending: 'Set to waiting',
}

async function setStatus(u, status) {
  try {
    await api('set_user_status', { email: u.email, status })
    toast(SAID[status] || 'Changed', 'ok')
    loadUsers()
  } catch (err) { toast(err.message, 'bad', err.code) }
}

async function loadAudit() {
  audit.value = 'loading'
  try { audit.value = (await api('read_audit', { limit: 100 })).entries }
  catch (err) { toast(err.message, 'bad', err.code); audit.value = null }
}
</script>

<template>
  <div>
    <h1>Setup</h1>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Who can sign in</h3>
        <button class="btn sm primary" @click="emit('add-user')">Add someone</button></div>
      <p class="muted small">Turn someone off here and they lose access within a minute.</p>

      <div v-if="users === null" class="col" style="gap:10px"><div v-for="i in 3" :key="i" class="skel"></div></div>
      <div v-else class="tablewrap">
        <table>
          <thead><tr><th>Email</th><th>Can do</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.email">
              <td>
                {{ u.email }}
                <span v-if="u.isYou" class="pill info">you</span>
                <span v-if="u.isSuperAdmin" class="pill ok">super admin</span>
              </td>
              <!-- The super admin's row role is only what their ordinary user
                   record says; their actual authority sits outside the database
                   and outranks every role here. Printing "Organiser" against
                   their name read as a ceiling, which it is not. -->
              <td>{{ u.isSuperAdmin ? 'Everything' : (ROLE_WORDS[u.role] || u.role) }}</td>
              <td>
                <span :class="['pill', statusOf(u) === 'active' ? 'ok'
                                     : statusOf(u) === 'pending' ? 'info' : 'bad']">
                  {{ STATUS_WORDS[statusOf(u)] || statusOf(u) }}
                </span>
              </td>
              <td>
                <!-- Only what this person may actually do to this row. An
                     organiser is not shown "Let in" at all, rather than being
                     shown it and refused. -->
                <button v-for="a in actionsFor(u)" :key="a.status"
                        :class="['btn', 'sm', a.tone || '']" style="margin-right:6px"
                        @click="setStatus(u, a.status)">{{ a.label }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!isSuper" class="hint">
        Only the super admin can add or change an organiser.
      </p>
    </div>

    <div v-if="isSuper" class="card">
      <div class="spread">
        <div class="grow">
          <h3 style="margin:0">Who can do what</h3>
          <p class="muted small" style="margin:4px 0 0">
            Turn any feature on or off for each kind of user.
          </p>
        </div>
        <button class="btn" @click="go('permissions')">Open</button>
      </div>
    </div>

    <div v-if="isSuper && c" class="card">
      <div class="spread">
        <div class="grow">
          <h3 style="margin:0">Tickets in play</h3>
          <p class="muted small" style="margin:4px 0 0">
            <template v-if="waiting">
              {{ live.toLocaleString() }} of {{ made.toLocaleString() }} can be sold.
              {{ waiting.toLocaleString() }} are printed and waiting.
            </template>
            <template v-else>
              All {{ live.toLocaleString() }} tickets that have been made are in play.
            </template>
          </p>
        </div>
        <button class="btn" @click="emit('tickets-in-play')">Change</button>
      </div>

      <!-- Creating rows is a different and heavier thing, so it sits under a
           divider rather than beside the everyday button. -->
      <div class="sub">
        <span class="muted small grow">
          <template v-if="allMade">
            All {{ made.toLocaleString() }} planned tickets have been made.
          </template>
          <template v-else>
            Need more than {{ made.toLocaleString() }} tickets altogether?
          </template>
        </span>
        <button v-if="!allMade" class="btn sm ghost" @click="emit('make-tickets')">
          Make more
        </button>
      </div>
    </div>

    <div v-if="c" class="card">
      <h3>How this raffle is set up</h3>
      <div class="tablewrap">
        <table>
          <tbody>
            <tr><td>Tickets in play</td><td>{{ live.toLocaleString() }} — {{ c.ticketPrefix }}{{ String(c.ticketStart).padStart(c.ticketDigits, '0') }} onwards</td></tr>
            <tr v-if="waiting"><td>Printed and waiting</td><td>{{ waiting.toLocaleString() }}</td></tr>
            <tr v-if="waiting"><td>Made altogether</td><td>{{ made.toLocaleString() }}</td></tr>
            <tr v-if="c.ticketCeiling"><td>Planned total</td><td>{{ c.ticketCeiling.toLocaleString() }}</td></tr>
            <tr><td>In each book</td><td>{{ c.ticketsPerBook }} — that makes {{ c.totalBooks }} books</td></tr>
            <tr><td>Price</td><td>{{ money(c.ticketPrice, c.currency) }} each</td></tr>
            <tr><td>If all sold</td><td>{{ money(live * c.ticketPrice, c.currency) }}<span v-if="waiting" class="muted small"> — of what is in play</span></td></tr>
            <tr>
              <td>Everybody reports by</td>
              <td>
                {{ c.checkInDate ? date(c.checkInDate) : 'not set' }}
                <span class="muted small">— the same date for every seller</span>
              </td>
            </tr>
            <tr>
              <td>Everything back by</td>
              <td>
                <template v-if="c.finalDeadline">{{ date(c.finalDeadline) }}</template>
                <span v-else class="pill warn">not set</span>
              </td>
            </tr>
            <tr><td>Draw date</td><td>{{ c.drawDate || 'not set' }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="sub">
        <span class="muted small grow">
          The check-in date moves on a month at a time, up to the final deadline.
        </span>
        <button class="btn sm ghost" @click="emit('deadlines')">Deadlines</button>
      </div>
      <p class="hint">
        Ticket numbers are fixed once the tickets are made. Everything else is changed
        in the <b>Config</b> tab of the spreadsheet.
      </p>
    </div>

    <div v-if="isSuper" class="card">
      <div class="spread"><h3 style="margin:0">What people have been doing</h3>
        <button class="btn sm" @click="loadAudit">Show</button></div>
      <div v-if="audit === 'loading'" class="col" style="gap:10px">
        <div v-for="i in 3" :key="i" class="skel"></div>
      </div>
      <div v-else-if="audit">
        <div v-for="(e, i) in audit" :key="i" class="log">
          <div class="small"><b>{{ e.action }}</b> <span class="muted">{{ e.email }}</span></div>
          <div class="tiny muted">{{ dateTime(e.time) }} · {{ String(e.details).slice(0, 120) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sub {
  display: flex; align-items: center; gap: 10px;
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);
}
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: 0; }
</style>
