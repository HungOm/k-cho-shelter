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
 * AN UNSET LOGO SHOWS RAFFLED'S OWN MARK, decided by the organiser rather than
 * guessed at here: a raffle ticket with no logo at all looks unofficial to the
 * person being asked for cash, and that costs more than a neutral mark does.
 *
 * It is DRAWN, not fetched, and drawn in var(--brand) — so a deployment that
 * has set its colour but not yet uploaded a logo already looks like itself, a
 * fresh install has a mark on the very first paint with no asset to serve, and
 * the product's own default can never be mistaken for somebody's real logo the
 * way a bundled PNG could.
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

  <!-- A ticket, torn where the stub comes away. aria-hidden because this is the
       product's mark and not a claim about who is running this raffle: naming it
       would put "Raffled" into a screen reader exactly where the organisation
       belongs, and saying nothing beats saying the wrong name. -->
  <svg v-else class="logo" :width="size" :height="size" viewBox="0 0 64 64"
       aria-hidden="true" focusable="false">
    <circle cx="32" cy="32" r="32" fill="var(--brand)" />
    <rect x="12" y="20" width="40" height="24" rx="4" fill="var(--brand-ink)" />
    <circle cx="38" cy="20" r="3.5" fill="var(--brand)" />
    <circle cx="38" cy="44" r="3.5" fill="var(--brand)" />
    <line x1="38" y1="26" x2="38" y2="38" stroke="var(--brand)"
          stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3.5" />
  </svg>
</template>

<style scoped>
.logo { display: block; border-radius: 50%; object-fit: contain; flex: 0 0 auto; }
</style>
