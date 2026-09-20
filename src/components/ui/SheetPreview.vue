<script setup>
/**
 * A SHEET OF A4, AT ITS REAL PROPORTIONS.
 *
 * WHY THIS IS A COMPONENT AND NOT A SECOND DRAWING. It was built inside the
 * printing modal and lived only there, which meant the screen that PRINTS a
 * sheet drew the page and the screen that CONFIGURES one did not — so somebody
 * dragging a margin from 10mm to 25mm watched three numbers change and had no
 * way to see the last ticket fall off the bottom. Two drawings of the same
 * geometry would drift the first time one was edited; this is the one drawing,
 * and both screens hand it the same `pageFit` result.
 *
 * EVERY DIMENSION IS A PERCENTAGE of 210 × 297 mm, so what is on screen is the
 * shape that comes out of the printer. A preview drawn to a convenient size
 * would hide exactly the thing somebody is looking for.
 *
 * `items` is how the printing screen puts real tickets on it — one entry per
 * ticket, each with the overlay carrying its number and QR. The design screen
 * passes none and gets `fit.per` blank slots with the artwork in them, which is
 * what it needs: it is asking about the page, not about any ticket.
 */
import { computed } from 'vue'

const props = defineProps({
  /** A pageFit() result: per, widthMM, heightMM, gapMM, marginMM. */
  fit: { type: Object, required: true },
  /** The artwork drawn in each slot, if there is one. */
  art: { type: String, default: '' },
  /** Real tickets, each { key, overlay }. Empty means blank slots. */
  items: { type: Array, default: () => [] },
  cutlines: { type: Boolean, default: true },
})

/*
 * EVERY DIMENSION IS A SHARE OF THE PAPER THIS DESIGN IS ON, not of A4. The
 * page used to be A4 by assumption in three places; now the geometry says
 * which paper it is and the drawing follows, so choosing A3 or turning the
 * sheet landscape reshapes the preview instead of leaving it lying.
 */
const paper = computed(() => props.fit?.paper ?? { widthMM: 210, heightMM: 297, label: 'A4' })
const pcOfPage = (mm) => `${(mm / paper.value.heightMM) * 100}%`
const pcOfWidth = (mm) => `${(mm / paper.value.widthMM) * 100}%`

/* Blank slots when nobody handed us tickets, so the page is still the page. */
const slots = computed(() => {
  // Not `props.items.length`: a caller that passes nothing at all should get
  // blank slots, not a crash. The prop default covers the ordinary case and
  // this covers the one where the default never ran.
  const given = Array.isArray(props.items) ? props.items : []
  if (given.length) return given
  const per = Math.max(0, Math.floor(Number(props.fit?.per) || 0))
  return Array.from({ length: per }, (_, i) => ({ key: `blank-${i}` }))
})
</script>

<template>
  <div class="a4" :style="{ aspectRatio: `${paper.widthMM} / ${paper.heightMM}` }">
    <div class="pagemargin"
         :style="{ inset: pcOfPage(fit.marginMM) + ' ' + pcOfWidth(fit.marginMM) }">
      <div v-for="(s, i) in slots" :key="s.key ?? i" class="slot"
           :style="{ width: pcOfWidth(fit.widthMM), height: pcOfPage(fit.heightMM),
                     marginBottom: i < slots.length - 1 ? pcOfPage(fit.gapMM) : '0',
                     outline: cutlines ? '1px dashed rgba(0,0,0,.35)' : 'none' }">
        <img v-if="art" :src="art" alt="">
        <!--
          A TICKET-SHAPED TICKET WHEN THERE IS NO ARTWORK YET, because an empty
          rectangle answers none of the questions somebody opens this to ask.
          It is drawn, never data: the words are fixed and the sheet says
          SAMPLE, so nobody can mistake a layout preview for their own ticket.
        -->
        <svg v-else class="dummy" viewBox="0 0 320 104" preserveAspectRatio="none" aria-hidden="true">
          <rect width="320" height="104" fill="var(--surface-2)"/>
          <rect x="216" y="0" width="1" height="104" stroke-dasharray="4 4" stroke="var(--border)"/>
          <circle cx="22" cy="20" r="9" fill="var(--brand-soft)"/>
          <rect x="38" y="15" width="86" height="7" rx="3" fill="var(--brand-soft)"/>
          <rect x="14" y="40" width="120" height="11" rx="3" fill="var(--muted)" opacity=".35"/>
          <rect x="14" y="60" width="72" height="5" rx="2" fill="var(--muted)" opacity=".22"/>
          <rect x="14" y="72" width="54" height="5" rx="2" fill="var(--muted)" opacity=".22"/>
          <rect x="170" y="56" width="34" height="34" rx="2" fill="var(--muted)" opacity=".4"/>
          <rect x="228" y="18" width="62" height="6" rx="2" fill="var(--muted)" opacity=".3"/>
          <rect x="228" y="40" width="78" height="4" rx="2" fill="var(--muted)" opacity=".2"/>
          <rect x="228" y="54" width="78" height="4" rx="2" fill="var(--muted)" opacity=".2"/>
          <rect x="228" y="68" width="50" height="4" rx="2" fill="var(--muted)" opacity=".2"/>
        </svg>
        <div v-if="s.overlay" class="overlay" v-html="s.overlay"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * #fff is paper, not a surface — it does not follow dark mode, because the
 * sheet coming out of the printer does not either. Everything else is a token.
 */
.a4 {
  position: relative; width: 100%;
  background: #fff; border: 1px solid var(--border); border-radius: 2px;
  box-shadow: var(--shadow); overflow: hidden;
}
.pagemargin { position: absolute; display: flex; flex-direction: column; align-items: center }
.slot { position: relative; flex: none; background: #fff }
.slot img, .slot .dummy { display: block; width: 100%; height: 100%; object-fit: fill }
.slot .overlay { position: absolute; inset: 0; pointer-events: none }
.slot .overlay :deep(svg) { width: 100%; height: 100%; display: block }
</style>
