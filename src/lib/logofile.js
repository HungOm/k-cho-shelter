/**
 * Turning a file somebody picked into the two images the raffle stores.
 *
 * WHY RESIZE HERE. The server caps each image at 512 KB, but the reason to
 * shrink is not the cap — it is that the mark is drawn at 40px in the interface
 * and the original is whatever came off a designer's machine, which on this
 * project was 156 KB for something the size of a thumbnail. That file is sent
 * to every volunteer's phone on mobile data, every day of the raffle. Sending
 * 156 KB where 6 KB would do is somebody else's money.
 *
 * Both sizes are produced here so the small one is genuinely small rather than
 * the same file under a second name.
 *
 * EVERYTHING COMES OUT AS PNG. The canvas re-encodes anyway, so honouring the
 * input type would only preserve a label, not the bytes — and PNG keeps the
 * transparency a logo usually depends on, which JPEG silently fills with black.
 * One output type also means contentType cannot disagree with what was sent.
 *
 * NONE OF THIS IS A SECURITY CHECK. The server caps and type-checks each image
 * independently and does not trust which one was labelled small. What follows
 * is a courtesy: it fails early, on the device, with a sentence somebody can
 * act on, instead of after a slow upload.
 */

/** What the server will accept. SVG is deliberately not here — see reject(). */
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

/** Big enough for any camera photo of a printed logo; small enough to decode. */
export const MAX_SOURCE = 8 * 1024 * 1024

export const SIZES = { big: 192, small: 96 }

/**
 * Why this file cannot be used, in words for whoever picked it — or null.
 *
 * SVG gets its own sentence rather than falling into "not a picture we can
 * use", because it IS a picture and being told otherwise would read as a bug.
 * The reason it is refused is that an SVG can carry script and would be served
 * from this raffle's own origin, alongside the session and several thousand
 * phone numbers.
 */
export function reject(file) {
  if (!file) return 'No file was chosen.'
  const type = String(file.type || '').toLowerCase()
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    return 'SVG logos cannot be uploaded, because an SVG can carry code and this ' +
      'one would be served from the raffle\'s own address. Save it as a PNG and ' +
      'upload that — whoever made the logo can do it in a minute.'
  }
  if (!ACCEPTED.includes(type)) return 'That is not a PNG, JPEG or WebP picture.'
  if (file.size > MAX_SOURCE) {
    return `That picture is ${Math.round(file.size / 1024 / 1024)} MB. Please use one under 8 MB.`
  }
  return null
}

/** Square, centred, transparent where the picture does not reach. */
export function drawSquare(img, side, doc = document) {
  const canvas = doc.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  // Contain rather than cover: a logo cropped to fill a square loses the part
  // of itself that was doing the identifying.
  const scale = Math.min(side / w, side / h)
  const dw = Math.round(w * scale)
  const dh = Math.round(h * scale)
  ctx.drawImage(img, Math.round((side - dw) / 2), Math.round((side - dh) / 2), dw, dh)
  return canvas
}

/** Bare base64, no data: prefix — the prefix would be a second place to state the type. */
export function bare(dataUrl) {
  const i = String(dataUrl || '').indexOf(',')
  return i < 0 ? '' : dataUrl.slice(i + 1)
}

/**
 * The payload, or a thrown sentence.
 *
 * Deliberately not silent about a decode failure: a file the browser cannot
 * read is usually a renamed something-else, and "nothing happened" is the
 * worst possible response to that.
 */
export async function toPayload(file) {
  const why = reject(file)
  if (why) throw new Error(why)

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject_) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject_(new Error('That file could not be opened as a picture.'))
      el.src = url
    })
    return {
      data: bare(drawSquare(img, SIZES.big).toDataURL('image/png')),
      dataSmall: bare(drawSquare(img, SIZES.small).toDataURL('image/png')),
      contentType: 'image/png'
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}
