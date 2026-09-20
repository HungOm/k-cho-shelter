<script setup>
/**
 * Recording who won.
 *
 * The button for this existed on the draw screen and opened nothing: it set a
 * modal kind that App.vue had no branch for, so it looked live, took the click,
 * and did nothing at all. This is the screen it was asking for.
 *
 * THE THING THIS SCREEN IS FOR is not typing a number — it is confirming the
 * number is the one you meant BEFORE it is written down. A winner recorded
 * against the wrong ticket is close to unrecoverable: the live backend refuses
 * a second entry for the same ticket, there is no action to remove one, and by
 * the time anybody notices, a name has usually been read out. So the buyer
 * behind the number is shown as soon as it resolves, from the ticket table
 * already on the device, and the save button stays out of reach until a real
 * sold ticket is in the box.
 */
import { ref, computed, onMounted } from 'vue'
import { state, api, toast, isSuper, isSold, drawChanged } from '../../lib/store.js'
import { resolveTicketNumber } from '../../lib/books.js'
import { money } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'saved'])

const raw = ref('')
const prize = ref('')
const prizeId = ref('')
const schedule = ref(null)
const busy = ref(false)
const problem = ref('')

const currency = computed(() => state.cfg?.currency || '')

/*
 * THE PRIZE COMES OFF THE SCHEDULE NOW, and the reason is that this box used to
 * be free text. "First prize", "1st Prize" and "Grand prize" were three
 * different prizes to everything downstream, nothing could say how many of the
 * ten hampers were left, and the same prize could be awarded twice.
 *
 * Only what is still to give is offered. A prize already given is not a choice
 * an organiser should have to notice is wrong — on a night when somebody is
 * reading numbers out of a drum, the list itself should be the guard.
 */
onMounted(async () => {
  try {
    schedule.value = await api('list_prizes', {})
    const first = available.value[0]
    if (first) prizeId.value = first.prize_id
  } catch (err) {
    /*
     * A BACKEND WITHOUT THE PRIZE LIST MUST NOT STOP A DRAW.
     *
     * Pushing to master deploys the frontend alone; the Edge Function is a
     * separate, manual step. So this screen can be live against a server that
     * has never heard of list_prizes — and leaving `schedule` null on the error
     * left the prize field on a skeleton for ever with the save button out of
     * reach, on the one screen in this app that is used with a room waiting.
     *
     * An empty schedule is already a state this form knows how to be in: it
     * offers the typed box. Falling into it is strictly better than refusing,
     * for the same reason the backend still accepts free text at all.
     */
    schedule.value = { prizes: [], types: [], collected: 0 }
    if (err.code !== 'UNKNOWN_ACTION') toast(err.message, 'bad', err.code)
  }
})

const available = computed(() =>
  (schedule.value?.prizes || []).filter(p => p.active !== false && p.remaining > 0))

/*
 * NO SCHEDULE MEANS THE TYPED BOX IS STILL THERE. A raffle whose organiser
 * never opened the prize screen must still be able to record that somebody won
 * something — refusing would turn a missed setup step into a draw that cannot
 * be written down while the room is waiting.
 */
const noSchedule = computed(() => !!schedule.value && !schedule.value.prizes.length)
const allGone = computed(() =>
  !!schedule.value && schedule.value.prizes.length > 0 && !available.value.length)

const chosen = computed(() =>
  available.value.find(p => p.prize_id === prizeId.value) || null)

function label(p) {
  const left = p.remaining === p.quantity
    ? `${p.quantity} to give`
    : `${p.remaining} of ${p.quantity} left`
  return `${p.tier}${p.name ? ' — ' + p.name : ''} (${left})`
}

/** "611" is what somebody reads off the paper; KS-00611 is what it is called. */
const number = computed(() => resolveTicketNumber(raw.value))
const ticket = computed(() => (number.value ? state.byNumber[number.value] : null))

const notATicket = computed(() => !!raw.value.trim() && !number.value)

/**
 * Only a ticket somebody actually bought can win. A prize drawn against an
 * unsold number means either a prize going nowhere or, worse, somebody
 * deciding afterwards whose it was.
 */
const eligible = computed(() =>
  !!ticket.value && isSold(ticket.value))

const contactable = computed(() =>
  !!ticket.value && !!ticket.value.name.trim() && !!ticket.value.phone.trim())

const canSave = computed(() =>
  eligible.value && !busy.value &&
  (noSchedule.value ? !!prize.value.trim() : !!prizeId.value))

async function save() {
  problem.value = ''
  busy.value = true
  try {
    const r = await api('record_winner', {
      ticketNumber: number.value,
      // One or the other. The prize id wins where there is a schedule, and the
      // backend freezes the label from it rather than trusting what is typed
      // here — so correcting a spelling next week cannot rewrite the record of
      // what was read out on the night.
      ...(noSchedule.value
        ? { prize: prize.value.trim() }
        : { prizeId: prizeId.value }),
    })
    toast(`${r.ticketNumber || r.ticket} recorded as a winner`, 'ok')
    drawChanged()
    emit('saved')
  } catch (err) {
    problem.value = explain(err)
  } finally { busy.value = false }
}

function explain(err) {
  switch (err.code) {
    case 'NOT_ELIGIBLE':
      return `${number.value} was never sold, so it was not in the draw.`
    case 'TICKET_NOT_FOUND':
      return `${number.value} is not a ticket in this raffle.`
    case 'BAD_REQUEST':
      // The live backend refuses a second entry for the same ticket. Saying so
      // plainly beats "bad request", which reads as the app being broken.
      return /drawn/i.test(err.message)
        ? `${number.value} has already been recorded as a winner.`
        : err.message
    case 'SUPER_ADMIN_ONLY':
      return 'Only the System Admin can record a winner.'
    case 'NOT_FOUND':
      // Somebody removed the prize between this screen loading and the save.
      return 'That prize is no longer on the list. Close this and open it again.'
    default:
      return err.message
  }
}
</script>

<template>
  <Sheet title="Add a winner" subtitle="Write down which ticket won, and what it won"
         @close="emit('close')">

    <div v-if="!isSuper" class="note bad">
      Only the System Admin can record a winner.
    </div>

    <template v-else>
      <div class="field">
        <label for="wt">Which ticket won? <span class="req">*</span></label>
        <input id="wt" v-model="raw" class="xl" inputmode="numeric"
               placeholder="e.g. 611" autocomplete="off">
        <p class="hint">
          Type the number on the ticket. The prefix is added for you.
        </p>
      </div>

      <!-- Who this is, before it is written down. -->
      <div v-if="ticket && eligible" class="note info">
        <b class="data">{{ ticket.number }}</b> — {{ ticket.name || 'no name written down' }}
        <template v-if="ticket.phone"> · {{ ticket.phone }}</template>
        <div v-if="!contactable" class="small" style="margin-top:4px">
          This ticket has no name or phone against it. It can still be recorded,
          but nobody will be able to tell them they have won.
        </div>
      </div>

      <div v-else-if="ticket" class="note bad">
        <b class="data">{{ ticket.number }}</b> is {{ ticket.status.toLowerCase() }}, so it was never
        in the draw. Only a ticket somebody bought can win.
      </div>

      <div v-else-if="notATicket" class="note bad">
        That is not a ticket in this raffle.
      </div>

      <!-- Off the schedule where there is one, so a prize cannot be named two
           ways or given twice. -->
      <div v-if="!schedule" class="skel" style="height:56px;margin-bottom:14px"></div>

      <div v-else-if="allGone" class="note warn">
        Every prize on the list has been given out. Add another prize before recording
        more winners, so this one is recorded against something.
      </div>

      <div v-else-if="noSchedule" class="field">
        <label for="wp">What did it win? <span class="req">*</span></label>
        <input id="wp" v-model="prize" class="xl" placeholder="e.g. First prize"
               autocomplete="off">
        <p class="hint">
          No prizes have been set up, so type what this one won. Setting up the prize
          list first means the app can count what is left and stop the same prize
          going out twice.
        </p>
      </div>

      <div v-else class="field">
        <label for="wpz">Which prize? <span class="req">*</span></label>
        <select id="wpz" v-model="prizeId" class="xl">
          <option v-for="p in available" :key="p.prize_id" :value="p.prize_id">
            {{ label(p) }}
          </option>
        </select>
        <p v-if="chosen" class="hint">
          This is number {{ chosen.awarded + 1 }} of {{ chosen.quantity }}.
          <template v-if="chosen.unitValue !== null && chosen.unitValue > 0">
            Worth {{ money(chosen.unitValue, currency) }}<template v-if="chosen.valuing === 'percent'">
              — {{ chosen.value_amount }}% of the {{ money(schedule.collected, currency) }} handed in
              so far</template>.
          </template>
          <template v-else>No value has been stated for it.</template>
        </p>
      </div>

      <div v-if="problem" class="note bad">{{ problem }}</div>

      <div class="note plain">
        The buyer's name and phone are copied from the ticket as it stands now,
        so the record of who won still says what it said on the day even if the
        ticket is corrected later.
      </div>
    </template>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button v-if="isSuper" class="btn primary" :disabled="!canSave" @click="save">
        {{ busy ? 'Saving…' : 'Record it' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.note.plain { background: var(--surface-2); color: var(--muted); }
</style>
