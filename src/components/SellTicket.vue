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
import { state, setSellMode, isSold } from '../lib/store.js'
import { useTicketSale } from '../lib/ticketsale.js'
import { money, STATUS_WORDS, plainName, isSellerContact, COUNTED_IN_HELP } from '../lib/format.js'
import Sheet from './ui/Sheet.vue'
import RoleTag from './ui/RoleTag.vue'
import StatusPill from './ui/StatusPill.vue'
import Bi from './ui/Bi.vue'
import Icon from './ui/Icon.vue'
import History from './modals/History.vue'
import Who from './ui/Who.vue'

const props = defineProps({ ticket: Object })
/* The trail, open or not. Nothing is fetched until it is. */
const showTrail = ref(false)

const emit = defineEmits(['close', 'saved'])

/*
 * THE RULES OF A SALE LIVE IN lib/ticketsale.js, and stay there now that this
 * sheet is the only screen that records one. They were pulled out when Find
 * had a dock of its own; keeping them out is what stops the next second
 * surface from being written as a second copy of the rules. Everything below
 * here is this sheet's own: the steps-versus-quick layout, and the focus that
 * goes with it.
 */
const {
  name, phone, zone, reason, onBehalf, step, busy, done,
  t, cfg, mode, isAvailable, isReserved, isDone,
  nameOk, phoneOk, canSell, agent, place, mine, blocked, needsReason,
  next, sell, hold, release, correct,
} = useTicketSale(computed(() => props.ticket), () => emit('saved'))

/*
 * WHERE THE TICKET PHYSICALLY IS, under the number.
 *
 * The subtitle used to name the seller the ticket was CREDITED to, which is
 * already a fact row below ("Sold by") and is not the question somebody
 * holding a counterfoil is asking. What they want under the number is where
 * the thing itself is: in the office, or in somebody's bag 200km away.
 *
 * The same four sentences the results list prints, so a row and the sheet it
 * opens cannot describe one ticket two ways.
 */
const where = computed(() => {
  const w = place.value
  if (!w) return ''
  if (w.out) return `with ${w.agentName || w.agentId}`
  if (w.status === 'Unassigned') return 'in the office'
  if (w.status === 'Returned') return 'brought back'
  if (w.status === 'Lost') return 'book lost'
  return ''
})

const nameBox = ref(null)
const phoneBox = ref(null)

async function focusFirst() {
  await nextTick()
  ;(step.value === 1 ? nameBox.value : phoneBox.value)?.focus()
}
watch(step, focusFirst)
watch(() => props.ticket, focusFirst, { immediate: true })
</script>

<template>
  <Sheet :title="t.number" :subtitle="`${t.book}${where ? ' · ' + where : ''}`" @close="emit('close')">

    <!-- An unsold ticket in a book somebody is carrying is not free stock. It
         is 200km away, and it may already have been sold on paper. -->
    <!-- `!mine` on both: the stubs are in this person's hand, so none of what
         follows is true of them. -->
    <div v-if="!mine && blocked && place?.out && t.status === 'Available'" class="note bad">
      <b>This one is with {{ place.agentName || place.agentId }}.</b>
      Not here, so it cannot be sold from this screen — they may have sold it in
          person. If the book is back, ask an organiser to mark it returned first.
    </div>
    <div v-else-if="!mine && !done && place?.out && t.status === 'Available'" class="note warn">
      <b>This one is with {{ place.agentName || place.agentId }}.</b>
      Not here, and they may have sold it without writing it down. Check with them
          before selling it to anybody else.
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
      Its money was settled when it came back, so nothing more sells from it —
          including this ticket, which came back unsold. An organiser puts the book
          back on the shelf first: <b>Books → Back on the shelf</b>.
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
        <!-- The book is NOT a row here. It is the subtitle, two lines up, and
             printing "Book · Book-0001" underneath "Book-0001 · in the office"
             is the same string twice inside one panel — which reads as a form
             with a field in it rather than as a record, and pushes the fact
             somebody opened this for further down. -->
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
      <!--
        THIS DIVERGES FROM CARD 6b ON PURPOSE. DO NOT "FIX" IT BACK.

        6b is titled "record, movement and correction in one modal, no second
        dialog", and the trail here IS a second surface. That was put to the
        organiser on 2026-09-21 with the card quoted and the alternative built
        and working — inline, expanding in place, with the lazy fetch kept — and
        they chose the sheet. It was briefly shipped inline at 437b15e and
        reverted at their word.

        So the card is not being overlooked and the inline version is not
        untried. The mockup describes a screen; this is the organiser's ruling
        about their own screen, and it outranks the drawing.

        THE TRAIL IS ASKED FOR, NOT FETCHED ON ARRIVAL.
        
        It was inline here for a while, which read well and cost a request on
        every open: a sold ticket used to touch no network at all, and a
        volunteer on a phone in a hall paid for a panel most of them were not
        looking at. Set by the organiser — it is a click, the history is
        fetched then, and it opens in a sheet ON TOP of this record rather than
        inside it.
        
        The sheet is where the fetch lives, so there is nothing to undo here:
        History mounts Trail, Trail loads on mount, and neither happens until
        somebody presses this.
      -->
      <button class="btn sm ghost mt" @click="showTrail = true">
        <Icon name="clock" :size="16" />Where it has been
      </button>
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
      <p class="hint">Both are needed — without them you cannot tell this person if they win.</p>
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

  </Sheet>

  <!-- On top of the record, not inside it. History mounts Trail, which
       fetches when it mounts — so pressing the button is what asks. -->
  <History v-if="showTrail" :ticket="t" :book="t?.book" @close="showTrail = false" />
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
