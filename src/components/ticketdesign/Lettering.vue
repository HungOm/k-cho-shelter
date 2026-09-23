<script setup>
/**
 * HOW WORDS ARE LETTERED — one control, used by all three inspectors.
 *
 * WHY IT IS ONE COMPONENT. The printed field, the drawn words and the card part
 * each carried their own copy, and the three copies had drifted into three
 * different answers to one question. Alignment was three WORDS in two panels
 * and one glyph repeated three times in the third. The typeface was named in a
 * select in one panel and drawn in its own face in another. Bold was a tick
 * box everywhere, though it takes effect the moment it is pressed. The same
 * command in three vocabularies a click apart is the case UI-STANDARD R9
 * exists for.
 *
 * WHAT IS NOT SHARED IS THE NAMES. The printed side calls its faces Times and
 * Padauk because a print shop asks which font; the card calls the same two
 * Everyday and Figures because nobody asks that of a picture sent on WhatsApp
 * (CardInspector.vue, and UI-EVIDENCE Phase 1). So the faces arrive as a prop
 * and this component never names one.
 *
 * TWO FACES ARE A SEGMENTED CONTROL, NOT A SELECT. A two-way choice hidden in a
 * dropdown is a click to find out there were only two (Designing User
 * Interfaces p246: five or fewer is radios or a segment). Each option is set in
 * its own face, so the control shows the thing it chooses.
 *
 * EVERYTHING IS A v-model AND NOTHING IS MUTATED HERE. The drawn-words panel
 * has to record an undo step before a value moves; the other two edit in
 * place. The parent decides which by how it handles the update.
 */
import { computed } from 'vue'
import ToolBar from '../ui/ToolBar.vue'
import ToolButton from '../ui/ToolButton.vue'

const props = defineProps({
  /** [{ id, name, stack, why }] — the faces, in this surface's own words. */
  faces: { type: Array, required: true },
  family: { type: String, default: 'text' },
  weight: { type: String, default: 'regular' },
  align: { type: String, default: 'left' },
  /**
   * Letter spacing as a share of the letter height, or null where the thing
   * being lettered has no such setting — in which case no field is drawn,
   * rather than a field that nothing reads.
   */
  tracking: { type: Number, default: null },
})
const emit = defineEmits(['update:family', 'update:weight', 'update:align', 'update:tracking'])

/* The three words the model stores, drawn as three lines of type. */
const ALIGNS = [
  { id: 'left', icon: 'textLeft', label: 'Words to the left' },
  { id: 'centre', icon: 'textCentre', label: 'Words centred' },
  { id: 'right', icon: 'textRight', label: 'Words to the right' },
]

const why = computed(() => props.faces.find((f) => f.id === props.family)?.why || '')
const trackingPct = computed(() => Math.round((props.tracking ?? 0) * 100))

function setTracking(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return
  /* The model's own limits (designelements.js), so a typed 90 lands where the
     renderer would have put it rather than somewhere the field disagrees with. */
  emit('update:tracking', Math.max(-0.1, Math.min(0.5, n / 100)))
}
</script>

<template>
  <div class="formrow lettering">
    <span class="cap">Lettering</span>
    <div class="seg" role="group" aria-label="Typeface">
      <button v-for="f in faces" :key="f.id" type="button" class="segbtn"
              :class="{ on: family === f.id }" :aria-pressed="family === f.id"
              :style="{ fontFamily: f.stack }" :title="f.why"
              @click="emit('update:family', f.id)">{{ f.name }}</button>
    </div>
    <p v-if="why" class="say">{{ why }}</p>

    <ToolBar label="How the words sit">
      <span class="tgroup">
        <ToolButton v-for="a in ALIGNS" :key="a.id" :icon="a.icon" :label="a.label" :size="15"
                    :active="align === a.id" @click="emit('update:align', a.id)" />
      </span>
      <span class="tgroup">
        <ToolButton icon="type" label="Bold" wide :size="15" :active="weight === 'bold'"
                    hint="Heavier lettering — the one emphasis that survives a grey press"
                    @click="emit('update:weight', weight === 'bold' ? 'regular' : 'bold')" />
      </span>
    </ToolBar>

    <label v-if="tracking !== null" class="formrow">
      <span class="cap">Letter spacing</span>
      <span class="wrap">
        <input type="number" step="1" min="-10" max="50" :value="trackingPct"
               @input="setTracking($event.target.value)">
        <span class="unit">%</span>
      </span>
    </label>
  </div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/* A group in its own right inside the panel's column: the rows of one control
   sit closer together than the controls around it (R3). */
.lettering { gap: var(--sp-3) }
</style>
