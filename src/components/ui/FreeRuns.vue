<script setup>
/**
 * What is available, before anybody types.
 *
 * The dialog used to open as two blank number boxes, so the only way to find
 * free books was to guess a range and be told no. This puts the answer on
 * screen, as tappable runs.
 */
import { computed } from 'vue'
import { freeRuns, runLabel } from '../../lib/books.js'

const props = defineProps({
  isFree: { type: Function, default: b => b.status === 'Unassigned' },
  label: { type: String, default: 'Free now' },
  noun: { type: String, default: 'free' },
  show: { type: Number, default: 4 }
})
const emit = defineEmits(['pick'])

const data = computed(() => freeRuns(props.isFree))
// The early runs are the ones people want — a gap at 592 matters far less than
// the gap at 31 — so show a handful and count the rest.
const shown = computed(() => data.value.runs.slice(0, props.show))
const rest = computed(() => Math.max(0, data.value.runs.length - props.show))
</script>

<template>
  <div v-if="data.total" class="runs">
    <div class="head">
      <span class="lbl">{{ label }}</span>
      <b>{{ data.total.toLocaleString() }} {{ data.total === 1 ? 'book' : 'books' }} {{ noun }}</b>
    </div>
    <div class="chips">
      <button v-for="r in shown" :key="r.from" class="run" @click="emit('pick', r)">
        {{ runLabel(r) }}
        <small>{{ r.count }}</small>
      </button>
      <span v-if="rest" class="more">+{{ rest }} more</span>
    </div>
  </div>
  <div v-else class="note warn">
    No books are {{ noun }} at the moment.
  </div>
</template>

<style scoped>
.runs {
  background: var(--surface-2); border-radius: var(--r-sm);
  padding: 12px 14px; margin-bottom: 16px;
}
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 9px; }
.lbl { font-size: .86rem; color: var(--muted); font-weight: 650; }
.head b { font-size: .92rem; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.run {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 7px 13px; min-height: 40px;
  border: 1.5px solid var(--border); border-radius: 999px;
  background: var(--surface); cursor: pointer;
  font-weight: 700; font-variant-numeric: tabular-nums;
}
.run:hover { border-color: var(--brand); color: var(--brand); }
.run small { font-weight: 500; color: var(--muted); font-size: .76rem; }
.run:hover small { color: inherit; opacity: .75; }
.more { font-size: .84rem; color: var(--muted); }
</style>
