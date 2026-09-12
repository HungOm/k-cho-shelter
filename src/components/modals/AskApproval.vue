<script setup>
/**
 * "This needs a second person."
 *
 * Shown when the server refuses a destructive action outright. The sentence is
 * the server's own — written by the same code that decided approval was needed
 * and that will execute it — so what the approver reads cannot drift from what
 * actually runs.
 */
import { ref } from 'vue'
import { api, toast } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ request: Object })   // {action, payload, summary}
const emit = defineEmits(['close', 'sent'])

const busy = ref(false)
const sent = ref(null)

async function ask() {
  busy.value = true
  try {
    const r = await api('request_approval', { action: props.request.action, payload: props.request.payload })
    sent.value = r
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet title="This needs the organiser" @close="emit('close')">
    <template v-if="sent">
      <div class="center" style="padding:14px 0">
        <div style="font-size:2.6rem">📨</div>
        <h2>Asked</h2>
        <p class="muted">
          The organiser has been asked. Nothing has changed yet — it happens only
          when they say yes.
        </p>
        <p class="tiny muted">The request lapses if nobody answers within a day.</p>
      </div>
    </template>

    <template v-else>
      <div class="note warn">
        <b>{{ request.summary }}</b>
      </div>
      <p>
        Changes this big need two people. You can ask the organiser to approve it —
        they will see exactly the sentence above, and it only happens if they agree.
      </p>
      <p class="muted small">Nothing has been changed.</p>
    </template>

    <template #actions>
      <button v-if="sent" class="btn primary block" @click="emit('sent')">Close</button>
      <template v-else>
        <button class="btn" @click="emit('close')">Leave it</button>
        <button class="btn primary" :disabled="busy" @click="ask">
          {{ busy ? 'Asking…' : 'Ask the organiser' }}
        </button>
      </template>
    </template>
  </Sheet>
</template>
