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
import { state, optimistic, toast, setSellMode, agentMap, whereIs, sellBlock, sellOverrideNeeded, isSold } from '../lib/store.js'
import { phoneDigits } from '../lib/search.js'
import { money, STATUS_WORDS, plainName, isSellerContact, COUNTED_IN_HELP } from '../lib/format.js'
import Sheet from './ui/Sheet.vue'
import RoleTag from './ui/RoleTag.vue'
import StatusPill from './ui/StatusPill.vue'
import Bi from './ui/Bi.vue'
import History from './modals/History.vue'
import Who from './ui/Who.vue'

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
const isDone = computed(() => isSold(t.value))

const nameOk = computed(() => name.value.trim().length > 0)
const phoneOk = computed(() => phoneDigits(phone.value).length >= 7)
const canSell = computed(() => nameOk.value && phoneOk.value)

const agent = computed(() => agentMap.value[t.value?.agent])
const place = computed(() => whereIs(t.value))

/*
 * IS THIS BOOK IN MY OWN HANDS?
 *
 * Every warning below is written for somebody looking at a ticket that is
 * SOMEWHERE ELSE — 200km away in a seller's bag, possibly already sold on
 * paper. Shown to the seller who is holding it, it says "this one is with TEST"
 * to TEST, and tells them to check with themselves before selling it. Reported
 * exactly that way, from their own account, while the sale worked perfectly.
 */
const mine = computed(() =>
  !!state.user?.agentId && place.value?.agentId === state.user.agentId)

/**
 * Set when the backend will REFUSE this sale, not merely when it is unwise.
 *
 * The warning below it has always said "check with them first" — advice, with
 * the button still live. This is the harder case: the book is not here, and
 * pressing Sold produces an error rather than a sale. Saying so before the
 * press, and taking the button away, is the difference between a rule and a
 * trap.
 */
const blocked = computed(() => (done.value ? null : sellBlock(t.value)))

/**
 * WRITING INTO A BOOK SOMEBODY ELSE IS CARRYING, which an organiser may do and
 * which now says why.
 *
 * The note underneath has always warned that the seller may have sold this
 * already — advice, with the button live. That was the whole of the record:
 * "sold", credited to the holder, indistinguishable from a sale invented at
 * this desk, which the seller meets at settlement with nothing to check it
 * against. The sentence goes into the book's own trail, where they will see it.
 *
 * A SEPARATE FIELD FROM `reason`, which belongs to the correction flow in the
 * already-sold branch. One ref serving two unrelated questions is how a
 * sentence typed about a spelling correction ends up on somebody's book.
 */
const onBehalf = ref('')
const needsReason = computed(() => !done.value && !blocked.value && sellOverrideNeeded(t.value))

/*
 * On top of this sheet, not instead of it: the answer to "who had this?" is
 * something you check and come back from, and losing the ticket you were
 * looking at to read it is how a screen stops being worth opening.
 */
const showHistory = ref(false)

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
  if (needsReason.value && !onBehalf.value.trim()) {
    return toast('Say why you are recording this for them', 'bad')
  }
  busy.value = true
  try {
    await optimistic(t.value.number, {
      status: 'Sold', name: name.value.trim(), phone: phone.value.trim(),
      zone: zone.value.trim(), payment: 'Paid'
    }, 'sell_ticket', {
      ticketNumber: t.value.number, buyerName: name.value.trim(),
      buyerPhone: phone.value.trim(), buyerZone: zone.value.trim(),
      reason: onBehalf.value.trim(), expectedVersion: t.value.version
    })
    done.value = true
    toast(`${t.value.number} sold`, 'ok')
    setTimeout(() => emit('saved'), 900)
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}

async function hold() {
  if (!nameOk.value) return toast('Who is it being held for?', 'bad')
  // Holding a number in somebody else's book has the same hazard as selling one
  // out of it — two people believe they have it — so it asks the same question.
  if (needsReason.value && !onBehalf.value.trim()) {
    return toast('Say why you are holding this one from their book', 'bad')
  }
  busy.value = true
  try {
    await optimistic(t.value.number, {
      status: 'Reserved', name: name.value.trim(), phone: phone.value.trim()
    }, 'reserve_ticket', {
      ticketNumber: t.value.number, buyerName: name.value.trim(),
      buyerPhone: phone.value.trim(), reason: onBehalf.value.trim(),
      expectedVersion: t.value.version
    })
    toast(`${t.value.number} is being held`, 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad', err.code)
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
    toast(err.message, 'bad', err.code)
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
      // ONE SPELLING NOW. This sent Buyer_Name AND buyerName, because the two
      // backends disagreed about this one action: the spreadsheet read sheet
      // column names, the Edge Function read camelCase, and each ignored the
      // other's — so a correction carrying only one silently did nothing on the
      // backend it was not speaking to. It came back "No changed fields were
      // supplied", which was true and useless.
      //
      // The handler still accepts the sheet spellings as aliases, so a stale
      // cached bundle sending them keeps working. Nothing sends them any more.
      buyerName: name.value.trim(), buyerPhone: phone.value.trim(),
      expectedVersion: t.value.version
    })
    toast('Fixed', 'ok')
    emit('saved')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="t.number" :subtitle="`${t.book}${agent ? ' · ' + agent.name : ''}`" @close="emit('close')">

    <!-- An unsold ticket in a book somebody is carrying is not free stock. It
         is 200km away, and it may already have been sold on paper. -->
    <!-- `!mine` on both: the stubs are in this person's hand, so none of what
         follows is true of them. -->
    <div v-if="!mine && blocked && place?.out && t.status === 'Available'" class="note bad">
      <b>This one is with {{ place.agentName || place.agentId }}.</b>
      The ticket itself is not here, so it cannot be sold from this screen —
      they may already have sold it in person. If the book is back, ask an
      organiser to mark it returned first.
    </div>
    <div v-else-if="!mine && !done && place?.out && t.status === 'Available'" class="note warn">
      <b>This one is with {{ place.agentName || place.agentId }}.</b>
      The ticket itself is not here, and they may already have sold it without
      writing it down. Check with them before selling it to anybody else.
      <!-- The sentence goes on the BOOK's record, not into a log nobody opens,
           so the seller meets it beside their own sales when it is counted in.
           Asked here rather than after the press, because a question that
           arrives as an error reads as the app having gone wrong. -->
      <label v-if="needsReason" class="why" for="onbehalf">Why are you recording this for them?</label>
      <input v-if="needsReason" id="onbehalf" v-model="onBehalf" autocomplete="off"
             :placeholder="`e.g. ${place.agentName || 'they'} phoned it in`">
    </div>
    <div v-else-if="!done && place?.status === 'Lost' && !isSold(t)" class="note bad">
      <b>This book was reported lost.</b> The ticket cannot win.
    </div>
    <!--
      A COUNTED-IN BOOK DISABLED BOTH BUTTONS AND SAID NOTHING, which is the
      trap the note above this one exists to prevent. The rule was right: a book
      that has been counted in has had its money reconciled, and selling another
      ticket out of it changes a total somebody already signed off. But it was
      enforced in silence, and a rule nobody can see is indistinguishable from a
      screen that is broken — which is exactly how it was reported.

      The way out is named, because "you cannot do this" without "here is what
      you can do" is half an answer: an organiser puts the book back on the
      shelf, and the tickets that came back unsold go with it.
    -->
    <div v-else-if="!done && place?.status === 'Settled' && !isSold(t)" class="note bad">
      <b>{{ t.book }} has already been
        <span class="helpword" :title="COUNTED_IN_HELP">counted in</span>.</b>
      Its money was settled when it came back, so nothing more can be sold from it —
      including this ticket, which came back unsold. To sell it, an organiser puts
      the book back on the shelf first: <b>Books → Put books back on the shelf</b>.
      The tickets already sold from it keep their buyers.
    </div>
    <div v-else-if="!done && place?.status === 'Void' && !isSold(t)" class="note bad">
      <b>{{ t.book }} was cancelled.</b> Nothing can be sold from it.
    </div>

    <!-- saved -->
    <div v-if="done" class="success">
      <div class="tick">✓</div>
      <h2>Sold</h2>
      <p class="muted">{{ name }} · {{ money(cfg.ticketPrice, cfg.currency) }}</p>
    </div>

    <!-- already sold: fix a mistake -->
    <template v-else-if="isDone">
      <div class="facts">
        <!-- "Bought by JOHN (seller)" would say the seller bought their own
             ticket. They did not — they sold it and know who to. So the label
             follows the fact rather than the fact being dressed up. -->
        <div class="fact">
          <span>{{ isSellerContact(t.name) ? 'Ask' : 'Bought by' }}</span>
          <b>
            {{ plainName(t.name) || 'nobody written down' }}
            <span v-if="isSellerContact(t.name)" class="pill">seller</span>
          </b>
        </div>
        <p v-if="isSellerContact(t.name)" class="tiny muted seller-note">
          Sold from this seller's own book. They know who bought it — ring them
          to reach the buyer.
        </p>
        <div class="fact"><span>Phone</span><b>{{ t.phone || 'none' }}</b></div>
        <div class="fact"><span>Book</span><b>{{ t.book }}</b></div>
        <!-- Who sold it was recorded from the first version and shown nowhere.
             It is the first thing asked about a sale somebody is querying. -->
        <div v-if="agent" class="fact"><span>Sold by</span><b>{{ agent.name }}<RoleTag seller /></b></div>
        <!-- A sale at the desk is credited to nobody unless somebody was named,
             and then this panel had nothing to say about who handled it — while
             the email of the person who typed it has been on the row since the
             first version. "Sold by: nobody" reads as a record with a hole in
             it; "written down by" is the person you would actually go and ask. -->
        <div v-else-if="isSold(t)" class="fact">
          <span>Sold by</span><b class="muted">Nobody — sold at the desk</b>
        </div>
        <div v-if="t.by" class="fact"><span>Written down by</span><Who :email="t.by" /></div>
        <div class="fact"><span>Now</span><StatusPill :status="t.status" /></div>
      </div>
      <button class="btn block mt" @click="showHistory = true">Where this ticket has been</button>
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
        <label for="fr"><Bi text="What are you fixing?" /> <span class="req">*</span></label>
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
          <h2 class="q"><Bi text="Who bought it?" /></h2>
          <input ref="nameBox" v-model="name" class="xl" autocomplete="off"
                 placeholder="Their name" @keydown.enter="next">
          <p class="hint">The name on the ticket stub.</p>
        </div>
        <div v-else key="2">
          <h2 class="q"><Bi text="What is their phone number?" /></h2>
          <input ref="phoneBox" v-model="phone" class="xl" type="tel" inputmode="tel"
                 autocomplete="off" placeholder="012-345 6789" @keydown.enter="sell">
          <p class="hint">Needed so you can call them if they win.</p>
          <div class="field mt">
            <label for="z"><Bi text="Church or area" /> <span class="opt">— not required</span></label>
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
        <label for="qn"><Bi text="Who bought it?" /> <span class="req">*</span></label>
        <input id="qn" ref="nameBox" v-model="name" autocomplete="off" placeholder="Their name">
      </div>
      <div class="field">
        <label for="qp"><Bi text="Phone number" /> <span class="req">*</span></label>
        <input id="qp" v-model="phone" type="tel" inputmode="tel" autocomplete="off"
               placeholder="012-345 6789" @keydown.enter="sell">
      </div>
      <div class="field">
        <label for="qz"><Bi text="Church or area" /> <span class="opt">— not required</span></label>
        <input id="qz" v-model="zone" autocomplete="off">
      </div>
      <p class="hint">Both the name and the phone number are needed — without them
        you cannot tell this person if they win.</p>
    </template>

    <template #actions>
      <template v-if="done"></template>

      <template v-else-if="isDone">
        <button class="btn" @click="emit('close')"><Bi text="Cancel" /></button>
        <button class="btn primary" :disabled="busy" @click="correct"><Bi text="Save the fix" /></button>
      </template>

      <template v-else-if="isReserved">
        <button class="btn" :disabled="busy" @click="release"><Bi text="Let it go" /></button>
        <button class="btn primary" :disabled="busy || !canSell || !!blocked" @click="sell"><Bi text="It is sold" /></button>
      </template>

      <template v-else-if="mode === 'steps' && step === 1">
        <button class="btn" @click="emit('close')"><Bi text="Cancel" /></button>
        <button class="btn primary lg" :disabled="!nameOk || !!blocked" @click="next"><Bi text="Next" /> →</button>
      </template>

      <template v-else-if="mode === 'steps'">
        <button class="btn" @click="step = 1">← <Bi text="Back" /></button>
        <button class="btn primary lg" :disabled="busy || !canSell || !!blocked" @click="sell">
          {{ busy ? 'Saving…' : 'Sold · ' + money(cfg.ticketPrice, cfg.currency) }}
        </button>
      </template>

      <template v-else>
        <button class="btn" :disabled="busy || !nameOk || !!blocked" @click="hold"><Bi text="Hold it" /></button>
        <button class="btn primary" :disabled="busy || !canSell || !!blocked" @click="sell">
          {{ busy ? 'Saving…' : 'Sold · ' + money(cfg.ticketPrice, cfg.currency) }}
        </button>
      </template>
    </template>

    <History v-if="showHistory" :ticket="t" @close="showHistory = false" />
  </Sheet>
</template>

<style scoped>
/* The question sits inside the warning it belongs to, so the answer is given
   where the reason for asking is still on screen. */
.why { margin-top: 12px; }
.seller-note { margin: -6px 0 10px; }
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
