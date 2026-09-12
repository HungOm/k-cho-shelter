<script setup>
/**
 * Counting a book back in.
 *
 * The seller is standing there holding the tickets that did NOT sell, so that
 * is what we ask for. Typing two numbers takes five seconds and is exact,
 * whereas "I sold eight" throws away which numbers went to whom — and the draw
 * depends on knowing that.
 */
import { ref, computed } from 'vue'
import { state, api, toast, refresh, loadDelta } from '../../lib/store.js'
import { money } from '../../lib/format.js'
import { resolveTicketNumber } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settled'])

const unsold = ref('')
const paid = ref('')
const lost = ref(false)
const soldCount = ref('')
const busy = ref(false)

const per = computed(() => state.cfg?.ticketsPerBook || 10)
const price = computed(() => state.cfg?.ticketPrice || 0)
const currency = computed(() => state.cfg?.currency || '')

const unsoldList = computed(() =>
  unsold.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))

const sold = computed(() => {
  if (lost.value) return parseInt(soldCount.value, 10) || 0
  // Only tickets that actually resolved count as returned. Counting a typo as
  // returned would show the agent owing less than the server will charge them.
  const good = unsoldList.value.length - unresolved.value.length
  return Math.max(0, per.value - good)
})
const due = computed(() => sold.value * price.value)
const paidNum = computed(() => parseFloat(paid.value) || 0)
const diff = computed(() => paidNum.value - due.value)

/** Anything that does not resolve is shown back, not silently sent. */
const unresolved = computed(() =>
  unsoldList.value.filter(r => !resolveTicketNumber(r)))

async function settle() {
  if (paid.value === '') return toast('How much money did they hand in?', 'bad')
  busy.value = true
  try {
    const payload = { bookNumber: props.book.book, amountPaid: paidNum.value }
    if (lost.value) { payload.allowUnidentified = true; payload.soldCount = sold.value }
    else payload.unsoldTickets = unsoldList.value.map(resolve)

    const r = await api('settle_book', payload)
    toast(`${props.book.book} counted — ${r.declaredSold} sold`,
      Math.abs(r.variance) > 0.005 ? 'bad' : 'ok')
    emit('settled')
    loadDelta().then(refresh)
  } catch (err) { toast(err.message, 'bad', err.code) } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="`Count in ${book.book}`"
         :subtitle="book.agentName ? `from ${book.agentName}` : ''" @close="emit('close')">
    <div class="note info">
      The seller is holding the tickets that <b>did not</b> sell.
      Type those numbers — everything else in the book counts as sold.
    </div>

    <template v-if="!lost">
      <div class="field">
        <label for="su">Which tickets came back?</label>
        <textarea id="su" v-model="unsold" class="xl" placeholder="313, 317"></textarea>
        <p class="hint">Separate with commas or spaces. Leave empty if the whole book sold.</p>
      </div>
    </template>
    <template v-else>
      <div class="field">
        <label for="sc">How many did they sell?</label>
        <input id="sc" v-model="soldCount" class="xl" type="number" inputmode="numeric"
               min="0" :max="per">
        <p class="hint">
          Only the book total is written down. No ticket is marked sold, because
          guessing which numbers went would put the wrong names in the draw.
        </p>
      </div>
    </template>

    <div class="field">
      <label for="sp">How much money did they hand in? <span class="req">*</span></label>
      <input id="sp" v-model="paid" class="xl" type="number" inputmode="decimal" step="0.01"
             :placeholder="String(due)">
    </div>

    <!-- A number here that is not a real ticket must never be sent quietly.
         Anything NOT on this list counts as sold and is charged to the agent,
         so one that fails to match moves a ticket to the sold side and adds its
         price to what that volunteer owes. -->
    <div v-if="unresolved.length" class="note bad">
      <b>Not a ticket in this raffle:</b> {{ unresolved.join(', ') }}
      <div class="small">Check the number. Until it is right, these would be counted as sold.</div>
    </div>

    <div :class="['note', paid !== '' && Math.abs(diff) > 0.005 ? 'warn' : 'info']">
      <b>{{ sold }}</b> sold · should be <b>{{ money(due, currency) }}</b>
      <template v-if="paid !== ''"> · handed in <b>{{ money(paidNum, currency) }}</b></template>
      <div v-if="paid !== '' && Math.abs(diff) > 0.005" style="margin-top:4px">
        <b>{{ diff > 0 ? 'Too much' : 'Short' }} by {{ money(Math.abs(diff), currency) }}</b>
      </div>
    </div>

    <label class="lostbox">
      <input type="checkbox" v-model="lost">
      <span>They lost the leftover tickets</span>
    </label>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy || unresolved.length" @click="settle">
        {{ busy ? 'Saving…' : 'Finish this book' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.lostbox { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-weight: 500; color: var(--muted); cursor: pointer; }
.lostbox input { width: auto; min-height: auto; }
</style>
