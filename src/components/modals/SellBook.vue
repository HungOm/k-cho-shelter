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
import { state, api, toast, loadDelta, refresh, isAdmin, bookBlock, overrideReasonNeeded } from '../../lib/store.js'
import { phoneDigits } from '../../lib/search.js'
import { money, COUNTED_IN_HELP } from '../../lib/format.js'
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

/*
 * WHO THE SALE IS CREDITED TO, and why it needs asking at all.
 *
 * A book that is OUT with somebody is theirs: they are carrying the paper, and
 * the server credits the holder whatever this box says. Nothing to ask.
 *
 * A book in the office, or one brought back and not given out again, is being
 * sold across a desk by whoever is standing at it — and that person used to be
 * recorded as nobody, or worse, as the seller who had handed the book in. So it
 * defaults to the person signed in, and can be changed, because the one at the
 * keyboard is not always the one who did the talking.
 *
 * Only offered to somebody who may credit another person. A seller recording
 * their own sale has nothing to choose, and the server refuses it anyway —
 * crediting a sale elsewhere moves what that person is shown as owing.
 */
const soldBy = ref(state.user?.agentId || '')
const iAmSeller = computed(() => state.user?.role === 'agent')
const sellers = computed(() => state.agents || [])
const creditName = computed(() => {
  const a = sellers.value.find(x => x.id === soldBy.value)
  return a ? a.name : ''
})

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

/**
 * Books in this range that this person cannot sell from.
 *
 * The same rule the database enforces, asked before the form is submitted
 * rather than after. Without it a helper types a range, fills in the buyer,
 * presses the button and is refused — having already done all the work and
 * committed to the sale in front of whoever is paying.
 *
 * Named, not counted. "3 books are out with a seller" sends somebody back to
 * the grid to work out which; naming them is the difference between a refusal
 * and an instruction.
 */
const blocked = computed(() => {
  const a = parseInt(from.value, 10)
  if (isNaN(a) || !count.value || tooMany.value) return []
  const b = parseInt(to.value || from.value, 10)
  const lo = Math.min(a, isNaN(b) ? a : b)
  const out = []
  for (let n = lo; n < lo + count.value; n++) {
    const num = bookNum(String(n))
    const book = state.books.find(x => x.book === num)
    const why = bookBlock(book)
    if (why) out.push(`${num} — ${why}`)
  }
  return out
})
/**
 * WHICH OF THESE BOOKS IS IN SOMEBODY ELSE'S BAG, named the same way as the
 * blocked list above and for the same reason: a count sends somebody back to
 * the grid to work out which.
 *
 * This is the case bookBlock lets through — an organiser may write into a book
 * that is out, because writing down what a seller telephoned in is ordinary.
 * A whole book is ten of those at once, credited to the holder, and the seller
 * meets all ten at settlement. So it says why, and the sentence goes onto each
 * book's own record where they will see it.
 */
const onBehalfBooks = computed(() => {
  const a = parseInt(from.value, 10)
  if (isNaN(a) || !count.value || tooMany.value) return []
  const b = parseInt(to.value || from.value, 10)
  const lo = Math.min(a, isNaN(b) ? a : b)
  const out = []
  for (let n = lo; n < lo + count.value; n++) {
    const book = state.books.find(x => x.book === bookNum(String(n)))
    if (overrideReasonNeeded(book)) out.push(book)
  }
  return out
})
const onBehalf = ref('')

const ok = computed(() =>
  count.value > 0 && !tooMany.value && !blocked.value.length &&
  name.value.trim() && phoneDigits(phone.value).length >= 7 &&
  (!onBehalfBooks.value.length || !!onBehalf.value.trim()))

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
      buyerZone: zone.value.trim(),
      soldBy: soldBy.value || '',
      reason: onBehalf.value.trim()
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

      <!-- Ten tickets at once out of paper somebody else is carrying. The names
           are here because "1 book is with a seller" is a number, and which one
           is the question. -->
      <div v-if="onBehalfBooks.length" class="note warn">
        <b>{{ onBehalfBooks.length === 1 ? 'This book is' : 'These books are' }} out with a seller</b> —
        {{ onBehalfBooks.map(b => `${b.book} (${b.agentName || b.agentId})`).join(', ') }}.
        You can record this, and every ticket is credited to whoever is holding the book.
        Say why, and it goes onto the book's record where they will see it when the book is
        <span class="helpword" :title="COUNTED_IN_HELP">counted in</span>.
        <label class="why" for="sbob">Why are you recording this for them? <span class="req">*</span></label>
        <input id="sbob" v-model="onBehalf" autocomplete="off"
               placeholder="e.g. they phoned in the sale from the market">
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

      <!-- Asked, not assumed. A book still out with a seller is credited to
           that seller whatever is chosen here, and the hint says so rather than
           leaving somebody to discover it on the ticket afterwards. -->
      <div v-if="!iAmSeller" class="field">
        <label for="sbs">Who sold it? <span class="opt">— for books in the office</span></label>
        <select id="sbs" v-model="soldBy">
          <option value="">Nobody — sold at the desk</option>
          <option v-for="a in sellers" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <p class="hint">
          <template v-if="creditName">Credited to {{ creditName }}.</template>
          <template v-else>Credited to nobody, which is right for a sale nobody carried a book for.</template>
          A book still out with a seller is always credited to that seller.
        </p>
      </div>

      <div class="note">
        Tickets already sold to somebody else are left exactly as they are.
      </div>
    </template>

    <template #actions>
      <button v-if="result" class="btn primary block" @click="emit('sold')">Done</button>
      <template v-else>
        <button class="btn" @click="emit('close')">Cancel</button>
    <div v-if="blocked.length" class="note bad">
      <b>Not here to sell:</b>
      <div v-for="b in blocked" :key="b" class="small">{{ b }}</div>
      <div class="small">A book out with a seller has to be marked back first.</div>
    </div>

        <button class="btn primary" :disabled="busy || !ok" @click="sell">
          {{ busy ? 'Saving…' : `Sell · ${money(amount, cfg.currency)}` }}
        </button>
      </template>
    </template>
  </Sheet>
</template>

<style scoped>
/* The question sits inside the warning it belongs to, so the answer is given
   where the reason for asking is still on screen. */
.why { margin-top: 12px; }
.done { text-align: center; padding: 20px 0 12px; }
.done .tick {
  width: 72px; height: 72px; margin: 0 auto 14px; border-radius: 50%;
  background: var(--ok-soft); color: var(--ok);
  display: grid; place-items: center; font-size: 2.2rem; font-weight: 800;
  animation: pop-in .38s var(--ease);
}
@keyframes pop-in { from { transform: scale(.4); opacity: 0 } }
</style>
