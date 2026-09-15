<script setup>
import { ref, computed } from 'vue'
import { state, api, toast, isSuper } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'saved', 'needs-approval'])

const email = ref('')
const name = ref('')
const role = ref('recorder')
const agentId = ref('')
const busy = ref(false)

const ROLES = computed(() => {
  const list = [
    { v: 'recorder', t: 'Helper', d: 'Can write down sales and look after books' },
    { v: 'agent', t: 'Seller', d: 'Can only touch the books they are holding' },
    { v: 'viewer', t: 'Can only look', d: 'Sees totals, but no phone numbers' }
  ]
  // Only the super admin can create another organiser — or another owner.
  //
  // Owner is offered because the raffle currently has exactly one, and
  // approving a two-person request is something only an owner may do. One
  // unreachable person therefore blocks every approval in the raffle, which is
  // a single point of failure in the control that exists to remove single
  // points of failure. A second owner is the fix; it is deliberately not
  // something an organiser can hand out.
  if (isSuper.value) {
    list.unshift({ v: 'admin', t: 'Organiser', d: 'Can do everything' })
    list.unshift({ v: 'superadmin', t: 'System Admin',
                   d: 'Everything an organiser can do, plus deciding who else signs in' })
  }
  return list
})

async function save() {
  if (!email.value.trim()) return toast('What is their Google email?', 'bad')
  busy.value = true
  try {
    await api('upsert_user', {
      email: email.value.trim(), role: role.value,
      name: name.value.trim() || email.value.trim(),
      agentId: role.value === 'agent' ? agentId.value : ''
    })
    toast('Added', 'ok')
    emit('saved')
  } catch (err) {
    // An organiser may ask for a Helper, Seller or viewer; the owner decides.
    // The server wrote the sentence the owner will read, so it is handed back
    // untouched rather than rebuilt here — an approver who is shown a summary
    // the server did not write is approving something else.
    if (err.code === 'APPROVAL_REQUIRED') {
      emit('needs-approval', {
        action: 'upsert_user',
        payload: {
          email: email.value.trim(), role: role.value,
          name: name.value.trim() || email.value.trim(),
          agentId: role.value === 'agent' ? agentId.value : ''
        },
        summary: err.details?.summary || err.message,
        detail: err.details?.detail || null
      })
      return
    }
    toast(err.message, 'bad', err.code)
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet title="Let someone sign in"
         subtitle="They sign in with this exact Google account." @close="emit('close')">
    <div class="field">
      <label for="ue">Their Google email <span class="req">*</span></label>
      <input id="ue" v-model="email" type="email" inputmode="email" autocomplete="off"
             placeholder="name@gmail.com" autofocus>
    </div>
    <div class="field">
      <label for="un">Their name</label>
      <input id="un" v-model="name" autocomplete="off">
    </div>

    <label>What can they do?</label>
    <div class="roles">
      <button v-for="r in ROLES" :key="r.v" :class="['role', { on: role === r.v }]" @click="role = r.v">
        <span class="t">{{ r.t }}</span>
        <span class="d">{{ r.d }}</span>
      </button>
    </div>

    <div v-if="role === 'agent'" class="field mt">
      <label for="ua">Which seller are they?</label>
      <select id="ua" v-model="agentId">
        <option value="">Choose…</option>
        <option v-for="a in state.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
    </div>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy" @click="save">{{ busy ? 'Adding…' : 'Add' }}</button>
    </template>
  </Sheet>
</template>

<style scoped>
.roles { display: grid; gap: 9px; }
.role {
  text-align: left; padding: 14px 16px; border-radius: var(--r-sm);
  border: 1.5px solid var(--border); background: var(--surface); cursor: pointer;
  transition: border-color .14s, background .14s;
}
.role:hover { border-color: var(--brand); }
.role.on { border-color: var(--brand); background: var(--brand-soft); }
.role .t { display: block; font-weight: 700; }
.role .d { display: block; font-size: .88rem; color: var(--muted); margin-top: 2px; }
</style>
