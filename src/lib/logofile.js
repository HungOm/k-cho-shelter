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

/**
 * What the file actually is, read from its first bytes.
 *
 * Both checks above can be walked past by renaming, because BOTH are labels:
 * the filename and the declared type are supplied by whoever picked the file,
 * and a browser will happily report image/png for a renamed SVG. The bytes are
 * the only part of a file that is not a claim about itself.
 *
 * This still is not the defence — the server reads its own bytes and does not
 * trust these. What it buys is the honest case: somebody renames logo.svg to
 * logo.png to get past the picker and finds out here, in a sentence, instead of
 * after a slow upload and a server error they cannot interpret.
 */
export function sniffType(bytes) {
  const b = bytes || []
  const at = (i, ...want) => want.every((v, k) => b[i + k] === v)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  // RIFF....WEBP — the four size bytes between are not ours to check.
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/**
 * Why the CONTENT cannot be used, in words — or null.
 *
 * Kept apart from reject() because one reads labels and this reads the file.
 * A disagreement between them is the interesting case and gets its own
 * sentence: it is either a renamed file or a mistake, and both are worth
 * saying plainly rather than reporting as an unreadable picture.
 */
export function rejectBytes(declared, bytes) {
  const actual = sniffType(bytes)
  if (!actual) {
    return 'That file is not a PNG, JPEG or WebP inside, whatever it is called. ' +
      'If it is an SVG, save it as a PNG and upload that.'
  }
  if (actual !== String(declared || '').toLowerCase()) {
    return `That file is named as ${declared} but is really ${actual}. ` +
      'Re-save it in the format you want and upload it again.'
  }
  return null
}

/**
 * THE PART OF THE PICTURE THAT IS ACTUALLY THE PICTURE, or null.
 *
 * WHY THIS EXISTS. A logo exported from a design tool nearly always carries
 * transparent margin — the artboard was bigger than the mark. Every layout
 * downstream then treats that margin as part of the logo, so the mark lands
 * inside its box at whatever fraction the exporter chose, and no amount of
 * fitting can recover it: the card cannot tell empty pixels from quiet ones.
 * Reported as "when logo is uploaded it doesn't fit well … becomes much
 * smaller", and the card's own inset and plinth were only two thirds of it.
 *
 * ALPHA ONLY, NEVER COLOUR. Fully transparent pixels are padding by
 * definition. White ones are not: plenty of marks are white, the card is dark,
 * and a JPEG has no alpha at all so a white-background logo is left exactly as
 * it is. Trimming what merely LOOKS like background would be this code
 * guessing at somebody's artwork.
 *
 * NULL WHENEVER IT CANNOT BE SURE, which is most of the ways this can go
 * wrong: a context that cannot give pixels, a canvas tainted by a
 * cross-origin source, an image that is transparent everywhere. The caller
 * falls back to the whole picture, which is what it did before this existed.
 */
export function alphaBounds(img, doc = document) {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) return null
  let data
  try {
    const probe = doc.createElement('canvas')
    probe.width = w
    probe.height = h
    const pctx = probe.getContext('2d')
    if (!pctx || typeof pctx.getImageData !== 'function') return null
    pctx.drawImage(img, 0, 0, w, h)
    data = pctx.getImageData(0, 0, w, h).data
  } catch {
    /* Tainted canvas, or a stub with no pixels. Not knowing is a real answer. */
    return null
  }
  if (!data || data.length < w * h * 4) return null

  /* 8 of 255, not 0. A one-per-cent ghost at the edge of an export is the
     antialiased tail of nothing, and treating it as content gives back the
     margin this is here to remove. */
  const FLOOR = 8
  let top = -1; let left = w; let right = -1; let bottom = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] <= FLOOR) continue
      if (top < 0) top = y
      bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (top < 0 || right < left) return null
  const box = { sx: left, sy: top, sw: right - left + 1, sh: bottom - top + 1 }
  /* Nothing worth doing under a couple of per cent — redrawing for three
     pixels costs a re-encode and changes the file for no visible gain. */
  return (box.sw >= w * 0.98 && box.sh >= h * 0.98) ? null : box
}

/** Square, centred, transparent where the picture does not reach. */
export function drawSquare(img, side, doc = document) {
  const canvas = doc.createElement('canvas')
  canvas.width = canvas.height = side
  const ctx = canvas.getContext('2d')
  /*
   * MEASURED FROM THE MARK AND NOT FROM THE FILE. `alphaBounds` answers with
   * the part of the image that has anything in it; without it — an older
   * browser, a tainted canvas, a JPEG — this is the whole picture and the
   * behaviour is what it always was.
   */
  const box = alphaBounds(img, doc)
  const w = box ? box.sw : (img.naturalWidth || img.width)
  const h = box ? box.sh : (img.naturalHeight || img.height)
  // Contain rather than cover: a logo cropped to fill a square loses the part
  // of itself that was doing the identifying.
  const scale = Math.min(side / w, side / h)
  const dw = Math.round(w * scale)
  const dh = Math.round(h * scale)
  const dx = Math.round((side - dw) / 2)
  const dy = Math.round((side - dh) / 2)
  if (box) ctx.drawImage(img, box.sx, box.sy, box.sw, box.sh, dx, dy, dw, dh)
  else ctx.drawImage(img, dx, dy, dw, dh)
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

  // The bytes, before the browser is asked to decode anything.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const whyBytes = rejectBytes(file.type, head)
  if (whyBytes) throw new Error(whyBytes)

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
