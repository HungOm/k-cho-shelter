<script setup>
/**
 * Getting ready for the draw.
 *
 * The number that matters is how many sold tickets have nobody's phone on
 * them. Every one of those is a winner you would not be able to find.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { state, api, toast, isSuper, isAdmin, canWrite, drawStamp } from '../lib/store.js'
import { moneyShort, money, date } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const emit = defineEmits(['open-ticket', 'record-winner', 'edit-prize'])

const ready = ref(null)
const missing = ref(null)
const winners = ref([])
const schedule = ref(null)
// True only when the backend has no list_prizes at all — an older Edge Function,
// or one deployed before the prize schedule was.
const prizesUnavailable = ref(false)
const currency = computed(() => state.cfg?.currency || '')

onMounted(load)
async function load() {
  try {
    ready.value = await api('report_draw_ready', {})
    winners.value = (await api('list_winners', {})).winners
  } catch (err) { toast(err.message, 'bad', err.code) }

  /*
   * THE PRIZE BOARD IS ITS OWN READ, AND ITS OWN FAILURE.
   *
   * Pushing to master deploys the frontend and nothing else — the Edge Function
   * and the migration are both applied by hand. So there is a real window, on a
   * raffle that is already running, where this screen is live against a backend
   * that has never heard of list_prizes. Sharing a try with the two reads above
   * meant that window took the whole screen down: the throw skipped the toast
   * for the reads that HAD worked and left the board on skeletons for ever.
   *
   * Nothing is toasted for the one error that means "not deployed yet". The
   * organiser cannot act on it, it would fire on every visit, and the card
   * below says the same thing in words they can use.
   */
  try {
    schedule.value = await api('list_prizes', {})
    prizesUnavailable.value = false
  } catch (err) {
    prizesUnavailable.value = true
    schedule.value = { prizes: [], types: [], collected: 0 }
    if (err.code !== 'UNKNOWN_ACTION') toast(err.message, 'bad', err.code)
  }
}

// The prize board and the winners list are this screen's own reads, not part of
// the ticket snapshot the poller keeps fresh — and the screen is kept alive, so
// it is never mounted a second time. Without this, saving a prize closed the
// dialog onto a board that did not have it.
watch(drawStamp, load)

/*
 * WHAT IS LEFT TO GIVE, TOTALLED. The board is read out in rank order and the
 * running count beside each line is the thing an announcer actually needs —
 * "three of ten hampers gone" — which nothing could say while the prize was a
 * typed phrase on a winner row.
 */
const prizes = computed(() => schedule.value?.prizes ?? [])
const stillToGive = computed(() =>
  prizes.value.filter(p => p.active !== false).reduce((n, p) => n + p.remaining, 0))

/*
 * Declared value, and only where a figure was actually stated. A prize typed as
 * "nothing declared" comes back as null and is left out of the sum rather than
 * added as a zero — a donated service with no agreed value is worth unstated,
 * and a total that silently counts it as nothing is a total that is wrong in a
 * direction nobody can see.
 */
const declaredValue = computed(() => prizes.value
  .filter(p => p.active !== false && p.unitValue !== null)
  .reduce((n, p) => n + p.unitValue * p.quantity, 0))
const anyUnstated = computed(() =>
  prizes.value.some(p => p.active !== false && p.unitValue === null))

/** Where a winner has got to, in one word. */
function stateOf(w) {
  if (w.forfeited_at || w.forfeitedDate) return { word: 'not collected', pill: 'bad' }
  if (w.claimed) return { word: 'collected', pill: 'ok' }
  if (w.notified) return { word: 'told', pill: 'warn' }
  return { word: 'new', pill: '' }
}

/*
 * A HELPER MOVES THESE, not the owner. A helper rings the winners and a helper
 * is standing there when one turns up for their hamper — the same reasoning
 * that lets a helper record cash at the table.
 */
const busyTicket = ref('')
async function mark(w, patch) {
  const ticket = w.ticket || w.tickets?.number
  busyTicket.value = ticket
  try {
    await api('set_winner_status', { ticketNumber: ticket, ...patch })
    await load()
  } catch (err) { toast(err.message, 'bad', err.code) }
  finally { busyTicket.value = '' }
}

async function loadMissing() {
  missing.value = 'loading'
  try {
    missing.value = await api('report_missing_contact', { limit: 200 })
  } catch (err) { toast(err.message, 'bad', err.code); missing.value = null }
}

async function exportEntries() {
  try {
    const r = await api('export_entries', {})
    const head = ['Ticket', 'Book', 'Buyer', 'Phone', 'Area', 'Seller', 'Can contact']
    const rows = r.entries.map(e => [e.ticket, e.book, e.buyerName, e.buyerPhone,
      e.buyerZone, e.agentName, e.contactable ? 'yes' : 'NO'])
    download(`entries-${new Date().toISOString().slice(0, 10)}.csv`, head, rows)
    toast(`${r.count} entries saved`, 'ok')
  } catch (err) { toast(err.message, 'bad', err.code) }
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

    <!-- THE PRIZE BOARD. What is on offer, in the order it is read out, with
         the running count an announcer actually needs beside each line. -->
    <div class="card">
      <div class="spread"><h3 style="margin:0">The prizes</h3>
        <button v-if="isAdmin && !prizesUnavailable" class="btn sm primary"
                @click="emit('edit-prize', null)">
          Add a prize
        </button></div>

      <div v-if="!schedule" class="col" style="gap:10px">
        <div v-for="i in 2" :key="i" class="skel"></div>
      </div>

      <template v-else-if="prizes.length">
        <p class="small muted">
          {{ stillToGive }} still to give.
          <template v-if="declaredValue > 0">
            {{ money(declaredValue, currency) }} declared<template v-if="anyUnstated">,
            plus prizes with no value stated</template>.
          </template>
        </p>
        <ul class="list">
          <li v-for="p in prizes" :key="p.prize_id">
            <button class="item" :disabled="!isAdmin" @click="emit('edit-prize', p)">
              <span class="grow">
                <span class="lead">
                  {{ p.tier }}<template v-if="p.name"> — {{ p.name }}</template>
                </span>
                <span class="sub">
                  <template v-if="p.quantity > 1">{{ p.quantity }} of them · </template>
                  <template v-if="p.unitValue !== null && p.unitValue > 0">
                    {{ money(p.unitValue, currency) }} each<template v-if="p.valuing === 'percent'">
                      ({{ p.value_amount }}% of takings)</template> ·
                  </template>
                  <template v-else>no value stated · </template>
                  {{ p.typeLabel }}
                  <template v-if="p.donor"> · given by {{ p.donor }}</template>
                  <template v-if="p.active === false"> · not being offered</template>
                </span>
              </span>
              <span :class="['pill', p.remaining === 0 ? 'ok' : p.awarded ? 'warn' : '']">
                {{ p.remaining === 0 ? 'all given' : p.awarded
                   ? `${p.remaining} of ${p.quantity} left` : `${p.quantity} to give` }}
              </span>
            </button>
          </li>
        </ul>
      </template>

      <div v-else-if="prizesUnavailable" class="note warn">
        This raffle's server does not have the prize list yet. Everything else on this
        screen is up to date, and a winner can still be recorded against a typed
        prize in the meantime.
      </div>

      <template v-else>
        <p class="muted small">
          No prizes have been set up. Until there are, a winner can only be recorded
          against a typed phrase — so nothing can count what is left to give, and the
          same prize can go out twice.
        </p>
      </template>
    </div>

    <div class="card">
      <div class="spread"><h3 style="margin:0">Winners</h3>
        <button v-if="isSuper" class="btn sm primary" @click="emit('record-winner')">Add a winner</button></div>
      <div v-if="winners.length">
        <div v-for="w in winners" :key="w.ticket || w.tickets?.number" class="winner">
          <div class="grow">
            <b>{{ w.ticket || w.tickets?.number }}</b> — {{ w.prize }}
            <template v-if="w.seq && w.seq > 1"> <span class="tiny muted">(no. {{ w.seq }})</span></template>
            <div class="tiny muted">
              {{ w.buyerName || w.buyer_name || 'no name written down' }}
              <template v-if="w.buyerPhone || w.buyer_phone"> · {{ w.buyerPhone || w.buyer_phone }}</template>
            </div>
            <!-- A helper moves these, which is the whole reason they exist: the
                 pills have been rendered since the beginning and nothing could
                 set them, so every winner read "new" for ever. -->
            <div v-if="canWrite" class="row wrap" style="gap:6px;margin-top:6px">
              <button class="btn sm" :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { notified: !w.notified })">
                {{ w.notified ? 'Not told after all' : 'Told them' }}
              </button>
              <button class="btn sm" :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { claimed: !w.claimed })">
                {{ w.claimed ? 'Not collected after all' : 'Collected it' }}
              </button>
              <button v-if="!w.claimed" class="btn sm"
                      :disabled="busyTicket === (w.ticket || w.tickets?.number)"
                      @click="mark(w, { forfeited: !(w.forfeited_at || w.forfeitedDate) })">
                {{ (w.forfeited_at || w.forfeitedDate) ? 'Back in play' : 'Never claimed' }}
              </button>
            </div>
          </div>
          <span :class="['pill', stateOf(w).pill]">{{ stateOf(w).word }}</span>
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
      Only the System Admin can download the entry list or add winners.
    </div>
  </div>
</template>

<style scoped>
.winner { display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--border); }
.winner:last-child { border-bottom: 0; }
</style>
