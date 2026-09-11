<script setup>
/** Handing books to a seller, and the receipt that proves it. */
import { ref, computed } from 'vue'
import { state, api, toast, refresh } from '../../lib/store.js'
import { money } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'issued'])

const agentId = ref(state.agents[0]?.id || '')
const from = ref('')
const to = ref('')
const due = ref(defaultDue())
const busy = ref(false)
const blocked = ref(null)

function defaultDue() {
  const d = new Date()
  d.setDate(d.getDate() + (state.cfg?.defaultDueDays || 30))
  return d.toISOString().slice(0, 10)
}

function bookNum(raw) {
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return ''
  return state.cfg.bookPrefix + digits.padStart(state.cfg.bookDigits, '0')
}

const count = computed(() => {
  const a = parseInt(from.value, 10), b = parseInt(to.value || from.value, 10)
  if (isNaN(a)) return 0
  return Math.max(0, Math.abs((isNaN(b) ? a : b) - a) + 1)
})
const worth = computed(() => count.value * (state.cfg?.ticketsPerBook || 0) * (state.cfg?.ticketPrice || 0))

async function issue() {
  if (!agentId.value) return toast('Who are the books for?', 'bad')
  if (!from.value) return toast('Which books?', 'bad')
  busy.value = true
  blocked.value = null
  try {
    const r = await api('issue_books', {
      agentId: agentId.value,
      fromBook: bookNum(from.value),
      toBook: bookNum(to.value || from.value),
      dueDate: due.value
    })
    toast(`${r.issued} books given to ${r.agent.name}`, 'ok')
    await refresh()
    emit('issued', r.agent.id)
  } catch (err) {
    if (err.code === 'BOOKS_NOT_AVAILABLE' && err.details?.blocked) blocked.value = err.details.blocked
    else toast(err.message, 'bad')
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet title="Give out books" subtitle="Hand a run of books to one seller" @close="emit('close')">
    <div class="field">
      <label for="ia">Who is taking them? <span class="req">*</span></label>
      <select id="ia" v-model="agentId">
        <option v-for="a in state.agents.filter(x => x.active)" :key="a.id" :value="a.id">
          {{ a.name }}<template v-if="a.booksOut"> — already has {{ a.booksOut }}</template>
        </option>
      </select>
    </div>

    <div class="row">
      <div class="field grow">
        <label for="if">First book <span class="req">*</span></label>
        <input id="if" v-model="from" class="xl" inputmode="numeric" placeholder="31">
      </div>
      <div class="field grow">
        <label for="it">Last book</label>
        <input id="it" v-model="to" class="xl" inputmode="numeric" placeholder="45">
      </div>
    </div>
    <p class="hint" style="margin-top:-8px">Leave the second box empty for a single book.</p>

    <div v-if="count" class="note info mt">
      <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b>
      · {{ count * state.cfg.ticketsPerBook }} tickets
      · worth {{ money(worth, state.cfg.currency) }} if they all sell
    </div>

    <div class="field mt">
      <label for="id">Bring back by</label>
      <input id="id" v-model="due" type="date">
    </div>

    <div v-if="blocked" class="note bad">
      <b>These books are not free:</b>
      <div v-for="b in blocked" :key="b.book">{{ b.book }} — {{ b.reason }}</div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy || !count" @click="issue">
        {{ busy ? 'Saving…' : `Give out ${count || ''}` }}
      </button>
    </template>
  </Sheet>
</template>
