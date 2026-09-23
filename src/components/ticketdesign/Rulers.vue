<script setup>
/**
 * RULERS IN MILLIMETRES, ALONG THE TOP AND DOWN THE SIDE.
 *
 * The artboard had one ruler, across the top, reading 0 · 25% · 50% · 75% and
 * the width in millimetres at the end. Shares are what the design stores, but
 * nobody holding a printed ticket, a steel rule or a print shop's quote speaks
 * in them — a serial "about 8 mm from the top" had to be worked out from a
 * percentage and the height, which was not on screen at all.
 *
 * So both sides read millimetres, with tick spacing chosen for the zoom
 * (src/lib/studiocanvas.js `ticksFor`): dense enough to measure by, sparse
 * enough never to smear. The share is still in the inspector, beside the
 * pixels, which is where somebody checking the stored value looks.
 *
 * THE ARTBOARD ITSELF IS THE SLOT, so the frame stays the shell's own markup —
 * its pointer handlers, its ref and its scoped styles do not cross into this
 * file, which only draws the two strips and the corner between them.
 */
import { computed } from 'vue'
import { ticksFor } from '../../lib/studiocanvas.js'

const props = defineProps({
  /** The printed size of the ticket. */
  widthMM: { type: Number, required: true },
  heightMM: { type: Number, required: true },
  /** The artboard as drawn on screen at this zoom. */
  widthPx: { type: Number, required: true },
  heightPx: { type: Number, required: true },
})

/* The strip's thickness. A number rather than a token because it is also the
   SVG's own coordinate space, which cannot read a custom property. */
const T = 16

const perMM = computed(() => (props.widthMM > 0 ? props.widthPx / props.widthMM : 0))
const across = computed(() => ticksFor(props.widthMM, perMM.value))
const down = computed(() => ticksFor(props.heightMM, perMM.value))
const len = (t) => (t.major ? 7 : 3)
</script>

<template>
  <div class="rulers" :style="{ gridTemplateColumns: `${T}px ${widthPx}px`, gridTemplateRows: `${T}px auto` }">
    <span class="corner" title="Millimetres, as the ticket prints">mm</span>
    <svg class="strip" :width="widthPx" :height="T" :viewBox="`0 0 ${widthPx} ${T}`" aria-hidden="true">
      <line v-for="t in across" :key="`x${t.mm}`"
            :x1="t.px + 0.5" :x2="t.px + 0.5" :y1="T - len(t)" :y2="T" />
      <template v-for="t in across" :key="`xl${t.mm}`">
        <text v-if="t.label" :x="t.px + 2" y="9">{{ t.mm }}</text>
      </template>
    </svg>
    <svg class="strip" :width="T" :height="heightPx" :viewBox="`0 0 ${T} ${heightPx}`" aria-hidden="true">
      <line v-for="t in down" :key="`y${t.mm}`"
            :x1="T - len(t)" :x2="T" :y1="t.px + 0.5" :y2="t.px + 0.5" />
      <template v-for="t in down" :key="`yl${t.mm}`">
        <text v-if="t.label" x="1" :y="t.px + 9">{{ t.mm }}</text>
      </template>
    </svg>
    <div class="board"><slot /></div>
  </div>
</template>

<style scoped>
.rulers { display: grid; margin: 0 auto }
.corner {
  display: grid; place-items: center;
  font-size: var(--fs-3xs); font-family: var(--font-data); color: var(--muted);
}
.strip { display: block; overflow: visible }
.strip line { stroke: var(--muted-2); stroke-width: 1 }
.strip text { fill: var(--muted); font-size: var(--fs-3xs); font-family: var(--font-data) }
.board { min-width: 0 }
</style>
