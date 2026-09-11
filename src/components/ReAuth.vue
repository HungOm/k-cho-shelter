<script setup>
/**
 * "Your sign-in has expired."
 *
 * Google ID tokens last one hour and cannot always be renewed without the
 * person doing something — One Tap can be suppressed, and under FedCM the old
 * silent-prompt signals are no longer reliable.
 *
 * So the honest design is to make expiry a one-tap speed bump rather than a
 * crash: this sits on top of the app, keeps every loaded ticket and every
 * half-typed form exactly where it was, and hands the failed request straight
 * back to itself once a new token arrives. Nothing is lost and nothing reloads.
 */
import { ref, onMounted, nextTick } from 'vue'

defineProps({ tried: Boolean })
const target = ref(null)

onMounted(async () => {
  await nextTick()
  window.__renderGoogleButton?.(target.value)
})
</script>

<template>
  <div class="wrap">
    <div class="box">
      <div class="mark">⏰</div>
      <h2>Your sign-in has expired</h2>
      <p class="muted">
        Google signs you out after an hour. Tap below to carry on —
        <b>nothing you have done will be lost.</b>
      </p>
      <div ref="target" class="gsi"></div>
      <p class="tiny muted">
        If no button appears, sign in again from your Google account and reload the page.
      </p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: fixed; inset: 0; z-index: 80;
  display: grid; place-items: center; padding: 24px;
  background: rgba(10, 13, 18, .62); backdrop-filter: blur(4px);
  animation: fade .18s ease;
}
@keyframes fade { from { opacity: 0 } }
.box {
  background: var(--surface); border-radius: 22px; padding: 32px 26px;
  max-width: 420px; width: 100%; text-align: center; box-shadow: var(--shadow-lg);
}
.mark { font-size: 2.8rem; line-height: 1; margin-bottom: 10px; }
.gsi { display: flex; justify-content: center; margin: 22px 0 14px; min-height: 44px; }
</style>
