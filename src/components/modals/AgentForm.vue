<script setup>
import { ref, computed } from 'vue'
import { api, toast, refresh, isAdmin } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ agent: Object })
const emit = defineEmits(['close', 'saved', 'receipt', 'check-in'])

/*
 * The way to a seller's check-in, including one already recorded.
 *
 * The Sellers screen lists the people still to report and gives each a button,
 * which covers the common case. It cannot cover the one that matters when
 * something has gone wrong: a report recorded against the wrong person is, by
 * definition, no longer on that list. Without a way in from the seller
 * themselves, the undo would be unreachable exactly when it is needed.
 */
const canCheckIn = computed(() => isAdmin.value && !!props.agent?.id)

/**
 * When a seller loses their handover paper, this is where someone goes looking
 * for them — by name, not by book number. `booksOut` counts the same books the
 * receipt lists, so the button is there exactly when the sheet has content.
 */
const canPrintReceipt = computed(() =>
  isAdmin.value && !!props.agent?.id && props.agent.booksOut > 0)

const name = ref(props.agent?.name || '')
const phone = ref(props.agent?.phone || '')
const zone = ref(props.agent?.zone || '')
const busy = ref(false)

async function save() {
  if (!name.value.trim()) return toast('What is their name?', 'bad')
  busy.value = true
  try {
    await api('upsert_agent', {
      agentId: props.agent?.id || '',
      name: name.value.trim(), phone: phone.value.trim(), zone: zone.value.trim()
    })
    toast('Saved', 'ok')
    emit('saved')
    refresh()
  } catch (err) { toast(err.message, 'bad', err.code) } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="agent ? 'Edit seller' : 'Add a seller'"
         subtitle="Someone who carries books. No Google account needed." @close="emit('close')">
    <div class="field">
      <label for="an">Their name <span class="req">*</span></label>
      <input id="an" v-model="name" class="xl" autocomplete="off" autofocus>
    </div>
    <div class="field">
      <label for="ap">Phone number</label>
      <input id="ap" v-model="phone" type="tel" inputmode="tel" autocomplete="off" placeholder="012-345 6789">
      <p class="hint">Used to send reminders about books on WhatsApp.</p>
    </div>
    <div class="field">
      <label for="az">Church or area <span class="opt">— not required</span></label>
      <input id="az" v-model="zone" autocomplete="off">
    </div>
    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button v-if="canPrintReceipt" class="btn" @click="emit('receipt', agent.id)">Receipt</button>
      <button v-if="canCheckIn" class="btn" @click="emit('check-in', agent)">
        {{ agent.reportState === 'reported' ? 'Check-in' : 'Reported' }}
      </button>
      <button class="btn primary" :disabled="busy" @click="save">{{ busy ? 'Saving…' : 'Save' }}</button>
    </template>
  </Sheet>
</template>
