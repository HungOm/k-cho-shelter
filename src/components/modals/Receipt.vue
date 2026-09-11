<script setup>
/**
 * The handover receipt.
 *
 * Without a signed record of what went out, "I never got those books" is an
 * argument you cannot win.
 */
import { ref, onMounted, computed } from 'vue'
import { api, toast, state } from '../../lib/store.js'
import { money, date } from '../../lib/format.js'
import { waNumber } from '../../lib/search.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ agentId: String })
const emit = defineEmits(['close'])
const r = ref(null)

onMounted(async () => {
  try {
    r.value = await api('handover_receipt', { agentId: props.agentId })
    if (!r.value.books.length) { toast('This person has no books out', 'bad'); emit('close') }
  } catch (err) { toast(err.message, 'bad'); emit('close') }
})

const waLink = computed(() => {
  if (!r.value?.agent.phone) return null
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
    <div v-if="!r" class="col" style="gap:12px">
      <div v-for="i in 5" :key="i" class="skel"></div>
    </div>
    <div v-else class="paper">
      <h2 style="margin-bottom:2px">{{ r.org }}</h2>
      <p class="muted small">{{ r.event }}</p>
      <hr class="hr">
      <div class="facts">
        <div class="f"><span>Given to</span><b>{{ r.agent.name }}</b></div>
        <div v-if="r.agent.phone" class="f"><span>Phone</span><b>{{ r.agent.phone }}</b></div>
        <div class="f"><span>Books</span><b>{{ r.bookCount }}</b></div>
        <div class="f"><span>Tickets</span><b>{{ r.ticketCount }}</b></div>
        <div class="f"><span>Worth if all sold</span><b>{{ money(r.valueIfAllSold, r.currency) }}</b></div>
        <div class="f"><span>Given by</span><b>{{ r.issuedBy }}</b></div>
        <div class="f"><span>Date</span><b>{{ date(r.generatedAt) }}</b></div>
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
      <a v-if="waLink" class="btn" :href="waLink" target="_blank" rel="noopener">Send on WhatsApp</a>
      <button class="btn primary" @click="window.print()">Print</button>
    </template>
  </Sheet>
</template>

<style scoped>
.facts { display: grid; gap: 12px; }
.f { display: flex; justify-content: space-between; gap: 14px; }
.f span { color: var(--muted); }
.sign { display: flex; gap: 28px; margin-top: 40px; }
.sign > div { flex: 1; }
.sign span { display: block; border-top: 1.5px solid var(--text); margin-bottom: 6px; }
.sign small { color: var(--muted); font-size: .8rem; }
</style>
