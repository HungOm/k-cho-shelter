<script setup>
/**
 * The ticket itself: the picture it is printed on, and where the number goes.
 *
 * ORGANISERS AND THE SYSTEM ADMIN ONLY. Not by hiding this screen — the server
 * refuses every action here for anyone else, and registers them as writes so
 * that no permissions row can hand them to a seller. The tab is hidden as well,
 * because offering a screen that will refuse everything is unkind, but hiding
 * it is not what makes it safe.
 *
 * EASY BY DEFAULT, ADJUSTABLE THROUGHOUT. Upload a ticket and it is ready to
 * print: the measurements underneath are the CEAM artwork's own, scaled to
 * whatever was uploaded, so the common case needs nothing set. Every one of
 * them is then a field on this screen for the case that is not common.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { state, api, setConfig, toast, isAdmin } from '../lib/store.js'
import { DEFAULT_DESIGN, designFor, validateDesign } from '../lib/ticketdesign.js'
import { numberLayerSVG, qrModuleMM, placeBoth } from '../lib/ticketart.js'
import { sheetHTML } from '../lib/ticketsheet.js'
import { toPayload, reject as rejectFile } from '../lib/templatefile.js'

const templates = ref([])
const activeId = ref('')
const sizes = ref([])
const loading = ref(true)
const loadErr = ref('')

const fileInput = ref(null)
const busy = ref(false)
const uploadErr = ref('')
const uploadNote = ref('')

/* The design being edited, and the one last saved, so Undo has something to go
 * back to without another round trip. */
const design = ref(null)
const saved = ref(null)
const savingDesign = ref(false)
const showGuides = ref(true)

const active = computed(() => templates.value.find((t) => t.id === activeId.value) || null)

/* A sample that shows the real thing: this raffle's own prefix and padding, at
 * the widest digits, so the preview shows the worst case rather than a flattering one. */
const sample = computed(() => {
  const c = state.cfg || {}
  const digits = Number(c.ticketDigits ?? 5)
  return String(c.ticketPrefix ?? '') + '8'.repeat(Math.max(1, digits))
})

/*
 * Stand-ins, so the fields can be positioned before any ticket is sold.
 * Deliberately the longest plausible values rather than flattering short ones:
 * a layout that only works for "Ma Nu" is a layout that breaks in the hall.
 */
const SAMPLE_BUYER = {
  name: 'Daw Hla Myint Aung', phone: '012-555 0001',
  address: 'Klang, Selangor', seller: 'Pa Thang',
}
const showBuyer = ref(true)

const sampleBook = computed(() => {
  const c2 = state.cfg || {}
  return String(c2.bookPrefix ?? 'Book-') + '8'.repeat(Math.max(1, Number(c2.bookDigits ?? 4)))
})

const preview = computed(() => {
  if (!design.value || !active.value) return ''
  try {
    return numberLayerSVG(design.value, sample.value, {
      guides: showGuides.value,
      qrBoxes: true,
      book: sampleBook.value,
      buyer: showBuyer.value ? SAMPLE_BUYER : null,
    })
  } catch (err) {
    return `<!-- ${String(err.message)} -->`
  }
})

const problems = computed(() => (design.value ? validateDesign(design.value, active.value) : []))

/* How coarse the QR would print. This is the number that decides whether a
 * scanner will read it off paper, so it is shown rather than left implied. */
const qrDensity = computed(() => {
  if (!design.value?.qrMain?.enabled) return null
  const mm = qrModuleMM(design.value, design.value.qrMain)
  return { mm, ok: mm >= 0.3 }
})

/* What the number will actually measure once placed — the useful readout when
 * somebody is moving it, and the thing that says whether it still fits. */
const placed = computed(() => {
  if (!design.value) return null
  try {
    return placeBoth(design.value, sample.value)
  } catch {
    return null
  }
})

function adopt(r) {
  templates.value = r?.templates ?? []
  activeId.value = String(r?.active ?? '')
  sizes.value = r?.sizes ?? []
  if (r?.config) setConfig(r.config)
  const t = templates.value.find((x) => x.id === activeId.value) || null
  design.value = t ? designFor(t) : null
  saved.value = design.value ? JSON.parse(JSON.stringify(design.value)) : null
}

async function load() {
  loading.value = true
  loadErr.value = ''
  try {
    adopt(await api('list_templates', {}))
  } catch (err) {
    loadErr.value = err.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

/* Changing which artwork is active changes the design being edited, so the
 * editor follows it rather than showing the previous one's measurements. */
watch(activeId, () => {
  const t = active.value
  if (!t) { design.value = null; saved.value = null; return }
  design.value = designFor(t)
  saved.value = JSON.parse(JSON.stringify(design.value))
})

async function pickFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  uploadErr.value = ''
  uploadNote.value = ''
  const why = rejectFile(file)
  if (why) { uploadErr.value = why; return }

  busy.value = true
  try {
    const payload = await toPayload(file, sizes.value)
    uploadNote.value = payload.note || ''
    adopt(await api('upload_template', {
      data: payload.data,
      contentType: payload.contentType,
      name: file.name.replace(/\.[^.]+$/, ''),
    }))
    toast('Ticket artwork saved', 'ok')
  } catch (err) {
    uploadErr.value = err.message
    if (err.code) toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}

async function choose(id) {
  busy.value = true
  try {
    adopt(await api('set_active_template', { id }))
    toast('Tickets will print from this artwork', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}

async function remove(id) {
  busy.value = true
  try {
    adopt(await api('remove_template', { id }))
    toast('Artwork removed', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}

async function saveDesign() {
  if (!active.value || !design.value) return
  savingDesign.value = true
  try {
    // The artwork's own size is not part of the design — it is a fact about the
    // picture, added by designFor on the way in. Storing it would be a second
    // copy of something the row already knows.
    const { artwork, ...rest } = design.value
    void artwork
    adopt(await api('set_template_design', { id: active.value.id, design: rest }))
    toast('Saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    savingDesign.value = false
  }
}

function undoDesign() {
  design.value = saved.value ? JSON.parse(JSON.stringify(saved.value)) : null
}

function resetDesign() {
  if (active.value) design.value = designFor({ ...active.value, design: {} })
}

/* ---- accepted sizes ---- */

const sizeErr = ref('')

function addSize() {
  sizes.value = [...sizes.value, {
    id: '', label: 'New size', widthMM: 190, heightMM: 61.39, tolerance: 0.02, minWidthPx: 1600,
  }]
}

async function saveSizes() {
  sizeErr.value = ''
  busy.value = true
  try {
    adopt(await api('set_ticket_sizes', { sizes: sizes.value }))
    toast('Accepted sizes saved', 'ok')
  } catch (err) {
    sizeErr.value = err.message
    if (err.code) toast(err.message, 'bad', err.code)
  } finally {
    busy.value = false
  }
}

/* ---- the test page ---- */

/*
 * Prints through the same path a real book will: the sheet builder, the print
 * stylesheet, and the browser's own dialog. No library, no server — the same
 * way the handover receipt has always printed.
 */
function printTest() {
  if (!design.value || !active.value) return
  const c = state.cfg || {}
  const prefix = String(c.ticketPrefix ?? '')
  const digits = Number(c.ticketDigits ?? 5)
  const numbers = [1, 2, 3, 4].map((n) => prefix + String(n).padStart(digits, '0'))
  const html = sheetHTML(design.value, numbers, active.value.url, {
    title: 'Ticket design — test page (not real tickets)',
  })
  const w = window.open('', '_blank')
  if (!w) { toast('Allow pop-ups to print a test page', 'bad'); return }
  w.document.write(html)
  w.document.close()
}

const kb = (n) => (n >= 1024 * 1024
  ? `${Math.round(n / 1024 / 1024 * 10) / 10} MB`
  : `${Math.round(n / 1024)} KB`)
</script>

<template>
  <section v-if="!isAdmin" class="card">
    <h3>Ticket design</h3>
    <p class="muted">This is an organiser's screen.</p>
  </section>

  <section v-else class="screen">
    <header class="head">
      <h2>Ticket design</h2>
      <p class="muted small">
        The picture your tickets are printed on, and where the number sits on it.
        Upload a ticket and it is ready to print — everything below is here for when
        the standard placement is not right.
      </p>
    </header>

    <p v-if="loadErr" class="note bad">{{ loadErr }}</p>
    <p v-else-if="loading" class="muted">Loading&hellip;</p>

    <template v-else>
      <!-- ---------- the artwork ---------- -->
      <div class="card">
        <h3>The artwork</h3>
        <p class="muted small">
          A picture of one blank ticket, including the stub. PNG, JPEG or WebP.
          About {{ 2244 }} pixels wide prints sharply at 190&nbsp;mm; a larger file is
          re-saved on this device before it is sent.
        </p>

        <div class="row wrap gap" style="margin-top:12px">
          <button class="btn sm primary" :disabled="busy" @click="fileInput?.click()">
            {{ busy ? 'Working…' : (templates.length ? 'Upload another' : 'Upload the ticket artwork') }}
          </button>
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp"
                 :disabled="busy" @change="pickFile" hidden>
        </div>

        <p v-if="uploadErr" class="note bad tiny" style="margin-top:10px">{{ uploadErr }}</p>
        <p v-if="uploadNote" class="note tiny" style="margin-top:10px">{{ uploadNote }}</p>

        <p v-if="!templates.length" class="muted small" style="margin-top:12px">
          Nothing uploaded yet, so tickets cannot be printed.
        </p>

        <table v-else class="rows" style="margin-top:14px">
          <thead>
            <tr><th>Name</th><th>Size</th><th>File</th><th>Uploaded</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="t in templates" :key="t.id" :class="{ on: t.id === activeId }">
              <td>
                {{ t.name }}
                <span v-if="t.id === activeId" class="pill ok">printing from this</span>
              </td>
              <td class="n">{{ t.width }} &times; {{ t.height }}</td>
              <td class="n">{{ kb(t.bytes) }}</td>
              <td class="n">{{ t.uploadedAt ? String(t.uploadedAt).slice(0, 10) : '' }}</td>
              <td class="right">
                <button v-if="t.id !== activeId" class="btn sm" :disabled="busy"
                        @click="choose(t.id)">Use this one</button>
                <button class="btn sm ghost" :disabled="busy" @click="remove(t.id)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ---------- accepted sizes ---------- -->
      <div class="card">
        <h3>Accepted sizes</h3>
        <p class="muted small">
          The shapes of paper this raffle prints. An upload that is not one of these
          is refused &mdash; a picture of the wrong shape is either stretched or cropped
          on every ticket, and neither can be put right afterwards.
          The tolerance is how far the shape may be out, as a fraction: 0.02 allows two per cent.
        </p>
        <table class="rows" style="margin-top:12px">
          <thead>
            <tr><th>Name</th><th>Width mm</th><th>Height mm</th><th>Tolerance</th><th>Least pixels wide</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in sizes" :key="i">
              <td><input v-model="s.label" style="max-width:160px" aria-label="Size name"></td>
              <td><input v-model.number="s.widthMM" type="number" step="0.01" style="max-width:90px" aria-label="Width in millimetres"></td>
              <td><input v-model.number="s.heightMM" type="number" step="0.01" style="max-width:90px" aria-label="Height in millimetres"></td>
              <td><input v-model.number="s.tolerance" type="number" step="0.005" style="max-width:90px" aria-label="Tolerance"></td>
              <td><input v-model.number="s.minWidthPx" type="number" step="10" style="max-width:110px" aria-label="Least pixels wide"></td>
              <td class="right">
                <button class="btn sm ghost" @click="sizes = sizes.filter((_, k) => k !== i)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="sizeErr" class="note bad tiny" style="margin-top:10px">{{ sizeErr }}</p>
        <div class="sub">
          <span class="muted small grow">Removing all of them restores the standard list.</span>
          <button class="btn sm" @click="addSize">Add a size</button>
          <button class="btn sm primary" :disabled="busy" @click="saveSizes">Save sizes</button>
        </div>
      </div>

      <template v-if="active && design">
        <!-- ---------- the preview ---------- -->
        <div class="card">
          <h3>How it will look</h3>
          <p class="muted small">
            The number shown is this raffle&rsquo;s own prefix at its widest &mdash;
            {{ sample }} &mdash; so what you see is the worst case, not a flattering one.
          </p>
          <div class="ticketpreview" style="margin-top:12px">
            <img :src="active.url" alt="" >
            <div class="overlay" v-html="preview"></div>
          </div>
          <div class="sub">
            <label class="check">
              <input v-model="showGuides" type="checkbox"> Show the measuring guides
            </label>
            <span class="grow"></span>
            <button class="btn sm" @click="printTest">Print a test page</button>
          </div>
          <p v-if="problems.length" class="note bad tiny" style="margin-top:10px">
            <span v-for="(p, i) in problems" :key="i">{{ p }}<br></span>
          </p>
        </div>

        <!-- ---------- where the number goes ---------- -->
        <div class="card">
          <h3>Where the number goes</h3>
          <p class="muted small">
            Measured in the picture&rsquo;s own pixels, from its top-left corner.
            <b>Baseline</b> is the line the digits sit on &mdash; the same line the printed
            &ldquo;TICKET NO:&rdquo; sits on. <b>Starts after</b> is the last pixel of the printed
            label, so the number begins just past it. <b>Must stop before</b> is whatever it
            must not run into, usually a logo.
          </p>

          <div v-for="half in ['main', 'stub']" :key="half" class="halfblock">
            <h4>{{ half === 'main' ? "The buyer's half" : 'The stub' }}</h4>
            <div class="grid">
              <label>Starts after
                <input v-model.number="design[half].label.right" type="number" step="1"></label>
              <label>Baseline
                <input v-model.number="design[half].label.baseline" type="number" step="1"></label>
              <label>Height of the digits
                <input v-model.number="design[half].capHeight" type="number" step="1"></label>
              <label>Must stop before
                <input v-model.number="design[half].clearRight" type="number" step="1"></label>
              <label>Size against the label
                <input v-model.number="design[half].scale" type="number" step="0.05" min="0.2"></label>
              <label>Colour
                <input v-model="design[half].ink" type="text" spellcheck="false"></label>
            </div>
            <p v-if="placed" class="tiny muted">
              {{ sample }} measures {{ Math.round(placed[half].width) }} px and ends at
              {{ Math.round(placed[half].right) }};
              <template v-if="placed[half].shrunk">
                it did not fit, so it was reduced to {{ placed[half].appliedScale.toFixed(2) }}&times;.
              </template>
              <template v-else>
                {{ Math.round(placed[half].limit - placed[half].right) }} px to spare.
              </template>
            </p>
          </div>
        </div>

        <!-- ---------- the book number ---------- -->
        <div class="card">
          <h3>The book number</h3>
          <p class="muted small">
            Which book a ticket came out of, printed beside its number. The ticket number
            identifies the ticket; the book is what somebody is holding when stubs come
            back. It is placed after the number, so a longer number pushes it along
            rather than being printed over.
          </p>
          <div v-for="half in ['main', 'stub']" :key="'bk' + half" class="halfblock">
            <h4>{{ half === 'main' ? "The buyer's half" : 'The stub' }}</h4>
            <label class="check">
              <input v-model="design.book[half].enabled" type="checkbox"> Print the book number here
            </label>
            <div v-if="design.book[half].enabled" class="grid">
              <label>Height<input v-model.number="design.book[half].capHeight" type="number" step="1"></label>
              <label v-if="!design.book[half].below">Gap after the number
                <input v-model.number="design.book[half].gap" type="number" step="0.1"></label>
              <label v-else>Drop below the number
                <input v-model.number="design.book[half].drop" type="number" step="0.05"></label>
              <label>Colour<input v-model="design.book[half].ink" type="text" spellcheck="false"></label>
              <label class="check" style="align-self:end">
                <input v-model="design.book[half].below" type="checkbox"> On its own line underneath
              </label>
            </div>
          </div>
        </div>

        <!-- ---------- the buyer's details ---------- -->
        <div class="card">
          <h3>The buyer&rsquo;s details</h3>
          <p class="muted small">
            The stub is printed with four ruled lines and a caption beside each. For a
            ticket already recorded as sold, these can be filled in when it is printed
            instead of copied out by hand. <b>Blank tickets going out to a seller always
            print blank lines</b> &mdash; the printing screen asks separately, each time.
          </p>
          <label class="check" style="margin-top:8px">
            <input v-model="design.buyer.enabled" type="checkbox"> Allow the stub to be filled in
          </label>
          <label class="check">
            <input v-model="showBuyer" type="checkbox"> Show a sample in the preview above
          </label>

          <template v-if="design.buyer.enabled">
            <div v-for="(f, key) in design.buyer.fields" :key="key" class="halfblock">
              <h4>{{ key }}</h4>
              <label class="check">
                <input v-model="f.enabled" type="checkbox"> Print this one
              </label>
              <div v-if="f.enabled" class="grid">
                <label>Starts at<input v-model.number="f.x" type="number" step="1"></label>
                <label>Sits on<input v-model.number="f.baseline" type="number" step="1"></label>
                <label>Height<input v-model.number="f.capHeight" type="number" step="1"></label>
                <label>Stops before<input v-model.number="f.maxRight" type="number" step="1"></label>
                <label>Colour<input v-model="f.ink" type="text" spellcheck="false"></label>
              </div>
            </div>
          </template>
        </div>

        <!-- ---------- the QR ---------- -->
        <div class="card">
          <h3>The QR code</h3>
          <p class="muted small">
            Where the code that proves a ticket is genuine will be printed. The box is
            positioned now; the codes themselves are not part of this step, so the
            preview shows the space rather than a scannable code.
          </p>
          <div v-for="[name, box] in [['On the buyer’s half', design.qrMain], ['On the stub', design.qrStub]]"
               :key="name" class="halfblock">
            <h4>{{ name }}</h4>
            <label class="check"><input v-model="box.enabled" type="checkbox"> Print a QR here</label>
            <div v-if="box.enabled" class="grid">
              <label>Across<input v-model.number="box.x" type="number" step="1"></label>
              <label>Down<input v-model.number="box.y" type="number" step="1"></label>
              <label>Size<input v-model.number="box.size" type="number" step="1"></label>
              <label class="check" style="align-self:end">
                <input v-model="box.backing" type="checkbox"> White behind it
              </label>
            </div>
          </div>
          <p v-if="qrDensity" class="tiny" :class="qrDensity.ok ? 'muted' : 'bad'">
            At {{ design.sheet.widthMM }} mm wide, each square of the code prints
            {{ qrDensity.mm.toFixed(2) }} mm across.
            <template v-if="!qrDensity.ok">
              That is small enough that some phones will struggle &mdash; make the box
              bigger, or print the ticket larger.
            </template>
            <template v-else>That reads reliably.</template>
          </p>
        </div>

        <!-- ---------- printing ---------- -->
        <div class="card">
          <h3>Printing</h3>
          <div class="grid">
            <label>Ticket width, mm
              <input v-model.number="design.sheet.widthMM" type="number" step="1"></label>
            <label>Tickets to a page
              <input v-model.number="design.sheet.perPage" type="number" step="1" min="1"></label>
            <label>Gap between, mm
              <input v-model.number="design.sheet.gapMM" type="number" step="1"></label>
            <label>Page margin, mm
              <input v-model.number="design.sheet.marginMM" type="number" step="1"></label>
            <label class="check" style="align-self:end">
              <input v-model="design.sheet.cutlines" type="checkbox"> Dashed line to cut along
            </label>
          </div>
          <p class="tiny muted">
            At {{ design.sheet.widthMM }} mm the ticket is
            {{ (design.sheet.widthMM * (active.height / active.width)).toFixed(1) }} mm tall,
            which is the artwork&rsquo;s own shape. Print at 100% scale with background
            graphics turned on.
          </p>
        </div>

        <div class="card sticky">
          <div class="sub">
            <span class="muted small grow">
              Changes are previewed at once and saved when you say so.
            </span>
            <button class="btn sm ghost" @click="resetDesign">Back to standard</button>
            <button class="btn sm ghost" :disabled="savingDesign" @click="undoDesign">Undo</button>
            <button class="btn sm primary" :disabled="savingDesign || problems.length"
                    @click="saveDesign">{{ savingDesign ? 'Saving…' : 'Save the design' }}</button>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.head { margin-bottom: 14px }
.halfblock { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line, #e3e3e8) }
.halfblock h4 { margin: 0 0 8px; font-size: 14px }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 14px }
.grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted, #6b6b74) }
.grid input[type=number], .grid input[type=text] { width: 100% }
.check { display: flex; align-items: center; gap: 7px; font-size: 13px }
.ticketpreview { position: relative; width: 100%; overflow: hidden; border: 1px solid var(--line, #e3e3e8); border-radius: 6px }
.ticketpreview img { display: block; width: 100%; height: auto }
.ticketpreview .overlay { position: absolute; inset: 0 }
.ticketpreview .overlay :deep(svg) { width: 100%; height: 100%; display: block }
.rows { width: 100%; border-collapse: collapse; font-size: 13px }
.rows th, .rows td { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line, #e3e3e8) }
.rows th { color: var(--muted, #6b6b74); font-weight: 500 }
.rows td.n, .rows th.n { font-variant-numeric: tabular-nums }
.rows .right { text-align: right; white-space: nowrap }
.rows tr.on td { background: var(--brand-soft, #f2f8f6) }
.sticky { position: sticky; bottom: 8px }
</style>
