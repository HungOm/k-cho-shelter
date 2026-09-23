/*
 * ONE TICKET, AS A FILE — for a proof, a printer's question, or a WhatsApp.
 *
 * The studio could print a test SHEET through the browser's dialog and could
 * send a picture of the DIGITAL card, and it could not hand anybody the printed
 * ticket itself as a file. A print shop that asks "send us what it looks like"
 * got a screenshot of a design screen.
 *
 * Two files, for two jobs:
 *   PNG at 300 dpi — what a ticket looks like, to show and to proof.
 *   SVG — the same drawing as vectors, for a designer who will open it.
 *
 * THE TRAP THIS FILE IS SHAPED AROUND. An SVG rasterised through an <img>
 * (what the card's "Send a test" does) is sandboxed: it may not load anything
 * from outside itself, so an <image href="https://…"> inside it draws as
 * nothing — silently. The artwork and any placed picture are such hrefs. So
 * the PNG is drawn in two passes, the artwork straight onto the canvas and
 * the layer over it, and any picture INSIDE the layer is inlined first as a
 * data URI. What could not be fetched is reported, never quietly dropped.
 *
 * PURE UP TO `rasterise`, which is the one function that needs a browser.
 */

const MM_PER_INCH = 25.4

/** The export's size in pixels: the printed width at this many dots an inch. */
export function exportSize(widthMM, artWidth, artHeight, dpi = 300) {
  const w = Math.round((Number(widthMM) / MM_PER_INCH) * dpi)
  const ratio = Number(artHeight) / Number(artWidth)
  /* Finite as well as positive: an artwork width of nought makes the ratio
     Infinity, which is greater than nought and is not a shape. */
  if (!(w > 0) || !(ratio > 0) || !Number.isFinite(ratio)) return { width: 0, height: 0 }
  return { width: w, height: Math.round(w * ratio) }
}

/*
 * THE TICKET AS ONE DOCUMENT: the artwork, then the layer the studio draws —
 * the same `elementLayerSVG` string the canvas and the print sheet use, so a
 * download cannot disagree with either. The layer is nested whole; its own
 * viewBox is the artwork's pixels, which is also this document's.
 */
export function ticketSVG({ layer, artworkHref, artWidth, artHeight, width, height }) {
  const w = Number(artWidth), h = Number(artHeight)
  const inner = String(layer || '').replace(/^<svg\b/, `<svg x="0" y="0" width="${w}" height="${h}"`)
  const size = width && height ? ` width="${width}" height="${height}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${size}>`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>`
    + (artworkHref ? `<image href="${esc(artworkHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>` : '')
    + inner
    + '</svg>'
}

/** Only the layer, for the second pass of the PNG — no paper, no artwork. */
export function layerDocument({ layer, artWidth, artHeight }) {
  const w = Number(artWidth), h = Number(artHeight)
  const inner = String(layer || '').replace(/^<svg\b/, `<svg x="0" y="0" width="${w}" height="${h}"`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Every https picture in an SVG string, replaced by its bytes as a data URI.
 * `fetcher(url)` returns a data URI or throws; anything that throws is left as
 * it was and named in `failed`, so the caller can say which picture is missing
 * from the file rather than hand over a ticket with a hole in it.
 */
export async function inlineImages(svg, fetcher) {
  const urls = [...new Set([...String(svg).matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1]))]
  let out = String(svg)
  const failed = []
  for (const url of urls) {
    try {
      const data = await fetcher(url.replace(/&amp;/g, '&'))
      out = out.split(`href="${url}"`).join(`href="${data}"`)
    } catch {
      failed.push(url)
    }
  }
  return { svg: out, failed }
}

/* ---------- the browser half ---------- */

/** A data URI for a picture, fetched the way the canvas will be allowed to use it. */
export async function fetchAsDataURI(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`${res.status}`)
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('unreadable'))
    r.readAsDataURL(blob)
  })
}

const load = (src, cors) => new Promise((resolve, reject) => {
  const img = new Image()
  if (cors) img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('The picture could not be loaded.'))
  img.src = src
})

/**
 * The ticket as a PNG: white paper, the artwork, the layer. The artwork is
 * loaded with CORS so the canvas is not tainted — a tainted canvas refuses
 * toBlob, and the export would fail at the last step with nothing drawn.
 */
export async function rasterise({ layerSVG, artworkHref, width, height }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  if (artworkHref) ctx.drawImage(await load(artworkHref, true), 0, 0, width, height)
  const url = URL.createObjectURL(new Blob([layerSVG], { type: 'image/svg+xml' }))
  try {
    ctx.drawImage(await load(url, false), 0, 0, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The ticket could not be saved as a picture.')
  return blob
}

/** Hand a file to the browser to save. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
