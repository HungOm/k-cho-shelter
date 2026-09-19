<script setup>
/**
 * A measurement, set by dragging and read as a number.
 *
 * WHY NOT A NUMBER FIELD. Placing a ticket number is a judgement about how it
 * looks against the artwork, not an arithmetic problem, and a number field asks
 * the wrong question: it wants a value before it will show you anything. A
 * slider inverts that — move it and the ticket answers. Nobody typing 21 into a
 * box knows whether 21 is right; everybody dragging can see when it is.
 *
 * THE NUMBER STAYS. It is what makes a placement reproducible on a second
 * artwork, what gets read out over the phone, and what an organiser compares
 * against the one they wrote down. Shown in monospace so a column of them
 * lines up, and in millimetres as well as pixels, because the file thinks in
 * pixels and the person thinks about a printed ticket.
 *
 * The readout is editable for the case the slider cannot serve: a value copied
 * from somewhere else, or one outside the range this slider offers.
 *
 * BOTH ARE FOCUSABLE, deliberately. The slider is the control — arrow keys move
 * it by a step, which is how a placement gets nudged — and the readout is a way
 * in for an exact figure. Taking the slider out of the tab order to avoid two
 * stops would leave the keyboard with only the typing route, which is the thing
 * this control exists to stop being mandatory. They are labelled differently so
 * a screen reader does not announce the same measurement twice.
 */
defineProps({
  label: { type: String, default: '' },
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  step: { type: Number, default: 1 },
  unit: { type: String, default: 'px' },
  /* Millimetres per unit, when this measures something that gets printed.
   * Zero means the value is not a physical length — a count, or a multiplier. */
  mm: { type: Number, default: 0 },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const set = (v) => {
  const n = Number(v)
  if (Number.isFinite(n)) emit('update:modelValue', n)
}

/* How far along the track the value sits, so the filled part can be a solid
 * block rather than a gradient. */
function pct(v, min, max) {
  const span = max - min
  if (!span) return 0
  return Math.max(0, Math.min(100, ((Number(v) - min) / span) * 100))
}
</script>

<template>
  <div class="dim">
    <div class="top">
      <span class="cap">{{ label }}</span>
      <span class="val">
        <input
          class="num" type="number" :value="modelValue" :step="step"
          :aria-label="`${label}, exact value`" @input="set($event.target.value)">
        <span class="u">{{ unit }}</span>
      </span>
    </div>

    <div class="track">
      <span class="fill" :style="{ width: pct(modelValue, min, max) + '%' }"></span>
      <input
        class="range" type="range" :value="modelValue"
        :min="min" :max="max" :step="step"
        :aria-label="label"
        @input="set($event.target.value)">
    </div>

    <p v-if="mm || hint" class="foot">
      <span v-if="mm" class="mmv">{{ (modelValue * mm).toFixed(2) }} mm</span>
      <span v-if="hint" class="hintt">{{ hint }}</span>
    </p>
  </div>
</template>

<style scoped>
.dim { display: block }
.top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px }
.cap { font-size: .8rem; color: var(--muted); flex: 1; min-width: 0 }

/* The number reads as a number: monospace, right-aligned, no field furniture
 * until you go near it. A box drawn around every value turns a panel of
 * measurements into a wall of boxes. */
.val { display: flex; align-items: baseline; gap: 3px }
.num {
  width: 52px; min-height: 0; padding: 1px 3px; text-align: right;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: .82rem; font-variant-numeric: tabular-nums;
  background: transparent; border: 1px solid transparent; border-radius: 3px;
}
.num:hover { border-color: var(--border) }
.num:focus { background: var(--surface); border-color: var(--brand); box-shadow: none }
.num::-webkit-outer-spin-button, .num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0 }
.u { font-size: .72rem; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace }

/*
 * The track. The filled part is a solid element rather than a gradient, so the
 * control obeys the same no-gradient rule as everything else on this screen.
 */
.track { position: relative; height: 18px; display: flex; align-items: center }
.track::before {
  content: ''; position: absolute; left: 0; right: 0; height: 3px;
  background: var(--surface-2); border-radius: 2px;
}
.fill {
  position: absolute; left: 0; height: 3px; border-radius: 2px;
  background: var(--brand); pointer-events: none;
}

/* The real control, transparent, on top — so it keeps native keyboard and
 * pointer behaviour while the visible track is ours. */
.range {
  position: absolute; left: 0; right: 0; width: 100%;
  margin: 0; padding: 0; min-height: 0; height: 18px;
  background: none; border: 0; -webkit-appearance: none; appearance: none;
}
.range:focus { outline: none; box-shadow: none }
.range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 15px; height: 15px; border-radius: 50%;
  background: #fff; border: .5px solid rgba(0, 0, 0, .18);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .28); cursor: grab;
}
.range::-webkit-slider-thumb:active { cursor: grabbing }
.range::-moz-range-thumb {
  width: 15px; height: 15px; border-radius: 50%; border: .5px solid rgba(0, 0, 0, .18);
  background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .28); cursor: grab;
}
.range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent) }

.foot { display: flex; gap: 8px; margin: 3px 0 0; font-size: .72rem; color: var(--muted) }
.mmv { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums }
.hintt { flex: 1; min-width: 0 }
</style>
