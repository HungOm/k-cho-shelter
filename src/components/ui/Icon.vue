<script setup>
/**
 * One stroke-drawn icon set.
 *
 * Emoji were standing in for these. They render differently on every phone,
 * carry their own colour that fights the interface, sit on a different baseline
 * from text, and — next to a real organisation mark — make the whole thing look
 * unfinished. These are one weight, one grid, and they take the colour of
 * whatever they sit in.
 */
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 24 }
})

const PATHS = {
  home:      'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6',
  search:    'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  ticket:    'M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 4v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4v-2ZM9.5 7v11',
  books:     'M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM9 4h4v16H9zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13A1.5 1.5 0 0 1 18.5 20H13z',
  people:    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.8c2.4.6 4 2.4 4 5.2',
  money:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M14.8 9.4c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 2 2.8 2 2.8.8 2.8 2-1.2 2-2.8 2c-1.2 0-2.3-.5-2.8-1.4',
  trophy:    'M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.5v1.5A3.5 3.5 0 0 0 7.6 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16.4 11M12 14v3.5M8.5 20.5h7L15 17.5H9l-.5 3Z',
  gear:      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.4v-.3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 2.7 1.2l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.4 1Z',
  key:       'M14.5 3a6.5 6.5 0 0 1 2.4 12.5L15 21l-2.5-1.5L10 21l-1.5-3 2-2A6.5 6.5 0 0 1 14.5 3ZM15 8.5h.01',
  hand:      'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5.3-3.2L4 15c-.4-.8-.1-1.8.7-2.2.8-.4 1.8-.1 2.2.7L8 15',
  more:      'M5 12h.01M12 12h.01M19 12h.01',
  clock:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  phoneOff:  'M3 3l18 18M9.5 4.5A15 15 0 0 0 19.5 14.5M8 13a15 15 0 0 0 3 3l1.5-1.5a1.5 1.5 0 0 1 1.6-.3l2 .8a1.5 1.5 0 0 1 1 1.4v2.3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 4.3 6.5 1.5 1.5 0 0 1 5.8 5h2.3a1.5 1.5 0 0 1 1.4 1l.8 2a1.5 1.5 0 0 1-.3 1.6L8 13Z',
  check:     'M4.5 12.5 9.5 17.5 19.5 6.5',
  plus:      'M12 5v14M5 12h14',
  bookPlus:  'M5 5.5A1.5 1.5 0 0 1 6.5 4H19v12H6.5A1.5 1.5 0 0 0 5 17.5v-12ZM5 17.5A1.5 1.5 0 0 0 6.5 19H19M12 7.5v5M9.5 10h5'
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false" class="ic">
    <path :d="PATHS[name] || PATHS.more" />
  </svg>
</template>

<style scoped>
.ic { flex: 0 0 auto; display: block; }
</style>
