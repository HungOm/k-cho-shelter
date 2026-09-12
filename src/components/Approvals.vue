<script setup>
/**
 * Things waiting on a second person.
 *
 * The organiser sees everybody's requests and decides them; everyone else sees
 * only their own and can withdraw them.
 *
 * Approving executes there and then, under the requester's name, so what was
 * approved is what happens — an approval that merely unlocked the action for
 * later would let the payload change in between.
 */
import { ref, onMounted, computed } from 'vue'
import { api, toast, state } from '../lib/store.js'
import { dateTime, relative } from '../lib/format.js'
import Empty from './ui/Empty.vue'

const rows = ref(null)
const youDecide = ref(false)
const busy = ref('')
const note = ref('')

onMounted(load)

async function load() {
  try {
    const r = await api('list_approvals', {})
    rows.value = r.requests
    youDecide.value = !!r.youDecide
  } catch (err) {
    toast(err.message, 'bad', err.code)
    rows.value = []
  }
}

const pending = computed(() => (rows.value || []).filter(r => r.status === 'Pending'))
const settled = computed(() => (rows.value || []).filter(r => r.status !== 'Pending'))

async function decide(r, approve) {
  busy.value = r.requestId
  try {
    const res = await api('decide_approval', {
      requestId: r.requestId, approve, note: note.value.trim()
    })
    note.value = ''
    if (res.executed) {
      toast(`Done — ${res.summary}`, 'ok')
    } else {
      toast(approve ? 'Approved, but it did not run' : 'Turned down', approve ? 'bad' : '')
    }
    await load()
  } catch (err) {
    // The list can be a moment out of date: a request may have lapsed, been
    // withdrawn, or the person who asked may have lost access since.
    const said = {
      APPROVAL_EXPIRED: 'That request has lapsed. Ask again if it is still needed.',
      NOTHING_TO_DO: 'That one has already been dealt with.',
      REQUESTER_UNAVAILABLE: 'The person who asked no longer has access, so it was not run.',
      REQUESTER_NOT_ALLOWED: 'The person who asked is no longer allowed to do that, so it was not run.'
    }[err.code]
    toast(said || err.message, 'bad', err.code)
    await load()
  } finally {
    busy.value = ''
  }
}

async function withdraw(r) {
  busy.value = r.requestId
  try {
    await api('cancel_approval', { requestId: r.requestId })
    toast('Withdrawn', 'ok')
    await load()
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = '' }
}

const TONE = { Approved: 'ok', Rejected: 'bad', Expired: '', Cancelled: '' }
</script>

<template>
  <div>
    <h1>Waiting for approval</h1>
    <p class="muted">
      {{ youDecide
        ? 'Changes big enough to need two people. Nothing has happened yet.'
        : 'Things you have asked the organiser to approve.' }}
    </p>

    <div v-if="rows === null" class="card">
      <div v-for="i in 2" :key="i" class="skel" style="margin-bottom:10px"></div>
    </div>

    <template v-else-if="pending.length">
      <div v-for="r in pending" :key="r.requestId" class="card req">
        <div class="spread" style="margin-bottom:8px">
          <span class="pill warn">Waiting</span>
          <span class="tiny muted">lapses {{ relative(r.expiresAt) }}</span>
        </div>
        <p class="what">{{ r.summary }}</p>
        <p class="tiny muted">Asked by {{ r.requestedBy }} · {{ dateTime(r.requestedAt) }}</p>

        <div v-if="youDecide" class="mt">
          <input v-model="note" placeholder="A note, if you want (optional)">
          <div class="row mt">
            <button class="btn danger grow" :disabled="busy === r.requestId" @click="decide(r, false)">
              Turn down
            </button>
            <button class="btn primary grow" :disabled="busy === r.requestId" @click="decide(r, true)">
              {{ busy === r.requestId ? 'Working…' : 'Approve and do it' }}
            </button>
          </div>
          <p class="hint">Approving carries it out straight away, in {{ r.requestedBy }}'s name.</p>
        </div>
        <div v-else class="mt">
          <button class="btn" :disabled="busy === r.requestId" @click="withdraw(r)">Withdraw</button>
        </div>
      </div>
    </template>

    <Empty v-else art="✅" title="Nothing waiting">
      {{ youDecide ? 'No one has asked for anything.' : 'You have not asked for anything.' }}
    </Empty>

    <template v-if="settled.length">
      <h3 class="mt">Already dealt with</h3>
      <div class="card flush">
        <ul class="list">
          <li v-for="r in settled.slice(0, 25)" :key="r.requestId">
            <div class="item" style="cursor:default">
              <span class="grow">
                <span class="sub" style="white-space:normal">{{ r.summary }}</span>
                <span class="sub">
                  {{ r.requestedBy }} · {{ dateTime(r.decidedAt || r.requestedAt) }}
                  <template v-if="r.note"> · “{{ r.note }}”</template>
                </span>
              </span>
              <span :class="['pill', TONE[r.status] || '']">{{ r.status }}</span>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.req { border-left: 4px solid var(--warn); }
.what { font-size: 1.08rem; font-weight: 650; line-height: 1.4; }
</style>
