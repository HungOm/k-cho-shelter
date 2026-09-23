<script setup>
/**
 * THE PANEL FOR A SHAPE SOMEBODY DREW.
 *
 * A decoration has more settings than anything else in this studio — a fill
 * that may be flat or a gradient, a stroke with a width and a dash, a corner
 * radius, rotation, opacity, a shadow, a blend mode, and for words a face, a
 * weight, an alignment and tracking. Stacked as groups the way the other two
 * inspectors are, that is a panel somebody scrolls.
 *
 * SO IT IS TABBED, AND THE THREE TABS ARE THE THREE QUESTIONS. Where is it,
 * what is it made of, what is done to it afterwards. That ordering is not
 * cosmetic: it is the order somebody actually works in, and it means the tab
 * they are on says what they are currently deciding.
 *
 * ICONS RATHER THAN WORDS WHERE THE CONTROL IS ITS OWN PICTURE — the fill
 * types, the dashes, the alignments. A word beside a drawing of a dashed line
 * is a word nobody reads. Where a control is a number it keeps its label,
 * because a number with no unit is a number somebody has to go and look up.
 *
 * AND THE CAPTIONS ARE `.say`. This panel was written after the studio's prose
 * cut rather than before it, which is the whole reason it has three tabs and
 * eleven words of explanation instead of a paragraph under every group.
 */
import { computed, ref } from 'vue'
import Icon from '../ui/Icon.vue'
import Ink from '../ui/Ink.vue'
import ToolBar from '../ui/ToolBar.vue'
import ToolButton from '../ui/ToolButton.vue'
import Toggle from '../ui/Toggle.vue'
import Lettering from './Lettering.vue'
import { PATHS } from '../../lib/iconpaths.js'
import { BLENDS, DASHES } from '../../lib/designelements.js'
/*
 * THE FACE NAMES ARE IMPORTED, AND FROM THE PRINTED SIDE'S LIST.
 *
 * This panel used to hard-code "Everyday" and "Serif" — a copy of the names
 * CardInspector uses, which are deliberately NOT the printed side's. That split
 * is a real decision (CardInspector.vue:54-60): a print shop asks which font,
 * nobody asks that of a picture sent on WhatsApp. The copy took the digital
 * words onto the printed tab.
 *
 * Which made the Place rail offer two ways to put words on a printed ticket,
 * one click apart, naming the same font differently:
 *
 *   "Own words" -> beginAdd('text')   -> Inspector           -> "Padauk"
 *   "Words"     -> beginAdd('d:text') -> DecorationInspector -> "Everyday"
 *
 * Same tab, same panel slot — the two are a v-if/v-else pair. So this imports
 * what Inspector imports, and gets the `why` line it never had along with it.
 *
 * This holds because decorations are printed-only TODAY. cardSVG can splice a
 * decoration layer (ticketart.js:1991) but neither card caller passes one, and
 * this panel renders only inside v-if="tab === 'place'". Feed decorations to a
 * card and the question is open again.
 */
import { FAMILIES } from '../../lib/ticketelements.js'

const props = defineProps({
  /** The decoration being edited, or null. Mutated in place, like the others. */
  deco: { type: Object, default: null },
  /** The artboard in pixels, so shares can be shown as something checkable. */
  size: { type: Object, default: () => ({ width: 1000, height: 400 }) },
  swatches: { type: Array, default: () => [] },
  /** The raffle's own colour from Setup, offered first under every picker. */
  brand: { type: String, default: '' },
  canDrop: { type: Boolean, default: false },
  /** What a press will not hold, for THIS shape. Printed tab only. */
  warnings: { type: Array, default: () => [] },
})
const emit = defineEmits(['pick-colour', 'mark', 'pick-image', 'edit-nodes'])

const TABS = [
  { id: 'box', icon: 'position', name: 'Box' },
  { id: 'style', icon: 'design', name: 'Style' },
  { id: 'fx', icon: 'preview', name: 'Effects' },
]
const tab = ref('box')

const px = (k) => Math.round((props.deco?.box?.[k] ?? 0)
  * (k === 'left' || k === 'width' ? props.size.width : props.size.height))

/* A gradient keeps its second colour when the fill is switched back to flat,
   so flipping between them does not lose a choice somebody already made. */
const FILL_ICONS = [
  { id: 'none', icon: 'previewOff', name: 'No fill' },
  { id: 'solid', icon: 'shape', name: 'Flat' },
  { id: 'gradient', icon: 'image', name: 'Gradient' },
]
const DASH_ICONS = { solid: 'minus', dashed: 'more', dotted: 'grid' }

/*
 * THE FOUR BLENDS, AS WORDS. They were four buttons all drawing `layers`, so
 * the only way to tell them apart was to hover each one — four identical
 * pictures is the case the icon rule forbids (UI-STANDARD R4). No drawing can
 * carry "multiply", and four is few enough for a segment (Designing User
 * Interfaces p246).
 */
const BLEND_WORD = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay' }
const BLEND_WHY = {
  normal: 'No mixing at all',
  multiply: 'Ink on paper — the one that behaves on a press the way it does on screen',
  screen: 'Worked out in light. Right on the card, not on paper.',
  overlay: 'Worked out in light. Right on the card, not on paper.',
}

/*
 * THE MARKS SOMEBODY CAN PLACE ARE THE APP'S OWN SET, and that is the whole
 * reason this is cheap. Icon.vue's drawings are strokes on a 24 grid with no
 * colour of their own, which is exactly what a placeable mark has to be — so
 * there is no second library to build, ship or keep in step.
 *
 * `missing` is filtered out: it is the mark shown when a name does not exist,
 * not a drawing anybody would choose.
 */
const MARKS = Object.keys(PATHS).filter((n) => n !== 'missing')

const isText = computed(() => props.deco?.kind === 'text')
const isIcon = computed(() => props.deco?.kind === 'icon')
const isImage = computed(() => props.deco?.kind === 'image')
const isPath = computed(() => props.deco?.kind === 'path')
/* Words for the two picture choices: no drawing tells "whole" from "fill" at
   sixteen pixels, and three and two are few enough for a segment. */
const FITS = [{ id: 'contain', name: 'Whole' }, { id: 'cover', name: 'Fill' }]
const CLIPS = [{ id: 'none', name: 'None' }, { id: 'ellipse', name: 'Oval' }, { id: 'rounded', name: 'Rounded' }]
const hasArea = computed(() => props.deco && props.deco.kind !== 'line')
const kindWord = computed(() => (isText.value ? 'Words' : isIcon.value ? 'Mark'
  : isImage.value ? 'Picture' : isPath.value ? 'Path'
  : props.deco?.kind === 'line' ? 'Rule' : props.deco?.kind === 'ellipse' ? 'Ellipse' : 'Rectangle'))

/* Every change is one undo step, and the parent owns the stack. Called before
   a value moves rather than after, which is the contract `mark` has everywhere
   else in this studio. */
const before = () => emit('mark')

function setShadow(on) {
  before()
  props.deco.shadow = on ? { x: 0, y: 0.004, blur: 0.004, colour: '#000000', opacity: 0.3 } : null
}
</script>

<template>
<aside class="panel">
  <template v-if="deco">
    <div class="phead">
      <span class="pglyph"><Icon :name="isText ? 'type' : isIcon ? 'design' : isImage ? 'image' : isPath ? 'pen' : 'shape'" :size="16" /></span>
      <div class="pname">
        <!-- THE NAME IS THE HEADING, and the heading can be typed into. Empty,
             it shows the kind — what the list calls it — as a placeholder, so
             the panel still says what it is describing before anybody names it. -->
        <input class="title" :value="deco.name" maxlength="40" :placeholder="kindWord"
               aria-label="Name" title="Name it, so the layer list says what it is for"
               @focus="before()" @input="deco.name = $event.target.value.replace(/[<>]/g, '')">
        <p class="say">{{ deco.half === 'stub' ? 'on the stub' : 'on the main half' }}</p>
      </div>
    </div>

    <!-- THREE QUESTIONS, IN THE ORDER SOMEBODY ASKS THEM. -->
    <ToolBar label="What to change" class="dtabs">
      <ToolButton v-for="t in TABS" :key="t.id" :icon="t.icon" :label="t.name"
                  wide :size="15" :active="tab === t.id" @click="tab = t.id" />
    </ToolBar>

    <!-- ---------- where it is ---------- -->
    <div v-show="tab === 'box'" class="pgroup">
      <div class="quad">
        <label v-for="k in ['left', 'top', 'width', 'height']" :key="k" class="formrow">
          <span class="cap">{{ k === 'left' ? 'Left' : k === 'top' ? 'Top' : k === 'width' ? 'Width' : 'Height' }}</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(deco.box[k] * 100).toFixed(1)"
                   @focus="before()"
                   @input="deco.box[k] = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
      </div>
      <!-- Shares are stored; pixels are what somebody checks against the
           picture that comes out. Both, the same as the other two panels. -->
      <p class="mono say">{{ px('left') }}, {{ px('top') }} · {{ px('width') }} &times; {{ px('height') }} px</p>

      <!-- A PATH IS ITS NODES: how many, whether it closes, and the way in to
           shape them. Edit nodes is also a double-click on the path, or A. -->
      <template v-if="isPath">
        <div class="switchrow">
          <span class="cap">{{ deco.path.nodes.length }} nodes · closed</span>
          <Toggle :model-value="deco.path.closed" label="the closing segment" :size="15"
                  @update:model-value="(v) => { before(); deco.path.closed = v }" />
        </div>
        <button class="btn sm" type="button" @click="emit('edit-nodes')">
          <Icon name="node" :size="15" />Edit nodes
        </button>
        <p class="say">Drag a node or a handle · double-click a node for a corner or a curve · ⌥-click the path to add one.</p>
      </template>

      <label class="formrow">
        <span class="cap">Turn</span>
        <span class="wrap">
          <input type="number" step="1" min="-180" max="180" :value="deco.rotation"
                 @focus="before()" @input="deco.rotation = Number($event.target.value)">
          <span class="unit">°</span>
        </span>
      </label>
    </div>

    <!-- ---------- what it is made of ---------- -->
    <div v-show="tab === 'style'" class="pgroup">
      <!-- A PICTURE: the picture itself, how it sits in its box, and what shape
           the box cuts it to. It has no fill and no outline of its own. -->
      <template v-if="isImage">
        <div class="picrow">
          <span class="picthumb"><img :src="deco.image.src" alt=""></span>
          <button class="btn sm" type="button" @click="emit('pick-image')">Change picture</button>
        </div>
        <h4 class="rubric">Fit</h4>
        <div class="seg" role="group" aria-label="How the picture sits in its box">
          <button v-for="f in FITS" :key="f.id" type="button" class="segbtn"
                  :class="{ on: deco.image.fit === f.id }" :aria-pressed="deco.image.fit === f.id"
                  @click="before(); deco.image.fit = f.id">{{ f.name }}</button>
        </div>
        <h4 class="rubric">Clip</h4>
        <div class="seg" role="group" aria-label="What shape the box cuts the picture to">
          <button v-for="c in CLIPS" :key="c.id" type="button" class="segbtn"
                  :class="{ on: deco.image.clip === c.id }" :aria-pressed="deco.image.clip === c.id"
                  @click="before(); deco.image.clip = c.id">{{ c.name }}</button>
        </div>
      </template>
      <template v-if="!isIcon && !isImage">
        <h4 class="rubric">Fill</h4>
        <ToolBar label="Fill">
          <ToolButton v-for="f in FILL_ICONS" :key="f.id" :icon="f.icon" :label="f.name"
                      :size="16" :active="deco.fill.type === f.id"
                      @click="before(); deco.fill.type = f.id" />
        </ToolBar>
        <template v-if="deco.fill.type !== 'none'">
          <Ink :model-value="deco.fill.colour" label="Colour" :swatches="swatches" :brand="brand" :can-drop="canDrop"
               @update:model-value="(v) => { before(); deco.fill.colour = v }"
               @pick="emit('pick-colour', (c) => { before(); deco.fill.colour = c })" />
          <template v-if="deco.fill.type === 'gradient'">
            <Ink :model-value="deco.fill.to" label="To" :swatches="swatches" :brand="brand" :can-drop="canDrop"
                 @update:model-value="(v) => { before(); deco.fill.to = v }"
                 @pick="emit('pick-colour', (c) => { before(); deco.fill.to = c })" />
            <label class="formrow">
              <span class="cap">Angle</span>
              <span class="wrap">
                <input type="number" step="15" min="0" max="359" :value="deco.fill.angle"
                       @focus="before()" @input="deco.fill.angle = Number($event.target.value)">
                <span class="unit">°</span>
              </span>
            </label>
          </template>
        </template>
      </template>

      <h4 v-if="!isImage" class="rubric">{{ isIcon ? 'Mark' : 'Line' }}</h4>
      <template v-if="isIcon">
        <!-- A GRID OF THE APP'S OWN DRAWINGS. Named for a screen reader by
             ToolButton, so 53 unlabelled squares are 53 named controls. -->
        <div class="marks">
          <ToolButton v-for="m in MARKS" :key="m" :icon="m" :label="m" :size="16"
                      :active="deco.icon.name === m"
                      @click="before(); deco.icon.name = m" />
        </div>
        <Ink :model-value="deco.fill.colour" label="Colour" :swatches="swatches" :brand="brand" :can-drop="canDrop"
             @update:model-value="(v) => { before(); deco.fill.colour = v }"
             @pick="emit('pick-colour', (c) => { before(); deco.fill.colour = c })" />
      </template>
      <template v-else-if="!isImage">
        <label class="formrow">
          <span class="cap">Thickness</span>
          <span class="wrap">
            <input type="number" step="0.05" min="0" max="5"
                   :value="(deco.stroke.width * 100).toFixed(2)"
                   @focus="before()"
                   @input="deco.stroke.width = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <template v-if="deco.stroke.width > 0">
          <ToolBar label="Dash">
            <ToolButton v-for="d in DASHES" :key="d" :icon="DASH_ICONS[d]" :label="d"
                        :size="16" :active="deco.stroke.dash === d"
                        @click="before(); deco.stroke.dash = d" />
          </ToolBar>
          <Ink :model-value="deco.stroke.colour" label="Line colour" :swatches="swatches" :brand="brand" :can-drop="canDrop"
               @update:model-value="(v) => { before(); deco.stroke.colour = v }"
               @pick="emit('pick-colour', (c) => { before(); deco.stroke.colour = c })" />
        </template>
      </template>

      <template v-if="isText">
        <h4 class="rubric">Words</h4>
        <input :value="deco.text.value" maxlength="120" placeholder="What it says"
               @focus="before()" @input="deco.text.value = $event.target.value">
        <!-- The lettering control the field inspector uses, so "Own words" and
             "Words" — one click apart on the rail — are lettered alike. This
             one also carries letter spacing, which the model and the renderer
             have held since drawn words were written and nothing could set. -->
        <Lettering :faces="FAMILIES" :family="deco.text.family" :weight="deco.text.weight"
                   :align="deco.text.align" :tracking="deco.text.tracking"
                   @update:family="(v) => { before(); deco.text.family = v }"
                   @update:weight="(v) => { before(); deco.text.weight = v }"
                   @update:align="(v) => { before(); deco.text.align = v }"
                   @update:tracking="(v) => { before(); deco.text.tracking = v }" />
      </template>

      <template v-if="hasArea && !isText && !isIcon && !isPath && (!isImage || deco.image.clip === 'rounded')">
        <label class="formrow">
          <span class="cap">Corners</span>
          <span class="wrap">
            <input type="number" step="1" min="0" max="50"
                   :value="Math.round(deco.radius * 100)"
                   @focus="before()"
                   @input="deco.radius = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <p class="say">50% is a capsule.</p>
      </template>
    </div>

    <!-- ---------- what is done to it afterwards ---------- -->
    <div v-show="tab === 'fx'" class="pgroup">
      <label class="formrow">
        <span class="cap">Opacity</span>
        <span class="wrap">
          <input type="number" step="5" min="0" max="100" :value="Math.round(deco.opacity * 100)"
                 @focus="before()" @input="deco.opacity = Number($event.target.value) / 100">
          <span class="unit">%</span>
        </span>
      </label>

      <!-- A SWITCH, because it takes effect as it is pressed: a tick box says
           "applied when you save", and the shadow is on the ticket at once. -->
      <div class="switchrow">
        <span class="cap">Shadow</span>
        <Toggle :model-value="!!deco.shadow" label="the shadow" :size="15"
                @update:model-value="setShadow" />
      </div>
      <template v-if="deco.shadow">
        <div class="quad">
          <label class="formrow"><span class="cap">Down</span>
            <span class="wrap">
              <input type="number" step="0.1" :value="(deco.shadow.y * 100).toFixed(1)"
                     @focus="before()" @input="deco.shadow.y = Number($event.target.value) / 100">
              <span class="unit">%</span>
            </span>
          </label>
          <label class="formrow"><span class="cap">Blur</span>
            <span class="wrap">
              <input type="number" step="0.1" min="0" :value="(deco.shadow.blur * 100).toFixed(1)"
                     @focus="before()" @input="deco.shadow.blur = Number($event.target.value) / 100">
              <span class="unit">%</span>
            </span>
          </label>
        </div>
      </template>

      <h4 class="rubric">How it mixes</h4>
      <div class="seg" role="group" aria-label="How it mixes">
        <button v-for="b in BLENDS" :key="b" type="button" class="segbtn"
                :class="{ on: deco.blend === b }" :aria-pressed="deco.blend === b"
                :title="BLEND_WHY[b]" @click="before(); deco.blend = b">{{ BLEND_WORD[b] }}</button>
      </div>

      <!--
        WHAT A PRESS WILL NOT HOLD — reported, never refused, and only on the
        printed tab. Every one of these is right on the digital card, which is
        a picture on a lit screen with no press and no grey, and a screen that
        cries wolf about the one place an effect belongs is a screen whose
        warnings get ignored.

        `.tiny bad`, not `.say`: this is a consequence, and the studio's own
        rule is that consequences keep every pixel while captions shrink.
      -->
      <p v-for="(w, i) in warnings" :key="i" class="tiny bad">{{ w }}</p>
    </div>
  </template>

  <div v-else class="nothing">
    <p class="rubric">Nothing selected</p>
    <p class="tiny muted">Draw a shape, or click one.</p>
  </div>
</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/* The tab strip is the panel's own control, so it sits above the first group
   rather than inside one. */
.dtabs { margin-bottom: var(--sp-2) }
/* A heading that can be typed into: set as the heading, with an edge only when
   it is being pointed at or typed in, so it reads as a name and not as a form. */
.title {
  width: 100%; min-height: 0; padding: 0 var(--sp-1); margin-left: calc(-1 * var(--sp-1));
  font-size: var(--fs-sm); font-weight: var(--fw-bold); color: var(--text);
  border: var(--rule) solid transparent; border-radius: var(--r-xs); background: none;
}
.title:hover { border-color: var(--border) }
.title:focus { border-color: var(--brand); outline: none }
/*
 * FIFTY-THREE MARKS IN A 300px PANEL. A grid rather than a wrapping row so the
 * columns line up down the panel — a ragged right edge on a picker this dense
 * reads as a mistake, and the eye scans a grid by column.
 */
.marks {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--sp-1);
  max-height: 170px; overflow: auto;
  padding: var(--sp-2); border: var(--rule) solid var(--border); border-radius: var(--r-sm);
}
/* A label and the switch it names on one line, the switch to the right of it
   (Designing User Interfaces p250). */
.picrow { display: flex; align-items: center; gap: var(--sp-4) }
/* On paper colour whatever the theme: it is judged as it will print. */
.picthumb {
  flex: none; display: grid; place-items: center; width: 72px; height: 48px; overflow: hidden;
  background: var(--paper); border: var(--rule) solid var(--border); border-radius: var(--r-xs);
}
.picthumb img { max-width: 100%; max-height: 100%; object-fit: contain }
.switchrow { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4) }
.switchrow > .cap { font-size: var(--fs-xs); font-weight: var(--fw-medium); color: var(--muted) }
.seg .segbtn { flex: 1 }
</style>
