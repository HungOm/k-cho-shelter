<script setup>
/**
 * The people who carry books.
 *
 * Chasing an overdue book is the most tedious job in a raffle and the one
 * nobody does, so it is the first thing on this screen and one tap sends the
 * reminder on WhatsApp with the words already written.
 */
import { computed } from 'vue'
import { state, isAdmin } from '../lib/store.js'
import { waNumber } from '../lib/search.js'
import { money, date } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const emit = defineEmits(['add-agent', 'open-agent'])

const currency = computed(() => state.cfg?.currency || '')

function reminder(o) {
  return `Hello ${o.agentName}, a reminder about raffle book ${o.book} for ` +
    `${state.cfg?.eventName || 'our fundraiser'}. It was due back on ${date(o.due)}, ` +
    `${o.daysOverdue} days ago. Could you bring the unsold tickets and the money? Thank you!`
}
function waLink(o) {
  return `https://wa.me/${waNumber(o.agentPhone)}?text=${encodeURIComponent(reminder(o))}`
}
</script>

<template>
  <div>
    <div class="spread" style="margin-bottom:6px">
      <h1 style="margin:0">Sellers</h1>
      <button v-if="isAdmin" class="btn primary" @click="emit('add-agent')">Add someone</button>
    </div>
    <p class="muted">People who carry books. They do not need a Google account.</p>

    <div v-if="state.overdue.length" class="card late">
      <div class="spread" style="margin-bottom:8px">
        <h3 style="margin:0;color:var(--warn)">⏰ Books not brought back</h3>
        <span class="pill warn">{{ state.overdue.length }}</span>
      </div>
      <div v-for="o in state.overdue.slice(0, 25)" :key="o.book" class="chase">
        <div class="grow">
          <b>{{ o.agentName || o.agentId }}</b>
          <div class="tiny muted">
            {{ o.book }} · {{ o.daysOverdue }} days late · {{ money(o.expected, currency) }} expected
          </div>
        </div>
        <a v-if="o.agentPhone" class="btn sm" :href="waLink(o)" target="_blank" rel="noopener">
          Remind
        </a>
      </div>
    </div>

    <div class="card flush">
      <TransitionGroup v-if="state.agents.length" name="list" tag="ul" class="list">
        <li v-for="a in state.agents" :key="a.id">
          <button class="item" @click="emit('open-agent', a)">
            <span class="avatar">{{ (a.name || '?').charAt(0).toUpperCase() }}</span>
            <span class="grow">
              <span class="lead">{{ a.name }}</span>
              <span class="sub">
                {{ a.zone || a.id }}<template v-if="a.phone"> · {{ a.phone }}</template>
              </span>
            </span>
            <span :class="['pill', a.booksOut ? 'info' : '']">
              {{ a.booksOut }} {{ a.booksOut === 1 ? 'book' : 'books' }}
            </span>
            <span class="chev">›</span>
          </button>
        </li>
      </TransitionGroup>
      <Empty v-else art="👥" title="Nobody added yet"
             :action="isAdmin ? 'Add your first seller' : ''" @action="emit('add-agent')">
        These are the people who carry books and sell tickets.
        All you need is a name and a phone number.
      </Empty>
    </div>
  </div>
</template>

<style scoped>
.late { border-left: 4px solid var(--warn); }
.chase { display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--border); }
.chase:last-child { border-bottom: 0; }
.avatar {
  flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand);
  display: grid; place-items: center; font-weight: 800; font-size: 1.1rem;
}
</style>
