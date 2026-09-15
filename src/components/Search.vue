<script setup>
/**
 * Finding things. On a wide screen the list keeps its place beside the ticket
 * you opened, so you can work down a stack without losing where you were.
 */
import { ref, computed } from 'vue'
import { state, searchResults, agentMap, whereIs, isSold } from '../lib/store.js'
import { STATUS_WORDS } from '../lib/format.js'
import StatusPill from './ui/StatusPill.vue'
import Empty from './ui/Empty.vue'

const emit = defineEmits(['open'])
const box = ref(null)

const examples = computed(() => {
  const c = state.cfg
  if (!c) return []
  const tail = String(c.ticketStart + 720).slice(-3)
  return [
    { text: tail, why: 'the last few numbers on the ticket' },
    { text: '012', why: 'part of a phone number' },
    { text: c.bookPrefix + '1', why: 'a whole book' }
  ]
})

function use(text) {
  state.query = text
  box.value?.focus()
}

function clear() {
  state.query = ''
  state.filterStatus = ''
  state.filterAgent = ''
  state.filterWhere = ''
}

const hasFilters = computed(() =>
  !!(state.query || state.filterStatus || state.filterAgent || state.filterWhere))

function subtitle(t) {
  const bits = [t.book]
  // The marker stays visible in a results list — "JOHN (seller)" tells you at a
  // glance that the contact is the seller, which is the thing you would
  // otherwise have to open the ticket to discover.
  if (t.name) bits.push(t.name)
  else if (isSold(t)) bits.push('no name written down')
  const a = agentMap.value[t.agent]
  if (a) bits.push(a.name)
  if (t.phone) bits.push(t.phone)
  return bits.join(' · ')
}

/**
 * Where the ticket physically is — which is not the same question as whether it
 * has been sold. An unsold ticket in a book that is out with somebody cannot be
 * sold from the office, and may already have been sold on paper.
 */
function place(t) {
  const w = whereIs(t)
  if (!w) return null
  if (w.out) return { text: `with ${w.agentName || w.agentId}`, tone: 'info' }
  if (w.status === 'Unassigned') return { text: 'in the office', tone: '' }
  if (w.status === 'Returned') return { text: 'brought back', tone: 'warn' }
  if (w.status === 'Lost') return { text: 'book lost', tone: 'bad' }
  return null
}
</script>

<template>
  <div>
    <h1>Find a ticket</h1>

    <div class="card searchcard">
      <input ref="box" v-model="state.query" class="xl" type="search"
             placeholder="Number, name or phone"
             autocomplete="off" autocapitalize="off" spellcheck="false"
             aria-label="Search tickets">

      <div class="row wrap" style="margin-top:12px">
        <select v-model="state.filterStatus" class="grow" aria-label="Filter by status">
          <option value="">Any ticket</option>
          <option v-for="(word, key) in STATUS_WORDS" :key="key" :value="key">{{ word }}</option>
        </select>
        <select v-model="state.filterAgent" class="grow" aria-label="Filter by seller">
          <option value="">Any seller</option>
          <option v-for="a in state.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <select v-model="state.filterWhere" class="grow" aria-label="Filter by where it is">
          <option value="">Anywhere</option>
          <option value="office">In the office</option>
          <option value="out">Out with a seller</option>
        </select>
        <button v-if="hasFilters" class="btn sm" @click="clear">Clear</button>
      </div>

      <div v-if="!state.query" class="chips">
        <span class="tiny muted" style="align-self:center">Try:</span>
        <button v-for="e in examples" :key="e.text" class="chip" :title="e.why" @click="use(e.text)">
          {{ e.text }}
        </button>
      </div>
    </div>

    <div class="spread count">
      <span class="small muted">
        <template v-if="state.loadProgress">
          Loading {{ state.loadProgress.done.toLocaleString() }} of
          {{ state.loadProgress.total.toLocaleString() }}…
        </template>
        <template v-else-if="searchResults.total">
          {{ searchResults.total.toLocaleString() }}
          {{ searchResults.total === 1 ? 'ticket' : 'tickets' }}
          <template v-if="searchResults.total > searchResults.results.length">
            (showing first {{ searchResults.results.length }})
          </template>
        </template>
      </span>
    </div>

    <div class="card flush">
      <!-- loading -->
      <ul v-if="state.loadProgress" class="list">
        <li v-for="i in 6" :key="i" class="skelrow">
          <div class="skel" style="width:35%"></div>
          <div class="skel" style="width:62%;height:11px;margin-top:8px"></div>
        </li>
      </ul>

      <!-- results -->
      <TransitionGroup v-else-if="searchResults.results.length" name="list" tag="ul" class="list">
        <li v-for="t in searchResults.results" :key="t.number">
          <button class="item" @click="emit('open', t)">
            <span class="grow">
              <span class="lead">{{ t.number }}</span>
              <span class="sub">{{ subtitle(t) }}</span>
            </span>
            <span v-if="place(t) && !isSold(t)" :class="['pill', place(t).tone]">
              {{ place(t).text }}
            </span>
            <StatusPill :status="t.status" />
            <span class="chev">›</span>
          </button>
        </li>
      </TransitionGroup>

      <!-- nothing -->
      <Empty v-else-if="!state.tickets.length" art="🎟️" title="No tickets yet">
        The tickets have not been made. The organiser needs to set the numbers
        and run setup.
      </Empty>
      <Empty v-else art="🔍" :title="state.query ? `Nothing matches “${state.query}”` : 'Nothing here'"
             :action="hasFilters ? 'Clear and start again' : ''" @action="clear">
        Try the last few numbers on the ticket, part of a name,
        or a phone number written any way you like.
      </Empty>
    </div>
  </div>
</template>

<style scoped>
.searchcard { padding: 16px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.count { margin: 0 4px 8px; min-height: 22px; }
.skelrow { padding: 18px; }
</style>
