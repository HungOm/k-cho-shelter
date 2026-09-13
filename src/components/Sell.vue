<script setup>
/**
 * The recording screen.
 *
 * Two jobs: look up one ticket fast, and key in the pile of stubs an agent
 * hands back. The stub pile is where the hours actually go, so it is built for
 * the keyboard: type, tab, type, tab, and a new row appears on its own.
 */
import { ref, computed, nextTick } from 'vue'
import { state, api, toast, loadDelta, canWrite } from '../lib/store.js'
import { phoneDigits } from '../lib/search.js'
import { money } from '../lib/format.js'
import { resolveTicketNumber } from '../lib/books.js'
import Bi from './ui/Bi.vue'

const emit = defineEmits(['open'])

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
  if (t.status === 'Sold') return { bad: true, text: 'already sold' }
  if (t.status === 'Void') return { bad: true, text: 'cancelled' }
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
      ;(t && t.status === 'Sold' ? landed : missing).push(sale)
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

  busy.value = true
  waited.value = 0
  ticker = setInterval(() => { waited.value += 1 }, 1000)
  try {
    const res = await api('bulk_record_sales', { sales }, { reconcile: true })
    rows.value = [blank()]
    toast(`${res.recorded} sales written down`, 'ok')
    loadDelta()
  } catch (err) {
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
</script>

<template>
  <div>
    <h1><Bi text="Write down sales" /></h1>

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
      <p class="muted small">
        For when a seller brings back their book. Fill a line, press Tab, and the
        next line appears. Nothing is saved until you press the button — and if
        one line has a problem, none of them are saved.
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
          <input v-model="r.phone" class="f" type="tel" inputmode="tel" autocomplete="off"
                 placeholder="Phone" aria-label="Phone" @keydown.tab="onLastField(i)">
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
