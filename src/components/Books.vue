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

const emit = defineEmits(['issue', 'transfer', 'return-books', 'restock', 'mark', 'open-book', 'sell-book', 'print-range'])

/* The book whose trail is open, or null. */
const showHistory = ref(null)

const status = ref('')
const agent = ref('')

const shown = computed(() => state.books.filter(b =>
  (!status.value || b.status === status.value) &&
  (!agent.value || b.agentId === agent.value)))

const counts = computed(() => state.bookStats || {})
const ORDER = ['Unassigned', 'Out', 'Returned', 'Settled', 'Lost', 'Void']
</script>

<template>
  <div>
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
      <BookGrid :books="shown" @pick="b => emit('open-book', b)" />
    </div>

    <div v-if="isAdmin" class="card">
      <h3>Other things you can do</h3>
      <div class="row wrap">
        <button class="btn" @click="emit('transfer')">Pass books to someone else</button>
        <button class="btn" @click="emit('return-books')">Mark books brought back</button>
        <button class="btn" @click="emit('restock')">Put books back on the shelf</button>
        <button class="btn" @click="emit('print-range')">Print tickets</button>
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
.stat.tap { cursor: pointer; text-align: left; transition: border-color .14s, transform .12s; }
.stat.tap:hover { border-color: var(--brand); transform: translateY(-2px); }
.stat.tap.on { border-color: var(--brand); background: var(--brand-soft); }
</style>
