<script setup>
/**
 * A dialog that behaves the way each screen size expects: a bottom sheet you
 * can thumb on a phone, a centred panel on a desktop.
 */
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  title: String,
  subtitle: String,
  wide: Boolean
})
const emit = defineEmits(['close'])

function onKey(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div :class="['sheet', { wide }]" role="dialog" aria-modal="true">
      <header v-if="title" class="head">
        <div class="grow">
          <h2>{{ title }}</h2>
          <p v-if="subtitle" class="muted small" style="margin:0">{{ subtitle }}</p>
        </div>
        <button class="x" @click="emit('close')" aria-label="Close">✕</button>
      </header>
      <div class="body"><slot /></div>
      <footer v-if="$slots.actions" class="foot noprint"><slot name="actions" /></footer>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(10, 13, 18, .55); backdrop-filter: blur(3px);
  animation: fade .16s ease;
}
@keyframes fade { from { opacity: 0 } }

.sheet {
  background: var(--surface); width: 100%; max-width: 560px;
  max-height: 92dvh; display: flex; flex-direction: column;
  border-radius: 22px 22px 0 0; box-shadow: var(--shadow-lg);
  animation: rise .24s var(--ease);
}
.sheet.wide { max-width: 860px; }
@keyframes rise { from { transform: translateY(26px); opacity: .4 } }

.head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 20px 20px 14px; border-bottom: 1px solid var(--border);
}
.head h2 { margin: 0; }
.x {
  flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%;
  border: 0; background: var(--surface-2); color: var(--muted);
  font-size: 1rem; cursor: pointer;
}
.x:hover { background: var(--border); color: var(--text); }

.body { padding: 20px; overflow-y: auto; flex: 1; }
/*
 * IT WRAPS, and that is the fix rather than a tidy-up.
 *
 * The footer was a non-wrapping flex row of buttons that each carry
 * `white-space: nowrap` and 44px of padding. A flex item cannot shrink below
 * its min-content width, so `flex: 1` does not save it: five buttons — See its
 * tickets, Where it has been, Sell it whole, Count it in, Close — need roughly
 * 770px against a sheet capped at 560, and the last two simply hung outside the
 * panel.
 *
 * It only appeared for an organiser, because "Count it in" is the fifth button
 * and only an organiser sees it. Four fitted; five did not.
 *
 * flex-wrap is a GUARANTEE, not a measurement: a wrapped line cannot overflow
 * its container horizontally whatever the labels say. That matters more than
 * usual here — the labels are plain English sentences and will be translated,
 * and a fix that depends on them staying short is a fix with an expiry date.
 */
.foot {
  display: flex; flex-wrap: wrap; gap: 10px;
  padding: 16px 20px max(16px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}
/*
 * `1 1 auto`, not `1`. flex-basis:0 makes every button ask for the same width
 * and then refuse to shrink below its text, which is what produced a row of
 * equals AND the overflow. Starting from content width lets them share the
 * space that is actually there and wrap when it runs out.
 */
.foot :deep(.btn) { flex: 1 1 auto; }
/*
 * A way OUT is not an action, and should not be given an action's share of the
 * row. `flex: 1` gave every footer button the same width, so four controls came
 * out identical whatever their weight — a ghost class changed the colour and
 * left the geometry, which is most of what makes a row of buttons read as a row
 * of equals. This one takes only its label's width and sits apart from the
 * things that do something.
 */
.foot :deep(.btn.ghost) { flex: 0 0 auto; margin-left: auto; }

@media (min-width: 700px) {
  .backdrop { align-items: center; }
  .sheet { border-radius: var(--r); max-height: 88dvh; }
  @keyframes rise { from { transform: scale(.97); opacity: .4 } }
}
</style>
