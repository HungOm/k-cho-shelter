<script setup>
/**
 * Who can sign in, and what the raffle is set to.
 *
 * The super admin is a rung above admin: it lives in a Script Property, outside
 * the spreadsheet, so nothing in this screen can grant it or take it away.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast, isSuper } from '../lib/store.js'
import { money, dateTime } from '../lib/format.js'

const emit = defineEmits(['add-user'])

const users = ref(null)
const audit = ref(null)
const superAdmin = ref('')
const c = computed(() => state.cfg)

const ROLE_WORDS = {
  admin: 'Organiser', recorder: 'Helper', agent: 'Seller', viewer: 'Can only look'
}

onMounted(loadUsers)

async function loadUsers() {
  try {
    const r = await api('list_users', {})
    users.value = r.users
    superAdmin.value = r.superAdmin || ''
  } catch (err) { toast(err.message, 'bad'); users.value = [] }
}

async function toggle(u) {
  try {
    await api('set_user_status', { email: u.email, active: !u.active })
    toast(u.active ? 'Turned off — they lose access within a minute' : 'Turned on', 'ok')
    loadUsers()
  } catch (err) { toast(err.message, 'bad') }
}

async function loadAudit() {
  audit.value = 'loading'
  try { audit.value = (await api('read_audit', { limit: 100 })).entries }
  catch (err) { toast(err.message, 'bad'); audit.value = null }
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
              <td>{{ ROLE_WORDS[u.role] || u.role }}</td>
              <td><span :class="['pill', u.active ? 'ok' : 'bad']">{{ u.active ? 'on' : 'off' }}</span></td>
              <td>
                <button v-if="!u.isYou && !(u.role === 'admin' && !isSuper)"
                        class="btn sm" @click="toggle(u)">
                  {{ u.active ? 'Turn off' : 'Turn on' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="!isSuper" class="hint">
        Only the super admin can add or change an organiser.
      </p>
    </div>

    <div v-if="c" class="card">
      <h3>How this raffle is set up</h3>
      <div class="tablewrap">
        <table>
          <tbody>
            <tr><td>Tickets</td><td>{{ c.totalTickets.toLocaleString() }} — {{ c.ticketPrefix }}{{ String(c.ticketStart).padStart(c.ticketDigits, '0') }} onwards</td></tr>
            <tr><td>In each book</td><td>{{ c.ticketsPerBook }} — that makes {{ c.totalBooks }} books</td></tr>
            <tr><td>Price</td><td>{{ money(c.ticketPrice, c.currency) }} each</td></tr>
            <tr><td>If all sold</td><td>{{ money(c.totalTickets * c.ticketPrice, c.currency) }}</td></tr>
            <tr><td>Books due back after</td><td>{{ c.defaultDueDays }} days</td></tr>
            <tr><td>Draw date</td><td>{{ c.drawDate || 'not set' }}</td></tr>
          </tbody>
        </table>
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
.log { padding: 10px 0; border-bottom: 1px solid var(--border); }
.log:last-child { border-bottom: 0; }
</style>
