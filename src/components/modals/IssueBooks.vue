<script setup>
/** Handing books to a seller, and the receipt that proves it. */
import { ref, computed } from 'vue'
import { state, api, toast, refresh } from '../../lib/store.js'
import { money } from '../../lib/format.js'
import { inspectRange, bookNumber } from '../../lib/books.js'
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

// Resolved locally against books already loaded, so the answer appears as they
// type rather than after a save they had to wait for.
const range = computed(() => inspectRange(from.value, to.value))
const count = computed(() => range.value?.count || 0)
const canIssue = computed(() => !!range.value && !range.value.noneFree)

/** Offer the first run big enough, so nobody has to hunt for free books. */
function useSuggestion() {
  const n = range.value?.nextRun
  if (!n) return
  from.value = String(n.from)
  to.value = n.to === n.from ? '' : String(n.to)
}
const worth = computed(() => count.value * (state.cfg?.ticketsPerBook || 0) * (state.cfg?.ticketPrice || 0))

async function issue() {
  if (!agentId.value) return toast('Who are the books for?', 'bad')
  if (!from.value) return toast('Which books?', 'bad')
  busy.value = true
  blocked.value = null
  try {
    const r = await api('issue_books', {
      agentId: agentId.value,
      fromBook: bookNumber(from.value),
      toBook: bookNumber(to.value || from.value),
      dueDate: due.value
    })
    toast(`${r.issued} books given to ${r.agent.name}`, 'ok')
    await refresh()
    emit('issued', r.agent.id)
  } catch (err) {
    if (err.code === 'BOOKS_NOT_AVAILABLE' && err.details?.blocked) blocked.value = err.details.blocked
    else toast(err.message, 'bad', err.code)
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

    <!-- clean range -->
    <div v-if="range?.allFree" class="note info mt">
      <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b>
      · {{ count * state.cfg.ticketsPerBook }} tickets
      · worth {{ money(worth, state.cfg.currency) }} if they all sell
    </div>

    <!-- some or all of it is already out -->
    <div v-else-if="range" :class="['note', range.noneFree ? 'bad' : 'warn', 'mt']">
      <b>{{ range.message }}</b>
      <div v-if="range.nextRun" class="mt">
        <button class="btn sm" @click="useSuggestion">
          Use {{ range.nextRun.from }}<template v-if="range.nextRun.to !== range.nextRun.from">–{{ range.nextRun.to }}</template>
          instead<template v-if="range.nextRun.short"> ({{ range.nextRun.available }} free)</template>
        </button>
      </div>
    </div>

    <div class="field mt">
      <label for="id">Bring back by</label>
      <input id="id" v-model="due" type="date">
    </div>

    <!-- the server refused: it names every blocked book, so show them all -->
    <div v-if="blocked" class="note bad">
      <b>Nothing was changed. These are not free:</b>
      <div v-for="b in blocked" :key="b.book" class="tiny">{{ b.book }} — {{ b.reason }}</div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy || !count || !canIssue" @click="issue">
        {{ busy ? 'Saving…' : `Give out ${count || ''}` }}
      </button>
    </template>
  </Sheet>
</template>
