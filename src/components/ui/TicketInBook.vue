<script setup>
/**
 * "Ticket KS-03291 is in Book-0330" — a line you can press to open that book.
 *
 * WHY IT EXISTS. Typing a ticket number into the book search narrowed the grid
 * to the one book, which is correct and easy to miss: a single square among
 * two thousand. People hold a ticket and want its book, so the answer is said
 * in words and is itself the way in. Shown by Home and the Books screen, which
 * is why it is a component and not two copies.
 *
 * It draws and reports; the parent finds the hit (ticketBookOf in lib/search.js)
 * and decides what opening means. No store here, like the other ui/ pieces.
 */
import { BOOK_WORDS } from '../../lib/format.js'

const props = defineProps({
  /** { ticket: 'KS-03291', book: <a book row> } from ticketBookOf. */
  hit: { type: Object, required: true },
})
defineEmits(['open'])

// Where the paper is, said briefly: "With a seller · Mana Kee".
const where = () => {
  const b = props.hit.book
  const bits = [BOOK_WORDS[b.status] || b.status]
  if (b.agentName) bits.push(b.agentName)
  return bits.join(' · ')
}
</script>

<template>
  <button class="note info ticketin" @click="$emit('open', hit.book)">
    <span>
      Ticket <b class="data">{{ hit.ticket }}</b> is in
      <b class="data">{{ hit.book.book }}</b>
      <span class="muted"> · {{ where() }}</span>
    </span>
    <span class="chev" aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
/* A note that is also a button: full width, text left, the arrow at the far end. */
.ticketin {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5);
  width: 100%; text-align: left; border: 0; cursor: pointer; font: inherit;
}
.ticketin:hover { filter: brightness(.97); }
/* No font-size or weight of its own: the arrow takes the line's. A new literal of
   either would be one more value in the scales scales.test.mjs keeps flat. */
.chev { flex: 0 0 auto; }
</style>
