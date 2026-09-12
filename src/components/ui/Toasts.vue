<script setup>
import { toasts } from '../../lib/store.js'
</script>

<template>
  <div class="toasts noprint" aria-live="polite">
    <TransitionGroup name="pop">
      <div v-for="t in toasts" :key="t.id" :class="['toast', t.tone]">
        <span class="ic">{{ t.tone === 'bad' ? '⚠️' : t.tone === 'ok' ? '✅' : 'ℹ️' }}</span>
        <span class="grow">
          {{ t.message }}
          <span v-if="t.my" class="my" lang="my">{{ t.my }}</span>
        </span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(86px + env(safe-area-inset-bottom)); z-index: 90;
  display: flex; flex-direction: column; gap: 8px; align-items: center;
  width: calc(100% - 32px); max-width: 440px; pointer-events: none;
}
.toast {
  display: flex; align-items: center; gap: 10px;
  background: var(--text); color: var(--bg);
  padding: 14px 20px; border-radius: 999px;
  font-size: .95rem; font-weight: 650; box-shadow: var(--shadow-lg);
}
.toast.bad { background: var(--bad); color: #fff; }
.toast.ok  { background: var(--ok);  color: #fff; }
.toast .ic { font-size: 1.1rem; }
.toast .my {
  display: block;
  font-family: 'Padauk', 'Noto Sans Myanmar', 'Myanmar Text', sans-serif;
  font-size: .82em; font-style: italic; opacity: .8; line-height: 1.45; margin-top: 2px;
}
.toast .grow { min-width: 0; }
@media (min-width: 900px) { .toasts { bottom: 28px; } }
</style>
