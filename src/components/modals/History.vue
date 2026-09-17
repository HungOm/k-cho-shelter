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
 * A TICKET NOW HAS A TRAIL OF ITS OWN, and this screen was written before it
 * did. The tickets table still keeps only the LATEST state — a correction
 * overwrites the buyer — but every material change is copied into
 * ticket_history by a database trigger BEFORE the overwrite, append only and
 * enforced as such, and book_history hands it back beside the book's movements.
 * So the sentence this screen used to end on, that an earlier name is not kept,
 * was true when it was written and is not true now.
 *
 * WHO SEES WHAT IS THE SERVER'S DECISION, and it is the same one it makes about
 * the live ticket: a seller sees the buyers in the books they are carrying, a
 * helper the sales they wrote down, an organiser everybody, a viewer everybody
 * with the telephone number shortened. Nothing is decided here. A step whose
 * buyer is not for this reader still appears, saying that a detail is withheld
 * — a trail with silent gaps in it is worse than one that admits to them,
 * because the gaps read as nothing having happened.
 *
 * So a ticket's history is its own recorded changes AND the custody of the book
 * it lives in, in one order, because the question is nearly always about the
 * relationship between the two.
 */
import { ref, computed, onMounted } from 'vue'
import Who from '../ui/Who.vue'
import { api, state, agentMap, isSold } from '../../lib/store.js'
import { dateTime, money, plainName, isSellerContact, STATUS_WORDS, COUNTED_IN_HELP } from '../../lib/format.js'
import { isDialable, waNumber } from '../../lib/search.js'
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
 * WHO HAD IT, WITH WHERE THEY ARE FROM.
 *
 * "Josh" is not enough to act on — there are two sellers called JOHN in this
 * raffle, and the one somebody means is the one from their own church. The zone
 * is how people refer to each other here anyway, so the screen says it the same
 * way: Josh (CCFM).
 *
 * The name alone when there is no zone, rather than an empty bracket, which
 * reads as a missing fact instead of an absent one.
 */
function personWords(who) {
  if (!who) return ''
  return who.zone ? `${who.name} (${who.zone})` : who.name
}

/**
 * AND WHETHER IT IS SOMETHING YOU MAY RING.
 *
 * The server decides: it fills the number in for an organiser and the system
 * admin, and leaves it empty for everybody else. So this asks whether there is
 * a number rather than asking who is reading — one rule, decided once, on the
 * side that can enforce it. A seller taking a book on still sees who had it
 * before them; they do not get a directory of everybody's telephone number as a
 * side effect of looking at a history.
 */
function canContact(who) {
  return !!(who && who.phone && isDialable(who.phone))
}

function contactLink(who) {
  // The refusal is HERE, not only in the v-if that calls it. A guard in the
  // template is a guard in one caller; the next caller writes its own, and one
  // of them gets it wrong. This is the shape contactpoints.test.mjs insists on
  // across every wa.me in the app, after exactly that happened on the Money
  // screen.
  if (!isDialable(who?.phone)) return ''
  return `https://wa.me/${waNumber(who.phone)}`
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
 * EVERY RECORDED CHANGE TO THE TICKET, from the server's append-only trail.
 *
 * Absent on the Apps Script backend, which has no such table: an empty list
 * rather than a crash, and the book's movements still read as they always did.
 *
 * A book's trail carries every ticket in the book — which is what somebody
 * asking about the BOOK wants — so a ticket narrows it to its own.
 */
const changes = computed(() => {
  const rows = trail.value?.tickets || []
  return props.ticket ? rows.filter(c => c.ticket === props.ticket.number) : rows
})

/** The five words the pill on the ticket uses, not a sixth set written here. */
const statusWord = (s) => STATUS_WORDS[s] || s || ''

/** The bare name, with the settlement's marker said in words rather than shown. */
function buyerWords(name) {
  if (!name) return ''
  return isSellerContact(name) ? `${plainName(name)} — the seller's own contact` : plainName(name)
}

/**
 * One recorded change, as something a volunteer reads.
 *
 * The substance goes in `lines` rather than into the heading, the same shape as
 * the sale below it: the heading says what the ticket BECAME, the lines say
 * what was on it before. A correction that moved no status is headed as one.
 *
 * `hidden` is the case that has to be got right. When every field that changed
 * is one this reader may not see, the step would otherwise render as a time and
 * a word with nothing under it, and read as a change that did nothing. It says
 * instead that something was changed and is not being shown.
 */
function changeStep(c) {
  const moved = c.toStatus !== c.fromStatus
  const lines = []

  // Available → Sold is the ordinary path and needs no saying. Sold → anything
  // is the one somebody came to this screen to find.
  if (moved && c.fromStatus && c.fromStatus !== 'Available') lines.push(`Was ${statusWord(c.fromStatus)}`)

  if (c.toSeller !== c.fromSeller) {
    lines.push(c.toSeller
      ? `Credited to ${c.toSeller}${c.fromSeller ? `, was ${c.fromSeller}` : ''}`
      : `No longer credited to ${c.fromSeller}`)
  }
  if (c.toBuyer !== c.fromBuyer) {
    lines.push(c.toBuyer
      ? `Buyer ${buyerWords(c.toBuyer)}${c.fromBuyer ? `, was ${buyerWords(c.fromBuyer)}` : ''}`
      : `${buyerWords(c.fromBuyer)} taken off it`)
  }
  if (c.toPhone !== c.fromPhone) {
    lines.push(c.toPhone
      ? `Telephone ${c.toPhone}${c.fromPhone ? `, was ${c.fromPhone}` : ''}`
      : 'Telephone number taken off it')
  }
  if (Number(c.toAmount ?? 0) !== Number(c.fromAmount ?? 0)) {
    lines.push(`${money(c.toAmount, currency.value)}${
      c.fromAmount != null ? `, was ${money(c.fromAmount, currency.value)}` : ''}`)
  }
  if (c.toPayment !== c.fromPayment && c.toPayment) lines.push(`Marked ${c.toPayment.toLowerCase()}`)

  return {
    kind: 'change', at: c.at, title: moved ? statusWord(c.toStatus) : 'Corrected',
    // Named only where the reader did not arrive holding one ticket.
    ticket: props.ticket ? '' : c.ticket,
    lines, by: c.by, note: c.note,
    // A note this reader may see IS the visible change — saying the details are
    // withheld while printing one of them contradicts itself on the same step.
    hidden: lines.length === 0 && !c.note,
  }
}

/**
 * The sale is in the trail already, when the trail was there to record it.
 *
 * Books sold before the trigger existed have no step for it and the ticket row
 * itself is the only record, so the sale block below stays. Where both exist,
 * showing both puts the same sale on the screen twice a minute apart, which
 * reads as two sales.
 */
const trailHasTheSale = computed(() => changes.value.some(c => isSold({ status: c.toStatus })))

/**
 * Book movements, ticket changes and the sale in ONE order, oldest first.
 *
 * Merged rather than shown as separate lists, because the question is nearly
 * always about the relationship between them — was it sold before or after the
 * book came back, was the buyer changed before or after it was counted in? Lists
 * side by side make the reader do that join in their head, and that is exactly
 * where somebody gets it wrong.
 */
const steps = computed(() => {
  const list = (trail.value?.history || []).map(h => ({
    kind: 'move', at: h.at, title: words(h.action), detail: movement(h),
    // "Counted in" is the one verb in this list a volunteer cannot infer from
    // the word, so it carries its own explanation. The others describe
    // themselves: given out, passed on, brought back.
    help: h.action === 'settle' ? COUNTED_IN_HELP : '',
    // The same movement as structured people, so the names can carry their
    // zone and be rung. `detail` stays for anything that has no people in it.
    from: h.fromWho || null, to: h.toWho || null,
    by: h.by, note: h.note,
  }))
  for (const c of changes.value) list.push(changeStep(c))
  if (sale.value && !trailHasTheSale.value) list.push({ kind: 'sale', at: sale.value.at })

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

/**
 * A book with no trail that has plainly been somewhere.
 *
 * `Unassigned` is the one status that agrees with an empty history: the book is
 * in the office and has never left it. Every other status is the book itself
 * saying it has moved, and an empty trail beside it means the movements were
 * not recorded here rather than that they did not happen.
 *
 * The distinction is not academic. This app is the second home of a raffle that
 * ran on a spreadsheet: books issued and brought back before the move have no
 * rows, and telling the person holding one that it "has not been given out"
 * teaches them that the trail is unreliable — which is the exact opposite of
 * what a record is for.
 */
const movedAlready = computed(() => {
  const status = trail.value?.book?.status || ''
  return !!status && status !== 'Unassigned'
})
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
         that never existed. But it is TWO answers, and this said only one of
         them: a book that has never moved, and a book that moved before this
         system was keeping the record. Told the second one, it said "it has not
         been given out" about a book whose own panel, one sheet behind, named
         the seller who brought it back. A screen that contradicts the screen
         under it is worse than one that admits it does not know. -->
    <p v-else-if="nothingRecorded" class="note">
      <template v-if="movedAlready">
        Nothing is recorded against {{ bookNumber }} here. It has clearly moved —
        it is {{ (trail.book.status || '').toLowerCase() }} — so this is a book
        whose comings and goings happened before the system started keeping them,
        or somewhere other than this app. Everything from here on is kept.
      </template>
      <template v-else>
        Nothing has been recorded against {{ bookNumber }} yet. It has not been
        given out, so there is nowhere for it to have been.
      </template>
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
          <div v-if="sale.by" class="who">Written down by <Who :email="sale.by" /></div>
        </template>

        <template v-else-if="s.kind === 'change'">
          <div class="when">{{ dateTime(s.at) }}</div>
          <div class="what">
            <b>{{ s.title }}</b>
            <span v-if="s.ticket" class="muted">{{ s.ticket }}</span>
          </div>
          <div v-for="(line, j) in s.lines" :key="j" class="who">{{ line }}</div>
          <div v-if="s.hidden" class="who">
            The buyer's details were changed. You are not shown them on this ticket.
          </div>
          <div v-if="s.by" class="who">Written down by <Who :email="s.by" /></div>
          <div v-if="s.note" class="note-line">{{ s.note }}</div>
        </template>

        <template v-else>
          <div class="when">{{ dateTime(s.at) }}</div>
          <!-- WHO HAD IT, NAMED AND PLACED. A movement with people in it
               renders them one at a time so the zone can travel with the name
               and an organiser can ring them; anything else keeps the plain
               sentence it always had. -->
          <div class="what">
            <b :class="{ helpword: s.help }" :title="s.help || undefined">{{ s.title }}</b>
            <template v-if="s.from || s.to">
              <template v-if="s.from">
                from
                <a v-if="canContact(s.from)" class="person" :href="contactLink(s.from)"
                   target="_blank" rel="noopener"
                   :title="`Message ${s.from.name} on WhatsApp`">{{ personWords(s.from) }}</a>
                <span v-else class="person plain">{{ personWords(s.from) }}</span>
              </template>
              <template v-if="s.to">
                to
                <a v-if="canContact(s.to)" class="person" :href="contactLink(s.to)"
                   target="_blank" rel="noopener"
                   :title="`Message ${s.to.name} on WhatsApp`">{{ personWords(s.to) }}</a>
                <span v-else class="person plain">{{ personWords(s.to) }}</span>
              </template>
            </template>
            <template v-else>{{ s.detail }}</template>
          </div>
          <div v-if="s.by" class="who">by {{ s.by }}</div>
          <div v-if="s.note" class="note-line">{{ s.note }}</div>
        </template>
      </li>
    </ol>

    <!-- Said once, at the bottom, because somebody reading a trail has to know
         whether what they are looking at is all of it. It is: a correction is
         added to this list, it never replaces what was there. What it is not is
         everything for every reader — buyers are shown to whoever may see them
         on the ticket itself, which is why a step can say a detail is withheld. -->
    <p v-if="(ticket || changes.length) && trail && !problem" class="tiny muted mt">
      Nothing here can be edited or removed. A correction is added to the end of
      the list, and what it corrected stays above it.
    </p>

    <template #actions>
      <button class="btn" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
/* A contactable name looks like something you can act on; one you cannot ring
   looks like plain text, because an underline that does nothing is a promise
   the screen does not keep. */
.person { font-weight: 600; }
a.person { color: var(--brand); text-decoration: underline; }
.person.plain { color: inherit; text-decoration: none; }

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
