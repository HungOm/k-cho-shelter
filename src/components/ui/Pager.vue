<script setup>
/**
 * A page of a long list, and the sentence saying which page it is.
 *
 * WHY THIS EXISTS RATHER THAN A LONGER TABLE. This raffle runs at two thousand
 * books and twenty thousand tickets, and the money screen draws one row per
 * seller and one line per charge and payment behind each of them. At a dozen
 * sellers a full list is the friendliest thing possible; at two hundred it is a
 * wall somebody scrolls past looking for a name, on the phone of whoever is
 * standing at a desk with a queue in front of them.
 *
 * THE COUNT IS PART OF THE CONTROL, not decoration. "Showing 1–25 of 214" is
 * the difference between a list that is short and a list that has been cut, and
 * a screen that quietly shows the first 25 of 214 is one somebody will act on
 * believing they have seen everything. Every cap in this app states itself for
 * the same reason.
 *
 * IT DISAPPEARS when everything fits, because a pager under a list of four is
 * furniture that makes a small screen look complicated.
 */
import { computed } from 'vue'

const props = defineProps({
  total: { type: Number, required: true },
  page: { type: Number, required: true },
  size: { type: Number, default: 25 },
  /** What is being counted, so the sentence reads in words a person would use. */
  noun: { type: String, default: 'rows' },
})
const emit = defineEmits(['update:page'])

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)))
const from = computed(() => (props.total ? (props.page - 1) * props.size + 1 : 0))
const to = computed(() => Math.min(props.total, props.page * props.size))

/* Clamped here rather than at every call site: a filter that shortens the list
   while somebody is on page nine must not leave them looking at nothing. */
function go(p) {
  emit('update:page', Math.min(pages.value, Math.max(1, p)))
}
</script>

<template>
  <div v-if="total > size" class="pager">
    <span class="count">
      Showing <b>{{ from }}–{{ to }}</b> of <b>{{ total }}</b> {{ noun }}
    </span>
    <span class="row">
      <button class="btn sm" :disabled="page <= 1" aria-label="First page" @click="go(1)">«</button>
      <button class="btn sm" :disabled="page <= 1" aria-label="Previous page" @click="go(page - 1)">‹</button>
      <span class="where">{{ page }} / {{ pages }}</span>
      <button class="btn sm" :disabled="page >= pages" aria-label="Next page" @click="go(page + 1)">›</button>
      <button class="btn sm" :disabled="page >= pages" aria-label="Last page" @click="go(pages)">»</button>
    </span>
  </div>
</template>

<style scoped>
.pager {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-top: 12px;
}
.count { font-size: .86rem; color: var(--muted); }
.where { font-size: .86rem; color: var(--muted); min-width: 56px; text-align: center; }
.row { display: flex; align-items: center; gap: 4px; }
/* Square, so five of them do not become a keyboard on a phone. */
.pager .btn.sm { min-width: 38px; padding: 6px 10px; }
</style>
