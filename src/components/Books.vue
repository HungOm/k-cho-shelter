<script setup>
/**
 * Books. The grid is the point: six hundred squares say where the stock is at a
 * glance, in a way six hundred table rows never will.
 */
import { ref, computed } from 'vue'
import { state, isAdmin, go } from '../lib/store.js'
import { BOOK_WORDS, money, relative } from '../lib/format.js'
import BookGrid from './ui/BookGrid.vue'
import StatusPill from './ui/StatusPill.vue'
import Icon from './ui/Icon.vue'
import Empty from './ui/Empty.vue'
import History from './modals/History.vue'

const emit = defineEmits(['issue', 'transfer', 'return-books', 'restock', 'mark', 'open-book', 'sell-book', 'print-range', 'print-sample'])

/* The book whose trail is open, or null. */
const showHistory = ref(null)

/*
 * THE CHOSEN BOOK, and the bar that appears beside it.
 *
 * Clicking a tile used to open the book's sheet immediately. That is one of the
 * three things somebody wants from a tile, and it was the only one reachable:
 * "give this book out" and "print this book's tickets" lived in a card of six
 * buttons at the bottom of the screen which had no idea a book was in mind, so
 * both began by asking the organiser to type a number they had just clicked on.
 *
 * Selecting instead of opening keeps the sheet one press away and puts the
 * other two next to the square. Pressing the same tile again clears it, so
 * there is always a way back to nothing selected.
 */
const picked = ref(null)
function pick(b) {
  picked.value = picked.value?.book === b.book ? null : b
}

/*
 * WHAT THE BAR CAN HONESTLY SAY. The book row carries its custody and its
 * seller; it does not carry its ticket range, so that is worked out from the
 * tickets already loaded — and OMITTED rather than guessed at when none are
 * loaded yet. A range invented from a book number would be wrong for any raffle
 * whose books are not a uniform ten.
 */
const pickedRange = computed(() => {
  const b = picked.value
  if (!b) return ''
  const ns = (state.tickets || []).filter(t => t.book === b.book).map(t => t.number).sort()
  return ns.length ? (ns.length === 1 ? ns[0] : `${ns[0]} — ${ns[ns.length - 1]}`) : ''
})

const status = ref('')
const agent = ref('')

const shown = computed(() => state.books.filter(b =>
  (!status.value || b.status === status.value) &&
  (!agent.value || b.agentId === agent.value)))

const counts = computed(() => state.bookStats || {})
const ORDER = ['Unassigned', 'Out', 'Returned', 'Settled', 'Lost', 'Void']
</script>

<template>
  <!-- Dense: an organiser screen, read many rows at a time at a desk. The class
       is half the switch; the other half is a >= 1024px media query in
       style.css, so this is an ordinary 17px screen with 52px targets on a
       phone. --tap is never overridden. -->
  <div class="dense">
    <div class="spread" style="margin-bottom:14px">
      <h1 style="margin:0">Books</h1>
      <div class="row">
        <button class="btn primary" @click="emit('sell-book')">Sell a whole book</button>
        <button v-if="isAdmin" class="btn" @click="emit('issue')">Give out books</button>
      </div>
    </div>

    <div class="stats" style="margin-bottom:14px">
      <button v-for="k in ORDER.filter(k => counts[k])" :key="k"
              :class="['stat', 'tap', { on: status === k }]"
              @click="status = status === k ? '' : k">
        <div class="n">{{ counts[k] }}</div>
        <div class="l">{{ BOOK_WORDS[k] }}</div>
      </button>
    </div>

    <div class="card">
      <div class="spread" style="margin-bottom:14px">
        <h3 style="margin:0">Where every book is</h3>
        <select v-model="agent" style="max-width:210px" aria-label="Filter by seller">
          <option value="">Everyone</option>
          <option v-for="a in state.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </div>
      <BookGrid :books="shown" selectable :selected="picked?.book || ''" @select="pick" />

      <!--
        THE BAR ONLY EXISTS WHEN A BOOK DOES. An action bar that is always on
        screen with its buttons greyed out is furniture: it takes the space of a
        decision without ever being one. This says which book, where it is, and
        which tickets are in it — then offers the three things that are only
        answerable once a book is named.
      -->
      <div v-if="picked" class="pickbar">
        <span class="what">
          <b>{{ picked.book }}</b> selected
          <template v-if="pickedRange"> · <span class="data">{{ pickedRange }}</span></template>
          · {{ (BOOK_WORDS[picked.status] || picked.status || '').toLowerCase() }}
        </span>
        <span class="row wrap">
          <button v-if="isAdmin" class="btn sm" @click="emit('issue', picked)">Give to a seller</button>
          <button class="btn sm" @click="emit('open-book', picked)">Open the book</button>
          <button class="btn sm" @click="emit('print-range', { book: picked.book })">Print tickets</button>
        </span>
      </div>
    </div>

    <div v-if="isAdmin" class="card">
      <h3>Other things you can do</h3>
      <div class="row wrap">
        <button class="btn" @click="emit('transfer')">Pass books to someone else</button>
        <button class="btn" @click="emit('return-books')">Mark books brought back</button>
        <button class="btn" @click="emit('restock')">Put books back on the shelf</button>
        <button class="btn" @click="emit('print-range')">Print tickets</button>
        <button class="btn" title="Ten watermarked sample tickets. Not in the raffle, cannot be sold."
                @click="emit('print-sample')">Print samples</button>
        <button class="btn danger" @click="emit('mark')">Report books lost</button>
      </div>
    </div>

    <h3 class="mt">{{ shown.length }} {{ shown.length === 1 ? 'book' : 'books' }}</h3>
    <div class="card flush">
      <TransitionGroup v-if="shown.length" name="list" tag="ul" class="list">
        <li v-for="b in shown.slice(0, 200)" :key="b.book" class="rowpair">
          <button class="item" @click="emit('open-book', b)">
            <span class="grow">
              <span class="lead">{{ b.book }}</span>
              <span class="sub">
                {{ b.firstTicket }}–{{ b.lastTicket }}
                <template v-if="b.agentName"> · {{ b.agentName }}</template>
                <template v-if="b.sold"> · {{ b.sold }} sold</template>
              </span>
            </span>
            <span v-if="b.inReport" class="pill warn">reported</span>
            <span v-if="b.daysOverdue > 0" class="pill bad">{{ b.daysOverdue }} days late</span>
            <StatusPill :status="b.status" kind="book" />
            <span class="chev">›</span>
          </button>
          <!-- The same question from the book side, and the same answer: its
               own control on the row, rather than two taps down inside a sheet
               that also gives books out. -->
          <button class="rowhist" :title="`Where ${b.book} has been`"
                  :aria-label="`Where ${b.book} has been`" @click="showHistory = b.book"><Icon name="clock" :size="17" /></button>
        </li>
      </TransitionGroup>
      <Empty v-else art="📚" :title="status ? `No books ${BOOK_WORDS[status].toLowerCase()}` : 'No books'"
             :action="isAdmin && status === 'Out' ? 'Give out books' : ''" @action="emit('issue')">
        Nothing here with those filters.
      </Empty>
    </div>

    <!-- On top of the list, so closing it puts you back where you were. -->
    <History v-if="showHistory" :book="showHistory" @close="showHistory = null" />
  </div>
</template>

<style scoped>
/*
 * Sticks to the bottom of the viewport so the bar stays reachable while the
 * grid is scrolled — six hundred squares is taller than a screen, and a bar
 * that scrolls away from the tile you just pressed is a bar you have to hunt.
 */
.pickbar {
  position: sticky; bottom: 10px; z-index: 2;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 10px; margin-top: 12px; padding: 10px 14px;
  background: var(--surface); border: 1.5px solid var(--brand-line);
  border-radius: var(--r-sm); box-shadow: var(--shadow);
}
.pickbar .what { font-size: .92em; color: var(--muted); }
.pickbar .what b { color: var(--text); font-family: var(--font-data); }
.stat.tap { cursor: pointer; text-align: left; transition: border-color .14s, transform .12s; }
.stat.tap:hover { border-color: var(--brand); transform: translateY(-2px); }
.stat.tap.on { border-color: var(--brand); background: var(--brand-soft); }
</style>
