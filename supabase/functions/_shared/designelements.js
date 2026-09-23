/*
 * DECORATIONS — the things somebody DRAWS, as opposed to the things the raffle
 * fills in.
 *
 * Until now a design held only fields: a ticket number, a buyer's name, a QR,
 * a line of typed words. Every one of those is a slot the app puts a value in.
 * Nothing on either tab could draw a rule under a heading, put a tint behind a
 * price, or place a mark in a corner — and that is most of what making a ticket
 * look designed actually consists of.
 *
 * A DECORATION IS NOT AN ELEMENT AND NOT A PART, and keeping the three apart is
 * the whole architecture:
 *
 *   ELEMENTS (ticketelements.js) print a VALUE. They have a source, and the
 *   app decides what they say.
 *   PARTS (cardelements.js) are the digital card's own composition. They are a
 *   fixed list this app owns, and an organiser moves them but cannot add one.
 *   DECORATIONS are neither. They say nothing the app knows about, they are
 *   created and removed freely, and they exist only because somebody drew them.
 *
 * ONE MODEL FOR BOTH TABS, for the same reason arrange.js is one module: the
 * printed ticket and the digital card hold position identically, as shares of
 * the artboard, and a rectangle is a rectangle on either. What differs is what
 * they are stored ALONGSIDE, which is the caller's problem and not this file's.
 *
 * STORED IN FULL, NOT SPARSELY — the one place this deliberately departs from
 * cardelements.js. A part overlay stores only what was MOVED, so a raffle keeps
 * every later improvement to the rest of the card. A decoration has no standard
 * version to improve: it is entirely somebody's own, and "only the differences"
 * against a default that does not exist is a rule with nothing to compare to.
 */

/* ---------- the vocabulary ---------- */

/*
 * SIX KINDS, AND THE LIST IS SHORT ON PURPOSE.
 *
 * Every one of these survives the thing tickets actually go through: printed
 * small on cheap stock, often in grey, folded, handled, and photographed under
 * a hall light to be scanned. A drawing tool that offers forty primitives on an
 * artefact like that is offering thirty-four ways to make a ticket worse.
 *
 * `icon` places one of the app's own drawings rather than an uploaded file. It
 * is here because Icon.vue is already a set of fifty-four stroke paths with no
 * colour of their own — which is exactly what a placeable mark needs to be, and
 * costs nothing to reuse.
 */
export const KINDS = ['rect', 'ellipse', 'line', 'text', 'image', 'icon']

/** Which kinds carry words, and therefore get the lettering controls. */
export const TEXTUAL = new Set(['text'])

export const FILLS = ['none', 'solid', 'gradient']
export const DASHES = ['solid', 'dashed', 'dotted']
export const WEIGHTS = ['regular', 'bold']
export const FAMILIES = ['text', 'number']
export const ALIGNS = ['left', 'centre', 'right']

/*
 * BLEND MODES, AND ONLY THE FOUR THAT MEAN SOMETHING ON A TICKET.
 *
 * `normal` is no blending. `multiply` is ink on paper — the one that behaves
 * the way a printed overlay actually behaves, and the only one that is safe
 * under a press. `screen` and `overlay` are for the digital card, which is a
 * picture on a lit screen and can afford them.
 *
 * The rest of the CSS list — colour-dodge, hard-light, luminosity and the other
 * dozen — are omitted rather than offered and warned about. On a grayscale
 * press every one of them collapses to something the designer never saw, and a
 * menu of sixteen where four work is a menu that mostly lies.
 */
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay']

/** How a picture sits in its box, and what shape the box cuts it to. */
export const FITS = ['contain', 'cover']
export const CLIPS = ['none', 'ellipse', 'rounded']

/* ---------- normalising, which never throws ---------- */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const tidy = (n) => Math.round(n * 1e6) / 1e6
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pick = (v, list, d) => (list.includes(v) ? v : d)

/** A colour this app will draw, or '' meaning "the design decides". */
const HEX = /^#[0-9a-f]{6}$/i
const ink = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : '')

/*
 * BOXES MAY LEAVE THE ARTBOARD, within reason, and that is not slack.
 * cardelements.js already allows it and says why: the watermark bleeds off the
 * right edge on purpose. A tint that runs to the trim, a rule that crosses the
 * perforation and a mark that hangs off a corner are all ordinary design, and
 * clamping them to 0–1 would make the tool unable to draw the commonest
 * things on a real ticket. The limits are there to catch a number that is
 * wrong, not to enforce a taste.
 */
/*
 * AND A LINE MAY HAVE A ZERO SIDE, WHICH IS WHAT A HORIZONTAL RULE IS.
 *
 * This read `num(b?.width, 0.1) || 0.1`, and the `||` was there to replace a
 * missing side with something visible. It also replaced a DELIBERATE zero,
 * because 0 is falsy — so a rule drawn with `height: 0` came out as a diagonal
 * across a tenth of the card. It was found by looking at a rendered ticket, not
 * by any assertion here, which is the second thing on this file that only a
 * picture could have told me.
 *
 * So the default applies when a side is ABSENT, never when it is zero, and the
 * floor is per kind: a rect or an ellipse with no area draws nothing and is a
 * mistake, while a line with no height is the commonest thing anybody draws.
 */
const side = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)

const minSide = (kind) => (kind === 'line' ? 0 : 0.0005)

const box = (b, kind) => ({
  left: tidy(clamp(num(b?.left), -1, 2)),
  top: tidy(clamp(num(b?.top), -1, 2)),
  width: tidy(clamp(side(b?.width, 0.1), minSide(kind), 3)),
  height: tidy(clamp(side(b?.height, 0.1), minSide(kind), 3)),
})

let seq = 0
export const nextDecoId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`
/* A group is only an id its members share; nothing else stores it. */
export const nextGroupId = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`

/* Letters and digits, forty at most — the same bound the server applies. */
const groupOf = (v) => String(v ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 40)

/**
 * One decoration, with every field present and sane.
 *
 * Anything unreadable becomes a default rather than an error, because this runs
 * inside a screen that is drawing somebody's ticket and inside the renderer
 * that produces the picture a buyer is sent. The strict half lives on the
 * server, in the action that SAVES — see `faultsIn` below, which is what the
 * API calls. A row quietly repaired at read time and refused at write time is
 * the pair this repo settled on for the supporter ladder, for the same reason:
 * the error belongs where somebody is looking at a form.
 */
export function normalDecoration(raw) {
  const kind = pick(raw?.kind, KINDS, 'rect')
  const fillType = pick(raw?.fill?.type, FILLS, kind === 'line' ? 'none' : 'solid')

  return {
    id: String(raw?.id || nextDecoId()),
    kind,
    /* Which half of a printed ticket it belongs to. Ignored by the card, which
       has no perforation — one field rather than two models. */
    half: raw?.half === 'stub' ? 'stub' : 'main',
    enabled: raw?.enabled !== false,
    /* Locked means "do not let a drag move this", nothing more. It is not a
       permission and it is not saved state about who may edit: it is the pin
       somebody puts in a background they have finished placing so they stop
       catching it while working on what sits over it. */
    locked: raw?.locked === true,
    /*
     * WHICH GROUP IT BELONGS TO, or '' for none. A group is its members sharing
     * this string and nothing more — no group record, no nesting — so a group
     * cannot outlive its shapes or point at one that has gone. A placed library
     * shape is its parts under one group, so a click on any part takes them all.
     */
    group: groupOf(raw?.group),
    /*
     * WHAT SOMEBODY CALLED IT, or '' to be called by its kind. A layer list of
     * "Rectangle, Rectangle, Rectangle" is a list somebody has to click through
     * to find the tint behind the price; "Price tint" is found by reading.
     * Forty characters, and no angle brackets — it is shown in markup.
     */
    name: String(raw?.name ?? '').replace(/[<>]/g, '').trim().slice(0, 40),
    /*
     * MIRRORED, across its own centre. Two booleans rather than a negative
     * width, because a box with a negative side is a box every other piece of
     * arithmetic in this studio would have to learn to read.
     */
    flipX: raw?.flipX === true,
    flipY: raw?.flipY === true,
    box: box(raw?.box, kind),
    /* Degrees, and whole ones. A rotation of 0.3° is a value somebody cannot
       have meant and cannot see; it arrives from a drag that was not quite
       still. */
    rotation: clamp(Math.round(num(raw?.rotation)), -180, 180),
    opacity: tidy(clamp(num(raw?.opacity, 1), 0, 1)),
    blend: pick(raw?.blend, BLENDS, 'normal'),

    fill: {
      type: fillType,
      colour: ink(raw?.fill?.colour) || '#000000',
      /* The far end of a gradient. Unused when the fill is solid, and kept
         rather than dropped so that switching to gradient and back does not
         lose the colour somebody already chose. */
      to: ink(raw?.fill?.to) || '#ffffff',
      angle: clamp(Math.round(num(raw?.fill?.angle, 90)), 0, 359),
    },

    stroke: {
      /* Width is in shares of the artboard's WIDTH, not pixels — the same
         reasoning as every other measurement here. A 2px rule on a 4000px
         artwork is invisible; a share survives the design being redrawn at any
         size, which is the promise the whole design model makes. */
      width: tidy(clamp(num(raw?.stroke?.width, kind === 'line' ? 0.002 : 0), 0, 0.2)),
      colour: ink(raw?.stroke?.colour) || '#000000',
      dash: pick(raw?.stroke?.dash, DASHES, 'solid'),
    },

    /* Corner rounding, as a share of the SHORTER side, so a wide box and a tall
       one with the same value look equally rounded. 0.5 is a capsule. */
    radius: tidy(clamp(num(raw?.radius), 0, 0.5)),

    /*
     * A SHADOW IS OFF UNTIL IT IS ASKED FOR, and `null` is how it says so
     * rather than a zero-blur shadow that still costs a filter on every render.
     */
    shadow: raw?.shadow
      ? {
        x: tidy(clamp(num(raw.shadow.x), -0.2, 0.2)),
        y: tidy(clamp(num(raw.shadow.y, 0.004), -0.2, 0.2)),
        blur: tidy(clamp(num(raw.shadow.blur, 0.004), 0, 0.2)),
        colour: ink(raw.shadow.colour) || '#000000',
        opacity: tidy(clamp(num(raw.shadow.opacity, 0.3), 0, 1)),
      }
      : null,

    text: {
      value: String(raw?.text?.value ?? '').slice(0, 120),
      family: pick(raw?.text?.family, FAMILIES, 'text'),
      weight: pick(raw?.text?.weight, WEIGHTS, 'regular'),
      align: pick(raw?.text?.align, ALIGNS, 'left'),
      /* Nothing here sets a size. The box does — the same rule the card's own
         textual parts follow, so lettering grows with what it is drawn in and
         a design survives being redrawn at another size. A separate size field
         is a second answer to one question. */
      tracking: tidy(clamp(num(raw?.text?.tracking), -0.1, 0.5)),
    },

    icon: { name: String(raw?.icon?.name ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 40) },
    image: {
      src: String(raw?.image?.src ?? '').slice(0, 512),
      /*
       * FIT OR FILL. `contain` shows the whole picture inside the box — right
       * for a logo, whose edges are the point. `cover` fills the box and crops
       * what spills — right for a photograph. `cover` is the default because it
       * is how every image drew before this was a choice.
       */
      fit: pick(raw?.image?.fit, FITS, 'cover'),
      /*
       * CLIPPED TO A SHAPE — the box as an ellipse, or with its corners
       * rounded by `radius`. The spec's "clip a picture to a shape" without a
       * mask tool: the shape is the decoration's own box, so there is nothing
       * second to draw, select or lose.
       */
      clip: pick(raw?.image?.clip, CLIPS, 'none'),
    },
  }
}

/** A whole list, in draw order — earlier is further back. */
export function normalDecorations(raw) {
  if (!Array.isArray(raw)) return []
  /* Capped. A design is a ticket, not a canvas: a thousand decorations is a
     file nobody can save and a render nobody can wait for, and the cap is the
     honest place to say so rather than discovering it at print time. */
  return raw.slice(0, MAX_DECORATIONS).map(normalDecoration)
}

export const MAX_DECORATIONS = 60

/* ---------- what the server refuses ---------- */

/**
 * Every reason a stored list cannot be accepted, or an empty array.
 *
 * Reasons rather than a boolean, and one per fault rather than the first:
 * somebody who has drawn twelve things wants to be told about all three that
 * are wrong, not to fix one and press Save again.
 */
export function faultsIn(list, opts = {}) {
  const bad = []
  if (list == null) return bad
  if (!Array.isArray(list)) return ['The decorations have to be a list.']
  if (list.length > MAX_DECORATIONS) {
    bad.push(`${list.length} decorations, and the limit is ${MAX_DECORATIONS}.`)
  }

  const seen = new Set()
  list.forEach((d, i) => {
    const where = `Decoration ${i + 1}`
    if (!d || typeof d !== 'object' || Array.isArray(d)) { bad.push(`${where} is not an object.`); return }
    const id = String(d.id ?? '')
    if (!id) bad.push(`${where} has no id.`)
    else if (seen.has(id)) bad.push(`${where} repeats the id ${id}.`)
    seen.add(id)

    if (d.image?.fit !== undefined && !FITS.includes(d.image.fit)) {
      bad.push(`${where} is fitted "${d.image.fit}", which is not one of ${FITS.join(', ')}.`)
    }
    if (d.image?.clip !== undefined && !CLIPS.includes(d.image.clip)) {
      bad.push(`${where} is clipped to "${d.image.clip}", which is not one of ${CLIPS.join(', ')}.`)
    }
    if (d.name !== undefined && (typeof d.name !== 'string' || d.name.length > 40 || /[<>]/.test(d.name))) {
      bad.push(`${where} has a name over forty characters, or with < or > in it.`)
    }
    if (d.group !== undefined && (typeof d.group !== 'string' || d.group !== groupOf(d.group))) {
      bad.push(`${where} has a group name the studio could not have made — letters and digits, forty at most.`)
    }
    if (d.kind !== undefined && !KINDS.includes(d.kind)) {
      bad.push(`${where} is a "${d.kind}", which is not one of ${KINDS.join(', ')}.`)
    }
    for (const k of ['left', 'top']) {
      if (d.box?.[k] !== undefined && !(num(d.box[k], NaN) >= -1 && num(d.box[k], NaN) <= 2)) {
        bad.push(`${where} is off the artboard — ${k} is ${d.box[k]}.`)
      }
    }
    /* A line is allowed a zero side — that is a horizontal or vertical rule,
       and refusing it would refuse the commonest decoration there is. */
    const floor = minSide(d.kind)
    for (const k of ['width', 'height']) {
      if (d.box?.[k] !== undefined && !(num(d.box[k], NaN) >= floor && num(d.box[k], NaN) <= 3)) {
        bad.push(`${where} has a ${k} of ${d.box[k]}.`)
      }
    }
    if (d.text?.value !== undefined && String(d.text.value).length > 120) {
      bad.push(`${where} carries ${String(d.text.value).length} characters and the limit is 120.`)
    }
    /* The same two characters the motto refuses, for the same reason: this ends
       up inside an SVG that goes to a buyer as a picture. */
    if (/[<>]/.test(String(d.text?.value ?? ''))) {
      bad.push(`${where} cannot contain < or >.`)
    }
    /*
     * A URL, NEVER A data: URI, AND THE REASON IS THE COLUMN IT LANDS IN.
     *
     * A printed design is stored whole as JSON on the template, and the note on
     * that limit says what it is for: "it holds coordinates, not pictures". A
     * data URI is a picture — one photograph pasted in would be larger than
     * every other measurement in the design put together, and sixty of them
     * would be a row nobody can save.
     *
     * So an image decoration REFERS to something already uploaded. That keeps a
     * decoration at about half a kilobyte whatever it draws, which is what made
     * it possible to raise the design limit by a sane amount rather than an
     * unbounded one.
     */
    if (d.image?.src && !/^https?:\/\//i.test(String(d.image.src))) {
      bad.push(`${where} points at a picture by ${String(d.image.src).slice(0, 12)}…. `
        + 'An image has to be one already uploaded to this raffle, referred to by '
        + 'its address — a design holds coordinates, not pictures.')
    }
  })

  /*
   * AND NOTHING MAY SIT ON THE CODE.
   *
   * The QR is the one thing on a ticket that fails silently: a tint across it,
   * a rule through it or a mark in its corner does not look broken on screen
   * and does not look broken on paper — it looks fine, and stops scanning. The
   * person who finds out is standing at a door with a phone that will not read
   * it, and by then the whole run is printed.
   *
   * So this is a refusal rather than a warning, and it is the only one in this
   * file that is about taste at all. Everything else here catches a value that
   * is wrong; this catches a design that is legal and will not work.
   */
  /*
   * EVERY code box, not one. A printed ticket has a QR on the main half AND one
   * on the stub, and a rule that only knew about the first would be a rule that
   * protected half the tickets — which is worse than none, because it would
   * look like it was working.
   */
  const codes = (opts.codeBoxes || []).filter((c) => c && Number.isFinite(Number(c.width)))
  if (codes.length) {
    list.forEach((d, i) => {
      if (!d?.box || d.enabled === false) return
      const b = box(d.box, d.kind)
      const hits = codes.some((code) => !(
        b.left >= code.left + code.width || b.left + b.width <= code.left
        || b.top >= code.top + code.height || b.top + b.height <= code.top))
      if (hits) {
        bad.push(`Decoration ${i + 1} overlaps the check code. Anything drawn over or `
          + 'under a QR stops it scanning, and nothing about the ticket looks wrong '
          + 'until somebody is at the door with it.')
      }
    })
  }
  return bad
}

/* ---------- drawing ---------- */

/*
 * SVG, because everything else this app draws is SVG and because it is the one
 * format that is the same artefact on a screen, in a chat and on a press.
 *
 * WHAT IS HERE AND WHAT IS NOT. Fill, gradient, stroke, dash, corner radius,
 * rotation, opacity, blend and drop shadow are all native SVG and all of them
 * survive being rasterised for a chat and separated for a press. Masks and
 * arbitrary vector paths are NOT here, and that is a decision rather than a
 * stopping point: a mask needs a second shape to mask WITH, and a path needs a
 * pen tool — each is a UI of its own rather than another field on this one, and
 * shipping the model for them without the tools would be a shape in the file
 * that nothing can produce.
 */
/*
 * QUOTES TOO, AND THAT IS NOT BELT-AND-BRACES.
 *
 * `esc` escaped &, < and > and shipped a card that would not render. A font
 * stack is `Padauk, "Noto Sans Myanmar", "Myanmar Text", system-ui` — it
 * CONTAINS double quotes — so `font-family="…"` closed itself at the first one
 * and the rest of the element became malformed attributes. The picture did not
 * draw at all.
 *
 * ticketart.js has known this for longer than this file has existed: its own
 * note says a quote in a font-family attribute killed it once, and every
 * font-family it writes is single-quoted for that reason. Doing it here too,
 * AND escaping the character, because one of those alone is a rule somebody
 * has to remember at every call site and the other is not.
 */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const DASH_FOR = { solid: '', dashed: '4 3', dotted: '1 2.5' }

/**
 * One decoration as SVG, in the artboard's own pixel space.
 *
 * `w` and `h` are the artboard in pixels; every share is multiplied up here so
 * that the caller never has to know the shape of a box.
 */
export function decorationSVG(d, w, h, ctx = {}) {
  const el = normalDecoration(d)
  if (!el.enabled) return ''

  const x = el.box.left * w
  const y = el.box.top * h
  const bw = Math.max(0.5, el.box.width * w)
  const bh = Math.max(0.5, el.box.height * h)
  const sw = el.stroke.width * w

  const uid = `d${String(el.id).replace(/[^a-z0-9]/gi, '')}`
  const defs = []

  let fill = 'none'
  if (el.fill.type === 'solid') fill = el.fill.colour
  else if (el.fill.type === 'gradient') {
    const a = (el.fill.angle % 360) * Math.PI / 180
    const dx = Math.cos(a) / 2
    const dy = Math.sin(a) / 2
    defs.push(
      `<linearGradient id="${uid}g" x1="${(0.5 - dx).toFixed(4)}" y1="${(0.5 - dy).toFixed(4)}" `
      + `x2="${(0.5 + dx).toFixed(4)}" y2="${(0.5 + dy).toFixed(4)}">`
      + `<stop offset="0" stop-color="${el.fill.colour}"/>`
      + `<stop offset="1" stop-color="${el.fill.to}"/></linearGradient>`)
    fill = `url(#${uid}g)`
  }

  if (el.shadow) {
    defs.push(
      `<filter id="${uid}s" x="-30%" y="-30%" width="160%" height="160%">`
      + `<feDropShadow dx="${(el.shadow.x * w).toFixed(2)}" dy="${(el.shadow.y * h).toFixed(2)}" `
      + `stdDeviation="${(el.shadow.blur * w).toFixed(2)}" flood-color="${el.shadow.colour}" `
      + `flood-opacity="${el.shadow.opacity}"/></filter>`)
  }

  const strokeAttrs = sw > 0
    ? ` stroke="${el.stroke.colour}" stroke-width="${sw.toFixed(2)}"`
      + (DASH_FOR[el.stroke.dash] ? ` stroke-dasharray="${DASH_FOR[el.stroke.dash]
        .split(' ').map((n) => (Number(n) * sw).toFixed(2)).join(' ')}"` : '')
      + ' stroke-linecap="round"'
    : ''

  let body = ''
  if (el.kind === 'rect') {
    /* The radius is a share of the shorter side, so a wide box and a tall one
       with the same value read as equally rounded. */
    const r = (el.radius * Math.min(bw, bh)).toFixed(2)
    body = `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" `
      + `height="${bh.toFixed(2)}" rx="${r}" ry="${r}" fill="${fill}"${strokeAttrs}/>`
  } else if (el.kind === 'ellipse') {
    body = `<ellipse cx="${(x + bw / 2).toFixed(2)}" cy="${(y + bh / 2).toFixed(2)}" `
      + `rx="${(bw / 2).toFixed(2)}" ry="${(bh / 2).toFixed(2)}" fill="${fill}"${strokeAttrs}/>`
  } else if (el.kind === 'line') {
    /* Corner to corner of its own box, so a line is dragged out the same way
       every other decoration is rather than needing two handles of its own. */
    body = `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" `
      + `x2="${(x + bw).toFixed(2)}" y2="${(y + bh).toFixed(2)}"`
      + (strokeAttrs || ` stroke="${el.fill.colour}" stroke-width="${Math.max(1, h * 0.002).toFixed(2)}"`)
      + '/>'
  } else if (el.kind === 'text') {
    const size = bh
    const anchor = el.text.align === 'centre' ? 'middle' : el.text.align === 'right' ? 'end' : 'start'
    const tx = el.text.align === 'centre' ? x + bw / 2 : el.text.align === 'right' ? x + bw : x
    body = `<text x="${tx.toFixed(2)}" y="${(y + bh).toFixed(2)}" text-anchor="${anchor}" `
      /* SINGLE-QUOTED, like every other font-family this app writes. A stack
         carries double quotes of its own and would close the attribute. */
      + `font-size="${size.toFixed(2)}" font-family='${el.text.family === 'number'
        ? esc(ctx.numberFamily || 'serif') : esc(ctx.textFamily || 'sans-serif')}' `
      + `font-weight="${el.text.weight === 'bold' ? '700' : '400'}" `
      + (el.text.tracking ? `letter-spacing="${(el.text.tracking * size).toFixed(2)}" ` : '')
      + `fill="${fill === 'none' ? el.fill.colour : fill}">${esc(el.text.value)}</text>`
  } else if (el.kind === 'icon') {
    /*
     * An icon is drawn on its own 24 grid, so it is scaled into the box rather
     * than having its path rewritten. It takes the FILL colour as its stroke,
     * because the set has no colour of its own — which is the property that
     * made it worth reusing here.
     */
    const path = (ctx.icons || {})[el.icon.name]
    if (!path) return ''
    const k = Math.min(bw, bh) / 24
    const ox = x + (bw - 24 * k) / 2
    const oy = y + (bh - 24 * k) / 2
    body = `<g transform="translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${k.toFixed(4)})">`
      + `<path d="${path}" fill="none" stroke="${el.fill.colour}" stroke-width="1.8" `
      + 'stroke-linecap="round" stroke-linejoin="round"/></g>'
  } else if (el.kind === 'image') {
    if (!el.image.src) return ''
    let clip = ''
    if (el.image.clip !== 'none') {
      const shape = el.image.clip === 'ellipse'
        ? `<ellipse cx="${(x + bw / 2).toFixed(2)}" cy="${(y + bh / 2).toFixed(2)}" rx="${(bw / 2).toFixed(2)}" ry="${(bh / 2).toFixed(2)}"/>`
        : `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" `
          + `rx="${(el.radius * Math.min(bw, bh)).toFixed(2)}"/>`
      defs.push(`<clipPath id="${uid}c">${shape}</clipPath>`)
      clip = ` clip-path="url(#${uid}c)"`
    }
    body = `<image x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" `
      + `height="${bh.toFixed(2)}" href="${esc(el.image.src)}" `
      + `preserveAspectRatio="xMidYMid ${el.image.fit === 'contain' ? 'meet' : 'slice'}"${clip}/>`
  }
  if (!body) return ''

  const wrap = []
  if (el.opacity < 1) wrap.push(`opacity="${el.opacity}"`)
  if (el.blend !== 'normal') wrap.push(`style="mix-blend-mode:${el.blend}"`)
  if (el.shadow) wrap.push(`filter="url(#${uid}s)"`)
  /*
   * TURNED AND MIRRORED ABOUT THE BOX'S OWN CENTRE, in one transform. SVG
   * applies a transform list right to left, so this reads: move the centre to
   * the origin, mirror, turn, move back — a mirrored shape turns the way it
   * LOOKS, not the way it was before it was mirrored.
   */
  const cx = (x + bw / 2).toFixed(2), cy = (y + bh / 2).toFixed(2)
  if (el.flipX || el.flipY) {
    const parts = [`translate(${cx} ${cy})`]
    if (el.rotation) parts.push(`rotate(${el.rotation})`)
    parts.push(`scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1})`)
    parts.push(`translate(${-cx} ${-cy})`)
    wrap.push(`transform="${parts.join(' ')}"`)
  } else if (el.rotation) {
    /* Unmirrored, the form every design saved before flipping existed was
       drawn in — kept byte for byte, so those tickets print as they did. */
    wrap.push(`transform="rotate(${el.rotation} ${cx} ${cy})"`)
  }

  const inner = (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body
  return wrap.length ? `<g ${wrap.join(' ')}>${inner}</g>` : inner
}

/** A whole layer, in draw order. */
export function decorationLayerSVG(list, w, h, ctx = {}) {
  return normalDecorations(list).map((d) => decorationSVG(d, w, h, ctx)).join('')
}

/*
 * WHAT WILL NOT SURVIVE A PRESS, as findings rather than refusals.
 *
 * Tickets are printed small, often in grey, on stock that soaks up ink, and
 * then photographed. These are the four things that reliably look right on a
 * screen and wrong on paper. They are reported and not blocked, because every
 * one of them is legitimate on the digital card — which is a picture on a lit
 * screen and has none of these problems.
 */
export function printWarnings(list, opts = {}) {
  const out = []
  if (!opts.printed) return out
  normalDecorations(list).forEach((d, i) => {
    if (!d.enabled) return
    const where = `Decoration ${i + 1}`
    if (d.fill.type === 'gradient') {
      out.push(`${where} is a gradient. Presses lay these down in visible steps, `
        + 'and a grey one bands worse than a coloured one.')
    }
    if (d.shadow) {
      out.push(`${where} has a shadow. Soft edges fill in on absorbent stock and `
        + 'print as a grey smudge rather than a shadow.')
    }
    if (d.blend !== 'normal' && d.blend !== 'multiply') {
      out.push(`${where} uses ${d.blend}. Only multiply behaves on paper the way `
        + 'it does on screen — the others are worked out in light.')
    }
    /*
     * A PICTURE STRETCHED PAST ITS PIXELS. A logo uploaded for the app's header
     * is a few hundred pixels across; placed two centimetres wide on a ticket
     * it prints at a resolution a press shows as blur. Only checkable once the
     * picture has loaded and its width is known, so it is skipped otherwise.
     */
    const natural = Number(opts.pictureWidths?.[d.image?.src])
    const mm = Number(opts.widthMM)
    if (d.kind === 'image' && natural > 0 && mm > 0 && d.box.width > 0) {
      const dpi = natural / ((d.box.width * mm) / 25.4)
      if (dpi < 200) {
        out.push(`${where} is a picture that will print at about ${Math.round(dpi)} dpi. `
          + 'Under 200 it prints soft — make it smaller, or use a larger picture.')
      }
    }
    if (d.stroke.width > 0 && d.stroke.width < 0.0004) {
      out.push(`${where} has a hairline that is thinner than most presses can hold. `
        + 'It will break up or disappear.')
    }
  })
  return out
}
