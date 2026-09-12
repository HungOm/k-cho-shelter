<script setup>
import { computed } from 'vue'
import { state, isAdmin, go } from '../../lib/store.js'
import { money, date, BOOK_WORDS } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import StatusPill from '../ui/StatusPill.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settle', 'receipt', 'see-tickets', 'sell-book'])
const currency = computed(() => state.cfg?.currency || '')
const canSettle = computed(() => ['Out', 'Returned'].includes(props.book.status))
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
      <button v-if="isAdmin && canSettle" class="btn primary" @click="emit('settle', book)">Count it in</button>
      <button v-else-if="isAdmin && book.agentId" class="btn" @click="emit('receipt', book.agentId)">Receipt</button>
      <button v-else class="btn" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.facts { display: grid; gap: 14px; }
.f { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.f span { color: var(--muted); }
.f b { text-align: right; }
</style>
