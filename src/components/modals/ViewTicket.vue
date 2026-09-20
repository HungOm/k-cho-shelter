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
import { ref, computed, watch, onMounted } from 'vue'
import { state, api, toast, go, goStudio } from '../../lib/store.js'
import { designFor, stubShare } from '../../lib/ticketdesign.js'
import { rankFor, rankCount } from '../../lib/ranks.js'
import { numberLayerSVG, ticketVerifyUrl, receiptVerifyUrl, cardSVG, CARD_DESIGNS, CARD } from '../../lib/ticketart.js'
import { encode } from '../../lib/qrcodegen.js'
import { date } from '../../lib/format.js'
import { inkFor } from '../../lib/brand.js'
import Sheet from '../ui/Sheet.vue'

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
  try {
    const r = await fetch(url, { mode: 'cors' })
    if (!r.ok) return
    const blob = await r.blob()
    logoUri.value = await new Promise((res) => {
      const f = new FileReader()
      f.onload = () => res(String(f.result))
      f.onerror = () => res('')
      f.readAsDataURL(blob)
    })
  } catch { /* no mark is a card with an initial on it, not a failure */ }
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
function ticketsHeldBy(t) {
  const phone = String(t?.buyer?.phone ?? '').trim()
  if (!phone) return []
  return (state.tickets || [])
    .filter((x) => isSold(x) && String(x?.buyer?.phone ?? '').trim() === phone)
    .map((x) => String(x.number))
    .sort()
}

const bandFor = (t) =>
  rankFor(ticketsHeldBy(t).length, Number(state.cfg?.ticketsPerBook ?? 0))

function cardValues(t) {
  const c = state.cfg || {}
  const brand = String(c.brandColor || '').trim()
  const band = bandFor(t)
  return {
    number: t.number,
    name: t.buyer?.name ?? '',
    org: String(c.orgName ?? '').trim(),
    event: String(c.eventName ?? '').trim(),
    drawOn: c.drawDate ? date(c.drawDate) : '',
    price: c.ticketPrice ? `${c.currency ?? ''} ${c.ticketPrice}`.trim() : '',
    /* Card 8a puts three facts on one line — what it cost, which book, when it
     * sold. `soldAt` is rendered only if the payload carries it; a fact that is
     * absent draws nothing rather than an empty label. */
    book: t.book ?? '',
    soldOn: t.soldAt ? date(t.soldAt) : '',
    sold: isSold(t),
    motto: String(c.motto ?? '').trim(),
    /* Blank when there is no band, which the card draws as nothing. It never
       falls back to the bottom rung — see ranks.js. */
    rankName: band?.name ?? '',
    rankCount: rankCount(band),
    brand,
    /* Computed, never configured — an organisation choosing a colour is not
     * choosing a contrast ratio. See brand.js. */
    ink: inkFor(brand) || '#ffffff',
    logo: logoUri.value,
    thanks: THANKS_EN,
    link: ticketVerifyUrl(verifyBase.value, t.number, t.code).replace(/^https?:\/\//, ''),
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
const cardName = computed(
  () => CARD_DESIGNS.find(d => d.id === cardStyle.value)?.name || 'Grand',
)
const cardNote = computed(
  () => CARD_DESIGNS.find(d => d.id === cardStyle.value)?.note || '',
)

const cardFor = (t) => cardSVG(cardStyle.value, cardValues(t), {
  qrUrl: ticketVerifyUrl(verifyBase.value, t.number, t.code),
  encode,
})

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

  const svg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardFor(t))}`
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

function messageFor(t) {
  return [t.number, THANKS_MY, THANKS_EN, ticketVerifyUrl(verifyBase.value, t.number, t.code)].join('\n')
}

/*
 * THE BUYER'S OWN LINK, and the reason it has to exist at all.
 *
 * Every ticket carries a QR, and that QR is PRINTED ON IT — so it authenticates
 * the ticket and never the person, and the public answer it gets is genuine or
 * not and nothing else. Price, book, draw date, what somebody paid and the
 * supporter band are all on the other side of that line: they belong to the
 * buyer, and §4i ruled that they travel on the token only the buyer holds.
 *
 * That token is `ticket_receipts.code`. It is minted per set, printed on
 * nothing, and the only way to have one is to have been sent one. Until now
 * nothing sent one. `make_receipt` was registered as a write and called by no
 * screen; `?r=CODE` had a complete server and a complete page and no traffic,
 * so every fact that ruling moved to the receipt view had been moved somewhere
 * unreachable — including, as of this week, the thank-you on the card.
 *
 * ONE LINK FOR EVERYTHING THEY HOLD, not one per ticket. A buyer who took ten
 * tickets was sent ten pictures and ten QR codes and had to check them one at a
 * time, which is the case makeReceipt was written for. The set is their sold
 * tickets, found by telephone number — never by name, because two buyers called
 * "Ma Hla" are two people. With no number recorded there is no set, so the
 * receipt covers this ticket alone: a receipt for one is still a receipt, and
 * it is better than silently grouping strangers.
 */
function receiptSet(t) {
  const held = ticketsHeldBy(t)
  return held.length ? held : [String(t.number)]
}

function receiptMessage(count, url) {
  return [
    count > 1 ? `${count} tickets` : '1 ticket',
    THANKS_MY,
    THANKS_EN,
    url,
  ].join('\n')
}

async function sendReceipt(t) {
  shareNote.value = { ...shareNote.value, [t.number]: '' }
  sharing.value = t.number
  try {
    const numbers = receiptSet(t)
    /*
     * The same set always mints the same code — makeReceipt looks for an
     * existing receipt covering exactly these tickets before making one. So
     * pressing this twice sends the buyer the same link rather than a second
     * artefact they have to work out which of is theirs.
     */
    const made = await api('make_receipt', { ticketNumbers: numbers })
    const url = receiptVerifyUrl(verifyBase.value, made.code)
    window.open(`https://wa.me/?text=${encodeURIComponent(receiptMessage(numbers.length, url))}`,
                '_blank', 'noopener')
    shareNote.value = { ...shareNote.value, [t.number]: numbers.length > 1
      ? `One link covering all ${numbers.length} of this buyer's tickets is in the message.`
      : 'The buyer\u2019s own link is in the message. It shows what they paid and which book, which the printed QR does not.' }
  } catch (e) {
    shareNote.value = { ...shareNote.value, [t.number]: e.message }
    if (e.code) toast(e.message, 'bad', e.code)
  } finally {
    sharing.value = ''
  }
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
        <span class="data">{{ at + 1 }} of {{ tickets.length }}</span>
        <button class="btn sm ghost" :disabled="at >= tickets.length - 1"
                :title="at >= tickets.length - 1 ? 'This is the last' : 'The next one'"
                @click="step(1)">&rsaquo;</button>
      </div>

      <div v-for="t in (current ? [current] : [])" :key="t.number" class="one">
        <div class="ticketpreview">
          <img :src="result.template.url" alt="">
          <div class="overlay" v-html="layerFor(t)"></div>
        </div>
        <p class="tiny muted">
          <b class="data">{{ t.number }}</b> · {{ t.book }} · {{ t.status || 'Available' }}
          · generated {{ t.generatedAt ? date(t.generatedAt) : '—' }}
          · <template v-if="t.printedAt">printed {{ date(t.printedAt) }}</template>
            <template v-else>not printed yet</template>
        </p>

        <!--
          THE COPY A BUYER KEEPS. Disabled with the reason rather than hidden,
          so an organiser learns that the sale needs recording rather than
          concluding the button has gone.
        -->
        <!--
          THE CARD A BUYER IS SENT, shown as it will be sent.
          It is not the ticket above: the name lives on the stub and the code on
          the buyer's half, so what belongs to the buyer is composed rather than
          cropped. See digitalCardSVG.
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
                there is nowhere to set one: it is counted, never awarded.
              -->
              <div v-if="bandFor(t)" class="fact">
                <dt>Supporter</dt>
                <dd>{{ bandFor(t).name }} <span class="muted">· {{ rankCount(bandFor(t)) }}</span></dd>
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
          <section class="look">
            <p class="rubric">Look</p>
            <ul class="chips">
              <li class="chip">
                <span class="swatch" :style="{ background: state.cfg?.brandColor || 'var(--brand)' }"></span>
                Raffle colour
              </li>
              <li class="chip" :class="{ off: !state.cfg?.logo }">{{ state.cfg?.logo ? 'Logo' : 'No logo' }}</li>
              <li class="chip" :class="{ off: !state.cfg?.motto }"
                  :title="state.cfg?.motto || 'No motto is printed on the card'">
                {{ state.cfg?.motto ? 'Motto on' : 'No motto' }}
              </li>
              <!-- IN THE SAME ROW, not under a DESIGN rubric of its own. It
                   was three buttons and it is one reading now, so it is the
                   same job as the chips beside it — and a rubric plus a row
                   holding one word spent two lines saying "Grand". It reads
                   "Grand card" rather than "Grand" because a bare treatment
                   name in a row of statements does not say what it is naming. -->
              <li class="chip" :title="cardNote">{{ cardName }} card</li>
            </ul>
            <!-- TWO LINKS, BECAUSE THEY GO TO TWO PLACES. Colour and logo are
                 the raffle's, and live in Setup; the treatment and the motto
                 are this card's, and live in the studio. One link covering
                 both would be right about half the time. -->
            <p class="links">
              <button type="button" class="linky"
                      title="Choose the treatment and the motto for the card a buyer receives"
                      @click="toCardStudio">Ticket Studio &middot; Digital ticket &rarr;</button>
              <button type="button" class="linky" title="Change the raffle's colour and logo"
                      @click="toSetup">Colour and logo in Setup &rarr;</button>
            </p>
          </section>

          <!--
            THE ACTIONS ARE THEIR OWN BLOCK, separated from what the panel is
            telling you rather than continuing the same 8px rhythm as the facts
            above. Reading and acting are different jobs and the eye needs the
            break to tell them apart.
          -->
          <div class="doing">
            <button class="btn primary wide" :disabled="!!cannotSend(t) || sharing === t.number"
                    :title="cannotSend(t) || 'Send this ticket and its check link to the buyer'"
                    @click="send(t)">
              {{ sharing === t.number ? 'Working…' : 'Send on WhatsApp' }}
            </button>
            <!--
              THE BUYER'S OWN LINK. Secondary, not primary: the everyday act on
              this screen is handing somebody their ticket, and this is the
              thing you send once so they can check the lot afterwards.

              It carries the count in its label because the count is the whole
              difference between it and the button above — "Send their receipt"
              beside "Send on WhatsApp" reads as two ways to do one thing, and
              "· 4 tickets" says in three characters what a sentence underneath
              would have said and nobody would have read.
            -->
            <button class="btn wide" :disabled="!!cannotSend(t) || sharing === t.number"
                    :title="cannotSend(t) || (receiptSet(t).length > 1
                      ? 'One link covering every ticket this buyer holds, showing what they paid and which books'
                      : 'The buyer\u2019s own link: what they paid and which book, which the printed QR never shows')"
                    @click="sendReceipt(t)">
              Send their receipt<template v-if="receiptSet(t).length > 1"> &middot; {{ receiptSet(t).length }} tickets</template>
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
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; list-style: none }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px;
  font-size: .8rem; color: var(--text); background: var(--surface-2);
}
/* Absent, not broken — the raffle simply has no logo yet. */
.chip.off { color: var(--muted); background: none }
/* Two links, stacked, not a wrapped row: side by side they read as one
   sentence broken in the middle, and at modal width the second wraps anyway. */
.links { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin: 0 }
.swatch { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .18) }

/* A link that is a button because it navigates the app rather than an href. */
.linky {
  border: 0; background: none; padding: 0; font: inherit; color: var(--brand);
  cursor: pointer; text-align: left;
}
.linky:hover:not(:disabled) { text-decoration: underline }
.linky:disabled { color: var(--muted); cursor: not-allowed; text-decoration: none }
.linky:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 4px }
.send .wide { width: 100% }

/* The pager. Centred above the card, because it is about the card and not
   about the book — the run and the count are in the sheet's subtitle. */
.pager { display: flex; align-items: center; justify-content: center; gap: 10px;
         margin-bottom: 12px }

.rubric { font-size: .68rem; font-weight: 600; letter-spacing: .07em;
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
