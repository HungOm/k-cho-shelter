<script setup>
/**
 * Transfer, bring back, or report lost — three shapes of the same job, so one
 * dialog rather than three near-identical ones.
 *
 * "Report lost" is the destructive one: it voids every unsold ticket in the
 * range so they cannot win a draw they were never entered in. That is why it
 * may come back asking for a second person's approval.
 */
import { ref, computed } from 'vue'
import { state, api, toast, refresh, loadDelta } from '../../lib/store.js'
import { inspectRange, bookNumber } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ kind: String })   // 'transfer' | 'return' | 'mark'
const emit = defineEmits(['close', 'done', 'needs-approval'])

const from = ref('')
const to = ref('')
const agentId = ref(state.agents[0]?.id || '')
const status = ref('Lost')
const reason = ref('')
const busy = ref(false)
const blocked = ref(null)

const cfg = computed(() => state.cfg)
// Transfer and bring-back only make sense for books that are actually out;
// reporting lost applies to anything that exists.
const isRelevant = computed(() => props.kind === 'mark'
  ? (b => b.status !== 'Unassigned')
  : (b => b.status === 'Out'))
const range = computed(() => inspectRange(from.value, to.value, isRelevant.value))
const count = computed(() => range.value?.count || 0)
const usable = computed(() => !!range.value && !range.value.noneFree)

const TITLES = {
  transfer: ['Pass books to someone else', 'They stay out, just with a different person'],
  return:   ['Mark books brought back', 'Any tickets being held in them go back on the shelf'],
  mark:     ['Report books lost', 'Every unsold ticket in them is cancelled']
}
const title = computed(() => TITLES[props.kind][0])
const subtitle = computed(() => TITLES[props.kind][1])

async function go() {
  if (!from.value) return toast('Which books?', 'bad')
  if (props.kind === 'mark' && !reason.value.trim()) return toast('Please say why', 'bad')

  const books = { fromBook: bookNumber(from.value), toBook: bookNumber(to.value || from.value) }
  const call = {
    transfer: ['transfer_books', { ...books, toAgentId: agentId.value }],
    return:   ['return_books', books],
    mark:     ['set_book_status', { ...books, status: status.value, reason: reason.value.trim(), dryRun: false }]
  }[props.kind]

  busy.value = true
  blocked.value = null
  try {
    const r = await api(call[0], call[1])
    const said = {
      transfer: `${r.transferred} books moved to ${r.toAgent}`,
      return: `${r.returned} brought back` + (r.reservationsReleased ? `, ${r.reservationsReleased} holds released` : ''),
      mark: `${r.changed} books marked, ${r.ticketsVoided} tickets cancelled`
    }[props.kind]
    toast(said, 'ok')
    emit('done')
    loadDelta().then(refresh)
  } catch (err) {
    // The server decides this needs a second person; it also wrote the sentence
    // the approver will read, so we hand its own summary straight back.
    if (err.code === 'APPROVAL_REQUIRED') {
      emit('needs-approval', {
        action: call[0], payload: call[1],
        summary: err.details?.summary || err.message,
        detail: err.details?.detail || null
      })
      return
    }
    if (err.code === 'TRANSFER_BLOCKED' && err.details?.blocked) blocked.value = err.details.blocked
    else toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet :title="title" :subtitle="subtitle" @close="emit('close')">
    <div v-if="kind === 'mark'" class="note warn">
      This cancels every unsold ticket in those books so they cannot win. Sold tickets are untouched.
    </div>

    <div class="row">
      <div class="field grow">
        <label for="baf">First book <span class="req">*</span></label>
        <input id="baf" v-model="from" class="xl" inputmode="numeric" placeholder="31">
      </div>
      <div class="field grow">
        <label for="bat">Last book</label>
        <input id="bat" v-model="to" class="xl" inputmode="numeric" placeholder="leave empty for one">
      </div>
    </div>
    <div v-if="range?.allFree" class="note info">
      <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b>
      · up to {{ count * cfg.ticketsPerBook }} tickets
    </div>
    <div v-else-if="range" :class="['note', range.noneFree ? 'bad' : 'warn']">
      <b v-if="kind === 'mark'">{{ range.message }}</b>
      <b v-else>
        {{ range.freeCount }} of {{ count }} can be moved — the rest are not out with anyone.
      </b>
    </div>

    <div v-if="kind === 'transfer'" class="field">
      <label for="bag">Who is taking them? <span class="req">*</span></label>
      <select id="bag" v-model="agentId">
        <option v-for="a in state.agents.filter(x => x.active)" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </div>

    <template v-if="kind === 'mark'">
      <div class="field">
        <label for="bas">Mark them as</label>
        <select id="bas" v-model="status">
          <option value="Lost">Lost</option>
          <option value="Void">Cancelled</option>
          <option value="Unassigned">Back in the office</option>
        </select>
      </div>
      <div class="field">
        <label for="bar">Why? <span class="req">*</span></label>
        <input id="bar" v-model="reason" placeholder="e.g. the seller moved away">
        <p class="hint">Kept in the record, so everyone can see what happened.</p>
      </div>
    </template>

    <div v-if="blocked" class="note bad">
      <b>Some books could not be moved:</b>
      <div v-for="b in blocked" :key="b.book" class="tiny">{{ b.book }} — {{ b.reason }}</div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button :class="['btn', kind === 'mark' ? 'danger' : 'primary']"
              :disabled="busy || !count || !usable" @click="go">
        {{ busy ? 'Saving…' : title }}
      </button>
    </template>
  </Sheet>
</template>
