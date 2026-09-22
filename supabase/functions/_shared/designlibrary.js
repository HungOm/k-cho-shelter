/*
 * THE LIBRARY — things a raffle has made once and wants again.
 *
 * Every other piece of this studio is about ONE design. The library is the only
 * part that outlives one: a badge somebody drew for last year's raffle, the two
 * colours their printer matched, the lettering they settled on for a heading.
 * Without it, a second raffle starts from nothing and a second TICKET starts
 * from nothing, and the answer to "make it look like the other one" is to do it
 * again by eye.
 *
 * THREE KINDS, AND THEY ARE THREE BECAUSE THEY ARE REUSED DIFFERENTLY:
 *
 *   SHAPES are a composition — one or more decorations saved together, with
 *   their arrangement. Placed as a group and then moved as a group.
 *   COLOURS are named. `swatches` in the studio today are read off the artwork
 *   and lost on reload, so a raffle that matched its printer's ink has nowhere
 *   to put the answer.
 *   TEXT STYLES are a face, a weight, an alignment and a tracking under a name,
 *   applied to words already on the ticket.
 *
 * A SAVED SHAPE HOLDS ITS PARTS RELATIVE TO ITSELF, which is the one decision
 * the rest of this file follows from. The decorations in a design are shares of
 * the ARTBOARD; a saved shape's are shares of its OWN BOUNDS. So placing one
 * anywhere, at any size, keeps its internal arrangement — a badge whose rule
 * sits a third of the way down stays a third of the way down whether it is
 * dropped at 40mm or 8mm. Storing artboard shares instead would make a saved
 * shape only reusable at the size and position it was saved from, which is the
 * same as not saving it.
 *
 * IT IS .js AND NOT .ts FOR THE REASON WRITTEN IN designelements.js: anything
 * reachable from a renderer that a plain-Node test imports has to be loadable
 * by Node, and the failure when it is not is the suite STOPPING rather than an
 * assertion going red.
 */

import { normalDecoration, normalDecorations } from './designelements.js'

export const MAX_SHAPES = 40
export const MAX_COLOURS = 24
export const MAX_STYLES = 16
/* A saved shape is a motif, not a design. Sixty decorations is the whole
   ticket's budget; a badge that used half of it would leave a raffle unable to
   place two of them. */
export const MAX_PARTS = 12

const str = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const HEX = /^#[0-9a-f]{6}$/i
const ink = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : '')
const tidy = (n) => Math.round(n * 1e6) / 1e6

let seq = 0
export const nextLibId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

/* ---------- reading, which never throws ---------- */

function normalShape(raw) {
  const parts = normalDecorations(raw?.parts).slice(0, MAX_PARTS)
  return {
    id: String(raw?.id || nextLibId('s')),
    name: str(raw?.name, 40) || 'Saved shape',
    parts,
  }
}

function normalColour(raw) {
  return {
    id: String(raw?.id || nextLibId('c')),
    name: str(raw?.name, 32) || 'Colour',
    value: ink(raw?.value) || '#000000',
  }
}

function normalStyle(raw) {
  const d = normalDecoration({ kind: 'text', text: raw })
  return {
    id: String(raw?.id || nextLibId('t')),
    name: str(raw?.name, 32) || 'Style',
    family: d.text.family,
    weight: d.text.weight,
    align: d.text.align,
    tracking: d.text.tracking,
    colour: ink(raw?.colour) || '',
  }
}

/** A stored library, or an empty one. Never throws — see designelements.js. */
export function normalLibrary(raw) {
  let o = raw
  if (typeof o === 'string') {
    try { o = JSON.parse(o) } catch { o = null }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {}
  return {
    shapes: (Array.isArray(o.shapes) ? o.shapes : []).slice(0, MAX_SHAPES).map(normalShape),
    colours: (Array.isArray(o.colours) ? o.colours : []).slice(0, MAX_COLOURS).map(normalColour),
    styles: (Array.isArray(o.styles) ? o.styles : []).slice(0, MAX_STYLES).map(normalStyle),
  }
}

export const EMPTY_LIBRARY = { shapes: [], colours: [], styles: [] }

/* ---------- saving and placing ---------- */

/**
 * Turn a selection into a saved shape: boxes become shares of their own bounds.
 *
 * A single decoration saved this way becomes a full-bleed 0,0,1,1 — which is
 * correct and is what makes one shape and a group of six behave identically
 * when placed.
 */
export function shapeFrom(decorations, name) {
  const list = normalDecorations(decorations).slice(0, MAX_PARTS)
  if (!list.length) return null

  const left = Math.min(...list.map((d) => d.box.left))
  const top = Math.min(...list.map((d) => d.box.top))
  const right = Math.max(...list.map((d) => d.box.left + d.box.width))
  const bottom = Math.max(...list.map((d) => d.box.top + d.box.height))
  /* A group with no extent in one axis — three rules stacked, all flat — would
     divide by zero. It keeps that axis whole instead, which places back as the
     same flat run at whatever width it is dropped. */
  const w = right - left || 1
  const h = bottom - top || 1

  return normalShape({
    name,
    parts: list.map((d) => ({
      ...d,
      box: {
        left: tidy((d.box.left - left) / w),
        top: tidy((d.box.top - top) / h),
        width: tidy(d.box.width / w),
        height: tidy(d.box.height / h),
      },
    })),
  })
}

/**
 * Place a saved shape into a box on the artboard: shares of itself become
 * shares of the artboard again.
 *
 * New ids every time, because the same saved shape placed twice must be two
 * things somebody can move apart — and because an id that repeats is a fault
 * the server refuses.
 */
export function placeShape(shape, box, makeId = () => nextLibId('d')) {
  const s = normalShape(shape)
  const b = {
    left: Number(box?.left) || 0,
    top: Number(box?.top) || 0,
    width: Number(box?.width) || 0.2,
    height: Number(box?.height) || 0.2,
  }
  return s.parts.map((p) => normalDecoration({
    ...p,
    id: makeId(),
    box: {
      left: tidy(b.left + p.box.left * b.width),
      top: tidy(b.top + p.box.top * b.height),
      width: tidy(p.box.width * b.width),
      height: tidy(p.box.height * b.height),
    },
  }))
}

/* ---------- what the server refuses ---------- */

export function libraryFaults(raw) {
  const bad = []
  if (raw == null || raw === '') return bad
  let o = raw
  if (typeof o === 'string') {
    try { o = JSON.parse(o) } catch { return ['The library could not be read.'] }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['The library has to be an object.']

  const check = (list, kind, max) => {
    if (list === undefined) return []
    if (!Array.isArray(list)) return [`The ${kind} have to be a list.`]
    const out = []
    if (list.length > max) out.push(`${list.length} ${kind}, and the limit is ${max}.`)
    const seen = new Set()
    list.forEach((x, i) => {
      const where = `${kind.replace(/s$/, '')} ${i + 1}`
      if (!x || typeof x !== 'object') { out.push(`${where} could not be read.`); return }
      const id = String(x.id ?? '')
      if (!id) out.push(`${where} has no id.`)
      else if (seen.has(id)) out.push(`${where} repeats the id ${id}.`)
      seen.add(id)
      /*
       * A NAME IS REQUIRED AND THAT IS NOT PEDANTRY. The library is a list
       * somebody reads later: an unnamed entry is one they have to place to
       * find out what it is, and a panel of six of those is worse than an
       * empty panel.
       */
      if (!str(x.name, 40)) out.push(`${where} has no name.`)
      if (kind === 'colours' && !ink(x.value)) {
        out.push(`${where} is not a colour this app can draw.`)
      }
      if (kind === 'shapes') {
        if (!Array.isArray(x.parts) || !x.parts.length) out.push(`${where} has nothing in it.`)
        else if (x.parts.length > MAX_PARTS) {
          out.push(`${where} has ${x.parts.length} pieces, and the limit is ${MAX_PARTS}.`)
        }
      }
    })
    return out
  }

  bad.push(...check(o.shapes, 'shapes', MAX_SHAPES))
  bad.push(...check(o.colours, 'colours', MAX_COLOURS))
  bad.push(...check(o.styles, 'styles', MAX_STYLES))
  return bad
}

/* ---------- what ships with the app ---------- */

/*
 * FOUR THINGS SO THE PANEL IS NOT EMPTY ON THE FIRST DAY.
 *
 * An empty library is a feature nobody discovers: there is nothing to place, so
 * nothing explains what placing would do. These are the four motifs a raffle
 * ticket actually uses, drawn from the parts already in the model, and they are
 * deliberately plain — a starting point somebody edits, not a house style.
 *
 * They are NOT stored. A raffle that has never opened the panel has a blank
 * config row and gets these; one that saves its own keeps both. So improving a
 * built-in reaches every raffle, which is the same reasoning as the card's
 * sparse overlay.
 */
export const BUILT_IN = [
  {
    id: 'b-rule', name: 'Rule',
    parts: [{ kind: 'line', box: { left: 0, top: 0, width: 1, height: 0 }, stroke: { width: 0.004 } }],
  },
  {
    id: 'b-doublerule', name: 'Double rule',
    parts: [
      { kind: 'line', box: { left: 0, top: 0, width: 1, height: 0 }, stroke: { width: 0.006 } },
      { kind: 'line', box: { left: 0, top: 1, width: 1, height: 0 }, stroke: { width: 0.002 } },
    ],
  },
  {
    id: 'b-panel', name: 'Tint panel',
    parts: [{ kind: 'rect', box: { left: 0, top: 0, width: 1, height: 1 }, radius: 0.08, opacity: 0.12 }],
  },
  {
    id: 'b-seal', name: 'Seal',
    parts: [
      { kind: 'ellipse', box: { left: 0, top: 0, width: 1, height: 1 }, fill: { type: 'none' }, stroke: { width: 0.03 } },
      { kind: 'ellipse', box: { left: 0.09, top: 0.09, width: 0.82, height: 0.82 }, fill: { type: 'none' }, stroke: { width: 0.01 } },
    ],
  },
].map(normalShape)
