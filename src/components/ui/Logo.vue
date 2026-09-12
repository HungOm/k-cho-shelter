<script setup>
/**
 * The CEAM mark.
 *
 * Served at two sizes rather than one: the full 391px original is 156 KB, which
 * is a lot to send to a phone on mobile data for something drawn at 40px. The
 * 96px file covers the interface, the 192px covers a retina screen and the
 * printed receipt.
 */
defineProps({
  size: { type: Number, default: 40 },
  big: Boolean            // print and the sign-in screen, where it is large
})
</script>

<template>
  <img :src="big ? '/ceam-logo-192.png' : '/ceam-logo-96.png'"
       :width="size" :height="size"
       alt="K'Cho Ethnic Association Malaysia"
       class="logo" loading="eager" decoding="async">
</template>

<style scoped>
.logo { display: block; border-radius: 50%; object-fit: contain; flex: 0 0 auto; }
</style>
