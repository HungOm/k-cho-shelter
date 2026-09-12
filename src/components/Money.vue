<script setup>
/**
 * Money. One number matters most — what each seller still owes — so it is the
 * last column and the only one in colour.
 */
import { ref, onMounted, computed } from 'vue'
import { state, api, toast } from '../lib/store.js'
import { money, moneyShort } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const rows = ref(null)
const currency = computed(() => state.cfg?.currency || '')
const o = computed(() => state.totals)

onMounted(load)
async function load() {
  try {
    const r = await api('report_outstanding', {})
    rows.value = r.agents
  } catch (err) {
    toast(err.message, 'bad', err.code)
    rows.value = []
  }
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
            <tr v-for="a in rows" :key="a.agentId">
              <td>
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
          </tbody>
        </table>
      </div>

      <Empty v-else art="💰" title="Nothing given out yet">
        Once books are with sellers, what they owe shows up here.
      </Empty>
    </div>
  </div>
</template>
