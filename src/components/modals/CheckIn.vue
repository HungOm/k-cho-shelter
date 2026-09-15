<script setup>
/**
 * A seller reporting in, written down.
 *
 * THIS IS WHAT CLEARS THE MARK, and it is the only thing that does. Every other
 * alert in this app is derived from the books, because an alert somebody can
 * tick away is an alert everybody ticks away, and by the one time it matters it
 * has been trained into furniture. This one is about a PERSON rather than a
 * book, so it cannot be derived: a seller can honestly report — sold six, here
 * is the money, keeping the book for the rest — and still be holding it
 * afterwards. The books say nothing about whether they rang.
 *
 * So the mark clears on a recorded fact. There is still nothing to dismiss:
 * clearing it and writing down what they said are the same action, and what is
 * written is what the next round is measured against.
 *
 * NOTHING HERE IS REQUIRED. A report is somebody saying where they are, and
 * half of them will be "nothing sold yet, I will get to it". An empty form that
 * refuses to save is a report recorded on the back of an envelope instead — so
 * every field can be left alone and the round is still answered.
 *
 * SETTLING IS SEPARATE, deliberately. What is typed here is what the seller
 * SAID; settling a book is the count that decides money. Recording "about RM60
 * collected" must never look like a settled book, so this writes to the round
 * and touches no ticket, no book and no balance.
 */
import { ref, computed } from 'vue'
import { api, state, toast, refresh } from '../../lib/store.js'
import { date, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ agent: Object })
const emit = defineEmits(['close', 'saved'])

const booksBack = ref('')
const ticketsSold = ref('')
const amountPaid = ref('')
const note = ref('')
const busy = ref(false)
const problem = ref('')

const currency = computed(() => state.cfg?.currency || '')
const round = computed(() => props.agent?.reportRound || state.checkIn.round || 1)
const already = computed(() => props.agent?.reportState === 'reported')

/** The date everybody answers by, as a day — never parsed as an instant. */
const by = computed(() => (state.checkIn.date ? date(state.checkIn.date) : ''))

const holding = computed(() => {
  const n = props.agent?.booksOut || 0
  return n ? plural(n, 'book', 'books') : 'no books'
})

const lateLine = computed(() => {
  const d = props.agent?.daysLate || 0
  if (!d) return ''
  return `${plural(d, 'day', 'days')} past the check-in.`
})

const missedLine = computed(() => {
  const n = props.agent?.missedRounds || 0
  if (n < 1) return ''
  return `Has missed ${plural(n, 'earlier check-in', 'earlier check-ins')}.`
})

async function save() {
  busy.value = true
  problem.value = ''
  try {
    const r = await api('record_check_in', {
      agentId: props.agent.id,
      booksBack: booksBack.value,
      ticketsSold: ticketsSold.value,
      amountPaid: amountPaid.value,
      note: note.value.trim(),
    })
    toast(r.updated ? 'Report updated' : `${r.agentName} has reported`, 'ok')
    emit('saved')
    refresh()
  } catch (err) {
    problem.value = err.message
  } finally { busy.value = false }
}

/**
 * Undo removes the record rather than hiding it, which is why it puts the
 * person straight back on the chase list. Recorded against the wrong seller is
 * a thing that happens on a phone in a car park.
 */
async function undo() {
  busy.value = true
  problem.value = ''
  try {
    await api('record_check_in', { agentId: props.agent.id, undo: true })
    toast('Taken off the record — they are back on the list', 'ok')
    emit('saved')
    refresh()
  } catch (err) {
    problem.value = err.message
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="`${agent?.name || 'Seller'} has reported`"
         :subtitle="by ? `Round ${round} — everybody reports by ${by}` : `Round ${round}`"
         @close="emit('close')">

    <div v-if="already" class="note ok">
      Already recorded as having reported this round<template v-if="agent.reportedAt">
      on {{ date(agent.reportedAt) }}</template>. Saving again replaces what was
      written down.
    </div>

    <p class="muted small lead">
      Holding {{ holding }}.
      <template v-if="lateLine"> {{ lateLine }}</template>
      <template v-if="missedLine"> {{ missedLine }}</template>
    </p>

    <p class="muted small lead">
      Write down what they said. Every box can be left empty — a seller saying
      "nothing sold yet" has still reported, and that is what this records.
    </p>

    <div class="grid">
      <div class="field">
        <label for="cb">Books brought back</label>
        <input id="cb" v-model="booksBack" type="number" inputmode="numeric" min="0" placeholder="0">
      </div>
      <div class="field">
        <label for="ct">Tickets sold so far</label>
        <input id="ct" v-model="ticketsSold" type="number" inputmode="numeric" min="0" placeholder="0">
      </div>
    </div>

    <div class="field">
      <label for="cm">Money handed in <span class="opt">— {{ currency }}</span></label>
      <input id="cm" v-model="amountPaid" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
      <p class="hint">
        What they said they handed over. Settling a book is where the money is
        counted and balanced — this is only the report.
      </p>
    </div>

    <div class="field">
      <label for="cn">Anything they said <span class="opt">— not required</span></label>
      <input id="cn" v-model="note" autocomplete="off" placeholder="Away until the 20th">
    </div>

    <div v-if="problem" class="note bad">{{ problem }}</div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button v-if="already" class="btn" :disabled="busy" @click="undo">Undo</button>
      <button class="btn primary" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : 'Record it' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.lead { margin: 0 0 14px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 380px) { .grid { grid-template-columns: 1fr; } }
</style>
