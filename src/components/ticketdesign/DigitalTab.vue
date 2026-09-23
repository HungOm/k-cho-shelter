<script setup>
/**
 * THE DIGITAL TICKET, DESIGNED RATHER THAN CHOSEN.
 *
 * This tab was a treatment switch, a motto field and a picture. The other
 * three tabs of the same studio are a designer — a list of what is on the
 * artboard, the artboard, and an inspector for whatever is selected — and the
 * one tab showing the thing a buyer ACTUALLY RECEIVES had none of it. An
 * organiser could move a ticket number three millimetres on paper nobody reads
 * closely, and could not move anything at all on the picture that arrives in a
 * WhatsApp message.
 *
 * So it is the same three columns, against the same model: `cardelements.js`
 * says what the parts of a card are and where they stand by default,
 * `ticketart.js` draws them there, and this screen moves them.
 *
 * WHAT IS DELIBERATELY NOT HERE, named rather than left to be discovered:
 *
 *   NOTHING CAN BE ADDED. There is no "+" on the layer list and no tool rail
 *   of shapes down the side. A card part is a composition this app owns — the
 *   masthead is a mark, an organisation and an event — and the list of them is
 *   fixed. The printed tab can add elements because that ticket is somebody's
 *   own artwork with fields dropped onto it; this one is our drawing.
 *
 *   NOTHING CAN BE REMOVED, only hidden, from the eye on its row. That is
 *   reversible from the same control and removal would not be.
 *
 *   THE SELLER'S NAME IS NOT AN OPTION. The card carries the buyer's name and
 *   nothing else about a person, and `digitalCardSVG` says why at length: it
 *   is a forwardable picture, and the phone, the area and the seller live on
 *   the stub and stay there. Reversing that is a decision about somebody's
 *   privacy, not a toggle.
 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { cardSVG, cardPalette, CARD_DESIGNS, ticketVerifyUrl } from '../../lib/ticketart.js'
import { CARD_SIZES, layoutFrom } from '../../lib/cardelements.js'
import { boundsOf, alignBoxes, distributeBoxes, orderMoved } from '../../lib/arrange.js'
import { encode } from '../../lib/qrcodegen.js'
import { inkFor } from '../../lib/brand.js'
import Icon from '../ui/Icon.vue'
import Toggle from '../ui/Toggle.vue'
import ToolBar from '../ui/ToolBar.vue'
import ToolButton from '../ui/ToolButton.vue'
import CardInspector from './CardInspector.vue'
import DecorationInspector from './DecorationInspector.vue'
import LibraryPanel from './LibraryPanel.vue'
import PicturePicker from './PicturePicker.vue'
import { usePen } from './usePen.js'
import { normalDecoration, nextDecoId, nextGroupId } from '../../lib/designelements.js'
import { placeShape } from '../../lib/designlibrary.js'
import { pathData } from '../../lib/pathgeometry.js'
import { expandGroups, drawBox, aboutCentre } from '../../lib/selection.js'
import { copyRecords, pasteRecords, repeatStep } from '../../lib/clipboard.js'
import { KEYS, keyLabel } from '../../lib/studiokeys.js'
import { CARD_FACES } from '../../lib/cardfaces.js'
import { inlineImages, fetchAsDataURI } from '../../lib/ticketexport.js'

const props = defineProps({
  /** `{ design, motto }` — the raffle's own two card settings, edited here. */
  card: { type: Object, required: true },
  /** This treatment's parts, resolved and whole. Edited in place. */
  parts: { type: Array, required: true },
  /** The raffle's config, for the colour, the name and a specimen number. */
  cfg: { type: Object, default: () => ({}) },
  /** How wide the picture is actually sent, for the QR reliability line. */
  sentWidth: { type: Number, default: 1200 },
  swatches: { type: Array, default: () => [] },
  canDrop: { type: Boolean, default: false },
  mottoMax: { type: Number, default: 48 },
  /*
   * WHAT HAS BEEN DRAWN ON THIS TREATMENT'S CARD (STUDIO-ESSENTIALS Phase 9).
   * Edited in place like the parts; a drawing added or removed is a new list,
   * sent up with `set-decorations`, because the parent owns which exist.
   */
  decorations: { type: Array, default: () => [] },
  /** The raffle's library, the same one the printed tab places from. */
  library: { type: Object, default: () => ({ shapes: [], colours: [], styles: [] }) },
  libBusy: { type: Boolean, default: false },
  /** The pictures this raffle has uploaded, for the Picture tool. */
  pictures: { type: Array, default: () => [] },
  /** The hand is up — Space held, or H — and a press pans instead. The
      studio holds it, because the key is the studio's on both tabs. */
  hand: { type: Boolean, default: false },
})
/*
 * `mark` AND `drag` ARE THE UNDO STACK'S TWO SIGNALS, and they are separate on
 * purpose. `mark` says "a change is about to happen, put the current state on
 * the stack"; `drag` says whether a gesture is in progress, which is what
 * stops a pointermove every few milliseconds from recording fifty entries the
 * owner of the stack would then have to press Undo fifty times to get past.
 */
const emit = defineEmits(['pick-colour', 'mark', 'drag', 'set-decorations',
  'save-shape', 'remove-shape', 'save-colour', 'remove-colour', 'save-style', 'remove-style'])

const size = computed(() => CARD_SIZES[props.card.design] || CARD_SIZES.grand)

/* ---------- what the card actually says ---------- */

/*
 * A SPECIMEN, NOT A MOCK. The number, the colour, the organisation and the
 * price are this raffle's own, so what is on screen is the card a buyer
 * receives rather than a picture of the idea of one. The name is a long one on
 * purpose, for the same reason the printed tab defaults to its longest entry.
 */
const specimen = computed(() => {
  const c = props.cfg || {}
  const brand = String(c.brandColor || '').trim()
  return {
    number: (c.ticketPrefix || '') + '1'.padStart(c.ticketDigits || 5, '0'),
    name: 'Daw Hla Myint Aung',
    org: c.orgName || '',
    event: c.eventName || '',
    price: c.ticketPrice ? `${c.currency ?? ''} ${c.ticketPrice}`.trim() : '',
    book: (c.bookPrefix || 'Book-') + '1'.padStart(c.bookDigits || 4, '0'),
    soldOn: '14 Sep 2026',
    drawOn: c.drawDate ? String(c.drawDate).slice(0, 10) : '',
    sold: true,
    motto: props.card.motto,
    brand,
    ink: inkFor(brand) || '#ffffff',
    thanks: 'Thank you — this keeps the shelter open.',
    link: String(verifyBase.value).replace(/^https?:\/\//, '') + '/?' + ((c.ticketPrefix || '') + '1'.padStart(c.ticketDigits || 5, '0')),
  }
})

const verifyBase = computed(() => {
  const set = String(props.cfg?.verifyUrl || '').trim()
  return set || ((typeof location === 'undefined' ? '' : location.origin) + '/v')
})

const specimenUrl = computed(() =>
  ticketVerifyUrl(verifyBase.value, specimen.value.number, 'SPECIMEN0000'))

/*
 * THE LAYOUT AS THE RENDERER WANTS IT, which is the sparse overlay and not the
 * list. Deriving it here rather than keeping a second copy means the picture
 * on screen is drawn from exactly the bytes that will be saved — there is no
 * arrangement in which the preview and the stored card can differ.
 */
const layout = computed(() => layoutFrom(props.card.design, props.parts, {}))

const drawError = ref('')
const preview = computed(() => {
  drawError.value = ''
  try {
    return cardSVG(props.card.design, { ...specimen.value, decorations: props.decorations }, {
      layout: layout.value, qrUrl: specimenUrl.value, encode,
    })
  } catch (err) {
    /* A failure here used to become nothing at all on the printed tab, so a
       preview that broke and a preview with nothing to draw looked the same. */
    drawError.value = String(err?.message || err)
    return ''
  }
})

/*
 * THE COLOUR A PART IS ALREADY PRINTED IN, for the panel that offers to change
 * it. Every part carries the NAME of the role it takes — gold, ink, quiet —
 * and the values come from the same function the renderer uses, so the swatch
 * beside "Colour" is the colour on the card and not a guess at one.
 */
const palette = computed(() => cardPalette(props.card.design, specimen.value))

/* ---------- the list ---------- */

/*
 * A PRIMARY SELECTION AND THE OTHERS — the same two refs as the printed tab,
 * and the same reason: the inspector edits ONE part's colour and lettering,
 * while align and distribute act on everything and do not care which was
 * clicked first.
 *
 * WHAT THIS TAB CANNOT OFFER, and the list is a fact about the model rather
 * than a gap. `EDITABLE` in cardelements.js is seven fields — box, enabled,
 * align, ink, family, weight, opacity — so there is no order to change, nothing
 * to duplicate and nothing to delete. A card part is hidden from its own eye
 * and put back from the same control. Drawing a Duplicate here would be a
 * control over machinery that does not exist, which this screen has declined
 * twice before.
 */
const sel = ref('')
const also = ref([])

/*
 * A DRAWING IS KNOWN BY BEING IN THE LIST, NOT BY ITS NAME. The printed tab
 * tells its two lists apart by a leading `d`; here a card PART is called
 * `draw`, so that test would take the draw date for something somebody drew.
 */
const decoIds = computed(() => new Set(props.decorations.map((d) => d.id)))
const isDeco = (id) => decoIds.value.has(id)
const things = computed(() => [...props.parts, ...props.decorations])
const thingById = (id) => things.value.find((t) => t.id === id) || null

const picked = computed(() => {
  const live = new Set([...props.parts.filter((p) => !p.locked).map((p) => p.id), ...decoIds.value])
  const out = []
  for (const id of [sel.value, ...also.value]) {
    if (id && live.has(id) && !out.includes(id)) out.push(id)
  }
  return out
})
/* In the model's own order, never the order somebody clicked — see the printed
   tab, where the same list feeds distribute's sort. */
const pickedParts = computed(() => {
  const want = new Set(picked.value)
  return things.value.filter((p) => want.has(p.id))
})
const pickedDecos = computed(() => props.decorations.filter((d) => picked.value.includes(d.id)))
const many = computed(() => picked.value.length > 1)

const chosen = computed(() => props.parts.find((p) => p.id === sel.value) || null)
const chosenDeco = computed(() => props.decorations.find((d) => d.id === sel.value) || null)
const chosenThing = computed(() => thingById(sel.value))
const watermark = computed(() => props.parts.find((p) => p.id === 'watermark') || null)
const shown = computed(() => props.parts.filter((p) => p.enabled !== false).length)

/* Drawn back to front in the layer list, which is how every layer list in
   every drawing program reads: what is nearest the eye is nearest the top. */
const layers = computed(() => [...props.parts].reverse())

function pick(id, add = false, solo = false) {
  const part = thingById(id)
  /* The background is the card itself. It can be the primary so the inspector
     can say what it is, but it cannot join a multi-selection — aligning the
     card to itself is the kind of button that does nothing and looks broken. */
  if (add && (!part || part.locked)) return
  /* A drawing in a group comes with its group, as on the printed tab; ⌘ takes
     the one part. */
  if (!add) {
    sel.value = id
    also.value = isDeco(id) && !solo ? expandGroups([id], props.decorations).filter((x) => x !== id) : []
  } else if (id === sel.value) {
    sel.value = also.value[0] || ''
    also.value = also.value.slice(1)
  } else if (also.value.includes(id)) {
    also.value = also.value.filter((x) => x !== id)
  } else if (sel.value) {
    also.value = [...also.value, sel.value]
    sel.value = id
  } else {
    sel.value = id
  }
}

/*
 * ARRANGING, against the same arithmetic the printed tab uses. One box aligns
 * to the card; several align to each other.
 */
const alignWithin = () => (many.value
  ? boundsOf(pickedParts.value.map((p) => p.box))
  : { left: 0, top: 0, width: 1, height: 1 })

function alignPicked(edge) {
  if (!pickedParts.value.length) return
  emit('mark')
  const out = alignBoxes(pickedParts.value.map((p) => p.box), edge, alignWithin())
  pickedParts.value.forEach((p, i) => { p.box.left = out[i].left; p.box.top = out[i].top })
}

function distributePicked(axis) {
  if (pickedParts.value.length < 3) return
  emit('mark')
  const out = distributeBoxes(pickedParts.value.map((p) => p.box), axis)
  pickedParts.value.forEach((p, i) => { p.box.left = out[i].left; p.box.top = out[i].top })
}

const whyNoSelection = computed(() => (picked.value.length ? '' : 'Nothing is selected'))
const whyNotDistribute = computed(() => (
  picked.value.length >= 3 ? ''
    : picked.value.length ? 'Spacing needs three or more — shift-click to add to the selection'
      : 'Nothing is selected'))

/* ---------- the canvas ---------- */

const stage = ref(null)
const frame = ref(null)
const zoom = ref(0.5)
const ZOOMS = [0.15, 0.25, 0.33, 0.5, 0.75, 1, 1.5]
const frameWidth = computed(() => Math.round(size.value.width * zoom.value))

function stepZoom(dir) {
  const i = ZOOMS.findIndex((z) => z >= zoom.value - 1e-6)
  zoom.value = dir > 0 ? ZOOMS[Math.min(ZOOMS.length - 1, i + 1)] : ZOOMS[Math.max(0, i - 1)]
}

/*
 * FIT MEASURES BOTH AXES, unlike the printed tab's, and it has to: Stub is
 * 1080 × 1920. Fitting that to the width alone puts a card two and a half
 * screens tall in a box you then scroll, which is not a view of a card.
 */
function fitToStage() {
  const el = stage.value
  if (!el || !el.clientWidth) return
  const byW = (el.clientWidth - 40) / size.value.width
  const byH = Math.max(200, el.clientHeight - 40) / size.value.height
  zoom.value = Math.max(0.05, Math.min(byW, byH))
}

onMounted(() => nextTick(fitToStage))
watch(() => props.card.design, () => { sel.value = ''; nextTick(fitToStage) })

const showGuides = ref(true)
const showSafe = ref(true)
/* The same control the Place tab calls "Every box", and the same default.
   With ten parts on a card the size of a postcard, every outline at once is
   how you find the one you want; one at a time is how you judge the card. */
const showAllBoxes = ref(true)
const snapping = ref(true)
const gridding = ref(true)
const asSent = ref(false)
const GRID_PX = 8

/*
 * A GRID IN PIXELS, NOT MILLIMETRES, which is the one real difference from the
 * printed tab's tools. Paper has a size in the hand and a grid on it is a
 * measurement; this card only ever exists as pixels in a message, so a grid in
 * millimetres would be a unit the object does not have.
 */
const gridX = computed(() => (gridding.value ? GRID_PX / size.value.width : 0))
const gridY = computed(() => (gridding.value ? GRID_PX / size.value.height : 0))

/*
 * THE GRID IS DRAWN ONLY WHEN IT CAN BE READ. At 50% a 8 px grid is four
 * screen pixels apart, which is not a grid — it is a moiré over somebody's
 * card, and it makes the thing being judged harder to see rather than easier.
 * Snapping is unaffected: the grid is still there to snap to at every zoom,
 * and the tool in the status bar is what says so.
 */
const gridVisible = computed(() => GRID_PX * zoom.value >= 6)

const SNAP = 0.006

function snapTo(value, candidates, step) {
  let best = value
  let dist = SNAP
  if (snapping.value) {
    for (const c of candidates) {
      const d = Math.abs(c - value)
      if (d < dist) { dist = d; best = c }
    }
  }
  if (step > 0) {
    const g = Math.round(value / step) * step
    if (Math.abs(g - value) < dist) { dist = Math.abs(g - value); best = g }
  }
  return best
}

/* The card's own edges and middles, plus every other part's edges. The middles
   matter more here than on paper: Certificate is a centred treatment and Stub
   centres its code, so "the middle of the card" is a line things belong on. */
function edgesExcept(id) {
  const xs = [0, 0.5, 1]
  const ys = [0, 0.5, 1]
  const skip = id instanceof Set ? id : new Set([id])
  for (const p of things.value) {
    if (skip.has(p.id) || p.locked || p.enabled === false) continue
    xs.push(p.box.left, p.box.left + p.box.width)
    ys.push(p.box.top, p.box.top + p.box.height)
  }
  return { xs, ys }
}

const drag = ref(null)
const share = (v) => Math.round(v * 1e7) / 1e7

function perShare() {
  const el = frame.value
  return { x: el?.clientWidth || 1, y: el?.clientHeight || 1 }
}

function startMove(part, ev) {
  if (props.hand) { ev.stopPropagation(); onFrameDown(ev); return }
  if (part.locked || part.enabled === false || asSent.value) return
  ev.stopPropagation()

  /* Shift selects and does not drag; ⌘ takes one part of a group. */
  if (ev.shiftKey) { pick(part.id, true); return }

  emit('mark')
  emit('drag', true)
  if (ev.metaKey || ev.ctrlKey) pick(part.id, false, true)
  else if (!picked.value.includes(part.id)) pick(part.id)
  /* ⌥-drag: a copy is dragged away and the original stays. Only drawings
     copy — a card part is one of a fixed set — so with parts in the
     selection the drag is an ordinary move. */
  /* The copies reach this component's props on the next render, not now —
     the parent owns the list — so the drag is built from the copy records,
     whose boxes are the originals' (they were made in place). Parts in the
     selection come along uncopied. */
  let group = pickedParts.value.filter((p) => p.id !== part.id && !p.locked).map((p) => ({ id: p.id, box: { ...p.box } }))
  let id = part.id
  if (ev.altKey && isDeco(part.id) && !penEditing.value) {
    const pairs = copyDrawings({ inPlace: true }, false)
    const mine = pairs.find((p) => p.from === part.id)
    if (mine) {
      id = mine.copy
      group = [
        ...pairs.filter((p) => p !== mine).map((p) => ({ id: p.copy, box: { ...p.box } })),
        ...group.filter((g) => !isDeco(g.id)),
      ]
    }
  }
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = {
    mode: 'move', id, px: ev.clientX, py: ev.clientY, box: { ...part.box }, group,
  }
}

function startResize(part, corner, ev) {
  ev.stopPropagation()
  if (part.locked) return
  emit('mark')
  emit('drag', true)
  sel.value = part.id
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'resize', corner, id: part.id, px: ev.clientX, py: ev.clientY, box: { ...part.box } }
}

function onPointerMove(ev) {
  const st = drag.value
  if (!st && penDrawing.value) { pen.move(pointOf(ev), ev); return }
  if (!st) return
  if (st.mode === 'pen') { pen.move(pointOf(ev), ev); return }
  if (st.mode === 'grip') { pen.gripMove(pointOf(ev), ev); return }
  if (st.mode === 'pan') {
    if (stage.value) {
      stage.value.scrollLeft = st.sl - (ev.clientX - st.px)
      stage.value.scrollTop = st.st - (ev.clientY - st.py)
    }
    return
  }
  if (st.mode === 'draw') {
    const [left, top] = pointOf(ev)
    drawn.value = drawBox(st.origin, { left, top }, {
      square: ev.shiftKey, centre: ev.altKey, line: pending.value === 'line',
      aspect: size.value.width / size.value.height,
    })
    return
  }
  const span = perShare()
  const dx = (ev.clientX - st.px) / span.x
  const dy = (ev.clientY - st.py) / span.y
  const part = thingById(st.id)
  if (!part) return
  const { xs, ys } = edgesExcept(new Set([st.id, ...(st.group || []).map((g) => g.id)]))
  const sx = (v) => snapTo(v, xs, gridX.value)
  const sy = (v) => snapTo(v, ys, gridY.value)

  if (st.mode === 'move') {
    const left = sx(st.box.left + dx)
    const right = sx(st.box.left + dx + st.box.width) - st.box.width
    const top = sy(st.box.top + dy)
    const bottom = sy(st.box.top + dy + st.box.height) - st.box.height
    const wantX = st.box.left + dx
    const wantY = st.box.top + dy
    part.box.left = share(Math.abs(left - wantX) <= Math.abs(right - wantX) ? left : right)
    part.box.top = share(Math.abs(top - wantY) <= Math.abs(bottom - wantY) ? top : bottom)

    /* The rest of the selection follows the primary's SETTLED position, not the
       pointer delta: snapping moves the primary further than the pointer went,
       and the raw delta would shear the group apart by the snap distance every
       time it caught. Same reasoning as the printed tab. */
    for (const g of st.group || []) {
      const other = thingById(g.id)
      if (!other) continue
      other.box.left = share(g.box.left + (part.box.left - st.box.left))
      other.box.top = share(g.box.top + (part.box.top - st.box.top))
    }
    return
  }

  const c = st.corner
  /*
   * A QR IS RESIZED AS A SQUARE WHATEVER CORNER IS DRAGGED, and the whole
   * gesture leads on the horizontal because that is the axis a pointer moves
   * furthest. A stretched code is not a smaller code, it is one that no longer
   * scans, so this is not a preference that belongs to the person dragging.
   */
  /* ⌥: the opposite edge mirrors the dragged one, about the middle. */
  const centred = () => {
    if (!ev.altKey) return
    const b = aboutCentre(st.box, part.box, 0.005)
    part.box.left = share(b.left); part.box.top = share(b.top)
    part.box.width = share(b.width); part.box.height = share(b.height)
  }
  if (part.square) {
    const w = Math.max(0.01, c.includes('w') ? st.box.width - dx : st.box.width + dx)
    const h = share(w * (size.value.width / size.value.height))
    if (c.includes('w')) part.box.left = share(st.box.left + st.box.width - w)
    if (c.includes('n')) part.box.top = share(st.box.top + st.box.height - h)
    part.box.width = share(w)
    part.box.height = h
    centred()
    return
  }
  if (c.includes('e')) part.box.width = share(Math.max(0.005, sx(st.box.left + st.box.width + dx) - st.box.left))
  if (c.includes('s')) part.box.height = share(Math.max(0.005, sy(st.box.top + st.box.height + dy) - st.box.top))
  if (c.includes('w')) {
    const left = sx(st.box.left + dx)
    const right = st.box.left + st.box.width
    part.box.left = share(Math.min(left, right - 0.005))
    part.box.width = share(right - part.box.left)
  }
  if (c.includes('n')) {
    const top = sy(st.box.top + dy)
    const bottom = st.box.top + st.box.height
    part.box.top = share(Math.min(top, bottom - 0.005))
    part.box.height = share(bottom - part.box.top)
  }
  centred()
}

function endPointer() {
  const st = drag.value
  if (st?.mode === 'pen') pen.up()
  if (st?.mode === 'grip') pen.gripUp()
  if (st?.mode === 'draw') {
    const b = drawn.value
    const tiny = !b || (b.width < 0.01 && b.height < 0.01)
    const box = !tiny ? b : { left: st.origin.left, top: st.origin.top, width: 0.2, height: pending.value === 'line' ? 0 : 0.15 }
    addDeco(pending.value, box)
  }
  drawn.value = null
  drag.value = null
  emit('drag', false)
}

/* Arrow keys nudge one pixel of the card, Shift ten — the step every drawing
   program uses, and in shares so it is the same distance at any zoom. The
   whole selection moves, as a drag moves it; a pinned thing stays. */
function nudge(ev) {
  const n = ev.shiftKey ? 10 : 1
  const map = {
    ArrowLeft: [-n / size.value.width, 0], ArrowRight: [n / size.value.width, 0],
    ArrowUp: [0, -n / size.value.height], ArrowDown: [0, n / size.value.height],
  }
  const d = map[ev.key]
  if (!d) return false
  if (penEditing.value && chosenNode.value >= 0) return pen.nudgeNode(d[0], d[1])
  const movers = pickedParts.value.filter((t) => !t.locked && t.enabled !== false)
  if (!movers.length) return false
  emit('mark')
  for (const t of movers) {
    t.box.left = share(t.box.left + d[0])
    t.box.top = share(t.box.top + d[1])
  }
  return true
}

const pc = (v) => `${(Number(v) * 100).toFixed(1)}%`

/*
 * ---------- drawing on the card (STUDIO-ESSENTIALS Phase 9) ----------
 *
 * The same seven tools as the printed tab and the same model, so a rule, a
 * picture or a path drawn here is the same record the printed side draws. What
 * differs is only where it is stored — per treatment, beside the card — and
 * that the card's own PARTS still cannot be added or removed: a drawing sits
 * on top of them and comes off again, which is the reversibility the
 * no-adding rule was protecting (STUDIO-REDESIGN §13, reversed 2026-09-22).
 */
const TOOLS = [
  { kind: 'rect', icon: 'shape', label: 'Rectangle', hint: 'A panel, a tint, a border' },
  { kind: 'ellipse', icon: 'ellipse', label: 'Ellipse', hint: 'An ellipse or a circle' },
  { kind: 'line', icon: 'minus', label: 'Line', hint: 'A rule — drag it flat for a level one' },
  { kind: 'text', icon: 'type', label: 'Words', hint: 'Words of your own, the same on every card' },
  { kind: 'icon', icon: 'design', label: 'Mark', hint: "One of the app's own drawings" },
  { kind: 'path', icon: 'pen', label: 'Pen', hint: 'Click for corners, drag for curves, click the first point to close' },
]
/* The key a tooltip names, from the one table — "Rectangle · R". */
const keyOf = (id) => keyLabel(KEYS.find((k) => k.id === id))
/* As pairs, not an object literal: the icons gate reads every `icon: '…'` in
   the source as a glyph being asked for, and the Mark tool's kind is `icon`. */
const TOOL_KEY = Object.fromEntries([['rect', 'toolRect'], ['ellipse', 'toolEllipse'], ['line', 'toolLine'],
  ['text', 'toolWords'], ['icon', 'toolMark'], ['path', 'toolPen']])

const pending = ref('')
const drawn = ref(null)
const pendingPicture = ref('')
const showPictures = ref(false)
const changingPicture = ref('')

function pointOf(ev) {
  const r = frame.value?.getBoundingClientRect()
  if (!r || !r.width) return [0, 0]
  return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]
}

function beginDraw(kind) {
  pending.value = pending.value === kind ? '' : kind
  sel.value = ''
  also.value = []
}

function addDeco(kind, box, extra = {}) {
  if (!kind) return
  emit('mark')
  const colour = palette.value?.ink || '#111111'
  const made = normalDecoration({
    id: nextDecoId(), kind, box,
    fill: { type: kind === 'line' || kind === 'image' || kind === 'path' ? 'none' : 'solid', colour },
    stroke: kind === 'line' || kind === 'path' ? { width: 0.003, colour } : { width: 0, colour },
    text: kind === 'text' ? { value: 'Your words' } : {},
    icon: kind === 'icon' ? { name: 'ticket' } : {},
    image: kind === 'image' ? { src: pendingPicture.value, fit: 'contain' } : {},
    ...extra,
  })
  emit('set-decorations', [...props.decorations, made])
  sel.value = made.id
  also.value = []
  pending.value = ''
  pendingPicture.value = ''
}

const pen = usePen({
  aspect: () => size.value.width / size.value.height,
  mark: () => emit('mark'),
  target: () => chosenDeco.value,
  place: (p) => addDeco('path', p.box, { path: p.path }),
})
const { drawing: penDrawing, draftNodes, editing: penEditing, handles: penHandles, chosenNode } = pen
const cardPx = ([x, y]) => [x * size.value.width, y * size.value.height]
const penDraftD = computed(() => pathData(draftNodes.value, false, cardPx))
const penEditD = computed(() => (penHandles.value.length && chosenDeco.value
  ? pathData(penHandles.value, chosenDeco.value.path.closed, cardPx) : ''))
const penPoints = computed(() => (penDrawing.value ? penDrawing.value.nodes : penHandles.value))
watch(sel, (id) => { if (penEditing.value && id !== penEditing.value) pen.leave() })
watch(pending, (p) => { if (p !== 'path' && penDrawing.value) pen.cancel() })

function onFrameDown(ev) {
  if (props.hand) {
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    drag.value = { mode: 'pan', px: ev.clientX, py: ev.clientY,
      sl: stage.value?.scrollLeft || 0, st: stage.value?.scrollTop || 0 }
    return
  }
  if (asSent.value) return
  if (pending.value === 'path') {
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    pen.down(pointOf(ev), ev)
    drag.value = { mode: 'pen' }
    return
  }
  if (pending.value) {
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    const [left, top] = pointOf(ev)
    drag.value = { mode: 'draw', origin: { left, top } }
    return
  }
  if (penEditing.value) {
    if (ev.altKey && pen.addNodeAt(pointOf(ev))) return
    pen.leave()
  }
  sel.value = ''
  also.value = []
}

function gripPen(i, which, ev) {
  if (penDrawing.value) return
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  pen.gripDown(i, which, pointOf(ev))
  drag.value = { mode: 'grip' }
}

/* Drawings come off; parts are hidden, never removed. */
const whyNoRemove = computed(() => (pickedDecos.value.length ? ''
  : picked.value.length ? "The card's own parts are hidden with their eye, not removed"
    : 'Nothing is selected'))
function removeDecos() {
  if (whyNoRemove.value) return
  emit('mark')
  const going = new Set(pickedDecos.value.map((d) => d.id))
  emit('set-decorations', props.decorations.filter((d) => !going.has(d.id)))
  sel.value = ''
  also.value = []
}

/* The library, placing onto this card. Saving goes up to the parent, which
   owns the library write — the same one the printed tab uses. */
function placeFromLibrary(shape) {
  emit('mark')
  const made = placeShape(shape, { left: 0.35, top: 0.35, width: 0.3, height: 0.3 }, nextDecoId)
  const g = made.length > 1 ? nextGroupId() : ''
  for (const d of made) d.group = g
  emit('set-decorations', [...props.decorations, ...made])
  sel.value = made[0]?.id || ''
  also.value = made.slice(1).map((d) => d.id)
}
function useColour(value) {
  if (!pickedParts.value.length) return
  emit('mark')
  for (const t of pickedParts.value) {
    if (isDeco(t.id)) t.fill.colour = value
    else t.ink = value
  }
}
const pickedLettering = computed(() => {
  const d = pickedDecos.value.find((x) => x.kind === 'text')
  if (d) return { family: d.text.family, weight: d.text.weight, align: d.text.align, tracking: d.text.tracking || 0, colour: d.fill.colour }
  const p = pickedParts.value.find((x) => !isDeco(x.id) && x.textual)
  return p ? { family: p.family, weight: p.weight, align: p.align, tracking: 0, colour: p.ink || '' } : null
})
function useStyle(style) {
  const list = pickedParts.value.filter((t) => (isDeco(t.id) ? t.kind === 'text' : t.textual))
  if (!list.length) return
  emit('mark')
  for (const t of list) {
    if (isDeco(t.id)) {
      Object.assign(t.text, { family: style.family, weight: style.weight, align: style.align, tracking: style.tracking || 0 })
      if (style.colour) t.fill.colour = style.colour
    } else {
      Object.assign(t, { family: style.family, weight: style.weight, align: style.align })
      if (style.colour) t.ink = style.colour
    }
  }
}

function openPictures() {
  if (!props.pictures.length) return
  changingPicture.value = ''
  showPictures.value = true
}
function pickPicture(src) {
  showPictures.value = false
  const d = changingPicture.value && props.decorations.find((x) => x.id === changingPicture.value)
  changingPicture.value = ''
  if (d) { emit('mark'); d.image.src = src; return }
  pendingPicture.value = src
  if (pending.value !== 'image') beginDraw('image')
}

/* Drawn back to front, like the parts' list; drawings sit over every part. */
const drawnLayers = computed(() => [...props.decorations].reverse())
const decoIcon = (k) => ({ text: 'type', icon: 'design', image: 'image', path: 'pen' }[k] || 'shape')
/* The word for a kind — `icon` handled on its own, because the icons gate reads
   every `icon: '…'` in the source as a glyph being asked for. */
const DECO_WORD = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Rule', text: 'Words', image: 'Picture', path: 'Path' }
const decoName = (d) => d.name || (d.kind === 'icon' ? 'Mark' : DECO_WORD[d.kind] || 'Shape')

/*
 * WHERE THE SAFE AREA COMES FROM, because a guide nobody can justify is a line
 * on a screen. A chat list thumbnail and the little preview above a reply are
 * a CENTRED SQUARE crop of the picture. Everything outside that square is
 * still in the card the buyer opens; it is simply not in the two places the
 * card is seen smallest. So the guide says "keep the number and the mark
 * inside this", which is the only decision it is asking for.
 */
const safeBox = computed(() => {
  const { width: w, height: h } = size.value
  const side = Math.min(w, h)
  return {
    left: (w - side) / 2 / w, top: (h - side) / 2 / h,
    width: side / w, height: side / h,
  }
})

/*
 * HOW SMALL ONE SQUARE OF THE QR LANDS, at the width the picture is actually
 * sent. The same question the printed tab asks in millimetres, asked in the
 * unit this object has. Under about two pixels a square, a code that has been
 * through a chat's own recompression twice stops scanning reliably.
 */
const qrDensity = computed(() => {
  const part = props.parts.find((p) => p.id === 'code')
  if (!part || part.enabled === false) return null
  let span = 41
  try { span = encode(specimenUrl.value, { ecc: 'M' }).size + 8 } catch { /* keep the default */ }
  const onCard = part.box.width * size.value.width
  const sent = onCard * (props.sentWidth / size.value.width)
  return { px: sent / span, ok: sent / span >= 2, sentWidth: props.sentWidth }
})

/* ---------- a test of the real thing ---------- */

/*
 * SEND A TEST — the specimen card, as a picture, through the same door a real
 * one goes out of.
 *
 * It rasterises the SAME SVG this screen is showing rather than asking the
 * server for anything, which is what makes it a test of the design and not of
 * the network. Nothing cross-origin goes into the canvas — the card is drawn
 * entirely from the raffle's colours and a QR made of rectangles — so
 * `toBlob` cannot be tainted, which is the failure the printed side's share
 * has to carry a fallback for.
 *
 * SHARE IF THE MACHINE CAN, DOWNLOAD IF IT CANNOT, and say which happened. A
 * desktop browser's share sheet often has no WhatsApp in it; the file in the
 * Downloads folder is the honest version of the same offer.
 */
const testing = ref(false)
const testNote = ref('')

async function sendTest() {
  testing.value = true
  testNote.value = ''
  try {
    const { width: W, height: H } = size.value
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('this browser cannot draw the picture')
    /* A picture drawn on the card is an address, and an SVG drawn through an
       <img> may not load anything from outside itself — so it would come out
       blank. Inlined first; anything that could not be fetched is named. */
    const { svg: inlined, failed } = await inlineImages(preview.value, fetchAsDataURI)
    if (failed.length) testNote.value = `${failed.length} picture(s) could not be fetched and are missing.`
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = () => rej(new Error('the card could not be drawn'))
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inlined)}`
    })
    ctx.drawImage(img, 0, 0, W, H)
    const blob = await new Promise((res, rej) => {
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('the picture came back empty'))), 'image/jpeg', 0.92)
    })
    const file = new File([blob], 'specimen-ticket.jpg', { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: 'A specimen ticket — not a real one.' })
      testNote.value = 'Handed to whatever this machine shares with.'
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'specimen-ticket.jpg'
    a.click()
    URL.revokeObjectURL(url)
    testNote.value = 'Saved to Downloads — this machine has nothing to share to.'
  } catch (err) {
    testNote.value = String(err?.message || err)
  } finally {
    testing.value = false
  }
}

/*
 * ---------- the keys, on the card ----------
 *
 * The studio owns the keyboard (src/lib/studiokeys.js) and hands every
 * 'canvas' key to whichever surface is showing. These are the card's answers,
 * against the card's own selection and history. What differs from the printed
 * tab is only what the card allows: its PARTS are a fixed set, so copy, cut,
 * paste, duplicate, remove, group and stacking act on the drawings in the
 * selection and leave the parts where they are. A key that has nothing to act
 * on answers false and is left to the page.
 */
const clip = ref(null)
let pastes = 0
const lastCopies = ref(null)

/** Copies of the selected drawings, or of a clip, added to the card. */
function copyDrawings(opts = {}, withMark = true, source = null) {
  const from = source || copyRecords([], props.decorations, pickedDecos.value.map((d) => d.id))
  if (!from.decorations.length) return []
  if (withMark) emit('mark')
  const got = pasteRecords(from, { nextId: () => '', nextDecoId, nextGroupId, ...opts })
  const made = got.decorations.map(normalDecoration)
  emit('set-decorations', [...props.decorations, ...made])
  sel.value = made[0]?.id || ''
  also.value = made.slice(1).map((d) => d.id)
  lastCopies.value = got.pairs
  return got.pairs
}

const chooseTool = (kind) => () => { if (pending.value !== kind) beginDraw(kind) }
const drawingsOnly = (f) => () => (pickedDecos.value.length ? f() : false)

function orderDrawings(move) {
  const ids = pickedDecos.value.map((d) => d.id)
  if (!ids.length) return false
  emit('mark')
  const by = Object.fromEntries(props.decorations.map((d) => [d.id, d]))
  emit('set-decorations', orderMoved(props.decorations.map((d) => d.id), ids, move).map((id) => by[id]))
  return true
}

/* A double-click on a grouped drawing takes that one part; on a path it puts
   the nodes up. Escape comes back out. */
function enterThing(d) {
  if (d.kind === 'path') { pick(d.id, false, true); pen.enter(d.id); return }
  if (d.group) pick(d.id, false, true)
}

const CARD_ACTIONS = {
  toolSelect: () => { pending.value = '' },
  toolRect: chooseTool('rect'),
  toolEllipse: chooseTool('ellipse'),
  toolLine: chooseTool('line'),
  toolWords: chooseTool('text'),
  toolMark: chooseTool('icon'),
  toolPen: chooseTool('path'),
  toolPicture: () => (props.pictures.length ? openPictures() : false),
  eyedropper: () => {
    if (!props.canDrop || !pickedParts.value.length) return false
    new window.EyeDropper().open().then((r) => useColour(String(r.sRGBHex).toUpperCase())).catch(() => {})
  },
  editNodes: () => (chosenDeco.value?.kind === 'path' ? (pen.enter(chosenDeco.value.id), true) : false),
  penFinish: () => (penDrawing.value ? pen.finish(false) || true : false),
  selectAll: () => {
    const live = things.value.filter((t) => t.enabled !== false && !t.locked).map((t) => t.id)
    sel.value = live[0] || ''
    also.value = live.slice(1)
  },
  deselect: () => { sel.value = ''; also.value = [] },
  escape: () => {
    if (penDrawing.value) { if (!pen.finish(false)) pen.cancel(); return }
    if (penEditing.value) { pen.leave(); return }
    if (pending.value) { pending.value = ''; return }
    const d = chosenDeco.value
    const whole = d?.group ? expandGroups([d.id], props.decorations) : []
    if (whole.length > picked.value.length) { pick(d.id); return }
    sel.value = ''
    also.value = []
  },
  copy: drawingsOnly(() => {
    clip.value = copyRecords([], props.decorations, pickedDecos.value.map((d) => d.id))
    pastes = 0
  }),
  cut: drawingsOnly(() => {
    clip.value = copyRecords([], props.decorations, pickedDecos.value.map((d) => d.id))
    pastes = 0
    removeDecos()
  }),
  paste: () => { if (!clip.value) return false; pastes += 1; copyDrawings({ times: pastes }, true, clip.value) },
  pasteInPlace: () => { if (!clip.value) return false; copyDrawings({ inPlace: true }, true, clip.value) },
  duplicate: drawingsOnly(() => {
    const step = repeatStep(lastCopies.value, picked.value, (id) => thingById(id)?.box)
    copyDrawings(step ? { step } : {})
  }),
  remove: () => {
    if (penEditing.value && chosenNode.value >= 0) return pen.removeChosen()
    return pickedDecos.value.length ? removeDecos() : false
  },
  group: () => {
    if (pickedDecos.value.length < 2) return false
    emit('mark')
    const g = nextGroupId()
    for (const d of pickedDecos.value) d.group = g
  },
  ungroup: () => {
    if (!pickedDecos.value.some((d) => d.group)) return false
    emit('mark')
    for (const d of pickedDecos.value) d.group = ''
  },
  /* Only drawings pin: a card part that cannot move is the background, and
     that is the card's decision, not a toggle. */
  lock: drawingsOnly(() => {
    emit('mark')
    const pin = pickedDecos.value.some((d) => !d.locked)
    for (const d of pickedDecos.value) d.locked = pin
  }),
  bold: () => {
    const list = pickedParts.value.filter((t) => (isDeco(t.id) ? t.kind === 'text' : t.textual))
    if (!list.length) return false
    emit('mark')
    const weightOf = (t) => (isDeco(t.id) ? t.text.weight : t.weight)
    const next = list.every((t) => weightOf(t) === 'bold') ? 'regular' : 'bold'
    for (const t of list) { if (isDeco(t.id)) t.text.weight = next; else t.weight = next }
  },
  nudge: (e) => nudge(e),
  forward: () => orderDrawings('forward'),
  backward: () => orderDrawings('backward'),
  front: () => orderDrawings('front'),
  back: () => orderDrawings('back'),
  zoomIn: () => stepZoom(1),
  zoomOut: () => stepZoom(-1),
  fit: () => fitToStage(),
  actual: () => { zoom.value = 1 },
  alignLeft: () => alignPicked('left'),
  alignCentre: () => alignPicked('centre'),
  alignRight: () => alignPicked('right'),
  alignTop: () => alignPicked('top'),
  alignMiddle: () => alignPicked('middle'),
  alignBottom: () => alignPicked('bottom'),
  spaceAcross: () => distributePicked('across'),
  spaceDown: () => distributePicked('down'),
  toggleSnap: () => { snapping.value = !snapping.value },
  toggleGrid: () => { gridding.value = !gridding.value },
}

/** What the studio calls with a key. `undefined` means "not the card's —
    the studio answers it" (the hand); false means "nothing to act on". */
function act(name, e = {}) {
  const f = CARD_ACTIONS[name]
  return f ? f(e) : undefined
}

/* ⌘-scroll and a pinch zoom about the pointer, as on the printed tab. */
function onWheel(ev) {
  if (!(ev.ctrlKey || ev.metaKey)) return
  ev.preventDefault()
  const el = stage.value
  const before = zoom.value
  const next = Math.max(0.05, Math.min(4, before * Math.exp(-ev.deltaY * 0.01)))
  if (!el) { zoom.value = next; return }
  const r = el.getBoundingClientRect()
  const px = ev.clientX - r.left + el.scrollLeft
  const py = ev.clientY - r.top + el.scrollTop
  zoom.value = next
  nextTick(() => {
    el.scrollLeft = px * (next / before) - (ev.clientX - r.left)
    el.scrollTop = py * (next / before) - (ev.clientY - r.top)
  })
}

defineExpose({ sendTest, testing, act })
</script>

<template>
<div class="studio">
  <!-- ---------- the layers rail ---------- -->
  <aside class="rail">
    <div class="block">
      <h3 class="rubric">Treatment</h3>
      <div class="seg">
        <button v-for="d in CARD_DESIGNS" :key="d.id" type="button" class="segbtn"
                :class="{ on: card.design === d.id }" :title="d.note"
                @click="card.design = d.id">{{ d.name }}</button>
      </div>
      <p class="say">{{ CARD_DESIGNS.find((d) => d.id === card.design)?.note }}</p>
    </div>

    <!-- DRAWING ON THE CARD: the printed tab's tools, onto this treatment. -->
    <div class="block">
      <h3 class="rubric">Draw</h3>
      <ToolBar label="Draw on the card">
        <ToolButton v-for="t in TOOLS" :key="t.kind" :icon="t.icon" :label="t.label" :size="17"
                    :active="pending === t.kind" :hint="t.hint" :keys="keyOf(TOOL_KEY[t.kind])" @click="beginDraw(t.kind)" />
        <ToolButton icon="image" label="Picture" :size="17" :active="pending === 'image'" :keys="keyOf('toolPicture')"
                    :why="pictures.length ? '' : 'There are no pictures yet — upload a logo in Setup, or artwork on the Artwork tab'"
                    hint="The raffle's logo or an uploaded artwork, placed on the card"
                    @click="openPictures" />
      </ToolBar>
    </div>

    <LibraryPanel
      :library="library" :selected="pickedDecos" :lettering="pickedLettering" :busy="libBusy"
      @place="placeFromLibrary" @save="(s) => emit('save-shape', s)"
      @save-colour="(c) => emit('save-colour', c)" @remove="(id) => emit('remove-shape', id)"
      @remove-colour="(id) => emit('remove-colour', id)" @use-colour="useColour"
      @save-style="(t) => emit('save-style', t)" @remove-style="(id) => emit('remove-style', id)"
      @use-style="useStyle" />

    <div class="block grow">
      <p class="rubric halfhead">
        Layers
        <span class="count data">{{ shown }} of {{ parts.length }} shown</span>
      </p>
      <!-- DRAWN FIRST, because it draws over every part of the card. -->
      <template v-if="decorations.length">
        <p class="rubric halfhead">Drawn <span class="count data">&middot; {{ decorations.length }}</span></p>
        <ul class="ellist">
          <li v-for="d in drawnLayers" :key="d.id" :class="{ on: sel === d.id, off: d.enabled === false }">
            <Icon :name="decoIcon(d.kind)" :size="15" class="kind" :title="decoName(d)" />
            <button type="button" class="elname"
                    @click="pick(d.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)">{{ decoName(d) }}</button>
            <Toggle v-model="d.enabled" :label="decoName(d)" :size="15" />
          </li>
        </ul>
        <p class="rubric halfhead">The card</p>
      </template>
      <ul class="ellist">
        <li v-for="p in layers" :key="p.id"
            :class="{ on: sel === p.id, off: p.enabled === false }">
          <Icon :name="p.kind" :size="15" class="kind" :class="p.kind" :title="p.what" />
          <button type="button" class="elname"
                  @click="pick(p.id, $event.shiftKey || $event.metaKey)">{{ p.name }}</button>
          <!--
            THE BACKGROUND HAS NO EYE AND SAYS WHY, rather than having one that
            does nothing or none at all with no explanation. This is the rule
            the rest of the app is held to for permissions and it is the right
            one here: an absent control is indistinguishable from a bug.
          -->
          <Toggle v-model="p.enabled" :label="p.name" :size="15"
                  :why="p.locked ? 'The background is the card itself — there is nothing behind it to show.' : ''" />
        </li>
      </ul>
      <p class="say" title="The parts of the card are this app's own drawing, not artwork you place things on.">
        These parts are the card: hidden, never removed. Draw over them instead.
      </p>
    </div>

    <div class="block">
      <h3 class="rubric">Canvas</h3>
      <!-- Tools that act at once, so pressed buttons rather than tick boxes —
           the Place tab made the same change (STUDIO-ESSENTIALS A5). -->
      <ToolBar label="What the canvas shows">
        <ToolButton :icon="showAllBoxes ? 'preview' : 'previewOff'" label="Every box" wide :size="15"
                    :active="showAllBoxes" hint="Outline every part and drawing, not only the selected one"
                    @click="showAllBoxes = !showAllBoxes" />
        <ToolButton icon="grid" label="Guides" wide :size="15" :active="showGuides"
                    hint="The grid and the card's centre lines" @click="showGuides = !showGuides" />
        <ToolButton icon="margins" label="Safe area" wide :size="15" :active="showSafe"
                    hint="A chat list thumbnail and the preview above a reply show a centred square of the picture. Keep the number and the mark inside it."
                    @click="showSafe = !showSafe" />
      </ToolBar>
      <p class="say" title="Everything outside it is still on the card somebody opens.">
        The square a chat list crops to.
      </p>
    </div>
  </aside>

  <!-- ---------- the canvas ---------- -->
  <div class="stagewrap">
    <div class="stagebar">
      <span class="say">what the buyer receives</span>
      <span class="specs data">{{ size.width }} &times; {{ size.height }} px</span>
      <span class="grow"></span>
      <span v-if="testNote" class="tiny muted">{{ testNote }}</span>
    </div>

    <!--
      THE ARRANGE RAIL, and it is SHORTER THAN THE PLACE TAB'S ON PURPOSE.

      Five tools, not eleven. A card part cannot be reordered, duplicated or
      deleted — `EDITABLE` in cardelements.js is seven fields and none of them
      is a position in the stack — so drawing those four here would be controls
      over machinery that does not exist. The parts are hidden from their own
      eye in the layer list and put back from the same control, which is the
      reversible version of removing one.

      It is hidden in "Preview as sent", where there is nothing to arrange:
      that mode exists to show the card with none of the studio on top.
    -->
    <div class="withrail">
    <ToolBar v-if="!asSent" label="Arrange" vertical>
      <span class="tgroup">
        <ToolButton icon="alignLeft" label="Align left" :why="whyNoSelection"
                    :hint="many ? 'Line the selected parts up on their left edges'
                                : 'Put this part against the left edge of the card'"
                    @click="alignPicked('left')" />
        <ToolButton icon="alignCentre" label="Centre across" :why="whyNoSelection"
                    :hint="many ? 'Centre the selected parts on each other, across'
                                : 'Centre this part across the card'"
                    @click="alignPicked('centre')" />
        <ToolButton icon="alignMiddle" label="Centre down" :why="whyNoSelection"
                    :hint="many ? 'Centre the selected parts on each other, down'
                                : 'Centre this part down the card'"
                    @click="alignPicked('middle')" />
      </span>
      <span class="tgroup">
        <ToolButton icon="distribute" label="Space across" :why="whyNotDistribute"
                    hint="Even gaps between the selected parts, left to right. The outermost two stay where they are."
                    @click="distributePicked('across')" />
        <ToolButton icon="distributeV" label="Space down" :why="whyNotDistribute"
                    hint="Even gaps between the selected parts, top to bottom"
                    @click="distributePicked('down')" />
      </span>
      <span class="tgroup">
        <ToolButton icon="trash" label="Remove" :why="whyNoRemove" :keys="keyOf('remove')"
                    hint="Take the selected drawings off the card. The card's own parts stay"
                    @click="removeDecos" />
      </span>
    </ToolBar>

    <div ref="stage" class="stage" :class="{ sent: asSent }" @wheel="onWheel">
      <!--
        AS SENT: the card at the width a chat gives it, on something that is
        not the studio's own surface. No rulers, no boxes, nothing to drag —
        the whole point is to stop seeing the design and see the picture.
      -->
      <div v-if="asSent" class="bubble">
        <div class="sentcard" v-html="preview"></div>
        <p class="tiny">Thank you — this keeps the shelter open.</p>
      </div>

      <template v-else>
        <!--
          THE QUARTER MARKS GO WHEN THERE IS NO ROOM FOR THEM. Stub fitted to
          a studio column is about 160 px across, and five labels in 160 px
          printed "50% 10<80>% px" — two readings on top of each other, which
          is worse than one. The card's own width is the label that has to
          survive, because it is the only absolute fact on the rule.
        -->
        <div class="ruler" :style="{ width: frameWidth + 'px' }">
          <span style="left:0">0</span>
          <template v-if="frameWidth >= 260">
            <span style="left:25%">25%</span>
            <span style="left:50%">50%</span>
            <span style="left:75%">75%</span>
          </template>
          <span class="right">{{ size.width }} px</span>
        </div>

        <div
          ref="frame" class="frame" :class="{ drawing: !!pending, panning: hand }"
          :style="{ width: frameWidth + 'px', height: Math.round(frameWidth * (size.height / size.width)) + 'px' }"
          @pointermove="onPointerMove" @pointerup="endPointer" @pointercancel="endPointer"
          @pointerdown="onFrameDown">
          <div class="cardart" v-html="preview"></div>

          <!-- The guides sit over the card and under the boxes: they are
               something to line up against, not something to select. -->
          <div v-if="showGuides && gridVisible" class="guides"
               :style="{ backgroundSize: `${GRID_PX * zoom}px ${GRID_PX * zoom}px` }"></div>
          <div v-if="showGuides" class="centreline v"></div>
          <div v-if="showGuides" class="centreline h"></div>
          <div v-if="showSafe" class="safe"
               :style="{ left: pc(safeBox.left), top: pc(safeBox.top), width: pc(safeBox.width), height: pc(safeBox.height) }">
            <span v-if="frameWidth >= 320" class="safetag">safe area</span>
          </div>

          <div
            v-for="p in parts" :key="p.id"
            class="ebox"
            :class="{ on: sel === p.id, too: also.includes(p.id), off: p.enabled === false,
                      locked: p.locked, faint: !picked.includes(p.id),
                      hidden: !showAllBoxes && !picked.includes(p.id) }"
            :style="{ left: pc(p.box.left), top: pc(p.box.top), width: pc(p.box.width), height: pc(p.box.height) }"
            :title="p.locked ? `${p.name} is the card itself` : `${p.name} — drag to move, or use the arrow keys`"
            @pointerdown="startMove(p, $event)">
            <button
              type="button" class="grab" :aria-label="p.name"
              :disabled="p.locked"
              :title="p.locked ? `${p.name} is the card itself` : `${p.name} — drag to move, or use the arrow keys`"
              @click.stop="pick(p.id, $event.shiftKey || $event.metaKey)"></button>
            <!-- The name on the selected box, as card 8c draws it: at a zoom
                 that fits a 1920px card, a highlighted rectangle is not
                 self-evidently the thing named in the list. -->
            <span v-if="sel === p.id" class="boxtag">{{ p.name }}</span>
            <!-- Handles on the primary alone: eight grips on each of five
                 selected boxes is forty over one card. -->
            <template v-if="sel === p.id && !many && !p.locked">
              <span v-for="c in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="c"
                    class="hdl" :class="c"
                    @pointerdown="startResize(p, c, $event)"></span>
            </template>
          </div>

          <!-- THE DRAWINGS' BOXES, over the parts' as the drawings are over the card. -->
          <div
            v-for="d in decorations" :key="d.id"
            class="ebox deco"
            :class="{ on: sel === d.id, too: also.includes(d.id), off: d.enabled === false,
                      faint: !picked.includes(d.id), hidden: !showAllBoxes && !picked.includes(d.id) }"
            :style="{ left: pc(d.box.left), top: pc(d.box.top), width: pc(d.box.width), height: pc(d.box.height) }"
            :title="`${decoName(d)} — drag to move, or use the arrow keys`"
            @pointerdown="startMove(d, $event)">
            <button
              type="button" class="grab" :aria-label="decoName(d)" :disabled="d.enabled === false || d.locked"
              @click.stop="pick(d.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)"
              @dblclick.stop="enterThing(d)"></button>
            <template v-if="sel === d.id && !many && !d.locked && penEditing !== d.id">
              <span v-for="c in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="c"
                    class="hdl" :class="c"
                    @pointerdown="startResize(d, c, $event)"></span>
            </template>
          </div>

          <div v-if="drawn" class="ebox drawnbox"
               :style="{ left: pc(drawn.left), top: pc(drawn.top), width: pc(drawn.width), height: pc(drawn.height) }"></div>

          <!-- The pen's layer, as on the printed tab: the path being drawn, or
               a selected path's nodes and handles. -->
          <svg v-if="penDraftD || penEditD" class="penlayer" aria-hidden="true"
               :viewBox="`0 0 ${size.width} ${size.height}`" preserveAspectRatio="none">
            <path v-if="penDraftD" :d="penDraftD" class="pendraft" />
            <path v-if="penEditD" :d="penEditD" class="penedit" />
          </svg>
          <span v-for="(n, i) in penPoints" :key="`n${i}`" class="pnode"
                :class="{ smooth: n.hx1 !== undefined || n.hx2 !== undefined, on: chosenNode === i }"
                :style="{ left: pc(n.x), top: pc(n.y) }"
                @pointerdown.stop="penDrawing ? (i === 0 && pen.down([n.x, n.y], $event)) : gripPen(i, 'node', $event)"
                @dblclick.stop="pen.toggleNode(i)"></span>
        </div>
      </template>
    </div>
    </div><!-- .withrail -->

    <p v-if="drawError" class="note bad tiny">Nothing could be drawn: {{ drawError }}</p>

    <!--
      THE STATUS BAR. Zoom on the left, where the selected part actually is in
      the middle, and the three tools on the right — the same arrangement as
      the Place tab's, because it is the same screen doing the same job.

      THE MEASUREMENTS ARE A READOUT AND NOT FIELDS, which is where this
      diverges from the mockup's drawing. The inspector already carries four
      boxes that edit exactly these four numbers; a second set of them a foot
      away would be the same control twice on one screen, and the Place tab
      settled that question the same way.
    -->
    <p class="readout">
      <!-- The set's own drawings, as on the Place tab (STUDIO-ESSENTIALS A6). -->
      <ToolBar label="Zoom">
        <ToolButton icon="zoomOut" label="Zoom out" :size="15" :keys="keyOf('zoomOut')" @click="stepZoom(-1)" />
        <span class="zval">{{ Math.round(zoom * 100) }}%</span>
        <ToolButton icon="zoomIn" label="Zoom in" :size="15" :keys="keyOf('zoomIn')" @click="stepZoom(1)" />
        <ToolButton icon="fit" label="Fit" wide :size="15" hint="Fit the whole card to the canvas" :keys="keyOf('fit')" @click="fitToStage" />
      </ToolBar>
      <template v-if="chosen">
        <b>x {{ pc(chosen.box.left) }}</b> · y {{ pc(chosen.box.top) }} ·
        w {{ pc(chosen.box.width) }} · h {{ pc(chosen.box.height) }}
      </template>
      <template v-else>Nothing selected.</template>
      <span class="grow"></span>
      <ToolBar label="Canvas tools">
        <ToolButton
          icon="magnet" label="Snap" wide :size="15" :active="snapping"
          hint="Line a part up with the edges and middles of the other parts as you drag it"
          @click="snapping = !snapping" />
        <ToolButton
          icon="grid" :label="`Grid ${GRID_PX} px`" wide :size="15" :active="gridding"
          :hint="`Line a part up with an ${GRID_PX} px grid on the card itself, so a column of them is square to the picture rather than to each other`"
          @click="gridding = !gridding" />
        <ToolButton
          icon="preview" label="Preview as sent" wide :size="15" :active="asSent"
          hint="The card at the size a chat gives it, with nothing of the studio on top"
          @click="asSent = !asSent" />
      </ToolBar>
    </p>
  </div>

  <!-- `v-model:motto`, not `@update:motto`. The motto belongs to the raffle
       and the panel is only where it is typed, so it travels down and back
       rather than being owned there. -->
  <!-- A drawing gets the drawn-shape panel, in the card's own face names. -->
  <DecorationInspector
    v-if="chosenDeco" :deco="chosenDeco" :size="size" :faces="CARD_FACES"
    :swatches="swatches" :brand="cfg?.brandColor || ''" :can-drop="canDrop"
    @mark="emit('mark')" @pick-colour="(apply) => emit('pick-colour', apply)"
    @pick-image="changingPicture = chosenDeco.id; showPictures = true"
    @edit-nodes="pen.enter(chosenDeco.id)" />
  <CardInspector
    v-else
    v-model:motto="card.motto"
    :part="chosen" :size="size" :brand="cfg?.brandColor || ''"
    :default-ink="chosen ? palette[chosen.role] || palette.ink : ''"
    :motto-max="mottoMax"
    :watermark="watermark" :qr-density="qrDensity"
    :swatches="swatches" :can-drop="canDrop"
    @pick-colour="(apply) => emit('pick-colour', apply)" />

  <PicturePicker v-if="showPictures" :pictures="pictures"
                 @pick="pickPicture" @close="showPictures = false; changingPicture = ''" />
</div>
</template>

<style scoped src="./studio.css"></style>

<style scoped>
.grow { flex: 1; min-width: 0 }
.rail, .panel { max-height: calc(100vh - 170px); overflow: auto }
.block { display: flex; flex-direction: column; gap: 7px }
/*
 * `1 0 auto`, NOT `1`. The shorthand `flex: 1` is `1 1 0%`, which lets the
 * layer block shrink below the height of what is in it — and nothing here
 * clips, so the sentence under the list printed straight through the CANVAS
 * heading below it. It takes the spare room and never gives up its own; the
 * rail scrolls when there is not enough, which is what `overflow: auto` on it
 * is for.
 */
.block.grow { flex: 1 0 auto }
.halfhead {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 8px; margin: 0;
}
.count { font-size: .68rem; text-transform: none; letter-spacing: 0 }

.ellist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.ellist li {
  display: flex; align-items: center; gap: 7px; padding: 2px 4px;
  min-height: var(--row-h); border-bottom: 1px solid var(--border);
}
.ellist li.on { background: var(--brand-soft); border-radius: 6px }
.ellist li.off .elname { opacity: .5 }
.elname {
  flex: 1; min-width: 0; text-align: left; border: 0; background: none; cursor: pointer;
  font-size: .84rem; color: var(--text); padding: 2px 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.elname:hover { color: var(--brand) }
.elname:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; border-radius: 3px }
/* The same tinting as the printed tab's layer list, so a glyph means the same
   kind of thing on both. Colour reinforces the shape; it never carries it. */
.kind { flex: none; color: var(--muted) }
.kind.code { color: var(--info) }
.kind.type { color: var(--warn) }
.kind.ticket { color: var(--brand) }

.stagebar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }
.specs { font-size: .72rem; color: var(--muted) }
/*
 * `safe center`, NOT `center`. A grid centring a child wider than itself
 * overflows in BOTH directions, and the half that overflows to the left cannot
 * be scrolled to — it is off the start of the scroll range. Zoomed to 150% on
 * a Stub card, the left edge of the card was simply unreachable. `safe` falls
 * back to start alignment the moment the child stops fitting, which is the
 * whole of the fix.
 */
.stage {
  overflow: auto; padding: 20px; background: var(--stage); border-radius: var(--r-sm);
  display: grid; place-content: safe center;
}
/* Not --paper: this card has no paper. It IS the picture, so what it sits on
   is the studio's own surround and nothing pretends otherwise. */
.frame { position: relative; margin: 0 auto; touch-action: none; box-shadow: var(--shadow-lg) }
.cardart { position: absolute; inset: 0 }
.cardart :deep(svg) { width: 100%; height: 100%; display: block }

.ruler {
  position: relative; height: 15px; margin: 0 auto 6px; font-size: .6rem; color: var(--muted);
  font-family: var(--font-data);
}
.ruler span { position: absolute; top: 2px; padding-left: 3px; border-left: 1px solid var(--border) }
.ruler .right { right: 0; border-left: 0; border-right: 1px solid var(--border); padding: 0 3px 0 0 }

/*
 * THE GUIDES DO NOT USE THE THEME TOKENS, for the same reason the printed
 * tab's boxes do not: they sit on top of a card whose colour belongs to
 * whichever charity is running the raffle. A token resolved against the APP's
 * background says nothing about whether a line will be visible on a dark green
 * rectangle. A light line over a dark one reads on both.
 */
.guides {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255,255,255,.07) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.07) 1px, transparent 1px);
}
.centreline { position: absolute; pointer-events: none; background: rgba(255,255,255,.22) }
.centreline.v { left: 50%; top: 0; bottom: 0; width: 1px }
.centreline.h { top: 50%; left: 0; right: 0; height: 1px }
/*
 * A DIFFERENT COLOUR FROM A PART'S BOX, because it is a different kind of
 * thing. Everything else dashed on this canvas is something you can select
 * and drag; this is a line on the card that nothing owns. The printed tab
 * makes the same distinction for the perforation and picks its colour the
 * same way — a hue, not a token, because it sits on somebody's artwork.
 */
.safe {
  position: absolute; pointer-events: none;
  outline: 1px dashed rgba(120, 220, 255, .75);
  box-shadow: 0 0 0 1px rgba(0,0,0,.3);
}
/* INSIDE the box, not above it. Grand's safe square is the full height of the
   card, so a tag hung above it landed on the ruler and read as part of it. */
.safetag {
  position: absolute; left: 3px; top: 2px; font-size: .56rem; letter-spacing: .06em;
  text-transform: uppercase; color: rgba(120,220,255,.9); font-family: var(--font-data);
}

.ebox {
  position: absolute; cursor: move; touch-action: none;
  outline: 1px dashed rgba(255, 255, 255, .85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
}
.ebox.faint { outline-color: rgba(255, 255, 255, .34); box-shadow: 0 0 0 1px rgba(0, 0, 0, .18) }
/* Still there to click, just not drawn. `display: none` would take the box out
   of the canvas and with it the only way to select a part by pointing at it. */
.ebox.hidden { outline: 0; box-shadow: none }
.ebox.off { cursor: not-allowed; outline-style: dotted; opacity: .55 }
.ebox.locked { cursor: default; outline-color: rgba(255, 255, 255, .18); box-shadow: none }
/* The others in a multi-selection: the same amber says "selected", a thinner
   line says "and the panel is about the other one". Declared BEFORE .on so a
   part that is both primary and — impossibly — also, still reads as primary. */
.ebox.too {
  outline: 1px solid #ffb300;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .4);
  background: rgba(255, 179, 0, .06);
}
.ebox.on {
  outline: 2px solid #ffb300;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .55);
  background: rgba(255, 179, 0, .12);
}
.boxtag {
  position: absolute; left: calc(100% + 6px); top: -2px; white-space: nowrap;
  background: #ffb300; color: #1a1400; font-size: .6rem; font-weight: 600;
  padding: 1px 5px; border-radius: 4px; font-family: var(--font-data);
}
.grab { position: absolute; inset: 0; border: 0; background: none; padding: 0; cursor: inherit }
/* A drawing's box, in the printed tab's drawing cyan so a drawing and a part
   read as two kinds of thing. Literal: it sits on the card's own colours. */
.ebox.deco { outline-color: #12b5e5 }
.ebox.deco.on { outline: 2px solid #12b5e5; background: rgba(18, 181, 229, .14) }
.frame.drawing { cursor: crosshair }
.frame.panning, .frame.panning .ebox { cursor: grab }
.ebox.drawnbox { outline: 2px solid #ffb300; background: rgba(255, 179, 0, .18); pointer-events: none }
.penlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 3 }
.penlayer path { fill: none; vector-effect: non-scaling-stroke }
.pendraft { stroke: #12b5e5; stroke-width: 1.5 }
.penedit { stroke: #12b5e5; stroke-width: 1 }
.pnode {
  position: absolute; z-index: 4; transform: translate(-50%, -50%); touch-action: none;
  width: 9px; height: 9px; background: #fff; border: var(--rule-strong) solid #12b5e5; cursor: move;
}
.pnode.smooth { border-radius: var(--r-pill) }
.pnode.on { background: #12b5e5 }
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

/* What a chat does with it: a narrow column and a message under the picture. */
.bubble {
  width: min(360px, 100%); display: flex; flex-direction: column; gap: 6px;
  padding: 10px; border-radius: 14px; background: var(--surface);
  box-shadow: var(--shadow);
}
.bubble p { margin: 0; color: var(--muted) }
.sentcard :deep(svg) { width: 100%; height: auto; display: block; border-radius: 10px }

.readout {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0;
  font-size: .72rem; color: var(--muted);
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.readout b { color: var(--text) }
.zval { min-width: 42px; text-align: center; font-size: var(--fs-2xs) }
/* .tools and .tool lived here AND in TicketDesign.vue, ten identical lines in
   two files. Both are ui/ToolBar.vue and ui/ToolButton.vue now. */

@media (max-width: 1023px) {
  .rail, .panel { max-height: none }
}
</style>
