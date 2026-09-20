<script setup>
/**
 * HOW THE TICKETS SIT ON THE PAPER — the third tab, on its own.
 *
 * First of the three lifted out of TicketDesign.vue, which was two thousand
 * lines holding every tab, its panels, its state and its styles. That file is
 * why a change here is risky: a rule added for this tab overrode three
 * controls seven hundred lines away and nobody noticed for a day.
 *
 * THE DESIGN GOES IN BY REFERENCE AND IS EDITED IN PLACE. That is not
 * laziness about props: it is what every control on this screen already did
 * when they shared a file, the parent watches the same object for its dirty
 * flag and its undo history, and changing the contract at the same moment as
 * the file boundary would make a mechanical move into a behavioural one.
 */
import { computed } from 'vue'
import { pageFit, PAPERS } from '../../lib/ticketsheet.js'
import Dim from '../ui/Dim.vue'
import SheetPreview from '../ui/SheetPreview.vue'

const props = defineProps({
  design: { type: Object, default: null },
  active: { type: Object, default: null },
  /* Computed by the parent because the artwork tab shows it too. */
  dpi: { type: Object, default: null },
})

/* Derived, never stored — see pageFit for why the count is not a setting. */
const fit = computed(() => (props.design ? pageFit(props.design) : null))
const design = computed(() => props.design)
const active = computed(() => props.active)
const dpi = computed(() => props.dpi)
</script>

<template>
<div class="studio">
      <div class="rail">
        <template v-if="active && design">
          <!--
            WHAT PAPER, ANSWERED BEFORE ANYTHING ELSE. The sheet was A4 by
            assumption and nothing on the screen said so, which left the one
            question somebody actually has — what goes in the tray — to be
            inferred from a number inside a sum.
          -->
          <div class="pgroup">
            <h4 class="rubric">Paper</h4>
            <div class="papers">
              <button v-for="pp in PAPERS" :key="pp.id" type="button" class="paper"
                      :class="{ on: (design.sheet.paper || 'a4') === pp.id }"
                      :title="`${pp.label} · ${pp.widthMM} × ${pp.heightMM} mm`"
                      @click="design.sheet.paper = pp.id">
                <span class="pshape"
                      :style="{ aspectRatio: `${pp.widthMM} / ${pp.heightMM}` }"></span>
                <b>{{ pp.label }}</b>
              </button>
            </div>
            <p class="tiny muted mono">{{ fit ? `${fit.paper.widthMM} × ${fit.paper.heightMM} mm` : '' }}</p>
            <div class="seg orient">
              <button type="button" class="segbtn" :class="{ on: !design.sheet.landscape }"
                      @click="design.sheet.landscape = false">Portrait</button>
              <button type="button" class="segbtn" :class="{ on: !!design.sheet.landscape }"
                      @click="design.sheet.landscape = true">Landscape</button>
            </div>
          </div>

          <div class="pgroup">
            <h4 class="rubric">How they sit on the page</h4>
            <div class="quad one">
              <Dim v-model="design.sheet.widthMM" label="Ticket width" :min="40" :max="210" unit="mm" />
              <Dim v-model="design.sheet.gapMM" label="Gap between" :min="0" :max="30" unit="mm" />
              <Dim v-model="design.sheet.marginMM" label="Page margin" :min="0" :max="30" unit="mm" />
            </div>
            <label class="choice">
              <input v-model="design.sheet.cutlines" type="checkbox"> Dashed line to cut along
            </label>
          </div>
        </template>
      </div>

      <div class="stagewrap">
        <SheetPreview v-if="active && design && fit" :fit="fit" :art="active.url"
                      :cutlines="!!design.sheet.cutlines" />
        <p v-else class="note">Upload some artwork before setting up the sheet.</p>
      </div>

      <div class="panel">
        <template v-if="active && design">

          <!--
            HOW MANY FIT IS SHOWN, NOT ASKED FOR.
            This was a slider from one to twelve called "Tickets to a page",
            and nothing read it — the tickets flowed down the page and the
            browser broke it wherever it ran out of paper. A ticket is as tall
            as its width and the artwork's shape make it, so the count has no
            free variable in it. The sum is given because that is the only form
            in which the answer can be checked against a sheet of A4.
          -->
          <div v-if="fit" class="pgroup">
            <h4 class="rubric">What that comes to</h4>
            <p class="fitline">
              <b class="big">{{ fit.per }}</b>
              <span>ticket{{ fit.per === 1 ? '' : 's' }} to a sheet of {{ fit.paper.label }}</span>
            </p>
            <!--
              TOO WIDE WAS COUNTED AS A FIT. The old arithmetic was about
              height alone, so a 190mm ticket on A5 answered "2 per page" and
              printed off the side of the paper.
            -->
            <p v-if="fit.tooWide" class="note bad tiny">
              The ticket is wider than {{ fit.paper.label }}. Reduce the width or the margin.
            </p>
            <!--
              THE SUM IS THE WORKING, NOT THE ANSWER. It was the only thing
              here and it is how you CHECK the answer, not how you read it —
              so the answer is the bar and the figure, and the arithmetic is
              underneath for whoever wants to satisfy themselves.
            -->
            <p class="usedline" :class="fit.fits ? '' : 'over'">
              <span class="usedbar" aria-hidden="true">
                <span :style="{ width: Math.min(100, (fit.used / fit.pageHeightMM) * 100) + '%' }"></span>
              </span>
              <span class="tiny">
                <b>{{ fit.used.toFixed(0) }}</b> of {{ fit.pageHeightMM.toFixed(0) }} mm used
              </span>
            </p>
            <p class="tiny mono working" :class="fit.fits ? 'muted' : 'bad'">
              {{ fit.per }} × {{ fit.heightMM.toFixed(1) }} +
              {{ fit.per - 1 }} × {{ fit.gapMM.toFixed(1) }} +
              2 × {{ fit.marginMM.toFixed(1) }} =
              {{ fit.used.toFixed(1) }} of {{ fit.pageHeightMM.toFixed(1) }} mm
            </p>
            <p class="tiny muted">
              At {{ design.sheet.widthMM }} mm the ticket is
              {{ fit.heightMM.toFixed(1) }} mm tall, which is the artwork's own shape.
              Print at 100% scale with background graphics turned on.
            </p>
            <p v-if="dpi" class="tiny" :class="dpi.soft ? 'bad' : (dpi.ok ? 'muted' : 'warn')">
              <b>{{ dpi.v }} dots per inch</b> at this size —
              <template v-if="dpi.ok">sharp enough for a print shop.</template>
              <template v-else-if="dpi.soft">
                soft enough to see. Re-export the artwork at
                {{ Math.ceil((300 * design.sheet.widthMM) / 25.4) }} px wide or more.
              </template>
              <template v-else>
                fine on an office printer, under the 300 a press usually asks for.
                {{ Math.ceil((300 * design.sheet.widthMM) / 25.4) }} px wide would reach it.
              </template>
            </p>
          </div>
        </template>
      </div>
    </div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.papers { display: flex; gap: 6px; flex-wrap: wrap }
.paper {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 6px 8px; min-width: 52px; cursor: pointer; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm);
}
.paper.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-ink) }
.paper .pshape { display: block; width: 18px; background: currentColor; opacity: .38; border-radius: 1px }
.paper.on .pshape { opacity: .7 }
.paper b { font-size: .76rem; font-weight: 600 }
.orient { margin-top: 6px }
.fitline { display: flex; align-items: baseline; gap: 8px; margin: 0 }
.fitline span { font-size: .84rem; color: var(--muted) }
.usedline { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 0 }
.usedline.over .usedbar > span { background: var(--bad) }
.usedline b { font-variant-numeric: tabular-nums }
.usedbar {
  display: block; height: 6px; border-radius: 999px;
  background: var(--surface-2); overflow: hidden;
}
.usedbar > span { display: block; height: 100%; background: var(--brand); border-radius: 999px }
.working { margin: 2px 0 0; opacity: .75 }
</style>
