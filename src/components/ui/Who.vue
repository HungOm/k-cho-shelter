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
 *
 * AND THE ROLE, in one lowercase word after the name. "Written down by Amos
 * Hung" says who to ask; "Amos Hung helper" says why they were the one writing
 * it down, which is the question somebody reading a queried sale actually has.
 * It is absent rather than guessed when the backend does not send one — an
 * older Edge Function sends no role, and a tag invented from nothing would be
 * worse than no tag.
 */
import { computed } from 'vue'
import { whoIs } from '../../lib/store.js'
import RoleTag from './RoleTag.vue'

const props = defineProps({ email: String })

const who = computed(() => whoIs(props.email))
const line = computed(() => {
  const w = who.value
  if (!w) return null
  // No name on file: the address is all there is, so it is shown once as the
  // name rather than twice as both lines.
  if (!w.name) return { main: w.email, sub: '', role: w.role }
  return { main: w.you ? `You (${w.name})` : w.name, sub: w.email, role: w.role }
})
</script>

<template>
  <span v-if="line" class="person">
    <b class="nm">{{ line.main }}<RoleTag :role="line.role" /></b>
    <span v-if="line.sub" class="em">{{ line.sub }}</span>
  </span>
</template>

<style scoped>
/*
 * Stacked, not side by side: these sit in tables and fact rows where the
 * horizontal space is already spoken for, and an address run on after a name
 * pushes the value it belongs to off the edge on a phone.
 */
.person { display: inline-flex; flex-direction: column; gap: 2px; line-height: 1.3; }
/*
 * `break-all` broke an address at whatever character hit the edge, mid-word,
 * even when it would have fitted on the next line. `anywhere` breaks only when
 * there is no other way, so hungom.oct19@gmail.com stays readable until it
 * genuinely cannot.
 */
.em { font-size: .74rem; color: var(--muted); overflow-wrap: anywhere; }
</style>
