<script setup>
/**
 * THE THINGS THIS RAFFLE KEEPS.
 *
 * Four built-in motifs plus whatever has been saved — shapes, named colours,
 * named lettering. Every other panel in this studio is about the design in
 * front of you; this is the only one whose contents survive it.
 *
 * A PICTURE, NOT A NAME, for a saved shape. The panel is a place somebody
 * looks for a thing they made three weeks ago, and "Badge 2" is a row they
 * have to place to find out what it is. So each one draws itself, at the size
 * it will be, from the same renderer that draws it on the ticket — which costs
 * nothing, because a decoration is already an SVG string.
 *
 * SAVING IS THE ONLY ACTION WITH A WORD ON IT. Placing is a click on the thing
 * itself, which is what a picture of a thing already invites; removing is the
 * same icon-only control the layer list uses. Saving is the one that needs a
 * name typed, so it is the one that gets a labelled button.
 */
import { computed, ref } from 'vue'
import ToolButton from '../ui/ToolButton.vue'
import Section from './Section.vue'
import { decorationLayerSVG } from '../../lib/designelements.js'
import { PATHS } from '../../lib/iconpaths.js'
import { BUILT_IN, MAX_SHAPES, MAX_COLOURS, MAX_STYLES, shapeFrom, nextLibId } from '../../lib/designlibrary.js'
import { FAMILIES } from '../../lib/ticketelements.js'

const props = defineProps({
  /** The raffle's own library, as config carries it. */
  library: { type: Object, default: () => ({ shapes: [], colours: [], styles: [] }) },
  /** What is selected on the artboard, so it can be saved. */
  selected: { type: Array, default: () => [] },
  /**
   * The lettering of the selected field or words — { family, weight, align,
   * tracking, colour } — or null when nothing lettered is selected.
   */
  lettering: { type: Object, default: null },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['place', 'save', 'save-colour', 'remove', 'remove-colour', 'use-colour',
  'save-style', 'remove-style', 'use-style'])

/* '' | 'shape' | 'colour' — one naming row serving both, because both need
   the same thing: a word typed before the server will take it. */
const naming = ref('')
const name = ref('')

/*
 * BUILT-INS FIRST AND THEY CANNOT BE REMOVED. They live in code, so a raffle
 * that has never saved anything still has something to place — an empty
 * library is a feature nobody discovers, because there is nothing there to
 * explain what placing would do. A delete on one would look like it worked and
 * be back next reload.
 */
const shapes = computed(() => [
  ...BUILT_IN.map((s) => ({ ...s, builtIn: true })),
  ...(props.library?.shapes ?? []),
])

/* Drawn at the size the tile is, from the renderer that draws the real thing.
   A preview built any other way is a preview that can disagree with the ticket
   — the same rule the brand preview in Setup follows. */
/* The drawing box. The viewBox below and the CSS aspect-ratio are the same
   two numbers, so a tile is never letterboxed against its own frame. */
const TW = 76, TH = 46
/* Not a token: this is ink INSIDE an SVG, which cannot read a CSS custom
   property, and it has to sit legibly on both themes' panel — so it is a
   mid-grey-green that neither surface swallows. */
const TILE_INK = '#5b6b66'
/* An area is a filled rect or ellipse — the thing other pieces get drawn on
   top of. A line, a word, a mark and a bare outline are not areas. */
const isArea = (p) => (p.kind === 'rect' || p.kind === 'ellipse')
  && (p.fill?.type ?? 'solid') !== 'none'
/*
 * A HAIRLINE HAS TO SURVIVE THE SHRINK. Stroke width is a share of the artboard
 * WIDTH, so the 0.004 that draws a 4px rule across a ticket draws a third of a
 * pixel across a 76px tile — visible on this retina screenshot and gone on an
 * ordinary display, which is the worst way for a bug to hide. Floored to a
 * little over one pixel.
 *
 * Only where there IS a stroke: the renderer gates the whole attribute on
 * width > 0, so flooring unconditionally would draw an outline around the tint
 * panel that the shape does not have.
 */
const tileStroke = (p) => (p.stroke?.width > 0
  ? Math.max(p.stroke.width, 1.1 / TW)
  : p.stroke?.width)

function tile(shape) {
  const parts = (shape.parts || []).map((p) => ({
    ...p,
    /* Inset a little: a shape whose stroke runs to its own edge is clipped by
       the tile and reads as broken rather than as full-bleed. */
    box: {
      left: 0.08 + p.box.left * 0.84,
      top: 0.12 + p.box.top * 0.76,
      width: p.box.width * 0.84,
      height: p.box.height * 0.76,
    },
    /*
     * ONE INK, TWO WEIGHTS — and the second weight is the point.
     *
     * The tile is a swatch, not a rehearsal of the ticket's colours: one ink so
     * the SHAPE is what is being compared between tiles. But flattening a whole
     * shape to a single opaque ink destroys figure and ground, and a saved
     * shape's most useful case is exactly that — a word or a mark ON a panel.
     * A "Paid chip" came back as a blank pill, which is the one thing a tile
     * must never be: unrecognisable at a glance.
     *
     * So an area reads as a tint and everything drawn ON it reads solid. A
     * stroked outline with no fill (the seal) is not an area, so it stays
     * solid too.
     */
    fill: { ...p.fill, colour: TILE_INK, to: TILE_INK },
    stroke: { ...p.stroke, colour: TILE_INK, width: tileStroke(p) },
    opacity: isArea(p) ? 0.34 : 1,
    shadow: null,
  }))
  /*
   * A ROOT <svg>, AND THAT IS NOT A DETAIL. decorationLayerSVG returns the
   * CHILDREN — <rect>, <text>, <g> — because its real job is to be spliced
   * inside the ticket's own <svg>. Handed to v-html on a <span> they are parsed
   * as HTML, where those names mean nothing: every shape draws as nothing and
   * only a <text>'s words survive, as loose prose. The panel looked like six
   * empty boxes with the word PAID adrift above one of them.
   */
  const body = decorationLayerSVG(parts, TW, TH, { icons: PATHS })
  return `<svg viewBox="0 0 ${TW} ${TH}" width="100%" height="100%" `
    + `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`
}

const canSave = computed(() => props.selected.length > 0)

/*
 * THE COLOUR ON THE SELECTION, WHICH IS THE ONLY COLOUR WORTH SAVING HERE.
 *
 * The studio's `swatches` are read off the artwork and lost on reload, so a
 * raffle that matched its printer's ink had nowhere to put the answer. What it
 * wants kept is the colour it just used, so that is what this offers: the fill
 * of the selected piece, or its stroke when the piece has no fill.
 */
const HEXY = /^#[0-9a-f]{6}$/i
const ink = (v) => (typeof v === 'string' && HEXY.test(v.trim()) ? v.trim().toLowerCase() : '')

const pickedColour = computed(() => {
  const d = props.selected?.[0]
  if (!d) return ''
  const f = (d.fill?.type ?? 'solid') !== 'none' ? d.fill?.colour : ''
  return ink(f) || ink(d.stroke?.colour) || ''
})

const coloursFull = computed(() => (props.library?.colours?.length ?? 0) >= MAX_COLOURS)
const whyNoColour = computed(() => {
  if (props.busy) return 'Saving…'
  if (coloursFull.value) return `The library holds ${MAX_COLOURS} colours. Remove one to keep another.`
  if (!pickedColour.value) return 'Select something with a colour on it first'
  /* Refusing a duplicate rather than storing a second row with the same value:
     two swatches that look identical is a panel somebody has to click to tell
     apart, which is the thing the tiles above exist to avoid. */
  if ((props.library?.colours ?? []).some((c) => c.value === pickedColour.value)) {
    return 'That colour is already kept'
  }
  return ''
})
const full = computed(() => (props.library?.shapes?.length ?? 0) >= MAX_SHAPES)
const whyNoSave = computed(() => {
  if (props.busy) return 'Saving…'
  if (full.value) return `The library holds ${MAX_SHAPES} saved shapes. Remove one to save another.`
  return canSave.value ? '' : 'Select something on the ticket first'
})

/*
 * LETTERING, KEPT. The library's model has held named text styles since it was
 * written, and nothing could make or use one — so "the gold serif we use for
 * the prize line" was retyped on every ticket. A kept style is the face, the
 * weight, the alignment, the spacing and the colour of whatever lettered thing
 * is selected, and a click puts all five on whatever is selected next.
 */
const stackOf = (id) => FAMILIES.find((f) => f.id === id)?.stack || 'inherit'
const stylesFull = computed(() => (props.library?.styles?.length ?? 0) >= MAX_STYLES)
const whyNoStyle = computed(() => {
  if (props.busy) return 'Saving…'
  if (stylesFull.value) return `The library holds ${MAX_STYLES} lettering styles. Remove one to keep another.`
  return props.lettering ? '' : 'Select a field or some words first'
})

function confirmSave() {
  if (naming.value === 'style') {
    if (!props.lettering) return
    emit('save-style', { ...props.lettering, id: nextLibId('t'), name: name.value.trim() || 'Lettering' })
    naming.value = ''
    name.value = ''
    return
  }
  if (naming.value === 'colour') {
    if (!pickedColour.value) return
    emit('save-colour', {
      id: nextLibId('c'),
      name: name.value.trim() || pickedColour.value,
      value: pickedColour.value,
    })
  } else {
    const made = shapeFrom(props.selected, name.value.trim() || 'Saved shape')
    if (!made) return
    emit('save', { ...made, id: nextLibId('s') })
  }
  naming.value = ''
  name.value = ''
}
</script>

<template>
<div class="block">
  <!-- THE SAVE CONTROL SITS IN THE HEADER, like Colours' and Lettering's.
       It was a full-width worded button under the tiles — the heaviest thing
       in a rail of 32px icons, for the same job its two neighbours did with a
       `+`. Three sections that all mean "keep this" now offer it one way. -->
  <Section label="Library" :count="shapes.length">
    <template #action>
      <ToolButton
        icon="plus" label="Keep the selection" :size="13" :why="whyNoSave"
        hint="Keep the selection in the library to place again"
        @click="naming = 'shape'" />
    </template>
  </Section>

  <!--
    THE REMOVE CONTROL IS A SIBLING OF THE TILE, NOT A CHILD OF IT.
    A <button> inside a <button> is invalid markup — browsers unnest it, and
    where the inner one ends up is not something to rely on. So the tile is a
    positioned wrapper holding two controls: the picture, which places, and the
    remove, which sits over its corner.
  -->
  <div class="tiles">
    <div v-for="s in shapes" :key="s.id" class="tile">
      <button
        type="button" class="place"
        :title="`Place ${s.name}`" :aria-label="`Place ${s.name}`"
        @click="emit('place', s)">
        <span class="art" v-html="tile(s)"></span>
        <span class="tname">{{ s.name }}</span>
      </button>
      <!-- Built-ins have none: they live in code, and a delete that came back
           next reload is a control that lied. -->
      <ToolButton
        v-if="!s.builtIn" icon="trash" :label="`Remove ${s.name}`" :size="13"
        class="tx" hint="Take it out of the library. What is already on a ticket stays."
        @click="emit('remove', s.id)" />
    </div>
  </div>

  <!-- Directly under the tiles, because it is about the tiles. It had drifted
       to the foot of the panel with the whole Colours section in between. -->
  <p class="say">Click one to place it.</p>

  <!-- NAMING IS THE ONE THING HERE THAT NEEDS A WORD, because a name has to be
       typed. Everything else is a click on a picture of itself. -->
  <template v-if="naming">
    <input v-model="name" maxlength="40"
           :placeholder="naming === 'colour' ? pickedColour : naming === 'style' ? 'Prize line, say' : 'Call it something'"
           @keyup.enter="confirmSave">
    <div class="row">
      <button class="btn sm ghost" @click="naming = ''; name = ''">Cancel</button>
      <button class="btn sm primary" :disabled="busy" @click="confirmSave">Save</button>
    </div>
  </template>

  <!--
    THE COLOURS ROW IS ALWAYS HERE, EVEN EMPTY.

    It used to render only when there were colours to show — and since nothing
    could ever save one, it was a section that could not appear. Hiding it also
    hides the way to fill it, so somebody looking for a colour they meant to
    keep finds no row, no control and no reason. An empty row with its one
    sentence costs a line and answers the question.
  -->
  <Section label="Colours" :count="library?.colours?.length ?? 0">
    <template #action>
      <!-- `why` rather than `disabled` + a hint that doubles as the reason:
           ToolButton makes the reason's PRESENCE the thing that disables, so
           there is no way to write a dead control without saying why (R8).
           This one said it the other way and its neighbour said it this way. -->
      <ToolButton
        icon="plus" label="Keep this colour" :size="13" :why="whyNoColour"
        :hint="`Keep ${pickedColour} to use on another ticket`"
        @click="naming = 'colour'" />
    </template>
  </Section>
  <div v-if="library?.colours?.length" class="cols">
    <div v-for="c in library.colours" :key="c.id" class="colwrap">
      <button
        type="button" class="col" :style="{ background: c.value }"
        :title="`${c.name} · ${c.value}`" :aria-label="`Use ${c.name}, ${c.value}`"
        @click="emit('use-colour', c.value)"></button>
      <ToolButton
        icon="trash" :label="`Remove ${c.name}`" :size="11" class="cx"
        hint="Take it out of the library. What is already on a ticket stays."
        @click="emit('remove-colour', c.id)" />
    </div>
  </div>
  <!-- `.tiny muted` is the studio's empty-state voice, and the note above its
       rule says this is the one place worth MORE words: what would put
       something here, and how. "No colours kept yet." was the class without
       the contract — it named the absence and stopped (R7). -->
  <p v-else class="tiny muted">None kept. Pick a colour, then +.</p>

  <Section label="Lettering" :count="library?.styles?.length ?? 0">
    <template #action>
      <ToolButton
        icon="plus" label="Keep this lettering" :size="13" :why="whyNoStyle"
        hint="Keep the selection's face, weight, alignment, spacing and colour"
        @click="naming = 'style'" />
    </template>
  </Section>
  <div v-if="library?.styles?.length" class="styles">
    <div v-for="t in library.styles" :key="t.id" class="tile">
      <!-- The style drawn as itself: "Aa" in its face, weight and colour. -->
      <button type="button" class="place" :title="`Letter the selection like ${t.name}`"
              :aria-label="`Use ${t.name}`" @click="emit('use-style', t)">
        <span class="aa" :style="{ fontFamily: stackOf(t.family), fontWeight: t.weight === 'bold' ? 700 : 400,
                                   color: t.colour || undefined, letterSpacing: `${t.tracking || 0}em` }">Aa</span>
        <span class="tname">{{ t.name }}</span>
      </button>
      <ToolButton icon="trash" :label="`Remove ${t.name}`" :size="13" class="tx"
                  hint="Take it out of the library. Lettering already on a ticket stays."
                  @click="emit('remove-style', t.id)" />
    </div>
  </div>
  <p v-else class="tiny muted">None kept. Select words, then +.</p>
</div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/*
 * A GRID OF PICTURES. Three across in a 240px rail, which is the width at
 * which a rule and a double rule are still telling apart — two across wastes
 * the height a library needs, and four makes a seal a smudge.
 */
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-2) }
.tile { position: relative }
.place {
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-1);
  width: 100%; padding: var(--sp-2) var(--sp-1);
  border: var(--rule) solid var(--border); border-radius: var(--r-md);
  background: var(--surface); cursor: pointer; color: var(--muted);
}
.place:hover { border-color: var(--brand); color: var(--text) }
.place:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px }
/* The art SCALES to the column rather than setting it. A fixed 76px plus
   padding and borders needs 262px for three across, and the rail is 240 — the
   grid ran out past its own panel. */
.art { display: block; width: 100%; aspect-ratio: 76 / 46; line-height: 0 }
.art :deep(svg) { display: block; width: 100%; height: 100% }
/* The name is the tile's caption, so it takes the caption voice — and it is
   allowed to truncate: the full one is in the title, and a wrapping name makes
   a grid of tiles ragged. */
.tname {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--fs-3xs);
}
/* The remove control only appears on the tile being pointed at: twelve visible
   delete buttons in a 240px rail is a panel that looks dangerous to use. */
.tx { position: absolute; top: 1px; right: 1px; opacity: 0 }
.tile:hover .tx, .tx:focus-visible { opacity: 1 }

/* The heading and its one control on a line, because a section that can be
   added to should say so where the section is named. */
/* The gap clears the remove badge, which overhangs its swatch by 6px — at the
   4px this started at, a badge sat on the NEIGHBOURING colour. */
.cols { display: flex; flex-wrap: wrap; gap: var(--sp-4) }
.styles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-2) }
/* Large enough to see the face: the tile's whole job is to show it. */
.aa { font-size: var(--fs-xl); line-height: 1.1; color: var(--text) }
.colwrap { position: relative }
/*
 * THE REMOVE BADGE CARRIES ITS OWN GROUND, which a swatch is the one place in
 * this panel that forces. Everywhere else an icon inherits currentColor against
 * a surface the theme controls; here it would sit on a colour the ORGANISER
 * chose, and on a dark navy it disappeared into the thing it removes. So it
 * gets the panel's own surface and border and steps off the corner.
 *
 * Still only on hover, the same rule as the tiles: a row of visible delete
 * buttons reads as a panel that is dangerous to touch.
 */
.cx {
  position: absolute; top: -5px; right: -5px; opacity: 0;
  /* Sized here rather than left to the button's own padding, which made it
     nearly as wide as the swatch. */
  width: 19px; height: 19px; padding: 0;
  display: grid; place-items: center;
  background: var(--surface); border: var(--rule) solid var(--border);
  border-radius: var(--r-pill);
}
.colwrap:hover .cx, .cx:focus-visible { opacity: 1 }
/* 44px, which is not a comfort choice: the remove badge sits on the corner, and
   at 28px a badge big enough to read eclipsed the swatch into a crescent — you
   could no longer see the colour you were deciding about. Four to a row in a
   240px rail. */
.col {
  width: 44px; height: 44px; padding: 0;
  border: var(--rule) solid var(--border-strong); border-radius: var(--r-md); cursor: pointer;
}
.col:hover { border-color: var(--brand) }
.col:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px }
</style>
