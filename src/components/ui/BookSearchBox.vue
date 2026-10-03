<script setup>
/**
 * The box you type a book into: number, a run like 31-45, a ticket number, or a
 * seller. Used wherever a list or grid of books can be narrowed, so it asks for
 * the same things and is named the same way on every screen.
 *
 * It only draws the box and reports what was typed. The matching is
 * searchBooks() in lib/search.js and the parent applies it, the same split
 * Filters and Pager use: a ui/ component takes its value as a prop and does not
 * reach into the store, which also keeps it renderable against a stubbed one.
 */
defineProps({
  modelValue: { type: String, default: '' },
  placeholder: {
    type: String,
    default: 'Book number, a range like 31-45, a ticket number or a seller',
  },
})
defineEmits(['update:modelValue'])
</script>

<template>
  <div class="row">
    <input :value="modelValue" class="xl grow" type="search"
           :placeholder="placeholder"
           autocomplete="off" autocapitalize="off" spellcheck="false"
           aria-label="Search books"
           @input="$emit('update:modelValue', $event.target.value)">
    <button v-if="modelValue" class="btn sm" @click="$emit('update:modelValue', '')">Clear</button>
  </div>
</template>
