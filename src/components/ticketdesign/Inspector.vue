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

defineProps({
  /** The selected element, edited in place. Null when nothing is selected. */
  element: { type: Object, default: null },
  /** What happens to this one's text at the longest value the designer knows. */
  report: { type: Object, default: null },
  /** For the one sentence that states a printed size in millimetres. */
  sheetWidthMM: { type: Number, default: 190 },
  /** How small a QR module lands at that width, when a code is selected. */
  qrDensity: { type: Object, default: null },
})
const emit = defineEmits(['remove'])
</script>

<template>
<aside class="panel">
  <template v-if="element">
    <div class="panelhead">
      <div>
        <p class="rubric">Selected</p>
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
      <p class="tiny muted">
        <template v-if="element.kind === 'field'">
          {{ SOURCE[element.source]?.why }}.
        </template>
        <template v-else-if="element.kind === 'text'">
          The same words on every ticket printed from this template.
        </template>
        <template v-else>
          Scanning it opens the public check page for this ticket.
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
      <p class="tiny muted">The bottom edge is the line the lettering sits on.</p>
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
           :can-drop="canDrop" @pick="dropper((c) => { element.ink = c })" />
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
      <p class="tiny muted">{{ FAMILIES.find((f) => f.id === element.family)?.why }}</p>
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
          <span class="why">The artwork prints its own placeholder code here; one drawn over another scans as neither.</span>
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

    <div class="pgroup saving">
      <h4 class="rubric">What saving changes</h4>
      <p class="tiny">
        The design belongs to the template, not to a ticket: everything printed or
        sent from now on draws from it, including digital tickets already issued.
        Paper already printed keeps what it was printed with.
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
</style>
