<script setup>
/**
 * ONE SECTION HEADER, FOR EVERY PANEL IN THE STUDIO.
 *
 * The rubric-plus-action pattern was hand-rolled 38 times across the studio, in
 * three different shapes: a bare `<h3 class="rubric">`, an `<h4>` inside a
 * `.colhead` flex row, and an `<h3>` with a `.count` span after it. They drew
 * almost the same and diverged in the details — margin, gap, where the count
 * sat, whether the action aligned to the label or to the row.
 *
 * WHY A COMPONENT AND NOT JUST A CLASS. A class fixes the drawing and leaves
 * the MARKUP free, which is how three shapes grew from one rule in the first
 * place. The heading level, the order of label, count and action, and the fact
 * that the action is an icon control rather than a worded button are decisions
 * that should be made once. R9 asks that things alike look alike; the reliable
 * way to get that is for them to be the same thing.
 *
 * THE ACTION IS A SLOT, not an `icon`/`label` pair, because the studio's
 * actions carry their own disabled reason (R8) and a slot lets the caller pass
 * the `ToolButton` it already has rather than this component growing a prop for
 * every case.
 */
defineProps({
  /** The section's name. R5 budgets a heading at four words; two is better. */
  label: { type: String, required: true },
  /**
   * How many things are in it. `null` renders nothing — which is NOT the same
   * as `0`, and the difference matters: "0" says the section is empty and was
   * counted, nothing says it does not count. A list shows its count; a group
   * of controls does not.
   */
  count: { type: [Number, String], default: null },
})
</script>

<template>
  <div class="shead">
    <h4 class="rubric">{{ label }}</h4>
    <span class="sfill"></span>
    <!-- THE COUNT SITS RIGHT, BESIDE THE ACTION, because that is where the two
         counts already on this screen sit — "TEMPLATES 2" in the artwork rail
         and the drawn-elements count in the place rail. Putting it next to the
         label read as part of the heading and would have been a third style
         for one idea, which is the thing this component exists to stop. -->
    <span v-if="count !== null" class="scount">{{ count }}</span>
    <!--
      A READOUT, for the headers whose right-hand side is a live figure that
      carries its own tone — "18 / 60" that turns red at the limit, "40%" as a
      watermark strengthens. `count` renders a plain number and cannot express
      that, and these are not `action`s: nothing happens when you press them.

      This is the `.spread` pattern, which is a GLOBAL class (style.css:588)
      that CardInspector had quietly redefined in its own scoped block with a
      different gap and a different baseline — so two components using the same
      class name drew differently. Its callers also each carried an inline
      `style="margin:0"` to cancel the heading's margin, which is the header
      component's job and not a caller's.
    -->
    <slot name="meta" />
    <slot name="action" />
  </div>
</template>

<style scoped src="./studio.css"></style>
