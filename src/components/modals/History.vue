<script setup>
/**
 * The trail, as a sheet you open and close.
 *
 * WHAT MOVED AND WHY. Everything this file used to contain — the fetch, the
 * verbs, the withheld steps, the sale folded in beside the custody — is now
 * `ui/Trail.vue`, because a sold ticket shows the same trail inline and two
 * copies of it is how the sheet and the section come to disagree about what a
 * withheld step looks like. One component draws the trail; this one decides
 * it is a sheet.
 *
 * SO THIS FILE IS DELIBERATELY THIN, and the temptation to put "just one
 * thing" back in it should be read as a sign that the thing belongs in Trail
 * where both readers get it.
 *
 * THE SUBTITLE IS THE ONE FACT THAT CROSSES. A book's sheet says what the
 * book is now, which is only known once the trail has been fetched — and the
 * thing that fetches it is the child. So Trail says when it has loaded and
 * this hears it. A ticket's subtitle needs nothing: it is the book it is in,
 * which the caller already handed us.
 */
import { ref, computed } from 'vue'
import Sheet from '../ui/Sheet.vue'
import Trail from '../ui/Trail.vue'

const props = defineProps({
  /** The book number to trace. Required — a ticket supplies its own book's. */
  book: String,
  /** Optional: the ticket whose sale is being asked about. */
  ticket: Object,
})
const emit = defineEmits(['close'])

const bookNumber = computed(() => props.ticket?.book || props.book || '')

/** Whatever the trail found out about the book, or null until it has. */
const loaded = ref(null)

const subtitle = computed(() => {
  if (props.ticket) return `In ${props.ticket.book}`
  return loaded.value?.status ? `Now: ${loaded.value.status}` : ''
})
</script>

<template>
  <Sheet :title="ticket ? `${ticket.number} — where it has been` : `${bookNumber} — where it has been`"
         :subtitle="subtitle"
         @close="emit('close')">

    <Trail :book="book" :ticket="ticket" @loaded="(b) => { loaded = b }" />

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>
