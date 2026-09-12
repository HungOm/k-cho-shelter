<script setup>
/**
 * The way in.
 *
 * Two things can be missing: the link to the spreadsheet, and a Google sign-in.
 * They are asked for one at a time, in plain words, because whoever is looking
 * at this screen is usually not the person who set the system up.
 */
import { ref, onMounted, watch, nextTick } from 'vue'
import Logo from './ui/Logo.vue'

const props = defineProps({
  phase: String,          // 'loading' | 'setup' | 'signin' | 'error'
  message: String,
  needsClientId: Boolean,
  savedUrl: String
})
const emit = defineEmits(['connect', 'reset', 'retry'])

const url = ref(props.savedUrl || '')
const cid = ref('')
const gsiTarget = ref(null)

function connect() {
  emit('connect', { url: url.value.trim(), cid: cid.value.trim() })
}

// The Google button is drawn by Google's script into this element, so it has to
// exist in the DOM before we ask for it.
watch(() => props.phase, async p => {
  if (p === 'signin' || p === 'waiting') {
    await nextTick()
    window.__renderGoogleButton?.(gsiTarget.value)
  }
}, { immediate: true })

onMounted(async () => {
  if (props.phase === 'signin') {
    await nextTick()
    window.__renderGoogleButton?.(gsiTarget.value)
  }
})
</script>

<template>
  <div class="gate">
    <div class="box">
      <Logo :size="76" big class="mark" />
      <h1>K'Cho Shelter</h1>
      <p class="muted">Raffle ticket record</p>
      <p class="tiny muted credit">K'Cho Ethnic Association Malaysia</p>

      <!-- checking -->
      <div v-if="phase === 'loading'" class="pad">
        <div class="spinner"></div>
        <p class="muted small mt">Just a moment…</p>
      </div>

      <!-- Google is being given a chance to sign them back in. Showing a button
           here would ask for something that is already happening. -->
      <div v-else-if="phase === 'waiting'" class="pad">
        <div class="spinner"></div>
        <p class="muted small mt">Signing you in…</p>
        <div ref="gsiTarget" class="gsi" style="display:none"></div>
      </div>

      <!-- first time on this device -->
      <form v-else-if="phase === 'setup'" class="pad left" @submit.prevent="connect">
        <div class="note info">
          <b>First time on this phone?</b><br>
          Paste the link the organiser sent you.
        </div>
        <div class="field">
          <label for="u">Link to the spreadsheet</label>
          <input id="u" v-model="url" type="url" inputmode="url" autocomplete="off"
                 placeholder="https://script.google.com/…/exec" required>
        </div>
        <div v-if="needsClientId" class="field">
          <label for="c">Google app ID</label>
          <input id="c" v-model="cid" autocomplete="off"
                 placeholder="…apps.googleusercontent.com">
        </div>
        <button class="btn primary block lg" type="submit">Connect</button>
      </form>

      <!-- sign in -->
      <div v-else-if="phase === 'signin'" class="pad">
        <p class="muted small">Sign in with the Google account the organiser approved.</p>
        <div ref="gsiTarget" class="gsi"></div>
        <button class="btn sm ghost mt" @click="emit('reset')">Use a different link</button>
      </div>

      <!-- something went wrong -->
      <div v-else class="pad left">
        <div class="note bad">{{ message }}</div>
        <div class="row" style="justify-content:center">
          <button class="btn" @click="emit('retry')">Try again</button>
          <button class="btn ghost" @click="emit('reset')">Different link</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
.box {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 24px; padding: 36px 28px; max-width: 460px; width: 100%;
  box-shadow: var(--shadow-lg); text-align: center;
}
.mark { margin: 0 auto 14px; }
.credit { margin-top: -2px; }
.box h1 { font-size: 1.5rem; margin-bottom: 2px; }
.pad { margin-top: 26px; }
.left { text-align: left; }
.gsi { display: flex; justify-content: center; margin: 20px 0 6px; min-height: 44px; }
.spinner {
  width: 30px; height: 30px; margin: 0 auto;
  border: 3px solid var(--border); border-top-color: var(--brand);
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
</style>
