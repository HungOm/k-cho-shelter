<script setup>
/**
 * A row of chips that narrows a list, with the count on each one.
 *
 * WHY IT IS A COMPONENT. This was written twice inside a fortnight — once over
 * a seller's account history, once over the approvals that have been dealt with
 * — and the second copy had already drifted: different gap, different resting
 * border, the count in a different weight. Two lists that do the same thing to
 * the reader should not look like two different ideas.
 *
 * THE RULE THIS ENFORCES, AND IT IS THE POINT OF THE COMPONENT: every row in
 * the list belongs to exactly one chip, and the chips' counts sum to All. A
 * filter set that leaves a kind out makes that kind visible under All and
 * nowhere else, and the reader has no way to know it is missing — the chips
 * read as exhaustive whether or not they are. This repository has paid for that
 * shape three times ("everything except X"), so `sums` is checked here and says
 * so in the console rather than failing quietly in front of a volunteer.
 *
 * It does NOT filter anything. The parent owns the list, the grouping and the
 * paging; this draws the choice and reports it. A component that filtered would
 * need to know what a row is, and there is no useful answer to that.
 */
import { computed } from 'vue'

const props = defineProps({
  /** [{ k, t }] — key and the word on the chip. 'all' is required and first. */
  items: { type: Array, required: true },
  /** { [k]: number } — how many rows each chip would show. */
  counts: { type: Object, default: () => ({}) },
  modelValue: { type: String, default: 'all' },
  /*
   * Below this many rows the chips are furniture: three controls over four rows
   * cost more attention than the filtering saves. The seller table uses the same
   * threshold for its search box, so the two screens agree on when a list has
   * become long enough to need handling.
   */
  min: { type: Number, default: 8 },
})
const emit = defineEmits(['update:modelValue'])

const total = computed(() => Number(props.counts.all ?? 0))

/* Only the chips that would show something — plus All, which always shows. A
   chip that filters to nothing is a control that looks broken when pressed. */
const shown = computed(() => total.value > props.min
  ? props.items.filter((f) => f.k === 'all' || props.counts[f.k])
  : [])

/*
 * The arithmetic that says the set is honest, checked at runtime because it
 * cannot be checked at the call site: a parent adds a new kind to its data long
 * after somebody wrote the chip list, and nothing connects the two.
 */
const sums = computed(() => {
  const parts = props.items.filter((f) => f.k !== 'all')
    .reduce((n, f) => n + Number(props.counts[f.k] ?? 0), 0)
  return parts === total.value
})
if (import.meta.env?.DEV) {
  const stop = () => {
    if (shown.value.length && !sums.value) {
      console.warn('[Filters] the chips do not sum to All — some rows belong to no chip ' +
        'and can only be seen unfiltered', JSON.parse(JSON.stringify(props.counts)))
    }
  }
  stop()
}
</script>

<template>
  <div v-if="shown.length" class="filters row wrap">
    <button v-for="f in shown" :key="f.k" type="button"
            :class="['chip', { on: modelValue === f.k }]"
            :aria-pressed="String(modelValue === f.k)"
            @click="emit('update:modelValue', f.k)">
      {{ f.t }} <span class="n">{{ counts[f.k] || 0 }}</span>
    </button>
    <slot name="after" />
  </div>
</template>

<style scoped>
.filters { gap: 6px; margin: 4px 0 10px; }
/*
 * --brand-line rather than --brand on the resting edge. Five chips outlined at
 * full brand strength compete with whatever the list is about, which on both
 * screens using this is a figure somebody came to read.
 */
.chip { border-color: var(--brand-line); }
.chip .n { font-variant-numeric: tabular-nums; font-weight: 700; opacity: .65; margin-left: 2px; }
</style>
