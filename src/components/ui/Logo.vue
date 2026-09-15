<script setup>
/**
 * Whoever is running this raffle — their mark, from config, or nothing.
 *
 * It used to be `<img src="/ceam-logo-192.png" alt="K'Cho Ethnic Association
 * Malaysia">`, unconditionally. Not a fallback: every deployment of this system
 * showed one organisation's logo on every screen and on the printed receipt,
 * with that organisation's name as the alt text a screen reader announces. A
 * logo is an identity claim, and that one was made on behalf of somebody who
 * had not made it.
 *
 * NO FALLBACK TO A BUNDLED MARK, deliberately. A default that quietly resolves
 * to the CEAM asset would be the same bug one layer down — correct for this
 * deployment, wrong for every other, and invisible precisely because it looks
 * right here. Same reasoning as the sign-in screen's org name, and as the phone
 * number on the Money screen: a fallback that fires silently means nobody ever
 * discovers the thing it is covering for.
 *
 * TWO SIZES because the original is 156 KB, which is a lot to send to a phone
 * on mobile data for something drawn at 40px. ORG_LOGO_SMALL is optional and
 * falls back to ORG_LOGO — that fallback is about FILE SIZE, not identity, so
 * it cannot show the wrong organisation.
 *
 * WHAT AN UNSET LOGO SHOULD LOOK LIKE IS NOT DECIDED. Today it renders nothing.
 * The open question is whether a fresh deployment with no mark set should show
 * a neutral default instead, because a raffle ticket with no logo looks
 * unofficial to the person being asked for money. That is the organiser's call,
 * not a default to be guessed at in code, and it is the ONLY part of this file
 * that is provisional — the config plumbing is settled either way.
 */
import { computed } from 'vue'
import { state } from '../../lib/store.js'

const props = defineProps({
  size: { type: Number, default: 40 },
  big: Boolean            // print and the sign-in screen, where it is large
})

const src = computed(() => {
  const big = String(state.cfg?.orgLogo ?? '').trim()
  const small = String(state.cfg?.orgLogoSmall ?? '').trim()
  return (props.big ? big : (small || big)) || ''
})

// Their name, or nothing. An empty alt marks the image decorative, which is
// what an unattributed mark is — better than announcing a name that is wrong.
const label = computed(() => String(state.cfg?.orgName ?? '').trim())
</script>

<template>
  <img v-if="src" :src="src" :width="size" :height="size"
       :alt="label" class="logo" loading="eager" decoding="async">
</template>

<style scoped>
.logo { display: block; border-radius: 50%; object-fit: contain; flex: 0 0 auto; }
</style>
