<script setup>
/**
 * THE SHAPES OF ARTWORK THIS RAFFLE WILL ACCEPT.
 *
 * A known shape is checked against its tolerance; an unfamiliar one is
 * refused rather than stretched, because a picture of the wrong shape is
 * squashed or cropped on every ticket and neither can be put right after it
 * is printed.
 *
 * SECOND PIECE OUT OF THE TWO-THOUSAND-LINE DESIGNER, and it went before the
 * rest of its own tab for one reason: the seam is four bindings wide — the
 * list, its error, and two actions — where the tab around it is eighteen. A
 * component whose interface cannot be stated in a line is not extracted, it
 * is relocated.
 *
 * THE LIST IS EDITED IN PLACE AND REMOVAL IS AN EVENT. Fields are typed
 * straight into the objects, which is what they always were; but removing one
 * REPLACES the array, and a child cannot reassign its parent's ref. That
 * asymmetry is worth keeping visible rather than smoothing over with a
 * v-model on the whole list — the parent owns which shapes exist.
 */
import Icon from '../ui/Icon.vue'
import ToolButton from '../ui/ToolButton.vue'

defineProps({
  sizes: { type: Array, default: () => [] },
  /** The shape the uploaded artwork matched, so the row can say so. */
  matched: { type: Object, default: null },
  error: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['add', 'save', 'remove'])
</script>

<template>
<aside class="panel">
  <div class="pgroup">
    <h4 class="rubric">Shapes we know</h4>
    <!--
      ONE BLOCK PER SHAPE, NOT A FIVE-COLUMN TABLE.
      A table of five numeric columns in a 300px panel truncates every
      field, which is how "190 × 61 mm" became "190 ×" and a height of
      61.39 became "61.". A shape is a small specification, so it is laid
      out as one — and the tolerance lives with the shape it belongs to
      rather than in a second list keyed by the same names.
    -->
    <ul class="shapes">
      <li v-for="(s, i) in sizes" :key="i"
          :class="{ on: matched === s }">
        <div class="shead">
          <input v-model="s.label" class="sname" aria-label="Shape name">
          <span v-if="matched === s" class="pill ok">matched</span>
          <!-- Was a literal "×" in a text button: a character doing an
               icon's job, at a text button's weight, on a row where the name
               is the thing being read. -->
          <ToolButton icon="trash" :label="`Remove ${s.label}`" :size="14"
                      hint="Artwork already uploaded in this shape keeps printing. Removing every shape restores the standard list."
                      @click="emit('remove', i)" />
        </div>
        <div class="sgrid">
          <label class="formrow"><span class="cap">Width</span>
            <span class="wrap">
              <input v-model.number="s.widthMM" type="number" step="0.01"
                     :aria-label="`Width of ${s.label} in millimetres`">
              <span class="unit">mm</span>
            </span>
          </label>
          <label class="formrow"><span class="cap">Height</span>
            <span class="wrap">
              <input v-model.number="s.heightMM" type="number" step="0.01"
                     :aria-label="`Height of ${s.label} in millimetres`">
              <span class="unit">mm</span>
            </span>
          </label>
          <label class="formrow"><span class="cap">Least width</span>
            <span class="wrap">
              <input v-model.number="s.minWidthPx" type="number" step="10"
                     :aria-label="`Least pixels wide for ${s.label}`">
              <span class="unit">px</span>
            </span>
          </label>
          <label class="formrow"><span class="cap">Tolerance</span>
            <span class="wrap">
              <input v-model.number="s.tolerance" type="number" step="0.005"
                     :aria-label="`Tolerance for ${s.label}`">
            </span>
          </label>
        </div>
      </li>
    </ul>
    <p v-if="error" class="note bad tiny">{{ error }}</p>
    <div class="prow">
      <button class="btn sm" @click="emit('add')"><Icon name="plus" :size="15" />Add a shape</button>
      <button class="btn sm primary" :disabled="busy" @click="emit('save')">
        <Icon name="check" :size="15" />Save
      </button>
    </div>
    <!--
      ONE SENTENCE, AND IT IS THE ONE THAT IS NOT GUESSABLE. The heading above
      carried a four-clause paragraph in its title and this restated its first
      clause underneath; between them they explained what a shape is, which the
      four labelled number fields already say. What no control here reveals is
      the UNIT on tolerance — 0.02 could be millimetres, per cent or pixels,
      and it is a fraction of the aspect ratio.
    -->
    <p class="say">Tolerance is a fraction of the shape: 0.02 allows two per cent out.</p>
  </div>

</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.shapes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-4) }
.shapes li { border: var(--rule) solid var(--border); border-radius: var(--r-md); padding: var(--sp-4) }
.shapes li.on { border-color: var(--brand); background: var(--brand-soft) }
.shead { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3) }
.sname {
  flex: 1; min-width: 0; min-height: 30px; padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-xs); font-weight: var(--fw-medium);
}
.sgrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3) var(--sp-4) }
.unit { font-size: var(--fs-2xs); color: var(--muted) }
/* Stranded in TicketDesign.vue when this file took the markup: a child's
 * markup does not inherit a parent's scoped styles, so these have been inert
 * since the extraction. Same cause as the verdict's status dot (3a70895). The
 * dead copies remain in the parent for whoever holds it next. */
.prow { display: flex; gap: var(--sp-3); flex-wrap: wrap }
.sgrid input {
  min-height: 30px; padding: var(--sp-2) var(--sp-3); text-align: right; font-size: var(--fs-2xs);
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.sgrid .unit { font-size: var(--fs-3xs) }
</style>
