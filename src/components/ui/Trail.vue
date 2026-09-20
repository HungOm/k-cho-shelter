<script setup>
/**
 * WHERE A BOOK — OR ONE TICKET IN IT — HAS BEEN. The trail itself, with no
 * frame around it.
 *
 * This was the whole of modals/History.vue, which is still its sheet. It was
 * lifted out because a sold ticket's record, its movements and the box for
 * correcting it are one question asked in three parts, and the movements were
 * two taps away behind a button. Two presentations, one drawing of the trail:
 * a second copy is how the sheet and the section come to disagree about what
 * a withheld step looks like.
 *
 * IT FETCHES ON MOUNT, which is the cost of showing it inline. Opening a sold
 * ticket used to touch no network at all; it now asks the server for the
 * book's history. That is one small request, it renders a skeleton while it
 * waits, and it says what happened rather than disappearing if it fails — but
 * it is a real cost on a phone in a hall and it is worth knowing about.
 *
 * Everything below this line is as it was in the sheet, including the reasons.
 */
import { ref, computed, onMounted } from 'vue'
import Who from './Who.vue'
import { api, state, agentMap, isSold } from '../../lib/store.js'
import { dateTime, money, plainName, isSellerContact, STATUS_WORDS, COUNTED_IN_HELP } from '../../lib/format.js'
import { isDialable, waNumber } from '../../lib/search.js'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  /** The book number to trace. Required — a ticket supplies its own book's. */
  book: String,
  /** Optional: the ticket whose sale is being asked about. */
  ticket: Object,
  /*
   * A heading, for when the trail is a SECTION rather than a whole sheet. It
   * lives here and not in the caller because the count belongs in it and only
   * this component knows the count — a caller wanting "5 movements" would
   * have to be told the number, which is a second binding crossing for a
   * label.
   */
  heading: { type: String, default: '' },
})
/* The wrapper needs the book's status for its subtitle and has no other way
 * to learn it — this component is what fetches it. Nothing else crosses. */
const emit = defineEmits(['loaded'])

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
    emit('loaded', trail.value?.book ?? null)
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
  // Two people now. An organiser OFFERS and nothing moves; the seller accepts
  // and the book becomes theirs, which is written as 'issue' so the history of
  // a book that changed hands reads the same however it got there. A release is
  // an offer that ended without being taken up — declined, withdrawn, or nobody
  // answered in time.
  offer: 'Offered',
  release: 'Offer ended',
  issue: 'Given out',
  transfer: 'Passed on',
  return: 'Brought back',
  settle: 'Counted in',
  restock: 'Put back in stock',
  // Written by acknowledge_books in people.ts, not by the book handlers — which
  // is why they were missing. Untranslated they rendered as the raw column with
  // a capital on the front: "Acknowledge_paper", underscore and all.
  acknowledge: 'Confirmed received',
  acknowledge_paper: 'Signed for',
  // Written by tickets.ts, not by the book handlers: an organiser recorded a
  // sale into this book while it was out with somebody else. Nothing moved, so
  // it has a `from` and no destination — which is why the office set above is
  // named one verb at a time rather than inferred from a null.
  record_for_holder: 'Recorded for the seller',
  lost: 'Reported lost',
  void: 'Cancelled',
  out: 'Marked as out',
  returned: 'Marked as brought back',
  unassigned: 'Marked as back in stock',
}

/**
 * THE MOVES THAT END AT THE OFFICE, named one at a time.
 *
 * Five of the server's verbs leave to_agent null, and the trail rendered every
 * one of them as "from JOHN" — a movement with a source and no destination,
 * which reads as though the book went nowhere or as though the screen lost the
 * other half. It did not: null IS the destination. Nobody holds the book, and
 * in this raffle a book nobody holds is in the office, which is what the Books
 * screen has always called it.
 *
 * NAMED RATHER THAN INFERRED FROM "to_agent IS NULL", because two other verbs
 * have the same null and mean the opposite of it. A book reported lost is not
 * in the office and neither is a cancelled one, and a trail that said they were
 * would be confidently wrong about the two books somebody is actually looking
 * for. Adding a verb to this list is a decision; being added to it by accident
 * is what this shape prevents.
 */
const ENDS_AT_THE_OFFICE = new Set(['return', 'returned', 'settle', 'restock', 'unassigned'])

/**
 * How a ticket's row came to be written, where that is not the ordinary way.
 *
 * `settlement` is the one that changes what a reader should believe: the buyer
 * was not written down at the table, somebody reconstructed the sale from a
 * count afterwards, and the name on it is a name nobody checked. The others say
 * which screen it came from, which answers "why does this row look different
 * from the ones around it".
 *
 * An empty source and one nobody has heard of both render nothing, rather than
 * a confident sentence about a value this build does not understand.
 */
const SOURCE_WORDS = {
  app: 'entered one ticket at a time',
  'book sale': 'sold as a whole book',
  bulk: 'entered from counterfoils in a batch',
  settlement: 'filled in when the book was counted in — nobody wrote the buyer down at the table',
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

  /*
   * WHO THE MONEY IS AGAINST, as a person rather than a name in a sentence.
   *
   * The server has always sent fromSellerWho/toSellerWho beside the bare names
   * — the same zone-and-telephone shape the book's own movements use — and this
   * screen read only the names. So "Credited to JOHN" on a ticket sat beside
   * "Given out to Josh (CCFM)" two rows above it, and the one line where
   * somebody is deciding whose debt this is was the one they could not act on.
   * There are two sellers called JOHN in this raffle.
   */
  const credited = (c.toSeller !== c.fromSeller)
    ? { to: c.toSellerWho || null, from: c.fromSellerWho || null,
        toName: c.toSeller, fromName: c.fromSeller }
    : null
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
    lines, credited, source: SOURCE_WORDS[c.source] || '', by: c.by, note: c.note,
    // A note this reader may see IS the visible change — saying the details are
    // withheld while printing one of them contradicts itself on the same step.
    // A credited seller counts as a visible change for the same reason: it is
    // the one thing on this step that is shown to every role.
    hidden: lines.length === 0 && !credited && !c.note,
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
    // Only when nobody took it. A verb on this list that DOES name a receiving
    // agent has a real destination and must say that one instead.
    toOffice: !h.toWho && ENDS_AT_THE_OFFICE.has(h.action),
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
  <h3 v-if="heading" class="trailhead">
    {{ heading }}
    <span v-if="trail && steps.length" class="tiny muted">
      {{ steps.length }} {{ steps.length === 1 ? 'movement' : 'movements' }} · newest last
    </span>
  </h3>

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
        <!-- WHOSE SALE IT IS, first and as a person. Everything under it is
             detail about the ticket; this is the line an organiser settling
             an argument is looking for, and it is rendered the same way a
             book's movements render the people in them. -->
        <div v-if="s.credited" class="who">
          <template v-if="s.credited.toName">
            Credited to
            <a v-if="canContact(s.credited.to)" class="person" :href="contactLink(s.credited.to)"
               target="_blank" rel="noopener"
               :title="`Message ${s.credited.to.name} on WhatsApp`">{{ personWords(s.credited.to) }}</a>
            <span v-else class="person plain">{{ personWords(s.credited.to) || s.credited.toName }}</span>
            <template v-if="s.credited.fromName">, was
              <span class="person plain">{{ personWords(s.credited.from) || s.credited.fromName }}</span>
            </template>
          </template>
          <template v-else>
            No longer credited to
            <span class="person plain">{{ personWords(s.credited.from) || s.credited.fromName }}</span>
          </template>
        </div>
        <div v-for="(line, j) in s.lines" :key="j" class="who">{{ line }}</div>
        <div v-if="s.hidden" class="who">
          The buyer's details were changed. You are not shown them on this ticket.
        </div>
        <div v-if="s.by" class="who">Written down by <Who :email="s.by" /></div>
        <!-- How the row came to be written, under who wrote it, because it
             qualifies them: "filled in when the book was counted in" is the
             difference between a name somebody took at the table and a name
             reconstructed from a count afterwards. -->
        <div v-if="s.source" class="note-line muted">{{ s.source }}</div>
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
            <!-- NOT A PERSON, AND NOT STYLED AS ONE. The office is where the
                 book went; there is nobody to ring about it, and a name-shaped
                 span would invite somebody to try. -->
            <template v-if="s.toOffice"> to the office</template>
          </template>
          <template v-else>
            {{ s.detail }}<template v-if="s.toOffice"> to the office</template>
          </template>
        </div>
        <!-- The person, not the address. This row printed by_user raw — "by
             helper.someone.oct19@gmail.com" — two lines below a sale row that
             resolved the very same column to a name and a role. -->
        <div v-if="s.by" class="who">by <Who :email="s.by" /></div>
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
</template>

<style scoped>
.trailhead { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0 0 8px }
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
  border-left: 2px solid var(--border);
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
  padding-left: 10px; border-left: 2px solid var(--border);
}
.tiny { font-size: .8rem; }
</style>
