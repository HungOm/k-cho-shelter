<script setup>
import { computed, ref } from 'vue'
import { state, isAdmin, go, bookBlock, isSold } from '../../lib/store.js'
import { money, date, BOOK_WORDS, COUNTED_IN_HELP } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import RoleTag from '../ui/RoleTag.vue'
import Who from '../ui/Who.vue'
import StatusPill from '../ui/StatusPill.vue'
import History from './History.vue'

const props = defineProps({ book: Object })
const emit = defineEmits(['close', 'settle', 'receipt', 'see-tickets', 'sell-book', 'restock'])
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
const holderLabel = computed(() => ({
  Out: 'Who has it',
  Returned: 'Brought back by',
  Settled: 'Was with',
  Lost: 'Last with',
}[props.book.status] || 'Who has it'))

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
      <div v-if="book.agentName" class="f">
        <span>{{ holderLabel }}</span><b>{{ book.agentName }}<RoleTag seller /></b>
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
          <b :style="owed > 0 ? 'color:var(--bad)' : ''">{{ money(Math.abs(owed), currency) }}</b>
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
      <button class="btn" @click="showHistory = true">Where it has been</button>
      <!-- Shown and DISABLED rather than hidden, when this person cannot sell
           from this book. Hiding it makes the app look different to different
           people for no stated reason; letting them press it makes the server
           refuse after they have committed to the action. Disabled with the
           reason on it is the only one of the three that tells them anything. -->
      <button v-if="book.available" class="btn" :disabled="!!blocked"
              :title="blocked ? `Cannot sell — ${blocked}` : undefined"
              @click="emit('sell-book', book)">
        Sell it whole
      </button>
      <button v-if="canPrintReceipt" class="btn" @click="emit('receipt', book.agentId)">Receipt</button>
      <!-- The tooltip is the answer to a question that was actually asked:
           if the whole book is sold, why is this still here. Sold is about
           tickets; this is about money, and they are different facts. -->
      <button v-if="isAdmin && canSettle" class="btn primary"
              :disabled="soldByMe" :title="settleHelp"
              @click="emit('settle', book)">Count it in</button>

      <!-- Primary only while the book is actually stuck. On a book that sold
           out entirely this is a correction somebody may need and should not be
           invited into; on one holding tickets nobody can sell, it is the only
           thing on the screen worth pressing. -->
      <!-- Before the shelf button, because it is the smaller correction and the
           one somebody usually wants: the book stays closed and its figures are
           put right. -->
      <button v-if="canRecount" class="btn" @click="emit('settle', book)">Count it in again</button>
      <button v-if="canShelve" :class="['btn', frozen > 0 ? 'primary' : '']"
              @click="emit('restock', book)">Put it back on the shelf</button>

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
.f b { text-align: right; }
/* A stated absence, not a figure. It must not read as an amount. */
.pending { color: var(--muted); font-weight: 400; }
</style>
