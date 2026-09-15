<script setup>
import { computed, ref } from 'vue'
import { state, isAdmin, go, bookBlock } from '../../lib/store.js'
import { money, date, BOOK_WORDS } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import StatusPill from '../ui/StatusPill.vue'
import History from './History.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settle', 'receipt', 'see-tickets', 'sell-book'])
const currency = computed(() => state.cfg?.currency || '')
const canSettle = computed(() => ['Out', 'Returned'].includes(props.book.status))

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
      <div class="f"><span>Who has it</span><b>{{ book.agentName || 'nobody' }}</b></div>
      <div v-if="book.due" class="f"><span>Due back</span>
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
              :title="blocked ? `Cannot sell — ${blocked}` : ''"
              @click="emit('sell-book', book)">
        Sell it whole
      </button>
      <button v-if="canPrintReceipt" class="btn" @click="emit('receipt', book.agentId)">Receipt</button>
      <button v-if="isAdmin && canSettle" class="btn primary" @click="emit('settle', book)">Count it in</button>
      <button v-else class="btn" @click="emit('close')">Close</button>
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
