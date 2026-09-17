<script setup>
/**
 * Counting a book back in.
 *
 * Whoever is holding the leftovers reads out the numbers that did NOT sell, so
 * that is what we ask for. Typing two numbers takes five seconds and is exact,
 * whereas "I sold eight" throws away which numbers went to whom — and the draw
 * depends on knowing that.
 *
 * TWO DIFFERENT MOMENTS REACH THIS SCREEN and they are not the same room. An
 * `Out` book is still with the seller: they are standing there with the unsold
 * tickets in their hand. A `Returned` book has already been handed back — the
 * tickets are in the office and the seller is not there. Telling an organiser
 * counting yesterday's returns that "the seller is holding the tickets" sends
 * them looking for somebody who went home, so the words follow the book.
 */
import { ref, computed } from 'vue'
import { state, api, toast, refresh, loadDelta } from '../../lib/store.js'
import { money } from '../../lib/format.js'
import { resolveTicketNumber } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settled'])

const unsold = ref('')
const paid = ref('')
const lost = ref(false)
const soldCount = ref('')
const busy = ref(false)

const per = computed(() => state.cfg?.ticketsPerBook || 10)
const price = computed(() => state.cfg?.ticketPrice || 0)
const currency = computed(() => state.cfg?.currency || '')

/** Already handed back and sitting in the office, rather than still out. */
const handedBack = computed(() => props.book.status === 'Returned')

const unsoldList = computed(() =>
  unsold.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))

/** Each entry with the ticket it resolves to, so nothing below resolves twice. */
const entries = computed(() =>
  unsoldList.value.map(raw => ({ raw, num: resolveTicketNumber(raw) })))

/**
 * THE SAME NUMBER TYPED TWICE IS ONE TICKET.
 *
 * Read out from a stack of stubs, "5052" gets said twice often enough; the list
 * is also edited and pasted. The count used to be the LENGTH OF THE LIST, so a
 * repeat took a ticket off the sold side and RM10 off what the seller owed —
 * and the server does not agree, because it counts the ticket ROWS. So the
 * screen said 8 sold and RM80, the organiser took RM80, and the book recorded 9
 * sold and RM90 owed. A reassuring total that is wrong, with the shortfall
 * landing on a volunteer.
 *
 * Deduplicated and shown. Collapsing it silently would leave somebody who typed
 * ten numbers looking at nine and no explanation.
 */
const returned = computed(() => [...new Set(entries.value.filter(e => e.num).map(e => e.num))])

const repeated = computed(() => {
  const seen = new Set()
  const twice = new Map()
  for (const e of entries.value) {
    if (!e.num) continue
    if (seen.has(e.num)) twice.set(e.num, (twice.get(e.num) ?? 1) + 1)
    seen.add(e.num)
  }
  return [...twice].map(([num, n]) => `${short(num)} (${n}×)`)
})

/**
 * How many tickets this book actually holds — the rows, not the setting.
 *
 * TICKETS_PER_BOOK is what a full book holds. A book at the end of a
 * part-released run holds fewer, and the server counts the rows, so subtracting
 * from the setting overstates the sale on exactly the books where the tickets
 * are already scarce. `inBook` knows; this had been reading the setting while
 * the comment above inBook explained why it must not.
 */
const held = computed(() => inBook.value.length || per.value)

const sold = computed(() => {
  if (lost.value) return parseInt(soldCount.value, 10) || 0
  // Unique, and only tickets that are IN THIS BOOK. A typo resolves to nothing
  // and a number from the next book resolves to somebody else's ticket; neither
  // comes back from here, and counting either would show the seller owing less
  // than the server is about to charge them.
  const here = new Set(inBook.value)
  const back = returned.value.filter(n => here.has(n)).length
  return Math.max(0, held.value - back)
})
const due = computed(() => sold.value * price.value)
const paidNum = computed(() => parseFloat(paid.value) || 0)
const diff = computed(() => paidNum.value - due.value)

/** Anything that does not resolve is shown back, not silently sent. */
const unresolved = computed(() => entries.value.filter(e => !e.num).map(e => e.raw))

/**
 * The numbers this book actually contains.
 *
 * Read from the tickets rather than worked out from the book number times the
 * tickets per book, because the two can disagree: a book at the end of a
 * part-released run holds fewer, and the arithmetic would confidently name
 * numbers that are not in play. The tickets know.
 */
const inBook = computed(() =>
  state.tickets
    .filter(t => t.book === props.book.book)
    .map(t => t.number)
    .sort())

/** "KS-00911" reads as 911 to the person holding the ticket. */
function short(n) {
  return String(n ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

const range = computed(() => {
  const l = inBook.value
  return l.length ? { first: short(l[0]), last: short(l[l.length - 1]), count: l.length } : null
})

/**
 * Two numbers from THIS book, so the example cannot be copied wrongly.
 *
 * The placeholder used to be a fixed "313, 317" whatever book was open. On
 * Book-092, whose tickets are 911-920, that is an example nobody can follow and
 * a number that belongs to somebody else's book.
 */
const example = computed(() => {
  const l = inBook.value
  if (l.length < 2) return '911, 915'
  return `${short(l[0])}, ${short(l[Math.min(2, l.length - 1)])}`
})

/**
 * THE WHOLE BOOK CAME BACK, which is a real Saturday and was ten lines of typing.
 *
 * A seller who never got started hands the book back untouched. The form asked
 * them to read out every number in it — the longest possible piece of typing
 * for the simplest possible outcome, and every one of those numbers is a chance
 * to fumble a digit and accidentally sell a ticket nobody bought.
 *
 * It FILLS THE BOX rather than setting a hidden flag. The numbers then go
 * through the same resolution, the same not-in-this-book check and the same
 * count as anything typed by hand, and the organiser can see on the screen
 * exactly what is about to be claimed — including taking one back out if the
 * seller then finds a stub in their pocket.
 */
function wholeBookBack() {
  unsold.value = inBook.value.map(short).join(', ')
}

/** Already saying the whole book came back, so the button has nothing to add. */
const allBack = computed(() =>
  inBook.value.length > 0 && sold.value === 0 && returned.value.length >= inBook.value.length)

/**
 * Typed a real ticket, but one from a different book.
 *
 * resolveTicketNumber searches the whole raffle, so a number from another book
 * resolves perfectly well and would be sent as "came back" for this one. That
 * is the silent wrong answer: the ticket is real, the form accepts it, and two
 * books end up describing the same ticket differently.
 */
const wrongBook = computed(() =>
  entries.value
    .filter(x => x.num && state.byNumber[x.num]?.book &&
                 state.byNumber[x.num].book !== props.book.book)
    .map(x => `${x.raw} (${state.byNumber[x.num].book})`))

async function settle() {
  if (paid.value === '') return toast('How much money did they hand in?', 'bad')
  /*
   * A LIST WITH A BAD NUMBER IN IT IS NOT SENT.
   *
   * The screen has said in red, since long before this, that a number it cannot
   * match "would be counted as sold" — and then let it be sent anyway. What
   * arrived at the server was a null in the array, which slipped through the
   * not-in-this-book check without matching anything and was quietly ignored:
   * the ticket it was meant to name stayed on the sold side and was charged to
   * the seller. The warning was right, nobody was stopped, and the outcome was
   * the one the warning described.
   *
   * A number from another book is the same act with a worse ending — the server
   * refuses the whole settlement by name, so the organiser finds out after
   * pressing the button rather than before.
   */
  if (!lost.value && (unresolved.value.length || wrongBook.value.length)) {
    return toast('Some of those numbers are not tickets in this book. Fix them first ' +
                 '— as they stand they would count as sold.', 'bad')
  }
  busy.value = true
  try {
    const payload = { bookNumber: props.book.book, amountPaid: paidNum.value }
    if (lost.value) { payload.allowUnidentified = true; payload.soldCount = sold.value }
    // Resolved and de-duplicated, so what is sent is exactly what the preview
    // counted. Nothing unresolved can be in it, because the button refuses
    // above while anything on the list is still wrong.
    else payload.unsoldTickets = returned.value

    const r = await api('settle_book', payload)
    toast(`${props.book.book} counted — ${r.declaredSold} sold`,
      Math.abs(r.variance) > 0.005 ? 'bad' : 'ok')
    emit('settled')
    loadDelta().then(refresh)
  } catch (err) { toast(err.message, 'bad', err.code) } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="`Count in ${book.book}`"
         :subtitle="book.agentName ? `from ${book.agentName}` : ''" @close="emit('close')">
    <div class="note info">
      <template v-if="handedBack">
        These tickets are back in the office. Type the numbers that <b>did not</b> sell
        — everything else in the book counts as sold.
      </template>
      <template v-else>
        The seller is holding the tickets that <b>did not</b> sell.
        Type those numbers — everything else in the book counts as sold.
      </template>
    </div>

    <template v-if="!lost">
      <div class="field">
        <label for="su">Which tickets came back?</label>
        <textarea id="su" v-model="unsold" class="xl" :placeholder="example"></textarea>
        <div v-if="inBook.length" class="quick">
          <button type="button" class="btn sm ghost" :disabled="allBack" @click="wholeBookBack">
            The whole book came back
          </button>
          <button type="button" class="btn sm ghost" :disabled="!unsold" @click="unsold = ''">
            Clear
          </button>
        </div>
        <p class="hint">
          <template v-if="range">
            This book holds <b>{{ range.first }}–{{ range.last }}</b>.
            Only those numbers belong here.<br>
          </template>
          Separate with commas or spaces. Leave empty if the whole book sold.
        </p>
      </div>
    </template>
    <template v-else>
      <div class="field">
        <label for="sc">How many did they sell?</label>
        <input id="sc" v-model="soldCount" class="xl" type="number" inputmode="numeric"
               min="0" :max="per">
        <p class="hint">
          Only the book total is written down. No ticket is marked sold, because
          guessing which numbers went would put the wrong names in the draw.
        </p>
      </div>
    </template>

    <div class="field">
      <label for="sp">How much money did they hand in? <span class="req">*</span></label>
      <input id="sp" v-model="paid" class="xl" type="number" inputmode="decimal" step="0.01"
             :placeholder="String(due)">
    </div>

    <!-- A number here that is not a real ticket must never be sent quietly.
         Anything NOT on this list counts as sold and is charged to the agent,
         so one that fails to match moves a ticket to the sold side and adds its
         price to what that volunteer owes. -->
    <div v-if="unresolved.length" class="note bad">
      <b>Not a ticket in this raffle:</b> {{ unresolved.join(', ') }}
      <div class="small">Check the number. Until it is right, these would be counted as sold.</div>
    </div>

    <!-- A real ticket, from somebody else's book. The dangerous one: it
         resolves, so nothing above catches it, and it would be recorded as
         having come back from a book it was never in. -->
    <!-- Said, not silently collapsed. Somebody who typed ten numbers and is
         shown nine needs to know which one this screen decided was the same
         ticket twice — most often it is, and occasionally it is a digit that
         should have been different. -->
    <div v-if="repeated.length" class="note warn">
      <b>Typed more than once:</b> {{ repeated.join(', ') }}
      <div class="small">Counted once. Check whether one of them should be a different number.</div>
    </div>

    <div v-if="wrongBook.length" class="note bad">
      <b>Not in {{ book.book }}:</b> {{ wrongBook.join(', ') }}
      <div class="small">
        <template v-if="range">This book holds {{ range.first }}–{{ range.last }}. </template>
        Those tickets belong to another book and cannot come back from this one.
      </div>
    </div>

    <div :class="['note', paid !== '' && Math.abs(diff) > 0.005 ? 'warn' : 'info']">
      <b>{{ sold }}</b> sold · should be <b>{{ money(due, currency) }}</b>
      <template v-if="paid !== ''"> · handed in <b>{{ money(paidNum, currency) }}</b></template>
      <div v-if="paid !== '' && Math.abs(diff) > 0.005" style="margin-top:4px">
        <b>{{ diff > 0 ? 'Too much' : 'Short' }} by {{ money(Math.abs(diff), currency) }}</b>
      </div>
    </div>

    <label class="lostbox">
      <input type="checkbox" v-model="lost">
      <span v-if="handedBack">The leftover tickets did not come back</span>
      <span v-else>They lost the leftover tickets</span>
    </label>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy || unresolved.length || wrongBook.length"
              @click="settle">
        {{ busy ? 'Saving…' : 'Finish this book' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.quick { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

.lostbox { display: flex; align-items: center; gap: 10px; margin-top: 14px;
  font-weight: 500; color: var(--muted); cursor: pointer; }
.lostbox input { width: auto; min-height: auto; }
</style>
