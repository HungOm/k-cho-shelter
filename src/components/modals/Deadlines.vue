<script setup>
/**
 * The two dates a raffle runs on.
 *
 * The CHECK-IN date is soft. One shared day everybody reports by — the same day
 * for the person who took books in March and the person who took them last
 * week, which is what makes a single reminder and a single late list possible.
 * Nobody is finished on that day; the point is to find out where things stand
 * while there is still time to do something about it. Then it steps on a month.
 *
 * The FINAL deadline is hard. Everything has to be back, because the draw
 * happens after it.
 *
 * The screen is built around the one dangerous truth here: moving the check-in
 * date forward makes late books stop being late. That is what a checkpoint is
 * for, and it is also how "we will collect it next month" becomes a year of
 * nobody chasing anyone. So the number of books it would absolve is shown in
 * words before anything is written, and the date has to be typed back when
 * there is anything to absolve.
 */
import { ref, computed, onMounted } from 'vue'
import { api, toast, refresh, isAdmin, isSuper } from '../../lib/store.js'
import { date, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close'])

const s = ref(null)             // deadline_status
const preview = ref(null)       // the dry run we are about to apply
const kind = ref('')            // 'roll' | 'final'
const busy = ref(false)
const problem = ref('')
const done = ref('')
const newFinal = ref('')
const newCheckIn = ref('')

onMounted(load)

async function load() {
  try {
    s.value = await api('deadline_status')
    newFinal.value = s.value.finalDeadline || ''
  } catch (err) { toast(err.message, 'bad', err.code); emit('close') }
}

const noFinal = computed(() => !!s.value && !s.value.finalDeadline)

/** How the check-in date is doing, in the words somebody would actually use. */
const checkInLine = computed(() => {
  const d = s.value
  if (!d?.checkInDate) return 'No check-in date set.'
  const n = d.daysToCheckIn
  if (n < 0) return `Was due ${plural(-n, 'day', 'days')} ago.`
  if (n === 0) return 'Today.'
  return `${plural(n, 'day', 'days')} to go.`
})

const finalLine = computed(() => {
  const d = s.value
  if (!d?.finalDeadline) return 'Not set yet.'
  const n = d.daysToFinal
  if (n < 0) return `Passed ${plural(-n, 'day', 'days')} ago.`
  if (n === 0) return 'Today.'
  return `${plural(n, 'day', 'days')} to go.`
})

function reset() { preview.value = null; kind.value = ''; problem.value = '' }

/** Step one: ask the server what the move would do, and change nothing. */
async function look(what) {
  reset()
  busy.value = true
  try {
    if (what === 'roll') {
      preview.value = await api('roll_check_in',
        newCheckIn.value ? { date: newCheckIn.value } : {})
    } else {
      preview.value = await api('set_final_deadline', { date: newFinal.value })
    }
    kind.value = what
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

/** Step two: the same request again, in earnest. */
async function apply() {
  busy.value = true
  problem.value = ''
  try {
    const confirm = preview.value.to || 'clear'
    if (kind.value === 'roll') {
      const r = await api('roll_check_in',
        { date: preview.value.to, dryRun: false, confirm })
      done.value = r.isLastRound
        ? `The last round now runs to ${date(r.to)}.`
        : `Everybody reports by ${date(r.to)}.`
    } else {
      const r = await api('set_final_deadline',
        { date: newFinal.value, dryRun: false, confirm })
      done.value = r.cleared
        ? 'The final deadline has been removed.'
        : `Everything has to be back by ${date(r.to)}.`
    }
    reset()
    newCheckIn.value = ''
    await load()
    refresh()
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

/**
 * The refusals worth saying better than the wire does. The rest already read
 * as sentences, so they are passed through rather than paraphrased badly.
 */
function explain(err) {
  switch (err.code) {
    case 'NO_FINAL_DEADLINE':
      return 'Set the final deadline first. Without one the check-in date has nothing to ' +
             'count down to, and a checkpoint that can always be moved again is just an ' +
             'extension.'
    case 'CANNOT_MOVE_BACK':
      return 'The check-in date only moves forward. Pulling it back would make books late ' +
             'for a date that had already passed when they were handed over.'
    case 'FINAL_PASSED':
      return 'The final deadline has passed, so there are no more check-ins. Anything still ' +
             'out is overdue outright — chase it, or move the final deadline if the whole ' +
             'raffle is running late.'
    case 'AFTER_DRAW':
      return 'That falls after the draw date. Everything has to be back before the draw, so ' +
             'move the draw first if the whole raffle is running later.'
    case 'SUPER_ADMIN_ONLY':
      return 'Only the owner can change the final deadline. The check-in date is yours ' +
             'to move.'
    default:
      return err.message
  }
}
</script>

<template>
  <Sheet title="Deadlines" subtitle="When sellers report, and when everything is due back"
         @close="emit('close')">

    <div v-if="!s" class="col" style="gap:12px">
      <div v-for="i in 4" :key="i" class="skel"></div>
    </div>

    <template v-else>
      <div v-if="done" class="note ok">{{ done }}</div>

      <div class="dates">
        <div :class="['d', { due: s.checkInDue }]">
          <span>Check-in</span>
          <b>{{ s.checkInDate ? date(s.checkInDate) : '—' }}</b>
          <small>{{ checkInLine }}</small>
        </div>
        <div :class="['d', 'hard', { due: s.finalPassed }]">
          <span>Everything back by</span>
          <b>{{ s.finalDeadline ? date(s.finalDeadline) : '—' }}</b>
          <small>{{ finalLine }}</small>
        </div>
      </div>

      <p class="muted small lead">
        The check-in is a checkpoint, not the end — everybody reports on the same day,
        then it moves on a month. The final deadline is the one that does not move on
        its own: the draw happens after it.
      </p>

      <div class="now">
        <div><span>Books out</span><b>{{ s.booksOut }}</b></div>
        <div :class="{ bad: s.lateNow }"><span>Late right now</span><b>{{ s.lateNow }}</b></div>
      </div>

      <div v-if="noFinal" class="note info">
        There is no final deadline yet, so the check-in date cannot be moved.
        <template v-if="!isSuper">Ask the owner to set one.</template>
      </div>

      <!-- ---------------------------------------------------- the soft one -->
      <template v-if="isAdmin && !noFinal">
        <h4>Move the check-in on</h4>
        <p class="muted small">
          Do this once you have been through where everybody stands. Books still out
          are given the new date.
        </p>
        <div class="row">
          <input v-model="newCheckIn" type="date" :min="s.today" :max="s.finalDeadline">
          <button class="btn" :disabled="busy" @click="look('roll')">
            {{ newCheckIn ? 'Check that date' : 'Next month' }}
          </button>
        </div>
        <p v-if="s.isLastRound" class="hint">
          This is the last round — the check-in date is already the final deadline.
        </p>
      </template>

      <!-- ---------------------------------------------------- the hard one -->
      <template v-if="isSuper">
        <h4>Final deadline</h4>
        <p class="muted small">
          The day everything has to be back. Only you can change it.
        </p>
        <div class="row">
          <input v-model="newFinal" type="date">
          <button class="btn" :disabled="busy" @click="look('final')">Check that date</button>
        </div>
      </template>

      <!-- what the move would do, before it does it -->
      <div v-if="preview" class="note warn">
        <b v-if="kind === 'roll'">
          Check-in moves to {{ date(preview.to) }}<template v-if="preview.isLastRound">
          — the final deadline, so this is the last round</template>.
        </b>
        <b v-else-if="preview.cleared">The raffle would have no final deadline.</b>
        <b v-else>Everything back by {{ date(preview.to) }}.</b>
        <p>{{ preview.effect }}</p>
        <div class="row end">
          <button class="btn sm" :disabled="busy" @click="reset">Leave it</button>
          <button class="btn sm primary" :disabled="busy" @click="apply">
            {{ busy ? 'Saving…' : 'Yes, do it' }}
          </button>
        </div>
      </div>

      <div v-if="problem" class="note bad">{{ problem }}</div>
    </template>

    <template #actions>
      <button class="btn block" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.dates { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.d { background: var(--surface-2); border-radius: var(--r-sm); padding: 12px 14px; }
.d.hard { background: var(--brand-soft); }
.d.due { background: var(--warn-soft); }
.d span { display: block; font-size: .8rem; color: var(--muted); font-weight: 600; }
.d b { font-size: 1.15rem; display: block; margin: 2px 0; }
.d small { color: var(--muted); font-size: .8rem; }
.lead { margin: 14px 0 16px; }
.now { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 6px; }
.now > div { background: var(--surface-2); border-radius: var(--r-sm); padding: 10px 14px; }
.now > div.bad b { color: var(--bad); }
.now span { display: block; font-size: .8rem; color: var(--muted); font-weight: 600; }
.now b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
h4 { margin: 20px 0 4px; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.row.end { justify-content: flex-end; margin-top: 12px; }
.row input { flex: 1; min-width: 150px; }
.note p { margin: 6px 0 0; }
</style>
