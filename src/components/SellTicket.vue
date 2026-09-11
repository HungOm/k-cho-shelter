<script setup>
/**
 * Recording one sale, two ways.
 *
 *   steps — one question per screen, large type, hard to get wrong. The default,
 *           because most people using this will be doing it for the first time.
 *   quick — everything on one card, for whoever is keying in a stack of
 *           counterfoils and already knows the drill.
 *
 * Both enforce the same rule: a sale needs a name and a usable phone number.
 * A sold ticket nobody can telephone is a winner you cannot find.
 */
import { ref, computed, nextTick, watch } from 'vue'
import { state, optimistic, toast, setSellMode, agentMap } from '../lib/store.js'
import { phoneDigits } from '../lib/search.js'
import { money, STATUS_WORDS } from '../lib/format.js'
import Sheet from './ui/Sheet.vue'
import StatusPill from './ui/StatusPill.vue'

const props = defineProps({ ticket: Object })
const emit = defineEmits(['close', 'saved'])

const name = ref(props.ticket?.name || '')
const phone = ref(props.ticket?.phone || '')
const zone = ref(props.ticket?.zone || '')
const reason = ref('')
const step = ref(1)
const busy = ref(false)
const done = ref(false)
const nameBox = ref(null)
const phoneBox = ref(null)

const t = computed(() => props.ticket)
const cfg = computed(() => state.cfg)
const mode = computed(() => state.sellMode)
const isAvailable = computed(() => t.value?.status === 'Available')
const isReserved = computed(() => t.value?.status === 'Reserved')
const isDone = computed(() => ['Sold', 'Donated'].includes(t.value?.status))

const nameOk = computed(() => name.value.trim().length > 0)
const phoneOk = computed(() => phoneDigits(phone.value).length >= 7)
const canSell = computed(() => nameOk.value && phoneOk.value)

const agent = computed(() => agentMap.value[t.value?.agent])

async function focusFirst() {
  await nextTick()
  ;(step.value === 1 ? nameBox.value : phoneBox.value)?.focus()
}
watch(step, focusFirst)
watch(() => props.ticket, focusFirst, { immediate: true })

function next() {
  if (!nameOk.value) return toast('Please write who bought it', 'bad')
  step.value = 2
}

async function sell() {
  if (!canSell.value) return toast('A name and phone number are both needed', 'bad')
  busy.value = true
  try {
    await optimistic(t.value.number, {
      status: 'Sold', name: name.value.trim(), phone: phone.value.trim(),
      zone: zone.value.trim(), payment: 'Paid'
    }, 'sell_ticket', {
      ticketNumber: t.value.number, buyerName: name.value.trim(),
      buyerPhone: phone.value.trim(), buyerZone: zone.value.trim(),
      expectedVersion: t.value.version
    })
    done.value = true
    toast(`${t.value.number} sold`, 'ok')
    setTimeout(() => emit('saved'), 900)
  } catch (err) {
    toast(err.message, 'bad')
  } finally {
    busy.value = false
  }
}

async function hold() {
  if (!nameOk.value) return toast('Who is it being held for?', 'bad')
  busy.value = true
  try {
    await optimistic(t.value.number, {
      status: 'Reserved', name: name.value.trim(), phone: phone.value.trim()
    }, 'reserve_ticket', {
      ticketNumber: t.value.number, buyerName: name.value.trim(),
      buyerPhone: phone.value.trim(), expectedVersion: t.value.version
    })
    toast(`${t.value.number} is being held`, 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad')
  } finally { busy.value = false }
}

async function release() {
  busy.value = true
  try {
    await optimistic(t.value.number, {
      status: 'Available', name: '', phone: '', zone: ''
    }, 'release_ticket', {
      ticketNumber: t.value.number, expectedVersion: t.value.version
    })
    toast(`${t.value.number} is free again`, 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad')
  } finally { busy.value = false }
}

async function correct() {
  if (!reason.value.trim()) return toast('Please say what you are fixing', 'bad')
  busy.value = true
  try {
    await optimistic(t.value.number, {
      name: name.value.trim(), phone: phone.value.trim()
    }, 'correct_ticket', {
      ticketNumber: t.value.number, reason: reason.value.trim(),
      Buyer_Name: name.value.trim(), Buyer_Phone: phone.value.trim(),
      expectedVersion: t.value.version
    })
    toast('Fixed', 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad')
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="t.number" :subtitle="`${t.book}${agent ? ' · ' + agent.name : ''}`" @close="emit('close')">

    <!-- saved -->
    <div v-if="done" class="success">
      <div class="tick">✓</div>
      <h2>Sold</h2>
      <p class="muted">{{ name }} · {{ money(cfg.ticketPrice, cfg.currency) }}</p>
    </div>

    <!-- already sold: fix a mistake -->
    <template v-else-if="isDone">
      <div class="facts">
        <div class="fact"><span>Bought by</span><b>{{ t.name || 'nobody written down' }}</b></div>
        <div class="fact"><span>Phone</span><b>{{ t.phone || 'none' }}</b></div>
        <div class="fact"><span>Book</span><b>{{ t.book }}</b></div>
        <div class="fact"><span>Now</span><StatusPill :status="t.status" /></div>
      </div>
      <div v-if="t.source === 'settlement'" class="note warn">
        This was filled in when the book was counted, so nobody wrote down who bought it.
      </div>
      <hr class="hr">
      <h3>Fix something</h3>
      <div class="field">
        <label for="fn">Who bought it</label>
        <input id="fn" v-model="name" autocomplete="off">
      </div>
      <div class="field">
        <label for="fp">Phone number</label>
        <input id="fp" v-model="phone" type="tel" inputmode="tel" autocomplete="off">
      </div>
      <div class="field">
        <label for="fr">What are you fixing? <span class="req">*</span></label>
        <input id="fr" v-model="reason" placeholder="e.g. phone number was wrong">
        <p class="hint">This is kept in the record so everyone can see what changed.</p>
      </div>
    </template>

    <!-- step by step -->
    <template v-else-if="mode === 'steps'">
      <div class="steps-head">
        <span class="pill brand">Step {{ step }} of 2</span>
        <button class="chip" @click="setSellMode('quick')">Show all at once</button>
      </div>

      <Transition name="slide" mode="out-in">
        <div v-if="step === 1" key="1">
          <h2 class="q">Who bought it?</h2>
          <input ref="nameBox" v-model="name" class="xl" autocomplete="off"
                 placeholder="Their name" @keydown.enter="next">
          <p class="hint">The name on the ticket stub.</p>
        </div>
        <div v-else key="2">
          <h2 class="q">What is their phone number?</h2>
          <input ref="phoneBox" v-model="phone" class="xl" type="tel" inputmode="tel"
                 autocomplete="off" placeholder="012-345 6789" @keydown.enter="sell">
          <p class="hint">Needed so you can call them if they win.</p>
          <div class="field mt">
            <label for="z">Which church or area? <span class="opt">— not required</span></label>
            <input id="z" v-model="zone" autocomplete="off">
          </div>
        </div>
      </Transition>
    </template>

    <!-- everything at once -->
    <template v-else>
      <div class="steps-head">
        <span class="pill">{{ STATUS_WORDS[t.status] }} · {{ money(cfg.ticketPrice, cfg.currency) }}</span>
        <button class="chip" @click="setSellMode('steps')">One at a time</button>
      </div>
      <div class="field">
        <label for="qn">Who bought it? <span class="req">*</span></label>
        <input id="qn" ref="nameBox" v-model="name" autocomplete="off" placeholder="Their name">
      </div>
      <div class="field">
        <label for="qp">Phone number <span class="req">*</span></label>
        <input id="qp" v-model="phone" type="tel" inputmode="tel" autocomplete="off"
               placeholder="012-345 6789" @keydown.enter="sell">
      </div>
      <div class="field">
        <label for="qz">Church or area <span class="opt">— not required</span></label>
        <input id="qz" v-model="zone" autocomplete="off">
      </div>
      <p class="hint">Both the name and the phone number are needed — without them
        you cannot tell this person if they win.</p>
    </template>

    <template #actions>
      <template v-if="done"></template>

      <template v-else-if="isDone">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy" @click="correct">Save the fix</button>
      </template>

      <template v-else-if="isReserved">
        <button class="btn" :disabled="busy" @click="release">Let it go</button>
        <button class="btn primary" :disabled="busy || !canSell" @click="sell">It is sold</button>
      </template>

      <template v-else-if="mode === 'steps' && step === 1">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary lg" :disabled="!nameOk" @click="next">Next →</button>
      </template>

      <template v-else-if="mode === 'steps'">
        <button class="btn" @click="step = 1">← Back</button>
        <button class="btn primary lg" :disabled="busy || !canSell" @click="sell">
          {{ busy ? 'Saving…' : 'Sold · ' + money(cfg.ticketPrice, cfg.currency) }}
        </button>
      </template>

      <template v-else>
        <button class="btn" :disabled="busy || !nameOk" @click="hold">Hold it</button>
        <button class="btn primary" :disabled="busy || !canSell" @click="sell">
          {{ busy ? 'Saving…' : 'Sold · ' + money(cfg.ticketPrice, cfg.currency) }}
        </button>
      </template>
    </template>
  </Sheet>
</template>

<style scoped>
.steps-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 20px; }
.q { font-size: 1.4rem; margin-bottom: 16px; }

.facts { display: grid; gap: 12px; }
.fact { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.fact span { color: var(--muted); }
.fact b { text-align: right; }

.success { text-align: center; padding: 26px 0 10px; }
.success .tick {
  width: 76px; height: 76px; margin: 0 auto 16px; border-radius: 50%;
  background: var(--ok-soft); color: var(--ok);
  display: grid; place-items: center; font-size: 2.4rem; font-weight: 800;
  animation: pop-in .38s var(--ease);
}
@keyframes pop-in { from { transform: scale(.4); opacity: 0 } }
</style>
