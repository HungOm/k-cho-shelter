<script setup>
/**
 * The seller's own report, prepared for them and sent when they are ready.
 *
 * WHAT A SELLER COULD DO AT A CHECKPOINT BEFORE THIS: nothing. They carry the
 * books, hold the stubs and the cash, and are given a date — and then the
 * checkpoint happens TO them. An organiser types their figures into a screen
 * the seller never sees, from numbers read out on a telephone or remembered
 * from a car park. The only record of what the seller said was written by
 * somebody else, afterwards, with the seller not in the room.
 *
 * READY, NOT BLANK. The screen opens on a draft built from live rows: the books
 * they hold, what is written down as sold in each, the stubs that implies, and
 * what the raffle thinks they owe. A form that asks a volunteer to tally their
 * own books on a phone is a form that gets filled in wrong or not at all. This
 * asks them to CHECK, and to change what the paper says is different — which is
 * the only part they know better than the database does.
 *
 * BUILT WHEN IT IS OPENED, not once a day. A daily job was asked for and it is
 * the wrong shape: a report prepared at six in the morning is wrong by lunch,
 * and this system has no scheduler — round_snapshots says so in the schema and
 * says why. Live rows on open is the same promise without a copy that goes
 * stale or a job that fails quietly at the weekend.
 *
 * AND NOTHING HAPPENS UNTIL SOMEBODY ACCEPTS IT. Sending puts it in the
 * organiser's queue. No book moves, no ticket is marked sold and no money is
 * recorded until an organiser presses Accept with the numbers in front of them.
 * That is the existing petition queue — the same one a seller asks for books
 * through — and it runs as the organiser, because bringing books back, counting
 * them in and taking cash are their acts and always were.
 */
import { ref, computed, onMounted } from 'vue'
import { state, api, toast, refresh, loadDelta } from '../../lib/store.js'
import { money, date, COUNTED_IN_HELP } from '../../lib/format.js'
import Sheet from '../ui/Sheet.vue'

const emit = defineEmits(['close', 'sent'])

const draft = ref(null)
const failed = ref('')
const busy = ref(false)

/** What the seller says about each book: keep it, bring it back, count it in. */
const choice = ref({})
/**
 * PER BOOK, THE TICKET NUMBERS THAT DID NOT SELL — the numbers, not a count.
 *
 * This asked "how many did not sell?" and then sent the LAST N unsold numbers,
 * on the assumption that a book is sold from the front. That assumption is
 * wrong often enough to matter: somebody sells three from the middle of a book
 * to people who picked their own numbers, says seven did not sell, and seven
 * tickets are marked sold — the wrong seven. The ticket-to-buyer link is what
 * the draw runs on, and a count cannot carry it.
 *
 * So the seller taps the ones that came back. It is the same act they are
 * performing with their hands, and a raffle ticket has a number on it precisely
 * so that it can be named.
 */
const unsold = ref({})
const handed = ref('')
const note = ref('')

const currency = computed(() => draft.value?.currency || state.cfg?.currency || '')

onMounted(async () => {
  try {
    const d = await api('report_draft', {})
    draft.value = d
    for (const b of d.books) {
      choice.value[b.book] = b.suggest
      // Everything not already written down as sold starts as unsold, which is
      // what the book looks like if the seller recorded every sale as they went.
      unsold.value[b.book] = new Set(b.unsoldNumbers)
    }
    // What the figures say they owe, as the starting amount. Typed over freely:
    // the seller knows what is in their hand and the screen does not.
    handed.value = d.owed > 0 ? String(d.owed) : ''
  } catch (err) {
    failed.value = err.message
  }
})

const lines = computed(() => draft.value?.books ?? [])
const returning = computed(() => lines.value.filter(b => choice.value[b.book] === 'return'))
const counting = computed(() => lines.value.filter(b => choice.value[b.book] === 'count'))
const keeping = computed(() => lines.value.filter(b => choice.value[b.book] === 'keep'))

/**
 * The stubs a count-in implies, which is the arithmetic a seller should never
 * be asked to do. Every ticket in a book they are counting in is either a stub
 * they are handing over or a ticket that did not sell.
 */
const unsoldIn = (b) => unsold.value[b.book]?.size ?? 0
const soldFromCounted = computed(() =>
  counting.value.reduce((n, b) => n + Math.max(0, b.held - unsoldIn(b)), 0))

/** Tapping a ticket moves it between "came back" and "sold". */
function toggle(b, number) {
  const set = unsold.value[b.book]
  if (!set) return
  const next = new Set(set)
  next.has(number) ? next.delete(number) : next.add(number)
  unsold.value[b.book] = next
}
const isUnsold = (b, number) => !!unsold.value[b.book]?.has(number)

/** "KS-00911" reads as 911 to somebody holding the ticket. */
const ticketNo = (n) => String(n ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')

/** The two ends of the range, because most books are all or nothing. */
function allBack(b) { unsold.value[b.book] = new Set(b.unsoldNumbers) }
function noneBack(b) { unsold.value[b.book] = new Set() }

const dueNow = computed(() => soldFromCounted.value * (draft.value?.ticketPrice || 0))
const handedNum = computed(() => parseFloat(handed.value) || 0)
const short = computed(() => Math.round((dueNow.value - handedNum.value) * 100) / 100)

const nothingToSend = computed(() =>
  !returning.value.length && !counting.value.length && handedNum.value <= 0)


async function send() {
  if (nothingToSend.value) {
    return toast('Say what you are bringing before you send it.', 'bad')
  }
  busy.value = true
  try {
    /*
     * WHICH STUBS, NOT HOW MANY, for a book being counted in.
     *
     * settle_book takes the ticket numbers that did NOT sell and marks the rest
     * sold, because a count is not a record of who holds which ticket and the
     * draw depends on that. The seller adjusts a COUNT on this screen — nobody
     * types ten numbers on a phone — so the numbers sent are the last N unsold
     * ones in the book, which is what a part-sold book actually looks like:
     * sold from the front, the tail unsold.
     *
     * The organiser counts the real stubs at the table and the count-in they
     * accept is this list. A book where the seller sold out of order is the
     * case this gets wrong, and it is why the organiser can decline and why
     * every book can still be counted in by hand afterwards.
     */
    const books = [
      ...returning.value.map(b => ({ book: b.book, action: 'return' })),
      ...counting.value.map(b => ({
        book: b.book, action: 'count',
        // In the book's own order, which is how they will be read back at the
        // table — not in the order somebody happened to tap them.
        unsold: b.unsoldNumbers.filter(n => isUnsold(b, n))
      }))
    ]

    await api('request_approval', {
      action: 'report_back',
      payload: {
        books,
        ticketsSold: soldFromCounted.value,
        stubsReturned: soldFromCounted.value,
        unsoldReturned: counting.value.reduce((n, b) => n + unsoldIn(b), 0),
        amountHanded: handedNum.value,
        note: note.value.trim()
      }
    })
    toast('Sent to the organiser — nothing changes until they accept it', 'ok')
    emit('sent')
    loadDelta().then(refresh)
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { busy.value = false }
}
</script>

<template>
  <Sheet title="Report back" subtitle="What you are bringing in, ready to check" @close="emit('close')">
    <div v-if="failed" class="note bad">{{ failed }}</div>

    <div v-else-if="!draft" class="skel" style="height:90px"></div>

    <template v-else>
      <div v-if="draft.alreadyReported" class="note warn">
        <b>You have already reported this round</b>, on {{ date(draft.alreadyReported.at) }}.
        Sending again is for when you have come back with more — the organiser sees both.
      </div>
      <div v-else class="note info">
        Nothing here changes anything until an organiser accepts it. Check it, change
        what is different, and send. A book you are
        <span class="helpword" :title="COUNTED_IN_HELP">counting in</span> is finished
        with: its money is reconciled and nothing more is sold from it.
        <template v-if="draft.dueBy"> Your books are due back by <b>{{ date(draft.dueBy) }}</b>.</template>
      </div>

      <template v-if="lines.length">
        <label>Your books</label>
        <div v-for="b in lines" :key="b.book" class="bk">
          <div class="spread">
            <span>
              <b>{{ b.book }}</b>
              <span class="sub"> {{ b.firstTicket }}–{{ b.lastTicket }}</span>
            </span>
            <span class="sub">{{ b.recordedSold }} of {{ b.held }} written down</span>
          </div>
          <div class="picks">
            <button v-for="opt in [
                      { v: 'count', t: 'Counting it in' },
                      { v: 'return', t: 'Bringing it back' },
                      { v: 'keep', t: 'Keeping it' }]"
                    :key="opt.v" type="button"
                    :class="['pick', { on: choice[b.book] === opt.v }]"
                    @click="choice[b.book] = opt.v">{{ opt.t }}</button>
          </div>
          <!-- Only where it changes anything. A book being kept or brought back
               unopened has no stubs to argue about.

               THE NUMBERS, TAPPED. Every ticket in the book that is not already
               written down as sold is here; the ones still lit are the ones
               coming back. It is the same act the seller is doing with their
               hands, and it is the only way the right tickets end up marked
               sold when a book was not sold from the front. -->
          <div v-if="choice[b.book] === 'count'" class="stubs">
            <div class="spread">
              <label>Which ones came back?</label>
              <span class="row">
                <button type="button" class="btn sm ghost" @click="allBack(b)">All</button>
                <button type="button" class="btn sm ghost" @click="noneBack(b)">None</button>
              </span>
            </div>
            <div class="chips">
              <button v-for="n in b.unsoldNumbers" :key="n" type="button"
                      :class="['chip', { on: isUnsold(b, n) }]"
                      :aria-pressed="isUnsold(b, n)" @click="toggle(b, n)">{{ ticketNo(n) }}</button>
            </div>
            <p class="hint">
              <b>{{ Math.max(0, b.held - unsoldIn(b)) }}</b> sold ·
              <b>{{ unsoldIn(b) }}</b> coming back
              <template v-if="b.recordedSold">
                · {{ b.recordedSold }} already written down as sold, which cannot be undone here
              </template>
            </p>
          </div>
        </div>
      </template>
      <div v-else class="note info">
        You are not holding any books. If you have money to hand over you can still
        send that.
      </div>

      <div class="field">
        <label for="rbm">How much money are you handing over?</label>
        <input id="rbm" v-model="handed" class="xl" type="number" inputmode="decimal" step="0.01">
        <p class="hint">
          What you are actually bringing. The organiser records it when they take it.
        </p>
      </div>

      <div class="field">
        <label for="rbn">Anything to say about it? <span class="opt">— not required</span></label>
        <input id="rbn" v-model="note" placeholder="e.g. two tickets lost at the market">
      </div>

      <div :class="['note', short > 0.005 ? 'warn' : 'info']">
        <b>{{ counting.length }}</b> to count in ·
        <b>{{ returning.length }}</b> coming back ·
        <b>{{ keeping.length }}</b> staying with you<br>
        <b>{{ soldFromCounted }}</b> sold from the books you are counting in, which is
        <b>{{ money(dueNow, currency) }}</b>
        <template v-if="handedNum"> · handing over <b>{{ money(handedNum, currency) }}</b></template>
        <div v-if="Math.abs(short) > 0.005" style="margin-top:4px">
          <b v-if="short > 0">{{ money(short, currency) }} short — say why in the note, or change it</b>
          <b v-else>{{ money(-short, currency) }} more than those books come to</b>
        </div>
      </div>
    </template>

    <template #actions>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :disabled="busy || !draft || nothingToSend" @click="send">
        {{ busy ? 'Sending…' : 'Send to the organiser' }}
      </button>
    </template>
  </Sheet>
</template>

<style scoped>
.bk { border: 1.5px solid var(--border); border-radius: var(--r-sm); padding: 12px 14px; margin-bottom: 10px; }
.picks { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.pick {
  flex: 1 1 auto; padding: 8px 12px; border-radius: var(--r-sm); cursor: pointer;
  border: 1.5px solid var(--border); background: var(--surface); font-weight: 600;
  font-size: .9rem; transition: border-color .14s, background .14s;
}
.pick:hover { border-color: var(--brand); }
.pick.on { border-color: var(--brand); background: var(--brand-soft); }
.stubs { margin-top: 12px; }
.stubs .spread { align-items: center; margin-bottom: 8px; }
.stubs label { margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* Big enough to hit with a thumb, on a phone, standing up, holding a book. */
.chip {
  min-width: 52px; padding: 10px 8px; border-radius: var(--r-sm);
  border: 1.5px solid var(--border); background: var(--surface);
  font-weight: 700; font-variant-numeric: tabular-nums; cursor: pointer;
  color: var(--muted); transition: border-color .12s, background .12s, color .12s;
}
.chip:hover { border-color: var(--brand); }
/* Lit means "came back". Unlit is a ticket this report says was sold, which is
   the one that costs somebody money, so it is the state that looks spent. */
.chip.on { border-color: var(--brand); background: var(--brand-soft); color: var(--text); }
</style>
