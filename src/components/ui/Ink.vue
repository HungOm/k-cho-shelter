<script setup>
/**
 * A printing colour: chosen from the artwork, picked off the screen, or typed.
 *
 * THREE WAYS IN, BECAUSE ONE IS NEVER ENOUGH HERE. The colours read off the
 * picture cover most cases and arrive already filled in. But detection measures
 * area, and the colour somebody actually wants is often the one with the least
 * of it — the gold on this raffle's ticket is thin lettering covering about a
 * tenth of one per cent of it, so no amount of counting will surface it. That
 * is what the dropper is for: point at the thing.
 *
 * The hex stays visible and editable throughout. It is what gets written into
 * the design, what a second artwork gets matched against, and what somebody
 * reads out when a print shop asks.
 */
defineProps({
  label: { type: String, default: '' },
  modelValue: { type: String, default: '#000000' },
  /* Colours read off this artwork, offered rather than described. */
  swatches: { type: Array, default: () => [] },
  canDrop: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'pick'])
const set = (v) => emit('update:modelValue', String(v).toUpperCase())
</script>

<template>
  <div class="ink">
    <span class="cap">{{ label }}</span>

    <div class="row">
      <input
        class="sw" type="color" :value="modelValue"
        :aria-label="`${label}, colour`" @input="set($event.target.value)">
      <input
        class="hex" type="text" spellcheck="false" :value="modelValue"
        :aria-label="`${label}, hex value`" @input="set($event.target.value)">
      <button
        v-if="canDrop" type="button" class="drop" title="Pick a colour off the ticket"
        :aria-label="`Pick ${label} off the ticket`" @click="emit('pick')">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M15.5 3.5a2.1 2.1 0 0 1 3 3l-2 2 1 1-1.5 1.5-1-1L7 17.5 4 18l.5-3 8.5-8.5-1-1L13.5 4l1 1 1-1.5Z"
                fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- Read off this picture. Shown as the colours themselves, because a list
         of hex values is not a thing anybody can choose between. -->
    <div v-if="swatches.length" class="from">
      <button
        v-for="c in swatches" :key="c" type="button" class="chip"
        :class="{ on: String(modelValue).toUpperCase() === c }"
        :style="{ background: c }" :title="c"
        :aria-label="`Use ${c}, from the artwork`" @click="set(c)"></button>
      <span class="note">off the artwork</span>
    </div>
  </div>
</template>

<style scoped>
.ink { display: block }
.cap { display: block; font-size: .8rem; color: var(--muted); margin-bottom: 4px }
.row { display: flex; align-items: center; gap: 6px }

.sw { width: 34px; min-width: 34px; height: 28px; min-height: 0; padding: 2px; border-radius: 3px }
.hex {
  flex: 1; min-width: 0; min-height: 28px; padding: 3px 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .8rem; text-transform: uppercase; border-radius: 3px;
}
.drop {
  width: 28px; height: 28px; min-height: 0; padding: 0; flex: none;
  display: grid; place-items: center; cursor: pointer; color: var(--muted);
  background: var(--surface); border: 1px solid var(--border); border-radius: 3px;
}
.drop:hover { color: var(--brand); border-color: var(--brand) }

.from { display: flex; align-items: center; gap: 4px; margin-top: 5px; flex-wrap: wrap }
.chip {
  width: 20px; height: 20px; padding: 0; cursor: pointer;
  border: 1px solid var(--border); border-radius: 3px;
}
.chip.on { box-shadow: 0 0 0 2px var(--brand); border-color: var(--brand) }
.note { font-size: .7rem; color: var(--muted) }
</style>
