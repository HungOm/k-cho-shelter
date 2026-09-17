<script setup>
import { computed, ref } from 'vue'
import { state, isAdmin, go, bookBlock } from '../../lib/store.js'
import { money, date, BOOK_WORDS, COUNTED_IN_HELP } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import StatusPill from '../ui/StatusPill.vue'
import History from './History.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settle', 'receipt', 'see-tickets', 'sell-book'])
const currency = computed(() => state.cfg?.currency || '')
const canSettle = computed(() => ['Out', 'Returned'].includes(props.book.status))

/**
 * Present tense only while it is true.
 *
 * held_by_agent survives Returned and Settled on purpose — settlement has to
 * know whose money it is — so the name is still there after the book is back.
 * Saying "who HAS it" then contradicts the status directly above.
 */
const holderLabel = computed(() => ({
  Out: 'Who has it',
  Returned: 'Brought back by',
  Settled: 'Was with',
  Lost: 'Last with',
}[props.book.status] || 'Who has it'))

/**
 * Reprinting a lost handover paper starts here. It used to be chained behind
 * "Count it in" as a v-else-if, which meant it never appeared: a receipt only
 * lists books that are Out, and an Out book can always be counted in. The
 * button showed up only once the book was settled — by which time there was
 * nothing left to put on the sheet.
 */
const canPrintReceipt = computed(() =>
  isAdmin.value && !!props.book.agentId && props.book.status === 'Out')

const blocked = computed(() => bookBlock(props.book))

/*
 * Opened ON TOP of this sheet rather than instead of it, so closing the history
 * puts you back on the book you were looking at. Replacing it would make "where
 * has this been?" cost you your place, which is how a useful screen stops being
 * opened.
 */
const showHistory = ref(false)
</script>

<template>
  <Sheet :title="book.book" :subtitle="`${book.firstTicket} – ${book.lastTicket}`" @close="emit('close')">
    <div class="facts">
      <div class="f"><span>Where it is</span><StatusPill :status="book.status" kind="book" /></div>

      <!-- THE LABEL FOLLOWS THE STATE, because it was contradicting the row
           above it. A book that is Brought back said "Who has it: JOHN" — the
           screen telling a volunteer, in two consecutive lines, that the book is
           here and that JOHN has it. held_by_agent is deliberately kept through
           Returned and Settled so settlement knows whose money it is, which is
           right; reading it as present tense afterwards is what was wrong.

           And the row is dropped entirely when nobody holds it. "In the office"
           followed by "Who has it: nobody" is the same fact twice, and the
           second one is phrased as if something were missing. -->
      <div v-if="book.agentName" class="f">
        <span>{{ holderLabel }}</span><b>{{ book.agentName }}</b>
      </div>

      <!-- Only while it is actually out. A due date on a book already back is an
           obligation that no longer exists, sitting in the middle of the facts
           as though it did. -->
      <div v-if="book.due && book.status === 'Out'" class="f"><span>Due back</span>
        <b :style="book.daysOverdue > 0 ? 'color:var(--bad)' : ''">
          {{ date(book.due) }}<template v-if="book.daysOverdue > 0"> — {{ book.daysOverdue }} days late</template>
        </b>
      </div>
      <div class="f"><span>Sold</span><b>{{ book.sold }} of {{ state.cfg.ticketsPerBook }}</b></div>
      <div class="f"><span>Should have</span><b>{{ money(book.expected, currency) }}</b></div>
      <div class="f"><span>Handed in</span><b>{{ money(book.paid, currency) }}</b></div>
      <div v-if="Math.abs(book.variance) > 0.005" class="f">
        <span>Difference</span><b style="color:var(--bad)">{{ money(book.variance, currency) }}</b>
      </div>
      <div v-if="book.missingContact" class="f">
        <span>No phone number</span><b style="color:var(--bad)">{{ book.missingContact }} tickets</b>
      </div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('see-tickets', book)">See its tickets</button>
      <button class="btn" @click="showHistory = true">Where it has been</button>
      <!-- Shown and DISABLED rather than hidden, when this person cannot sell
           from this book. Hiding it makes the app look different to different
           people for no stated reason; letting them press it makes the server
           refuse after they have committed to the action. Disabled with the
           reason on it is the only one of the three that tells them anything. -->
      <button v-if="book.available" class="btn" :disabled="!!blocked"
              :title="blocked ? `Cannot sell — ${blocked}` : undefined"
              @click="emit('sell-book', book)">
        Sell it whole
      </button>
      <button v-if="canPrintReceipt" class="btn" @click="emit('receipt', book.agentId)">Receipt</button>
      <!-- The tooltip is the answer to a question that was actually asked:
           if the whole book is sold, why is this still here. Sold is about
           tickets; this is about money, and they are different facts. -->
      <button v-if="isAdmin && canSettle" class="btn primary" :title="COUNTED_IN_HELP"
              @click="emit('settle', book)">Count it in</button>

      <!-- GHOST, not another button. Four controls of identical weight is a row
           with no answer to "what am I meant to do here", and the browser's
           focus ring lands on the last one — so Close, the only control that
           does nothing, was the one that looked chosen. Closing is always
           available from the × as well; this is the second way out, not an
           action, and it should not compete with three that are. -->
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>

    <!-- Later in the DOM than this sheet, which is fixed at z-index 60, so it
         paints over without unmounting anything underneath. -->
    <History v-if="showHistory" :book="book.book" @close="showHistory = false" />
  </Sheet>
</template>

<style scoped>
.facts { display: grid; gap: 14px; }
.f { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.f span { color: var(--muted); }
.f b { text-align: right; }
</style>
