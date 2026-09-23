<script setup>
/**
 * WHATEVER IS SELECTED ON THE DIGITAL CARD, AND NOTHING ELSE.
 *
 * The same contract as `Inspector.vue` next door, for a different object. It
 * is a separate file rather than a branch inside that one because almost
 * nothing is shared: a printed element has a source, an overflow rule and a
 * fit report against the longest value the designer knows; a card part has a
 * strength, a treatment-wide colour it inherits, and a motto with a character
 * limit. Two of the five groups would have been `v-if="printed"` and the
 * component's job would have become "tell these two apart".
 *
 * IT EDITS THE PART IN PLACE, like its sibling — the box on the canvas and the
 * numbers here are two views of one object, and that is the whole point.
 *
 * WHAT IT DOES NOT OFFER, and why. There is no Remove. A card part is not
 * something an organiser put there; it is part of this app's own drawing of a
 * ticket, and the list of parts is fixed. Hiding one is the whole of "take it
 * off", and it is reversible from the same control, which removal would not
 * be.
 */
import { ref } from 'vue'
import Icon from '../ui/Icon.vue'
import ToolBar from '../ui/ToolBar.vue'
import ToolButton from '../ui/ToolButton.vue'
import { FAMILIES } from '../../lib/ticketelements.js'
import Ink from '../ui/Ink.vue'

const props = defineProps({
  /** The selected part, edited in place. Null when nothing is selected. */
  part: { type: Object, default: null },
  /** The treatment's pixel size, so the box can be read in pixels as well. */
  size: { type: Object, default: () => ({ width: 1200, height: 760 }) },
  /** The raffle's own colour, which is where the card's paper comes from. */
  brand: { type: String, default: '' },
  /*
   * THE COLOUR THE CARD ALREADY PRINTS THIS PART IN, worked out from the
   * raffle's own colour by `cardPalette`. Shown when the part has no colour
   * of its own — which is the normal state, and which the panel used to
   * represent as #FFFFFF because that was a plausible-looking default. Beside
   * a gold motto it was simply untrue, and a colour control that opens on the
   * wrong colour is one somebody changes by accident.
   */
  defaultInk: { type: String, default: '' },
  /** The motto, which belongs to the raffle rather than to the layout. */
  motto: { type: String, default: '' },
  mottoMax: { type: Number, default: 48 },
  /** The watermark part of this treatment, or null where there is none. */
  watermark: { type: Object, default: null },
  swatches: { type: Array, default: () => [] },
  canDrop: { type: Boolean, default: false },
  /** How small one square of the QR lands at the size the card is sent. */
  qrDensity: { type: Object, default: null },
})
const emit = defineEmits(['update:motto', 'pick-colour'])

const ALIGN = [{ id: 'left', name: 'Left' }, { id: 'centre', name: 'Centre' }, { id: 'right', name: 'Right' }]
/*
 * TWO FACES, NOT THE PRINTED SIDE'S TWO. `ticketelements.js` names them Times
 * and Padauk after the fonts, because a print shop asks which font. Nobody
 * asks that of a picture sent on WhatsApp, so they are named for what they are
 * FOR — and the Myanmar chain stays the default, because a raffle whose buyers
 * have Burmese names must not have to discover that the other one drops them.
 */
/*
 * "Figures", not "Serif", ruled by the user 2026-09-23 and relayed through
 * kcho-shelter-51. It is also the name this panel's own reasoning above asks
 * for: the digital side names a face for what it is FOR, and "Serif" names the
 * shape of the letters instead — the printed side's kind of name, on the panel
 * that deliberately does not use them.
 *
 * `stack` is the face each option draws ITSELF in, taken from FAMILIES so the
 * two panels preview from one definition; FAMILIES' copy is pinned against the
 * renderer in tests/ticketart.test.mjs. The NAMES stay this panel's own.
 */
/*
 * TWO TABS, WHERE THERE WERE UP TO SIX STACKED GROUPS — the same change
 * Inspector and DecorationInspector have made. Two rather than three because
 * this panel has no effects: a card part is a box and some lettering.
 *
 * The part-specific extras — the motto's own words, the code's note — live
 * under Style rather than earning a third tab that would be empty for six of
 * the eight parts. A locked part gets no strip at all: there is nothing to
 * choose between.
 */
const TABS = [
  { id: 'box', icon: 'position', name: 'Box' },
  { id: 'style', icon: 'design', name: 'Style' },
]
const tab = ref('box')

const stackOf = (id) => FAMILIES.find((f) => f.id === id)?.stack
const FACES = [
  /* One clause each. The second sentence of both said the same thing the first
     one implied, and these sit under a two-item select where the reader has
     already narrowed it to two. */
  { id: 'text', name: 'Everyday', why: 'Renders Burmese. Use it for anything typed.', stack: stackOf('text') },
  { id: 'number', name: 'Figures', why: 'Figures of one width, so numbers line up. English only.', stack: stackOf('number') },
]

const px = (part, k) => Math.round(part.box[k] * (k === 'left' || k === 'width' ? props.size.width : props.size.height))

/*
 * `<input type="color">` TAKES A HEX AND NOTHING ELSE. Two of the card's four
 * derived colours are `rgba(…)` — the quiet grey and the hairline are the ink
 * at an opacity, so that they work on any brand — and handing one of those to
 * the swatch makes it fall back to black, which is the wrong colour rather
 * than no colour. The captions are white-ish on a dark card, so white is the
 * honest stand-in for them, and the sentence under the control says the card
 * is deciding either way.
 */
const swatchFor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : '#FFFFFF')
const over = () => (props.motto || '').length > props.mottoMax
</script>

<template>
<aside class="panel">
  <template v-if="part">
    <!--
      THE HEAD SAYS WHAT IS SELECTED AND WHERE IT IS, which is two facts a
      panel of percentages cannot give you. The second line is `what` from
      cardelements.js — "below the tear line", "top right" — because a reader
      who has just clicked a box on a card wants to know which half of it they
      are about to drag something out of.
    -->
    <div class="phead">
      <span class="pglyph" :class="part.kind"><Icon :name="part.kind" :size="16" /></span>
      <div class="pname">
        <h3>{{ part.name }}</h3>
        <p class="say">{{ part.what }}</p>
      </div>
      <button
        v-if="!part.locked" type="button" class="hide" :class="{ off: !part.enabled }"
        :aria-pressed="String(!part.enabled)"
        :title="part.enabled
          ? `Take ${part.name} off the card. It stays in the list, so you can put it back.`
          : `Put ${part.name} back on the card`"
        @click="part.enabled = !part.enabled">
        <Icon :name="part.enabled ? 'preview' : 'previewOff'" :size="16" />
      </button>
    </div>

    <!-- No strip on a locked part: there is nothing to choose between. -->
    <ToolBar v-if="!part.locked" label="What to change" class="ctabs">
      <ToolButton v-for="t in TABS" :key="t.id" :icon="t.icon" :label="t.name"
                  wide :size="15" :active="tab === t.id" @click="tab = t.id" />
    </ToolBar>

    <div v-show="tab === 'box'" v-if="!part.locked" class="pgroup">
      <div class="quad">
        <label class="formrow"><span class="cap">Left</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(part.box.left * 100).toFixed(1)"
                   @input="part.box.left = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">Top</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(part.box.top * 100).toFixed(1)"
                   @input="part.box.top = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">Width</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(part.box.width * 100).toFixed(1)"
                   @input="part.box.width = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
        <label class="formrow"><span class="cap">Height</span>
          <span class="wrap">
            <input type="number" step="0.1" :value="(part.box.height * 100).toFixed(1)"
                   @input="part.box.height = Number($event.target.value) / 100">
            <span class="unit">%</span>
          </span>
        </label>
      </div>
      <!-- Shares are what is stored; pixels are what somebody can check against
           the picture that comes out. Both, always — the same rule as the
           printed inspector, and for the same reason. -->
      <p class="mono tiny muted">
        {{ px(part, 'left') }}, {{ px(part, 'top') }} ·
        {{ px(part, 'width') }} &times; {{ px(part, 'height') }} px
      </p>
      <p v-if="part.square" class="say"
         title="A stretched QR is a QR that will not scan, and nobody finds out until somebody is at the door with it.">
        Always square.
      </p>
      <p v-else class="say">Lettering grows with the box.</p>
    </div>

    <div v-show="tab === 'style'" v-if="part.textual" class="pgroup">
      <div class="seg">
        <button v-for="a in ALIGN" :key="a.id" type="button" class="segbtn"
                :class="{ on: part.align === a.id }"
                @click="part.align = a.id">{{ a.name }}</button>
      </div>
      <!--
        BLANK MEANS THE COLOUR THE CARD ALREADY PRINTS THIS IN, which is worked
        out from the raffle's colour so that the lettering is readable on it —
        see brand.js. Setting a value here overrules that arithmetic, so the
        way back has to be a control and not a remembered hex.
      -->
      <Ink :model-value="part.ink || swatchFor(defaultInk)" label="Colour" :swatches="swatches"
           :can-drop="canDrop"
           @update:model-value="(v) => { part.ink = v }"
           @pick="emit('pick-colour', (c) => { part.ink = c })" />
      <p class="say">
        <button v-if="part.ink" type="button" class="linkish"
                title="Go back to the colour worked out from the raffle's own colour, which is readable on it"
                @click="part.ink = ''">Back to the card's own colour</button>
        <template v-else>From the raffle's colour.</template>
      </p>
      <div class="sitrow">
        <label class="formrow"><span class="cap">Lettering</span>
          <span class="wrap">
            <!-- Each option in its own face: this is the control whose whole
                 subject is appearance, and it named two typefaces in words. -->
            <select v-model="part.family" class="faces">
              <option v-for="f in FACES" :key="f.id" :value="f.id"
                      :style="{ fontFamily: f.stack }">{{ f.name }}</option>
            </select>
          </span>
        </label>
        <label class="choice bold">
          <input v-model="part.weight" type="checkbox" true-value="bold" false-value="regular">
          Bold
        </label>
      </div>
      <!-- The second sentence went: it said a caption keeps its own lettering,
           which is a fact about a part nobody has selected. -->
      <p class="say">{{ FACES.find((f) => f.id === part.family)?.why }}</p>
    </div>

    <!--
      THE MOTTO IS NOT PART OF THE LAYOUT and is edited here anyway, because
      this is where somebody is standing when they decide what it should say.
      It belongs to the RAFFLE — one line on every card, whichever treatment —
      where the box around it belongs to this treatment's layout. Two owners,
      one panel, and the sentence under the field says which is which.
    -->
    <div v-show="tab === 'style'" v-if="part.id === 'motto'" class="pgroup">
      <div class="spread">
        <h4 class="rubric" style="margin:0">Text</h4>
        <span class="tiny data" :class="over() ? 'bad' : 'muted'">
          {{ (motto || '').length }} / {{ mottoMax }}
        </span>
      </div>
      <input :value="motto" autocomplete="off" placeholder="e.g. Love is patient, love is kind"
             @input="emit('update:motto', $event.target.value)">
      <!-- The bar is the count again, as a length rather than a number: a
           reader who is typing is watching the field, not the digits. -->
      <span class="meter" :class="{ bad: over() }" aria-hidden="true">
        <span :style="{ width: Math.min(100, ((motto || '').length / mottoMax) * 100) + '%' }"></span>
      </span>
      <!-- The count and the meter above already say the length; a sentence
           repeating it was the label restated. What survives is the fact
           neither of them shows — that the line belongs to the raffle, while
           the box around it belongs to this treatment. -->
      <p class="say"
         title="Longer is refused rather than shrunk: shrinking changes the design where you cannot see it.">
        The same line on every treatment. The box is this one's.
      </p>
    </div>

    <div v-show="tab === 'style'" v-if="part.id === 'code'" class="pgroup">
      <h4 class="rubric">The code</h4>
      <p class="say"
         title="No placeholder underneath it to fight with, unlike the printed ticket — this card is drawn, not photographed.">
        Opens the public check page.
      </p>
      <p v-if="qrDensity" class="tiny" :class="qrDensity.ok ? 'muted' : 'bad'">
        Sent at {{ qrDensity.sentWidth }} px wide, each square of the code lands
        {{ qrDensity.px.toFixed(1) }} px across.
        <template v-if="!qrDensity.ok">
          Under two pixels a square, which phones struggle with once the picture
          has been through a chat twice — make the box bigger.
        </template>
        <template v-else>That reads reliably.</template>
      </p>
    </div>

    <div v-if="part.locked" class="pgroup">
      <h4 class="rubric">The card itself</h4>
      <p class="say">The card itself — it cannot be moved or hidden.</p>
    </div>
  </template>

  <div v-else class="nothing">
    <p class="rubric">Nothing selected</p>
    <p class="tiny muted">
      Click a part of the card, or a name in the list, to move it or change
      how it looks.
    </p>
  </div>

  <!--
    ALWAYS ON, BELOW WHATEVER IS SELECTED, because both of these are facts
    about the whole card rather than about one part of it — and because an
    organiser who has just chosen a colour in Setup comes here to see what it
    did. The colour is a STATEMENT and not a field: it is set in one place, and
    a second control for it here would be two doors to one value.
  -->
  <div class="pgroup cardwide">
    <h4 class="rubric">The card's colour</h4>
    <div class="brandrow">
      <span class="chipcol" :style="{ background: brand || 'var(--brand)' }"></span>
      <b class="data">{{ brand || 'the standard colour' }}</b>
    </div>
    <p class="say"
       title="The lettering on top is worked out for readability rather than chosen, so a pale colour does not produce an unreadable card.">
      From the raffle's theme, in Setup.
    </p>
  </div>

  <div v-if="watermark" class="pgroup">
    <div class="spread">
      <h4 class="rubric" style="margin:0">Watermark</h4>
      <span class="tiny data muted">{{ Math.round(watermark.opacity * 100) }}%</span>
    </div>
    <label class="formrow">
      <span class="cap">Strength</span>
      <input type="range" min="0" max="20" step="1"
             :value="Math.round(watermark.opacity * 100)"
             aria-label="Watermark strength, as a percentage"
             title="A few per cent is the point of it: strong enough that a large flat field does not read as a screen, faint enough that nothing is printed over."
             @input="watermark.opacity = Number($event.target.value) / 100">
    </label>
    <!-- The sentence moved onto the control it is about. A slider showing its
         own percentage above it does not also need a paragraph telling you
         which end of it is right. -->
  </div>

</aside>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
/* The tab strip is the panel's own control, so it sits above the first group
   rather than inside one — the placement its two sibling inspectors use. */
.ctabs { margin-bottom: var(--sp-2) }
.phead { display: flex; align-items: flex-start; gap: 8px }
.phead h3 { margin: 0; font-size: .95rem }
.phead p { margin: 1px 0 0 }
.pname { flex: 1; min-width: 0 }
/* The kind, as the drawing the layer row uses, so the panel and the list name
   the same thing the same way. Its tinting is the list's too. */
.pglyph {
  flex: none; display: grid; place-items: center; width: 26px; height: 26px;
  border-radius: 7px; background: var(--surface-2); color: var(--muted);
}
.pglyph.type { color: var(--warn) }
.pglyph.code { color: var(--info) }
.pglyph.ticket { color: var(--brand) }
.hide {
  flex: none; border: 0; background: none; cursor: pointer; color: var(--muted);
  padding: 4px; border-radius: 7px; line-height: 0;
}
.hide:hover { background: var(--surface-2); color: var(--text) }
.hide.off { color: var(--warn) }
.hide:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px }

.spread { display: flex; align-items: baseline; justify-content: space-between; gap: 8px }
.sitrow { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: end }
.choice.bold { padding-bottom: 6px }
.saving { color: var(--muted) }

/* The character count as a length. --brand until it is over, --bad after, which
   is the colour table's own pairing for "fine" and "will be refused". */
.meter { display: block; height: 3px; border-radius: 2px; background: var(--surface-2); overflow: hidden }
.meter > span { display: block; height: 100%; background: var(--brand) }
.meter.bad > span { background: var(--bad) }

.brandrow { display: flex; align-items: center; gap: 8px }
.chipcol {
  width: 26px; height: 26px; border-radius: 7px; flex: none;
  border: 1px solid var(--border);
}
/* The way back to a derived colour. A button, because it acts; drawn as text,
   because it sits in a sentence. */
.linkish {
  border: 0; background: none; padding: 0; cursor: pointer; font: inherit;
  color: var(--brand); text-decoration: underline;
}
.cardwide { color: var(--muted) }
</style>
