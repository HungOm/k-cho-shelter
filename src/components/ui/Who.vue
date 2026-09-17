<script setup>
/**
 * A person, named — with the address they sign in under kept underneath.
 *
 * "Written down by helper.someone.oct19@gmail.com" was the whole answer on
 * three screens. It is accurate and it is not how anybody here refers to each
 * other; the name is what somebody needs to go and ask a question, and the
 * address is what they need to tell two people with the same first name apart.
 * So both, in the order a reader wants them.
 *
 * The address stays for a second reason: it is what the record actually holds.
 * A screen that shows only a resolved name hides the fact that the row is keyed
 * on an address, and the day somebody's name changes in app_users the history
 * would silently re-attribute work that was already done.
 */
import { computed } from 'vue'
import { whoIs } from '../../lib/store.js'

const props = defineProps({ email: String })

const who = computed(() => whoIs(props.email))
const line = computed(() => {
  const w = who.value
  if (!w) return null
  // No name on file: the address is all there is, so it is shown once as the
  // name rather than twice as both lines.
  if (!w.name) return { main: w.email, sub: '' }
  return { main: w.you ? `You (${w.name})` : w.name, sub: w.email }
})
</script>

<template>
  <span v-if="line" class="person">
    <b class="nm">{{ line.main }}</b>
    <span v-if="line.sub" class="em">{{ line.sub }}</span>
  </span>
</template>

<style scoped>
/*
 * Stacked, not side by side: these sit in tables and fact rows where the
 * horizontal space is already spoken for, and an address run on after a name
 * pushes the value it belongs to off the edge on a phone.
 */
.person { display: inline-flex; flex-direction: column; line-height: 1.25; }
.em { font-size: .74rem; color: var(--muted); word-break: break-all; }
</style>
