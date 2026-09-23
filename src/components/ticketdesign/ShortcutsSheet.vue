<script setup>
/**
 * THE STUDIO'S KEYS, LISTED FROM THE TABLE THE STUDIO ANSWERS THEM FROM.
 *
 * Opened with ? or the key drawing in the studio's bar. It holds no key of
 * its own — every row comes from src/lib/studiokeys.js, which is also what the
 * handler reads — so a key cannot work without being listed here, or be
 * listed here without working. tests/studiokeys.test.mjs holds that this file
 * spells no key itself.
 *
 * Grouped as the tools are grouped on screen, and each row uses the tool's own
 * words, so the sheet teaches the keys for things somebody can already see.
 */
import { computed } from 'vue'
import Sheet from '../ui/Sheet.vue'
import { KEYS, comboLabel, combosOf } from '../../lib/studiokeys.js'

const emit = defineEmits(['close'])

const groups = computed(() => {
  const out = []
  for (const row of KEYS) {
    let g = out.find((x) => x.name === row.group)
    if (!g) out.push((g = { name: row.group, rows: [] }))
    g.rows.push({ id: row.id, label: row.label, keys: row.doc ? [row.doc] : combosOf(row).map(comboLabel) })
  }
  return out
})
</script>

<template>
  <Sheet title="Keyboard shortcuts" wide @close="emit('close')">
    <div class="keysheet">
      <section v-for="g in groups" :key="g.name" class="kgroup">
        <h3 class="rubric">{{ g.name }}</h3>
        <dl>
          <template v-for="r in g.rows" :key="r.id">
            <dt>{{ r.label }}</dt>
            <dd>
              <template v-for="(k, i) in r.keys" :key="k">
                <span v-if="i" class="or">or</span><kbd>{{ k }}</kbd>
              </template>
            </dd>
          </template>
        </dl>
      </section>
    </div>
  </Sheet>
</template>

<style scoped>
/* Two columns of groups at desk width, so the whole table is one look rather
   than a scroll; one below that. More space between groups than within them. */
.keysheet { columns: 2 280px; column-gap: var(--sp-8) }
.kgroup { break-inside: avoid; margin-bottom: var(--sp-7) }
.rubric {
  margin: 0 0 var(--sp-3); font-size: var(--fs-3xs); font-weight: var(--fw-medium);
  letter-spacing: .07em; text-transform: uppercase; color: var(--muted);
}
dl { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-3) var(--sp-5); margin: 0; align-items: baseline }
dt { font-size: var(--fs-sm) }
dd { margin: 0; text-align: right; white-space: nowrap }
kbd {
  display: inline-block; min-width: 1.6em; padding: var(--sp-1) var(--sp-3); text-align: center;
  font-family: var(--font-data); font-size: var(--fs-xs); font-variant-numeric: tabular-nums;
  background: var(--surface-2); border: var(--rule) solid var(--border); border-radius: var(--r-xs);
}
.or { margin: 0 var(--sp-2); font-size: var(--fs-2xs); color: var(--muted) }
</style>
