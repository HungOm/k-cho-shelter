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
import Bi from './ui/Bi.vue'
import { state } from '../lib/store.js'

const props = defineProps({
  phase: String,          // 'loading' | 'setup' | 'signin' | 'error'
  message: String,
  needsClientId: Boolean,
  savedUrl: String,
  supabase: Boolean,      // sign in through Supabase Auth rather than GIS
  // Supabase too can use the Google button on this page and trade the token it
  // returns, instead of handing off to supabase.co and coming back. Same
  // button, same account; the consent screen names this site rather than the
  // project reference.
  gsi: Boolean,
  // A second line for whoever can act on the failure, when the person reading
  // the first one cannot. Shown quietly, in English: it names a dashboard whose
  // own menus are in English, so glossing it would help nobody.
  detail: String,
  notYou: Boolean,        // the failure is a setting, not this person's account
  refused: Boolean        // the account is not on the list, or was turned off
})
const emit = defineEmits(['connect', 'reset', 'retry', 'signin'])

const url = ref(props.savedUrl || '')
const cid = ref('')
const gsiTarget = ref(null)

function connect() {
  emit('connect', { url: url.value.trim(), cid: cid.value.trim() })
}

// The Google button is drawn by Google's script into this element, so it has to
// exist in the DOM before we ask for it.
watch(() => props.phase, async p => {
  if (props.supabase && !props.gsi) return
  if (p === 'signin' || p === 'waiting') {
    await nextTick()
    window.__renderGoogleButton?.(gsiTarget.value)
  }
}, { immediate: true })

onMounted(async () => {
  if (props.supabase && !props.gsi) return
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
      <!-- The config has not loaded before sign-in, so this falls back to the
           registered name. Once signed in it follows the raffle's settings,
           wherever the chosen backend keeps them. -->
      <p class="tiny muted credit">
        {{ state.cfg?.orgName || "K'Cho Ethnic Association Malaysia" }}
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
        <!-- The handoff to supabase.co: only when this build has no Google
             client id, or somebody asked for it with ?signin=redirect. -->
        <div v-if="supabase && !gsi" class="gsi">
          <button class="btn primary block lg" @click="emit('signin')">
            Continue with Google
          </button>
        </div>
        <div v-else ref="gsiTarget" class="gsi"></div>
        <button v-if="!supabase" class="btn sm ghost mt" @click="emit('reset')">
          Use a different link
        </button>
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
            {{ supabase ? 'Different account' : 'Different link' }}
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
