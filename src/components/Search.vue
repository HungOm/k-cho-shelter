<script setup>
/**
 * Finding things. On a wide screen the list keeps its place beside the ticket
 * you opened, so you can work down a stack without losing where you were.
 */
import { ref, computed } from 'vue'
import { state, searchResults, agentMap, whereIs, isSold, isAdmin, api, toast, go } from '../lib/store.js'
import { STATUS_WORDS } from '../lib/format.js'
import StatusPill from './ui/StatusPill.vue'
import Empty from './ui/Empty.vue'
import History from './modals/History.vue'

const emit = defineEmits(['open'])
const box = ref(null)

/*
 * The ticket whose trail is open, or null. Held here rather than in the row so
 * that closing it puts you back on the list exactly where you were.
 */
const showHistory = ref(null)

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

/**
 * ASKING FOR THE BOOK A TICKET IS IN.
 *
 * WHY THE BOOK AND NOT THE TICKET. A ticket has no custody of its own: what
 * makes a ticket somebody's to sell is books.held_by_agent, and its owner is
 * derived from its book. So this screen answers "3291 is in Book-330, in the
 * office" and offers the book — asking for one ticket out of a book would be
 * asking for a thing the raffle has no way to give.
 *
 * WHO IS OFFERED IT. Somebody who cannot issue books to themselves and whose
 * account is linked to a seller, which is exactly the person the fence stops:
 * they may only sell from books they are carrying. An organiser is not offered
 * it because they can simply take the book.
 *
 * AND ONLY FOR A BOOK THAT CAN ACTUALLY BE GIVEN. Asking for one already in
 * somebody's bag produces a refusal at the moment of granting, which is the
 * worst place to discover it.
 *
 * "In the office" and nothing wider, for now. A book brought back with nothing
 * sold from it is physically just as available, and issue_books still refuses
 * it — it has to be counted in and restocked first. Offering it here would be
 * a button whose refusal arrives in front of an organiser who has already said
 * yes. When that rule changes, this widens with it.
 */
const canAsk = computed(() => !isAdmin.value && !!state.user?.agentId)

function askable(t) {
  const w = whereIs(t)
  return canAsk.value && w?.status === 'Unassigned' ? w : null
}

const asking = ref('')

async function askFor(t) {
  const book = askable(t)
  if (!book) return
  asking.value = t.number
  try {
    const r = await api('request_approval', {
      action: 'issue_books',
      payload: { bookNumbers: [book.book] },
    })
    // Named, and pointed at where the answer will arrive. "Request sent" leaves
    // somebody refreshing the list they are already on.
    toast(`Asked for ${book.book} — ${r.summary}`, 'ok')
    go('approvals')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    asking.value = ''
  }
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
        <li v-for="t in searchResults.results" :key="t.number" class="rowpair">
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
          <!-- WHERE IT HAS BEEN, FROM THE LIST ITSELF.
               It used to be two taps down, inside the sell sheet — so the one
               question you ask about a ticket somebody hands you across a table
               ("who had this before?") cost you opening a form that can record
               a sale. Its own control, with its own label, because a row that
               does two things from one tap does the wrong one eventually. -->
          <button class="rowhist" :title="`Where ${t.number} has been`"
                  :aria-label="`Where ${t.number} has been`" @click="showHistory = t">🕘</button>
          <!-- A THIRD CONTROL, for the same reason the second one exists: a row
               that does several things from one tap does the wrong one
               eventually. A seller may only sell out of books they are
               carrying, and until now the screen showed them a ticket they
               could not have with no way to ask for it. -->
          <button v-if="askable(t)" class="rowhist ask" :disabled="asking === t.number"
                  :title="`Ask for ${askable(t).book}`"
                  :aria-label="`Ask for ${askable(t).book}`" @click="askFor(t)">🙋</button>
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

    <!-- On top of the list, not instead of it. -->
    <History v-if="showHistory" :ticket="showHistory" @close="showHistory = null" />
  </div>
</template>

<style scoped>
.searchcard { padding: 16px; }
/* The same shape as the history control beside it: a small square that does one
   named thing, rather than a word competing with the row itself. */
.ask:disabled { opacity: .5; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.count { margin: 0 4px 8px; min-height: 22px; }
.skelrow { padding: 18px; }
</style>
