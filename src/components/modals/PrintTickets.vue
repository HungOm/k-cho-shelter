<script setup>
/**
 * PRINTING TICKETS — the sheet is the subject, not the form that describes it.
 *
 * TWO STEPS, VISIBLY. Tickets are generated (given a code that can be checked)
 * and then drawn. Keeping them apart is what makes a reprint safe: generating
 * is once-only, so a ticket already in somebody's wallet and the one coming off
 * the printer carry the same code. This screen shows how many of the chosen
 * tickets have never been generated and offers to do it, rather than doing it
 * silently as a side effect of pressing Print.
 *
 * WHAT CHANGED. This was a form that ended in a picture of one ticket. But
 * nobody prints a ticket — they print a SHEET, and every question that actually
 * goes wrong is a question about the sheet: how many are on it, where it breaks,
 * whether the last one is half off the bottom, how many blanks are on the end of
 * the run. So the sheet is now drawn, at its real proportions, page by page,
 * with the arithmetic that decides it written underneath.
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
import { ref, computed, watch } from 'vue'
import { state, api, toast } from '../../lib/store.js'
import { designFor } from '../../lib/ticketdesign.js'
import { numberLayerSVG, ticketVerifyUrl } from '../../lib/ticketart.js'
import { sheetHTML, pageFit } from '../../lib/ticketsheet.js'
import { encode } from '../../lib/qrcodegen.js'
import { expandTicketRange, bookNumber, storedBook } from '../../lib/books.js'
// Across into the check page's own folder on purpose: the sample book and the
// marker its QR carries are one contract shared with the page that answers it,
// and that page may not import from lib/. See src/verify/sample.js.
import { sampleBook, sampleVerifyUrl, SAMPLE_BOOK } from '../../verify/sample.js'
import Sheet from '../ui/Sheet.vue'
import SheetPreview from '../ui/SheetPreview.vue'

const props = defineProps({ payload: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close'])

/* A book was named, so that is the obvious thing to print — unless samples
 * were asked for, which is a choice somebody made on the way in. */
const mode = ref(props.payload?.sample ? 'sample' : props.payload?.book ? 'book' : 'range')
const book = ref(String(props.payload?.book ?? ''))
const fromBook = ref(String(props.payload?.book ?? ''))
const toBook = ref(String(props.payload?.book ?? ''))
const numbers = ref('')

/*
 * SAMPLES ARE A SCOPE, NOT A MODE, and that is the whole of their safety.
 *
 * A mode is a thing somebody leaves switched on: real tickets printed with a
 * watermark across them, or — far worse — one browser set to samples and
 * another not, both printing what they believe is the same book. A scope
 * cannot be left on. You choose it for one run, the run says what it is, and
 * the next run starts from whatever you pick then.
 *
 * The confirmation below is the second half of what was asked for: the screen
 * says which kind of paper this will be before it draws anything, and will not
 * draw until that has been read. The watermark is the third half — a mistake
 * that gets past both is still obvious on the paper itself.
 */
const isSample = computed(() => mode.value === 'sample')
const sampleOk = ref(false)

const busy = ref(false)
const err = ref('')
const result = ref(null)
const progress = ref('')

/*
 * WHERE THIS BATCH STARTS, and why there are batches at all.
 *
 * A drawn ticket is a page of artwork with a QR on it. Ten thousand of them is
 * not something a browser will lay out, however patient anybody is — so the
 * server hands back a printer's worth at a time and this walks them.
 */
const cursor = ref(0)
const batchStart = ref(0)
const batch = ref(1)
const doneAll = ref(true)

/*
 * HOW BIG THE SERVER'S WINDOW TURNED OUT TO BE, learned from the first batch
 * rather than written down here. printing.ts caps a batch at MAX_PER_PRINT and
 * that number is the server's to change; a copy of it on this side would go on
 * dividing by 200 long after the server stopped using it, and the only symptom
 * would be a batch count that is quietly wrong.
 */
const windowSize = ref(0)

/*
 * Fill the stub's ruled lines in for tickets that are already sold.
 *
 * Off by default, and deliberately: a blank book going out to a seller must
 * print blank lines.
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

/* ---------- how it lands on paper ---------- */

/*
 * The page setup for THIS run.
 *
 * Held here rather than written back to the template, because a margin is a
 * fact about the printer somebody is standing at, not about the ticket. The
 * template's own numbers are the starting point and the Ticket Studio screen is
 * where a lasting change belongs; this is the knob you turn when the office
 * printer eats 12 mm instead of 10.
 */
const runSheet = ref(null)
watch(design, (d) => {
  if (d && !runSheet.value) runSheet.value = { ...d.sheet }
}, { immediate: true })

const sheetOpts = computed(() => (runSheet.value ? { ...runSheet.value } : {}))

const fit = computed(() => (design.value ? pageFit(design.value, sheetOpts.value) : null))

/* The tickets on screen, cut into pages exactly where the printer will cut. */
const pages = computed(() => {
  const per = fit.value?.per ?? 1
  const out = []
  for (let i = 0; i < tickets.value.length; i += per) out.push(tickets.value.slice(i, i + per))
  return out
})

const pageNo = ref(0)
watch(pages, () => { if (pageNo.value >= pages.value.length) pageNo.value = 0 })
const page = computed(() => pages.value[pageNo.value] ?? [])

/* How many slots on the last sheet have nothing in them. A run that ends three
 * up the page is a sheet somebody has to guillotine differently. */
const blanks = computed(() => {
  const per = fit.value?.per ?? 0
  if (!per || !tickets.value.length) return 0
  const rem = tickets.value.length % per
  return rem === 0 ? 0 : per - rem
})

/* The sum, in the form somebody can check against a ruler. */
const pageSum = computed(() => {
  const f = fit.value
  if (!f) return ''
  return `${f.per} × ${f.heightMM.toFixed(1)} + ${f.per - 1} × ${f.gapMM.toFixed(1)}`
    + ` + 2 × ${f.marginMM.toFixed(1)} = ${f.used.toFixed(1)} of ${f.pageHeightMM.toFixed(1)} mm`
})

/*
 * WHAT THE QR ACTUALLY CARRIES.
 *
 * Every character in the address is a module in the printed code, and the
 * module size is what decides whether a phone reads it off paper across a
 * table. These are the four numbers that settle it, taken from a real encode of
 * a real ticket's address rather than estimated.
 */
const qrFacts = computed(() => {
  const d = design.value
  const t = tickets.value[0]
  if (!d || !t) return null
  const code = d.elements?.find((e) => e.kind === 'code' && e.enabled !== false)
  if (!code) return null
  try {
    const url = ticketVerifyUrl(verifyBase.value, t.number, t.code)
    const enc = encode(url, { ecc: code.ecc || 'M' })
    const bytes = new TextEncoder().encode(url).length
    const version = (enc.size - 17) / 4
    const widthMM = Number(sheetOpts.value.widthMM ?? d.sheet.widthMM ?? 190)
    const sizePx = Math.min(code.box.width * d.artwork.width, code.box.height * d.artwork.height)
    const perModuleMM = ((sizePx / (enc.size + 8)) * widthMM) / d.artwork.width
    return { url, bytes, version, modules: enc.size, mm: perModuleMM, widthMM }
  } catch {
    return null
  }
})

/* ---------- what is being printed ---------- */

/*
 * WHAT THE RAFFLE CALLS THE BOOK SOMEBODY TYPED.
 *
 * The server matches `books.number` exactly (functions/api/printing.ts), so a
 * raffle numbered Book-001 refuses "Book-0001" as a book that does not exist
 * — which is what it said, and is close to useless to read while holding a
 * book with 0001 printed on it. Every other screen that takes a book number
 * canonicalises before sending: IssueBooks sends bookNumber(), so 1, 01 and
 * Book-1 all arrive as the same label. This modal sent the box's own text,
 * which is why it alone was strict about padding.
 *
 * RESOLVED AGAINST THE LOADED BOOKS rather than by padding — storedBook() in
 * lib/books.js, which is where the reasoning is written down and where the
 * payment screen reads it from too.
 */
const numOf = (v) => parseInt(String(v ?? '').replace(/\D/g, ''), 10)

/** The first and last book this raffle actually has, for when somebody misses. */
const bookSpan = computed(() => {
  if (!state.booksAllLoaded || !state.books.length) return ''
  let lo = state.books[0], hi = state.books[0]
  for (const b of state.books) {
    if (numOf(b.book) < numOf(lo.book)) lo = b
    if (numOf(b.book) > numOf(hi.book)) hi = b
  }
  return `${lo.book} to ${hi.book}`
})

/*
 * Said HERE rather than after a round trip, and saying what would work.
 * "Book-0001 is not a book in this raffle" is true and leaves somebody
 * guessing at the padding; the book list is already on the device, so the
 * range it would accept costs nothing to include.
 */
function noSuchBook(typed) {
  const span = bookSpan.value
  return `There is no book ${String(typed).trim()} in this raffle.` +
    (span ? ` The books run ${span}.` : '')
}

const scopeProblem = computed(() => {
  if (mode.value === 'book') {
    return book.value && storedBook(book.value) === null ? noSuchBook(book.value) : ''
  }
  if (mode.value === 'range') {
    for (const typed of [fromBook.value, toBook.value]) {
      if (typed && storedBook(typed) === null) return noSuchBook(typed)
    }
  }
  return ''
})

/** The placeholder follows the raffle's own numbering rather than guessing at it. */
const bookHint = computed(() => bookNumber('1') || 'Book-001')
const bookHintLast = computed(() => bookNumber('10') || 'Book-010')

const scope = computed(() => {
  // A sample asks the server for nothing. loadSample builds the batch.
  if (mode.value === 'sample') return null
  if (mode.value === 'book') {
    const one = storedBook(book.value)
    return one ? { book: one } : null
  }
  if (mode.value === 'all') return { all: true }
  if (mode.value === 'numbers') {
    const raw = numbers.value.trim()
    if (!raw) return null
    const run = expandTicketRange(raw)
    if (run) return { numbers: run }
    return { numbers: raw.split(/[\s,]+/).filter(Boolean) }
  }
  if (!fromBook.value) return null
  /*
   * An unknown LAST book is not quietly dropped back to the first. Printing
   * one book when somebody asked for a run of forty is a stack of paper that
   * looks right until it is counted.
   */
  const from = storedBook(fromBook.value)
  const to = toBook.value ? storedBook(toBook.value) : from
  if (!from || !to) return null
  return { fromBook: from, toBook: to }
})

/*
 * THE BOOKS IN THIS BATCH, AND WHETHER THEY HAVE CODES.
 *
 * Assembled from the tickets that came back rather than asked for separately,
 * because the server already said which of them have never been generated and a
 * second request for the same fact is a second thing that can disagree.
 *
 * It describes THE BATCH ON SCREEN and says so. A books table that looked like
 * the whole raffle while showing one book's worth would be worse than no table:
 * "not yet" against a book nobody asked about reads as a finding.
 */
const bookRows = computed(() => {
  const never = new Set(missing.value)
  const by = new Map()
  for (const t of tickets.value) {
    const key = t.book || '—'
    const row = by.get(key) || { book: key, first: t.number, last: t.number, n: 0, without: 0 }
    row.last = t.number
    row.n += 1
    if (never.has(t.number)) row.without += 1
    by.set(key, row)
  }
  return [...by.values()]
})

/*
 * `tickets` and `notGenerated` are disjoint: the server returns the drawable
 * ones in the first and names the rest in the second, so the batch is their sum
 * and the ones with codes are simply the first.
 */
/*
 * WHICH BATCH THIS IS, OUT OF HOW MANY.
 *
 * Nothing on the wire says how many batches there are. render_tickets returns a
 * window, a cursor and `done`, and resolveScope knows the total only as a LIMIT
 * it stopped at — so the count is worked out here or not shown.
 *
 * WHEN IT IS EXACT: `done` means this window is the last, so the total simply
 * IS the batch on screen. No arithmetic, and it covers the ordinary case of one
 * book in one batch.
 *
 * WHEN IT IS DERIVED: tickets in the chosen scope, divided by the window the
 * server actually used. The scope size comes from the configured book size —
 * the same number isFreeToIssue already trusts when it compares a book's
 * `available` against it — so a raffle whose books are not uniform is the case
 * this gets wrong, and the guard below is what catches it.
 *
 * WHEN IT REFUSES: no configured size, no window measured yet, or arithmetic
 * that says the total is not greater than the batch on screen while the server
 * is still offering another one. Those disagree, and when a derived number
 * disagrees with something the server actually said, the server wins and the
 * total is dropped. "Batch 3" is honest. "Batch 3 of 3" above a live Next batch
 * button is a number somebody stops printing at.
 */
const scopeTickets = computed(() => {
  const c = state.cfg || {}
  const per = Number(c.ticketsPerBook || 0)
  if (mode.value === 'sample') return tickets.value.length || null
  if (mode.value === 'numbers') {
    const n = scope.value?.numbers
    return Array.isArray(n) && n.length ? n.length : null
  }
  if (mode.value === 'all') return Number(c.totalTickets) || null
  if (!per) return null
  if (mode.value === 'book') return scope.value?.book ? per : null
  const lo = numOf(scope.value?.fromBook), hi = numOf(scope.value?.toBook)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null
  return (hi - lo + 1) * per
})

const totalBatches = computed(() => {
  if (!result.value) return null
  if (doneAll.value) return batch.value
  const n = scopeTickets.value
  const w = windowSize.value
  if (!n || !w) return null
  const t = Math.ceil(n / w)
  return t > batch.value ? t : null
})

/* One batch start to finish is not a batch anybody is counting, so it says
 * nothing rather than "Batch 1 of 1". */
const manyBatches = computed(() => !!result.value && !(doneAll.value && batch.value === 1))

const batchLabel = computed(() => {
  if (!manyBatches.value) return ''
  const t = totalBatches.value
  return t ? `Batch ${batch.value} of ${t}` : `Batch ${batch.value}`
})

const withCodes = computed(() => tickets.value.length)
const inBatch = computed(() => tickets.value.length + missing.value.length)

/** One window of tickets, starting after `from`. */
async function load(from) {
  if (mode.value === 'sample') return loadSample()
  if (!scope.value) { err.value = scopeProblem.value || 'Say which tickets to print.'; return }
  busy.value = true
  err.value = ''
  try {
    const r = await api('render_tickets', { ...scope.value, after: from, withBuyer: withBuyer.value })
    result.value = r
    batchStart.value = from
    cursor.value = r.after ?? from
    doneAll.value = !!r.done
    pageNo.value = 0
    // The first window is the only honest measure of the window, because every
    // later one may be the short last batch.
    if (from === 0 && !r.done) windowSize.value = (r.tickets?.length ?? 0) + (r.notGenerated?.length ?? 0)
  } catch (e) {
    err.value = e.message
    result.value = null
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
  }
}

/*
 * The sample batch, assembled here rather than asked for.
 *
 * One request still goes out, and only for the ARTWORK: the template lives on
 * the server and a sample has to be drawn on the same paper as a real ticket
 * or it demonstrates nothing. render_tickets is read-only — it stamps nothing
 * as printed — and it returns the template even when its scope matches no
 * tickets, which is what makes this work on a raffle that has not been
 * numbered yet.
 */
async function loadSample() {
  busy.value = true
  err.value = ''
  try {
    const r = await api('render_tickets', { all: true, after: 0, withBuyer: false })
    result.value = {
      template: r.template,
      verifyBase: r.verifyBase,
      tickets: sampleBook(),
      notGenerated: [],
      done: true,
      after: null,
    }
    batchStart.value = 0
    cursor.value = 0
    doneAll.value = true
    pageNo.value = 0
  } catch (e) {
    err.value = e.message
    result.value = null
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
  }
}

function look() { batch.value = 1; windowSize.value = 0; load(0) }
function nextBatch() { batch.value += 1; load(cursor.value) }

/*
 * Generate every ticket in the scope that has no code, walking the whole thing.
 * The server does a window per call and says where it got to.
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
    /*
     * A sample's QR carries the marker, never the compact <number>.<code>
     * form. Sent as a lookup it would be a ticket that does not exist, and the
     * page would answer a demonstration ticket in red as though somebody had
     * forged it.
     */
    qrUrl: isSample.value
      ? sampleVerifyUrl(verifyBase.value, t.number)
      : ticketVerifyUrl(verifyBase.value, t.number, t.code),
    watermark: isSample.value ? 'SAMPLE' : '',
    encode,
  })
}

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
    /*
     * The sheet prints itself once its images have loaded. It used to be a
     * 600ms timer out here, which is fine on a warm cache and prints a blank
     * page on a cold one — or declines to print and leaves somebody looking
     * at the sheet wondering what happened. The document is the only thing
     * that knows when it is ready.
     */
    /*
     * A PDF IS THE PRINT DIALOG'S OWN EXPORT, and that is not a workaround.
     * Browsers write PDF from this sheet with live text and vector QR codes;
     * a library would rasterise every ticket to fit in the bundle and produce
     * a bigger, worse file. So the route to a PDF is the dialog, and the
     * samples button opens it — there is nothing to stamp as printed on a
     * sample, so "open" and "print" were never two different things here.
     */
    autoPrint: !download || isSample.value,
    ...sheetOpts.value,
  })
  const w = window.open('', '_blank')
  if (!w) { toast('Allow pop-ups to print', 'bad'); return }
  w.document.write(html)
  w.document.close()
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

/* A ticket's height as a share of the page, so the preview is the real
 * proportion rather than a drawing of one. */
</script>

<template>
  <Sheet title="Printing tickets"
         :subtitle="tickets.length
           ? (batchLabel ? `${batchLabel} · ` : '') + `${tickets[0].number} — ${tickets[tickets.length - 1].number}`
           : 'a book, a run of books, the whole raffle, or ten samples'"
         wide @close="emit('close')">
    <p v-if="!hasArtwork" class="note bad">
      No ticket artwork yet. Upload it in Ticket Studio first.
    </p>

    <template v-else>
      <p class="whoonly">
        <span class="pill bad">Organisers only</span>
        <span class="tiny muted">Cannot be handed to sellers from the Access screen.</span>
      </p>

      <!--
        WHICH KIND OF PAPER THIS IS, across the top rather than only beside the
        control that chose it. Somebody scrolls to the sheet, prints, and walks
        away; the answer has to be where they end up, not only where they began.
      -->
      <div v-if="isSample" class="samplestrip">
        SAMPLE RUN — watermarked, not in the raffle, cannot be sold
      </div>

      <div class="printroom">
        <!-- ---------- the sheet ---------- -->
        <div class="paperside">
          <template v-if="tickets.length && fit">
            <div class="pager">
              <button class="btn sm ghost" :disabled="pageNo === 0"
                      title="The sheet before this one" @click="pageNo -= 1">&lsaquo;</button>
              <b class="tiny">Sheet {{ pageNo + 1 }} of {{ pages.length }}</b>
              <!-- Two counters side by side, and they count different things:
                   sheets WITHIN this batch, batches within the run. Labelled in
                   full rather than abbreviated, because "3/50 · 1/50" beside
                   itself is unreadable and this run really can have the same
                   number twice. -->
              <b v-if="batchLabel" class="tiny batchnow">{{ batchLabel }}</b>
              <button class="btn sm ghost" :disabled="pageNo >= pages.length - 1"
                      title="The next sheet" @click="pageNo += 1">&rsaquo;</button>
              <span class="grow"></span>
              <span class="tiny muted mono">A4 210 × 297 mm · portrait</span>
            </div>
            <p class="tiny muted mono runline">
              {{ page[0]?.number }} — {{ page[page.length - 1]?.number }}
              <template v-if="page[0]?.book"> · {{ page[0].book }}</template>
              <template v-if="blanks">
                · last sheet has {{ blanks }} blank{{ blanks === 1 ? '' : 's' }}
              </template>
            </p>

            <!--
              THE PAGE AT ITS REAL PROPORTIONS. Everything here is a percentage
              of 210 × 297 mm, so what is on screen is the shape that comes out
              of the printer — a preview drawn to a convenient size would hide
              exactly the thing somebody is looking for, which is whether the
              last ticket falls off the bottom.
            -->
            <SheetPreview :fit="fit" :art="result.template.url"
                          :cutlines="!!runSheet?.cutlines"
                          :items="page.map((t) => ({ key: t.number, overlay: layerFor(t) }))" />

            <!--
              THE PAGE SETUP, and the sum it produces. "Tickets to a page" used
              to be a slider that nothing read: a ticket is as tall as its width
              and the artwork's shape make it, so how many fit is arithmetic with
              no free variable in it. It is shown, not asked for.
            -->
            <div class="setup">
              <p class="rubric">On the page</p>
              <div class="setupgrid">
                <label class="formrow"><span class="cap">Ticket width</span>
                  <span class="wrap">
                    <input v-model.number="runSheet.widthMM" type="number" step="1" min="40" max="210">
                    <span class="unit">mm</span>
                  </span>
                </label>
                <label class="formrow"><span class="cap">Gap</span>
                  <span class="wrap">
                    <input v-model.number="runSheet.gapMM" type="number" step="1" min="0" max="30">
                    <span class="unit">mm</span>
                  </span>
                </label>
                <label class="formrow"><span class="cap">Margin</span>
                  <span class="wrap">
                    <input v-model.number="runSheet.marginMM" type="number" step="1" min="0" max="30">
                    <span class="unit">mm</span>
                  </span>
                </label>
                <label class="choice"><input v-model="runSheet.cutlines" type="checkbox"> Cut lines</label>
              </div>
              <p class="tiny mono" :class="fit.fits ? 'muted' : 'bad'">{{ pageSum }}</p>
              <p class="tiny muted">This run only — the template's setup is in Ticket Studio.</p>
            </div>
          </template>

          <p v-else-if="result" class="note tiny">
            Nothing in this batch can be drawn yet.
          </p>
          <!--
            NOTHING CHOSEN YET, SAID OUT LOUD. This column rendered nothing at
            all until a batch was loaded, so the first thing an organiser saw
            was blank space where the sheet would be. That answers none of the
            questions they opened this to ask, and an empty area reads as a
            screen that has failed rather than one that is waiting.

            It also says where the sheets get drawn, because the thing anybody
            is nervous about here is committing paper to a printer. Being told
            the drawing happens on screen first is what makes the button safe
            to press.
          -->
          <div v-else class="nodraw">
            <p class="head">Nothing drawn yet</p>
            <p class="tiny muted">
              Pick a batch, then <b>See what is there</b>.
            </p>
          </div>
        </div>

        <!-- ---------- what to print ---------- -->
        <aside class="controlside">
          <div class="cgroup">
            <p class="rubric">What to print</p>
            <label class="choice"><input v-model="mode" type="radio" value="book"> This book</label>
            <input v-if="mode === 'book'" v-model="book" class="sub-in" spellcheck="false"
                   :placeholder="bookHint" aria-label="Which book">

            <label class="choice"><input v-model="mode" type="radio" value="range"> A run of books</label>
            <div v-if="mode === 'range'" class="tworow">
              <input v-model="fromBook" class="sub-in" spellcheck="false" :placeholder="bookHint"
                     aria-label="First book">
              <input v-model="toBook" class="sub-in" spellcheck="false" :placeholder="bookHintLast"
                     aria-label="Last book">
            </div>

            <label class="choice"><input v-model="mode" type="radio" value="numbers"> Numbers you type</label>
            <input v-if="mode === 'numbers'" v-model="numbers" class="sub-in" spellcheck="false"
                   placeholder="KS-00001–KS-00010" aria-label="Ticket numbers">

            <label class="choice"><input v-model="mode" type="radio" value="all"> The whole raffle</label>

            <label class="choice"><input v-model="mode" type="radio" value="sample"> Sample book</label>
            <div v-if="isSample" class="samplebox">
              <!-- Three facts became one. "Cannot be sold" was the third, and
                   the checkbox directly below is the reader confirming exactly
                   that — the box argued a point its own control already makes. -->
              <p class="tiny"><b>Ten watermarked samples.</b> Never in the raffle, never recorded.</p>
              <label class="choice tiny">
                <input v-model="sampleOk" type="checkbox">
                <span>I understand these cannot be sold</span>
              </label>
            </div>

            <!-- The hint is nested inside the label's own text rather than beside
                 the checkbox: .choice is a flex row, so a sibling span becomes a
                 second column and the label wraps to three words a line. -->
            <label class="choice">
              <input v-model="withBuyer" type="checkbox">
              <span>Fill in the buyer's details
                <span class="why">Only for tickets already sold — a blank book needs blank lines.</span>
              </span>
            </label>

            <button class="btn sm wide" :disabled="busy || (isSample && !sampleOk)"
                    :title="isSample && !sampleOk ? 'Confirm you understand these are samples' : ''"
                    @click="look">
              {{ busy ? 'Working…' : isSample ? 'Draw the sample book' : 'See what is there' }}
            </button>
            <p v-if="progress" class="tiny muted">{{ progress }}</p>
            <p v-if="err" class="note bad tiny">{{ err }}</p>
          </div>

          <template v-if="result">
            <!--
              THE TWO STEPS, NUMBERED, because they happen in an order and the
              second one is refused until the first has been done. Generating is
              once-only; a reprint must carry the code the ticket already has.
            -->
            <div v-if="!isSample" class="cgroup">
              <p class="rubric"><span class="step">1</span> Give them codes</p>
              <p class="tiny muted">
                <template v-if="missing.length">
                  {{ missing.length }} of these {{ inBatch }} have never
                  been generated, so they have no code and cannot be printed.
                </template>
                <template v-else>
                  All {{ tickets.length }} already have one. Running this again generates
                  nothing and says so.
                </template>
              </p>
              <button class="btn sm wide" :class="{ primary: missing.length }"
                      :disabled="busy || !missing.length"
                      :title="missing.length ? `Generate ${missing.length} codes` : 'Every ticket in this batch already has a code'"
                      @click="generateMissing">
                {{ missing.length ? `Generate ${missing.length}` : 'Nothing to generate' }}
              </button>
              <!--
                Quiet, and conditional. This said the same thing as the line
                above the button, in alarm red, underneath the button that
                fixes it — so a first print run read it as a refusal: the
                tickets would be left out whatever you did. They are only left
                out if you print WITHOUT pressing Generate.
              -->
              <p v-if="missing.length" class="tiny muted">
                {{ missing.slice(0, 6).join(', ') }}<template v-if="missing.length > 6">, and
                {{ missing.length - 6 }} more</template>. Print without generating and these are left out.
              </p>
            </div>

            <div class="cgroup">
              <p class="rubric"><span class="step" v-if="!isSample">2</span> Put them on paper</p>
              <p v-if="isSample" class="tiny muted">Never marked as printed — run off as many as you like.</p>
              <button v-if="!isSample" class="btn sm primary wide" :disabled="busy || !tickets.length"
                      :title="tickets.length ? 'Marks this batch printed, then opens the print dialog' : 'Nothing to print'"
                      @click="printThem">
                Print {{ pages.length }} sheet{{ pages.length === 1 ? '' : 's' }} now
              </button>
              <button class="btn sm wide" :class="{ primary: isSample }" :disabled="busy || !tickets.length"
                      :title="tickets.length ? 'Opens the same sheets without stamping the book as printed' : 'Nothing to open'"
                      @click="openSheet(true)">
                {{ isSample ? 'Print or save as PDF' : 'Open without marking printed' }}
              </button>
              <button v-if="!doneAll" class="btn sm wide" :disabled="busy" @click="nextBatch">
                Next batch<template v-if="totalBatches"> ({{ batch + 1 }} of {{ totalBatches }})</template> &rarr;
              </button>
              <p v-if="manyBatches" class="tiny muted">
                {{ batchLabel }}<template v-if="!doneAll">. The run is not finished.</template>
                <template v-else>. This is the last one.</template>
              </p>
              <p class="tiny muted">Print at 100%.</p>
            </div>

            <div v-if="bookRows.length" class="cgroup">
              <p class="rubric">Books in this batch</p>
              <table class="brows">
                <thead><tr><th>Book</th><th>Numbers</th><th class="r">Codes</th></tr></thead>
                <tbody>
                  <tr v-for="b in bookRows" :key="b.book">
                    <td>{{ b.book }}</td>
                    <td class="mono">{{ b.first }}–{{ b.last }}</td>
                    <td class="r" :class="b.without ? 'badt' : 'okt'">
                      {{ b.without ? 'not yet' : 'generated' }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="tiny muted">
                This batch only.<template v-if="!doneAll"> More books follow.</template>
              </p>
            </div>

            <div v-if="qrFacts" class="cgroup">
              <p class="rubric">What the QR carries</p>
              <p class="mono tiny brk">{{ qrFacts.url }}</p>
              <p class="tiny muted mono">
                {{ qrFacts.bytes }} bytes · version {{ qrFacts.version }} ·
                {{ qrFacts.modules }} modules · {{ qrFacts.mm.toFixed(2) }} mm each
                at {{ qrFacts.widthMM }} mm wide
              </p>
              <p class="tiny muted">
                Printed codes outlive the raffle — the address stays yours to set.
              </p>
            </div>
          </template>
        </aside>
      </div>

      <p class="tiny muted foot">
        Generating is audited; printing stamps the book.
        <template v-if="result">
          <span class="grow"></span>
          <b>{{ withCodes }}</b> of {{ inBatch }} in this batch have codes.
        </template>
      </p>
    </template>
    <template #actions>
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
.samplebox {
  margin: 6px 0 10px; padding: 10px 12px; border-radius: var(--r-sm);
  background: var(--warn-soft); border: 1px solid var(--warn);
}
.samplebox p { margin: 0 0 6px; }
.samplestrip {
  margin: 0 0 10px; padding: 8px 12px; border-radius: var(--r-sm);
  background: var(--warn-soft); border: 1px solid var(--warn);
  font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-align: center;
}
.whoonly { display: flex; align-items: center; gap: 8px; margin: 0 0 12px }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums }
.grow { flex: 1; min-width: 0 }
/* As studio.css, on the scale. .68 was the pre-token value the studio already
   migrated off; --fw-medium IS 600, so that half is a rename. */
.rubric {
  margin: 0; font-size: var(--fs-3xs); font-weight: var(--fw-medium); letter-spacing: .07em;
  text-transform: uppercase; color: var(--muted);
}
/* A step is a number in the order it happens, not a decorative badge. */
.step {
  display: inline-block; width: 15px; height: 15px; line-height: 15px; text-align: center;
  background: var(--brand); color: var(--brand-ink); border-radius: 3px;
  font-size: .62rem; margin-right: 5px; letter-spacing: 0;
}

.printroom { display: grid; grid-template-columns: minmax(0, 1fr) 232px; gap: 16px; align-items: start }
.paperside { min-width: 0; display: flex; flex-direction: column; gap: 8px }
.controlside { display: flex; flex-direction: column; gap: 12px; min-width: 0 }
.cgroup { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border) }
.cgroup:first-child { border-top: 0; padding-top: 0 }
.wide { width: 100% }
.sub-in { margin: 0 0 2px 24px; width: calc(100% - 24px); min-height: 34px; padding: 4px 8px; font-size: .84rem }
.tworow { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-left: 24px }
.tworow .sub-in { margin: 0; width: 100% }

.pager { display: flex; align-items: center; gap: 6px }
.batchnow { color: var(--brand); }
.nodraw {
  display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  min-height: 220px; padding: 20px; gap: 6px;
  border: 1px dashed var(--border); border-radius: var(--r-sm); background: var(--surface-2);
}
.nodraw .head { margin: 0; font-weight: 650; color: var(--muted) }
.nodraw p { margin: 0 }
.runline { margin: 0 }

/*
 * A4 AT ITS REAL SHAPE. The aspect ratio is the paper's own, and every ticket
 * inside is a percentage of it — so a ticket that would fall off the bottom
 * falls off the bottom here too, which is the entire reason to draw this.
 */

.setup { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border) }
.setupgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px 10px; align-items: end }
.setupgrid input[type=number] {
  min-height: 32px; padding: 3px 6px; text-align: right; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums;
}

.brows { width: 100%; border-collapse: collapse; font-size: 11px }
.brows th, .brows td { text-align: left; padding: 3px 4px 3px 0; border-bottom: 1px solid var(--border) }
.brows th { color: var(--muted); font-weight: 500; font-size: .62rem; text-transform: uppercase; letter-spacing: .05em }
.brows .r { text-align: right }
.okt { color: var(--ok) }
.badt { color: var(--bad) }
.brk { word-break: break-all; color: var(--text) }

.foot { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 14px 0 0; padding-top: 10px; border-top: 1px solid var(--border) }

@media (max-width: 720px) {
  .printroom { grid-template-columns: 1fr }
}
</style>
