<script setup>
/**
 * The handover receipt.
 *
 * Without a signed record of what went out, "I never got those books" is an
 * argument you cannot win.
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { api, toast, state } from '../../lib/store.js'
import { money, date } from '../../lib/format.js'
import { waNumber, isDialable } from '../../lib/search.js'
import Sheet from '../ui/Sheet.vue'
import Logo from '../ui/Logo.vue'

const props = defineProps({ agentId: String })
const emit = defineEmits(['close'])
const r = ref(null)
const nothing = ref('')

/*
 * A sheet that closes itself is the worst answer to "why is there no receipt".
 *
 * Both of these used to toast and emit('close'). The sheet opened, showed its
 * skeletons, and vanished — and a toast is gone in seconds, so what the person
 * is left with is a dialog that dismissed itself for no stated reason. That is
 * indistinguishable from a bug, and it was reported as one.
 *
 * It stays open and says which of the two happened, because they need different
 * things: nothing to print is a fact about the seller, and a failed call is a
 * reason to try again.
 */
onMounted(load)

async function load() {
  try {
    const got = await api('handover_receipt', { agentId: props.agentId })
    if (!got.books?.length) {
      nothing.value = 'There is nothing to print: this seller is not holding any books ' +
        'right now. A receipt lists the books somebody currently has — once they are all ' +
        'counted back in, there is nothing left to hand over.'
      return
    }
    r.value = got
  } catch (err) {
    toast(err.message, 'bad', err.code)
    nothing.value = err.message
  }
}

/**
 * The books listed here are whatever the seller holds *right now*, so this
 * sheet can be produced again any time — a lost paper is not a lost record.
 * But a reprint must never pass for the original handover, so it carries the
 * day the books actually went out, not the day someone hit Print.
 */
const givenOn = computed(() => {
  if (!r.value) return null
  const days = r.value.books.map(b => b.issued).filter(Boolean).sort()
  return days[0] || r.value.generatedAt
})

const isReprint = computed(() => {
  if (!r.value || !givenOn.value) return false
  return new Date(givenOn.value).toDateString()
      !== new Date(r.value.generatedAt).toDateString()
})

/**
 * `window` is not in scope inside a template, so the old inline handler threw
 * and the dialog never opened. Printing also has to hide the screen behind
 * this sheet, which is what the body class switches on.
 */
function done() { document.body.classList.remove('printing') }

function print() {
  document.body.classList.add('printing')
  window.addEventListener('afterprint', done, { once: true })
  window.print()
}

onUnmounted(done)

const waLink = computed(() => {
  // Not merely present: a number we cannot place sends this handover receipt,
  // naming books and their value, to whoever owns that number elsewhere.
  if (!isDialable(r.value?.agent.phone)) return null
  const list = r.value.books.map(b => `${b.book} (${b.firstTicket}-${b.lastTicket})`).join(', ')
  const text = `${r.value.org}\n${r.value.event}\n\nBooks given to ${r.value.agent.name}:\n${list}\n\n` +
    `${r.value.bookCount} books, ${r.value.ticketCount} tickets, worth ` +
    `${r.value.currency} ${r.value.valueIfAllSold.toFixed(2)} if they all sell.\n` +
    `Please bring back unsold tickets and the money by ${date(r.value.books[0].due)}. Thank you!`
  return `https://wa.me/${waNumber(r.value.agent.phone)}?text=${encodeURIComponent(text)}`
})
</script>

<template>
  <Sheet title="Handover receipt" wide @close="emit('close')">
    <p v-if="nothing" class="note">{{ nothing }}</p>

    <div v-else-if="!r" class="col" style="gap:12px">
      <div v-for="i in 5" :key="i" class="skel"></div>
    </div>
    <div v-else class="paper">
      <p v-if="isReprint" class="stamp">Reprint — a copy of the books still out, not a new handover</p>
      <div class="head">
        <Logo :size="54" big />
        <div class="grow">
          <h2 style="margin-bottom:2px">{{ r.org }}</h2>
          <p class="muted small" style="margin:0">{{ r.event }}</p>
        </div>
      </div>
      <hr class="hr">
      <div class="facts">
        <div class="f"><span>Given to</span><b>{{ r.agent.name }}</b></div>
        <div v-if="r.agent.phone" class="f"><span>Phone</span><b>{{ r.agent.phone }}</b></div>
        <div class="f"><span>Books</span><b>{{ r.bookCount }}</b></div>
        <div class="f"><span>Tickets</span><b>{{ r.ticketCount }}</b></div>
        <div class="f"><span>Worth if all sold</span><b>{{ money(r.valueIfAllSold, r.currency) }}</b></div>
        <div class="f"><span>Given by</span><b>{{ r.issuedBy }}</b></div>
        <div class="f"><span>Given on</span><b>{{ date(givenOn) }}</b></div>
        <div v-if="isReprint" class="f"><span>This copy printed</span><b>{{ date(r.generatedAt) }}</b></div>
      </div>
      <hr class="hr">
      <div class="tablewrap">
        <table>
          <thead><tr><th>Book</th><th>Tickets</th><th class="num">How many</th><th>Back by</th></tr></thead>
          <tbody>
            <tr v-for="b in r.books" :key="b.book">
              <td>{{ b.book }}</td>
              <td>{{ b.firstTicket }} – {{ b.lastTicket }}</td>
              <td class="num">{{ b.tickets }}</td>
              <td>{{ date(b.due) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <hr class="hr">
      <p class="small">
        I have received the books listed above, and I will bring back all unsold
        tickets and the money collected by the date shown.
      </p>
      <div class="sign">
        <div><span></span><small>Seller's signature</small></div>
        <div><span></span><small>Given by</small></div>
      </div>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
      <!-- Nothing to send and nothing to print when there is no receipt. Two
           buttons that cannot work is how a person concludes the app is broken
           rather than that the seller is holding no books. -->
      <a v-if="waLink && !nothing" class="btn" :href="waLink" target="_blank" rel="noopener">
        Send on WhatsApp
      </a>
      <button v-if="!nothing" class="btn primary" @click="print()">Print / Save as PDF</button>
    </template>
  </Sheet>
</template>

<style scoped>
.stamp {
  margin: 0 0 14px; padding: 8px 12px; border: 1.5px dashed var(--warn);
  border-radius: var(--r-sm); color: var(--warn);
  font-weight: 600; font-size: .85rem;
}
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.facts { display: grid; gap: 12px; }
.f { display: flex; justify-content: space-between; gap: 14px; }
.f span { color: var(--muted); }
.sign { display: flex; gap: 28px; margin-top: 40px; }
.sign > div { flex: 1; }
.sign span { display: block; border-top: 1.5px solid var(--text); margin-bottom: 6px; }
.sign small { color: var(--muted); font-size: .8rem; }
</style>
