<script setup>
/**
 * The whole raffle as coloured squares.
 *
 * Six hundred rows in a table tell you nothing. Six hundred squares tell you at
 * a glance how much stock is still in the office and who is sitting on it.
 */
import { computed } from 'vue'
import { bookShort, BOOK_WORDS } from '../../lib/format.js'

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
  if (b.sold) bits.push(b.sold + ' sold')
  if (b.daysOverdue > 0) bits.push(b.daysOverdue + ' days late')
  return bits.join(' · ')
}
</script>

<template>
  <div>
    <div class="grid">
      <button v-for="b in shown" :key="b.book"
              :class="['bk', 's-' + b.status, { late: b.daysOverdue > 0 }]"
              :title="label(b)" @click="emit('pick', b)">
        {{ bookShort(b.book) }}
      </button>
      <button v-if="remaining" class="bk more" @click="emit('more')" :title="remaining + ' more'">
        +{{ remaining }}
      </button>
    </div>
    <div class="keys">
      <span><i class="s-Unassigned"></i>In the office</span>
      <span><i class="s-Out"></i>With a seller</span>
      <span><i class="s-Returned"></i>Brought back</span>
      <span><i class="s-Settled"></i>Finished</span>
      <span><i class="s-Lost"></i>Lost</span>
      <span><i class="late-key"></i>Late</span>
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

.keys { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 14px;
  font-size: .85rem; color: var(--muted); }
.keys span { display: flex; align-items: center; gap: 6px; }
.keys i { width: 13px; height: 13px; border-radius: 4px; display: inline-block; }
.keys i.late-key { outline: 2.5px solid var(--bad); outline-offset: -2.5px; background: transparent; }
</style>
