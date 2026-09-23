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
import Icon from './Icon.vue'

defineProps({
  label: { type: String, default: '' },
  modelValue: { type: String, default: '#000000' },
  /* Colours read off this artwork, offered rather than described. */
  swatches: { type: Array, default: () => [] },
  /*
   * The raffle's own colour, from Setup — offered FIRST and apart from the
   * artwork's, because it is a different kind of answer: not "a colour this
   * picture happens to contain" but "the colour this raffle wears everywhere
   * else". Empty when Setup has none, and then nothing is drawn for it.
   */
  brand: { type: String, default: '' },
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
        <!-- From the icon set, where every other drawing in the app lives and
             where the icons gate can see it; this was the one written inline. -->
        <Icon name="dropper" :size="15" />
      </button>
    </div>

    <!-- Read off this picture. Shown as the colours themselves, because a list
         of hex values is not a thing anybody can choose between. -->
    <div v-if="brand || swatches.length" class="from">
      <button
        v-if="brand" type="button" class="swatch"
        :class="{ on: String(modelValue).toUpperCase() === brand }"
        :style="{ background: brand }" :title="`The raffle's colour · ${brand}`"
        :aria-label="`Use the raffle's colour, ${brand}`" @click="set(brand)"></button>
      <span v-if="brand && !swatches.length" class="whence">the raffle's colour</span>
      <span v-if="brand && swatches.length" class="gap"></span>
      <button
        v-for="c in swatches" :key="c" type="button" class="swatch"
        :class="{ on: String(modelValue).toUpperCase() === c }"
        :style="{ background: c }" :title="c"
        :aria-label="`Use ${c}, from the artwork`" @click="set(c)"></button>
      <span v-if="swatches.length" class="whence">off the artwork</span>
    </div>
  </div>
</template>

<style scoped>
.ink { display: block }
.cap { display: block; font-size: var(--fs-xs); color: var(--muted); margin-bottom: var(--sp-2) }
.row { display: flex; align-items: center; gap: var(--sp-3) }

.sw { width: 34px; min-width: 34px; height: 28px; min-height: 0; padding: var(--sp-1); border-radius: var(--r-xs) }
/* The data face, because a hex is read character by character — to a print
   shop over the phone, among other places. */
.hex {
  flex: 1; min-width: 0; min-height: 28px; padding: var(--sp-1) var(--sp-3);
  font-family: var(--font-data);
  font-size: var(--fs-xs); text-transform: uppercase; border-radius: var(--r-xs);
}
.drop {
  width: 28px; height: 28px; min-height: 0; padding: 0; flex: none;
  display: grid; place-items: center; cursor: pointer; color: var(--muted);
  background: var(--surface); border: var(--rule) solid var(--border); border-radius: var(--r-xs);
}
.drop:hover { color: var(--brand); border-color: var(--brand) }

.from { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); flex-wrap: wrap }
/* The raffle's colour and the artwork's are two answers, so a little more space
   between them than within either (R3). */
.gap { width: var(--sp-3) }
/*
 * `.swatch`, NOT `.chip`, and the component's own prop is already called
 * `swatches`.
 *
 * `.chip` is a GLOBAL utility in style.css — a 44px-tall rounded pill with a
 * border and a hover, used for the search screen's "Try:" suggestions and for
 * filter chips across the app. This is a 20×20 square of colour. Two unrelated
 * things under one name, and only the scoping keeps them apart.
 *
 * That is thinner protection than it looks, because this repository keeps
 * MOVING scoped rules into style.css when a second component needs them —
 * `.seg`/`.segbtn` and `.hint.warnish` both went that way. The day this one
 * followed, every "Try:" chip in Find would have become a 20-pixel square with
 * its label wrapped inside it, and the commit doing the moving would have
 * looked like a tidy-up.
 *
 * Named for the role rather than the drawing — see name-tokens-for-the-role and
 * global-class-names-leak-colour, which is the same failure with the arrow
 * pointing the other way.
 */
.swatch {
  width: 20px; height: 20px; padding: 0; cursor: pointer;
  border: var(--rule) solid var(--border); border-radius: var(--r-xs);
}
.swatch.on { box-shadow: 0 0 0 2px var(--brand); border-color: var(--brand) }
/*
 * `.whence`, NOT `.note`. `.note` is a GLOBAL rule in style.css — the app's
 * aside, with a 12px left pad and a 2px left rule — and a scoped rule of the
 * same name only ADDS to it. So "off the artwork" had been drawn with a stray
 * vertical bar in front of it, a margin under it, and a padding that pushed it
 * away from the swatches it names. Named for what it says: where these came
 * from.
 */
.whence { font-size: var(--fs-3xs); color: var(--muted) }
</style>
