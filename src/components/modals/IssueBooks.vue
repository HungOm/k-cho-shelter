<script setup>
/**
 * Offering books to a seller.
 *
 * This screen used to hand them over outright: the seller named here was
 * holding the books the moment the button was pressed, which meant the money
 * was on their balance and they were on the chase list, whether or not they
 * knew anything about it. A mistyped name made somebody liable.
 *
 * Now it reserves them and asks. The books are on nobody's balance until the
 * seller accepts, and an offer nobody answers goes back on the shelf.
 */
import { ref, computed } from 'vue'
import { state, api, toast, refresh } from '../../lib/store.js'
import { money, date } from '../../lib/format.js'
import { inspectRange, bookNumber } from '../../lib/books.js'
import { asDay, todayDay, dayFromNow } from '../../lib/days.js'
import Sheet from '../ui/Sheet.vue'
import FreeRuns from '../ui/FreeRuns.vue'
import AgentForm from './AgentForm.vue'

/*
 * A BOOK MAY ARRIVE ALREADY CHOSEN.
 *
 * Opened from the Books grid, the organiser has just pressed the square they
 * mean, and asking them to type its number back is the kind of small insult
 * that makes people stop using a screen. Opened from anywhere else the payload
 * is empty and this behaves exactly as it did.
 *
 * It fills BOTH ends of the range, because one book is a range of one — and a
 * prefilled `from` with an empty `to` would submit as an open-ended run.
 */
const props = defineProps({ payload: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close', 'issued'])

const agentId = ref(state.agents[0]?.id || '')

/**
 * Adding a seller without losing the handover you were in the middle of.
 *
 * Books get given out at a table, and the person in front of you is often
 * somebody who is not on the list yet. Sending them to the Sellers screen means
 * closing this, typing the name, coming back, and re-entering the book range
 * and the date — so in practice the range gets retyped from memory, or the
 * books are handed over and recorded later, which is how a book ends up with
 * nobody's name against it.
 *
 * The form opens ON TOP of this one rather than replacing it, so every field
 * here survives, and the seller it creates is selected on the way back.
 */
const NEW_SELLER = '__new__'
const adding = ref(false)

/**
 * The sentinel never reaches the model, and that is deliberate.
 *
 * With v-model, letting it in and setting it back leaves the BOX still reading
 * "+ Add a new seller" while the value underneath says JOHN: the model went
 * A1 -> sentinel -> A1, so it matches what Vue last rendered and no patch is
 * scheduled. The state was right and the screen was wrong, which a test that
 * reads the state cannot see — a browser found it.
 *
 * So the element is driven by hand. The DOM is put back in the same turn as the
 * choice, and agentId only ever holds a real seller.
 */
function pickSeller(el) {
  if (el.value !== NEW_SELLER) { agentId.value = el.value; return }
  el.value = agentId.value      // same turn, so the box never shows the sentinel
  adding.value = true
}

async function sellerAdded(e) {
  adding.value = false
  // The list has to contain them before the box can point at them, and
  // AgentForm's own refresh is not awaited — so wait for one here rather than
  // setting an id that momentarily matches no option.
  await refresh()
  if (e?.agentId) agentId.value = e.agentId
}
const from = ref(String(props.payload?.book ?? ''))
const to = ref(String(props.payload?.book ?? ''))
const due = ref(defaultDue())
const busy = ref(false)
const blocked = ref(null)
const partly = ref(null)

/**
 * A blocked book, said in words rather than in the server's field names.
 *
 * The server sends {book, status, agentId} — never `reason`, which is what
 * this template asked for and got nothing from, printing every refusal as a
 * book number followed by an empty dash. The status is already a phrase
 * chosen to read aloud ('out', 'settled', 'not released yet', 'taken
 * meanwhile'), so the only thing missing is WHO, which is the half an
 * organiser standing at a table actually needs: a book that is 'out' is out
 * with somebody, and that somebody is who they have to ring.
 */
function whyBlocked(b) {
  const held = b.agentId && state.agents.find(a => a.id === b.agentId)
  if (held) return `${b.status} — with ${held.name}`
  if (b.agentId) return `${b.status} — with ${b.agentId}`
  return b.status || 'not free'
}

/**
 * The shared check-in date, not a month from today.
 *
 * Somebody collecting books a fortnight after everybody else still reports on
 * the same day as the rest of the team — that is the whole reason the date is
 * shared, and counting thirty days from this particular handover would quietly
 * undo it. The fallbacks match the server's: the final deadline if the check-in
 * has passed and nobody has moved it yet, and only then the old rolling month.
 */
function defaultDue() {
  const today = todayDay()
  const checkIn = asDay(state.cfg?.checkInDate)
  if (checkIn && checkIn >= today) return checkIn

  const last = asDay(state.cfg?.finalDeadline)
  if (last && last >= today) return last

  return dayFromNow(state.cfg?.defaultDueDays || 30)
}

/** Whether the date in the box is still the one everybody else is on. */
const sharedDay = computed(() => asDay(state.cfg?.checkInDate))
const lastDay = computed(() => asDay(state.cfg?.finalDeadline))
const isShared = computed(() => !!sharedDay.value && due.value === sharedDay.value)

// Resolved locally against books already loaded, so the answer appears as they
// type rather than after a save they had to wait for.
const range = computed(() => inspectRange(from.value, to.value))
const count = computed(() => range.value?.count || 0)
const canIssue = computed(() => !!range.value && !range.value.noneFree)

/**
 * Tapping a run fills the first box always, and the second only when the run is
 * small enough to be a plausible single handover. Filling "to" with 2000 from a
 * 1,400-book run would put a number in front of them that the server refuses
 * anyway — the cap is 300 — so the end is left for them to decide.
 */
function useRun(r) {
  from.value = String(r.from)
  to.value = r.count <= 50 ? String(r.to) : ''
}

/** Offer the first run big enough, so nobody has to hunt for free books. */
function useSuggestion() {
  const n = range.value?.nextRun
  if (!n) return
  from.value = String(n.from)
  to.value = n.to === n.from ? '' : String(n.to)
}
const worth = computed(() => count.value * (state.cfg?.ticketsPerBook || 0) * (state.cfg?.ticketPrice || 0))

async function issue() {
  if (!agentId.value) return toast('Who are the books for?', 'bad')
  if (!from.value) return toast('Which books?', 'bad')
  busy.value = true
  blocked.value = null
  try {
    /*
     * OFFER, NOT ISSUE. Typing a seller's name used to make that person liable
     * for the money on these books before they had said a word. Now the books
     * are reserved and the seller is asked; they become theirs when the seller
     * accepts, and go back on the shelf if nobody does.
     *
     * issue_books still exists and is still the right call in one place: when
     * the SELLER asked (Search.vue sends it as a petition) and an organiser
     * grants it. Consent is on the record there already.
     */
    const r = await api('offer_books', {
      agentId: agentId.value,
      fromBook: bookNumber(from.value),
      toBook: bookNumber(to.value || from.value),
      dueDate: due.value
    })
    /*
     * A PARTIAL HANDOVER STOPS HERE, and that is the whole point of it.
     *
     * The server gives out the books it can and names the ones it could not —
     * somebody else took them between the range being typed and the button
     * being pressed. This closed on the count alone and went straight to the
     * handover receipt, so an organiser who asked for five and gave out three
     * printed paper for five and put it in a seller's hand. The server's own
     * comment says it: a receipt for five books when three went out is the
     * paper a seller holds up later and is wrong about.
     *
     * So when anything was skipped the sheet stays up and says which, and the
     * receipt is a deliberate second tap rather than the automatic next thing.
     */
    /*
     * KEPT, THOUGH AN OFFER CANNOT BE PARTIAL. offer_books_tx refuses the whole
     * batch and names the books that were not free, so `skipped` never arrives
     * today. It stays because the branch is the safe direction: if the server
     * ever does start reporting a partial offer, this shows it rather than
     * printing paper for books that were never reserved.
     */
    if (r.skipped?.length) {
      partly.value = r
      await refresh()
      return
    }

    /*
     * TWO ENDINGS, because there are two kinds of seller.
     *
     * Offering asks for consent, and a seller who cannot sign in can never give
     * it — so for them the server issues instead, and "waiting for them to
     * accept" would be waiting for something that cannot happen. It said exactly
     * that, with `undefined` where the count should be, because an issue reply
     * carries `issued` and not `offered`.
     */
    if (r.direct) {
      toast(`${r.issued} ${r.issued === 1 ? 'book' : 'books'} given to ` +
            `${r.agent?.name || 'them'} — they have no account to accept with, ` +
            `so the handover is recorded against you`, 'ok')
    } else {
      // NOT "given to". Nothing has moved yet, and a receipt printed on the
      // strength of this sentence would be paper the seller has not agreed to.
      toast(`${r.offered} ${r.offered === 1 ? 'book' : 'books'} offered — ` +
            `waiting for them to accept`, 'ok')
    }
    // Close first. The write is done and the toast has said so; reloading the
    // whole ticket table before closing reads as a hang, which is exactly what
    // it looked like on a 20,000-ticket raffle.
    // The seller id from the form, not from the response: an offer replies with
    // what was reserved and the queue row that was opened, and has no `agent`
    // on it. Reading r.agent.id here threw on the happy path.
    emit('issued', agentId.value)
    refresh()
  } catch (err) {
    // BOOKS_CHANGED_MEANWHILE carries the same `blocked` list and was not
    // caught, so a race — two organisers giving out the same run within a
    // second — fell through to a toast and threw away the names of the books
    // it had just gone to the trouble of identifying.
    const named = err.code === 'BOOKS_NOT_AVAILABLE' || err.code === 'BOOKS_CHANGED_MEANWHILE'
    if (named && err.details?.blocked) blocked.value = err.details.blocked
    else toast(err.message, 'bad', err.code)
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet title="Offer books" subtitle="The seller accepts before the books are theirs" @close="emit('close')">
    <div class="field">
      <label for="ia">Who is taking them? <span class="req">*</span></label>
      <select id="ia" :value="agentId" @change="pickSeller($event.target)">
        <option v-for="a in state.agents.filter(x => x.active)" :key="a.id" :value="a.id">
          {{ a.name }}<template v-if="a.booksOut"> — holding {{ a.booksOut }}
            {{ a.booksOut === 1 ? 'book' : 'books' }}</template>
        </option>
        <!-- Last, and in the raffle's own colour: it is a different KIND of
             choice from the names above it, and a list of people with an action
             hidden among them is how somebody hands books to the wrong person. -->
        <option :value="NEW_SELLER" class="newopt">+ Add a new seller…</option>
      </select>
    </div>

    <FreeRuns @pick="useRun" />

    <div class="row">
      <div class="field grow">
        <label for="if">First book <span class="req">*</span></label>
        <input id="if" v-model="from" class="xl" inputmode="numeric" placeholder="31">
      </div>
      <div class="field grow">
        <label for="it">Last book</label>
        <input id="it" v-model="to" class="xl" inputmode="numeric" placeholder="45">
      </div>
    </div>
    <p class="hint" style="margin-top:-8px">Leave the second box empty for a single book.</p>

    <!-- clean range -->
    <div v-if="range?.allFree" class="note info mt">
      <b>{{ count }} {{ count === 1 ? 'book' : 'books' }}</b>
      · {{ count * state.cfg.ticketsPerBook }} tickets
      · worth {{ money(worth, state.cfg.currency) }} if they all sell
    </div>

    <!-- some or all of it is already out -->
    <div v-else-if="range" :class="['note', range.noneFree ? 'bad' : 'warn', 'mt']">
      <b>{{ range.message }}</b>
      <div v-if="range.nextRun" class="mt">
        <button class="btn sm" @click="useSuggestion">
          Use {{ range.nextRun.from }}<template v-if="range.nextRun.to !== range.nextRun.from">–{{ range.nextRun.to }}</template>
          instead<template v-if="range.nextRun.short"> ({{ range.nextRun.available }} free)</template>
        </button>
      </div>
    </div>

    <div class="field mt">
      <label for="id">Bring back by</label>
      <input id="id" v-model="due" type="date" :max="lastDay || null">
      <p v-if="isShared" class="hint">
        The check-in date — the same day every seller reports by.
      </p>
      <p v-else-if="sharedDay" class="hint warnish">
        Everybody else reports by {{ date(sharedDay) }}. Giving these books a
        different date takes them off that list.
      </p>
    </div>

    <!-- the server refused: it names every blocked book, so show them all -->
    <div v-if="blocked" class="note bad">
      <b>Nothing was changed. These are not free:</b>
      <div v-for="b in blocked" :key="b.book" class="tiny">{{ b.book }} — {{ whyBlocked(b) }}</div>
    </div>

    <!-- some went out and some did not: the receipt must not claim otherwise -->
    <div v-if="partly" class="note warn">
      <b>{{ partly.issued }} of {{ partly.issued + partly.skipped.length }} books went to
        {{ partly.agent.name }}</b> — the rest were given out by somebody else while you
      were typing, so they are not on this handover.
      <div v-for="b in partly.skipped.slice(0, 12)" :key="b" class="tiny">{{ b }} — taken meanwhile</div>
      <div v-if="partly.skipped.length > 12" class="tiny">…and {{ partly.skipped.length - 12 }} more</div>
    </div>

    <template #actions>
      <!-- After a partial handover the only two useful actions are the receipt
           for what ACTUALLY went out, and leaving. Offering "Give out" again
           over a range that is now half gone is how the same mistake is made
           twice. -->
      <template v-if="partly">
        <button class="btn" @click="emit('close')">Done</button>
        <button class="btn primary" @click="emit('issued', partly.agent.id)">
          Receipt for the {{ partly.issued }} that went out
        </button>
      </template>
      <template v-else>
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy || !count || !canIssue" @click="issue">
          {{ busy ? 'Saving…' : `Give out ${count || ''}` }}
        </button>
      </template>
    </template>
    <!-- On top of this sheet, not instead of it: Sheet is fixed at z-index 60
         and this one comes later in the DOM, so it paints over. Nothing here
         unmounts, which is the whole point — the range and the date survive. -->
    <AgentForm v-if="adding" @close="adding = false" @saved="sellerAdded" />
  </Sheet>
</template>

<style scoped>
/* Native option styling is limited, but colour and weight carry. */
.newopt { color: var(--brand); font-weight: 700; }

/* .hint.warnish moved to src/style.css — three components used it and only
   two defined it. */
</style>
