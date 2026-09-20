<script setup>
/**
 * Whether something is shown, as an eye rather than a tick box.
 *
 * The studio's layer list uses a bare `<input type="checkbox">` per row. Card
 * 9b draws an eye, and the eye is also the truer verb: a tick box says "include
 * this in a set", an eye says "show this", and a layer row is about what
 * appears on the ticket.
 *
 * The label is the thing being toggled, never drawn — the row already carries
 * its name, and repeating it would be read twice.
 */
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: true },
  /* The thing this shows or hides, e.g. "Ticket number". Used to build the
     announced label and the hover title. */
  label: { type: String, required: true },
  size: { type: Number, default: 18 },
  /* Why it cannot be pressed. Present means disabled — a control you cannot use
     is shown with its reason rather than hidden. See permissionui. */
  why: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const verb = () => (props.modelValue ? 'Hide' : 'Show')
</script>

<template>
  <button
    type="button"
    class="eye"
    :class="{ off: !modelValue }"
    :aria-pressed="modelValue"
    :aria-label="`${verb()} ${label}`"
    :disabled="!!why"
    :title="why || `${verb()} ${label}`"
    @click="emit('update:modelValue', !modelValue)"
  >
    <!-- previewOff, not phoneOff: the set had no "not shown" drawing when this
         was written, so the hidden state borrowed a crossed-out HANDSET and put
         a telephone beside a ticket field. -->
    <Icon :name="modelValue ? 'preview' : 'previewOff'" :size="size" />
  </button>
</template>

<style scoped>
.eye {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px; background: none;
  color: var(--muted); cursor: pointer;
}
.eye:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
/* Off is quieter, not invisible: the row has to keep reading as a row you can
   turn back on. --muted-2 is 3.03:1, which the system allows for icons. */
.eye.off { color: var(--muted-2); }
.eye:disabled { opacity: .45; cursor: not-allowed; }
.eye:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
</style>
