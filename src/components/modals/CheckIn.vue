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
 *
 * AND TWO OF THESE BOXES ARE THE ONLY ONES THE SYSTEM CANNOT ANSWER ITSELF.
 * Books back and tickets sold are the seller's word about things the database
 * counts — useful as a cross-check, useless as a record. Stubs handed in and
 * unsold tickets handed back are PAPER, which nothing else in this system can
 * see. With them, every ticket a seller was carrying is in one of four places:
 * a stub in the envelope, a ticket back on the desk, paper still in a book they
 * kept, or missing. Without them the fourth is unknowable, and it is the only
 * one anybody needed.
 *
 * THE COUNT ON THE RECORD IS SHOWN WHILE THEY TYPE. Not to argue with the
 * seller — the declaration is recorded as given, always — but because the
 * moment to find out that nine stubs met four recorded sales is while both
 * people are standing there, not in December when one of them is unreachable.
 */
import { ref, computed, onMounted } from 'vue'
import { api, state, toast, refresh } from '../../lib/store.js'
import { date, money, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ agent: Object })
const emit = defineEmits(['close', 'saved', 'sheet'])

const booksBack = ref('')
const stubsReturned = ref('')
const unsoldReturned = ref('')
const ticketsSold = ref('')
const amountPaid = ref('')
const note = ref('')
const busy = ref(false)
const problem = ref('')

/*
 * What the system already has on this seller, loaded once when the sheet opens.
 *
 * Named and called from onMounted rather than written inside it, for the reason
 * the receipt learned the hard way: a load buried in the hook cannot be driven
 * by a test at all.
 *
 * It never blocks the form. A check-in recorded in a car park with no signal
 * has to work exactly as it did before this panel existed — so a failure here
 * leaves `sheet` null and every box still types and still saves.
 */
const sheet = ref(null)
onMounted(load)
async function load() {
  if (!props.agent?.id) return
  try { sheet.value = await api('check_in_sheet', { agentId: props.agent.id }) } catch { /* the form is the point */ }
}

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

const numberOf = (v) => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * THE PAPER, AS THEY COUNT IT ONTO THE TABLE.
 *
 * Books handed back × tickets per book is the paper that came with them; stubs
 * plus unsold tickets is the paper actually handed over. The difference is the
 * number this whole screen exists to produce, and it is shown as it is typed
 * rather than after saving, because the envelope is still open at that point.
 *
 * NOT "counted in", which is this app's word for the LAST step of a book —
 * unsold numbers read back, cash written down, the book closed as Finished.
 * This screen is a checkpoint in the middle and closes nothing. The two are a
 * paragraph apart in a volunteer's day and one sentence apart on the screen,
 * and a term that means the ordinary English thing in one place and a
 * particular irreversible act in another is how somebody thinks they have
 * finished a book by reporting on it.
 *
 * Negative is ORDINARY and says so: a seller mid-book hands in stubs from a
 * book they are keeping, so more paper comes in than the returned books held.
 * Only the positive direction is a question.
 */
const perBook = computed(() => sheet.value?.ticketsPerBook || 0)
const paper = computed(() => {
  if (!perBook.value) return null
  const back = numberOf(booksBack.value)
  const inHand = numberOf(stubsReturned.value) + numberOf(unsoldReturned.value)
  if (!back && !inHand) return null
  return { expected: back * perBook.value, handedIn: inHand, gap: back * perBook.value - inHand }
})

/** Sales already recorded against the books this seller holds, and what is owed. */
const onRecord = computed(() => {
  const r = sheet.value?.recorded
  if (!r) return null
  const stubs = numberOf(stubsReturned.value)
  const before = sheet.value?.gap?.stubsToDate ?? 0
  return {
    ticketsSold: r.ticketsSold,
    outstanding: r.outstanding,
    // Cumulative against cumulative: stubs handed in before today, plus what is
    // being counted now, against the running total of recorded sales. Comparing
    // today's envelope with the whole raffle's sales would show a gap on every
    // sheet after the first, which is how a number stops being read.
    gap: stubs ? (before + stubs) - r.ticketsSold : 0,
  }
})

async function save() {
  busy.value = true
  problem.value = ''
  try {
    const r = await api('record_check_in', {
      agentId: props.agent.id,
      booksBack: booksBack.value,
      stubsReturned: stubsReturned.value,
      unsoldReturned: unsoldReturned.value,
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

    <div class="grid">
      <div class="field">
        <label for="cs">Stubs handed in</label>
        <input id="cs" v-model="stubsReturned" type="number" inputmode="numeric" min="0" placeholder="0">
      </div>
      <div class="field">
        <label for="cu">Unsold tickets back</label>
        <input id="cu" v-model="unsoldReturned" type="number" inputmode="numeric" min="0" placeholder="0">
      </div>
    </div>
    <p class="hint tuck">
      The counterfoils of sold tickets, and the unsold tickets out of part-used
      books. Counting them is what makes a missing ticket findable — nothing
      else in here can see paper.
    </p>

    <!-- Shown as it is typed, because the envelope is still open. Never a
         refusal: the declaration is recorded exactly as the seller gives it,
         and this only says what the record says beside it. -->
    <div v-if="paper && paper.gap > 0" class="note warn">
      {{ plural(paper.expected, 'ticket', 'tickets') }} came with those books and
      {{ paper.handedIn }} have been handed over — {{ paper.gap }} not accounted for.
      Worth a second look in the envelope before this is written down.
    </div>
    <div v-else-if="paper && paper.gap < 0" class="note">
      More paper than the books handed back held, which is ordinary: stubs out of
      a book they are keeping.
    </div>

    <div v-if="onRecord && onRecord.gap" class="note">
      <b>{{ onRecord.gap > 0 ? `${onRecord.gap} more` : `${-onRecord.gap} fewer` }}</b>
      stubs than sales recorded on their books ({{ onRecord.ticketsSold }} recorded).
      <template v-if="onRecord.gap > 0">
        Those sales still have to be entered, or the buyers cannot be drawn.
      </template>
    </div>

    <div class="field">
      <label for="cm">Money handed in <span class="opt">— {{ currency }}</span></label>
      <input id="cm" v-model="amountPaid" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00">
      <p class="hint">
        What they said they handed over. Settling a book is where the money is
        counted and balanced — this is only the report.
        <template v-if="onRecord && onRecord.outstanding > 0">
          They are shown as owing {{ money(onRecord.outstanding, currency) }} today.
        </template>
      </p>
    </div>

    <div class="field">
      <label for="cn">Anything they said <span class="opt">— not required</span></label>
      <input id="cn" v-model="note" autocomplete="off" placeholder="Away until the 20th">
    </div>

    <div v-if="problem" class="note bad">{{ problem }}</div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <!-- The printed sheet is the thing that gets signed. Offered here because
           this is where somebody already is when the seller is in front of
           them, and it opens on top rather than instead — nothing typed is
           lost by looking at it. -->
      <button class="btn" @click="emit('sheet', agent)">Report</button>
      <button v-if="already" class="btn" :disabled="busy" @click="undo">Undo</button>
      <button class="btn primary" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : 'Record it' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.lead { margin: 0 0 14px; }
.tuck { margin-top: -6px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 380px) { .grid { grid-template-columns: 1fr; } }
</style>
