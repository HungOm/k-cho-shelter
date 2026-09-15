<script setup>
/**
 * English label with a Burmese gloss under it.
 *
 * English stays primary; the Burmese is small and faint because it is there to
 * help somebody who is unsure, not to compete with the label. An untranslated
 * string simply renders as English, so nothing breaks while the map is filled
 * in or reviewed.
 */
import { computed } from 'vue'
import { my, fill } from '../../lib/i18n.js'

const props = defineProps({
  text: { type: String, required: true },
  inline: Boolean,         // for use inside a button, where a block would stretch it
  // Fills {n}-style placeholders in BOTH languages, so a counted sentence is
  // one key rather than a fragment with a number stranded beside it.
  vars: { type: Object, default: null }
})
const shown = computed(() => fill(props.text, props.vars))
const sub = computed(() => my(props.text, props.vars))
</script>

<template>
  <span :class="['bi', { inline }]">
    <span class="en">{{ shown }}</span>
    <span v-if="sub" class="my" lang="my" aria-hidden="true">{{ sub }}</span>
  </span>
</template>

<style scoped>
.bi { display: inline-flex; flex-direction: column; line-height: 1.25; align-items: flex-start; }
/* In a centred parent — a tab, a tile — the two lines centre together.
   Anywhere else they stay left, or a sidebar row reads as centred text. */
.bi.mid { align-items: center; }
.bi.inline { display: inline; }
.en { display: block; }
.my {
  display: block;
  font-family: 'Padauk', 'Noto Sans Myanmar', 'Myanmar Text', 'Myanmar Sangam MN', sans-serif;
  /* Smaller than the label on purpose: the gloss is there to help somebody
     who is unsure of the English, not to be read in its own right. Not smaller
     than this, though — Burmese stacks its marks above and below the line, and
     they are the first thing to turn to mush. */
  font-size: .68em;
  font-style: italic;
  font-weight: 400;
  opacity: .58;
  line-height: 1.45;
  margin-top: 1px;
  /* Burmese sits lower than Latin; without this the gloss crowds the label. */
  padding-top: .06em;
}
</style>
