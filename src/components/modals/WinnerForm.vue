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
import { ref, computed } from 'vue'
import { state, api, toast, isSuper } from '../../lib/store.js'
import { resolveTicketNumber } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'saved'])

const raw = ref('')
const prize = ref('')
const busy = ref(false)
const problem = ref('')

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
  !!ticket.value && (ticket.value.status === 'Sold' || ticket.value.status === 'Donated'))

const contactable = computed(() =>
  !!ticket.value && !!ticket.value.name.trim() && !!ticket.value.phone.trim())

const canSave = computed(() => eligible.value && !!prize.value.trim() && !busy.value)

async function save() {
  problem.value = ''
  busy.value = true
  try {
    const r = await api('record_winner', {
      ticketNumber: number.value,
      prize: prize.value.trim(),
    })
    toast(`${r.ticketNumber || r.ticket} recorded as a winner`, 'ok')
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
        <b>{{ ticket.number }}</b> — {{ ticket.name || 'no name written down' }}
        <template v-if="ticket.phone"> · {{ ticket.phone }}</template>
        <div v-if="!contactable" class="small" style="margin-top:4px">
          This ticket has no name or phone against it. It can still be recorded,
          but nobody will be able to tell them they have won.
        </div>
      </div>

      <div v-else-if="ticket" class="note bad">
        <b>{{ ticket.number }}</b> is {{ ticket.status.toLowerCase() }}, so it was never
        in the draw. Only a ticket somebody bought can win.
      </div>

      <div v-else-if="notATicket" class="note bad">
        That is not a ticket in this raffle.
      </div>

      <div class="field">
        <label for="wp">What did it win? <span class="req">*</span></label>
        <input id="wp" v-model="prize" class="xl" placeholder="e.g. First prize"
               autocomplete="off">
        <p class="hint">Whatever you want to appear beside their name.</p>
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
