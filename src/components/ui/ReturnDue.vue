<script setup>
/**
 * Books that are late, or nearly. Nobody can make it go away.
 *
 * THERE IS NO CLOSE BUTTON, and that is the feature. An alert somebody can tick
 * away is an alert everybody ticks away, and by the one time it matters it has
 * been trained into furniture. This is counted from the books themselves, so it
 * disappears when they come back and at no other moment — there is nothing to
 * dismiss because there is no dismissal to store.
 *
 * SCOPED BY THE SERVER, which is what makes it worth reading. A seller sees
 * their own books; an organiser sees all of them. Showing a seller the whole
 * raffle's overdue count gives them a number they cannot act on, and a number
 * you cannot act on teaches you to skip the banner — the same failure by a
 * politer route.
 *
 * The wording is not one sentence with a count dropped into it. A seller
 * holding one book late and an organiser holding forty need different
 * sentences, and "1 books" is how a volunteer learns the app was not written
 * for them.
 */
import { computed } from 'vue'
import { state, go } from '../../lib/store.js'
import { date } from '../../lib/format.js'
import Bi from './Bi.vue'
import { LINES } from '../../lib/returnlines.js'

const r = computed(() => state.returns || { late: 0, dueSoon: 0, by: '', scope: 'all' })
const mine = computed(() => r.value.scope === 'mine')

/** Late is the louder of the two, so it wins the tone and the sentence. */
const tone = computed(() => (r.value.late ? 'bad' : 'warn'))
const show = computed(() => r.value.late > 0 || r.value.dueSoon > 0)


const headline = computed(() => {
  const { late, dueSoon } = r.value
  const n = late || dueSoon
  const kind = late ? 'late' : 'soon'
  const who = mine.value ? 'Mine' : 'All'
  const many = n === 1 ? 'One' : 'Many'
  return { text: LINES[`${kind}${who}${many}`], vars: { n } }
})

const detail = computed(() => {
  const { late, dueSoon, by } = r.value
  const when = by ? date(by) : ''
  if (late && dueSoon && when) return { text: LINES.alsoDue, vars: { n: dueSoon, when } }
  if (late) return { text: mine.value ? LINES.bringBack : LINES.chase, vars: null }
  if (!when) return { text: mine.value ? LINES.bringBack : LINES.chase, vars: null }
  return { text: mine.value ? LINES.dueByMine : LINES.dueBy, vars: { when } }
})
</script>

<template>
  <!-- No close button, by design. See the note at the top of this file. -->
  <div v-if="show" :class="['note', tone, 'due']" role="status">
    <b><Bi :text="headline.text" :vars="headline.vars" /></b>
    <div class="small"><Bi :text="detail.text" :vars="detail.vars" /></div>
    <button v-if="!mine" class="btn sm mt" @click="go('books')">
      <Bi text="See the books" />
    </button>
  </div>
</template>

<style scoped>
.due { margin-bottom: 14px; }
.mt { margin-top: 8px; }
</style>
