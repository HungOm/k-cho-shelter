<script setup>
/**
 * One book as a row in a list: its number, the tickets in it, who has it, and
 * the pills that say what needs doing.
 *
 * WHY IT IS A COMPONENT. The Books screen drew this inline. Find now shows
 * matching books above its tickets, and a book is described the same way
 * wherever it turns up — "Book-0013 · KS-00121–KS-00130 · Mana Kee · 4 sold,
 * 3 days late" — or one screen starts saying something the other does not. The
 * same reason Filters, Pager and StatusPill are components.
 *
 * It is only the tappable part. The row it sits in (the rowpair with the
 * history button beside it) belongs to the list, which knows what else it
 * offers; this draws the book and reports the tap.
 */
import StatusPill from './StatusPill.vue'

defineProps({
  book: { type: Object, required: true },
})
defineEmits(['open'])
</script>

<template>
  <button class="item" @click="$emit('open', book)">
    <span class="grow">
      <span class="lead">{{ book.book }}</span>
      <span class="sub">
        {{ book.firstTicket }}–{{ book.lastTicket }}
        <template v-if="book.agentName"> · {{ book.agentName }}</template>
        <template v-if="book.sold"> · {{ book.sold }} sold</template>
      </span>
    </span>
    <span v-if="book.inReport" class="pill warn">reported</span>
    <span v-if="book.daysOverdue > 0" class="pill bad">{{ book.daysOverdue }} days late</span>
    <StatusPill :status="book.status" kind="book" />
    <span class="chev">›</span>
  </button>
</template>
