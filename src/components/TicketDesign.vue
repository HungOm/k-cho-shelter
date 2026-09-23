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
  validateElements,
} from '../lib/ticketelements.js'
import {
  EDGES, boundsOf, alignBoxes, distributeBoxes, orderMoved, offsetBox,
} from '../lib/arrange.js'
import {
  KINDS as DECO_KINDS, MAX_DECORATIONS, normalDecoration, nextDecoId, nextGroupId, printWarnings,
} from '../lib/designelements.js'
import { isClick, hitsIn, expandGroups, mergeSelection, drawBox, aboutCentre } from '../lib/selection.js'
import { copyRecords, pasteRecords, repeatStep } from '../lib/clipboard.js'
import { snapEdges, snapNear, snapSpan } from '../lib/studiocanvas.js'
import { KEYS, keyLabel, findBinding, fieldOwns } from '../lib/studiokeys.js'
import {
  exportSize, ticketSVG, layerDocument, inlineImages, fetchAsDataURI, rasterise, downloadBlob,
} from '../lib/ticketexport.js'
import { placeShape, normalLibrary, nextLibId } from '../lib/designlibrary.js'
import { encode } from '../lib/qrcodegen.js'
import { sheetHTML, pageFit } from '../lib/ticketsheet.js'
import { toPayload, reject as rejectFile } from '../lib/templatefile.js'
import { blankArtboardFile } from '../lib/blankticket.js'
import {
  browserStorage, designText, writeDraft, readDraft, clearDraft, compareDraft,
} from '../lib/studiodraft.js'
import Sheet from './ui/Sheet.vue'
import SheetTab from './ticketdesign/SheetTab.vue'
import ShapesPanel from './ticketdesign/ShapesPanel.vue'
import TemplateRail from './ticketdesign/TemplateRail.vue'
import ArtworkVerdict from './ticketdesign/ArtworkVerdict.vue'
import Inspector from './ticketdesign/Inspector.vue'
import DecorationInspector from './ticketdesign/DecorationInspector.vue'
import LibraryPanel from './ticketdesign/LibraryPanel.vue'
import DigitalTab from './ticketdesign/DigitalTab.vue'
import SelectionInspector from './ticketdesign/SelectionInspector.vue'
import Rulers from './ticketdesign/Rulers.vue'
import ShortcutsSheet from './ticketdesign/ShortcutsSheet.vue'
import PicturePicker from './ticketdesign/PicturePicker.vue'
import { usePen } from './ticketdesign/usePen.js'
import { pathData } from '../lib/pathgeometry.js'
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
/*
 * WHAT HAS BEEN DRAWN ON THE CARD, every treatment's, as config carries it
 * (STUDIO-ESSENTIALS Phase 9). Declared up here with the card's other state
 * because `loadCard` fills it from an immediate watcher during setup.
 */
const cardDecos = ref({})
const cardLayout = ref({})
const cardParts = ref([])
const cardSaving = ref(false)
const mottoLeft = computed(() => MOTTO_MAX - (card.value.motto || '').length)
const mottoOver = computed(() => mottoLeft.value < 0)

/* How wide the picture is actually sent, which is what decides whether the QR
   on it will scan. The template's own setting when there is one — the same
   number ViewTicket rasterises at — and its fallback when there is not. */
/* This treatment's drawings, and a new list for it — the card tab edits
   drawings in place and sends a new list when one is added or removed. */
const cardDrawn = computed(() => cardDecos.value[card.value.design] || [])
function setCardDrawn(list) {
  cardDecos.value = { ...cardDecos.value, [card.value.design]: list }
}

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
  /* In the saved state, so drawing makes the card dirty, is one undo step and
     is kept in the draft like everything else about it. */
  decorations: cardDecos.value,
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
/*
 * UNSAVED WORK KEPT ON THIS COMPUTER — see src/lib/studiodraft.js.
 *
 * Declared up here, above `loadCard`, for the same reason as the undo stack
 * below: loadCard runs from an immediate watcher during setup and offers the
 * card's draft, so anything it touches must already exist (watchorder).
 *
 * `drafts` is null where the browser will not lend its storage; every use
 * below then does nothing, and the studio opens exactly as it did before.
 */
const drafts = browserStorage()
const CARD_DRAFT = 'card'
/* An offer waiting for a yes or a no: { id, state, design, editedAt, keptAt }.
   While one is waiting, nothing new is written over it — a draft is not
   discarded by being ignored. */
const draftOffer = ref(null)
const cardDraftOffer = ref(null)

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
  const drawn = state.cfg?.cardDecorations
  cardDecos.value = drawn && typeof drawn === 'object' ? JSON.parse(JSON.stringify(drawn)) : {}
  rebaseCard()
  offerCardDraft()
}

function offerCardDraft() {
  cardDraftOffer.value = null
  if (!drafts) return
  const d = readDraft(drafts, CARD_DRAFT)
  const state = compareDraft(d, cardSavedState.value)
  if (state === 'same') clearDraft(drafts, CARD_DRAFT)
  if (state === 'newer' || state === 'stale') cardDraftOffer.value = { id: CARD_DRAFT, state, ...d }
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

watch([card, cardParts, cardDecos], () => {
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
  cardDecos.value = snap.decorations && typeof snap.decorations === 'object' ? snap.decorations : {}
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
  if (drafts) clearDraft(drafts, CARD_DRAFT)
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
      cardDecorations: cardDecos.value,
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
/* The artboard as a grey press will print it — a view, never saved. */
const inGrey = ref(false)
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
/*
 * `solo` is ⌘-click: this one thing, and not the group it belongs to. It is
 * how somebody works on one part of a placed library shape without ungrouping
 * it — the convention drawing tools have settled on. Without it a click on any
 * member of a group takes the whole group, which is what a group is for.
 */
function pick(id, add = false, solo = false) {
  if (!add) {
    const whole = solo ? [id] : expandGroups([id], decorations.value)
    sel.value = id
    also.value = whole.filter((x) => x !== id)
  } else if (id === sel.value) {
    sel.value = also.value[0] || ''
    also.value = also.value.slice(1)
  } else if (also.value.includes(id)) {
    also.value = also.value.filter((x) => x !== id)
  } else if (sel.value) {
    const whole = solo ? [id] : expandGroups([id], decorations.value)
    also.value = [...new Set([...also.value, sel.value, ...whole.filter((x) => x !== id)])]
      .filter((x) => x !== id)
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
 *
 * A copied GROUP is a new group. It used to keep the original's group id, so
 * a click on the copy selected the original as well and dragging one dragged
 * both. Duplicate now goes through the same records as paste, which already
 * gave each source group a fresh one.
 *
 * DUPLICATE AGAIN REPEATS THE LAST MOVE: duplicate, drag the copy along, and
 * every further ⌘D steps the same distance again (src/lib/clipboard.js,
 * repeatStep). `lastCopies` is what the step is measured from.
 */
const lastCopies = ref(null)

function makeCopies(opts = {}) {
  const got = pasteRecords(copyRecords(elements.value, decorations.value, picked.value), {
    nextId, nextDecoId, nextGroupId, room: MAX_DECORATIONS - decorations.value.length, ...opts,
  })
  const els = got.elements.map(normalElement)
  const decos = got.decorations.map(normalDecoration)
  if (els.length) design.value.elements = [...elements.value, ...els]
  if (decos.length) design.value.decorations = [...decorations.value, ...decos]
  const made = [...els, ...decos]
  sel.value = made[0]?.id || ''
  also.value = made.slice(1).map((x) => x.id)
  lastCopies.value = got.pairs.filter((p) => made.some((m) => m.id === p.copy))
  if (got.refused) {
    toast(`${got.refused} drawn ${got.refused === 1 ? 'shape was' : 'shapes were'} left out — a ticket holds ${MAX_DECORATIONS}`, 'bad')
  }
  return got.pairs
}

function duplicatePicked() {
  if (!pickedThings.value.length) return
  mark()
  const step = repeatStep(lastCopies.value, picked.value, (id) => thingById(id)?.box)
  makeCopies(step ? { step } : {})
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
 * ---------- copy, cut and paste ----------
 *
 * The clip is held in memory, not on the system clipboard: it carries records
 * this studio understands, it survives switching template (which is the point
 * of it over Duplicate), and a browser asks permission before a page may read
 * the system clipboard — a prompt on every paste is not a paste.
 */
const clip = ref(null)
let pastes = 0

function copyPicked() {
  if (!picked.value.length) return
  clip.value = copyRecords(elements.value, decorations.value, picked.value)
  pastes = 0
  toast(`Copied ${picked.value.length}`, 'ok')
}

function cutPicked() {
  if (!picked.value.length) return
  clip.value = copyRecords(elements.value, decorations.value, picked.value)
  pastes = 0
  deletePicked()
}

/* ⇧⌘V lands the paste exactly where the copied things were — on another
   template, the same place on that ticket. */
function pastePicked(inPlace = false) {
  if (!clip.value || !design.value) return
  mark()
  if (!inPlace) pastes += 1
  const got = pasteRecords(clip.value, {
    nextId, nextDecoId, nextGroupId, times: pastes, inPlace,
    room: MAX_DECORATIONS - decorations.value.length,
  })
  const els = got.elements.map(normalElement)
  const decos = got.decorations.map(normalDecoration)
  if (els.length) design.value.elements = [...elements.value, ...els]
  if (decos.length) design.value.decorations = [...decorations.value, ...decos]
  const made = [...els, ...decos]
  sel.value = made[0]?.id || ''
  also.value = made.slice(1).map((x) => x.id)
  if (got.refused) {
    toast(`${got.refused} drawn ${got.refused === 1 ? 'shape was' : 'shapes were'} left out — a ticket holds ${MAX_DECORATIONS}`, 'bad')
  }
}

/*
 * ---------- groups and mirrors ----------
 *
 * Only drawn shapes group and only drawn shapes mirror. A field prints a value
 * the raffle fills in, placed where that value belongs; mirroring a ticket
 * number would print it backwards, and grouping one with a tint would make a
 * click on the tint drag the number off its measured line.
 */
function groupPicked() {
  if (whyNotGroup.value) return
  mark()
  const g = nextGroupId()
  for (const d of pickedDecos.value) d.group = g
}

function ungroupPicked() {
  if (whyNotUngroup.value) return
  mark()
  for (const d of pickedDecos.value) d.group = ''
}

/* Mirrored as a SELECTION: every shape flips, and their places mirror within
   the box they share, so a group turns over as one thing rather than each
   part flipping where it stands. */
function flipPicked(axis) {
  const list = pickedDecos.value.filter((d) => !d.locked)
  if (!list.length) return
  mark()
  const b = boundsOf(list.map((d) => d.box))
  for (const d of list) {
    if (axis === 'across') {
      d.box.left = Math.round((b.left + b.left + b.width - d.box.left - d.box.width) * 1e7) / 1e7
      d.flipX = !d.flipX
    } else {
      d.box.top = Math.round((b.top + b.top + b.height - d.box.top - d.box.height) * 1e7) / 1e7
      d.flipY = !d.flipY
    }
  }
}

const whyNotGroup = computed(() => {
  if (!picked.value.length) return 'Nothing is selected'
  if (pickedEls.value.length) return 'Only drawn shapes group — a field is placed on its own'
  if (pickedDecos.value.length < 2) return 'Grouping needs two or more drawn shapes'
  const gs = new Set(pickedDecos.value.map((d) => d.group))
  if (gs.size === 1 && !gs.has('')) return 'These are already one group'
  return ''
})
const whyNotUngroup = computed(() => {
  if (!picked.value.length) return 'Nothing is selected'
  return pickedDecos.value.some((d) => d.group) ? '' : 'Nothing selected is in a group'
})
const whyNotFlip = computed(() => {
  if (!picked.value.length) return 'Nothing is selected'
  if (!pickedDecos.value.length) return 'Only drawn shapes flip — a field prints a value'
  return pickedDecos.value.some((d) => !d.locked) ? '' : 'Everything selected is pinned'
})

/* What the multi-selection panel lists. */
const pickedSummary = computed(() => pickedThings.value.map((t) => (isDeco(t.id)
  ? { id: t.id, drawn: true, name: decoName(t), word: decoWord(t.kind),
      icon: decoIcon(t.kind) }
  : { id: t.id, drawn: false, name: nameOf(t), word: KIND_WORD[t.kind], icon: KIND_ICON[t.kind] })))
const pickedBounds = computed(() => (pickedThings.value.length
  ? boundsOf(pickedThings.value.map((t) => t.box)) : null))
const pickedOneGroup = computed(() => {
  const gs = new Set(pickedDecos.value.map((d) => d.group))
  return pickedDecos.value.length > 1 && gs.size === 1 && !gs.has('')
})

/*
 * WHY EACH TOOL CANNOT BE PRESSED, or '' when it can. Handed straight to
 * ToolButton, which disables on the presence of a reason — so there is no way
 * to draw one of these enabled without an answer to "why not".
 */
const whyNoSelection = computed(() => (picked.value.length ? '' : 'Nothing is selected'))
/* What a press will not hold, as findings rather than refusals — see
   designelements.js. Only the printed tab asks for them. */
const riskOpts = () => ({ printed: true, widthMM: Number(design.value?.sheet?.widthMM ?? 0), pictureWidths: pictureWidths.value })
const printRisks = computed(() => printWarnings(decorations.value, riskOpts()))

/*
 * THE WARNINGS FOR ONE SHAPE, for the panel that is showing it. The rail's line
 * counts them all; the inspector says which of them are about the thing in
 * front of you, which is the only place somebody can act on one.
 */
function risksFor(d) {
  return d ? printWarnings([d], riskOpts()) : []
}

/* ---------- the library ---------- */

const library = computed(() => normalLibrary(state.cfg?.designLibrary))
const libBusy = ref(false)

/*
 * PLACED IN THE MIDDLE, AT A SIZE SOMEBODY CAN SEE AND THEN DRAG.
 *
 * Not at the pointer, because there is no pointer — this is a click in a rail
 * two hundred pixels from the artboard. Not at the size it was saved, because a
 * saved shape has no size: it holds its parts relative to its own bounds
 * precisely so that where it lands is a decision made now.
 *
 * A fifth of the ticket, centred, and SELECTED — so the next thing that
 * happens is a drag, which is what somebody placing a badge wants to do.
 */
function placeFromLibrary(shape) {
  if (!design.value) return
  mark()
  const made = placeShape(shape, { left: 0.4, top: 0.35, width: 0.2, height: 0.3 }, nextDecoId)
  /* ONE NEW GROUP PER PLACEMENT. A saved shape's parts may carry the group they
     had when they were saved, and two placements of it sharing that id would
     select each other. A single part is in no group. */
  const g = made.length > 1 ? nextGroupId() : ''
  for (const d of made) d.group = g
  design.value.decorations = [...decorations.value, ...made]
  sel.value = made[0].id
  also.value = made.slice(1).map((d) => d.id)
}

async function writeLibrary(next, said) {
  libBusy.value = true
  try {
    const r = await api('set_design_library', { library: next })
    if (r?.config) setConfig(r.config)
    toast(said, 'ok')
  } catch (err) {
    toast(err.message, 'bad', err.code)
  } finally { libBusy.value = false }
}

function saveToLibrary(shape) {
  writeLibrary({ ...library.value, shapes: [...library.value.shapes, shape] },
    `Saved “${shape.name}”`)
}

/*
 * REMOVING FROM THE LIBRARY TAKES NOTHING OFF A TICKET, which the control says
 * in its own hint. A shape placed on a design was copied at the moment it was
 * placed — the library is where it came FROM, not where it lives — and a
 * delete that also stripped every ticket that had ever used it would be the
 * most expensive misunderstanding this panel could cause.
 */
function removeFromLibrary(id) {
  writeLibrary({ ...library.value, shapes: library.value.shapes.filter((s) => s.id !== id) },
    'Taken out of the library')
}

/*
 * A COLOUR IS KEPT THE SAME WAY A SHAPE IS, and for the same reason it needed
 * keeping at all: `swatches` below are read off the artwork and thrown away on
 * reload, so the ink a printer matched had nowhere to live. These two make the
 * Colours row reachable — before them nothing could write one, so the row was
 * a read path with no write path and could never appear.
 */
function saveColourToLibrary(colour) {
  writeLibrary({ ...library.value, colours: [...library.value.colours, colour] },
    `Kept “${colour.name}”`)
}

function removeColourFromLibrary(id) {
  writeLibrary({ ...library.value, colours: library.value.colours.filter((c) => c.id !== id) },
    'Taken out of the library')
}

/*
 * LETTERING, KEPT AND USED. The selection's lettering is read off the first
 * lettered thing in it — drawn words, or a field or own words (a code has
 * none) — and a kept style is put on every lettered thing selected.
 */
const lettered = (t) => (isDeco(t.id) ? t.kind === 'text' : t.kind !== 'code')
const pickedLettering = computed(() => {
  const t = pickedThings.value.find(lettered)
  if (!t) return null
  return isDeco(t.id)
    ? { family: t.text.family, weight: t.text.weight, align: t.text.align,
        tracking: t.text.tracking || 0, colour: t.fill?.colour || '' }
    : { family: t.family, weight: t.weight, align: t.align, tracking: 0, colour: t.ink || '' }
})

function saveStyleToLibrary(style) {
  writeLibrary({ ...library.value, styles: [...library.value.styles, style] }, `Kept “${style.name}”`)
}
function removeStyleFromLibrary(id) {
  writeLibrary({ ...library.value, styles: library.value.styles.filter((t) => t.id !== id) }, 'Removed')
}
function useLibraryStyle(style) {
  const things = pickedThings.value.filter(lettered)
  if (!things.length) { toast('Select a field or some words to letter them', 'warn'); return }
  mark()
  for (const t of things) {
    if (isDeco(t.id)) {
      Object.assign(t.text, { family: style.family, weight: style.weight, align: style.align, tracking: style.tracking || 0 })
      if (style.colour) t.fill.colour = style.colour
    } else {
      Object.assign(t, { family: style.family, weight: style.weight, align: style.align })
      if (style.colour) t.ink = style.colour
    }
  }
}

function useLibraryColour(value) {
  const things = pickedThings.value
  if (!things.length) { toast('Select something to give it that colour', 'warn'); return }
  mark()
  for (const t of things) {
    if (t.fill) t.fill.colour = value
    else t.ink = value
  }
}

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
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Rule', text: 'Words', image: 'Picture', path: 'Path',
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
/* The drawing a drawn thing is shown by — the same one its tool on the rail
   wears, so the list and the rail name a kind the same way. */
function decoIcon(kind) {
  return { text: 'type', icon: 'design', image: 'image', path: 'pen' }[kind] || 'shape'
}

function decoWord(kind) {
  return kind === 'icon' ? 'Mark' : (DECO_WORD[kind] || 'Shape')
}

function decoName(d) {
  /* What somebody called it comes first; everything below is the fallback. */
  if (d?.name) return d.name
  const typed = String(d?.text?.value ?? '').trim()
  if (d?.kind === 'text' && typed) return `“${typed.length > 22 ? `${typed.slice(0, 21)}…` : typed}”`
  if (d?.kind === 'icon' && d.icon?.name) return `Mark · ${d.icon.name}`
  return decoWord(d?.kind)
}

/*
 * RENAMING A DRAWN SHAPE IN THE LIST — double-click its name. The field takes
 * the row's place and gives it back on Enter or when it loses focus; Escape
 * leaves the name as it was. One undo step, like every other change.
 */
const renaming = ref('')
function commitRename(d, value) {
  if (renaming.value !== d.id) return
  renaming.value = ''
  const next = String(value ?? '').replace(/[<>]/g, '').trim().slice(0, 40)
  if (next === (d.name || '')) return
  mark()
  d.name = next
}

/*
 * THE SIX ALIGNMENTS, as data so the two rows cannot drift apart in wording.
 * `one` is what a single box does (it goes to the edge of the TICKET); `many`
 * is what a selection does (its members go to the edge of their own bounds) —
 * the distinction arrange.js's boundsOf draws, said in the hint.
 */
const ALIGN_ACROSS = [
  { edge: 'left', icon: 'alignLeft', label: 'Align left',
    one: 'Put this box against the left edge of the ticket', many: 'Line the selected boxes up on their left edges' },
  { edge: 'centre', icon: 'alignCentre', label: 'Centre across',
    one: 'Centre this box across the ticket', many: 'Centre the selected boxes on each other, across' },
  { edge: 'right', icon: 'alignRight', label: 'Align right',
    one: 'Put this box against the right edge of the ticket', many: 'Line the selected boxes up on their right edges' },
]
const ALIGN_DOWN = [
  { edge: 'top', icon: 'alignTop', label: 'Align top',
    one: 'Put this box against the top edge of the ticket', many: 'Line the selected boxes up on their top edges' },
  { edge: 'middle', icon: 'alignMiddle', label: 'Centre down',
    one: 'Centre this box down the ticket', many: 'Centre the selected boxes on each other, down' },
  { edge: 'bottom', icon: 'alignBottom', label: 'Align bottom',
    one: 'Put this box on the bottom edge of the ticket',
    many: 'Put the selected boxes on one line — their bottom edges, which is where the lettering sits' },
]

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
/*
 * ---------- pictures ----------
 *
 * What can be placed is what this raffle has already uploaded: its logo, from
 * Setup, and the artwork in this studio. A picture is stored by address, so it
 * has to be somewhere already; uploading a new one from here is its own piece
 * of server work, and the picker says what it offers.
 */
const pictures = computed(() => [
  ...(state.cfg?.orgLogo ? [{ src: state.cfg.orgLogo, name: "The raffle's logo", kind: 'logo' }] : []),
  ...templates.value.filter((t) => t.url).map((t) => ({ src: t.url, name: t.name, kind: 'artwork' })),
])
const whyNoPicture = computed(() => (pictures.value.length ? ''
  : "There are no pictures yet — upload a logo in Setup, or artwork on the Artwork tab"))
const showPictures = ref(false)
/* The picture waiting for its box to be drawn, and — when the picker was
   opened from the inspector — the placed picture it will replace instead. */
const pendingPicture = ref('')
const changingPicture = ref('')

function openPictures() {
  if (whyNoPicture.value) return
  changingPicture.value = ''
  showPictures.value = true
}
function changePicture() {
  if (!chosenDeco.value) return
  changingPicture.value = chosenDeco.value.id
  showPictures.value = true
}
function pickPicture(src) {
  showPictures.value = false
  const d = changingPicture.value && decorations.value.find((x) => x.id === changingPicture.value)
  changingPicture.value = ''
  if (d) { mark(); d.image.src = src; return }
  pendingPicture.value = src
  if (pending.value !== 'd:image') beginAdd('d:image')
}

/*
 * HOW MANY PIXELS EACH PLACED PICTURE HAS, learnt by loading it — the only way
 * to know, and what lets the studio warn that a header-sized logo placed large
 * will print soft. Browser only; a picture not yet loaded is not warned about.
 */
const pictureWidths = ref({})
watch(() => decorations.value.filter((d) => d.kind === 'image' && d.image?.src).map((d) => d.image.src).join('\n'),
  (joined) => {
    if (typeof Image === 'undefined') return
    for (const src of joined.split('\n').filter(Boolean)) {
      if (pictureWidths.value[src]) continue
      const img = new Image()
      img.onload = () => { pictureWidths.value = { ...pictureWidths.value, [src]: img.naturalWidth } }
      img.src = src
    }
  })

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
    /* A picture is fitted whole to start with: the one placed most is a logo,
       and a logo cropped to fill its box has lost its edges. */
    image: kind === 'image' ? { src: pendingPicture.value, fit: 'contain' } : {},
    ...(kind === 'image' ? { fill: { type: 'none', colour } } : {}),
  })
  if (kind === 'image') pendingPicture.value = ''
  design.value.decorations = [...decorations.value, made]
  sel.value = made.id
  also.value = []
  pending.value = ''
}

/*
 * ---------- the pen ----------
 *
 * Drawing and node editing live in usePen.js, shared with the card tab; what
 * is here is where a finished path goes and how the pointer reaches the pen.
 */
const pen = usePen({
  aspect: () => (active.value?.width && active.value?.height ? active.value.width / active.value.height : 3),
  mark,
  target: () => chosenDeco.value,
  place: (p) => {
    const side = p.box.left + p.box.width / 2 >= stubShare(design.value) ? 'stub' : 'half'
    const colour = inkNear(side)
    mark()
    const made = normalDecoration({
      id: nextDecoId(), kind: 'path', half: side === 'stub' ? 'stub' : 'main', box: p.box, path: p.path,
      /* A pen stroke is a line to start with: no fill until one is asked for. */
      fill: { type: 'none', colour }, stroke: { width: 0.002, colour },
    })
    design.value.decorations = [...decorations.value, made]
    sel.value = made.id
    also.value = []
    pending.value = ''
  },
})
const { drawing: penDrawing, draftNodes, editing: penEditing, handles: penHandles, chosenNode } = pen
/* The pen draws in the artwork's own pixels: the overlay's viewBox is the
   artwork, so a stroke that is a pixel wide on screen is a pixel wide here. */
const artPx = ([x, y]) => [x * (active.value?.width || 1600), y * (active.value?.height || 517)]
const penDraftD = computed(() => pathData(draftNodes.value, false, artPx))
const penEditD = computed(() => (penHandles.value.length && chosenDeco.value
  ? pathData(penHandles.value, chosenDeco.value.path.closed, artPx) : ''))
/* The nodes being drawn or edited, and the handle lines, for the overlay. */
const penPoints = computed(() => (penDrawing.value ? penDrawing.value.nodes : penHandles.value))
const penArms = computed(() => {
  const out = []
  penPoints.value.forEach((n, i) => {
    if (n.hx1 !== undefined) out.push({ key: `${i}a`, i, which: 'h1', x: n.hx1, y: n.hy1, from: n })
    if (n.hx2 !== undefined) out.push({ key: `${i}b`, i, which: 'h2', x: n.hx2, y: n.hy2, from: n })
  })
  return out
})
function pointOf(ev) {
  const r = frame.value?.getBoundingClientRect()
  if (!r || !r.width) return [0, 0]
  return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]
}
function gripPen(i, which, ev) {
  if (penDrawing.value) return
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  pen.gripDown(i, which, pointOf(ev))
  drag.value = { mode: 'grip' }
}
function editChosenNodes() {
  if (chosenDeco.value?.kind === 'path') pen.enter(chosenDeco.value.id)
}
/* A different selection, or a different tool, ends node editing and drawing. */
watch(sel, (id) => { if (penEditing.value && id !== penEditing.value) pen.leave() })
watch(pending, (p) => { if (p !== 'd:path' && penDrawing.value) pen.cancel() })

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

/* One pixel of the artwork to one pixel of the screen — the only zoom at
   which a hairline on screen is a hairline on the file. */
function zoomActual() { zoom.value = 1 }

/* The hand: Space held turns a press on the artboard into a pan, and H picks
   it up to keep — until V, Escape or another tool puts it down. */
const spaceHeld = ref(false)
const handTool = ref(false)
const handUp = computed(() => spaceHeld.value || handTool.value)

/*
 * ⌘-SCROLL AND A PINCH ZOOM ABOUT THE POINTER. A trackpad pinch arrives as a
 * wheel event with Ctrl held, so one handler serves both. The point under the
 * pointer stays under it — a zoom that recentres somewhere else loses the
 * thing somebody was zooming in to look at.
 */
function zoomAt(ev, getZoom, setZoom, scroller) {
  if (!(ev.ctrlKey || ev.metaKey)) return
  ev.preventDefault()
  const el = scroller
  const before = getZoom()
  const next = Math.max(0.05, Math.min(4, before * Math.exp(-ev.deltaY * 0.01)))
  if (!el) { setZoom(next); return }
  const r = el.getBoundingClientRect()
  const px = ev.clientX - r.left + el.scrollLeft
  const py = ev.clientY - r.top + el.scrollTop
  setZoom(next)
  nextTick(() => {
    el.scrollLeft = px * (next / before) - (ev.clientX - r.left)
    el.scrollTop = py * (next / before) - (ev.clientY - r.top)
  })
}
const onStageWheel = (ev) => zoomAt(ev, () => zoom.value, (z) => { zoom.value = z }, stage.value)

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
  /* Breathing room, so the ticket is not jammed against the scroller — and the
     ruler down the left side, which the artboard now shares the width with. */
  zoom.value = Math.max(0.05, (el.clientWidth - 48) / aw)
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
/* The line the last snap on each axis caught, or null — read by the drag to
   draw a guide where the box landed. */
let caughtX = null
let caughtY = null
function snapTo(value, candidates, step = 0) {
  return snapNear(value, snapping.value ? candidates : [], step, SNAP)
}

/*
 * THE GUIDES: a hairline across the artboard at whatever line the moving box
 * just caught — another box's edge or centre, the artboard's centre, the stub.
 * Null when nothing did, which is most of the time. A grid catch draws none;
 * the grid is already on screen.
 */
const snapLines = ref({ x: null, y: null })

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
const snapX = (v, xs) => { const r = snapTo(v, xs, gridX.value); if (r.hit !== null) caughtX = r.hit; return r.value }
const snapY = (v, ys) => { const r = snapTo(v, ys, gridY.value); if (r.hit !== null) caughtY = r.hit; return r.value }

/*
 * WHAT A MOVING BOX MAY SNAP TO: every edge of every OTHER thing on the ticket.
 *
 * Two corrections to the version this replaced, both found by dragging a
 * placed library shape. It read `elements` only, so a field could not be lined
 * up with a drawn rule and a drawn rule could not be lined up with anything.
 * And it excluded only the box under the pointer, so in a group drag the
 * primary snapped to the edges of the other boxes travelling WITH it — edges
 * that move as it moves, which is snapping to yourself.
 *
 * Hidden things are not candidates: an edge you cannot see is a pull you
 * cannot explain.
 */
function edgesExcept(moving) {
  /* Edges AND centres now, and the artboard's own centre — src/lib/
     studiocanvas.js, where the tests can reach the arithmetic. */
  return snapEdges([...elements.value, ...decorations.value], moving, { stubAt: stubShare(design.value) })
}

function startMove(el, ev) {
  if (handUp.value) { ev.stopPropagation(); onFrameDown(ev); return }
  if (el.enabled === false || el.locked) return
  ev.stopPropagation()

  /*
   * SHIFT ON THE CANVAS SELECTS, IT DOES NOT DRAG. Somebody adding a fifth box
   * to a selection is aiming at the box, not at a destination, and a drag that
   * begins on the same press moves it a few pixels every time — which is a
   * design quietly nudged out of alignment by the act of selecting it.
   */
  if (ev.shiftKey) { pick(el.id, true); return }

  mark()
  /* ⌘ drags the one part under the pointer out of its group's selection. */
  if (ev.metaKey || ev.ctrlKey) pick(el.id, false, true)
  /*
   * PRESSING SOMETHING ALREADY SELECTED KEEPS THE SELECTION, and drags all of
   * it. Anything else makes a multi-selection impossible to move: you pick
   * three, press one to drag them, and the press throws the other two away.
   */
  else if (!picked.value.includes(el.id)) pick(el.id)

  /*
   * ⌥-DRAG LEAVES THE ORIGINAL AND DRAGS A COPY — the copies are made exactly
   * on top, and it is they that move. One undo step takes the whole gesture
   * back, because mark() was called above and the copy does not call it again.
   */
  if (ev.altKey && !penEditing.value) {
    const index = picked.value.indexOf(el.id)
    const pairs = makeCopies({ inPlace: true })
    const mine = pairs.find((p) => p.from === el.id) || pairs[index]
    const copy = mine && thingById(mine.copy)
    if (copy) el = copy
  }

  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = {
    mode: 'move', id: el.id, px: ev.clientX, py: ev.clientY, box: { ...el.box },
    /* Every box's starting position, so the delta is applied to where each one
       WAS rather than accumulating per frame. The primary is excluded — it is
       handled by the snapping path below and would otherwise move twice. */
    /* Of EITHER kind. This read `pickedEls`, so a selection holding drawn
       shapes left them behind — and a library shape is several drawn shapes
       placed as one selection, so it came apart on its first drag. A pinned
       or hidden member stays put, the same as when it is dragged alone. */
    group: pickedThings.value
      .filter((t) => t.id !== el.id && !t.locked && t.enabled !== false)
      .map((t) => ({ id: t.id, box: { ...t.box } })),
  }
}

function startResize(el, corner, ev) {
  ev.stopPropagation()
  if (el.locked) return
  mark()
  sel.value = el.id
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'resize', corner, id: el.id, px: ev.clientX, py: ev.clientY, box: { ...el.box } }
}

/*
 * A PRESS ON THE ARTBOARD ITSELF, not on a box.
 *
 * With a tool waiting it draws the new box, from the corner the pointer went
 * down on. With none it is a MARQUEE: drag across the ticket and everything
 * the band touches is selected — shift adds to what is already selected. A
 * press that does not move is a click on empty artboard, which clears the
 * selection; before this it did nothing, and there was no way to deselect
 * with the pointer at all.
 */
function onFrameDown(ev) {
  if (!frame.value) return
  /* The pen puts a node down; ⌥ with a path's nodes up adds one to it; any
     other press on the artboard ends node editing and carries on as before. */
  if (pending.value === 'd:path') {
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    pen.down(pointOf(ev), ev)
    drag.value = { mode: 'pen' }
    return
  }
  if (penEditing.value) {
    if (ev.altKey && pen.addNodeAt(pointOf(ev))) return
    pen.leave()
  }
  /* Space held, or the hand picked up with H: the artboard scrolls under the
     pointer instead of anything being drawn or selected. */
  if (handUp.value) {
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
    drag.value = { mode: 'pan', px: ev.clientX, py: ev.clientY,
      sl: stage.value?.scrollLeft || 0, st: stage.value?.scrollTop || 0 }
    return
  }
  const r = frame.value.getBoundingClientRect()
  const left = (ev.clientX - r.left) / r.width
  const top = (ev.clientY - r.top) / r.height
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = {
    mode: pending.value ? 'draw' : 'band', add: ev.shiftKey,
    aspect: r.width / (r.height || 1),
    px: ev.clientX, py: ev.clientY, origin: { left, top }, box: { left, top, width: 0, height: 0 },
  }
}

const drawn = ref(null)

function onPointerMove(ev) {
  const st = drag.value
  /* Between clicks the pen's rubber band follows the pointer. */
  if (!st && penDrawing.value) { pen.move(pointOf(ev), ev); return }
  if (!st) return
  if (st.mode === 'pen') { pen.move(pointOf(ev), ev); return }
  if (st.mode === 'grip') { pen.gripMove(pointOf(ev), ev); return }
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

  if (st.mode === 'pan') {
    if (stage.value) {
      stage.value.scrollLeft = st.sl - (ev.clientX - st.px)
      stage.value.scrollTop = st.st - (ev.clientY - st.py)
    }
    return
  }

  if (st.mode === 'draw' || st.mode === 'band') {
    const r = frame.value.getBoundingClientRect()
    /* Shift and ⌥ shape what is being DRAWN; a marquee is only a band. */
    const drawing = st.mode === 'draw'
    drawn.value = drawBox(st.origin, {
      left: (ev.clientX - r.left) / r.width, top: (ev.clientY - r.top) / r.height,
    }, { square: drawing && ev.shiftKey, centre: drawing && ev.altKey, aspect: st.aspect, line: pendingDeco.value === 'line' })
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
  const { xs, ys } = edgesExcept(new Set([st.id, ...(st.group || []).map((g) => g.id)]))

  if (st.mode === 'move') {
    /* Whichever of the box's three lines — leading edge, centre, trailing edge
     * — comes nearest something wins, so no side is privileged and centring
     * one thing under another is a drag, not a sum. */
    const on = snapping.value
    const sx = snapSpan(st.box.left + dx, st.box.width, on ? xs : [], gridX.value)
    const sy = snapSpan(st.box.top + dy, st.box.height, on ? ys : [], gridY.value)
    el.box.left = sx.start
    el.box.top = sy.start
    snapLines.value = { x: sx.hit, y: sy.hit }

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
    caughtX = null
    caughtY = null
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
      if (ev.altKey) Object.assign(el.box, aboutCentre(st.box, el.box))
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
    /* ⌥: the opposite edge mirrors the dragged one, about the middle. */
    if (ev.altKey) Object.assign(el.box, aboutCentre(st.box, el.box))
    snapLines.value = { x: caughtX, y: caughtY }
  }
}

function endPointer() {
  const st = drag.value
  if (st?.mode === 'pen') pen.up()
  if (st?.mode === 'grip') pen.gripUp()
  if (st?.mode === 'band') {
    const band = drawn.value
    if (isClick(band)) {
      if (!st.add) { sel.value = ''; also.value = [] }
    } else {
      const hits = expandGroups(hitsIn([...elements.value, ...decorations.value], band), decorations.value)
      const next = mergeSelection({ sel: sel.value, also: also.value }, hits, st.add)
      sel.value = next.sel
      also.value = next.also
    }
  }
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
  snapLines.value = { x: null, y: null }
}

function startStubDrag(ev) {
  ev.stopPropagation()
  mark()
  ev.currentTarget.setPointerCapture?.(ev.pointerId)
  drag.value = { mode: 'stub', px: ev.clientX, py: ev.clientY }
}

/*
 * THE ARROWS NUDGE ONE PIXEL, SHIFT TEN — pixels of the artwork, so a nudge is
 * the same distance on the file at any zoom, and it is the step every drawing
 * program uses. They answer from the window, not from the focused box: after a
 * marquee, a click in the layer list or a paste, nothing on the artboard has
 * the keyboard focus, and the arrows used to scroll the page instead.
 */
function nudge(ev) {
  /*
   * THE SELECTION MOVES, NOT ONLY ITS PRIMARY. A drag already moved all of it
   * and the arrow keys moved one box, so nudging three aligned fields by a
   * millimetre took them out of alignment — the one thing a nudge is for.
   *
   * The step is clamped ONCE, for the whole selection, to what the most
   * constrained member allows; clamping each box on its own would let the
   * others carry on past the one that stopped at the edge, and the group
   * would shear. Fields stay on the artwork; drawn shapes may hang off it,
   * within the limits the model gives them.
   */
  const movers = pickedThings.value.filter((t) => !t.locked && t.enabled !== false)
  const n = ev.shiftKey ? 10 : 1
  const w = design.value?.artwork?.width || active.value?.width || 1000
  const h = design.value?.artwork?.height || active.value?.height || 1000
  const map = {
    ArrowLeft: [-n / w, 0], ArrowRight: [n / w, 0], ArrowUp: [0, -n / h], ArrowDown: [0, n / h],
  }
  const d = map[ev.key]
  if (!d) return false
  /* With a path's nodes up, the chosen node moves instead of the path. */
  if (penEditing.value && chosenNode.value >= 0) return pen.nudgeNode(d[0], d[1])
  if (!movers.length) return false
  mark()
  let [dx, dy] = d
  for (const t of movers) {
    const [lo, hi] = isDeco(t.id) ? [-1, 2] : [0, 1]
    dx = Math.max(lo - t.box.left, Math.min(hi - t.box.width - t.box.left, dx))
    dy = Math.max(lo - t.box.top, Math.min(hi - t.box.height - t.box.top, dy))
  }
  for (const t of movers) {
    t.box.left = Math.round((t.box.left + dx) * 1e7) / 1e7
    t.box.top = Math.round((t.box.top + dy) * 1e7) / 1e7
  }
  return true
}

/* ⇧⌘L: pin or unpin. If anything selected is loose, everything is pinned;
   only a selection that is all pinned is let go. */
function lockPicked() {
  const list = pickedThings.value
  if (!list.length) return false
  mark()
  const pin = list.some((t) => !t.locked)
  for (const t of list) t.locked = pin
  toast(pin ? `Pinned ${list.length}` : `Unpinned ${list.length}`, 'ok')
  return true
}

/* ⌘B: bold lettering on, or off when all of it is bold already. */
function boldPicked() {
  const list = pickedThings.value.filter(lettered)
  if (!list.length) return false
  mark()
  const weightOf = (t) => (isDeco(t.id) ? t.text.weight : t.weight)
  const next = list.every((t) => weightOf(t) === 'bold') ? 'regular' : 'bold'
  for (const t of list) { if (isDeco(t.id)) t.text.weight = next; else t.weight = next }
  return true
}

/* I: the eyedropper colours the selection from anywhere on the screen. */
function eyedropPicked() {
  if (!canDrop || !pickedThings.value.length) return false
  dropper(useLibraryColour)
  return true
}

/* A double-click on a grouped shape goes into the group and takes that one
   part; on a path it puts the nodes up. Escape comes back out. */
function enterThing(d) {
  if (d.kind === 'path') { pick(d.id, false, true); pen.enter(d.id); return }
  if (d.group) pick(d.id, false, true)
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
  offerDraft()
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
  window.addEventListener('keyup', onFocusKeyUp)
  window.addEventListener('blur', dropHand)
  window.addEventListener('beforeunload', onLeavePage)
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
  window.removeEventListener('keyup', onFocusKeyUp)
  window.removeEventListener('blur', dropHand)
  window.removeEventListener('beforeunload', onLeavePage)
  keepDraftNow()
  keepCardDraftNow()
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
  window.removeEventListener('keyup', onFocusKeyUp)
  window.removeEventListener('blur', dropHand)
  window.removeEventListener('beforeunload', onLeavePage)
  keepDraftNow()
  keepCardDraftNow()
})

/*
 * onFocusKey is the one WINDOW listener for every key the studio answers —
 * including the arrows, which used to be bound on each box and so did nothing
 * unless that box happened to hold the keyboard focus.
 */
/*
 * TYPING IS NOT A SHORTCUT. Every key has to leave a text field alone, or
 * Delete eats a character out of a motto and ⌘A selects every box on the
 * ticket instead of the words in the box under the cursor. Which keys belong
 * to which kind of field is src/lib/studiokeys.js, fieldOwns — a checkbox or a
 * dropdown is not a text field, and treating it as one silenced every key.
 */
/* Letting go of Space puts the hand down. So does leaving the window, or the
   hand would stay up for somebody who tabbed away mid-pan and came back. */
function onFocusKeyUp(e) { if (e.key === ' ') spaceHeld.value = false }
function dropHand() { spaceHeld.value = false }

/*
 * EVERY KEY IS LOOKED UP, not tested for one at a time. The table is
 * src/lib/studiokeys.js, which the shortcuts sheet lists from too; ACTIONS is
 * what each row's `action` runs here. tests/studiokeys.test.mjs holds the two
 * to one another in both directions, so a key cannot work without being on
 * the sheet, or be on the sheet without working.
 */
const choose1 = (kind) => () => { if (pending.value !== kind) beginAdd(kind) }
const ACTIONS = {
  toolSelect: () => { pending.value = ''; handTool.value = false },
  toolHand: () => { pending.value = ''; handTool.value = !handTool.value },
  toolRect: choose1('d:rect'),
  toolEllipse: choose1('d:ellipse'),
  toolLine: choose1('d:line'),
  toolWords: choose1('d:text'),
  toolMark: choose1('d:icon'),
  toolPicture: () => openPictures(),
  toolPen: choose1('d:path'),
  eyedropper: () => eyedropPicked(),
  editNodes: () => (chosenDeco.value?.kind === 'path' ? editChosenNodes() : false),
  /* Enter finishes a path being drawn and otherwise is not the studio's key —
     returning false leaves it to whatever button has the focus. */
  penFinish: () => (penDrawing.value ? pen.finish(false) || true : false),
  selectAll: () => {
    /* Everything that is on the ticket. A hidden element selected by ⌘A is one
       that arrange tools would move where nobody can see it happen. */
    const live = [...elements.value, ...decorations.value]
      .filter((t) => t.enabled !== false).map((t) => t.id)
    sel.value = live[0] || ''
    also.value = live.slice(1)
  },
  deselect: () => { sel.value = ''; also.value = [] },
  /*
   * Escape undoes one level of what is going on: a path being drawn is
   * finished (most drawing tools end an open path this way), node editing is
   * left, a waiting tool or the hand is put down, one part picked out of a
   * group goes back to being the group — and only then is the selection let go.
   */
  escape: () => {
    if (penDrawing.value) { if (!pen.finish(false)) pen.cancel(); return }
    if (penEditing.value) { pen.leave(); return }
    if (pending.value || handTool.value) { pending.value = ''; handTool.value = false; return }
    const d = chosenDeco.value
    const whole = d?.group ? expandGroups([d.id], decorations.value) : []
    if (whole.length > picked.value.length) { pick(d.id); return }
    sel.value = ''
    also.value = []
  },
  copy: () => copyPicked(),
  cut: () => cutPicked(),
  paste: () => pastePicked(),
  pasteInPlace: () => pastePicked(true),
  duplicate: () => duplicatePicked(),
  /* With a path's nodes up, Delete removes the chosen NODE, not the path. */
  remove: () => (penEditing.value && chosenNode.value >= 0 ? pen.removeChosen() : deletePicked()),
  group: () => groupPicked(),
  ungroup: () => ungroupPicked(),
  lock: () => lockPicked(),
  bold: () => boldPicked(),
  nudge: (e) => nudge(e),
  forward: () => orderPicked('forward'),
  backward: () => orderPicked('backward'),
  front: () => orderPicked('front'),
  back: () => orderPicked('back'),
  /* ⇧⌘Z for redo, which is what this platform's own apps use. Ctrl+Y is the
     Windows spelling and is not bound: a second binding nobody presses is a
     second thing to keep. */
  undo: () => (tab.value === 'digital' ? undoCard() : undo()),
  redo: () => (tab.value === 'digital' ? redoCard() : redo()),
  zoomIn: () => stepZoom(1),
  zoomOut: () => stepZoom(-1),
  fit: () => fitToWidth(),
  actual: () => zoomActual(),
  hand: () => { spaceHeld.value = true },
  /*
   * ⌘S SAVES WHAT IS ON THE TAB, and is always the studio's — the browser's
   * "save this page as HTML" is never what somebody in an editor means. The
   * same conditions as the Save button, and its reason said when it cannot.
   */
  save: () => {
    if (tab.value === 'digital') {
      if (cardSaving.value) return
      if (!cardDirty.value) { toast('Nothing has changed since the last save', 'ok'); return }
      saveCard()
      return
    }
    if (savingDesign.value || !design.value) return
    if (problems.value.length) { toast(problems.value[0], 'bad'); return }
    saveDesign()
  },
  exportPng: () => { if (whyNoExport.value) { toast(whyNoExport.value, 'warn'); return } downloadSample('png') },
  palette: () => { showKeys.value = 'palette' },
  focus: () => setFocus(!state.focus),
  help: () => { showKeys.value = 'keys' },
  alignLeft: () => alignPicked('left'),
  alignCentre: () => alignPicked('centre'),
  alignRight: () => alignPicked('right'),
  alignTop: () => alignPicked('top'),
  alignMiddle: () => alignPicked('middle'),
  alignBottom: () => alignPicked('bottom'),
  spaceAcross: () => distributePicked('across'),
  spaceDown: () => distributePicked('down'),
  flipAcross: () => flipPicked('across'),
  flipDown: () => flipPicked('down'),
  toggleSnap: () => { snapping.value = !snapping.value },
  toggleGrid: () => { gridding.value = !gridding.value },
  greyPreview: () => { inGrey.value = !inGrey.value },
  exportSvg: () => { if (whyNoExport.value) { toast(whyNoExport.value, 'warn'); return } downloadSample('svg') },
}

/* The keys' written form, for a tooltip: keyOf('duplicate') is "⌘D", or
   "Ctrl+D" off a Mac. */
const keyOf = (id) => keyLabel(KEYS.find((k) => k.id === id))

/* The sheet: '' closed, 'keys' for ?, 'palette' for ⌘K — one list, two ways in. */
const showKeys = ref('')

/*
 * ONE PATH FROM A ROW TO WHAT IT DOES, for a key and for the palette alike.
 * On the Digital ticket tab a canvas row is the card's to answer, against the
 * card's own selection; the card says `undefined` for the few it leaves to
 * the studio (the hand, which the studio holds for both surfaces).
 */
function runRow(row, e = {}) {
  if (row.group === 'Tools' && row.action !== 'toolHand') handTool.value = false
  if (tab.value === 'digital' && row.when === 'canvas') {
    const r = digital.value?.act?.(row.action, e)
    if (r !== undefined) return r
  }
  return ACTIONS[row.action]?.(e)
}

function runFromSheet(id) {
  const row = KEYS.find((k) => k.id === id)
  showKeys.value = ''
  if (row) nextTick(() => runRow(row))
}

function onFocusKey(e) {
  /* A dialog is up: its own keys (Escape closes it) are the only ones that
     mean anything, and a Delete behind it would remove a selection nobody can
     see. */
  if (showKeys.value || pendingSwitch.value || showPictures.value) return
  const row = findBinding(e, tab.value)
  if (!row) return
  if (fieldOwns(e.target, e, row)) return
  /* An action that answers false did not apply — Enter with no path being
     drawn, an arrow with nothing selected — and the key is left to the page. */
  if (runRow(row, e) !== false) e.preventDefault()
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
  offerDraft()
  nextTick(fitToWidth)
})

/*
 * ---------- keeping unsaved work ----------
 *
 * Written a moment after the design stops changing, not on every pointermove:
 * a drag is sixty writes a second of a string up to 64k long, and storage is
 * synchronous. Flushed at once on the way out — a switch, a hidden tab, the
 * page closing — because a timer does not survive any of those.
 */
let draftTimer = 0
function keepDraftNow() {
  clearTimeout(draftTimer)
  draftTimer = 0
  const id = active.value?.id
  if (!drafts || !id || !design.value || !saved.value || draftOffer.value) return
  if (!dirty.value) { clearDraft(drafts, id); return }
  writeDraft(drafts, id, {
    design: designText(design.value), saved: designText(saved.value), editedAt: editedAt.value,
  })
}
watch(design, () => {
  if (!drafts) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(keepDraftNow, 600)
}, { deep: true })

let cardDraftTimer = 0
function keepCardDraftNow() {
  clearTimeout(cardDraftTimer)
  cardDraftTimer = 0
  if (!drafts || cardDraftOffer.value) return
  if (!cardDirty.value) { clearDraft(drafts, CARD_DRAFT); return }
  writeDraft(drafts, CARD_DRAFT, { design: cardState.value, saved: cardSavedState.value })
}
watch(cardState, () => {
  if (!drafts) return
  clearTimeout(cardDraftTimer)
  cardDraftTimer = setTimeout(keepCardDraftNow, 600)
})

function offerDraft() {
  draftOffer.value = null
  const id = active.value?.id
  if (!drafts || !id || !saved.value) return
  const d = readDraft(drafts, id)
  const state = compareDraft(d, designText(saved.value))
  if (state === 'same') clearDraft(drafts, id)
  if (state === 'newer' || state === 'stale') draftOffer.value = { id, state, ...d }
}

/* Restoring is one undo step, so the saved design is a press of Undo away. */
function restoreDraft() {
  const d = draftOffer.value
  if (!d || !design.value) return
  mark()
  design.value = { ...JSON.parse(d.design), artwork: design.value.artwork }
  draftOffer.value = null
}
function discardDraft() {
  const d = draftOffer.value
  if (d) clearDraft(drafts, d.id)
  draftOffer.value = null
}
function restoreCardDraft() {
  const d = cardDraftOffer.value
  if (!d) return
  markCard()
  applyCard(JSON.parse(d.design))
  cardDraftOffer.value = null
}
function discardCardDraft() {
  if (cardDraftOffer.value) clearDraft(drafts, CARD_DRAFT)
  cardDraftOffer.value = null
}

/* The offer that belongs to the tab on screen, the same rule as Save. */
const shownDraft = computed(() => (tab.value === 'digital' ? cardDraftOffer.value : draftOffer.value))
const draftLine = computed(() => {
  const d = shownDraft.value
  if (!d) return ''
  const at = new Date(d.keptAt || Date.now())
  const today = new Date().toDateString() === at.toDateString()
  const when = today
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const what = tab.value === 'digital' ? 'card' : 'design'
  return d.state === 'stale'
    ? `Unsaved ${what} changes from ${when} were kept, but it has been saved since.`
    : `Unsaved ${what} changes from ${when} were kept on this computer.`
})

/*
 * ---------- switching template with unsaved work ----------
 *
 * The one move in the studio that takes work OFF the screen: the canvas is
 * reloaded from the template being switched to. With a draft kept, nothing is
 * lost and the dialog says where it went; without one, it is lost, and the
 * dialog says that instead and makes discarding the thing you press.
 *
 * Leaving the studio is NOT guarded. The screen is kept alive between visits
 * (App.vue's KeepAlive), so the work is exactly where it was on return, and a
 * question on the way out would be friction that protects nothing.
 */
const pendingSwitch = ref(null)
function askSwitch(id, proceed) {
  if (!id || id === activeId.value) return
  if (!dirty.value) { proceed(); return }
  keepDraftNow()
  pendingSwitch.value = { proceed }
}
function confirmSwitch() {
  const go2 = pendingSwitch.value?.proceed
  pendingSwitch.value = null
  go2?.()
}
function pickTemplate(ev) {
  const id = ev.target.value
  /* Put the picker back until the answer is in; a refused switch must not
     leave it naming a template the canvas is not showing. */
  ev.target.value = activeId.value
  askSwitch(id, () => { activeId.value = id })
}

/* Closing the page: flush what is kept, and ask the browser's own question. */
function onLeavePage(e) {
  keepDraftNow()
  keepCardDraftNow()
  if (dirty.value || cardDirty.value) { e.preventDefault(); e.returnValue = '' }
}

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
  /* Drawn shapes count the same way. Without this pass a design with ten new
     shapes and nothing else read "Save the design" — a clean button over a
     dirty design, beside a status that said "edited". */
  const dMine = new Map((now.decorations ?? []).map((d) => [d.id, key(d)]))
  const dTheirs = new Map((was.decorations ?? []).map((d) => [d.id, key(d)]))
  for (const [id, k] of dMine) if (dTheirs.get(id) !== k) n += 1
  for (const id of dTheirs.keys()) if (!dMine.has(id)) n += 1
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

function choose(id) {
  askSwitch(id, () => chooseNow(id))
}

async function chooseNow(id) {
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
    if (drafts && active.value) clearDraft(drafts, active.value.id)
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
  if (drafts && active.value) clearDraft(drafts, active.value.id)
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

/*
 * THE RAFFLE'S OWN COLOUR, OFFERED WHERE INK IS CHOSEN. It is set once in
 * Setup and was nowhere in this studio, so matching a printed heading to the
 * colour the app, the check page and the digital ticket already wear meant
 * reading a hex off another screen and typing it. Offered, not applied — the
 * ticket's ink stays the organiser's choice.
 */
const brandInk = computed(() => {
  const c = state.cfg?.brandColor
  return usable(c) ? String(c).toUpperCase() : ''
})

/* What the selected field itself gets wrong, beside it rather than at the foot
   of the canvas. Validated alone — `after` dropped, because whether its anchor
   still exists is a fact about the list, which the canvas foot still reports. */
const chosenFaults = computed(() => (chosen.value && design.value
  ? validateElements([{ ...chosen.value, after: '' }], stubShare(design.value))
  : []))

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
/*
 * ---------- one sample ticket, as a file ----------
 *
 * A proof for a print shop, or a picture to show somebody: the sample values
 * the canvas shows, a working sample QR, and the SAMPLE watermark the test
 * page carries — a file that travels must not pass for a real ticket.
 */
const exporting = ref('')
async function downloadSample(kind) {
  const t = active.value
  if (!design.value || !t || exporting.value) return
  exporting.value = kind
  try {
    const layer = elementLayerSVG(design.value, sampleValues.value, {
      qrUrl: ticketVerifyUrl(sampleVerifyBase.value, sampleNumber.value, 'SAMPLE0CODE0'),
      encode, watermark: 'SAMPLE',
    })
    const name = `${t.name} - sample ticket`
    if (kind === 'svg') {
      /* Sized in millimetres, so it opens at the size it prints. */
      const svg = ticketSVG({
        layer, artworkHref: t.url, artWidth: t.width, artHeight: t.height,
        width: `${Number(design.value.sheet.widthMM).toFixed(2)}mm`,
        height: `${printedHeightMM.value.toFixed(2)}mm`,
      })
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)
    } else {
      const size = exportSize(design.value.sheet.widthMM, t.width, t.height, 300)
      const { svg, failed } = await inlineImages(
        layerDocument({ layer, artWidth: t.width, artHeight: t.height }), fetchAsDataURI)
      const blob = await rasterise({ layerSVG: svg, artworkHref: t.url, ...size })
      downloadBlob(blob, `${name}.png`)
      if (failed.length) {
        toast(`${failed.length} placed ${failed.length === 1 ? 'picture' : 'pictures'} could not be fetched and ${failed.length === 1 ? 'is' : 'are'} missing from the file`, 'bad')
      }
    }
  } catch (err) {
    toast(`The ticket could not be saved: ${err?.message || err}`, 'bad')
  } finally {
    exporting.value = ''
  }
}
const whyNoExport = computed(() => (exporting.value ? 'Saving the last one…'
  : !active.value || !design.value ? 'Upload some artwork first' : ''))

/* The printed height in millimetres — derived, never stored, the same rule as
   the line below. */
const printedHeightMM = computed(() => {
  const t = active.value
  const w = Number(design.value?.sheet?.widthMM ?? 0)
  return t && w ? w * (t.height / t.width) : 0
})
/* The 2 mm grid as drawn. Two millimetres is the same number of pixels on both
   axes at any zoom, so the cell is square; below six pixels it is a tint, not
   a grid, and is not drawn. */
const gridCellPx = computed(() => {
  const w = Number(design.value?.sheet?.widthMM ?? 0)
  return w ? (GRID_MM / w) * frameWidth.value : 0
})
const gridShown = computed(() => gridding.value && gridCellPx.value >= 6)

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
      <!-- Every key the studio answers, listed from the table it answers them
           from. Beside the title because it is about the whole studio. -->
      <ToolButton icon="help" label="Shortcuts" :size="16" :keys="keyOf('help')"
                  hint="Every key this studio answers" @click="showKeys = 'keys'" />

      <!--
        THE PICTURE, BESIDE THE NAME — NOT INSTEAD OF IT.

        This header exists to answer "which template am I editing", which its
        own comment calls the question a screen with three tabs and two side
        panels most easily loses. It answered it in words, on a screen that
        shows the thing everywhere else: TemplateRail draws each template as
        its own thumbnail, LibraryPanel is "a click on a picture of itself",
        and the Draw row's shapes ARE their icons.

        Being shown a target as a picture rather than described in words made
        it 1.28-1.45 s faster to find across 10,282 searches of real interfaces
        (Putkonen et al., IJHCS 199:103483) — the second-largest effect in that
        data. And the header is the upper-left, where the first fixations land
        regardless of where the target actually is, so this is the one place on
        the screen where a picture is read before anybody decides to look.

        THE SELECT STAYS. A thumbnail is not a control: it cannot be tabbed to,
        cannot be opened from the keyboard, and cannot list what else there is.
        The image answers "which one is this" and the select answers "what else
        could it be" — the same division TemplateRail already uses, where the
        picture chooses and the tooltip carries the paperwork.

        DECORATIVE, DELIBERATELY. The select is already labelled "Template
        being designed" and already announces the active option, so alt text
        here would make a screen reader say the name twice. It sits inside the
        <label>, so clicking the picture focuses the select — the thing it
        depicts.

        GUARDED, BECAUSE THE URL CAN BE EMPTY. The server returns
        `url: String(r.url ?? '')`, so a template may carry an empty string,
        and `<img src="">` renders a broken-image glyph rather than nothing.
      -->
      <label v-if="templates.length" class="picker">
        <span class="sr">Template being designed</span>
        <img v-if="active?.url" class="pickthumb" :src="active.url"
             alt="" aria-hidden="true" loading="lazy">
        <select :value="activeId" @change="pickTemplate">
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
        <!-- Said once, beside the button it is about — it used to be a group
             in the card inspector, restated for every part anybody clicked.
             TWENTY-SEVEN WORDS CUT TO SEVEN. "From now on" already carries the
             second sentence: a picture that has been delivered cannot be
             redrawn, so saying so was explaining the absence of a thing
             nobody had asked about. The rest is on the title. -->
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
        <!--
          WHAT SAVING REACHES, SAID ONCE AND BESIDE THE BUTTON IT IS ABOUT.
          This lived in the inspector as a group titled "What saving changes",
          which meant it was restated on every click of every element — six
          groups deep in a panel about the selection, describing a control in
          the bar. It belongs here, and only when there is something to save.
        -->
      </template>
    </header>
    <!--
      WHAT SAVING REACHES, on its own line under the bar, right-aligned beneath
      Save. It sat IN the bar, and at desk width the bar does not wrap, so it
      and the template picker fought for one row: the picker lost every pixel
      and showed an empty sliver, and when the picker was given a floor the
      sentence became a column one word wide and the bar grew to a quarter of
      the screen. Neither is slack. Beneath the button it is about, it is
      still beside it, still visible, and quieter than the bar.
    -->
    <!--
      ONE REGISTER FOR BOTH TABS, AND THE BLAST RADIUS STAYS VISIBLE.
      The digital half had been cut to seven words and the printed half left at
      twenty, so one control said one thing in two registers. Both now open
      "Applies to".
      WHAT WAS CUT AND WHAT WAS NOT. The second sentence went — "Paper already
      printed keeps what it had" is reassurance about a thing that cannot
      happen, and it is on the title. "Including digital tickets already
      issued" STAYS ON SCREEN: it is the half people misread, it is the reason
      somebody about to commit a press run reads this at all, and
      ticketscreen.test.mjs pins it for exactly that reason. It caught this
      when the first attempt moved it to the title — which is also what R6 of
      UI-STANDARD.md forbids, since a hover is a click by another name.
    -->
    <p v-if="tab === 'digital' ? cardDirty : dirty" class="say saving savingline"
       :title="tab === 'digital'
         ? 'A card issued earlier is drawn this way only if it is sent again. Pictures already delivered keep what they had.'
         : 'Paper already printed keeps what it had.'">
      {{ tab === 'digital'
        ? 'Applies to cards sent from now on.'
        : 'Applies to everything printed or sent from now on, including digital tickets already issued.' }}
    </p>

    <!--
      AN OFFER, NOT A RESTORE. Work kept from a session that ended without a
      save is shown with its time and waits for an answer; nothing on the
      canvas changes until somebody presses Restore. A bar rather than a
      dialog, because the studio underneath is usable either way.
    -->
    <div v-if="shownDraft" class="note info draftbar" role="status">
      <span class="grow">{{ draftLine }}</span>
      <button class="btn sm" type="button"
              @click="tab === 'digital' ? restoreCardDraft() : restoreDraft()">Restore them</button>
      <button class="btn sm ghost" type="button"
              @click="tab === 'digital' ? discardCardDraft() : discardDraft()">Discard them</button>
    </div>

    <ShortcutsSheet v-if="showKeys" :mode="showKeys" :where="tab" @run="runFromSheet" @close="showKeys = ''" />
    <PicturePicker v-if="showPictures" :pictures="pictures"
                   @pick="pickPicture" @close="showPictures = false; changingPicture = ''" />

    <Sheet v-if="pendingSwitch" title="Unsaved changes" @close="pendingSwitch = null">
      <p v-if="drafts">
        Your changes to {{ active?.name }} are kept on this computer and offered back when you
        open it again.
      </p>
      <p v-else>Your changes to {{ active?.name }} have not been saved and will be lost.</p>
      <template #actions>
        <button class="btn ghost" type="button" @click="pendingSwitch = null">Keep editing</button>
        <button :class="['btn', drafts ? 'primary' : 'danger']" type="button" @click="confirmSwitch">
          {{ drafts ? 'Switch template' : 'Discard changes' }}
        </button>
      </template>
    </Sheet>

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
                <ToolButton icon="shape" label="Rectangle" :size="17" :keys="keyOf('toolRect')"
                            :active="pendingDeco === 'rect'"
                            hint="Draw a rectangle — a tint behind a price, a panel, a border"
                            @click="beginAdd('d:rect')" />
                <ToolButton icon="ellipse" label="Ellipse" :size="17" :keys="keyOf('toolEllipse')"
                            :active="pendingDeco === 'ellipse'"
                            hint="Draw an ellipse or a circle"
                            @click="beginAdd('d:ellipse')" />
                <ToolButton icon="minus" label="Line" :size="17" :keys="keyOf('toolLine')"
                            :active="pendingDeco === 'line'"
                            hint="Draw a rule. Drag it flat for a horizontal one — a line with no height is a line, not a mistake"
                            @click="beginAdd('d:line')" />
                <ToolButton icon="type" label="Words" :size="17" :keys="keyOf('toolWords')"
                            :active="pendingDeco === 'text'"
                            hint="Words you type, which print the same on every ticket. Unlike a field, the raffle puts nothing in it"
                            @click="beginAdd('d:text')" />
                <ToolButton icon="image" label="Picture" :size="17" :keys="keyOf('toolPicture')"
                            :active="pendingDeco === 'image'" :why="whyNoPicture"
                            hint="The raffle's logo or an uploaded artwork, placed on the ticket"
                            @click="openPictures" />
                <ToolButton icon="pen" label="Pen" :size="17" :keys="keyOf('toolPen')"
                            :active="pendingDeco === 'path'"
                            hint="Click for corners, drag for curves, click the first point to close. Enter finishes an open path"
                            @click="beginAdd('d:path')" />
                <ToolButton icon="design" label="Mark" :size="17" :keys="keyOf('toolMark')"
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

            <!--
              THE LIBRARY SITS BETWEEN DRAWING AND THE LAYER LIST, which is
              where it is used from: you place something, and the next thing
              you look at is the list it just joined.
            -->
            <LibraryPanel
              :library="library" :selected="pickedDecos" :lettering="pickedLettering" :busy="libBusy"
              @place="placeFromLibrary" @save="saveToLibrary"
              @save-colour="saveColourToLibrary" @remove="removeFromLibrary"
              @remove-colour="removeColourFromLibrary" @use-colour="useLibraryColour"
              @save-style="saveStyleToLibrary" @remove-style="removeStyleFromLibrary"
              @use-style="useLibraryStyle" />

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
                            @click="pick(el.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)">{{ nameOf(el) }}</button>
                    <span v-if="trouble(el)" class="warnmark"
                          :title="`${nameOf(el)} ${trouble(el)}`">!</span>
                    <!-- The same pin the drawn shapes carry, and the same
                         meaning: a drag and the arrow keys leave it put. -->
                    <ToolButton :icon="el.locked ? 'lock' : 'position'"
                                :label="el.locked ? `Unpin ${nameOf(el)}` : `Pin ${nameOf(el)}`"
                                :active="!!el.locked" :size="15"
                                :hint="el.locked ? 'Pinned — a drag will not move it. Click to release.'
                                                 : 'Pin it, so working around it does not keep catching it'"
                                @click="mark(); el.locked = !el.locked" />
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
                    <Icon :name="decoIcon(d.kind)" :size="15" class="kind" :title="decoWord(d.kind)" />
                    <input v-if="renaming === d.id" class="elname rename" :value="d.name"
                           :placeholder="decoWord(d.kind)" maxlength="40" :aria-label="`Name for ${decoName(d)}`"
                           @vue:mounted="({ el }) => { el.focus(); el.select() }"
                           @keydown.enter.prevent="commitRename(d, $event.target.value)"
                           @keydown.escape.stop="renaming = ''"
                           @blur="commitRename(d, $event.target.value)">
                    <button v-else type="button" class="elname" title="Double-click to rename"
                            @click="pick(d.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)"
                            @dblclick="renaming = d.id">{{ decoName(d) }}</button>
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
              <!-- TOOLS THAT ACT AT ONCE, so pressed buttons rather than tick
                   boxes: a tick box says "this is applied when you submit",
                   and nothing here is submitted. -->
              <ToolBar label="What the artboard shows">
                <ToolButton :icon="showAllBoxes ? 'preview' : 'previewOff'" label="Every box"
                            wide :size="15" :active="showAllBoxes"
                            hint="Outline every box on the ticket, not only the selected one"
                            @click="showAllBoxes = !showAllBoxes" />
                <ToolButton icon="code" label="Real QR" wide :size="15" :active="realQr"
                            hint="Draw a real, scannable code in each code box rather than a placeholder"
                            @click="realQr = !realQr" />
                <ToolButton icon="greyscale" label="In grey" wide :size="15" :active="inGrey"
                            hint="Show the ticket as a grey press will print it — colours that differ only in hue disappear"
                            @click="inGrey = !inGrey" />
              </ToolBar>
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
              <!-- THE SET'S OWN DRAWINGS, not a minus sign, a plus sign and a
                   word — the only three controls on this bar that were typed
                   characters beside a row of icons. -->
              <ToolBar label="Zoom">
                <ToolButton icon="zoomOut" label="Zoom out" :size="15" :keys="keyOf('zoomOut')"
                            :why="zoom <= ZOOMS[0] ? 'This is as far out as it goes' : ''"
                            @click="stepZoom(-1)" />
                <span class="zval">{{ Math.round(zoom * 100) }}%</span>
                <ToolButton icon="zoomIn" label="Zoom in" :size="15" :keys="keyOf('zoomIn')"
                            :why="zoom >= ZOOMS[ZOOMS.length - 1] ? 'This is as far in as it goes' : ''"
                            @click="stepZoom(1)" />
                <ToolButton icon="fit" label="Fit" wide :size="15"
                            hint="Fit the whole ticket to the width of the canvas" :keys="keyOf('fit')"
                            @click="fitToWidth" />
                <ToolButton icon="actualSize" label="Actual size" :size="15"
                            :active="zoom === 1"
                            hint="One pixel of the artwork to one pixel of the screen" :keys="keyOf('actual')"
                            @click="zoomActual" />
              </ToolBar>
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
              <!-- A sample ticket as a file, beside the numbers it is made at. -->
              <ToolBar label="Download a sample ticket">
                <ToolButton icon="download" label="PNG" wide :size="15" :why="whyNoExport"
                            hint="A sample ticket as a 300 dpi picture, watermarked SAMPLE — for a proof or to show somebody"
                            @click="downloadSample('png')" />
                <ToolButton icon="download" label="SVG" wide :size="15" :why="whyNoExport"
                            hint="The same sample as a vector drawing, at print size, for a designer to open"
                            @click="downloadSample('svg')" />
              </ToolBar>
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
            <ToolBar label="Arrange" vertical class="railtools">
              <!--
                SIX EDGES IN TWO ROWS OF THREE, each its own drawing. arrange.js
                has aligned to all six since it was written; the rail offered
                three, under three drawings borrowed from unrelated tools, so
                "put these on one baseline" — the commonest thing done to type
                on a ticket — had no button.
              -->
              <span class="tgroup bycol">
                <ToolButton v-for="a in ALIGN_ACROSS" :key="a.edge" :icon="a.icon" :label="a.label"
                            :why="whyNoSelection" :hint="many ? a.many : a.one"
                            @click="alignPicked(a.edge)" />
                <ToolButton v-for="a in ALIGN_DOWN" :key="a.edge" :icon="a.icon" :label="a.label"
                            :why="whyNoSelection" :hint="many ? a.many : a.one"
                            @click="alignPicked(a.edge)" />
              </span>
              <span class="tgroup">
                <ToolButton icon="distribute" label="Space across" :why="whyNotDistribute"
                            hint="Even gaps between the selected boxes, left to right. The outermost two stay where they are."
                            @click="distributePicked('across')" />
                <ToolButton icon="distributeV" label="Space down" :why="whyNotDistribute"
                            hint="Even gaps between the selected boxes, top to bottom"
                            @click="distributePicked('down')" />
              </span>
              <span class="tgroup">
                <ToolButton icon="arrowUp" label="Bring forward" :keys="keyOf('forward')" :why="whyNotOrder"
                            hint="One place nearer the front, so it prints over what it overlaps"
                            @click="orderPicked('forward')" />
                <ToolButton icon="arrowDown" label="Send backward" :keys="keyOf('backward')" :why="whyNotOrder"
                            hint="One place further back"
                            @click="orderPicked('backward')" />
                <ToolButton icon="layers" label="Bring to front" :keys="keyOf('front')" :why="whyNotOrder"
                            hint="All the way to the front of the stack"
                            @click="orderPicked('front')" />
                <ToolButton icon="toBack" label="Send to back" :keys="keyOf('back')" :why="whyNotOrder"
                            hint="All the way to the back, so everything it overlaps prints over it"
                            @click="orderPicked('back')" />
              </span>
              <span class="tgroup">
                <ToolButton icon="flipH" label="Flip across" :why="whyNotFlip"
                            hint="Mirror left for right — the selection turns over as one"
                            @click="flipPicked('across')" />
                <ToolButton icon="flipV" label="Flip down" :why="whyNotFlip"
                            hint="Mirror top for bottom"
                            @click="flipPicked('down')" />
                <ToolButton icon="group" label="Group" :keys="keyOf('group')" :why="whyNotGroup"
                            hint="Make these one thing: a click on any part takes them all. ⌘-click still reaches one part"
                            @click="groupPicked" />
                <ToolButton icon="ungroup" label="Ungroup" :keys="keyOf('ungroup')" :why="whyNotUngroup"
                            hint="Let the parts be selected one at a time again"
                            @click="ungroupPicked" />
              </span>
              <span class="tgroup">
                <ToolButton icon="duplicate" label="Duplicate" :keys="keyOf('duplicate')" :why="whyNoSelection"
                            hint="A copy, nudged down and right so it is visibly a copy"
                            @click="duplicatePicked" />
                <ToolButton icon="trash" label="Remove" :keys="keyOf('remove')" :why="whyNoSelection"
                            hint="Take the selection off the ticket"
                            @click="deletePicked" />
              </span>
            </ToolBar>

            <div ref="stage" class="stage" @wheel="onStageWheel">
              <!-- Millimetres along the top and down the side, as the ticket
                   prints; the share is in the inspector, beside the pixels. -->
              <Rulers :width-m-m="Number(design.sheet.widthMM)" :height-m-m="printedHeightMM"
                      :width-px="frameWidth" :height-px="frameWidth * (active.height / active.width)">
              <div
                ref="frame" class="frame" :class="{ drawing: !!pending, panning: handUp, grey: inGrey }"
                :style="{ width: frameWidth + 'px' }"
                @pointerdown="onFrameDown" @pointermove="onPointerMove"
                @pointerup="endPointer" @pointercancel="endPointer">
                <img :src="active.url" alt="" draggable="false">
                <div class="overlay" v-html="preview"></div>
                <!-- The 2 mm grid the snapping uses, drawn, so a box jumping to
                     it has a reason on screen. -->
                <div v-if="gridShown" class="gridlines"
                     :style="{ backgroundSize: `${gridCellPx}px ${gridCellPx}px` }"></div>

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
                    @click.stop="pick(d.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)"
                    @dblclick.stop="enterThing(d)"></button>
                  <template v-if="sel === d.id && !many && !d.locked && d.enabled !== false && penEditing !== d.id">
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
                    :title="el.enabled === false ? `${nameOf(el)} is switched off in the list`
                      : el.locked ? `${nameOf(el)} is pinned — unpin it in the list to move it`
                      : `${nameOf(el)} — drag to move, or use the arrow keys`"
                    @click.stop="pick(el.id, $event.shiftKey, $event.metaKey || $event.ctrlKey)"></button>
                  <!-- Handles on the PRIMARY only. Eight of them on each of
                       five selected boxes is forty grips over one artboard, and
                       a drag from any of them resizes one thing while four
                       others look equally grabbable. -->
                  <template v-if="sel === el.id && !many && el.enabled !== false && !el.locked">
                    <span
                      v-for="c in ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']" :key="c"
                      class="hdl" :class="c"
                      @pointerdown="startResize(el, c, $event)"></span>
                  </template>
                </div>

                <!-- The box being drawn right now. -->
                <div v-if="drawn" class="ebox drawnbox" :class="{ band: drag?.mode === 'band' }"
                     :style="{ left: pc(drawn.left), top: pc(drawn.top), width: pc(drawn.width), height: pc(drawn.height) }"></div>

                <!-- The perforation. Draggable, because it is a measurement you
                     can see on the artwork and nobody should be typing it. -->
                <div class="stubline" :style="{ left: pc(design.stubAt) }"
                     @pointerdown="startStubDrag">
                  <span class="stubgrip" :title="`The stub begins at ${pc(design.stubAt)} — drag to move`">
                    {{ pc(design.stubAt) }}
                  </span>
                </div>

                <!--
                  THE PEN'S OWN LAYER: the path being drawn, or the nodes and
                  handles of the path being edited. Over everything, because it
                  is what the pointer is working on; in the artwork's pixels, so
                  it lines up with what the renderer drew underneath.
                -->
                <svg v-if="penDraftD || penEditD" class="penlayer" aria-hidden="true"
                     :viewBox="`0 0 ${active.width} ${active.height}`" preserveAspectRatio="none">
                  <path v-if="penDraftD" :d="penDraftD" class="pendraft" />
                  <path v-if="penEditD" :d="penEditD" class="penedit" />
                  <line v-for="a in penArms" :key="`l${a.key}`" class="penarm"
                        :x1="artPx([a.from.x, a.from.y])[0]" :y1="artPx([a.from.x, a.from.y])[1]"
                        :x2="artPx([a.x, a.y])[0]" :y2="artPx([a.x, a.y])[1]" />
                </svg>
                <span v-for="a in penArms" :key="`h${a.key}`" class="phandle"
                      :style="{ left: pc(a.x), top: pc(a.y) }"
                      :title="'Drag to shape the curve · ⌥ to move this side alone'"
                      @pointerdown.stop="gripPen(a.i, a.which, $event)"></span>
                <span v-for="(n, i) in penPoints" :key="`n${i}`" class="pnode"
                      :class="{ smooth: n.hx1 !== undefined || n.hx2 !== undefined, on: chosenNode === i, first: penDrawing && i === 0 }"
                      :style="{ left: pc(n.x), top: pc(n.y) }"
                      :title="penDrawing ? (i === 0 ? 'Click to close the path' : '') : 'Drag to move · double-click for a corner or a curve'"
                      @pointerdown.stop="penDrawing ? (i === 0 && pen.down([n.x, n.y], $event)) : gripPen(i, 'node', $event)"
                      @dblclick.stop="pen.toggleNode(i)"></span>

                <!-- What the moving box just caught, while it is caught. -->
                <div v-if="snapLines.x !== null" class="guide v" :style="{ left: pc(snapLines.x) }"></div>
                <div v-if="snapLines.y !== null" class="guide h" :style="{ top: pc(snapLines.y) }"></div>
              </div>
              </Rulers>
            </div>
            </div><!-- .withrail -->

            <p class="readout">
              <template v-if="chosen && inPixels">
                <b>x {{ pc(chosen.box.left) }}</b> · y {{ pc(chosen.box.top) }} ·
                w {{ pc(chosen.box.width) }} · h {{ pc(chosen.box.height) }}
                — on this template {{ inPixels.x }}, {{ inPixels.y }},
                {{ inPixels.w }} × {{ inPixels.h }} px
              </template>
              <!--
                THE PANEL ALREADY SAYS THIS, three feet to the right and at
                the moment somebody is looking for it: Inspector.vue's empty
                state is "Nothing selected" over "Click a box, or a name in
                the list." Both were on screen at once, verbatim, and the two
                had already started to drift — one sentence with an em dash
                here, two lines there. A readout says WHAT IS TRUE; the panel
                says what to DO about it. This keeps the first half only.
              -->
              <template v-else>Nothing selected</template>
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
          <!--
            WHICHEVER PANEL THE SELECTION WANTS. A drawn shape and a field have
            almost nothing in common to edit — one has a source and an overflow
            rule, the other a gradient and a blend mode — so one panel with
            every control in it and half of them hidden would be a panel whose
            shape changes under the reader. Two components, one slot.
          -->
          <SelectionInspector
            v-if="many" :things="pickedSummary" :bounds="pickedBounds"
            :size="{ width: active.width, height: active.height }"
            :mixed="mixedPick" :grouped="pickedOneGroup"
            @pick="(id) => pick(id, false, true)" />
          <DecorationInspector
            v-else-if="chosenDeco"
            :deco="chosenDeco" :size="{ width: active.width, height: active.height }"
            :swatches="swatches" :brand="brandInk" :can-drop="canDrop"
            :warnings="risksFor(chosenDeco)"
            @mark="mark" @pick-colour="dropper" @pick-image="changePicture" @edit-nodes="editChosenNodes" />
          <Inspector v-else :element="chosen" :report="fitReport"
                     :sheet-width-m-m="design.sheet.widthMM"
                     :qr-density="qrDensity"
                     :half="chosenHalf"
                     :in-pixels="inPixels" :mm-per="mmPer"
                     :swatches="swatches" :brand="brandInk" :can-drop="canDrop"
                     :faults="chosenFaults"
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
              <ToolButton icon="ruler" label="Measuring guides" wide :size="15" :active="showGuides"
                          hint="Draw each field's measured box and baseline over the artwork"
                          @click="showGuides = !showGuides" />
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
        :decorations="cardDrawn" :library="library" :lib-busy="libBusy" :pictures="pictures" :hand="handUp"
        @mark="markCard" @drag="(v) => { cardDragging = v }"
        @pick-colour="dropper" @set-decorations="setCardDrawn"
        @save-shape="saveToLibrary" @remove-shape="removeFromLibrary"
        @save-colour="saveColourToLibrary" @remove-colour="removeColourFromLibrary"
        @save-style="saveStyleToLibrary" @remove-style="removeStyleFromLibrary" />

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
                :title="cardHistory.length ? `Undo the last change · ${keyOf('undo')}` : 'Nothing to undo'"
                @click="undoCard">Undo</button>
                <button class="btn sm" :disabled="!cardFuture.length"
                :title="cardFuture.length ? `Put back what Undo took · ${keyOf('redo')}` : 'Nothing to redo'"
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
                :title="history.length ? `Undo the last change · ${keyOf('undo')}` : 'Nothing to undo'"
                @click="undo">Undo</button>
        <!-- Beside Undo rather than hidden behind the shortcut. A redo nobody
             can see is one nobody knows exists, and the whole reason it is here
             is to make pressing Undo a cheap look rather than a commitment. -->
        <button class="btn sm" :disabled="!future.length"
                :title="future.length ? `Put back what Undo took · ${keyOf('redo')}` : 'Nothing to redo'"
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
  /* A FLOOR, NOT ZERO. With the design dirty the bar also carries the saving
     note, and a picker allowed to shrink to nothing lost every pixel to it —
     an empty sliver in the one control that says which template is on the
     canvas. The note is the slack: it is helper text and may wrap. */
  /* RAISED BY EXACTLY THE THUMBNAIL. The floor below was set so the select
     could not lose every pixel to the saving note; putting a 34px picture and
     a 6px gap inside the same label would have taken that back out of the
     select and reinstated the sliver this rule exists to prevent. */
  .bar .picker { min-width: 160px; flex: 0 1 auto; }
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
.bar h2 { margin: 0; font-size: var(--fs-md); flex: none; white-space: nowrap }
/*
 * THE PICKER IS A ROW NOW — a thumbnail and the select that names it.
 *
 * The select keeps `width: auto` as its basis and is allowed to shrink, so the
 * thumbnail is never the thing that gets squeezed: it is the fixed half of the
 * pair and the name is the elastic half. A truncated name still reads; half a
 * picture does not.
 */
.picker { display: flex; align-items: center; gap: var(--sp-3) }
.picker select { min-height: 34px; padding: 4px 8px; width: auto; max-width: 220px;
                 flex: 1 1 auto; min-width: 0 }
/*
 * 34x22 AND CROPPED, WHICH IS A DECISION ABOUT WHAT SURVIVES AT THIS SIZE.
 *
 * A ticket is about 3.1:1 (the reference artwork is 1600x517), so fitting one
 * whole into a header row gives either 22px tall and 68px wide — a quarter of
 * the bar, in a row that has already lost a fight over space once — or, at a
 * width the bar can spare, a letterboxed sliver 11px tall that shows nothing.
 *
 * Cropping to the middle keeps what actually distinguishes two artworks at
 * thumbnail size: their colour and their texture. Nobody reads a ticket here;
 * they recognise one. The whole shape is in TemplateRail, one tab away, at a
 * size where the shape is the point.
 *
 * The literal 34x22 is a proportion, not a size step — it is this element's
 * aspect ratio expressed in pixels, and rounding either number to a scale
 * would change the crop rather than the spacing. --r-xs and --rule are tokens
 * because they ARE the radius and the hairline everything else uses.
 */
.pickthumb {
  width: 34px; height: 22px; flex: none; object-fit: cover;
  border-radius: var(--r-xs); border: var(--rule) solid var(--border);
  background: var(--surface-2);
}
.specs { font-family: var(--font-data); font-size: var(--fs-2xs); color: var(--muted) }
.tabs { display: flex; gap: 2px; padding: 2px; background: var(--surface-2); border-radius: var(--r-sm) }
/*
 * ONE LINE EACH, and it is not only a tidiness matter. "Artwork & paper" and
 * "Print sheet" were breaking after the first word, so a control that reads
 * as one row of three became six stacked words and the bar grew a second
 * line. The bar's height is spent twice over: the studio below it is sized
 * `calc(100vh - 150px)`, an allowance for this bar and the footer, so a bar
 * that wraps pushes the footer's actions off the bottom of the frame.
 */
/* The kept-work offer: a line and its two answers on one row, above the tabs'
   content, the space under it matching the space between the studio's groups. */
.draftbar { display: flex; align-items: center; gap: var(--sp-4); margin: 0 0 var(--sp-5) }
.tabbtn {
  border: 0; background: none; color: var(--muted); cursor: pointer;
  padding: var(--sp-3) var(--sp-5); border-radius: var(--r-md);
  font-size: var(--fs-xs); font-weight: var(--fw-medium);
  white-space: nowrap;
}
.tabbtn.on { background: var(--brand); color: var(--brand-ink) }
.tabbtn:focus-visible { outline: 2px solid var(--brand); outline-offset: var(--rule) }
/*
 * IT SHRINKS BEFORE THE BUTTONS DO. The bar wraps, and this sentence is the
 * longest thing in it — "Edited 12:04 · not yet saved" pushed Save onto a
 * line of its own, which reads as an orphaned primary action rather than as
 * a header that ran out of room. The status may truncate; the action may not
 * move.
 */
.statetxt {
  font-size: var(--fs-2xs); color: var(--muted);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  /* It may ellipsize a long sentence; it may not be squeezed down to one
     character. "s" where "saved" belongs is not a shortened status, it is a
     glyph wearing one. Its longest content is "edited 12:04". */
  flex: none;
}
.statetxt.unsaved { color: var(--warn); font-weight: var(--fw-medium) }

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
.ellist li.off .elname { opacity: .5 }
.elname {
  flex: 1; min-width: 0; text-align: left; border: 0; background: none; cursor: pointer;
  font-size: var(--fs-xs); color: var(--text); padding: 2px 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.elname:hover { color: var(--brand) }
/* The rename field takes the name's place and keeps its size, so the row does
   not jump when somebody starts typing. */
.elname.rename {
  min-height: 0; padding: 0 var(--sp-2); border: var(--rule) solid var(--brand);
  border-radius: var(--r-xs); font: inherit; width: 100%;
}
.elname:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; border-radius: 3px }
/* The kind, as a drawing. It keeps the three-letter badges' colour coding,
 * because that told the eye which rows were alike at a glance -- but the colour
 * is now reinforcement for a shape rather than the only difference between FLD
 * and TXT, and the word is on the title. */
.kind { flex: none; color: var(--muted) }
.kind.code { color: var(--info) }
.kind.text { color: var(--warn) }
.warnmark {
  flex: none; width: 15px; height: 15px; border-radius: 50%;
  background: var(--warn-soft); color: var(--warn);
  font-size: var(--fs-3xs); font-weight: var(--fw-bold); line-height: 15px; text-align: center; cursor: help;
}

.stubrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap }
.pcfield {
  width: 82px; min-height: 32px; padding: 4px 8px; text-align: right;
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}

/* ---- the stage ---- */
.stagebar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap }
.zval {
  min-width: 42px; text-align: center; font-size: var(--fs-2xs);
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
/*
 * THE GRID AND THE GUIDES, drawn over the artwork and under nothing that can
 * be pressed. Literal colours for the reason every mark on the artboard is: it
 * sits on somebody's artwork, which can be any colour, so it takes the
 * selection's own cyan — faint for the grid, which is always there, and full
 * for a guide, which is there for the half second something is caught.
 */
.gridlines {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(18, 181, 229, .22) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(18, 181, 229, .22) 1px, transparent 1px);
}
.guide { position: absolute; pointer-events: none; background: #12b5e5; z-index: 2 }
.guide.v { top: 0; bottom: 0; width: 1px; margin-left: -.5px }
.guide.h { left: 0; right: 0; height: 1px; margin-top: -.5px }
.frame.panning, .frame.panning .ebox { cursor: grab }
/*
 * THE PEN'S LAYER. The path in the selection's cyan, a node a small square
 * (corner) or circle (smooth) with generous room to grab, a handle a dot at
 * the end of a hairline. Literal colours, for the artboard's reason: they sit
 * on somebody's artwork. Strokes do not scale with the zoom.
 */
.penlayer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 3 }
.penlayer path, .penlayer line { fill: none; vector-effect: non-scaling-stroke }
.pendraft { stroke: #12b5e5; stroke-width: 1.5 }
.penedit { stroke: #12b5e5; stroke-width: 1 }
.penarm { stroke: #12b5e5; stroke-width: 1 }
.pnode, .phandle { position: absolute; z-index: 4; transform: translate(-50%, -50%); touch-action: none }
.pnode { width: 9px; height: 9px; background: #fff; border: var(--rule-strong) solid #12b5e5; cursor: move }
.pnode.smooth { border-radius: var(--r-pill) }
.pnode.on { background: #12b5e5 }
.pnode.first { cursor: pointer; width: 11px; height: 11px }
.phandle { width: 7px; height: 7px; border-radius: var(--r-pill); background: #12b5e5; cursor: crosshair }
/* In grey: the artwork and what is drawn on it, not the boxes and handles,
   which are the studio's and stay in colour so they can still be found. */
.frame.grey > img, .frame.grey > .overlay { filter: grayscale(1) }

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
/* The marquee: the selection's own cyan, dashed, so it reads as "choosing" and
   not as a box about to be made. Literal for the reason every colour on the
   artboard is — it sits on somebody's artwork, which can be any colour. */
/*
 * THE ARRANGE RAIL IS TWO TOOLS WIDE. Eighteen tools in one column made the
 * canvas taller than a laptop's window and pushed Save, Undo and Redo off the
 * bottom of the screen. Two wide, the six alignments read as a matrix — the
 * edges across down the first column, the edges down the second — and every
 * other group is rows of two.
 */
.withrail .railtools .tgroup { display: grid; grid-template-columns: repeat(2, 32px); gap: var(--sp-1) }
.withrail .railtools .tgroup.bycol { grid-auto-flow: column; grid-template-rows: repeat(3, 32px) }
.ebox.drawnbox.band { outline: 1px dashed #12b5e5; background: rgba(18, 181, 229, .08) }
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
  background: var(--info); color: var(--info-ink); font-size: var(--fs-3xs); padding: 2px 3px;
  border-radius: 3px; font-family: var(--font-data);
  writing-mode: vertical-rl;
}

.readout {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0;
  font-size: var(--fs-2xs); color: var(--muted);
  font-family: var(--font-data); font-variant-numeric: tabular-nums;
}
.readout b { color: var(--text) }

/* ---- the panel ---- */
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
.savingline { margin: var(--sp-2) 0 0; text-align: right }
.btn.danger { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, var(--border)) }
.wide { width: 100% }

/*
 * The one answer the panel exists to give, so it is the one block with a fill.
 *
 * `.report p` was here too and could never have matched: Vue scopes only the
 * LAST compound selector, so it compiled to `p[data-v-TicketDesign]` and the
 * <p> is in Inspector.vue carrying Inspector's id. An ancestor may come from
 * anywhere above in the DOM; the last element may not. Inspector has its own
 * copy, which is the one that has been doing the work.
 */
/*
 * `.report` AND `.big` WERE HERE AND ARE GONE. Neither class appears in this
 * component's template, so both compiled to `[data-v-TicketDesign]` against
 * markup that carries a different scope id, and neither has ever painted
 * anything. Inspector.vue holds the live `.report` set — the same four rules,
 * already on the tokens — and `.big` is global in style.css at 1.15rem, which
 * is --fs-lg, so ArtworkVerdict's figures were never reading from here.
 *
 * The `!important` on `.big` was the tell: somebody fighting specificity that
 * was never in play. Deleted rather than migrated, for the reason a stale
 * `.statement` block was deleted from Money.vue — a rule that reads as
 * load-bearing is a trap for the next reader, and this one had already set
 * one: it was on the shortlist to be carefully migrated to --fs-xl.
 *
 * Same family as `.report p`, removed a commit earlier, and as `.vhead .dot`
 * before that. reachableclass catches the descendant form; a bare single-class
 * rule dead in its own file slips through, which is a known edge of that gate
 * rather than a miss.
 */

/* ---- the artwork verdict ---- */
/* The magnitude before the precision: the figure is what the eye lands on and
 * the sentence under it is what makes it mean something. */

/* ---- accepted shapes ---- */
/*
 * A specification is typed, not slid — 190 by 61.39 at a 2% tolerance is a
 * figure somebody was given, not one they feel their way to. So these stay
 * fields, and get what a column of numbers needs: one alignment and figures
 * that line up.
 */

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
