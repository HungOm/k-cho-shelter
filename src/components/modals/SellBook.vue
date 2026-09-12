<script setup>
/**
 * Selling a whole book to one buyer.
 *
 * Common when a church or a family takes a book outright. Every ticket gets the
 * SAME name and phone, which is the point: a winner drawn from a book sale can
 * still be telephoned. A book closed through settlement deliberately leaves
 * those blank, so the two look very different in the missing-contact report.
 */
import { ref, computed } from 'vue'
import { state, api, toast, loadDelta, refresh, isAdmin } from '../../lib/store.js'
import { phoneDigits } from '../../lib/search.js'
import { money } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'sold'])

const from = ref(props.book ? String(props.book.book).replace(/\D/g, '').replace(/^0+/, '') : '')
const to = ref('')
const name = ref('')
const phone = ref('')
const zone = ref('')
const busy = ref(false)
const result = ref(null)

const cfg = computed(() => state.cfg)
const count = computed(() => {
  const a = parseInt(from.value, 10)
  const b = parseInt(to.value || from.value, 10)
  if (isNaN(a)) return 0
  return Math.max(0, Math.abs((isNaN(b) ? a : b) - a) + 1)
})
const tickets = computed(() => count.value * (cfg.value?.ticketsPerBook || 0))
const amount = computed(() => tickets.value * (cfg.value?.ticketPrice || 0))
const tooMany = computed(() => count.value > 20)
const ok = computed(() =>
  count.value > 0 && !tooMany.value && name.value.trim() && phoneDigits(phone.value).length >= 7)

function bookNum(raw) {
  const d = String(raw).replace(/\D/g, '')
  return d ? cfg.value.bookPrefix + d.padStart(cfg.value.bookDigits, '0') : ''
}

async function sell() {
  if (!ok.value) return toast('A name and a phone number are both needed', 'bad')
  busy.value = true
  try {
    const r = await api('sell_book', {
      fromBook: bookNum(from.value),
      toBook: bookNum(to.value || from.value),
      buyerName: name.value.trim(),
      buyerPhone: phone.value.trim(),
      buyerZone: zone.value.trim()
    })
    result.value = r
    loadDelta().then(refresh)
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet title="Sell a whole book" subtitle="One buyer takes every ticket in it" @close="emit('close')">

    <!-- what actually happened -->
    <template v-if="result">
      <div class="done">
        <div class="tick">✓</div>
        <h2>{{ result.sold }} {{ result.sold === 1 ? 'ticket' : 'tickets' }} sold</h2>
        <p class="muted">to {{ result.buyerName }} · {{ money(result.amount, result.currency) }}</p>
      </div>

      <!-- the interesting half: what was left alone -->
      <div v-if="result.skipped?.length" class="note warn">
        <b>{{ result.skipped.length }} were not sold</b> — they already belonged to somebody else,
        and nothing was overwritten.
        <div v-for="s in result.skipped.slice(0, 12)" :key="s.ticketNumber" class="tiny">
          {{ s.ticketNumber }} — {{ s.reason }}
        </div>
        <div v-if="result.skipped.length > 12" class="tiny">…and {{ result.skipped.length - 12 }} more</div>
      </div>
      <div v-else class="note ok">Every ticket in the book went to this buyer.</div>
    </template>

    <!-- the form -->
    <template v-else>
      <div class="row">
        <div class="field grow">
          <label for="sbf">First book <span class="req">*</span></label>
          <input id="sbf" v-model="from" class="xl" inputmode="numeric" placeholder="31">
        </div>
        <div class="field grow">
          <label for="sbt">Last book</label>
          <input id="sbt" v-model="to" class="xl" inputmode="numeric" placeholder="leave empty for one">
        </div>
      </div>

      <div v-if="tooMany" class="note bad">
        That is {{ count }} books. At most 20 can go to one buyer at a time.
      </div>
      <div v-else-if="count" class="note info">
        <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b> ·
        {{ tickets }} tickets · <b>{{ money(amount, cfg.currency) }}</b>
      </div>

      <div class="field">
        <label for="sbn">Who is buying them? <span class="req">*</span></label>
        <input id="sbn" v-model="name" class="xl" autocomplete="off" placeholder="Their name">
      </div>
      <div class="field">
        <label for="sbp">Phone number <span class="req">*</span></label>
        <input id="sbp" v-model="phone" class="xl" type="tel" inputmode="tel"
               autocomplete="off" placeholder="012-345 6789">
        <p class="hint">
          This name and number go on every ticket in the book, so a winner can still be telephoned.
        </p>
      </div>
      <div class="field">
        <label for="sbz">Church or area <span class="opt">— not required</span></label>
        <input id="sbz" v-model="zone" autocomplete="off">
      </div>

      <div class="note">
        Tickets already sold to somebody else are left exactly as they are.
      </div>
    </template>

    <template #actions>
      <button v-if="result" class="btn primary block" @click="emit('sold')">Done</button>
      <template v-else>
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy || !ok" @click="sell">
          {{ busy ? 'Saving…' : `Sell · ${money(amount, cfg.currency)}` }}
        </button>
      </template>
    </template>
  </Sheet>
</template>

<style scoped>
.done { text-align: center; padding: 20px 0 12px; }
.done .tick {
  width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 50%;
  background: var(--ok-soft); color: var(--ok);
  display: grid; place-items: center; font-size: 2.2rem; font-weight: 800;
  animation: pop-in .38s var(--ease);
}
@keyframes pop-in { from { transform: scale(.4); opacity: 0 } }
</style>
