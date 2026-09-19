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
import { ref, computed, onMounted } from 'vue'
import { state, api, toast } from '../../lib/store.js'
import { designFor, stubShare } from '../../lib/ticketdesign.js'
import { numberLayerSVG, ticketVerifyUrl, digitalCardSVG, CARD } from '../../lib/ticketart.js'
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

const title = computed(() => (props.payload?.book
  ? `Book ${props.payload.book}`
  : String(props.payload?.number ?? 'Ticket')))

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
function cardValues(t) {
  const c = state.cfg || {}
  const brand = String(c.brandColor || '').trim()
  return {
    number: t.number,
    name: t.buyer?.name ?? '',
    org: String(c.orgName ?? '').trim(),
    event: String(c.eventName ?? '').trim(),
    drawOn: c.drawDate ? date(c.drawDate) : '',
    price: c.ticketPrice ? `${c.currency ?? ''} ${c.ticketPrice}`.trim() : '',
    brand,
    /* Computed, never configured — an organisation choosing a colour is not
     * choosing a contrast ratio. See brand.js. */
    ink: inkFor(brand) || '#ffffff',
    logo: logoUri.value,
    thanks: THANKS_EN,
    link: ticketVerifyUrl(verifyBase.value, t.number, t.code).replace(/^https?:\/\//, ''),
  }
}

const cardFor = (t) => digitalCardSVG(design.value, cardValues(t), {
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
  <Sheet :title="title" subtitle="As it will print" wide @close="emit('close')">
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

      <div v-for="t in tickets" :key="t.number" class="one">
        <div class="ticketpreview">
          <img :src="result.template.url" alt="">
          <div class="overlay" v-html="layerFor(t)"></div>
        </div>
        <p class="tiny muted">
          <b>{{ t.number }}</b> · {{ t.book }} · {{ t.status || 'Available' }}
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
          <div class="sendhead">
            <b class="mono">{{ t.number }}</b>
            <span class="grow"></span>
            <span v-if="isSold(t)" class="pill ok">sold</span>
            <span v-else class="pill">not sold yet</span>
          </div>

          <div class="card" v-html="cardFor(t)"></div>

          <p class="tiny muted">
            The buyer&rsquo;s name is printed on it, so a copy passed to someone else is
            visibly not theirs. Their phone, area and seller stay on the stub and are
            never sent.
          </p>

          <button class="btn primary wide" :disabled="!!cannotSend(t) || sharing === t.number"
                  :title="cannotSend(t) || 'Send this ticket and its check link to the buyer'"
                  @click="send(t)">
            {{ sharing === t.number ? 'Working…' : 'Send on WhatsApp' }}
          </button>
          <button class="btn wide" :disabled="!!cannotSend(t) || sharing === t.number"
                  :title="cannotSend(t) || 'Save the card as a picture'"
                  @click="savePicture(t)">Save the picture</button>

          <p class="note tiny fallback">
            If the phone cannot make the picture, a WhatsApp message carrying the check
            link is sent instead.
          </p>

          <p v-if="cannotSend(t)" class="tiny muted">{{ cannotSend(t) }}</p>
          <p v-else class="tiny muted">
            Sending is refused until the sale is recorded, and it never mints a code for
            an unprinted book.
          </p>
          <p v-if="shareNote[t.number]" class="note tiny">{{ shareNote[t.number] }}</p>
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
.send { display: flex; flex-direction: column; gap: 8px; margin-top: 10px;
        padding-top: 12px; border-top: 1px solid var(--border) }
.send.off { opacity: .6 }
.send p { margin: 0 }
.sendhead { display: flex; align-items: center; gap: 8px }
.sendhead .grow { flex: 1; min-width: 0 }
.send .wide { width: 100% }
.card { border-radius: 8px; overflow: hidden; box-shadow: var(--shadow) }
.card :deep(svg) { display: block; width: 100%; height: auto }
/* The fallback is information, not a warning: it is what happens next, and a
 * red note would read as something having gone wrong before it has. */
.fallback { border-left: 3px solid var(--info); background: var(--info-soft); color: var(--info) }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums }
.ticketpreview { position: relative; width: 100%; border: 1px solid var(--border); border-radius: 6px; overflow: hidden }
.ticketpreview img { display: block; width: 100%; height: auto }
.ticketpreview .overlay { position: absolute; inset: 0 }
.ticketpreview .overlay :deep(svg) { width: 100%; height: 100%; display: block }
</style>
