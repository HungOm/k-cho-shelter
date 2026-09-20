<script setup>
/**
 * THE TICKET YOU ARE LOOKING AT, BESIDE THE LIST RATHER THAN ON TOP OF IT.
 *
 * WHY A DOCK AND NOT THE SHEET. Working down a stack of counterfoils is a
 * loop: find the number, write the sale, find the next number. A sheet covers
 * the list, so every ticket costs an open and a close, and the place you had
 * got to in the results is somewhere underneath. A dock keeps the list in
 * view and keeps the keyboard in it — which is the whole point, because the
 * fast way through a stack is never the mouse.
 *
 * IT IS NOT THE ONLY PRESENTATION AND MUST NOT BECOME ONE. A seller on a
 * phone, standing up, holding a book, gets the sheet — there is no room for a
 * column beside a list at 390px and no keyboard to justify it. Find decides
 * which, at 1024px; this component only draws the wide one.
 *
 * WHAT IT DOES NOT OWN. The rules of a sale are lib/ticketsale.js, shared
 * with the sheet, because two screens recording a sale must refuse the same
 * things for the same reasons. The trail is ui/Trail.vue, shared with the
 * sheet for the same reason. This file is a layout and a pair of tabs.
 *
 * A CORRECTION IS NOT OFFERED HERE, deliberately. Fixing a sold ticket asks
 * what you are fixing and writes that sentence into the record; it is a
 * different act from selling, done rarely and read later by somebody
 * checking. It stays in the sheet, one button away, rather than being
 * reproduced in a narrower column where the reason box would be the first
 * thing squeezed.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { money, plainName, isSellerContact } from '../../lib/format.js'
import { useTicketSale } from '../../lib/ticketsale.js'
import StatusPill from './StatusPill.vue'
import Trail from './Trail.vue'
import Who from './Who.vue'

const props = defineProps({
  ticket: { type: Object, default: null },
  /** The next unsold ticket in the list, so the loop can say where it goes next. */
  nextUnsold: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved', 'open-full', 'go-next'])

const {
  name, phone, zone, busy, done, t, cfg,
  nameOk, phoneOk, canSell, agent, place, mine, blocked, needsReason, onBehalf,
  isDone, sell, hold,
} = useTicketSale(computed(() => props.ticket), () => emit('saved'))

/*
 * TWO TABS, AND THE SECOND ONE COSTS A REQUEST. Trail fetches on mount, so it
 * is only mounted once somebody asks for it — the same decision the sheet
 * made after the inline version turned every open into a round trip.
 */
const tab = ref('sell')
const seenTrail = ref(false)
watch(tab, (v) => { if (v === 'trail') seenTrail.value = true })

/* A new ticket is a new question: back to the form, and back to the top. */
const nameBox = ref(null)
watch(() => props.ticket?.number, async () => {
  tab.value = 'sell'
  seenTrail.value = false
  await nextTick()
  nameBox.value?.focus()
})

const where = computed(() => {
  const w = place.value
  if (!w) return ''
  if (w.out) return `with ${w.agentName || w.agentId}`
  if (w.status === 'Unassigned') return 'in the office'
  if (w.status === 'Returned') return 'brought back'
  if (w.status === 'Lost') return 'book lost'
  return ''
})
</script>

<template>
<aside v-if="ticket" class="dock" aria-label="The ticket you have open">
  <header class="dockhead">
    <div>
      <h2 class="data">{{ ticket.number }}</h2>
      <p class="tiny muted">
        <span class="data">{{ ticket.book }}</span>
        <template v-if="where"> · {{ where }}</template>
      </p>
    </div>
    <StatusPill :status="ticket.status" />
    <button class="iconbtn" aria-label="Close this ticket" title="Close this ticket"
            @click="emit('close')">✕</button>
  </header>

  <div class="seg" role="tablist">
    <button type="button" class="segbtn" role="tab" :aria-selected="tab === 'sell'"
            :class="{ on: tab === 'sell' }" @click="tab = 'sell'">
      {{ isDone ? 'What was written down' : 'Write the sale' }}
    </button>
    <button type="button" class="segbtn" role="tab" :aria-selected="tab === 'trail'"
            :class="{ on: tab === 'trail' }" @click="tab = 'trail'">Where it has been</button>
  </div>

  <div v-show="tab === 'sell'" class="dockbody">
    <!--
      ALREADY SOLD. The record, and the way to the one screen that can change
      it. Reproducing the correction box here would be a second place to type
      a reason that goes into somebody's permanent record.
    -->
    <template v-if="isDone">
      <div class="fact">
        <span>{{ isSellerContact(t.name) ? 'Ask' : 'Bought by' }}</span>
        <b>{{ plainName(t.name) || 'nobody written down' }}</b>
      </div>
      <div class="fact"><span>Phone</span><b class="data">{{ t.phone || 'none' }}</b></div>
      <div v-if="agent" class="fact"><span>Sold by</span><b>{{ agent.name }}</b></div>
      <div v-if="t.by" class="fact"><span>Written down by</span><Who :email="t.by" /></div>
      <button class="btn block mt" @click="emit('open-full', ticket)">
        Open the full record to fix something
      </button>
    </template>

    <!--
      A BOOK THAT IS NOT HERE REFUSES, it does not warn. Shown disabled with
      the reason rather than hidden, which is the rule permissionui pins: a
      control that vanishes makes the screen differ between people with no
      stated cause, and the seller concludes they have been demoted.
    -->
    <template v-else>
      <p v-if="blocked && !mine" class="note bad tiny">{{ blocked }}</p>

      <label class="field">
        <span>Who bought it? <span class="req">*</span></span>
        <input ref="nameBox" v-model="name" :disabled="!!blocked" autocomplete="off"
               :title="blocked || undefined" placeholder="Their name">
      </label>
      <label class="field">
        <span>Phone number <span class="req">*</span></span>
        <input v-model="phone" :disabled="!!blocked" type="tel" inputmode="tel"
               autocomplete="off" :title="blocked || undefined" placeholder="012-345 6789">
      </label>
      <label class="field">
        <span>Church or area</span>
        <input v-model="zone" :disabled="!!blocked" autocomplete="off"
               :title="blocked || undefined" placeholder="Optional">
        <small class="muted tiny">Not printed on the ticket and not used for the draw.</small>
      </label>

      <div v-if="needsReason" class="note warn tiny">
        <b>This book is out with {{ place?.agentName || 'a seller' }}.</b>
        The ticket is credited to them, so say why you are writing it down —
        it goes onto the book's record where they will see it.
        <input v-model="onBehalf" class="mt" autocomplete="off"
               placeholder="e.g. she brought the counterfoils back on Sunday">
      </div>

      <p v-if="cfg?.ticketPrice" class="tiny muted">
        Records <b class="data">{{ money(cfg.ticketPrice, cfg.currency) }}</b> against this ticket.
      </p>
    </template>
  </div>

  <div v-if="seenTrail" v-show="tab === 'trail'" class="dockbody">
    <Trail :ticket="ticket" />
  </div>

  <footer v-if="!isDone" class="dockfoot">
    <button class="btn grow" :disabled="busy || !nameOk || !!blocked"
            :title="blocked || 'Hold it for somebody without taking the money yet'"
            @click="hold">Hold it</button>
    <button class="btn primary grow" :disabled="busy || !canSell || !!blocked"
            :title="blocked || (!nameOk ? 'Who bought it?' : !phoneOk ? 'A phone number somebody can ring' : undefined)"
            @click="sell">{{ busy ? 'Saving…' : 'Sold' }}</button>
  </footer>

  <!--
    WHERE THE LOOP GOES NEXT, named rather than implied. Somebody working down
    a stack wants the next unsold number, and the difference between "there is
    another one" and "you have reached the end" is the difference between
    carrying on and checking whether the screen is stuck.
  -->
  <p v-if="!isDone" class="tiny muted nextup">
    <template v-if="nextUnsold">
      Keep going · next unsold is
      <button class="linkish data" @click="emit('go-next')">{{ nextUnsold.number }}</button>
    </template>
    <template v-else>Nothing else unsold in these results.</template>
  </p>
</aside>
</template>

<style scoped>
.dock {
  display: flex; flex-direction: column; gap: 12px;
  border: 1px solid var(--border); border-radius: var(--r);
  background: var(--surface); padding: 14px;
  position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow: auto;
}
.dockhead { display: flex; align-items: flex-start; gap: 8px }
.dockhead h2 { margin: 0; font-size: 1.15rem; line-height: 1.1 }
.dockhead p { margin: 2px 0 0 }
.dockhead .pill { margin-left: auto }
.iconbtn {
  border: 1px solid var(--border); background: var(--surface); color: var(--muted);
  border-radius: var(--r-sm); width: 30px; height: 30px; cursor: pointer; flex: none;
}
.iconbtn:hover { border-color: var(--bad); color: var(--bad) }
.dockbody { display: flex; flex-direction: column; gap: 10px; min-width: 0 }
.field { display: flex; flex-direction: column; gap: 4px }
.field > span { font-size: .82rem; color: var(--muted) }
.dockfoot { display: flex; gap: 8px }
.fact { display: flex; justify-content: space-between; gap: 10px; align-items: baseline }
.fact > span { color: var(--muted); font-size: .82rem }
.nextup { margin: 0 }
.linkish {
  border: 0; background: none; padding: 0; cursor: pointer;
  color: var(--brand); text-decoration: underline;
}
</style>
