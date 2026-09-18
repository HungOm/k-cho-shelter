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
import { ref, computed, onMounted } from 'vue'
import { state, api, toast, refresh, loadDelta, isSold } from '../../lib/store.js'
import { money, COUNTED_IN_HELP } from '../../lib/format.js'
import { resolveTicketNumber, expandTicketRange } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settled', 'put-back'])

const unsold = ref('')
const paid = ref('')
const lost = ref(false)
const soldCount = ref('')
const busy = ref(false)

/**
 * WHAT THIS SELLER HAS ALREADY HANDED OVER, and why this screen has to say it.
 *
 * Money can now arrive without a book closing behind it: a seller halfway
 * through a book hands over what they have taken and carries on selling. That
 * cash is recorded against the SELLER, and the book it came out of still shows
 * nothing paid — correctly, because nobody has counted it in yet.
 *
 * Which sets a trap at this screen. The organiser finally counts the book in,
 * reads "10 sold, comes to RM100" and types 100 — over sixty pounds that is
 * already in the tin. agent_money adds the book's figure to the hand-overs, so
 * the seller comes out RM60 in credit on money nobody ever received twice.
 *
 * So the balance is shown and the box is filled with THE BALANCE, not the
 * book's value. The organiser can still type anything; what they cannot do any
 * more is type the obvious number and be wrong.
 *
 * FAILING QUIETLY IS RIGHT HERE. This is a hint on a screen whose real job is
 * counting stubs, and a count-in must not be blocked because a second read did
 * not come back.
 */
const standing = ref(null)
onMounted(async () => {
  const holder = String(props.book?.agentId || '')
  if (!holder) return
  const mine = String(state.user?.agentId || '') === holder
  const staff = state.user?.role === 'admin' || state.user?.role === 'recorder'
  if (!mine && !staff) return
  try {
    standing.value = await api('report_draft', mine ? {} : { agentId: holder })
  } catch { standing.value = null }
})
/** Cash from this seller that is not against any book — the interim money. */
const alreadyIn = computed(() => Number(standing.value?.handedIn || 0))

const per = computed(() => state.cfg?.ticketsPerBook || 10)
const price = computed(() => state.cfg?.ticketPrice || 0)
const currency = computed(() => state.cfg?.currency || '')

/** Already handed back and sitting in the office, rather than still out. */
const handedBack = computed(() => props.book.status === 'Returned')

/**
 * COUNTING IN A BOOK THAT IS ALREADY COUNTED IN, which is a correction.
 *
 * The server refuses a second settlement unless it is forced, and forcing one
 * is listed in approvals.ts as needing a second person for anybody but the
 * owner — because it writes over figures somebody has already signed off. What
 * it is NOT is a re-run of the same act, so the screen says which it is: the
 * old figures come off, the money recorded with them is reversed on the ledger,
 * and what is typed here replaces them.
 */
const recounting = computed(() => props.book.status === 'Settled')
/** Still in the seller's hands, so this screen asks them rather than deciding. */
const asking = computed(() => props.book.status === 'Out')

const unsoldList = computed(() =>
  unsold.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))

/**
 * Each entry with the ticket it resolves to, so nothing below resolves twice.
 *
 * A RANGE BECOMES ITS TICKETS, one entry each, and every one of them keeps the
 * range as its `raw`. That is what makes the checks below work unchanged: a
 * range that strays into the next book is reported by the not-in-this-book
 * check exactly as a single stray number would be, and named as the range the
 * person typed rather than as a number they never wrote down.
 */
const entries = computed(() =>
  unsoldList.value.flatMap(raw => {
    const spread = expandTicketRange(raw)
    if (spread) return spread.map(num => ({ raw, num }))
    return [{ raw, num: resolveTicketNumber(raw) }]
  }))

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
const unresolved = computed(() =>
  [...new Set(entries.value.filter(e => !e.num).map(e => e.raw))])

/**
 * TYPED A TICKET THAT IS ALREADY RECORDED AS SOLD.
 *
 * The server refuses this — SOLD_TICKET_NAMED_UNSOLD — because counting a book
 * in must not erase a buyer's name and telephone number as a side effect. But
 * it refuses AFTER the button, which is the same complaint this screen already
 * makes about numbers from another book: the organiser finds out having already
 * committed, with a seller standing there.
 *
 * It matters more with ranges than it ever did by hand. "3291-3300" is ten
 * tickets nobody reads out one at a time, and if three of them sold last week
 * the range quietly claims they came back.
 *
 * Placeholders a previous settlement wrote (source 'settlement') are not buyers
 * anybody recorded, and the server allows a forced re-settle to name them, so
 * they are not flagged here either. The two rules have to agree or the screen
 * blocks something the server would have accepted.
 */
const alreadySold = computed(() =>
  [...new Set(entries.value
    .filter(e => e.num)
    .map(e => state.byNumber[e.num])
    // isSold, not a comparison spelled out again here. "Sold" and "Donated" are
    // both spoken for, and a screen that remembers only the first gives a
    // donated ticket away twice — which is why soldlock.test.mjs refuses a
    // second copy of the rule anywhere in the client.
    .filter(t => t && isSold(t) && t.source !== 'settlement')
    .map(t => `${short(t.number)}${t.name ? ` (${t.name})` : ''}`))])

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
 * NOTHING SOLD IS NOT A COUNT-IN, AND COUNTING IT IN IS A ONE-WAY DOOR.
 *
 * Reported from the live raffle, and it is the Book-084 freeze approached from
 * the other end. A book came back with every ticket still in it, was counted in
 * at nought, and the screen said Finished · RM0 — correctly. What nobody was
 * told is that the ten unsold tickets went with it: a settled book cannot be
 * sold from, by anybody, the organiser holding the paper included. Ten sellable
 * tickets left the raffle, quietly, with nothing on the screen saying so and no
 * control on it to undo it.
 *
 * NOTHING WAS BROKEN, which is why it lasted. Every rule involved is right —
 * counting in reconciles a book's money, and a reconciled book must not keep
 * selling. What was wrong is that this screen offered "Finish this book" as THE
 * thing to do at the one moment it was the wrong thing. There was no money to
 * reconcile, so the count-in recorded nothing and cost ten tickets.
 *
 * A book with nothing sold has not been counted in. It has come back, which is
 * `return_books`: one act, nobody's approval, and the book is free to go out
 * again or be sold from the desk the moment it lands. So that is what the
 * screen offers here, and the count-in stays on it for whoever means it.
 */
const nothingSold = computed(() =>
  !lost.value && inBook.value.length > 0 && sold.value === 0)

/** Nothing sold AND no money: a count-in that would record nothing at all. */
const nothingToCount = computed(() => nothingSold.value && paidNum.value === 0)

/*
 * ...and it is still out with somebody, so bringing it back is the act that is
 * actually being asked for. A book already handed back needs nothing doing: it
 * is on the desk, it is free to give out, and the screen says so instead.
 */
const putBackInstead = computed(() => nothingToCount.value && props.book.status === 'Out')

/** Brought back rather than closed — the same button, without the trapdoor. */
async function putBack() {
  busy.value = true
  try {
    await api('return_books', { fromBook: props.book.book, toBook: props.book.book })
    toast(`${props.book.book} is back — its tickets can still be sold`, 'ok')
    emit('put-back')
    loadDelta().then(refresh)
  } catch (err) { toast(err.message, 'bad', err.code) } finally { busy.value = false }
}

/**
 * Typed a real ticket, but one from a different book.
 *
 * resolveTicketNumber searches the whole raffle, so a number from another book
 * resolves perfectly well and would be sent as "came back" for this one. That
 * is the silent wrong answer: the ticket is real, the form accepts it, and two
 * books end up describing the same ticket differently.
 */
const wrongBook = computed(() =>
  [...new Set(entries.value
    .filter(x => x.num && state.byNumber[x.num]?.book &&
                 state.byNumber[x.num].book !== props.book.book)
    // Deduplicated: a ten-ticket range that overruns this book would otherwise
    // report the same sentence ten times.
    .map(x => `${x.raw} (${state.byNumber[x.num].book})`))])

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
  /*
   * And the opposite mistake: a ticket already recorded as sold, named as one
   * that came back. The server refuses it by name; stopping here means the
   * organiser is told while the seller is still standing there, rather than
   * after the settlement appears to have been taken.
   */
  if (!lost.value && alreadySold.value.length) {
    return toast('Some of those tickets are recorded as sold. Correct or void the sale ' +
                 'first, so the record says why — counting a book in does not erase a buyer.',
                 'bad')
  }
  busy.value = true
  try {
    const payload = { bookNumber: props.book.book, amountPaid: paidNum.value }
    // Only when it is actually a second count-in. Sending force on an ordinary
    // one would ask for an approval nobody needs.
    if (recounting.value) payload.force = true
    if (lost.value) { payload.allowUnidentified = true; payload.soldCount = sold.value }
    // Resolved and de-duplicated, so what is sent is exactly what the preview
    // counted. Nothing unresolved can be in it, because the button refuses
    // above while anything on the list is still wrong.
    else payload.unsoldTickets = returned.value

    /*
     * A BOOK STILL OUT IS ASKED FOR, NOT COUNTED.
     *
     * The seller is the one holding the stubs, and the figures on this screen
     * are the desk's reading of what has been written down — which does not
     * include the tickets they sold this morning and have not entered. So for a
     * book that is Out these numbers go TO them as a proposal, they check it
     * against what is in their hand, and their agreement is what settles it.
     *
     * A book that is already back on the desk is counted here as it always was:
     * the paper is present, and that is the whole difference.
     */
    if (asking.value) {
      const r = await api('request_count_in', payload)
      toast(`Asked ${r.detail?.agentName || 'the seller'} to check ${props.book.book}`, 'ok')
      emit('settled')
      loadDelta().then(refresh)
      return
    }

    const r = await api('settle_book', payload)
    toast(`${props.book.book} counted — ${r.declaredSold} sold`,
      Math.abs(r.variance) > 0.005 ? 'bad' : 'ok')
    emit('settled')
    loadDelta().then(refresh)
  } catch (err) { toast(err.message, 'bad', err.code) } finally { busy.value = false }
}
</script>

<template>
  <Sheet :title="recounting ? `Count in ${book.book} again` : `Count in ${book.book}`"
         :subtitle="book.agentName ? `from ${book.agentName}` : ''" @close="emit('close')">
      <!-- SAID BEFORE THE FIGURES, because it changes what they mean: on a book
           still out these are a proposal the seller checks, not a record. -->
      <p v-if="asking" class="note">
        <b>{{ book.agentName || 'The seller' }} has to agree to this.</b>
        They are holding the stubs, and they may have sold tickets this morning
        that are not written down yet. These figures go to them to check.
      </p>

    <div v-if="recounting" class="note warn">
      <b>This book has already been counted in.</b>
      What you type here replaces the figures on it: the money recorded with the old
      count is reversed on the ledger and this count is recorded in its place. Both
      stay on the record, so the correction can be read afterwards.
    </div>

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
          Separate with commas or spaces, or type a run as
          <b v-if="range">{{ range.first }}–{{ range.last }}</b><b v-else>911–920</b>.
          Leave empty if the whole book sold.
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
      <!-- MONEY THAT IS ALREADY IN, said before the number is typed rather than
           queried afterwards. Typing this book's full value over an interim
           hand-over is the one mistake this screen makes that nothing else
           catches: both figures are right on their own and the seller ends up
           in credit for cash nobody received twice. The balance is offered as
           a tap, and the organiser is still free to type whatever was actually
           put on the table. -->
      <div v-if="alreadyIn > 0.005" class="note warn" style="margin-top:8px">
        <b>{{ money(alreadyIn, currency) }} already handed in</b>, against no book —
        {{ props.book.agentName || 'they' }} paid it while still selling.
        <div class="small" style="margin-top:4px">
          This book comes to <b>{{ money(due, currency) }}</b>.
          <template v-if="standing"> They owe <b>{{ money(standing.owed, currency) }}</b> in
          total.</template>
          Do not take it twice.
        </div>
        <button type="button" class="btn sm" style="margin-top:8px"
                @click="paid = String(Math.max(0, Math.round((due - alreadyIn) * 100) / 100))">
          Use {{ money(Math.max(0, due - alreadyIn), currency) }} — the balance on this book
        </button>
      </div>
    </div>

    <!-- A number here that is not a real ticket must never be sent quietly.
         Anything NOT on this list counts as sold and is charged to the agent,
         so one that fails to match moves a ticket to the sold side and adds its
         price to what that volunteer owes. -->
    <div v-if="alreadySold.length" class="note bad">
      <b>Already recorded as sold:</b> {{ alreadySold.join(', ') }}
      <div class="small" style="margin-top:4px">
        Counting the book in does not erase a buyer. If that sale was wrong, correct or
        void it first so the record says why.
      </div>
    </div>

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

    <!--
      THE CONSEQUENCE, SAID BEFORE THE PRESS.

      A count-in at nought closes the book and freezes every ticket left in it.
      The old screen said neither half: it showed "0 sold · RM0" — which reads
      as harmless — and offered Finish. The organiser found out days later, when
      a ticket lying on the desk in front of them could not be sold by anybody.
    -->
    <div v-if="nothingSold" class="note warn">
      <b>Nothing sold in this book.</b>
      <span class="helpword" :title="COUNTED_IN_HELP">Counting it in</span> closes the
      book, and the {{ held }} tickets still in it freeze with it — nobody can sell
      them until an organiser puts the book back on the shelf.
      <template v-if="putBackInstead">
        Bringing it back is the whole job here: the book returns to the desk free, and
        its tickets can be sold from there or given to somebody else.
      </template>
      <template v-else-if="handedBack">
        It is already back at the desk and free to give out again, so there is nothing
        here to count in.
      </template>
    </div>

    <label class="lostbox">
      <input type="checkbox" v-model="lost">
      <span v-if="handedBack">The leftover tickets did not come back</span>
      <span v-else>They lost the leftover tickets</span>
    </label>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <!-- The act that is actually being asked for, first. The count-in is
           DEMOTED RATHER THAN REMOVED: a book whose leftovers are gone, or a
           figure being corrected, still needs it, and it is not this screen's
           place to decide that nobody ever means it. It just stops looking like
           the step that was being asked for. -->
      <button v-if="putBackInstead" class="btn primary" :disabled="busy" @click="putBack">
        {{ busy ? 'Saving…' : 'Mark it brought back' }}
      </button>
      <button :class="['btn', nothingToCount ? 'ghost' : 'primary']"
              :disabled="busy || unresolved.length || wrongBook.length || alreadySold.length"
              @click="settle">
        {{ busy ? 'Saving…'
           : asking && nothingToCount ? 'Ask them to count it in anyway'
           : asking ? 'Ask them to check it'
           : nothingToCount ? 'Count it in anyway' : 'Finish this book' }}
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
