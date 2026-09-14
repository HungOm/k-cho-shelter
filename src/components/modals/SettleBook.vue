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

/**
 * The numbers this book actually contains.
 *
 * Read from the tickets rather than worked out from the book number times the
 * tickets per book, because the two can disagree: a book at the end of a
 * part-released run holds fewer, and the arithmetic would confidently name
 * numbers that are not in play. The tickets know.
 */
const inBook = computed(() =>
  state.tickets
    .filter(t => t.book === props.book.book)
    .map(t => t.number)
    .sort())

/** "KS-00911" reads as 911 to the person holding the ticket. */
function short(n) {
  return String(n ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

const range = computed(() => {
  const l = inBook.value
  return l.length ? { first: short(l[0]), last: short(l[l.length - 1]), count: l.length } : null
})

/**
 * Two numbers from THIS book, so the example cannot be copied wrongly.
 *
 * The placeholder used to be a fixed "313, 317" whatever book was open. On
 * Book-092, whose tickets are 911-920, that is an example nobody can follow and
 * a number that belongs to somebody else's book.
 */
const example = computed(() => {
  const l = inBook.value
  if (l.length < 2) return '911, 915'
  return `${short(l[0])}, ${short(l[Math.min(2, l.length - 1)])}`
})

/**
 * Typed a real ticket, but one from a different book.
 *
 * resolveTicketNumber searches the whole raffle, so a number from another book
 * resolves perfectly well and would be sent as "came back" for this one. That
 * is the silent wrong answer: the ticket is real, the form accepts it, and two
 * books end up describing the same ticket differently.
 */
const wrongBook = computed(() =>
  unsoldList.value
    .map(raw => ({ raw, num: resolveTicketNumber(raw) }))
    .filter(x => x.num && state.byNumber[x.num]?.book &&
                 state.byNumber[x.num].book !== props.book.book)
    .map(x => `${x.raw} (${state.byNumber[x.num].book})`))

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
        <textarea id="su" v-model="unsold" class="xl" :placeholder="example"></textarea>
        <p class="hint">
          <template v-if="range">
            This book holds <b>{{ range.first }}–{{ range.last }}</b>.
            Only those numbers belong here.<br>
          </template>
          Separate with commas or spaces. Leave empty if the whole book sold.
        </p>
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

    <!-- A real ticket, from somebody else's book. The dangerous one: it
         resolves, so nothing above catches it, and it would be recorded as
         having come back from a book it was never in. -->
    <div v-if="wrongBook.length" class="note bad">
      <b>Not in {{ book.book }}:</b> {{ wrongBook.join(', ') }}
      <div class="small">
        <template v-if="range">This book holds {{ range.first }}–{{ range.last }}. </template>
        Those tickets belong to another book and cannot come back from this one.
      </div>
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
      <button class="btn primary" :disabled="busy || unresolved.length || wrongBook.length"
              @click="settle">
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
