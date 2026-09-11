<script setup>
/** Money raised against the target. The bar animates in, so progress reads
    as movement rather than a static number. */
import { ref, onMounted, watch } from 'vue'
import { moneyShort } from '../../lib/format.js'

const props = defineProps({
  percent: { type: Number, default: 0 },
  collected: Number, target: Number, currency: String,
  sold: Number, total: Number, outstanding: Number
})

const width = ref('0%')
function animate() {
  requestAnimationFrame(() => { width.value = Math.max(1.5, props.percent) + '%' })
}
onMounted(animate)
watch(() => props.percent, animate)
</script>

<template>
  <div class="hero">
    <div class="amount">{{ moneyShort(collected, currency) }}</div>
    <div class="cap">
      collected so far<template v-if="outstanding > 0"> · {{ moneyShort(outstanding, currency) }} still to come in</template>
    </div>
    <div class="bar"><i :style="{ width }"></i></div>
    <div class="legend">
      <span>{{ (sold || 0).toLocaleString() }} of {{ (total || 0).toLocaleString() }} tickets sold</span>
      <span>{{ Math.round(percent) }}% of {{ moneyShort(target, currency) }}</span>
    </div>
  </div>
</template>

<style scoped>
.hero {
  background: linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 62%, #0ea5e9));
  color: var(--brand-ink); border-radius: var(--r);
  padding: 24px; margin-bottom: 14px; box-shadow: var(--shadow);
}
.amount { font-size: 2.4rem; font-weight: 850; letter-spacing: -.035em; line-height: 1.05; }
.cap { opacity: .88; font-size: .95rem; margin-top: 4px; }
.bar { height: 11px; border-radius: 99px; background: rgba(255,255,255,.28);
  margin: 18px 0 9px; overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: 99px; background: #fff;
  width: 0; transition: width .9s var(--ease); }
.legend { display: flex; justify-content: space-between; gap: 10px;
  font-size: .85rem; font-weight: 650; opacity: .92; flex-wrap: wrap; }
</style>
