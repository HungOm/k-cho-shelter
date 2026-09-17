<script setup>
/**
 * The way in.
 *
 * One thing can be missing now: the Google sign-in. There used to be a second —
 * a setup phase asking a volunteer to paste a script.google.com link and a
 * Google app ID before they could even try — and it is gone with the backend
 * that needed it. Whoever is looking at this screen is usually not the person
 * who set the system up, so it asks for as little as it can.
 */
import { ref, onMounted, watch, nextTick } from 'vue'
import Logo from './ui/Logo.vue'
import Bi from './ui/Bi.vue'
import { state } from '../lib/store.js'

const props = defineProps({
  phase: String,          // 'loading' | 'signin' | 'error'
  message: String,
  /*
   * WHICH WAY THE GOOGLE SIGN-IN GOES, and it is the only fork left here.
   *
   * true  — draw Google's own button on this page and trade the credential it
   *         returns for a session. The consent screen names this site.
   * false — hand off to supabase.co and come back. Used when the build has no
   *         Google client id, or somebody asked with ?signin=redirect.
   *
   * There used to be a 'setup' phase above this asking a volunteer to paste a
   * script.google.com link and a Google app ID before they could sign in at
   * all. There is nothing to paste now: the project is built into the bundle.
   */
  gsi: Boolean,
  // A second line for whoever can act on the failure, when the person reading
  // the first one cannot. Shown quietly, in English: it names a dashboard whose
  // own menus are in English, so glossing it would help nobody.
  detail: String,
  notYou: Boolean,        // the failure is a setting, not this person's account
  refused: Boolean        // the account is not on the list, or was turned off
})
const emit = defineEmits(['reset', 'retry', 'signin'])

const gsiTarget = ref(null)

// The Google button is drawn by Google's script into this element, so it has to
// exist in the DOM before we ask for it.
watch(() => props.phase, async p => {
  if (!props.gsi) return
  if (p === 'signin' || p === 'waiting') {
    await nextTick()
    window.__renderGoogleButton?.(gsiTarget.value)
  }
}, { immediate: true })

onMounted(async () => {
  if (!props.gsi) return
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
      <h1>Raffled</h1>
      <p class="muted">Raffle ticket books, sellers and money</p>
      <!-- Config has not loaded before sign-in — whoami has not run yet — so on
           this screen the fallback was not the edge case, it was every load.
           Which made one organisation's name the credit line of every
           deployment. Nothing is the honest answer: a blank space says nothing,
           and a name says something untrue about who is asking for the money. -->
      <p v-if="state.cfg?.orgName" class="tiny muted credit">
        {{ state.cfg.orgName }}
      </p>

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

      <!-- sign in -->
      <div v-if="phase === 'signin'" class="pad">
        <p class="muted small">Sign in with the Google account the organiser approved.</p>
        <!-- The handoff to supabase.co: only when this build has no Google
             client id, or somebody asked for it with ?signin=redirect. -->
        <div v-if="!gsi" class="gsi">
          <button class="btn primary block lg" @click="emit('signin')">
            Continue with Google
          </button>
        </div>
        <div v-else ref="gsiTarget" class="gsi"></div>
      </div>

      <!-- turned away: on the list, or not -->
      <!--
        A refusal and a breakage need opposite things. Somebody who is simply
        not on the list gains nothing from "Try again" — it reloads into the
        same wall — and everything from a way to reach a different Google
        account. Showing both buttons for both cases is how a person ends up
        pressing the useless one, repeatedly, and concluding the app is broken.
      -->
      <div v-else-if="refused" class="pad left">
        <div class="note bad">{{ message }}</div>
        <p class="muted small">
          Nothing is wrong with the app — this account simply has no access yet.
        </p>
        <button class="btn primary block" @click="emit('reset')">
          Sign in with a different account
        </button>
      </div>

      <!-- something went wrong -->
      <div v-else class="pad left">
        <div class="note bad"><Bi :text="message" /></div>
        <!-- Not the same as a breakage and not the same as a refusal: the app
             works, the account is fine, and somebody else has to do something
             before trying again can succeed. Saying so is the whole design —
             an unreadable refusal and a broken app are the same screen, and a
             volunteer who reads it as broken stops and tells nobody. -->
        <p v-if="notYou" class="muted small">
          <Bi text="Nothing is wrong with your phone or your account — tell the organiser." />
        </p>
        <p v-if="detail" class="tiny muted">{{ detail }}</p>
        <div class="row" style="justify-content:center">
          <button class="btn" @click="emit('retry')">Try again</button>
          <button class="btn ghost" @click="emit('reset')">
            Different account
          </button>
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
