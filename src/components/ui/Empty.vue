<script setup>
/**
 * Empty states that say what is missing and offer the button that fixes it.
 * A blank list with the word "none" teaches a new volunteer nothing.
 */
defineProps({ art: { type: String, default: '📭' }, title: String, action: String })
defineEmits(['action'])
</script>

<template>
  <div class="empty">
    <div class="art">{{ art }}</div>
    <h3>{{ title }}</h3>
    <p><slot /></p>
    <button v-if="action" class="btn primary" @click="$emit('action')">{{ action }}</button>
  </div>
</template>
