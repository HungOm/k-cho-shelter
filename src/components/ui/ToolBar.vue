<script setup>
/**
 * A STRIP OF TOOLS, AND THE GROUPS INSIDE IT.
 *
 * `ToolButton` is one tool; this is the thing they stand in. It exists for two
 * reasons that a plain `<div class="row">` does not give:
 *
 * **It is announced as a toolbar.** `role="toolbar"` with a name tells a screen
 * reader that these belong together and what they are for, so twelve unlabelled
 * rectangles become one named group with twelve controls in it. Without it the
 * rail is read as twelve loose buttons in the middle of a page.
 *
 * **It draws the groups.** A tool rail that is one undivided run of icons makes
 * the reader learn twelve positions. Divided into what-you-are-doing / what-you
 * are-placing / what-you-are-arranging, they learn three. The divider is a
 * hairline, not a gap, because a gap at this density reads as an accident —
 * and the groups are marked up as groups rather than being separated by an
 * empty span, so the structure is there for a reader who cannot see the line.
 *
 * WHY IT TAKES SLOTS RATHER THAN A LIST OF TOOLS. An earlier shape of this took
 * `:tools="[…]"` and rendered them, which reads well until a tool needs a
 * `v-if`, a different size, or a popover hanging off it — at which point the
 * prop grows a `when` field and a `slot` field and becomes a second template
 * language. A slot is already the template language.
 */
defineProps({
  /**
   * What this bar is for — "Drawing tools", "Arrange". Announced as the group's
   * name, and never drawn: the tools carry their own words and a heading over a
   * row of icons is the kind of furniture this redesign is removing.
   */
  label: { type: String, required: true },
  /** A rail stands up; a bar lies along the bottom of the stage. */
  vertical: { type: Boolean, default: false },
})
</script>

<template>
  <div
    class="toolbar"
    :class="{ down: vertical }"
    role="toolbar"
    :aria-label="label"
    :aria-orientation="vertical ? 'vertical' : 'horizontal'"
  >
    <slot />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex; align-items: center; gap: var(--sp-1);
  flex-wrap: wrap; min-width: 0;
}
.toolbar.down { flex-direction: column; flex-wrap: nowrap; }

/*
 * THE DIVIDER IS DRAWN BY THE GROUP, NOT PLACED BETWEEN GROUPS. A separator
 * element between them is one more thing every caller has to remember and get
 * the right way round when the bar turns vertical. `:deep` because the groups
 * arrive through the slot and are therefore not this component's markup — the
 * one place a scoped stylesheet legitimately reaches past itself.
 */
.toolbar :deep(.tgroup) {
  display: flex; align-items: center; gap: var(--sp-1); min-width: 0;
}
.toolbar :deep(.tgroup + .tgroup) {
  margin-left: var(--sp-3); padding-left: var(--sp-3); border-left: var(--rule) solid var(--border);
}
.toolbar.down :deep(.tgroup) { flex-direction: column; }
.toolbar.down :deep(.tgroup + .tgroup) {
  margin: var(--sp-3) 0 0; padding: var(--sp-3) 0 0;
  border-left: 0; border-top: var(--rule) solid var(--border);
}
</style>
