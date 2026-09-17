<script setup>
/**
 * The whole raffle as coloured squares.
 *
 * Six hundred rows in a table tell you nothing. Six hundred squares tell you at
 * a glance how much stock is still in the office and who is sitting on it.
 *
 * TWO THINGS ABOUT A BOOK, AND THE COLOUR ONLY EVER CARRIED ONE. Where the
 * paper is — office, seller, brought back, finished — is what the colour says,
 * and that is right: it is the question the grid exists for. What it could not
 * say is whether anything in the book has SOLD, and those are independent. A
 * book can come back with every ticket sold or with none, and until now both
 * drew the same brown square.
 *
 * That was reported the way such things always are: somebody sold a whole book,
 * looked at this grid, and saw nothing change. Nothing was broken — the sale was
 * recorded, the ticket list showed it, the book's own panel showed 10 of 10 —
 * and the one screen that shows the whole raffle had no way to draw it. A
 * screen that cannot show a thing that happened is indistinguishable from a
 * screen that did not hear about it.
 *
 * So the colour stays custody and the SALES are a mark on top: a ring when
 * every ticket in the book has gone, a corner when some have. A second colour
 * scale would have meant choosing which of the two questions the grid answers,
 * and losing the other.
 */
import { computed } from 'vue'
import { bookShort, BOOK_WORDS } from '../../lib/format.js'
import Bi from './Bi.vue'

const props = defineProps({
  books: { type: Array, default: () => [] },
  limit: Number
})
const emit = defineEmits(['pick', 'more'])

const shown = computed(() => props.limit ? props.books.slice(0, props.limit) : props.books)
const remaining = computed(() => props.limit ? Math.max(0, props.books.length - props.limit) : 0)

function label(b) {
  const bits = [b.book, BOOK_WORDS[b.status] || b.status]
  if (b.agentName) bits.push(b.agentName)
  if (b.sold) bits.push(b.sold + ' of ' + (b.sold + (b.available ?? 0)) + ' sold')
  if (b.daysOverdue > 0) bits.push(b.daysOverdue + ' days late')
  return bits.join(' · ')
}

/**
 * How much of this book has gone: 'all', 'some', or nothing.
 *
 * `available` is what is left to sell in it, which is the only honest way to
 * ask "is it finished" — a book at the end of a part-released run holds fewer
 * than TICKETS_PER_BOOK, and counting against the setting would draw it as sold
 * out while four tickets were still in somebody's hand.
 *
 * A book with nothing sold and nothing available has not been released yet; it
 * gets no mark, because "sold out" and "not printed" must not look the same.
 */
function sales(b) {
  const sold = Number(b.sold ?? 0)
  if (!sold) return ''
  return Number(b.available ?? 0) > 0 ? 'some' : 'all'
}
</script>

<template>
  <div>
    <div class="grid">
      <button v-for="b in shown" :key="b.book"
              :class="['bk', 's-' + b.status, sales(b) && 'sold-' + sales(b),
                       { late: b.daysOverdue > 0 }]"
              :title="label(b)" @click="emit('pick', b)">
        {{ bookShort(b.book) }}
      </button>
      <button v-if="remaining" class="bk more" @click="emit('more')" :title="remaining + ' more'">
        +{{ remaining }}
      </button>
    </div>
    <div class="keys">
      <span><i class="s-Unassigned"></i><Bi text="In the office" /></span>
      <span><i class="s-Out"></i><Bi text="With a seller" /></span>
      <span><i class="s-Returned"></i><Bi text="Brought back" /></span>
      <span><i class="s-Settled"></i><Bi text="Finished" /></span>
      <span><i class="s-Lost"></i><Bi text="Lost" /></span>
      <span><i class="late-key"></i><Bi text="Late" /></span>
      <span><i class="s-Returned sold-all"></i><Bi text="Every ticket sold" /></span>
      <span><i class="s-Returned sold-some"></i><Bi text="Some sold" /></span>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 5px; }
.bk {
  aspect-ratio: 1; border: 0; border-radius: 7px; padding: 0;
  display: grid; place-items: center; cursor: pointer;
  font-size: .68rem; font-weight: 700; color: #fff;
  transition: transform .12s var(--ease), box-shadow .12s;
}
.bk:hover { transform: scale(1.22); z-index: 2; box-shadow: var(--shadow); }
.bk:active { transform: scale(1.05); }

.s-Unassigned { background: var(--surface-2); color: var(--muted); box-shadow: inset 0 0 0 1px var(--border); }
.s-Out        { background: #2563eb; }
.s-Returned   { background: #c2700a; }
.s-Settled    { background: #15803d; }
.s-Lost       { background: #c62828; }
.s-Void       { background: #4b5563; }
.more         { background: var(--brand-soft); color: var(--brand); }
.late { outline: 2.5px solid var(--bad); outline-offset: -2.5px; }

/*
 * THE SALES, DRAWN ON TOP OF THE CUSTODY COLOUR.
 *
 * A white ring for a book with nothing left in it, a corner for one part sold.
 * White rather than a colour of its own: every custody colour in this grid is
 * already a hue, and a seventh would be read as a seventh place a book can be.
 * A ring is not a place, which is the point.
 *
 * Inset so it cannot change the square's size — these sit in a dense grid and a
 * border would shift every tile around it by a pixel, which reads as the grid
 * jittering when a sale lands.
 */
.bk.sold-all::after {
  content: ''; position: absolute; inset: 4px;
  border: 2px solid rgba(255, 255, 255, .9); border-radius: 4px;
}
.bk.sold-some::after {
  content: ''; position: absolute; right: 4px; bottom: 4px;
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255, 255, 255, .9);
}
/* The office colour is pale, so a white mark on it would be invisible. */
.bk.s-Unassigned.sold-all::after { border-color: var(--muted); }
.bk.s-Unassigned.sold-some::after { background: var(--muted); }
.bk { position: relative; }

.keys i.sold-all { position: relative; }
.keys i.sold-all::after {
  content: ''; position: absolute; inset: 2px;
  border: 1.5px solid rgba(255, 255, 255, .9); border-radius: 2px;
}
.keys i.sold-some { position: relative; }
.keys i.sold-some::after {
  content: ''; position: absolute; right: 1px; bottom: 1px;
  width: 4px; height: 4px; border-radius: 50%; background: rgba(255, 255, 255, .9);
}

.keys { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px;
  font-size: .85rem; color: var(--muted); }
.keys span { display: flex; align-items: center; gap: 6px; }
.keys :deep(.bi) { line-height: 1.2; }
.keys i { width: 13px; height: 13px; border-radius: 4px; display: inline-block; }
.keys i.late-key { outline: 2.5px solid var(--bad); outline-offset: -2.5px; background: transparent; }
</style>
