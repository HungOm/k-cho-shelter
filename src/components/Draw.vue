<script setup>
/**
 * Getting ready for the draw.
 *
 * The number that matters is how many sold tickets have nobody's phone on
 * them. Every one of those is a winner you would not be able to find.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast, isSuper, isAdmin } from '../lib/store.js'
import { moneyShort, date } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const emit = defineEmits(['open-ticket', 'record-winner'])

const ready = ref(null)
const missing = ref(null)
const winners = ref([])
const currency = computed(() => state.cfg?.currency || '')

onMounted(load)
async function load() {
  try {
    ready.value = await api('report_draw_ready', {})
    winners.value = (await api('list_winners', {})).winners
  } catch (err) { toast(err.message, 'bad') }
}

async function loadMissing() {
  missing.value = 'loading'
  try {
    missing.value = await api('report_missing_contact', { limit: 200 })
  } catch (err) { toast(err.message, 'bad'); missing.value = null }
}

async function exportEntries() {
  try {
    const r = await api('export_entries', {})
    const head = ['Ticket', 'Book', 'Buyer', 'Phone', 'Area', 'Seller', 'Can contact']
    const rows = r.entries.map(e => [e.ticket, e.book, e.buyerName, e.buyerPhone,
      e.buyerZone, e.agentName, e.contactable ? 'yes' : 'NO'])
    download(`entries-${new Date().toISOString().slice(0, 10)}.csv`, head, rows)
    toast(`${r.count} entries saved`, 'ok')
  } catch (err) { toast(err.message, 'bad') }
}

function download(filename, head, rows) {
  const q = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = [head.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename
  document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}
</script>

<template>
  <div>
    <h1>The draw</h1>

    <div v-if="ready" :class="['note', ready.ready ? 'ok' : 'warn']">
      <b>{{ ready.ready ? '✅ Ready to draw' : '⚠️ Not ready yet' }}</b>
      <div v-for="b in ready.blockers" :key="b">• {{ b }}</div>
    </div>
    <div v-else class="skel" style="height:60px;margin-bottom:14px"></div>

    <div v-if="ready" class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="n">{{ ready.totals.eligibleEntries.toLocaleString() }}</div><div class="l">In the draw</div></div>
      <div class="stat"><div class="n">{{ ready.totals.ticketsAvailable.toLocaleString() }}</div><div class="l">Not sold</div></div>
      <div class="stat" :class="{ accent: ready.totals.missingContact }">
        <div class="n" :style="ready.totals.missingContact ? 'color:var(--bad)' : ''">
          {{ ready.totals.missingContact }}
        </div>
        <div class="l">No phone number</div>
      </div>
      <div class="stat"><div class="n">{{ moneyShort(ready.totals.outstanding, currency) }}</div><div class="l">Still owed</div></div>
    </div>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Tickets with nobody's name</h3>
        <button class="btn sm" @click="loadMissing">Show them</button></div>
      <p class="muted small">
        A sold ticket with no name or phone is a winner you cannot find. Fix these before the draw.
      </p>

      <div v-if="missing === 'loading'" class="col" style="gap:10px">
        <div v-for="i in 3" :key="i" class="skel"></div>
      </div>
      <template v-else-if="missing">
        <div v-if="!missing.total" class="note ok">Every sold ticket has a name and a phone number.</div>
        <template v-else>
          <p class="small muted">{{ missing.total }} in total<template v-if="missing.total > missing.returned">, showing {{ missing.returned }}</template></p>
          <ul class="list">
            <li v-for="t in missing.tickets" :key="t.ticket">
              <button class="item" @click="emit('open-ticket', t.ticket)">
                <span class="grow">
                  <span class="lead">{{ t.ticket }}</span>
                  <span class="sub">
                    {{ t.book }} · {{ t.buyerName ? 'no phone number' : 'no name' }}
                    <template v-if="t.source === 'settlement'"> · filled in when the book was counted</template>
                  </span>
                </span>
                <span class="pill bad">fix</span>
              </button>
            </li>
          </ul>
        </template>
      </template>
    </div>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Winners</h3>
        <button v-if="isSuper" class="btn sm primary" @click="emit('record-winner')">Add a winner</button></div>
      <div v-if="winners.length">
        <div v-for="w in winners" :key="w.ticket" class="winner">
          <div class="grow">
            <b>{{ w.ticket }}</b> — {{ w.prize }}
            <div class="tiny muted">
              {{ w.buyerName || 'no name written down' }}
              <template v-if="w.buyerPhone"> · {{ w.buyerPhone }}</template>
            </div>
          </div>
          <span :class="['pill', w.claimed ? 'ok' : w.notified ? 'warn' : '']">
            {{ w.claimed ? 'collected' : w.notified ? 'told' : 'new' }}
          </span>
        </div>
      </div>
      <p v-else class="muted small">No winners yet.</p>
    </div>

    <div v-if="isSuper" class="card">
      <h3>The list of entries</h3>
      <p class="muted small">Every sold and given ticket. Cancelled and unsold ones are left out.</p>
      <button class="btn" @click="exportEntries">Save the list (CSV)</button>
      <p class="hint">This file has everyone's phone number in it. Keep it safe and do not put it online.</p>
    </div>
    <div v-else-if="isAdmin" class="note">
      Only the super admin can download the entry list or add winners.
    </div>
  </div>
</template>

<style scoped>
.winner { display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--border); }
.winner:last-child { border-bottom: 0; }
</style>
