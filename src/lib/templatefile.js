/*
 * CHECKING A TICKET ARTWORK BEFORE IT IS SENT.
 *
 * The server checks all of this again and its answer is the one that counts —
 * see supabase/functions/api/templates.ts, where the byte sniff and the size
 * rules are enforced properly. What follows is a courtesy: it fails on the
 * device, immediately, with a sentence somebody can act on, instead of after a
 * slow upload over mobile data.
 *
 * IT ALSO DOES ONE THING THE SERVER CANNOT. A print-resolution ticket can be
 * larger than the 4 MB the function accepts, and the honest response to that is
 * not "too big, go away" but "this has been re-saved slightly smaller, here is
 * what changed". The canvas re-encode below does that and reports it, so an
 * organiser with a 9 MB PNG from a designer is not stuck.
 *
 * Modelled on logofile.js, which does the same job for the organisation's logo.
 */

/** What the server will accept. SVG is deliberately not here — see reject(). */
export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

/** The function's own limit. Anything above it is re-encoded, not refused. */
export const MAX_UPLOAD = 4 * 1024 * 1024

/** Bigger than this and the file is not a ticket, it is a mistake. */
export const MAX_SOURCE = 32 * 1024 * 1024

/** What a ticket wants for a sharp press run: 300 dpi across 190 mm. */
export const IDEAL_WIDTH_PX = 2244

/**
 * Why this file cannot be used, in words for whoever picked it — or null.
 *
 * SVG gets its own sentence rather than falling into "not a picture we can
 * use", because it IS a picture and being told otherwise would read as a bug.
 * It is refused because an SVG can carry script and would be served from this
 * raffle's own address, next to the session and several thousand phone numbers.
 */
export function reject(file) {
  if (!file) return 'No file was chosen.'
  const type = String(file.type || '').toLowerCase()
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    return 'SVG artwork cannot be uploaded, because an SVG can carry code and this ' +
      'one would be served from the raffle\'s own address. Save it as a PNG or ' +
      'JPEG and upload that instead.'
  }
  if (!ACCEPTED.includes(type)) return 'That is not a PNG, JPEG or WebP picture.'
  if (file.size > MAX_SOURCE) {
    return `That picture is ${Math.round(file.size / 1024 / 1024)} MB, which is far larger ` +
      'than a ticket design should be. Please check it is the right file.'
  }
  return null
}

/** The first bytes, so a renamed file is caught before anything is decoded. */
export function sniffType(bytes) {
  const starts = (sig) => sig.every((b, i) => bytes[i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x52, 0x49, 0x46, 0x46]) &&
      [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)) return 'image/webp'
  if (starts([0x3c, 0x3f, 0x78, 0x6d, 0x6c]) || starts([0x3c, 0x73, 0x76, 0x67])) return 'image/svg+xml'
  return null
}

/** The label against the bytes — or null if they agree. */
export function rejectBytes(declared, bytes) {
  const real = sniffType(bytes)
  if (real === 'image/svg+xml') {
    return 'That file is an SVG with a different name on it. SVG cannot be accepted, ' +
      'because it can carry code. Save it as a PNG or JPEG instead.'
  }
  if (!real) return 'That file is not a PNG, JPEG or WebP picture.'
  if (real !== String(declared || '').toLowerCase()) {
    return `That file is named as ${declared} but is really ${real}. Re-save it, or choose it again.`
  }
  return null
}

/** Strip the `data:...;base64,` prefix the server does not want. */
export function bare(dataUrl) {
  const i = String(dataUrl || '').indexOf(',')
  return i < 0 ? '' : dataUrl.slice(i + 1)
}

/**
 * Does this picture's shape match one the raffle prints?
 *
 * The same rule as the server's `matchSize`, so the refusal arrives before the
 * upload rather than after it. Returns the size it matched, or null.
 */
export function matchSize(width, height, sizes) {
  if (!(width > 0 && height > 0) || !Array.isArray(sizes)) return null
  const ratio = width / height
  for (const s of sizes) {
    const want = Number(s.widthMM) / Number(s.heightMM)
    const tol = Number(s.tolerance ?? 0.02)
    if (!(want > 0)) continue
    if (Math.abs(ratio - want) / want > tol) continue
    if (width < Number(s.minWidthPx ?? 0)) continue
    return s
  }
  return null
}

/** Why a picture was refused for its shape, in words — matching the server's. */
export function sizeComplaint(width, height, sizes) {
  const list = Array.isArray(sizes) ? sizes : []
  const near = list.find((s) => {
    const want = Number(s.widthMM) / Number(s.heightMM)
    return want > 0 && Math.abs(width / height - want) / want <= Number(s.tolerance ?? 0.02)
  })
  if (near && width < Number(near.minWidthPx ?? 0)) {
    return `It is the right shape for ${near.label}, but ${width} pixels wide. ` +
      `${near.minWidthPx} is the minimum, and about ${IDEAL_WIDTH_PX} would print sharply.`
  }
  const shapes = list.map((s) => `${s.label} (${(Number(s.widthMM) / Number(s.heightMM)).toFixed(2)} : 1)`)
  return `That picture is ${(width / height).toFixed(2)} : 1. This raffle prints ` +
    (shapes.length === 1 ? shapes[0] : shapes.join(', ')) + '.'
}

/** Draw the picture at a given width, keeping its shape. */
function redraw(img, width, doc = document) {
  const scale = width / img.naturalWidth
  const canvas = doc.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(img.naturalHeight * scale)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * The payload, or a thrown sentence.
 *
 * Returns `{ data, contentType, width, height, note }`, where `note` is either
 * null or a sentence saying what had to be done to fit — an organiser is told
 * that their 9 MB file was re-saved, rather than finding out from a blurry
 * proof three weeks later.
 *
 * `sizes` is the accepted list from the server; when it is given, a picture of
 * the wrong shape is refused HERE, before a slow upload that would be refused
 * anyway.
 */
export async function toPayload(file, sizes) {
  const why = reject(file)
  if (why) throw new Error(why)

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

    const width = img.naturalWidth
    const height = img.naturalHeight
    if (Array.isArray(sizes) && sizes.length && !matchSize(width, height, sizes)) {
      throw new Error(sizeComplaint(width, height, sizes))
    }

    // Small enough already: send the original bytes, untouched. Re-encoding a
    // file that did not need it would throw away quality for nothing.
    if (file.size <= MAX_UPLOAD) {
      const buf = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
      return {
        data: btoa(bin),
        contentType: String(file.type).toLowerCase(),
        width, height, note: null,
      }
    }

    /*
     * Too big. Re-encode as JPEG, narrowing only if it is still too big at full
     * width — quality first, then size, because a ticket that is 200 pixels
     * narrower still prints well and one that is heavily compressed does not.
     */
    for (const targetWidth of [width, Math.max(IDEAL_WIDTH_PX, width * 0.75), IDEAL_WIDTH_PX]) {
      const canvas = redraw(img, Math.round(targetWidth))
      const data = bare(canvas.toDataURL('image/jpeg', 0.92))
      // base64 is four characters per three bytes.
      if (data.length * 0.75 <= MAX_UPLOAD) {
        const was = Math.round(file.size / 1024 / 1024 * 10) / 10
        const now = Math.round(data.length * 0.75 / 1024 / 1024 * 10) / 10
        const narrower = canvas.width !== width ? `, and narrowed to ${canvas.width} pixels` : ''
        return {
          data,
          contentType: 'image/jpeg',
          width: canvas.width,
          height: canvas.height,
          note: `That picture was ${was} MB, over the ${MAX_UPLOAD / 1024 / 1024} MB limit, ` +
            `so it was re-saved as a JPEG${narrower} — ${now} MB.`,
        }
      }
    }
    throw new Error(
      `That picture is ${Math.round(file.size / 1024 / 1024)} MB and could not be made ` +
      `small enough. Save it as a JPEG about ${IDEAL_WIDTH_PX} pixels wide and try again.`)
  } finally {
    URL.revokeObjectURL(url)
  }
}
