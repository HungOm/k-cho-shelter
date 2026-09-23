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
import { waNumber, isDialable } from '../lib/search.js'
import { money, date } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const emit = defineEmits(['add-agent', 'open-agent', 'record-check-in'])

/*
 * WHO HAS NOT REPORTED, which is a different question from which book is late.
 *
 * A seller can honestly report — sold six, here is the money, keeping the book
 * for the rest — and still be holding it afterwards, so the overdue list above
 * cannot answer this and never could. The server works it out from the round,
 * the check-in date and the rows saying who has answered; nothing here decides
 * it, because two screens deciding the same thing is two screens disagreeing.
 *
 * It clears when a report is RECORDED, not when anybody ticks it away. That is
 * why the button beside each name writes something down rather than hiding a
 * row: the mark and the record are the same act.
 */
const notReported = computed(() =>
  state.agents.filter(a => a.reportState === 'late' || a.reportState === 'due')
    .sort((x, y) => (y.daysLate || 0) - (x.daysLate || 0)))

const lateReporting = computed(() =>
  notReported.value.filter(a => a.reportState === 'late').length)

/** The pill beside a name, in the words somebody would use out loud. */
function standing(a) {
  if (a.reportState === 'reported') return { tone: 'ok', text: 'Reported' }
  if (a.reportState === 'late') {
    return { tone: 'bad', text: a.daysLate > 0 ? `${a.daysLate} days late` : 'Not reported' }
  }
  if (a.reportState === 'due') return { tone: 'warn', text: 'To report' }
  return null
}

function chaseLine(a) {
  const missed = a.missedRounds > 1 ? ` · missed ${a.missedRounds} check-ins` : ''
  if (a.reportState === 'late') {
    return `${a.daysLate > 0 ? a.daysLate + ' days past the check-in' : 'Has not reported'}` +
      ` · ${a.booksOut} ${a.booksOut === 1 ? 'book' : 'books'} out${missed}`
  }
  return `${a.booksOut} ${a.booksOut === 1 ? 'book' : 'books'} out${missed}`
}

function reportReminder(a) {
  // The check-in DATE, not the end of the grace: the grace is how long before
  // somebody is chased, and telling a seller about it would move the date they
  // think they were given.
  const by = state.checkIn.date || ''
  return `Hello ${a.name}, a reminder about ${state.cfg?.eventName || 'our fundraiser'}. ` +
    `Everybody reports by ${by ? date(by) : 'the check-in date'} — how many tickets have ` +
    `sold, what is left, and anything collected. You do not need to bring the books back ` +
    `yet. Thank you!`
}

/*
 * No link for a number we cannot place.
 *
 * Four of this raffle's sellers have numbers whose leading zero was lost, so
 * wa.me read them as country code 1 and every reminder went to North America.
 * A link built from a number like that is indistinguishable from one that
 * works, which is the whole problem — the organiser presses it, WhatsApp opens,
 * and a stranger receives a reminder about somebody else's raffle books.
 */
function reportWaLink(a) {
  if (!isDialable(a.phone)) return ''
  return `https://wa.me/${waNumber(a.phone)}?text=${encodeURIComponent(reportReminder(a))}`
}

const currency = computed(() => state.cfg?.currency || '')

function reminder(o) {
  return `Hello ${o.agentName}, a reminder about raffle book ${o.book} for ` +
    `${state.cfg?.eventName || 'our fundraiser'}. It was due back on ${date(o.due)}, ` +
    `${o.daysOverdue} days ago. Could you bring the unsold tickets and the money? Thank you!`
}
function waLink(o) {
  if (!isDialable(o.agentPhone)) return ''
  return `https://wa.me/${waNumber(o.agentPhone)}?text=${encodeURIComponent(reminder(o))}`
}
</script>

<template>
  <!-- Dense: an organiser screen, read many rows at a time at a desk. The class
       is half the switch; the other half is a >= 1024px media query in
       style.css, so this is an ordinary 17px screen with 52px targets on a
       phone. --tap is never overridden. -->
  <div class="dense">
    <div class="spread" style="margin-bottom:6px">
      <h1>Sellers</h1>
      <button v-if="isAdmin" class="btn primary" @click="emit('add-agent')">Add someone</button>
    </div>
    <p class="muted">
      People who carry books and sell tickets. Most never open the app —
      a name and a phone number is all that is needed.
    </p>

    <div v-if="notReported.length" class="card report">
      <div class="spread" style="margin-bottom:8px">
        <h3>Still to report</h3>
        <span :class="['pill', lateReporting ? 'bad' : 'warn']">{{ notReported.length }}</span>
      </div>
      <p class="tiny muted" style="margin:0 0 10px">
        Everybody reports on the same day, whether or not the books come back.
        Recording a report clears the mark until the next round.
      </p>
      <div v-for="a in notReported.slice(0, 25)" :key="a.id" class="chase">
        <div class="grow">
          <b>{{ a.name || a.id }}</b>
          <div class="tiny muted">{{ chaseLine(a) }}</div>
        </div>
        <a v-if="reportWaLink(a)" class="btn sm" :href="reportWaLink(a)" target="_blank" rel="noopener">
          Remind
        </a>
        <button v-if="isAdmin" class="btn sm primary" @click="emit('record-check-in', a)">
          Reported
        </button>
      </div>
    </div>

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
        <a v-if="waLink(o)" class="btn sm" :href="waLink(o)" target="_blank" rel="noopener">
          Remind
        </a>
        <!-- Said, not hidden. A missing button is a puzzle; this is the one
             fact that explains it and the one thing somebody can act on. -->
        <span v-else-if="o.agentPhone" class="tiny">{{ o.agentPhone }} cannot be dialled</span>
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
            <span v-if="standing(a)" :class="['pill', standing(a).tone]">
              {{ standing(a).text }}
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
.report { border-left: 4px solid var(--brand); }
.chase { display: flex; align-items: center; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid var(--border); }
.chase:last-child { border-bottom: 0; }
.avatar {
  flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%;
  background: var(--brand-soft); color: var(--brand);
  display: grid; place-items: center; font-weight: 800; font-size: 1.1rem;
}
</style>
