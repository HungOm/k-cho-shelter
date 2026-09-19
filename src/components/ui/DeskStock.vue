<script setup>
/**
 * What the DESK can sell right now, put in front of an organiser.
 *
 * YourStock answers this for a seller — the books in their hands — and renders
 * nothing for an organiser, deliberately, because an organiser holds no books.
 * But "holds no books" is not "has nothing to sell": the office holds the whole
 * raffle, and the Sell screen opened for them as a blank number box. The only
 * way to find a free number was to type one and be told no, which is exactly the
 * gap FreeRuns was built to close for books and nobody had closed for tickets.
 *
 * WHAT IT OFFERS IS DERIVED FROM THE REFUSAL, NOT FROM A SECOND RULE. sellBlock
 * is the function this screen already calls to decide whether a sale may go
 * ahead, so a number appears here exactly when pressing it would work. Writing a
 * separate "what looks free" rule is how the two come to disagree, and a panel
 * that recommends a ticket the next screen refuses is worse than no panel — it
 * spends somebody's trust and then takes it back. This repository has produced
 * that shape of bug repeatedly; there is only one half of the fact here.
 *
 * TICKETS OUT WITH SELLERS ARE COUNTED BUT NOT OFFERED. They are unsold, so
 * leaving them out of the totals would understate the raffle — but they are in
 * somebody's bag, and selling one at the desk hands the buyer a number with no
 * ticket behind it. They are named as theirs rather than folded into a single
 * "available" figure that means two different things.
 */
import { ref, computed, watch } from 'vue'
import { state, isSold, sellBlock } from '../../lib/store.js'
import { freeRuns, runLabel } from '../../lib/books.js'
import Bi from './Bi.vue'
import Pager from './Pager.vue'

const emit = defineEmits(['open'])

/*
 * The mirror of YourStock's own test. A person carrying books gets that panel;
 * anybody else who may write gets this one. Stated as its own computed rather
 * than "not a seller" so that the two panels cannot both decide they are the
 * wrong one and leave the screen blank.
 */
const isDesk = computed(() => {
  const u = state.user || {}
  return u.role !== 'agent' && !u.agentId
})

/** Unsold, and in a book the desk can actually hand over. */
const sellable = computed(() => {
  if (!isDesk.value) return []
  return (state.tickets || [])
    .filter((t) => t.status === 'Available' && !isSold(t) && !sellBlock(t))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
})

/** Unsold, but in somebody's bag. Counted so the total is honest, never offered. */
const withSellers = computed(() => {
  if (!isDesk.value) return 0
  return (state.tickets || [])
    .filter((t) => t.status === 'Available' && !isSold(t) && sellBlock(t)).length
})

/** How many books those sellable numbers are spread across. */
const bookCount = computed(() => new Set(sellable.value.map((t) => t.book)).size)

/*
 * Books nobody is holding, as runs — the second half of "what is available".
 * Informational here: giving a book out is the Books screen's job, and a control
 * that starts that flow from a selling screen is a different feature. The runs
 * are what an organiser is actually asked on the phone ("what have we got left?")
 * and the answer was previously only obtainable by opening another screen.
 */
const free = computed(() => (isDesk.value ? freeRuns((b) => b.status === 'Unassigned') : { runs: [], total: 0 }))
const freeShown = computed(() => free.value.runs.slice(0, 4))
const freeRest = computed(() => Math.max(0, free.value.runs.length - 4))

const PAGE = 24
const page = ref(1)
const pageTickets = computed(() => sellable.value.slice((page.value - 1) * PAGE, page.value * PAGE))
/** A sale shortens the list; nobody should be left looking at an empty page. */
watch(sellable, () => { if ((page.value - 1) * PAGE >= sellable.value.length) page.value = 1 })
</script>

<template>
  <div v-if="isDesk && (sellable.length || free.total || withSellers)" class="card desk">
    <div class="spread" style="margin-bottom:10px">
      <div>
        <h3 style="margin:0"><Bi text="To sell in the office" /></h3>
        <p class="muted small" style="margin:2px 0 0">
          <template v-if="sellable.length">
            {{ sellable.length.toLocaleString() }} to sell, in {{ bookCount }}
            {{ bookCount === 1 ? 'book' : 'books' }}
          </template>
          <template v-else>Nothing in the office is free to sell</template>
        </p>
      </div>
    </div>

    <div v-if="sellable.length" class="tix">
      <button v-for="t in pageTickets" :key="t.number" class="tix-b" @click="emit('open', t)">
        {{ t.number }}
      </button>
    </div>

    <Pager v-if="sellable.length" v-model:page="page" :total="sellable.length" :size="24" noun="tickets" />

    <p v-if="free.total" class="muted small runs">
      <b>{{ free.total.toLocaleString() }}</b>
      {{ free.total === 1 ? 'book has' : 'books have' }} not gone out yet —
      <span v-for="(r, i) in freeShown" :key="i" class="run">{{ runLabel(r) }}</span>
      <template v-if="freeRest">and {{ freeRest }} more {{ freeRest === 1 ? 'run' : 'runs' }}</template>
    </p>

    <p v-if="withSellers" class="muted small">
      Another {{ withSellers.toLocaleString() }}
      {{ withSellers === 1 ? 'ticket is' : 'tickets are' }} out with sellers. Those are
      theirs to sell — write them down when they report back.
    </p>
  </div>
</template>

<style scoped>
/* Squared off against YourStock's brand edge: the same furniture, a different
   person's stock, so they should read as siblings rather than as one panel. */
.desk { border-left: 4px solid var(--muted, #888); }
.tix { display: flex; flex-wrap: wrap; gap: 6px; }
.tix-b {
  font-variant-numeric: tabular-nums;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tix-b:hover { border-color: var(--brand); }
.runs { margin: 10px 0 0; }
.run { font-variant-numeric: tabular-nums; }
.run:not(:last-of-type)::after { content: ', '; }
</style>
