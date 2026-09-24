<script setup>
import { ref, computed } from 'vue'
import { state, api, toast, refresh, isSuper } from '../../lib/store.js'
import Sheet from '../ui/Sheet.vue'

/*
 * ONE SHEET, TWO JOBS, because upsert_user has always done both.
 *
 * It is keyed on the email address, so saving an address that already exists
 * UPDATES that account — including the seller it is linked to. That has been
 * true since it was written and there was no way to reach it: the People screen
 * offered "Add someone", and per row Pause and Stop. An account linked to the
 * wrong seller could not be corrected from anywhere in this app.
 *
 * That is not a small gap. The link decides which books a seller may write in,
 * and a mislinked account refuses every sale its owner tries to make while the
 * screen tells them the book is with somebody else — whose name is their own.
 * The only repair was to guess that re-adding the same address would overwrite
 * it.
 */
const props = defineProps({ user: Object })
const emit = defineEmits(['close', 'saved', 'needs-approval'])

/*
 * THE SELLER IS NOT ON THE LIST YET, WHICH ON DAY ONE IS EVERY SELLER.
 *
 * A selling account has to name the seller it belongs to — the server has
 * refused one without since it was written, because their sales would have
 * nobody to credit. This screen asked the question and then offered only people
 * already on the sellers list, with nothing to do about it if the person in
 * front of you was not one. The way through was: cancel, find the Sellers
 * screen, add them, come back, start again, and remember which email you were
 * halfway through typing.
 *
 * So the picker carries one more option, and choosing it opens the rest of what
 * a seller record needs. One press then writes both: the seller, and the
 * account tied to it.
 *
 * ONE NAME FOR BOTH, deliberately. The account's name and the seller's name are
 * the same person, and two boxes that can disagree is how a raffle ends up with
 * books credited to "Amos H." and a login called "Amos Hung". The name above
 * becomes required when a seller is being made here, because a seller without
 * one is what the server refuses next.
 */
const NEW_SELLER = '__new'

const editing = computed(() => !!props.user?.email)

const email = ref(props.user?.email || '')
const name = ref(props.user?.name || '')
const role = ref(props.user?.role || 'recorder')
const agentId = ref(props.user?.agentId || '')
const phone = ref('')
const zone = ref('')
const busy = ref(false)

/** Making the seller here rather than picking one. */
const makingNew = computed(() => role.value === 'agent' && agentId.value === NEW_SELLER)

/*
 * The seller this screen created, kept so a second press cannot make a second
 * one. Adding the account can fail after the seller is written — a mistyped
 * email, an approval the owner has to give — and the obvious thing to do then
 * is fix it and press Add again. Without this, every press leaves another
 * duplicate of the same person on the sellers list.
 */
const madeAgent = ref('')

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
  /*
   * ASKED BEFORE THE PRESS, because the server asks after it.
   *
   * upsert_user refuses a selling account with no seller on it, in a good
   * sentence — and it arrives as a red error on a form that had said nothing,
   * after a round trip, with the picker sitting on "Choose…". The rule is the
   * server's and stays there; this is so nobody meets it.
   */
  if (role.value === 'agent' && !agentId.value) {
    return toast('Which seller is this account for? Pick them, or add them here.', 'bad')
  }
  if (makingNew.value && !name.value.trim()) {
    return toast('What is this seller called? It goes on their books and on the ' +
                 'sellers list, so it cannot be left to the email address.', 'bad')
  }

  busy.value = true
  try {
    /*
     * THE SELLER FIRST, because the account points at it. A new seller is
     * written, its id read back, and that id is what the account is tied to —
     * so the two are linked at the moment they are made rather than by
     * somebody remembering to go back and do it.
     */
    let linked = role.value === 'agent' ? agentId.value : ''
    if (makingNew.value) {
      if (!madeAgent.value) {
        const made = await api('upsert_agent', {
          name: name.value.trim(), phone: phone.value.trim(), zone: zone.value.trim()
        })
        madeAgent.value = String(made?.agentId || '')
        // So the rest of the app — the pickers, the seller list — knows about
        // them without a reload, whatever happens to the account below.
        refresh()
      }
      linked = madeAgent.value
      if (!linked) throw new Error('The seller was not created, so there is nothing to tie the account to.')
    }

    // Built ONCE and used twice. It was spelled out separately for the call and
    // for the approval request, which is two chances for them to say different
    // things — and the approver reads the second one.
    const payload = {
      email: email.value.trim(), role: role.value,
      name: name.value.trim() || email.value.trim(),
      agentId: linked
    }

    try {
      await api('upsert_user', payload)
    } catch (err) {
      // An organiser may ask for a Helper, Seller or viewer; the owner decides.
      // The server wrote the sentence the owner will read, so it is handed back
      // untouched rather than rebuilt here — an approver who is shown a summary
      // the server did not write is approving something else.
      if (err.code === 'APPROVAL_REQUIRED') {
        emit('needs-approval', {
          action: 'upsert_user', payload,
          summary: err.details?.summary || err.message,
          detail: err.details?.detail || null
        })
        return
      }
      throw err
    }

    toast(madeAgent.value
      ? `Saved, and ${name.value.trim()} is on the sellers list`
      : editing.value ? 'Saved' : 'Added', 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="editing ? 'Change this account' : 'Let someone sign in'"
         :subtitle="editing
           ? 'Who they are, and which seller their books belong to.'
           : 'They sign in with this exact Google account.'" @close="emit('close')">
    <div class="field">
      <label for="ue">Their Google email <span class="req">*</span></label>
      <!-- READ-ONLY WHEN EDITING. The address is the key: typing over it here
           would quietly create a SECOND account and leave the first exactly as
           it was, which is the opposite of what somebody came to this sheet to
           do. -->
      <input id="ue" v-model="email" type="email" inputmode="email" autocomplete="off"
             placeholder="name@gmail.com" :readonly="editing" :autofocus="!editing">
    </div>
    <div class="field">
      <label for="un">Their name <span v-if="makingNew" class="req">*</span></label>
      <input id="un" v-model="name" autocomplete="off">
      <p v-if="makingNew" class="hint">
        Goes on the sellers list and every book they carry — the name the raffle will
          chase, print and read out. One name, not two.
      </p>
    </div>

    <label>What can they do?</label>
    <div class="roles">
      <button v-for="r in ROLES" :key="r.v" :class="['role', { on: role === r.v }]" @click="role = r.v">
        <span class="t">{{ r.t }}</span>
        <span class="d">{{ r.d }}</span>
      </button>
    </div>

    <!-- REQUIRED, and said so. The server has always refused a selling account
         with no seller on it; the form asked as though it were optional and let
         the refusal explain, after the press. -->
    <div v-if="role === 'agent'" class="field mt">
      <label for="ua">Which seller are they? <span class="req">*</span></label>
      <select id="ua" v-model="agentId">
        <option value="">Choose…</option>
        <option v-for="a in state.agents" :key="a.id" :value="a.id">{{ a.name }}</option>
        <option :value="NEW_SELLER">＋ Somebody new — add them here</option>
      </select>
      <p class="hint">
        <template v-if="state.agents.length">
          Their sales and their books are credited to this person.
        </template>
        <template v-else>
          Nobody is on the sellers list yet. Choose the last option to add them with
          this account.
        </template>
      </p>
    </div>

    <!-- The rest of what a seller record holds, in this sheet rather than
         behind a cancel-and-come-back. Same three fields as the Add a seller
         form, because it is the same record. -->
    <template v-if="makingNew">
      <div class="note info">
        One press writes both: <b>{{ name.trim() || 'this person' }}</b> joins the sellers
        list, and this Google account is tied to them — so the books they carry and the
        money they hand in land on the person they sign in as.
      </div>
      <div class="field">
        <label for="up">Phone number</label>
        <input id="up" v-model="phone" type="tel" inputmode="tel" autocomplete="off"
               placeholder="012-345 6789">
        <p class="hint">Used to send reminders about books on WhatsApp.</p>
      </div>
      <div class="field">
        <label for="uz">Church or area <span class="opt">— not required</span></label>
        <input id="uz" v-model="zone" autocomplete="off">
      </div>
      <!-- Only after the seller exists. It is the answer to "did that press do
           half of it?", which is the question somebody asks when the account
           fails and the sheet stays open. -->
      <div v-if="madeAgent" class="note ok">
        <b>{{ name.trim() }} is on the sellers list</b> as {{ madeAgent }}. Pressing Add
        again finishes the account and will not add a second copy of them.
      </div>
    </template>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : editing ? 'Save' : 'Add' }}
      </button>
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
