<script setup>
/**
 * WHATEVER IS SELECTED, AND NOTHING ELSE.
 *
 * STUDIO-PLAN phase 2. Each tab used to carry its own permanent panel, so
 * every property of every kind of thing was on screen at once and the panel
 * for the thing you were actually editing was one of three. This is one
 * panel whose contents are the selection: a text element offers its words,
 * its lettering and its colour; a code offers what a code has; nothing
 * selected says so and says how to select something.
 *
 * IT EDITS THE ELEMENT IN PLACE, which is what the boxes on the canvas
 * already did — they are two views of one object and the whole point is that
 * dragging a box and typing a percentage are the same edit. Removing is an
 * event, because that changes which elements exist and the parent owns the
 * list.
 *
 * THE VOCABULARY IS IMPORTED, NOT PASSED. SOURCES, FAMILIES, ALIGN and
 * OVERFLOW are facts about what an element can be, not state — a parent
 * handing them down would be a parent claiming to own them.
 */
import { ref } from 'vue'
import { SOURCES, SOURCE, FAMILIES, ALIGN, OVERFLOW, nameOf } from '../../lib/ticketelements.js'
import ToolBar from '../ui/ToolBar.vue'
import ToolButton from '../ui/ToolButton.vue'
/*
 * THE COLOUR CONTROL, IMPORTED HERE RATHER THAN IN THE PARENT.
 *
 * <Ink> has been in this template since e6db02e, the commit that extracted this
 * file, and has never been imported into it -- the import stayed behind in
 * TicketDesign.vue, where nothing used it. A component in <script setup> that is
 * neither imported nor globally registered does not resolve, and Vue renders an
 * unresolved component as nothing at all rather than as an error. So a text
 * element on a ticket has had no colour control for as long as this file has
 * existed, silently.
 *
 * vue/no-undef-components does not catch it: the rule flags <Inkk>, <Link> and
 * <Logo> in the same file and skips <Ink> by name.
 */
import Ink from '../ui/Ink.vue'

defineProps({
  /** The selected element, edited in place. Null when nothing is selected. */
  element: { type: Object, default: null },
  /** What happens to this one's text at the longest value the designer knows. */
  report: { type: Object, default: null },
  /** For the one sentence that states a printed size in millimetres. */
  sheetWidthMM: { type: Number, default: 190 },
  /** How small a QR module lands at that width, when a code is selected. */
  qrDensity: { type: Object, default: null },
  /*
   * WHERE THE BOX ACTUALLY LANDED, in the template's own pixels, and the
   * millimetres each of those is worth. Both came across in the extraction as
   * template references with nothing behind them, so `v-if="inPixels"` has been
   * permanently false and the printed-size line under the box has never once
   * rendered. They are the parent's to compute -- only it knows the artwork's
   * dimensions -- so they arrive as props.
   */
  inPixels: { type: Object, default: null },
  mmPer: { type: Number, default: 0 },
  /** Colours read off this artwork, offered under the picker. */
  swatches: { type: Array, default: () => [] },
  /** Whether this browser has an EyeDropper to offer at all. */
  canDrop: { type: Boolean, default: false },
  /** Which half of the ticket the box sits on, in the words the list uses. */
  half: { type: String, default: '' },
})
/*
 * `pick-colour` carries the callback rather than a colour, because the parent
 * owns the EyeDropper and this panel owns the element being edited. The parent
 * opens the dropper and calls back with what was picked.
 */
const emit = defineEmits(['remove', 'pick-colour'])

/*
 * SIX STACKED GROUPS BECAME THREE TABS — the change DecorationInspector already
 * made, for the same reason: a panel that answers every question at once
 * answers none of them first. Up to six .pgroups stood on screen together, two
 * of which were not about the selection at all.
 *
 * The three are the three questions in the order somebody asks them: what does
 * it say, where is it, how does it look. It opens on Box, which is what
 * DecorationInspector opens on — the two panels are a v-if/v-else pair in one
 * slot, so opening on different tabs would make the panel appear to jump
 * between two elements that are a click apart. On a code element there is
 * nothing to type, so that tab carries the code's own settings instead.
 *
 * "What saving changes" is gone from here. It was a property of the SAVE
 * BUTTON being shown once per selection, so it repeated the same sentence on
 * every click of every element; it now sits on the button it describes.
 */
const TABS = [
  { id: 'what', icon: 'type', name: 'Prints' },
  { id: 'box', icon: 'position', name: 'Box' },
  { id: 'style', icon: 'design', name: 'Style' },
]
const tab = ref('box')
</script>

<template>
<!--
  THE RIGHT-HAND COLUMN, which is what card 9b draws and what this was before a
  commit built to the superseded card 1b made it a tab body. It is `.panel`
  again: its own box beside the artboard, always present, its contents changing
  with the selection rather than its geometry.

  The half chip stays where the rubric that said "Selected" used to be. The
  column no longer announces itself -- "Selected" was the tab's word, and a
  panel whose first line is the name of the thing it is describing tells you
  more than one that repeats its own title.
-->
<aside class="panel">
  <template v-if="element">
    <div class="panelhead">
      <div>
        <p v-if="half" class="rubric">{{ half }}</p>
        <h3>{{ nameOf(element) }}</h3>
      </div>
      <!--
        DESTRUCTIVE IS NOT BIG AND RED. This was a full-weight danger button in
        the panel's own header, so the loudest thing in a panel about an element
        was the control that deletes it — louder than the element's name beside
        it. It is also the fifth remove in this studio and the only one that was
        not the quiet trash the layer list, the library, the shapes panel and
        the template rail all use.
      -->
      <ToolButton icon="trash" :label="`Remove ${nameOf(element)}`" :size="15"
                  :hint="`Take ${nameOf(element)} off the ticket. Tickets already printed keep it.`"
                  @click="emit('remove', element.id)" />
    </div>

    <!-- THREE QUESTIONS, IN THE ORDER SOMEBODY ASKS THEM. -->
    <ToolBar label="What to change" class="itabs">
      <ToolButton v-for="t in TABS" :key="t.id" :icon="t.icon" :label="t.name"
                  wide :size="15" :active="tab === t.id" @click="tab = t.id" />
    </ToolBar>

    <div v-show="tab === 'what'" class="pgroup">
      <label class="formrow">
        <span class="cap">What it prints</span>
        <span class="wrap">
          <select v-if="element.kind === 'field'" v-model="element.source">
            <option v-for="s in SOURCES" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
          <input v-else-if="element.kind === 'text'" v-model="element.text" type="text"
                 placeholder="The words to print">
          <input v-else type="text" value="The check code behind the QR" disabled
                 title="A code element always prints this ticket's own check code">
        </span>
      </label>
      <p class="say">
        <template v-if="element.kind === 'field'">
          {{ SOURCE[element.source]?.why }}.
        </template>
        <template v-else-if="element.kind === 'text'">
          The same on every ticket from this template.
        </template>
        <template v-else>
          Opens the public check page.
        </template>
      </p>
    </div>

    <div v-show="tab === 'box'" class="pgroup">
      <div class="quad">
        <label class="formrow"><span class="cap">From left</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(element.box.left * 100).toFixed(1)"
                   @input="element.box.left = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">From top</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(element.box.top * 100).toFixed(1)"
                   @input="element.box.top = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">Width</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(element.box.width * 100).toFixed(1)"
                   @input="element.box.width = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">Height</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(element.box.height * 100).toFixed(1)"
                   @input="element.box.height = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
      </div>
      <p v-if="inPixels" class="mono tiny muted">
        {{ inPixels.x }}, {{ inPixels.y }} · {{ inPixels.w }} × {{ inPixels.h }} px
        <template v-if="mmPer">
          · {{ (inPixels.w * mmPer).toFixed(1) }} × {{ (inPixels.h * mmPer).toFixed(1) }} mm printed
        </template>
      </p>
      <p class="say">The bottom edge is the baseline.</p>
    </div>

    <div v-show="tab === 'style'" v-if="element.kind !== 'code'" class="pgroup">
      <div class="seg">
        <button v-for="a in ALIGN" :key="a.id" type="button" class="segbtn"
                :class="{ on: element.align === a.id }"
                @click="element.align = a.id">{{ a.name }}</button>
      </div>
      <!-- A colour needs the swatch, the hex and the dropper side by side;
           squeezed into half a 300px column the hex was truncated. -->
      <Ink v-model="element.ink" label="Colour" :swatches="swatches"
           :can-drop="canDrop" @pick="emit('pick-colour', (c) => { element.ink = c })" />
      <div class="sitrow">
        <label class="formrow"><span class="cap">Lettering</span>
          <span class="wrap">
            <!--
              EACH OPTION IN ITS OWN FACE. This is the one tool on the screen
              whose whole subject is how something looks, and it asked which
              typeface with two words. The picture answers "which one is this";
              the clause below answers "when do I use it". Both, because a name
              is what lets somebody correctly give up when neither fits.
            -->
            <select v-model="element.family" class="faces">
              <option v-for="f in FAMILIES" :key="f.id" :value="f.id"
                      :style="{ fontFamily: f.stack }">{{ f.name }}</option>
            </select>
          </span>
        </label>
        <label class="choice bold">
          <input v-model="element.weight" type="checkbox" true-value="bold" false-value="regular">
          Bold
        </label>
      </div>
      <p class="say">{{ FAMILIES.find((f) => f.id === element.family)?.why }}</p>
    </div>

    <div v-show="tab === 'style'" v-if="element.kind !== 'code'" class="pgroup">
      <h4 class="rubric">When the text is too long</h4>
      <div class="seg">
        <button v-for="o in OVERFLOW" :key="o.id" type="button" class="segbtn"
                :class="{ on: element.overflow === o.id }"
                :title="o.why" @click="element.overflow = o.id">{{ o.name }}</button>
      </div>
      <div v-if="report" class="report" :class="report.tone">
        <b>{{ report.head }}</b>
        <p>{{ report.body }}</p>
      </div>
    </div>

    <div v-show="tab === 'what'" v-else class="pgroup">
      <h4 class="rubric">The code</h4>
      <label class="choice">
        <input v-model="element.backing" type="checkbox">
        <span>White behind it
          <span class="why">The artwork prints its own code here; one over another scans as neither.</span>
        </span>
      </label>
      <p v-if="qrDensity" class="tiny" :class="qrDensity.ok ? 'muted' : 'bad'">
        At {{ sheetWidthMM }} mm wide each square of the code prints
        {{ qrDensity.mm.toFixed(2) }} mm across.
        <template v-if="!qrDensity.ok">
          Small enough that some phones will struggle — make the box bigger.
        </template>
        <template v-else>That reads reliably.</template>
      </p>
    </div>

  </template>

  <div v-else class="nothing">
    <p class="rubric">Nothing selected</p>
    <p class="tiny muted">Click a box, or a name in the list.</p>
  </div>
</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.panelhead { display: flex; align-items: flex-start; gap: var(--sp-4) }
/* The tab strip is the panel's own control, so it sits above the first group
   rather than inside one — the same placement DecorationInspector uses. */
.itabs { margin-bottom: var(--sp-2) }
/* Each option draws in the face it selects. A select's own button text takes
   the CHOSEN option's family in every engine that honours it, so the closed
   control previews too, not just the open list. */
.faces option { font-size: var(--fs-sm) }
/*
 * THESE CAME BACK FROM TicketDesign.vue, stranded when this file took the
 * markup. A child's markup does not inherit a parent's scoped styles -- only
 * the child's ROOT element carries the parent's scope -- so every one of these
 * has been inert since the extraction while looking perfectly correct in the
 * parent's stylesheet. Same cause as the artwork verdict's status dot (3a70895)
 * and as <Ink> never being imported: something did not follow its markup out.
 *
 * The dead copies are still in TicketDesign.vue and are somebody else's file to
 * clean while they hold it. Adding them here is safe either way -- the parent's
 * are inert, so this is the only copy that does anything.
 */
.panelhead h3 { margin: var(--sp-1) 0 0; font-size: var(--fs-sm) }
/* Lettering and Bold are ONE row: the checkbox belongs beside the select it
   qualifies, not under it. Unstyled, they stacked and the panel grew 33px. */
.sitrow { display: grid; grid-template-columns: 1fr auto; gap: var(--sp-3) var(--sp-5); align-items: end }
.choice.bold { padding-bottom: var(--sp-3) }

/* What happens to this text at its longest -- the whole point of the overflow
   group. Unstyled it was a bare sentence with no tone and no box at all. */
.report { border-radius: var(--r-md); padding: var(--sp-4) var(--sp-5); font-size: var(--fs-2xs) }
.report p { margin: var(--sp-1) 0 0 }
.report.ok { background: var(--ok-soft); color: var(--ok) }
.report.warn { background: var(--warn-soft); color: var(--warn) }
.report.info { background: var(--info-soft); color: var(--info) }
</style>
