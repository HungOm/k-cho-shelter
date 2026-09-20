<script setup>
/**
 * WHETHER THIS ARTWORK CAN BE PRINTED, AND WHAT IS WRONG IF NOT.
 *
 * Three questions a person asks before committing a press run: is the shape
 * one we know, is it enough pixels wide, and does everything placed on it
 * still land inside the picture. The report answers all three and this draws
 * the answers.
 *
 * ONE PROP. The whole panel is twenty-three reads of a single object, which
 * is why it is the cleanest thing to have come out of the designer — it
 * decides nothing, fetches nothing and owns nothing. Given a report it draws
 * a verdict; given none, the parent does not render it.
 *
 * The report itself stays in the parent because the artwork tab's stage shows
 * pieces of it too, and one derivation feeding two views is the point of
 * keeping it where both can see it.
 */
defineProps({
  /** An artworkReport: ratio, exact, size, px, minPx, placed, overflowing, ready. */
  report: { type: Object, required: true },
})
</script>

<template>
<div class="verdict" :class="report.ready ? 'ok' : 'warn'">
  <p class="vhead">
    <span class="dot"></span>
    <b v-if="report.ready">This artwork is ready to print</b>
    <b v-else>This artwork is not ready yet</b>
  </p>
  <div class="vgrid">
    <div>
      <p class="rubric">Shape</p>
      <p class="big mono">{{ report.ratio.toFixed(3) }}</p>
      <p class="tiny" :class="report.size ? 'okt' : 'badt'">
        <template v-if="report.size">
          wanted {{ report.wanted.toFixed(3) }} ±{{ report.tolerance }}
          — {{ report.exact ? 'exact' : 'within tolerance' }}
        </template>
        <template v-else>not a shape this raffle accepts</template>
      </p>
    </div>
    <div>
      <p class="rubric">Width in pixels</p>
      <p class="big mono">{{ report.px }}</p>
      <p class="tiny" :class="report.enoughPx ? 'okt' : 'badt'">
        <template v-if="report.minPx">
          {{ report.minPx }} needed —
          {{ report.px === report.minPx ? 'just enough' : (report.enoughPx ? 'comfortable' : 'too few') }}
        </template>
        <template v-else>no floor set for this shape</template>
      </p>
    </div>
    <div>
      <p class="rubric">Placements still valid</p>
      <p class="big mono">
        {{ report.placed - report.overflowing }} of {{ report.placed }}
      </p>
      <p class="tiny" :class="report.overflowing ? 'badt' : 'okt'">
        <template v-if="report.overflowing">
          {{ report.overflowing }} will not fit its box
        </template>
        <template v-else>nothing overflows</template>
      </p>
    </div>
  </div>
</div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.verdict { border: 1px solid var(--border); border-radius: var(--r-sm); padding: 12px; background: var(--surface) }
.verdict.ok { border-left: 3px solid var(--ok) }
.verdict.warn { border-left: 3px solid var(--warn) }
.vhead { display: flex; align-items: center; gap: 7px; margin: 0 0 10px }
.vgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px }
.okt { color: var(--ok) }
.badt { color: var(--bad) }
</style>
