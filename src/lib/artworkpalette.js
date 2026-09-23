/*
 * THE TICKET'S OWN COLOURS, READ OFF THE TICKET.
 *
 * Every ink in DEFAULT_DESIGN was sampled by hand from the CEAM artwork —
 * #FDEFB0 for the gold the number is printed in, #0F490E for the dark green on
 * the stub. `scaleDefaults` scales the geometry to whatever is uploaded and
 * leaves the inks alone, so a raffle that uploads its own artwork gets CEAM's
 * gold printed on it and has to find four colour fields to fix it.
 *
 * So the colours are read from the picture instead, and the fields arrive
 * filled in. An organiser who wants something else still changes them; an
 * organiser who does not never sees the problem.
 *
 * WHERE THIS RUNS MATTERS. Sampling happens while the file is still on the
 * organiser's own machine, during upload, from a blob they chose. Reading the
 * artwork back from Storage would put a cross-origin image on the canvas and
 * getImageData would throw — the taint this repo has been wary of since the
 * digital-ticket work. Sampling at upload time means that never arises.
 */

import { parseHex, luminance } from './brand.js'

/*
 * Large enough that thin printed text survives the downscale. At 72 the gold
 * the CEAM number is set in vanished entirely — averaged into the green it sits
 * on — and the detector confidently returned a palette with no gold in it. Fine
 * detail is exactly where a ticket keeps its distinguishing colour.
 */
const GRID = 200

/* Buckets coarse enough that the hundreds of near-identical greens in a JPEG
 * land together, fine enough that gold and cream stay apart. */
const STEP = 24

const hex = ([r, g, b]) => '#' + [r, g, b]
  .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
  .join('').toUpperCase()

/**
 * Chroma, 0..1 — the spread between a pixel's strongest and weakest channel.
 *
 * Used in preference to HSL saturation, which is unusable at the ends of the
 * lightness range: #FEFEFF is white to any eye, but HSL calls it fully
 * saturated because one channel differs by 1/255 and the denominator has
 * collapsed. On the first real ticket that put white forward as the accent.
 * Chroma says 0.004 and is not fooled.
 */
export function chroma([r, g, b]) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

/** Saturation on the HSL scale, 0..1. Kept for callers that want the classic
 * measure; the palette below scores on chroma instead, for the reason above. */
export function saturation([r, g, b]) {
  const mx = Math.max(r, g, b) / 255
  const mn = Math.min(r, g, b) / 255
  if (mx === mn) return 0
  const l = (mx + mn) / 2
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn)
}

/**
 * Count the colours in an already-drawn canvas.
 *
 * Returns buckets sorted by how much of the picture they cover, each carrying
 * its average colour rather than its bucket corner — the corner is a colour
 * that may appear nowhere in the image, and it shows when you print it.
 *
 * @param {{ getContext: Function, width: number, height: number }} canvas
 * @returns {{ hex: string, rgb: number[], share: number, sat: number, lum: number }[]}
 */
export function countColours(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const bins = new Map()
  let kept = 0

  for (let i = 0; i < data.length; i += 4) {
    // A transparent or near-transparent pixel is the absence of artwork, not a
    // colour choice, so it must not vote.
    if (data[i + 3] < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = `${Math.round(r / STEP)},${Math.round(g / STEP)},${Math.round(b / STEP)}`
    const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    bin.r += r; bin.g += g; bin.b += b; bin.n += 1
    bins.set(key, bin)
    kept += 1
  }
  if (!kept) return []

  return [...bins.values()]
    .map((b) => {
      const rgb = [b.r / b.n, b.g / b.n, b.b / b.n]
      return { hex: hex(rgb), rgb, share: b.n / kept, sat: saturation(rgb), chroma: chroma(rgb), lum: luminance(rgb) }
    })
    .sort((a, b) => b.share - a.share)
}

/**
 * The four colours a ticket design needs.
 *
 * - `paper`  the field things are printed ON — the biggest area, whatever it is
 * - `ink`    what to print on that field so it can be read
 * - `accent` the ticket's own colour, the one somebody chose
 * - `mark`   for the editor's own handles: legible against the paper, and
 *            deliberately NOT one of the ticket's colours, because a handle
 *            that matches the artwork disappears into it
 *
 * `ink` is picked for contrast against `paper` rather than for being dark. On a
 * dark green ticket the readable ink is the gold, and a rule that always
 * reached for the darkest colour would return near-black and be unreadable.
 */
export function palette(buckets) {
  if (!buckets?.length) return null
  const paper = buckets[0]

  /* Real estate, not a fleck: a bucket under 0.5% is a JPEG artefact or an
   * anti-aliased edge, and picking it would theme the screen from noise. */
  const solid = buckets.filter((b) => b.share >= 0.005)

  const gap = (b) => Math.abs(b.lum - paper.lum)
  const readable = solid.filter((b) => gap(b) > 0.2)
  const ink = readable.slice().sort((a, b) => gap(b) - gap(a))[0] ?? paper

  /*
   * The chosen colour: the most saturated one with enough presence to have been
   * a decision rather than an artefact.
   *
   * IT MUST NOT BE THE PAPER, and on the first real artwork it was. A dark green
   * ticket is 15% dark green at saturation 0.54, which wins on both counts and
   * returns an accent identical to the background — a colour that cannot mark
   * anything. Distance from the paper is therefore part of the score, not a
   * filter applied afterwards, so a ticket printed in one hue still yields the
   * lighter or deeper version of it rather than giving up.
   */
  const far = (b) => Math.hypot(
    b.rgb[0] - paper.rgb[0], b.rgb[1] - paper.rgb[1], b.rgb[2] - paper.rgb[2],
  ) / 441.67
  /*
   * A higher floor than `solid`, because an accent must have presence to have
   * been a choice. One magenta pixel in two hundred is a compression artefact,
   * and at the 0.5% floor it out-scored the ticket's own colour on chroma
   * alone. The accent actually chosen off the real artwork covers 3.5%, so this
   * floor has room under it.
   */
  const accent = solid.filter((b) => b.share >= 0.015 && b.chroma > 0.08 && far(b) > 0.12)
    .sort((a, b) => (b.chroma * Math.sqrt(b.share) * far(b)) - (a.chroma * Math.sqrt(a.share) * far(a)))[0]
    ?? ink

  return {
    paper: paper.hex,
    ink: ink.hex,
    accent: accent.hex,
    mark: paper.lum > 0.5 ? '#B3261E' : '#FFD166',
    dark: paper.lum <= 0.5,
  }
}

/**
 * Draw an image small and read its palette. Browser only.
 *
 * Throws if the canvas is tainted, which is the caller's signal to keep the
 * defaults rather than to show an error — a design whose colours were guessed
 * is still a working design.
 */
export function paletteOf(img, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !img) return null
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) return null
  const canvas = doc.createElement('canvas')
  canvas.width = GRID
  canvas.height = Math.max(1, Math.round((h / w) * GRID))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return palette(countColours(canvas))
}

/**
 * Put the detected colours into a design, without disturbing anything else.
 *
 * Only the ink fields move. Geometry, sizes and switches are the organiser's,
 * and a colour detection that rearranged a ticket would be unforgivable.
 *
 * The two halves are printed on different parts of the artwork and usually in
 * different colours, so they are not given the same ink: the buyer's half is
 * the accent where that reads against the paper, the stub falls back to ink.
 */
/**
 * A deep copy that survives what the caller actually hands us.
 *
 * THE CRASH THIS EXISTS FOR, reported from the Artwork tab: "Failed to execute
 * 'structuredClone' on 'Window': #<Object> could not be cloned." Detecting the
 * artwork's colours died on that line and the tab was unusable.
 *
 * This read `structuredClone ? structuredClone(design) : JSON.parse(...)`. The
 * ternary is a FEATURE CHECK — does this runtime have the function — and the
 * failure is a THROW from a function that is very much present. So the JSON
 * fallback sitting right there was unreachable in the one case it was written
 * for. A fallback guarded on the wrong condition is not a fallback.
 *
 * WHAT IT CHOKED ON. `TicketDesign.vue` passes `design.value`, and that is a
 * Vue reactive PROXY. structuredClone refuses a Proxy outright, so this was
 * never going to work from the only caller it has — it threw on the first real
 * use, not on some edge case. Verified in Node: `structuredClone(reactive({}))`
 * raises DOMException with that exact message.
 *
 * try/catch RATHER THAN toRaw(). This module knows nothing about Vue and
 * should not learn: it is plain arithmetic over a design object, tested with
 * plain objects, and importing a framework here to unwrap one caller's
 * argument would put a UI dependency under a colour function. The catch also
 * covers the next uncloneable thing somebody passes — a Date subclass, a
 * function left on a config — which toRaw would not.
 */
function deepCopy(v) {
  try {
    return structuredClone(v)
  } catch {
    /* Proxies, functions and class instances all land here. JSON drops
       functions and undefined, which is correct for a design: every field it
       carries is a number, a string or a plain object. */
    return JSON.parse(JSON.stringify(v))
  }
}

export function inkDesign(design, pal) {
  if (!design || !pal) return design
  const main = pal.accent || pal.ink
  const stub = pal.ink || pal.accent
  const d = deepCopy(design)
  if (d.main) d.main.ink = main
  if (d.stub) d.stub.ink = stub
  if (d.book?.main) d.book.main.ink = main
  if (d.book?.stub) d.book.stub.ink = stub
  for (const f of Object.values(d.buyer?.fields ?? {})) f.ink = stub
  return d
}

/** Guard: a hex we are about to write into a design must be a real one. */
export function usable(value) {
  return !!parseHex(value)
}
