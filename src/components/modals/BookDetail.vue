<script setup>
import { computed, ref, onMounted } from 'vue'
import { state, isAdmin, go, bookBlock, isSold, api } from '../../lib/store.js'
import { custodyOf } from '../../lib/books.js'
import { money, date, BOOK_WORDS, COUNTED_IN_HELP } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import RoleTag from '../ui/RoleTag.vue'
import Who from '../ui/Who.vue'
import StatusPill from '../ui/StatusPill.vue'
import History from './History.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['withdraw-offer', 'close', 'settle', 'receipt', 'see-tickets', 'sell-book', 'restock', 'view-book', 'print-book', 'print-sample'])

// `permissionui`: shown and disabled rather than hidden, matching the
// cannotSellWhole button already on this sheet.
const ADMIN_ONLY_WHY = 'Only an organiser can do this'

/*
 * Whether this raffle has artwork to print tickets onto. A yes or no carried on
 * the boot config — not the artwork itself, which would be kilobytes of
 * coordinates sent to every screen to answer a question two buttons ask.
 */
const hasArtwork = computed(() => !!state.cfg?.ticketArtwork)
const noArtworkWhy = 'No ticket artwork has been uploaded yet — see the Ticket Studio screen.'

const currency = computed(() => state.cfg?.currency || '')
const canSettle = computed(() => ['Out', 'Returned'].includes(props.book.status))

/**
 * COUNTING A BOOK IN AGAIN, when the figures on it are wrong.
 *
 * settle_book has taken a `force` since it was written, and approvals.ts has a
 * sentence for it — "settle a book again, over a settlement that is already
 * recorded" — so the server has always expected this to happen. No screen could
 * ask for it. A book counted in with the wrong money, or counted in twice by
 * two people, or counted in at nought by mistake, was final.
 *
 * THAT IS NOT THE SAME DOOR AS PUTTING IT BACK ON THE SHELF, and the difference
 * matters. Restocking throws the settlement away and returns the tickets to
 * stock; re-counting keeps the book closed and corrects what it says. The one
 * that was missing is the smaller one, which is why the money on a book could
 * be wrong with no way to put it right — and why restock, which refuses a book
 * with money owed on it, then read as a locked door rather than as a guard.
 */
const canRecount = computed(() => isAdmin.value && props.book.status === 'Settled')

/**
 * Every sale in this book was written down by the person reading the screen.
 *
 * YOU COUNT MONEY IN FROM SOMEBODY. Counting a book in is the moment a seller
 * hands back the leftovers and the cash; it is a transaction with a person on
 * the other side of it. When the sales were recorded at the office by whoever
 * is looking at this sheet, there is nobody on the other side — the money went
 * into the tin at the time, and "Count it in" is asking them to collect from
 * themselves.
 *
 * REPORTED FROM FOUR REAL BOOKS. Book-001, 002, 003 and 116 came back, were
 * sold whole at the desk two days later, and the sale was credited to whoever
 * had been holding the book — so the sheet showed a volunteer owing RM100 for
 * tickets the organiser had sold and already been paid for. The attribution is
 * a separate repair; this stops the screen inviting the wrong action while it
 * is still wrong.
 *
 * ALL, not any. A book with one desk sale and nine a seller made still has
 * money to collect, and disabling it there would strand that seller's cash. It
 * also fails toward the button WORKING: before the tickets have loaded there
 * are no rows to judge, so the answer is false and nothing is taken away.
 */
const soldByMe = computed(() => {
  const me = String(state.user?.email || '')
  if (!me) return false
  const inBook = state.tickets.filter(t => t.book === props.book.book && isSold(t))
  return inBook.length > 0 && inBook.every(t => String(t.by || '') === me)
})

/** Why the button is greyed, said where somebody will read it. */
const settleHelp = computed(() => soldByMe.value
  ? 'Every sale in this book was written down by you, at the office, so the money '
    + 'is already in. Counting a book in is collecting it from the person who was '
    + 'holding it — there is nobody to collect from here.'
  : COUNTED_IN_HELP)

/**
 * Present tense only while it is true.
 *
 * held_by_agent survives Returned and Settled on purpose — settlement has to
 * know whose money it is — so the name is still there after the book is back.
 * Saying "who HAS it" then contradicts the status directly above.
 */
/*
 * Moved into books.js so the grid answers it the same way. This row and the
 * grid's tooltip were two copies of one fact, and both went silent on Offered.
 */
/*
 * BUILT FROM state.agents RATHER THAN IMPORTING THE STORE'S agentMap, and the
 * reason is the harnesses. Four suites render this sheet against a stubbed
 * store, and a stub exports what the component needed on the day it was
 * written — so reaching for one more export broke the bundle in every one of
 * them before a single assertion ran. `state` is already imported here and
 * every stub carries agents, so this asks for nothing new.
 */
const agents = computed(() =>
  Object.fromEntries((state.agents || []).map((a) => [a.id, a])))
const custody = computed(() => custodyOf(props.book, agents.value))

/**
 * Reprinting a lost handover paper starts here. It used to be chained behind
 * "Count it in" as a v-else-if, which meant it never appeared: a receipt only
 * lists books that are Out, and an Out book can always be counted in. The
 * button showed up only once the book was settled — by which time there was
 * nothing left to put on the sheet.
 */
const canPrintReceipt = computed(() =>
  isAdmin.value && !!props.book.agentId && props.book.status === 'Out')

const blocked = computed(() => bookBlock(props.book))

/**
 * A WHOLE-BOOK SALE NEEDS A WHOLE BOOK.
 *
 * The button only asked whether any ticket was still available, so a book with
 * 8 of its 10 gone offered "Sell it whole" — and the server sold the remaining
 * two to somebody who had asked for a book, reporting the other eight as
 * skipped. One act, one buyer, one price and one receipt is what a whole-book
 * sale means; two stubs out of a book is not that.
 *
 * The server refuses it now as BOOK_NOT_WHOLE, which is where the rule has to
 * live. This is so the control is not offered in the first place — disabled
 * with the reason on it, which is this file's own rule about the difference
 * between hiding a button and explaining one.
 */
const notWhole = computed(() => Number(props.book?.sold || 0) > 0
  ? `${props.book.sold} of its tickets are already sold`
  : '')

/** Either reason, whichever applies, for the one control that has both. */
const cannotSellWhole = computed(() => blocked.value || notWhole.value)

/**
 * THE WAY BACK OUT, ON THE BOOK IT IS ABOUT.
 *
 * Putting a book back on the shelf has existed on the server since the
 * beginning and, since the Book-084 report, on the Books screen as well — a
 * bulk sheet under "Other things you can do" that asks you to type the book's
 * number back in. It was reported missing again anyway, and by somebody looking
 * at exactly this sheet: a book counted in with everything returned, every
 * ticket in it frozen, and the only control on the screen a greyed-out "Sell it
 * whole" with no way forward from it.
 *
 * A way out that lives on another screen, behind a generic heading, and asks
 * you to re-identify the book you are already looking at is not one most people
 * will find. So it is here, where the dead end is met.
 *
 * ONLY FOR A BOOK THAT HAS BEEN COUNTED IN. A book merely brought back is not
 * stuck — it can be sold from and given out again as it stands — and a control
 * that undoes a count-in sitting beside the one that performs it is an invitation
 * to undo a settlement that was right.
 */
const canShelve = computed(() => isAdmin.value && props.book.status === 'Settled')

/**
 * Tickets that never sold, in a book that can no longer sell them.
 *
 * The number was on the sheet all along as part of `available` and said nothing
 * about itself; this is the sentence that turns it into the fact somebody needs.
 */
const frozen = computed(() =>
  props.book.status === 'Settled' ? Number(props.book.available || 0) : 0)

/**
 * TWO GAPS ON THIS SHEET, AND THEY WERE BEING SHOWN AS ONE.
 *
 * "Difference" sat directly under Should have and Handed in, so every reader
 * took it for the third row of that sum — the cash shortfall. It was not. It
 * was `variance_amount`, the seller's declared count against the ticket numbers
 * actually written down, which is a different question with a different answer.
 * The two diverge the moment a seller reports ten sold and nine are on paper.
 *
 * So they are two rows now, each saying which question it answers:
 *
 *   Still owed                  should have  −  handed in     (cash)
 *   Sold but not written down   declared     −  recorded      (paper)
 *
 * ONLY ONCE THE BOOK HAS BEEN COUNTED IN. Before that there is no declared
 * figure and no handed-in figure — `amount_due` and `amount_paid` are both null
 * — and printing "Handed in RM0.00" against a book that is simply still out
 * accuses a seller of having paid nothing. The server now says which it is.
 *
 * The count gap is signed and the sign matters, so the label follows it rather
 * than the number carrying a minus into a row headed with a positive noun.
 */
const owed = computed(() => Number(props.book.expected || 0) - Number(props.book.paid || 0))
const owedLabel = computed(() => (owed.value < 0 ? 'Over by' : 'Still owed'))

/**
 * "STILL OWED" ON A BOOK STOPPED BEING THE WHOLE TRUTH THE DAY MONEY COULD
 * ARRIVE WITHOUT A BOOK CLOSING.
 *
 * A seller halfway through a book can now hand over what they have taken and
 * carry on selling. That cash is recorded against the SELLER; the book it came
 * out of still shows nothing paid, because nobody has counted it in. When the
 * book is finally counted in, the organiser takes the BALANCE — the rest of it
 * — and the book records that. Correct, and the two lines above then read:
 *
 *     Should have   RM100
 *     Handed in     RM40
 *     Still owed    RM60      <- in red, and nobody owes it
 *
 * The sixty is in the tin. It went in weeks ago, against no book. This sheet
 * cannot see it, so it drew a debt that does not exist on the screen an
 * organiser opens to decide whether to chase somebody — which is worse than
 * showing nothing, because a wrong red figure gets acted on.
 *
 * So the seller's own standing is fetched and the row is explained rather than
 * hidden: the book really is short by sixty, and the person really does not owe
 * it. Both are facts and the sheet now says which is which.
 *
 * FAILING QUIETLY IS RIGHT. This is one line on a sheet of twenty, and a book
 * must still open when a second read does not come back.
 */
const standing = ref(null)
onMounted(async () => {
  /*
   * ONLY WHERE THE QUESTION CAN ARISE. This sheet is opened constantly and the
   * read behind it is not small, so it is not made on every book — only on one
   * that has been counted in and still shows a shortfall, which is the only
   * shape that can be a debt somebody already paid. Every other book opens
   * exactly as fast as it did before.
   */
  if (!props.book?.countedIn || owed.value <= 0.005) return
  const holder = String(props.book?.agentId || '')
  if (!holder) return
  const mine = String(state.user?.agentId || '') === holder
  const staff = state.user?.role === 'admin' || state.user?.role === 'recorder'
  if (!mine && !staff) return
  try {
    standing.value = await api('report_draft', mine ? {} : { agentId: holder })
  } catch { standing.value = null }
})
/** Money from this seller that sits against no book at all. */
const loose = computed(() => Number(standing.value?.handedIn || 0))
/** What the PERSON owes, which is the number a chase decision is made on. */
const theyOwe = computed(() => Number(standing.value?.owed ?? NaN))
/* Only where the book's debt and the person's disagree. In the ordinary case
   the two say the same thing and a second sentence about it is noise. */
const debtIsExplained = computed(() =>
  owed.value > 0.005 && loose.value > 0.005 && !Number.isNaN(theyOwe.value) &&
  theyOwe.value < owed.value - 0.005)
const countGap = computed(() => Number(props.book.variance || 0))
const countGapLabel = computed(() => (countGap.value > 0
  ? 'Sold but not written down'
  : 'Written down but not declared'))

/*
 * Opened ON TOP of this sheet rather than instead of it, so closing the history
 * puts you back on the book you were looking at. Replacing it would make "where
 * has this been?" cost you your place, which is how a useful screen stops being
 * opened.
 */
const showHistory = ref(false)
</script>

<template>
  <Sheet :title="book.book" :subtitle="`${book.firstTicket} – ${book.lastTicket}`" @close="emit('close')">
    <div class="facts">
      <div class="f"><span>Where it is</span><StatusPill :status="book.status" kind="book" /></div>

      <!-- THE LABEL FOLLOWS THE STATE, because it was contradicting the row
           above it. A book that is Brought back said "Who has it: JOHN" — the
           screen telling a volunteer, in two consecutive lines, that the book is
           here and that JOHN has it. held_by_agent is deliberately kept through
           Returned and Settled so settlement knows whose money it is, which is
           right; reading it as present tense afterwards is what was wrong.

           And the row is dropped entirely when nobody holds it. "In the office"
           followed by "Who has it: nobody" is the same fact twice, and the
           second one is phrased as if something were missing. -->
      <div v-if="custody.has" class="f">
        <span>{{ custody.label }}</span><b>{{ custody.name }}<RoleTag seller /></b>
      </div>

      <!-- Only while it is actually out. A due date on a book already back is an
           obligation that no longer exists, sitting in the middle of the facts
           as though it did. -->
      <div v-if="book.due && book.status === 'Out'" class="f"><span>Due back</span>
        <b :style="book.daysOverdue > 0 ? 'color:var(--bad)' : ''">
          {{ date(book.due) }}<template v-if="book.daysOverdue > 0"> — {{ book.daysOverdue }} days late</template>
        </b>
      </div>
      <!-- A REPORT NOBODY HAS ACCEPTED YET. The book has not moved and will
           not until somebody accepts, so every other row here is unchanged —
           which is exactly why this one has to be said. Without it the seller
           and the organiser are both looking at a book that shows no sign of
           having been reported at all. -->
      <div v-if="book.inReport" class="f">
        <span>Reported</span><b style="color:var(--warn)">waiting to be accepted</b>
      </div>
      <div class="f"><span>Sold</span><b>{{ book.sold }} of {{ state.cfg.ticketsPerBook }}</b></div>
      <div class="f"><span>Should have</span><b>{{ money(book.expected, currency) }}</b></div>
      <template v-if="book.countedIn">
        <div class="f"><span>Handed in</span><b>{{ money(book.paid, currency) }}</b></div>
        <!-- A→B. Counting a book in is cash moving from the person who was
             holding it to the person who took it, and this sheet named only the
             amount. The holder is two rows above; this is the other end, and
             the column it comes from has been written since settle_book existed
             and read back by nothing. -->
        <div v-if="book.settledBy" class="f">
          <span>Counted in by</span><b><Who :email="book.settledBy" /></b>
        </div>
        <div v-if="Math.abs(owed) > 0.005" class="f">
          <span>{{ owedLabel }}</span>
          <!-- Not red when the money is accounted for elsewhere. Red is the
               signal to go and chase somebody, and there is nobody to chase. -->
          <b :style="owed > 0 && !debtIsExplained ? 'color:var(--bad)' : ''">{{
            money(Math.abs(owed), currency) }}</b>
        </div>
        <div v-if="debtIsExplained" class="f why">
          <span>
            {{ book.agentName || 'They' }} handed in
            <b>{{ money(loose, currency) }}</b> before this book was counted in.
            <template v-if="theyOwe > 0.005">
              They owe <b>{{ money(theyOwe, currency) }}</b> in total.
            </template>
            <template v-else>They owe nothing.</template>
          </span>
        </div>
        <div v-if="Math.abs(countGap) > 0.005" class="f">
          <span>{{ countGapLabel }}</span>
          <b style="color:var(--warn)">{{ money(Math.abs(countGap), currency) }}</b>
        </div>
      </template>
      <div v-else class="f"><span>Handed in</span><b class="pending">not counted in yet</b></div>
      <div v-if="book.missingContact" class="f">
        <span>No phone number</span><b style="color:var(--bad)">{{ book.missingContact }} tickets</b>
      </div>
    </div>

    <!-- Said on the sheet rather than only in the button, because the button
         answers "what can I do" and this answers "what has happened to my
         tickets" — which is the question somebody arrives here with. -->
    <div v-if="frozen > 0" class="note warn">
      <b>{{ frozen }} {{ frozen === 1 ? 'ticket' : 'tickets' }} in this book never sold,
        and cannot be sold now.</b>
      {{ book.book }} has been <span class="helpword" :title="COUNTED_IN_HELP">counted in</span>,
      which closes it. Putting it back on the shelf returns
      {{ frozen === 1 ? 'that ticket' : 'those tickets' }} to the office so
      {{ frozen === 1 ? 'it' : 'they' }} can be sold again. The count-in is undone with
      it — the figures are cleared and any money recorded against them is reversed on
      the ledger — and every ticket already sold keeps its buyer.
    </div>

    <template #actions>
      <button class="btn" @click="emit('see-tickets', book)">See its tickets</button>
      <!--
        Looking at the printed ticket, and printing it. Both are organisers'
        work and both need artwork to exist, so they are shown DISABLED with
        the reason rather than refused after the press — the rule every other
        control on this sheet is held to. The title is bound only when there is
        something to say, because a valueless title attribute is its own bug.
      -->
      <button class="btn" :disabled="!isAdmin || !hasArtwork"
              :title="!isAdmin ? ADMIN_ONLY_WHY : (hasArtwork ? null : noArtworkWhy)"
              @click="emit('view-book', book)">View a ticket</button>
      <button class="btn" :disabled="!isAdmin || !hasArtwork"
              :title="!isAdmin ? ADMIN_ONLY_WHY : (hasArtwork ? null : noArtworkWhy)"
              @click="emit('print-book', book)">Print this book</button>
      <button class="btn" :disabled="!isAdmin || !hasArtwork"
              :title="!isAdmin ? ADMIN_ONLY_WHY : 'Ten watermarked sample tickets. Not in the raffle, cannot be sold.'"
              @click="emit('print-sample')">Print samples</button>
      <button class="btn" title="Every hand this book has passed through"
              @click="showHistory = true">Where it has been</button>
      <!-- Shown and DISABLED rather than hidden, when this person cannot sell
           from this book. Hiding it makes the app look different to different
           people for no stated reason; letting them press it makes the server
           refuse after they have committed to the action. Disabled with the
           reason on it is the only one of the three that tells them anything. -->
      <button v-if="book.available" class="btn" :disabled="!!cannotSellWhole"
              :title="cannotSellWhole ? `Cannot sell it whole — ${cannotSellWhole}` : undefined"
              @click="emit('sell-book', book)">
        Sell it whole
      </button>
      <button v-if="canPrintReceipt" class="btn" @click="emit('receipt', book.agentId)">Receipt</button>
      <!-- The tooltip is the answer to a question that was actually asked:
           if the whole book is sold, why is this still here. Sold is about
           tickets; this is about money, and they are different facts. -->
      <button v-if="canSettle" class="btn primary"
              :disabled="soldByMe || !isAdmin" :title="!isAdmin ? ADMIN_ONLY_WHY : settleHelp"
              @click="emit('settle', book)">Count it in</button>

      <!-- Primary only while the book is actually stuck. On a book that sold
           out entirely this is a correction somebody may need and should not be
           invited into; on one holding tickets nobody can sell, it is the only
           thing on the screen worth pressing. -->
      <!-- Before the shelf button, because it is the smaller correction and the
           one somebody usually wants: the book stays closed and its figures are
           put right. -->
      <!-- TAKING AN OFFER BACK, on the screen where somebody is standing when
           they decide to. Until this existed the only route was the Approvals
           list, which is the SELLER'S list of things to answer rather than the
           organiser's list of things they have sent — so an offer made by
           mistake could only be undone by waiting a week for it to lapse.
           Nothing has been accepted, so nothing has to come back: the books go
           straight to the shelf and the seller's request closes as cancelled. -->
      <button v-if="book.status === 'Offered'" class="btn primary"
              :disabled="!isAdmin"
              :title="!isAdmin ? ADMIN_ONLY_WHY : 'Take the offer back — nothing has been accepted, so the books go straight to the shelf'"
              @click="emit('withdraw-offer', book)">Take it back</button>

      <button v-if="canRecount" class="btn" @click="emit('settle', book)">Count it in again</button>
      <!-- The same words as the Books toolbar, shortened the same way: the
           sentence is in the title and the sheet keeps the full phrase. A
           button and the instruction that sends somebody to it must read the
           same, which is why SellTicket's "Books → …" moved with it. -->
      <button v-if="canShelve" :class="['btn', frozen > 0 ? 'primary' : '']"
              title="Put it back on the shelf — unsold tickets go back into the office"
              @click="emit('restock', book)">Back on the shelf</button>

      <!-- GHOST, not another button. Four controls of identical weight is a row
           with no answer to "what am I meant to do here", and the browser's
           focus ring lands on the last one — so Close, the only control that
           does nothing, was the one that looked chosen. Closing is always
           available from the × as well; this is the second way out, not an
           action, and it should not compete with three that are. -->
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>

    <!-- Later in the DOM than this sheet, which is fixed at z-index 60, so it
         paints over without unmounting anything underneath. -->
    <History v-if="showHistory" :book="book.book" @close="showHistory = false" />
  </Sheet>
</template>

<style scoped>
.facts { display: grid; gap: 14px; }
.f { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.f span { color: var(--muted); }
.f b { text-align: right; font-family: var(--font-data); font-variant-numeric: tabular-nums; }
/* The sentence under a figure that would otherwise be read as a debt. Full
   width and left-aligned, because it is prose and the rows above are a table. */
.f.why { display: block; }
.f.why span { display: block; font-size: .84rem; line-height: 1.45; text-align: left; }
.f.why b { color: var(--text); }
/* A stated absence, not a figure. It must not read as an amount. */
.pending { color: var(--muted); font-weight: 400; }
</style>
