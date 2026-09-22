<script setup>
/**
 * One stroke-drawn icon set.
 *
 * Emoji were standing in for these. They render differently on every phone,
 * carry their own colour that fights the interface, sit on a different baseline
 * from text, and — next to a real organisation mark — make the whole thing look
 * unfinished. These are one weight, one grid, and they take the colour of
 * whatever they sit in.
 *
 * WHY THE SET IS WORTH MORE THAN IT LOOKS. Every label in this app is English
 * with a Burmese gloss under it, so on a control the icon is frequently the
 * only thing that is language-independent. A volunteer who reads neither line
 * still has to know which button counts a book in. That makes semantic
 * clarity load-bearing here rather than decorative: when a drawing has to
 * choose between being handsome and being unmistakable, it is unmistakable.
 *
 * THREE RULES THE DRAWINGS FOLLOW.
 *
 * 1. Everything is built from strokes on the 24 grid with round caps, and
 *    nothing is filled. A filled shape reads at a different weight from its
 *    neighbours and breaks the set the moment two icons sit side by side.
 * 2. Four marks at most. These are read at 16px in an organiser's table as
 *    well as at 52px on a phone held at arm's length outdoors, and detail
 *    finer than about 3 units of the grid turns to grey mush at the small end.
 * 3. The print icons borrow the printer's own vocabulary — crop marks for
 *    bleed, nested rules for margins — rather than inventing metaphors. The
 *    people who lay out a raffle ticket have seen those marks before.
 *
 * NO TEXT IN A DRAWING. A glyph would need translating, and the whole point of
 * the icon is to be the part that does not. Three drawings argue with that
 * rule and each says why at its own line: `type` is the compositor's serif T,
 * `help` is a question mark, and `actualSize` is the printer's 1:1 — trade
 * notation rather than words being read as a sentence.
 *
 * WHAT THE TEST CAN AND CANNOT HOLD, because the difference matters if you add
 * a fourth. tests/icons.test.mjs sweeps every path for anything that is not a
 * path command or a number, which catches a <text> element folded in and a
 * font pressed into service. It CANNOT tell a letterform drawn in strokes from
 * any other arrangement of strokes — nothing can. So the three exceptions
 * above are held by this comment and by whoever reads it, not by the suite.
 */
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 24 },
  /*
   * The accessible name, for an icon that is the WHOLE of a control.
   *
   * Left empty, the icon is aria-hidden, which is right for the common case:
   * nearly every icon in this app sits beside a <Bi> label, and announcing
   * both reads the control out twice.
   *
   * Deliberately an aria-label and not an SVG <title>. A <title> inside the
   * svg becomes the tooltip of whatever the svg sits in, which would quietly
   * override the `title` a disabled control carries its REASON in — the rule
   * permissionui.test.mjs exists to enforce. An aria-label names the icon for
   * a screen reader and shows no tooltip at all, so the two cannot collide.
   */
  label: { type: String, default: '' }
})
/*
 * THE DRAWINGS MOVED TO src/lib/iconpaths.js, and only the drawings.
 *
 * The studio can place an icon on a ticket now, and the renderer that draws
 * that ticket runs nowhere near a Vue component — so a table of path strings
 * could not go on living inside one. Every rule about what a drawing may be is
 * unchanged and still enforced by tests/icons.test.mjs, which parses the new
 * file; this component is what it always was, minus the data.
 */
import { PATHS, ALIASES } from '../../lib/iconpaths.js'


const d = computed(() => {
  const key = ALIASES[props.name] || props.name
  const path = PATHS[key]
  if (!path && import.meta.env?.DEV) {
    console.warn(`[Icon] there is no icon called "${props.name}" — showing the missing mark`)
  }
  return path || PATHS.missing
})

/*
 * STROKE WEIGHT IS OPTICAL, NOT FIXED.
 *
 * stroke-width is in grid units, so a constant 1.7 renders 1.1px at size 16
 * and 3.7px at 52 — the set thins out in an organiser's table and thickens
 * into a marker pen on a seller's tap target, which is the one place it has to
 * survive daylight and a moving hand. What should stay roughly constant is the
 * weight the eye sees, growing only slightly with the drawing: 1.5px at 16,
 * about 2.2px at 52. This converts that back into grid units.
 */
const stroke = computed(() => {
  const px = Math.min(2.2, Math.max(1.5, 1.5 + (props.size - 16) * 0.02))
  return +(px * 24 / props.size).toFixed(2)
})
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" :stroke-width="stroke"
       stroke-linecap="round" stroke-linejoin="round"
       :role="label ? 'img' : undefined"
       :aria-label="label || undefined"
       :aria-hidden="label ? undefined : 'true'"
       focusable="false" class="ic">
    <path :d="d" />
  </svg>
</template>

<style scoped>
.ic { flex: 0 0 auto; display: block; }
</style>
