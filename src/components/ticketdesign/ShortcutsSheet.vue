<script setup>
/**
 * THE STUDIO'S KEYS, LISTED FROM THE TABLE THE STUDIO ANSWERS THEM FROM.
 *
 * Two ways in, one list. `?` (or the key drawing in the studio's bar) opens
 * it as a reference: every key, grouped as the tools are grouped on screen.
 * ⌘K opens it as a COMMAND PALETTE: type a few letters of what you want —
 * "group", "centre", "grey" — and Enter does it, so nobody has to remember a
 * key to use a command, and the commands that have no key are still one
 * search away.
 *
 * It holds no key of its own — every row comes from src/lib/studiokeys.js,
 * which is also what the handler reads — so a key cannot work without being
 * listed here, or be listed here without working. tests/studiokeys.test.mjs
 * holds that this file spells no key itself. Keys are written for the
 * platform: ⇧⌘G on a Mac, Ctrl+Shift+G elsewhere.
 */
import { computed, ref, onMounted, nextTick } from 'vue'
import Sheet from '../ui/Sheet.vue'
import { KEYS, comboLabel, combosOf, docLabel, answersOn } from '../../lib/studiokeys.js'

const props = defineProps({
  /** 'keys' — the reference; 'palette' — search and run. */
  mode: { type: String, default: 'keys' },
  /** The tab it was opened on, so the palette offers only what works there. */
  where: { type: String, default: 'place' },
})
const emit = defineEmits(['close', 'run'])

/* At most two ways per row: the first, and one more. Zoom answers four
   spellings of + and −, because keyboards differ; listing all four is noise
   for the one person whose keyboard sends the third. */
const keysOf = (row) => (row.doc ? [docLabel(row.doc)] : combosOf(row).slice(0, 2).map((c) => comboLabel(c)))

/* The reference: everything with a key or a gesture. Commands without either
   live in the palette, where they can be found by name. */
const groups = computed(() => {
  const out = []
  for (const row of KEYS) {
    if (!row.combo && !row.doc) continue
    let g = out.find((x) => x.name === row.group)
    if (!g) out.push((g = { name: row.group, rows: [] }))
    g.rows.push({ id: row.id, label: row.label, keys: keysOf(row) })
  }
  return out
})

/* The palette: what can be RUN on this tab, matched word by word. */
const query = ref('')
const at = ref(0)
const runnable = KEYS.filter((r) => r.action && answersOn(r, props.where))
/* One row per action: the far nudge is the same command as the near one. */
const seen = new Set()
const commands = runnable.filter((r) => (seen.has(r.action) ? false : seen.add(r.action)))
const found = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.filter((r) => {
    const hay = `${r.label} ${r.group} ${r.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
})

const search = ref(null)
onMounted(() => { if (props.mode === 'palette') nextTick(() => search.value?.focus()) })

function onSearchKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); at.value = Math.min(found.value.length - 1, at.value + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); at.value = Math.max(0, at.value - 1) }
  else if (e.key === 'Enter') { e.preventDefault(); const r = found.value[at.value]; if (r) emit('run', r.id) }
}
</script>

<template>
  <Sheet v-if="mode === 'palette'" title="Find a command" wide @close="emit('close')">
    <input ref="search" v-model="query" class="find" type="search" aria-label="Command"
           placeholder="Group, centre, grey, zoom…" @input="at = 0" @keydown="onSearchKey">
    <ul v-if="found.length" class="cmds" role="listbox" aria-label="Commands">
      <li v-for="(r, i) in found" :key="r.id">
        <button type="button" class="cmd" :class="{ at: i === at }" role="option" :aria-selected="i === at"
                @mouseenter="at = i" @click="emit('run', r.id)">
          <span class="clabel">{{ r.label }}</span>
          <span class="cgroup">{{ r.group }}</span>
          <kbd v-if="r.combo || r.doc">{{ keysOf(r)[0] }}</kbd>
        </button>
      </li>
    </ul>
    <p v-else class="none">Nothing on this tab answers to “{{ query }}”.</p>
  </Sheet>

  <Sheet v-else title="Keyboard shortcuts" wide @close="emit('close')">
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

/* The palette: one field, then the matches, the highlighted one filled. */
.find { width: 100%; margin-bottom: var(--sp-4) }
.cmds { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto }
.cmd {
  display: grid; grid-template-columns: 1fr auto auto; gap: var(--sp-4); align-items: baseline;
  width: 100%; min-height: 36px; padding: var(--sp-2) var(--sp-4); text-align: left;
  background: none; border: 0; border-radius: var(--r-xs); color: var(--text); cursor: pointer;
}
.cmd.at { background: var(--brand-soft) }
.cmd:focus-visible { outline: 2px solid var(--brand); outline-offset: calc(-1 * var(--rule)) }
.clabel { font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.cgroup { font-size: var(--fs-2xs); color: var(--muted) }
.none { margin: 0; font-size: var(--fs-sm); color: var(--muted) }
</style>
