<script setup>
import { computed } from 'vue'
import { STATUS_WORDS, BOOK_WORDS } from '../../lib/format.js'
import Bi from './Bi.vue'

const props = defineProps({ status: String, kind: { type: String, default: 'ticket' } })

const TONE = {
  Sold: 'ok', Donated: 'info', Reserved: 'warn', Void: 'bad',
  Settled: 'ok', Out: 'info', Returned: 'warn', Lost: 'bad'
}
const tone = computed(() => TONE[props.status] || '')
const word = computed(() =>
  (props.kind === 'book' ? BOOK_WORDS : STATUS_WORDS)[props.status] || props.status)
</script>

<template><span :class="['pill', tone]"><Bi :text="word" inline /></span></template>
