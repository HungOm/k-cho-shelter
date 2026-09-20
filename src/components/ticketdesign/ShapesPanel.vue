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
    <h4 class="rubric"
        title="A known shape is checked against its tolerance. An unfamiliar one is refused rather than stretched — a picture of the wrong shape is squashed or cropped on every ticket, and neither can be put right afterwards.">
      Shapes we know
    </h4>
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
          <button class="btn sm ghost" :title="`Remove ${s.label}`"
                  @click="emit('remove', i)">×</button>
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
      <button class="btn sm" @click="emit('add')">Add a shape</button>
      <button class="btn sm primary" :disabled="busy" @click="emit('save')">Save shapes</button>
    </div>
    <p class="tiny muted"
       title="Tolerance is on the aspect ratio, as a fraction: 0.02 accepts two per cent out of shape. Removing every shape restores the standard list. Only artwork too coarse to print is turned away — an unfamiliar shape is measured and offered, never thrown away.">
      Tolerance is a fraction of the aspect ratio
    </p>
  </div>

</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.shapes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px }
.shapes li { border: 1px solid var(--border); border-radius: 8px; padding: 8px }
.shapes li.on { border-color: var(--brand); background: var(--brand-soft) }
.shead { display: flex; align-items: center; gap: 6px; margin-bottom: 6px }
.sname { flex: 1; min-width: 0; min-height: 30px; padding: 3px 6px; font-size: .84rem; font-weight: 500 }
.sgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px }
.unit { font-size: .74rem; color: var(--muted) }
</style>
