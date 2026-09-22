<script setup>
/**
 * ONE TOOL. An icon, a name it is announced by, and a sentence on hover.
 *
 * The studio had three of these hand-rolled in `TicketDesign.vue` and the same
 * three again in `DigitalTab.vue` — the markup and the CSS duplicated, line for
 * line, in two files. The organiser's own instruction about that bar was that
 * the tools should be icons with a hover explanation rather than sentences, and
 * the note above the original says the rest of it: **the sentence moved, it did
 * not go.** That is the whole contract of this component, so it is stated once
 * here rather than re-argued at every call site.
 *
 * THREE THINGS IT WILL NOT LET A CALLER GET WRONG, each of them a rule this
 * repository already pays for elsewhere:
 *
 * 1. **A name, always.** An icon-only control with no `aria-label` is a bare
 *    rectangle to anybody not looking at it, and this set is deliberately
 *    language-independent — the drawing is frequently the only thing a reader
 *    of neither language has. `label` is required, and it names what the tool
 *    DOES rather than what state it is in, so the announced name does not
 *    change under somebody mid-press.
 *
 * 2. **The label goes on the BUTTON, never inside the drawing.** A `<title>`
 *    element inside the svg becomes the tooltip of whatever it sits in, which
 *    silently overrides the `title` a disabled control carries its REASON in.
 *    `Icon` is therefore left unlabelled here and hidden from the reader, and
 *    the naming is done out here. icons.test.mjs pins both halves.
 *
 * 3. **Disabled carries its reason.** `why` is the reason and its presence is
 *    what disables — the same shape as `Toggle.vue`, so there is no way to
 *    write a dead control without saying why it is dead. Enabled-then-refused
 *    blames somebody for something the screen knew in advance; hidden makes the
 *    screen differ between people for no stated reason. See permissionui.
 *
 * AND THE STATE IS NOT COLOUR ALONE. `active` lights the icon in the brand, and
 * it also sets `aria-pressed`, because a difference carried only by a hue is
 * one that several readers do not get. `active` defaults to `null` — meaning
 * "this is not a toggle", so a one-shot action like Duplicate is not announced
 * as being permanently off.
 *
 * NOT `--tap`, AND THAT IS DELIBERATE. That token is a correctness constraint
 * for a control a seller presses on a phone outdoors; these are an organiser's
 * desk tools on a screen that refuses to open below tablet width. The studio
 * settled this once already for its three original tools.
 */
import Icon from './Icon.vue'

const props = defineProps({
  /** A name from Icon.vue's set. An unknown one draws the `missing` mark. */
  icon: { type: String, required: true },
  /** What the tool does — "Select", "Bring forward". Announced, and shown when
   *  `wide`. Never the state: "Hide" flips under the reader, "Show or hide"
   *  does not. */
  label: { type: String, required: true },
  /**
   * The sentence. What the three original tools carried in `title`, e.g. "Line
   * a box up with the edges of the other boxes as you drag it". Falls back to
   * the label, so a tool with nothing more to say still names itself on hover.
   */
  hint: { type: String, default: '' },
  /**
   * Lit, and announced as pressed. `null` means this is an action rather than
   * a toggle, and no pressed state is announced at all.
   */
  active: { type: Boolean, default: null },
  /** Why it cannot be pressed. Present means disabled — see the note above. */
  why: { type: String, default: '' },
  /** Show the word beside the drawing. Off by default: a rail is icons. */
  wide: { type: Boolean, default: false },
  size: { type: Number, default: 18 },
})
defineEmits(['click'])

/* The reason wins over the description: somebody hovering a dead control is
   asking why it is dead, not what it would have done. */
const tip = () => props.why || props.hint || props.label
</script>

<template>
  <button
    type="button"
    class="tool"
    :class="{ on: active === true, wide }"
    :aria-pressed="active === null ? null : String(active)"
    :aria-label="label"
    :disabled="!!why"
    :title="tip()"
    @click="$emit('click')"
  >
    <Icon :name="icon" :size="size" />
    <span v-if="wide" class="word">{{ label }}</span>
  </button>
</template>

<style scoped>
/*
 * Lifted from the two identical copies in TicketDesign.vue and DigitalTab.vue.
 * Square when it is an icon, and only wider when it has been given a word —
 * a rail of icons that are each a different width is not a rail.
 */
.tool {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  width: 32px; height: 32px; padding: 0;
  border: 0; border-radius: 8px; background: none;
  color: var(--muted); font-size: .74rem; font-weight: 600;
  cursor: pointer;
}
.tool.wide { width: auto; padding: 0 9px; }
.tool:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
/*
 * ON IS AN INK — AND A FILL AS WELL, BUT ONLY WHEN THERE IS NO WORD.
 *
 * The studio's original three tools lit the icon in --brand and left the button
 * transparent, and the note above them argued it: a filled pill each would have
 * put three lozenges in a bar already holding a zoom stepper and a line of
 * measurements, and the bar would have read as four groups instead of two. That
 * is right, and it is right *because those tools carry their word*. "Snap" in
 * brand beside a magnet is unambiguous with no box at all.
 *
 * An icon-only rail is the other case. Twelve drawings, exactly one of them the
 * mode you are in, and nothing but a hue to say which — a colour change alone
 * does not read as "you are in this mode", and it is the one difference a
 * reader with a red-green deficiency may not get at all. There the selected
 * thing needs a shape.
 *
 * So the fill follows the ABSENCE OF THE WORD rather than a prop. A caller
 * cannot pick the wrong one, because the thing that decides is the same thing
 * that created the problem. --brand-soft is the system's own tint for this and
 * flips with the theme.
 */
.tool.on { color: var(--brand); }
.tool.on:not(.wide) { background: var(--brand-soft); }
.tool.on:hover:not(:disabled) { color: var(--brand); }
.tool.on:not(.wide):hover:not(:disabled) { background: var(--brand-soft); }
.tool:disabled { opacity: .45; cursor: not-allowed; }
.tool:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.word { white-space: nowrap; }
</style>
