<script setup>
/**
 * The recording screen.
 *
 * Two jobs: look up one ticket fast, and key in the pile of stubs an agent
 * hands back. The stub pile is where the hours actually go, so it is built for
 * the keyboard: type, tab, type, tab, and a new row appears on its own.
 */
import { ref, computed, nextTick } from 'vue'
import { patchTickets } from '../lib/optimistic.js'
import { state, api, toast, loadDelta, canWrite, sellBlock, sellOverrideNeeded, whereIs, isSold } from '../lib/store.js'
import { phoneDigits, isDialable } from '../lib/search.js'
import { money, COUNTED_IN_HELP } from '../lib/format.js'
import { resolveTicketNumber } from '../lib/books.js'
import Bi from './ui/Bi.vue'
import YourStock from './ui/YourStock.vue'

const emit = defineEmits(['open', 'report-back'])

/** Only for the wording below: the stock panel decides its own visibility. */
const amSeller = computed(() => state.user?.role === 'agent' || !!state.user?.agentId)

const lookup = ref('')
const rows = ref([blank()])
const busy = ref(false)
const waited = ref(0)          // seconds on the current save
const checking = ref(false)    // working out what a timed-out save actually did
const problems = ref([])
/**
 * Set only when a reconciliation found that part of the batch landed. It
 * changes the heading above the list, which otherwise announces that nothing
 * was saved — true for a validation failure, and the opposite of true here.
 */
const partlySaved = ref(false)
let ticker = null
const rowEls = ref([])

function blank() { return { id: Math.random().toString(36).slice(2), num: '', name: '', phone: '' } }

/**
 * THE BOOKS THIS BATCH REACHES INTO THAT SOMEBODY ELSE IS CARRYING.
 *
 * This screen is transcription: a stack of counterfoils from a seller who has
 * been out with a book. So the ordinary batch here is exactly the one the server
 * asks about — an organiser writing sales into a book in somebody else's bag —
 * and this screen had no way to answer.
 *
 * bulk_record_sales has refused such a batch since the reason rule went in, and
 * the deployed function has carried that refusal since the afternoon it was
 * deployed. With no box on the screen, the organiser met REASON_REQUIRED naming
 * a book and had no way through it at all — the batch could not be saved by any
 * route this screen offers. The single-ticket and whole-book screens both ask;
 * this one did not, which is what a rule enforced on two doors of three looks
 * like from the desk.
 *
 * NAMED rather than counted, like the other two: "a book is with a seller" sends
 * somebody back to the grid to work out which.
 */
const onBehalfBooks = computed(() => {
  const seen = new Map()
  for (const r of rows.value) {
    const t = resolve(r.num)
    if (!t || !sellOverrideNeeded(t)) continue
    const b = whereIs(t)
    if (b && !seen.has(b.book)) seen.set(b.book, b)
  }
  return [...seen.values()]
})
const onBehalf = ref('')

const filled = computed(() => rows.value.filter(r => r.num.trim()).length)
const value = computed(() => filled.value * (state.cfg?.ticketPrice || 0))

/** Accepts a full number or just the trailing digits people actually remember. */
function resolve(raw) {
  const n = resolveTicketNumber(raw)
  return n ? state.byNumber[n] : null
}

function findOne() {
  const t = resolve(lookup.value)
  if (!t) return toast('No ticket with that number', 'bad')
  lookup.value = ''
  emit('open', t)
}

async function addRow(after) {
  rows.value.push(blank())
  if (after) {
    await nextTick()
    rowEls.value[rows.value.length - 1]?.querySelector('input')?.focus()
  }
}

function removeRow(i) {
  rows.value.splice(i, 1)
  if (!rows.value.length) rows.value.push(blank())
}

function onLastField(i) {
  if (i === rows.value.length - 1) addRow(true)
}

/** Shows what the number resolved to, so a typo is obvious before saving. */
function resolved(r) {
  if (!r.num.trim()) return null
  const t = resolve(r.num)
  if (!t) return { bad: true, text: 'no such ticket' }
  // Donated counts: it is spoken for, and a line not flagged here is a line
  // the server refuses with a batch of forty attached to it.
  if (isSold(t)) return { bad: true, text: 'already sold' }
  if (t.status === 'Void') return { bad: true, text: 'cancelled' }
  // A ticket in a book that is not here will be refused on save, and the whole
  // batch goes with it. Better to say so on the line that caused it.
  const blocked = sellBlock(t)
  if (blocked) return { bad: true, text: blocked }
  return { bad: false, text: t.number }
}

/**
 * A save that timed out is a question, not a failure.
 *
 * The rows may well have been written while the response was still in flight,
 * so the honest move is to reload and look. Whatever now reads as Sold landed;
 * whatever did not is put back in the form, so pressing Save again re-sends
 * only the ones that are genuinely missing. That turns "did any of this
 * happen?" into an exact list, and makes the obvious next action safe.
 */
async function reconcile(sales) {
  checking.value = true
  partlySaved.value = false
  try {
    await loadDelta()
    const landed = [], missing = []
    for (const sale of sales) {
      const t = state.byNumber[sale.ticketNumber]
      ;(isSold(t) ? landed : missing).push(sale)
    }

    if (!missing.length) {
      rows.value = [blank()]
      toast(`All ${landed.length} saved after all`, 'ok')
      return
    }

    rows.value = missing.map(sale => ({
      id: Math.random().toString(36).slice(2),
      num: sale.ticketNumber, name: sale.buyerName, phone: sale.buyerPhone
    }))
    partlySaved.value = landed.length > 0
    problems.value = landed.length
      ? [`${landed.length} of ${sales.length} did save. The ${missing.length} still ` +
         `showing below did not — press Save to send just those.`]
      : [`None of them saved. They are still here — press Save to try again.`]
    toast(landed.length ? `${landed.length} saved, ${missing.length} still to go`
                        : 'Nothing saved — try again', landed.length ? 'ok' : 'bad')
  } catch {
    // The reload failed too, so we genuinely cannot say. Keep every row.
    partlySaved.value = true   // we do not know, so do not claim nothing saved
    problems.value = [
      'We could not reach the server to check whether that saved. Nothing has ' +
      'been cleared. Look up one of these ticket numbers before entering them ' +
      'again, so you do not record the same sale twice.'
    ]
  } finally {
    checking.value = false
  }
}

async function saveAll() {
  problems.value = []
  partlySaved.value = false
  const sales = []
  const local = []

  for (const r of rows.value) {
    if (!r.num.trim()) continue
    const t = resolve(r.num)
    if (!t) { local.push(`${r.num} — no ticket with that number`); continue }
    if (!r.name.trim()) { local.push(`${t.number} — who bought it?`); continue }
    if (phoneDigits(r.phone).length < 7) { local.push(`${t.number} — phone number is too short`); continue }
    sales.push({ ticketNumber: t.number, buyerName: r.name.trim(), buyerPhone: r.phone.trim() })
  }

  if (local.length) { problems.value = local; return }
  if (!sales.length) return toast('Nothing to save yet', 'bad')
  // The server refuses the whole batch without it, so the screen refuses first,
  // next to the box that answers it rather than after forty lines are typed.
  if (onBehalfBooks.value.length && !onBehalf.value.trim()) {
    return toast('Say why you are recording these for them', 'bad')
  }

  busy.value = true
  waited.value = 0
  ticker = setInterval(() => { waited.value += 1 }, 1000)

  /*
   * Shown before the server answers, and ONLY here.
   *
   * This screen is transcription after the fact — the buyer left an hour ago
   * and these are stubs being typed up — so a row that has to go back is an
   * annoyance rather than a lie told to somebody standing at the desk. Selling
   * a ticket at a table is the opposite case and is deliberately excluded; see
   * NEVER_OPTIMISTIC.
   *
   * The rows keep the values until the delta below replaces them with the
   * server's, which is the reconciliation: the truth overwrites the guess.
   */
  const shown = patchTickets(state, sales.map(s2 => ({
    number: s2.ticketNumber, status: 'Sold', name: s2.buyerName, phone: s2.buyerPhone
  })))

  try {
    const res = await api('bulk_record_sales',
    { sales, reason: onBehalf.value.trim() }, { reconcile: true })
    shown.commit()
    rows.value = [blank()]
    toast(`${res.recorded} sales written down`, 'ok')
    loadDelta()
  } catch (err) {
    // Every path out of here either commits or rolls back. A write that does
    // neither leaves rows marked "saving" for ever, and a permanent pending
    // state is a worse lie than a slow screen.
    shown.rollback()
    if (err.code === 'WRITE_UNCONFIRMED') {
      await reconcile(sales)
    } else if (err.code === 'BATCH_REJECTED' && err.details?.failures) {
      problems.value = err.details.failures.map(f => `${f.ticketNumber} — ${f.message}`)
    } else {
      toast(err.message, 'bad', err.code)
    }
  } finally {
    clearInterval(ticker)
    busy.value = false
  }
}
/**
 * A contact somebody could actually ring, checked as it is typed.
 *
 * NOT a blocker. The length test below still decides whether a sale saves, and
 * a volunteer at a table with a queue in front of them should not be stopped by
 * a warning. But a buyer's telephone number has exactly one job — finding the
 * person whose ticket was drawn — and a number missing its leading zero looks
 * completely normal in the box while being unreachable forever after.
 *
 * Nine tickets on this raffle already carry a number like that. This is the
 * place they would have been caught: at the table, while the buyer is still
 * standing there and can repeat it.
 */
function phoneWarning(phone) {
  const typed = String(phone || '').trim()
  if (isDialable(typed)) return ''
  // Also covers an empty box: nothing typed is nothing to warn about, and the
  // buyer may simply not have given a number. A separate !typed guard read as
  // a second rule and was the same rule twice.
  if (phoneDigits(typed).length < 7) return ''
  return 'Check this number — it has no leading 0 and no country code, so it cannot be rung.'
}

</script>

<template>
  <div>
    <h1><Bi text="Write down sales" /></h1>

    <!-- Their own numbers, first and tappable. Shared with Find, because the
         same short list is the answer on both screens. Renders nothing for
         anybody who is not holding books. -->
    <YourStock report-back @open="t => emit('open', t)" @report-back="emit('report-back')" />

    <div class="card">
      <h3><Bi text="One ticket" /></h3>
      <p class="muted small">Type the number and it opens straight away.</p>
      <div class="row">
        <input v-model="lookup" class="grow xl" inputmode="numeric" autocomplete="off"
               placeholder="e.g. 721" @keydown.enter="findOne" aria-label="Ticket number">
        <button class="btn primary lg" @click="findOne"><Bi text="Open" /></button>
      </div>
      <p class="hint">Just the last few numbers is enough.</p>
    </div>

    <div class="card">
      <div class="spread" style="margin-bottom:6px">
        <h3 style="margin:0"><Bi text="A pile of stubs" /></h3>
        <span class="pill brand" v-if="filled">
          {{ filled }} · {{ money(value, state.cfg?.currency) }}
        </span>
      </div>
      <!-- WORDED FOR WHOEVER IS READING IT. "For when a seller brings back their
           book" is a sentence about somebody else, and a seller reading it on
           their own screen has to work out whether the form is for them. It is:
           it is how you write down an afternoon's sales in one go. -->
      <p class="muted small">
        <template v-if="amSeller">
          For writing down several at once — an afternoon's sales, or the stubs
          from a book you are about to hand back.
        </template>
        <template v-else>
          For when a seller brings back their book.
        </template>
        Fill a line, press Tab, and the next line appears. Nothing is saved until
        you press the button — and if one line has a problem, none of them are saved.
      </p>

      <div class="rows">
        <div v-for="(r, i) in rows" :key="r.id" ref="rowEls" class="stub">
          <div class="f n">
            <input v-model="r.num" inputmode="numeric" autocomplete="off"
                   placeholder="Ticket" aria-label="Ticket number">
            <small v-if="resolved(r)" :class="['tag', { bad: resolved(r).bad }]">
              {{ resolved(r).text }}
            </small>
          </div>
          <input v-model="r.name" class="f" autocomplete="off" placeholder="Name" aria-label="Buyer name">
          <div class="f col" style="gap:2px">
            <input v-model="r.phone" type="tel" inputmode="tel" autocomplete="off"
                   placeholder="Phone" aria-label="Phone" @keydown.tab="onLastField(i)">
            <small v-if="phoneWarning(r.phone)" class="tag bad">{{ phoneWarning(r.phone) }}</small>
          </div>
          <button class="del" @click="removeRow(i)" aria-label="Remove this line">✕</button>
        </div>
      </div>

      <!-- The heading used to be a flat "nothing was saved", which sat directly
           above a line saying 1 of 3 did save. After a timeout that claim is
           not only wrong, it is the exact wrong claim to make. -->
      <div v-if="problems.length" :class="['note', partlySaved ? '' : 'bad', 'mt']">
        <b v-if="!partlySaved">Fix these first — nothing was saved:</b>
        <b v-else>Some of these saved:</b>
        <div v-for="p in problems" :key="p">{{ p }}</div>
      </div>

      <!-- ABOVE THE SAVE BUTTON, because that is where the batch is refused.
           An organiser typing up a seller's counterfoils is the ordinary use of
           this screen and the server asks why every time; without a box the
           whole batch was unsaveable by any route this screen offers. -->
      <div v-if="onBehalfBooks.length" class="note warn mt">
        <b>{{ onBehalfBooks.length === 1 ? 'This book is' : 'These books are' }} out with a seller</b> —
        {{ onBehalfBooks.map(b => `${b.book} (${b.agentName || b.agentId})`).join(', ') }}.
        Every ticket is credited to whoever is holding the book. Say why you are
        writing these down, and it goes onto the book's record where they will
        see it when the book is
        <span class="helpword" :title="COUNTED_IN_HELP">counted in</span>.
        <label class="why" for="bulkwhy">Why are you recording these for them? <span class="req">*</span></label>
        <input id="bulkwhy" v-model="onBehalf" autocomplete="off"
               placeholder="e.g. she brought the counterfoils back on Sunday">
      </div>

      <div class="row mt">
        <button class="btn grow" @click="addRow(true)">+ Another line</button>
        <button class="btn primary grow lg" :disabled="busy || checking || !filled" @click="saveAll">
          <template v-if="checking">Checking what saved…</template>
          <template v-else-if="busy">
            Saving<template v-if="waited >= 4"> — {{ waited }}s</template>…
          </template>
          <template v-else>Save {{ filled || '' }}</template>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The question sits inside the warning it belongs to. */
.why { margin-top: 12px; }
.rows { margin-top: 12px; }
.stub {
  display: grid; gap: 8px; margin-bottom: 8px;
  grid-template-columns: 1fr 1.25fr 1.1fr 48px;
  align-items: start;
}
.stub .f { min-width: 0; }
.stub input { min-height: 50px; }
.tag { display: block; font-size: .76rem; color: var(--ok); margin-top: 4px; padding-left: 4px; }
.tag.bad { color: var(--bad); }
.del {
  min-height: 50px; border: 1.5px solid var(--border); border-radius: var(--r-sm);
  background: var(--surface); color: var(--muted); cursor: pointer; font-size: .95rem;
}
.del:hover { border-color: var(--bad); color: var(--bad); }

@media (max-width: 640px) {
  .stub {
    grid-template-columns: 1fr 48px;
    grid-template-areas: "num del" "name name" "phone phone";
    padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--border);
  }
  .stub .n { grid-area: num; }
  .stub .f:nth-of-type(2) { grid-area: name; }
  .stub .f:nth-of-type(3) { grid-area: phone; }
  .stub .del { grid-area: del; }
}
</style>
