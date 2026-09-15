<script setup>
/**
 * Where a book — or one ticket in it — has been, and who had it at each step.
 *
 * THE QUESTION THIS ANSWERS is an ordinary one on a Saturday morning: somebody
 * is holding ticket KS-00413, it says Sold, and they want to know who gave the
 * book out, who was carrying it, and who wrote the sale down. Until now every
 * one of those movements was recorded and none of them could be read back. The
 * book_history table has been written to since the first version and the
 * book_history action has existed on both backends, open to every role on
 * purpose — the person who needs to know where a book went is usually the one
 * holding the clipboard, not an organiser. Nothing in the app had ever called
 * it. This is its first reader.
 *
 * A TICKET HAS NO TRAIL OF ITS OWN, and the honest thing is to say so rather
 * than invent one. The tickets table keeps the LATEST state with an author and
 * a time — sold_by_agent, sold_at, recorded_by, source — and a correction
 * overwrites it, so a previous buyer is genuinely gone. What a ticket does have
 * is the custody of the book it lives in, which is most of what people are
 * asking about. So a ticket's history is its own sale merged into its book's
 * movements, in one order, and the sale is marked as the single point it is.
 */
import { ref, computed, onMounted } from 'vue'
import { api, state, agentMap, isSold } from '../../lib/store.js'
import { dateTime, money, plainName, isSellerContact } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'
import StatusPill from '../ui/StatusPill.vue'

const props = defineProps({
  /** The book number to trace. Required — a ticket supplies its own book's. */
  book: String,
  /** Optional: the ticket whose sale is being asked about. */
  ticket: Object,
})
const emit = defineEmits(['close'])

const trail = ref(null)
const problem = ref('')

const bookNumber = computed(() => props.ticket?.book || props.book || '')

/*
 * Named, not inline in onMounted, for the reason the receipt learned the hard
 * way: setup() can be called directly but onMounted never fires from it, so a
 * load buried in the hook cannot be driven by a test at all. That is untestable
 * rather than untested, and it is a one-word difference to avoid.
 */
onMounted(load)

async function load() {
  if (!bookNumber.value) { problem.value = 'There is no book to trace this back to.'; return }
  try {
    trail.value = await api('book_history', { bookNumber: bookNumber.value })
  } catch (err) {
    // Stays open and says what happened. A sheet that dismisses itself is
    // indistinguishable from a crash, which is how the receipt got reported.
    problem.value = err.message
  }
}

/**
 * The words a volunteer reads, for the verbs the server writes.
 *
 * `issue`, `transfer`, `return`, `settle` and `restock` are written by the book
 * handlers; the rest are a status somebody set by hand, lower-cased, so
 * `set_book_status` contributes `lost`, `void`, `out`, `returned` and
 * `unassigned` without anybody having listed them anywhere.
 */
const WORDS = {
  issue: 'Given out',
  transfer: 'Passed on',
  return: 'Brought back',
  settle: 'Counted in',
  restock: 'Put back in stock',
  lost: 'Reported lost',
  void: 'Cancelled',
  out: 'Marked as out',
  returned: 'Marked as brought back',
  unassigned: 'Marked as back in stock',
}

/** Unknown verbs read as themselves rather than vanishing from the trail. */
function words(action) {
  return WORDS[action] || String(action || '').replace(/^\w/, c => c.toUpperCase())
}

/** "from JOHN to MARY", "to JOHN", "from JOHN" — whichever the step had. */
function movement(h) {
  if (h.from && h.to) return `from ${h.from} to ${h.to}`
  if (h.to) return `to ${h.to}`
  if (h.from) return `from ${h.from}`
  return ''
}

/**
 * The ticket's own sale, as one step in the same list.
 *
 * Only when it HAPPENED. An unsold ticket has no sale to show, and a row saying
 * nothing was sold at an empty time is noise on the one screen that exists to
 * be read carefully.
 */
const sale = computed(() => {
  const t = props.ticket
  if (!isSold(t)) return null
  const seller = agentMap.value[t.agent]
  return {
    at: t.saleDate || t.modified || '',
    who: seller?.name || t.agent || '',
    by: t.by || '',
    buyer: plainName(t.name),
    sellerIsContact: isSellerContact(t.name),
    amount: t.amount,
    payment: t.payment,
    // Filled in at settlement means nobody wrote the buyer down at the table.
    fromSettlement: t.source === 'settlement',
  }
})

/**
 * Book movements and the sale in ONE order, oldest first.
 *
 * Merged rather than shown as two lists, because the question is nearly always
 * about the relationship between them — was it sold before or after the book
 * came back? Two lists side by side make the reader do that join in their head,
 * and that is exactly where somebody gets it wrong.
 */
const steps = computed(() => {
  const list = (trail.value?.history || []).map(h => ({
    kind: 'move', at: h.at, title: words(h.action), detail: movement(h),
    by: h.by, note: h.note,
  }))
  if (sale.value) list.push({ kind: 'sale', at: sale.value.at })

  // Undated entries sort last rather than to 1970: an unknown time is not the
  // beginning of the raffle, and putting it there tells a story that is wrong.
  return list.sort((a, b) => {
    if (!a.at) return 1
    if (!b.at) return -1
    return new Date(a.at) - new Date(b.at)
  })
})

const currency = computed(() => state.cfg?.currency || '')
const nothingRecorded = computed(() => !!trail.value && steps.value.length === 0)
</script>

<template>
  <Sheet :title="ticket ? `${ticket.number} — where it has been` : `${bookNumber} — where it has been`"
         :subtitle="ticket ? `In ${ticket.book}` : (trail?.book?.status ? `Now: ${trail.book.status}` : '')"
         @close="emit('close')">

    <p v-if="problem" class="note bad">{{ problem }}</p>

    <div v-else-if="!trail" class="col" style="gap:12px">
      <div v-for="i in 4" :key="i" class="skel"></div>
    </div>

    <!-- Recorded and empty is a real answer, and a different one from a book
         that never existed. A book sitting in the office has simply never
         moved, and saying so beats an empty panel that reads as a failure. -->
    <p v-else-if="nothingRecorded" class="note">
      Nothing has been recorded against {{ bookNumber }} yet. It has not been
      given out, so there is nowhere for it to have been.
    </p>

    <ol v-else class="trail">
      <li v-for="(s, i) in steps" :key="i" :class="['step', s.kind]">
        <span class="dot" aria-hidden="true"></span>

        <template v-if="s.kind === 'sale'">
          <div class="when">{{ dateTime(sale.at) }}</div>
          <div class="what">
            <b>Sold</b>
            <template v-if="sale.who"> by {{ sale.who }}</template>
            <StatusPill v-if="sale.payment" :status="sale.payment === 'Paid' ? 'Paid' : 'Unpaid'" />
          </div>
          <div class="who">
            <template v-if="sale.buyer && !sale.sellerIsContact">To {{ sale.buyer }}</template>
            <template v-else-if="sale.sellerIsContact">
              The seller's own contact is on it — they know who bought it
            </template>
            <template v-else>Nobody written down as the buyer</template>
            <template v-if="sale.amount"> · {{ money(sale.amount, currency) }}</template>
          </div>
          <div v-if="sale.fromSettlement" class="note warn tiny">
            Filled in when the book was counted, so nobody wrote down who bought it
            at the time.
          </div>
          <div v-if="sale.by" class="who">Written down by {{ sale.by }}</div>
        </template>

        <template v-else>
          <div class="when">{{ dateTime(s.at) }}</div>
          <div class="what"><b>{{ s.title }}</b> {{ s.detail }}</div>
          <div v-if="s.by" class="who">by {{ s.by }}</div>
          <div v-if="s.note" class="note-line">{{ s.note }}</div>
        </template>
      </li>
    </ol>

    <!-- Said once, at the bottom, because somebody reading a trail and NOT
         finding an old buyer in it should be told why rather than concluding
         the record is incomplete. -->
    <p v-if="ticket && trail && !problem" class="tiny muted mt">
      A ticket keeps only its current buyer. If this sale was corrected, the
      earlier name is not kept — the movements of the book above are.
    </p>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.trail { list-style: none; margin: 0; padding: 0; }

.step {
  position: relative;
  padding: 0 0 18px 22px;
  border-left: 2px solid var(--line, #e3e3e3);
}
.step:last-child { border-left-color: transparent; padding-bottom: 0; }

.dot {
  position: absolute; left: -7px; top: 3px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--muted); border: 2px solid var(--bg, #fff);
}
/* The sale is the step people came to look at. */
.step.sale .dot { background: var(--brand); }

.when { font-size: .78rem; color: var(--muted); }
.what { margin-top: 1px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.who { font-size: .85rem; color: var(--muted); margin-top: 2px; }
.note-line {
  font-size: .85rem; margin-top: 4px;
  padding-left: 10px; border-left: 2px solid var(--line, #e3e3e3);
}
.tiny { font-size: .8rem; }
</style>
