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
import Icon from '../ui/Icon.vue'
import ToolButton from '../ui/ToolButton.vue'
import { decorationLayerSVG } from '../../lib/designelements.js'
import { PATHS } from '../../lib/iconpaths.js'
import { BUILT_IN, MAX_SHAPES, shapeFrom, nextLibId } from '../../lib/designlibrary.js'

const props = defineProps({
  /** The raffle's own library, as config carries it. */
  library: { type: Object, default: () => ({ shapes: [], colours: [], styles: [] }) },
  /** What is selected on the artboard, so it can be saved. */
  selected: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['place', 'save', 'remove', 'use-colour'])

const naming = ref(false)
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
const full = computed(() => (props.library?.shapes?.length ?? 0) >= MAX_SHAPES)
const whyNoSave = computed(() => {
  if (props.busy) return 'Saving…'
  if (full.value) return `The library holds ${MAX_SHAPES} saved shapes. Remove one to save another.`
  return canSave.value ? '' : 'Select something on the ticket first'
})

function confirmSave() {
  const made = shapeFrom(props.selected, name.value.trim() || 'Saved shape')
  if (!made) return
  emit('save', { ...made, id: nextLibId('s') })
  naming.value = false
  name.value = ''
}
</script>

<template>
<div class="block">
  <h3 class="rubric">Library</h3>

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

  <!-- SAVING IS THE ONE THING HERE THAT NEEDS A WORD, because it needs a name
       typed. Everything else is a click on a picture of itself. -->
  <template v-if="!naming">
    <button class="btn sm" :disabled="!!whyNoSave" :title="whyNoSave || 'Keep the selection to place again'"
            @click="naming = true">
      <Icon name="plus" :size="15" />Save the selection
    </button>
  </template>
  <template v-else>
    <input v-model="name" maxlength="40" placeholder="Call it something"
           @keyup.enter="confirmSave">
    <div class="row">
      <button class="btn sm ghost" @click="naming = false; name = ''">Cancel</button>
      <button class="btn sm primary" :disabled="busy" @click="confirmSave">Save</button>
    </div>
  </template>

  <template v-if="library?.colours?.length">
    <h4 class="rubric">Colours</h4>
    <div class="cols">
      <button
        v-for="c in library.colours" :key="c.id" type="button" class="col"
        :style="{ background: c.value }"
        :title="`${c.name} · ${c.value}`" :aria-label="`Use ${c.name}, ${c.value}`"
        @click="emit('use-colour', c.value)"></button>
    </div>
  </template>

  <p class="say">Click one to place it.</p>
</div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/*
 * A GRID OF PICTURES. Three across in a 240px rail, which is the width at
 * which a rule and a double rule are still telling apart — two across wastes
 * the height a library needs, and four makes a seal a smudge.
 */
.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px }
.tile { position: relative }
.place {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: 100%; padding: 5px 3px 4px;
  border: 1px solid var(--border); border-radius: 8px;
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
  font-size: .68rem;
}
/* The remove control only appears on the tile being pointed at: twelve visible
   delete buttons in a 240px rail is a panel that looks dangerous to use. */
.tx { position: absolute; top: 1px; right: 1px; opacity: 0 }
.tile:hover .tx, .tx:focus-visible { opacity: 1 }

.cols { display: flex; flex-wrap: wrap; gap: 4px }
.col {
  width: 24px; height: 24px; padding: 0;
  border: 1px solid var(--border-strong); border-radius: 6px; cursor: pointer;
}
.col:hover { border-color: var(--brand) }
.col:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px }
</style>
