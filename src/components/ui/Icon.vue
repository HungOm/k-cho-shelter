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

const PATHS = {
  // --- the app ---------------------------------------------------------
  home:      'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  search:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  ticket:    'M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 4v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4v-2ZM9.5 7v11',
  books:     'M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM9 4h4v16H9zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20H13z',
  people:    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.8c2.4.6 4 2.4 4 5.2',
  money:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M14.8 9.4c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 2 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.3-.5-2.8-1.4',
  trophy:    'M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.5v1.5A3.5 3.5 0 0 0 7.6 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16.4 11M12 14v3.5M8.5 20.5h7L15 17.5H9l-.5 3Z',
  /*
   * REDRAWN, and the only existing drawing this change touches.
   *
   * The old gear was the forty-node arc-per-tooth kind. It is legible in the
   * sidebar at 22px and grey mush in a dense rail at 16, which is where the
   * studio needs it as `settings`. A rim, a hub and eight teeth carry the same
   * meaning and hold their shape all the way down.
   *
   * THE TEETH TOUCH THE RIM, and that is the whole drawing. The first attempt
   * here was a circle with eight strokes floating outside it, which is a SUN —
   * it was drawn, rendered, and read as brightness by the person who had just
   * drawn it. A tooth starts where the rim ends; a ray does not.
   */
  gear:      'M12 4.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6ZM12 4.8V2.4M12 19.2v2.4M4.8 12H2.4M19.2 12h2.4M6.9 6.9 5.2 5.2M17.1 17.1l1.7 1.7M17.1 6.9l1.7-1.7M6.9 17.1l-1.7 1.7',
  key:       'M14.5 3a6.5 6.5 0 0 1 2.4 12.5L15 21l-2.5-1.5L10 21l-1.5-3 2-2A6.5 6.5 0 0 1 14.5 3ZM15 8.5h.01',
  hand:      'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.3-3.2L4 15c-.4-.8-.1-1.8.7-2.2.8-.4 1.8-.1 2.2.7L8 15',
  more:      'M5 12h.01M12 12h.01M19 12h.01',
  clock:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  phoneOff:  'M3 3l18 18M9.5 4.5A15 15 0 0 0 19.5 14.5M8 13a15 15 0 0 0 3 3l1.5-1.5a1.5 1.5 0 0 1 1.6-.3l2 .8a1.5 1.5 0 0 1 1 1.4v2.3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 4.3 6.5 1.5 1.5 0 0 1 5.8 5h2.3a1.5 1.5 0 0 1 1.4 1l.8 2a1.5 1.5 0 0 1-.3 1.6L8 13Z',
  check:     'M4.5 12.5 9.5 17.5 19.5 6.5',
  plus:      'M12 5v14M5 12h14',
  minus:     'M5 12h14',
  bookPlus:  'M5 5.5A1.5 1.5 0 0 1 6.5 4H19v12H6.5A1.5 1.5 0 0 0 5 17.5v-12ZM5 17.5A1.5 1.5 0 0 0 6.5 19H19M12 7.5v5M9.5 10h5',
  trash:     'M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12',
  arrowUp:   'M12 20V4.5M6 10.5 12 4.5l6 6',
  arrowDown: 'M12 4v15.5M18 13.5 12 19.5l-6-6',
  /* Back out of somewhere, rather than back one step in a list — it sits on
     "Exit studio", where the thing being left is a whole mode. */
  arrowLeft: 'M20 12H4.5M10.5 6 4.5 12l6 6',

  // --- the studio: what a ticket is made of ----------------------------
  /*
   * The element palette — text, picture, code — is three drawings that have to
   * be told apart at a glance in the same row. They are deliberately as
   * different from one another as the grid allows: a letterform, a framed
   * landscape, and the unmistakable corner squares of a QR code.
   */
  design:    'M4 20l1-3.6L14.9 6.6a1.9 1.9 0 0 1 2.7 2.7L7.6 19.1 4 20ZM13.4 8.1l2.5 2.5',
  type:      'M6 6h12M12 6v12M9.5 18h5',
  image:     'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11ZM8.8 11a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6ZM4.6 16.2l4.4-3.7 3.5 3 3-2.5 4 3.6',
  code:      'M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5zM14.5 14.5h2v2h-2zM17.5 17.5h2v2h-2z',

  // --- the studio: placing it ------------------------------------------
  position:  'M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  size:      'M4 9.5V4h5.5M20 14.5V20h-5.5M5.2 5.2 10.4 10.4M18.8 18.8 13.6 13.6',
  align:     'M4.5 4v16M8.5 7.5h11M8.5 12h7.5M8.5 16.5h9.5',
  layers:    'M12 3.8 3.6 8.4 12 13l8.4-4.6L12 3.8ZM4.2 12.4 12 16.7l7.8-4.3',
  /*
   * SNAP is a horseshoe magnet, which is card 9b's own drawing and is the one
   * metaphor for this that nobody has to be taught. The alternative — two
   * boxes with a dashed line between them — is a picture of the RESULT, and at
   * 15px beside an 11px label it reads as a diagram rather than as a tool.
   *
   * Two arches and two pole faces: the legs stay open, because a closed
   * horseshoe is an arch and an arch is a bridge.
   */
  magnet:    'M5 17V10a7 7 0 0 1 14 0v7M9 17v-7a3 3 0 0 1 6 0v7M5 17h4M15 17h4',
  /*
   * GRID IS FOUR CROSSING LINES, AND NOT FOUR SQUARES, which is what the card
   * draws and what I drew first.
   *
   * Four equal panes is `ph-grid-four`, and in this app it collides: `code`
   * above is a QR, three large squares and two small, and at 15px in the same
   * screen — the rail lists "Check code" while the stage bar offers "Grid 2 mm"
   * — a reader has two arrangements of small squares to tell apart. That is
   * rule 1 of this set failing quietly: unmistakable beats handsome, and it has
   * to be unmistakable against the set's OWN neighbours, not in isolation.
   *
   * Lines are also the truer drawing. A grid is what a box snaps TO, and what
   * it snaps to is the lines, not the panes between them. Four marks, gaps of
   * about five grid units, which is coarse enough to hold at the small end.
   */
  grid:      'M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16',
  /*
   * FIT is two walls and an arrow between them, not the four corner brackets
   * the rest of the world uses for "fit to frame". The control it belongs to
   * is fitToWidth: the ticket grows until it touches the sides of the sheet,
   * and the drawing says width rather than area.
   */
  fit:       'M4.5 5.5v13M19.5 5.5v13M8.5 12h7M10.2 9.8 8 12l2.2 2.2M13.8 9.8 16 12l-2.2 2.2',

  // --- the studio: putting it on paper ---------------------------------
  print:     'M7.5 9.5v-5h9v5M7.5 17.5H6A1.6 1.6 0 0 1 4.4 16v-4.4A1.6 1.6 0 0 1 6 10h12a1.6 1.6 0 0 1 1.6 1.6V16a1.6 1.6 0 0 1-1.6 1.5h-1.5M7.5 14.5h9v5h-9z',
  paper:     'M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5ZM13.5 3.5V8h4.5',
  template:  'M4.5 5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-13ZM4.5 9h15M9.5 9v11',
  margins:   'M4.5 4.5h15v15h-15zM8.5 8.5h7v7h-7z',
  /*
   * BLEED is eight crop marks and no box. That is what bleed IS — ink running
   * past a trim line that only exists on the printer's marks — and drawing a
   * rectangle would say the opposite of the thing named.
   */
  bleed:     'M9 3v5.5M15 3v5.5M3 9h5.5M15.5 9H21M3 15h5.5M15.5 15H21M9 15.5V21M15 15.5V21',
  preview:   'M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12ZM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  /* The eye, struck through. There was no "not shown" drawing in the set, so a
   * visibility control had to borrow phoneOff -- a crossed-out HANDSET beside a
   * ticket field. The slash is the same M3 3l18 18 stroke phoneOff uses, so the
   * two read as one convention rather than two. */
  previewOff:'M3 3l18 18M10.6 6.1A7.6 7.6 0 0 1 12 5.8c5.6 0 9.2 6.2 9.2 6.2a17 17 0 0 1-2.8 3.4M6.5 8.1A17 17 0 0 0 2.8 12S6.4 18.2 12 18.2a8 8 0 0 0 3.2-.7M9.9 9.9a2.6 2.6 0 0 0 3.7 3.7',
  download:  'M12 4v10.5M8 11l4 4 4-4M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17',

  // --- the studio: looking at it before it prints ----------------------
  /*
   * The two zooms are `search`'s magnifier with a bar added, deliberately and
   * not for want of an idea. A preview's zoom and the app's search are the same
   * gesture — make this bigger so I can see it — and drawing them from two
   * different shapes would say they were unrelated.
   */
  zoomIn:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M11 8v6M8 11h6',
  zoomOut:   'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M8 11h6',
  /*
   * ACTUAL SIZE IS THE PRINTER'S "1:1", AND IT IS THE ONE PLACE THIS SET
   * DRAWS CHARACTERS ON PURPOSE.
   *
   * Every metaphor available says the wrong thing. A magnifier with a 1 reads
   * as "zoom to 100% of the window", which is a claim about the browser; this
   * control claims the ticket on the glass is the size of the ticket in your
   * hand. 1:1 is the notation the trade already uses for exactly that, next to
   * the crop marks and the trim box, and somebody laying out a raffle ticket
   * has seen it.
   *
   * THE COST, STATED RATHER THAN HIDDEN: Burmese has its own digits (၁), so
   * this is the one drawing in the set that is not fully language-independent.
   * It is acceptable HERE because the ticket studio is an organiser's desk
   * tool. If this control ever reaches the seller's field screens, it needs a
   * label beside it rather than a redraw — a mark that reads as measurement to
   * one reader and as nothing to another is worse than a word.
   */
  actualSize:'M6.6 8.8 8.2 7.2v9.6M12 10.2h.01M12 14.6h.01M14.8 8.8 16.4 7.2v9.6',
  /*
   * The way in to calibration, so it has to read as MEASUREMENT and not as
   * settings — a browser cannot know a display's physical DPI, so "actual
   * size" is approximate until somebody holds a bank card against a bar on the
   * screen. Ticks of two lengths, because a ruler with even teeth is a comb.
   */
  ruler:     'M3.5 8.5h17v7h-17zM7 8.5v3M10.5 8.5v2M14 8.5v3M17.5 8.5v2',
  reset:     'M4.6 9.3A7.6 7.6 0 1 1 4.5 13M3.6 4v5.3h5.3',
  help:      'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.4A2.5 2.5 0 0 1 14.5 10c0 1.7-2.5 2.2-2.5 3.7M12 17h.01',

  /*
   * NOT A DRAWING — what is shown when a name does not exist.
   *
   * It used to be `more`, the three-dot ellipsis, which is a real control in
   * the sidebar. A misspelt name therefore produced a plausible button that
   * did nothing unusual, and the mistake reached whoever was looking at the
   * screen rather than whoever typed it. A broken-edged box struck through is
   * not mistakable for anything this set intends, so it is visible the moment
   * it renders.
   *
   * THE STRIKE IS NOT DECORATION. Without it this was a dashed square, which
   * sat on the contact sheet looking like a perfectly reasonable crop tool —
   * a fallback that looks like an icon is the bug all over again, one step
   * along. Nothing else in the set is struck through.
   */
  missing:   'M5 5h3.5M13 5h3.5M19 7.5v3.5M19 15.5V19h-3.5M13 19H9.5M5 19v-3.5M5 11V7.5M6.5 17.5 17.5 6.5'
}

/*
 * One concept, one drawing. `settings` is what the studio's rail calls the
 * control the sidebar calls `gear`; both names point at the same path rather
 * than at two gears that would drift apart the first time either is touched.
 */
const ALIASES = { settings: 'gear' }

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
