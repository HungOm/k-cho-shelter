<script setup>
/**
 * Printing tickets — a book, a run of books, or the whole raffle.
 *
 * TWO STEPS, VISIBLY. Tickets are generated (given a code that can be checked)
 * and then drawn. Keeping them apart is what makes a reprint safe: generating
 * is once-only, so a ticket already in somebody's wallet and the one coming off
 * the printer carry the same code. This screen shows how many of the chosen
 * tickets have never been generated and offers to do it, rather than doing it
 * silently as a side effect of pressing Print.
 *
 * NOTHING IS STORED. The tickets are drawn here, in the browser, from the
 * artwork and a few dozen bytes per ticket, and thrown away when this closes.
 * That is what lets a raffle hold twenty thousand of them without the app
 * carrying twenty thousand pictures.
 *
 * ORGANISERS ONLY, and the server refuses everything here for anybody else —
 * see tests/strictactions. This screen is only reachable from controls that
 * organisers see.
 */
import { ref, computed } from 'vue'
import { state, api, toast } from '../../lib/store.js'
import { designFor } from '../../lib/ticketdesign.js'
import { numberLayerSVG, ticketVerifyUrl } from '../../lib/ticketart.js'
import { sheetHTML } from '../../lib/ticketsheet.js'
import { encode } from '../../lib/qrcodegen.js'
import { expandTicketRange } from '../../lib/books.js'
import Sheet from '../ui/Sheet.vue'

const props = defineProps({ payload: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close'])

/* A book was named, so that is the obvious thing to print. */
const mode = ref(props.payload?.book ? 'book' : 'range')
const book = ref(String(props.payload?.book ?? ''))
const fromBook = ref(String(props.payload?.book ?? ''))
const toBook = ref(String(props.payload?.book ?? ''))
const numbers = ref('')

const busy = ref(false)
const err = ref('')
const result = ref(null)
const progress = ref('')

/*
 * WHERE THIS BATCH STARTS, and why there are batches at all.
 *
 * A drawn ticket is a page of artwork with a QR on it. Ten thousand of them is
 * not something a browser will lay out, however patient anybody is — so the
 * server hands back a printer's worth at a time and this walks them. `cursor`
 * is the ticket index the next batch starts after; `batch` is only for saying
 * "3 of 50" to somebody watching.
 */
const cursor = ref(0)
/* Where the batch on screen STARTED, which is what "print this batch" needs. */
const batchStart = ref(0)
const batch = ref(1)
const doneAll = ref(true)

/*
 * Fill the stub's ruled lines in for tickets that are already sold.
 *
 * Off by default, and deliberately: a blank book going out to a seller must
 * print blank lines. It is worth having because the stub exists to be filled
 * in, the raffle already knows all four fields, and the alternative is somebody
 * copying them out of the app by hand.
 */
const withBuyer = ref(false)

const c = computed(() => state.cfg || {})
const hasArtwork = computed(() => !!c.value.ticketArtwork)

const design = computed(() => (result.value?.template ? designFor(result.value.template) : null))

/* Blank means this site, which is what an organiser who has set nothing wants. */
const verifyBase = computed(() => {
  const set = String(result.value?.verifyBase || '').trim()
  if (set) return set
  return (typeof location === 'undefined' ? '' : location.origin) + '/v'
})

const tickets = computed(() => result.value?.tickets ?? [])
const missing = computed(() => result.value?.notGenerated ?? [])

const scope = computed(() => {
  if (mode.value === 'book') return book.value ? { book: book.value } : null
  if (mode.value === 'all') return { all: true }
  if (mode.value === 'numbers') {
    const raw = numbers.value.trim()
    if (!raw) return null
    // A typed run — "KS-00001–KS-00010" — expanded the way every other screen
    // expands one, so the same thing typed here and there means the same.
    const run = expandTicketRange(raw)
    if (run) return { numbers: run }
    return { numbers: raw.split(/[\s,]+/).filter(Boolean) }
  }
  if (!fromBook.value) return null
  return { fromBook: fromBook.value, toBook: toBook.value || fromBook.value }
})

/** One window of tickets, starting after `from`. */
async function load(from) {
  if (!scope.value) { err.value = 'Say which tickets to print.'; return }
  busy.value = true
  err.value = ''
  try {
    const r = await api('render_tickets', { ...scope.value, after: from, withBuyer: withBuyer.value })
    result.value = r
    batchStart.value = from
    cursor.value = r.after ?? from
    doneAll.value = !!r.done
  } catch (e) {
    err.value = e.message
    result.value = null
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
  }
}

function look() { batch.value = 1; load(0) }
function nextBatch() { batch.value += 1; load(cursor.value) }

/*
 * Generate every ticket in the scope that has no code, walking the whole thing.
 *
 * The server does a window per call and says where it got to. A raffle of
 * twenty thousand is a handful of calls; each is small enough that a dropped
 * connection costs a retry rather than a mystery about how far it got.
 */
async function generateMissing() {
  if (!scope.value) return
  busy.value = true
  err.value = ''
  try {
    let total = 0
    let from = 0
    for (let pass = 0; pass < 200; pass++) {
      const r = await api('generate_tickets', { ...scope.value, after: from })
      total += r.generated
      progress.value = `${total} generated…`
      if (r.done || r.after == null) break
      from = r.after
    }
    progress.value = ''
    if (total) toast(`${total} ticket${total === 1 ? '' : 's'} generated`, 'ok')
    await load(0)
    batch.value = 1
  } catch (e) {
    err.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
    progress.value = ''
  }
}

/** One ticket's overlay: its number, its book, its code, and the buyer if asked. */
function layerFor(t) {
  return numberLayerSVG(design.value, t.number, {
    book: t.book,
    buyer: t.buyer,
    qrUrl: ticketVerifyUrl(verifyBase.value, t.number, t.code),
    encode,
  })
}

const preview = computed(() => (design.value && tickets.value.length ? layerFor(tickets.value[0]) : ''))

/*
 * Printing goes through the browser's own dialog and the app's print
 * stylesheet, exactly as the handover receipt has always printed. No library,
 * no server, nothing to install on the machine doing the printing.
 */
function openSheet(download) {
  if (!design.value || !tickets.value.length) return
  const html = sheetHTML(design.value, tickets.value.map((t) => t.number), result.value.template.url, {
    title: `Tickets ${tickets.value[0].number} to ${tickets.value[tickets.value.length - 1].number}`,
    layers: Object.fromEntries(tickets.value.map((t) => [t.number, layerFor(t)])),
  })
  const w = window.open('', '_blank')
  if (!w) { toast('Allow pop-ups to print', 'bad'); return }
  w.document.write(html)
  w.document.close()
  if (!download) setTimeout(() => { try { w.print() } catch { /* the person can print it themselves */ } }, 600)
}

/** Mark this batch printed, then open it. */
async function printThem() {
  busy.value = true
  try {
    // The SAME window that is on screen, marked printed. Not `cursor`, which
    // is where the next batch begins — using that would stamp the wrong tickets.
    await api('render_tickets', { ...scope.value, after: batchStart.value, print: true, withBuyer: withBuyer.value })
    openSheet(false)
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Sheet title="Print tickets" @close="emit('close')">
    <p v-if="!hasArtwork" class="note bad">
      There is no ticket artwork yet, so nothing can be printed. Upload it on the
      Ticket design screen first.
    </p>

    <template v-else>
      <div class="field">
        <label for="pt-scope">Which tickets</label>
        <select id="pt-scope" v-model="mode">
          <option value="book">One book</option>
          <option value="range">A run of books</option>
          <option value="numbers">Tickets I type</option>
          <option value="all">Every ticket in the raffle</option>
        </select>
      </div>

      <div v-if="mode === 'book'" class="field">
        <label for="pt-book">Book</label>
        <input id="pt-book" v-model="book" spellcheck="false" placeholder="Book-0001">
      </div>

      <div v-else-if="mode === 'range'" class="row wrap gap">
        <div class="field"><label for="pt-from">First book</label>
          <input id="pt-from" v-model="fromBook" spellcheck="false" placeholder="Book-0001"></div>
        <div class="field"><label for="pt-to">Last book</label>
          <input id="pt-to" v-model="toBook" spellcheck="false" placeholder="Book-0010"></div>
      </div>

      <div v-else-if="mode === 'numbers'" class="field">
        <label for="pt-nums">Ticket numbers</label>
        <input id="pt-nums" v-model="numbers" spellcheck="false" placeholder="KS-00001–KS-00010">
        <p class="tiny muted">A run, or numbers separated by spaces or commas.</p>
      </div>

      <p v-else class="muted small">
        Every ticket in the raffle, a printer's worth at a time.
      </p>

      <label class="check" style="margin-top:12px">
        <input v-model="withBuyer" type="checkbox">
        Fill in the buyer&rsquo;s details on the stub, for tickets already sold
      </label>
      <p class="tiny muted" style="margin:4px 0 0">
        Name, phone, address and who sold it, written onto the stub&rsquo;s own lines.
        Blank tickets going out to a seller should leave this off.
      </p>

      <div class="sub">
        <span class="muted small grow">{{ progress }}</span>
        <button class="btn sm" :disabled="busy" @click="look">
          {{ busy ? 'Working…' : 'See what is there' }}
        </button>
      </div>

      <p v-if="err" class="note bad tiny">{{ err }}</p>

      <template v-if="result">
        <div class="card" style="margin-top:14px">
          <p v-if="!doneAll || batch > 1" class="tiny muted" style="margin:0 0 6px">
            Batch {{ batch }}<template v-if="!doneAll">, and there are more after it</template>.
            A printer&rsquo;s worth at a time &mdash; ten thousand tickets is not something a
            browser will lay out in one go.
          </p>
          <p>
            <b>{{ tickets.length }}</b> ticket{{ tickets.length === 1 ? '' : 's' }} in this batch, ready to print.
            <template v-if="missing.length">
              <br><b>{{ missing.length }}</b> ha{{ missing.length === 1 ? 's' : 've' }} never been
              generated, so {{ missing.length === 1 ? 'it has' : 'they have' }} no code yet and
              cannot be printed.
            </template>
          </p>
          <p v-if="missing.length" class="tiny muted">
            {{ missing.slice(0, 8).join(', ') }}<template v-if="missing.length > 8">, and
            {{ missing.length - 8 }} more</template>.
          </p>
          <div class="sub">
            <span class="grow"></span>
            <button v-if="missing.length" class="btn sm primary" :disabled="busy"
                    @click="generateMissing">
              Generate {{ missing.length }} and try again
            </button>
          </div>
        </div>

        <template v-if="tickets.length">
          <p class="tiny muted" style="margin:14px 0 6px">
            This is the first of them, drawn exactly as it will print:
          </p>
          <div class="ticketpreview">
            <img :src="result.template.url" alt="">
            <div class="overlay" v-html="preview"></div>
          </div>
          <p class="tiny muted" style="margin-top:8px">
            The code on each ticket points at {{ verifyBase }} — scanning it says whether
            that ticket is genuine.
          </p>
        </template>
      </template>
    </template>

    <template #actions>
      <button v-if="tickets.length" class="btn" :disabled="busy" @click="openSheet(true)">
        Open without marking printed
      </button>
      <button v-if="tickets.length" class="btn primary" :disabled="busy" @click="printThem">
        Print {{ tickets.length }}
      </button>
      <button v-if="tickets.length && !doneAll" class="btn" :disabled="busy" @click="nextBatch">
        Next batch &rarr;
      </button>
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.ticketpreview { position: relative; width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden }
.ticketpreview img { display: block; width: 100%; height: auto }
.ticketpreview .overlay { position: absolute; inset: 0 }
.ticketpreview .overlay :deep(svg) { width: 100%; height: 100%; display: block }
</style>
