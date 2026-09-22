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
import { SOURCES, SOURCE, FAMILIES, ALIGN, OVERFLOW, nameOf } from '../../lib/ticketelements.js'
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
      <button class="btn sm danger" :title="`Take ${nameOf(element)} off the ticket`"
              @click="emit('remove', element.id)">Remove</button>
    </div>

    <div class="pgroup">
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

    <div class="pgroup">
      <h4 class="rubric">Its box</h4>
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

    <div v-if="element.kind !== 'code'" class="pgroup">
      <h4 class="rubric">How it sits</h4>
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
            <select v-model="element.family">
              <option v-for="f in FAMILIES" :key="f.id" :value="f.id">{{ f.name }}</option>
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

    <div v-if="element.kind !== 'code'" class="pgroup">
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

    <div v-else class="pgroup">
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

    <!-- A CONSEQUENCE, so it keeps `.tiny` while the captions above drop to
         `.say`. The half that surprises people — that digital tickets already
         issued are redrawn from it — leads, and the half that reassures
         follows quietly. -->
    <div class="pgroup saving">
      <h4 class="rubric">What saving changes</h4>
      <p class="tiny">
        Everything printed or sent from now on draws from this, including
        digital tickets already issued.
        <span class="muted">Paper already printed keeps what it had.</span>
      </p>
    </div>
  </template>

  <div v-else class="nothing">
    <p class="rubric">Nothing selected</p>
    <p class="tiny muted">
      Click a box on the ticket, or a name in the list, to change what it prints
      and where it sits.
    </p>
  </div>
</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.panelhead { display: flex; align-items: flex-start; gap: 8px }
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
.panelhead h3 { margin: 2px 0 0; font-size: .95rem }
/* Lettering and Bold are ONE row: the checkbox belongs beside the select it
   qualifies, not under it. Unstyled, they stacked and the panel grew 33px. */
.sitrow { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: end }
.choice.bold { padding-bottom: 6px }
.saving { color: var(--muted) }
/* What happens to this text at its longest -- the whole point of the overflow
   group. Unstyled it was a bare sentence with no tone and no box at all. */
.report { border-radius: 8px; padding: 8px 10px; font-size: .76rem }
.report p { margin: 3px 0 0 }
.report.ok { background: var(--ok-soft); color: var(--ok) }
.report.warn { background: var(--warn-soft); color: var(--warn) }
.report.info { background: var(--info-soft); color: var(--info) }
</style>
