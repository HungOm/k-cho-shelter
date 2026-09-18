<script setup>
/**
 * What a seller is holding, put in front of them and tappable.
 *
 * WHY IT IS A COMPONENT RATHER THAN A BLOCK ON ONE SCREEN. A seller is confined
 * to the books in their hands, so the same short list of numbers is the answer
 * on every screen they have: Sell asks them to type a number, Find asks them to
 * search for one, and in both cases the numbers that are theirs and still
 * unsold are the ones they want. Built once here so the two cannot drift into
 * two different ideas of what a seller is holding — which is the same reason
 * the money views are not two copies of the same arithmetic.
 *
 * ORGANISERS SEE NOTHING. They hold no books; the whole raffle is theirs to
 * type, and a panel showing nothing would be a permanent empty box on their
 * busiest screens. The caller does not have to know that — this renders nothing
 * when there is nothing to render.
 */
import { ref, computed, watch } from 'vue'
import { state, isSold } from '../../lib/store.js'
import Bi from './Bi.vue'
import Pager from './Pager.vue'

const props = defineProps({
  /** Show a "Report back" button in the header. Sell wants it; Find does not. */
  reportBack: { type: Boolean, default: false },
  /** Heading, because "Yours to sell" is wrong on a screen for looking things up. */
  title: { type: String, default: 'Yours to sell' },
})
const emit = defineEmits(['open', 'report-back'])

const isSeller = computed(() => state.user?.role === 'agent' || !!state.user?.agentId)
const myAgentId = computed(() => state.user?.agentId || '')

/** The books in their hands, in book order, with what is left in each. */
const myBooks = computed(() => {
  if (!isSeller.value || !myAgentId.value) return []
  return (state.books || [])
    .filter((b) => b.status === 'Out' && b.agentId === myAgentId.value)
    .sort((a, b) => String(a.book).localeCompare(String(b.book), undefined, { numeric: true }))
})

/** Which book's tickets are showing. '' is all of them. */
const pickedBook = ref('')
const page = ref(1)
const PAGE = 24

/*
 * Their unsold tickets. Available only — a reserved ticket is somebody's promise
 * and a sold one is done, and offering either here would be inviting a refusal.
 * Sorted by number, which is the order the stubs are in their hand.
 */
const sellable = computed(() => {
  if (!myBooks.value.length) return []
  const mine = new Set(myBooks.value.map((b) => b.book))
  return (state.tickets || [])
    .filter((t) => mine.has(t.book) && !isSold(t) && t.status === 'Available' &&
                   (!pickedBook.value || t.book === pickedBook.value))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
})

/* PAGED, because a seller with ten books is holding a hundred numbers and a
   hundred tiles is a wall on a phone. */
const pageTickets = computed(() =>
  sellable.value.slice((page.value - 1) * PAGE, page.value * PAGE))

/** A filter that shortens the list must not leave somebody on an empty page. */
watch(sellable, () => { if ((page.value - 1) * PAGE >= sellable.value.length) page.value = 1 })

function pickBook(b) {
  pickedBook.value = pickedBook.value === b ? '' : b
  page.value = 1
}
const leftIn = (b) => Number(b.available ?? 0)

defineExpose({ hasStock: computed(() => myBooks.value.length > 0) })
</script>

<template>
  <div v-if="isSeller && myBooks.length" class="card mine">
    <div class="spread" style="margin-bottom:10px">
      <div>
        <h3 style="margin:0"><Bi :text="title" /></h3>
        <p class="muted small" style="margin:2px 0 0">
          {{ sellable.length }} left in {{ myBooks.length }}
          {{ myBooks.length === 1 ? 'book' : 'books' }}
        </p>
      </div>
      <button v-if="reportBack" class="btn sm" @click="emit('report-back')">
        <Bi text="Report back" />
      </button>
    </div>

    <!-- One chip per book, showing its range and what is left. Tapping filters
         rather than navigating: a seller working one book at a time should not
         lose the screen to see the next. -->
    <div class="chips">
      <button v-for="b in myBooks" :key="b.book" type="button"
              :class="['bchip', { on: pickedBook === b.book }]"
              @click="pickBook(b.book)">
        <b>{{ b.book }}</b>
        <span class="rng">{{ b.firstTicket }}–{{ b.lastTicket }}</span>
        <span class="left">{{ leftIn(b) }} left</span>
      </button>
    </div>

    <div v-if="sellable.length" class="tix">
      <button v-for="t in pageTickets" :key="t.number" class="tix-b" @click="emit('open', t)">
        {{ t.number }}
      </button>
    </div>
    <p v-else class="muted small" style="margin:10px 0 0">
      <template v-if="pickedBook">Every ticket in {{ pickedBook }} is spoken for.</template>
      <template v-else>Every ticket in your books is spoken for — time to report back.</template>
    </p>

    <Pager v-model:page="page" :total="sellable.length" :size="24" noun="tickets" />
  </div>
</template>

<style scoped>
.mine { border-left: 4px solid var(--brand); }

/* One chip per book. Wrapped rather than a sideways scroller: a seller with nine
   books should see all nine, not discover the ninth by swiping. */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.bchip {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  border: 1px solid var(--border); background: var(--surface); color: inherit;
  border-radius: 12px; padding: 9px 13px; cursor: pointer; line-height: 1.2;
  transition: border-color .12s var(--ease), background .12s var(--ease);
}
.bchip:hover { border-color: var(--brand); }
/* The chosen one is FILLED, not merely outlined: on a phone in daylight an
   outline is not a state anybody can see. */
.bchip.on { background: var(--brand); color: var(--brand-ink); border-color: var(--brand); }
.bchip .rng { font-size: .78rem; opacity: .75; font-variant-numeric: tabular-nums; }
.bchip .left { font-size: .78rem; font-weight: 700; opacity: .9; }

/* The numbers themselves. A wrapping grid of equal tiles, tabular figures so
   they line up in columns the eye can run down — they are read as a sequence,
   the way stubs sit in a hand. */
.tix {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px; margin-top: 12px;
}
.tix-b {
  border: 1px solid var(--border); background: var(--surface-2); color: inherit;
  border-radius: 9px; padding: 11px 6px; cursor: pointer;
  font-weight: 700; font-variant-numeric: tabular-nums; font-size: .95rem;
  /* Comfortably past the 44px touch target: this is the control a seller taps
     most, standing up, one-handed, often in the dark. */
  min-height: 46px;
  transition: transform .1s var(--ease), border-color .12s var(--ease);
}
.tix-b:hover { border-color: var(--brand); color: var(--brand); }
.tix-b:active { transform: scale(.97); }
</style>
