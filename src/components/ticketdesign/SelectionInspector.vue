<script setup>
/**
 * WHAT IS SELECTED, WHEN IT IS MORE THAN ONE THING.
 *
 * With five boxes selected the inspector used to go on describing the first of
 * them as if it were alone — its name in the heading, its numbers in the
 * fields — while the arrange tools beside the canvas acted on all five. The
 * panel said one thing and the tools did another, and the only way to find out
 * which boxes were in the selection was to look for outlines on a ticket at 40%.
 *
 * So a selection of several gets a panel of its own: how many and of what, the
 * box they occupy together, and the list of them. It edits nothing. Everything
 * that acts on a selection is already on the arrange rail, and a second set of
 * controls for the same commands a foot away is one control with two homes.
 *
 * A NAME IN THE LIST IS A WAY IN. Clicking one selects that thing alone — and
 * inside a group, just that part — so the panel for a single thing is one click
 * from the panel for many.
 */
import { computed } from 'vue'
import Icon from '../ui/Icon.vue'

const props = defineProps({
  /** [{ id, icon, name, word, drawn }] — what is selected, in stacking order. */
  things: { type: Array, required: true },
  /** Their combined box, in shares of the artboard. */
  bounds: { type: Object, default: null },
  /** The artboard in pixels, so the shares can be checked against the file. */
  size: { type: Object, default: () => ({ width: 1600, height: 517 }) },
  /** Fields and drawn shapes together, which cannot be restacked across. */
  mixed: { type: Boolean, default: false },
  /** Every drawn shape selected is one group. */
  grouped: { type: Boolean, default: false },
})
const emit = defineEmits(['pick'])

const fields = computed(() => props.things.filter((t) => !t.drawn).length)
const drawn = computed(() => props.things.length - fields.value)
const kinds = computed(() => [
  fields.value ? `${fields.value} ${fields.value === 1 ? 'field' : 'fields'}` : '',
  drawn.value ? `${drawn.value} drawn` : '',
].filter(Boolean).join(' · '))

const pc = (v) => `${(Number(v) * 100).toFixed(1)}%`
const px = (v, of) => Math.round(Number(v) * of)
</script>

<template>
<aside class="panel">
  <div class="shead">
    <h3>{{ things.length }} selected</h3>
    <p class="say">{{ kinds }}</p>
  </div>

  <div v-if="bounds" class="pgroup">
    <p class="rubric">Together</p>
    <p class="mono tiny">
      x {{ pc(bounds.left) }} · y {{ pc(bounds.top) }} · {{ pc(bounds.width) }} &times; {{ pc(bounds.height) }}
    </p>
    <p class="mono say">
      {{ px(bounds.left, size.width) }}, {{ px(bounds.top, size.height) }} ·
      {{ px(bounds.width, size.width) }} &times; {{ px(bounds.height, size.height) }} px
    </p>
  </div>

  <div class="pgroup">
    <ul class="picks">
      <li v-for="t in things" :key="t.id">
        <Icon :name="t.icon" :size="15" class="glyph" :title="t.word" />
        <button type="button" class="pname" :title="`Select only ${t.name}`"
                @click="emit('pick', t.id)">{{ t.name }}</button>
      </li>
    </ul>
    <p v-if="grouped" class="say">One group. ⌘-click a part to work inside it.</p>
    <p v-if="mixed" class="say">Fields print over every drawn shape, so the two cannot be restacked across.</p>
  </div>
</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.shead h3 { margin: 0; font-size: var(--fs-lg); font-variant-numeric: tabular-nums }
.shead .say { margin-top: var(--sp-1) }
.picks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.picks li { display: flex; align-items: center; gap: var(--sp-4); min-height: 30px }
.glyph { flex: none; color: var(--muted) }
/* A name is a way in, drawn as the list's own row text rather than as a
   button, because it sits in a list of names. */
.pname {
  flex: 1; min-width: 0; text-align: left; border: 0; background: none; padding: 0;
  font: inherit; font-size: var(--fs-xs); color: var(--text); cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pname:hover { color: var(--brand) }
.pname:focus-visible { outline: 2px solid var(--brand); outline-offset: var(--rule) }
</style>
