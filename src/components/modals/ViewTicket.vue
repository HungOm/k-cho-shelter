<script setup>
/**
 * Looking at a ticket — one, or the ten in a book — as it will actually print.
 *
 * DRAWN HERE, NOW, AND THROWN AWAY. Nothing about a ticket's appearance is
 * stored: the artwork is one file, the design is a few coordinates, and the
 * ticket itself is a number and a code. Opening this puts them together; closing
 * it discards the result. That is what lets the books screen list a thousand
 * books instantly — nothing is rendered until somebody asks to see one.
 *
 * ONLY WHAT HAS BEEN GENERATED. A ticket with no code has never been printed
 * and cannot be proved genuine, so there is nothing honest to show: it is
 * listed by number instead, with the reason.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { state, api, toast, go, goStudio } from '../../lib/store.js'
import { designFor, stubShare } from '../../lib/ticketdesign.js'
import { ladderFrom, rankFor, rankCount } from '../../lib/ranks.js'
import { numberLayerSVG, ticketVerifyUrl, receiptVerifyUrl, cardSVG, CARD_DESIGNS, CARD } from '../../lib/ticketart.js'
import { inlineImages, fetchAsDataURI } from '../../lib/ticketexport.js'
/* What one buyer holds, folded into books and spans — see ticketspans.js. One
   definition, so the card, the message and the check page cannot describe the
   same purchase three different ways. */
import { spansOf } from '../../lib/ticketspans.js'
import { encode } from '../../lib/qrcodegen.js'
import { date } from '../../lib/format.js'
import { inkFor } from '../../lib/brand.js'
import Sheet from '../ui/Sheet.vue'
import Icon from '../ui/Icon.vue'

const props = defineProps({ payload: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close', 'print', 'print-sample'])

const busy = ref(true)
const err = ref('')
const result = ref(null)

const design = computed(() => (result.value?.template ? designFor(result.value.template) : null))
const tickets = computed(() => result.value?.tickets ?? [])
const missing = computed(() => result.value?.notGenerated ?? [])

const verifyBase = computed(() => {
  const set = String(result.value?.verifyBase || '').trim()
  return set || ((typeof location === 'undefined' ? '' : location.origin) + '/v')
})

/*
 * Card 8a titles this "Book-004 · the buyer's ticket" and puts the run and the
 * count underneath. The old title said "As it will print", which described the
 * preview rather than what an organiser opened it for.
 */
const title = computed(() => (props.payload?.book
  ? `${props.payload.book} \u00b7 the buyer's ticket`
  : String(props.payload?.number ?? 'Ticket')))

const range = computed(() => {
  const list = tickets.value
  if (!list.length) return ''
  const sold = list.filter(isSold).length
  const run = list.length > 1 ? `${list[0].number} \u2014 ${list[list.length - 1].number}` : list[0].number
  return `${run} \u00b7 ${sold} sold`
})

/*
 * ONE TICKET AT A TIME, with a pager. The modal used to stack every ticket in
 * the book down one column — ten cards, ten print previews and ten sets of
 * buttons — so finding the one somebody asked about meant scrolling past nine.
 * 8a pages them: "1 of 10", and the buttons always in the same place.
 */
const at = ref(0)
const current = computed(() => tickets.value[at.value] ?? null)
watch(tickets, () => { at.value = 0 })
const step = (d) => { at.value = Math.min(tickets.value.length - 1, Math.max(0, at.value + d)) }

function layerFor(t) {
  return numberLayerSVG(design.value, t.number, {
    book: t.book,
    buyer: t.buyer,
    qrUrl: ticketVerifyUrl(verifyBase.value, t.number, t.code),
    encode,
  })
}

/* ---------- the ticket a buyer is sent ---------- */

/*
 * THE DIGITAL TICKET.
 *
 * A buyer who has paid has a stub in their hand and nothing on their phone. So
 * this turns the ticket already drawn on screen into a picture and hands it to
 * whatever the phone shares with.
 *
 * ONLY FOR A SALE THAT IS RECORDED, and the reason is not tidiness. A picture
 * of a ticket is what a buyer will treat as proof of theirs; sending one before
 * the sale is in the books creates a claim the raffle cannot support at the
 * draw. A ticket that is not recorded sold shows the button DISABLED WITH THE
 * REASON rather than hidden, because an organiser who cannot find the button
 * concludes the app is broken instead of learning that the sale needs
 * recording first.
 *
 * NOTHING NEW IS ASKED OF THE SERVER. Everything this needs — the artwork, the
 * design, the number, the code, the buyer — is already on screen, and the
 * request that fetched it is organiser-only and refused for anybody else. This
 * adds a way to save what is already being looked at; it does not add a way to
 * see more.
 */
const sharing = ref('')
/* Keyed by ticket number: viewing a book draws ten of these, and a single
 * message would appear under all of them however few actually failed. */
/*
 * What to tell them about the last share — no longer only failures, so it is
 * not called shareErr any more. The desktop route succeeds and still leaves
 * something the person needs to know.
 */
const shareNote = ref({})

const soldState = (t) => String(t?.status ?? '').toLowerCase()
const isSold = (t) => ['sold', 'donated'].includes(soldState(t))

/** Why this ticket cannot be sent, or '' when it can. */
function cannotSend(t) {
  if (!isSold(t)) return 'The sale is not recorded yet, so there is nothing to send a buyer. Record the sale first.'
  if (!t.code) return 'This ticket has no code yet, so a buyer could not check it.'
  return ''
}

function loadImage(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not load the picture'))
    img.src = src
  })
}

/*
 * The ticket, flattened into one picture.
 *
 * The artwork is fetched a SECOND time with crossOrigin set, because the copy
 * already on screen was loaded without it and a canvas that has drawn a tainted
 * image refuses to hand back its pixels. If Storage does not answer with the
 * CORS header the fetch fails here rather than at toBlob, which is the better
 * place to find out — see the caller, which falls back to sending the link.
 *
 * The overlay goes on as an SVG drawn into the canvas. Webfonts do not load
 * inside an image, so a Burmese name renders in whatever Myanmar font the phone
 * itself has — the same bet the printed ticket makes, and the reason
 * TEXT_FAMILY ends in a system fallback rather than at Padauk.
 */
/*
 * THE ORGANISATION'S OWN MARK, INLINED.
 *
 * An SVG rendered through an <img> will not fetch anything external — that is a
 * security rule of the format, not a bug — so a logo referenced by URL simply
 * does not appear in the exported picture while looking fine on screen. It has
 * to be fetched here and handed over as a data URI.
 *
 * Fetched once and remembered, and any failure is silent: a bucket without CORS
 * headers, an offline phone, a logo nobody uploaded. The card draws the
 * organisation's initial instead, which is a mark rather than a gap.
 */
const logoUri = ref('')
async function loadLogo() {
  const url = String(state.cfg?.orgLogoSmall || state.cfg?.orgLogo || '').trim()
  if (!url || logoUri.value) return
  /*
   * `fetchAsDataURI`, WHICH THIS FILE WAS ALREADY IMPORTING. The fetch, the
   * blob and the FileReader were written out here a second time, five lines
   * below an import of the function that does exactly that. Found when the
   * studio needed the same mark and the obvious move was to extract a helper
   * that already existed.
   */
  try { logoUri.value = await fetchAsDataURI(url) } catch { /* an initial is a mark, not a gap */ }
}

/* What goes on the card, from what this screen and the config already hold. */
/*
 * HOW MANY TICKETS THIS BUYER HOLDS, counted out of the list this screen
 * already has, keyed on the telephone number.
 *
 * ON THE PHONE, NOT THE NAME. Two buyers called "Ma Hla" are two people, and a
 * count that merged them would hand one of them the other's standing on a card
 * they are sent. A blank number is not an identity: it gets no band, rather
 * than being pooled with every other blank — which would make "no number
 * recorded" the largest supporter in the raffle.
 *
 * COUNTED LIVE HERE, STORED ON THE RECEIPT THERE, and they agree because both
 * happen at the moment the ticket is sent: the same count, the same ladder
 * (src/lib/ranks.js re-exports the one the server uses). Afterwards the picture
 * the buyer holds and the receipt behind it both stop moving, which is what a
 * receipt is. Buying more later earns the higher band on the NEXT one.
 */
/*
 * TWO WRITINGS OF ONE NAME, FOLDED TO ONE. The same fold the database indexes
 * on and the api keys with — if the three ever disagree, one buyer gets two
 * digital tickets or two buyers get one. See buyerKey in _shared/holding.ts.
 */
const buyerKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/*
 * WHAT THIS BUYER HOLDS, AND A BUYER IS BOTH HALVES.
 *
 * Keyed on the telephone number AND the name. The number alone pools a
 * household or a shop — everyone who bought through one phone would share a
 * digital ticket listing each other's tickets. The name alone pools two people
 * called Ma Hla. Neither identifies anybody on its own; together they are as
 * close as a hand-written raffle gets.
 *
 * With no number recorded there is nothing to key on at all, so nothing is
 * returned and the card falls back to this one ticket.
 */
/*
 * TWO SHAPES OF A TICKET LIVE IN THIS APP, AND THIS FUNCTION IS HANDED ONE OF
 * EACH. That is the whole of the bug this pair of helpers fixes.
 *
 * The modal's own ticket comes from `render_tickets` and is the SERVER's
 * shape, with the buyer nested: `t.buyer.phone`. The rows in `state.tickets`
 * come from `toTicket` in store.js and are FLAT — `x.phone`, `x.name` — and
 * there is no `x.buyer` on them at all.
 *
 * This read `x?.buyer?.phone` against the store, so it matched nothing, every
 * time, for everybody. A buyer holding ten tickets counted as holding one: no
 * supporter band on any card, and no digital ticket ever minted, because
 * `ensureHolding` gives up below two. It was reported three times as "still
 * per ticket" and it was never the deploy.
 *
 * It survived because tests/harnessreach built `state.tickets` with the
 * NESTED shape — a fixture more generous than production, which is the trap
 * that file's own notes warn about. The fixture is the real shape now.
 *
 * Named rather than a fallback chain: these are the two shapes this app has,
 * both real, both legitimate, and neither is a guess.
 */
const buyerPhoneOf = (x) => String(x?.buyer?.phone ?? x?.phone ?? '').trim()
const buyerNameOf = (x) => String(x?.buyer?.name ?? x?.name ?? '')

function ticketsHeldBy(t) {
  const phone = buyerPhoneOf(t)
  if (!phone) return []
  const name = buyerKey(buyerNameOf(t))
  return (state.tickets || [])
    .filter((x) => isSold(x)
      && buyerPhoneOf(x) === phone
      && buyerKey(buyerNameOf(x)) === name)
    .map((x) => String(x.number))
    .sort()
}

/*
 * THE RUNGS ARE THE ORGANISER'S WORDS, AND THIS READS THEM RATHER THAN KNOWING
 * THEM. `ladderFrom` falls back to the default preset for a config row it
 * cannot use, so a card is always drawn with working words — and it is the same
 * function the check page's server calls, so the picture in somebody's chat and
 * the page that confirms it cannot disagree about what rung four is called.
 */
const ladder = computed(() => ladderFrom(state.cfg?.supporterBands))

const bandFor = (t) =>
  rankFor(ticketsHeldBy(t).length, Number(state.cfg?.ticketsPerBook ?? 0), ladder.value)

/* The ladder comes back highest first, so [0] is the top rung. */
const topRung = computed(() => ladder.value[0]?.name || 'Supporters')
const bandsNote = computed(() => {
  const per = Number(state.cfg?.ticketsPerBook ?? 0)
  const rungs = [...ladder.value].reverse()
    .map((r) => `${r.name} at ${r.minBooks} book${r.minBooks === 1 ? '' : 's'}`)
  return `What this raffle calls its supporters, lowest first: ${rungs.join(', ')}.`
    + (per ? ` A book is ${per} tickets.` : '')
})

/*
 * WHAT THIS BUYER HOLDS, AS BOOKS AND SPANS.
 *
 * A digital ticket is one per buyer and carries everything they have, so the
 * card's headline is a description of a SET rather than a number. The folding
 * needs the raffle's books, because a book is a book when the buyer holds
 * every ticket in it — never because ten numbers happen to run on. See
 * ticketspans.js, and `halfofeachbook` in its suite for the case that makes
 * the difference.
 */
function holdingOf(t) {
  const numbers = ticketsHeldBy(t)
  if (numbers.length < 2) return { chunks: [], tickets: numbers.length }
  const byNumber = new Map((state.tickets || []).map((x) => [String(x.number), x]))
  const rows = numbers.map((n) => ({ number: n, book: byNumber.get(n)?.book ?? '' }))
  const chunks = spansOf(rows, state.books || [])
  return { chunks, tickets: numbers.length }
}

/*
 * THE CODE THIS BUYER'S DIGITAL TICKET IS BEHIND.
 *
 * ASKED FOR AS SOON AS THERE IS A TICKET TO ASK ABOUT, so that what is on
 * screen is what would be sent. The first version issued the code on SEND, on
 * the grounds that issuing one when a modal opens is a write for looking — and
 * the cost of that was a preview showing ticket KS-00001 to somebody about to
 * hand over a card covering ten. An organiser cannot check a picture they are
 * not being shown.
 *
 * IT IS CHEAP BECAUSE THERE IS ALMOST NOTHING TO WRITE. A digital ticket is a
 * code against a telephone number and nothing else; what it covers is resolved
 * when somebody scans it. So this is one row, once, for a buyer who has never
 * had one — every later open reads that same row back, the audit trail records
 * only the creation, and nothing about the holding is stored to go stale.
 *
 * IT FAILS QUIETLY HERE AND LOUDLY ON SEND. Opening a modal must not throw a
 * red error over a screen somebody is reading; the card falls back to this
 * ticket, which is true, and `send` asks again where a failure is something
 * the organiser needs to know about before handing anything over.
 */
const minted = ref({})

/*
 * KEYED BY THE BUYER, NOT BY THE TICKET, and that is not a cache detail.
 *
 * It was keyed on `t.number`, so paging through a book sold entirely to one
 * person asked the server for that person's digital ticket TEN TIMES and
 * stored ten entries — all holding the same code, because there is only one.
 * Ten calls for one artefact, and worse, it wrote into the data structure the
 * very thing this model exists to remove: one digital ticket per ticket.
 *
 * Blank for a buyer with no telephone number recorded, who has no identity to
 * hold a code against and so never gets one.
 */
function holdKeyOf(t) {
  const phone = buyerPhoneOf(t)
  return phone ? `${phone}\u0000${buyerKey(buyerNameOf(t))}` : ''
}

/** The code for whoever this ticket belongs to, once there is one. */
const codeFor = (t) => (holdKeyOf(t) ? String(minted.value[holdKeyOf(t)] ?? '') : '')

/*
 * WHY IT COULD NOT BE MADE, KEPT RATHER THAN SWALLOWED.
 *
 * This caught and discarded, on the reasoning that opening a modal must not
 * throw a red error over a screen somebody is reading. That half is still
 * right. Discarding the REASON was not: the card silently fell back to this
 * one ticket, which is a perfectly ordinary-looking card, and the only signal
 * that anything had failed was that it showed the wrong thing — which you can
 * only notice if you already know what the right thing looks like.
 *
 * It cost the person using this three rounds of asking why the digital ticket
 * was still per ticket, and me three answers, because the screen had the
 * answer and was not saying it. Quiet is not the same as invisible.
 */
const holdError = ref({})

async function ensureHolding(t) {
  const key = holdKeyOf(t)
  if (!key || minted.value[key] || ticketsHeldBy(t).length < 2) return
  try {
    const made = await api('make_receipt', { ticketNumbers: ticketsHeldBy(t) })
    minted.value = { ...minted.value, [key]: String(made.code) }
    holdError.value = { ...holdError.value, [key]: '' }
  } catch (e) {
    /* No toast — see above. The card block says it instead, where somebody
       looking at the wrong card is already looking. */
    holdError.value = { ...holdError.value, [key]: e.message || 'it could not be made' }
  }
}

/** Why this buyer's digital ticket is missing, when it is. */
function whyNoHolding(t) {
  if (heldCount(t) < 2 || codeFor(t)) return ''
  const key = holdKeyOf(t)
  if (!key) return 'No telephone number is recorded for this buyer, so there is nothing to hold their tickets against.'
  return holdError.value[key] || ''
}

function cardValues(t) {
  const c = state.cfg || {}
  const brand = String(c.brandColor || '').trim()
  const band = bandFor(t)
  /*
   * ONE TICKET UNTIL THIS BUYER'S DIGITAL TICKET HAS BEEN MINTED, and their
   * whole holding after. The card takes `spans` and decides for itself: absent
   * or covering one, it draws exactly the card it always drew.
   */
  const code = codeFor(t)
  const held = code ? holdingOf(t) : { chunks: [], tickets: 1 }
  const many = held.tickets > 1
  const each = Number(c.ticketPrice ?? 0)
  return {
    number: t.number,
    spans: held.chunks,
    name: t.buyer?.name ?? '',
    org: String(c.orgName ?? '').trim(),
    event: String(c.eventName ?? '').trim(),
    drawOn: c.drawDate ? date(c.drawDate) : '',
    /* WHAT THEY PAID, which on a holding is what they paid for all of it. A
     * per-ticket price beside "TICKETS 10" would read as the total and be out
     * by a factor of ten on the one number a buyer checks. */
    price: each ? `${c.currency ?? ''} ${many ? each * held.tickets : each}`.trim() : '',
    /* Card 8a puts three facts on one line — what it cost, which book, when it
     * sold. `soldAt` is rendered only if the payload carries it; a fact that is
     * absent draws nothing rather than an empty label. On a holding the middle
     * fact is a COUNT: "which book" stops having one answer, and the card
     * swaps it for the number of tickets when `spans` says so. */
    book: many ? '' : (t.book ?? ''),
    soldOn: t.soldAt ? date(t.soldAt) : '',
    sold: isSold(t),
    motto: String(c.motto ?? '').trim(),
    /* Blank when there is no band, which the card draws as nothing. It never
       falls back to the bottom rung — see ranks.js. */
    rankName: band?.name ?? '',
    rankCount: rankCount(band),
    /*
     * WHICH PICTURE THE SUPPORTER CARD DRAWS, AND IT IS NOT A SECOND CHOICE.
     *
     * The raffle already said what it is when it picked a rung preset — a
     * shelter, a learning centre, a community centre, a fellowship. The card's
     * device follows that rather than adding a control beside it, because two
     * settings for one fact is two settings that can disagree, and the one
     * that disagrees is whichever the organiser did not open. An unknown or
     * empty preset falls back inside cardbadges.js rather than here.
     */
    category: String(c.supporterBands?.preset ?? ''),
    /* The rung's POSITION, which is what the seal draws. `band.id` is a slot
       id from ranks.ts — rung1..rung5 — and is the only stable thing about a
       rung, the name being free text an organiser rewrites. */
    rungSlot: band?.id ?? '',
    /*
     * THE REFERENCE IN WORDS, under the QR. The code is already carried for
     * the QR itself; this is the same string set where somebody can read it
     * back down a telephone, which is what happens when a camera will not
     * focus in a hall. Blank on a ticket with no receipt minted, and the card
     * draws nothing rather than "Ref".
     */
    ref: code || '',
    /*
     * WHAT THE MONEY DOES AND WHEN IT IS DRAWN — the two things a buyer asks
     * that no card has answered. Both blank until an organiser fills them in,
     * and both draw nothing when blank rather than a label over an empty
     * space.
     *
     * `topPrize` is CONFIG and not a row of the prize schedule, and the comment
     * here said the opposite for several hours after the decision changed — the
     * two are not the same fact. `prizes` is the draw-night list with values on
     * it; this is one line of advertising sent weeks earlier, and a card should
     * not recite a figure nobody meant to publish. Both are set in Setup, under
     * the Ticket Studio row.
     */
    impact: String(c.impactLine ?? '').trim(),
    prize: String(c.topPrize ?? '').trim(),
    /*
     * The last line, and the only one addressed to the person by name. First
     * name only: "Good luck, Hung Om!" reads as a form letter, and the card
     * has already said their full name once, larger, at the top.
     */
    goodLuck: goodLuckFor(t.buyer?.name ?? ''),
    brand,
    /* Computed, never configured — an organisation choosing a colour is not
     * choosing a contrast ratio. See brand.js. */
    ink: inkFor(brand) || '#ffffff',
    logo: logoUri.value,
    thanks: THANKS_EN,
    /* The address in words under the QR, and it has to be the SAME address the
       QR carries — a holding's card showing one ticket's link beside a code
       that opens the whole holding is two answers to one question. */
    link: (code
      ? receiptVerifyUrl(verifyBase.value, code)
      : ticketVerifyUrl(verifyBase.value, t.number, t.code)).replace(/^https?:\/\//, ''),
  }
}

/* Close first: leaving a modal open over the screen it just navigated to is
   how a sheet ends up floating above an unrelated page. */
/*
 * SETUP, NOT THE STUDIO, because the studio cannot change this card.
 *
 * The link here read "Design it in the studio". The studio lays out boxes on
 * the PRINTED artwork; this card is drawn from scratch by digitalCardSVG out of
 * the raffle's colour, ink and logo, and those live on Setup. Nothing an
 * organiser did in the studio ever moved a pixel of the thing they were looking
 * at while they clicked it.
 *
 * What made it plausible: digitalCardSVG's first parameter is `design`, and it
 * is never read — 136 lines, zero references. A signature that claims a
 * relationship the body does not have is how a screen ends up linking to it.
 * The parameter is gone with this.
 *
 * No room gate either. The studio needs a tablet; Setup does not, so a seller
 * on a phone can now reach the thing the chips above are describing.
 */
function toSetup() {
  emit('close')
  go('admin')
}

/* Straight to the tab that owns this, not to the studio's front door: a link
   naming a workspace should arrive in it. */
function toCardStudio() {
  emit('close')
  goStudio('digital')
}

/*
 * WHICH OF THE THREE — READ, NOT CHOSEN. This was a three-button picker, and
 * the comment it replaces said why: Card 8b shipped Grand, Certificate and
 * Stub and only Grand was ever reachable, so a per-view toggle here was the
 * only way anybody could look at the other two.
 *
 * That place now exists — Ticket Studio · Digital ticket — and the organiser's
 * instruction was that the treatment is "set once there". So the picker is
 * gone. Three buttons that changed this one preview and nothing a buyer would
 * ever receive were a choice in appearance only: press Stub, send the ticket,
 * and the buyer gets Grand.
 */
const cardStyle = computed(
  () => CARD_DESIGNS.find(d => d.id === state.cfg?.cardDesign)?.id || 'grand',
)
/*
 * WHAT THIS CARD IS WEARING, AS ONE LINE.
 *
 * Five separate read-outs became five separate objects on screen, and objects
 * in this app are pressable. As a sentence they are what they always were —
 * facts — and the eye reads them in one pass instead of five.
 *
 * ABSENCE IS NAMED, not omitted. "no logo" in the quiet tone is the answer an
 * organiser is looking for; dropping the item entirely would leave them
 * counting what is missing.
 *
 * AND THE RUNGS ARE COUNTED. This said "& 4 more", which was hardcoded and
 * happened to be right — the worst version of that bug, because it reads
 * correctly until the day somebody changes the ladder, which is now a thing
 * they can do.
 */
const wearing = computed(() => {
  const cfg = state.cfg || {}
  const rungs = ladder.value.length
  return [
    { text: `${cardName.value} card`, why: cardNote.value },
    cfg.logo
      ? { text: 'logo', why: 'The raffle\u2019s logo is printed on the card' }
      : { text: 'no logo', off: true, why: 'No logo is printed on the card' },
    cfg.motto
      ? { text: 'motto', why: cfg.motto }
      : { text: 'no motto', off: true, why: 'No motto is printed on the card' },
    rungs
      ? { text: `${topRung.value} ladder`, why: bandsNote.value }
      : { text: 'no rungs', off: true, why: 'This raffle has no supporter rungs set' },
  ]
})

const cardName = computed(
  () => CARD_DESIGNS.find(d => d.id === cardStyle.value)?.name || 'Grand',
)
const cardNote = computed(
  () => CARD_DESIGNS.find(d => d.id === cardStyle.value)?.note || '',
)

/*
 * THE ARRANGEMENT COMES FROM THE SAME PLACE THE TREATMENT DOES.
 *
 * The studio's Digital ticket tab can now move, resize, hide and recolour
 * every part of this card, and what it saves is `state.cfg.cardLayout`. If it
 * did not arrive here the studio would be a screen that changes a preview and
 * nothing a buyer ever receives — which is exactly the fault the treatment
 * picker above was removed for, rebuilt one layer down. Blank means the
 * standard card, which is what every raffle has until somebody moves a part.
 */
const cardFor = (t) => {
  const code = codeFor(t)
  /* What the organiser drew on this treatment's card (STUDIO-ESSENTIALS
     Phase 9) — drawn over the card's parts, the way the studio shows it. */
  const drawn = state.cfg?.cardDecorations?.[cardStyle.value] || []
  return cardSVG(cardStyle.value, { ...cardValues(t), decorations: drawn }, {
    /* One QR for everything they hold, once there is a code for it. Until
       then this is the card for this ticket and carries the ticket's own. */
    qrUrl: code
      ? receiptVerifyUrl(verifyBase.value, code)
      : ticketVerifyUrl(verifyBase.value, t.number, t.code),
    encode,
    layout: state.cfg?.cardLayout,
  })
}

/*
 * The card, rasterised for sharing.
 *
 * NOTHING CROSS-ORIGIN GOES INTO IT, which is the quiet win here. The printed
 * ticket had to be fetched from Storage with crossOrigin set, and a bucket that
 * does not answer with the header taints the canvas and toBlob throws — the
 * failure the WhatsApp text fallback existed for. The card is drawn entirely
 * from the design's own colours and a QR made of rectangles, so it is one
 * self-contained SVG with no request in it.
 */
/*
 * `mime` exists because the clipboard and the file want different formats.
 * WhatsApp takes the JPEG happily as a file, but every browser that will put an
 * image on the clipboard at all takes PNG and only PNG. Rather than a second
 * copy of the drawing, the encoder is the parameter.
 */
async function pictureOf(t, mime = 'image/jpeg') {
  const d = design.value
  const W = Math.max(400, Number(d.digital?.widthPx ?? 1200))
  const H = Math.round(W * (CARD.height / CARD.width))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser cannot draw the picture')

  /* A picture drawn on the card is an address, and this SVG is drawn through an
     <img>, which may not load anything from outside itself — so it would come
     out blank on the buyer's copy. Inlined first, the way the logo already is. */
  const { svg: inlined } = await inlineImages(cardFor(t), fetchAsDataURI)
  const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inlined)}`
  ctx.drawImage(await loadImage(svg, false), 0, 0, W, H)

  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('the picture came back empty'))),
      mime, mime === 'image/jpeg' ? Number(d.digital?.quality ?? 0.92) : undefined)
  })
  return blob
}

/*
 * WHAT THE BUYER IS TOLD, and it goes with the picture rather than instead of
 * it. The address is the part that matters: it is what lets them check the
 * ticket later, and it is the whole of the message when the picture cannot be
 * made.
 *
 * THE BURMESE HERE HAS HAD NO NATIVE READER, the same as the six keys added to
 * the verify page. The English below it is the sentence that was meant; if the
 * two disagree, correct the Burmese against the English.
 */
const THANKS_MY = 'ဝယ်ယူသူအားပေးမှုအတွက် ကျေးဇူးတင်ပါသည်။'
const THANKS_EN = 'Thank you — this keeps the shelter open.'

/*
 * THE LAST LINE ON THE SUPPORTER CARD, and the only one that speaks to the
 * person rather than about the ticket.
 *
 * FIRST NAME ONLY, and the split is the whole care in it. "Good luck, Hung
 * Om!" reads as a mail merge; the card has already set their full name once,
 * larger, at the top, so repeating it adds nothing and costs the warmth the
 * line exists for.
 *
 * SPLIT ON WHITESPACE AND TAKE THE FIRST PART, which is right for the names
 * this raffle actually holds and is NOT a claim about names in general. A
 * Burmese name is frequently one word and comes back whole, which is the
 * correct answer. Where it is wrong it is wrong in the safe direction — too
 * much of somebody's name rather than a stranger's — and a name that is one
 * long word is drawn as itself rather than cut at a guess.
 *
 * Blank in, blank out: no name recorded draws no line at all, rather than
 * "Good luck, !" on the card a buyer keeps.
 */
function goodLuckFor(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || ''
  return first ? `Good luck, ${first}!` : ''
}

function messageFor(t) {
  const code = codeFor(t)
  const held = code ? holdingOf(t) : { tickets: 1 }
  /* The picture is the nicety; this line is what actually lets them check it
     later, so it names the same thing the QR opens and never a subset of it. */
  return [
    held.tickets > 1 ? `${held.tickets} tickets` : t.number,
    THANKS_MY, THANKS_EN,
    code ? receiptVerifyUrl(verifyBase.value, code)
      : ticketVerifyUrl(verifyBase.value, t.number, t.code),
  ].join('\n')
}

/*
 * THE BUYER'S DIGITAL TICKET, MINTED BEFORE IT IS DRAWN.
 *
 * One per buyer, covering everything they hold, behind one code — so the code
 * has to exist before the card can carry it, and only the server issues one.
 * Pressing send is the moment: a code issued on OPENING a modal would be a
 * write for looking at something.
 *
 * THE SAME BUYER ALWAYS GETS THE SAME CODE. `make_receipt` is keyed on their
 * telephone number now, replaces the item list and recomputes the band, so
 * sending again after another sale hands them a link they already have that
 * now covers more. That is the whole of "regenerated".
 *
 * IT FAILS LOUDLY RATHER THAN QUIETLY SENDING LESS. If the code cannot be
 * issued, the alternative is a picture of ONE ticket handed to somebody who
 * bought ten, captioned as their digital ticket. An organiser standing in
 * front of that buyer can press again; they cannot un-send a card that
 * understated what somebody paid for.
 */
async function mintHolding(t) {
  const numbers = ticketsHeldBy(t)
  if (numbers.length < 2) return
  const made = await api('make_receipt', { ticketNumbers: numbers })
  minted.value = { ...minted.value, [holdKeyOf(t)]: String(made.code) }
  /* The card is redrawn from `minted`, and the picture is rasterised from the
     card. Without this the JPEG is made from the markup that was on screen a
     tick ago — the single ticket — and the organiser watches the preview
     change into something other than what they just sent. */
  await nextTick()
}

/*
 * THE BUYER'S OWN TOKEN IS NOT THE ONE PRINTED, and that split is the whole of
 * why a digital ticket may say what a printed one may not.
 *
 * Every ticket carries a QR and that QR is PRINTED ON IT — so it authenticates
 * the ticket and never the person, and the public answer it gets is genuine or
 * not and nothing else. Price, book, draw date, what somebody paid and the
 * supporter band are on the other side of that line: they belong to the buyer,
 * and §4i ruled that they travel on the token only the buyer holds.
 *
 * That token is `ticket_receipts.code`. It is printed on nothing, and the only
 * way to have one is to have been sent one — a property of the system rather
 * than a policy laid over it. It is keyed on the BUYER now rather than on a set
 * of tickets, so one person has one of them for as long as they hold anything.
 * See mintHolding above, and the migration of 2026-09-21.
 *
 * `receiptSet`, `receiptMessage` and `sendReceipt` were here and are gone.
 * They sent that link ON ITS OWN, from a second button, beside a first button
 * that sent a picture of ONE ticket — two artefacts for one buyer, which is
 * exactly what one-digital-ticket-per-buyer exists to stop. The link travels
 * inside `messageFor` with the picture now, every time, and the count in the
 * button's label says what is about to go.
 */

/** How many tickets this buyer holds, for a label that says what will be sent. */
function heldCount(t) {
  return ticketsHeldBy(t).length || 1
}

/*
 * CAN THIS DEVICE HAND A FILE TO WHATSAPP — which is not what canShare asks.
 *
 * `navigator.canShare({files})` answers true in desktop Chrome, so a button
 * labelled "Send on WhatsApp" opened the macOS share sheet: Mail, Messages,
 * AirDrop, Notes, Freeform. No WhatsApp anywhere on it. The browser could
 * indeed share a file; the chooser it opened simply had nothing useful in it.
 *
 * The real question is whether the operating system's chooser has WhatsApp in
 * it, and that is a question about the device rather than about the API. On a
 * phone it does. On a desktop it does not, and wa.me does better there anyway —
 * it opens WhatsApp Web, which is the thing the button promised.
 *
 * So the file route is taken only where it beats the link. Everywhere else the
 * picture is saved and the message opened beside it, which was already written
 * and was simply unreachable.
 */
/*
 * PUT IT ON THE CLIPBOARD, so the desktop route is one paste rather than a hunt
 * through Downloads. WhatsApp Web accepts a pasted image, which is as close as a
 * browser gets to attaching one — no link can carry a picture, wa.me included.
 *
 * Every part of this is refused somewhere: the API is absent in Firefox, the
 * constructor throws outside a secure context, and some browsers accept no type
 * but PNG. None of that is worth reporting to somebody in the middle of selling
 * a ticket — the download is the backstop, and the message says which happened.
 */
async function copyPicture(blob) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

function canHandFileToAnApp(file) {
  if (!navigator.canShare?.({ files: [file] })) return false
  if (navigator.userAgentData?.mobile === true) return true
  const ua = navigator.userAgent || ''
  /* iPadOS reports itself as a Macintosh, and only the touch points give it
   * away. Everything else is an honest phone or tablet string. */
  const iPadOS = /Macintosh/.test(ua) && Number(navigator.maxTouchPoints) > 1
  return /Android|iPhone|iPad|iPod/i.test(ua) || iPadOS
}

/*
 * SEND IT. A picture where the phone will carry one, a link where it will not.
 *
 * The fallback is not a degraded mode to apologise for — a WhatsApp message
 * carrying the check address is the thing that actually matters, because it is
 * what lets the buyer prove the ticket later. The picture is the nicety.
 */
async function send(t) {
  shareNote.value = { ...shareNote.value, [t.number]: '' }
  sharing.value = t.number
  try {
    await mintHolding(t)
    const blob = await pictureOf(t)
    const file = new File([blob], `${t.number}.jpg`, { type: 'image/jpeg' })
    if (canHandFileToAnApp(file)) {
      await navigator.share({ files: [file], text: messageFor(t) })
      return
    }
    /*
     * No file sharing here. The picture is copied and saved, the message opened
     * beside it, and — the part that was missing — the screen SAYS so.
     *
     * Reported as "WhatsApp didn't get the picture, only the thank-you note,
     * ticket number and verification link". It had made the picture: it was in
     * Downloads. Nothing on screen mentioned that, and the only note this panel
     * could show fired when the picture FAILED — so a working desktop share
     * looked exactly like a broken one. A silent side-effect is not a feature
     * somebody has; it is one they have to be told about.
     */
    const pasted = await copyPicture(await pictureOf(t, 'image/png'))
    saveBlob(blob, `${t.number}.jpg`)
    window.open(`https://wa.me/?text=${encodeURIComponent(messageFor(t))}`, '_blank', 'noopener')
    shareNote.value = { ...shareNote.value, [t.number]: pasted
      ? 'WhatsApp cannot be handed a picture from a link, so the ticket is on your clipboard — paste it into the chat. It is in your Downloads too.'
      : 'WhatsApp cannot be handed a picture from a link, so the ticket is in your Downloads — drag it into the chat.' }
  } catch (e) {
    if (e?.name === 'AbortError') return          // they closed the share sheet
    shareNote.value = { ...shareNote.value, [t.number]: 'The picture could not be made on this device, so the check link is being sent instead.' }
    window.open(`https://wa.me/?text=${encodeURIComponent(messageFor(t))}`, '_blank', 'noopener')
  } finally {
    sharing.value = ''
  }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

async function savePicture(t) {
  shareNote.value = { ...shareNote.value, [t.number]: '' }
  sharing.value = t.number
  try {
    saveBlob(await pictureOf(t), `${t.number}.jpg`)
  } catch {
    shareNote.value = { ...shareNote.value, [t.number]: 'The picture could not be made on this device. Send the check link instead.' }
  } finally {
    sharing.value = ''
  }
}

/* Paging is paging between BUYERS as often as between tickets — a book sold
   to four people is four holdings — so each one is asked for as it is reached
   rather than only the first. Already-known codes short-circuit. */
watch(current, (t) => { ensureHolding(t) })

onMounted(async () => {
  const scope = props.payload?.book
    ? { book: props.payload.book }
    : { numbers: [props.payload?.number] }
  try {
    /*
     * withBuyer here because this screen is for LOOKING at one ticket — an
     * organiser checking what a sold ticket's stub actually says. Printing a
     * blank book is the other screen, and it asks separately.
     */
    result.value = await api('render_tickets', { ...scope, withBuyer: true })
    /* The buyer's own code, so the card on screen is the card that goes. */
    await nextTick()
    ensureHolding(current.value)
  } catch (e) {
    err.value = e.message
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    busy.value = false
  }
  loadLogo()
})
</script>

<template>
  <Sheet :title="title" :subtitle="range" wide @close="emit('close')">
    <p v-if="busy" class="muted">Drawing…</p>
    <p v-else-if="err" class="note bad">{{ err }}</p>

    <template v-else>
      <p v-if="missing.length" class="note tiny">
        <template v-if="!tickets.length">
          This has never been generated, so it has no code yet and cannot be printed.
        </template>
        <template v-else>
          {{ missing.length }} of these has not been generated yet and is not shown:
          {{ missing.slice(0, 6).join(', ') }}<template v-if="missing.length > 6">, and
          {{ missing.length - 6 }} more</template>.
        </template>
      </p>

      <!--
        The pager, as 8a draws it: "1 of 10" between two arrows. Hidden for a
        single ticket, where a pager would be furniture.
      -->
      <div v-if="tickets.length > 1" class="pager">
        <button class="btn sm ghost" :disabled="at === 0"
                :title="at === 0 ? 'This is the first' : 'The one before'"
                @click="step(-1)">&lsaquo;</button>
        <span class="data" title="Printed tickets in this book. The digital ticket below is one per buyer and does not change as you page.">{{ at + 1 }} of {{ tickets.length }}</span>
        <button class="btn sm ghost" :disabled="at >= tickets.length - 1"
                :title="at >= tickets.length - 1 ? 'This is the last' : 'The next one'"
                @click="step(1)">&rsaquo;</button>
      </div>

      <div v-for="t in (current ? [current] : [])" :key="t.number" class="one">
        <div class="ticketpreview">
          <img :src="result.template.url" alt="">
          <div class="overlay" v-html="layerFor(t)"></div>
        </div>
        <!-- THE PRINTED TICKET, which IS one per ticket and carries its own
             QR on the paper. That is the half the pager is paging; the digital
             ticket below is one per buyer and does not change with it. -->
        <p class="tiny muted">
          <b class="data">{{ t.number }}</b> · {{ t.book }} · {{ t.status || 'Available' }}
          · generated {{ t.generatedAt ? date(t.generatedAt) : '—' }}
          · <template v-if="t.printedAt">printed {{ date(t.printedAt) }}</template>
            <template v-else>not printed yet</template>
        </p>

        <!--
          THE CARD A BUYER IS SENT, shown as it will be sent.
          It is not the ticket above: the name lives on the stub and the code on
          the buyer's half, so what belongs to the buyer is composed rather than
          cropped. See digitalCardSVG.
        -->
        <!--
          AND IT IS ONE ARTEFACT, WHICH THIS HEADING EXISTS TO SAY.
          The pager above steps through PRINTED tickets, one page each, because
          each has its own artwork and its own printed QR. The digital ticket
          does not work that way: it is one per BUYER, covering everything they
          hold, behind one QR. Paging a book sold to one person therefore shows
          the SAME digital ticket ten times — correct, and indistinguishable
          from ten digital tickets unless the screen says which it is. It was
          read as the second thing, which is fair: nothing on the screen said
          otherwise.
        -->
        <!--
          WHAT IT IS, THEN WHETHER WE HAVE IT — two sentences, not one.
          The first describes the artefact and is true whether or not a code
          has come back yet; folding them together left a state with nothing
          said in it, which the suite caught on a render where the request had
          not run. A screen that goes quiet while it waits is the failure this
          whole block was added to stop.
        -->
        <p class="digihead">
          <span class="rubric">Their digital ticket</span>
          <span v-if="heldCount(t) > 1" class="tiny muted">
            One picture and one QR for all {{ heldCount(t) }} tickets this buyer holds
            — the same one on every page of this book.
          </span>
          <span v-else class="tiny muted">
            One picture and one QR. It covers everything this buyer holds.
          </span>
        </p>
        <!--
          THE CARD BELOW IS NOT THE ONE THEY SHOULD GET, AND IT SAYS SO.
          Without this the fallback is a perfectly ordinary-looking card for
          one ticket, and the only clue that anything failed is that it shows
          the wrong thing — which you can only notice if you already know what
          the right thing looks like.
        -->
        <p v-if="whyNoHolding(t)" class="note warn tiny nohold">
          The card below is this one ticket, not their digital ticket — it
          could not be made: {{ whyNoHolding(t) }}
        </p>
        <!--
          THE COPY A BUYER KEEPS. Disabled with the reason rather than hidden,
          so an organiser learns that the sale needs recording rather than
          concluding the button has gone.
        -->
        <div class="send" :class="{ off: !!cannotSend(t) }">
          <!--
            Two columns, as 8a draws it: the keepsake on the left and what is
            known about this ticket on the right. The number and the sold state
            used to sit in a header above the card — the card says both, so the
            header was the card read aloud.
          -->
          <div class="card" v-html="cardFor(t)"></div>

          <aside class="rail">
            <p class="rubric">This ticket</p>
            <!--
              A facts table, label left and value right, which is the shape the
              system gives every derived-from-nothing fact. Absent values print
              an em dash rather than nothing, so a missing phone is visibly
              missing rather than a row that failed to render.
            -->
            <dl class="facts">
              <div class="fact"><dt>Buyer</dt><dd>{{ t.buyer?.name || '\u2014' }}</dd></div>
              <div class="fact"><dt>Phone</dt><dd class="data">{{ t.buyer?.phone || '\u2014' }}</dd></div>
              <div class="fact"><dt>Seller</dt><dd>{{ t.buyer?.seller || '\u2014' }}</dd></div>
              <div class="fact"><dt>Code</dt><dd class="data">{{ t.code || '\u2014' }}</dd></div>
              <!--
                THE BAND, BESIDE THE BUYER IT BELONGS TO. A row rather than a
                chip in the Look block: Look reports what the RAFFLE is wearing
                and this is a fact about this ticket's buyer, which is what the
                rail above it is for.

                The row is absent when there is no band — no telephone number
                recorded, or a raffle with no book size — rather than drawn
                empty. "Supporter: —" invites somebody to go and set one, and
                there is nowhere to set one: WHO is on a rung is counted, never
                awarded.

                WHAT THE RUNG IS CALLED IS SETTABLE, THOUGH, AND THE TITLE SAYS
                SO. That half changed when the words became configuration — a
                raffle for the learning centre calls rung four "Patron" and one
                for the shelter calls it "Keeper". Somebody reading "Keeper"
                here and wondering where it came from has nowhere to look
                otherwise, and the honest answer is two sentences: the word is
                yours, the count is not. The link to change it is in the Look
                block below, with the rest of what this raffle is wearing.
              -->
              <div v-if="bandFor(t)" class="fact">
                <dt>Supporter</dt>
                <dd :title="'Counted from the ' + rankCount(bandFor(t)) + ' this buyer holds, never awarded. '
                            + 'What the rung is CALLED is this raffle\u2019s own \u2014 change it in Setup.'">
                  {{ bandFor(t).name }} <span class="muted">· {{ rankCount(bandFor(t)) }}</span>
                </dd>
              </div>
            </dl>

          <!--
            Card 8a's "Look" block: what this card is currently wearing, and
            where to change it. Status, not controls — a modal about one ticket
            is not the place that owns the raffle's appearance, so the chips
            read and the links travel.

            THE MOCKUP'S THIRD CHIP IS "Motto on", and it is drawn now. It was
            held back because nothing anywhere SET the motto — no Setup field,
            no branding API field — so a chip reading "Motto off" beside a link
            to a page with no motto field was a dead end wearing the costume of
            state. Ticket Studio · Digital ticket writes it, and the link below
            goes there, so the chip reports something a reader can act on.
          -->
          <!--
            WHAT THIS CARD IS WEARING — one line — AND THREE WAYS TO CHANGE IT.

            It was five pills and three sentences, and the pills were the
            problem. `.chip` in style.css is this app's PRESSABLE control: a
            44px tap target with `cursor: pointer` and a hover that turns it
            brand-coloured, and every other user of it is a <button> — Search's
            "Try:" row, Approvals' reasons, SellTicket, TicketsInPlay. These
            were <li>. The scoped block below restyled their padding and colour
            and did not touch the cursor, the tap height or the hover, so the
            panel showed five things the size of a button that lit up under the
            pointer and did nothing. Shape promising an action that is not
            there is the most direct way to break "don't make me think".

            So the state is a line of text and the actions are buttons, which is
            the distinction the old markup had backwards. The model is
            unchanged and is still right: these READ, and the three controls
            TRAVEL — a modal about one ticket does not own the raffle's
            appearance.

            THREE AND NOT TWO, because they go to three places: the treatment
            and the motto are the card's and live in the studio; the colour and
            the logo are the raffle's and live in Setup; the rungs are the
            raffle's words for its supporters and live in their own card there.
          -->
          <section class="look">
            <p class="rubric">Look</p>
            <p class="wearing">
              <span class="swatch" :style="{ background: state.cfg?.brandColor || 'var(--brand)' }"></span>
              <!-- NO SEPARATORS. A middot between four facts in a 300px rail
                   is a character that has to wrap somewhere, and both places
                   are wrong: as a sibling it orphans at the end of a line, and
                   glued to the item after it, it leads the next one. Spacing
                   separates them at every width and cannot break. -->
              <span v-for="bit in wearing" :key="bit.text" class="bit"
                    :class="{ off: bit.off }" :title="bit.why">{{ bit.text }}</span>
            </p>
            <!-- THREE EQUAL COLUMNS, NOT A WRAPPING ROW. At rail width the
                 three came to about 298px against 300 of room, so they wrapped
                 2 and 1 and read as ragged rather than as a set. A grid makes
                 them one object, and it cannot go ragged at a width nobody
                 tested. -->
            <div class="goto">
              <button type="button" class="btn sm"
                      title="Choose the treatment and the motto for the card a buyer receives"
                      @click="toCardStudio"><Icon name="design" :size="16" />Card</button>
              <button type="button" class="btn sm" title="Change the raffle's colour and logo"
                      @click="toSetup"><Icon name="image" :size="16" />Colour</button>
              <button type="button" class="btn sm"
                      title="Choose what this raffle calls its supporters, and how many books each rung takes"
                      @click="toSetup"><Icon name="people" :size="16" />Rungs</button>
            </div>
          </section>

          <!--
            THE ACTIONS ARE THEIR OWN BLOCK, separated from what the panel is
            telling you rather than continuing the same 8px rhythm as the facts
            above. Reading and acting are different jobs and the eye needs the
            break to tell them apart.
          -->
          <div class="doing">
            <!--
              ONE BUTTON WHERE THERE WERE TWO, and the model is the reason.
              "Send on WhatsApp" sent a picture of THIS TICKET, and "Send their
              receipt" sent a link covering everything the buyer held. Under
              one-digital-ticket-per-buyer those are not two things — the
              picture and the link are one artefact, and the message has always
              carried the address the QR opens. Two buttons for it read as a
              choice, and the wrong half of that choice hands somebody who
              bought ten tickets a picture of one.

              THE COUNT IS IN THE LABEL because it is what is about to happen,
              and whoever presses this is standing in front of the buyer. It
              says in three characters what a sentence underneath would have
              said and nobody would have read.
            -->
            <button class="btn primary wide" :disabled="!!cannotSend(t) || sharing === t.number"
                    :title="cannotSend(t) || (heldCount(t) > 1
                      ? 'One picture and one link covering every ticket this buyer holds'
                      : 'Send this ticket and its check link to the buyer')"
                    @click="send(t)">
              <template v-if="sharing === t.number">Working&hellip;</template>
              <template v-else>Send their digital ticket<template
                v-if="heldCount(t) > 1"> &middot; {{ heldCount(t) }} tickets</template></template>
            </button>
            <button class="btn wide" :disabled="!!cannotSend(t) || sharing === t.number"
                    :title="cannotSend(t) || 'Save the card as a picture'"
                    @click="savePicture(t)">Save the picture</button>

            <!--
              WHAT IS SAID HERE IS ONLY EVER ABOUT NOW. Two standing paragraphs
              used to sit under these buttons: one describing the link fallback,
              one describing when sending is refused. Both are already said at
              the moment they apply — the refusal by cannotSend on the disabled
              button and below, the fallback by shareNote after a send. A
              permanent notice about an occasional outcome is read once and then
              becomes furniture, and it was the tallest thing in the column.
            -->
            <p v-if="cannotSend(t)" class="tiny muted">{{ cannotSend(t) }}</p>
            <p v-if="shareNote[t.number]" class="note tiny">{{ shareNote[t.number] }}</p>
          </div>
          </aside>
        </div>
      </div>
    </template>

    <template #actions>
      <button v-if="tickets.length" class="btn" @click="emit('print', payload)">Print</button>
      <button v-if="tickets.length" class="btn"
              title="Ten watermarked sample tickets. Not in the raffle, cannot be sold."
              @click="emit('print-sample')">Print samples</button>
      <button class="btn ghost" @click="emit('close')">Close</button>
    </template>
  </Sheet>
</template>

<style scoped>
/* The heading over the card: what it is, then how wide it reaches. Two lines
   on a phone, one at desk width, and the sentence never competes with the
   rubric above it. */
.digihead {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px;
  margin: 18px 0 8px;
}
.digihead .rubric { margin: 0 }
/* Amber, not red: nothing is broken and nothing is lost — the card below is
   simply the smaller of two true things, and the sentence says which. */
.nohold { margin: 0 0 10px }

.one { margin-bottom: 18px }
/*
 * The send panel. One column, because the card is the subject and two buttons
 * stacked under it is how the mockup reads — a row of equal buttons beside a
 * picture makes the picture look like an illustration of them.
 */
.send { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px;
        align-items: start; margin-top: 10px;
        padding-top: 12px; border-top: 1px solid var(--border) }
/* One column on a phone: 300px of rail beside a card leaves neither room. */
@media (max-width: 720px) { .send { grid-template-columns: minmax(0, 1fr) } }
.send.off { opacity: .6 }
.send p { margin: 0 }
.rail { display: flex; flex-direction: column; gap: 8px; min-width: 0 }
/* The gap above is the rhythm for rows of facts. Buttons are not a fact, so
 * they get a rule and real air rather than one more 8px step. */
.doing {
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border);
}
.doing .note, .doing .tiny { margin: 0 }

/*
 * The "Look" block. A quiet group, not a card: it is the fourth container in a
 * 300px rail, and a fifth rounded box would make the rail read as a stack of
 * equals with nothing saying which part is the ticket's facts and which is the
 * raffle's appearance. A rule above it and a rubric is enough separation.
 */
.look { margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--border) }
/*
 * A LINE, NOT PILLS. The five read-outs used `.chip`, which this scoped block
 * restyled the padding and colour of and did NOT redeclare `cursor: pointer`,
 * `min-height: 44px` or `.chip:hover` — so they kept the global control's tap
 * height, pointer and brand-coloured hover while doing nothing at all.
 */
.wearing {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px;
  margin: 0 0 10px; font-size: .82rem; color: var(--text); line-height: 1.8;
}
/* Each reading is one unbreakable unit, so the line wraps BETWEEN facts rather
   than inside one — "Grand" over "card" is two answers to one question. */
.wearing .bit { white-space: nowrap }
/* Absent, not broken — the raffle simply has no logo yet. It is also what
   tells the four apart without a separator: what IS set reads at full
   strength, what is not reads quiet. */
.wearing .off { color: var(--muted) }
.goto { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px }
.goto .btn { padding-left: 8px; padding-right: 8px }

.swatch { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .18) }

/* `.linky` went with the three stacked sentence-links it dressed. Left behind
   it would be the mirror of the dead imports removed from TicketDesign today:
   a name with nothing using it, which nothing in the toolchain reports. */
.send .wide { width: 100% }

/* The pager. Centred above the card, because it is about the card and not
   about the book — the run and the count are in the sheet's subtitle. */
.pager { display: flex; align-items: center; justify-content: center; gap: 10px;
         margin-bottom: 12px }

/* The same treatment the studio's `.rubric` carries. --fs-3xs is .66 where
   this said .68: the nearest step on the scale, and the 2% studio.css already
   decided no eye resolves. Margin stays absent on purpose — two of the three
   users here are <p>, and zeroing it would move them. */
.rubric { font-size: var(--fs-3xs); font-weight: var(--fw-medium); letter-spacing: .07em;
          text-transform: uppercase; color: var(--muted) }
.facts { margin: 0 }
.fact { display: flex; align-items: baseline; gap: 12px;
        padding: 8px 0; border-top: 1px solid var(--border) }
.fact dt { color: var(--muted); font-size: .86rem; flex: 1; min-width: 0 }
.fact dd { margin: 0; font-weight: 600; text-align: right; min-width: 0;
           overflow-wrap: anywhere }
/*
 * Top of its column, and the slack below it is deliberate.
 *
 * The rail is the taller column — four facts, a privacy note, the Look block
 * and three actions — and the card cannot be made to match it: at 1.5:1 a card
 * tall enough to reach the last button would have to be wider than the sheet.
 * Centring it was tried and is worse: the card drops past the rail's first row
 * and the two columns lose the shared top edge that says they are one panel.
 * An asymmetric panel with a short column is ordinary; a floating card is not.
 */
.card { border-radius: 8px; overflow: hidden; box-shadow: var(--shadow); align-self: start }
.card :deep(svg) { display: block; width: 100%; height: auto }
.mono { font-family: var(--font-data); font-variant-numeric: tabular-nums; }
.ticketpreview { position: relative; width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden }
.ticketpreview img { display: block; width: 100%; height: auto }
.ticketpreview .overlay { position: absolute; inset: 0 }
.ticketpreview .overlay :deep(svg) { width: 100%; height: 100%; display: block }
</style>
