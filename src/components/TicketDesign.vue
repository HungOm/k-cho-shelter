<script setup>
/**
 * THE TICKET DESIGNER. The template is the subject; everything else is a tab.
 *
 * ORGANISERS AND THE SYSTEM ADMIN ONLY. Not by hiding this screen — the server
 * refuses every action here for anyone else, and registers them as writes so
 * that no permissions row can hand them to a seller. The tab is hidden as well,
 * because offering a screen that will refuse everything is unkind, but hiding
 * it is not what makes it safe.
 *
 * WHAT CHANGED, AND WHY IT IS THE WHOLE SCREEN.
 *
 * This was eight stacked cards of measurements for six things the system had
 * named: two ticket numbers, two book numbers, four buyer lines, two QR boxes.
 * An organiser who wanted the price on the ticket had nowhere to put it, and
 * one who wanted to move the buyer's name had to find the right card among a
 * couple of thousand pixels of scrolling and type a coordinate into it.
 *
 * Now the design is a LIST OF ELEMENTS — see src/lib/ticketelements.js — and
 * this screen is the three things you do with one: put something on the ticket
 * (the rail), move it (the canvas), and say how it should look (the panel).
 * Nothing on the ticket is privileged and nothing is required.
 *
 * THE THREE TABS ARE THREE JOBS, not three groups of settings. Place is where
 * the work happens and is where you land. Artwork & paper is the picture
 * underneath and the shapes this raffle will accept — touched once per artwork.
 * Print sheet is how it is laid out on A4 — touched once per printer. Putting
 * all three in one column is what made the old screen a settings page with a
 * thumbnail in it.
 *
 * DENSITY OVER TAP SIZE, DELIBERATELY. --tap is 52px because a seller presses
 * buttons one-handed in a car park. This screen is an organiser at a desk
 * placing print artwork to the pixel; a 52px target would cover the thing being
 * positioned. The visible handles are small and their hit areas are generous.
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { state, api, setConfig, toast, isAdmin, setFocus, go } from '../lib/store.js'
import { designFor, validateDesign, stubShare } from '../lib/ticketdesign.js'
import {
  elementLayerSVG, placeElements, qrModuleMM, ticketVerifyUrl,
} from '../lib/ticketart.js'
import {
  SOURCES, SOURCE, OVERFLOW, ALIGN, FAMILIES, lockAxis, keepRatio, nameOf, normalElement, nextId, legacyFromElements,
} from '../lib/ticketelements.js'
import { encode } from '../lib/qrcodegen.js'
import { sheetHTML, pageFit } from '../lib/ticketsheet.js'
import { toPayload, reject as rejectFile } from '../lib/templatefile.js'
import { blankArtboardFile } from '../lib/blankticket.js'
import Dim from './ui/Dim.vue'
import SheetTab from './ticketdesign/SheetTab.vue'
import ShapesPanel from './ticketdesign/ShapesPanel.vue'
import TemplateRail from './ticketdesign/TemplateRail.vue'
import ArtworkVerdict from './ticketdesign/ArtworkVerdict.vue'
import Inspector from './ticketdesign/Inspector.vue'
import Ink from './ui/Ink.vue'
import Icon from './ui/Icon.vue'
import { paletteOf, inkDesign, usable } from '../lib/artworkpalette.js'
/* Across into the check page's own folder on purpose: the sample book and the
 * page that answers a sample QR have to agree, and that page may not import
 * from lib/. See src/verify/sample.js. */
import { sampleBook, sampleVerifyUrl } from '../verify/sample.js'

const templates = ref([])
const activeId = ref('')
const sizes = ref([])
const loading = ref(true)
const loadErr = ref('')

const busy = ref(false)
const uploadErr = ref('')
const uploadNote = ref('')

const design = ref(null)
const saved = ref(null)
const savingDesign = ref(false)

const TABS = [
  { id: 'place', name: 'Place' },
  { id: 'artwork', name: 'Artwork & paper' },
  { id: 'sheet', name: 'Print sheet' },
]
const tab = ref('place')

const active = computed(() => templates.value.find((t) => t.id === activeId.value) || null)
const elements = computed(() => design.value?.elements ?? [])

/* ---------- what a ticket would actually say ---------- */

/*
 * THE WORST CASE, NOT A FLATTERING ONE.
 *
 * Every sample here is the longest plausible value rather than a short one. A
 * layout that only works for "Ma Nu" is a layout that breaks in the hall, and
 * the whole reason to look at a preview is to find that out before the press
 * run rather than after it.
 */
const LONG = {
  'buyer.name': 'Daw Hla Myint Aung',
  'buyer.phone': '012-345 6789',
  'buyer.address': 'Kajang, Selangor',
  seller: 'Pa Thang',
}
const TYPICAL = {
  'buyer.name': 'Ma Nu',
  'buyer.phone': '012-345 6789',
  'buyer.address': 'Kajang',
  seller: 'Pa Thang',
}
const showLongest = ref(true)

const sampleValues = computed(() => {
  const c = state.cfg || {}
  const digits = Math.max(1, Number(c.ticketDigits ?? 5))
  const bookDigits = Math.max(1, Number(c.bookDigits ?? 3))
  const from = showLongest.value ? LONG : TYPICAL
  return {
    'ticket.number': String(c.ticketPrefix ?? '') + '8'.repeat(digits),
    'book.number': String(c.bookPrefix ?? 'Book-') + '8'.repeat(bookDigits),
    price: `${c.currency ?? 'RM'} ${Number(c.ticketPrice ?? 10)}`,
    'sold.on': '14 Sep 2026',
    'draw.on': c.drawDate ? String(c.drawDate).slice(0, 10) : '31 Dec 2026',
    code: 'SAMPLE0CODE0',
    ...from,
  }
})

/* The number a reader recognises, shown in the rail's header line. */
const sampleNumber = computed(() => sampleValues.value['ticket.number'])

const realQr = ref(true)
const showGuides = ref(false)
const showAllBoxes = ref(true)
const snapping = ref(true)

const sampleVerifyBase = computed(() => {
  const set = String(state.cfg?.verifyUrl || '').trim()
  return set || ((typeof location === 'undefined' ? '' : location.origin) + '/v')
})

const preview = computed(() => {
  if (!design.value || !active.value) return ''
  try {
    return elementLayerSVG(design.value, sampleValues.value, {
      guides: showGuides.value,
      qrBoxes: !realQr.value,
      qrUrl: realQr.value
        ? ticketVerifyUrl(sampleVerifyBase.value, sampleNumber.value, 'SAMPLE0CODE0')
        : '',
      encode: realQr.value ? encode : undefined,
    })
  } catch (err) {
    return `<!-- ${String(err.message)} -->`
  }
})

/* Where everything actually landed, so the panel can report on the selected
 * one rather than recomputing its own version of the same arithmetic. */
const placements = computed(() => {
  if (!design.value) return []
  try {
    return placeElements(design.value, sampleValues.value)
  } catch {
    return []
  }
})

const problems = computed(() => (design.value ? validateDesign(design.value, active.value) : []))

/* ---------- the element list ---------- */

const sel = ref('')
const chosen = computed(() => elements.value.find((e) => e.id === sel.value) || null)
const placedById = computed(() => Object.fromEntries(placements.value.map((p) => [p.id, p])))
const chosenPlaced = computed(() => placedById.value[sel.value] || null)

/*
 * A VALUE THAT WILL NOT FIT IS MARKED WHERE THE LIST IS, not only in the panel.
 *
 * The panel describes one element and has to be scrolled to reach its fit
 * report, so an organiser who never selects the buyer's name never learns that
 * every long one is being shrunk. The list is on screen the whole time, so the
 * warning belongs there too — the panel then explains what the marker means.
 */
function trouble(el) {
  const p = placedById.value[el.id]
  if (!p || p.kind === 'code' || el.enabled === false) return ''
  if (!p.fits) return 'runs past its box'
  if (p.shrunk) return 'too long, so it is being shrunk'
  return ''
}

/** What an element is called on screen. Never its id, never a model key. */

const TAG = { field: 'FLD', code: 'QR', text: 'TXT' }

/*
 * Which side of the perforation something is on.
 *
 * Derived from where the box actually is rather than stored, because an
 * organiser who drags an element across the stub line has plainly moved it to
 * the other half and should not then have to say so in a second control.
 */
function sideOf(el) {
  const at = stubShare(design.value)
  return el.box.left + el.box.width / 2 >= at ? 'stub' : 'half'
}

/*
 * The rail's two groups. `sideOf` already decides which half a box is on — it
 * asks where the box's CENTRE falls against the stub line — so this is only
 * that answer, collected. Order within a group is left exactly as it is; the
 * grouping must not become a reordering.
 */
const HALVES = [
  { k: 'half', t: 'Main half' },
  { k: 'stub', t: 'Stub' },
]
const byHalf = computed(() => {
  const out = { half: [], stub: [] }
  for (const el of elements.value) out[sideOf(el)].push(el)
  return out
})

function pick(id) {
  sel.value = id
  /* Selecting from the rail should show the thing selected, not leave it
   * somewhere off the side of a zoomed canvas. */
  nextTick(scrollSelectionIntoView)
}

/*
 * ADDING SOMETHING: pick what, then draw where.
 *
 * Two steps rather than one because the alternative is dropping a box in the
 * middle of the ticket and making somebody drag it off whatever it landed on.
 * `pending` is the kind waiting for a box to be drawn for it; the canvas shows
 * a crosshair while it is set.
 */
const pending = ref('')

function beginAdd(kind) {
  pending.value = pending.value === kind ? '' : kind
  sel.value = ''
}

/* A sensible default for a new element: the ink of whatever is already on this
 * side of the perforation, so a raffle's second element matches its first
 * without being told to. Printing in a colour nobody chose is how a new element
 * ends up invisible on a dark green field. */
function inkNear(side) {
  const near = elements.value.find((e) => e.kind !== 'code' && sideOf(e) === side)
  return near?.ink || elements.value.find((e) => e.kind !== 'code')?.ink || '#000000'
}

function addElementAt(kind, box) {
  const side = box.left + box.width / 2 >= stubShare(design.value) ? 'stub' : 'half'
  const el = normalElement({
    id: nextId(),
    kind,
    source: kind === 'field' ? 'price' : '',
    text: kind === 'text' ? 'Thank you' : '',
    half: side === 'stub' ? 'stub' : 'main',
    box,
    ink: kind === 'code' ? '#000000' : inkNear(side),
    overflow: 'shrink',
  })
  design.value.elements = [...elements.value, el]
  sel.value = el.id
  pending.value = ''
}

function removeElement(id) {
  mark()
  design.value.elements = elements.value.filter((e) => e.id !== id)
  /* Anything that was flowing after it has lost its anchor. Detaching it is
   * better than leaving a design that validateElements will refuse to save. */
  for (const e of design.value.elements) if (e.after === id) e.after = ''
  if (sel.value === id) sel.value = ''
}

/* ---------- the canvas: zoom, drag, snap ---------- */

const stage = ref(null)
const frame = ref(null)
const zoom = ref(0.5)
const ZOOMS = [0.25, 0.33, 0.5, 0.75, 1, 1.5, 2]

/* The artwork's own pixels, times the zoom. "49%" means half actual size, which
 * is the only reading of a zoom percentage that means anything when the whole
 * job is placing things on a raster. */
const frameWidth = computed(() => Math.round((design.value?.artwork?.width ?? 1600) * zoom.value))

function stepZoom(dir) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6)
  const next = dir > 0 ? ZOOMS[Math.min(ZOOMS.length - 1, i + 1)] : ZOOMS[Math.max(0, i - 1)]
  zoom.value = next
}

/*
 * THE FIT MEASURES THE CANVAS, AND THE CANVAS IS ONLY ON THE PLACE TAB.
 *
 * Artwork is uploaded from Artwork & paper, and with none uploaded the screen
 * opens there deliberately — so all three calls to this (mounted, switching
 * template, finishing an upload) ran while `stage` was unrendered, returned
 * on the first line, and left the zoom set for the artwork before this one.
 * Remembering what the zoom was last fitted to lets the fit happen when the
 * canvas actually appears, and stops it overriding a zoom somebody chose.
 */
const fittedTo = ref('')

function fitToWidth() {
  const el = stage.value
  const aw = design.value?.artwork?.width || 0
  if (!el || !aw) return
  /* 32px of breathing room, so the ticket is not jammed against the scroller. */
  zoom.value = Math.max(0.05, (el.clientWidth - 32) / aw)
  fittedTo.value = activeId.value
}

watch(tab, (t) => {
  if (t === 'place' && fittedTo.value !== activeId.value) nextTick(fitToWidth)
})

function scrollSelectionIntoView() {
  const p = chosenPlaced.value
  const el = stage.value
  if (!p || !el) return
  const x = p.box.x * zoom.value
  if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
  }
}

/*
 * A drag in screen pixels is a drag in shares of the artwork. Dividing by the
 * rendered size rather than by the zoom means the same gesture means the same
 * distance whether the canvas is fitted, zoomed, or on a narrow window.
 */
function perShare() {
  const el = frame.value
  return {
    x: el?.clientWidth || 1,
    y: el?.clientHeight || 1,
  }
}

const drag = ref(null)

/*
 * SNAPPING TO WHAT IS ALREADY THERE.
 *
 * Tickets are printed matter and printed matter is aligned: the buyer's four
 * ruled lines share a left edge, and the two halves' numbers share a baseline.
 * Getting that by eye at 49% zoom is not possible, and getting it by typing is
 * the thing this screen exists to stop being mandatory. The threshold is in
 * shares so it is the same distance on the ticket at any zoom.
 */
const SNAP = 0.004

function snapTo(value, candidates) {
  if (!snapping.value) return value
  let best = value
  let dist = SNAP
  for (const c of candidates) {
    const d = Math.abs(c - value)
    if (d < dist) { dist = d; best = c }
  }
  return best
}

function edgesExcept(id) {
  const xs = []
  const ys = []
  for (const e of elements.value) {
    if (e.id === id) continue
    xs.push(e.box.left, e.box.left + e.box.width)
    ys.push(e.box.top, e.box.top + e.box.height)
  }
  xs.push(0, 1, stubShare(design.value))
  ys.push(0, 1)
  return { xs, ys }
}

function startMove(el, ev) {
  if (el.enabled === false) return
  ev.stopPropagation()
  mark()
  sel.value = el.id
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'move', id: el.id, px: ev.clientX, py: ev.clientY, box: { ...el.box } }
}

function startResize(el, corner, ev) {
  ev.stopPropagation()
  mark()
  sel.value = el.id
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'resize', corner, id: el.id, px: ev.clientX, py: ev.clientY, box: { ...el.box } }
}

/* Drawing a brand new box, from the corner the pointer went down on. */
function startDraw(ev) {
  if (!pending.value || !frame.value) return
  const r = frame.value.getBoundingClientRect()
  const left = (ev.clientX - r.left) / r.width
  const top = (ev.clientY - r.top) / r.height
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'draw', px: ev.clientX, py: ev.clientY, origin: { left, top }, box: { left, top, width: 0, height: 0 } }
}

const drawn = ref(null)

function onPointerMove(ev) {
  const st = drag.value
  if (!st) return
  const span = perShare()
  /*
   * SHIFT MEANS "I MEANT THIS EXACTLY". A box is nearly always meant level
   * with something — a line of type, the box above it, the stub edge — and a
   * drag on a preview at 15% puts a serial number a third of a millimetre out
   * of true: invisible here, obvious on a sheet of forty.
   */
  const [dx, dy] = ev.shiftKey
    ? lockAxis((ev.clientX - st.px) / span.x, (ev.clientY - st.py) / span.y)
    : [(ev.clientX - st.px) / span.x, (ev.clientY - st.py) / span.y]

  if (st.mode === 'draw') {
    const r = frame.value.getBoundingClientRect()
    const x = (ev.clientX - r.left) / r.width
    const y = (ev.clientY - r.top) / r.height
    drawn.value = {
      left: Math.min(st.origin.left, x),
      top: Math.min(st.origin.top, y),
      width: Math.abs(x - st.origin.left),
      height: Math.abs(y - st.origin.top),
    }
    return
  }

  if (st.mode === 'stub') {
    const r = frame.value.getBoundingClientRect()
    const at = (ev.clientX - r.left) / r.width
    design.value.stubAt = Math.max(0.05, Math.min(0.95, Math.round(at * 1e4) / 1e4))
    return
  }

  const el = elements.value.find((e) => e.id === st.id)
  if (!el) return
  const { xs, ys } = edgesExcept(st.id)

  if (st.mode === 'move') {
    const left = snapTo(st.box.left + dx, xs)
    const top = snapTo(st.box.top + dy, ys)
    /* Snapping the trailing edge too, so a box lines up on whichever of its
     * sides is nearest something — the left edge is not privileged. */
    const right = snapTo(st.box.left + dx + st.box.width, xs) - st.box.width
    const bottom = snapTo(st.box.top + dy + st.box.height, ys) - st.box.height
    el.box.left = Math.abs(left - (st.box.left + dx)) <= Math.abs(right - (st.box.left + dx)) ? left : right
    el.box.top = Math.abs(top - (st.box.top + dy)) <= Math.abs(bottom - (st.box.top + dy)) ? top : bottom
    return
  }

  if (st.mode === 'resize') {
    const c = st.corner
    /* Shift on a corner keeps the shape it already had. Width leads, because
     * these boxes are wider than they are tall and width is what is being
     * dragged. */
    if (ev.shiftKey && (c.includes('e') || c.includes('w'))) {
      const width = c.includes('e')
        ? Math.max(0.002, st.box.width + dx)
        : Math.max(0.002, st.box.width - dx)
      const kept = keepRatio(st.box, width, el.box.height)
      if (c.includes('w')) el.box.left = st.box.left + st.box.width - kept.width
      if (c.includes('n')) el.box.top = st.box.top + st.box.height - kept.height
      el.box.width = kept.width
      el.box.height = kept.height
      return
    }
    if (c.includes('e')) el.box.width = Math.max(0.002, snapTo(st.box.left + st.box.width + dx, xs) - st.box.left)
    if (c.includes('s')) el.box.height = Math.max(0.002, snapTo(st.box.top + st.box.height + dy, ys) - st.box.top)
    if (c.includes('w')) {
      const left = snapTo(st.box.left + dx, xs)
      const right = st.box.left + st.box.width
      el.box.left = Math.min(left, right - 0.002)
      el.box.width = right - el.box.left
    }
    if (c.includes('n')) {
      const top = snapTo(st.box.top + dy, ys)
      const bottom = st.box.top + st.box.height
      el.box.top = Math.min(top, bottom - 0.002)
      el.box.height = bottom - el.box.top
    }
  }
}

function endPointer() {
  const st = drag.value
  if (st?.mode === 'draw' && drawn.value) {
    const b = drawn.value
    /* A click rather than a drag means no box was drawn. Rather than making a
     * zero-sized element nobody can see or grab, give it a sensible default
     * size at the point that was clicked. */
    const box = b.width < 0.005 || b.height < 0.004
      ? { left: b.left, top: b.top, width: 0.14, height: 0.03 }
      : b
    addElementAt(pending.value, box)
  }
  drag.value = null
  drawn.value = null
}

function startStubDrag(ev) {
  ev.stopPropagation()
  mark()
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'stub', px: ev.clientX, py: ev.clientY }
}

/* Arrow keys nudge by a tenth of a per cent, Shift by one. Both are in shares,
 * so a nudge is the same distance on the ticket whatever the zoom. */
function onKey(ev) {
  const el = chosen.value
  if (!el) return
  const step = ev.shiftKey ? 0.01 : 0.001
  const map = {
    ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
  }
  const d = map[ev.key]
  if (!d) return
  ev.preventDefault()
  el.box.left = Math.max(0, Math.min(1 - el.box.width, el.box.left + d[0]))
  el.box.top = Math.max(0, Math.min(1 - el.box.height, el.box.top + d[1]))
}

/* ---------- readouts ---------- */

const pc = (v) => `${(Number(v) * 100).toFixed(1)}%`

/* A share is what is stored; a pixel is what an organiser can check against the
 * file they exported. Both, always — a share on its own is unverifiable. */
const inPixels = computed(() => {
  const el = chosen.value
  const a = design.value?.artwork
  if (!el || !a) return null
  return {
    x: Math.round(el.box.left * a.width),
    y: Math.round(el.box.top * a.height),
    w: Math.round(el.box.width * a.width),
    h: Math.round(el.box.height * a.height),
  }
})

const mmPer = computed(() => {
  const w = Number(design.value?.artwork?.width ?? 0)
  const mm = Number(design.value?.sheet?.widthMM ?? 0)
  return w && mm ? mm / w : 0
})

/*
 * HOW SHARPLY THIS WILL ACTUALLY PRINT. The artwork is a picture of a fixed
 * pixel width printed at a fixed width in millimetres, so the resolution it
 * lands at is decided and knowable. Three hundred is the usual floor for print,
 * 200 is visibly soft at arm's length, and the accepted-size rule lets 1600 px
 * through, which at 190 mm is 214.
 */
const dpi = computed(() => {
  const px = Number(active.value?.width ?? 0)
  const mm = Number(design.value?.sheet?.widthMM ?? 0)
  if (!px || !mm) return null
  const v = Math.round(px / (mm / 25.4))
  return { v, ok: v >= 300, soft: v < 200 }
})

/* How the ticket lands on A4 — derived, never stored. See pageFit. */
const fit = computed(() => (design.value ? pageFit(design.value) : null))

const qrDensity = computed(() => {
  const code = elements.value.find((e) => e.kind === 'code' && e.enabled !== false)
  if (!code || !design.value) return null
  const a = design.value.artwork
  const mm = qrModuleMM(design.value, { size: Math.min(code.box.width * a.width, code.box.height * a.height) })
  return { mm, ok: mm >= 0.3 }
})

/*
 * WHAT HAPPENS TO THE LONGEST VALUE.
 *
 * The one question a box for a buyer's name actually raises. Reported from the
 * real placement rather than estimated: whether it fitted, and if it had to be
 * shrunk, the size it ended up at in printed pixels.
 *
 * It is honest about what it does not know. The app has no reading of every
 * name on the register from this screen, so this is the longest name the
 * DESIGNER knows, not the longest one sold — and it says so rather than
 * implying a survey it did not do.
 */
const fitReport = computed(() => {
  const p = chosenPlaced.value
  const el = chosen.value
  if (!p || !el || p.kind === 'code') return null
  if (!p.measured) {
    return {
      tone: 'info',
      head: 'This one cannot be measured here',
      body: `${p.text} is drawn in ${FAMILIES.find((f) => f.id === 'text').name}, whose widths the `
        + 'browser decides. It will be laid out correctly and it cannot be shrunk to fit, so leave '
        + 'the box wider than it looks like it needs.',
    }
  }
  const chars = [...p.text].length
  const px = Math.round(p.fontSize * 0.676)
  if (p.shrunk) {
    return {
      tone: 'warn',
      head: 'It does not fit, so it is being shrunk',
      body: `${p.text} — ${chars} characters, shrunk to ${px} px inside the box. `
        + 'Widen the box, or accept smaller lettering on the tickets that need it.',
    }
  }
  const spare = Math.round(((p.limit - p.right) / Math.max(1, p.box.w)) * 100)
  return {
    tone: 'ok',
    head: 'The longest value still fits',
    body: `${p.text} — ${chars} characters at ${px} px, with ${spare}% of the box to spare.`,
  }
})

/* ---------- loading, saving, dirty ---------- */

function adopt(r) {
  templates.value = r?.templates ?? []
  activeId.value = String(r?.active ?? '')
  sizes.value = r?.sizes ?? []
  if (r?.config) setConfig(r.config)
  const t = templates.value.find((x) => x.id === activeId.value) || null
  /*
   * WITH NO ARTWORK THERE IS NOTHING TO PLACE, so the screen opens on the tab
   * that can do something about it. Landing on Place and showing a note that
   * points at another tab is a screen telling somebody to go somewhere it could
   * have taken them.
   */
  if (!t) tab.value = 'artwork'
  design.value = t ? designFor(t) : null
  saved.value = design.value ? JSON.parse(JSON.stringify(design.value)) : null
  sel.value = ''
  /* A design that has just arrived from the server has no past to undo into. */
  rebase()
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
/*
 * THE STUDIO ASKS FOR THE ROOM, and gives it back on the way out.
 *
 * Card 7a draws the app's chrome collapsed with "Exit studio" top left and ⌘\
 * to bring it back. The reason is the artboard: this screen measures in
 * millimetres beside a sidebar of eleven tabs nobody is going to press while
 * placing a field to the pixel.
 *
 * THREE WAYS BACK, because a person who has lost the navigation does not know
 * which one they were supposed to know about — the shortcut, the visible Exit
 * studio button, and go() clearing the flag from anywhere else. A keyboard
 * shortcut as the only way out is a trap wearing a feature's clothes.
 */
onMounted(() => {
  setFocus(true)
  window.addEventListener('keydown', onFocusKey)
  load().then(() => nextTick(fitToWidth))
})
onUnmounted(() => {
  setFocus(false)
  window.removeEventListener('keydown', onFocusKey)
})

/*
 * Named apart from onKey above, which nudges the selected box with the arrow
 * keys and is bound per element. This one is a WINDOW listener for the whole
 * screen's chrome, and two handlers on one name is how a listener ends up
 * removed by the wrong remove.
 */
function onFocusKey(e) {
  // ⌘\ on a Mac, Ctrl+\ elsewhere. Not a bare key: this screen is full of
  // text fields and a single letter would fire while somebody types a motto.
  if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    setFocus(!state.focus)
  }
}

/* Out of the studio entirely, as distinct from bringing the nav back. */
function exitStudio() { go('home') }

watch(activeId, () => {
  const t = active.value
  if (!t) { design.value = null; saved.value = null; return }
  design.value = designFor(t)
  saved.value = JSON.parse(JSON.stringify(design.value))
  sel.value = ''
  rebase()
  nextTick(fitToWidth)
})

/*
 * DIRTY, AND WHEN.
 *
 * The old screen saved on request and said nothing about the state in between,
 * so work was lost on navigation with no warning and no way to tell whether
 * what was on screen had been written down. Comparing against the last saved
 * copy is cheap at this size and cannot drift the way a manual flag does.
 */
const dirty = computed(() => {
  if (!design.value || !saved.value) return false
  return JSON.stringify(design.value) !== JSON.stringify(saved.value)
})

const editedAt = ref('')

async function pickFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  await useFile(file)
}

/*
 * STARTING FROM A BLANK TICKET, which is the second route into a design.
 *
 * It draws a real PNG at the chosen size — trim edge, stub perforation, white
 * paper — and hands it to the SAME function an uploaded file goes through. That
 * is the whole point: nothing downstream learns that this artwork was
 * generated, so placement, the print sheet and the QR work unchanged, and real
 * artwork can replace it later without anything being unpicked.
 *
 * The size comes from the raffle's own accepted shapes, so the picture cannot
 * be drawn at a size the uploader would then refuse.
 */
async function startBlank(sz) {
  uploadErr.value = ''
  uploadNote.value = ''
  busy.value = true
  try {
    const file = await blankArtboardFile(
      sz.widthMM, sz.heightMM, stubShare(design.value), 300, sz.label || 'Blank ticket')
    busy.value = false
    await useFile(file)
  } catch (err) {
    busy.value = false
    uploadErr.value = err.message
  }
}

async function useFile(file) {
  uploadErr.value = ''
  uploadNote.value = ''
  const why = rejectFile(file)
  if (why) { uploadErr.value = why; return }

  busy.value = true
  try {
    const payload = await toPayload(file, sizes.value)
    uploadNote.value = payload.note || ''

    /*
     * READ THE COLOURS WHILE THE FILE IS STILL HERE. Reading it back from
     * Storage would put a cross-origin image on a canvas and getImageData would
     * throw. A palette that cannot be read is not an error — the defaults still
     * draw a working ticket — so this never interrupts an upload.
     */
    let pal = null
    try { pal = await paletteFromFile(file) } catch { pal = null }

    adopt(await api('upload_template', {
      data: payload.data,
      contentType: payload.contentType,
      name: file.name.replace(/\.[^.]+$/, ''),
    }))

    if (pal && usable(pal.ink) && design.value && active.value) {
      design.value = { ...inkDesign(design.value, pal), artwork: design.value.artwork }
      detected.value = pal
      await saveDesign()
      toast('Artwork saved, colours taken from the picture', 'ok')
    } else {
      toast('Ticket artwork saved', 'ok')
    }
    nextTick(fitToWidth)
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
    /* The artwork's own size is a fact about the picture, added by designFor on
     * the way in. Storing it would be a second copy of something the row knows. */
    const { artwork, ...rest } = design.value
    void artwork
    /*
     * THE OLD SLOTS GO OUT IN STEP WITH THE ELEMENTS.
     *
     * Not because anything here reads them — elementsOf takes the list outright
     * — but because a browser still running the previous bundle does, and it
     * does not fail when they are stale. It prints a whole run from where an
     * element used to be, and the two machines disagree with no error on
     * either. See legacyFromElements for what can and cannot be carried back.
     */
    const payload = { ...rest, ...legacyFromElements(design.value) }
    adopt(await api('set_template_design', { id: active.value.id, design: payload }))
    toast('Saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally {
    savingDesign.value = false
  }
}

/*
 * UNDO IS ONE STEP AT A TIME, which is what the word means.
 *
 * It used to restore the last SAVED state, so after ten drags it discarded all
 * ten and called that Undo. Now every change pushes onto a stack and this pops
 * one. "Back to the saved design" is the other thing, and it is now named for
 * what it does rather than sharing a button with this.
 */
const history = ref([])
const HISTORY_MAX = 50
let restoring = false

/*
 * THE PREVIOUS STATE, HELD AS A STRING.
 *
 * A deep watcher on a ref is handed the SAME object as its old and its new
 * value — mutating design.value.elements[2].box.left does not replace the ref,
 * so `before` and `now` are one object and comparing them finds nothing. Every
 * change would look like no change and Undo would never have anything to pop.
 * So the previous state is kept here as text, which cannot alias.
 */
let lastSnap = ''
let lastPush = 0

/** Put the current state on the stack, before something changes it. */
function mark() {
  if (!design.value) return
  const snap = JSON.stringify(design.value)
  history.value = [...history.value.slice(-(HISTORY_MAX - 1)), snap]
  lastSnap = snap
  lastPush = Date.now()
}

function rebase() {
  lastSnap = design.value ? JSON.stringify(design.value) : ''
  history.value = []
  lastPush = 0
}

watch(design, () => {
  if (restoring || !design.value) return
  const snap = JSON.stringify(design.value)
  if (snap === lastSnap) return

  if (dirty.value) {
    editedAt.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  /*
   * ONE ENTRY PER GESTURE, NOT PER PIXEL.
   *
   * A drag fires this on every pointermove. Recording each one would make Undo
   * mean "back up one pixel" and put fifty presses between an organiser and the
   * position they had before they started — which is the same uselessness as
   * the old Undo that threw away everything since the last save, approached
   * from the other end. A drag marks its own starting point when it begins; a
   * typed field coalesces into one entry per half-second of typing.
   */
  if (!drag.value && lastSnap && Date.now() - lastPush > 500) {
    history.value = [...history.value.slice(-(HISTORY_MAX - 1)), lastSnap]
    lastPush = Date.now()
  }
  lastSnap = snap
}, { deep: true })

function undo() {
  const last = history.value[history.value.length - 1]
  if (!last) return
  restoring = true
  design.value = JSON.parse(last)
  history.value = history.value.slice(0, -1)
  lastSnap = last
  nextTick(() => { restoring = false })
}

function revertToSaved() {
  restoring = true
  design.value = saved.value ? JSON.parse(JSON.stringify(saved.value)) : null
  rebase()
  nextTick(() => { restoring = false })
}

function resetDesign() {
  if (active.value) design.value = designFor({ ...active.value, design: {} })
}

/* ---------- colours ---------- */

const detected = ref(null)

function paletteFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try { resolve(paletteOf(img)) } catch (e) { reject(e) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read the picture')) }
    img.src = url
  })
}

/* Paper last, because printing on the paper colour is how you make something
 * invisible. */
const swatches = computed(() => {
  const p = detected.value
  if (!p) return []
  return [...new Set([p.accent, p.ink, p.paper].filter(usable))]
})

const canDrop = typeof window !== 'undefined' && 'EyeDropper' in window

/*
 * THE EYEDROPPER, for the colour detection cannot reach. The gold this ticket's
 * number is printed in covers about a tenth of one per cent of it, so no
 * measurement of area will ever find it. The browser's own EyeDropper samples
 * the screen rather than the image, which would taint the canvas.
 */
async function dropper(apply) {
  if (!canDrop) return
  try {
    const { sRGBHex } = await new window.EyeDropper().open()
    if (usable(sRGBHex)) apply(String(sRGBHex).toUpperCase())
  } catch { /* dismissed with Escape, which is not a failure */ }
}

/* ---------- accepted sizes ---------- */

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

/* ---------- the artwork's own report ---------- */

/*
 * IS THIS ARTWORK READY TO PRINT? Three questions with three numbers, and each
 * one says what was wanted beside what was got — a bare "3.094" tells nobody
 * whether that is good news.
 */
const artworkReport = computed(() => {
  const t = active.value
  const d = design.value
  if (!t || !d) return null
  const ratio = t.width / t.height
  const size = sizes.value.find((s) => {
    const want = Number(s.widthMM) / Number(s.heightMM)
    return want > 0 && Math.abs(ratio - want) / want <= Number(s.tolerance ?? 0.02)
  }) || null
  const wanted = size ? Number(size.widthMM) / Number(size.heightMM) : null
  const minPx = size ? Number(size.minWidthPx ?? 0) : 0
  const overflowing = placements.value.filter((p) => p.kind === 'text' && (p.shrunk || !p.fits)).length
  return {
    size,
    ratio,
    wanted,
    exact: wanted !== null && Math.abs(ratio - wanted) < 0.0005,
    tolerance: size ? Number(size.tolerance ?? 0.02) : 0.02,
    px: t.width,
    minPx,
    enoughPx: t.width >= minPx,
    placed: elements.value.length,
    overflowing,
    ready: !!size && t.width >= minPx && overflowing === 0,
  }
})

/* ---------- the test page ---------- */

/*
 * Prints through the same path a real book will: the sheet builder, the print
 * stylesheet, and the browser's own dialog. No library, no server.
 */
function printTest() {
  if (!design.value || !active.value) return

  /*
   * SAMPLE NUMBERS AND REAL CODES, which is the opposite of what this did.
   *
   * It printed the raffle's own prefix and the next four numbers in sequence —
   * KS-00001 to KS-00004, which are real tickets somebody may be holding — and
   * it drew no QR at all. What came off the printer therefore had the artwork's
   * OWN placeholder code on it, the one printed into the picture, which is not
   * a code for anything and answers nothing when scanned.
   *
   * Both halves are fixed by the same change. The numbers come from the sample
   * book, so no real ticket number reaches sample paper. And each ticket gets
   * its own QR, encoded here at the real length, carrying that sample's marker
   * — so scanning any of them lands on the check page and is told, in both
   * languages, that it is a sample and not a ticket.
   *
   * A sample's code is derived rather than stored, so this works with no
   * database and no request: on a laptop with no connection, from a sheet found
   * in a drawer years later, the QR still answers.
   *
   * THE WATERMARK HAS TO GO IN THE LAYER, not only in the sheet. `layers`
   * REPLACES a ticket's overlay rather than adding to it, so a layer built
   * without it is a sample with no SAMPLE across it.
   */
  const per = Math.max(1, Math.min(Number(fit.value?.per ?? 4), 10))
  const tickets = sampleBook().slice(0, per)

  const layers = Object.fromEntries(tickets.map((t) => [t.number, elementLayerSVG(
    design.value,
    { 'ticket.number': t.number, 'book.number': t.book, code: t.code },
    {
      qrUrl: sampleVerifyUrl(sampleVerifyBase.value, t.number),
      encode,
      watermark: 'SAMPLE',
    },
  )]))

  const html = sheetHTML(design.value, tickets.map((t) => t.number), active.value.url, {
    title: 'Ticket Studio — a sheet of samples, not real tickets',
    watermark: 'SAMPLE',
    autoPrint: true,
    layers,
  })
  const w = window.open('', '_blank')
  if (!w) { toast('Allow pop-ups to print a test page', 'bad'); return }
  w.document.write(html)
  w.document.close()
}



/* The ticket at its printed size. The height is never stored — it is the
 * artwork's own shape times the width, because a second number is a second
 * thing to get wrong and getting it wrong stretches the artwork off its
 * baseline. */
const printedSize = computed(() => {
  const t = active.value
  const w = Number(design.value?.sheet?.widthMM ?? 0)
  if (!t || !w) return ''
  return `${w.toFixed(1)} × ${(w * (t.height / t.width)).toFixed(1)} mm`
})
</script>

<template>
  <section v-if="!isAdmin" class="card">
    <h3>Ticket Studio</h3>
    <p class="muted">This is an organiser's screen.</p>
  </section>

  <section v-else class="designer dense">
    <!--
      THE HEADER IS THE TEMPLATE. Which artwork is being designed, what shape it
      is, and the two things you do when you have finished. It stays put while
      everything under it scrolls, because "which template am I editing" is the
      question a screen with three tabs and two side panels most easily loses.
    -->
    <header class="bar">
      <!--
        THE VISIBLE WAY OUT, top left, as card 7a draws it. It is first in the
        bar because that is where somebody looks for the way back when the
        navigation they were using has gone.
      -->
      <button class="btn sm ghost exit" @click="exitStudio">
        <Icon name="arrowLeft" :size="16" />Exit studio
      </button>
      <h2>Ticket Studio</h2>

      <label v-if="templates.length" class="picker">
        <span class="sr">Template being designed</span>
        <select v-model="activeId">
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>
      <!--
        THE ARTBOARD'S OWN NUMBERS, written as card 9b writes them:
        "190.0 x 61.5 mm - 2244 x 726 px - 300 dpi". The dpi was computed here
        already and shown only inside the artwork verdict, which is the one tab
        somebody is NOT on while placing boxes — so the resolution they are
        designing against was invisible exactly when it constrains what they do.

        All of it is data, so all of it takes --font-data.
      -->
      <span v-if="active && design" class="specs data">
        {{ printedSize }} · {{ active.width }} × {{ active.height }} px<template
          v-if="dpi"> · {{ dpi.v }} dpi</template>
      </span>

      <nav class="tabs" role="tablist">
        <button
          v-for="t in TABS" :key="t.id" type="button" role="tab"
          class="tabbtn" :class="{ on: tab === t.id }"
          :aria-selected="tab === t.id" @click="tab = t.id">{{ t.name }}</button>
      </nav>

      <span class="grow"></span>

      <span class="statetxt" :class="{ unsaved: dirty }">
        <template v-if="dirty">Edited {{ editedAt }} · not yet saved</template>
        <template v-else-if="saved">All changes saved</template>
      </span>

      <button class="btn sm" :disabled="!active || !design"
              :title="active ? 'Fill one sheet with sample tickets, each with its own working QR, through the real print path' : 'Upload some artwork first'"
              @click="printTest">Print a test page</button>
      <button class="btn sm primary"
              :disabled="savingDesign || !design || problems.length > 0"
              :title="problems.length ? problems[0] : 'Write this design onto the template'"
              @click="saveDesign">{{ savingDesign ? 'Saving…' : 'Save the design' }}</button>
    </header>

    <p v-if="loadErr" class="note bad">{{ loadErr }}</p>
    <p v-else-if="loading" class="muted">Loading&hellip;</p>

    <template v-else>
      <!-- ================= PLACE ================= -->
      <div v-if="tab === 'place'" class="studio">
        <template v-if="active && design">
          <!-- ---------- the rail ---------- -->
          <aside class="rail">
            <div class="block">
              <h3 class="rubric">Put something on the ticket</h3>
              <div class="seg">
                <button type="button" class="segbtn" :class="{ on: pending === 'field' }"
                        @click="beginAdd('field')">A field</button>
                <button type="button" class="segbtn" :class="{ on: pending === 'code' }"
                        @click="beginAdd('code')">A code</button>
                <button type="button" class="segbtn" :class="{ on: pending === 'text' }"
                        @click="beginAdd('text')">Own words</button>
              </div>
              <p class="tiny muted">
                Pick it, then draw a box anywhere on the artwork.
                Nothing here is fixed by the system.
              </p>
            </div>

            <div class="block grow">
              <h3 class="rubric">
                On this template <span class="count">{{ elements.length }}</span>
              </h3>
              <!--
                GROUPED BY HALF, which is how card 7a draws it and how the
                ticket itself is organised: MAIN HALF and STUB are two different
                pieces of paper after somebody tears along the perforation, and
                what is printed on each is a separate decision.

                It was a flat list with the side repeated on every row as a
                small grey word — ten rows carrying the same two answers, and
                the reader doing the sorting. The heading says it once and
                counts them, and a box that crosses the line changes GROUP when
                it is dragged, which is the same fact told more loudly.
              -->
              <template v-for="g in HALVES" :key="g.k">
                <h4 v-if="byHalf[g.k].length" class="halfhead">
                  {{ g.t }} <span class="count data">{{ byHalf[g.k].length }}</span>
                </h4>
                <ul v-if="byHalf[g.k].length" class="ellist">
                  <li v-for="el in byHalf[g.k]" :key="el.id"
                      :class="{ on: sel === el.id, off: el.enabled === false }">
                    <input
                      v-model="el.enabled" type="checkbox"
                      :aria-label="`Print ${nameOf(el)}`"
                      :title="`Print ${nameOf(el)} on every ticket`">
                    <span class="tag" :class="el.kind">{{ TAG[el.kind] }}</span>
                    <button type="button" class="elname" @click="pick(el.id)">{{ nameOf(el) }}</button>
                    <span v-if="trouble(el)" class="warnmark"
                          :title="`${nameOf(el)} ${trouble(el)}`">!</span>
                  </li>
                </ul>
              </template>
              <p v-if="!elements.length" class="tiny muted">
                Nothing is printed on this ticket yet. Pick something above and draw a box.
              </p>
            </div>

            <!--
              ARTBOARD — what the canvas DRAWS, as card 9b groups it.

              These two were loose on the status bar beside Snap and Longest
              entry, which mixes two kinds of control: what the artboard shows
              you, and how the tool behaves while you drag. The card separates
              them and it is right — "Real QR" changes the picture, "Snap"
              changes the pointer.

              The card also draws "Grid & guides" and "Bleed & safe area" here.
              Neither is built: nothing in ticketsheet.js or ticketdesign.js has
              ever heard of a bleed, and a toggle over absent machinery is the
              sheet.perPage bug — a control that said four while the sheet did
              something else. They are a pipeline task with a UI at the end.
            -->
            <div class="block">
              <h3 class="rubric">Artboard</h3>
              <label class="choice tiny"><input v-model="showAllBoxes" type="checkbox"> Every box</label>
              <label class="choice tiny"><input v-model="realQr" type="checkbox"> Real QR</label>
            </div>

            <div class="block">
              <h3 class="rubric">Where the stub begins</h3>
              <div class="stubrow">
                <input
                  class="pcfield" type="number" step="0.1" min="5" max="95"
                  :value="(design.stubAt * 100).toFixed(1)"
                  aria-label="Where the stub begins, as a percentage of the ticket"
                  @input="design.stubAt = Math.max(0.05, Math.min(0.95, Number($event.target.value) / 100))">
                <span class="unit">%</span>
                <span class="tiny muted">or drag the line on the ticket</span>
              </div>
            </div>
          </aside>

          <!-- ---------- the canvas ---------- -->
          <div class="stagewrap">
            <div class="stagebar">
              <div class="zoom">
                <button type="button" class="zbtn" title="Zoom out" @click="stepZoom(-1)">−</button>
                <span class="zval">{{ Math.round(zoom * 100) }}%</span>
                <button type="button" class="zbtn" title="Zoom in" @click="stepZoom(1)">+</button>
                <button type="button" class="btn sm ghost" @click="fitToWidth">Fit</button>
              </div>
              <label class="choice tiny"><input v-model="snapping" type="checkbox"> Snap to other boxes</label>
              <label class="choice tiny"><input v-model="showLongest" type="checkbox"> Longest entry</label>
              <span class="grow"></span>
              <span class="tiny muted held">positions held as a share of the template, not as pixels</span>
            </div>

            <div ref="stage" class="stage">
              <!-- The ruler reads in shares, because that is what is stored; the
                   width in millimetres is the one absolute fact on it. -->
              <div class="ruler" :style="{ width: frameWidth + 'px' }">
                <span style="left:0">0</span>
                <span style="left:25%">25%</span>
                <span style="left:50%">50%</span>
                <span style="left:75%">75%</span>
                <span class="right">{{ Number(design.sheet.widthMM).toFixed(1) }} mm</span>
              </div>

              <div
                ref="frame" class="frame" :class="{ drawing: !!pending }"
                :style="{ width: frameWidth + 'px' }"
                @pointerdown="startDraw" @pointermove="onPointerMove"
                @pointerup="endPointer" @pointercancel="endPointer">
                <img :src="active.url" alt="" draggable="false">
                <div class="overlay" v-html="preview"></div>

                <!-- Every element's box. Shown as an outline when asked for, and
                     always for the selected one — you cannot position what you
                     cannot see the extent of. -->
                <div
                  v-for="el in elements" :key="el.id"
                  class="ebox"
                  :class="{ on: sel === el.id, off: el.enabled === false, faint: !showAllBoxes && sel !== el.id, code: el.kind === 'code' }"
                  :style="{ left: pc(el.box.left), top: pc(el.box.top), width: pc(el.box.width), height: pc(el.box.height) }"
                  :title="el.enabled === false ? `${nameOf(el)} is switched off in the list` : `${nameOf(el)} — drag to move, or use the arrow keys`"
                  @pointerdown="startMove(el, $event)">
                  <button
                    type="button" class="grab" :aria-label="nameOf(el)"
                    :disabled="el.enabled === false"
                    :title="el.enabled === false ? `${nameOf(el)} is switched off in the list` : `${nameOf(el)} — drag to move, or use the arrow keys`"
                    @keydown="onKey" @click.stop="pick(el.id)"></button>
                  <template v-if="sel === el.id && el.enabled !== false">
                    <span
                      v-for="c in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="c"
                      class="hdl" :class="c"
                      @pointerdown="startResize(el, c, $event)"></span>
                  </template>
                </div>

                <!-- The box being drawn right now. -->
                <div v-if="drawn" class="ebox drawnbox"
                     :style="{ left: pc(drawn.left), top: pc(drawn.top), width: pc(drawn.width), height: pc(drawn.height) }"></div>

                <!-- The perforation. Draggable, because it is a measurement you
                     can see on the artwork and nobody should be typing it. -->
                <div class="stubline" :style="{ left: pc(design.stubAt) }"
                     @pointerdown="startStubDrag">
                  <span class="stubgrip" :title="`The stub begins at ${pc(design.stubAt)} — drag to move`">
                    {{ pc(design.stubAt) }}
                  </span>
                </div>
              </div>
            </div>

            <p class="readout">
              <template v-if="chosen && inPixels">
                <b>x {{ pc(chosen.box.left) }}</b> · y {{ pc(chosen.box.top) }} ·
                w {{ pc(chosen.box.width) }} · h {{ pc(chosen.box.height) }}
                — on this template {{ inPixels.x }}, {{ inPixels.y }},
                {{ inPixels.w }} × {{ inPixels.h }} px
              </template>
              <template v-else>
                Nothing selected. Pick something from the list, or click a box on the ticket.
              </template>
              <span class="grow"></span>
              <span class="muted">
                Shown with the {{ showLongest ? 'longest' : 'typical' }} entry the designer knows.
              </span>
            </p>

            <p v-if="problems.length" class="note bad tiny">
              <span v-for="(p, i) in problems" :key="i">{{ p }}<br></span>
            </p>
          </div>

          <!-- ---------- the panel ---------- -->
          <!--
            THE INSPECTOR. Thirty-one reads of the selected element, four of
            the report about it, and one measurement off the sheet — the rest
            of what it needs are constants it can import itself. Phase 2 of
            STUDIO-PLAN: one panel whose contents are whatever is selected,
            rather than a panel per tab.
          -->
          <Inspector :element="chosen" :report="fitReport" :sheet-width-m-m="design.sheet.widthMM"
                     :qr-density="qrDensity" @remove="removeElement" />
        </template>

        <p v-else class="note">
          No artwork yet. Open <b>Artwork &amp; paper</b> and upload a picture of one blank
          ticket, and this is where you place things on it.
        </p>
      </div>

      <!-- ================= ARTWORK & PAPER ================= -->
      <div v-else-if="tab === 'artwork'" class="studio">
        <!--
          THE TEMPLATE RAIL IS ITS OWN COMPONENT. Five bindings in, four
          events out, and the file input lives with it — the parent never
          sees a DOM node, only the File somebody chose.
        -->
        <TemplateRail :templates="templates" :active-id="activeId" :busy="busy"
                      :error="uploadErr" :note="uploadNote"
                      :sizes="sizes"
                      @choose="choose" @remove="remove" @file="pickFile" @blank="startBlank" />

        <div class="stagewrap">
          <template v-if="active && design">
            <div class="stagebar">
              <b class="mono tiny">{{ active.name }}</b>
              <label class="choice tiny"><input v-model="showGuides" type="checkbox"> Measuring guides</label>
              <span class="grow"></span>
              <span class="tiny muted mono">
                measured {{ Number(design.sheet.widthMM).toFixed(1) }} ×
                {{ (design.sheet.widthMM * (active.height / active.width)).toFixed(1) }} mm
                <template v-if="dpi">at {{ dpi.v }} dpi</template>
              </span>
            </div>

            <div class="stage plain">
              <!--
                FITTED, NOT ZOOMED. This view answers "is this the right
                picture and is the stub line where I think it is", which
                needs the whole ticket. It used to be drawn at the Place
                tab's zoom — a control this tab does not have — so a canvas
                left at 200% showed a scrolled crop here with no way back.
                Capped at the artwork's own width so a small file is never
                blown up past actual size.
              -->
              <div class="frame fitted" :style="{ maxWidth: (design.artwork?.width ?? active.width) + 'px' }">
                <img :src="active.url" alt="" draggable="false">
                <div class="overlay" v-html="preview"></div>
                <div class="stubline still" :style="{ left: pc(design.stubAt) }"></div>
              </div>
            </div>
            <p class="readout mono">
              ↑ the stub begins at {{ Math.round(design.stubAt * active.width) }} px ·
              {{ (design.stubAt * design.sheet.widthMM).toFixed(1) }} mm
            </p>

            <!--
              THE ONE CARD ON THIS SCREEN THAT IS A CARD. Three questions with
              three numbers, each stating what was wanted beside what was got.
            -->
            <ArtworkVerdict v-if="artworkReport" :report="artworkReport" />
          </template>
          <p v-else class="note">Upload a picture of one blank ticket to begin.</p>
        </div>

        <!--
          THE SHAPES PANEL IS ITS OWN COMPONENT. Four bindings wide — the list,
          its error, and two actions — where the rest of this tab is eighteen.
          That is why it went first: a seam you can state in one line.
        -->
        <ShapesPanel :sizes="sizes" :error="sizeErr" :matched="artworkReport?.size ?? null"
                     :busy="busy" @add="addSize" @save="saveSizes"
                     @remove="(i) => { sizes = sizes.filter((_, k) => k !== i) }" />
      </div>

      <!--
        THE PRINT SHEET IS ITS OWN COMPONENT. First of the three to move out —
        smallest, and the one whose contents were rebuilt most recently. The
        design object goes in by reference and the tab edits it, which is what
        every control on this screen already did when they shared a file.
      -->
      <SheetTab v-else :design="design" :active="active" :dpi="dpi" />

      <!--
        THE FOOTER SAYS WHAT THE MODEL IS. It is one sentence and it is the
        thing somebody needs to know before they trust this screen with a press
        run: what they are moving is a proportion of the ticket, not a pixel on
        one particular file.
      -->
      <footer class="footbar">
        <span class="tiny muted grow">
          Held as shares of the template, so the same design survives a redraw at any size —
          and a different charity's artwork starts from its own.
        </span>
        <!--
          THREE ACTIONS THAT LOOKED IDENTICAL AND ARE NOT.
          Undo takes back one step. "Back to saved" throws away this sitting.
          "Back to standard" discards the whole design — every measurement
          anybody has ever made on this template — and it was a ghost button
          sitting flush against the other two, first in the row. Nothing on
          the screen said which of the three you could not take back.
          It is marked and it is separated now; the everyday one is nearest
          the hand.
        -->
        <button class="btn sm ghost danger" :disabled="!design"
                title="Discard the whole design and start from the standard one. This cannot be undone."
                @click="resetDesign">Back to standard</button>
        <span class="gap"></span>
        <button class="btn sm ghost" :disabled="!dirty"
                :title="dirty ? 'Throw away every change since the last save' : 'Nothing has changed since the last save'"
                @click="revertToSaved">Back to saved</button>
        <button class="btn sm" :disabled="!history.length"
                :title="history.length ? 'Undo the last change' : 'Nothing to undo'"
                @click="undo">Undo</button>
      </footer>
    </template>
  </section>
</template>

<style scoped src="./ticketdesign/studio.css"></style>

<style scoped>
.designer { display: flex; flex-direction: column; gap: 12px; min-height: 0 }
/* .sr moved to style.css — it is a global utility and was trapped here. */
.grow { flex: 1; min-width: 0 }

/* ---- the bar ---- */
.bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-bottom: 10px; border-bottom: 1px solid var(--border);
}
.bar h2 { margin: 0; font-size: 1.05rem }
.picker select { min-height: 34px; padding: 4px 8px; width: auto; max-width: 220px }
.specs { font-family: var(--font-data); font-size: .72rem; color: var(--muted) }
.tabs { display: flex; gap: 2px; padding: 2px; background: var(--surface-2); border-radius: var(--r-sm) }
.tabbtn {
  border: 0; background: none; color: var(--muted); cursor: pointer;
  padding: 6px 12px; border-radius: 8px; font-size: .84rem; font-weight: 500;
}
.tabbtn.on { background: var(--brand); color: var(--brand-ink) }
.tabbtn:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px }
/*
 * IT SHRINKS BEFORE THE BUTTONS DO. The bar wraps, and this sentence is the
 * longest thing in it — "Edited 12:04 · not yet saved" pushed Save onto a
 * line of its own, which reads as an orphaned primary action rather than as
 * a header that ran out of room. The status may truncate; the action may not
 * move.
 */
.statetxt {
  font-size: .74rem; color: var(--muted);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.statetxt.unsaved { color: var(--warn); font-weight: 500 }

/* ---- three columns: list, ticket, one thing's settings ---- */
.panel { max-height: calc(100vh - 170px); overflow: auto }

/*
 * A RUBRIC, NOT A HEADING. These name a group of controls inside a panel and
 * must not compete with the screen's own title — small, spaced, and in the
 * muted colour, so the eye reads the ticket first and the labels second.
 */

/* ---- segmented buttons: one of these, not many of those ---- */

/* ---- the element list: a register, not a stack of cards ---- */
.ellist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.ellist li {
  display: flex; align-items: center; gap: 7px; padding: 5px 4px;
  border-bottom: 1px solid var(--border);
}
.ellist li.on { background: var(--brand-soft); border-radius: 6px }
.ellist li.off .elname, .ellist li.off .side { opacity: .5 }
.elname {
  flex: 1; min-width: 0; text-align: left; border: 0; background: none; cursor: pointer;
  font-size: .84rem; color: var(--text); padding: 2px 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.elname:hover { color: var(--brand) }
.elname:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; border-radius: 3px }
/* The kind, as three letters. A word would push the name out of a 240px rail;
 * a coloured dot alone would say nothing without a key. */
.tag {
  font-family: var(--font-data);
  font-size: .58rem; font-weight: 700; letter-spacing: .04em;
  padding: 2px 4px; border-radius: 3px; background: var(--surface-2); color: var(--muted);
}
.tag.code { background: var(--info-soft); color: var(--info) }
.tag.text { background: var(--warn-soft); color: var(--warn) }
.side { font-size: .68rem; color: var(--muted) }
.warnmark {
  flex: none; width: 15px; height: 15px; border-radius: 50%;
  background: var(--warn-soft); color: var(--warn);
  font-size: .66rem; font-weight: 700; line-height: 15px; text-align: center; cursor: help;
}

.stubrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap }
.pcfield {
  width: 82px; min-height: 32px; padding: 4px 8px; text-align: right;
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}

/* ---- the stage ---- */
.stagebar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }
.zoom { display: flex; align-items: center; gap: 4px }
.zbtn {
  width: 26px; height: 26px; border: 1px solid var(--border); background: var(--surface);
  border-radius: 6px; cursor: pointer; color: var(--text); line-height: 1;
}
.zbtn:hover { border-color: var(--brand) }
.zval {
  min-width: 42px; text-align: center; font-size: .76rem;
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.held { text-align: right }

.stage { overflow: auto; padding: 0 0 8px; background: var(--surface-2); border-radius: var(--r-sm) }
.stage.plain { padding-bottom: 0 }
.ruler {
  position: relative; height: 15px; margin: 0 auto; font-size: .6rem; color: var(--muted);
  font-family: var(--font-data);
}
.ruler span { position: absolute; top: 2px; padding-left: 3px; border-left: 1px solid var(--border) }
.ruler .right { right: 0; border-left: 0; border-right: 1px solid var(--border); padding: 0 3px 0 0 }

.frame {
  position: relative; margin: 0 auto; touch-action: none;
  box-shadow: var(--shadow); background: var(--surface);
}
.frame.drawing { cursor: crosshair }
.frame.fitted { width: 100% }
.frame img { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none }
.frame .overlay { position: absolute; inset: 0; pointer-events: none }
.frame .overlay :deep(svg) { width: 100%; height: 100%; display: block }

/*
 * AN ELEMENT'S BOX. Faint until you ask for it, solid when selected. The
 * outline is the extent of the lettering, and its bottom edge is the baseline
 * — which is why the selected box shows that edge heavier than the rest.
 */
/*
 * THESE OUTLINES DO NOT USE THE THEME TOKENS, AND THAT IS THE POINT.
 *
 * Every other colour on this screen is a token so it follows dark mode. These
 * sit on top of somebody's artwork, which is dark green here and might be white
 * card or a photograph on the next raffle's ticket — so a token that resolves
 * against the APP's background tells you nothing about whether the line will be
 * visible against the TICKET's. A light dash over a dark hairline reads on both,
 * the way a selection marquee does in any image editor, and ticketart.js picks
 * its measuring-guide colours the same way and for the same reason.
 */
.ebox {
  position: absolute; cursor: move; touch-action: none;
  outline: 1px dashed rgba(255, 255, 255, .85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
}
.ebox.faint { outline-color: rgba(255, 255, 255, .4); box-shadow: 0 0 0 1px rgba(0, 0, 0, .22) }
.ebox.off { cursor: not-allowed; outline-style: dotted; outline-color: rgba(255, 255, 255, .45); opacity: .6 }
.ebox.on {
  outline: 2px solid #ffb300;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .55);
  background: rgba(255, 179, 0, .14);
}
.ebox.code.on { background: rgba(255, 179, 0, .2) }
.ebox.drawnbox {
  outline: 2px solid #ffb300; box-shadow: 0 0 0 1px rgba(0, 0, 0, .55);
  background: rgba(255, 179, 0, .18); pointer-events: none;
}
/* The keyboard route in. It fills the box so a click anywhere selects, and it
 * is a real button so arrow keys reach it and a screen reader names it. */
.grab { position: absolute; inset: 0; border: 0; background: none; padding: 0; cursor: inherit }
.grab:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px }
.hdl {
  position: absolute; width: 8px; height: 8px; background: #fff;
  border: 1.5px solid #ffb300; border-radius: 1px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
}
.hdl.nw { left: -4px; top: -4px; cursor: nwse-resize }
.hdl.n { left: calc(50% - 3.5px); top: -4px; cursor: ns-resize }
.hdl.ne { right: -4px; top: -4px; cursor: nesw-resize }
.hdl.e { right: -4px; top: calc(50% - 3.5px); cursor: ew-resize }
.hdl.se { right: -4px; bottom: -4px; cursor: nwse-resize }
.hdl.s { left: calc(50% - 3.5px); bottom: -4px; cursor: ns-resize }
.hdl.sw { left: -4px; bottom: -4px; cursor: nesw-resize }
.hdl.w { left: -4px; top: calc(50% - 3.5px); cursor: ew-resize }

/* The perforation. Dashed because that is what it is on the paper. */
.stubline { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px dashed var(--info); cursor: ew-resize; touch-action: none }
.stubline.still { cursor: default }
.stubgrip {
  position: absolute; top: 50%; left: -21px; transform: translateY(-50%);
  background: var(--info); color: #fff; font-size: .58rem; padding: 2px 3px;
  border-radius: 3px; font-family: var(--font-data);
  writing-mode: vertical-rl;
}

.readout {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0;
  font-size: .72rem; color: var(--muted);
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.readout b { color: var(--text) }

/* ---- the panel ---- */
.panelhead h3 { margin: 2px 0 0; font-size: .95rem }
/* Paper is chosen by its shape, so the shapes are the control. */
/*
 * Orientation uses the segmented control this screen already has — .seg with
 * .segbtn children, the same one the field/code/words switch and the
 * alignment and overflow rows use. A second `.seg` rule was defined here for
 * a day and overrode all three of them with a border and a margin.
 */
/* A template is recognised by its picture, so the picture is the control. */
/*
 * `.quad` is the INSPECTOR's grid — four box fields, where two columns pair
 * x with y and width with height. The sheet tab borrowed it for three
 * unrelated measurements, which left an empty fourth cell and implied a
 * pairing between width and gap that does not exist. It uses `.one` now.
 */
.sitrow { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: end }
.choice.bold { padding-bottom: 6px }
.prow { display: flex; gap: 6px; flex-wrap: wrap }
.nothing { padding: 8px 0 }
.saving { color: var(--muted) }
.btn.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, var(--border)) }
.wide { width: 100% }

/* The one answer the panel exists to give, so it is the one block with a fill. */
.report { border-radius: 8px; padding: 8px 10px; font-size: .76rem }
.report p { margin: 3px 0 0 }
.report.ok { background: var(--ok-soft); color: var(--ok) }
.report.warn { background: var(--warn-soft); color: var(--warn) }
.report.info { background: var(--info-soft); color: var(--info) }

/* ---- templates list ---- */
.tlist p { margin: 0 }

/* ---- the artwork verdict ---- */
.vhead .dot { width: 9px; height: 9px; border-radius: 2px; background: var(--warn) }
.verdict.ok .vhead .dot { background: var(--ok) }
.vgrid p { margin: 0 }
/* The magnitude before the precision: the figure is what the eye lands on and
 * the sentence under it is what makes it mean something. */
.big { font-size: 1.3rem; font-weight: 600; margin: 3px 0 !important }

/* ---- accepted shapes ---- */
/*
 * A specification is typed, not slid — 190 by 61.39 at a 2% tolerance is a
 * figure somebody was given, not one they feel their way to. So these stay
 * fields, and get what a column of numbers needs: one alignment and figures
 * that line up.
 */
.sgrid input {
  min-height: 30px; padding: 3px 6px; text-align: right; font-size: 12px;
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.sgrid .wrap input[type=number] { padding-right: 30px }
.sgrid .unit { font-size: .66rem }

/* The arithmetic is how you check the answer, so it sits under it and quiet. */

.footbar .gap { flex: 0 0 18px }
.footbar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 10px; border-top: 1px solid var(--border);
}

/*
 * NARROW: the panel goes under the ticket rather than beside it, and the rail
 * stops being a column. Three columns in 900px is three unusable columns. This
 * is an organiser's screen and most of them are at a desk, but a laptop at
 * 1280 is common and the third column has to survive it.
 */
@media (max-width: 1200px) {
  .studio { grid-template-columns: 200px minmax(0, 1fr) }
  .panel { grid-column: 1 / -1; max-height: none }
}
@media (max-width: 820px) {
  .studio { grid-template-columns: 1fr }
  .rail { max-height: none }
  .held { display: none }
}
</style>
