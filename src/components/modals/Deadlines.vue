<script setup>
/**
 * The two dates a raffle runs on.
 *
 * The CHECK-IN date is soft. One shared day everybody reports by — the same day
 * for the person who took books in March and the person who took them last
 * week, which is what makes a single reminder and a single late list possible.
 * Nobody is finished on that day; the point is to find out where things stand
 * while there is still time to do something about it. Then it steps on a month
 * — or whatever cadence this raffle is set to, which the screen says rather
 * than assumes, because a quarterly raffle told "next month" is being promised
 * a rhythm nobody is keeping.
 *
 * THE ROUNDS ARE SHOWN AS A PLAN, not one date at a time. They are worked out
 * from the current date, the cadence and the wall — nobody types them — so a
 * seller can be told every one of their dates on the day they take their books.
 * Shown only: the roll steps the current date and clamps at the wall exactly as
 * it always did, because whether somebody is late must not depend on a
 * derivation.
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
// Moving one round stores a row the spreadsheet has no table for, and a round
// report reads one it cannot freeze. Both are offered only where they work,
// rather than offered everywhere and refused by the server afterwards.
import { date, plural } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'round-report'])

const s = ref(null)             // deadline_status
const preview = ref(null)       // the dry run we are about to apply
const kind = ref('')            // 'roll' | 'final'
const busy = ref(false)
const problem = ref('')
const done = ref('')
const newFinal = ref('')
const newCheckIn = ref('')

/*
 * MOVING ONE FUTURE ROUND, which is a different act from rolling the check-in.
 *
 * The roll moves the LIVE date and gives every book still out more time; that
 * is why it previews what it would forgive and makes somebody type the date
 * back. Moving round 5 forgives nothing — nobody is reporting to it yet — so it
 * needs no confirmation, and the server refuses anything that would put two
 * reporting dates out of order.
 */
const moving = ref(null)        // the round being edited
const movedTo = ref('')
const moveNote = ref('')

/*
 * THE DAY SELLING STOPS, which an organiser could be refused by and not set.
 *
 * The cutoff has been enforced since it existed; the date itself lived in a
 * config row only somebody with database access could write. So the app could
 * turn a volunteer away from a sale on the authority of a date nobody in the
 * app could choose, move, or remove.
 *
 * Closing sooner is the direction that costs money, so the server asks for the
 * date to be typed back and this passes it straight through rather than
 * deciding here what counts as dangerous. One rule, on the server.
 */
const newClose = ref('')
const closeConfirm = ref('')

async function setClose(clear = false) {
  busy.value = true
  problem.value = ''
  try {
    const r = await api('set_sales_close', {
      date: clear ? '' : newClose.value,
      confirm: closeConfirm.value,
    })
    toast(r.cleared ? 'Ticket sales stay open' : `Ticket sales close ${date(r.to)}`, 'ok')
    closeConfirm.value = ''
    newClose.value = ''
    await load()
    refresh()
  } catch (err) {
    if (err.code === 'CONFIRM_REQUIRED') {
      // Typed back, not tapped through. The button changes what it says so the
      // second press is a different decision from the first.
      closeConfirm.value = err.details?.confirm ?? newClose.value
      problem.value = err.message
    } else {
      problem.value = err.message
    }
  } finally { busy.value = false }
}

function startMove(r) {
  moving.value = r.round
  movedTo.value = r.date
  moveNote.value = ''
  problem.value = ''
}

async function applyMove(clear = false) {
  busy.value = true
  problem.value = ''
  try {
    const r = await api('set_check_in_date', {
      round: moving.value,
      date: clear ? '' : movedTo.value,
      note: moveNote.value.trim(),
    })
    toast(clear ? `Round ${r.round} is back on ${date(r.to)}` : `Round ${r.round} moved to ${date(r.to)}`, 'ok')
    moving.value = null
    await load()
    refresh()
  } catch (err) {
    problem.value = err.message
  } finally { busy.value = false }
}

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

/**
 * "a month", "a fortnight", "10 days" — the server's words, not this screen's.
 *
 * It used to be worked out here from a month count, which was the only unit
 * there was. A raffle reporting every fortnight cannot be described in whole
 * months, and this screen would have gone on saying "a month" to a team that
 * reports twice as often — the exact failure the comment above warns about,
 * with the assumption moved one layer down rather than removed.
 */
const cadence = computed(() => s.value?.cadenceWords
  || ((s.value?.everyMonths || 1) === 1 ? 'a month' : `${s.value.everyMonths} months`))

/**
 * How the rounds read as words: the one that has gone, the one being answered
 * now, the ones still ahead, and the wall on the end.
 */
const rounds = computed(() => (s.value?.schedule || []).map(r => ({
  ...r,
  state: r.date === s.value.checkInDate ? 'now' : (r.done ? 'done' : 'ahead'),
})))

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
      return 'Only the System Admin can change the final deadline. The check-in date is yours ' +
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
        then it moves on {{ cadence }}. The final deadline is the one that does not move
        on its own: the draw happens after it.
      </p>

      <!--
        The whole plan, worked out rather than typed. An organiser can read the
        last round off it before deciding anything, and a seller can be told
        every date they are expected to answer on the day they take their books.
      -->
      <template v-if="rounds.length">
        <h4>Everybody reports on</h4>
        <ol class="rounds">
          <li v-for="r in rounds" :key="r.round" :class="r.state">
            <span class="n">{{ r.last ? 'Last' : r.round }}</span>
            <span class="grow">
              <b>{{ date(r.date) }}</b>
              <span class="tiny muted">
                <template v-if="r.last">Everything back by this day</template>
                <template v-else-if="r.state === 'now'">This round — reporting now</template>
                <template v-else-if="r.state === 'done'">Gone</template>
                <template v-else>Still ahead</template>
                <!-- A date off the rhythm has to be said twice: somebody told a
                     seller the derived one before it moved. -->
                <template v-if="r.moved"> · moved</template>
              </span>
            </span>

            <!-- Only rounds nobody is reporting to yet. The live one belongs to
                 "Move the check-in on" below, which says first how many books
                 it would give more time to. -->
            <button v-if="isAdmin && r.state === 'ahead' && !r.last"
                    class="btn sm ghost noprint" @click="startMove(r)">Move</button>
            <button v-if="r.state === 'done'" class="btn sm ghost noprint"
                    @click="emit('round-report', r.round)">Report</button>
          </li>
        </ol>

        <!-- The one row of controls, shown against the round being moved rather
             than as a separate screen: the plan above it is the context that
             makes a date choice sensible. -->
        <div v-if="moving" class="movebox">
          <b class="small">Round {{ moving }}</b>
          <div class="row">
            <input v-model="movedTo" type="date" :min="s.today" :max="s.finalDeadline">
            <button class="btn primary" :disabled="busy" @click="applyMove(false)">Move it</button>
          </div>
          <input v-model="moveNote" class="mt6" placeholder="Why — the hall is booked" autocomplete="off">
          <div class="row mt6">
            <button class="btn sm ghost" @click="moving = null">Cancel</button>
            <button class="btn sm ghost" :disabled="busy" @click="applyMove(true)">
              Put it back on the rhythm
            </button>
          </div>
          <p class="hint">
            Only this round moves. The ones after it keep the dates they have —
            the plan is worked out from the check-in date, not from each round in turn.
          </p>
        </div>
        <p v-if="s.checkInDate && s.sellersHolding" class="muted small">
          {{ s.sellersReported }} of {{ s.sellersHolding }}
          {{ s.sellersHolding === 1 ? 'seller holding books has' : 'sellers holding books have' }}
          reported this round<template v-if="s.reportBy">, and anybody who has not is
          shown as late from {{ date(s.reportBy) }}</template>.
        </p>
      </template>

      <div class="now">
        <div><span>Books out</span><b>{{ s.booksOut }}</b></div>
        <div :class="{ bad: s.lateNow }"><span>Late right now</span><b>{{ s.lateNow }}</b></div>
      </div>

      <!-- The third date, which is neither of the two at the top: selling stops
           before the books are due back, and until it existed a ticket could be
           sold the morning after the draw. Shown here rather than only in
           Settings because this is the screen people come to for "when". -->
      <p v-if="s.salesCloseDate" :class="['note', s.salesClosed ? 'warn' : '']">
        <template v-if="s.salesClosed">
          Ticket sales closed on {{ date(s.salesCloseDate) }}. Recording a new sale is
          refused; an organiser can still force one that was genuinely sold in time, and
          it goes in the log. Settling, correcting and counting go on as normal.
        </template>
        <template v-else>
          Ticket sales close on {{ date(s.salesCloseDate) }}<template v-if="s.daysToSalesClose > 0">,
          {{ plural(s.daysToSalesClose, 'day', 'days') }} away</template>.
        </template>
      </p>

      <div v-if="noFinal" class="note info">
        There is no final deadline yet, so the check-in date cannot be moved.
        <template v-if="!isSuper">Ask the System Admin to set one.</template>
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
            {{ newCheckIn ? 'Check that date' : `Next round — ${cadence} on` }}
          </button>
        </div>
        <p v-if="s.isLastRound" class="hint">
          This is the last round — the check-in date is already the final deadline.
        </p>
      </template>

      <!-- ------------------------------------------------ when selling stops -->
      <template v-if="isAdmin">
        <h4>When ticket sales close</h4>
        <p class="muted small">
          The last day a ticket may be sold. Not the day the books come back, and
          not the draw — usually earlier than both. After it, recording a sale is
          refused; an organiser can still force one that was genuinely sold in
          time, and it goes in the log.
        </p>
        <div class="row">
          <input v-model="newClose" type="date" :max="s.drawDate || undefined">
          <button class="btn" :disabled="busy || !newClose" @click="setClose(false)">
            {{ closeConfirm ? 'Yes — close it then' : 'Set it' }}
          </button>
          <button v-if="s.salesCloseDate" class="btn ghost" :disabled="busy" @click="setClose(true)">
            Keep selling
          </button>
        </div>
      </template>

      <!-- ---------------------------------------------------- the hard one -->
      <!--
        An organiser sees the final deadline at the top of this screen and has
        no control for it. Left unexplained that silence reads as broken, and
        they go asking what is wrong with the app. Saying who sets it is not the
        same as the refusal banner: that one reported a working system as
        failing, this one explains a date they can already see.
      -->
      <p v-if="isAdmin && !isSuper" class="muted small whosets-note">
        The final deadline is set by the System Admin. You can move the check-in date
        as far as that, and no further.
      </p>
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
.movebox {
  margin: 8px 0 14px; padding: 12px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-2, transparent);
}
.mt6 { margin-top: 6px; }

.rounds { list-style: none; margin: 4px 0 16px; padding: 0; }
.rounds li { display: flex; align-items: center; gap: 12px; padding: 8px 0;
  border-bottom: 1px solid var(--border); }
.rounds li:last-child { border-bottom: 0; }
.rounds .n { flex: 0 0 44px; height: 28px; border-radius: var(--r-sm);
  background: var(--surface-2); color: var(--muted);
  display: grid; place-items: center; font-weight: 700; font-size: .8rem; }
.rounds li.now .n { background: var(--brand-soft); color: var(--brand); }
.rounds li.done { opacity: .55; }
.rounds b { display: block; }
.dates { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.d { background: var(--surface-2); border-radius: var(--r-sm); padding: 12px 14px; }
.d.hard { background: var(--brand-soft); }
.d.due { background: var(--warn-soft); }
.d span { display: block; font-size: .8rem; color: var(--muted); font-weight: 600; }
.d b { font-size: 1.15rem; display: block; margin: 2px 0; }
.d small { color: var(--muted); font-size: .8rem; }
.lead { margin: 14px 0 16px; }
.whosets-note { margin: 20px 0 0; }
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
