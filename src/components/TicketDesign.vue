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
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, nextTick } from 'vue'
import { state, api, setConfig, toast, isAdmin, setFocus, go, NO_ROOM_WHY } from '../lib/store.js'
import { designFor, validateDesign, stubShare } from '../lib/ticketdesign.js'
import {
  elementLayerSVG, placeElements, qrModuleMM, ticketVerifyUrl,
} from '../lib/ticketart.js'
/* CARD_TREATMENTS so the footer can COUNT the treatments rather than state a
   number. It said "the other two" and was correct until a fourth treatment
   landed, at which point it was a sentence quietly telling somebody the wrong
   thing about what a destructive button spares. */
import { resolveParts, standardParts, layoutFrom, CARD_TREATMENTS } from '../lib/cardelements.js'
/*
 * SOURCES, SOURCE, OVERFLOW, ALIGN AND Dim WENT OUT WITH THE PANELS THAT USED
 * THEM and the import lines stayed behind — each of the five appeared exactly
 * once in this file, on the line importing it.
 *
 * Harmless to run and worth deleting anyway, because it is the same defect as
 * the one this file's own comment below records in the other direction: a name
 * and a use that have stopped agreeing, with nothing that notices. `<Ink>` sat
 * in a template unimported and a text element had no colour control for as long
 * as that file existed; these are imports with no template. eslint cannot see
 * either inside <script setup>, so the only thing between them and the next
 * reader is somebody looking.
 */
import {
  FAMILIES, lockAxis, keepRatio, nameOf, normalElement, nextId, legacyFromElements,
} from '../lib/ticketelements.js'
import {
  EDGES, boundsOf, alignBoxes, distributeBoxes, orderMoved, offsetBox,
} from '../lib/arrange.js'
import {
  KINDS as DECO_KINDS, normalDecoration, nextDecoId, printWarnings,
} from '../lib/designelements.js'
import { encode } from '../lib/qrcodegen.js'
import { sheetHTML, pageFit } from '../lib/ticketsheet.js'
import { toPayload, reject as rejectFile } from '../lib/templatefile.js'
import { blankArtboardFile } from '../lib/blankticket.js'
import SheetTab from './ticketdesign/SheetTab.vue'
import ShapesPanel from './ticketdesign/ShapesPanel.vue'
import TemplateRail from './ticketdesign/TemplateRail.vue'
import ArtworkVerdict from './ticketdesign/ArtworkVerdict.vue'
import Inspector from './ticketdesign/Inspector.vue'
import DigitalTab from './ticketdesign/DigitalTab.vue'
/* Ink went WITH the inspector: it was imported here and used only there,
 * which is the half of the extraction bug this side owned. */
import Icon from './ui/Icon.vue'
import Toggle from './ui/Toggle.vue'
import ToolBar from './ui/ToolBar.vue'
import ToolButton from './ui/ToolButton.vue'
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
  /* "Artwork", not "Artwork & paper". The mockup titles the CARD "Artwork &
     paper" and labels the TAB "Artwork" — 2a, 2b, 7a and 8c all draw it that
     way — and the longer label was never anybody's decision (git log -S puts it
     in adf1fca, a commit about element storage). It also costs the bar about
     fifty pixels it does not have now there are four tabs. */
  { id: 'artwork', name: 'Artwork' },
  { id: 'sheet', name: 'Print sheet' },
  /* Card 8c. The other three tabs are about the PRINTED ticket — artwork, where
     the fields sit on it, how it lands on paper. This one is the picture a buyer
     is sent, which shares the raffle's colour and nothing else: no artwork, no
     coordinates, no paper. It belongs here because it is still "what a ticket
     looks like", and an organiser who has just chosen a colour should not be
     sent to a different screen to see what it did to the thing they hand out. */
  { id: 'digital', name: 'Digital ticket' },
]
const tab = ref('place')

/* ---------- card 8c: the digital ticket ---------- */
/*
 * THE CARD IS THREE THINGS NOW, WHERE IT WAS TWO.
 *
 * The treatment and the motto belong to the RAFFLE — one answer each, whatever
 * treatment is on. The layout belongs to a TREATMENT: Grand's motto and Stub's
 * motto are in different places on differently shaped cards, and an organiser
 * who arranges one and then looks at another must not find the second one
 * rearranged behind them.
 *
 * So `cardLayout` holds every treatment's overlay and `cardParts` holds the
 * whole, resolved list for the one on screen. Switching treatment folds what
 * is on screen back into the overlay before resolving the next — which is the
 * step that, left out, silently discards the arrangement somebody just made.
 */
const MOTTO_MAX = 48
const card = ref({ design: 'grand', motto: '' })
const cardLayout = ref({})
const cardParts = ref([])
const cardSaving = ref(false)
const mottoLeft = computed(() => MOTTO_MAX - (card.value.motto || '').length)
const mottoOver = computed(() => mottoLeft.value < 0)

/* How wide the picture is actually sent, which is what decides whether the QR
   on it will scan. The template's own setting when there is one — the same
   number ViewTicket rasterises at — and its fallback when there is not. */
const cardSentWidth = computed(() => Number(design.value?.digital?.widthPx ?? 1200))

/*
 * EVERYTHING ABOUT THE CARD THAT CAN BE SAVED, as text that cannot alias.
 *
 * Declared here rather than beside the undo stack that uses it because
 * `loadCard` runs from an immediate watcher during setup and reads it. A const
 * declared further down would be in its temporal dead zone at that moment,
 * which is a blank screen and one line in a console.
 */
const cardState = computed(() => JSON.stringify({
  design: card.value.design,
  motto: card.value.motto,
  layout: layoutFrom(card.value.design, cardParts.value, cardLayout.value),
}))
const cardSavedState = ref('')
const cardDirty = computed(() => cardState.value !== cardSavedState.value)

/*
 * ONE UNDO ENTRY PER GESTURE, the same rule and the same reasons as the
 * printed side's: a drag fires the watcher on every pointermove, and an Undo
 * that means "back up one pixel" is not an Undo. A drag marks its own start;
 * anything typed coalesces into one entry per half second.
 *
 * ABOVE `loadCard`, WHICH IS NOT A TIDINESS MATTER. It runs from an immediate
 * watcher during setup and calls `rebaseCard`, which assigns to `cardSnap`.
 * Declared below, that is a write into a `let` still in its temporal dead
 * zone: the whole screen throws in setup and renders as seven characters of
 * empty shell, with "Unhandled error during execution of watcher callback" as
 * the only clue and no mention of this file in it.
 */
const cardHistory = ref([])
/* The card's half of the same fork — see `future` on the printed side for why
   an undo you cannot reverse stops being pressed at all. */
const cardFuture = ref([])
const cardDragging = ref(false)
let cardSnap = ''
let cardPush = 0
let cardRestoring = false

function loadCard() {
  card.value = {
    design: state.cfg?.cardDesign || 'grand',
    motto: state.cfg?.motto || '',
  }
  const stored = state.cfg?.cardLayout
  cardLayout.value = stored && typeof stored === 'object' ? JSON.parse(JSON.stringify(stored)) : {}
  cardParts.value = resolveParts(card.value.design, cardLayout.value)
  rebaseCard()
}
watch(() => state.cfg, loadCard, { immediate: true, deep: true })

/*
 * SWITCHING TREATMENT FOLDS BEFORE IT RESOLVES, and it folds against the
 * treatment that was on screen rather than the one arriving. `layoutFrom` is
 * told which treatment the parts belong to precisely so this cannot be got
 * wrong silently — measured against the wrong standard, every part of a card
 * looks changed and the whole layout would be written down as an override.
 */
watch(() => card.value.design, (now, was) => {
  if (cardRestoring || !was || now === was) return
  cardLayout.value = layoutFrom(was, cardParts.value, cardLayout.value)
  cardParts.value = resolveParts(now, cardLayout.value)
})

function markCard() {
  const now = cardState.value
  cardHistory.value = [...cardHistory.value.slice(-(HISTORY_MAX - 1)), now]
  cardFuture.value = []
  cardSnap = now
  cardPush = Date.now()
}

function rebaseCard() {
  cardSnap = cardState.value
  cardSavedState.value = cardSnap
  cardHistory.value = []
  cardFuture.value = []
  cardPush = 0
}

watch([card, cardParts], () => {
  if (cardRestoring) return
  const now = cardState.value
  if (now === cardSnap) return
  if (!cardDragging.value && cardSnap && Date.now() - cardPush > 500) {
    cardHistory.value = [...cardHistory.value.slice(-(HISTORY_MAX - 1)), cardSnap]
    cardFuture.value = []
    cardPush = Date.now()
  }
  cardSnap = now
}, { deep: true })

function applyCard(snap) {
  cardRestoring = true
  card.value.design = snap.design
  card.value.motto = snap.motto
  cardLayout.value = snap.layout
  cardParts.value = resolveParts(snap.design, snap.layout)
  nextTick(() => { cardRestoring = false })
}

function undoCard() {
  const last = cardHistory.value[cardHistory.value.length - 1]
  if (!last) return
  cardFuture.value = [...cardFuture.value.slice(-(HISTORY_MAX - 1)), cardState.value]
  applyCard(JSON.parse(last))
  cardHistory.value = cardHistory.value.slice(0, -1)
  cardSnap = last
}

function redoCard() {
  const next = cardFuture.value[cardFuture.value.length - 1]
  if (!next) return
  cardHistory.value = [...cardHistory.value.slice(-(HISTORY_MAX - 1)), cardState.value]
  applyCard(JSON.parse(next))
  cardFuture.value = cardFuture.value.slice(0, -1)
  cardSnap = next
}

function revertCard() {
  applyCard(JSON.parse(cardSavedState.value))
  cardHistory.value = []
  cardFuture.value = []
  cardSnap = cardSavedState.value
}

/* Back to the standard card — this treatment only. The others keep whatever
   was arranged on them, because they are separate pieces of work. */
function resetCard() {
  markCard()
  const rest = { ...cardLayout.value }
  delete rest[card.value.design]
  cardLayout.value = rest
  cardParts.value = standardParts(card.value.design)
}

async function saveCard() {
  if (mottoOver.value) return toast(`The motto is ${-mottoLeft.value} characters over`, 'bad')
  cardSaving.value = true
  try {
    const layout = layoutFrom(card.value.design, cardParts.value, cardLayout.value)
    const r = await api('set_card_design', {
      cardDesign: card.value.design, motto: card.value.motto, cardLayout: layout,
    })
    if (r?.config) setConfig(r.config)
    loadCard()
    toast('Digital ticket saved', 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
    loadCard()
  } finally { cardSaving.value = false }
}

/* The tab itself owns the rasteriser for "Send a test", because it owns the
   SVG that gets rasterised. The bar only presses the button, and reads back
   whether it is still working — through a computed, because `digital` is null
   until the tab is mounted and a template that reaches into it directly warns
   on every other tab. */
const digital = ref(null)
const digitalBusy = computed(() => !!digital.value?.testing)

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
/*
 * CARD 9b DRAWS THREE TOOLS AND THIS ONE DID NOT EXIST: `[magnet] Snap`,
 * `[grid] Grid 2 mm`, `[Aa] Longest entry`. Snapping to the other boxes lines a
 * field up with its neighbours; snapping to a grid lines it up with the ticket
 * itself, which is the one a print shop's eye reads — a row of fields each
 * aligned to a different neighbour is not aligned to anything.
 *
 * INDEPENDENT OF `snapping`, exactly as 9b draws them: both are lit at once and
 * either can be off. Folding the grid into the snap toggle would have made one
 * control that does two things and can only say one of them.
 */
const gridding = ref(true)
const GRID_MM = 2

const sampleVerifyBase = computed(() => {
  const set = String(state.cfg?.verifyUrl || '').trim()
  return set || ((typeof location === 'undefined' ? '' : location.origin) + '/v')
})

/*
 * Why the artwork drew nothing, when it draws nothing. A failure here used to
 * become an HTML comment, so a preview that broke and a preview with nothing
 * to draw looked identical on screen and in a screenshot.
 */
const previewError = ref('')

const preview = computed(() => {
  previewError.value = ''
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
    previewError.value = String(err?.message || err)
    return ''
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

/*
 * A PRIMARY SELECTION AND THE OTHERS, rather than one set of equals.
 *
 * `sel` is what the inspector is showing and has always been; `also` is
 * everything else that is selected. Two refs rather than a Set because the two
 * jobs are genuinely different and collapsing them loses one: the inspector
 * edits ONE element's source, colour and lettering, and an inspector showing
 * five elements' properties at once is a feature nobody asked for — while
 * align, distribute, order and delete all act on the whole selection and do
 * not care which was clicked first.
 *
 * So the rule is: the last thing clicked is the primary, everything held with
 * shift joins it, and the inspector follows the primary alone.
 */
const sel = ref('')
const also = ref([])

/** Everything selected, primary first, with anything since deleted dropped. */
const picked = computed(() => {
  const live = new Set([...elements.value.map((e) => e.id), ...decorations.value.map((d) => d.id)])
  const out = []
  for (const id of [sel.value, ...also.value]) {
    if (id && live.has(id) && !out.includes(id)) out.push(id)
  }
  return out
})
const pickedEls = computed(() => {
  const want = new Set(picked.value)
  /* In ARRAY order, not selection order: everything downstream — distribute's
     sort, the order moves, the renderer — reads array order as stacking order,
     and handing those the order somebody happened to click in would restack a
     design as a side effect of arranging it. */
  return elements.value.filter((e) => want.has(e.id))
})
const pickedDecos = computed(() => {
  const want = new Set(picked.value)
  return decorations.value.filter((d) => want.has(d.id))
})
/* Everything selected, of either kind. Align and distribute are arithmetic on
   a box and do not care which list a box came from. */
const pickedThings = computed(() => [...pickedEls.value, ...pickedDecos.value])
const many = computed(() => picked.value.length > 1)

/*
 * THE THINGS SOMEBODY DREW, alongside the things the raffle fills in.
 *
 * Two lists rather than one, and they stay two: an element prints a VALUE and
 * has a source; a decoration says nothing the app knows about. They are drawn
 * as two layers — decorations under every field, so no shape anybody adds can
 * take a serial number away — so merging them into one array would be merging
 * two z-orders that are deliberately separate.
 *
 * ONE ID-SPACE THOUGH, which is what lets the selection, the arrange tools and
 * the layer list treat them alike. `nextId` makes `e…` and `nextDecoId` makes
 * `d…`, so an id says which list it came from without anything having to carry
 * a flag alongside it.
 */
const decorations = computed(() => design.value?.decorations ?? [])
const isDeco = (id) => String(id).startsWith('d')

const thingById = (id) => (isDeco(id)
  ? decorations.value.find((d) => d.id === id)
  : elements.value.find((e) => e.id === id)) || null

const chosen = computed(() => elements.value.find((e) => e.id === sel.value) || null)
const chosenDeco = computed(() => decorations.value.find((d) => d.id === sel.value) || null)
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

/*
 * THE KIND OF THING A ROW IS, as a drawing rather than an abbreviation.
 *
 * This was `{ field: 'FLD', code: 'QR', text: 'TXT' }` set in three-letter
 * badges -- a private vocabulary the reader has to learn, in the narrowest
 * column on the screen. Card 9b draws a glyph per row.
 *
 *   field  a value the raffle fills in    -> the ticket it comes off
 *   text   words somebody typed           -> the serif T of the type palette
 *   code   the check code as a QR         -> the code drawing itself
 *
 * The word is still there, on the title, so nothing is carried by the picture
 * alone -- the same rule as a status never being colour alone.
 */
const KIND_ICON = { field: 'ticket', text: 'type', code: 'code' }
const KIND_WORD = {
  field: 'A field the raffle fills in',
  text: 'Words you typed',
  code: 'The check code, as a QR',
}

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

/* Which half the selected box is on, in the list's own words, for the chip at
 * the top of the panel. Derived here because sideOf needs the stub position and
 * that belongs to the design, not to the inspector. */
const chosenHalf = computed(() =>
  chosen.value ? (HALVES.find((g) => g.k === sideOf(chosen.value))?.t ?? '') : '')

/**
 * `add` is shift or the platform's own modifier, and it TOGGLES.
 *
 * Toggling rather than only adding, because the way somebody fixes a
 * shift-click they did not mean is to shift-click it again — and a selection
 * you can only grow is one you have to start over from.
 *
 * Shift-clicking the primary promotes the next one rather than leaving the
 * inspector pointed at something no longer selected.
 */
function pick(id, add = false) {
  if (!add) {
    sel.value = id
    also.value = []
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
  /* Selecting from the rail should show the thing selected, not leave it
   * somewhere off the side of a zoomed canvas. */
  nextTick(scrollSelectionIntoView)
}

/*
 * ---------- arranging what is already there ----------
 *
 * The arithmetic is in src/lib/arrange.js and is shared with the card tab; what
 * lives here is which boxes to hand it and what to do with the answer. Every
 * one of these calls mark() first, so the whole operation is a single undo step
 * rather than one per element.
 */

/** Against the artboard for one, against the selection for several. */
const alignWithin = () => (many.value
  ? boundsOf(pickedThings.value.map((e) => e.box))
  : { left: 0, top: 0, width: 1, height: 1 })

function alignPicked(edge) {
  if (!pickedThings.value.length) return
  mark()
  const out = alignBoxes(pickedThings.value.map((e) => e.box), edge, alignWithin())
  pickedThings.value.forEach((e, i) => { e.box.left = out[i].left; e.box.top = out[i].top })
}

function distributePicked(axis) {
  if (pickedThings.value.length < 3) return
  mark()
  const out = distributeBoxes(pickedThings.value.map((e) => e.box), axis)
  pickedThings.value.forEach((e, i) => { e.box.left = out[i].left; e.box.top = out[i].top })
}

/*
 * ORDER STAYS INSIDE ONE LIST, AND A MIXED SELECTION CANNOT BE ORDERED.
 *
 * The two lists are two layers by design: every decoration draws under every
 * field. So "bring this decoration forward past that ticket number" has no
 * answer — not a hard one, none at all — and a tool that quietly reordered
 * within each list instead would move two things away from each other while
 * looking like it moved them together. Disabled with the reason instead.
 */
function orderPicked(move) {
  if (!picked.value.length || mixedPick.value) return
  mark()
  const inDecos = pickedDecos.value.length > 0
  const list = inDecos ? decorations.value : elements.value
  const order = orderMoved(list.map((e) => e.id), picked.value, move)
  const by = Object.fromEntries(list.map((e) => [e.id, e]))
  const sorted = order.map((id) => by[id])
  if (inDecos) design.value.decorations = sorted
  else design.value.elements = sorted
}

const mixedPick = computed(() => pickedEls.value.length > 0 && pickedDecos.value.length > 0)

/*
 * A COPY IS A NEW ELEMENT, NOT A SECOND REFERENCE. `after` is dropped rather
 * than copied: it names another element to flow from, and two elements flowing
 * from one anchor print on top of each other. The copy starts standing on its
 * own, which is the only version of it that is always correct.
 */
function duplicatePicked() {
  if (!pickedThings.value.length) return
  mark()
  const copy = (x) => JSON.parse(JSON.stringify(x))
  const els = pickedEls.value.map((e) => normalElement({
    ...copy(e), id: nextId(), after: '', box: offsetBox(e.box),
  }))
  const decos = pickedDecos.value.map((d) => normalDecoration({
    ...copy(d), id: nextDecoId(), box: offsetBox(d.box),
  }))
  if (els.length) design.value.elements = [...elements.value, ...els]
  if (decos.length) design.value.decorations = [...decorations.value, ...decos]
  const made = [...els, ...decos]
  sel.value = made[0].id
  also.value = made.slice(1).map((x) => x.id)
}

function deletePicked() {
  if (!picked.value.length) return
  mark()
  const going = new Set(picked.value)
  design.value.elements = elements.value.filter((e) => !going.has(e.id))
  /* Anything that was flowing after a deleted element has lost its anchor. */
  for (const e of design.value.elements) if (going.has(e.after)) e.after = ''
  design.value.decorations = decorations.value.filter((d) => !going.has(d.id))
  sel.value = ''
  also.value = []
}

/*
 * WHY EACH TOOL CANNOT BE PRESSED, or '' when it can. Handed straight to
 * ToolButton, which disables on the presence of a reason — so there is no way
 * to draw one of these enabled without an answer to "why not".
 */
const whyNoSelection = computed(() => (picked.value.length ? '' : 'Nothing is selected'))
/* What a press will not hold, as findings rather than refusals — see
   designelements.js. Only the printed tab asks for them. */
const printRisks = computed(() => printWarnings(decorations.value, { printed: true }))

/*
 * WHAT TO CALL A SHAPE SOMEBODY DREW.
 *
 * It has no name of its own — that is what makes it a decoration rather than a
 * part — so the list has to say something, and "Decoration 4" is the worst of
 * the available answers: it changes when anything above it is deleted, so the
 * row somebody is looking for is never where they left it.
 *
 * The words if it has words, the mark's name if it is a mark, the kind
 * otherwise. Every one of those is stable under deletion and says what the
 * thing IS.
 */
const DECO_WORD = {
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Rule', text: 'Words', image: 'Picture',
}
/*
 * `icon` IS SPELLED OUT HERE RATHER THAN PUT IN THE TABLE ABOVE, and the
 * reason is a convention this codebase enforces with a test.
 *
 * `icon: '…'` means an icon NAME everywhere in this app, and icons.test.mjs
 * scans every file for that pattern to check the drawing exists. A label
 * filed under that key reads to it as a request for a drawing called "Mark",
 * and it failed exactly that way. The test is right and the table was wrong:
 * one key spelling meaning two different things is how a scanner ends up
 * unable to tell them apart, and the scanner is the thing that catches typos
 * in the other 54 cases.
 */
function decoWord(kind) {
  return kind === 'icon' ? 'Mark' : (DECO_WORD[kind] || 'Shape')
}

function decoName(d) {
  const typed = String(d?.text?.value ?? '').trim()
  if (d?.kind === 'text' && typed) return `“${typed.length > 22 ? `${typed.slice(0, 21)}…` : typed}”`
  if (d?.kind === 'icon' && d.icon?.name) return `Mark · ${d.icon.name}`
  return decoWord(d?.kind)
}

const whyNotOrder = computed(() => whyNoSelection.value || (mixedPick.value
  ? 'Fields and drawn shapes are two layers — everything drawn prints under every field, '
    + 'so there is no order between them to change'
  : ''))
const whyNotDistribute = computed(() => (
  picked.value.length >= 3 ? ''
    : picked.value.length ? 'Spacing needs three or more — shift-click to add to the selection'
      : 'Nothing is selected'))

/*
 * ADDING SOMETHING: pick what, then draw where.
 *
 * Two steps rather than one because the alternative is dropping a box in the
 * middle of the ticket and making somebody drag it off whatever it landed on.
 * `pending` is the kind waiting for a box to be drawn for it; the canvas shows
 * a crosshair while it is set.
 */
const pending = ref('')

/*
 * `d:rect` RATHER THAN `rect`, and the prefix is load-bearing rather than
 * tidy: an element kind and a decoration kind are both called `text`, and one
 * of them prints somebody's typed words while the other is a value the raffle
 * fills in. One namespace with a collision in it is a bug waiting for whoever
 * adds the fourth kind.
 */
const DECO_PREFIX = 'd:'
const pendingDeco = computed(() => (pending.value.startsWith(DECO_PREFIX)
  ? pending.value.slice(DECO_PREFIX.length) : ''))

function beginAdd(kind) {
  pending.value = pending.value === kind ? '' : kind
  sel.value = ''
  also.value = []
}

/*
 * A NEW DECORATION IS VISIBLE BEFORE IT IS STYLED, which is the one thing that
 * decides whether a drawing tool feels like it works. A shape created with no
 * fill, or in the colour of whatever is behind it, reads as a tool that did
 * nothing — and the next thing somebody does is press it four more times.
 *
 * So it takes the ink already on this side of the perforation, the same rule
 * and the same function a new ELEMENT uses, rather than black on a dark green
 * field. A line takes it as a stroke, because a filled line is a rectangle.
 */
function addDecorationAt(kind, box) {
  const side = box.left + box.width / 2 >= stubShare(design.value) ? 'stub' : 'half'
  const colour = inkNear(side)
  const made = normalDecoration({
    id: nextDecoId(),
    kind,
    half: side === 'stub' ? 'stub' : 'main',
    box,
    fill: { type: kind === 'line' ? 'none' : 'solid', colour },
    stroke: kind === 'line' ? { width: 0.002, colour } : { width: 0, colour },
    text: kind === 'text' ? { value: 'Your words' } : {},
    icon: kind === 'icon' ? { name: 'ticket' } : {},
  })
  design.value.decorations = [...decorations.value, made]
  sel.value = made.id
  also.value = []
  pending.value = ''
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

/*
 * Nearest wins between the two, rather than one taking precedence. A field
 * being dragged past a neighbour's edge that happens to sit half a grid step
 * away should land on whichever it is actually closer to — a fixed precedence
 * would pull it off the edge it was visibly next to.
 *
 * `step` is already 0 when the grid is off, so the two gates are separate: the
 * `snapping` check guards the neighbours only.
 */
function snapTo(value, candidates, step = 0) {
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
    const d = Math.abs(g - value)
    if (d < dist) { dist = d; best = g }
  }
  return best
}

/*
 * TWO MILLIMETRES IS TWO MILLIMETRES ON BOTH AXES, and that is the whole
 * reason these are two computeds rather than one.
 *
 * Boxes are stored as SHARES of the template, so a step in millimetres has to
 * be divided by the artboard's own size on that axis. The ticket is 190 mm
 * across and about 61 mm down: one share value for both would have made the
 * horizontal grid 2 mm and the vertical grid a little over 6, and the fields
 * would have looked aligned in the inspector and been wrong on paper.
 *
 * The height is derived, never stored — the artwork's own shape times the
 * width — which is the same rule `printedSize` follows and for the same
 * reason: a second stored number is a second thing to get wrong.
 */
const gridX = computed(() => {
  const mm = Number(design.value?.sheet?.widthMM ?? 0)
  return gridding.value && mm > 0 ? GRID_MM / mm : 0
})
const gridY = computed(() => {
  const mm = Number(design.value?.sheet?.widthMM ?? 0)
  const t = active.value
  if (!gridding.value || !mm || !t?.width || !t?.height) return 0
  return GRID_MM / (mm * (t.height / t.width))
})
const snapX = (v, xs) => snapTo(v, xs, gridX.value)
const snapY = (v, ys) => snapTo(v, ys, gridY.value)

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
  if (el.enabled === false || el.locked) return
  ev.stopPropagation()

  /*
   * SHIFT ON THE CANVAS SELECTS, IT DOES NOT DRAG. Somebody adding a fifth box
   * to a selection is aiming at the box, not at a destination, and a drag that
   * begins on the same press moves it a few pixels every time — which is a
   * design quietly nudged out of alignment by the act of selecting it.
   */
  if (ev.shiftKey || ev.metaKey) { pick(el.id, true); return }

  mark()
  /*
   * PRESSING SOMETHING ALREADY SELECTED KEEPS THE SELECTION, and drags all of
   * it. Anything else makes a multi-selection impossible to move: you pick
   * three, press one to drag them, and the press throws the other two away.
   */
  if (!picked.value.includes(el.id)) pick(el.id)

  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = {
    mode: 'move', id: el.id, px: ev.clientX, py: ev.clientY, box: { ...el.box },
    /* Every box's starting position, so the delta is applied to where each one
       WAS rather than accumulating per frame. The primary is excluded — it is
       handled by the snapping path below and would otherwise move twice. */
    group: pickedEls.value.filter((e) => e.id !== el.id).map((e) => ({ id: e.id, box: { ...e.box } })),
  }
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

  /* Either list — a drag does not care which, and `thingById` reads the id. */
  const el = thingById(st.id)
  if (!el) return
  const { xs, ys } = edgesExcept(st.id)

  if (st.mode === 'move') {
    const left = snapX(st.box.left + dx, xs)
    const top = snapY(st.box.top + dy, ys)
    /* Snapping the trailing edge too, so a box lines up on whichever of its
     * sides is nearest something — the left edge is not privileged. */
    const right = snapX(st.box.left + dx + st.box.width, xs) - st.box.width
    const bottom = snapY(st.box.top + dy + st.box.height, ys) - st.box.height
    el.box.left = Math.abs(left - (st.box.left + dx)) <= Math.abs(right - (st.box.left + dx)) ? left : right
    el.box.top = Math.abs(top - (st.box.top + dy)) <= Math.abs(bottom - (st.box.top + dy)) ? top : bottom

    /*
     * THE REST OF THE SELECTION FOLLOWS THE PRIMARY'S SETTLED POSITION, not the
     * raw pointer delta. Snapping moves the primary a little further than the
     * pointer went, and applying the pointer's delta to the others would shear
     * the selection apart by exactly the snap distance every time it caught.
     * One box snaps; the group keeps its shape.
     */
    for (const g of st.group || []) {
      const other = thingById(g.id)
      if (!other) continue
      other.box.left = Math.round((g.box.left + (el.box.left - st.box.left)) * 1e4) / 1e4
      other.box.top = Math.round((g.box.top + (el.box.top - st.box.top)) * 1e4) / 1e4
    }
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
    if (c.includes('e')) el.box.width = Math.max(0.002, snapX(st.box.left + st.box.width + dx, xs) - st.box.left)
    if (c.includes('s')) el.box.height = Math.max(0.002, snapY(st.box.top + st.box.height + dy, ys) - st.box.top)
    if (c.includes('w')) {
      const left = snapX(st.box.left + dx, xs)
      const right = st.box.left + st.box.width
      el.box.left = Math.min(left, right - 0.002)
      el.box.width = right - el.box.left
    }
    if (c.includes('n')) {
      const top = snapY(st.box.top + dy, ys)
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
    /* A click rather than a drag gets a default — and a different one for a
       shape than for a field. A field is a line of type and is wide and thin;
       a rectangle that shape reads as a rule somebody did not mean to draw. */
    const tiny = b.width < 0.005 || b.height < 0.004
    const box = !tiny ? b
      : pendingDeco.value && pendingDeco.value !== 'line'
        ? { left: b.left, top: b.top, width: 0.12, height: 0.12 }
        : { left: b.left, top: b.top, width: 0.14, height: 0.03 }
    if (pendingDeco.value) addDecorationAt(pendingDeco.value, box)
    else addElementAt(pending.value, box)
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
  /* Either list — an arrow key nudges whatever is selected, and a decoration is
     as selectable as a field. `chosen` alone would have made the arrows work on
     fields and silently do nothing on shapes. */
  const el = thingById(sel.value)
  if (!el || el.locked) return
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
  load().then(() => nextTick(fitToWidth))
})

/*
 * ACTIVATED, NOT MOUNTED: App.vue keeps screens alive, so onMounted runs once
 * a session and onUnmounted never. go() clears focus on every navigation, so
 * the studio collapsed the nav on the first visit only; and the Cmd-\ listener,
 * removed on unmount, stayed bound and toggled the nav away from every other
 * screen. onActivated also fires on first mount, so this is the only path.
 */
onActivated(() => {
  /* Not on a screen about to say it needs a bigger one. */
  if (state.roomy) setFocus(true)
  window.addEventListener('keydown', onFocusKey)
  /* A caller asked for a particular tab — see goStudio. Read once and cleared,
     because the request belongs to that one arrival: leaving it set would send
     every later visit to the studio to whichever tab somebody last linked to. */
  if (state.studioTab) {
    if (TABS.some(t => t.id === state.studioTab)) tab.value = state.studioTab
    state.studioTab = ''
  }
})

onDeactivated(() => {
  setFocus(false)
  window.removeEventListener('keydown', onFocusKey)
})
/*
 * Turned off on the way down, never back on: a window dragged narrower must
 * give the navigation back, but re-entering focus on the way up would undo a
 * ⌘\ somebody pressed deliberately. Widening leaves the chrome showing, which
 * is a working studio either way.
 */
watch(() => state.roomy, (roomy) => { if (!roomy) setFocus(false) })
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
/*
 * TYPING IS NOT A SHORTCUT. Every one of these has to refuse while somebody is
 * in a field, or Delete eats a character out of a motto and ⌘A selects every
 * box on the ticket instead of the text in the box under the cursor. The
 * studio is full of inputs, which is why the existing ⌘\ was already careful
 * to use a modifier rather than a bare key.
 */
function inAField(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
    || t.tagName === 'SELECT' || t.isContentEditable)
}

function onFocusKey(e) {
  // ⌘\ on a Mac, Ctrl+\ elsewhere. Not a bare key: this screen is full of
  // text fields and a single letter would fire while somebody types a motto.
  if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    setFocus(!state.focus)
    return
  }

  /* The arrange shortcuts belong to the Place tab, where the selection is. */
  if (tab.value !== 'place' || inAField(e.target)) return
  const cmd = e.metaKey || e.ctrlKey

  if (cmd && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicatePicked(); return }
  if (cmd && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    /* Everything that is on the ticket. A hidden element selected by ⌘A is one
       that arrange tools would move where nobody can see it happen. */
    const live = elements.value.filter((el) => el.enabled !== false).map((el) => el.id)
    sel.value = live[0] || ''
    also.value = live.slice(1)
    return
  }
  if (cmd && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    /* ⇧⌘Z for redo, which is what this platform's own apps use. Ctrl+Y is the
       Windows spelling and is not bound: this screen is a Mac-first organiser's
       tool and a second binding nobody presses is a second thing to keep. */
    if (e.shiftKey) redo(); else undo()
    return
  }
  if (e.key === 'Escape' && picked.value.length) {
    e.preventDefault()
    sel.value = ''
    also.value = []
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && picked.value.length) {
    e.preventDefault()
    deletePicked()
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

/*
 * HOW MUCH IS WAITING TO BE WRITTEN, on the button that writes it.
 *
 * Counted rather than invented: every element whose JSON differs from the
 * saved copy, plus the two things that are not elements — where the stub
 * begins and the sheet's own settings. An added or removed element counts
 * once. A number on a button that did not come from the data is the
 * `sheet.perPage` mistake again, so if there is nothing to count this says
 * "Save the design" instead of "Save · 0".
 */
const changeCount = computed(() => {
  const now = design.value, was = saved.value
  if (!now || !was) return 0
  const key = (e) => JSON.stringify(e)
  const mine = new Map((now.elements ?? []).map((e) => [e.id, key(e)]))
  const theirs = new Map((was.elements ?? []).map((e) => [e.id, key(e)]))
  let n = 0
  for (const [id, k] of mine) if (theirs.get(id) !== k) n += 1
  for (const id of theirs.keys()) if (!mine.has(id)) n += 1
  if (now.stubAt !== was.stubAt) n += 1
  if (JSON.stringify(now.sheet) !== JSON.stringify(was.sheet)) n += 1
  return n
})

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
/*
 * WHAT UNDO TOOK, so it can be put back.
 *
 * The stack was pop-only: a step undone was gone, and the only way back was to
 * redo the work by hand. That is a worse trap than it looks on a design screen,
 * because undo is how somebody EXPLORES — press it, look, decide you preferred
 * the other one — and an undo you cannot reverse turns a cheap look into a
 * commitment. So people stop pressing it, which is the same as not having it.
 *
 * A NEW ACTION FORKS THE TIMELINE AND THIS EMPTIES. Keeping it would offer a
 * redo that reinstates a state the current one never came from, which is the
 * one thing worse than no redo at all: it silently discards whatever was done
 * in between.
 */
const future = ref([])
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
  future.value = []
  lastSnap = snap
  lastPush = Date.now()
}

function rebase() {
  lastSnap = design.value ? JSON.stringify(design.value) : ''
  history.value = []
  future.value = []
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
    future.value = []
    lastPush = Date.now()
  }
  lastSnap = snap
}, { deep: true })

function undo() {
  const last = history.value[history.value.length - 1]
  if (!last) return
  restoring = true
  future.value = [...future.value.slice(-(HISTORY_MAX - 1)), JSON.stringify(design.value)]
  design.value = JSON.parse(last)
  history.value = history.value.slice(0, -1)
  lastSnap = last
  nextTick(() => { restoring = false })
}

function redo() {
  const next = future.value[future.value.length - 1]
  if (!next) return
  restoring = true
  history.value = [...history.value.slice(-(HISTORY_MAX - 1)), JSON.stringify(design.value)]
  design.value = JSON.parse(next)
  future.value = future.value.slice(0, -1)
  lastSnap = next
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

  <!--
    THE SAME REASON THE NAV GIVES, because a person who reached this screen on
    a phone did so from a tab that said why, or from a link, and two different
    explanations of one fact is how somebody decides the app is broken.
  -->
  <section v-else-if="!state.roomy" class="card noroom">
    <Icon name="ticket" :size="34" />
    <h3>Ticket Studio needs a bigger screen</h3>
    <p class="muted">{{ NO_ROOM_WHY }}</p>
    <p class="tiny muted">
      Everything else in the app works here — this is the one screen that does not,
      because an artboard and two rails of controls do not fit on a phone.
    </p>
    <button class="btn" @click="exitStudio">Back to Home</button>
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
      <nav class="tabs" role="tablist">
        <button
          v-for="t in TABS" :key="t.id" type="button" role="tab"
          class="tabbtn" :class="{ on: tab === t.id }"
          :aria-selected="tab === t.id" @click="tab = t.id">{{ t.name }}</button>
      </nav>

      <span class="grow"></span>

      <!--
        SHORT ENOUGH TO SURVIVE THE ROOM IT HAS. This truncated to "All
        change…" at desk width, which is not a shorter way of saying
        something — it is the same number of pixels spent saying nothing.
        The time is the fact worth keeping ("did my last change land?"), the
        count of what is unsaved moves onto the button that will write it,
        and "saved" needs no sentence because an idle Save button beside a
        time is already the message.
      -->
      <span class="statetxt data"
            :class="{ unsaved: tab === 'digital' ? cardDirty : dirty }">
        <!-- editedAt is set by the design watcher, which does not fire for
             every route a change can arrive by, so it can legitimately be
             empty while dirty is true. "edited " with nothing after it is
             worse than the sentence this replaced. -->
        <!-- THE STATUS FOLLOWS THE TAB, like the Save button beside it. It
             said "saved" on the digital tab while a card sat unsaved, because
             it was reading the template's dirty flag on a tab that does not
             edit the template. -->
        <template v-if="tab === 'digital'">{{ cardDirty ? 'not saved' : 'saved' }}</template>
        <template v-else-if="dirty">{{ editedAt ? `edited ${editedAt}` : 'not saved' }}</template>
        <template v-else-if="saved">saved</template>
      </span>

      <!--
        TWO SAVES ON ONE SCREEN THAT SAVED DIFFERENT THINGS. The card's own
        Save lived down in its panel while this bar still offered "Save the
        design", and the two wrote unrelated records: one the card's treatment
        and motto, the other the template's geometry. Same word, same screen,
        eighteen inches apart, and no way to tell which one had kept your work.

        So the bar carries whichever save belongs to the tab you are on, in the
        one place every tab puts it. "Print a test page" goes with it on the
        digital tab: it fills a sheet of PAPER tickets, which is not a test of
        the picture a buyer is sent. It is not disabled-with-a-reason here — a
        disabled control says "not for you", and this one is simply not part of
        this tab, the way Place's rulers are not.
      -->
      <template v-if="tab === 'digital'">
        <!--
          SEND A TEST, which 8c draws and which had nothing behind it. It
          rasterises the card on screen and hands it to whatever this machine
          shares with, or saves it when the machine has nothing — the same two
          outcomes the buyer's own Send on WhatsApp has, for the same reason.
          It is a test of the DESIGN, so it never touches the server and never
          uses a real ticket number.
        -->
        <button class="btn sm" :disabled="digitalBusy"
                title="Make the picture this design produces and share or save it, the way a real one goes out"
                @click="digital?.sendTest()">
          {{ digitalBusy ? 'Making…' : 'Send a test' }}
        </button>
        <button class="btn sm primary" :disabled="cardSaving || mottoOver || !cardDirty"
                :title="mottoOver ? 'The motto is over 48 characters'
                  : !cardDirty ? 'Nothing has changed since the last save'
                  : 'Write the card onto the raffle'"
                @click="saveCard">
          {{ cardSaving ? 'Saving…' : 'Save the card' }}
        </button>
      </template>
      <template v-else>
        <button class="btn sm" :disabled="!active || !design"
                :title="active ? 'Fill one sheet with sample tickets, each with its own working QR, through the real print path' : 'Upload some artwork first'"
                @click="printTest">Print a test page</button>
        <button class="btn sm primary"
                :disabled="savingDesign || !design || problems.length > 0"
                :title="problems.length ? problems[0] : 'Write this design onto the template'"
                @click="saveDesign">
          {{ savingDesign ? 'Saving…' : changeCount ? `Save · ${changeCount}` : 'Save the design' }}
        </button>
      </template>
    </header>

    <p v-if="loadErr" class="note bad">{{ loadErr }}</p>
    <p v-else-if="loading" class="muted">Loading&hellip;</p>

    <template v-else>
      <!-- ================= PLACE ================= -->
      <div v-if="tab === 'place'" class="studio">
        <template v-if="active && design">

          <!-- ---------- the layers rail (card 9b) ---------- -->
          <!--
            LEFT, BESIDE THE ARTBOARD, which is where it was and where card 9b
            draws it. It spent one commit as a tab inside the right-hand panel,
            built to card 1b -- and 1b is in the document's "Earlier
            explorations, superseded" list. The live card is 9b: fields left,
            artboard dominant in the middle, the selected thing on the right.
            The organiser who uses this screen said the same thing from their
            own screen before anybody had read the index.

            The cost of the tabbed version is what settles it. You select FROM
            this list, so behind a tab it is a press away every time you move
            between objects, and the artboard gained 254px it did not need
            nearly as much as the list needed to be visible.
          -->
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
              <p class="say" title="Nothing here is fixed by the system — a field can go anywhere on either half.">
                Pick one, then draw a box.
              </p>
            </div>

            <!--
              AND THE THINGS THAT PRINT NOTHING THE RAFFLE KNOWS ABOUT.

              Its own group, under its own heading, because it is a different
              kind of act: everything above prints a VALUE — a number, a name, a
              code — and everything here is a shape somebody drew. Putting a
              rectangle in the same row as "A field" would say they were
              alternatives, and the first question anybody asks of a rectangle
              beside a ticket number is what it is going to print.

              ICONS RATHER THAN WORDS, which is the one place in this rail that
              is not a segmented control of labels. A rectangle, an ellipse and
              a line ARE their icons — a word for each would be a word nobody
              needs, and this is the drawing half of the screen.
            -->
            <div class="block">
              <h3 class="rubric">Draw</h3>
              <ToolBar label="Shapes to draw">
                <ToolButton icon="shape" label="Rectangle" :size="17"
                            :active="pendingDeco === 'rect'"
                            hint="Draw a rectangle — a tint behind a price, a panel, a border"
                            @click="beginAdd('d:rect')" />
                <ToolButton icon="reset" label="Ellipse" :size="17"
                            :active="pendingDeco === 'ellipse'"
                            hint="Draw an ellipse or a circle"
                            @click="beginAdd('d:ellipse')" />
                <ToolButton icon="minus" label="Line" :size="17"
                            :active="pendingDeco === 'line'"
                            hint="Draw a rule. Drag it flat for a horizontal one — a line with no height is a line, not a mistake"
                            @click="beginAdd('d:line')" />
                <ToolButton icon="type" label="Words" :size="17"
                            :active="pendingDeco === 'text'"
                            hint="Words you type, which print the same on every ticket. Unlike a field, the raffle puts nothing in it"
                            @click="beginAdd('d:text')" />
                <ToolButton icon="design" label="Mark" :size="17"
                            :active="pendingDeco === 'icon'"
                            hint="One of the app's own drawings, placed on the ticket"
                            @click="beginAdd('d:icon')" />
              </ToolBar>
              <p v-if="printRisks.length" class="tiny warnish">
                <!-- REPORTED, NOT REFUSED, and only here: every one of these is
                     right on the digital card, which is a picture on a lit
                     screen with no press and no grey. -->
                {{ printRisks[0] }}
                <template v-if="printRisks.length > 1">
                  &nbsp;&middot; and {{ printRisks.length - 1 }} more like it.
                </template>
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
                <!--
                  A RUBRIC, NOT A HEADING. This was an <h4>, so "Main half"
                  competed with the panel's own title and read as a name. Card
                  9b sets it as a label -- MAIN HALF · 3 -- which is the
                  treatment every other group in this panel already uses.
                -->
                <p v-if="byHalf[g.k].length" class="rubric halfhead">
                  {{ g.t }} <span class="count data">&middot; {{ byHalf[g.k].length }}</span>
                </p>
                <ul v-if="byHalf[g.k].length" class="ellist">
                  <li v-for="el in byHalf[g.k]" :key="el.id"
                      :class="{ on: sel === el.id, off: el.enabled === false }">
                    <!--
                      A GLYPH, NOT THREE LETTERS. The kind was rendered as FLD /
                      QR / TXT, which is the screen teaching its own abbreviations
                      in a 240px rail. Icon.vue already carries the element
                      palette this studio was drawn against -- 47 drawings, and
                      this file was asking for two of them.
                    -->
                    <Icon :name="KIND_ICON[el.kind]" :size="15" class="kind"
                          :class="el.kind" :title="KIND_WORD[el.kind]" />
                    <button type="button" class="elname"
                            @click="pick(el.id, $event.shiftKey || $event.metaKey)">{{ nameOf(el) }}</button>
                    <span v-if="trouble(el)" class="warnmark"
                          :title="`${nameOf(el)} ${trouble(el)}`">!</span>
                    <!--
                      AN EYE, NOT A TICK BOX, and on the right where 9b draws it.
                      A tick box says "include this in a set"; an eye says "show
                      this", and a layer row is about what appears on the ticket.
                      The control announces the ACTION -- "Hide Ticket number" --
                      because a button is named by what it does, not by its state.
                    -->
                    <Toggle v-model="el.enabled" :label="nameOf(el)" :size="15" />
                  </li>
                </ul>
              </template>
              <!--
                THE DRAWN SHAPES, IN THEIR OWN GROUP AND BELOW THE HALVES.

                Below, because that is the order they print in: everything drawn
                sits under every field. A list whose order contradicts the
                artefact it describes is a list somebody has to translate.

                NOT SPLIT BY HALF, unlike the fields above. A shape crosses the
                perforation all the time — a tint that runs the width of the
                ticket, a rule under both halves — so grouping them by side
                would put one thing in two places or force a choice the drawing
                does not have.

                REVERSED, so the topmost shape is the top row. The array is
                draw order and later draws over earlier; a layer list reads
                downwards from the front. The card tab reverses for the same
                reason and says so in the same words.
              -->
              <template v-if="decorations.length">
                <p class="rubric halfhead">
                  Drawn <span class="count data">&middot; {{ decorations.length }}</span>
                </p>
                <ul class="ellist">
                  <li v-for="d in [...decorations].reverse()" :key="d.id"
                      :class="{ on: sel === d.id, off: d.enabled === false }">
                    <Icon :name="d.kind === 'text' ? 'type' : d.kind === 'icon' ? 'design' : 'shape'"
                          :size="15" class="kind" :title="decoWord(d.kind)" />
                    <button type="button" class="elname"
                            @click="pick(d.id, $event.shiftKey || $event.metaKey)">{{ decoName(d) }}</button>
                    <!--
                      PINNED, NOT LOCKED-OUT. A drawn background is the thing
                      somebody keeps catching while working on what sits over
                      it, and this is the pin they put in it — it refuses a
                      DRAG and nothing else. It is not a permission and it does
                      not travel to anybody else.
                    -->
                    <ToolButton :icon="d.locked ? 'lock' : 'position'"
                                :label="d.locked ? `Unpin ${decoName(d)}` : `Pin ${decoName(d)}`"
                                :active="d.locked" :size="15"
                                :hint="d.locked ? 'Pinned — a drag will not move it. Click to release.'
                                                : 'Pin it, so working over it does not keep catching it'"
                                @click="mark(); d.locked = !d.locked" />
                    <Toggle v-model="d.enabled" :label="decoName(d)" :size="15" />
                  </li>
                </ul>
              </template>

              <p v-if="!elements.length && !decorations.length" class="tiny muted">
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
                <span class="say">or drag the line on the ticket</span>
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
              <span class="grow"></span>
              <!--
                THE ARTBOARD'S OWN NUMBERS: "190.0 × 61.5 mm · 2244 × 726 px ·
                300 dpi". They were in the header beside the template picker,
                where two shrinking items on one nowrap row overlapped each
                other at desk width — and where they were also furthest from
                the thing they describe. They belong under the artboard, beside
                the zoom, which is the other reading of the same object.

                All of it is data, so all of it takes --font-data.
              -->
              <span v-if="active && design" class="specs data">
                {{ printedSize }} · {{ active.width }} × {{ active.height }} px<template
                  v-if="dpi"> · {{ dpi.v }} dpi</template>
              </span>
              <!--
                THE SENTENCE THAT WAS HERE — "positions held as a share of the
                template, not as pixels" — is gone, and it is not lost. The
                footer says it in full, three lines down: "Held as shares of
                the template, so the same design survives a redraw at any size".
                Both arrived in one commit, adf1fca, so this was one author
                writing the fact twice rather than two decisions to state it.

                NOT A CLEAN DUPLICATE, WHICH I HAD TO BE TOLD. The footer said
                what SURVIVES a redraw; this said what the positions are NOT —
                pixels — and ticketscreen holds those as two facts on purpose.
                Deleting this dropped the second one, and the suite said so.
                The words moved into the footer rather than out of the screen.

                Worth moving here specifically because the rest of this change
                takes two sentences OUT of this bar on the grounds that a tool
                should be an icon with its explanation on hover. Leaving a third
                sentence saying half of what the footer says would have been the
                same noise in a different voice.
              -->

              <!--
                THE THREE TOOLS, as cards 9b and 9c draw them: an icon, a short
                label, lit when on. They were two captioned checkboxes reading
                "Snap to other boxes" and "Longest entry", and the organiser's
                instruction about this bar was that the tools should be icons
                with a hover explanation rather than sentences.

                THE SENTENCE MOVED, IT DID NOT GO. What the checkbox said in
                the bar is what the button says in its `title` — which is the
                same place this app already puts the reason a control cannot be
                used, so a reader looking for "what does this do" and a reader
                looking for "why can I not press this" look in one place.

                A BUTTON WITH aria-pressed, NOT A CHECKBOX WITH ITS BOX HIDDEN.
                Hiding the input would leave a control that a screen reader
                still announces as a checkbox inside a label whose text is one
                word; this says what it is.

                Right-aligned after the measurements, which is 9b's own
                arrangement: what the artboard IS on the left, what you can do
                to it on the right.
              -->
              <ToolBar label="Canvas tools">
                <ToolButton
                  icon="magnet" label="Snap" wide :size="15" :active="snapping"
                  hint="Line a box up with the edges of the other boxes as you drag it"
                  @click="snapping = !snapping" />
                <ToolButton
                  icon="grid" :label="`Grid ${GRID_MM} mm`" wide :size="15" :active="gridding"
                  hint="Line a box up with a 2 mm grid on the ticket itself, so a row of fields is square to the paper rather than to each other"
                  @click="gridding = !gridding" />
                <ToolButton
                  icon="type" label="Longest entry" wide :size="15" :active="showLongest"
                  hint="Draw the longest value each field will ever hold, so a box that is too small shows it here rather than on the printed ticket"
                  @click="showLongest = !showLongest" />
              </ToolBar>
            </div>

            <!--
              THE TOOL RAIL, beside the artboard rather than in the bar above it.

              The bar already holds a zoom stepper, a line of measurements and
              three toggles; eight more controls in it would make one strip of
              fourteen things with no grouping the eye can use. Down the left of
              the canvas they are where the hand already is when it is working
              on the artboard, and they group into what-you-are-doing /
              arranging / stacking, which is three positions to learn rather
              than eleven.

              EVERY ONE OF THESE ACTS ON THE SELECTION, and every one of them is
              disabled with the reason when there is nothing to act on — so the
              rail is never a row of live buttons that silently do nothing.
            -->
            <div class="withrail">
            <ToolBar label="Arrange" vertical>
              <span class="tgroup">
                <ToolButton icon="align" label="Align left" :why="whyNoSelection"
                            :hint="many ? 'Line the selected boxes up on their left edges'
                                        : 'Put this box against the left edge of the ticket'"
                            @click="alignPicked('left')" />
                <ToolButton icon="position" label="Centre across" :why="whyNoSelection"
                            :hint="many ? 'Centre the selected boxes on each other, across'
                                        : 'Centre this box across the ticket'"
                            @click="alignPicked('centre')" />
                <ToolButton icon="size" label="Centre down" :why="whyNoSelection"
                            :hint="many ? 'Centre the selected boxes on each other, down'
                                        : 'Centre this box down the ticket'"
                            @click="alignPicked('middle')" />
              </span>
              <span class="tgroup">
                <ToolButton icon="distribute" label="Space across" :why="whyNotDistribute"
                            hint="Even gaps between the selected boxes, left to right. The outermost two stay where they are."
                            @click="distributePicked('across')" />
                <ToolButton icon="margins" label="Space down" :why="whyNotDistribute"
                            hint="Even gaps between the selected boxes, top to bottom"
                            @click="distributePicked('down')" />
              </span>
              <span class="tgroup">
                <ToolButton icon="arrowUp" label="Bring forward" :why="whyNoSelection"
                            hint="One place nearer the front, so it prints over what it overlaps"
                            @click="orderPicked('forward')" />
                <ToolButton icon="arrowDown" label="Send backward" :why="whyNoSelection"
                            hint="One place further back"
                            @click="orderPicked('backward')" />
                <ToolButton icon="layers" label="Bring to front" :why="whyNoSelection"
                            hint="All the way to the front of the stack"
                            @click="orderPicked('front')" />
              </span>
              <span class="tgroup">
                <ToolButton icon="duplicate" label="Duplicate" :why="whyNoSelection"
                            hint="A copy, nudged down and right so it is visibly a copy"
                            @click="duplicatePicked" />
                <ToolButton icon="trash" label="Remove" :why="whyNoSelection"
                            hint="Take the selection off the ticket"
                            @click="deletePicked" />
              </span>
            </ToolBar>

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

                <!--
                  THE DRAWN SHAPES' BOXES, FIRST, so they sit under the fields'
                  the way the shapes themselves sit under the fields. A
                  selection outline that stacked the other way round would say
                  the opposite of what the ticket prints.

                  A decoration you can SEE — a filled rectangle — does not need
                  its box drawn to be found, so the outline only appears when
                  boxes are being shown or when it is in the selection. An
                  element is invisible until the raffle fills it in, which is
                  why theirs is drawn on the same terms but for a different
                  reason.
                -->
                <div
                  v-for="d in decorations" :key="d.id"
                  class="ebox deco"
                  :class="{ on: sel === d.id, too: also.includes(d.id), off: d.enabled === false,
                            faint: !showAllBoxes && !picked.includes(d.id) }"
                  :style="{ left: pc(d.box.left), top: pc(d.box.top), width: pc(d.box.width), height: pc(d.box.height) }"
                  :title="d.locked ? `${decoName(d)} is pinned — unlock it in the list to move it`
                                   : `${decoName(d)} — drag to move, or use the arrow keys`"
                  @pointerdown="startMove(d, $event)">
                  <button
                    type="button" class="grab" :aria-label="decoName(d)"
                    :disabled="d.enabled === false || d.locked"
                    :title="d.locked ? `${decoName(d)} is pinned` : `${decoName(d)} — drag to move, or use the arrow keys`"
                    @keydown="onKey" @click.stop="pick(d.id, $event.shiftKey || $event.metaKey)"></button>
                  <template v-if="sel === d.id && !many && !d.locked && d.enabled !== false">
                    <span
                      v-for="c in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="c"
                      class="hdl" :class="c"
                      @pointerdown="startResize(d, c, $event)"></span>
                  </template>
                </div>

                <!-- Every element's box. Shown as an outline when asked for, and
                     always for the selected one — you cannot position what you
                     cannot see the extent of. -->
                <div
                  v-for="el in elements" :key="el.id"
                  class="ebox"
                  :class="{ on: sel === el.id, too: also.includes(el.id), off: el.enabled === false,
                            faint: !showAllBoxes && !picked.includes(el.id), code: el.kind === 'code' }"
                  :style="{ left: pc(el.box.left), top: pc(el.box.top), width: pc(el.box.width), height: pc(el.box.height) }"
                  :title="el.enabled === false ? `${nameOf(el)} is switched off in the list` : `${nameOf(el)} — drag to move, or use the arrow keys`"
                  @pointerdown="startMove(el, $event)">
                  <button
                    type="button" class="grab" :aria-label="nameOf(el)"
                    :disabled="el.enabled === false"
                    :title="el.enabled === false ? `${nameOf(el)} is switched off in the list` : `${nameOf(el)} — drag to move, or use the arrow keys`"
                    @keydown="onKey" @click.stop="pick(el.id, $event.shiftKey || $event.metaKey)"></button>
                  <!-- Handles on the PRIMARY only. Eight of them on each of
                       five selected boxes is forty grips over one artboard, and
                       a drag from any of them resizes one thing while four
                       others look equally grabbable. -->
                  <template v-if="sel === el.id && !many && el.enabled !== false">
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
            </div><!-- .withrail -->

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

            <p v-if="previewError" class="note bad tiny">
      Nothing could be drawn on the ticket: {{ previewError }}
    </p>
    <p v-if="problems.length" class="note bad tiny">
              <span v-for="(p, i) in problems" :key="i">{{ p }}<br></span>
            </p>
          </div>

          <!-- ---------- the inspector: whatever is selected ---------- -->
          <Inspector :element="chosen" :report="fitReport"
                     :sheet-width-m-m="design.sheet.widthMM"
                     :qr-density="qrDensity"
                     :half="chosenHalf"
                     :in-pixels="inPixels" :mm-per="mmPer"
                     :swatches="swatches" :can-drop="canDrop"
                     @pick-colour="dropper" @remove="removeElement" />
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
      <SheetTab v-else-if="tab === 'sheet'" :design="design" :active="active" :dpi="dpi" />

      <!--
        CARD 8c — THE DIGITAL TICKET, and now the same three columns as the
        rest of the studio: what is on the card, the card, and whatever is
        selected. It was a treatment switch, a motto field and a picture — the
        one tab showing the thing a buyer actually receives, and the one tab
        you could not design.

        IT IS ITS OWN COMPONENT because it is a designer's worth of machinery —
        a canvas with drag, resize, snap and a grid, a layer list, an inspector
        — and almost none of it is shared with the printed side. A card part is
        a composition this app owns; a printed element is a box somebody drew
        on their own artwork. See src/lib/cardelements.js for the difference.
      -->
      <DigitalTab
        v-else ref="digital" :card="card" :parts="cardParts" :cfg="state.cfg"
        :sent-width="cardSentWidth" :motto-max="MOTTO_MAX"
        :swatches="swatches" :can-drop="canDrop"
        @mark="markCard" @drag="(v) => { cardDragging = v }"
        @pick-colour="dropper" />

      <!--
        THE FOOTER SAYS WHAT THE MODEL IS. It is one sentence and it is the
        thing somebody needs to know before they trust this screen with a press
        run: what they are moving is a proportion of the ticket, not a pixel on
        one particular file.
      -->
      <!--
        SAME REASONING AS THE BAR'S BUTTONS, one line down: the footer carries
        whichever set of three belongs to the tab you are on.

        IT USED TO BE HIDDEN ON THE DIGITAL TAB, and the note here said why —
        "there is no geometry and nothing placed", so Undo would have taken
        back a change to a drawing you were not looking at. That was true of a
        tab holding a treatment switch and a motto field. There is geometry
        now, and a tab where you can drag ten things around and take none of
        them back is the worse failure by a distance.
      -->
      <footer v-if="tab === 'digital'" class="footbar">
        <span class="say grow">
          Held as shares, so an arrangement survives a redraw. Only what you
          have moved is written down.
        </span>
        <button class="btn sm ghost danger" :disabled="!cardParts.length"
                :title="`Put every part of this card back where it started. The other ${CARD_TREATMENTS.length - 1} treatments keep whatever you have arranged on them. This cannot be undone.`"
                @click="resetCard">Standard card</button>
        <span class="gap"></span>
        <button class="btn sm ghost" :disabled="!cardDirty"
                :title="cardDirty ? 'Throw away every change since the last save' : 'Nothing has changed since the last save'"
                @click="revertCard">Back to saved</button>
        <button class="btn sm" :disabled="!cardHistory.length"
                :title="cardHistory.length ? 'Undo the last change' : 'Nothing to undo'"
                @click="undoCard">Undo</button>
                <button class="btn sm" :disabled="!cardFuture.length"
                :title="cardFuture.length ? 'Put back what Undo took \u2014 \u21e7\u2318Z' : 'Nothing to redo'"
                @click="redoCard">Redo</button>
      </footer>
      <footer v-else class="footbar">
        <span class="say grow">
          Held as shares, not pixels, so a design survives a redraw at any size.
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
                @click="resetDesign">Standard design</button>
        <span class="gap"></span>
        <button class="btn sm ghost" :disabled="!dirty"
                :title="dirty ? 'Throw away every change since the last save' : 'Nothing has changed since the last save'"
                @click="revertToSaved">Back to saved</button>
        <button class="btn sm" :disabled="!history.length"
                :title="history.length ? 'Undo the last change — \u2318Z' : 'Nothing to undo'"
                @click="undo">Undo</button>
        <!-- Beside Undo rather than hidden behind the shortcut. A redo nobody
             can see is one nobody knows exists, and the whole reason it is here
             is to make pressing Undo a cheap look rather than a commitment. -->
        <button class="btn sm" :disabled="!future.length"
                :title="future.length ? 'Put back what Undo took — \u21e7\u2318Z' : 'Nothing to redo'"
                @click="redo">Redo</button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
/*
 * 8c's own furniture went with it. The digital tab was two columns and a
 * picture styled from here — `.studio.digital`, `.dpanel`, `.dstage`,
 * `.dcard`, `.mt` — and it is now three columns in DigitalTab.vue, which
 * carries its own. A child's markup does not take its parent's scoped styles
 * with it, so leaving these behind would have left five inert rules that read
 * as the live ones.
 */
</style>

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
/*
 * ONE ROW AT DESK WIDTH, which is what card 9b draws and what the bar is for.
 *
 * It wraps below that, correctly — eight controls cannot share a phone's width.
 * But on a monitor the wrap put "Print a test page" and "Save the design" on a
 * line of their own under everything else, which reads as a second toolbar
 * rather than as the end of the first, and costs a row of the artboard's height
 * to say nothing.
 *
 * The two that give way are the template name and the dimensions: a name can
 * ellipsize and still be recognised, and the measurements are a reference
 * somebody reads once rather than scans. Nothing that can be PRESSED shrinks.
 *
 * 1200, NOT 1024. A fourth tab arrived — "Digital ticket" — and the row stopped
 * fitting at the low end of the range this covered. Held on one line anyway, it
 * did not overflow visibly, which is why it survived: the H2 shrank, wrapped to
 * "Ticket / Studio" and rendered straight across the template picker, and the
 * status truncated to the single letter "s". Both look like design.
 *
 * The number is measured, not guessed: the bar was rendered at seven container
 * widths from 1000 to 1240 with wrapping forced off, and its contents first sat
 * inside the box at about 1200. 1024 never fitted — even with three tabs it was
 * roughly 1120 — so this rule has been quietly squeezing the bar since it was
 * written. Below 1200 the bar wraps to two lines, which is the honest failure
 * and what it already does on a phone.
 */
@media (min-width: 1200px) {
  .bar { flex-wrap: nowrap; }
  .bar .picker { min-width: 0; flex: 0 1 auto; }
  /*
   * `width: 100%` is the whole fix. A select with only a max-width keeps its
   * intrinsic width while the label around it shrinks to nothing, so the
   * template name rendered straight across the item beside it — two strings
   * on top of each other at exactly the width this rule was added to tidy.
   * It has to be told to follow its box, not just be stopped from exceeding it.
   */
  .bar .picker select { max-width: 180px; width: 100%; }
}

/*
 * The unavailable screen. Centred and narrow because there is nothing to scan
 * — it is one fact and one way out, and a full-width card of body text reads
 * as an error the app had rather than a limit it has.
 */
.noroom {
  max-width: 420px; margin: 40px auto; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.noroom :deep(.ic) { color: var(--muted-2); }
.noroom h3 { margin: 0; }
.noroom p { margin: 0; }
.noroom .btn { margin-top: 8px; }
/* NOT A FLEX ITEM THAT GIVES. The title has no shorter form: shrunk, it wraps
   to two lines inside a row sized for one and lands on the control beside it.
   The picker and the `.grow` spacer are the slack in this bar. */
.bar h2 { margin: 0; font-size: 1.05rem; flex: none; white-space: nowrap }
.picker select { min-height: 34px; padding: 4px 8px; width: auto; max-width: 220px }
.specs { font-family: var(--font-data); font-size: .72rem; color: var(--muted) }
.tabs { display: flex; gap: 2px; padding: 2px; background: var(--surface-2); border-radius: var(--r-sm) }
/*
 * ONE LINE EACH, and it is not only a tidiness matter. "Artwork & paper" and
 * "Print sheet" were breaking after the first word, so a control that reads
 * as one row of three became six stacked words and the bar grew a second
 * line. The bar's height is spent twice over: the studio below it is sized
 * `calc(100vh - 150px)`, an allowance for this bar and the footer, so a bar
 * that wraps pushes the footer's actions off the bottom of the frame.
 */
.tabbtn {
  border: 0; background: none; color: var(--muted); cursor: pointer;
  padding: 6px 12px; border-radius: 8px; font-size: .84rem; font-weight: 500;
  white-space: nowrap;
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
  /* It may ellipsize a long sentence; it may not be squeezed down to one
     character. "s" where "saved" belongs is not a shortened status, it is a
     glyph wearing one. Its longest content is "edited 12:04". */
  flex: none;
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
/*
 * THE ROWS TAKE --row-h, WHICH THEY NEVER DID.
 *
 * This screen carries `.dense`, which sets --row-h to 34px at desk width and
 * leaves it at 68px on anything smaller. Nothing in this list referenced it, so
 * the rows sat at whatever their padding produced -- around 60px on a screen
 * that had already declared itself dense, and an organiser reading nine layers
 * got a third of a panel of air.
 *
 * `.dense .item` is the only rule in style.css that consumes the token, and a
 * layer row is not an `.item`. Reading the token directly is the fix. --tap is
 * untouched, and correctly so: nothing in this list is pressed one-handed in a
 * field, which is the only thing --tap protects.
 */
.ellist li {
  display: flex; align-items: center; gap: 7px; padding: 2px 4px;
  min-height: var(--row-h);
  border-bottom: 1px solid var(--border);
}
/*
 * THE GROUP LABEL WAS AN <h4> AND HAD NO RULE OF ITS OWN, so it took the
 * default heading weight and size and competed with the panel's title -- "Main
 * half" read as the name of something rather than as a label over three rows.
 * Card 9b sets it as a rubric: MAIN HALF · 3. The class now only carries what
 * is particular to it, which is the count sitting at the far edge.
 */
.halfhead {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 8px; margin: 10px 0 2px;
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
/* The kind, as a drawing. It keeps the three-letter badges' colour coding,
 * because that told the eye which rows were alike at a glance -- but the colour
 * is now reinforcement for a shape rather than the only difference between FLD
 * and TXT, and the word is on the title. */
.kind { flex: none; color: var(--muted) }
.kind.code { color: var(--info) }
.kind.text { color: var(--warn) }
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
/*
 * THE THREE TOOLS. An icon, a short label, lit when on — cards 9b and 9c.
 *
 * COLOUR IS THE STATE and there is no box. `--brand` when on, `--muted` when
 * off, which is the colour table's own pairing and the same one `.tabbtn` uses
 * one row up. A filled pill for each would have put three lozenges in a bar
 * that already holds a zoom stepper and a line of measurements, and the bar
 * would have read as four groups of controls instead of two.
 *
 * NOT `--tap`. That token is a correctness constraint for a control a SELLER
 * presses on a phone, standing up, one-handed — and this studio refuses to
 * open below tablet width and says so on its own screen. These are an
 * organiser's desk tools beside a 26px zoom stepper, so the density side of
 * that trade is the right one. 30px of height still clears a finger on the
 * tablet that is the smallest thing this screen will run on.
 */
/* .tools and .tool were declared HERE and again, identically, in
   DigitalTab.vue. Both are ui/ToolBar.vue and ui/ToolButton.vue now, and the
   reasoning above moved into ToolButton with them — including the part this
   bar was right about, which is that a tool carrying its WORD needs no fill. */

/* --stage, not --surface-2: the artboard sits ON something, and in dark mode
 * that something has to be BELOW the panels rather than level with them --
 * a panel cannot lift off a surface it matches. The token landed in 3770c4c
 * with nothing pointing at it; this is the surface it was cut for. */
.stage { overflow: auto; padding: 0 0 8px; background: var(--stage); border-radius: var(--r-sm) }
.stage.plain { padding-bottom: 0 }
.ruler {
  position: relative; height: 15px; margin: 0 auto; font-size: .6rem; color: var(--muted);
  font-family: var(--font-data);
}
.ruler span { position: absolute; top: 2px; padding-left: 3px; border-left: 1px solid var(--border) }
.ruler .right { right: 0; border-left: 0; border-right: 1px solid var(--border); padding: 0 3px 0 0 }

/*
 * --paper, not --surface. This is the sheet the ticket prints on, and it was
 * following the theme: in dark mode the artboard went near-black, so a field
 * was being positioned and judged against a colour no printer produces. The
 * <img> above it is unconditional, so on a FROM-SCRATCH design — 9a's second
 * route, and the state 9c itself draws — nothing covers the frame and the
 * artboard IS the paper. Artwork with transparency composites over it the same.
 * The surround it sits on (.stage) does flip, and should: that is the chrome.
 */
.frame {
  position: relative; margin: 0 auto; touch-action: none;
  box-shadow: var(--shadow); background: var(--paper);
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
/*
 * THE OTHERS IN A MULTI-SELECTION ARE MARKED, AND NOT AS BRIGHTLY.
 *
 * One outline weight for everything selected would lose which box the
 * inspector is editing, and the inspector edits exactly one. So the primary
 * keeps its 2px amber and the rest take a thinner line of the same hue: the
 * same colour says "selected", the weight says "and this one is the one the
 * panel is about".
 *
 * The literal amber rather than a token is the surrounding file's own choice
 * and its reason holds here: this outline sits on somebody's ARTWORK, which is
 * any colour at all, so it cannot be a theme colour that might land on its own
 * twin. It is the same value the primary uses, three lines down.
 */
/*
 * A DRAWN SHAPE'S OUTLINE IS A DIFFERENT COLOUR FROM A FIELD'S.
 *
 * Both are amber today and both sit on somebody's artwork, so two selected
 * things would say nothing about which list they came from — and the list is
 * the difference between "prints a value the raffle fills in" and "prints
 * exactly this". It matters at the moment somebody presses an order tool and
 * is told fields and shapes have no order between them: the screen should
 * already have said they were two kinds of thing.
 *
 * A literal rather than a token for the same reason the amber is one, three
 * rules down: this sits on ARTWORK, which is any colour at all, and a theme
 * colour could land on its own twin.
 */
.ebox.deco { outline-color: #12b5e5 }
.ebox.deco.on { outline: 2px solid #12b5e5; background: rgba(18, 181, 229, .14) }
.ebox.deco.too { outline: 1px solid #12b5e5; background: rgba(18, 181, 229, .07) }
.ebox.too {
  outline: 1px solid #ffb300;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, .45);
  background: rgba(255, 179, 0, .07);
}
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
  background: var(--info); color: var(--info-ink); font-size: .58rem; padding: 2px 3px;
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
 * NARROW: a rail stops being a column and goes under the canvas.
 *
 * THIS USED TO SAY 1200px AND STUDIO.CSS SAID 1023px, for the same rule, in two
 * files. TicketDesign.vue includes studio.css first and its own block second,
 * so on equal specificity this one won -- and three columns actually needed
 * 1201px while the comment reasoning it out, next door, said 1024. The
 * breakpoint and its documentation were 177px apart.
 *
 * The grid now lives in studio.css alone. What is left here is the part that is
 * genuinely this component's: which of its own furniture disappears when there
 * is no width for it. The grid itself is not here at all -- one declaration, in
 * studio.css, because two of them at different breakpoints is what put the
 * documented width 177px away from the effective one.
 */
@media (max-width: 1023px) {
  .rail { max-height: none }
}
</style>
