<script setup>
/**
 * Looking at a ticket — one, or the ten in a book — as it will actually print.
 *
 * DRAWN HERE, NOW, AND THROWN AWAY. Nothing about a ticket's appearance is
 * stored: the artwork is one file, the design is a few coordinates, and the
 * ticket itself is a number and a code. Opening this puts them together; closing
 * it discards the result. That is what lets the books screen list a thousand
 * books instantly — nothing is rendered until somebody asks to see one.
 *
 * ONLY WHAT HAS BEEN GENERATED. A ticket with no code has never been printed
 * and cannot be proved genuine, so there is nothing honest to show: it is
 * listed by number instead, with the reason.
 */
import { ref, computed, onMounted } from 'vue'
import { api, toast } from '../../lib/store.js'
import { designFor } from '../../lib/ticketdesign.js'
import { numberLayerSVG, ticketVerifyUrl } from '../../lib/ticketart.js'
import { encode } from '../../lib/qrcodegen.js'
import { date } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ payload: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close', 'print'])

const busy = ref(true)
const err = ref('')
const result = ref(null)

const design = computed(() => (result.value?.template ? designFor(result.value.template) : null))
const tickets = computed(() => result.value?.tickets ?? [])
const missing = computed(() => result.value?.notGenerated ?? [])

const verifyBase = computed(() => {
  const set = String(result.value?.verifyBase || '').trim()
  return set || ((typeof location === 'undefined' ? '' : location.origin) + '/v')
})

const title = computed(() => (props.payload?.book
  ? `Book ${props.payload.book}`
  : String(props.payload?.number ?? 'Ticket')))

function layerFor(t) {
  return numberLayerSVG(design.value, t.number, {
    book: t.book,
    buyer: t.buyer,
    qrUrl: ticketVerifyUrl(verifyBase.value, t.number, t.code),
    encode,
  })
}

onMounted(async () => {
  const scope = props.payload?.book
    ? { book: props.payload.book }
    : { numbers: [props.payload?.number] }
  try {
    /*
     * withBuyer here because this screen is for LOOKING at one ticket — an
     * organiser checking what a sold ticket's stub actually says. Printing a
     * blank book is the other screen, and it asks separately.
     */
    result.value = await api('render_tickets', { ...scope, withBuyer: true })
  } catch (e) {
    err.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
  }
})
</script>

<template>
  <Sheet :title="title" subtitle="As it will print" wide @close="emit('close')">
    <p v-if="busy" class="muted">Drawing…</p>
    <p v-else-if="err" class="note bad">{{ err }}</p>

    <template v-else>
      <p v-if="missing.length" class="note tiny">
        <template v-if="!tickets.length">
          This has never been generated, so it has no code yet and cannot be printed.
        </template>
        <template v-else>
          {{ missing.length }} of these has not been generated yet and is not shown:
          {{ missing.slice(0, 6).join(', ') }}<template v-if="missing.length > 6">, and
          {{ missing.length - 6 }} more</template>.
        </template>
      </p>

      <div v-for="t in tickets" :key="t.number" class="one">
        <div class="ticketpreview">
          <img :src="result.template.url" alt="">
          <div class="overlay" v-html="layerFor(t)"></div>
        </div>
        <p class="tiny muted">
          <b>{{ t.number }}</b> · {{ t.book }} · {{ t.status || 'Available' }}
          · generated {{ t.generatedAt ? date(t.generatedAt) : '—' }}
          · <template v-if="t.printedAt">printed {{ date(t.printedAt) }}</template>
            <template v-else>not printed yet</template>
        </p>
      </div>
    </template>

    <template #actions>
      <button v-if="tickets.length" class="btn" @click="emit('print', payload)">Print</button>
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.one { margin-bottom: 18px }
.ticketpreview { position: relative; width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden }
.ticketpreview img { display: block; width: 100%; height: auto }
.ticketpreview .overlay { position: absolute; inset: 0 }
.ticketpreview .overlay :deep(svg) { width: 100%; height: 100%; display: block }
</style>
