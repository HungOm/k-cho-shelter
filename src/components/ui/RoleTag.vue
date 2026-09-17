<script setup>
/**
 * What somebody is, in one lowercase word after their name.
 *
 * "Brought back by Thang ling" and "Written down by Amos Hung" both answer who.
 * Neither answers why that person and not another, which is the question an
 * organiser has when they are looking at a sale somebody is querying — a helper
 * writing down a desk sale and a seller handing back their own book are
 * different acts, and the names alone read identically.
 *
 * ONE COMPONENT rather than a span in each screen, because the words and the
 * weight have to match wherever they appear. A tag that is grey on one screen
 * and bold on the next reads as two different things.
 *
 * Takes either a `role` from app_users, or `seller` for somebody who carries
 * paper and never signs in — they have no row and no role, and are still a
 * seller. Renders nothing at all when neither is known, which is what keeps an
 * older backend that sends no role from producing an invented one.
 */
import { computed } from 'vue'
import { ROLE_TAG, SELLER_TAG } from '../../lib/format.js'

const props = defineProps({
  role: String,     // a role from app_users: admin, recorder, agent, viewer
  seller: Boolean,  // carries paper, has no sign-in
})

const word = computed(() => (props.seller ? SELLER_TAG : ROLE_TAG[props.role] || ''))
</script>

<template>
  <span v-if="word" class="roletag"> {{ word }}</span>
</template>

<style scoped>
/*
 * Quiet and lighter than the name: it qualifies the name rather than competing
 * with it, and it sits inside the same bold run so it wraps with the name
 * instead of stranding itself on a line of its own.
 */
.roletag { font-weight: 500; font-size: .78rem; color: var(--muted); }
</style>
