<script setup>
/**
 * Money. One number matters most — what each seller still owes — so it is the
 * last column and the only one in colour.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast, agentMap } from '../lib/store.js'
import { money, moneyShort, date } from '../lib/format.js'
import { waNumber } from '../lib/search.js'
import Empty from './ui/Empty.vue'

const rows = ref(null)
const currency = computed(() => state.cfg?.currency || '')
const o = computed(() => state.totals)

onMounted(load)
async function load() {
  try {
    const r = await api('report_outstanding', {})
    rows.value = (r.agents || []).map(normalise)
  } catch (err) {
    toast(err.message, 'bad', err.code)
    rows.value = []
  }
}

/*
 * The two backends describe this report differently, so read both.
 *
 * Apps Script sends name / booksOut / ticketsSold / overdueBooks; the Supabase
 * port sends agentName / books (an array) / sold, and no overdue count. The
 * client reads the Apps Script names, so on the deployed default the seller,
 * books and sold columns were BLANK — a table of amounts owed by nobody, which
 * is precisely the question it exists to answer.
 *
 * Temporary. The port should return the shape it promised and then this goes:
 * two spellings of one fact in the client is the thing that has gone wrong six
 * times in this repository, and carrying it is a stopgap, not a design.
 */
function normalise(a) {
  const books = Array.isArray(a.books) ? a.books.length : a.booksOut
  return {
    ...a,
    name: a.name || a.agentName || agentMap.value[a.agentId]?.name || a.agentId,
    booksOut: books ?? 0,
    ticketsSold: a.ticketsSold ?? a.sold ?? 0,
  }
}

/** Which tickets make up the debt — who bought them, and what came in. */
const open = ref('')
function toggle(id) { open.value = open.value === id ? '' : id }

function ticketsFor(agentId) {
  return state.tickets
    .filter(t => t.agent === agentId && ['Sold', 'Donated'].includes(t.status))
    .sort((a, b) => String(a.number).localeCompare(String(b.number)))
}

/** Paid is the ticket's own record, not a guess from the seller's total. */
const isPaid = t => /paid|received|in/i.test(String(t.payment || ''))

function phoneOf(agentId) {
  return agentMap.value[agentId]?.phone || ''
}
function waLink(a) {
  const ph = phoneOf(a.agentId)
  if (!ph) return ''
  const msg = `Hello ${a.name}, the raffle shows ${money(a.outstanding, currency.value)} ` +
    `still to come in from ${a.ticketsSold} ticket${a.ticketsSold === 1 ? '' : 's'}. ` +
    `Could you let us know when you can hand it in? Thank you.`
  return `https://wa.me/${waNumber(ph)}?text=${encodeURIComponent(msg)}`
}
</script>

<template>
  <div>
    <h1>Money</h1>
    <p class="muted">The system records money — it never touches it. Cash is handled in person.</p>

    <div v-if="o" class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="n">{{ moneyShort(o.expected, currency) }}</div><div class="l">Should have</div></div>
      <div class="stat"><div class="n">{{ moneyShort(o.collected, currency) }}</div><div class="l">Handed in</div></div>
      <div class="stat" :class="{ accent: o.outstanding > 0 }">
        <div class="n" :style="o.outstanding > 0 ? 'color:var(--warn)' : ''">
          {{ moneyShort(o.outstanding, currency) }}
        </div>
        <div class="l">Still owed</div>
      </div>
      <div class="stat"><div class="n">{{ (o.ticketsSold || 0).toLocaleString() }}</div><div class="l">Tickets sold</div></div>
    </div>

    <div class="card">
      <h3>What each seller owes</h3>
      <p class="muted small">Tickets written down as sold, minus the cash handed in.</p>

      <div v-if="rows === null" class="col" style="gap:12px;margin-top:14px">
        <div v-for="i in 4" :key="i" class="skel"></div>
      </div>

      <div v-else-if="rows.length" class="tablewrap" style="margin-top:8px">
        <table>
          <thead>
            <tr>
              <th>Seller</th><th class="num">Books</th><th class="num">Sold</th>
              <th class="num">Should have</th><th class="num">Handed in</th><th class="num">Owes</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="a in rows" :key="a.agentId">
              <tr :class="{ openrow: open === a.agentId }" @click="toggle(a.agentId)">
                <td>
                  <span class="chev">{{ open === a.agentId ? '▾' : '▸' }}</span>
                  {{ a.name }}
                  <span v-if="a.overdueBooks" class="pill bad">{{ a.overdueBooks }} late</span>
                </td>
                <td class="num">{{ a.booksOut }}</td>
                <td class="num">{{ a.ticketsSold }}</td>
                <td class="num">{{ money(a.expected) }}</td>
                <td class="num">{{ money(a.collected) }}</td>
                <td class="num">
                  <b :style="a.outstanding > 0 ? 'color:var(--warn)' : 'color:var(--muted)'">
                    {{ money(a.outstanding) }}
                  </b>
                </td>
              </tr>

              <!-- WHICH tickets. The total answers "how much"; chasing it needs
                   "which ones, sold to whom, and what has already come in" —
                   otherwise the conversation with the seller starts by both
                   sides trying to reconstruct the same list from memory. -->
              <tr v-if="open === a.agentId" class="detail">
                <td colspan="6">
                  <div class="row wrap gap" style="margin-bottom:10px">
                    <a v-if="waLink(a)" class="btn sm" :href="waLink(a)"
                       target="_blank" rel="noopener">Message on WhatsApp</a>
                    <a v-if="phoneOf(a.agentId)" class="btn sm ghost"
                       :href="`tel:${phoneOf(a.agentId)}`">{{ phoneOf(a.agentId) }}</a>
                    <span v-else class="tiny muted">No phone number on file for this seller.</span>
                  </div>

                  <div v-if="!ticketsFor(a.agentId).length" class="tiny muted">
                    No tickets are written down against this seller yet — the money
                    owed comes from a book counted in, not from individual sales.
                  </div>
                  <table v-else class="inner">
                    <thead>
                      <tr><th>Ticket</th><th>Book</th><th>Bought by</th>
                          <th class="num">Amount</th><th>Money</th><th>When</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="t in ticketsFor(a.agentId)" :key="t.number">
                        <td><b>{{ t.number }}</b></td>
                        <td>{{ t.book }}</td>
                        <td>{{ t.name || '—' }}<template v-if="t.phone"> · {{ t.phone }}</template></td>
                        <td class="num">{{ money(t.amount) }}</td>
                        <td>
                          <span :class="['pill', isPaid(t) ? 'ok' : 'bad']">
                            {{ isPaid(t) ? 'in' : 'not in' }}
                          </span>
                        </td>
                        <td class="tiny muted">{{ t.saleDate ? date(t.saleDate) : '' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <Empty v-else art="💰" title="Nothing given out yet">
        Once books are with sellers, what they owe shows up here.
      </Empty>
    </div>
  </div>
</template>
